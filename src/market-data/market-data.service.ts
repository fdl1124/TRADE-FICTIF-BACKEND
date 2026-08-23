import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Client } from '@libsql/client';
import { Inject } from '@nestjs/common';
import { PriceCacheService, PRICE_FRESHNESS_MS } from './price-cache.service';
import { BinanceService } from './binance.service';
import { YahooFinanceService } from './yahoo-finance.service';
import { findAsset } from '../common/constants/assets';
import { PriceTick } from '../common/interfaces';
import { LIBSQL_CLIENT } from '../database/libsql-token';

type HistoryRange = '1d' | '1w' | '1m';

const RANGE_MS: Record<HistoryRange, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1m': 31 * 24 * 60 * 60 * 1000,
};

const BINANCE_KLINES: Record<HistoryRange, { interval: string; limit: number }> = {
  '1d': { interval: '5m', limit: 288 },
  '1w': { interval: '1h', limit: 168 },
  '1m': { interval: '4h', limit: 186 },
};

const STOCK_CANDLE_RESOLUTION: Record<HistoryRange, { resolution: string }> = {
  '1d': { resolution: '5' },
  '1w': { resolution: '60' },
  '1m': { resolution: 'D' },
};

@Injectable()
export class MarketDataService {
  constructor(
    private readonly cache: PriceCacheService,
    private readonly binance: BinanceService,
    private readonly yahoo: YahooFinanceService,
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
  ) {}

  getCachedTick(symbol: string): PriceTick | null {
    return this.cache.get(symbol);
  }

  async getFreshTick(symbol: string): Promise<PriceTick | null> {
    if (this.cache.isFresh(symbol, PRICE_FRESHNESS_MS)) {
      return this.cache.get(symbol);
    }
    const asset = findAsset(symbol);
    if (!asset) {
      return null;
    }
    if (asset.type === 'crypto') {
      await this.binance.fetchTick(symbol);
    } else {
      await this.yahoo.fetchQuote(symbol);
    }
    return this.cache.isFresh(symbol, PRICE_FRESHNESS_MS) ? this.cache.get(symbol) : null;
  }

  async getHistory(symbol: string, range: HistoryRange): Promise<PriceTick[]> {
    const asset = findAsset(symbol);
    if (!asset) {
      return [];
    }
    if (asset.type === 'crypto') {
      const config = BINANCE_KLINES[range];
      return this.binance.fetchKlines(symbol, config.interval, config.limit);
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fromSeconds = Math.floor((Date.now() - RANGE_MS[range]) / 1000);
    const candles = await this.yahoo.fetchCandles(
      symbol,
      STOCK_CANDLE_RESOLUTION[range].resolution,
      fromSeconds,
      nowSeconds,
    );
    if (candles && candles.length > 1) {
      return candles;
    }
    return this.yahoo.readLocalHistory(symbol, Date.now() - RANGE_MS[range]);
  }

  @Interval(60_000)
  async snapshotPrices(): Promise<void> {
    const symbols = this.cache.allSymbols();
    if (symbols.length === 0) {
      return;
    }
    const now = new Date().toISOString();
    const tx = await this.db.transaction('write');
    try {
      for (const symbol of symbols) {
        const tick = this.cache.get(symbol);
        if (!tick) {
          continue;
        }
        await tx.execute({
          sql: 'INSERT INTO price_history (symbol, price, change_24h, ts) VALUES (?, ?, ?, ?)',
          args: [symbol, tick.price, tick.change24h, now],
        });
      }
      await tx.execute({
        sql: 'DELETE FROM price_history WHERE ts < ?',
        args: [new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()],
      });
      await tx.commit();
    } catch {
      await tx.rollback();
    } finally {
      await tx.close();
    }
  }
}
