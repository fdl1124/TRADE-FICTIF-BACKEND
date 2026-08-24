import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PriceTick } from '../common/interfaces';

export const PRICE_FRESHNESS_MS = 500;

@Injectable()
export class PriceCacheService {
  private readonly ticks = new Map<string, PriceTick>();
  private readonly receivedAt = new Map<string, number>();

  constructor(private readonly emitter: EventEmitter2) {}

  setTick(
    symbol: string,
    price: number,
    change24h: number,
    exchangeTimestampMs?: number,
    stats?: { volume24h?: number; high24h?: number; low24h?: number },
  ): void {
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }
    const safeChange = Number.isFinite(change24h) ? change24h : 0;
    const previous = this.ticks.get(symbol);
    const tick: PriceTick = {
      symbol,
      price,
      timestamp: new Date(exchangeTimestampMs ?? Date.now()).toISOString(),
      change24h: safeChange,
      volume24h: stats?.volume24h ?? previous?.volume24h,
      high24h: stats?.high24h ?? previous?.high24h,
      low24h: stats?.low24h ?? previous?.low24h,
    };
    this.ticks.set(symbol, tick);
    this.receivedAt.set(symbol, Date.now());
    this.emitter.emit('price.tick', tick);
  }

  get(symbol: string): PriceTick | null {
    return this.ticks.get(symbol) ?? null;
  }

  isFresh(symbol: string, maxAgeMs: number = PRICE_FRESHNESS_MS): boolean {
    const received = this.receivedAt.get(symbol);
    return received !== undefined && Date.now() - received <= maxAgeMs;
  }

  allSymbols(): string[] {
    return Array.from(this.ticks.keys());
  }
}
