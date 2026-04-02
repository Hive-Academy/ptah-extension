import {
  Controller,
  Get,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HealthController - Production health check endpoint
 *
 * Validates actual database connectivity, not just HTTP 200.
 * Used by Docker HEALTHCHECK and monitoring tools.
 *
 * Route: GET /api/health (global prefix 'api' set in main.ts)
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Health check with database validation
   *
   * GET /api/health
   *
   * Returns 200 with status "ok" when database is reachable.
   * Throws ServiceUnavailableException (HTTP 503) when database is unreachable.
   */
  @Get()
  async check() {
    try {
      await this.prisma.user.count();
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
      };
    } catch (error) {
      this.logger.error('Health check failed: database unreachable', error);
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      });
    }
  }
}
