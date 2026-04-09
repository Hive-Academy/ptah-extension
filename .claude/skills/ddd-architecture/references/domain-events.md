# Domain Events

Event-driven patterns for loosely coupled domain logic.

## Event Structure

```typescript
// libs/shared/domain/src/lib/domain-event.ts
export abstract class DomainEvent {
  readonly occurredAt: Date;
  readonly eventId: string;
  abstract readonly eventType: string;

  constructor() {
    this.occurredAt = new Date();
    this.eventId = randomUUID();
  }
}
```

### Event Definition

```typescript
// libs/orders/domain/src/lib/events/order-placed.event.ts
export class OrderPlacedEvent extends DomainEvent {
  readonly eventType = 'order.placed';

  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly total: number,
    public readonly items: OrderItemDto[],
  ) {
    super();
  }
}

export class OrderCancelledEvent extends DomainEvent {
  readonly eventType = 'order.cancelled';

  constructor(
    public readonly orderId: string,
    public readonly reason: string,
    public readonly refundAmount: number,
  ) {
    super();
  }
}
```

## Raising Events in Aggregates

```typescript
// libs/orders/domain/src/lib/aggregates/order.aggregate.ts
export class Order extends Entity<OrderId> {
  private domainEvents: DomainEvent[] = [];

  protected addDomainEvent(event: DomainEvent): void {
    this.domainEvents.push(event);
  }

  getDomainEvents(): DomainEvent[] {
    return [...this.domainEvents];
  }

  clearDomainEvents(): void {
    this.domainEvents = [];
  }

  // Business method that raises event
  place(): void {
    this.assertCanPlace();

    this._status = OrderStatus.PLACED;
    this._placedAt = new Date();

    // Raise domain event
    this.addDomainEvent(
      new OrderPlacedEvent(
        this._id.value,
        this._customerId.value,
        this.total.amount,
        this._items.map((i) => i.toDto()),
      ),
    );
  }

  cancel(reason: string): void {
    this.assertCanCancel();

    const refundAmount = this.calculateRefund();
    this._status = OrderStatus.CANCELLED;

    this.addDomainEvent(new OrderCancelledEvent(this._id.value, reason, refundAmount));
  }
}
```

## Publishing Events

### After Repository Save

```typescript
// libs/orders/infrastructure/src/lib/repositories/order.repository.ts
@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async save(order: Order): Promise<void> {
    // Get events before clearing
    const events = order.getDomainEvents();

    // Persist aggregate
    await this.prisma.$transaction(async (tx) => {
      await tx.order.upsert({
        where: { id: order.id.value },
        create: this.toCreateData(order),
        update: this.toUpdateData(order),
      });

      // Save items
      await tx.orderItem.deleteMany({
        where: { orderId: order.id.value },
      });
      await tx.orderItem.createMany({
        data: order.items.map((i) => this.toItemData(order.id, i)),
      });
    });

    // Clear events from aggregate
    order.clearDomainEvents();

    // Publish events after successful transaction
    for (const event of events) {
      await this.eventBus.publish(event);
    }
  }
}
```

### Using NestJS CQRS

```typescript
// libs/orders/application/src/lib/commands/place-order.handler.ts
@CommandHandler(PlaceOrderCommand)
export class PlaceOrderHandler implements ICommandHandler<PlaceOrderCommand> {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<void> {
    const order = await this.orderRepository.findById(OrderId.fromString(command.orderId));

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    order.place();

    await this.orderRepository.save(order);

    // Publish all domain events
    const events = order.getDomainEvents();
    order.clearDomainEvents();

    for (const event of events) {
      this.eventBus.publish(event);
    }
  }
}
```

## Event Handlers

### In-Process Handler

```typescript
// libs/orders/application/src/lib/event-handlers/order-placed.handler.ts
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

@EventsHandler(OrderPlacedEvent)
export class OrderPlacedHandler implements IEventHandler<OrderPlacedEvent> {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly inventoryService: InventoryService,
  ) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    // Send confirmation email
    await this.notificationService.sendOrderConfirmation(event.customerId, event.orderId);

    // Reserve inventory
    await this.inventoryService.reserveItems(
      event.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
    );
  }
}
```

### Multiple Handlers Per Event

```typescript
// libs/analytics/application/src/lib/handlers/order-analytics.handler.ts
@EventsHandler(OrderPlacedEvent)
export class OrderAnalyticsHandler implements IEventHandler<OrderPlacedEvent> {
  constructor(private readonly analyticsService: AnalyticsService) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    await this.analyticsService.trackOrder({
      orderId: event.orderId,
      customerId: event.customerId,
      total: event.total,
      itemCount: event.items.length,
    });
  }
}

// libs/loyalty/application/src/lib/handlers/loyalty-points.handler.ts
@EventsHandler(OrderPlacedEvent)
export class LoyaltyPointsHandler implements IEventHandler<OrderPlacedEvent> {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    const points = Math.floor(event.total);
    await this.loyaltyService.awardPoints(event.customerId, points);
  }
}
```

## Cross-Boundary Events

For events that need to cross bounded context boundaries:

### Event Gateway

```typescript
// libs/shared/infrastructure/src/lib/event-gateway.ts
@Injectable()
export class EventGateway {
  constructor(
    private readonly eventBus: EventBus,
    private readonly messageBroker: MessageBrokerService, // RabbitMQ, etc.
  ) {}

  async publish(event: DomainEvent): Promise<void> {
    // Publish to local handlers
    this.eventBus.publish(event);

    // Publish to other bounded contexts via message broker
    await this.messageBroker.publish(event.eventType, this.serialize(event));
  }

  private serialize(event: DomainEvent): string {
    return JSON.stringify({
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      payload: event,
    });
  }
}
```

### Integration Events

```typescript
// libs/orders/application/src/lib/integration-events/order-placed.integration.ts

// Integration event - cleaner interface for other contexts
export class OrderPlacedIntegrationEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly total: number,
    public readonly placedAt: Date,
  ) {}

  static fromDomain(event: OrderPlacedEvent): OrderPlacedIntegrationEvent {
    return new OrderPlacedIntegrationEvent(event.orderId, event.customerId, event.total, event.occurredAt);
  }
}
```

## Event Sourcing (Advanced)

For systems that need complete audit trails:

```typescript
// libs/orders/infrastructure/src/lib/event-store/order-event-store.ts
@Injectable()
export class OrderEventStore {
  constructor(private readonly prisma: PrismaService) {}

  async appendEvents(aggregateId: string, events: DomainEvent[]): Promise<void> {
    const currentVersion = await this.getCurrentVersion(aggregateId);

    await this.prisma.$transaction(
      events.map((event, index) =>
        this.prisma.eventStore.create({
          data: {
            aggregateId,
            aggregateType: 'Order',
            eventType: event.eventType,
            version: currentVersion + index + 1,
            payload: JSON.stringify(event),
            occurredAt: event.occurredAt,
          },
        }),
      ),
    );
  }

  async getEvents(aggregateId: string): Promise<DomainEvent[]> {
    const records = await this.prisma.eventStore.findMany({
      where: { aggregateId },
      orderBy: { version: 'asc' },
    });

    return records.map((r) => this.deserialize(r.eventType, r.payload));
  }

  // Rebuild aggregate from events
  async loadAggregate(aggregateId: string): Promise<Order | null> {
    const events = await this.getEvents(aggregateId);

    if (events.length === 0) return null;

    return Order.rehydrate(aggregateId, events);
  }

  private async getCurrentVersion(aggregateId: string): Promise<number> {
    const result = await this.prisma.eventStore.aggregate({
      where: { aggregateId },
      _max: { version: true },
    });
    return result._max.version ?? 0;
  }

  private deserialize(eventType: string, payload: string): DomainEvent {
    const data = JSON.parse(payload);
    // Map event type to class...
    switch (eventType) {
      case 'order.created':
        return new OrderCreatedEvent(data.orderId, data.customerId);
      case 'order.placed':
        return new OrderPlacedEvent(data.orderId, data.customerId, data.total, data.items);
      // ...
      default:
        throw new Error(`Unknown event type: ${eventType}`);
    }
  }
}
```

## Testing Events

```typescript
describe('Order Aggregate Events', () => {
  it('should raise OrderPlacedEvent when placed', () => {
    // Arrange
    const order = Order.create(CustomerId.fromString('cust-1'));
    order.addItem(ProductId.fromString('prod-1'), 'Widget', 2, Money.of(50));
    order.setShippingAddress(AddressId.fromString('addr-1'));

    // Act
    order.place();

    // Assert
    const events = order.getDomainEvents();
    expect(events).toHaveLength(2); // Created + Placed

    const placedEvent = events.find((e) => e instanceof OrderPlacedEvent) as OrderPlacedEvent;

    expect(placedEvent).toBeDefined();
    expect(placedEvent.orderId).toBe(order.id.value);
    expect(placedEvent.total).toBe(100);
  });
});
```
