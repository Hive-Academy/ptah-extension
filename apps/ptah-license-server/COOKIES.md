# Authentication Cookie Convention

## Overview

The Ptah License Server uses a **SINGLE unified** HTTP-only authentication cookie for all authentication flows.

---

## Cookie: `ptah_auth`

**Purpose**: JWT-based authentication for all application features

**Set By**:

- `GET /auth/callback` - WorkOS OAuth callback
- `POST /auth/login/email` - Email/password login
- `POST /auth/verify-email` - Email verification after signup
- `GET /auth/verify?token=...` - Magic link verification
- `GET /auth/oauth/:provider` → `/auth/callback` - Direct OAuth (GitHub/Google)

**Validated By**:

- `JwtAuthGuard` (checks `request.cookies?.ptah_auth`)

**Used For**:

- All authenticated endpoints
- Any endpoint decorated with `@UseGuards(JwtAuthGuard)`

---

## Cookie Properties

```typescript
{
  httpOnly: true,              // Prevents JavaScript access (XSS protection)
  secure: isProduction,        // HTTPS only in production
  sameSite: 'lax',            // CSRF protection while allowing redirects
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',                  // Available to all routes
}
```

---

## Logout Behavior

**Endpoint**: `POST /auth/logout`

**Clears the cookie**:

```typescript
res.clearCookie('ptah_auth', { ... });
```

---

## Authentication Flows

All authentication flows use the same `ptah_auth` cookie:

### 1. WorkOS OAuth Flow

```
User → GET /auth/login → WorkOS → GET /auth/callback → Sets ptah_auth
```

### 2. Email/Password Flow

```
User → POST /auth/login/email → Sets ptah_auth
```

### 3. Magic Link Flow

```
User → POST /auth/magic-link → Email → GET /auth/verify → Sets ptah_auth
```

### 4. Direct OAuth (GitHub/Google)

```
User → GET /auth/oauth/github → GitHub → GET /auth/callback → Sets ptah_auth
```

---

## Guard Usage

All protected endpoints use the same guard:

```typescript
@Get('protected-route')
@UseGuards(JwtAuthGuard)
async protectedRoute(@Req() request: Request) {
  const userId = request.user.id;
  // ...
}
```

---

## Common Issues & Solutions

### Issue: "No authentication token provided"

**Symptom**: 401 Unauthorized with message "No authentication token provided"

**Cause**: User not authenticated or cookie expired

**Solution**:

1. Check browser DevTools → Application → Cookies
2. Verify `ptah_auth` cookie exists
3. Verify the cookie hasn't expired
4. Verify `withCredentials: true` is set in HTTP client

### Issue: Cookie not being sent with requests

**Symptom**: Guard receives `undefined` for cookie value

**Cause**: Missing `withCredentials: true` in HTTP client configuration

**Solution**: Ensure Angular HTTP client has `withCredentials: true`:

```typescript
// Frontend interceptor
const apiReq = req.clone({
  url: `${environment.apiBaseUrl}${req.url}`,
  withCredentials: true, // Required for cookies
});
```

---

## Related Files

### Backend (NestJS)

- **Auth Controller**: `apps/ptah-license-server/src/app/auth/auth.controller.ts`
- **JwtAuthGuard**: `apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts`
- **License Controller**: `apps/ptah-license-server/src/license/controllers/license.controller.ts`

### Frontend (Angular)

- **API Interceptor**: `apps/ptah-landing-page/src/app/interceptors/api.interceptor.ts`
- **Auth Service**: `apps/ptah-landing-page/src/app/services/auth.service.ts`
- **Profile Page**: `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts`

---

**Last Updated**: 2026-01-26
**Version**: 2.0.0 (Unified single-cookie approach)
