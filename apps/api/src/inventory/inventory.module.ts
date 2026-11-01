import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryController } from './inventory.controller.js';
import { INVENTORY_REPOSITORY, PrismaInventoryRepository } from './inventory.repository.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [
    PrismaService,
    PrismaInventoryRepository,
    { provide: INVENTORY_REPOSITORY, useExisting: PrismaInventoryRepository },
    InventoryService,
  ],
})
export class InventoryModule {}
