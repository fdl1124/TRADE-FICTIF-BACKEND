import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PriceTick } from '../common/interfaces';

export const PRICE_FRESHNESS_MS = 500;

@Injectable()
export class PriceCacheService {
  private readonly ticks = new Map<string, PriceTick>();
  private readonly receivedAt = new Map<string, number>();

  constructor(private readonly emitter: EventEmitter2) {}

  setTick(symbol: string, price: number, change24h: number, exchangeTimestampMs?: number): void {
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }
    const safeChange = Number.isFinite(change24h) ? change24h : 0;
    const timestamp = new Date(exchangeTimestampMs ?? Date.now()).toISOString();
    const tick: PriceTick = { symbol, price, timestamp, change24h: safeChange };
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
