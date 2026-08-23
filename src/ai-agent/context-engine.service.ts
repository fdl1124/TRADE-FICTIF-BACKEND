import { Injectable } from '@nestjs/common';
import { MarketDataService } from '../market-data/market-data.service';
import { MarketStatusService } from '../market-data/market-status.service';
import { BinanceService } from '../market-data/binance.service';
import { YahooFinanceService } from '../market-data/yahoo-finance.service';
import { AccountService } from '../portfolio/account.service';
import { PositionsService } from '../portfolio/positions.service';
import { findAsset } from '../common/constants/assets';

export type ThinkingLevel = 'low' | 'medium' | 'high';

export interface AgentMarketContext {
  symbol: string;
  assetType: 'stock' | 'crypto';
  exchange: string;
  marketOpen: boolean;
  spotPrice: number;
  priceTimestamp: string;
  change24hPct: number;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  volatilityPct: number | null;
  recentCloses: number[];
  currentPositionQuantity: number;
  cashBalance: number;
  startingBalance: number;
  totalEquity: number;
}

export interface ContextBuildResult {
  ok: boolean;
  reason?: 'MARKET_CLOSED' | 'STALE_PRICE_DATA';
  context?: AgentMarketContext;
  thinkingLevel: ThinkingLevel;
}

const HIGH_VOLATILITY_CHANGE_24H = 5;
const HIGH_VOLATILITY_VOLATILITY = 3;
const CLOSES_LOOKBACK = 72;
const CLOSES_LOOKBACK_MS = 4 * 24 * 60 * 60 * 1000;

export function computeRsi(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) {
    return null;
  }
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses -= delta;
    }
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function computeSma(closes: number[], period: number): number | null {
  if (closes.length < period) {
    return null;
  }
  const slice = closes.slice(closes.length - period);
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return Number((sum / period).toFixed(4));
}

export function computeVolatilityPct(closes: number[]): number | null {
  if (closes.length < 3) {
    return null;
  }
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const previous = closes[i - 1];
    if (previous <= 0) {
      continue;
    }
    returns.push(((closes[i] - previous) / previous) * 100);
  }
  if (returns.length < 2) {
    return null;
  }
  const mean = returns.reduce((acc, value) => acc + value, 0) / returns.length;
  const variance = returns.reduce((acc, value) => acc + (value - mean) ** 2, 0) / returns.length;
  return Number(Math.sqrt(variance).toFixed(4));
}

@Injectable()
export class ContextEngineService {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly marketStatus: MarketStatusService,
    private readonly binance: BinanceService,
    private readonly yahoo: YahooFinanceService,
    private readonly accounts: AccountService,
    private readonly positions: PositionsService,
  ) {}

  async build(accountId: string, symbol: string): Promise<ContextBuildResult> {
    const asset = findAsset(symbol);
    if (!asset) {
      return { ok: false, reason: 'STALE_PRICE_DATA', thinkingLevel: 'medium' };
    }

    if (!this.marketStatus.isMarketOpen(asset)) {
      return { ok: false, reason: 'MARKET_CLOSED', thinkingLevel: 'medium' };
    }

    const tick = await this.marketData.getFreshTick(asset.symbol);
    if (!tick) {
      return { ok: false, reason: 'STALE_PRICE_DATA', thinkingLevel: 'medium' };
    }

    const closes = await this.loadCloses(asset.type, asset.symbol, tick.price);

    const [{ balance, startingBalance }, summary, heldQuantity] = await Promise.all([
      this.accounts.getBalanceAndStarting(accountId),
      this.accounts.getSummary(accountId),
      this.positions.getHeldQuantity(accountId, asset.symbol),
    ]);

    const context: AgentMarketContext = {
      symbol: asset.symbol,
      assetType: asset.type,
      exchange: asset.exchange,
      marketOpen: true,
      spotPrice: tick.price,
      priceTimestamp: tick.timestamp,
      change24hPct: tick.change24h,
      rsi14: computeRsi(closes),
      sma20: computeSma(closes, 20),
      sma50: computeSma(closes, 50),
      volatilityPct: computeVolatilityPct(closes),
      recentCloses: closes.slice(-30),
      currentPositionQuantity: heldQuantity,
      cashBalance: balance,
      startingBalance: startingBalance,
      totalEquity: Number((balance + summary.totalPositionsValue).toFixed(2)),
    };

    return {
      ok: true,
      context,
      thinkingLevel: this.resolveThinkingLevel(context),
    };
  }

  resolveThinkingLevel(context: AgentMarketContext): ThinkingLevel {
    const volatile =
      Math.abs(context.change24hPct) >= HIGH_VOLATILITY_CHANGE_24H ||
      (context.volatilityPct !== null && context.volatilityPct >= HIGH_VOLATILITY_VOLATILITY);
    return volatile ? 'high' : 'medium';
  }

  private async loadCloses(assetType: 'stock' | 'crypto', symbol: string, spot: number): Promise<number[]> {
    let closes: number[] = [];
    if (assetType === 'crypto') {
      const klines = await this.binance.fetchKlines(symbol, '1h', CLOSES_LOOKBACK);
      closes = klines.map((tickEntry) => tickEntry.price);
    } else {
      const to = Math.floor(Date.now() / 1000);
      const from = Math.floor((Date.now() - CLOSES_LOOKBACK_MS) / 1000);
      const candles = await this.yahoo.fetchCandles(symbol, '60', from, to);
      if (candles && candles.length > 1) {
        closes = candles.map((candle) => candle.price);
      } else {
        const local = await this.yahoo.readLocalHistory(symbol, Date.now() - CLOSES_LOOKBACK_MS);
        closes = local.map((entry) => entry.price);
      }
    }
    if (closes.length === 0 || closes[closes.length - 1] !== spot) {
      closes = [...closes, spot];
    }
    return closes;
  }
}
