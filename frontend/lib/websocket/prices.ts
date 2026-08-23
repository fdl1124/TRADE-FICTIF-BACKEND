import type { PriceTick } from "@/lib/types"
import { priceTickSchema } from "@/lib/validation"
import { prices } from "@/lib/mock-api"

export type PriceConnectionState = "connecting" | "live" | "reconnecting" | "closed"
export interface PriceClient {
  subscribe(symbols: string[]): void
  unsubscribe(symbols: string[]): void
  close(): void
}

export function createPriceClient(onTick: (tick: PriceTick) => void, onState: (state: PriceConnectionState) => void): PriceClient {
  const mock = process.env.NEXT_PUBLIC_USE_MOCK_API !== "false"
  if (!mock) {
    let symbols: string[] = []
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket
    const connect = () => {
      onState("connecting")
      ws = new WebSocket(`${process.env.NEXT_PUBLIC_WS_URL ?? ""}/ws/prices`)
      ws.onopen = () => {
        onState("live")
        ws.send(JSON.stringify({ action: "subscribe", symbols }))
      }
      ws.onmessage = (e) => onTick(priceTickSchema.parse(JSON.parse(String(e.data))))
      ws.onclose = () => {
        onState("reconnecting")
        reconnectTimer = setTimeout(connect, 1500)
      }
    }
    connect()
    return {
      subscribe(next) {
        symbols = [...new Set([...symbols, ...next])]
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "subscribe", symbols: next }))
      },
      unsubscribe(next) {
        symbols = symbols.filter((s) => !next.includes(s))
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "unsubscribe", symbols: next }))
      },
      close() {
        if (reconnectTimer) clearTimeout(reconnectTimer)
        ws.onclose = null
        ws.close()
        onState("closed")
      },
    }
  }
  const subscribed = new Set<string>()
  onState("connecting")
  const ready = setTimeout(() => onState("live"), 250)
  const interval = setInterval(() => {
    for (const symbol of subscribed) {
      const base = prices[symbol]
      if (!base) continue
      base.price *= 1 + (Math.random() - 0.5) * 0.00045
      onTick(priceTickSchema.parse({ symbol, price: base.price, timestamp: new Date().toISOString(), change24h: base.change }))
    }
  }, 1500)
  return {
    subscribe(symbols) {
      symbols.forEach((s) => subscribed.add(s))
    },
    unsubscribe(symbols) {
      symbols.forEach((s) => subscribed.delete(s))
    },
    close() {
      clearTimeout(ready)
      clearInterval(interval)
      onState("closed")
    },
  }
}
