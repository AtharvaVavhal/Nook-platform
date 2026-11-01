import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client.js';
import { loadRuntimeConfig } from '../config.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private client: PrismaClient | undefined;

  get db(): PrismaClient {
    if (!this.client) {
      const databaseUrl = loadRuntimeConfig().databaseUrl;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL is required for database-backed operations.');
      }
      this.client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
