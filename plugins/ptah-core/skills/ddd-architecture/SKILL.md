---
name: ddd-architecture
description: 'Domain-Driven Design for complex business domains. Use when deciding whether DDD is warranted, defining bounded contexts, aggregates, entities and value objects, applying CQRS or domain events, or organizing a domain layer. .NET project and solution layout is dotnet-solution-architect.'
---

# Domain-Driven Design Architecture

Decide whether DDD is warranted, then load the one reference that owns the pattern. Do not implement a base class or a library layout from this file.

## When to Engage User

DDD is highly context-dependent. ALWAYS discuss with user before implementing.

If this skill is invoked from `saas-workspace-initializer` Step a2, the Round 1 discovery answers (jobs-to-be-done, candidate domains, MVP scope) are already available — use them and do not re-ask the equivalent questions. Ask only what those answers leave open.

Load [references/discovery.md](references/discovery.md) only when domain discovery is still open.

## Warrant

Score with the user before writing pattern code. Count the yeses:

- Do entities have complex lifecycles? (draft → approved → fulfilled)
- Are there business rules that span multiple entities?
- Do different parts of the system use different terminology?
- Is there a need for audit trails or event sourcing?
- Will multiple teams work on different parts?

| Yeses | Do |
| ----- | -- |
| 0-1 | Simple services. Stop. |
| 2-3 | Tactical patterns only (entities, value objects). |
| 4-5 | Strategic DDD: bounded contexts, then the tactical patterns. |

Situations the score alone does not route:

| Situation | Do |
| --------- | -- |
| Simple CRUD | Same as 0-1. Skip DDD. |
| Multiple teams | Bounded contexts, even when the rest of the score is low. |
| High consistency needs | Aggregates + domain events. Load entities-aggregates.md and domain-events.md. |

## Rules that break silently

1. Copy `Entity`, `EntityId`, and `ValueObject` from the references below. Do not hand-roll a base class.
2. One aggregate per transaction; refer to other aggregates by id. Home: [references/entities-aggregates.md](references/entities-aggregates.md).

## References

| Load | When |
| ---- | ---- |
| [references/discovery.md](references/discovery.md) | Domain discovery is still open. |
| [references/entities-aggregates.md](references/entities-aggregates.md) | Writing an entity, an identity type, or an aggregate. |
| [references/value-objects.md](references/value-objects.md) | Writing a value object. |
| [references/cqrs-pattern.md](references/cqrs-pattern.md) | Separating commands from queries, or a read path dominates. |
| [references/domain-events.md](references/domain-events.md) | Recording what happened, eventual consistency, or an audit trail. |
| [references/repository-pattern.md](references/repository-pattern.md) | Persisting an aggregate. |
| [references/layer-layout.md](references/layer-layout.md) | Organizing a domain library into folders. |
