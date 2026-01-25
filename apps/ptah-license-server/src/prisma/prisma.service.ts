import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated-prisma-client/client';

/**
 * PrismaService - NestJS wrapper for Prisma Client with PostgreSQL driver adapter
 *
 * Uses Prisma 7.1.0 driver adapters pattern as recommended in official docs.
 * @see https://www.prisma.io/docs/guides/nestjs
 *
 * Implements OnModuleInit to connect on app startup.
 * Implements OnModuleDestroy to disconnect on app shutdown.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env['DATABASE_URL'] as string;

    // Debug logging - mask password in connection string
    const maskedUrl = connectionString
      ? connectionString.replace(/:[^:@]+@/, ':****@')
      : 'NOT SET';
    console.log(`[PrismaService] DATABASE_URL: ${maskedUrl}`);

    if (!connectionString) {
      console.error('[PrismaService] ERROR: DATABASE_URL is not set!');
    }

    // Create Prisma adapter with connection string (as per official docs)
    const adapter = new PrismaPg({ connectionString });

    // Initialize PrismaClient with adapter
    super({ adapter });
  }

  /**
   * Connect to database on module initialization
   */
  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma $connect() successful');

      // Test query to verify connection works
      this.logger.log('Testing Prisma model query (user.count)...');
      const userCount = await this.user.count();
      this.logger.log(`Database connection verified. User count: ${userCount}`);
    } catch (error) {
      this.logger.error('Failed to connect to PostgreSQL database', error);
      this.logger.error('Error details:', {
        message: (error as Error).message,
        code: (error as { code?: string }).code,
      });
      throw error;
    }
  }

  /**
   * Disconnect from database on module destruction
   */
  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Successfully disconnected from PostgreSQL database');
    } catch (error) {
      this.logger.error('Error while disconnecting from database', error);
      throw error;
    }
  }
}
