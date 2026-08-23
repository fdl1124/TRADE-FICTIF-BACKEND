import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { IncomingMessage } from 'node:http';
import { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { PriceTick } from '../common/interfaces';
import { findAsset } from '../common/constants/assets';

const THROTTLE_MS = 1_000;
const MAX_SYMBOLS_PER_CLIENT = 20;
const WS_PATH = '/ws/prices';

interface SubscribePayload {
  action?: unknown;
  symbols?: unknown;
}

@Injectable()
export class PricesGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PricesGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  private readonly lastSentPerSymbol = new Map<string, number>();

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer();
    if (!server) {
      this.logger.error('HTTP server unavailable, price WebSocket disabled');
      return;
    }
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      let pathname = '';
      try {
        pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      } catch {
        pathname = '';
      }
      if (pathname !== WS_PATH) {
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (client: WebSocket) => {
      this.subscriptions.set(client, new Set<string>());
      client.on('message', (data) => this.handleMessage(client, data));
      client.on('close', () => this.subscriptions.delete(client));
      client.on('error', () => this.subscriptions.delete(client));
    });
    this.logger.log('Price WebSocket ready on /ws/prices');
  }

  onModuleDestroy(): void {
    for (const client of this.subscriptions.keys()) {
      client.close();
    }
    this.subscriptions.clear();
    this.wss.close();
  }

  private handleMessage(client: WebSocket, data: unknown): void {
    let parsed: SubscribePayload;
    try {
      parsed = JSON.parse(String(data)) as SubscribePayload;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.symbols)) {
      return;
    }
    const symbols = parsed.symbols
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => findAsset(s) !== null);
    const subscribed = this.subscriptions.get(client);
    if (!subscribed) {
      return;
    }
    if (parsed.action === 'subscribe') {
      for (const symbol of symbols) {
        if (subscribed.size >= MAX_SYMBOLS_PER_CLIENT && !subscribed.has(symbol)) {
          break;
        }
        subscribed.add(symbol);
      }
    } else if (parsed.action === 'unsubscribe') {
      for (const symbol of symbols) {
        subscribed.delete(symbol);
      }
    }
  }

  @OnEvent('price.tick')
  onPriceTick(tick: PriceTick): void {
    const last = this.lastSentPerSymbol.get(tick.symbol) ?? 0;
    const now = Date.now();
    if (now - last < THROTTLE_MS) {
      return;
    }
    this.lastSentPerSymbol.set(tick.symbol, now);
    const payload = JSON.stringify(tick);
    for (const [client, symbols] of this.subscriptions) {
      if (client.readyState === WebSocket.OPEN && symbols.has(tick.symbol)) {
        client.send(payload);
      }
    }
  }
}
