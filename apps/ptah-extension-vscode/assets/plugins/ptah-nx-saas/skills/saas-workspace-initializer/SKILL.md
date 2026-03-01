---
name: saas-workspace-initializer
description: Orchestrated workflow for initializing a complete SaaS workspace with NestJS, Nx, and your choice of Angular or React frontend; use when starting a new SaaS project, setting up monorepo structure, creating multi-tenant architecture, or needing full PRD-to-implementation workflow; integrates with orchestration to coordinate PM, Architect, and Development agents.
---

# SaaS Workspace Initializer

Orchestrated workflow for spinning up production-ready SaaS applications using Nx, NestJS, and your chosen frontend framework (Angular or React).

## Trigger Keywords

When user mentions any of these, consider this skill:

- "new SaaS project", "start SaaS", "create SaaS"
- "multi-tenant", "multitenancy"
- "Nx monorepo", "NestJS + Angular", "NestJS + React"
- "initialize workspace", "scaffold workspace"

## Workflow Overview

```
Phase 0: FRAMEWORK SELECTION (Orchestrator)
         Ask user: Angular or React?
         |
         v
Phase 1: SCOPE CLARIFICATION (Orchestrator)
         Ask critical SaaS-specific questions
         |
         v
Phase 2: project-manager + [saas-discovery-prompt]
         Creates: SaaS PRD with tenant model, features, integrations
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 3: software-architect + [nx-workspace-architect]
         Creates: Implementation plan with library structure
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 4: team-leader MODE 1 + [domain-skills]
         Creates batched tasks for workspace setup
         |
         v
Phase 5: Development (iterative)
         - Workspace initialization
         - Library scaffolding
         - Core infrastructure (auth, multitenancy)
         - Domain scaffolding
         |
         v
Phase 6: QA verification
         - Build verification
         - Linting/formatting
         - Basic smoke tests
```

## Phase 0: Framework Selection

**CRITICAL**: Before any other questions, ask the user which frontend framework to use:

```
Which frontend framework would you like for this SaaS project?

1. **Angular** — Signal-based reactive architecture, ideal for enterprise apps
   - Uses: angular-frontend-patterns skill (from ptah-angular plugin)
   - Best for: Complex forms, enterprise dashboards, admin panels

2. **React** — Component composition with hooks, ideal for flexible UIs
   - Uses: react-best-practices + react-nx-patterns skills (from ptah-react plugin)
   - Best for: Rapid prototyping, consumer-facing apps, SSR with Next.js
```

Record the choice in `scope-decisions.md` under **Frontend Framework**.

### Skill Loading Based on Choice

| Choice  | Frontend Skill(s) to Load                   |
| ------- | ------------------------------------------- |
| Angular | `angular-frontend-patterns`                 |
| React   | `react-best-practices`, `react-nx-patterns` |

## Phase 1: Scope Clarification Questions

After framework selection, ask user these critical questions:

### Business Context

1. **SaaS Type**: B2B, B2C, or both?
2. **Tenant Model**:
   - Shared database (row-level isolation)
   - Database per tenant
   - Schema per tenant
3. **Initial Domains**: What are the 2-3 core business domains? (e.g., Orders, Users, Products)

### Technical Context

4. **Authentication**:
   - Built-in (JWT)
   - External provider (Clerk, Auth0, WorkOS, etc.)
5. **Payment Provider**: Needed immediately or later?
   - If yes: Stripe, Paddle, LemonSqueezy?
6. **Deployment Target**:
   - Docker/Kubernetes
   - Serverless
   - PaaS (Render, Railway, DigitalOcean, etc.)

### Monetization & Integration Context

7. **Monetization Model**:
   - Freemium (free + paid tiers)
   - Trial-to-Paid (time-limited full access)
   - Usage-Based (pay per consumption)
   - Seat-Based (per-user pricing)
8. **Webhook Sources**: Which external services will send webhooks?
   - Payment provider, email bounces, VCS hooks, messaging platforms, etc.
9. **Email Needs**:
   - Transactional (license keys, password resets, magic links)
   - Lifecycle (trial reminders, subscription updates)
   - Marketing (optional, usually external)
10. **Real-Time Requirements**: SSE, WebSockets, or polling for live updates?

### Scale Context

11. **Team Size**: Solo, small team (2-5), or larger?
12. **Timeline**: MVP or production-ready?

## Phase 2: PM Agent Prompt Extension

When invoking project-manager, include:

```
ADDITIONAL CONTEXT FOR SAAS PRD:

Reference skill: saas-workspace-initializer
Frontend Framework: [Angular|React] (from Phase 0)

The task-description.md MUST include:

1. TENANT MODEL SECTION
   - Tenant identification strategy
   - Tenant isolation approach
   - Tenant provisioning workflow

2. AUTHENTICATION SECTION
   - Auth provider choice with rationale
   - Token management strategy
   - Permission model (RBAC/ABAC)

3. DOMAIN BOUNDARIES
   - List bounded contexts
   - Mark which are core vs supporting
   - Identify shared kernel components

4. THIRD-PARTY INTEGRATIONS
   Using Provider Pattern (see nestjs-backend-patterns skill):
   - List planned integrations
   - Define abstract interfaces first
   - Identify which need immediate vs future implementation

5. MONETIZATION MODEL
   Following saas-platform-patterns skill:
   - Tier definitions (free, pro, enterprise)
   - Feature gating strategy
   - Trial period configuration
   - License provisioning approach

6. WEBHOOK INTEGRATION REQUIREMENTS
   Following webhook-architecture skill:
   - List expected webhook sources
   - Event types per source
   - Resilience requirements (idempotency, failure recovery)

7. EMAIL DELIVERY REQUIREMENTS
   - Transactional email types (welcome, license, password reset)
   - Lifecycle emails (trial reminders, subscription updates)
   - Email provider choice (Resend, SendGrid, AWS SES)

8. MVP FEATURE SCOPE
   - Must-have features for launch
   - Nice-to-have features (phase 2)
   - Explicitly out of scope

9. NON-FUNCTIONAL REQUIREMENTS
   - Expected scale (users, requests)
   - Performance requirements
   - Compliance requirements (GDPR, etc.)
```

## Phase 3: Architect Agent Prompt Extension

When invoking software-architect, include:

```
ADDITIONAL CONTEXT FOR SAAS ARCHITECTURE:

Frontend Framework: [Angular|React] (from Phase 0)

Reference skills:
- nx-workspace-architect (library structure)
- nestjs-backend-patterns (backend patterns)
- webhook-architecture (webhook handling patterns)
- resilient-nestjs-patterns (service orchestration, resilience, events)
- saas-platform-patterns (monetization, licensing, subscriptions)
- nestjs-deployment (Docker, production hardening)
- [selected frontend skill] (frontend patterns)
- ddd-architecture (domain patterns)

The implementation-plan.md MUST include:

1. WORKSPACE STRUCTURE
   Following nx-workspace-architect patterns:
   - List all libraries to create
   - Define tags for each library
   - Specify module boundary rules

2. DOMAIN LAYER ORGANIZATION
   For each bounded context:
   - domain/ library (entities, value objects)
   - application/ library (commands, queries)
   - infrastructure/ library (repositories)
   - feature/ library (controllers/components)

3. SHARED INFRASTRUCTURE
   - shared/domain (base classes, common value objects)
   - shared/infrastructure (database, auth, multitenancy)
   - shared/ui (design system components)
   - api-interfaces (DTOs, contracts)

4. MULTITENANCY IMPLEMENTATION
   Following nestjs-backend-patterns:
   - Tenant middleware/interceptor
   - ZenStack access policies
   - Prisma client factory

5. AUTHENTICATION SCAFFOLD
   Following nestjs-backend-patterns:
   - Auth provider interface
   - JWT strategy setup
   - Guards and decorators

6. WEBHOOK ARCHITECTURE
   Following webhook-architecture skill:
   - 3-layer pattern per webhook source
   - Signature verification strategy
   - Failed webhook storage schema

7. RESILIENCE PATTERNS
   Following resilient-nestjs-patterns skill:
   - Service orchestration for complex domains
   - Domain service layering (Controller/Service/DbService)
   - Retry + fallback for external calls
   - Event-driven side-effects (EventEmitter + SSE)
   - Dynamic module design (forRoot/forTesting)

8. MONETIZATION INFRASTRUCTURE
   Following saas-platform-patterns skill:
   - Plan configuration and feature gating
   - License generation and verification
   - Subscription state machine
   - Checkout and portal integration
   - Trial period management

9. DEPLOYMENT ARCHITECTURE
   Following nestjs-deployment skill:
   - Docker multi-stage build
   - Webpack externals configuration
   - Database migration strategy
   - Production hardening checklist

10. PHASE BREAKDOWN
    Batch 1: Workspace + shared infrastructure
    Batch 2: Authentication + multitenancy
    Batch 3: Webhook + resilience infrastructure
    Batch 4: Monetization infrastructure (licensing, subscriptions)
    Batch 5: First domain (scaffold only)
    Batch 6: Deployment configuration (Docker, CI/CD)
    Batch 7: Build verification
```

## Phase 4-5: Team Leader Task Batching

### Batch 1: Workspace Foundation

```
Tasks:
1. Create Nx workspace with preset
2. Configure ESLint with module boundaries
3. Setup Prisma shared library
4. Create shared/domain library with base classes
5. Create api-interfaces library
```

### Batch 2: Infrastructure Layer

```
Tasks:
1. Setup ZenStack schema with tenant policies
2. Create authentication module (provider pattern)
3. Create multitenancy middleware
4. Setup JWT strategy
5. Create shared guards and decorators
```

### Batch 3: Webhook & Resilience Infrastructure

```
Tasks:
1. Create webhook module (3-layer pattern per source)
2. Setup signature verification (SDK or manual HMAC)
3. Create FailedWebhook model and recovery endpoint
4. Setup EventEmitter module for async side-effects
5. Create SSE events module for real-time client updates
6. Implement retry utility for external service calls
```

### Batch 4: Monetization Infrastructure

```
Tasks:
1. Create plan configuration (tiers, features, limits)
2. Create license module (generation, verification endpoint)
3. Create subscription module (state machine, webhook handlers)
4. Setup checkout validation and portal integration
5. Create email module (provider pattern with retry)
6. Setup trial management (reminders, auto-downgrade)
```

### Batch 5: First Domain Scaffold

```
Tasks:
1. Create [domain]/domain library
2. Create [domain]/application library
3. Create [domain]/infrastructure library
4. Create [domain]/feature library (NestJS)
5. Create [domain]/feature library ([Angular|React])
```

### Batch 6: Deployment Configuration

```
Tasks:
1. Create Dockerfile.dev (development with hot reload)
2. Create Dockerfile (multi-stage production build)
3. Create docker-compose.yml (local dev with PostgreSQL)
4. Configure webpack externals for problematic packages
5. Setup health check endpoint
6. Configure production hardening (rate limiting, CORS, validation)
```

### Batch 7: Verification

```
Tasks:
1. Build all libraries
2. Run linting
3. Generate Prisma client
4. Verify module boundaries
5. Docker build test
6. Health check smoke test
```

## Developer Agent Skill References

When team-leader assigns tasks, developers should reference:

| Task Area              | Skill Reference                                                   |
| ---------------------- | ----------------------------------------------------------------- |
| Workspace setup        | nx-workspace-architect                                            |
| Library creation       | nx-workspace-architect/references/library-creation.md             |
| Module boundaries      | nx-workspace-architect/references/module-boundaries.md            |
| Auth implementation    | nestjs-backend-patterns/references/authentication.md              |
| Multitenancy           | nestjs-backend-patterns/references/multitenancy.md                |
| Prisma/ZenStack        | nestjs-backend-patterns/references/prisma-zenstack.md             |
| Webhook handling       | webhook-architecture                                              |
| Signature verification | webhook-architecture/references/signature-verification.md         |
| Webhook resilience     | webhook-architecture/references/resilience-and-recovery.md        |
| Service decomposition  | resilient-nestjs-patterns/references/service-orchestration.md     |
| Domain layering        | resilient-nestjs-patterns/references/domain-service-layering.md   |
| Retry/fallback         | resilient-nestjs-patterns/references/retry-and-fallback.md        |
| Events + SSE           | resilient-nestjs-patterns/references/event-driven-architecture.md |
| Dynamic modules        | resilient-nestjs-patterns/references/dynamic-modules.md           |
| Freemium/trials        | saas-platform-patterns/references/freemium-model.md               |
| License management     | saas-platform-patterns/references/license-lifecycle.md            |
| Subscription engine    | saas-platform-patterns/references/subscription-state-machine.md   |
| Checkout/portal        | saas-platform-patterns/references/checkout-and-portal.md          |
| Docker deployment      | nestjs-deployment/references/docker-multistage.md                 |
| Production hardening   | nestjs-deployment/references/production-hardening.md              |
| Database migrations    | nestjs-deployment/references/database-migrations.md               |
| Webpack bundling       | nestjs-deployment/references/webpack-bundling.md                  |
| Entity design          | ddd-architecture/references/entities-aggregates.md                |
| Frontend (Angular)     | angular-frontend-patterns                                         |
| Frontend (React)       | react-best-practices, react-nx-patterns                           |

## Quick Commands

For continuing work on initialized workspace:

```
# Add new domain
/orchestrate add [domain-name] domain to TASK_XXXX

# Implement specific feature
/orchestrate [feature-name] for TASK_XXXX

# Add third-party integration
/orchestrate integrate [provider-type] using provider pattern
```

## Example Invocation

User: "Help me create a new multi-tenant SaaS for project management"

Orchestrator Response:

```
Starting SaaS workspace initialization...

**Step 1: Frontend Framework**

Which frontend framework would you like?

1. **Angular** — Signal-based, enterprise-grade (recommended for complex admin UIs)
2. **React** — Composition-based, flexible (recommended for consumer-facing apps)

---

Once you choose, I'll ask about your business requirements:

- SaaS type (B2B/B2C)
- Tenant model
- Core domains
- Authentication approach
- And more...
```

## References

### Core Architecture Skills (ptah-nx-saas plugin)

- [nx-workspace-architect](../nx-workspace-architect/SKILL.md) - Nx monorepo structure and library organization
- [nestjs-backend-patterns](../nestjs-backend-patterns/SKILL.md) - Provider pattern, auth, multitenancy, Prisma
- [webhook-architecture](../webhook-architecture/SKILL.md) - 3-layer webhook handling, signature verification, resilience
- [resilient-nestjs-patterns](../resilient-nestjs-patterns/SKILL.md) - Service orchestration, domain layering, retry/fallback, events
- [saas-platform-patterns](../saas-platform-patterns/SKILL.md) - Monetization, licensing, subscriptions, checkout
- [nestjs-deployment](../nestjs-deployment/SKILL.md) - Docker multi-stage, production hardening, migrations

### External Skills

- [ddd-architecture](../../ptah-core/skills/ddd-architecture/SKILL.md) - Domain patterns
- [orchestration](../../ptah-core/skills/orchestration/SKILL.md) - Workflow management
- [angular-frontend-patterns](../../ptah-angular/skills/angular-frontend-patterns/SKILL.md) - Angular patterns
- [react-best-practices](../../ptah-react/skills/react-best-practices/SKILL.md) - React patterns
- [react-nx-patterns](../../ptah-react/skills/react-nx-patterns/SKILL.md) - React + Nx patterns
