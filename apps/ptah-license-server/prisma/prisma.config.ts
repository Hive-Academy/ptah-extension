/**
 * Prisma Configuration for Ptah License Server
 * Prisma 7.1.0+ configuration file for migrate and client setup
 *
 * This file configures the database connection URL for migrations.
 * At runtime, PrismaClient will use the driver adapter pattern.
 */

export default {
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ||
        'postgresql://user:password@localhost:5432/ptah_licenses',
    },
  },
};
