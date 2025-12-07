# Requirements Document - TASK_2025_043

**Task**: Ptah License Server Implementation  
**Type**: Backend Implementation (New NestJS Project)  
**Created**: 2025-12-07  
**Project Manager**: Elite PM Agent

---

## Introduction

### Business Context

Ptah is transitioning from open-source to a freemium SaaS model to monetize premium Claude Agent SDK features. The license server is the critical infrastructure enabling this business model transformation.

**Core Business Value**: Enable $8/month premium subscriptions with minimal infrastructure complexity, targeting 4-week launch timeline.

### Strategic Simplification

This implementation deliberately simplifies the original architecture by:

- **Removing OAuth token storage** - Users manage their own `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in VS Code settings
- **Minimal backend surface** - Only 2 REST endpoints, 3 database tables
- **Fast time-to-market** - Production-ready in 2-3 days vs 8 weeks for complex architecture

### Value Proposition

- **For Users**: Simple license key activation in VS Code, no account creation complexity
- **For Business**: Low infrastructure cost ($20/month DigitalOcean), minimal maintenance burden
- **For Development**: Clear scope, proven patterns, quick iteration

---

## Task Classification

- **Type**: FEATURE (New Backend System)
- **Priority**: P1-High (Blocks premium tier launch)
- **Complexity**: Medium (2-3 days implementation)
- **Estimated Effort**: 16-24 hours total
  - Day 1: NestJS setup + PostgreSQL schema (6-8h)
  - Day 2: License verification + Paymob webhooks (6-8h)
  - Day 3: Email service + testing + deployment (4-8h)

---

## Workflow Dependencies

- **Research Needed**: **NO** (Standard NestJS/PostgreSQL stack, proven Paymob integration)
- **UI/UX Design Needed**: **NO** (Backend API only, VS Code extension consumes API)

**Next Phase**: Phase 4 - Architecture (software-architect creates implementation-plan.md)

---

## Requirements

### Requirement 1: License Verification API

**User Story**: As a VS Code extension using the Ptah license server, I want to verify if a license key grants premium status, so that I can enable/disable premium features based on subscription validity.

#### Acceptance Criteria

1. **WHEN** extension sends `POST /api/v1/licenses/verify` with valid license key **THEN** API **SHALL** return `200 OK` with JSON payload containing `valid: true`, `tier: "premium"`, `email`, and `expiresAt` within 200ms (p95).

2. **WHEN** extension sends request with expired license key **THEN** API **SHALL** return `200 OK` with `valid: false`, `tier: "free"` within 200ms (p95).

3. **WHEN** extension sends request with revoked license key **THEN** API **SHALL** return `200 OK` with `valid: false`, `tier: "free"` within 200ms (p95).

4. **WHEN** extension sends request with non-existent license key **THEN** API **SHALL** return `200 OK` with `valid: false`, `tier: "free"` within 200ms (p95).

5. **WHEN** extension sends request with malformed license key **THEN** API **SHALL** return `400 Bad Request` with validation error details within 100ms.

6. **WHEN** database connection fails during verification **THEN** API **SHALL** return `503 Service Unavailable` with retry-after header.

7. **WHEN** subscription status is 'canceled' or 'past_due' **THEN** API **SHALL** return `valid: false` even if license key exists.

---

### Requirement 2: Paymob Payment Webhook Integration

**User Story**: As a Paymob payment processor sending webhook events, I want the license server to handle successful payment notifications, so that users receive license keys automatically after subscribing.

#### Acceptance Criteria

1. **WHEN** Paymob sends `POST /api/v1/webhooks/paymob` with successful transaction event **THEN** server **SHALL** verify webhook signature using HMAC-SHA256 within 50ms.

2. **WHEN** webhook signature is invalid **THEN** server **SHALL** return `401 Unauthorized` and log security event within 50ms.

3. **WHEN** valid webhook received for new subscription **THEN** server **SHALL** create user record (if not exists), subscription record, generate license key, and send email within 5 seconds.

4. **WHEN** generating license key **THEN** server **SHALL** use format `ptah_lic_{32-hex-chars}` with cryptographically secure random generation.

5. **WHEN** duplicate webhook received (idempotency check) **THEN** server **SHALL** return `200 OK` without creating duplicate records.

6. **WHEN** email delivery fails **THEN** server **SHALL** retry up to 3 times with exponential backoff (1s, 2s, 4s) and log failure for manual intervention.

7. **WHEN** webhook received for subscription cancellation **THEN** server **SHALL** update subscription status to 'canceled' and set license to 'revoked' within 2 seconds.

---

### Requirement 3: Database Schema & Data Integrity

**User Story**: As a PostgreSQL database administrator, I want a minimal schema with proper constraints and indexing, so that license operations are fast, reliable, and data integrity is enforced.

#### Acceptance Criteria

1. **WHEN** schema migrated **THEN** database **SHALL** contain exactly 3 tables: `users`, `subscriptions`, `licenses`.

2. **WHEN** inserting user **THEN** email **SHALL** be unique (enforced by database constraint) and in valid email format.

3. **WHEN** creating subscription **THEN** `user_id` foreign key constraint **SHALL** prevent orphaned subscriptions.

4. **WHEN** generating license key **THEN** `license_key` unique constraint **SHALL** prevent duplicates.

5. **WHEN** querying license by key **THEN** query **SHALL** use index on `license_key` column and complete within 10ms (p99).

6. **WHEN** subscription expires **THEN** `current_period_end` timestamp **SHALL** be in UTC timezone.

7. **WHEN** cascade delete user **THEN** related subscriptions and licenses **SHALL** also be deleted (ON DELETE CASCADE).

---

### Requirement 4: License Key Generation & Security

**User Story**: As a license key generator, I want cryptographically secure random keys with collision resistance, so that license keys cannot be guessed or brute-forced.

#### Acceptance Criteria

1. **WHEN** generating license key **THEN** system **SHALL** use `crypto.randomBytes(16)` (Node.js crypto module) for 128-bit entropy.

2. **WHEN** encoding random bytes **THEN** system **SHALL** use hexadecimal encoding resulting in 32-character string.

3. **WHEN** formatting license key **THEN** final format **SHALL** be `ptah_lic_{32-hex}` (total 40 characters).

4. **WHEN** checking for collision **THEN** system **SHALL** retry generation if key exists (probability: <1 in 2^128).

5. **WHEN** storing license key **THEN** database **SHALL** enforce unique constraint to prevent duplicates.

---

### Requirement 5: Email Delivery Service

**User Story**: As a newly subscribed user who just paid via Paymob, I want to receive my license key via email within 1 minute, so that I can activate premium features immediately.

#### Acceptance Criteria

1. **WHEN** license key generated **THEN** email service **SHALL** send activation email within 30 seconds.

2. **WHEN** sending email **THEN** subject **SHALL** be "Your Ptah Premium License Key" and sender **SHALL** be "noreply@ptah.dev".

3. **WHEN** email template rendered **THEN** content **SHALL** include license key (plaintext), activation instructions, support link, and unsubscribe link.

4. **WHEN** using SendGrid/Resend **THEN** API key **SHALL** be stored in environment variable `EMAIL_API_KEY`.

5. **WHEN** email delivery fails **THEN** system **SHALL** log error with user email, license key, and retry status for manual recovery.

6. **WHEN** email sent successfully **THEN** system **SHALL** log delivery confirmation with timestamp.

---

## Non-Functional Requirements

### Performance Requirements

- **License Verification Response Time**:
  - 95th percentile: <200ms
  - 99th percentile: <500ms
  - Database query latency: <10ms (p99)
- **Webhook Processing Time**:
  - Signature verification: <50ms
  - End-to-end processing (user creation + license generation + email): <5 seconds
- **Throughput**:
  - License verification: 100 req/sec (vastly exceeds MVP needs)
  - Webhook processing: 10 req/sec (covers 10 subscriptions/sec = 864,000/day)
- **Resource Usage**:
  - Memory: <256MB (NestJS app)
  - CPU: <20% idle, <60% under load (DigitalOcean $20/month droplet)
  - Database: <10MB initial (users + subscriptions + licenses)

### Security Requirements

- **Authentication**:
  - License verification endpoint: **PUBLIC** (no auth required)
  - Webhook endpoint: HMAC-SHA256 signature verification (Paymob secret)
- **Authorization**:
  - N/A for MVP (public endpoints with signature verification)
- **Data Protection**:
  - Environment variables: `PAYMOB_SECRET_KEY`, `EMAIL_API_KEY`, `DATABASE_URL`
  - Database connection: TLS/SSL enforced
  - User emails: PII, log redaction in production
- **Compliance**:
  - **GDPR**: Email storage consent via Paymob checkout
  - **PCI-DSS**: N/A (Paymob handles payment processing)
  - **OWASP Top 10**: SQL injection prevention (TypeORM), input validation (class-validator)

### Scalability Requirements

- **Load Capacity**: Handle 10x current load without code changes (vertical scaling)
- **Growth Planning**: Support 100,000 users (database growth: ~10MB for licenses + subscriptions)
- **Resource Scaling**: DigitalOcean droplet resize from 1GB → 2GB → 4GB RAM

### Reliability Requirements

- **Uptime**: 99.9% availability (43 minutes downtime/month acceptable for MVP)
- **Error Handling**:
  - Graceful degradation: Return 503 if database unavailable
  - Circuit breaker for email service (fail-open, log for manual retry)
- **Recovery Time**: <5 minutes (manual deployment from Git)
- **Data Durability**: PostgreSQL automated daily backups (DigitalOcean Managed Database)

### Monitoring & Observability

- **Logging**: Structured JSON logs (Winston) with log levels (error, warn, info, debug)
- **Metrics**:
  - License verification request rate, latency (p50, p95, p99)
  - Webhook processing success/failure rate
  - Email delivery success/failure rate
- **Alerting**:
  - Email delivery failures >10/hour
  - Database connection failures
  - Webhook signature verification failures >5/minute (potential attack)

---

## Stakeholder Analysis

### Primary Stakeholders

#### End Users (Premium Subscribers)

- **Needs**: Fast license activation, clear email instructions, reliable premium feature access
- **Pain Points**: Manual license entry, delayed email delivery, unclear errors
- **Success Criteria**: 95% receive license within 1 minute of payment

#### Business Owners (Ptah SaaS)

- **ROI Expectations**:
  - Launch within 4 weeks
  - Infrastructure cost <$50/month (includes database, email, hosting)
  - Support 1,000 premium users before scaling needed
- **Success Criteria**:
  - 99.9% uptime
  - <5 manual support tickets/month for license issues
  - Payment → License activation automated

#### Development Team (Ptah Engineers)

- **Technical Constraints**:
  - Must integrate with existing VS Code extension (TypeScript, RPC)
  - NestJS framework preference (team expertise)
  - PostgreSQL database (DigitalOcean Managed Database)
- **Success Criteria**:
  - Clear API documentation
  - TypeScript types for frontend integration
  - Simple deployment (Docker + DigitalOcean App Platform)

### Secondary Stakeholders

#### Operations Team

- **Deployment Requirements**:
  - Docker containerization
  - Environment variable configuration
  - Health check endpoint for monitoring
- **Maintenance**:
  - Database migration scripts (TypeORM)
  - Automated backups
  - Log aggregation (DigitalOcean Logs)

#### Support Team

- **Documentation Needs**:
  - License key format specification
  - Common error codes and resolutions
  - Manual license generation procedure (for edge cases)

---

## Risk Analysis

### Technical Risks

#### Risk 1: Paymob Webhook Signature Verification Complexity

- **Probability**: Medium
- **Impact**: Critical (invalid signatures = no license generation)
- **Mitigation**:
  - Reference official Paymob documentation
  - Test with Paymob sandbox webhooks before production
  - Implement detailed logging for signature failures
- **Contingency**: Manual license generation + email for first 100 users while debugging

#### Risk 2: Email Delivery Failures (SendGrid/Resend Quota/Downtime)

- **Probability**: Low
- **Impact**: High (users don't receive license keys)
- **Mitigation**:
  - Implement retry logic with exponential backoff
  - Log failed deliveries for manual intervention
  - Send daily summary of failed emails to admin
- **Contingency**: Display license key in Paymob success page as fallback

#### Risk 3: Database Connection Pool Exhaustion

- **Probability**: Low (MVP traffic)
- **Impact**: Critical (license verification fails)
- **Mitigation**:
  - Configure TypeORM connection pool max=10, min=2
  - Implement connection timeout monitoring
  - Health check endpoint tests database connectivity
- **Contingency**: Vertical scaling (increase database connections limit)

#### Risk 4: License Key Collision (Despite 128-bit Entropy)

- **Probability**: Extremely Low (1 in 2^128)
- **Impact**: Medium (duplicate license key)
- **Mitigation**:
  - Database unique constraint enforces uniqueness
  - Retry generation on collision
  - Monitor collision events (should be zero)
- **Contingency**: Automatic retry with new random bytes

### Business Risks

#### Risk 1: Paymob Integration Changes/Deprecation

- **Probability**: Low (Paymob is stable payment provider)
- **Impact**: High (no new subscriptions)
- **Mitigation**:
  - Follow Paymob webhook v2 specification (latest)
  - Subscribe to Paymob developer updates
  - Implement webhook version detection
- **Contingency**: Fallback to manual license generation interface

#### Risk 2: License Verification API Becomes DDoS Target

- **Probability**: Medium (public endpoint)
- **Impact**: Medium (extension can cache license status)
- **Mitigation**:
  - Implement rate limiting (100 req/min per IP)
  - DigitalOcean App Platform DDoS protection
  - Extension caches license verification for 24h
- **Contingency**: Increase rate limits, add CAPTCHA for suspicious traffic

---

## Dependencies

### Technical Dependencies

- **Backend Framework**: NestJS ^10.0.0
- **Database**: PostgreSQL 15+ (DigitalOcean Managed Database)
- **ORM**: TypeORM ^0.3.0
- **Email Service**: SendGrid OR Resend (user choice)
- **Deployment**: Docker + DigitalOcean App Platform
- **Environment**: Node.js 20 LTS

### External Dependencies

- **Paymob Payment Gateway**:
  - Webhook endpoint availability
  - Signature format stability
  - Sandbox environment for testing
- **Email Provider (SendGrid/Resend)**:
  - API availability (99.9% SLA)
  - Monthly quota (10,000 emails/month free tier)
- **DigitalOcean**:
  - App Platform (auto-deploy from Git)
  - Managed Database (PostgreSQL)
  - DNS management (ptah.dev domain)

### Team Dependencies

- **VS Code Extension Team**:
  - TypeScript interface for API responses
  - License verification logic integration
  - Environment variable configuration docs

---

## Success Metrics

### MVP Launch Metrics (4-Week Timeline)

1. **License Verification Latency**: 95th percentile <200ms (measured via APM)
2. **Email Delivery Success Rate**: >99% within 1 minute (tracked via email service webhooks)
3. **Webhook Processing Success Rate**: >99.5% (tracked via internal metrics)
4. **Zero Critical Bugs**: No P0/P1 bugs in production first 2 weeks
5. **Infrastructure Cost**: <$50/month total (DigitalOcean + email provider)

### Business Success Metrics (3-Month Horizon)

1. **User Onboarding**: >95% of users successfully activate premium within 5 minutes of payment
2. **Support Ticket Volume**: <2% of users need manual license intervention
3. **System Reliability**: 99.9% uptime (measured via DigitalOcean monitoring)
4. **Scalability Buffer**: Support 1,000 premium users with current infrastructure

### Developer Success Metrics

1. **API Documentation**: OpenAPI/Swagger spec published within 1 day of deployment
2. **Integration Time**: VS Code extension integration completed within 2 days
3. **Deployment Frequency**: Automated deployments on Git push (CD pipeline)

---

## Out of Scope (Explicitly Excluded from MVP)

1. ❌ **OAuth Token Encryption/Storage** - Users manage tokens in VS Code settings
2. ❌ **Device Tracking/Management** - Accept license key sharing risk for MVP
3. ❌ **Audit Logs** - Add in phase 2 if compliance needed
4. ❌ **WorkOS Integration** - Simplified auth model doesn't need enterprise SSO
5. ❌ **Multi-Currency Support** - Paymob handles EGP, future expansion TBD
6. ❌ **License Key Format Customization** - Fixed format for MVP
7. ❌ **User Dashboard** - Manage subscriptions via Paymob portal
8. ❌ **Team Licenses** - Personal licenses only in MVP

---

## Appendix: API Contract Specifications

### POST /api/v1/licenses/verify

**Request**:

```typescript
interface VerifyLicenseRequest {
  licenseKey: string; // Format: ptah_lic_{32-hex}
}
```

**Response (200 OK - Valid Premium)**:

```typescript
interface VerifyLicenseResponse {
  valid: true;
  tier: 'premium';
  email: string;
  expiresAt: string; // ISO 8601 UTC timestamp
}
```

**Response (200 OK - Invalid/Free)**:

```typescript
interface VerifyLicenseResponse {
  valid: false;
  tier: 'free';
}
```

**Response (400 Bad Request)**:

```typescript
interface ErrorResponse {
  statusCode: 400;
  message: string[];
  error: 'Bad Request';
}
```

---

### POST /api/v1/webhooks/paymob

**Request Headers**:

```
Content-Type: application/json
x-paymob-signature: {HMAC-SHA256 signature}
```

**Request Body** (Paymob Format):

```typescript
interface PaymobWebhookPayload {
  type: 'TRANSACTION' | 'SUBSCRIPTION_CANCELED';
  obj: {
    success: boolean;
    subscription_id?: string;
    billing_data: {
      email: string;
    };
    // ... other Paymob fields
  };
}
```

**Response**:

```typescript
interface WebhookAckResponse {
  received: true;
}
```

---

## Next Steps

1. **User Validation Required**: Review this requirements document

   - Reply "APPROVED ✅" to proceed to architecture phase
   - OR provide feedback for requirements refinement

2. **Next Command**: `/phase-4-architecture TASK_2025_043`
   - Agent: software-architect
   - Deliverable: implementation-plan.md
   - Duration: 1-2 hours
