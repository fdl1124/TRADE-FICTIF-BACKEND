"use client"

import { useEffect, useRef, useState } from "react"

const SYMBOL_MAP: Record<string, string> = {
  BTCUSDT: "BINANCE:BTCUSDT",
  ETHUSDT: "BINANCE:ETHUSDT",
  SOLUSDT: "BINANCE:SOLUSDT",
  BNBUSDT: "BINANCE:BNBUSDT",
  XRPUSDT: "BINANCE:XRPUSDT",
  DOGEUSDT: "BINANCE:DOGEUSDT",
  ADAUSDT: "BINANCE:ADAUSDT",
  LINKUSDT: "BINANCE:LINKUSDT",
  AVAXUSDT: "BINANCE:AVAXUSDT",
  DOTUSDT: "BINANCE:DOTUSDT",
  LTCUSDT: "BINANCE:LTCUSDT",
  ATOMUSDT: "BINANCE:ATOMUSDT",
  UNIUSDT: "BINANCE:UNIUSDT",
  NEARUSDT: "BINANCE:NEARUSDT",
  AAPL: "NASDAQ:AAPL",
  MSFT: "NASDAQ:MSFT",
  GOOGL: "NASDAQ:GOOGL",
  AMZN: "NASDAQ:AMZN",
  NVDA: "NASDAQ:NVDA",
  TSLA: "NASDAQ:TSLA",
  META: "NASDAQ:META",
  AMD: "NASDAQ:AMD",
  NFLX: "NASDAQ:NFLX",
  INTC: "NASDAQ:INTC",
  JPM: "NYSE:JPM",
  V: "NYSE:V",
  KO: "NYSE:KO",
  DIS: "NYSE:DIS",
  BA: "NYSE:BA",
}

const INTERVAL_MAP: Record<string, string> = { "1d": "5", "1w": "60", "1m": "D" }

export function PriceChart({ symbol, range }: { symbol: string; range: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tvReady, setTvReady] = useState(false)

  useEffect(() => {
    if (window.TradingView) {
      setTvReady(true)
      return
    }
    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/tv.js"
    script.async = true
    script.onload = () => setTvReady(true)
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    if (!tvReady || !containerRef.current || !(window as Record<string, unknown>).TradingView) return
    const container = containerRef.current
    container.innerHTML = ""
    const tvSymbol = SYMBOL_MAP[symbol] ?? `BINANCE:${symbol}`
    const interval = INTERVAL_MAP[range] ?? "5"
    const widgetConfig = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone: "America/New_York",
      theme: "dark",
      style: "1",
      locale: "fr",
      toolbar_bg: "#0B1018",
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      details: true,
      withdateranges: true,
      studies: ["STD;RSI", "STD;EMA"],
      container_id: container.id,
      backgroundColor: "rgba(11,16,24,1)",
      gridColor: "rgba(32,43,58,0.4)",
      overrides: {
        "paneProperties.background": "#0B1018",
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": "rgba(32,43,58,0.4)",
        "paneProperties.horzGridProperties.color": "rgba(32,43,58,0.4)",
        "scalesProperties.textColor": "#8C9AAD",
        "mainSeriesProperties.candleStyle.upColor": "#42C98A",
        "mainSeriesProperties.candleStyle.downColor": "#F06D72",
        "mainSeriesProperties.candleStyle.borderUpColor": "#42C98A",
        "mainSeriesProperties.candleStyle.borderDownColor": "#F06D72",
        "mainSeriesProperties.candleStyle.wickUpColor": "#42C98A",
        "mainSeriesProperties.candleStyle.wickDownColor": "#F06D72",
      },
    })

    const scriptEl = document.createElement("script")
    scriptEl.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    scriptEl.async = true
    scriptEl.type = "text/javascript"
    scriptEl.innerHTML = widgetConfig
    container.appendChild(scriptEl)
  }, [tvReady, symbol, range])

  return (
    <div className="w-full">
      {!tvReady && (
        <div style={{ height: 500, display: "grid", placeItems: "center" }}>
          <div className="skeleton skeleton-card w-full" style={{ height: 500 }} />
        </div>
      )}
      <div
        ref={containerRef}
        id={`tv_chart_${symbol}_${range}`}
        className="w-full"
        style={{ height: 520, display: tvReady ? "block" : "none" }}
      />
    </div>
  )
}

declare global {
  interface Window {
    TradingView?: { widget: new (config: { container_id: string } & Record<string, unknown>) => void }
  }
}
