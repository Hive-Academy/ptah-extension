import { defineConfig } from 'prisma/config';

// Note: DATABASE_URL is set by docker-compose.yml environment directive
// or by the local .env file for local development
// No need to import dotenv - environment variables are already available

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] || '',
  },
});
