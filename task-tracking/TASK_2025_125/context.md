# Task Context - TASK_2025_125

## User Request

Implement rate limiting on the license server to protect the `/api/v1/licenses/verify` endpoint from abuse and DoS attacks.

## Task Type

FEATURE

## Complexity Assessment

Low-Medium - NestJS ThrottlerModule is well-documented and straightforward to implement.

## Background

From TASK_2025_124 security assessment:

- License keys have 256-bit entropy (cryptographically secure)
- Brute-force attacks are mathematically impossible
- However, the verify endpoint has NO rate limiting
- This creates DoS vulnerability and violates security best practices

## Requirements

### Primary Goals

1. Add `@nestjs/throttler` package to license server
2. Configure global rate limiting (fallback protection)
3. Add stricter per-endpoint rate limiting on `/api/v1/licenses/verify`
4. Ensure admin endpoints have appropriate limits

### Rate Limiting Configuration

| Endpoint | Limit | Window | Rationale |
|----------|-------|--------|-----------|
| Global (default) | 100 req | 1 minute | General protection |
| `/api/v1/licenses/verify` | 10 req | 1 minute | Stricter for license checks |
| `/api/v1/admin/*` | 30 req | 1 minute | Admin operations |
| `/api/v1/auth/*` | 20 req | 1 minute | Auth operations |

### Secondary Goals (from security assessment)

1. Fix timing attack in `admin-api-key.guard.ts` using `crypto.timingSafeEqual()`
2. Add request logging for security monitoring (optional)

## Related Tasks

- TASK_2025_124: Subscription Enforcement Audit (identified this gap)
- TASK_2025_121: Two-Tier Paid Extension Model

## Files Affected

- `apps/ptah-license-server/package.json` - Add @nestjs/throttler dependency
- `apps/ptah-license-server/src/app.module.ts` - Configure ThrottlerModule
- `apps/ptah-license-server/src/license/controllers/license.controller.ts` - Add @Throttle decorator
- `apps/ptah-license-server/src/license/guards/admin-api-key.guard.ts` - Fix timing attack

## Created

2026-01-27
