import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * PrismaService - NestJS wrapper for Prisma Client with PostgreSQL driver adapter
 *
 * Uses Prisma 7.1.0 driver adapters pattern for Nx monorepo compatibility.
 * Configures connection pool with min=2, max=10 connections.
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
  private pool: Pool;

  constructor() {
    // Create PostgreSQL connection pool
    const connectionString =
      process.env.DATABASE_URL ||
      'postgresql://user:password@localhost:5432/ptah_licenses';

    const pool = new Pool({
      connectionString,
      min: 2, // Minimum pool size
      max: 10, // Maximum pool size
      idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
      connectionTimeoutMillis: 5000, // Connection timeout: 5 seconds
    });

    // Create Prisma adapter with pg Pool
    const adapter = new PrismaPg(pool);

    // Initialize PrismaClient with adapter
    super({ adapter });

    this.pool = pool;
  }

  /**
   * Connect to database on module initialization
   */
  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Successfully connected to PostgreSQL database');
    } catch (error) {
      this.logger.error('Failed to connect to PostgreSQL database', error);
      throw error;
    }
  }

  /**
   * Disconnect from database on module destruction
   */
  async onModuleDestroy() {
    try {
      await this.$disconnect();
      await this.pool.end(); // Close the connection pool
      this.logger.log('Successfully disconnected from PostgreSQL database');
    } catch (error) {
      this.logger.error('Error while disconnecting from database', error);
      throw error;
    }
  }
}
