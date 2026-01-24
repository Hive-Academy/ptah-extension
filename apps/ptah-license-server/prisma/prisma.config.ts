/**
 * Prisma Configuration for Ptah License Server
 * Prisma 7.1.0+ configuration file for migrate and client setup
 *
 * This file configures the database connection URL for migrations.
 * At runtime, PrismaClient will use the driver adapter pattern.
 */

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
