# Implementation Plan - TASK_2025_125: License Server Rate Limiting

## Codebase Investigation Summary

### Files to Modify

- `apps/ptah-license-server/package.json` - Add dependency
- `apps/ptah-license-server/src/app.module.ts` - Configure ThrottlerModule
- `apps/ptah-license-server/src/license/controllers/license.controller.ts` - Endpoint-specific limits
- `apps/ptah-license-server/src/license/guards/admin-api-key.guard.ts` - Fix timing attack
- `apps/ptah-license-server/src/app/auth/auth.controller.ts` - Auth endpoint limits

### NestJS Throttler Documentation

```typescript
// Installation
npm install @nestjs/throttler

// Module Configuration
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,    // Time window in milliseconds
      limit: 100,    // Max requests per window
    }]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

// Per-endpoint override
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Post('verify')
async verify() { ... }

// Skip throttling for specific endpoint
@SkipThrottle()
@Get('health')
async health() { ... }
```

---

## Architecture Design

### Component 1: ThrottlerModule Configuration

**Purpose**: Global rate limiting protection for all endpoints

**Location**: `apps/ptah-license-server/src/app.module.ts`

**Configuration**:

```typescript
ThrottlerModule.forRoot([
  {
    name: 'default',
    ttl: 60000, // 1 minute window
    limit: 100, // 100 requests per minute (default)
  },
]);
```

**Rationale**:

- 100 req/min is generous for normal usage
- Prevents obvious abuse without affecting legitimate users
- Can be overridden per-endpoint for sensitive operations

---

### Component 2: Verify Endpoint Rate Limiting

**Purpose**: Stricter protection for license verification

**Location**: `apps/ptah-license-server/src/license/controllers/license.controller.ts`

**Configuration**:

```typescript
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Post('verify')
async verify(@Body() dto: VerifyLicenseDto): Promise<VerifyLicenseResponse> {
  // ...
}
```

**Rationale**:

- 10 req/min is sufficient for normal extension usage
- Extension caches license status for 1 hour
- Prevents brute-force and DoS without impacting UX

---

### Component 3: Admin Endpoint Rate Limiting

**Purpose**: Protection for administrative operations

**Location**: `apps/ptah-license-server/src/license/controllers/license.controller.ts`

**Configuration**:

```typescript
@Throttle({ default: { limit: 30, ttl: 60000 } })
@UseGuards(AdminApiKeyGuard)
@Post('create')
async createLicense() { ... }
```

**Rationale**:

- Admin operations should be less frequent than user operations
- 30 req/min allows batch operations without abuse

---

### Component 4: Timing Attack Fix

**Purpose**: Prevent timing-based API key discovery

**Location**: `apps/ptah-license-server/src/license/guards/admin-api-key.guard.ts`

**Before**:

```typescript
if (apiKey !== validApiKey) {
  throw new UnauthorizedException('Invalid API key');
}
```

**After**:

```typescript
import { timingSafeEqual } from 'crypto';

const isValid = apiKey.length === validApiKey.length && timingSafeEqual(Buffer.from(apiKey), Buffer.from(validApiKey));

if (!isValid) {
  throw new UnauthorizedException('Invalid API key');
}
```

**Rationale**:

- `timingSafeEqual` prevents timing attacks by taking constant time
- Length check prevents buffer allocation timing leak

---

## Error Response Format

When rate limit is exceeded, NestJS Throttler returns:

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```

Headers included:

- `Retry-After: <seconds>`
- `X-RateLimit-Limit: <limit>`
- `X-RateLimit-Remaining: <remaining>`
- `X-RateLimit-Reset: <timestamp>`

---

## Files Affected Summary

| File                     | Change Type | Description                                    |
| ------------------------ | ----------- | ---------------------------------------------- |
| `package.json`           | ADD         | @nestjs/throttler dependency                   |
| `app.module.ts`          | MODIFY      | Import ThrottlerModule, configure global guard |
| `license.controller.ts`  | MODIFY      | Add @Throttle decorators to endpoints          |
| `admin-api-key.guard.ts` | MODIFY      | Use timingSafeEqual for comparison             |
| `auth.controller.ts`     | MODIFY      | Add @Throttle decorator (optional)             |

---

## Testing Strategy

### Manual Testing

1. **Verify endpoint rate limit**:

   ```bash
   # Should succeed
   for i in {1..10}; do curl -X POST http://localhost:3000/api/v1/licenses/verify -H "Content-Type: application/json" -d '{"licenseKey":"test"}'; done

   # 11th request should return 429
   curl -X POST http://localhost:3000/api/v1/licenses/verify -H "Content-Type: application/json" -d '{"licenseKey":"test"}'
   ```

2. **Global rate limit**:

   ```bash
   # Make 101 requests quickly - 101st should fail
   ```

3. **Timing attack fix**:
   - Measure response time for valid vs invalid API keys
   - Times should be statistically similar

### Unit Tests (Optional)

```typescript
describe('Rate Limiting', () => {
  it('should return 429 after exceeding limit', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).post('/api/v1/licenses/verify').send({ licenseKey: 'test' });
    }

    const response = await request(app.getHttpServer()).post('/api/v1/licenses/verify').send({ licenseKey: 'test' });

    expect(response.status).toBe(429);
  });
});
```

---

## Rollback Strategy

If rate limiting causes issues:

1. Remove `APP_GUARD` provider from `app.module.ts`
2. Remove `@Throttle` decorators from controllers
3. Keep ThrottlerModule imported (no-op without guard)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- NestJS backend work
- Security-focused changes
- No frontend impact

### Complexity Assessment

**Complexity**: LOW
**Estimated Effort**: 1-2 hours

**Breakdown**:

- Add dependency: 5 min
- Configure ThrottlerModule: 15 min
- Add endpoint decorators: 15 min
- Fix timing attack: 15 min
- Testing: 30-45 min

---

_Architecture designed by Software Architect Agent - TASK_2025_125_
_Date: 2026-01-27_
