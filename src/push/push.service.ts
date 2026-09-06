import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject(LIBSQL_CLIENT) } from '../database/libsql-token';
import type { Client } from '@libsql/client';
import { FirebaseService } from '../auth/firebase.service';
import { randomUUID } from 'node:crypto';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
    private readonly firebase: FirebaseService,
  ) {}

  onModuleInit(): void {
    void this.db
      .execute(
        "CREATE TABLE IF NOT EXISTS push_tokens (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, platform TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL)",
      )
      .then(() => this.logger.log('push_tokens ready'))
      .catch((error: unknown) => this.logger.error(`push_tokens init failed: ${String(error)}`));
  }

  async registerToken(accountId: string, token: string, platform: string): Promise<void> {
    const existing = await this.db.execute({
      sql: 'SELECT id, account_id FROM push_tokens WHERE token = ?',
      args: [token],
    });
    if (existing.rows.length > 0) {
      await this.db.execute({
        sql: 'UPDATE push_tokens SET account_id = ?, platform = ? WHERE token = ?',
        args: [accountId, platform, token],
      });
      return;
    }
    await this.db.execute({
      sql: 'INSERT INTO push_tokens (id, account_id, token, platform, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [randomUUID(), accountId, token, platform, new Date().toISOString()],
    });
  }

  async removeToken(accountId: string, token: string): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM push_tokens WHERE token = ? AND account_id = ?',
      args: [token, accountId],
    });
  }

  async listTokens(accountId: string): Promise<string[]> {
    const rows = await this.db.execute({
      sql: 'SELECT token FROM push_tokens WHERE account_id = ?',
      args: [accountId],
    });
    return rows.rows.map((r) => String(r.token));
  }

  async notifyAccount(
    accountId: string,
    title: string,
    body: string,
    url = '/',
  ): Promise<void> {
    try {
      const tokens = await this.listTokens(accountId);
      if (tokens.length === 0) return;
      const { sent, deadTokens } = await this.firebase.sendPushToTokens(tokens, title, body, url);
      for (const dead of deadTokens) {
        await this.db.execute({ sql: 'DELETE FROM push_tokens WHERE token = ?', args: [dead] });
      }
      if (sent > 0) {
        this.logger.log(`Push envoye a ${sent}/${tokens.length} appareil(s)`);
      }
    } catch (error) {
      this.logger.warn(`notifyAccount failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
