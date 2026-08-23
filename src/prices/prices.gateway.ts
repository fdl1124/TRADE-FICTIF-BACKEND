import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PriceTick } from '../common/interfaces';
import { findAsset } from '../common/constants/assets';

interface SubscribePayload {
  action?: unknown;
  symbols?: unknown;
}

const THROTTLE_MS = 1_000;
const MAX_SYMBOLS_PER_CLIENT = 20;

@WebSocketGateway({
  path: '/ws/prices',
  cors: { origin: (process.env.FRONTEND_ORIGIN ?? '').split(',').map((o) => o.trim()) },
})
export class PricesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly lastSentPerSymbol = new Map<string, number>();

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket): void {
    client.data.symbols = new Set<string>();
  }

  handleDisconnect(client: Socket): void {
    client.data.symbols = undefined;
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, @MessageBody() payload: SubscribePayload): void {
    const symbols = this.extractSymbols(payload);
    const subscribed: Set<string> = client.data.symbols ?? new Set<string>();
    for (const symbol of symbols) {
      if (subscribed.size >= MAX_SYMBOLS_PER_CLIENT) {
        break;
      }
      subscribed.add(symbol);
      client.join(this.roomFor(symbol));
    }
    client.data.symbols = subscribed;
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, @MessageBody() payload: SubscribePayload): void {
    const symbols = this.extractSymbols(payload);
    const subscribed: Set<string> = client.data.symbols ?? new Set<string>();
    for (const symbol of symbols) {
      subscribed.delete(symbol);
      client.leave(this.roomFor(symbol));
    }
    client.data.symbols = subscribed;
  }

  @OnEvent('price.tick')
  onPriceTick(tick: PriceTick): void {
    const last = this.lastSentPerSymbol.get(tick.symbol) ?? 0;
    const now = Date.now();
    if (now - last < THROTTLE_MS) {
      return;
    }
    this.lastSentPerSymbol.set(tick.symbol, now);
    this.server.to(this.roomFor(tick.symbol)).emit('price', tick);
  }

  private extractSymbols(payload: SubscribePayload): string[] {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.symbols)) {
      return [];
    }
    return payload.symbols
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => findAsset(s) !== null)
      .slice(0, MAX_SYMBOLS_PER_CLIENT);
  }

  private roomFor(symbol: string): string {
    return `price:${symbol}`;
  }
}
