"use client"

import { useEffect, useState } from "react"
import {
  createAgent,
  deleteAgent,
  getAgents,
  runAgent,
  updateAgent,
  type AgentInstance,
  type CreateAgentInput,
} from "@/lib/api"
import { useTrading } from "@/store/use-trading"

type Profile = AgentInstance["profile"]
type ThinkingLevel = AgentInstance["thinkingLevel"]
type Mode = AgentInstance["mode"]

const profileLabel: Record<Profile, string> = {
  technical: "Technique",
  news: "Actu",
  risk: "Risque",
  custom: "Custom",
}

const profileTone: Record<Profile, string> = {
  technical: "cyan",
  news: "good",
  risk: "bad",
  custom: "neutral",
}

const thinkingOptions: ThinkingLevel[] = ["low", "medium", "high"]
const profileOptions: Profile[] = ["technical", "news", "risk", "custom"]

function toLegacyConfig(agent: AgentInstance) {
  return {
    accountId: agent.accountId,
    enabled: agent.enabled,
    mode: agent.mode,
    watchedSymbols: agent.watchedSymbols,
    maxPositionSizePercent: agent.maxPositionSizePercent,
    dailyLossLimitPercent: agent.dailyLossLimitPercent,
    circuitBreakerActive: agent.circuitBreakerActive,
    circuitBreakerReason: agent.circuitBreakerReason,
  }
}

interface FormState {
  name: string
  profile: Profile
  instructions: string
  thinkingLevel: ThinkingLevel
  watchedSymbols: string[]
  maxPositionSizePercent: number
  dailyLossLimitPercent: number
  enabled: boolean
  mode: Mode
}

const emptyForm: FormState = {
  name: "",
  profile: "custom",
  instructions: "",
  thinkingLevel: "medium",
  watchedSymbols: [],
  maxPositionSizePercent: 2,
  dailyLossLimitPercent: 3,
  enabled: true,
  mode: "propose",
}

function formFromAgent(agent: AgentInstance): FormState {
  return {
    name: agent.name,
    profile: agent.profile,
    instructions: agent.instructions ?? "",
    thinkingLevel: agent.thinkingLevel,
    watchedSymbols: [...agent.watchedSymbols],
    maxPositionSizePercent: agent.maxPositionSizePercent,
    dailyLossLimitPercent: agent.dailyLossLimitPercent,
    enabled: agent.enabled,
    mode: agent.mode,
  }
}

export function AgentsPage() {
  const assets = useTrading((s) => s.assets)
  const decisions = useTrading((s) => s.decisions)
  const setData = useTrading((s) => s.setData)
  const pushToast = useTrading((s) => s.pushToast)

  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterAgentId, setFilterAgentId] = useState<string>("all")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<AgentInstance | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const list = await getAgents()
        if (cancelled) return
        setAgents(list)
        if (list.length > 0) {
          setData({ aiConfig: toLegacyConfig(list[0]) as never })
        }
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Chargement des agents impossible", "error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [setData, pushToast])

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm })
    setFormError(null)
    setDrawerOpen(true)
  }

  function openEdit(agent: AgentInstance) {
    setEditing(agent)
    setForm(formFromAgent(agent))
    setFormError(null)
    setDrawerOpen(true)
  }

  function validate(): string | null {
    if (!form.name.trim()) return "Le nom est requis"
    if (form.name.trim().length > 60) return "Le nom ne peut dépasser 60 caractères"
    if (form.instructions.length > 2000) return "Les instructions ne peuvent dépasser 2000 caractères"
    if (form.enabled && form.watchedSymbols.length === 0) return "Au moins 1 symbole requis si l'agent est actif"
    if (form.maxPositionSizePercent <= 0) return "La taille max doit être positive"
    if (form.dailyLossLimitPercent <= 0) return "La perte journalière doit être positive"
    return null
  }

  async function handleSubmit() {
    const err = validate()
    if (err) {
      setFormError(err)
      return
    }
    setSaving(true)
    setFormError(null)
    const payload: CreateAgentInput = {
      name: form.name.trim(),
      profile: form.profile,
      instructions: form.instructions,
      thinkingLevel: form.thinkingLevel,
      watchedSymbols: form.watchedSymbols,
      maxPositionSizePercent: form.maxPositionSizePercent,
      dailyLossLimitPercent: form.dailyLossLimitPercent,
      enabled: form.enabled,
      mode: form.mode,
    }
    try {
      if (editing) {
        const updated = await updateAgent(editing.id, payload)
        setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
        if (selectedId === updated.id) setSelectedId(updated.id)
        if (agents[0]?.id === updated.id) setData({ aiConfig: toLegacyConfig(updated) as never })
        pushToast("Agent mis à jour", "success")
      } else {
        const created = await createAgent(payload)
        setAgents((prev) => [...prev, created])
        if (agents.length === 0) setData({ aiConfig: toLegacyConfig(created) as never })
        pushToast("Agent créé", "success")
      }
      setDrawerOpen(false)
      setEditing(null)
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Enregistrement impossible", "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(agent: AgentInstance) {
    if (typeof window !== "undefined" && !window.confirm(`Supprimer ${agent.name} ?`)) return
    setDeletingId(agent.id)
    try {
      await deleteAgent(agent.id)
      setAgents((prev) => prev.filter((a) => a.id !== agent.id))
      if (selectedId === agent.id) setSelectedId(null)
      if (agents[0]?.id === agent.id) {
        const remaining = agents.filter((a) => a.id !== agent.id)
        if (remaining[0]) setData({ aiConfig: toLegacyConfig(remaining[0]) as never })
      }
      pushToast("Agent supprimé", "success")
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Suppression impossible", "error")
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRun(agent: AgentInstance) {
    setRunningId(agent.id)
    try {
      const result = await runAgent(agent.id)
      if (result.length > 0) {
        setData({ decisions: [...result, ...decisions] })
      }
      pushToast(`Agent ${agent.name} lancé`, "success")
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Lancement impossible", "error")
    } finally {
      setRunningId(null)
    }
  }

  function toggleSymbol(symbol: string) {
    setForm((prev) => ({
      ...prev,
      watchedSymbols: prev.watchedSymbols.includes(symbol)
        ? prev.watchedSymbols.filter((s) => s !== symbol)
        : [...prev.watchedSymbols, symbol],
    }))
  }

  const filteredDecisions = (() => {
    if (filterAgentId === "all") return decisions
    const ag = agents.find((a) => a.id === filterAgentId)
    if (!ag) return decisions
    return decisions.filter((d) => ag.watchedSymbols.includes(d.symbol))
  })()

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="section-head">
        <div>
          <span className="eyebrow">AUTOMATISATION</span>
          <h1>Agents</h1>
          <p>Créez, configurez et lancez vos agents de trading autonomes.</p>
        </div>
        <button className="primary" onClick={openCreate}>
          + Créer un agent
        </button>
      </div>

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel" style={{ height: 160, opacity: 0.6 }}>
              <div style={{ height: 14, background: "var(--border)", marginBottom: 12, width: "60%" }} />
              <div style={{ height: 10, background: "var(--border)", marginBottom: 8 }} />
              <div style={{ height: 10, background: "var(--border)", width: "80%" }} />
            </div>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="panel empty">
          <h3>Aucun agent</h3>
          <p>Créez votre premier agent pour commencer.</p>
          <button className="primary" style={{ marginTop: 12 }} onClick={openCreate}>
            Créer un agent
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelectedId(agent.id)}
              className="panel"
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderColor: selectedId === agent.id ? "var(--cyan)" : undefined,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <strong style={{ display: "block", fontSize: 15 }}>{agent.name}</strong>
                  <span className={`pill ${profileTone[agent.profile]}`} style={{ marginTop: 6 }}>
                    {profileLabel[agent.profile]}
                  </span>
                </div>
                <span className={`pill ${agent.enabled ? "good" : "bad"}`}>{agent.enabled ? "ACTIF" : "INACTIF"}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {agent.watchedSymbols.length === 0 ? (
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>Aucun symbole</span>
                ) : (
                  agent.watchedSymbols.map((s) => (
                    <span key={s} className="pill">
                      {s}
                    </span>
                  ))
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".08em" }}>
                  {agent.mode === "autonomous" ? "AUTONOME" : "PROPOSE"} · {agent.thinkingLevel.toUpperCase()}
                </span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  handleRun(agent)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation()
                    handleRun(agent)
                  }
                }}
                className="primary"
                style={{
                  justifyContent: "center",
                  width: "100%",
                  opacity: runningId === agent.id ? 0.7 : 1,
                  pointerEvents: runningId === agent.id ? "none" : "auto",
                  display: "inline-flex",
                }}
              >
                {runningId === agent.id ? "Lancement…" : "Lancer maintenant"}
              </span>
              {agent.circuitBreakerActive && (
                <div className="warning" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11 }}>Circuit breaker actif: {agent.circuitBreakerReason ?? "limite atteinte"}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {selectedAgent && (
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <span className="eyebrow">FICHE AGENT</span>
              <h2 style={{ margin: "6px 0 0" }}>{selectedAgent.name}</h2>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <span className={`pill ${profileTone[selectedAgent.profile]}`}>{profileLabel[selectedAgent.profile]}</span>
                <span className={`pill ${selectedAgent.enabled ? "good" : "bad"}`}>{selectedAgent.enabled ? "ACTIF" : "INACTIF"}</span>
                <span className="pill">{selectedAgent.mode === "autonomous" ? "Autonome" : "Propose"}</span>
                <span className="pill">{selectedAgent.thinkingLevel}</span>
              </div>
            </div>
            <button className="text-btn" onClick={() => setSelectedId(null)}>
              Fermer
            </button>
          </div>

          <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            <dt style={{ color: "var(--muted)", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>Instructions</dt>
            <dd style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: 11, gridColumn: "1 / -1", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
              {selectedAgent.instructions ? selectedAgent.instructions : "—"}
            </dd>
            <dt style={{ color: "var(--muted)", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>Symboles</dt>
            <dd style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: 11, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {selectedAgent.watchedSymbols.map((s) => (
                <span key={s} className="pill">
                  {s}
                </span>
              ))}
              {selectedAgent.watchedSymbols.length === 0 && "—"}
            </dd>
            <dt style={{ color: "var(--muted)", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>Taille max position</dt>
            <dd style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: 11 }}>{selectedAgent.maxPositionSizePercent}%</dd>
            <dt style={{ color: "var(--muted)", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>Perte journalière max</dt>
            <dd style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: 11 }}>{selectedAgent.dailyLossLimitPercent}%</dd>
            <dt style={{ color: "var(--muted)", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>Circuit breaker</dt>
            <dd style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: 11 }}>
              {selectedAgent.circuitBreakerActive ? `Actif — ${selectedAgent.circuitBreakerReason ?? ""}` : "Inactif"}
            </dd>
          </dl>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" onClick={() => openEdit(selectedAgent)}>
              Éditer
            </button>
            <button className="danger" disabled={deletingId === selectedAgent.id} onClick={() => handleDelete(selectedAgent)}>
              {deletingId === selectedAgent.id ? "Suppression…" : "Supprimer"}
            </button>
            <button
              className="primary"
              style={{ marginLeft: "auto" }}
              disabled={runningId === selectedAgent.id}
              onClick={() => handleRun(selectedAgent)}
            >
              {runningId === selectedAgent.id ? "Lancement…" : "Lancer maintenant"}
            </button>
          </div>
        </div>
      )}

      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <span className="eyebrow">JOURNAL FILTRABLE</span>
            <h2 style={{ margin: "4px 0 0" }}>Décisions</h2>
          </div>
          <select className="sort" style={{ minWidth: 180, marginTop: 0 }} value={filterAgentId} onChange={(e) => setFilterAgentId(e.target.value)}>
            <option value="all">Tous les agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {filteredDecisions.length === 0 ? (
          <div className="empty" style={{ padding: "30px 10px" }}>
            <h3>Aucune décision</h3>
            <p>Aucune décision pour ce filtre.</p>
          </div>
        ) : (
          filteredDecisions.slice(0, 30).map((d) => (
            <div key={d.id} className="decision-row" style={{ cursor: "default" }}>
              <div className="decision-action">
                <span className={`pill ${d.validationPassed ? (d.action === "BUY" ? "good" : "cyan") : "bad"}`}>{d.action}</span>
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
              <span className={`pill ${d.validationPassed ? "good" : "bad"}`}>{d.validationPassed ? "VALIDÉE" : "REJETÉE"}</span>
            </div>
          ))
        )}
      </div>

      {drawerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 40,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="panel"
            style={{ width: "min(620px,100%)", maxHeight: "90vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>{editing ? "Éditer l'agent" : "Créer un agent"}</h2>
              <button className="text-btn" onClick={() => setDrawerOpen(false)}>
                Fermer
              </button>
            </div>

            {formError && <div className="warning" style={{ borderColor: "var(--coral)" }}><strong>{formError}</strong></div>}

            <label style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--muted)" }}>
              NOM
              <input
                value={form.name}
                maxLength={60}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Ex: Agent technique"
                style={{ display: "block", width: "100%", marginTop: 6, background: "#0D141E", border: "1px solid var(--border)", padding: 10, color: "var(--foreground)" }}
              />
              <span style={{ display: "block", textAlign: "right", marginTop: 4, color: "var(--muted)", fontSize: 10 }}>{form.name.length}/60</span>
            </label>

            <label style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--muted)" }}>
              PROFIL
              <select
                value={form.profile}
                onChange={(e) => setForm((p) => ({ ...p, profile: e.target.value as Profile }))}
                style={{ display: "block", width: "100%", marginTop: 6, background: "#0D141E", border: "1px solid var(--border)", padding: 10, color: "var(--foreground)" }}
              >
                {profileOptions.map((p) => (
                  <option key={p} value={p}>
                    {profileLabel[p]}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--muted)" }}>
              INSTRUCTIONS
              <textarea
                value={form.instructions}
                maxLength={2000}
                rows={4}
                onChange={(e) => setForm((p) => ({ ...p, instructions: e.target.value }))}
                placeholder="Décrivez la stratégie de l'agent..."
                style={{ display: "block", width: "100%", marginTop: 6, background: "#0D141E", border: "1px solid var(--border)", padding: 10, color: "var(--foreground)", resize: "vertical" }}
              />
              <span style={{ display: "block", textAlign: "right", marginTop: 4, color: "var(--muted)", fontSize: 10 }}>{form.instructions.length}/2000</span>
            </label>

            <label style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--muted)" }}>
              NIVEAU DE RÉFLEXION
              <select
                value={form.thinkingLevel}
                onChange={(e) => setForm((p) => ({ ...p, thinkingLevel: e.target.value as ThinkingLevel }))}
                style={{ display: "block", width: "100%", marginTop: 6, background: "#0D141E", border: "1px solid var(--border)", padding: 10, color: "var(--foreground)" }}
              >
                {thinkingOptions.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--muted)" }}>SYMBOLES SURVEILLÉS</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {assets.length === 0 ? (
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>Aucun actif disponible</span>
                ) : (
                  assets.map((a) => (
                    <label
                      key={a.symbol}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        border: "1px solid var(--border)",
                        padding: "6px 8px",
                        background: form.watchedSymbols.includes(a.symbol) ? "var(--panel-2)" : "transparent",
                        cursor: "pointer",
                        fontSize: 11,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.watchedSymbols.includes(a.symbol)}
                        onChange={() => toggleSymbol(a.symbol)}
                      />
                      {a.symbol}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--muted)" }}>
                TAILLE MAX POSITION (%)
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={form.maxPositionSizePercent}
                  onChange={(e) => setForm((p) => ({ ...p, maxPositionSizePercent: Number(e.target.value) }))}
                  style={{ display: "block", width: "100%", marginTop: 6, background: "#0D141E", border: "1px solid var(--border)", padding: 10, color: "var(--foreground)" }}
                />
              </label>
              <label style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--muted)" }}>
                PERTE JOURNALIÈRE MAX (%)
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={form.dailyLossLimitPercent}
                  onChange={(e) => setForm((p) => ({ ...p, dailyLossLimitPercent: Number(e.target.value) }))}
                  style={{ display: "block", width: "100%", marginTop: 6, background: "#0D141E", border: "1px solid var(--border)", padding: 10, color: "var(--foreground)" }}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                <button
                  type="button"
                  className={`switch ${form.enabled ? "on" : ""}`}
                  onClick={() => setForm((p) => ({ ...p, enabled: !p.enabled }))}
                  aria-pressed={form.enabled}
                >
                  <i />
                </button>
                Activé
              </label>
              <label style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--muted)", display: "flex", flexDirection: "column", gap: 6 }}>
                MODE
                <select
                  value={form.mode}
                  onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value as Mode }))}
                  style={{ background: "#0D141E", border: "1px solid var(--border)", padding: "8px 10px", color: "var(--foreground)", minWidth: 140 }}
                >
                  <option value="propose">Propose</option>
                  <option value="autonomous">Autonome</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={{ border: "1px solid var(--border)", background: "transparent", padding: "10px 14px" }} onClick={() => setDrawerOpen(false)}>
                Annuler
              </button>
              <button className="primary" disabled={saving} onClick={handleSubmit}>
                {saving ? "Enregistrement…" : editing ? "Enregistrer" : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
