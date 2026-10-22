---
name: resilient-nestjs-patterns
description: 'NestJS service decomposition and resilience. Use when splitting an orchestrator service into layers, adding retries or fallbacks, wiring EventEmitter events or SSE, or designing forRoot/forTesting dynamic modules. Persistence, auth, RBAC and repositories are nestjs-backend-patterns. Webhook plumbing is webhook-architecture. A task that both persists and retries may load both skills.'
---

# Resilient NestJS Patterns

## Apply

- Use during a Stage B module task when the module needs orchestration, reliability, events, or configurable wiring.
- Keep controllers at the HTTP boundary, domain services responsible for business rules, and database services responsible for persistence and transactions.
- Retry only transient external failures with a bounded policy; make fallback behavior explicit. Keep side effects behind events when they should not block the core transaction.
- Expose configuration through a dynamic module when provider choices vary by environment or tests.
- When patterns compose, a thin controller calls a business orchestrator; it delegates persistence to a DbService, external calls to a resilient adapter, and emits a domain event only after the transaction succeeds. Event listeners handle email or SSE; the module exports the orchestrator and supplies production and test providers through `forRoot` and `forTesting`.

## Selection and adoption

| Current problem | Route |
| --- | --- |
| Controller calls Prisma, owns transactions, or mixes HTTP mapping with business rules | [Domain service layering](references/domain-service-layering.md) first |
| Service has unrelated method clusters or too many collaborators to test | [Service orchestration](references/service-orchestration.md) after layering |
| Transient provider errors, a local fallback, or provider downtime | [Retry and fallback](references/retry-and-fallback.md); this can be adopted independently |
| Email, cache invalidation, audit work, or SSE coupled to the core method | [Event-driven architecture](references/event-driven-architecture.md) after service boundaries are clear |
| Repeated provider setup, environment choices, or test substitutes | [Dynamic modules](references/dynamic-modules.md) once the module structure is stable |

Adopt only patterns justified by a current problem; do not decompose a small cohesive service just to fit this sequence.

## Failure patterns

| Symptom | Correct route |
| --- | --- |
| Fat controller with business logic | Domain service layering |
| God service spanning unrelated concerns | Service orchestration |
| Silent failure from an empty catch around an external call | Retry and fallback with explicit failure handling |
| Synchronous email or other side effect blocking the response | Event-driven architecture |
| Copy-pasted provider arrays across modules | Dynamic modules |
| Premature decomposition of a small service | Keep it cohesive (YAGNI) |

## Load by task

- For a domain service coordinating several collaborators, load [service orchestration](references/service-orchestration.md).
- For controller, business, and database boundaries, load [domain service layering](references/domain-service-layering.md).
- For external provider failures, load [retry and fallback](references/retry-and-fallback.md).
- For decoupled side effects or SSE, load [event-driven architecture](references/event-driven-architecture.md).
- For configurable provider wiring and test substitutes, load [dynamic modules](references/dynamic-modules.md).
