# Task Context - TASK_2025_112

**Task ID**: TASK_2025_112
**Created**: 2026-01-22T13:10:00+02:00
**Status**: Architecture Phase (Restructured)
**Type**: FEATURE (Major Enhancement)
**Requested By**: User

---

## Original User Request

> Actually, I don't want to have these comments. I would rather make it through our Angular UI setting.
>
> Actually, I wanted to also focus on something else related to how our local setup works, because so far I can't run this server. I can't see we don't have any Docker Compose with PostgreSQL and the required configuration for the different tools we are using.
>
> Also, I don't know if we are correctly implementing the authentication workflow for users to gain the license, as mentioned in this task. I think it was a previous task with payment implemented. I wanted to change just to use a Paddle and implement Battle into our workflow, so this is going to be like much more feature-rich task with implementing payment was Paddle and checking our authentication with Work OS and making sure it works correctly. A very important part of this task is the front-end integration with our Ptah landing page. We need to add there or show there our plans section in the landing page, and add a login page and also a profile page with a subscription and all of this information.

## User Intent (Interpretation)

The user wants to **replace and enhance TASK_2025_075** (simplified license server) with a **production-ready SaaS licensing system** that includes:

1. **Paddle Payment Integration**: Replace manual license creation with automated subscription management
2. **WorkOS Authentication**: Replace magic links with enterprise-grade SSO
3. **Docker Development Environment**: Local setup with PostgreSQL, Redis, and all required services
4. **DigitalOcean Deployment**: Production deployment configuration
5. **Frontend Integration**: Pricing page, login page, profile/subscription dashboard in Ptah Angular landing page
6. **Settings UI**: Angular webview settings for license key management (not command palette)

---

## Task Restructuring (User Decision: 2026-01-22)

**User Feedback**: "The task is only focused on the frontend and completely ignored the docker setup and backend setup for paddle and work os. Shouldn't that be done before the frontend?"

**Decision**: Split into **two sequential phases**:

### Phase A: Infrastructure + Backend (TASK_2025_112A)

**Scope**:

1. Docker Compose development environment (PostgreSQL, Redis, license-server)
2. Backend Paddle integration (webhooks, subscription lifecycle)
3. Backend WorkOS/Auth integration (OIDC with PKCE)
4. Environment configuration (.env.example files)
5. DigitalOcean deployment documentation

**Deliverable**: `implementation-plan-phase-a.md`

### Phase B: Frontend Integration (TASK_2025_112B)

**Scope**:

1. Angular routing infrastructure
2. Pricing page with Paddle checkout
3. Login page with WorkOS SSO
4. Profile page with license management
5. Design assets integration

**Deliverable**: `implementation-plan-phase-b.md` (current `implementation-plan.md` renamed)

**Dependency**: Phase B depends on Phase A completion (backend APIs must exist before frontend can integrate)

---

## Context from TASK_2025_075

**Existing Infrastructure** (70% complete):

- ✅ PostgreSQL schema (Users, Licenses tables)
- ✅ License verification API (`POST /verify`)
- ✅ NestJS license server skeleton
- ✅ VS Code `LicenseService` with caching
- ✅ Conditional MCP registration
- ✅ Magic link authentication (basic)
- ❌ Missing: Payment integration (Paddle)
- ❌ Missing: Production auth (WorkOS SSO)
- ❌ Missing: Docker Compose setup
- ❌ Missing: Frontend pages (pricing, login, profile)

## Research Completed

See `research-findings.md` for detailed technical recommendations:

| Area      | Recommendation                                       |
| --------- | ---------------------------------------------------- |
| Payment   | Paddle Billing API v2 (unified REST, tax compliance) |
| Auth      | WorkOS OIDC with PKCE (OAuth 2.1 compliant)          |
| Hosting   | DigitalOcean App Platform + Managed PostgreSQL HA    |
| Local Dev | Docker Compose with WSL2 native filesystem           |

## Success Criteria

**Phase A (Infrastructure + Backend)**:

- [ ] `docker-compose up` starts PostgreSQL, Redis, license-server
- [ ] Paddle webhooks correctly provision licenses
- [ ] WorkOS OIDC/PKCE flow works end-to-end
- [ ] Comprehensive `.env.example` with setup instructions
- [ ] DigitalOcean deployment guide documented

**Phase B (Frontend)**:

- [ ] Angular routing with `/pricing`, `/login`, `/profile` routes
- [ ] Pricing page displays plans and triggers Paddle checkout
- [ ] Login page initiates WorkOS SSO flow
- [ ] Profile page shows license status with copy functionality
- [ ] Design system compliance (Ptah Egyptian aesthetic)

---

**Current Phase**: Phase A - Architecture Review
**Next Step**: Create `implementation-plan-phase-a.md` for user approval
