---
name: ddd-architecture
description: 'Domain-Driven Design patterns for scalable SaaS applications; use when structuring complex business domains, defining bounded contexts, implementing aggregates and entities, applying CQRS patterns, enabling event-driven architecture, and organizing the domain layer; involves user discussion to understand domain complexity.'
---

# Domain-Driven Design Architecture

Strategic and tactical DDD patterns for NestJS + Angular applications.

## When to Engage User

DDD is highly context-dependent. ALWAYS discuss with user before implementing.

If this skill is invoked from `saas-workspace-initializer` Step a2, the Round 1 discovery answers (jobs-to-be-done, candidate domains, MVP scope) are already available — use them and do not re-ask the equivalent questions below. Ask only what those answers leave open.

### Discovery Questions

1. **Domain Complexity**
   - "What are your core business entities and their relationships?"
   - "Which operations are most critical to get right?"
   - "Are there complex business rules or validations?"

2. **Bounded Contexts**
   - "Are there distinct business areas that use different terminology?"
   - "Which teams will own which parts of the system?"
   - "Do you have existing systems that define boundaries?"

3. **Scale & Performance**
   - "Which read operations are most frequent?"
   - "Are there operations that need eventual consistency?"
   - "Do you need audit trails for business operations?"

## DDD Building Blocks

| Concept        | Purpose                 | Example                     |
| -------------- | ----------------------- | --------------------------- |
| Entity         | Identity + lifecycle    | User, Order, Product        |
| Value Object   | Attributes, no identity | Money, Address, Email       |
| Aggregate      | Consistency boundary    | Order + OrderItems          |
| Domain Event   | Record what happened    | OrderPlaced, UserRegistered |
| Repository     | Persistence abstraction | OrderRepository             |
| Domain Service | Cross-aggregate logic   | PaymentProcessor            |

## Project Structure

```
libs/
├── [domain]/
│   ├── domain/                 # Core domain logic
│   │   └── src/lib/
│   │       ├── entities/       # Entities and aggregates
│   │       ├── value-objects/  # Value objects
│   │       ├── events/         # Domain events
│   │       ├── services/       # Domain services
│   │       └── repositories/   # Repository interfaces
│   │
│   ├── application/            # Use cases / application services
│   │   └── src/lib/
│   │       ├── commands/       # Command handlers
│   │       ├── queries/        # Query handlers
│   │       └── services/       # Application services
│   │
│   ├── infrastructure/         # Technical implementations
│   │   └── src/lib/
│   │       ├── persistence/    # Repository implementations
│   │       ├── messaging/      # Event publishing
│   │       └── external/       # External service adapters
│   │
│   └── feature/                # Controllers / presenters
│       └── src/lib/
│           └── controllers/
```

## Entity Pattern

An entity has identity, a private constructor reached through factories, and
business methods that guard their own invariants. It extends a shared `Entity`
base that supplies identity equality and the domain-event buffer:

```typescript
export class Order extends Entity<OrderId> {
  private constructor(
    id: OrderId,
    private _customerId: CustomerId,
  ) {
    super(id);
  }

  static create(customerId: CustomerId): Order; // new, raises OrderCreated
  static reconstitute(data: OrderData): Order; // rehydrate, raises nothing

  addItem(productId: ProductId, qty: number, unitPrice: Money): void;
  place(): void; // rejects an empty order
  get total(): Money; // derived, never stored
}
```

Read [references/entities-aggregates.md](references/entities-aggregates.md) for
the full pattern — the `Entity` and `EntityId` base classes, the invariant
guards, and the aggregate-root rules. Do not hand-roll a base class from this
sketch; the reference version is the one to copy.

## Value Object Pattern

A value object has no identity — two instances with equal contents are equal. It
is immutable, validates in its constructor, and returns new instances from every
operation. It extends a shared `ValueObject` base that supplies structural
equality:

```typescript
export class Money extends ValueObject<{ amount: number; currency: string }> {
  static of(amount: number, currency?: string): Money; // throws if negative
  static zero(currency?: string): Money;

  add(other: Money): Money; // all three reject a currency mismatch
  subtract(other: Money): Money;
  multiply(factor: number): Money;
}
```

Read [references/value-objects.md](references/value-objects.md) for the
`ValueObject` base class and further worked examples (`Email`, `Address`,
`DateRange`, `Percentage`).

## Decision Matrix: When to Use DDD

| Scenario               | Recommendation                                  |
| ---------------------- | ----------------------------------------------- |
| Simple CRUD            | Skip DDD, use basic services                    |
| Medium complexity      | Use tactical patterns (entities, value objects) |
| Complex domain         | Full DDD with bounded contexts                  |
| Multiple teams         | Bounded contexts essential                      |
| High consistency needs | Aggregates + domain events                      |

## Complexity Assessment

Before implementing DDD, assess with user:

```
□ Do entities have complex lifecycles? (draft → approved → fulfilled)
□ Are there business rules that span multiple entities?
□ Do different parts of the system use different terminology?
□ Is there a need for audit trails or event sourcing?
□ Will multiple teams work on different parts?
```

**Score:**

- 0-1: Simple services sufficient
- 2-3: Tactical DDD patterns
- 4-5: Full strategic DDD

## References

Load for detailed implementation:

- [entities-aggregates.md](references/entities-aggregates.md) - Entity and aggregate patterns
- [value-objects.md](references/value-objects.md) - Value object implementations
- [cqrs-pattern.md](references/cqrs-pattern.md) - Command/Query separation
- [domain-events.md](references/domain-events.md) - Event-driven patterns
- [repository-pattern.md](references/repository-pattern.md) - Persistence abstraction
