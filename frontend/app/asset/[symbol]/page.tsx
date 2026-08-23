import { TradingApp } from "@/components/trading-app"
export default async function AssetPage({params}:{params:Promise<{symbol:string}>}){const {symbol}=await params;return <TradingApp initialView="asset" initialSymbol={decodeURIComponent(symbol).toUpperCase()}/>}
