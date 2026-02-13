---
name: saas-workspace-initializer
description: Orchestrated workflow for initializing a complete SaaS workspace with NestJS, Angular, and Nx; use when starting a new SaaS project, setting up monorepo structure, creating multi-tenant architecture, or needing full PRD-to-implementation workflow; integrates with orchestration to coordinate PM, Architect, and Development agents.
---

# SaaS Workspace Initializer

Orchestrated workflow for spinning up production-ready SaaS applications using Nx, NestJS, and Angular.

## Trigger Keywords

When user mentions any of these, consider this skill:

- "new SaaS project", "start SaaS", "create SaaS"
- "multi-tenant", "multitenancy"
- "Nx monorepo", "NestJS + Angular"
- "initialize workspace", "scaffold workspace"

## Workflow Overview

```
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

## Phase 1: Scope Clarification Questions

Before invoking PM, ask user these critical questions:

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
   - External provider (Clerk, Auth0, etc.)
5. **Payment Provider**: Needed immediately or later?
6. **Deployment Target**:
   - Docker/Kubernetes
   - Serverless
   - PaaS (Render, Railway, etc.)

### Scale Context

7. **Team Size**: Solo, small team (2-5), or larger?
8. **Timeline**: MVP or production-ready?

## Phase 2: PM Agent Prompt Extension

When invoking project-manager, include:

```
ADDITIONAL CONTEXT FOR SAAS PRD:

Reference skill: saas-workspace-initializer

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

5. MVP FEATURE SCOPE
   - Must-have features for launch
   - Nice-to-have features (phase 2)
   - Explicitly out of scope

6. NON-FUNCTIONAL REQUIREMENTS
   - Expected scale (users, requests)
   - Performance requirements
   - Compliance requirements (GDPR, etc.)
```

## Phase 3: Architect Agent Prompt Extension

When invoking software-architect, include:

```
ADDITIONAL CONTEXT FOR SAAS ARCHITECTURE:

Reference skills:
- nx-workspace-architect (library structure)
- nestjs-backend-patterns (backend patterns)
- angular-frontend-patterns (frontend patterns)
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

6. PHASE BREAKDOWN
   Batch 1: Workspace + shared infrastructure
   Batch 2: Authentication + multitenancy
   Batch 3: First domain (scaffold only)
   Batch 4: Build verification
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

### Batch 3: First Domain Scaffold

```
Tasks:
1. Create [domain]/domain library
2. Create [domain]/application library
3. Create [domain]/infrastructure library
4. Create [domain]/feature library (NestJS)
5. Create [domain]/feature library (Angular)
```

### Batch 4: Verification

```
Tasks:
1. Build all libraries
2. Run linting
3. Generate Prisma client
4. Verify module boundaries
```

## Developer Agent Skill References

When team-leader assigns tasks, developers should reference:

| Task Area           | Skill Reference                                        |
| ------------------- | ------------------------------------------------------ |
| Workspace setup     | nx-workspace-architect                                 |
| Library creation    | nx-workspace-architect/references/library-creation.md  |
| Module boundaries   | nx-workspace-architect/references/module-boundaries.md |
| Auth implementation | nestjs-backend-patterns/references/authentication.md   |
| Multitenancy        | nestjs-backend-patterns/references/multitenancy.md     |
| Prisma/ZenStack     | nestjs-backend-patterns/references/prisma-zenstack.md  |
| Entity design       | ddd-architecture/references/entities-aggregates.md     |
| Angular patterns    | angular-frontend-patterns                              |

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

Before we proceed, I need to understand your requirements:

**Business Context:**
1. Is this B2B, B2C, or both?
2. Tenant model preference:
   - [ ] Shared database (simpler, recommended for MVP)
   - [ ] Database per tenant (stronger isolation)
3. Core domains (e.g., Projects, Tasks, Teams)?

**Technical Context:**
4. Authentication:
   - [ ] Built-in JWT (we control everything)
   - [ ] External provider (Clerk, Auth0 - faster to market)
5. Payment integration needed for MVP?

**Scale Context:**
6. Team size working on this?
7. Timeline: Quick MVP or production-ready architecture?

Reply with your choices and I'll create the PRD.
```

## References

- [nx-workspace-architect](../nx-workspace-architect/SKILL.md) - Workspace structure
- [nestjs-backend-patterns](../nestjs-backend-patterns/SKILL.md) - Backend patterns
- [angular-frontend-patterns](../angular-frontend-patterns/SKILL.md) - Frontend patterns
- [ddd-architecture](../ddd-architecture/SKILL.md) - Domain patterns
- [orchestration](../orchestration/SKILL.md) - Workflow management
