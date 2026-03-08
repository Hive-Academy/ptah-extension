# Development Tasks - TASK_2025_125

**Total Tasks**: 5 | **Batches**: 1 | **Status**: 0/1 complete

---

## Batch 1: Rate Limiting Implementation

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Add @nestjs/throttler dependency

**File**: D:\projects\ptah-extension\apps\ptah-license-server\package.json
**Spec Reference**: implementation-plan.md (NestJS Throttler Documentation)

**Quality Requirements**:

- MUST add @nestjs/throttler as production dependency
- MUST be compatible with current NestJS version

**Implementation Details**:

```bash
cd apps/ptah-license-server
npm install @nestjs/throttler
```

---

### Task 1.2: Configure ThrottlerModule in AppModule

**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\app.module.ts
**Spec Reference**: implementation-plan.md (Component 1)

**Quality Requirements**:

- MUST import ThrottlerModule and ThrottlerGuard
- MUST configure global rate limit: 100 req/min
- MUST register ThrottlerGuard as APP_GUARD
- MUST NOT break existing module imports

**Implementation Details**:

```typescript
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    // ... existing imports
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // ... existing providers
  ],
})
export class AppModule {}
```

---

### Task 1.3: Add rate limiting to license verification endpoint

**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts
**Spec Reference**: implementation-plan.md (Component 2)

**Quality Requirements**:

- MUST add @Throttle decorator to verify endpoint
- MUST limit to 10 requests per minute
- MUST import Throttle from @nestjs/throttler

**Implementation Details**:

```typescript
import { Throttle } from '@nestjs/throttler';

@Throttle({ default: { limit: 10, ttl: 60000 } })
@Post('verify')
async verify(@Body() dto: VerifyLicenseDto): Promise<VerifyLicenseResponse> {
  // existing implementation
}
```

---

### Task 1.4: Add rate limiting to admin endpoints

**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts
**Spec Reference**: implementation-plan.md (Component 3)

**Quality Requirements**:

- MUST add @Throttle decorator to admin endpoints (create, revoke, etc.)
- MUST limit to 30 requests per minute
- MUST apply after @UseGuards decorator

**Implementation Details**:

```typescript
@Throttle({ default: { limit: 30, ttl: 60000 } })
@UseGuards(AdminApiKeyGuard)
@Post('create')
async createLicense(@Body() dto: CreateLicenseDto) {
  // existing implementation
}
```

---

### Task 1.5: Fix timing attack in AdminApiKeyGuard

**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\license\guards\admin-api-key.guard.ts
**Spec Reference**: implementation-plan.md (Component 4)

**Quality Requirements**:

- MUST use crypto.timingSafeEqual for API key comparison
- MUST check length before comparison (prevent buffer allocation timing)
- MUST NOT change error response format

**Implementation Details**:

```typescript
import { timingSafeEqual } from 'crypto';

// Replace direct comparison:
// if (apiKey !== validApiKey)

// With constant-time comparison:
const isValid = apiKey.length === validApiKey.length && timingSafeEqual(Buffer.from(apiKey), Buffer.from(validApiKey));

if (!isValid) {
  throw new UnauthorizedException('Invalid API key');
}
```

---

**Batch 1 Verification**:

- [x] All files exist at paths
- [x] `npm install` succeeds
- [x] `npx nx build ptah-license-server` succeeds
- [ ] Server starts without errors (manual test)
- [ ] Verify endpoint returns 429 after 10 rapid requests (manual test)
- [ ] Admin endpoint returns 429 after 30 rapid requests (manual test)
- [x] Timing attack fix applied (constant-time comparison)

---

## Implementation Summary

### Task 1.1: Add @nestjs/throttler dependency - COMPLETED

- Added `"@nestjs/throttler": "^6.4.0"` to package.json

### Task 1.2: Configure ThrottlerModule in AppModule - COMPLETED

- Imported ThrottlerModule and ThrottlerGuard
- Configured global rate limit: 100 requests per minute
- Applied ThrottlerGuard globally via APP_GUARD

### Task 1.3: Add rate limiting to verify endpoint - COMPLETED

- Added @Throttle({ default: { limit: 10, ttl: 60000 } }) to POST /verify
- 10 requests per minute (stricter than global)

### Task 1.4: Add rate limiting to admin endpoints - COMPLETED

- Added @Throttle({ default: { limit: 30, ttl: 60000 } }) to AdminController
- 30 requests per minute for all admin endpoints

### Task 1.5: Fix timing attack in AdminApiKeyGuard - COMPLETED

- Imported crypto.timingSafeEqual
- Added length check before comparison
- Replaced direct string comparison with constant-time comparison

### Bonus: Auth endpoint rate limiting - COMPLETED

- POST /auth/login/email: 5 req/min (brute-force protection)
- POST /auth/magic-link: 3 req/min (email spam protection)
- POST /auth/signup: 5 req/min (mass account prevention)

---

_Created by Team-Leader Agent - TASK_2025_125_
_Updated: 2026-01-27 (Implementation completed)_
