"use client"

import { useEffect, useRef, useState } from "react"
import { AreaSeries, ColorType, createChart } from "lightweight-charts"
import { getAssetHistory } from "@/lib/api"
import type { HistoryRange } from "@/lib/types"

export function PriceChart({ symbol, range }: { symbol: string; range: HistoryRange }) {
  const ref = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    let disposed = false
    const container = ref.current
    const chart = createChart(container, {
      height: 310,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8C9AAD", fontFamily: "Geist Mono" },
      grid: { vertLines: { color: "#202B3A" }, horzLines: { color: "#202B3A" } },
      rightPriceScale: { borderColor: "#2A3748" },
      timeScale: { borderColor: "#2A3748" },
    })
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#38BDF8",
      topColor: "rgba(56,189,248,0.28)",
      bottomColor: "rgba(56,189,248,0.02)",
      lineWidth: 2,
      priceLineColor: "#38BDF8",
    })
    const resize = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }))
    resize.observe(container)

    getAssetHistory(symbol, range)
      .then((ticks) => {
        if (disposed) return
        const points = ticks
          .map((tick) => ({ time: Math.floor(new Date(tick.timestamp).getTime() / 1000) as never, value: tick.price }))
          .sort((a, b) => (a.time as number) - (b.time as number))
        setEmpty(points.length === 0)
        if (points.length > 0) {
          series.setData(points)
          chart.timeScale().fitContent()
        }
      })
      .catch(() => {
        if (!disposed) setEmpty(true)
      })

    return () => {
      disposed = true
      resize.disconnect()
      chart.remove()
    }
  }, [symbol, range])

  return (
    <div className="w-full" aria-label="Graphique de prix de l'actif">
      {empty && <p className="empty">Historique indisponible pour cet actif.</p>}
      <div ref={ref} className="w-full" />
    </div>
  )
}
