---
name: ddd-architecture
description: 'Domain-Driven Design patterns for scalable SaaS applications; use when structuring complex business domains, defining bounded contexts, implementing aggregates and entities, applying CQRS patterns, enabling event-driven architecture, and organizing the domain layer; involves user discussion to understand domain complexity.'
---

# Domain-Driven Design Architecture

Strategic and tactical DDD patterns for NestJS + Angular applications.

## When to Engage User

DDD is highly context-dependent. ALWAYS discuss with user before implementing:

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

```typescript
// libs/orders/domain/src/lib/entities/order.entity.ts
export class Order {
  private _id: OrderId;
  private _customerId: CustomerId;
  private _items: OrderItem[] = [];
  private _status: OrderStatus = OrderStatus.DRAFT;
  private _placedAt: Date | null = null;

  private _events: DomainEvent[] = [];

  private constructor(id: OrderId, customerId: CustomerId) {
    this._id = id;
    this._customerId = customerId;
  }

  // Factory method
  static create(customerId: CustomerId): Order {
    const order = new Order(OrderId.generate(), customerId);
    order.addEvent(new OrderCreated(order.id, customerId));
    return order;
  }

  // Reconstitute from persistence
  static reconstitute(data: OrderData): Order {
    const order = new Order(OrderId.fromString(data.id), CustomerId.fromString(data.customerId));
    order._items = data.items.map((i) => OrderItem.reconstitute(i));
    order._status = data.status;
    order._placedAt = data.placedAt;
    return order;
  }

  // Business methods
  addItem(productId: ProductId, quantity: number, unitPrice: Money): void {
    this.ensureCanModify();

    const existingItem = this._items.find((i) => i.productId.equals(productId));
    if (existingItem) {
      existingItem.increaseQuantity(quantity);
    } else {
      this._items.push(OrderItem.create(productId, quantity, unitPrice));
    }

    this.addEvent(new OrderItemAdded(this._id, productId, quantity));
  }

  place(): void {
    this.ensureCanModify();

    if (this._items.length === 0) {
      throw new DomainException('Cannot place empty order');
    }

    this._status = OrderStatus.PLACED;
    this._placedAt = new Date();
    this.addEvent(new OrderPlaced(this._id, this.total));
  }

  // Computed properties
  get id(): OrderId {
    return this._id;
  }
  get status(): OrderStatus {
    return this._status;
  }

  get total(): Money {
    return this._items.reduce((sum, item) => sum.add(item.subtotal), Money.zero());
  }

  // Domain events
  get events(): ReadonlyArray<DomainEvent> {
    return [...this._events];
  }

  clearEvents(): void {
    this._events = [];
  }

  private addEvent(event: DomainEvent): void {
    this._events.push(event);
  }

  private ensureCanModify(): void {
    if (this._status !== OrderStatus.DRAFT) {
      throw new DomainException('Order cannot be modified');
    }
  }
}
```

## Value Object Pattern

```typescript
// libs/shared/domain/src/lib/value-objects/money.ts
export class Money {
  private constructor(private readonly _amount: number, private readonly _currency: string = 'USD') {
    if (_amount < 0) {
      throw new DomainException('Money cannot be negative');
    }
  }

  static of(amount: number, currency = 'USD'): Money {
    return new Money(amount, currency);
  }

  static zero(currency = 'USD'): Money {
    return new Money(0, currency);
  }

  get amount(): number {
    return this._amount;
  }
  get currency(): string {
    return this._currency;
  }

  add(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this._amount + other._amount, this._currency);
  }

  subtract(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this._amount - other._amount, this._currency);
  }

  multiply(factor: number): Money {
    return new Money(this._amount * factor, this._currency);
  }

  equals(other: Money): boolean {
    return this._amount === other._amount && this._currency === other._currency;
  }

  private ensureSameCurrency(other: Money): void {
    if (this._currency !== other._currency) {
      throw new DomainException('Currency mismatch');
    }
  }
}
```

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
