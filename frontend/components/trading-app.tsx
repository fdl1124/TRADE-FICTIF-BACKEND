"use client"
import { Activity as ReactActivity, useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  MessageCircle,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Target,
  Wifi,
  X,
  ArrowUp,
  ArrowDown,
  Download,
  Plus,
  Trash2,
  Play,
  Send,
  Sparkles,
} from "lucide-react"
import {
  approveAiDecision,
  cancelOrder,
  createAgent,
  deleteAgent,
  getAccount,
  getAccountSummary,
  getAgents,
  getAiConfig,
  getAiDecisions,
  getAssetPrice,
  getAssets,
  getConversations,
  getMessages,
  getOrders,
  getPositions,
  patchPosition,
  postOrder,
  putAiConfig,
  rejectAiDecision,
  runAgent,
  sendMessageStream,
  updateAgent,
  createConversation,
  deleteConversation,
} from "@/lib/api"
import type { AgentInstance, ChatMessage, Conversation } from "@/lib/api"
import { onAuthChange, signOutUser } from "@/lib/auth/client"
import { TradingApiError, humanizeApiError } from "@/lib/api/errors"
import { createPriceClient } from "@/lib/websocket/prices"
import { isMockMode, useTrading } from "@/store/use-trading"
import { money, signed, type View } from "@/lib/trading"
import type { HistoryRange, OrderStatus } from "@/lib/types"
import { PriceChart } from "./price-chart"
import { AgentsPage } from "@/components/agents/agents-page"
import { ChatInterface } from "@/components/chat/chat-interface"
type AppView = View | "chat"
const nav: [AppView, string, typeof LayoutDashboard][] = [
  ["dashboard", "Vue d’ensemble", LayoutDashboard],
  ["market", "Marché", ChartCandlestick],
  ["positions", "Positions", BriefcaseBusiness],
  ["orders", "Ordres", BookOpen],
  ["performance", "Performance", Target],
  ["agent", "Agents IA", BrainCircuit],
  ["settings", "Paramètres", Settings],
  ["chat", "Assistant IA", MessageCircle],
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
function exportToCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = String(v ?? "")
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const csv = [headers.map(escape).join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `il y a ${sec} s`
  const min = Math.round(sec / 60)
  if (min < 60) return `il y a ${min} min`
  const hr = Math.round(min / 60)
  if (hr < 24) return `il y a ${hr} h`
  return `il y a ${Math.round(hr / 24)} j`
}
function RelativeTime({ iso }: { iso: string }) {
  const value = formatRelative(iso)
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60000)
    return () => clearInterval(id)
  }, [])
  return <>{value}</>
}
function useRelativeTime(iso: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])
  const diff = now - new Date(iso).getTime()
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `il y a ${sec} s`
  const min = Math.round(sec / 60)
  if (min < 60) return `il y a ${min} min`
  const hr = Math.round(min / 60)
  if (hr < 24) return `il y a ${hr} h`
  const day = Math.round(hr / 24)
  return `il y a ${day} j`
}
function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
function PriceFlash({ value, children }: { value: number; children: React.ReactNode }) {
  const prev = useRef(value)
  const [flash, setFlash] = useState<"" | "price-flash-up" | "price-flash-down">("")
  useEffect(() => {
    if (value > prev.current) setFlash("price-flash-up")
    else if (value < prev.current) setFlash("price-flash-down")
    prev.current = value
    if (value !== prev.current || flash) {
      const id = setTimeout(() => setFlash(""), 900)
      return () => clearTimeout(id)
    }
  }, [value, flash])
  useEffect(() => {
    if (flash) {
      const id = setTimeout(() => setFlash(""), 900)
      return () => clearTimeout(id)
    }
  }, [flash])
  return <span className={flash}>{children}</span>
}
function SkeletonLine({ w = "100%" }: { w?: string }) {
  return <div className="skeleton skeleton-line" style={{ width: w, height: 14, background: "var(--panel-2)", borderRadius: 6, opacity: 0.7 }} />
}
function SkeletonCard() {
  return <div className="skeleton skeleton-card" style={{ height: 110, background: "var(--panel-2)", borderRadius: 8, opacity: 0.6 }} />
}
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  tone?: "primary" | "danger"
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.5)" }} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(420px,92vw)", background: "var(--panel)", border: "1px solid var(--border)", padding: 20, borderRadius: 10 }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <p style={{ color: "var(--muted)", margin: "8px 0 18px", lineHeight: 1.5 }}>{description}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ border: "1px solid var(--border)", background: "transparent", padding: "8px 12px", borderRadius: 6 }}>
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className={tone === "danger" ? "danger" : "primary"}
            style={{
              border: tone === "danger" ? "1px solid rgb(240 109 114 / .35)" : "1px solid var(--cyan)",
              background: tone === "danger" ? "transparent" : "var(--cyan)",
              color: tone === "danger" ? "var(--coral)" : "#071015",
              padding: "8px 12px",
              borderRadius: 6,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "Tab" && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKey)
    const prev = document.activeElement as HTMLElement | null
    setTimeout(() => ref.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus(), 0)
    return () => {
      document.removeEventListener("keydown", onKey)
      prev?.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          width: "min(420px, 92vw)",
          background: "var(--panel)",
          borderLeft: "1px solid var(--border)",
          padding: 20,
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} aria-label="Fermer" style={{ border: 0, background: "transparent" }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
function ToastStack() {
  const toasts = useTrading((s) => s.toasts)
  const dismissToast = useTrading((s) => s.dismissToast)
  useEffect(() => {
    if (toasts.length === 0) return
    const ids = toasts.map((t) => t.id)
    const timer = setTimeout(() => {
      ids.forEach((id) => dismissToast(id))
    }, 4000)
    return () => clearTimeout(timer)
  }, [toasts, dismissToast])
  return (
    <div style={{ position: "fixed", bottom: 18, right: 18, zIndex: 60, display: "flex", flexDirection: "column", gap: 8, width: "min(360px, 92vw)" }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 14px",
            background: t.tone === "success" ? "rgba(66,201,138,0.12)" : t.tone === "error" ? "rgba(240,109,114,0.12)" : "var(--panel-2)",
            border: `1px solid ${t.tone === "success" ? "rgba(66,201,138,0.35)" : t.tone === "error" ? "rgba(240,109,114,0.35)" : "var(--border)"}`,
            borderRadius: 8,
            color: "var(--foreground)",
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>{t.message}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Fermer" style={{ border: 0, background: "transparent", color: "var(--muted)" }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
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
  const pushNotification = useTrading((s) => s.pushNotification)
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
      if (user) void loadCore()
      else router.replace("/login")
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
  useEffect(() => {
    const unsub = useTrading.subscribe((state, prev) => {
      const newRejectedOrders = state.orders.filter((o) => o.status === "rejected" && !prev.orders.some((p) => p.id === o.id && p.status === "rejected"))
      newRejectedOrders.forEach((o) => pushNotification("Ordre rejeté", `${o.symbol} ${o.side} ${o.quantity} — ${o.rejectionReason ?? "rejet sans détail"}`))
      const newCancelled = state.orders.filter((o) => o.status === "cancelled" && !prev.orders.some((p) => p.id === o.id && p.status === "cancelled"))
      newCancelled.forEach((o) => pushNotification("Ordre annulé", `${o.symbol} ${o.side} annulé`))
      const newRejectedDecisions = state.decisions.filter((d) => !d.validationPassed && !prev.decisions.some((p) => p.id === d.id))
      newRejectedDecisions.forEach((d) => pushNotification("Décision rejetée", `${d.symbol} ${d.action} — ${d.validationErrors.join(", ") || "validation échouée"}`))
      if (state.aiConfig?.circuitBreakerActive && !prev.aiConfig?.circuitBreakerActive) {
        pushNotification("Circuit breaker", state.aiConfig.circuitBreakerReason ?? "Limite de perte journalière atteinte")
      }
    })
    return () => unsub()
  }, [pushNotification])
}
function Shell({ children }: { children: React.ReactNode }) {
  const view = useTrading((s) => s.view as unknown as AppView)
  const setView = useTrading((s) => s.setView)
  const summary = useTrading((s) => s.summary)
  const priceState = useTrading((s) => s.priceState)
  const user = useTrading((s) => s.user)
  const decisions = useTrading((s) => s.decisions)
  const aiConfig = useTrading((s) => s.aiConfig)
  const notifications = useTrading((s) => s.notifications)
  const markAllRead = useTrading((s) => s.markAllRead)
  const [notifOpen, setNotifOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileRef = useRef<HTMLDivElement>(null)
  const pendingApprovals = decisions.filter((d) => d.validationPassed && d.action !== "HOLD" && !d.resultingOrderId && aiConfig?.mode === "propose").length
  const unread = notifications.filter((n) => !n.read).length
  const priceLabel = priceState === "live" ? "PRIX EN DIRECT" : priceState === "connecting" ? "CONNEXION…" : "RECONNEXION…"
  const initials = (user?.displayName ?? user?.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [mobileOpen])
  return (
    <div className="app-shell">
      <style>{`.price-flash-up{animation:flashUp 900ms ease} .price-flash-down{animation:flashDown 900ms ease} @keyframes flashUp{0%{background:rgba(66,201,138,0.28)}100%{background:transparent}} @keyframes flashDown{0%{background:rgba(240,109,114,0.28)}100%{background:transparent}} .pulse{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 0 rgba(66,201,138,0.7);animation:pulse 1.6s infinite} @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(66,201,138,0.7)}70%{box-shadow:0 0 0 8px rgba(66,201,138,0)}100%{box-shadow:0 0 0 0 rgba(66,201,138,0)}} .skeleton{animation:skeleton 1.2s ease-in-out infinite alternate} @keyframes skeleton{0%{opacity:0.5}100%{opacity:0.9}}`}</style>
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
            <button key={id} onClick={() => (setView as unknown as (v: AppView) => void)(id)} className={view === id ? "active" : ""}>
              <Icon />
              <span>{label}</span>
              {id === "agent" && pendingApprovals > 0 && <b>{pendingApprovals}</b>}
              {id === "chat" && <Sparkles size={12} style={{ marginLeft: "auto", color: "var(--cyan)" }} />}
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
            <button onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu" style={{ border: 0, background: "transparent" }}>
              <Menu />
            </button>
            <strong>LEDGER</strong>
          </div>
          <div className="rail-metric">
            <span>SOLDE DISPONIBLE</span>
            <strong className="mono">{money(summary?.balance ?? 0)}</strong>
          </div>
          <div className="rail-metric">
            <span>P&L TOTAL</span>
            {summary ? <Pnl value={summary.totalPnl} percent={summary.totalPnlPercent} /> : <span className="mono">Données en chargement</span>}
          </div>
          <div className="rail-state">
            {priceState === "live" && <span className="pulse" />}
            <Wifi />
            <span>{priceLabel}</span>
            <i>{priceState === "live" ? "À l’instant" : "En attente"}</i>
          </div>
          <button className="icon-btn" aria-label="Notifications" onClick={() => setNotifOpen(true)} style={{ position: "relative" }}>
            <Bell />
            {unread > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  background: "var(--coral)",
                  color: "#fff",
                  borderRadius: 99,
                  fontSize: 10,
                  padding: "1px 5px",
                  minWidth: 16,
                  textAlign: "center",
                }}
              >
                {unread}
              </span>
            )}
          </button>
          <div className="avatar">{initials}</div>
        </header>
        <main>{children}</main>
      </div>
      <nav className="bottom-nav">
        {nav.map(([id, , Icon]) => (
          <button key={id} onClick={() => (setView as unknown as (v: AppView) => void)(id)} className={view === id ? "active" : ""}>
            <Icon />
            <span style={{ fontSize: 8 }}>{id}</span>
          </button>
        ))}
      </nav>
      {mobileOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 35, display: "flex" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} onClick={() => setMobileOpen(false)} />
          <div
            ref={mobileRef}
            role="dialog"
            aria-modal="true"
            style={{ position: "relative", width: 260, background: "var(--panel)", borderRight: "1px solid var(--border)", padding: 16, overflow: "auto" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <strong>LEDGER</strong>
              <button onClick={() => setMobileOpen(false)} aria-label="Fermer" style={{ border: 0, background: "transparent" }}>
                <X size={18} />
              </button>
            </div>
            <nav style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {nav.map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => {
                    ;(setView as unknown as (v: AppView) => void)(id)
                    setMobileOpen(false)
                  }}
                  className={view === id ? "active" : ""}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 7,
                    border: 0,
                    background: view === id ? "var(--panel-2)" : "transparent",
                    color: view === id ? "var(--foreground)" : "var(--muted)",
                    textAlign: "left",
                  }}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}
      <Drawer open={notifOpen} onClose={() => setNotifOpen(false)} title="Notifications">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{unread} non lus</span>
          <button
            onClick={markAllRead}
            style={{ border: "1px solid var(--border)", background: "transparent", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}
          >
            Tout marquer lu
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notifications.length === 0 && <div className="empty" style={{ padding: 20 }}>Aucune notification</div>}
          {notifications.map((n) => (
            <div
              key={n.id}
              style={{
                border: "1px solid var(--border)",
                background: n.read ? "transparent" : "rgba(57,198,212,0.08)",
                padding: 12,
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <strong style={{ fontSize: 13 }}>{n.title}</strong>
                <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}><RelativeTime iso={n.createdAt} /></span>
              </div>
              <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.4 }}>{n.body}</p>
            </div>
          ))}
        </div>
      </Drawer>
      <ToastStack />
    </div>
  )
}
function Dashboard() {
  const setView = useTrading((s) => s.setView)
  const selectAsset = useTrading((s) => s.selectAsset)
  const summary = useTrading((s) => s.summary)
  const account = useTrading((s) => s.account)
  const positions = useTrading((s) => s.positions)
  const assets = useTrading((s) => s.assets)
  const prices = useTrading((s) => s.prices)
  const decisions = useTrading((s) => s.decisions)
  const watchlist = useTrading((s) => s.watchlist)
  const pushToast = useTrading((s) => s.pushToast)
  const [sortDesc, setSortDesc] = useState(true)
  const sortedPositions = useMemo(() => {
    const copy = [...positions]
    copy.sort((a, b) => (sortDesc ? b.unrealizedPnl - a.unrealizedPnl : a.unrealizedPnl - b.unrealizedPnl))
    return copy
  }, [positions, sortDesc])
  const watchAssets = watchlist.filter((symbol) => assets.some((a) => a.symbol === symbol))
  const loading = !summary && positions.length === 0 && assets.length === 0
  async function toggleWatchSync(symbol: string) {
    const current = useTrading.getState().watchlist
    const next = current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol]
    useTrading.setState({ watchlist: next })
    try {
      await putAiConfig({ watchedSymbols: next })
      pushToast("Watchlist synchronisée", "success")
    } catch {
      pushToast("Watchlist locale mise à jour", "info")
    }
  }
  return (
    <>
      <SectionHead
        eyebrow="VOTRE PORTFUEILLE SIMULÉ"
        title="Vue d’ensemble"
        copy="Votre exposition, vos risques et vos décisions — sans embellissement."
        action={
          <button className="primary" onClick={() => (setView as unknown as (v: AppView) => void)("market")}>
            <Search /> Trouver un actif
          </button>
        }
      />
      {loading ? (
        <div className="stats-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
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
            {summary ? <Pnl value={summary.totalPnl} percent={summary.totalPnlPercent} /> : <span className="mono">Données en chargement</span>}
            <small>Depuis l’ouverture du compte</small>
          </article>
          <article className="stat critical">
            <span>RÈGLES DE RISQUE</span>
            <strong className="mono">LIMITES ACTIVES</strong>
            <small>L’agent respecte vos garde-fous en permanence</small>
          </article>
        </div>
      )}
      <div className="dashboard-grid">
        <section className="panel wide">
          <div className="panel-head">
            <div>
              <span className="eyebrow">EXPOSITION ACTIVE</span>
              <h2>Positions ouvertes</h2>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setSortDesc((v) => !v)} style={{ border: "1px solid var(--border)", background: "transparent", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}>
                Tri P&L {sortDesc ? "↓" : "↑"}
              </button>
              <button className="text-btn" onClick={() => (setView as unknown as (v: AppView) => void)("positions")}>
                Voir tout <ChevronRight />
              </button>
            </div>
          </div>
          <div className="positions-list">
            {positions.length === 0 && (
              <div className="empty">
                <h3>Aucune position ouverte</h3>
                <p>Passez votre premier ordre depuis le marché.</p>
              </div>
            )}
            {sortedPositions.map((p) => (
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
                  <PriceFlash value={p.currentPrice}>
                    <strong className="mono">{money(p.currentPrice)}</strong>
                  </PriceFlash>
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
          {watchAssets.length === 0 && (
            <div className="empty">
              <h3>Watchlist vide</h3>
              <p>Suivez des actifs depuis la vue Marché.</p>
            </div>
          )}
          {watchAssets.map((s) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="watch-row" style={{ flex: 1 }} onClick={() => selectAsset(s)}>
                <div>
                  <strong>{s}</strong>
                  <span>{assets.find((a) => a.symbol === s)?.name ?? "Données en chargement"}</span>
                </div>
                <div>
                  <PriceFlash value={prices[s]?.price ?? 0}>
                    <strong className="mono">{prices[s] ? money(prices[s].price) : "Données en chargement"}</strong>
                  </PriceFlash>
                  <span className={(prices[s]?.change ?? 0) >= 0 ? "positive" : "negative"}>
                    {(prices[s]?.change ?? 0) >= 0 ? "+" : ""}
                    {(prices[s]?.change ?? 0).toFixed(2)}%
                  </span>
                </div>
              </button>
              <button
                onClick={() => toggleWatchSync(s)}
                aria-label="Retirer"
                style={{ border: "1px solid var(--border)", background: "transparent", padding: 6, borderRadius: 6 }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </section>
        <section className="panel wide">
          <div className="panel-head">
            <div>
              <span className="eyebrow">JOURNAL DE DÉCISIONS</span>
              <h2>Dernières analyses de l’agent</h2>
            </div>
            <button className="text-btn" onClick={() => (setView as unknown as (v: AppView) => void)("agent")}>
              Ouvrir le journal <ChevronRight />
            </button>
          </div>
          {decisions.length === 0 && (
            <div className="empty">
              <h3>Aucune décision encore</h3>
              <p>Activez l’agent IA pour générer des analyses.</p>
            </div>
          )}
          {decisions.slice(0, 2).map((d) => (
            <DecisionRow key={d.id} d={d} />
          ))}
        </section>
        <section className="panel discipline">
          <ShieldAlert />
          <div>
            <span className="eyebrow">RAPPEL PERMANENT</span>
            <h2>
              L’argent est fictif.
              <br />
              La discipline ne l’est pas.
            </h2>
            <p>Aucune remise à zéro rapide. Chaque décision reste dans votre journal.</p>
          </div>
        </section>
      </div>
    </>
  )
}
function Market() {
  const search = useTrading((s) => s.search)
  const setSearch = useTrading((s) => s.setSearch)
  const assetType = useTrading((s) => s.assetType)
  const setAssetType = useTrading((s) => s.setAssetType)
  const selectedSymbol = useTrading((s) => s.selectedSymbol)
  const selectAsset = useTrading((s) => s.selectAsset)
  const assets = useTrading((s) => s.assets)
  const prices = useTrading((s) => s.prices)
  const watchlist = useTrading((s) => s.watchlist)
  const toggleWatch = useTrading((s) => s.toggleWatch)
  const [detail, setDetail] = useState(false)
  const [favOnly, setFavOnly] = useState(false)
  const [sortKey, setSortKey] = useState<"symbol" | "price" | "change">("symbol")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search, 250)
  const list = useMemo(() => {
    let base = assets.filter((a) => {
      const typeOk = assetType === "all" || a.type === assetType
      const searchOk = (a.symbol + a.name).toLowerCase().includes(debouncedSearch.toLowerCase())
      const favOk = !favOnly || watchlist.includes(a.symbol)
      return typeOk && searchOk && favOk
    })
    base = [...base].sort((a, b) => {
      let va: string | number = ""
      let vb: string | number = ""
      if (sortKey === "symbol") {
        va = a.symbol
        vb = b.symbol
      } else if (sortKey === "price") {
        va = prices[a.symbol]?.price ?? 0
        vb = prices[b.symbol]?.price ?? 0
      } else {
        va = prices[a.symbol]?.change ?? 0
        vb = prices[b.symbol]?.change ?? 0
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1
      if (va > vb) return sortDir === "asc" ? 1 : -1
      return 0
    })
    return base
  }, [assets, debouncedSearch, assetType, favOnly, watchlist, sortKey, sortDir, prices])
  const totalPages = Math.max(1, Math.ceil(list.length / 20))
  const paged = useMemo(() => list.slice((page - 1) * 20, page * 20), [list, page])
  useEffect(() => setPage(1), [debouncedSearch, assetType, favOnly, sortKey, sortDir])
  const asset = assets.find((a) => a.symbol === selectedSymbol)
  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("asc")
    }
  }
  function exportMarketCsv() {
    const rows = list.map((a) => ({
      symbole: a.symbol,
      nom: a.name,
      type: a.type,
      exchange: a.exchange,
      prix: prices[a.symbol]?.price ?? "",
      variation: prices[a.symbol]?.change ?? "",
    }))
    exportToCsv("marche.csv", rows)
  }
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
      <SectionHead eyebrow={`${assets.length} ACTIFS TRADABLES`} title="Marché" copy="Prix en direct. Les actions suivent les horaires du marché américain." />
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
        <button className={favOnly ? "active" : ""} onClick={() => setFavOnly((v) => !v)}>
          <Star size={14} /> Favoris
        </button>
        <button onClick={exportMarketCsv} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Download size={14} /> CSV
        </button>
      </div>
      {assets.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonLine w="60%" />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <section className="panel market-table">
          <div className="table-head">
            <button onClick={() => toggleSort("symbol")} style={{ border: 0, background: "transparent", display: "flex", alignItems: "center", gap: 4, color: "var(--muted)", fontSize: 9 }}>
              ACTIF {sortKey === "symbol" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
            </button>
            <span>TYPE</span>
            <button onClick={() => toggleSort("price")} style={{ border: 0, background: "transparent", display: "flex", alignItems: "center", gap: 4, color: "var(--muted)", fontSize: 9 }}>
              PRIX {sortKey === "price" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
            </button>
            <button onClick={() => toggleSort("change")} style={{ border: 0, background: "transparent", display: "flex", alignItems: "center", gap: 4, color: "var(--muted)", fontSize: 9 }}>
              VARIATION 24H {sortKey === "change" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
            </button>
            <span>ÉTAT</span>
          </div>
          {paged.length ? (
            paged.map((a) => (
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
                <PriceFlash value={prices[a.symbol]?.price ?? 0}>
                  <strong className="mono">{prices[a.symbol] ? money(prices[a.symbol].price) : "Données en chargement"}</strong>
                </PriceFlash>
                <span className={`mono ${(prices[a.symbol]?.change ?? 0) >= 0 ? "positive" : "negative"}`}>
                  {(prices[a.symbol]?.change ?? 0) >= 0 ? "+" : ""}
                  {(prices[a.symbol]?.change ?? 0).toFixed(2)}%
                </span>
                <Pill tone={a.type === "crypto" || isUsMarketOpen() ? "good" : "neutral"}>{a.type === "crypto" ? "OUVERT" : isUsMarketOpen() ? "OUVERT" : "FERMÉ"}</Pill>
              </button>
            ))
          ) : (
            <div className="empty">
              <Search />
              <h3>Aucun actif trouvé</h3>
              <p>Essayez un autre symbole ou retirez un filtre.</p>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 4px", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Page {page} / {totalPages} • {list.length} actifs
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ border: "1px solid var(--border)", background: "transparent", padding: "6px 10px", borderRadius: 6 }}>
                Précédent
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={{ border: "1px solid var(--border)", background: "transparent", padding: "6px 10px", borderRadius: 6 }}>
                Suivant
              </button>
            </div>
          </div>
        </section>
      )}
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
  const prices = useTrading((s) => s.prices)
  const tick = prices[asset.symbol]
  const high = tick ? tick.price * 1.015 : null
  const low = tick ? tick.price * 0.985 : null
  const volume = tick ? Math.round(800 + Math.abs(tick.change) * 1200) : null
  return (
    <>
      <button className="back" onClick={back}>
        ← Retour au marché
      </button>
      <div className="asset-title">
        <div className="asset-id">
          <AssetIcon symbol={asset.symbol} />
          <div>
            <span className="eyebrow">
              {asset.exchange} • {asset.type === "crypto" ? "OUVERT 24/7" : isUsMarketOpen() ? "MARCHÉ OUVERT" : "MARCHÉ FERMÉ"}
            </span>
            <h1>
              {asset.name} <small>{asset.symbol}</small>
            </h1>
          </div>
        </div>
        <div className="asset-price">
          <PriceFlash value={price}>
            <strong className="mono">{price ? money(price) : "Données en chargement"}</strong>
          </PriceFlash>
          <span className={change >= 0 ? "positive" : "negative"}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(2)}% aujourd’hui
          </span>
          <button onClick={toggle} style={{ border: "1px solid var(--border)", background: watched ? "rgba(57,198,212,0.12)" : "var(--panel)", padding: "8px 11px", display: "flex", gap: 7, borderRadius: 6 }}>
            <Star className={watched ? "starred" : ""} size={16} />
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 14 }}>
            <div style={{ border: "1px solid var(--border)", padding: 10, background: "#0D141E" }}>
              <span style={{ fontSize: 9, color: "var(--muted)", letterSpacing: ".08em" }}>VOLUME 24H</span>
              <strong className="mono" style={{ display: "block", marginTop: 6 }}>
                {volume ? volume.toLocaleString("fr-FR") : "Données en chargement"}
              </strong>
            </div>
            <div style={{ border: "1px solid var(--border)", padding: 10, background: "#0D141E" }}>
              <span style={{ fontSize: 9, color: "var(--muted)", letterSpacing: ".08em" }}>HIGH 24H</span>
              <strong className="mono" style={{ display: "block", marginTop: 6 }}>
                {high ? money(high) : "Données en chargement"}
              </strong>
            </div>
            <div style={{ border: "1px solid var(--border)", padding: 10, background: "#0D141E" }}>
              <span style={{ fontSize: 9, color: "var(--muted)", letterSpacing: ".08em" }}>LOW 24H</span>
              <strong className="mono" style={{ display: "block", marginTop: 6 }}>
                {low ? money(low) : "Données en chargement"}
              </strong>
            </div>
          </div>
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
  const [stopLoss, setStopLoss] = useState("")
  const [takeProfit, setTakeProfit] = useState("")
  const [status, setStatus] = useState<{ message: string; action: string } | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const balance = useTrading((s) => s.summary?.balance ?? 0)
  const pushToast = useTrading((s) => s.pushToast)
  const total = Number(qty || 0) * (type === "limit" ? Number(limit || 0) || price : price)
  const part = balance > 0 ? ((total / balance) * 100).toFixed(1) : "0"
  const slippageMax = "0,08%"
  function validate(): string | null {
    const q = Number(qty)
    if (!Number.isFinite(q) || q <= 0) return "Quantité invalide."
    if (type === "limit") {
      const lp = Number(limit)
      if (!Number.isFinite(lp) || lp <= 0) return "Prix limite invalide."
    }
    if (stopLoss) {
      const sl = Number(stopLoss)
      if (!Number.isFinite(sl) || sl <= 0) return "Stop-loss invalide."
    }
    if (takeProfit) {
      const tp = Number(takeProfit)
      if (!Number.isFinite(tp) || tp <= 0) return "Take-profit invalide."
    }
    return null
  }
  async function submit() {
    const err = validate()
    if (err) {
      setStatus({ message: err, action: "Corrigez les champs puis réessayez." })
      return
    }
    setConfirmOpen(true)
  }
  async function confirmSubmit() {
    setConfirmOpen(false)
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
        stopLoss: stopLoss ? Number(stopLoss) : null,
        takeProfit: takeProfit ? Number(takeProfit) : null,
      })
      const msg =
        order.status === "filled"
          ? `Ordre exécuté à ${money(order.filledPrice ?? 0)} • slippage ${order.slippage?.toFixed(3) ?? "0"}%`
          : order.status === "pending"
            ? "Ordre limite en attente d’exécution"
            : `Ordre rejeté : ${order.rejectionReason ?? "raison inconnue"}`
      setOk(msg)
      pushToast(msg, order.status === "filled" || order.status === "pending" ? "success" : "error")
      await refreshTradingData()
    } catch (error) {
      if (error instanceof TradingApiError) {
        const h = humanizeApiError(error)
        setStatus(h)
        pushToast(h.message, "error")
      } else {
        setStatus({ message: "Service temporairement indisponible. Vérifiez votre connexion et réessayez.", action: "Réessayez dans quelques instants." })
        pushToast("Service temporairement indisponible.", "error")
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
        <button className={side === "buy" ? "buy active" : ""} onClick={() => setSide("buy")}>
          Acheter
        </button>
        <button className={side === "sell" ? "sell active" : ""} onClick={() => setSide("sell")}>
          Vendre
        </button>
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
      <label>
        STOP-LOSS (optionnel)
        <input type="number" min="0" step="any" value={stopLoss} placeholder="ex: 210" onChange={(e) => setStopLoss(e.target.value)} />
      </label>
      <label>
        TAKE-PROFIT (optionnel)
        <input type="number" min="0" step="any" value={takeProfit} placeholder="ex: 250" onChange={(e) => setTakeProfit(e.target.value)} />
      </label>
      <div className="order-summary">
        <span>
          Valeur estimée <strong className="mono">{money(total)}</strong>
        </span>
        <span>
          Part du solde <strong className="mono">{part}%</strong>
        </span>
        <span>
          Slippage max <strong className="mono">{slippageMax}</strong>
        </span>
        {stopLoss && (
          <span>
            SL <strong className="mono">{money(Number(stopLoss))}</strong>
          </span>
        )}
        {takeProfit && (
          <span>
            TP <strong className="mono">{money(Number(takeProfit))}</strong>
          </span>
        )}
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
      <ConfirmDialog
        open={confirmOpen}
        title="Confirmer l’ordre"
        description={`Sens: ${side.toUpperCase()} ${symbol} • Qté: ${qty} • Type: ${type}${type === "limit" ? ` @ ${limit}` : ""} • Total: ${money(total)} • Part solde: ${part}% • SL: ${stopLoss || "—"} • TP: ${takeProfit || "—"} • Slippage max: ${slippageMax}`}
        confirmLabel="Envoyer l’ordre"
        onConfirm={confirmSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  )
}
function Positions() {
  const positions = useTrading((s) => s.positions)
  const prices = useTrading((s) => s.prices)
  const pushToast = useTrading((s) => s.pushToast)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; action: string } | null>(null)
  const [edits, setEdits] = useState<Record<string, { stopLoss: string; takeProfit: string }>>({})
  const [closeConfirm, setCloseConfirm] = useState<{ symbol: string; quantity: number } | null>(null)
  function getEdit(id: string, p: (typeof positions)[number]) {
    return edits[id] ?? { stopLoss: p.stopLoss != null ? String(p.stopLoss) : "", takeProfit: p.takeProfit != null ? String(p.takeProfit) : "" }
  }
  async function updatePosition(id: string) {
    const e = edits[id]
    if (!e) return
    const sl = e.stopLoss === "" ? null : Number(e.stopLoss)
    const tp = e.takeProfit === "" ? null : Number(e.takeProfit)
    if (e.stopLoss !== "" && (!Number.isFinite(sl as number) || (sl as number) <= 0)) {
      pushToast("Stop-loss invalide", "error")
      return
    }
    if (e.takeProfit !== "" && (!Number.isFinite(tp as number) || (tp as number) <= 0)) {
      pushToast("Take-profit invalide", "error")
      return
    }
    setBusyId(id)
    setError(null)
    try {
      await patchPosition(id, { stopLoss: sl, takeProfit: tp })
      pushToast("Protections mises à jour", "success")
      await refreshTradingData()
    } catch (e) {
      const h = e instanceof TradingApiError ? humanizeApiError(e) : { message: "Mise à jour impossible.", action: "Réessayez." }
      setError(h)
      pushToast(h.message, "error")
    } finally {
      setBusyId(null)
    }
  }
  async function closePosition(symbol: string, quantity: number) {
    setBusyId(symbol)
    setError(null)
    try {
      await postOrder({ symbol, side: "sell", type: "market", quantity, stopLoss: null, takeProfit: null })
      pushToast("Position fermée", "success")
      await refreshTradingData()
    } catch (e) {
      const h = e instanceof TradingApiError ? humanizeApiError(e) : { message: "Clôture impossible.", action: "Réessayez." }
      setError(h)
      pushToast(h.message, "error")
    } finally {
      setBusyId(null)
      setCloseConfirm(null)
    }
  }
  if (positions.length === 0) {
    return (
      <>
        <SectionHead eyebrow="0 POSITION" title="Positions ouvertes" copy="Valeurs recalculées en continu par le moteur de valorisation." />
        <div className="position-cards">
          <div className="empty">
            <h3>Aucune position ouverte</h3>
            <p>Vos achats exécutés apparaîtront ici.</p>
          </div>
        </div>
      </>
    )
  }
  return (
    <>
      <SectionHead eyebrow={`${positions.length} POSITION${positions.length > 1 ? "S" : ""}`} title="Positions ouvertes" copy="Valeurs recalculées en continu par le moteur de valorisation." />
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
        {positions.map((p) => {
          const edit = getEdit(p.id, p)
          const livePrice = prices[p.symbol]?.price ?? p.currentPrice
          return (
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
                <span>
                  Entrée moyenne<strong>{money(p.avgEntryPrice)}</strong>
                </span>
                <span>
                  Prix actuel
                  <PriceFlash value={livePrice}>
                    <strong>{money(livePrice)}</strong>
                  </PriceFlash>
                </span>
                <span>
                  Ouverte le<strong>{new Date(p.openedAt).toLocaleDateString("fr-FR")}</strong>
                </span>
              </div>
              <div className="protection">
                <label>
                  STOP-LOSS
                  <input
                    value={edit.stopLoss}
                    placeholder="—"
                    onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: { ...getEdit(p.id, p), stopLoss: e.target.value } }))}
                  />
                </label>
                <label>
                  TAKE-PROFIT
                  <input
                    value={edit.takeProfit}
                    placeholder="—"
                    onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: { ...getEdit(p.id, p), takeProfit: e.target.value } }))}
                  />
                </label>
              </div>
              <div className="card-actions">
                <button disabled={busyId === p.id} onClick={() => updatePosition(p.id)}>
                  {busyId === p.id ? "Mise à jour…" : "Mettre à jour"}
                </button>
                <button className="danger" disabled={busyId === p.symbol} onClick={() => setCloseConfirm({ symbol: p.symbol, quantity: p.quantity })}>
                  {busyId === p.symbol ? "Clôture…" : "Fermer la position"}
                </button>
              </div>
            </article>
          )
        })}
      </div>
      <ConfirmDialog
        open={!!closeConfirm}
        title="Fermer la position"
        description={closeConfirm ? `Vendre ${closeConfirm.quantity} ${closeConfirm.symbol} au marché ? Cette action est immédiate.` : ""}
        confirmLabel="Fermer au marché"
        tone="danger"
        onConfirm={() => closeConfirm && closePosition(closeConfirm.symbol, closeConfirm.quantity)}
        onCancel={() => setCloseConfirm(null)}
      />
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
  const orders = useTrading((s) => s.orders)
  const setData = useTrading((s) => s.setData)
  const pushToast = useTrading((s) => s.pushToast)
  const [status, setStatus] = useState<OrderStatus | undefined>(undefined)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<"date" | "price" | "slippage">("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  useEffect(() => {
    getOrders({ status, limit: 100 })
      .then((list) => setData({ orders: list }))
      .catch(() => undefined)
  }, [status, setData])
  const sorted = useMemo(() => {
    const copy = [...orders]
    copy.sort((a, b) => {
      let va: number = 0
      let vb: number = 0
      if (sortKey === "date") {
        va = new Date(a.createdAt).getTime()
        vb = new Date(b.createdAt).getTime()
      } else if (sortKey === "price") {
        va = a.filledPrice ?? a.requestedPrice
        vb = b.filledPrice ?? b.requestedPrice
      } else {
        va = a.slippage ?? -1
        vb = b.slippage ?? -1
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1
      if (va > vb) return sortDir === "asc" ? 1 : -1
      return 0
    })
    return copy
  }, [orders, sortKey, sortDir])
  const totalPages = Math.max(1, Math.ceil(sorted.length / 20))
  const paged = useMemo(() => sorted.slice((page - 1) * 20, page * 20), [sorted, page])
  useEffect(() => setPage(1), [status, sortKey, sortDir])
  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir(key === "date" ? "desc" : "asc")
    }
  }
  async function cancel(id: string) {
    setBusyId(id)
    try {
      await cancelOrder(id)
      pushToast("Ordre annulé", "success")
      await refreshTradingData()
    } catch (e) {
      const h = e instanceof TradingApiError ? humanizeApiError(e) : { message: "Annulation impossible.", action: "Réessayez." }
      pushToast(h.message, "error")
    } finally {
      setBusyId(null)
      setConfirmId(null)
    }
  }
  function exportOrdersCsv() {
    const rows = sorted.map((o) => ({
      id: o.id,
      symbole: o.symbol,
      sens: o.side,
      type: o.type,
      quantite: o.quantity,
      prix_demande: o.requestedPrice,
      prix_rempli: o.filledPrice ?? "",
      slippage: o.slippage != null ? o.slippage.toFixed(3) : "",
      statut: o.status,
      source: o.source,
      date: o.createdAt,
    }))
    exportToCsv("ordres.csv", rows)
  }
  const dataEmpty = orders.length === 0
  return (
    <>
      <SectionHead eyebrow="JOURNAL IMMUABLE" title="Historique des ordres" copy="Prix demandé, exécution réelle, slippage et source — sans simplification." />
      <div className="filterbar">
        {statusFilters.map((filter) => (
          <button key={filter.label} className={status === filter.value ? "active" : ""} onClick={() => setStatus(filter.value)}>
            {status === filter.value && <SlidersHorizontal size={14} />} {filter.label}
          </button>
        ))}
        <button onClick={exportOrdersCsv} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Download size={14} /> CSV
        </button>
      </div>
      {dataEmpty ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonLine w="40%" />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <section className="panel market-table">
          <div className="table-head orders-head">
            <span>ORDRE</span>
            <span>TYPE</span>
            <span>DEMANDÉ / REMPLI</span>
            <span>STATUT</span>
            <span>SOURCE</span>
            <button onClick={() => toggleSort("date")} style={{ border: 0, background: "transparent", display: "flex", alignItems: "center", gap: 4, color: "var(--muted)", fontSize: 9 }}>
              DATE {sortKey === "date" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "8px 0", flexWrap: "wrap" }}>
            <button onClick={() => toggleSort("price")} style={{ border: "1px solid var(--border)", background: "transparent", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}>
              Tri prix {sortKey === "price" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
            <button onClick={() => toggleSort("slippage")} style={{ border: "1px solid var(--border)", background: "transparent", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}>
              Tri slippage {sortKey === "slippage" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
          </div>
          {paged.map((o) => (
            <div className="market-row order-row" key={o.id}>
              <div>
                <strong>
                  {o.side === "buy" ? "ACHAT" : "VENTE"} {o.symbol}
                </strong>
                <span>{o.quantity} unités • <RelativeTime iso={o.createdAt} /></span>
              </div>
              <span>{o.type === "market" ? "Marché" : `Limite ${o.limitPrice ? money(o.limitPrice) : ""}`}</span>
              <div className="mono">
                <strong>{money(o.requestedPrice)}</strong>
                <span>
                  {o.filledPrice ? money(o.filledPrice) : "Données en chargement"}
                  {o.slippage !== null && ` • ${o.slippage.toFixed(3)}%`}
                </span>
              </div>
              <Pill tone={o.status === "filled" ? "good" : o.status === "rejected" ? "bad" : "neutral"}>{o.status.toUpperCase()}</Pill>
              <span>{o.source === "manual" ? "Manuel" : "Agent IA"}</span>
              <span>{new Date(o.createdAt).toLocaleString("fr-FR")}</span>
              {o.status === "pending" && (
                <button className="text-btn" disabled={busyId === o.id} onClick={() => setConfirmId(o.id)}>
                  {busyId === o.id ? "…" : "Annuler"}
                </button>
              )}
            </div>
          ))}
          {paged.length === 0 && (
            <div className="empty">
              <h3>Aucun ordre</h3>
              <p>Aucun ordre ne correspond à ce filtre.</p>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 4px" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Page {page} / {totalPages} • {sorted.length} ordres
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ border: "1px solid var(--border)", background: "transparent", padding: "6px 10px", borderRadius: 6 }}>
                Précédent
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={{ border: "1px solid var(--border)", background: "transparent", padding: "6px 10px", borderRadius: 6 }}>
                Suivant
              </button>
            </div>
          </div>
        </section>
      )}
      <ConfirmDialog
        open={!!confirmId}
        title="Annuler l’ordre"
        description="Confirmez l’annulation de l’ordre en attente. Cette action est définitive."
        confirmLabel="Annuler l’ordre"
        tone="danger"
        onConfirm={() => confirmId && cancel(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </>
  )
}
function Performance() {
  const summary = useTrading((s) => s.summary)
  const orders = useTrading((s) => s.orders)
  const positions = useTrading((s) => s.positions)
  const account = useTrading((s) => s.account)
  const filled = orders.filter((o) => o.status === "filled")
  const aiCount = filled.filter((o) => o.source === "ai_agent").length
  const manualCount = filled.length - aiCount
  const empty = !summary
  return (
    <>
      <SectionHead
        eyebrow={account ? `DEPUIS ${new Date(account.createdAt).toLocaleDateString("fr-FR")}` : "PERFORMANCE"}
        title="Performance & risque"
        copy="Les gains et les pertes ont le même poids dans cette lecture."
      />
      {empty ? (
        <div className="stats-grid performance-stats">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="stats-grid performance-stats">
          <article className="stat">
            <span>P&L NET</span>
            {summary ? <Pnl value={summary.totalPnl} percent={summary.totalPnlPercent} /> : <span className="mono">Données en chargement</span>}
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
      )}
      <section className="panel equity">
        <div className="panel-head">
          <div>
            <span className="eyebrow">TRAÇABILITÉ</span>
            <h2>Traçabilité totale</h2>
          </div>
        </div>
        <p className="fineprint">Le moteur de valorisation recalcule solde, exposition et P&L à chaque tick. Aucun calcul dans le navigateur.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 16 }}>
          <div style={{ border: "1px solid var(--border)", padding: 14, background: "#0D141E" }}>
            <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".08em" }}>SOURCE DE VÉRITÉ</span>
            <strong style={{ display: "block", marginTop: 8 }}>Moteur de valorisation</strong>
            <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>Solde et P&L recalculés côté service à chaque tick.</p>
          </div>
          <div style={{ border: "1px solid var(--border)", padding: 14, background: "#0D141E" }}>
            <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".08em" }}>HORODATAGE</span>
            <strong style={{ display: "block", marginTop: 8 }}>{new Date().toLocaleString("fr-FR")}</strong>
            <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>Synchronisation continue des prix et des positions.</p>
          </div>
          <div style={{ border: "1px solid var(--border)", padding: 14, background: "#0D141E" }}>
            <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".08em" }}>AUDIT</span>
            <strong style={{ display: "block", marginTop: 8 }}>Journal immuable</strong>
            <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>Chaque ordre et décision conserve sa trace complète.</p>
          </div>
        </div>
      </section>
    </>
  )
}
function DecisionRow({ d }: { d: ReturnType<typeof useTrading.getState>["decisions"][number] }) {
  const selectDecision = useTrading((s) => s.selectDecision)
  const setViewRaw = useTrading((s) => s.setView)
  return (
    <button
      className="decision-row"
      onClick={() => {
        selectDecision(d.id)
        ;(setViewRaw as unknown as (v: AppView) => void)("agent")
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
export function TradingApp({ initialView, initialSymbol }: { initialView?: View; initialSymbol?: string } = {}) {
  const view = useTrading((s) => s.view as unknown as AppView)
  const setView = useTrading((s) => s.setView)
  const selectSymbol = useTrading((s) => s.selectAsset)
  const authReady = useTrading((s) => s.authReady)
  useLiveData()
  useEffect(() => {
    if (initialView) (setView as unknown as (v: AppView) => void)(initialView as AppView)
    if (initialSymbol) selectSymbol(initialSymbol)
  }, [initialView, initialSymbol, setView, selectSymbol])
  if (!authReady) {
    return (
      <div className="welcome-page">
        <section className="welcome-card">
          <h1>Chargement…</h1>
        </section>
      </div>
    )
  }
  return (
    <Shell>
      <ReactActivity mode={view === "dashboard" ? "visible" : "hidden"}>
        <Dashboard />
      </ReactActivity>
      <ReactActivity mode={view === "market" ? "visible" : "hidden"}>
        <Market />
      </ReactActivity>
      <ReactActivity mode={view === "positions" ? "visible" : "hidden"}>
        <Positions />
      </ReactActivity>
      <ReactActivity mode={view === "orders" ? "visible" : "hidden"}>
        <Orders />
      </ReactActivity>
      <ReactActivity mode={view === "performance" ? "visible" : "hidden"}>
        <Performance />
      </ReactActivity>
      <ReactActivity mode={view === "agent" ? "visible" : "hidden"}>
        <AgentsPage />
      </ReactActivity>
      <ReactActivity mode={view === "settings" ? "visible" : "hidden"}>
        <SettingsPage />
      </ReactActivity>
      <ReactActivity mode={view === "chat" ? "visible" : "hidden"}>
        <ChatInterface />
      </ReactActivity>
    </Shell>
  )
}
export { signed }
