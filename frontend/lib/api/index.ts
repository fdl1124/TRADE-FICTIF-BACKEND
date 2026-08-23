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
