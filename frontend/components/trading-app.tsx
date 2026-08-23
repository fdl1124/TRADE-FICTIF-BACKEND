"use client"

import { Activity as ReactActivity, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Bell,
  Bitcoin,
  BookOpen,
  BrainCircuit,
  BriefcaseBusiness,
  ChartCandlestick,
  ChevronRight,
  Clock3,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Target,
  Wifi,
} from "lucide-react"
import {
  approveAiDecision,
  cancelOrder,
  getAccount,
  getAccountSummary,
  getAiConfig,
  getAiDecisions,
  getAssetPrice,
  getAssets,
  getOrders,
  getPositions,
  postOrder,
  putAiConfig,
  rejectAiDecision,
} from "@/lib/api"
import { onAuthChange, signOutUser } from "@/lib/auth/client"
import { TradingApiError, humanizeApiError } from "@/lib/api/errors"
import { createPriceClient } from "@/lib/websocket/prices"
import { isMockMode, useTrading } from "@/store/use-trading"
import { money, signed, type View } from "@/lib/trading"
import type { HistoryRange, OrderStatus } from "@/lib/types"
import { PriceChart } from "./price-chart"

const nav: [View, string, typeof LayoutDashboard][] = [
  ["dashboard", "Vue d’ensemble", LayoutDashboard],
  ["market", "Marché", ChartCandlestick],
  ["positions", "Positions", BriefcaseBusiness],
  ["orders", "Ordres", BookOpen],
  ["performance", "Performance", Target],
  ["agent", "Agent IA", BrainCircuit],
  ["settings", "Paramètres", Settings],
]

const rangeLabels: [string, HistoryRange][] = [
  ["1J", "1d"],
  ["1S", "1w"],
  ["1M", "1m"],
]

let refreshData: (() => Promise<void>) | null = null

async function refreshTradingData(): Promise<void> {
  await refreshData?.()
}

function isUsMarketOpen(): boolean {
  const parts: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date())) {
    parts[part.type] = part.value
  }
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(parts.weekday ?? "")) return false
  const minutes = Number.parseInt(parts.hour ?? "0", 10) * 60 + Number.parseInt(parts.minute ?? "0", 10)
  return minutes >= 570 && minutes < 960
}

function Pnl({ value, percent }: { value: number; percent?: number }) {
  const up = value >= 0
  return (
    <span className={`mono pnl ${up ? "positive" : "negative"}`}>
      {up ? "+" : "−"}
      {money(Math.abs(value))}
      {percent !== undefined && ` (${up ? "+" : "−"}${Math.abs(percent).toFixed(2)}%)`}
    </span>
  )
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "cyan" }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

function AssetIcon({ symbol }: { symbol: string }) {
  return <span className="asset-icon">{symbol.startsWith("BTC") ? <Bitcoin /> : symbol.slice(0, 1)}</span>
}

function SectionHead({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  )
}

function useLiveData() {
  const router = useRouter()
  const setData = useTrading((s) => s.setData)
  const applyTick = useTrading((s) => s.applyTick)
  const setUser = useTrading((s) => s.setUser)
  const setAuthReady = useTrading((s) => s.setAuthReady)
  const setPriceState = useTrading((s) => s.setPriceState)

  const loadCore = useCallback(async () => {
    const [account, summary, assets, positions, orders, decisions, aiConfig] = await Promise.allSettled([
      getAccount(),
      getAccountSummary(),
      getAssets(),
      getPositions(),
      getOrders({ limit: 100 }),
      getAiDecisions(100),
      getAiConfig(),
    ])
    const patch: Parameters<typeof setData>[0] = {}
    if (account.status === "fulfilled") patch.account = account.value
    if (summary.status === "fulfilled") patch.summary = summary.value
    if (assets.status === "fulfilled") patch.assets = assets.value
    if (positions.status === "fulfilled") patch.positions = positions.value
    if (orders.status === "fulfilled") patch.orders = orders.value
    if (decisions.status === "fulfilled") patch.decisions = decisions.value
    if (aiConfig.status === "fulfilled") {
      patch.aiConfig = aiConfig.value
      useTrading.setState({ watchlist: aiConfig.value.watchedSymbols })
    }
    setData(patch)
    if (assets.status === "fulfilled") {
      for (const asset of assets.value) {
        getAssetPrice(asset.symbol)
          .then(applyTick)
          .catch(() => undefined)
      }
    }
  }, [setData, applyTick])

  useEffect(() => {
    refreshData = loadCore
  }, [loadCore])

  useEffect(() => {
    if (isMockMode) return
    const unsubscribe = onAuthChange((user) => {
      setUser(user)
      setAuthReady(true)
      if (user) {
        void loadCore()
      } else {
        router.replace("/login")
      }
    })
    return unsubscribe
  }, [router, setUser, setAuthReady, loadCore])

  useEffect(() => {
    if (isMockMode) return
    const client = createPriceClient(
      (tick) => applyTick(tick),
      (state) => setPriceState(state),
    )
    const unsubscribeAssets = useTrading.subscribe((state, previous) => {
      if (state.assets !== previous.assets && state.assets.length > 0) {
        client.subscribe(state.assets.map((asset) => asset.symbol))
      }
    })
    return () => {
      unsubscribeAssets()
      client.close()
    }
  }, [applyTick, setPriceState])

  useEffect(() => {
    if (isMockMode) return
    const interval = setInterval(() => {
      void Promise.allSettled([getAccountSummary(), getPositions(), getOrders({ limit: 100 }), getAiDecisions(100)]).then(
        ([summary, positions, orders, decisions]) => {
          const patch: Parameters<typeof setData>[0] = {}
          if (summary.status === "fulfilled") patch.summary = summary.value
          if (positions.status === "fulfilled") patch.positions = positions.value
          if (orders.status === "fulfilled") patch.orders = orders.value
          if (decisions.status === "fulfilled") patch.decisions = decisions.value
          setData(patch)
        },
      )
    }, 20000)
    return () => clearInterval(interval)
  }, [setData])
}

function Shell({ children }: { children: React.ReactNode }) {
  const { view, setView, summary, priceState, user, decisions, aiConfig } = useTrading()
  const pendingApprovals = decisions.filter(
    (d) => d.validationPassed && d.action !== "HOLD" && !d.resultingOrderId && aiConfig?.mode === "propose",
  ).length
  const priceLabel = priceState === "live" ? "PRIX EN DIRECT" : priceState === "connecting" ? "CONNEXION…" : "RECONNEXION…"
  const initials = (user?.displayName ?? user?.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>LEDGER</strong>
            <span>SIMULATED MARKETS</span>
          </div>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button key={id} onClick={() => setView(id)} className={view === id ? "active" : ""}>
              <Icon />
              <span>{label}</span>
              {id === "agent" && pendingApprovals > 0 && <b>{pendingApprovals}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ShieldAlert />
          <div>
            <strong>Discipline réelle</strong>
            <span>Capital fictif • Règles réelles</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="discipline-rail">
          <div className="mobile-brand">
            <Menu />
            <strong>LEDGER</strong>
          </div>
          <div className="rail-metric">
            <span>SOLDE DISPONIBLE</span>
            <strong className="mono">{money(summary?.balance ?? 0)}</strong>
          </div>
          <div className="rail-metric">
            <span>P&L TOTAL</span>
            {summary ? <Pnl value={summary.totalPnl} percent={summary.totalPnlPercent} /> : <span className="mono">—</span>}
          </div>
          <div className="rail-state">
            <Wifi />
            <span>{priceLabel}</span>
            <i>{priceState === "live" ? "À l’instant" : "En attente"}</i>
          </div>
          <button className="icon-btn" aria-label="Notifications">
            <Bell />
          </button>
          <div className="avatar">{initials}</div>
        </header>
        <main>{children}</main>
      </div>
      <nav className="bottom-nav">
        {nav.slice(0, 6).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setView(id)} className={view === id ? "active" : ""}>
            <Icon />
            <span>{label.split(" ")[0]}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function Dashboard() {
  const { setView, selectAsset, summary, account, positions, assets, prices, decisions, watchlist } = useTrading()
  const watchAssets = watchlist.filter((symbol) => assets.some((a) => a.symbol === symbol))
  return (
    <>
      <SectionHead
        eyebrow="VOTRE PORTFUEILLE SIMULÉ"
        title="Vue d’ensemble"
        copy="Votre exposition, vos risques et vos décisions — sans embellissement."
        action={
          <button className="primary" onClick={() => setView("market")}>
            <Search /> Trouver un actif
          </button>
        }
      />
      <div className="stats-grid">
        <article className="stat">
          <span>SOLDE DISPONIBLE</span>
          <strong className="mono">{money(summary?.balance ?? 0)}</strong>
          <small>Capital initial : {money(account?.startingBalance ?? 10000)}</small>
        </article>
        <article className="stat">
          <span>POSITIONS OUVERTES</span>
          <strong className="mono">{money(summary?.totalPositionsValue ?? 0)}</strong>
          <small>{positions.length} position{positions.length > 1 ? "s" : ""}</small>
        </article>
        <article className="stat">
          <span>P&L TOTAL</span>
          {summary ? <Pnl value={summary.totalPnl} percent={summary.totalPnlPercent} /> : <span className="mono">—</span>}
          <small>Depuis l’ouverture du compte</small>
        </article>
        <article className="stat critical">
          <span>RÈGLES DE RISQUE</span>
          <strong className="mono">LIMITES ACTIVES</strong>
          <small>L’agent respecte vos garde-fous en permanence</small>
        </article>
      </div>
      <div className="dashboard-grid">
        <section className="panel wide">
          <div className="panel-head">
            <div>
              <span className="eyebrow">EXPOSITION ACTIVE</span>
              <h2>Positions ouvertes</h2>
            </div>
            <button className="text-btn" onClick={() => setView("positions")}>
              Voir tout <ChevronRight />
            </button>
          </div>
          <div className="positions-list">
            {positions.length === 0 && <div className="empty"><h3>Aucune position ouverte</h3><p>Passez votre premier ordre depuis le marché.</p></div>}
            {positions.map((p) => (
              <button key={p.id} onClick={() => selectAsset(p.symbol)} className="position-row">
                <div className="asset-id">
                  <AssetIcon symbol={p.symbol} />
                  <div>
                    <strong>{p.symbol}</strong>
                    <span>{p.quantity} unités • {p.leverage}×</span>
                  </div>
                </div>
                <div>
                  <span>Prix moyen</span>
                  <strong className="mono">{money(p.avgEntryPrice)}</strong>
                </div>
                <div>
                  <span>Prix actuel</span>
                  <strong className="mono">{money(p.currentPrice)}</strong>
                </div>
                <div>
                  <span>P&L latent</span>
                  <Pnl value={p.unrealizedPnl} percent={p.unrealizedPnlPercent} />
                </div>
                <ChevronRight />
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">SURVEILLANCE</span>
              <h2>Watchlist</h2>
            </div>
            <Star />
          </div>
          {watchAssets.map((s) => (
            <button className="watch-row" key={s} onClick={() => selectAsset(s)}>
              <div>
                <strong>{s}</strong>
                <span>{assets.find((a) => a.symbol === s)?.name}</span>
              </div>
              <div>
                <strong className="mono">{money(prices[s]?.price ?? 0)}</strong>
                <span className={(prices[s]?.change ?? 0) >= 0 ? "positive" : "negative"}>
                  {(prices[s]?.change ?? 0) >= 0 ? "+" : ""}
                  {(prices[s]?.change ?? 0).toFixed(2)}%
                </span>
              </div>
            </button>
          ))}
          {watchAssets.length === 0 && <div className="empty"><h3>Watchlist vide</h3><p>Suivez des actifs depuis la vue Marché.</p></div>}
        </section>
        <section className="panel wide">
          <div className="panel-head">
            <div>
              <span className="eyebrow">JOURNAL DE DÉCISIONS</span>
              <h2>Dernières analyses de l’agent</h2>
            </div>
            <button className="text-btn" onClick={() => setView("agent")}>
              Ouvrir le journal <ChevronRight />
            </button>
          </div>
          {decisions.slice(0, 2).map((d) => (
            <DecisionRow key={d.id} d={d} />
          ))}
          {decisions.length === 0 && <div className="empty"><h3>Aucune décision encore</h3><p>Activez l’agent IA pour générer des analyses.</p></div>}
        </section>
        <section className="panel discipline">
          <ShieldAlert />
          <div>
            <span className="eyebrow">RAPPEL PERMANENT</span>
            <h2>L’argent est fictif.<br />La discipline ne l’est pas.</h2>
            <p>Aucune remise à zéro rapide. Chaque décision reste dans votre journal.</p>
          </div>
        </section>
      </div>
    </>
  )
}

function Market() {
  const { search, setSearch, assetType, setAssetType, selectedSymbol, selectAsset, assets, prices, watchlist, toggleWatch } = useTrading()
  const [detail, setDetail] = useState(false)
  const list = useMemo(
    () =>
      assets.filter(
        (a) => (assetType === "all" || a.type === assetType) && (a.symbol + a.name).toLowerCase().includes(search.toLowerCase()),
      ),
    [assets, search, assetType],
  )
  const asset = assets.find((a) => a.symbol === selectedSymbol)
  if (detail && asset) {
    return (
      <AssetDetail
        asset={asset}
        price={prices[asset.symbol]?.price ?? 0}
        change={prices[asset.symbol]?.change ?? 0}
        back={() => setDetail(false)}
        watched={watchlist.includes(asset.symbol)}
        toggle={() => toggleWatch(asset.symbol)}
      />
    )
  }
  return (
    <>
      <SectionHead
        eyebrow={`${assets.length} ACTIFS TRADABLES`}
        title="Marché"
        copy="Prix en direct. Les actions suivent les horaires du marché américain."
      />
      <div className="filterbar">
        <label>
          <Search />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un symbole ou un nom" />
        </label>
        {(["all", "stock", "crypto"] as const).map((t) => (
          <button key={t} className={assetType === t ? "active" : ""} onClick={() => setAssetType(t)}>
            {t === "all" ? "Tous" : t === "stock" ? "Actions" : "Crypto"}
          </button>
        ))}
      </div>
      <section className="panel market-table">
        <div className="table-head">
          <span>ACTIF</span>
          <span>TYPE</span>
          <span>PRIX</span>
          <span>VARIATION 24H</span>
          <span>ÉTAT</span>
        </div>
        {list.length ? (
          list.map((a) => (
            <button
              key={a.symbol}
              className="market-row"
              onClick={() => {
                selectAsset(a.symbol)
                setDetail(true)
              }}
            >
              <div className="asset-id">
                <AssetIcon symbol={a.symbol} />
                <div>
                  <strong>{a.symbol}</strong>
                  <span>{a.name} • {a.exchange}</span>
                </div>
              </div>
              <Pill>{a.type === "stock" ? "ACTION" : "CRYPTO"}</Pill>
              <strong className="mono">{money(prices[a.symbol]?.price ?? 0)}</strong>
              <span className={`mono ${(prices[a.symbol]?.change ?? 0) >= 0 ? "positive" : "negative"}`}>
                {(prices[a.symbol]?.change ?? 0) >= 0 ? "+" : ""}
                {(prices[a.symbol]?.change ?? 0).toFixed(2)}%
              </span>
              <Pill tone={a.type === "crypto" || isUsMarketOpen() ? "good" : "neutral"}>
                {a.type === "crypto" ? "OUVERT" : isUsMarketOpen() ? "OUVERT" : "FERMÉ"}
              </Pill>
            </button>
          ))
        ) : (
          <div className="empty">
            <Search />
            <h3>Aucun actif trouvé</h3>
            <p>Essayez un autre symbole ou retirez un filtre.</p>
          </div>
        )}
      </section>
    </>
  )
}

function AssetDetail({
  asset,
  price,
  change,
  back,
  watched,
  toggle,
}: {
  asset: { symbol: string; name: string; type: "stock" | "crypto"; exchange: string }
  price: number
  change: number
  back: () => void
  watched: boolean
  toggle: () => void
}) {
  const [range, setRange] = useState<HistoryRange>("1d")
  return (
    <>
      <button className="back" onClick={back}>← Retour au marché</button>
      <div className="asset-title">
        <div className="asset-id">
          <AssetIcon symbol={asset.symbol} />
          <div>
            <span className="eyebrow">{asset.exchange} • {asset.type === "crypto" ? "OUVERT 24/7" : isUsMarketOpen() ? "MARCHÉ OUVERT" : "MARCHÉ FERMÉ"}</span>
            <h1>{asset.name} <small>{asset.symbol}</small></h1>
          </div>
        </div>
        <div className="asset-price">
          <strong className="mono">{money(price)}</strong>
          <span className={change >= 0 ? "positive" : "negative"}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(2)}% aujourd’hui
          </span>
          <button onClick={toggle}>
            <Star className={watched ? "starred" : ""} />
            {watched ? "Suivi" : "Suivre"}
          </button>
        </div>
      </div>
      <div className="asset-grid">
        <section className="panel chart-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">HISTORIQUE DE PRIX</span>
              <h2>Cotation</h2>
            </div>
            <div className="range">
              {rangeLabels.map(([label, value]) => (
                <button key={value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <PriceChart symbol={asset.symbol} range={range} />
        </section>
        <OrderForm symbol={asset.symbol} price={price} closed={asset.type === "stock" && !isUsMarketOpen()} />
      </div>
    </>
  )
}

function OrderForm({ symbol, price, closed }: { symbol: string; price: number; closed: boolean }) {
  const [side, setSide] = useState<"buy" | "sell">("buy")
  const [type, setType] = useState<"market" | "limit">("market")
  const [qty, setQty] = useState("1")
  const [limit, setLimit] = useState("")
  const [status, setStatus] = useState<{ message: string; action: string } | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const balance = useTrading((s) => s.summary?.balance ?? 0)
  const total = Number(qty || 0) * (type === "limit" ? Number(limit || 0) || price : price)

  async function submit() {
    if (closed || busy) return
    setBusy(true)
    setStatus(null)
    setOk(null)
    try {
      const order = await postOrder({
        symbol,
        side,
        type,
        quantity: Number(qty),
        limitPrice: type === "limit" ? Number(limit) || undefined : undefined,
        stopLoss: null,
        takeProfit: null,
      })
      setOk(
        order.status === "filled"
          ? `Ordre exécuté à ${money(order.filledPrice ?? 0)} • slippage ${order.slippage?.toFixed(3) ?? "0"}%`
          : order.status === "pending"
            ? "Ordre limite en attente d’exécution"
            : `Ordre rejeté : ${order.rejectionReason ?? "raison inconnue"}`,
      )
      await refreshTradingData()
    } catch (error) {
      if (error instanceof TradingApiError) {
        setStatus(humanizeApiError(error))
      } else {
        setStatus({ message: "Connexion impossible au backend.", action: "Vérifiez que l’API est démarrée." })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel order-form">
      <span className="eyebrow">NOUVEL ORDRE</span>
      <h2>{symbol}</h2>
      {closed && (
        <div className="warning">
          <Clock3 />
          <div>
            <strong>Marché fermé</strong>
            <span>Réouverture à 9h30, heure de New York, jours ouvrés.</span>
          </div>
        </div>
      )}
      <div className="segmented">
        <button className={side === "buy" ? "buy active" : ""} onClick={() => setSide("buy")}>Acheter</button>
        <button className={side === "sell" ? "sell active" : ""} onClick={() => setSide("sell")}>Vendre</button>
      </div>
      <label>
        TYPE D’ORDRE
        <select value={type} onChange={(e) => setType(e.target.value as "market" | "limit")}>
          <option value="market">Marché</option>
          <option value="limit">Limite</option>
        </select>
      </label>
      <label>
        QUANTITÉ
        <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      {type === "limit" && (
        <label>
          PRIX LIMITE
          <input type="number" min="0" step="any" value={limit} placeholder={price.toFixed(2)} onChange={(e) => setLimit(e.target.value)} />
        </label>
      )}
      <div className="order-summary">
        <span>Valeur estimée <strong className="mono">{money(total)}</strong></span>
        <span>Part du solde <strong className="mono">{balance > 0 ? ((total / balance) * 100).toFixed(1) : "0"}%</strong></span>
        <span>Slippage simulé <strong className="mono">systématique</strong></span>
      </div>
      <p className="fineprint">Le prix d’exécution réel peut différer. Aucune exécution parfaite n’est simulée.</p>
      <button className="primary full" disabled={closed || busy || Number(qty) <= 0} onClick={submit}>
        {busy ? "Transmission…" : `Vérifier l’ordre ${side === "buy" ? "d’achat" : "de vente"}`}
      </button>
      {ok && <div className="success">{ok}</div>}
      {status && (
        <div className="warning">
          <ShieldAlert />
          <div>
            <strong>{status.message}</strong>
            <span>{status.action}</span>
          </div>
        </div>
      )}
    </section>
  )
}

function Positions() {
  const { positions } = useTrading()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; action: string } | null>(null)

  async function closePosition(symbol: string, quantity: number) {
    setBusyId(symbol)
    setError(null)
    try {
      await postOrder({ symbol, side: "sell", type: "market", quantity, stopLoss: null, takeProfit: null })
      await refreshTradingData()
    } catch (e) {
      setError(e instanceof TradingApiError ? humanizeApiError(e) : { message: "Clôture impossible.", action: "Réessayez." })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <SectionHead
        eyebrow={`${positions.length} POSITION${positions.length > 1 ? "S" : ""}`}
        title="Positions ouvertes"
        copy="Prix, protections et P&L latent mis à jour en direct par le backend."
      />
      {error && (
        <div className="warning">
          <ShieldAlert />
          <div>
            <strong>{error.message}</strong>
            <span>{error.action}</span>
          </div>
        </div>
      )}
      <div className="position-cards">
        {positions.length === 0 && (
          <div className="empty">
            <h3>Aucune position ouverte</h3>
            <p>Vos achats exécutés apparaîtront ici.</p>
          </div>
        )}
        {positions.map((p) => (
          <article className="panel position-card" key={p.id}>
            <div className="panel-head">
              <div className="asset-id">
                <AssetIcon symbol={p.symbol} />
                <div>
                  <h2>{p.symbol}</h2>
                  <span>{p.quantity} unités • {p.leverage}×</span>
                </div>
              </div>
              <Pnl value={p.unrealizedPnl} percent={p.unrealizedPnlPercent} />
            </div>
            <div className="position-metrics">
              <span>Entrée moyenne<strong>{money(p.avgEntryPrice)}</strong></span>
              <span>Prix actuel<strong>{money(p.currentPrice)}</strong></span>
              <span>Ouverte le<strong>{new Date(p.openedAt).toLocaleDateString("fr-FR")}</strong></span>
            </div>
            <div className="protection">
              <label>STOP-LOSS<input defaultValue={p.stopLoss ?? ""} disabled /></label>
              <label>TAKE-PROFIT<input defaultValue={p.takeProfit ?? ""} disabled /></label>
            </div>
            <div className="card-actions">
              <button disabled title="Modification non prise en charge par l’API actuelle">Mettre à jour</button>
              <button className="danger" disabled={busyId === p.symbol} onClick={() => closePosition(p.symbol, p.quantity)}>
                {busyId === p.symbol ? "Clôture…" : "Fermer la position"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

const statusFilters: { label: string; value?: OrderStatus }[] = [
  { label: "Tous les statuts" },
  { label: "En attente", value: "pending" },
  { label: "Exécutés", value: "filled" },
  { label: "Rejetés", value: "rejected" },
  { label: "Annulés", value: "cancelled" },
]

function Orders() {
  const { orders, setData } = useTrading()
  const [status, setStatus] = useState<OrderStatus | undefined>(undefined)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    getOrders({ status, limit: 100 })
      .then((list) => setData({ orders: list }))
      .catch(() => undefined)
  }, [status, setData])

  async function cancel(id: string) {
    setBusyId(id)
    try {
      await cancelOrder(id)
      await refreshTradingData()
    } catch {
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <SectionHead
        eyebrow="JOURNAL IMMUABLE"
        title="Historique des ordres"
        copy="Prix demandé, exécution réelle, slippage et source — sans simplification."
      />
      <div className="filterbar">
        {statusFilters.map((filter) => (
          <button key={filter.label} className={status === filter.value ? "active" : ""} onClick={() => setStatus(filter.value)}>
            {status === filter.value && <SlidersHorizontal />} {filter.label}
          </button>
        ))}
      </div>
      <section className="panel market-table">
        <div className="table-head orders-head">
          <span>ORDRE</span>
          <span>TYPE</span>
          <span>DEMANDÉ / REMPLI</span>
          <span>STATUT</span>
          <span>SOURCE</span>
          <span>DATE</span>
        </div>
        {orders.length === 0 && <div className="empty"><h3>Aucun ordre</h3><p>Vos ordres apparaîtront ici.</p></div>}
        {orders.map((o) => (
          <div className="market-row order-row" key={o.id}>
            <div>
              <strong>{o.side === "buy" ? "ACHAT" : "VENTE"} {o.symbol}</strong>
              <span>{o.quantity} unités</span>
            </div>
            <span>{o.type === "market" ? "Marché" : `Limite ${o.limitPrice ? money(o.limitPrice) : ""}`}</span>
            <div className="mono">
              <strong>{money(o.requestedPrice)}</strong>
              <span>
                {o.filledPrice ? money(o.filledPrice) : "—"}
                {o.slippage !== null && ` • ${o.slippage.toFixed(3)}%`}
              </span>
            </div>
            <Pill tone={o.status === "filled" ? "good" : o.status === "rejected" ? "bad" : "neutral"}>{o.status.toUpperCase()}</Pill>
            <span>{o.source === "manual" ? "Manuel" : "Agent IA"}</span>
            <span>{new Date(o.createdAt).toLocaleString("fr-FR")}</span>
            {o.status === "pending" && (
              <button className="text-btn" disabled={busyId === o.id} onClick={() => cancel(o.id)}>
                {busyId === o.id ? "…" : "Annuler"}
              </button>
            )}
          </div>
        ))}
      </section>
    </>
  )
}

function Performance() {
  const { summary, orders, positions, account } = useTrading()
  const filled = orders.filter((o) => o.status === "filled")
  const aiCount = filled.filter((o) => o.source === "ai_agent").length
  const manualCount = filled.length - aiCount
  return (
    <>
      <SectionHead
        eyebrow={account ? `DEPUIS ${new Date(account.createdAt).toLocaleDateString("fr-FR")}` : "PERFORMANCE"}
        title="Performance & risque"
        copy="Les gains et les pertes ont le même poids dans cette lecture."
      />
      <div className="stats-grid performance-stats">
        <article className="stat">
          <span>P&L NET</span>
          {summary ? <Pnl value={summary.totalPnl} percent={summary.totalPnlPercent} /> : <span className="mono">—</span>}
        </article>
        <article className="stat">
          <span>VALEUR DES POSITIONS</span>
          <strong className="mono">{money(summary?.totalPositionsValue ?? 0)}</strong>
        </article>
        <article className="stat">
          <span>SOLDE DISPONIBLE</span>
          <strong className="mono">{money(summary?.balance ?? 0)}</strong>
        </article>
        <article className="stat">
          <span>ORDRES EXÉCUTÉS</span>
          <strong className="mono">{filled.length}</strong>
        </article>
        <article className="stat critical">
          <span>ORDRES REJETÉS</span>
          <strong className="mono">{orders.filter((o) => o.status === "rejected").length}</strong>
        </article>
        <article className="stat">
          <span>POSITIONS OUVERTES</span>
          <strong className="mono">{positions.length}</strong>
        </article>
        <article className="stat">
          <span>SOURCE MANUELLE</span>
          <strong className="mono">{manualCount}</strong>
        </article>
        <article className="stat">
          <span>SOURCE AGENT IA</span>
          <strong className="mono">{aiCount}</strong>
        </article>
      </div>
      <section className="panel equity">
        <div className="panel-head">
          <div>
            <span className="eyebrow">TRAÇABILITÉ</span>
            <h2>Chaque valeur vient du backend</h2>
          </div>
        </div>
        <p className="fineprint">
          Le backend est la source de vérité unique du portefeuille : solde, valorisation et P&L sont recalculés côté serveur,
          jamais dans le navigateur.
        </p>
      </section>
    </>
  )
}

function DecisionRow({ d }: { d: ReturnType<typeof useTrading.getState>["decisions"][number] }) {
  const { selectDecision, setView } = useTrading()
  return (
    <button
      className="decision-row"
      onClick={() => {
        selectDecision(d.id)
        setView("agent")
      }}
    >
      <div className="decision-action">
        <Pill tone={d.validationPassed ? (d.action === "BUY" ? "good" : "cyan") : "bad"}>{d.action}</Pill>
        <strong>{d.symbol}</strong>
      </div>
      <p>{d.reasoningSummary}</p>
      <div className="confidence">
        <span>Confiance</span>
        <div>
          <i style={{ width: `${d.confidenceScore * 100}%` }} />
        </div>
        <strong>{Math.round(d.confidenceScore * 100)}%</strong>
      </div>
      <Pill tone={d.validationPassed ? "good" : "bad"}>{d.validationPassed ? "VALIDÉE" : "REJETÉE"}</Pill>
      <ChevronRight />
    </button>
  )
}

function Agent() {
  const { selectedDecision, selectDecision, decisions, aiConfig, setData } = useTrading()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; action: string } | null>(null)
  const d = decisions.find((x) => x.id === selectedDecision)

  async function patchConfig(patch: Parameters<typeof putAiConfig>[0]) {
    setBusy("config")
    setError(null)
    try {
      const config = await putAiConfig(patch)
      setData({ aiConfig: config })
    } catch (e) {
      setError(e instanceof TradingApiError ? humanizeApiError(e) : { message: "Mise à jour impossible.", action: "Réessayez." })
    } finally {
      setBusy(null)
    }
  }

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id)
    setError(null)
    try {
      if (action === "approve") {
        await approveAiDecision(id)
      } else {
        await rejectAiDecision(id)
      }
      const [list] = await Promise.all([getAiDecisions(100), refreshTradingData()])
      setData({ decisions: list })
    } catch (e) {
      setError(e instanceof TradingApiError ? humanizeApiError(e) : { message: "Action impossible.", action: "Réessayez." })
    } finally {
      setBusy(null)
    }
  }

  if (d) {
    return (
      <>
        <button className="back" onClick={() => selectDecision(null)}>← Retour au journal</button>
        <SectionHead
          eyebrow={`${d.modelUsed} • RAISONNEMENT ${d.thinkingLevel.toUpperCase()}`}
          title={`${d.action} ${d.symbol}`}
          copy={d.reasoningSummary}
          action={<Pill tone={d.validationPassed ? "good" : "bad"}>{d.validationPassed ? "VALIDATION PASSÉE" : "VALIDATION REJETÉE"}</Pill>}
        />
        <div className="agent-detail">
          <section className="panel reasoning">
            <span className="eyebrow">RAISONNEMENT COMPLET • NON TRONQUÉ</span>
            <h2>Pourquoi cette décision</h2>
            {d.fullReasoning.split("\n\n").map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
          <aside className="panel context">
            <span className="eyebrow">TRACE D’AUDIT</span>
            <h2>Contexte</h2>
            <dl>
              <dt>Modèle</dt>
              <dd>{d.modelUsed}</dd>
              <dt>Niveau de réflexion</dt>
              <dd>{d.thinkingLevel}</dd>
              <dt>Confiance</dt>
              <dd>{Math.round(d.confidenceScore * 100)} %</dd>
              <dt>Créée</dt>
              <dd>{new Date(d.createdAt).toLocaleString("fr-FR")}</dd>
            </dl>
            <h3>Facteurs clés</h3>
            <div className="tags">
              {d.keyFactors.map((k) => (
                <Pill key={k}>{k}</Pill>
              ))}
            </div>
            {d.validationErrors.length > 0 && (
              <div className="warning">
                <ShieldAlert />
                <div>
                  <strong>Blocage de validation</strong>
                  <span>{d.validationErrors.join(", ")}</span>
                </div>
              </div>
            )}
            {aiConfig?.mode === "propose" && d.validationPassed && d.action !== "HOLD" && !d.resultingOrderId && (
              <div className="decision-actions">
                <button className="primary" disabled={busy === d.id} onClick={() => decide(d.id, "approve")}>
                  {busy === d.id ? "Exécution…" : "Approuver"}
                </button>
                <button className="danger" disabled={busy === d.id} onClick={() => decide(d.id, "reject")}>
                  Rejeter
                </button>
              </div>
            )}
            {d.resultingOrderId && <p className="fineprint">Ordre lié : {d.resultingOrderId}</p>}
          </aside>
        </div>
      </>
    )
  }

  return (
    <>
      <SectionHead
        eyebrow="CONTRÔLE STRICT • JOURNAL COMPLET"
        title="Agent IA"
        copy="Des propositions argumentées à évaluer — jamais des vérités à suivre aveuglément."
      />
      {error && (
        <div className="warning">
          <ShieldAlert />
          <div>
            <strong>{error.message}</strong>
            <span>{error.action}</span>
          </div>
        </div>
      )}
      <section className="panel agent-config">
        <div>
          <span className="eyebrow">ÉTAT DE L’AGENT</span>
          <h2>{aiConfig?.enabled ? "Agent actif" : "Agent inactif"}</h2>
          <p>
            {aiConfig?.circuitBreakerActive
              ? `Circuit breaker actif : ${aiConfig.circuitBreakerReason ?? "limite de perte journalière atteinte"}`
              : aiConfig?.enabled
                ? "Analyse les symboles surveillés selon vos limites."
                : "Aucune analyse ou exécution automatique."}
          </p>
        </div>
        <button
          className={`switch ${aiConfig?.enabled ? "on" : ""}`}
          onClick={() => patchConfig({ enabled: !aiConfig?.enabled })}
          aria-pressed={aiConfig?.enabled ?? false}
          disabled={busy === "config"}
        >
          <i />
        </button>
        <div className="mode-select">
          <button className={aiConfig?.mode === "propose" ? "active" : ""} onClick={() => patchConfig({ mode: "propose" })}>
            <strong>Proposer</strong>
            <span>Vous validez chaque décision</span>
          </button>
          <button className={aiConfig?.mode === "autonomous" ? "active" : ""} onClick={() => patchConfig({ mode: "autonomous" })}>
            <strong>Autonome</strong>
            <span>Exécute dans les limites fixées</span>
          </button>
        </div>
        <div className="risk">
          <label>
            TAILLE MAX. POSITION{" "}
            <input
              type="number"
              min="0.1"
              step="0.1"
              defaultValue={aiConfig?.maxPositionSizePercent ?? 2}
              onBlur={(e) => {
                const value = Number(e.target.value)
                if (Number.isFinite(value) && value > 0) void patchConfig({ maxPositionSizePercent: value })
              }}
            />
            <span>%</span>
          </label>
          <label>
            PERTE JOURNALIÈRE MAX.{" "}
            <input
              type="number"
              min="0.1"
              step="0.1"
              defaultValue={aiConfig?.dailyLossLimitPercent ?? 3}
              onBlur={(e) => {
                const value = Number(e.target.value)
                if (Number.isFinite(value) && value > 0) void patchConfig({ dailyLossLimitPercent: value })
              }}
            />
            <span>%</span>
          </label>
        </div>
        {aiConfig?.circuitBreakerActive && (
          <button className="danger" disabled={busy === "config"} onClick={() => patchConfig({ resetCircuitBreaker: true })}>
            Réarmer le circuit breaker
          </button>
        )}
      </section>
      <div className="panel decisions">
        <div className="panel-head">
          <div>
            <span className="eyebrow">{decisions.length} ENTRÉES • TOUTES CONSERVÉES</span>
            <h2>Journal de décisions</h2>
          </div>
          <Pill tone="cyan">AUDIT COMPLET</Pill>
        </div>
        {decisions.length === 0 && (
          <div className="empty">
            <h3>Aucune décision encore</h3>
            <p>Activez l’agent et ajoutez des symboles à surveiller pour générer des analyses.</p>
          </div>
        )}
        {decisions.map((decision) => (
          <DecisionRow key={decision.id} d={decision} />
        ))}
      </div>
    </>
  )
}

function SettingsPage() {
  const { user, account } = useTrading()
  const router = useRouter()
  return (
    <>
      <SectionHead
        eyebrow="COMPTE & TRAÇABILITÉ"
        title="Paramètres"
        copy="Informations du compte, préférences et accès aux données."
      />
      <div className="settings-grid">
        <section className="panel">
          <span className="eyebrow">PROFIL</span>
          <h2>{user?.displayName ?? "Utilisateur"}</h2>
          <dl className="settings-list">
            <dt>Adresse e-mail</dt>
            <dd>{user?.email ?? "—"}</dd>
            <dt>Compte créé</dt>
            <dd>{user ? new Date(user.createdAt).toLocaleDateString("fr-FR") : "—"}</dd>
            <dt>Compte de simulation</dt>
            <dd>{account ? `Solde ${money(account.balance)} sur ${money(account.startingBalance)}` : "—"}</dd>
            <dt>Devise</dt>
            <dd>USD — Dollar américain</dd>
          </dl>
        </section>
        <section className="panel">
          <span className="eyebrow">DONNÉES</span>
          <h2>Export & audit</h2>
          <p>Une copie complète de vos ordres, positions et décisions IA sera disponible ici.</p>
          <button disabled>Exporter les données — bientôt</button>
        </section>
        <section className="panel danger-zone">
          <span className="eyebrow">SESSION</span>
          <h2>Déconnexion</h2>
          <p>Votre historique et votre compte de simulation restent conservés.</p>
          <button
            className="danger"
            onClick={async () => {
              await signOutUser()
              router.push("/login")
            }}
          >
            Se déconnecter
          </button>
        </section>
      </div>
    </>
  )
}

export function TradingApp({ initialView, initialSymbol }: { initialView?: View; initialSymbol?: string } = {}) {
  const { view, setView, selectSymbol, authReady } = useTrading()
  useLiveData()

  useEffect(() => {
    if (initialView) setView(initialView)
    if (initialSymbol) selectSymbol(initialSymbol)
  }, [initialView, initialSymbol, setView, selectSymbol])

  if (!authReady) {
    return <div className="welcome-page"><section className="welcome-card"><h1>Chargement…</h1></section></div>
  }

  return (
    <Shell>
      <ReactActivity mode={view === "dashboard" ? "visible" : "hidden"}><Dashboard /></ReactActivity>
      <ReactActivity mode={view === "market" ? "visible" : "hidden"}><Market /></ReactActivity>
      <ReactActivity mode={view === "positions" ? "visible" : "hidden"}><Positions /></ReactActivity>
      <ReactActivity mode={view === "orders" ? "visible" : "hidden"}><Orders /></ReactActivity>
      <ReactActivity mode={view === "performance" ? "visible" : "hidden"}><Performance /></ReactActivity>
      <ReactActivity mode={view === "agent" ? "visible" : "hidden"}><Agent /></ReactActivity>
      <ReactActivity mode={view === "settings" ? "visible" : "hidden"}><SettingsPage /></ReactActivity>
    </Shell>
  )
}

export { signed }
