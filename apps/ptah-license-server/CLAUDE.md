# Ptah License Server

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **ptah-license-server** is a NestJS backend application that handles license verification, subscription management, and payment processing for Ptah Extension premium features.

## Boundaries

**Belongs here**:

- License generation and verification
- Subscription management (create, update, cancel)
- Payment processing (Paymob integration)
- User authentication and authorization
- License API endpoints
- Database operations (PostgreSQL)

**Does NOT belong**:

- VS Code extension UI (belongs in ptah-extension-vscode)
- Frontend components (belongs in other apps)
- Extension business logic (belongs in backend libraries)

## Key Files

### Entry Point

- `src/main.ts` - NestJS bootstrap and server configuration

### Modules

- `src/app.module.ts` - Root module with imports
- `src/license/` - License management module
- `src/auth/` - Authentication module
- `src/payment/` - Payment processing module
- `src/subscription/` - Subscription management module

### Configuration

- `webpack.config.js` - Webpack bundling
- `tsconfig.app.json` - TypeScript configuration
- `.env` - Environment variables (DATABASE_URL, PAYMOB_API_KEY, etc.)

## Tech Stack

- **Framework**: NestJS 11
- **Database**: PostgreSQL (via Prisma or TypeORM)
- **Authentication**: JWT tokens
- **Payment Gateway**: Paymob
- **API**: RESTful endpoints
- **Build**: Webpack + esbuild

## Architecture

```
┌────────────────────────────────────────────────┐
│  Ptah License Server (NestJS)                   │
├────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────┐    ┌──────────────┐          │
│  │ Auth Module  │    │ License      │          │
│  │ (JWT)        │───▶│ Module       │          │
│  └──────────────┘    └──────────────┘          │
│         │                    │                  │
│         ▼                    ▼                  │
│  ┌──────────────┐    ┌──────────────┐          │
│  │ User         │    │ Subscription │          │
│  │ Management   │◀───│ Module       │          │
│  └──────────────┘    └──────────────┘          │
│         │                    │                  │
│         └────────┬───────────┘                  │
│                  ▼                               │
│          ┌──────────────┐                       │
│          │ PostgreSQL   │                       │
│          │ Database     │                       │
│          └──────────────┘                       │
│                                                 │
│  External Integration:                          │
│  └─▶ Paymob Payment Gateway                    │
└────────────────────────────────────────────────┘
```

## API Endpoints

### Authentication

- `POST /auth/register` - Register new user
- `POST /auth/login` - Login and get JWT token
- `POST /auth/refresh` - Refresh access token

### Licenses

- `GET /licenses/:id` - Get license details
- `POST /licenses` - Create new license
- `POST /licenses/verify` - Verify license key
- `DELETE /licenses/:id` - Revoke license

### Subscriptions

- `GET /subscriptions/user/:userId` - Get user subscriptions
- `POST /subscriptions` - Create subscription
- `PUT /subscriptions/:id` - Update subscription
- `DELETE /subscriptions/:id` - Cancel subscription

### Payments

- `POST /payments/webhook` - Paymob payment webhook
- `POST /payments/initiate` - Initiate payment
- `GET /payments/:id/status` - Check payment status

## Dependencies

### External NPM Packages

- `@nestjs/common` - NestJS framework
- `@nestjs/core` - NestJS core
- `@nestjs/platform-express` - Express adapter
- `@nestjs/config` - Configuration module
- `@nestjs/jwt` - JWT utilities
- `@workos-inc/node` - WorkOS SDK (optional SSO)
- `axios` - HTTP client (Paymob integration)
- `class-validator` - DTO validation
- `class-transformer` - Object transformation

## Commands

```bash
# Development
nx serve ptah-license-server     # Start dev server
nx build ptah-license-server --watch

# Build
nx build ptah-license-server     # Production build

# Quality Gates
nx lint ptah-license-server      # Lint code
nx test ptah-license-server      # Run tests

# Database
npx prisma migrate dev           # Run migrations (if using Prisma)
npx prisma studio                # Open database GUI
```

## Environment Variables

Create `.env` file in project root:

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/ptah_licenses"

# JWT
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d

# Paymob
PAYMOB_API_KEY=your-paymob-api-key
PAYMOB_INTEGRATION_ID=your-integration-id
PAYMOB_IFRAME_ID=your-iframe-id

# WorkOS (Optional)
WORKOS_API_KEY=your-workos-api-key
WORKOS_CLIENT_ID=your-client-id
```

## Database Schema

### Users Table

- `id` - UUID (primary key)
- `email` - String (unique)
- `password_hash` - String
- `created_at` - Timestamp
- `updated_at` - Timestamp

### Licenses Table

- `id` - UUID (primary key)
- `key` - String (unique, indexed)
- `user_id` - UUID (foreign key → users.id)
- `type` - Enum (trial, pro, enterprise)
- `status` - Enum (active, expired, revoked)
- `expires_at` - Timestamp
- `created_at` - Timestamp

### Subscriptions Table

- `id` - UUID (primary key)
- `user_id` - UUID (foreign key → users.id)
- `license_id` - UUID (foreign key → licenses.id)
- `plan` - Enum (monthly, yearly)
- `status` - Enum (active, cancelled, past_due)
- `current_period_end` - Timestamp
- `created_at` - Timestamp

### Payments Table

- `id` - UUID (primary key)
- `subscription_id` - UUID (foreign key → subscriptions.id)
- `amount` - Decimal
- `currency` - String (EGP, USD)
- `status` - Enum (pending, completed, failed)
- `payment_gateway_id` - String (Paymob transaction ID)
- `created_at` - Timestamp

## Deployment

### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/apps/ptah-license-server ./
CMD ["node", "main.js"]
```

### Production Checklist

- [ ] Set strong JWT secret
- [ ] Configure PostgreSQL connection pooling
- [ ] Enable CORS for allowed origins only
- [ ] Set up SSL/TLS certificates
- [ ] Configure rate limiting
- [ ] Set up monitoring (Sentry, DataDog)
- [ ] Enable request logging
- [ ] Configure backup strategy for database
- [ ] Test payment webhook handling
- [ ] Set up CI/CD pipeline

## Security Guidelines

1. **Authentication**: Always use JWT for protected routes
2. **Input Validation**: Validate all DTOs with class-validator
3. **SQL Injection**: Use parameterized queries (ORM handles this)
4. **Rate Limiting**: Throttle API requests to prevent abuse
5. **HTTPS Only**: Force HTTPS in production
6. **Secrets**: Never commit .env files, use environment variables

## Testing

```bash
# Unit tests
nx test ptah-license-server

# E2E tests
nx test ptah-license-server-e2e

# Manual API testing
# Use Postman/Insomnia with collection
```

## Related Documentation

- [VS Code Extension](../ptah-extension-vscode/CLAUDE.md)
- [E2E Tests](../ptah-license-server-e2e/CLAUDE.md)
