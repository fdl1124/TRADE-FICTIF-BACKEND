"use client"

import { useEffect, useRef, useState } from "react"
import {
  createConversation,
  deleteConversation,
  getConversations,
  getMessages,
  postOrder,
  sendMessageStream,
  type ChatMessage,
} from "@/lib/api"
import { useTrading } from "@/store/use-trading"

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function markdownToHtml(input: string) {
  let html = escapeHtml(input)
  const blockPlaceholders: string[] = []
  const inlinePlaceholders: string[] = []
  html = html.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    const idx = blockPlaceholders.length
    blockPlaceholders.push(
      `<pre style="background:#0D141E;border:1px solid var(--border);padding:10px;overflow:auto;margin:8px 0;border-radius:6px"><code>${code}</code></pre>`
    )
    return `__BLOCK_${idx}__`
  })
  html = html.replace(/`([^`]+?)`/g, (_m, code: string) => {
    const idx = inlinePlaceholders.length
    inlinePlaceholders.push(
      `<code style="background:#0D141E;padding:2px 4px;border:1px solid var(--border);border-radius:4px">${code}</code>`
    )
    return `__INLINE_${idx}__`
  })
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/\*([^*]+?)\*/g, "<em>$1</em>")
  html = html.replace(
    /\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--cyan);text-decoration:underline">$1</a>'
  )
  html = html.replace(/^### (.+)$/gm, '<h3 style="margin:10px 0 4px;font-size:14px">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 style="margin:10px 0 4px;font-size:15px">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h2 style="margin:10px 0 4px;font-size:16px">$1</h2>')
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote style="margin:8px 0;padding:4px 10px;border-left:3px solid var(--cyan);color:var(--muted)">$1</blockquote>')
  html = html.replace(/^---+$/gm, '<hr style="border:0;border-top:1px solid var(--border);margin:10px 0" />')
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>")
  html = html.replace(/^\d+[.)] (.+)$/gm, "<oli>$1</oli>")
  html = html.replace(/(?:<oli>.*?<\/oli>\n?)+/g, (m) => {
    return `<ol style="margin:8px 0;padding-left:18px;display:flex;flex-direction:column;gap:4px">${m}</ol>`
  })
  html = html.replace(/(?:<li>.*?<\/li>\n?)+/g, (m) => {
    return `<ul style="margin:8px 0;padding-left:18px;display:flex;flex-direction:column;gap:4px">${m}</ul>`
  })
  html = html.replace(/\n/g, "<br>")
  html = html.replace(/<\/li><br><li>/g, "</li><li>")
  html = html.replace(/<\/oli><br><oli>/g, "</oli><oli>")
  html = html.replace(/<ul[^>]*><br>/g, (m) => m.replace("<br>", ""))
  html = html.replace(/<ol[^>]*><br>/g, (m) => m.replace("<br>", ""))
  html = html.replace(/<br><\/ul>/g, "</ul>")
  html = html.replace(/<br><\/ol>/g, "</ol>")
  html = html.replace(/<oli>/g, '<li style="margin:0">')
  html = html.replace(/<\/oli>/g, "</li>")
  blockPlaceholders.forEach((block, i) => {
    html = html.replace(`__BLOCK_${i}__`, block)
  })
  inlinePlaceholders.forEach((inline, i) => {
    html = html.replace(`__INLINE_${i}__`, inline)
  })
  return html
}

const TOOL_LABELS: Record<string, string> = {
  get_portfolio_summary: "Résumé du portefeuille",
  get_positions: "Positions ouvertes",
  get_asset_snapshot: "Analyse de l'actif",
  get_order_history: "Historique des ordres",
  search_assets: "Recherche d'actifs",
  get_chart_data: "Analyse du graphique",
  propose_order: "Proposition d'ordre",
  google_search: "Recherche web",
  url_context: "Analyse du lien",
}

function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name
}

function relativeDate(iso: string) {  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "À l'instant"
  if (minutes < 60) return `Il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Il y a ${hours} h`
  const days = Math.floor(hours / 24)
  if (days === 1) return "Hier"
  if (days < 7) return `Il y a ${days} j`
  return d.toLocaleDateString("fr-FR")
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.includes(",") ? result.split(",")[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error("Lecture fichier impossible"))
    reader.readAsDataURL(file)
  })
}

export function ChatInterface() {
  const chatConversations = useTrading((s) => s.chatConversations)
  const chatMessages = useTrading((s) => s.chatMessages)
  const selectedChatId = useTrading((s) => s.selectedChatId)
  const chatStreaming = useTrading((s) => s.chatStreaming)
  const setChatConversations = useTrading((s) => s.setChatConversations)
  const setChatMessages = useTrading((s) => s.setChatMessages)
  const setSelectedChatId = useTrading((s) => s.setSelectedChatId)
  const setChatStreaming = useTrading((s) => s.setChatStreaming)
  const pushToast = useTrading((s) => s.pushToast)

  const [loadingConvs, setLoadingConvs] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [input, setInput] = useState("")
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [thinkingEnabled, setThinkingEnabled] = useState(true)
  const [statusBanner, setStatusBanner] = useState<string | null>(null)
  const [thinkingOpen, setThinkingOpen] = useState<Record<string, boolean>>({})
  const [confirmingOrder, setConfirmingOrder] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)

  const listRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const apply = () => {
      setIsMobile(mq.matches)
      setShowSidebar(!mq.matches)
    }
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  const messages = selectedChatId ? chatMessages[selectedChatId] ?? [] : []

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingConvs(true)
      try {
        const convs = await getConversations()
        if (cancelled) return
        setChatConversations(convs)
        if (convs.length > 0 && !selectedChatId) {
          setSelectedChatId(convs[0].id)
        }
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Chargement conversations impossible", "error")
      } finally {
        if (!cancelled) setLoadingConvs(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [setChatConversations, setSelectedChatId, pushToast, selectedChatId])

  useEffect(() => {
    if (!selectedChatId) return
    if (chatMessages[selectedChatId] !== undefined && chatMessages[selectedChatId].length > 0) return
    let cancelled = false
    async function load() {
      setLoadingMsgs(true)
      try {
        const msgs = await getMessages(selectedChatId as string)
        if (cancelled) return
        setChatMessages(selectedChatId as string, msgs)
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Chargement messages impossible", "error")
      } finally {
        if (!cancelled) setLoadingMsgs(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedChatId, chatMessages, setChatMessages, pushToast])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, statusBanner, chatStreaming])

  useEffect(() => {
    return () => {
      previewUrls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [previewUrls])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 140) + "px"
  }

  useEffect(() => {
    autoResize()
  }, [input])

  async function handleSelectConversation(id: string) {
    setSelectedChatId(id)
    setStatusBanner(null)
    if (chatMessages[id] !== undefined) return
    setLoadingMsgs(true)
    try {
      const msgs = await getMessages(id)
      setChatMessages(id, msgs)
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Chargement messages impossible", "error")
    } finally {
      setLoadingMsgs(false)
    }
  }

  async function handleNewConversation() {
    try {
      const conv = await createConversation()
      setChatConversations([conv, ...chatConversations])
      setSelectedChatId(conv.id)
      setChatMessages(conv.id, [])
      pushToast("Conversation créée", "success")
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Création impossible", "error")
    }
  }

  async function handleDeleteConversation(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Supprimer cette conversation ?")) return
    try {
      await deleteConversation(id)
      const remaining = chatConversations.filter((c) => c.id !== id)
      setChatConversations(remaining)
      if (selectedChatId === id) {
        setSelectedChatId(remaining[0]?.id ?? null)
      }
      pushToast("Conversation supprimée", "success")
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Suppression impossible", "error")
    }
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files) return
    const incoming = Array.from(files)
    const combined = [...pendingFiles, ...incoming]
    if (combined.length > 10) {
      pushToast("10 fichiers maximum autorisés", "error")
      return
    }
    const total = combined.reduce((s, f) => s + f.size, 0)
    if (total > 15 * 1024 * 1024) {
      pushToast("Le total des fichiers dépasse 15 Mo", "error")
      return
    }
    const allowed = combined.every((f) => f.type.startsWith("image/") || f.type === "application/pdf")
    if (!allowed) {
      pushToast("Type de fichier non autorisé", "error")
      return
    }
    const urls = combined.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : ""))
    previewUrls.forEach((u) => {
      if (u) URL.revokeObjectURL(u)
    })
    setPendingFiles(combined)
    setPreviewUrls(urls)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removePending(index: number) {
    const next = pendingFiles.filter((_, i) => i !== index)
    const url = previewUrls[index]
    if (url) URL.revokeObjectURL(url)
    const nextUrls = previewUrls.filter((_, i) => i !== index)
    setPendingFiles(next)
    setPreviewUrls(nextUrls)
  }

  async function handleSend() {
    const content = input.trim()
    if (!content && pendingFiles.length === 0) return
    if (!selectedChatId) {
      try {
        const conv = await createConversation()
        setChatConversations([conv, ...chatConversations])
        setSelectedChatId(conv.id)
        await sendWithId(conv.id, content)
        return
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Création conversation impossible", "error")
        return
      }
    }
    await sendWithId(selectedChatId, content)
  }

  async function sendWithId(conversationId: string, content: string) {
    const totalSize = pendingFiles.reduce((s, f) => s + f.size, 0)
    if (totalSize > 15 * 1024 * 1024) {
      pushToast("Le total des fichiers dépasse 15 Mo", "error")
      return
    }
    if (pendingFiles.length > 10) {
      pushToast("10 fichiers maximum autorisés", "error")
      return
    }

    let attachments: { name: string; mimeType: string; dataBase64: string }[] = []
    try {
      attachments = await Promise.all(
        pendingFiles.map(async (f) => ({
          name: f.name,
          mimeType: f.type,
          dataBase64: await fileToBase64(f),
        }))
      )
    } catch {
      pushToast("Lecture des fichiers impossible", "error")
      return
    }

    const userMessage: ChatMessage = {
      id: `tmp_${Date.now()}`,
      conversationId,
      role: "user",
      content: content || (attachments.length ? "Pièces jointes" : ""),
      attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType })),
      toolSteps: [],
      thinking: "",
      sources: [],
      orderProposal: null,
      createdAt: new Date().toISOString(),
    }

    const prev = chatMessages[conversationId] ?? []
    const assistantId = `asst_${Date.now() + 1}`
    const placeholder: ChatMessage = {
      id: assistantId,
      conversationId,
      role: "assistant",
      content: "",
      attachments: [],
      toolSteps: [],
      thinking: "",
      sources: [],
      orderProposal: null,
      createdAt: new Date().toISOString(),
    }

    setChatMessages(conversationId, [...prev, userMessage, placeholder])
    setInput("")
    const urlsToRevoke = [...previewUrls]
    setPendingFiles([])
    setPreviewUrls([])
    urlsToRevoke.forEach((u) => {
      if (u) URL.revokeObjectURL(u)
    })
    setChatStreaming(true)
    setStatusBanner("Envoi…")
    const controller = new AbortController()
    abortRef.current = controller
    let accContent = ""
    let accThinking = ""
    let accTools: string[] = []
    let accSources: string[] = []
    let accProposal: ChatMessage["orderProposal"] = null

    try {
      await sendMessageStream(
        conversationId,
        { content, attachments, thinkingEnabled },
        {          onDelta: (text) => {
            accContent += text
            setChatMessages(conversationId, ((): ChatMessage[] => {
              const cur = useTrading.getState().chatMessages[conversationId] ?? []
              return cur.map((m) => (m.id === assistantId ? { ...m, content: accContent } : m))
            })())
          },
          onThinkingDelta: (text) => {
            accThinking += text
            setChatMessages(conversationId, (() => {
              const cur = useTrading.getState().chatMessages[conversationId] ?? []
              return cur.map((m) => (m.id === assistantId ? { ...m, thinking: accThinking } : m))
            })())
          },
          onStatus: (label) => {
            setStatusBanner(label)
          },
          onToolDone: (name) => {
            accTools = [...accTools, name]
            setChatMessages(conversationId, (() => {
              const cur = useTrading.getState().chatMessages[conversationId] ?? []
              return cur.map((m) =>
                m.id === assistantId ? { ...m, toolSteps: accTools.map((n) => ({ name: n, summary: n })) } : m
              )
            })())
          },
          onDone: (data) => {
            accProposal = data.orderProposal ?? null
            accSources = data.sources ?? []
            setChatMessages(conversationId, (() => {
              const cur = useTrading.getState().chatMessages[conversationId] ?? []
              return cur.map((m) =>
                m.id === assistantId
                  ? { ...m, id: data.messageId || m.id, orderProposal: accProposal, sources: accSources }
                  : m
              )
            })())
            setStatusBanner(null)
            getMessages(conversationId)
              .then((msgs) => setChatMessages(conversationId, msgs))
              .catch(() => undefined)
            getConversations()
              .then((convs) => setChatConversations(convs))
              .catch(() => undefined)
          },
          onError: (message) => {
            setStatusBanner(null)
            pushToast(message, "error")
            setChatMessages(conversationId, (() => {
              const cur = useTrading.getState().chatMessages[conversationId] ?? []
              return cur.filter((m) => m.id !== assistantId)
            })())
          },
          onUserSaved: (data) => {
            setChatMessages(conversationId, (() => {
              const cur = useTrading.getState().chatMessages[conversationId] ?? []
              return cur.map((m) => (m.id === userMessage.id ? { ...m, id: data.messageId } : m))
            })())
          },
        },
        { signal: controller.signal }
      )
    } catch (e) {
      const aborted = e instanceof DOMException ? e.name === "AbortError" : e instanceof Error && e.name === "AbortError"
      if (aborted) {
        pushToast("Génération interrompue", "success")
      } else {
        pushToast(e instanceof Error ? e.message : "Envoi impossible", "error")
        setStatusBanner(null)
      }
    } finally {
      abortRef.current = null
      setChatStreaming(false)
      setTimeout(() => setStatusBanner(null), 1200)
    }
  }

  async function handleConfirmProposal(msg: ChatMessage) {
    const p = msg.orderProposal
    if (!p) return
    setConfirmingOrder(msg.id)
    try {
      await postOrder({
        symbol: p.symbol,
        side: p.side,
        type: p.type,
        quantity: p.quantity,
        limitPrice: p.limitPrice ?? null,
      })
      pushToast("Ordre confirmé", "success")
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Confirmation impossible", "error")
    } finally {
      setConfirmingOrder(null)
    }
  }

  return (
    <div className="panel chat-layout" style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 120px)", minHeight: 480, padding: 0, overflow: "hidden", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border)", gap: 10 }}>
        {isMobile && (
          <button
            onClick={() => setShowSidebar((v) => !v)}
            style={{ width: 34, height: 34, display: "grid", placeItems: "center", border: "1px solid var(--border)", background: "var(--panel-2)", cursor: "pointer", flexShrink: 0 }}
            aria-label="Conversations"
          >
            ☰
          </button>
        )}
        <strong style={{ letterSpacing: ".04em", flex: 1 }}>Assistant IA</strong>
        <button className="primary" onClick={handleNewConversation} style={{ padding: "8px 12px" }}>
          Nouvelle conversation
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        <aside
          style={{
            width: isMobile ? "78%" : 260,
            maxWidth: 300,
            position: isMobile ? "absolute" : "relative",
            top: 0,
            bottom: 0,
            left: 0,
            zIndex: 30,
            borderRight: "1px solid var(--border)",
            display: showSidebar ? "flex" : "none",
            flexDirection: "column",
            minWidth: 0,
            background: "var(--panel)",
            boxShadow: isMobile ? "12px 0 30px rgba(0,0,0,0.45)" : "none",
          }}
        >
          <div style={{ padding: 10, overflow: "auto", flex: 1 }}>
            {loadingConvs ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ height: 56, background: "var(--panel-2)", border: "1px solid var(--border)", opacity: 0.6 }} />
                ))}
              </div>
            ) : chatConversations.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", padding: "20px 10px" }}>Aucune conversation</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {chatConversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      handleSelectConversation(c.id)
                      if (isMobile) setShowSidebar(false)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSelectConversation(c.id)
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "10px 10px",
                      border: "1px solid var(--border)",
                      background: selectedChatId === c.id ? "var(--panel-2)" : "transparent",
                      borderColor: selectedChatId === c.id ? "var(--cyan)" : "var(--border)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <strong style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                        {c.title}
                      </strong>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteConversation(c.id)
                        }}
                        style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 14, padding: "2px 4px" }}
                        aria-label="Supprimer"
                      >
                        ×
                      </button>
                    </div>
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>{relativeDate(c.updatedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {statusBanner && (
            <div style={{ padding: "8px 14px", background: "rgba(57,198,212,0.08)", borderBottom: "1px solid rgba(57,198,212,0.25)", color: "var(--cyan)", fontSize: 11, letterSpacing: ".06em" }}>
              {statusBanner}
            </div>
          )}

          <div ref={listRef} style={{ flex: 1, overflow: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
            {!selectedChatId ? (
              <div style={{ color: "var(--muted)", textAlign: "center", marginTop: 40, fontSize: 13 }}>Sélectionnez ou créez une conversation</div>
            ) : loadingMsgs ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, opacity: 0.7 }}>
                    <div style={{ height: 14, width: i === 1 ? "80%" : "60%", background: "var(--panel-2)", border: "1px solid var(--border)" }} />
                    <div style={{ height: 48, background: "var(--panel-2)", border: "1px solid var(--border)" }} />
                  </div>
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div style={{ color: "var(--muted)", textAlign: "center", marginTop: 40, fontSize: 13 }}>Aucun message — commencez la discussion</div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      background: m.role === "user" ? "var(--cyan)" : "var(--panel-2)",
                      color: m.role === "user" ? "#071015" : "var(--foreground)",
                      border: "1px solid var(--border)",
                      padding: "10px 12px",
                      borderRadius: 8,
                      fontSize: 13,
                      lineHeight: 1.6,
                      overflow: "hidden",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.role === "assistant" && m.thinking && (
                      <div style={{ marginBottom: 8, border: "1px solid var(--border)", background: "rgba(0,0,0,0.12)" }}>
                        <button
                          onClick={() => setThinkingOpen((p) => ({ ...p, [m.id]: !p[m.id] }))}
                          style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 11 }}
                        >
                          <span>Réflexion du modèle</span>
                          <span>{thinkingOpen[m.id] ? "−" : "+"}</span>
                        </button>
                        {thinkingOpen[m.id] && (
                          <div style={{ padding: "8px", fontSize: 12, color: "var(--muted)", whiteSpace: "pre-wrap", borderTop: "1px solid var(--border)" }}>
                            {m.thinking}
                          </div>
                        )}
                      </div>
                    )}

                    {m.role === "assistant" ? (
                      <div dangerouslySetInnerHTML={{ __html: markdownToHtml(m.content || (chatStreaming && m.id === messages[messages.length - 1]?.id ? "…" : "")) }} />
                    ) : (
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                    )}

                    {m.attachments.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {m.attachments.map((a, idx) => (
                          <span key={idx} className="pill" style={{ fontSize: 10 }}>
                            {a.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {m.toolSteps.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {m.toolSteps.map((t, idx) => (
                          <span key={idx} className="pill cyan">
                            {toolLabel(t.name)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {m.role === "assistant" && m.sources.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {m.sources.map((s, idx) => (
                        <a key={idx} href={s} target="_blank" rel="noopener noreferrer" className="pill" style={{ textDecoration: "underline", color: "var(--cyan)" }}>
                          Source {idx + 1}
                        </a>
                      ))}
                    </div>
                  )}

                  {m.role === "assistant" && m.orderProposal && (
                    <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 12, display: "flex", flexDirection: "column", gap: 8, borderRadius: 8 }}>
                      <strong style={{ fontSize: 12 }}>
                        Proposition: {m.orderProposal.side === "buy" ? "ACHAT" : "VENTE"} {m.orderProposal.symbol}
                      </strong>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                        <span>Quantité: {m.orderProposal.quantity}</span>
                        <span>Type: {m.orderProposal.type}</span>
                        {m.orderProposal.limitPrice !== null && <span>Prix limite: {m.orderProposal.limitPrice}</span>}
                      </div>
                      {m.orderProposal.rationale && <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{m.orderProposal.rationale}</p>}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="primary" disabled={confirmingOrder === m.id} onClick={() => handleConfirmProposal(m)} style={{ padding: "8px 10px" }}>
                          {confirmingOrder === m.id ? "Confirmation…" : "Confirmer"}
                        </button>
                        <button
                          style={{ border: "1px solid var(--border)", background: "transparent", padding: "8px 10px" }}
                          onClick={() => {
                            setChatMessages(conversationIdFor(m) ?? (selectedChatId as string), (() => {
                              const cid = conversationIdFor(m) ?? (selectedChatId as string)
                              const cur = useTrading.getState().chatMessages[cid] ?? []
                              return cur.map((x) => (x.id === m.id ? { ...x, orderProposal: null } : x))
                            })())
                          }}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}

                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          <div style={{ borderTop: "1px solid var(--border)", padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--panel)" }}>
            {pendingFiles.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {pendingFiles.map((f, idx) => (
                  <div key={idx} style={{ position: "relative", width: 64, height: 64, border: "1px solid var(--border)", overflow: "hidden", background: "var(--panel-2)", display: "grid", placeItems: "center" }}>
                    {previewUrls[idx] ? (
                      <img src={previewUrls[idx]} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: 10, color: "var(--muted)", padding: 4, textAlign: "center", wordBreak: "break-all" }}>{f.name.slice(0, 14)}</span>
                    )}
                    <button onClick={() => removePending(idx)} style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)", color: "#fff", border: 0, cursor: "pointer", fontSize: 11 }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ width: 38, height: 38, display: "grid", placeItems: "center", border: "1px solid var(--border)", background: "var(--panel-2)", cursor: "pointer", flexShrink: 0 }}
                aria-label="Ajouter fichiers"
              >
                +
              </button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => handleFilesSelected(e.target.files)} />

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Votre message…"
                rows={1}
                style={{
                  flex: 1,
                  minHeight: 38,
                  maxHeight: 140,
                  resize: "none",
                  background: "#0D141E",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--foreground)",
                  padding: "9px 12px",
                  fontSize: 14,
                  lineHeight: 1.5,
                  outline: "none",
                  overflow: "auto",
                }}
              />

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)", flexShrink: 0, cursor: "pointer" }}>
                <button
                  type="button"
                  className={`switch ${thinkingEnabled ? "on" : ""}`}
                  onClick={() => setThinkingEnabled((v) => !v)}
                  aria-pressed={thinkingEnabled}
                  style={{ width: 36, height: 22 }}
                >
                  <i style={{ width: 14, height: 14 }} />
                </button>
                Thinking
              </label>

              {chatStreaming ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  style={{ width: 44, height: 38, display: "grid", placeItems: "center", background: "#E5484D", color: "#fff", border: 0, cursor: "pointer", flexShrink: 0, borderRadius: 8 }}
                  aria-label="Arrêter la génération"
                  title="Arrêter la génération"
                >
                  <span style={{ display: "block", width: 12, height: 12, background: "#fff" }} />
                </button>
              ) : (
                <button className="primary" onClick={handleSend} disabled={!input.trim() && pendingFiles.length === 0} style={{ height: 38, padding: "0 16px", borderRadius: 8 }}>
                  Envoyer
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function conversationIdFor(m: ChatMessage) {
  return m.conversationId
}
