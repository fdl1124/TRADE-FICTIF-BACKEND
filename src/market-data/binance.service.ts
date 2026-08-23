import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PriceCacheService } from './price-cache.service';
import { CRYPTO_SYMBOLS } from '../common/constants/assets';
import { PriceTick } from '../common/interfaces';

interface BinanceCombinedMessage {
  stream?: string;
  data?: {
    s?: string;
    c?: string;
    P?: string;
    E?: number;
  };
}

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
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
          this.cache.setTick(
            d.s,
            Number.parseFloat(d.c),
            Number.parseFloat(d.P ?? '0'),
            typeof d.E === 'number' ? d.E : Date.now(),
          );
        }
      } catch {
        return;
      }
    };

    ws.onclose = () => {
      if (!this.destroyed) {
        this.logger.warn('Binance WebSocket closed, reconnecting in 5s');
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
      const data = (await response.json()) as { lastPrice?: string; priceChangePercent?: string; closeTime?: number };
      const price = Number.parseFloat(data.lastPrice ?? '');
      if (!Number.isFinite(price) || price <= 0) {
        return null;
      }
      this.cache.setTick(
        symbol,
        price,
        Number.parseFloat(data.priceChangePercent ?? '0'),
        typeof data.closeTime === 'number' ? data.closeTime : Date.now(),
      );
      return this.cache.get(symbol);
    } catch {
      return null;
    }
  }

  async fetchKlines(symbol: string, interval: string, limit: number): Promise<PriceTick[]> {
    try {
      const response = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      );
      if (!response.ok) {
        return [];
      }
      const rows = (await response.json()) as unknown[];
      const ticks: PriceTick[] = [];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) {
          continue;
        }
        const closeTime = Number(row[6]);
        const close = Number.parseFloat(String(row[4]));
        if (!Number.isFinite(close) || close <= 0) {
          continue;
        }
        ticks.push({
          symbol,
          price: close,
          timestamp: new Date(Number.isFinite(closeTime) ? closeTime : Date.now()).toISOString(),
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
      return [];
    }
  }
}
