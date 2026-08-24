"use client"

import { useEffect, useRef, useState } from "react"
import { CandlestickSeries, ColorType, createChart } from "lightweight-charts"
import type { Time } from "lightweight-charts"
import { getCandles } from "@/lib/api"
import type { HistoryRange } from "@/lib/types"
import { useTrading } from "@/store/use-trading"

type CandlePoint = { time: Time; open: number; high: number; low: number; close: number }

export function PriceChart({ symbol, range }: { symbol: string; range: HistoryRange }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const dataRef = useRef<CandlePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const tick = useTrading((s) => s.prices[symbol])

  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false
    setLoading(true)
    setError(false)
    setEmpty(false)
    const container = containerRef.current
    const chart = createChart(container, {
      height: 310,
      autoSize: false,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8C9AAD", fontFamily: "Geist Mono" },
      grid: { vertLines: { color: "#202B3A" }, horzLines: { color: "#202B3A" } },
      rightPriceScale: { borderColor: "#2A3748" },
      timeScale: { borderColor: "#2A3748", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      handleScroll: true,
      handleScale: true,
    })
    chartRef.current = chart
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#42C98A",
      downColor: "#F06D72",
      borderVisible: false,
      wickUpColor: "#42C98A",
      wickDownColor: "#F06D72",
    })
    seriesRef.current = series as unknown as ReturnType<ReturnType<typeof createChart>["addSeries"]>
    dataRef.current = []
    const resize = new ResizeObserver(() => {
      if (!container) return
      chart.applyOptions({ width: container.clientWidth })
    })
    resize.observe(container)
    chart.applyOptions({ width: container.clientWidth })

    getCandles(symbol, range)
      .then((candles) => {
        if (disposed) return
        if (!candles || candles.length === 0) {
          setEmpty(true)
          setLoading(false)
          return
        }
        const points: CandlePoint[] = candles
          .map((c) => ({
            time: Math.floor(new Date(c.time).getTime() / 1000) as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
          .sort((a, b) => (a.time as number) - (b.time as number))
        const deduped: CandlePoint[] = []
        for (const p of points) {
          const last = deduped[deduped.length - 1]
          if (last && last.time === p.time) deduped[deduped.length - 1] = p
          else deduped.push(p)
        }
        dataRef.current = deduped
        setEmpty(deduped.length === 0)
        if (deduped.length > 0) {
          series.setData(deduped as unknown as never)
          chart.timeScale().fitContent()
        }
        setLoading(false)
      })
      .catch(() => {
        if (disposed) return
        setError(true)
        setLoading(false)
      })

    return () => {
      disposed = true
      resize.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [symbol, range, reloadKey])

  useEffect(() => {
    if (!tick || typeof tick.price !== "number") return
    const series = seriesRef.current
    const data = dataRef.current
    if (!series || !data || data.length === 0) return
    const last = data[data.length - 1]
    const price = tick.price
    const next: CandlePoint = {
      time: last.time,
      open: last.open,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    }
    data[data.length - 1] = next
    ;(series as unknown as { update: (d: CandlePoint) => void }).update(next)
  }, [tick])

  return (
    <div className="w-full" aria-label="Graphique de prix de l'actif">
      {loading && (
        <div className="flex flex-col gap-3 py-4">
          <div className="skeleton skeleton-card w-full" />
          <div className="skeleton skeleton-line w-3/4" />
          <div className="skeleton skeleton-line w-1/2" />
        </div>
      )}
      {!loading && error && (
        <div className="empty">
          <p>Erreur lors du chargement de l&apos;historique.</p>
          <button className="primary" onClick={() => setReloadKey((k) => k + 1)}>
            Réessayer
          </button>
        </div>
      )}
      {!loading && !error && empty && (
        <div className="empty">
          <p>Historique indisponible</p>
          <button className="primary" onClick={() => setReloadKey((k) => k + 1)}>
            Réessayer
          </button>
        </div>
      )}
      <div ref={containerRef} className="w-full" style={{ display: loading || error || empty ? "none" : "block" }} />
    </div>
  )
}
