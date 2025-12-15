# Requirements Document - TASK_2025_075

**Project**: Ptah Simplified License Server (No Payment Integration)
**Created**: 2025-12-15
**Status**: Active
**Priority**: High
**Complexity**: Medium (3-4 days)

---

## Executive Summary

### Business Context

Ptah Extension requires a license verification system to enable premium features while postponing payment provider integration. This simplified license server supports manual early adopter distribution during the beta period, allowing the team to validate product-market fit before committing to a specific payment provider.

### Value Proposition

1. **Immediate Market Entry**: Launch premium tier without payment provider lock-in
2. **Early Adopter Program**: Manually distribute 2-month licenses to beta users
3. **Postpone Payment Decision**: Evaluate Paymob vs alternatives based on early adopter feedback
4. **Preserve Architecture**: Design remains extensible for future payment integration
5. **Minimal Complexity**: 2-table database vs 3-table payment-integrated design

### Strategic Alignment

This approach enables:

- Beta user onboarding within 1 week of completion
- Manual license distribution via admin API
- Customer portal for license management (no payment features)
- VS Code extension premium feature unlocking
- Future payment integration without database migration

---

## 1. Functional Requirements

### Requirement 1: License Verification API

**User Story**: As a VS Code extension, I want to verify a license key's validity and plan tier, so that I can unlock premium features for valid license holders.

#### Acceptance Criteria

1. **WHEN** the extension sends a POST request to `/api/v1/licenses/verify` with a valid license key **THEN** the API **SHALL** return `{ valid: true, tier: "early_adopter", plan: {...}, expiresAt: "2026-02-15T00:00:00Z", daysRemaining: 45 }` in under 200ms (p95)

2. **WHEN** the extension sends a license key that does not exist in the database **THEN** the API **SHALL** return `{ valid: false, tier: "free" }` with HTTP 200 status

3. **WHEN** the extension sends a license key with status "expired" **THEN** the API **SHALL** return `{ valid: false, tier: "free", reason: "expired" }` with expiration date

4. **WHEN** the extension sends a license key with status "revoked" **THEN** the API **SHALL** return `{ valid: false, tier: "free", reason: "revoked" }`

5. **WHEN** the license verification request is malformed (missing licenseKey field) **THEN** the API **SHALL** return HTTP 400 with validation error details

6. **WHEN** a free tier user (no license key) makes a verification request **THEN** the API **SHALL** return `{ valid: false, tier: "free" }` without database lookup

### Requirement 2: Admin License Generation API

**User Story**: As an admin, I want to create license keys for early adopters via API, so that I can manually distribute premium access during the beta period.

#### Acceptance Criteria

1. **WHEN** an admin sends a POST request to `/api/v1/admin/licenses` with valid API key header, email, and plan **THEN** the system **SHALL** create a user (if new), generate a license key with format `ptah_lic_{64-hex-chars}`, create a license record with 60-day expiration, and return `{ success: true, license: {...}, emailSent: true }`

2. **WHEN** the admin requests license creation for an existing user email **THEN** the system **SHALL** revoke any existing active licenses for that user and create a new license with fresh 60-day expiration

3. **WHEN** the `sendEmail` parameter is true **THEN** the system **SHALL** send an email to the user containing the license key and setup instructions within 10 seconds

4. **WHEN** the admin API key is missing or invalid **THEN** the API **SHALL** return HTTP 401 Unauthorized

5. **WHEN** the request body is invalid (missing email or invalid plan) **THEN** the API **SHALL** return HTTP 400 with validation error details

6. **WHEN** the email service fails **THEN** the system **SHALL** still create the license, return `{ success: true, license: {...}, emailSent: false, emailError: "..." }`, and log the error for manual follow-up

### Requirement 3: Magic Link Authentication

**User Story**: As a user, I want to log into the customer portal using a magic link sent to my email, so that I can manage my license without creating a password.

#### Acceptance Criteria

1. **WHEN** a user submits their email to `/api/v1/auth/magic-link` **THEN** the system **SHALL** generate a 64-character hex token with 30-second TTL, send an email with magic link `https://ptah.dev/auth/verify?token=...`, and return `{ success: true, message: "Check your email for login link" }`

2. **WHEN** a user clicks a valid magic link within 30 seconds **THEN** the system **SHALL** validate the token, consume it (single-use enforcement), set an HTTP-only JWT cookie with 7-day expiration, and redirect to `/portal/dashboard`

3. **WHEN** a user clicks an expired magic link (>30 seconds old) **THEN** the system **SHALL** redirect to `/auth/login?error=token_expired` with appropriate error message

4. **WHEN** a user clicks a magic link that has already been used **THEN** the system **SHALL** redirect to `/auth/login?error=token_already_used`

5. **WHEN** the JWT cookie is set **THEN** it **SHALL** have flags: `httpOnly: true`, `secure: true` (production), `sameSite: 'strict'`, `maxAge: 7 days`

6. **WHEN** the email for magic link does not exist in the users table **THEN** the system **SHALL** still send a generic success message (security: no email enumeration) but log the attempt

### Requirement 4: Customer Portal API

**User Story**: As a user, I want to view my license status and resend my license key email via the customer portal, so that I can manage my premium access.

#### Acceptance Criteria

1. **WHEN** an authenticated user (valid JWT cookie) sends GET request to `/api/v1/licenses/me` **THEN** the API **SHALL** return `{ plan: "early_adopter", status: "active", expiresAt: "2026-02-15T00:00:00Z", daysRemaining: 45, email: "user@example.com", createdAt: "..." }` in under 100ms

2. **WHEN** an authenticated user clicks "Resend License Key" (POST `/api/v1/licenses/resend`) **THEN** the system **SHALL** find the user's active license, send an email with the license key and instructions, and return `{ success: true, message: "License key email sent to user@example.com" }`

3. **WHEN** the license key is NEVER displayed in the portal UI or API responses **THEN** security requirement is satisfied (keys only sent via email)

4. **WHEN** an unauthenticated request is made to portal API endpoints **THEN** the API **SHALL** return HTTP 401 Unauthorized

5. **WHEN** the user has no active license **THEN** GET `/api/v1/licenses/me` **SHALL** return `{ plan: "free", status: "none", message: "No active license found" }` with HTTP 200

6. **WHEN** the email resend fails **THEN** the API **SHALL** return `{ success: false, error: "Email delivery failed. Please contact support." }` with HTTP 500

### Requirement 5: Hardcoded Plan Configuration

**User Story**: As the system, I want to enforce two hardcoded plans (Free and Early Adopter) without database plan configuration, so that I can simplify the architecture and postpone payment integration.

#### Acceptance Criteria

1. **WHEN** the system is queried for plan details **THEN** it **SHALL** return plan information from a hardcoded TypeScript constant `PLANS` object (not from database)

2. **WHEN** the plan is "free" **THEN** the plan details **SHALL** include `{ name: "Free", features: ["basic_cli_wrapper", "session_history"], expiresAfterDays: null, isPremium: false }`

3. **WHEN** the plan is "early_adopter" **THEN** the plan details **SHALL** include `{ name: "Early Adopter", features: ["all_premium_features", "sdk_access", "custom_tools"], expiresAfterDays: 60, futurePrice: 8, isPremium: true }`

4. **WHEN** an admin creates a license with an invalid plan name **THEN** the API **SHALL** return HTTP 400 with error `{ error: "Invalid plan. Allowed values: free, early_adopter" }`

5. **WHEN** the license verification response includes plan details **THEN** it **SHALL** merge the hardcoded plan information with the license record data

### Requirement 6: Email Notifications

**User Story**: As a user, I want to receive emails with my license key and setup instructions, so that I can activate my premium features in VS Code.

#### Acceptance Criteria

1. **WHEN** a new license is created via admin API **THEN** the system **SHALL** send an email with subject "Your Ptah Premium License Key" containing the license key, VS Code setup instructions, and customer portal URL

2. **WHEN** a user requests license key resend **THEN** the system **SHALL** send the same email template with subject "Ptah License Key (Resent)"

3. **WHEN** a user requests a magic link **THEN** the system **SHALL** send an email with subject "Login to Ptah Portal" containing a magic link valid for 30 seconds

4. **WHEN** an email fails to send after 3 retry attempts **THEN** the system **SHALL** log the failure with user email and license key for manual follow-up

5. **WHEN** emails are sent **THEN** they **SHALL** use SendGrid API with templates stored in `src/email/templates/` as Handlebars (.hbs) files

---

## 2. Non-Functional Requirements

### Performance Requirements

**API Response Time**:

- **License Verification**: 95% of requests under 200ms, 99% under 500ms
- **Magic Link Generation**: 95% of requests under 300ms (includes email queuing)
- **Portal API**: 95% of requests under 100ms (simple database queries)
- **Admin License Creation**: 95% of requests under 1000ms (includes user creation, license generation, email sending)

**Throughput**:

- **Concurrent Users**: Support 100 concurrent license verification requests (VS Code extension polling)
- **Admin API**: Support 10 concurrent license creation requests (manual admin usage)

**Database Performance**:

- **Query Latency**: 99% of database queries under 10ms
- **Index Optimization**: Indexes on `licenses.licenseKey`, `users.email`

### Security Requirements

**Authentication**:

- **Admin API**: X-API-Key header validation against `ADMIN_API_KEY` environment variable (256-bit random key)
- **Portal API**: JWT authentication with HTTP-only cookies (7-day expiration)
- **Magic Link**: 30-second TTL, single-use enforcement, 64-character hex tokens (256-bit entropy)

**Authorization**:

- **Admin Endpoints**: Require valid admin API key
- **Portal Endpoints**: Require valid JWT cookie with user ID extraction

**Data Protection**:

- **License Keys**: Never displayed in portal UI (only sent via email)
- **Environment Variables**: Store all secrets in `.env` file (DATABASE_URL, ADMIN_API_KEY, SENDGRID_API_KEY, JWT_SECRET)
- **HTTPS Only**: Force HTTPS in production (secure cookie flag)

**Input Validation**:

- **Email Format**: RFC 5322 email validation
- **License Key Format**: Must match `ptah_lic_[a-f0-9]{64}`
- **Plan Validation**: Enum validation ("free" | "early_adopter")

### Scalability Requirements

**Horizontal Scaling**:

- **Stateless Architecture**: Magic link tokens stored in-memory (suitable for single-instance deployment; note for multi-instance: migrate to Redis)
- **Database Connection Pooling**: PostgreSQL connection pool (min: 2, max: 10 connections)

**Data Growth**:

- **Users**: Support up to 10,000 users (early adopter phase)
- **Licenses**: Support up to 10,000 active licenses
- **Database Size**: Estimated 100MB for first 10,000 users

### Reliability Requirements

**Uptime**:

- **Target Availability**: 99.5% uptime (allows 3.6 hours downtime/month)
- **Graceful Degradation**: If email service fails, still create license and log error

**Error Handling**:

- **Database Errors**: Return HTTP 503 Service Unavailable with retry guidance
- **Email Errors**: Log error, return success with `emailSent: false` flag
- **Validation Errors**: Return HTTP 400 with detailed error messages

**Recovery**:

- **Database Backup**: Daily automated backups with 7-day retention
- **Email Retry**: 3 retry attempts with exponential backoff (1s, 2s, 4s)

### Maintainability Requirements

**Code Quality**:

- **TypeScript Strict Mode**: Enable strict type checking
- **No `any` Types**: Use proper TypeScript types throughout
- **ESLint Compliance**: Pass all linting rules
- **Test Coverage**: Minimum 70% unit test coverage for services

**Documentation**:

- **API Documentation**: OpenAPI/Swagger spec for all endpoints
- **Code Comments**: Document complex business logic (e.g., license expiration calculation)
- **Environment Variables**: Document all required environment variables in README

**Dependency Management**:

- **Prisma Version**: Use Prisma 7.1.0 with driver adapters (no Rust binary)
- **NestJS Version**: Use NestJS 11+ (existing in monorepo)
- **PostgreSQL Driver**: Use `@prisma/adapter-pg` with `pg@8.11.0`

---

## 3. User Stories

### User Story 1: VS Code Extension License Verification

**As a** VS Code extension developer
**I want** to verify license keys on extension activation
**So that** I can unlock premium features for valid license holders

**Acceptance Criteria**:

- Extension sends license key to `/api/v1/licenses/verify`
- API returns validity, tier, plan details, and expiration info in <200ms
- Invalid/expired licenses return `tier: "free"` without errors
- Extension caches verification result for 1 hour (reduce API calls)

### User Story 2: Admin License Distribution

**As an** admin
**I want** to create licenses for early adopters via API
**So that** I can manually distribute premium access during beta

**Acceptance Criteria**:

- Admin calls `/api/v1/admin/licenses` with email and plan
- System generates license key with format `ptah_lic_{64-hex}`
- System sends email with license key and setup instructions
- System returns license details for admin records
- Admin can revoke existing licenses by creating new ones for same email

### User Story 3: Customer Portal Access

**As a** user
**I want** to log into the customer portal via magic link
**So that** I can view my license status without a password

**Acceptance Criteria**:

- User submits email to `/api/v1/auth/magic-link`
- User receives email with magic link (30-second expiration)
- User clicks link and is auto-logged into portal
- Portal displays license plan, expiration date, days remaining
- User can request license key resend (email only, never displayed)

### User Story 4: Early Adopter Workflow

**As an** early adopter
**I want** to receive a 2-month premium license via email
**So that** I can test premium features before paying

**Acceptance Criteria**:

- Admin creates license via admin API with `plan: "early_adopter"`
- System generates license key valid for 60 days
- System sends email with license key and VS Code setup instructions
- User enters license key in VS Code settings (`ptah.licenseKey`)
- Extension unlocks premium features for 60 days
- User can access portal to view expiration date and resend license

### User Story 5: License Expiration Handling

**As a** user
**I want** clear feedback when my license expires
**So that** I know when to renew

**Acceptance Criteria**:

- When license expires, `/api/v1/licenses/verify` returns `{ valid: false, tier: "free", reason: "expired", expiredAt: "..." }`
- VS Code extension detects expired license and shows upgrade prompt
- Portal displays "License Expired" status with expired date
- Portal shows contact information for renewal (email/Twitter during beta)

---

## 4. Out of Scope (Postponed to TASK_2025_043)

The following features are **NOT** included in this simplified implementation:

### Payment Integration

- ❌ Paymob webhook integration (`POST /api/v1/webhooks/paymob`)
- ❌ Payment processing and subscription management
- ❌ Subscription renewal via payments
- ❌ Payment history tracking
- ❌ Subscription cancellation via API (Paymob integration)
- ❌ `subscriptions` table (removed from database schema)

### Advanced Features

- ❌ Automatic license renewal
- ❌ Subscription plan upgrades/downgrades
- ❌ Payment method management
- ❌ Invoice generation
- ❌ Revenue analytics
- ❌ Webhook retry logic
- ❌ HMAC signature validation (Paymob-specific)

### Future Enhancements (Not in Scope)

- ❌ Deep link activation (`vscode://ptah/activate?key=...`)
- ❌ License renewal reminder emails
- ❌ Admin dashboard UI (HTML interface)
- ❌ Multi-device license tracking
- ❌ License transfer between users
- ❌ Team/organization licenses

---

## 5. Database Schema

### Table 1: `users`

**Purpose**: Store user email addresses for license ownership.

| Column    | Type      | Constraints               | Description                    |
| --------- | --------- | ------------------------- | ------------------------------ |
| id        | UUID      | PRIMARY KEY, DEFAULT uuid | User unique identifier         |
| email     | VARCHAR   | UNIQUE, NOT NULL          | User email address (lowercase) |
| createdAt | TIMESTAMP | DEFAULT NOW()             | User registration timestamp    |

**Indexes**:

- PRIMARY KEY on `id`
- UNIQUE INDEX on `email`

### Table 2: `licenses`

**Purpose**: Store license keys with plan, status, and expiration.

| Column     | Type      | Constraints               | Description                                       |
| ---------- | --------- | ------------------------- | ------------------------------------------------- |
| id         | UUID      | PRIMARY KEY, DEFAULT uuid | License unique identifier                         |
| userId     | UUID      | FOREIGN KEY → users.id    | License owner (CASCADE DELETE)                    |
| licenseKey | VARCHAR   | UNIQUE, NOT NULL          | License key (format: ptah*lic*{64-hex})           |
| plan       | VARCHAR   | NOT NULL                  | Plan type (enum: "free" \| "early_adopter")       |
| status     | VARCHAR   | DEFAULT "active"          | Status (enum: "active" \| "expired" \| "revoked") |
| expiresAt  | TIMESTAMP | NULLABLE                  | Expiration date (NULL = never expires)            |
| createdAt  | TIMESTAMP | DEFAULT NOW()             | License creation timestamp                        |
| createdBy  | VARCHAR   | DEFAULT "admin"           | Admin audit trail (who created license)           |

**Indexes**:

- PRIMARY KEY on `id`
- UNIQUE INDEX on `licenseKey` (fast verification lookups)
- INDEX on `userId` (user license queries)
- INDEX on `status, expiresAt` (expired license cleanup queries)

**Constraints**:

- `plan` CHECK constraint: `plan IN ('free', 'early_adopter')`
- `status` CHECK constraint: `status IN ('active', 'expired', 'revoked')`
- Foreign key `userId` REFERENCES `users(id)` ON DELETE CASCADE

---

## 6. API Specification

### Endpoint 1: License Verification

**Endpoint**: `POST /api/v1/licenses/verify`

**Authentication**: None (public endpoint)

**Request Body**:

```typescript
{
  "licenseKey": "ptah_lic_a1b2c3d4e5f6..." // Required: 64-hex chars after prefix
}
```

**Response (Valid License)**:

```typescript
{
  "valid": true,
  "tier": "early_adopter",
  "plan": {
    "name": "Early Adopter",
    "features": ["all_premium_features", "sdk_access", "custom_tools"],
    "futurePrice": 8,
    "isPremium": true
  },
  "expiresAt": "2026-02-15T00:00:00Z",
  "daysRemaining": 45
}
```

**Response (Invalid/Expired)**:

```typescript
{
  "valid": false,
  "tier": "free",
  "reason": "expired" | "revoked" | "not_found" // Optional
}
```

**Performance**: <200ms p95 latency

---

### Endpoint 2: Admin License Creation

**Endpoint**: `POST /api/v1/admin/licenses`

**Authentication**: `X-API-Key: <ADMIN_API_KEY>` header

**Request Body**:

```typescript
{
  "email": "user@example.com",        // Required: valid email format
  "plan": "early_adopter" | "free",   // Required: enum validation
  "sendEmail": true                    // Optional: default true
}
```

**Response**:

```typescript
{
  "success": true,
  "license": {
    "id": "uuid",
    "licenseKey": "ptah_lic_...",
    "plan": "early_adopter",
    "status": "active",
    "expiresAt": "2026-02-15T00:00:00Z",
    "createdAt": "2025-12-15T00:00:00Z"
  },
  "emailSent": true,                   // false if email failed
  "emailError": "..."                  // present if emailSent=false
}
```

**Error Responses**:

- HTTP 401: Invalid/missing API key
- HTTP 400: Invalid email or plan
- HTTP 500: Database or email service error

---

### Endpoint 3: Magic Link Request

**Endpoint**: `POST /api/v1/auth/magic-link`

**Authentication**: None

**Request Body**:

```typescript
{
  "email": "user@example.com"  // Required: valid email format
}
```

**Response**:

```typescript
{
  "success": true,
  "message": "Check your email for login link"
}
```

**Behavior**:

- Always returns success (no email enumeration)
- Only sends email if user exists in database
- Magic link format: `https://ptah.dev/auth/verify?token={64-hex}`

---

### Endpoint 4: Magic Link Verification

**Endpoint**: `GET /api/v1/auth/verify?token={token}`

**Authentication**: None (token-based)

**Response (Success)**:

- Sets HTTP-only cookie: `access_token={jwt}`
- Redirects to: `/portal/dashboard`

**Response (Invalid Token)**:

- Redirects to: `/auth/login?error=token_expired` or `token_already_used`

**Cookie Configuration**:

```typescript
{
  httpOnly: true,
  secure: true,        // Production only
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
}
```

---

### Endpoint 5: Get User License

**Endpoint**: `GET /api/v1/licenses/me`

**Authentication**: JWT cookie (required)

**Response**:

```typescript
{
  "plan": "early_adopter",
  "status": "active",
  "expiresAt": "2026-02-15T00:00:00Z",
  "daysRemaining": 45,
  "email": "user@example.com",
  "createdAt": "2025-12-15T00:00:00Z"
  // Note: licenseKey is NEVER included in response
}
```

**Error Responses**:

- HTTP 401: Missing/invalid JWT cookie
- HTTP 404: User has no active license

---

### Endpoint 6: Resend License Key

**Endpoint**: `POST /api/v1/licenses/resend`

**Authentication**: JWT cookie (required)

**Response**:

```typescript
{
  "success": true,
  "message": "License key email sent to user@example.com"
}
```

**Error Responses**:

- HTTP 401: Missing/invalid JWT cookie
- HTTP 404: User has no active license
- HTTP 500: Email service failure

---

## 7. Hardcoded Plan Configuration

**File**: `src/config/plans.config.ts`

```typescript
export const PLANS = {
  free: {
    name: 'Free',
    features: ['basic_cli_wrapper', 'session_history', 'permission_management', 'mcp_configuration'],
    expiresAfterDays: null, // Never expires
    isPremium: false,
    description: 'Beautiful UI for Claude CLI',
  },
  early_adopter: {
    name: 'Early Adopter',
    features: ['all_premium_features', 'sdk_access', 'custom_tools', 'workspace_semantic_search', 'editor_context_awareness', 'git_workspace_info'],
    expiresAfterDays: 60, // 2 months
    futurePrice: 8, // USD/month when payments launch
    isPremium: true,
    description: 'SDK-powered workspace tools + all free features',
  },
} as const;

export type PlanName = keyof typeof PLANS;
```

---

## 8. Environment Variables

**File**: `.env` (never commit to git)

```bash
# Server Configuration
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://ptah.dev

# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@host:5432/ptah_licenses

# Admin API Security
ADMIN_API_KEY=<256-bit-random-key>  # Generate: openssl rand -hex 32

# JWT Authentication
JWT_SECRET=<256-bit-random-key>     # Generate: openssl rand -hex 32
JWT_EXPIRATION=7d

# Email Service (SendGrid)
SENDGRID_API_KEY=<sendgrid-api-key>
SENDGRID_FROM_EMAIL=noreply@ptah.dev
SENDGRID_FROM_NAME=Ptah Team

# Magic Link Configuration
MAGIC_LINK_TTL_MS=30000  # 30 seconds (default)
```

---

## 9. Dependencies

### Required NPM Packages

**Backend (NestJS)**:

- `@nestjs/common@^11.0.0`
- `@nestjs/core@^11.0.0`
- `@nestjs/platform-express@^11.0.0`
- `@nestjs/config@^3.0.0`
- `@nestjs/jwt@^10.0.0`
- `@prisma/client@7.1.0`
- `@prisma/adapter-pg@7.1.0`
- `pg@8.11.0`
- `class-validator@^0.14.0`
- `class-transformer@^0.5.0`
- `@sendgrid/mail@^8.0.0`

**Dev Dependencies**:

- `prisma@7.1.0`
- `@types/pg@^8.11.0`
- `@types/node@^20.0.0`

### Existing Monorepo Dependencies

Reuse existing patterns from:

- `apps/ptah-license-server/src/app/auth/services/ticket.service.ts` (magic link pattern)
- `apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts` (JWT guard)
- `apps/ptah-license-server/src/app/auth/auth.controller.ts` (cookie handling)

### External Services

- **PostgreSQL**: Database (existing in monorepo)
- **SendGrid**: Email delivery (user's preferred choice from research)

---

## 10. Risks and Mitigations

### Risk 1: Email Delivery Failure

**Probability**: Medium
**Impact**: High (users can't receive license keys)

**Mitigation Strategy**:

- Implement 3 retry attempts with exponential backoff (1s, 2s, 4s)
- Log all email failures with user email and license key for manual follow-up
- Return `emailSent: false` flag in API response (admin can manually resend)
- Consider backup email provider (e.g., AWS SES) for future enhancement

**Contingency**:

- If email service is down, admin can manually send license keys
- Portal resend feature allows users to retry email delivery

---

### Risk 2: Admin API Key Leakage

**Probability**: Low
**Impact**: Critical (unauthorized license creation)

**Mitigation Strategy**:

- Store admin API key in environment variable (never in code)
- Use 256-bit random key (generate with `openssl rand -hex 32`)
- Rotate API key every 90 days
- Implement rate limiting on admin endpoints (10 requests/minute per IP)
- Log all admin license creation attempts with IP address

**Contingency**:

- If key is compromised, immediately rotate to new key
- Audit all licenses created in suspect time window
- Revoke unauthorized licenses via database update

---

### Risk 3: Magic Link Token Replay Attacks

**Probability**: Low
**Impact**: Medium (unauthorized portal access)

**Mitigation Strategy**:

- Enforce 30-second TTL (short window for interception)
- Single-use enforcement (token deleted after validation)
- Use 64-character hex tokens (256-bit entropy, cryptographically secure)
- HTTPS-only in production (prevents network sniffing)

**Contingency**:

- If replay attack detected, force JWT logout for affected user
- User can request new magic link immediately

---

### Risk 4: Database Connection Pool Exhaustion

**Probability**: Medium (during traffic spikes)
**Impact**: High (API downtime)

**Mitigation Strategy**:

- Configure connection pool: min=2, max=10 connections
- Implement query timeout (5 seconds max)
- Use Prisma connection management (automatic pooling)
- Monitor connection pool metrics (alert if >80% utilization)

**Contingency**:

- If pool exhausted, return HTTP 503 Service Unavailable with retry-after header
- Scale horizontally (add more instances with Redis for magic link tokens)

---

### Risk 5: License Key Enumeration Attacks

**Probability**: Medium
**Impact**: Low (attackers guess valid license keys)

**Mitigation Strategy**:

- Use 64-character hex keys (2^256 possible combinations)
- Rate limit verification endpoint (100 requests/minute per IP)
- Log all verification attempts (detect brute force patterns)
- No difference in response time for valid vs invalid keys (timing attack prevention)

**Contingency**:

- If brute force detected, temporarily IP ban
- Implement CAPTCHA for verification endpoint (future enhancement)

---

### Risk 6: Multi-Instance Deployment (Magic Link Tokens)

**Probability**: High (if horizontally scaling)
**Impact**: High (magic links fail on different instances)

**Mitigation Strategy**:

- Document that current in-memory token storage is single-instance only
- Provide migration path to Redis for multi-instance deployments
- Use sticky sessions (load balancer affinity) as temporary workaround

**Contingency**:

- If scaling required before payment integration, migrate to Redis in 1 day
- Use existing TicketService pattern as reference (already designed for Redis migration)

---

## 11. Success Metrics

### Technical Metrics

| Metric                       | Target        | Measurement Method                    |
| ---------------------------- | ------------- | ------------------------------------- |
| License Verification Latency | <200ms (p95)  | Application performance monitoring    |
| Admin License Creation Time  | <1000ms (p95) | API response time tracking            |
| Email Delivery Success Rate  | >99%          | SendGrid delivery logs                |
| Database Query Latency       | <10ms (p99)   | Prisma query logging                  |
| API Uptime                   | >99.5%        | Health check monitoring (every 1 min) |

### Business Metrics

| Metric                        | Target        | Measurement Method                           |
| ----------------------------- | ------------- | -------------------------------------------- |
| Early Adopter Licenses Issued | 50+ (month 1) | Database count query                         |
| Portal Login Success Rate     | >95%          | Magic link validation success tracking       |
| License Activation Time       | <5 minutes    | Time from email sent to extension activation |
| Support Requests (License)    | <5% of users  | Support ticket tracking                      |

### Quality Metrics

| Metric                        | Target | Measurement Method          |
| ----------------------------- | ------ | --------------------------- |
| Unit Test Coverage            | >70%   | Jest coverage report        |
| Zero Critical Security Issues | 100%   | Security audit (pre-launch) |
| TypeScript Strict Compliance  | 100%   | tsc --noEmit (no errors)    |
| ESLint Pass Rate              | 100%   | ESLint CI check             |

---

## 12. Acceptance Criteria (High-Level)

### Must Have (MVP)

- [ ] License verification endpoint returns valid/invalid status in <200ms
- [ ] Admin API creates licenses with 60-day expiration and sends email
- [ ] Magic link authentication works with 30-second TTL and single-use enforcement
- [ ] Customer portal displays license status (no license key displayed)
- [ ] Portal resend feature sends license key email
- [ ] Database has 2 tables (users, licenses) with proper indexes
- [ ] All endpoints have input validation (class-validator)
- [ ] JWT cookies are HTTP-only with secure flag in production
- [ ] Hardcoded plans (free, early_adopter) return correct feature lists
- [ ] Email templates for license key and magic link are production-ready

### Nice to Have (Post-MVP)

- [ ] Deep link activation (`vscode://ptah/activate?key=...`)
- [ ] License renewal reminder emails (7 days before expiration)
- [ ] Admin dashboard UI (HTML interface for license management)
- [ ] Redis migration for multi-instance magic link token storage
- [ ] License transfer between users (admin-initiated)

---

## 13. Testing Requirements

### Unit Tests

**Coverage Target**: Minimum 70%

**Test Cases**:

- `LicensesService.verifyLicense()` - valid, expired, revoked, not found
- `AdminService.createLicense()` - new user, existing user, email failure
- `MagicLinkService.create()` - token generation and TTL enforcement
- `MagicLinkService.validateAndConsume()` - valid, expired, already used
- `AuthService.generateJwtForEmail()` - JWT generation and payload

### Integration Tests

**Test Cases**:

- POST `/api/v1/licenses/verify` - full request/response cycle
- POST `/api/v1/admin/licenses` - database + email integration
- POST `/api/v1/auth/magic-link` → GET `/api/v1/auth/verify` - full magic link flow
- GET `/api/v1/licenses/me` - JWT authentication + database query

### E2E Tests

**Critical User Journeys**:

1. **Early Adopter Onboarding**:

   - Admin creates license via API
   - User receives email
   - User enters license in VS Code
   - Extension verifies and unlocks premium

2. **Portal Access**:

   - User requests magic link
   - User clicks link in email
   - User views license status in portal
   - User clicks resend license key

3. **License Expiration**:
   - Create license with 1-second expiration
   - Wait for expiration
   - Verify `/api/v1/licenses/verify` returns `valid: false`
   - Verify portal shows "Expired" status

---

## 14. Deployment Checklist

### Pre-Launch

- [ ] Environment variables configured (DATABASE_URL, ADMIN_API_KEY, JWT_SECRET, SENDGRID_API_KEY)
- [ ] Database migrations executed (2 tables: users, licenses)
- [ ] Indexes created (licenses.licenseKey, users.email)
- [ ] Admin API key generated (256-bit random, stored securely)
- [ ] Email templates tested (license key, magic link)
- [ ] HTTPS certificate configured (Let's Encrypt or CloudFlare)
- [ ] CORS configured for allowed origins only (https://ptah.dev)
- [ ] Rate limiting enabled (license verification, admin API)
- [ ] Health check endpoint implemented (`GET /health`)

### Launch Day

- [ ] Deploy to production server (DigitalOcean, AWS, or similar)
- [ ] Verify database connection (run health check)
- [ ] Test license verification endpoint (public endpoint)
- [ ] Test admin license creation (generate first early adopter license)
- [ ] Test magic link authentication (full portal login flow)
- [ ] Monitor error logs (first 24 hours)
- [ ] Monitor email delivery rate (SendGrid dashboard)

### Post-Launch

- [ ] Set up automated database backups (daily, 7-day retention)
- [ ] Configure monitoring alerts (Sentry, DataDog, or similar)
- [ ] Document admin API usage (internal wiki)
- [ ] Create support email template for license issues
- [ ] Schedule weekly license audit (expired licenses cleanup)

---

## 15. Future Integration Path (TASK_2025_043)

This simplified architecture is designed to support future payment integration without database migration:

### Preserved Extensibility

1. **Database Schema**: Add `subscriptions` table without modifying existing `users` or `licenses` tables
2. **API Endpoints**: Payment endpoints (`/api/v1/webhooks/paymob`) can be added without affecting existing license API
3. **Email Templates**: Reuse existing templates for payment receipts and subscription renewals
4. **Admin API**: Extend with subscription management endpoints (cancel, update)

### Migration Strategy (When Payments Launch)

1. **Phase 1**: Add `subscriptions` table with foreign key to `users.id`
2. **Phase 2**: Implement Paymob webhook endpoint (`POST /api/v1/webhooks/paymob`)
3. **Phase 3**: Update license creation logic to link with subscriptions
4. **Phase 4**: Migrate existing early adopter licenses to "grandfathered" subscription status
5. **Phase 5**: Enable payment checkout on landing page

**Estimated Migration Time**: 2-3 days (with existing simplified architecture as foundation)

---

## Document Status

**Status**: ✅ Ready for Implementation
**Created**: 2025-12-15
**Last Updated**: 2025-12-15
**Next Step**: software-architect creates `implementation-plan.md`

---

## Appendix A: License Key Generation Algorithm

**Format**: `ptah_lic_{64-hex-chars}`

**Implementation**:

```typescript
import { randomBytes } from 'crypto';

function generateLicenseKey(): string {
  const random = randomBytes(32).toString('hex'); // 32 bytes = 64 hex chars
  return `ptah_lic_${random}`;
}

// Example output: ptah_lic_a1b2c3d4e5f6789012345678901234567890abcdef...
```

**Security Properties**:

- 256-bit entropy (2^256 possible keys)
- Cryptographically secure (Node.js crypto.randomBytes)
- URL-safe (hex encoding)
- Collision probability: negligible (1 in 10^77)

---

## Appendix B: Email Template Specifications

### Template 1: License Key Email

**File**: `src/email/templates/license-key.hbs`

**Subject**: Your Ptah Premium License Key

**Variables**:

- `{{licenseKey}}` - The generated license key
- `{{plan}}` - Plan name (e.g., "Early Adopter")
- `{{expiresAt}}` - Expiration date (formatted)
- `{{portalUrl}}` - Customer portal URL

**Content**:

```
Hi there,

Welcome to Ptah Premium! Your {{plan}} license is ready.

License Key: {{licenseKey}}

Expires: {{expiresAt}}

Setup Instructions:
1. Open VS Code settings (Cmd+,)
2. Search for "Ptah"
3. Paste your license key in "Ptah: License Key"
4. Reload VS Code window

Manage your license: {{portalUrl}}

Need help? Reply to this email.

- The Ptah Team
```

### Template 2: Magic Link Email

**File**: `src/email/templates/magic-link.hbs`

**Subject**: Login to Ptah Portal

**Variables**:

- `{{magicLink}}` - The magic link URL (30-second expiration)

**Content**:

```
Hi there,

Click the link below to access your Ptah Portal:

{{magicLink}}

This link expires in 30 seconds.

Didn't request this? Ignore this email.

- The Ptah Team
```

---

## Appendix C: Admin API Usage Examples

### Create Early Adopter License

```bash
curl -X POST https://api.ptah.dev/api/v1/admin/licenses \
  -H "X-API-Key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "plan": "early_adopter",
    "sendEmail": true
  }'
```

**Response**:

```json
{
  "success": true,
  "license": {
    "id": "uuid",
    "licenseKey": "ptah_lic_a1b2c3...",
    "plan": "early_adopter",
    "status": "active",
    "expiresAt": "2026-02-15T00:00:00Z",
    "createdAt": "2025-12-15T00:00:00Z"
  },
  "emailSent": true
}
```

### Verify License Key

```bash
curl -X POST https://api.ptah.dev/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "ptah_lic_a1b2c3..."
  }'
```

**Response**:

```json
{
  "valid": true,
  "tier": "early_adopter",
  "plan": {
    "name": "Early Adopter",
    "features": ["all_premium_features", "sdk_access", "custom_tools"],
    "futurePrice": 8,
    "isPremium": true
  },
  "expiresAt": "2026-02-15T00:00:00Z",
  "daysRemaining": 45
}
```

---

**End of Requirements Document**
