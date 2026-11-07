import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { InventoryController } from './inventory.controller.js';
import { INVENTORY_REPOSITORY, PrismaInventoryRepository } from './inventory.repository.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [InventoryController],
  providers: [
    PrismaInventoryRepository,
    { provide: INVENTORY_REPOSITORY, useExisting: PrismaInventoryRepository },
    InventoryService,
  ],
})
export class InventoryModule {}
