# Repository Pattern

Persistence abstraction for domain aggregates.

## Repository Principles

1. **One per aggregate root** - Not for child entities
2. **Collection interface** - Feels like in-memory collection
3. **Domain terms** - Uses domain language, not SQL
4. **Returns aggregates** - Full aggregate, not partial data

## Repository Interface

```typescript
// libs/orders/domain/src/lib/repositories/order.repository.ts

// Define in domain layer - no infrastructure dependencies
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  findByCustomerId(customerId: CustomerId): Promise<Order[]>;
  save(order: Order): Promise<void>;
  delete(order: Order): Promise<void>;
  nextId(): OrderId;
}

// Token for dependency injection
export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
```

## Prisma Implementation

```typescript
// libs/orders/infrastructure/src/lib/repositories/prisma-order.repository.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService, private readonly eventPublisher: EventPublisher) {}

  async findById(id: OrderId): Promise<Order | null> {
    const data = await this.prisma.order.findUnique({
      where: { id: id.value },
      include: {
        items: true,
      },
    });

    if (!data) return null;

    return this.toDomain(data);
  }

  async findByCustomerId(customerId: CustomerId): Promise<Order[]> {
    const orders = await this.prisma.order.findMany({
      where: { customerId: customerId.value },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((o) => this.toDomain(o));
  }

  async save(order: Order): Promise<void> {
    const events = order.domainEvents;

    await this.prisma.$transaction(async (tx) => {
      // Upsert main aggregate
      await tx.order.upsert({
        where: { id: order.id.value },
        create: this.toCreateData(order),
        update: this.toUpdateData(order),
      });

      // Sync items: delete all and recreate
      await tx.orderItem.deleteMany({
        where: { orderId: order.id.value },
      });

      if (order.items.length > 0) {
        await tx.orderItem.createMany({
          data: order.items.map((item) => ({
            id: randomUUID(),
            orderId: order.id.value,
            productId: item.productId.value,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice.amount,
            unitPriceCurrency: item.unitPrice.currency,
          })),
        });
      }
    });

    // Publish events after successful transaction
    order.clearDomainEvents();
    for (const event of events) {
      await this.eventPublisher.publish(event);
    }
  }

  async delete(order: Order): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.orderItem.deleteMany({
        where: { orderId: order.id.value },
      }),
      this.prisma.order.delete({
        where: { id: order.id.value },
      }),
    ]);
  }

  nextId(): OrderId {
    return OrderId.generate();
  }

  // === Mapping methods ===

  private toDomain(data: OrderWithItems): Order {
    return Order.reconstitute({
      id: OrderId.fromString(data.id),
      customerId: CustomerId.fromString(data.customerId),
      status: data.status as OrderStatus,
      items: data.items.map((item) =>
        OrderItem.reconstitute({
          productId: ProductId.fromString(item.productId),
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: Money.of(item.unitPrice, item.unitPriceCurrency),
        })
      ),
      shippingAddressId: data.shippingAddressId ? AddressId.fromString(data.shippingAddressId) : null,
      total: Money.of(data.totalAmount, data.totalCurrency),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  private toCreateData(order: Order) {
    return {
      id: order.id.value,
      customerId: order.customerId.value,
      status: order.status,
      shippingAddressId: order.shippingAddressId?.value ?? null,
      totalAmount: order.total.amount,
      totalCurrency: order.total.currency,
      createdAt: order.createdAt,
      updatedAt: new Date(),
    };
  }

  private toUpdateData(order: Order) {
    return {
      status: order.status,
      shippingAddressId: order.shippingAddressId?.value ?? null,
      totalAmount: order.total.amount,
      totalCurrency: order.total.currency,
      updatedAt: new Date(),
    };
  }
}
```

## Module Registration

```typescript
// libs/orders/infrastructure/src/lib/orders-infrastructure.module.ts
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: ORDER_REPOSITORY,
      useClass: PrismaOrderRepository,
    },
    EventPublisher,
  ],
  exports: [ORDER_REPOSITORY],
})
export class OrdersInfrastructureModule {}

// libs/orders/feature/src/lib/orders.module.ts
@Module({
  imports: [CqrsModule, OrdersInfrastructureModule],
  controllers: [OrdersController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class OrdersModule {}
```

## Usage in Command Handlers

```typescript
// libs/orders/application/src/lib/commands/submit-order.handler.ts
@CommandHandler(SubmitOrderCommand)
export class SubmitOrderHandler implements ICommandHandler<SubmitOrderCommand> {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository
  ) {}

  async execute(command: SubmitOrderCommand): Promise<void> {
    // 1. Retrieve aggregate
    const order = await this.orderRepository.findById(OrderId.fromString(command.orderId));

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 2. Execute domain logic (raises events internally)
    order.submit();

    // 3. Persist (repository publishes events)
    await this.orderRepository.save(order);
  }
}
```

## Specification Pattern

For complex queries:

```typescript
// libs/orders/domain/src/lib/specifications/order.specification.ts
export interface OrderSpecification {
  toQuery(): Prisma.OrderWhereInput;
}

export class OrdersByStatusSpecification implements OrderSpecification {
  constructor(private readonly status: OrderStatus) {}

  toQuery(): Prisma.OrderWhereInput {
    return { status: this.status };
  }
}

export class OrdersByDateRangeSpecification implements OrderSpecification {
  constructor(private readonly startDate: Date, private readonly endDate: Date) {}

  toQuery(): Prisma.OrderWhereInput {
    return {
      createdAt: {
        gte: this.startDate,
        lte: this.endDate,
      },
    };
  }
}

export class CompositeSpecification implements OrderSpecification {
  constructor(private readonly specs: OrderSpecification[]) {}

  toQuery(): Prisma.OrderWhereInput {
    return {
      AND: this.specs.map((s) => s.toQuery()),
    };
  }
}
```

### Using Specifications

```typescript
// In repository
async findBySpecification(spec: OrderSpecification): Promise<Order[]> {
  const data = await this.prisma.order.findMany({
    where: spec.toQuery(),
    include: { items: true },
  });
  return data.map(d => this.toDomain(d));
}

// Usage
const pendingThisWeek = new CompositeSpecification([
  new OrdersByStatusSpecification(OrderStatus.PENDING),
  new OrdersByDateRangeSpecification(startOfWeek, endOfWeek),
]);

const orders = await orderRepository.findBySpecification(pendingThisWeek);
```

## Unit of Work (Optional)

For coordinating multiple repositories:

```typescript
// libs/shared/infrastructure/src/lib/unit-of-work.ts
export interface UnitOfWork {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  private tx: Prisma.TransactionClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async begin(): Promise<void> {
    // Prisma doesn't support long-running transactions
    // Use interactive transactions instead
  }

  async executeInTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      return work(tx);
    });
  }
}

// Usage in application service
async transferOrder(fromCustomerId: string, toCustomerId: string, orderId: string) {
  await this.unitOfWork.executeInTransaction(async (tx) => {
    const order = await this.orderRepo.withTransaction(tx).findById(orderId);
    order.transferTo(CustomerId.fromString(toCustomerId));
    await this.orderRepo.withTransaction(tx).save(order);

    await this.auditRepo.withTransaction(tx).log(/* ... */);
  });
}
```

## Testing Repositories

```typescript
// libs/orders/infrastructure/src/lib/repositories/prisma-order.repository.spec.ts
describe('PrismaOrderRepository', () => {
  let repository: PrismaOrderRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [PrismaOrderRepository, EventPublisher],
    }).compile();

    repository = module.get(PrismaOrderRepository);
    prisma = module.get(PrismaService);

    // Clean up
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
  });

  it('should save and retrieve order', async () => {
    // Arrange
    const order = Order.create(CustomerId.fromString('customer-1'));
    order.addItem(ProductId.fromString('product-1'), 'Widget', 2, Money.of(50));

    // Act
    await repository.save(order);
    const retrieved = await repository.findById(order.id);

    // Assert
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id.equals(order.id)).toBe(true);
    expect(retrieved!.items).toHaveLength(1);
    expect(retrieved!.total.amount).toBe(100);
  });

  it('should update existing order', async () => {
    // Arrange
    const order = Order.create(CustomerId.fromString('customer-1'));
    await repository.save(order);

    // Act
    order.addItem(ProductId.fromString('product-1'), 'Widget', 1, Money.of(50));
    await repository.save(order);

    // Assert
    const retrieved = await repository.findById(order.id);
    expect(retrieved!.items).toHaveLength(1);
  });
});
```

## In-Memory Repository (Testing)

```typescript
// libs/orders/infrastructure/src/lib/repositories/in-memory-order.repository.ts
export class InMemoryOrderRepository implements OrderRepository {
  private orders: Map<string, Order> = new Map();

  async findById(id: OrderId): Promise<Order | null> {
    return this.orders.get(id.value) ?? null;
  }

  async findByCustomerId(customerId: CustomerId): Promise<Order[]> {
    return Array.from(this.orders.values()).filter((o) => o.customerId.equals(customerId));
  }

  async save(order: Order): Promise<void> {
    this.orders.set(order.id.value, order);
  }

  async delete(order: Order): Promise<void> {
    this.orders.delete(order.id.value);
  }

  nextId(): OrderId {
    return OrderId.generate();
  }

  // Test helpers
  clear(): void {
    this.orders.clear();
  }

  count(): number {
    return this.orders.size;
  }
}
```
