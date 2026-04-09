# Production Hardening for NestJS

## Overview

Production hardening transforms a working NestJS application into one that is secure, observable, and resilient. This guide covers the `main.ts` bootstrap configuration, rate limiting, logging, health checks, memory management, and security headers.

---

## main.ts Production Setup

The bootstrap file is where all global middleware, pipes, and configuration converge. Order matters.

```typescript
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import cookieParser = require('cookie-parser');

async function bootstrap() {
  // 1. Environment-driven log levels
  const isProduction = process.env['NODE_ENV'] === 'production';
  const logLevels: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[] = isProduction ? ['log', 'error', 'warn'] : ['log', 'error', 'warn', 'debug', 'verbose'];

  // 2. Create app with raw body for webhook signature verification
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: logLevels,
  });

  // 3. Cookie parser (for auth sessions, PKCE state, CSRF tokens)
  app.use(cookieParser());

  // 4. Global validation pipeline
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw on unknown properties
      transform: true, // Auto-transform payloads to DTO types
    }),
  );

  // 5. CORS (restrict to known frontend URL)
  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-API-Key'],
  });

  // 6. Global prefix with webhook exclusions
  app.setGlobalPrefix('api', {
    // Webhooks need raw body at a known path, not behind /api
    exclude: ['webhooks/{*path}'],
  });

  // 7. Start
  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  Logger.log(`Application running on http://localhost:${port}/api`);
  Logger.log(`Environment: ${isProduction ? 'production' : 'development'}`);
}

bootstrap();
```

### Configuration Decisions

| Setting                      | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `rawBody: true`              | Preserves unparsed request body for HMAC webhook verification   |
| `whitelist: true`            | Prevents mass assignment attacks by stripping unknown fields    |
| `forbidNonWhitelisted: true` | Returns 400 if client sends unexpected fields                   |
| `transform: true`            | Converts query string params to proper types (string to number) |
| `credentials: true`          | Allows cookies in cross-origin requests                         |
| Webhook exclusion            | Webhook providers send to root paths, not prefixed ones         |

---

## Rate Limiting

### Setup with @nestjs/throttler

```bash
npm install @nestjs/throttler
```

### Global Configuration in AppModule

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    // Default: 100 requests per minute per IP
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute window (milliseconds)
        limit: 100, // Max requests per window
      },
    ]),
  ],
  providers: [
    // Apply rate limiting globally to all routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
```

### Per-Endpoint Overrides

```typescript
import { Controller, Post, Get } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';

@Controller('licenses')
export class LicenseController {
  // Stricter limit for verification (prevent brute-force)
  @Throttle([{ name: 'default', limit: 10, ttl: 60000 }])
  @Post('verify')
  async verifyLicense() {
    // 10 requests per minute max
  }

  // Admin endpoints: moderate limit
  @Throttle([{ name: 'default', limit: 30, ttl: 60000 }])
  @Get('admin/stats')
  async getStats() {
    // 30 requests per minute max
  }

  // Skip rate limiting for internal health checks
  @SkipThrottle()
  @Get('health')
  async health() {
    return { status: 'ok' };
  }
}
```

### Rate Limit Guidelines

| Endpoint Type        | Suggested Limit | Rationale                           |
| -------------------- | --------------- | ----------------------------------- |
| General API          | 100/min         | Normal usage baseline               |
| Authentication       | 10-20/min       | Prevent credential stuffing         |
| License verification | 10/min          | Prevent brute-force key guessing    |
| Admin endpoints      | 30/min          | Lower traffic, moderate protection  |
| Webhooks             | Skip or high    | Providers send bursts during events |
| Health checks        | Skip            | Called frequently by orchestrators  |

---

## Environment-Driven Logging

### Log Level Strategy

```typescript
// Determine log levels before creating the app
const isProduction = process.env['NODE_ENV'] === 'production';

const logLevels: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[] = isProduction
  ? ['log', 'error', 'warn'] // Production: essentials only
  : ['log', 'error', 'warn', 'debug', 'verbose']; // Development: full detail
```

### What Each Level Is For

| Level     | Production | Use Case                                              |
| --------- | ---------- | ----------------------------------------------------- |
| `error`   | Yes        | Unrecoverable failures, exceptions                    |
| `warn`    | Yes        | Degraded state, approaching limits                    |
| `log`     | Yes        | Business events (user created, payment processed)     |
| `debug`   | No         | Request details, query parameters, intermediate state |
| `verbose` | No         | Full request/response bodies, internal state dumps    |

### Using Logger in Services

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PaymentService {
  // Named logger for filtering in production
  private readonly logger = new Logger(PaymentService.name);

  async processPayment(paymentId: string) {
    this.logger.log(`Processing payment: ${paymentId}`); // Always visible
    this.logger.debug(`Payment details: ${JSON.stringify(details)}`); // Dev only
    this.logger.verbose(`Full request context: ...`); // Dev only

    try {
      // ... process payment
    } catch (error) {
      this.logger.error(`Payment failed: ${paymentId}`, error.stack);
      throw error;
    }
  }
}
```

### Important: Never Use console.log

```typescript
// WRONG: No timestamp, no context, no level filtering
console.log('Payment processed');

// CORRECT: Structured, filterable, includes class name
this.logger.log('Payment processed');
// Output: [PaymentService] Payment processed
```

---

## Health Check Endpoint

### Simple Health Check (Recommended Start)

The simplest approach uses an existing route that exercises the application stack:

```typescript
@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async healthCheck() {
    // This is the root /api endpoint
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

### Health Check with Database Connectivity

For more thorough checks, add a dedicated health controller that verifies database connectivity:

```typescript
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'degraded', timestamp: new Date().toISOString() };
    }
  }
}
```

### Docker Health Check

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api || exit 1
```

The `start-period` gives the app time to run migrations and start up before health checks begin failing.

---

## Memory Management

### Container Memory Limits

Node.js defaults to a heap limit based on system memory. In containers, this can cause OOM kills because Node.js sees the host memory, not the container limit.

```dockerfile
# For a 512MB container, set heap to ~85-90% of limit
ENV NODE_OPTIONS="--max-old-space-size=450"

# For a 1GB container
# ENV NODE_OPTIONS="--max-old-space-size=900"

# For a 2GB container
# ENV NODE_OPTIONS="--max-old-space-size=1800"
```

### Why 85-90%?

The remaining 10-15% is needed for:

- Node.js overhead outside V8 heap (buffers, native code)
- Prisma query engine memory
- OS-level allocations within the container

### Monitoring Memory

Use `process.memoryUsage()` to log heap and RSS periodically in production. If `heapUsed` approaches `max-old-space-size`, the container is at risk of OOM.

---

## Security Headers

### Helmet Middleware

```bash
npm install helmet
```

```typescript
import helmet from 'helmet';

// In bootstrap(), before other middleware:
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
  }),
);
```

Use helmet with defaults for API-only backends. If behind a reverse proxy that already sets security headers, avoid duplicates.

### Headers Helmet Sets

| Header                            | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `Strict-Transport-Security`       | Force HTTPS                               |
| `X-Content-Type-Options: nosniff` | Prevent MIME type sniffing                |
| `X-Frame-Options: DENY`           | Prevent clickjacking                      |
| `X-XSS-Protection: 0`             | Disable legacy XSS filter (CSP is better) |
| `Content-Security-Policy`         | Control resource loading sources          |

---

## Production Configuration

### Environment Variables

```bash
# Required
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@host:5432/dbname
FRONTEND_URL=https://myapp.com
JWT_SECRET=<generate-strong-random-string>
WEBHOOK_SECRET=<from-payment-provider>

# Recommended
NODE_OPTIONS="--max-old-space-size=450"
```

### ConfigModule Pattern

```typescript
// app.module.ts - make ConfigService available globally
ConfigModule.forRoot({ isGlobal: true });

// In any service - type-safe access with defaults
const port = this.config.get<number>('PORT', 3000);
const dbUrl = this.config.getOrThrow<string>('DATABASE_URL'); // throws if missing
```

---

## Summary: Bootstrap Order

The order of middleware and configuration in `main.ts` matters:

```
1. Log levels          -> Configured before app creation
2. NestFactory.create  -> rawBody: true for webhooks
3. cookieParser()      -> Before any route handling
4. ValidationPipe      -> Global input validation
5. CORS                -> Before route registration
6. Global prefix       -> With webhook exclusions
7. app.listen()        -> Start accepting requests
```

Each step builds on the previous. Changing the order can cause subtle issues (e.g., CORS headers missing from validation error responses if CORS is applied after pipes).
