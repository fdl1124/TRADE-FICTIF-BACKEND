import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@libsql/client';
import { Inject } from '@nestjs/common';
import { LIBSQL_CLIENT } from './libsql-token';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(LIBSQL_CLIENT) private readonly client: Client) {}

  get db(): Client {
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    await this.runMigrations();
  }

  private async runMigrations(): Promise<void> {
    await this.client.execute(
      'CREATE TABLE IF NOT EXISTS applied_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    );

    const migrationsDir = join(__dirname, 'migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await this.client.execute({
        sql: 'SELECT name FROM applied_migrations WHERE name = ?',
        args: [file],
      });
      if (applied.rows.length > 0) {
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      await this.client.executeMultiple(sql);
      await this.client.execute({
        sql: 'INSERT INTO applied_migrations (name, applied_at) VALUES (?, ?)',
        args: [file, new Date().toISOString()],
      });
      this.logger.log(`Applied migration ${file}`);
    }
  }
}
