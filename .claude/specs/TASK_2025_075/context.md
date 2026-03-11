# Task Context - TASK_2025_075

## User Intent

Build a simplified license server WITHOUT payment integration (postponed) that:

1. Verifies license keys for premium status with hardcoded plans
2. Supports two plans: Free and Early Adopter (free for 2 months, $8/month later)
3. Provides admin API to manually create and email licenses to early adopters
4. Includes magic link authentication for customer portal
5. Preserves architecture for future payment provider integration

**Key Decision**: Postpone Paymob/payment integration. Distribute early adopter licenses manually via admin API until payment provider decision is finalized.

## Conversation Summary

This task is a PIVOT from TASK_2025_043 (License Server with Paymob Integration). Key changes:

- REMOVED: Paymob webhooks, HMAC validation, subscription management via payments
- ADDED: Admin license generation endpoint, hardcoded plans, 2-month expiration for early adopters
- SIMPLIFIED: Database from 3 tables to 2 (removed subscriptions), portal without payment features

**Why the pivot?**

- User wants to work with early adopters before committing to a payment provider
- Email-based 2-month licenses allow manual distribution during beta period
- Architecture remains extensible for future payment integration

## Technical Context

- Branch: feature/license-server-simplified
- Created: 2025-12-15
- Type: FEATURE (Backend + Frontend)
- Complexity: Medium (3-4 days, ~12 tasks)
- Related Task: TASK_2025_043 (preserved for future Paymob integration)

## Execution Strategy

**Strategy**: FEATURE (Streamlined - no payment integration)

**Planned Agent Sequence**:

1. software-architect → Creates implementation-plan.md (revised from 043)
2. USER VALIDATES
3. team-leader MODE 1 → Creates tasks.md
4. team-leader MODE 2 (loop) → Developer assignments
5. team-leader MODE 3 → Completion verification
6. QA choice
7. modernization-detector

## Key Technical Decisions

### Database Schema (2 tables)

- `users`: id, email, createdAt
- `licenses`: id, userId, licenseKey, plan, status, expiresAt, createdAt, createdBy

### Hardcoded Plans

```typescript
const PLANS = {
  free: { name: 'Free', expiresAfterDays: null },
  early_adopter: { name: 'Early Adopter', expiresAfterDays: 60, futurePrice: 8 },
};
```

### API Endpoints

- POST /api/v1/licenses/verify (license verification for VS Code extension)
- POST /api/v1/admin/licenses (admin creates license, sends email)
- POST /api/v1/licenses/resend (resend license email)
- POST /api/v1/auth/magic-link (portal authentication)
- GET /api/v1/auth/verify (magic link validation)
- GET /api/v1/licenses/me (user's license status)

### Early Adopter Workflow

1. User requests access (email/form/social)
2. Admin calls POST /admin/licenses with email and plan
3. System generates license key: ptah*lic*{32-hex}
4. System emails license key + setup instructions
5. User enters license in VS Code settings
6. Extension verifies via /licenses/verify
7. Premium features unlocked for 2 months

## Dependencies

**Tech Stack**:

- NestJS (backend framework)
- PostgreSQL (database)
- Prisma 7.1.0 with driver adapters
- SendGrid (email delivery)
- Angular (landing page portal)

**NOT Included (Postponed)**:

- Paymob integration
- Payment webhooks
- Subscription management
- Payment history

## Success Criteria

### Must Have

- License verification endpoint working (<200ms response)
- Admin license creation with email delivery
- Magic link authentication for portal
- 2-month expiration for early adopter licenses
- Portal shows license status and resend button

### Nice to Have

- Deep link activation (vscode://ptah...)
- License renewal reminder emails
- Admin dashboard UI
