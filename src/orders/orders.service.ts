import { Injectable, Interval, Logger } from '@nestjs/common';
import { Client } from '@libsql/client';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LIBSQL_CLIENT } from '../database/database.module';
import { MarketStatusService } from '../market-data/market-status.service';
import { MarketDataService } from '../market-data/market-data.service';
import { PriceCacheService } from '../market-data/price-cache.service';
import { SlippageEngineService, roundTo } from './slippage-engine.service';
import { findAsset } from '../common/constants/assets';
import { Order, OrderSide, OrderSource } from '../common/interfaces';
import { CreateOrderDto } from '../common/dto/create-order.dto';
import { ListOrdersQueryDto } from '../common/dto/query-dtos';
import { ApiErrors } from '../common/api-error';

const QUANTITY_EPSILON = 1e-12;
const MIN_DELAY_AFTER_REACH_MS = 3_000;
const LIMIT_FILL_DELAY_MIN_MS = 5_000;
const LIMIT_FILL_DELAY_MAX_MS = 15_000;

interface FillParams {
  accountId: string;
  symbol: string;
  type: 'market' | 'limit';
  side: OrderSide;
  quantity: number;
  source: OrderSource;
  requestedPrice: number;
  filledPrice: number;
  slippage: number;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
    private readonly marketStatus: MarketStatusService,
    private readonly marketData: MarketDataService,
    private readonly cache: PriceCacheService,
    private readonly slippageEngine: SlippageEngineService,
  ) {}

  async createOrder(accountId: string, dto: CreateOrderDto, source: OrderSource): Promise<Order> {
    const asset = findAsset(dto.symbol);
    if (!asset) {
      throw ApiErrors.invalidSymbol(dto.symbol);
    }

    const isLimit = dto.type === 'limit';
    if (isLimit && (dto.limitPrice === undefined || dto.limitPrice === null)) {
      throw ApiErrors.limitPriceRequired();
    }

    if (asset.type === 'stock' && !this.marketStatus.isStockMarketOpen()) {
      throw ApiErrors.marketClosed(asset.symbol);
    }

    const tick = await this.marketData.getFreshTick(asset.symbol);
    if (!tick) {
      throw ApiErrors.stalePrice(asset.symbol);
    }

    const account = await this.db.execute({
      sql: 'SELECT balance FROM accounts WHERE id = ?',
      args: [accountId],
    });
    if (account.rows.length === 0) {
      throw ApiErrors.notFound('Account');
    }
    const balance = Number(account.rows[0].balance);

    const positionRow = await this.db.execute({
      sql: 'SELECT quantity FROM positions WHERE account_id = ? AND symbol = ?',
      args: [accountId, asset.symbol],
    });
    const heldQuantity =
      positionRow.rows.length > 0 ? Number(positionRow.rows[0].quantity) : 0;

    const stopLoss = dto.stopLoss ?? null;
    const takeProfit = dto.takeProfit ?? null;

    if (!isLimit) {
      if (dto.side === 'buy') {
        const worstCaseCost =
          dto.quantity * tick.price * (1 + this.slippageEngine.maxSlippageFraction(asset.symbol));
        if (worstCaseCost > balance + QUANTITY_EPSILON) {
          throw ApiErrors.insufficientBalance(worstCaseCost, balance);
        }
      } else if (dto.quantity > heldQuantity + QUANTITY_EPSILON) {
        throw ApiErrors.insufficientPosition(asset.symbol, dto.quantity, heldQuantity);
      }

      const { filledPrice, slippage } = this.slippageEngine.apply(asset.symbol, tick.price, dto.side);
      return this.executeFill({
        accountId,
        symbol: asset.symbol,
        type: 'market',
        side: dto.side,
        quantity: dto.quantity,
        source,
        requestedPrice: tick.price,
        filledPrice,
        slippage,
        limitPrice: null,
        stopLoss,
        takeProfit,
      });
    }

    const limitPrice = dto.limitPrice as number;
    if (dto.side === 'buy') {
      const cost = dto.quantity * limitPrice;
      if (cost > balance + QUANTITY_EPSILON) {
        throw ApiErrors.insufficientBalance(cost, balance);
      }
    } else if (dto.quantity > heldQuantity + QUANTITY_EPSILON) {
      throw ApiErrors.insufficientPosition(asset.symbol, dto.quantity, heldQuantity);
    }

    const orderId = randomUUID();
    const now = new Date();
    const fillAfterMs =
      now.getTime() +
      LIMIT_FILL_DELAY_MIN_MS +
      Math.random() * (LIMIT_FILL_DELAY_MAX_MS - LIMIT_FILL_DELAY_MIN_MS);
    await this.db.execute({
      sql: `INSERT INTO orders (id, account_id, symbol, type, side, quantity, limit_price, requested_price, filled_price, slippage, status, source, stop_loss, take_profit, rejection_reason, created_at, filled_at, reached_at, fill_after)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, ?, ?, NULL, ?, NULL, NULL, ?)`,
      args: [
        orderId,
        accountId,
        asset.symbol,
        'limit',
        dto.side,
        dto.quantity,
        limitPrice,
        tick.price,
        source,
        stopLoss,
        takeProfit,
        now.toISOString(),
        new Date(fillAfterMs).toISOString(),
      ],
    });
    return this.getOne(accountId, orderId);
  }

  async list(accountId: string, query: ListOrdersQueryDto): Promise<Order[]> {
    const limit = query.limit ?? 50;
    const result =
      query.status !== undefined
        ? await this.db.execute({
            sql: 'SELECT * FROM orders WHERE account_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?',
            args: [accountId, query.status, limit],
          })
        : await this.db.execute({
            sql: 'SELECT * FROM orders WHERE account_id = ? ORDER BY created_at DESC LIMIT ?',
            args: [accountId, limit],
          });
    return result.rows.map((row) => this.mapRow(row));
  }

  async getOne(accountId: string, orderId: string): Promise<Order> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM orders WHERE id = ? AND account_id = ?',
      args: [orderId, accountId],
    });
    if (result.rows.length === 0) {
      throw ApiErrors.notFound('Order');
    }
    return this.mapRow(result.rows[0]);
  }

  async cancel(accountId: string, orderId: string): Promise<Order> {
    const existing = await this.db.execute({
      sql: 'SELECT status FROM orders WHERE id = ? AND account_id = ?',
      args: [orderId, accountId],
    });
    if (existing.rows.length === 0) {
      throw ApiErrors.notFound('Order');
    }
    const status = String(existing.rows[0].status);
    if (status !== 'pending') {
      throw ApiErrors.notPendingOrder(status);
    }
    await this.db.execute({
      sql: "UPDATE orders SET status = 'cancelled' WHERE id = ? AND account_id = ?",
      args: [orderId, accountId],
    });
    return this.getOne(accountId, orderId);
  }

  @Interval(5_000)
  async processPendingLimitOrders(): Promise<void> {
    const pending = await this.db.execute("SELECT * FROM orders WHERE status = 'pending'");
    for (const row of pending.rows) {
      try {
        await this.tryFillLimitOrder(row);
      } catch (error) {
        this.logger.warn(
          `Limit order ${String(row.id)} processing failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async tryFillLimitOrder(row: Record<string, unknown>): Promise<void> {
    const orderId = String(row.id);
    const accountId = String(row.account_id);
    const symbol = String(row.symbol);
    const side = String(row.side) as OrderSide;
    const quantity = Number(row.quantity);
    const limitPrice = Number(row.limit_price);
    const requestedPrice = Number(row.requested_price);

    const asset = findAsset(symbol);
    if (!asset) {
      return;
    }
    if (asset.type === 'stock' && !this.marketStatus.isStockMarketOpen()) {
      return;
    }
    const tick = this.cache.get(symbol);
    if (!tick) {
      return;
    }

    const reached = side === 'buy' ? tick.price <= limitPrice : tick.price >= limitPrice;
    if (!reached) {
      if (row.reached_at !== null && row.reached_at !== undefined) {
        await this.db.execute({
          sql: 'UPDATE orders SET reached_at = NULL WHERE id = ?',
          args: [orderId],
        });
      }
      return;
    }

    let reachedAtMs: number;
    if (row.reached_at === null || row.reached_at === undefined) {
      reachedAtMs = Date.now();
      await this.db.execute({
        sql: 'UPDATE orders SET reached_at = ? WHERE id = ?',
        args: [new Date(reachedAtMs).toISOString(), orderId],
      });
    } else {
      reachedAtMs = Date.parse(String(row.reached_at));
    }

    const fillAfterMs = row.fill_after ? Date.parse(String(row.fill_after)) : 0;
    const eligibleAtMs = Math.max(fillAfterMs, reachedAtMs + MIN_DELAY_AFTER_REACH_MS);
    if (Date.now() < eligibleAtMs) {
      return;
    }

    const slippage = ((limitPrice - requestedPrice) / requestedPrice) * 100;
    await this.executeFill({
      accountId,
      symbol,
      type: 'limit',
      side,
      quantity,
      source: String(row.source) as OrderSource,
      requestedPrice,
      filledPrice: limitPrice,
      slippage: Number(slippage.toFixed(4)),
      limitPrice,
      stopLoss: row.stop_loss === null || row.stop_loss === undefined ? null : Number(row.stop_loss),
      takeProfit: row.take_profit === null || row.take_profit === undefined ? null : Number(row.take_profit),
      orderIdOverride: orderId,
      createdAtOverride: row.created_at ? String(row.created_at) : undefined,
    });
  }

  private async executeFill(params: FillParams & {
    orderIdOverride?: string;
    createdAtOverride?: string;
  }): Promise<Order> {
    const orderId = params.orderIdOverride ?? randomUUID();
    const nowIso = new Date().toISOString();
    const createdAt = params.createdAtOverride ?? nowIso;

    const tx = await this.db.transaction('write');
    try {
      const accountRow = await tx.execute({
        sql: 'SELECT balance FROM accounts WHERE id = ?',
        args: [params.accountId],
      });
      if (accountRow.rows.length === 0) {
        throw ApiErrors.notFound('Account');
      }
      let balance = Number(accountRow.rows[0].balance);

      const positionRow = await tx.execute({
        sql: 'SELECT id, quantity, avg_entry_price FROM positions WHERE account_id = ? AND symbol = ?',
        args: [params.accountId, params.symbol],
      });
      const positionExists = positionRow.rows.length > 0;
      const heldQuantity = positionExists ? Number(positionRow.rows[0].quantity) : 0;
      const avgEntryPrice = positionExists ? Number(positionRow.rows[0].avg_entry_price) : 0;
      const positionId = positionExists ? String(positionRow.rows[0].id) : null;

      if (params.side === 'buy') {
        const cost = roundTo(params.quantity * params.filledPrice, 2);
        if (cost > balance + QUANTITY_EPSILON) {
          await tx.execute({
            sql: `INSERT INTO orders (id, account_id, symbol, type, side, quantity, limit_price, requested_price, filled_price, slippage, status, source, stop_loss, take_profit, rejection_reason, created_at, filled_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'rejected', ?, ?, ?, 'INSUFFICIENT_BALANCE', ?, NULL)`,
            args: [
              orderId,
              params.accountId,
              params.symbol,
              params.type,
              params.side,
              params.quantity,
              params.limitPrice,
              params.requestedPrice,
              params.source,
              params.stopLoss,
              params.takeProfit,
              createdAt,
            ],
          });
          await tx.commit();
          return await this.getOne(params.accountId, orderId);
        }
        balance = roundTo(balance - cost, 2);
        await tx.execute({
          sql: 'UPDATE accounts SET balance = ? WHERE id = ?',
          args: [balance, params.accountId],
        });
        if (positionExists && positionId) {
          const newQuantity = heldQuantity + params.quantity;
          const newAvg =
            (heldQuantity * avgEntryPrice + params.quantity * params.filledPrice) / newQuantity;
          await tx.execute({
            sql: 'UPDATE positions SET quantity = ?, avg_entry_price = ?, stop_loss = ?, take_profit = ? WHERE id = ?',
            args: [
              newQuantity,
              newAvg,
              params.stopLoss,
              params.takeProfit,
              positionId,
            ],
          });
        } else {
          await tx.execute({
            sql: `INSERT INTO positions (id, account_id, symbol, quantity, avg_entry_price, stop_loss, take_profit, leverage, opened_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            args: [
              randomUUID(),
              params.accountId,
              params.symbol,
              params.quantity,
              params.filledPrice,
              params.stopLoss,
              params.takeProfit,
              nowIso,
            ],
          });
        }
      } else {
        if (params.quantity > heldQuantity + QUANTITY_EPSILON) {
          await tx.execute({
            sql: `INSERT INTO orders (id, account_id, symbol, type, side, quantity, limit_price, requested_price, filled_price, slippage, status, source, stop_loss, take_profit, rejection_reason, created_at, filled_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'rejected', ?, ?, ?, 'INSUFFICIENT_POSITION', ?, NULL)`,
            args: [
              orderId,
              params.accountId,
              params.symbol,
              params.type,
              params.side,
              params.quantity,
              params.limitPrice,
              params.requestedPrice,
              params.source,
              params.stopLoss,
              params.takeProfit,
              createdAt,
            ],
          });
          await tx.commit();
          return await this.getOne(params.accountId, orderId);
        }
        const proceeds = roundTo(params.quantity * params.filledPrice, 2);
        balance = roundTo(balance + proceeds, 2);
        await tx.execute({
          sql: 'UPDATE accounts SET balance = ? WHERE id = ?',
          args: [balance, params.accountId],
        });
        const realizedPnl = roundTo((params.filledPrice - avgEntryPrice) * params.quantity, 2);
        const remaining = heldQuantity - params.quantity;
        if (positionId && remaining <= QUANTITY_EPSILON) {
          await tx.execute({ sql: 'DELETE FROM positions WHERE id = ?', args: [positionId] });
        } else if (positionId) {
          await tx.execute({
            sql: 'UPDATE positions SET quantity = ? WHERE id = ?',
            args: [remaining, positionId],
          });
        }
        await tx.execute({
          sql: `INSERT INTO orders (id, account_id, symbol, type, side, quantity, limit_price, requested_price, filled_price, slippage, status, source, stop_loss, take_profit, rejection_reason, created_at, filled_at, realized_pnl)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'filled', ?, ?, ?, NULL, ?, ?, ?)`,
          args: [
            orderId,
            params.accountId,
            params.symbol,
            params.type,
            params.side,
            params.quantity,
            params.limitPrice,
            params.requestedPrice,
            params.filledPrice,
            params.slippage,
            params.source,
            params.stopLoss,
            params.takeProfit,
            createdAt,
            nowIso,
            realizedPnl,
          ],
        });
        await tx.commit();
        return await this.getOne(params.accountId, orderId);
      }

      await tx.execute({
        sql: `INSERT INTO orders (id, account_id, symbol, type, side, quantity, limit_price, requested_price, filled_price, slippage, status, source, stop_loss, take_profit, rejection_reason, created_at, filled_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'filled', ?, ?, ?, NULL, ?, ?)`,
        args: [
          orderId,
          params.accountId,
          params.symbol,
          params.type,
          params.side,
          params.quantity,
          params.limitPrice,
          params.requestedPrice,
          params.filledPrice,
          params.slippage,
          params.source,
          params.stopLoss,
          params.takeProfit,
          createdAt,
          nowIso,
        ],
      });
      await tx.commit();
      return await this.getOne(params.accountId, orderId);
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      await tx.close();
    }
  }

  private mapRow(row: Record<string, unknown>): Order {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      symbol: String(row.symbol),
      type: String(row.type) as 'market' | 'limit',
      side: String(row.side) as OrderSide,
      quantity: Number(row.quantity),
      limitPrice: row.limit_price === null || row.limit_price === undefined ? null : Number(row.limit_price),
      requestedPrice: Number(row.requested_price),
      filledPrice: row.filled_price === null || row.filled_price === undefined ? null : Number(row.filled_price),
      slippage: row.slippage === null || row.slippage === undefined ? null : Number(row.slippage),
      status: String(row.status) as Order['status'],
      source: String(row.source) as OrderSource,
      stopLoss: row.stop_loss === null || row.stop_loss === undefined ? null : Number(row.stop_loss),
      takeProfit: row.take_profit === null || row.take_profit === undefined ? null : Number(row.take_profit),
      rejectionReason:
        row.rejection_reason === null || row.rejection_reason === undefined
          ? null
          : String(row.rejection_reason),
      createdAt: String(row.created_at),
      filledAt: row.filled_at === null || row.filled_at === undefined ? null : String(row.filled_at),
    };
  }
}
