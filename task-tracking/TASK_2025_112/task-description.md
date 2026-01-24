# Requirements Document - TASK_2025_112

## Introduction

This task transforms the existing simplified license server (TASK_2025_075) into a **production-ready SaaS licensing platform** with payment processing, enterprise authentication, Docker-based development environment, and comprehensive frontend integration.

**Business Value**: Enable monetization of Ptah extension through automated subscription management, reduce operational overhead with self-service licensing, and provide enterprise customers with SSO capabilities.

**Context**: TASK_2025_075 delivered ~70% of basic infrastructure (database, license verification API, VS Code integration) but lacks payment processing, production authentication, local dev setup, and frontend user journeys.

---

## Task Classification

- **Type**: FEATURE (Major Enhancement)
- **Priority**: P0-Critical (Enables business monetization)
- **Complexity**: Complex (20-30 hours)
- **Estimated Effort**: 3-4 days (full-stack + infrastructure + research)

---

## Workflow Dependencies

- **Research Needed**: **YES** (Critical)
  - Paddle Checkout API v1 vs v2 comparison
  - Paddle webhook security best practices
  - WorkOS OIDC integration patterns
  - DigitalOcean deployment architecture for Node.js + Angular
- **UI/UX Design Needed**: **YES** (Frontend Pages)

  - Pricing page design (plan cards, CTA buttons)
  - Login page design (WorkOS SSO + email input)
  - Profile/Dashboard page wireframe (subscription status, license key display)

- **DevOps Infrastructure**: **YES** (Core Requirement)
  - Docker Compose for local development
  - DigitalOcean deployment configuration
  - PostgreSQL managed database setup
  - Redis session storage
  - Environment variable management

---

## Requirements

### Requirement 1: Paddle Payment Integration

**User Story**: As a **potential customer** visiting the Ptah landing page, I want to **select a plan and complete checkout**, so that **I receive a license key and access premium features**.

#### Acceptance Criteria

1. **WHEN** user clicks "Buy Now" on pricing page **THEN** Paddle Checkout overlay **SHALL** open with pre-selected plan
2. **WHEN** payment succeeds via Paddle **THEN** webhook handler **SHALL** create user and license in database within 5 seconds
3. **WHEN** license is created **THEN** SendGrid email **SHALL** send license key within 10 seconds
4. **WHEN** subscription is updated (upgrade/downgrade) **THEN** webhook handler **SHALL** update license tier atomically
5. **WHEN** subscription is canceled **THEN** license status **SHALL** change to 'revoked' on next billing date
6. **WHEN** webhook signature is invalid **THEN** endpoint **SHALL** return 401 Unauthorized and log security event

**Technical Implementation**:

- Paddle Checkout SDK (@paddle/paddle-js)
- Webhook endpoints: `/webhooks/paddle/subscription.created`, `subscription.updated`, `subscription.canceled`
- Webhook signature verification using Paddle public key
- Idempotent webhook processing (check event ID before processing)

---

### Requirement 2: WorkOS Authentication

**User Story**: As a **licensed user**, I want to **log in with my organization's SSO**, so that **I can access my license dashboard securely**.

#### Acceptance Criteria

1. **WHEN** user clicks "Login" **THEN** WorkOS OIDC redirect **SHALL** initiate to identity provider
2. **WHEN** user completes SSO **THEN** callback **SHALL** verify JWT and create session within 2 seconds
3. **WHEN** JWT is valid **THEN** user **SHALL** redirect to `/profile` page
4. **WHEN** user is not found in database **THEN** system **SHALL** show "No license found" message with purchase CTA
5. **WHEN** session expires (7 days) **THEN** user **SHALL** be redirected to login page
6. **WHEN** WorkOS SSO fails **THEN** error page **SHALL** display actionable message (e.g., "Contact your IT admin")

**Technical Implementation**:

- WorkOS Node.js SDK (@workos-inc/node)
- OIDC redirect flow with PKCE
- JWT verification with WorkOS public keys
- HTTP-only session cookies with 7-day expiration
- CSRF protection on callback endpoint

---

### Requirement 3: Docker Development Environment

**User Story**: As a **developer**, I want to **run `docker-compose up` and have full stack running locally**, so that **I can develop and test without manual database setup**.

#### Acceptance Criteria

1. **WHEN** developer runs `docker-compose up` **THEN** PostgreSQL, Redis, license-server, and frontend **SHALL** start within 30 seconds
2. **WHEN** all services are running **THEN** license server **SHALL** be accessible at `http://localhost:3000`
3. **WHEN** all services are running **THEN** frontend **SHALL** be accessible at `http://localhost:4200`
4. **WHEN** developer edits code **THEN** hot-reload **SHALL** apply changes within 2 seconds
5. **WHEN** PostgreSQL container starts **THEN** Prisma migrations **SHALL** auto-apply on first run
6. **WHEN** developer runs `docker-compose down` **THEN** data **SHALL** persist in named volumes

**Technical Implementation**:

- Docker Compose v2 with health checks
- Services: `postgres`, `redis`, `license-server`, `frontend-dev`
- Volumes: `postgres-data`, `redis-data`
- Networks: `ptah-network` (bridge)
- Environment files: `.env.local` (git-ignored)

---

### Requirement 4: DigitalOcean Deployment Configuration

**User Story**: As a **DevOps engineer**, I want **documented deployment steps for DigitalOcean**, so that **I can deploy production infrastructure in <1 hour**.

#### Acceptance Criteria

1. **WHEN** deploying to DigitalOcean **THEN** deployment guide **SHALL** include Terraform scripts for all resources
2. **WHEN** provisioning database **THEN** guide **SHALL** use DigitalOcean Managed PostgreSQL for HA
3. **WHEN** deploying license server **THEN** guide **SHALL** use App Platform with auto-scaling (1-3 containers)
4. **WHEN** deploying frontend **THEN** guide **SHALL** use static site hosting with CDN
5. **WHEN** domain is configured **THEN** guide **SHALL** include SSL certificate setup (Let's Encrypt)
6. **WHEN** monitoring is needed **THEN** guide **SHALL** integrate DigitalOcean Monitoring + Sentry

**Technical Implementation**:

- Terraform configuration files (DigitalOcean provider)
- DigitalOcean App Platform spec.yaml
- Managed PostgreSQL with 2 standby nodes (HA)
- Redis managed instance (1GB)
- CDN configuration for Angular static assets
- Environment variable injection via DigitalOcean secrets

---

### Requirement 5: Frontend Integration (Pricing Page)

**User Story**: As a **visitor**, I want to **see clear pricing plans with features**, so that **I can choose the right plan for my needs**.

#### Acceptance Criteria

1. **WHEN** user navigates to `/pricing` **THEN** page **SHALL** display 3 plan cards (Free, Early Adopter, Pro)
2. **WHEN** plan card is displayed **THEN** it **SHALL** show: name, price, features list, CTA button
3. **WHEN** user clicks "Buy Early Adopter" **THEN** Paddle Checkout **SHALL** open with `priceId` from environment
4. **WHEN** plan is "Free" **THEN** CTA button **SHALL** say "Download Extension" and link to VS Code Marketplace
5. **WHEN** viewport \u003c 768px **THEN** plan cards **SHALL** stack vertically
6. **WHEN** checkout completes **THEN** user **SHALL** redirect to `/profile` with success message

**Technical Implementation**:

- Angular component: `PricingPageComponent`
- Paddle SDK initialization in `app.config.ts`
- Plan data from environment variables (`PADDLE_PRICE_ID_EARLY_ADOPTER`)
- Responsive grid layout (TailwindCSS)
- Success callback: `window.location.href = '/profile?checkout=success'`

---

### Requirement 6: Frontend Integration (Login Page)

**User Story**: As a **licensed user**, I want **one-click SSO login**, so that **I can access my dashboard quickly**.

#### Acceptance Criteria

1. **WHEN** user navigates to `/login` **THEN** page **SHALL** display "Sign in with WorkOS" button
2. **WHEN** user clicks SSO button **THEN** page **SHALL** redirect to `/api/auth/workos`
3. **WHEN** SSO completes **THEN** user **SHALL** land on `/profile` with session active
4. **WHEN** user is already logged in **THEN** `/login` **SHALL** redirect to `/profile`
5. **WHEN** SSO fails **THEN** error message **SHALL** display with "Try again" button
6. **WHEN** viewport \u003c 768px **THEN** UI **SHALL** remain fully usable

**Technical Implementation**:

- Angular component: `LoginPageComponent`
- WorkOS OAuth redirect: `GET /api/auth/workos`
- Callback handling: `GET /api/auth/workos/callback`
- Session check via HTTP interceptor
- Error handling with user-friendly messages

---

### Requirement 7: Frontend Integration (Profile/Dashboard Page)

**User Story**: As a **logged-in user**, I want to **view my subscription status and license key**, so that **I can configure my VS Code extension**.

#### Acceptance Criteria

1. **WHEN** authenticated user visits `/profile` **THEN** page **SHALL** display: plan name, expiration date, days remaining, license key
2. **WHEN** user clicks "Copy License Key" **THEN** key **SHALL** copy to clipboard with success toast
3. **WHEN** license is expired **THEN** page **SHALL** show "Renew Subscription" CTA with Paddle checkout
4. **WHEN** user clicks "Manage Subscription" **THEN** page **SHALL** redirect to Paddle customer portal
5. **WHEN** user is not authenticated **THEN** page **SHALL** redirect to `/login`
6. **WHEN** API call fails **THEN** page **SHALL** show error state with retry button

**Technical Implementation**:

- Angular component: `ProfilePageComponent`
- API endpoint: `GET /api/v1/licenses/me` (existing from TASK_2025_075)
- Clipboard API integration
- Auth guard: `canActivate: [AuthGuard]`
- Paddle customer portal link

---

### Requirement 8: Comprehensive Environment Configuration

**User Story**: As a **new developer**, I want **.env.example with clear instructions**, so that **I can configure my local environment in <15 minutes**.

#### Acceptance Criteria

1. **WHEN** developer reads `.env.example` **THEN** every variable **SHALL** have: description, example value, setup instructions
2. **WHEN** setup instructions reference external service **THEN** it **SHALL** include: signup URL, where to find API key, how to configure
3. **WHEN** variable is security-critical **THEN** comment **SHALL** warn against committing real values
4. **WHEN** developer follows instructions **THEN** all services **SHALL** start without errors
5. **WHEN** `.env.example` is updated **THEN** `DEV_LICENSE_SETUP.md` **SHALL** be updated in sync
6. **WHEN** variable is optional **THEN** comment **SHALL** indicate default behavior when omitted

**Technical Implementation**:

- `.env.example` files for:
  - `apps/ptah-license-server/.env.example`
  - `apps/ptah-landing-page/.env.example`
  - `docker/.env.example` (Docker Compose)
- Inline comments with setup links
- `DEV_LICENSE_SETUP.md` comprehensive guide

---

## Non-Functional Requirements

### Performance

- **Response Time**:
  - License verification API: 95% \u003c 150ms, 99% \u003c 300ms
  - Paddle webhook processing: 95% \u003c 500ms, 99% \u003c 1s
  - Frontend page load: LCP \u003c 2.5s (desktop), \u003c 3.5s (mobile)
- **Throughput**: Handle 100 concurrent checkout requests
- **Resource Usage**:
  - License server: Memory \u003c 512MB, CPU \u003c 30%
  - Frontend build: \u003c 2MB gzipped

### Security

- **Authentication**: WorkOS OIDC with JWT verification
- **Authorization**: License-based premium feature gating (existing from TASK_2025_075)
- **Data Protection**:
  - License keys encrypted in database (encrypt at rest)
  - HTTPS enforced for all endpoints
  - Paddle webhook signature verification
  - WorkOS JWT signature verification
- **Compliance**:
  - GDPR: User data deletion API
  - PCI-DSS: No payment card storage (Paddle handles)
  - OWASP Top 10: Protection against XSS, CSRF, SQL injection

### Scalability

- **Load Capacity**: Handle 10x current load with horizontal scaling
- **Growth Planning**: Support 50,000 users with current architecture
- **Database**: Indexed queries on `licenseKey`, `userId`, `status+expiresAt`

### Reliability

- **Uptime**: 99.5% availability (managed DigitalOcean services)
- **Error Handling**:
  - Paddle webhook failures: 3 retries with exponential backoff
  - WorkOS authentication failures: Graceful fallback to error page
  - Database connection errors: Circuit breaker pattern
- **Recovery Time**: \u003c 15 minutes (DigitalOcean auto-scaling + monitoring)

### Observability

- **Logging**: Structured JSON logs with correlation IDs
- **Monitoring**: DigitalOcean Monitoring + Sentry error tracking
- **Alerting**: PagerDuty integration for critical failures
- **Metrics**:
  - Paddle webhook success rate (target: \u003e 99%)
  - WorkOS authentication success rate (target: \u003e 99.5%)
  - License verification latency (p95, p99)

---

## Stakeholder Analysis

- **End Users** (VS Code extension users):

  - **Need**: Seamless license activation with clear pricing
  - **Pain Point**: Current lack of payment option blocks premium features
  - **Success Metric**: \u003c 5 minutes from purchase to license activation

- **Enterprise Customers**:

  - **Need**: SSO integration for team management
  - **Pain Point**: No centralized license management
  - **Success Metric**: SSO login success rate \u003e 99%

- **Development Team**:

  - **Need**: Fast local dev setup, clear deployment docs
  - **Pain Point**: No Docker Compose, manual PostgreSQL setup
  - **Success Metric**: \u003c 15 minutes from git clone to running stack

- **Business Owners**:
  - **Need**: Automated revenue generation, low operational overhead
  - **Pain Point**: Manual license creation is not scalable
  - **Success Metric**: 100% automated checkout → license delivery

---

## Risk Analysis

### Technical Risks

**Risk 1**: Paddle webhook delivery failures

- **Probability**: Medium (15%)
- **Impact**: Critical (users pay but don't get license)
- **Mitigation**:
  - Implement idempotent webhook handlers (check event ID)
  - Add manual license creation admin tool as fallback
  - Monitor webhook success rate with alerts
- **Contingency**: Manual license creation via Admin API (existing from TASK_2025_075)

**Risk 2**: WorkOS SSO configuration complexity

- **Probability**: Medium (20%)
- **Impact**: High (blocks enterprise customers)
- **Mitigation**:
  - Research WorkOS OIDC integration patterns (Phase 2)
  - Create step-by-step setup guide in docs
  - Test with multiple identity providers (Google, Microsoft, Okta)
- **Contingency**: Email/password fallback authentication

**Risk 3**: Docker Compose performance on Windows

- **Probability**: Medium (25%)
- **Impact**: Medium (slower dev experience)
- **Mitigation**:
  - Use WSL2 for Docker Desktop
  - Document performance optimization tips
  - Provide cloud dev environment alternative (GitPod)
- **Contingency**: Manual setup guide without Docker

**Risk 4**: DigitalOcean deployment complexity

- **Probability**: Low (10%)
- **Impact**: High (blocks production deployment)
- **Mitigation**:
  - Use Terraform for reproducible infrastructure
  - Create detailed deployment runbook
  - Test deployment in staging environment first
- **Contingency**: Deploy to Vercel (frontend) + Railway (backend) as alternative

**Risk 5**: Frontend-backend communication in Docker network

- **Probability**: Low (10%)
- **Impact**: Medium (local dev broken)
- **Mitigation**:
  - Use Docker Compose networking with service discovery
  - Test CORS configuration thoroughly
  - Document network troubleshooting steps
- **Contingency**: Run frontend outside Docker (ng serve) with API proxy

---

## Dependencies

### Technical Dependencies

- **Backend**:
  - @paddle/paddle-js: ^2.0.0 (Paddle Checkout SDK)
  - @workos-inc/node: ^6.0.0 (WorkOS authentication)
  - @nestjs/config: ^3.0.0 (environment variables)
  - @prisma/client: 7.1.0 (existing)
- **Frontend**:
  - @paddle/paddle-js: ^2.0.0
  - @angular/common: ^20.0.0 (existing)
  - @angular/router: ^20.0.0 (existing)
- **Infrastructure**:
  - Docker: \u003e= 24.0.0
  - Docker Compose: \u003e= 2.0.0
  - Terraform: \u003e= 1.6.0

### External Services

- **Paddle** (payment processing):
  - Sandbox account for testing
  - Production account with tax configuration
  - Webhook endpoint configuration
- **WorkOS** (authentication):
  - WorkOS account (free tier for development)
  - OIDC client configuration
  - Production environment setup
- **DigitalOcean** (hosting):

  - Account with API token
  - Managed PostgreSQL cluster
  - Managed Redis cluster
  - App Platform for license server
  - Spaces for static frontend hosting

- **SendGrid** (email - existing):
  - API key (existing from TASK_2025_075)
- **Sentry** (error tracking - optional):
  - DSN for backend
  - DSN for frontend

### Team Dependencies

- **None** (self-sufficient task)

---

## Success Metrics

1. **Automated Revenue**: 100% of checkouts result in license provisioning within 30 seconds
2. **Developer Onboarding**: New dev can run full stack in \u003c 15 minutes
3. **Authentication Success**: WorkOS SSO login success rate \u003e 99%
4. **Deployment Time**: Production deployment in \u003c 1 hour using Terraform
5. **User Activation**: \u003c 5 minutes from purchase to VS Code extension activation
6. **Webhook Reliability**: Paddle webhook processing success rate \u003e 99%

---

## Research Requirements (Phase 2 Input)

**Researcher-Expert Mandate**: Investigate the following areas with production case studies:

1. **Paddle Integration Deep Dive**:

   - Checkout API v1 vs v2 comparison (recommend best for our use case)
   - Webhook security best practices (signature verification, replay attack prevention)
   - Subscription lifecycle management (upgrades, downgrades, cancellations)
   - Tax handling for international customers
   - Production case studies (companies using Paddle with NestJS)

2. **WorkOS OIDC Integration**:

   - OIDC redirect flow with PKCE implementation
   - JWT verification strategies (verify signature with WorkOS public key)
   - Session management patterns (HTTP-only cookies vs Bearer tokens)
   - Multi-tenant consideration (if user belongs to multiple orgs)
   - Production case studies (companies using WorkOS with Angular)

3. **DigitalOcean Architecture**:

   - App Platform vs Droplets comparison for Node.js apps
   - Managed PostgreSQL HA configuration (primary + 2 standbys)
   - Redis session storage best practices
   - CDN configuration for Angular apps
   - Cost optimization strategies (auto-scaling rules)

4. **Docker Compose Best Practices**:
   - Health check patterns for PostgreSQL readiness
   - Hot-reload configuration for NestJS + Angular
   - Named volume management for data persistence
   - Network isolation strategies
   - Windows/WSL2 performance optimizations

**Deliverable**: `research-findings.md` with actionable recommendations and code examples

---

## DevOps Requirements (Infrastructure Planning)

**DevOps-Engineer Mandate**: Design and implement the following infrastructure:

1. **Docker Compose Configuration**:

   - `docker-compose.yml` with services: postgres, redis, license-server, frontend-dev
   - Health checks for all services
   - Named volumes for data persistence
   - Environment variable injection
   - Hot-reload configuration

2. **Terraform Configuration**:

   - DigitalOcean provider setup
   - Managed PostgreSQL cluster (db-s-2vcpu-4gb, 2 standby nodes)
   - Managed Redis cluster (db-s-1vcpu-1gb)
   - App Platform configuration for license server
   - Spaces bucket for frontend static assets
   - CDN endpoint for frontend
   - Domain and SSL certificate setup

3. **CI/CD Pipeline** (future - not in this task):

   - GitHub Actions workflow for license server deployment
   - GitHub Actions workflow for frontend deployment
   - Automated database migrations

4. **.env.example Files**:
   - Comprehensive environment variable documentation
   - Setup instructions with links to service dashboards
   - Security warnings for sensitive variables

**Deliverable**: Infrastructure-as-code ready for deployment

---

## Out of Scope (Future Tasks)

- ❌ Multi-currency pricing (Paddle handles automatically)
- ❌ Affiliate program integration
- ❌ Advanced analytics dashboard (usage metrics, retention)
- ❌ License transfer between users
- ❌ Team/organization license management
- ❌ API usage metering and quotas
- ❌ Automated refund processing

---

## Phase Routing Decision

Based on workflow dependencies:

```
✅ Research Needed: YES
✅ UI/UX Design Needed: YES
✅ DevOps Infrastructure: YES (core requirement)
```

**Next Phase**: Phase 2 - Research (researcher-expert)

---

## Approved By

**Status**: **PENDING USER REVIEW** ✋

> **User**: Please review this requirements document and reply with:
>
> - "APPROVED ✅" to proceed to research phase
> - Feedback/questions/changes if needed

---

**Document Version**: 1.0  
**Created**: 2026-01-22T13:10:00+02:00  
**Last Updated**: 2026-01-22T13:10:00+02:00
