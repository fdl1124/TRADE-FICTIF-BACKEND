import { Injectable } from '@nestjs/common';
import { Client } from '@libsql/client';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LIBSQL_CLIENT } from '../database/libsql-token';
import { PriceCacheService } from '../market-data/price-cache.service';
import { Account, AccountSummary } from '../common/interfaces';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { ApiErrors } from '../common/api-error';

interface PositionPriceRow {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
}

@Injectable()
export class AccountService {
  constructor(
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
    private readonly cache: PriceCacheService,
  ) {}

  async getOrCreateAccountId(user: FirebaseUserPayload): Promise<string> {
    const existingUser = await this.db.execute({
      sql: 'SELECT id FROM users WHERE id = ?',
      args: [user.uid],
    });
    const displayName = user.name ?? user.email ?? user.uid;
    if (existingUser.rows.length === 0) {
      await this.db.execute({
        sql: 'INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)',
        args: [user.uid, user.email ?? '', displayName, new Date().toISOString()],
      });
    } else {
      await this.db.execute({
        sql: 'UPDATE users SET email = ?, display_name = ? WHERE id = ?',
        args: [user.email ?? '', displayName, user.uid],
      });
    }

    const account = await this.db.execute({
      sql: 'SELECT id FROM accounts WHERE user_id = ?',
      args: [user.uid],
    });
    if (account.rows.length > 0) {
      return String(account.rows[0].id);
    }

    const accountId = randomUUID();
    await this.db.execute({
      sql: 'INSERT INTO accounts (id, user_id, balance, starting_balance, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [accountId, user.uid, 10_000, 10_000, new Date().toISOString()],
    });
    return accountId;
  }

  async assertOwnership(accountId: string, uid: string): Promise<void> {
    const result = await this.db.execute({
      sql: 'SELECT user_id FROM accounts WHERE id = ?',
      args: [accountId],
    });
    if (result.rows.length === 0) {
      throw ApiErrors.notFound('Account');
    }
    if (String(result.rows[0].user_id) !== uid) {
      throw ApiErrors.forbidden();
    }
  }

  async getAccount(accountId: string): Promise<Account> {
    const result = await this.db.execute({
      sql: 'SELECT id, user_id, balance, starting_balance, created_at FROM accounts WHERE id = ?',
      args: [accountId],
    });
    if (result.rows.length === 0) {
      throw ApiErrors.notFound('Account');
    }
    const row = result.rows[0];
    return {
      id: String(row.id),
      userId: String(row.user_id),
      balance: Number(row.balance),
      startingBalance: Number(row.starting_balance),
      createdAt: String(row.created_at),
    };
  }

  async getBalanceAndStarting(accountId: string): Promise<{ balance: number; startingBalance: number }> {
    const account = await this.getAccount(accountId);
    return { balance: account.balance, startingBalance: account.startingBalance };
  }

  async listPositionPrices(accountId: string): Promise<PositionPriceRow[]> {
    const result = await this.db.execute({
      sql: 'SELECT symbol, quantity, avg_entry_price FROM positions WHERE account_id = ?',
      args: [accountId],
    });
    return result.rows.map((row) => ({
      symbol: String(row.symbol),
      quantity: Number(row.quantity),
      avgEntryPrice: Number(row.avg_entry_price),
    }));
  }

  currentPriceOrEntry(row: PositionPriceRow): number {
    const tick = this.cache.get(row.symbol);
    return tick ? tick.price : row.avgEntryPrice;
  }

  async getSummary(accountId: string): Promise<AccountSummary> {
    const { balance, startingBalance } = await this.getBalanceAndStarting(accountId);
    const positions = await this.listPositionPrices(accountId);
    const totalPositionsValue = positions.reduce(
      (sum, position) => sum + position.quantity * this.currentPriceOrEntry(position),
      0,
    );
    const totalEquity = balance + totalPositionsValue;
    const totalPnl = totalEquity - startingBalance;
    const totalPnlPercent = startingBalance > 0 ? (totalPnl / startingBalance) * 100 : 0;
    return {
      balance: round2(balance),
      totalPositionsValue: round2(totalPositionsValue),
      totalPnl: round2(totalPnl),
      totalPnlPercent: Number(totalPnlPercent.toFixed(2)),
    };
  }

  async getDailyPnl(accountId: string): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const realized = await this.db.execute({
      sql: "SELECT COALESCE(SUM(realized_pnl), 0) AS total FROM orders WHERE account_id = ? AND status = 'filled' AND side = 'sell' AND substr(filled_at, 1, 10) = ?",
      args: [accountId, today],
    });
    const realizedTotal = Number(realized.rows[0]?.total ?? 0);
    const positions = await this.listPositionPrices(accountId);
    const unrealized = positions.reduce(
      (sum, position) => sum + position.quantity * (this.currentPriceOrEntry(position) - position.avgEntryPrice),
      0,
    );
    return round2(realizedTotal + unrealized);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
