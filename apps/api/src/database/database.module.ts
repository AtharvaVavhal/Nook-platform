import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Single shared PrismaService (one connection pool) for every feature module. */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
