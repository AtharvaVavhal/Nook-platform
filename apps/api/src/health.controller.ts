import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

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
