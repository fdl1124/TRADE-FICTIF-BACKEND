"use client"

import { useEffect, useRef, useState } from "react"
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart } from "lightweight-charts"
import type { IChartApi, ISeriesApi, Time, UTCTimestamp } from "lightweight-charts"
import { getCandles } from "@/lib/api"
import type { Candle, HistoryRange } from "@/lib/types"
import { useTrading } from "@/store/use-trading"

type CandlePoint = { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume: number | null }

const BUCKET_SECONDS: Record<HistoryRange, number> = { "1d": 300, "1w": 3600, "1m": 14400 }

function pricePrecision(price: number): number {
  if (price >= 1000) return 2
  if (price >= 10) return 3
  if (price >= 1) return 4
  return 6
}

export function PriceChart({ symbol, range }: { symbol: string; range: HistoryRange }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null)
  const dataRef = useRef<CandlePoint[]>([])
  const [candles, setCandles] = useState<Candle[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [hover, setHover] = useState<CandlePoint | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number>(0)
  const tick = useTrading((s) => s.prices[symbol])

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(false)
    setCandles(null)
    getCandles(symbol, range)
      .then((data) => {
        if (disposed) return
        setCandles(data && data.length > 0 ? data : [])
        setLoading(false)
      })
      .catch(() => {
        if (disposed) return
        setError(true)
        setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [symbol, range, reloadKey])

  useEffect(() => {
    if (!candles || candles.length === 0 || !containerRef.current) return
    const container = containerRef.current
    container.innerHTML = ""

    const chart = createChart(container, {
      height: 420,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8C9AAD",
        fontFamily: "Geist Mono",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(32,43,58,0.55)" },
        horzLines: { color: "rgba(32,43,58,0.55)" },
      },
      rightPriceScale: { borderColor: "#2A3748", scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: {
        borderColor: "#2A3748",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 7,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#39C6D4", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1B2534" },
        horzLine: { color: "#39C6D4", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1B2534" },
      },
      handleScroll: true,
      handleScale: { axisPressedMouseMove: { time: true, price: false }, mouseWheel: false, pinch: true },
      localization: {
        priceFormatter: (price: number) => price.toFixed(pricePrecision(price)),
      },
    })
    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#42C98A",
      downColor: "#F06D72",
      borderVisible: false,
      wickUpColor: "#42C98A",
      wickDownColor: "#F06D72",
    })
    candleRef.current = candleSeries

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "rgba(57,198,212,0.35)",
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
    volumeRef.current = volumeSeries

    const points: CandlePoint[] = candles
      .map((c) => ({
        time: Math.floor(new Date(c.time).getTime() / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))
      .sort((a, b) => a.time - b.time)
    const deduped: CandlePoint[] = []
    for (const p of points) {
      const lastP = deduped[deduped.length - 1]
      if (lastP && lastP.time === p.time) deduped[deduped.length - 1] = p
      else deduped.push(p)
    }
    dataRef.current = deduped

    candleSeries.setData(
      deduped.map((p) => ({ time: p.time, open: p.open, high: p.high, low: p.low, close: p.close })),
    )
    volumeSeries.setData(
      deduped.map((p) => ({
        time: p.time,
        value: p.volume ?? 0,
        color: p.close >= p.open ? "rgba(66,201,138,0.35)" : "rgba(240,109,114,0.35)",
      })),
    )
    const lastPrice = deduped[deduped.length - 1].close
    candleSeries.applyOptions({
      priceFormat: {
        type: "price",
        precision: pricePrecision(lastPrice),
        minMove: 1 / 10 ** pricePrecision(lastPrice),
      },
    })
    chart.timeScale().fitContent()

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setHover(null)
        return
      }
      const point = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined
      if (!point) {
        setHover(null)
        return
      }
      const volPoint = param.seriesData.get(volumeSeries) as { value?: number } | undefined
      setHover({
        time: param.time as UTCTimestamp,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        volume: volPoint?.value ?? null,
      })
    })

    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
    }
  }, [candles])

  useEffect(() => {
    if (!tick || typeof tick.price !== "number") return
    const series = candleRef.current
    const volumeSeries = volumeRef.current
    const chart = chartRef.current
    const data = dataRef.current
    if (!series || !volumeSeries || !chart || !data || data.length === 0) return
    const last = data[data.length - 1]
    const price = tick.price
    const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS[range]) * BUCKET_SECONDS[range]
    const current = last.time === bucket ? last : null
    const next: CandlePoint = current
      ? {
          time: bucket as UTCTimestamp,
          open: current.open,
          high: Math.max(current.high, price),
          low: Math.min(current.low, price),
          close: price,
          volume: current.volume,
        }
      : {
          time: bucket as UTCTimestamp,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: tick.volume24h ?? null,
        }
    if (current) {
      data[data.length - 1] = next
    } else {
      data.push(next)
    }
    series.update({ time: next.time, open: next.open, high: next.high, low: next.low, close: next.close })
    volumeSeries.update({
      time: next.time,
      value: next.volume ?? 0,
      color: next.close >= next.open ? "rgba(66,201,138,0.35)" : "rgba(240,109,114,0.35)",
    })
    setLastUpdate(Date.now())
  }, [tick, range])

  const legend = hover ?? (dataRef.current.length > 0 ? dataRef.current[dataRef.current.length - 1] : null)
  const up = legend ? legend.close >= legend.open : true
  const legendPrecision = legend ? pricePrecision(legend.close) : 2
  const fmt = (value: number) => value.toFixed(legendPrecision)

  return (
    <div className="w-full" aria-label="Graphique de prix de l'actif">
      {loading && (
        <div className="flex flex-col gap-3 py-4">
          <div className="skeleton skeleton-card w-full" style={{ height: 420 }} />
        </div>
      )}
      {!loading && error && (
        <div className="empty" style={{ height: 420, display: "grid", placeItems: "center" }}>
          <div>
            <p>Erreur lors du chargement de l&apos;historique.</p>
            <button className="primary" onClick={() => setReloadKey((k) => k + 1)}>
              Réessayer
            </button>
          </div>
        </div>
      )}
      {!loading && !error && candles !== null && candles.length === 0 && (
        <div className="empty" style={{ height: 420, display: "grid", placeItems: "center" }}>
          <div>
            <p>Historique indisponible pour cet actif.</p>
            <button className="primary" onClick={() => setReloadKey((k) => k + 1)}>
              Réessayer
            </button>
          </div>
        </div>
      )}
      {!loading && !error && candles !== null && candles.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
            fontFamily: "var(--font-geist-mono)",
            fontSize: 11,
            color: "var(--muted)",
            padding: "0 0 8px",
          }}
        >
          <span style={{ color: "var(--foreground)" }}>{symbol}</span>
          {legend && (
            <>
              <span>
                O <span className="mono" style={{ color: "var(--foreground)" }}>{fmt(legend.open)}</span>
              </span>
              <span>
                H <span style={{ color: "var(--mint)" }}>{fmt(legend.high)}</span>
              </span>
              <span>
                L <span style={{ color: "var(--coral)" }}>{fmt(legend.low)}</span>
              </span>
              <span>
                C <span style={{ color: up ? "var(--mint)" : "var(--coral)" }}>{fmt(legend.close)}</span>
              </span>
              {legend.volume !== null && legend.volume !== undefined && (
                <span>
                  Vol <span className="mono" style={{ color: "var(--foreground)" }}>{Math.round(legend.volume).toLocaleString("fr-FR")}</span>
                </span>
              )}
              {hover ? (
                <span style={{ color: "var(--cyan)" }}>● survol</span>
              ) : lastUpdate > 0 ? (
                <span style={{ color: "var(--mint)" }}>● temps réel</span>
              ) : null}
            </>
          )}
        </div>
      )}
      {!loading && !error && candles !== null && candles.length > 0 && (
        <div ref={containerRef} className="w-full" style={{ height: 420 }} />
      )}
    </div>
  )
}
