# TASK_2025_043: License Server Implementation

**Created**: 2025-12-04
**Status**: Planned
**Type**: Backend Implementation (New Project)
**Owner**: team-leader

---

## 🎯 User Intent

Build a minimal NestJS license server that:

1. Verifies license keys for premium status
2. Handles Paymob payment webhooks
3. Generates and emails license keys to users
4. Stores users, subscriptions, and licenses in PostgreSQL

**Key Simplification**: We do NOT store OAuth tokens. Users manage their own API keys (either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`) directly in VS Code settings.

---

## 📊 Context from Previous Tasks

This task is the implementation phase of **TASK_2025_041** (Claude Agent SDK Research) which produced:

- Business model strategy (freemium SaaS)
- Simplified architecture (no OAuth storage)
- Premium features powered by Claude Agent SDK

**Critical Decision from User**:

> "i think we don't need to store the claude oauth token or deal with it at all, its just a setting variable that users can se in their vs code IDE"

This drastically simplified the license server requirements.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────┐
│         VS CODE EXTENSION               │
│  User sets in VS Code settings:         │
│  • ptah.licenseKey                      │
│  • ptah.anthropicApiKey (option 1)      │
│  • ptah.claudeOAuthToken (option 2)     │
└─────────────┬───────────────────────────┘
              │ Only for license verification
              ▼
┌─────────────────────────────────────────┐
│      LICENSE SERVER (NestJS)            │
│                                          │
│  POST /api/v1/licenses/verify           │
│  POST /api/v1/webhooks/paymob           │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│      PostgreSQL (3 tables)              │
│  • users                                 │
│  • subscriptions                         │
│  • licenses                              │
└─────────────────────────────────────────┘
```

---

## 🎯 Success Criteria

### Must Have

- ✅ 2 API endpoints working (verify, webhook)
- ✅ PostgreSQL with 3 tables
- ✅ License key generation (`ptah_lic_{32-hex}`)
- ✅ Paymob webhook signature verification
- ✅ Email service for license key delivery

### Nice to Have

- 🔮 Deployment to DigitalOcean
- 🔮 Docker Compose setup
- 🔮 API documentation (Swagger)
- 🔮 Health check endpoint

---

## 📝 Related Documentation

Key documents copied to this task:

- **SIMPLIFIED_ARCHITECTURE.md** - Complete simplified architecture (3 tables, 2 endpoints)
- **LICENSE_SERVER_ARCHITECTURE.md** - Original detailed architecture (reference only)
- **PREMIUM_SAAS_STRATEGY.md** - Business model context

**Important**: Use SIMPLIFIED_ARCHITECTURE.md as the source of truth. The LICENSE_SERVER_ARCHITECTURE.md has outdated OAuth storage logic that we're NOT implementing.

---

## 🚀 Implementation Timeline

**Estimated**: 2-3 days

**Week 1: Backend MVP**

- Day 1: NestJS project setup, PostgreSQL schema
- Day 2: Licenses controller + Webhooks controller
- Day 3: Email service + Testing

---

## 🔗 Dependencies

**Tech Stack** (as requested by user):

- NestJS (backend framework)
- PostgreSQL (database)
- Paymob (payment processor for Egypt)
- DigitalOcean (deployment)
- SendGrid/Resend (email delivery)

**No Dependencies on**:

- ❌ WorkOS (removed - no auth needed)
- ❌ OAuth encryption (removed - no token storage)
- ❌ Device tracking (removed - accept sharing risk for MVP)

---

## 📌 Key Constraints

1. **Minimal Scope**: Only 2 endpoints, no complex features
2. **No OAuth Storage**: Users manage their own API/OAuth tokens
3. **Egypt Payment Focus**: Paymob integration required
4. **Fast Go-to-Market**: Keep it simple for 4-week launch

---

## 🎯 Next Steps

1. Create `task-description.md` (requirements)
2. Create `implementation-plan.md` (detailed design)
3. Team-leader will break down into atomic tasks
4. Developers will implement each task
5. Senior-tester will validate functionality
