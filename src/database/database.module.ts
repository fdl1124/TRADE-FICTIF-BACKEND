import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, Client } from '@libsql/client';
import { DatabaseService } from './database.service';

export const LIBSQL_CLIENT = 'LIBSQL_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: LIBSQL_CLIENT,
      useFactory: (config: ConfigService): Client => {
        const url = config.getOrThrow<string>('TURSO_DATABASE_URL');
        const authToken = config.get<string>('TURSO_AUTH_TOKEN');
        return createClient({ url, authToken: authToken && authToken.length > 0 ? authToken : undefined });
      },
      inject: [ConfigService],
    },
    DatabaseService,
  ],
  exports: [LIBSQL_CLIENT, DatabaseService],
})
export class DatabaseModule {}
