---
name: nestjs-backend-patterns
description: NestJS backend architecture for multi-tenant SaaS. Use for third-party API providers, Prisma or ZenStack setup, multitenancy, authentication, RBAC or policies, and repositories. Not for retries, events or dynamic modules — use resilient-nestjs-patterns.
---

# NestJS Backend Architecture Patterns

## Apply

- During a Stage B module task, keep controllers thin and put integration, tenancy, and authorization behind services. Stage A may scaffold only thin primitives.
- Wrap each external SDK with an injected provider and export a service from its module; keep provider selection and credentials in configuration.
- Resolve tenant context before database access and deny access when it is missing. Enforce resource permissions at the query or policy boundary, not only in controllers.
- Keep authentication, authorization, persistence, and external integration in their respective modules.
- Place shared Prisma, auth, and provider adapters under `shared/`; place domain controllers and DTOs in the domain's `feature-api` library.

## Load by task

- For an external API adapter or provider switch, load [third-party integration](references/third-party-integration.md).
- For tenant isolation and context propagation, load [multitenancy](references/multitenancy.md).
- For Prisma or ZenStack setup and access policies, load [Prisma and ZenStack](references/prisma-zenstack.md).
- For roles and resource permissions, load [authorization](references/authorization.md).
- For JWT, Passport, or OAuth, load [authentication](references/authentication.md).
