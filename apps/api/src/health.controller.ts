import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';

@Controller('health')
export class HealthController {
  // Explicit @Inject: tsx does not emit decorator metadata, so implicit injection yields undefined.
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getHealth(): { status: 'ok'; service: 'nook-api'; scope: 'milestone-0' } {
    return { status: 'ok', service: 'nook-api', scope: 'milestone-0' };
  }

  @Get('database')
  async getDatabaseHealth(): Promise<{ status: 'ok'; dependency: 'database' }> {
    if (!(await this.database.isAvailable())) {
      throw new ServiceUnavailableException({ status: 'degraded', dependency: 'database' });
    }
    return { status: 'ok', dependency: 'database' };
  }
}
