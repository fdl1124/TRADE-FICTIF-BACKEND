import { Injectable } from '@nestjs/common';
import { Client } from '@libsql/client';
import { Inject } from '@nestjs/common';
import { LIBSQL_CLIENT } from '../database/database.module';
import { PriceCacheService } from '../market-data/price-cache.service';
import { Position } from '../common/interfaces';
import { ApiErrors } from '../common/api-error';

@Injectable()
export class PositionsService {
  constructor(
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
    private readonly cache: PriceCacheService,
  ) {}

  async list(accountId: string): Promise<Position[]> {
    const result = await this.db.execute({
      sql: 'SELECT id, account_id, symbol, quantity, avg_entry_price, stop_loss, take_profit, leverage, opened_at FROM positions WHERE account_id = ? ORDER BY opened_at ASC',
      args: [accountId],
    });
    return result.rows.map((row) => this.mapRow(row));
  }

  async getOne(accountId: string, positionId: string): Promise<Position> {
    const result = await this.db.execute({
      sql: 'SELECT id, account_id, symbol, quantity, avg_entry_price, stop_loss, take_profit, leverage, opened_at FROM positions WHERE id = ? AND account_id = ?',
      args: [positionId, accountId],
    });
    if (result.rows.length === 0) {
      throw ApiErrors.notFound('Position');
    }
    return this.mapRow(result.rows[0]);
  }

  async getHeldQuantity(accountId: string, symbol: string): Promise<number> {
    const result = await this.db.execute({
      sql: 'SELECT quantity FROM positions WHERE account_id = ? AND symbol = ?',
      args: [accountId, symbol],
    });
    if (result.rows.length === 0) {
      return 0;
    }
    return Number(result.rows[0].quantity);
  }

  private mapRow(row: Record<string, unknown>): Position {
    const avgEntryPrice = Number(row.avg_entry_price);
    const tick = this.cache.get(String(row.symbol));
    const currentPrice = tick ? tick.price : avgEntryPrice;
    const quantity = Number(row.quantity);
    const unrealizedPnl = quantity * (currentPrice - avgEntryPrice);
    const unrealizedPnlPercent = avgEntryPrice > 0 ? (unrealizedPnl / (quantity * avgEntryPrice)) * 100 : 0;
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      symbol: String(row.symbol),
      quantity,
      avgEntryPrice,
      currentPrice,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      unrealizedPnlPercent: Number(unrealizedPnlPercent.toFixed(2)),
      stopLoss: row.stop_loss === null ? null : Number(row.stop_loss),
      takeProfit: row.take_profit === null ? null : Number(row.take_profit),
      leverage: Number(row.leverage),
      openedAt: String(row.opened_at),
    };
  }
}
