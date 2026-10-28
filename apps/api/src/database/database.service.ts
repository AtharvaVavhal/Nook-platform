import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { loadRuntimeConfig } from '../config.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool | undefined;

  constructor() {
    const config = loadRuntimeConfig();
    this.pool = config.databaseUrl
      ? new Pool({
          connectionString: config.databaseUrl,
          max: 3,
          connectionTimeoutMillis: 1500,
          idleTimeoutMillis: 10000,
          application_name: 'nook-m0-api',
        })
      : undefined;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      // Do not expose connection strings, SQL errors, or infrastructure details in health responses.
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
