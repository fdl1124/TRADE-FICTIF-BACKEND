import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PriceCacheService } from './price-cache.service';
import { CRYPTO_SYMBOLS } from '../common/constants/assets';
import { Candle, PriceTick } from '../common/interfaces';

interface BinanceCombinedMessage {
  stream?: string;
  data?: {
    s?: string;
    c?: string;
    P?: string;
    E?: number;
    v?: string;
    q?: string;
    h?: string;
    l?: string;
  };
}

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly cache: PriceCacheService) {}

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
  }

  private connect(): void {
    if (this.destroyed) {
      return;
    }
    const streams = CRYPTO_SYMBOLS.map((s) => `${s.toLowerCase()}@ticker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    this.ws = ws;

    ws.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as BinanceCombinedMessage;
        const d = parsed.data;
        if (d && typeof d.s === 'string' && typeof d.c === 'string') {
          const volume = Number.parseFloat(d.q ?? '');
          const high = Number.parseFloat(d.h ?? '');
          const low = Number.parseFloat(d.l ?? '');
          this.cache.setTick(
            d.s,
            Number.parseFloat(d.c),
            Number.parseFloat(d.P ?? '0'),
            typeof d.E === 'number' ? d.E : Date.now(),
            {
              volume24h: Number.isFinite(volume) ? volume : undefined,
              high24h: Number.isFinite(high) ? high : undefined,
              low24h: Number.isFinite(low) ? low : undefined,
            },
          );
        }
      } catch {
        return;
      }
    };

    ws.onclose = () => {
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        this.connect();
      },
      5_000,
    );
  }

  async fetchTick(symbol: string): Promise<PriceTick | null> {
    try {
      const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as {
        lastPrice?: string;
        priceChangePercent?: string;
        closeTime?: number;
        quoteVolume?: string;
        highPrice?: string;
        lowPrice?: string;
      };
      const price = Number.parseFloat(data.lastPrice ?? '');
      if (!Number.isFinite(price) || price <= 0) {
        return null;
      }
      const volume = Number.parseFloat(data.quoteVolume ?? '');
      const high = Number.parseFloat(data.highPrice ?? '');
      const low = Number.parseFloat(data.lowPrice ?? '');
      this.cache.setTick(
        symbol,
        price,
        Number.parseFloat(data.priceChangePercent ?? '0'),
        typeof data.closeTime === 'number' ? data.closeTime : Date.now(),
        {
          volume24h: Number.isFinite(volume) ? volume : undefined,
          high24h: Number.isFinite(high) ? high : undefined,
          low24h: Number.isFinite(low) ? low : undefined,
        },
      );
      return this.cache.get(symbol);
    } catch {
      return null;
    }
  }

  async fetchKlines(symbol: string, interval: string, limit: number): Promise<PriceTick[]> {
    const candles = await this.fetchCandles(symbol, interval, limit);
    return candles.map((candle) => ({
      symbol,
      price: candle.close,
      timestamp: candle.time,
      change24h: 0,
    }));
  }

  async fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    try {
      const response = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      );
      if (!response.ok) {
        return [];
      }
      const rows = (await response.json()) as unknown[];
      const candles: Candle[] = [];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 7) {
          continue;
        }
        const openTime = Number(row[0]);
        const open = Number.parseFloat(String(row[1]));
        const high = Number.parseFloat(String(row[2]));
        const low = Number.parseFloat(String(row[3]));
        const close = Number.parseFloat(String(row[4]));
        const volume = Number.parseFloat(String(row[5]));
        if (![open, high, low, close].every(Number.isFinite) || close <= 0) {
          continue;
        }
        candles.push({
          time: new Date(Number.isFinite(openTime) ? openTime : Date.now()).toISOString(),
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : null,
        });
      }
      return candles;
    } catch {
      return [];
    }
  }
}
