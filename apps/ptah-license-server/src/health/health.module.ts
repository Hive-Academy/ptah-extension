import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * HealthModule - Health check endpoint module
 *
 * PrismaService is available globally via PrismaModule (@Global decorator),
 * so there is no need to import PrismaModule here.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
