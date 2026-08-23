import { Injectable, Interval } from '@nestjs/common';
import { Client } from '@libsql/client';
import { Inject } from '@nestjs/common';
import { PriceCacheService } from './price-cache.service';
import { STOCK_SYMBOLS } from '../common/constants/assets';
import { PriceTick } from '../common/interfaces';
import { LIBSQL_CLIENT } from '../database/database.module';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

interface YahooChartResponse {
  chart?: {
    error?: unknown;
    result?: Array<{
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
}

const RESOLUTION_TO_INTERVAL: Record<string, string> = {
  '5': '5m',
  '60': '1h',
  D: '1d',
};

function rangeFromWindow(from: number, to: number): string {
  const days = Math.max(1, Math.round((to - from) / 86_400));
  if (days <= 1) return '1d';
  if (days <= 6) return '5d';
  if (days <= 27) return '1mo';
  if (days <= 90) return '3mo';
  return '1y';
}

@Injectable()
export class YahooFinanceService {
  constructor(
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
    private readonly cache: PriceCacheService,
  ) {}

  @Interval(30_000)
  async pollQuotes(): Promise<void> {
    for (const symbol of STOCK_SYMBOLS) {
      await this.fetchQuote(symbol);
    }
  }

  async fetchQuote(symbol: string): Promise<PriceTick | null> {
    try {
      const response = await fetch(`${YAHOO_BASE}/${symbol}?interval=1d&range=1d`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as YahooChartResponse;
      const result = data.chart?.result?.[0];
      const meta = result?.meta;
      if (!meta || !Number.isFinite(meta.regularMarketPrice) || (meta.regularMarketPrice ?? 0) <= 0) {
        return null;
      }
      const price = meta.regularMarketPrice as number;
      const previousClose = Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : price;
      const change24h = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;
      const marketTime = Number.isFinite(meta.regularMarketTime)
        ? (meta.regularMarketTime as number) * 1000
        : Date.now();
      this.cache.setTick(symbol, price, change24h, marketTime);
      return this.cache.get(symbol);
    } catch {
      return null;
    }
  }

  async fetchCandles(symbol: string, resolution: string, from: number, to: number): Promise<PriceTick[] | null> {
    const interval = RESOLUTION_TO_INTERVAL[resolution] ?? '1h';
    const range = rangeFromWindow(from, to);
    try {
      const response = await fetch(`${YAHOO_BASE}/${symbol}?interval=${interval}&range=${range}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as YahooChartResponse;
      const result = data.chart?.result?.[0];
      if (!result || data.chart?.error) {
        return null;
      }
      const timestamps = result.timestamp ?? [];
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const ticks: PriceTick[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const close = closes[i];
        if (!Number.isFinite(close) || (close ?? 0) <= 0) {
          continue;
        }
        ticks.push({
          symbol,
          price: close as number,
          timestamp: new Date(timestamps[i] * 1000).toISOString(),
          change24h: 0,
        });
      }
      if (ticks.length > 1) {
        const first = ticks[0].price;
        for (const tick of ticks) {
          tick.change24h = ((tick.price - first) / first) * 100;
        }
      }
      return ticks;
    } catch {
      return null;
    }
  }

  async readLocalHistory(symbol: string, sinceMs: number): Promise<PriceTick[]> {
    const result = await this.db.execute({
      sql: 'SELECT price, change_24h, ts FROM price_history WHERE symbol = ? AND ts >= ? ORDER BY ts ASC',
      args: [symbol, new Date(sinceMs).toISOString()],
    });
    return result.rows.map((row) => ({
      symbol,
      price: Number(row.price),
      timestamp: String(row.ts),
      change24h: Number(row.change_24h),
    }));
  }
}
