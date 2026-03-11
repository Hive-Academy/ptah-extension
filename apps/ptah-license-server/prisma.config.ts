import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file from the app directory for local development
// Docker environments set DATABASE_URL directly via docker-compose.yml
config({ path: resolve(__dirname, '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] || '',
  },
});
