import { Module } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';
import { HealthController } from './health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { InventoryModule } from './inventory/inventory.module.js';

@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [HealthController],
  providers: [DatabaseService],
})
export class AppModule {}
