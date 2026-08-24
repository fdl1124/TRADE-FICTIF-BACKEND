"use client"

import { create } from "zustand"
import {
  assets as mockAssets,
  decisions as mockDecisions,
  orders as mockOrders,
  positions as mockPositions,
  prices as mockPrices,
} from "@/lib/mock-api"
import type {
  Account,
  AccountSummary,
  AiAgentConfig,
  AiDecision,
  Asset,
  Order,
  Position,
  PriceTick,
  User,
} from "@/lib/types"
import type { View } from "@/lib/trading"
import type { ChatMessage, Conversation } from "@/lib/api"

export type PriceState = "connecting" | "live" | "reconnecting" | "closed"

export type ToastTone = "success" | "error" | "info"

export interface Toast {
  id: string
  message: string
  tone: ToastTone
}

export interface Notification {
  id: string
  title: string
  body: string
  read: boolean
  createdAt: string
}

export interface TradingData {
  account: Account | null
  summary: AccountSummary | null
  assets: Asset[]
  prices: Record<string, { price: number; change: number }>
  positions: Position[]
  orders: Order[]
  decisions: AiDecision[]
  aiConfig: AiAgentConfig | null
}

const MOCK = process.env.NEXT_PUBLIC_USE_MOCK_API !== "false"

const mockData: TradingData = {
  account: { id: "acc_01", userId: "demo_user", balance: 7824.16, startingBalance: 10000, createdAt: "2026-06-04T10:00:00Z" },
  summary: { balance: 7824.16, totalPositionsValue: 4662.56, totalPnl: 2486.72, totalPnlPercent: 24.87 },
  assets: mockAssets,
  prices: mockPrices,
  positions: mockPositions,
  orders: mockOrders,
  decisions: mockDecisions,
  aiConfig: {
    accountId: "acc_01",
    enabled: true,
    mode: "propose",
    watchedSymbols: ["AAPL", "BTCUSDT", "MSFT"],
    maxPositionSizePercent: 2,
    dailyLossLimitPercent: 3,
    circuitBreakerActive: false,
    circuitBreakerReason: null,
  },
}

const emptyData: TradingData = {
  account: null,
  summary: null,
  assets: [],
  prices: {},
  positions: [],
  orders: [],
  decisions: [],
  aiConfig: null,
}

interface State extends TradingData {
  view: View
  selectedSymbol: string
  search: string
  assetType: "all" | "stock" | "crypto"
  selectedDecision: string | null
  watchlist: string[]
  user: User | null
  authReady: boolean
  priceState: PriceState
  toasts: Toast[]
  notifications: Notification[]
  chatConversations: Conversation[]
  chatMessages: Record<string, ChatMessage[]>
  selectedChatId: string | null
  chatStreaming: boolean
  setView: (view: View) => void
  selectAsset: (symbol: string) => void
  setSearch: (search: string) => void
  setAssetType: (assetType: "all" | "stock" | "crypto") => void
  selectDecision: (id: string | null) => void
  toggleWatch: (symbol: string) => void
  setData: (patch: Partial<TradingData>) => void
  applyTick: (tick: PriceTick) => void
  setUser: (user: User | null) => void
  setAuthReady: (ready: boolean) => void
  setPriceState: (state: PriceState) => void
  pushToast: (message: string, tone: ToastTone) => void
  dismissToast: (id: string) => void
  pushNotification: (title: string, body: string) => void
  markAllRead: () => void
  setChatConversations: (conversations: Conversation[]) => void
  setChatMessages: (conversationId: string, messages: ChatMessage[]) => void
  setSelectedChatId: (id: string | null) => void
  setChatStreaming: (streaming: boolean) => void
}

export const useTrading = create<State>((set) => ({
  ...(MOCK ? mockData : emptyData),
  view: "dashboard",
  selectedSymbol: MOCK ? "AAPL" : "",
  search: "",
  assetType: "all",
  selectedDecision: null,
  watchlist: ["AAPL", "BTCUSDT", "MSFT"],
  user: MOCK
    ? { id: "demo_user", email: "marc.l@example.com", displayName: "Marc L.", createdAt: "2026-06-04T10:00:00Z" }
    : null,
  authReady: MOCK,
  priceState: "connecting",
  toasts: [],
  notifications: [],
  chatConversations: [],
  chatMessages: {},
  selectedChatId: null,
  chatStreaming: false,
  setView: (view) => set({ view }),
  selectAsset: (selectedSymbol) => set({ selectedSymbol, view: "market" }),
  setSearch: (search) => set({ search }),
  setAssetType: (assetType) => set({ assetType }),
  selectDecision: (selectedDecision) => set({ selectedDecision }),
  toggleWatch: (symbol) =>
    set((state) => ({
      watchlist: state.watchlist.includes(symbol)
        ? state.watchlist.filter((s) => s !== symbol)
        : [...state.watchlist, symbol],
    })),
  setData: (patch) => set(patch),
  applyTick: (tick) =>
    set((state) => ({
      prices: { ...state.prices, [tick.symbol]: { price: tick.price, change: tick.change24h } },
    })),
  setUser: (user) => set({ user }),
  setAuthReady: (authReady) => set({ authReady }),
  setPriceState: (priceState) => set({ priceState }),
  pushToast: (message, tone) =>
    set((state) => ({
      toasts: [...state.toasts, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, message, tone }],
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  pushNotification: (title, body) =>
    set((state) => ({
      notifications: [
        { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, title, body, read: false, createdAt: new Date().toISOString() },
        ...state.notifications,
      ],
    })),
  markAllRead: () => set((state) => ({ notifications: state.notifications.map((n) => ({ ...n, read: true })) })),
  setChatConversations: (chatConversations) => set({ chatConversations }),
  setChatMessages: (conversationId, messages) =>
    set((state) => ({ chatMessages: { ...state.chatMessages, [conversationId]: messages } })),
  setSelectedChatId: (selectedChatId) => set({ selectedChatId }),
  setChatStreaming: (chatStreaming) => set({ chatStreaming }),
}))

export const isMockMode = MOCK
