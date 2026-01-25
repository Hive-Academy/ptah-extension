# Authentication Cookie Naming Convention

**CRITICAL**: This document defines the cookie naming convention for the Ptah License Server.

## Overview

The Ptah License Server uses **TWO SEPARATE** HTTP-only authentication cookies for different authentication flows. Mixing these cookie names will cause authentication failures.

---

## Cookie Naming Convention

### 1. `access_token` - WorkOS OAuth Flow (Main Application)

**Purpose**: Main application authentication using WorkOS OAuth

**Set By**:

- `POST /auth/callback` - WorkOS OAuth callback
- `POST /auth/login/email` - Email/password login
- `POST /auth/verify-email` - Email verification after signup
- `GET /auth/oauth/:provider` → `/auth/callback` - Direct OAuth (GitHub/Google)

**Validated By**:

- `JwtAuthGuard` (checks `request.cookies?.access_token`)

**Used For**:

- All main application authenticated endpoints
- Any endpoint decorated with `@UseGuards(JwtAuthGuard)`

**Code Reference**:

- Guard: `apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts:40`
- Set: `apps/ptah-license-server/src/app/auth/auth.controller.ts:252,526,619`

---

### 2. `ptah_auth` - Magic Link Portal Flow (Customer Portal)

**Purpose**: Customer portal authentication using passwordless magic links

**Set By**:

- `GET /auth/verify?token=...` - Magic link verification

**Validated By**:

- `PtahJwtAuthGuard` (checks `request.cookies?.ptah_auth || request.cookies?.access_token`)

**Used For**:

- Customer portal endpoints (e.g., `/profile` dashboard)
- `GET /api/v1/licenses/me` - Customer license details

**Important Note**:
The `PtahJwtAuthGuard` accepts BOTH `ptah_auth` and `access_token` cookies. This means users can access the customer portal regardless of how they logged in (magic link, OAuth, or email/password).

**Code Reference**:

- Guard: `apps/ptah-license-server/src/app/auth/guards/ptah-jwt-auth.guard.ts:44`
- Set: `apps/ptah-license-server/src/app/auth/auth.controller.ts:442`

---

---

## Why Two Cookies?

You might wonder: "Why have two separate cookies if `PtahJwtAuthGuard` accepts both?"

**Answer**: Different authentication flows for different use cases:

### Main Application Flow (`access_token`)

- **Used when**: Building a full application with WorkOS SSO
- **Features**: WorkOS user management, organization support, role-based access
- **Cookie**: `access_token`
- **Guard**: `JwtAuthGuard` (strict - only accepts `access_token`)

### Customer Portal Flow (`ptah_auth`)

- **Used when**: Simple customer portal for license management
- **Features**: Passwordless login, no organization needed, simple UX
- **Cookie**: `ptah_auth` (preferred) or `access_token` (fallback)
- **Guard**: `PtahJwtAuthGuard` (flexible - accepts both cookies)

**Key Insight**:

- If you log in via Google OAuth or email/password, you get `access_token` cookie
- You can still access the `/profile` page because `PtahJwtAuthGuard` accepts `access_token` as fallback
- You don't need to request a magic link if you're already authenticated!

---

## Cookie Properties (Both Cookies)

All authentication cookies use the same security configuration:

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

**Clears BOTH cookies** to ensure complete session termination:

```typescript
res.clearCookie('access_token', { ... });
res.clearCookie('ptah_auth', { ... });
```

**Code Reference**: `apps/ptah-license-server/src/app/auth/auth.controller.ts:289-312`

---

## Authentication Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Authentication Flows                          │
└─────────────────────────────────────────────────────────────────┘

WorkOS OAuth Flow (access_token):
┌──────────┐   GET /auth/login    ┌────────┐   POST /auth/callback   ┌────────┐
│ User     │ ──────────────────> │ Server │ ────────────────────────> │ Server │
│          │   (redirect to      │        │   (code + state)          │        │
│          │    WorkOS)           │        │                           │        │
└──────────┘                      └────────┘                           └────────┘
                                                                           │
                                                                           │ Set cookie:
                                                                           │ access_token
                                                                           ▼
                                                                      ┌────────┐
                                                                      │ User   │
                                                                      │ Login  │
                                                                      └────────┘

Magic Link Portal Flow (ptah_auth):
┌──────────┐  POST /auth/magic-link  ┌────────┐   Email with link   ┌────────┐
│ User     │ ──────────────────────> │ Server │ ─────────────────────>│ Email  │
│          │   { email }             │        │                       │        │
└──────────┘                         └────────┘                       └────────┘
                                                                           │
                                                                           │ User clicks
                                                                           │ magic link
                                                                           ▼
┌──────────┐  GET /auth/verify?token=...  ┌────────┐
│ Browser  │ ──────────────────────────────>│ Server │
│          │                               │        │
└──────────┘                               └────────┘
                                                │
                                                │ Set cookie:
                                                │ ptah_auth
                                                ▼
                                           ┌────────┐
                                           │ Portal │
                                           │ Login  │
                                           └────────┘
```

---

## Guard Selection Guide

When protecting an endpoint, choose the appropriate guard:

### Use `JwtAuthGuard` when:

- Endpoint is part of the main application
- Users authenticate via WorkOS OAuth
- Users authenticate via email/password signup
- Users authenticate via direct OAuth (GitHub/Google)

**Example**:

```typescript
@Get('protected-route')
@UseGuards(JwtAuthGuard)
async protectedRoute(@Req() request: Request) {
  const userId = request.user.id;
  // ...
}
```

### Use `PtahJwtAuthGuard` when:

- Endpoint is part of the customer portal
- Users authenticate via magic link
- Endpoint serves the `/profile` dashboard or similar portal features

**Example**:

```typescript
@Get('me')
@UseGuards(PtahJwtAuthGuard)
async getMyLicense(@Req() request: Request) {
  const userId = request.user.id;
  // ...
}
```

---

## Common Issues & Solutions

### Issue: "No authentication token provided"

**Symptom**: 401 Unauthorized with message "No authentication token provided"

**Cause**: Wrong guard used for the authentication flow

**Solution**: Verify the cookie name matches the guard:

- If using `JwtAuthGuard`, ensure endpoint was accessed after WorkOS OAuth login (sets `access_token`)
- If using `PtahJwtAuthGuard`, ensure endpoint was accessed after magic link verification (sets `ptah_auth`)

### Issue: Cookie not being sent with requests

**Symptom**: Guard receives `undefined` for cookie value

**Cause**: Missing `withCredentials: true` in HTTP client configuration

**Solution**: Ensure Angular HTTP client has `withCredentials: true`:

```typescript
// Frontend interceptor
const apiReq = req.clone({
  url: `${environment.apiBaseUrl}${req.url}`,
  withCredentials: true, // ✅ Required for cookies
});
```

**Code Reference**: `apps/ptah-landing-page/src/app/interceptors/api.interceptor.ts:32`

---

## Testing Authentication

### Test WorkOS OAuth Flow (`access_token`)

1. Navigate to `/auth/login`
2. Complete WorkOS authentication
3. Verify cookie set: `access_token`
4. Test protected endpoint with `@UseGuards(JwtAuthGuard)`

### Test Magic Link Portal Flow (`ptah_auth`)

1. Navigate to `/login` (frontend)
2. Enter email and request magic link
3. Click link in email
4. Verify cookie set: `ptah_auth`
5. Navigate to `/profile`
6. Verify license data loads from `GET /api/v1/licenses/me`

---

## Maintenance Notes

**When adding new authentication endpoints**:

1. Decide which authentication flow the endpoint belongs to
2. Choose the appropriate guard (`JwtAuthGuard` or `PtahJwtAuthGuard`)
3. Set the correct cookie name when issuing JWT tokens
4. Document the endpoint in this file under the appropriate cookie section

**When debugging authentication issues**:

1. Check browser DevTools → Application → Cookies
2. Verify the correct cookie exists (`access_token` or `ptah_auth`)
3. Verify the cookie properties (httpOnly, secure, sameSite, domain, path)
4. Verify the guard expects the same cookie name
5. Verify `withCredentials: true` is set in HTTP client

---

## Related Files

### Backend (NestJS)

- **Auth Controller**: `apps/ptah-license-server/src/app/auth/auth.controller.ts`
- **JwtAuthGuard**: `apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts`
- **PtahJwtAuthGuard**: `apps/ptah-license-server/src/app/auth/guards/ptah-jwt-auth.guard.ts`
- **License Controller**: `apps/ptah-license-server/src/license/controllers/license.controller.ts`

### Frontend (Angular)

roperties (httpOnly, secure, sameSite, domain, path) 4. Verify the guard expects the same cookie name 5. Verify `withCredentials: true` is set in HTTP client

---

## Related Files

### Backend (NestJS)

- **Auth Controller**: `apps/ptah-license-server/src/app/auth/auth.controller.ts`
- **JwtAuthGuard**: `apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts`
- **PtahJwtAuthGuard**: `apps/ptah-license-server/src/app/auth/guards/ptah-jwt-auth.guard.ts`
- **License Controller**: `apps/ptah-license-server/src/license/controllers/license.controller.ts`

### Frontend (Angular)

- **API Interceptor**: `apps/ptah-landing-page/src/app/interceptors/api.interceptor.ts`
- **Auth Service**: `apps/ptah-landing-page/src/app/services/auth.service.ts`
- **Profile Page**: `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts`

---

**Last Updated**: 2026-01-25
**Version**: 1.0.0
