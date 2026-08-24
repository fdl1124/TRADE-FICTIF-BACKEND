import { getIdToken } from "@/lib/auth/client"
import { assets, decisions, orders as seedOrders, positions, prices } from "@/lib/mock-api"
import type {
  Account,
  AccountSummary,
  AiAgentConfig,
  AiDecision,
  Asset,
  CreateOrderInput,
  HistoryRange,
  Order,
  OrderStatus,
  Position,
  PriceTick,
} from "@/lib/types"
import {
  accountSchema,
  accountSummarySchema,
  aiConfigSchema,
  aiDecisionSchema,
  assetSchema,
  createOrderSchema,
  orderSchema,
  positionSchema,
  priceTickSchema,
} from "@/lib/validation"
import { TradingApiError } from "./errors"

export interface UpdateAiConfigInput {
  enabled?: boolean
  mode?: "propose" | "autonomous"
  watchedSymbols?: string[]
  maxPositionSizePercent?: number
  dailyLossLimitPercent?: number
  resetCircuitBreaker?: boolean
}

export interface AiDecisionRaw {
  id: string
  context: unknown
  rawResponse: unknown
  createdAt: string
}

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface AgentInstance {
  id: string
  accountId: string
  name: string
  profile: "technical" | "news" | "risk" | "custom"
  instructions: string | null
  thinkingLevel: "low" | "medium" | "high"
  watchedSymbols: string[]
  maxPositionSizePercent: number
  dailyLossLimitPercent: number
  enabled: boolean
  mode: "propose" | "autonomous"
  circuitBreakerActive: boolean
  circuitBreakerReason: string | null
}

export interface CreateAgentInput {
  name?: string
  profile?: "technical" | "news" | "risk" | "custom"
  instructions?: string
  thinkingLevel?: "low" | "medium" | "high"
  watchedSymbols?: string[]
  maxPositionSizePercent?: number
  dailyLossLimitPercent?: number
  enabled?: boolean
  mode?: "propose" | "autonomous"
}

export interface UpdateAgentInput extends CreateAgentInput {
  resetCircuitBreaker?: boolean
}

export interface Conversation {
  id: string
  accountId: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface OrderProposal {
  symbol: string
  side: "buy" | "sell"
  quantity: number
  type: "market" | "limit"
  limitPrice: number | null
  rationale: string | null
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: "user" | "assistant"
  content: string
  attachments: Array<{ name: string; mimeType: string }>
  toolSteps: Array<{ name: string; summary: string }>
  thinking: string
  sources: string[]
  orderProposal: OrderProposal | null
  createdAt: string
}

export interface ChatAttachmentInput {
  name: string
  mimeType: string
  dataBase64: string
}

export interface SendMessageInput {
  content: string
  attachments?: ChatAttachmentInput[]
  thinkingEnabled?: boolean
}

export interface ChatStreamCallbacks {
  onDelta?: (text: string) => void
  onThinkingDelta?: (text: string) => void
  onStatus?: (label: string) => void
  onToolDone?: (name: string) => void
  onDone?: (data: { messageId: string; orderProposal: OrderProposal | null; sources: string[] }) => void
  onError?: (message: string) => void
  onUserSaved?: (data: { messageId: string }) => void
}

const MOCK = process.env.NEXT_PUBLIC_USE_MOCK_API !== "false"
const API = process.env.NEXT_PUBLIC_API_URL ?? ""
const sleep = () => new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 300))

let mockOrders: Order[] = [...seedOrders]
const mockConfig: AiAgentConfig = {
  accountId: "acc_01",
  enabled: true,
  mode: "propose",
  watchedSymbols: ["AAPL", "BTCUSDT", "MSFT"],
  maxPositionSizePercent: 2,
  dailyLossLimitPercent: 3,
  circuitBreakerActive: false,
  circuitBreakerReason: null,
}

let mockAgents: AgentInstance[] = [
  {
    id: "agent_01",
    accountId: "acc_01",
    name: "Agent technique",
    profile: "technical",
    instructions: null,
    thinkingLevel: "medium",
    watchedSymbols: ["AAPL", "BTCUSDT"],
    maxPositionSizePercent: 2,
    dailyLossLimitPercent: 3,
    enabled: true,
    mode: "propose",
    circuitBreakerActive: false,
    circuitBreakerReason: null,
  },
]

let mockConversations: Conversation[] = [
  {
    id: "conv_01",
    accountId: "acc_01",
    title: "Nouvelle conversation",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

let mockMessages: Record<string, ChatMessage[]> = {
  conv_01: [],
}

function validateAttachments(attachments: ChatAttachmentInput[]) {
  if (attachments.length > 10) {
    throw new TradingApiError("VALIDATION_ERROR", "10 fichiers maximum autorisés")
  }
  for (const file of attachments) {
    const isImage = file.mimeType.startsWith("image/")
    const isPdf = file.mimeType === "application/pdf"
    if (!isImage && !isPdf) {
      throw new TradingApiError("VALIDATION_ERROR", `Type de fichier non autorisé: ${file.mimeType}`)
    }
  }
  const totalBytes = attachments.reduce((sum, a) => sum + Math.ceil((a.dataBase64.length * 3) / 4), 0)
  if (totalBytes > 15 * 1024 * 1024) {
    throw new TradingApiError("VALIDATION_ERROR", "Le total des fichiers dépasse 15 Mo")
  }
}

async function request<T>(path: string, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  const token = await getIdToken()
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const value = payload as { error?: string; message?: string; details?: unknown }
    throw new TradingApiError(value.error ?? "UNKNOWN", value.message ?? "Erreur API", value.details)
  }
  return parse(payload)
}

const tick = (symbol: string): PriceTick =>
  priceTickSchema.parse({
    symbol,
    price: prices[symbol]?.price ?? 0,
    timestamp: new Date().toISOString(),
    change24h: prices[symbol]?.change ?? 0,
  })

export async function getAccount(): Promise<Account> {
  if (!MOCK) return request("/api/account", undefined, (v) => accountSchema.parse(v))
  await sleep()
  return accountSchema.parse({ id: "acc_01", userId: "demo_user", balance: 7824.16, startingBalance: 10000, createdAt: "2026-06-04T10:00:00Z" })
}

export async function getAccountSummary(): Promise<AccountSummary> {
  if (!MOCK) return request("/api/account/summary", undefined, (v) => accountSummarySchema.parse(v))
  await sleep()
  return accountSummarySchema.parse({ balance: 7824.16, totalPositionsValue: 4662.56, totalPnl: 2486.72, totalPnlPercent: 24.87 })
}

export async function getAssets(): Promise<Asset[]> {
  if (!MOCK) return request("/api/assets", undefined, (v) => assetSchema.array().parse(v))
  await sleep()
  return assetSchema.array().parse(assets)
}

export async function getAssetPrice(symbol: string): Promise<PriceTick> {
  if (!MOCK) return request(`/api/assets/${encodeURIComponent(symbol)}/price`, undefined, (v) => priceTickSchema.parse(v))
  await sleep()
  if (!prices[symbol]) throw new TradingApiError("INVALID_SYMBOL", "Symbole inconnu")
  return tick(symbol)
}

export async function getAssetHistory(symbol: string, range: HistoryRange): Promise<PriceTick[]> {
  if (!MOCK) return request(`/api/assets/${encodeURIComponent(symbol)}/history?range=${range}`, undefined, (v) => priceTickSchema.array().parse(v))
  await sleep()
  const current = await getAssetPrice(symbol)
  const count = range === "1d" ? 36 : range === "1w" ? 56 : 72
  return priceTickSchema.array().parse(
    Array.from({ length: count }, (_, i) => ({
      ...current,
      price: current.price * (1 + Math.sin(i * 0.63) * 0.014 + ((i - count) / count) * 0.035),
      timestamp: new Date(Date.now() - (count - i) * 3600000).toISOString(),
    })),
  )
}

export async function getCandles(symbol: string, range: HistoryRange): Promise<Candle[]> {
  if (!MOCK)
    return request(`/api/assets/${encodeURIComponent(symbol)}/candles?range=${range}`, undefined, (v) => v as Candle[])
  await sleep()
  if (!prices[symbol]) throw new TradingApiError("INVALID_SYMBOL", "Symbole inconnu")
  const base = prices[symbol].price
  const count = range === "1d" ? 48 : range === "1w" ? 56 : 72
  const intervalMs = range === "1d" ? 30 * 60 * 1000 : range === "1w" ? 3 * 60 * 60 * 1000 : 4 * 60 * 60 * 1000
  return Array.from({ length: count }, (_, i) => {
    const drift = Math.sin(i * 0.52) * 0.015 + ((i - count) / count) * 0.02
    const close = base * (1 + drift)
    const spread = base * 0.008
    const open = close * (1 + (Math.random() - 0.5) * 0.004)
    const high = Math.max(open, close) + Math.random() * spread * 0.5
    const low = Math.min(open, close) - Math.random() * spread * 0.5
    return {
      time: new Date(Date.now() - (count - i) * intervalMs).toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.round(800 + Math.random() * 4000),
    }
  })
}

export async function getPositions(): Promise<Position[]> {
  if (!MOCK) return request("/api/positions", undefined, (v) => positionSchema.array().parse(v))
  await sleep()
  return positionSchema.array().parse(positions)
}

export async function getPosition(id: string): Promise<Position> {
  if (!MOCK) return request(`/api/positions/${id}`, undefined, (v) => positionSchema.parse(v))
  await sleep()
  const found = positions.find((p) => p.id === id)
  if (!found) throw new TradingApiError("INVALID_SYMBOL", "Position introuvable")
  return positionSchema.parse(found)
}

export async function patchPosition(id: string, input: { stopLoss?: number | null; takeProfit?: number | null }): Promise<Position> {
  if (!MOCK) return request(`/api/positions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }, (v) => positionSchema.parse(v))
  await sleep()
  const idx = positions.findIndex((p) => p.id === id)
  if (idx === -1) throw new TradingApiError("INVALID_SYMBOL", "Position introuvable")
  const updated = {
    ...positions[idx],
    stopLoss: input.stopLoss !== undefined ? input.stopLoss : positions[idx].stopLoss,
    takeProfit: input.takeProfit !== undefined ? input.takeProfit : positions[idx].takeProfit,
  }
  return positionSchema.parse(updated)
}

export async function postOrder(input: CreateOrderInput): Promise<Order> {
  const valid = createOrderSchema.parse(input)
  if (!MOCK) return request("/api/orders", { method: "POST", body: JSON.stringify(valid) }, (v) => orderSchema.parse(v))
  await sleep()
  if (!prices[valid.symbol]) throw new TradingApiError("INVALID_SYMBOL", "Symbole inconnu")
  const requestedPrice = prices[valid.symbol].price
  const orderValue = requestedPrice * valid.quantity
  if (orderValue > 7824.16) throw new TradingApiError("INSUFFICIENT_BALANCE", "Solde insuffisant")
  const slippage = valid.type === "market" ? 0.08 : null
  const filledPrice = valid.type === "market" ? requestedPrice * (valid.side === "buy" ? 1.0008 : 0.9992) : null
  const order = orderSchema.parse({
    id: `ord_${Date.now()}`,
    accountId: "acc_01",
    ...valid,
    limitPrice: valid.limitPrice ?? null,
    stopLoss: valid.stopLoss ?? null,
    takeProfit: valid.takeProfit ?? null,
    requestedPrice,
    filledPrice,
    slippage,
    status: valid.type === "market" ? "filled" : "pending",
    source: "manual",
    rejectionReason: null,
    createdAt: new Date().toISOString(),
    filledAt: filledPrice ? new Date().toISOString() : null,
  })
  mockOrders = [order, ...mockOrders]
  return order
}

export async function getOrders(filters: { status?: OrderStatus; limit?: number } = {}): Promise<Order[]> {
  const query = new URLSearchParams()
  if (filters.status) query.set("status", filters.status)
  if (filters.limit) query.set("limit", String(filters.limit))
  if (!MOCK) return request(`/api/orders?${query}`, undefined, (v) => orderSchema.array().parse(v))
  await sleep()
  return orderSchema.array().parse(mockOrders.filter((o) => !filters.status || o.status === filters.status).slice(0, filters.limit))
}

export async function cancelOrder(id: string): Promise<Order> {
  if (!MOCK) return request(`/api/orders/${id}`, { method: "DELETE" }, (v) => orderSchema.parse(v))
  await sleep()
  const found = mockOrders.find((o) => o.id === id)
  if (!found || found.status !== "pending") throw new TradingApiError("INVALID_ORDER", "Seul un ordre en attente peut être annulé")
  mockOrders = mockOrders.map((o) => (o.id === id ? { ...o, status: "cancelled" as OrderStatus } : o))
  return mockOrders.find((o) => o.id === id) as Order
}

export async function getAiConfig(): Promise<AiAgentConfig> {
  if (!MOCK) return request("/api/ai/config", undefined, (v) => aiConfigSchema.parse(v))
  await sleep()
  return aiConfigSchema.parse(mockConfig)
}

export async function putAiConfig(input: UpdateAiConfigInput): Promise<AiAgentConfig> {
  if (!MOCK) return request("/api/ai/config", { method: "PUT", body: JSON.stringify(input) }, (v) => aiConfigSchema.parse(v))
  await sleep()
  return aiConfigSchema.parse({ ...mockConfig, ...input })
}

export async function getAiDecisions(limit = 50): Promise<AiDecision[]> {
  if (!MOCK) return request(`/api/ai/decisions?limit=${limit}`, undefined, (v) => aiDecisionSchema.array().parse(v))
  await sleep()
  return aiDecisionSchema.array().parse(decisions.slice(0, limit))
}

export async function getAiDecision(id: string): Promise<AiDecision> {
  if (!MOCK) return request(`/api/ai/decisions/${id}`, undefined, (v) => aiDecisionSchema.parse(v))
  await sleep()
  const found = decisions.find((d) => d.id === id)
  if (!found) throw new TradingApiError("INVALID_DECISION", "Décision introuvable")
  return aiDecisionSchema.parse(found)
}

export async function getAiDecisionRaw(id: string): Promise<AiDecisionRaw> {
  if (!MOCK) {
    return request(`/api/ai/decisions/${id}/raw`, undefined, (v) => {
      const value = v as { id?: unknown; createdAt?: unknown; context?: unknown; rawResponse?: unknown }
      if (typeof value.id !== "string" || typeof value.createdAt !== "string") {
        throw new TradingApiError("UNKNOWN", "Réponse brute invalide")
      }
      return { id: value.id, createdAt: value.createdAt, context: value.context, rawResponse: value.rawResponse }
    })
  }
  const decision = await getAiDecision(id)
  return { id: decision.id, createdAt: decision.createdAt, context: { mode: "demo" }, rawResponse: { mode: "demo" } }
}

export async function approveAiDecision(id: string): Promise<AiDecision> {
  if (!MOCK) return request(`/api/ai/decisions/${id}/approve`, { method: "POST" }, (v) => aiDecisionSchema.parse(v))
  const decision = await getAiDecision(id)
  if (!decision.validationPassed || !decision.proposedQuantity) {
    throw new TradingApiError("POSITION_SIZE_EXCEEDED", "Décision non exécutable")
  }
  return decision
}

export async function rejectAiDecision(id: string): Promise<AiDecision> {
  if (!MOCK) return request(`/api/ai/decisions/${id}/reject`, { method: "POST" }, (v) => aiDecisionSchema.parse(v))
  await getAiDecision(id)
  const found = decisions.find((d) => d.id === id)
  return aiDecisionSchema.parse(found as AiDecision)
}

export async function getAgents(): Promise<AgentInstance[]> {
  if (!MOCK) return request("/api/ai/agents", undefined, (v) => v as AgentInstance[])
  await sleep()
  return [...mockAgents]
}

export async function createAgent(dto: CreateAgentInput): Promise<AgentInstance> {
  if (!MOCK) return request("/api/ai/agents", { method: "POST", body: JSON.stringify(dto) }, (v) => v as AgentInstance)
  await sleep()
  const agent: AgentInstance = {
    id: `agent_${Date.now()}`,
    accountId: "acc_01",
    name: dto.name?.trim() || `Agent ${dto.profile ?? "custom"}`,
    profile: dto.profile ?? "custom",
    instructions: dto.instructions ?? null,
    thinkingLevel: dto.thinkingLevel ?? "medium",
    watchedSymbols: (dto.watchedSymbols ?? []).map((s) => s.toUpperCase()),
    maxPositionSizePercent: dto.maxPositionSizePercent ?? 2,
    dailyLossLimitPercent: dto.dailyLossLimitPercent ?? 3,
    enabled: dto.enabled ?? true,
    mode: dto.mode ?? "propose",
    circuitBreakerActive: false,
    circuitBreakerReason: null,
  }
  mockAgents = [...mockAgents, agent]
  return agent
}

export async function updateAgent(id: string, dto: UpdateAgentInput): Promise<AgentInstance> {
  if (!MOCK) return request(`/api/ai/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(dto) }, (v) => v as AgentInstance)
  await sleep()
  const idx = mockAgents.findIndex((a) => a.id === id)
  if (idx === -1) throw new TradingApiError("INVALID_AGENT", "Agent introuvable")
  const current = mockAgents[idx]
  const updated: AgentInstance = {
    ...current,
    name: dto.name !== undefined ? dto.name.trim() : current.name,
    profile: dto.profile !== undefined ? dto.profile : current.profile,
    instructions: dto.instructions !== undefined ? dto.instructions : current.instructions,
    thinkingLevel: dto.thinkingLevel !== undefined ? dto.thinkingLevel : current.thinkingLevel,
    watchedSymbols: dto.watchedSymbols !== undefined ? dto.watchedSymbols.map((s) => s.toUpperCase()) : current.watchedSymbols,
    maxPositionSizePercent: dto.maxPositionSizePercent ?? current.maxPositionSizePercent,
    dailyLossLimitPercent: dto.dailyLossLimitPercent ?? current.dailyLossLimitPercent,
    enabled: dto.enabled !== undefined ? dto.enabled : current.enabled,
    mode: dto.mode !== undefined ? dto.mode : current.mode,
    circuitBreakerActive: dto.resetCircuitBreaker ? false : current.circuitBreakerActive,
    circuitBreakerReason: dto.resetCircuitBreaker ? null : current.circuitBreakerReason,
  }
  mockAgents = mockAgents.map((a) => (a.id === id ? updated : a))
  return updated
}

export async function deleteAgent(id: string): Promise<{ deleted: true }> {
  if (!MOCK) return request(`/api/ai/agents/${encodeURIComponent(id)}`, { method: "DELETE" }, (v) => v as { deleted: true })
  await sleep()
  const exists = mockAgents.some((a) => a.id === id)
  if (!exists) throw new TradingApiError("INVALID_AGENT", "Agent introuvable")
  mockAgents = mockAgents.filter((a) => a.id !== id)
  return { deleted: true }
}

export async function runAgent(id: string): Promise<AiDecision[]> {
  if (!MOCK) return request(`/api/ai/agents/${encodeURIComponent(id)}/run`, { method: "POST" }, (v) => aiDecisionSchema.array().parse(v))
  await sleep()
  const agent = mockAgents.find((a) => a.id === id)
  if (!agent) throw new TradingApiError("INVALID_AGENT", "Agent introuvable")
  if (agent.circuitBreakerActive) throw new TradingApiError("DAILY_LOSS_LIMIT_REACHED", "Circuit breaker actif")
  return aiDecisionSchema.array().parse(decisions.slice(0, 2))
}

export async function getConversations(): Promise<Conversation[]> {
  if (!MOCK) return request("/api/chat/conversations", undefined, (v) => v as Conversation[])
  await sleep()
  return [...mockConversations]
}

export async function createConversation(title?: string): Promise<Conversation> {
  if (!MOCK) return request("/api/chat/conversations", { method: "POST", body: JSON.stringify({ title }) }, (v) => v as Conversation)
  await sleep()
  const now = new Date().toISOString()
  const conv: Conversation = {
    id: `conv_${Date.now()}`,
    accountId: "acc_01",
    title: title?.trim() || "Nouvelle conversation",
    createdAt: now,
    updatedAt: now,
  }
  mockConversations = [conv, ...mockConversations]
  mockMessages[conv.id] = []
  return conv
}

export async function deleteConversation(id: string): Promise<{ deleted: true }> {
  if (!MOCK) return request(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }, (v) => v as { deleted: true })
  await sleep()
  mockConversations = mockConversations.filter((c) => c.id !== id)
  delete mockMessages[id]
  return { deleted: true }
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  if (!MOCK) return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, undefined, (v) => v as ChatMessage[])
  await sleep()
  return [...(mockMessages[conversationId] ?? [])]
}

export async function sendMessageStream(
  conversationId: string,
  input: SendMessageInput,
  callbacks: ChatStreamCallbacks,
): Promise<void> {
  const attachments = input.attachments ?? []
  validateAttachments(attachments)
  if (MOCK) {
    await sleep()
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      conversationId,
      role: "user",
      content: input.content,
      attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType })),
      toolSteps: [],
      thinking: "",
      sources: [],
      orderProposal: null,
      createdAt: new Date().toISOString(),
    }
    const list = mockMessages[conversationId] ?? []
    mockMessages[conversationId] = [...list, userMsg]
    callbacks.onUserSaved?.({ messageId: userMsg.id })
    const fullText = `Réponse simulée pour : ${input.content.slice(0, 120)}`
    const chunks = fullText.match(/.{1,18}/g) ?? [fullText]
    for (const chunk of chunks) {
      await new Promise((r) => setTimeout(r, 40))
      callbacks.onDelta?.(chunk)
    }
    if (input.thinkingEnabled) {
      callbacks.onThinkingDelta?.("Réflexion simulée en mode MOCK.")
    }
    callbacks.onStatus?.("done")
    const assistantMsg: ChatMessage = {
      id: `msg_${Date.now() + 1}`,
      conversationId,
      role: "assistant",
      content: fullText,
      attachments: [],
      toolSteps: [],
      thinking: input.thinkingEnabled ? "Réflexion simulée en mode MOCK." : "",
      sources: [],
      orderProposal: null,
      createdAt: new Date().toISOString(),
    }
    mockMessages[conversationId] = [...(mockMessages[conversationId] ?? []), assistantMsg]
    const convIdx = mockConversations.findIndex((c) => c.id === conversationId)
    if (convIdx !== -1) {
      mockConversations[convIdx] = { ...mockConversations[convIdx], updatedAt: new Date().toISOString() }
    }
    callbacks.onDone?.({ messageId: assistantMsg.id, orderProposal: null, sources: [] })
    return
  }
  const token = await getIdToken()
  const response = await fetch(`${API}/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      content: input.content,
      attachments,
      thinkingEnabled: input.thinkingEnabled ?? false,
    }),
  })
  if (!response.ok || !response.body) {
    let message = "Erreur API"
    try {
      const payload = (await response.json()) as { message?: string }
      message = payload.message ?? message
    } catch {}
    callbacks.onError?.(message)
    throw new TradingApiError("UNKNOWN", message)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""
  const dispatch = (eventName: string, rawData: string) => {
    let data: unknown = null
    try {
      data = rawData ? JSON.parse(rawData) : null
    } catch {
      data = rawData
    }
    const obj = (data ?? {}) as Record<string, unknown>
    switch (eventName) {
      case "delta": {
        const text = typeof obj.text === "string" ? obj.text : typeof data === "string" ? data : ""
        if (text) callbacks.onDelta?.(text)
        break
      }
      case "thinking_delta": {
        const text = typeof obj.text === "string" ? obj.text : typeof data === "string" ? data : ""
        if (text) callbacks.onThinkingDelta?.(text)
        break
      }
      case "status": {
        const label = typeof obj.label === "string" ? obj.label : String(data ?? "")
        callbacks.onStatus?.(label)
        break
      }
      case "tool_done": {
        const name = typeof obj.name === "string" ? obj.name : String(data ?? "")
        callbacks.onToolDone?.(name)
        break
      }
      case "done": {
        callbacks.onDone?.({
          messageId: typeof obj.messageId === "string" ? obj.messageId : "",
          orderProposal: (obj.orderProposal as OrderProposal | null) ?? null,
          sources: Array.isArray(obj.sources) ? (obj.sources as string[]) : [],
        })
        break
      }
      case "error": {
        const msg = typeof obj.message === "string" ? obj.message : "Erreur inconnue"
        callbacks.onError?.(msg)
        break
      }
      case "user_saved": {
        const mid = typeof obj.messageId === "string" ? obj.messageId : ""
        callbacks.onUserSaved?.({ messageId: mid })
        break
      }
      default:
        break
    }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        const raw = line.slice(5).trim()
        dispatch(currentEvent, raw)
        currentEvent = ""
      } else if (line.trim() === "") {
        currentEvent = ""
      }
    }
  }
  if (buffer.startsWith("data:") && currentEvent) {
    dispatch(currentEvent, buffer.slice(5).trim())
  }
}
