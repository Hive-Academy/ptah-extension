# CQRS Pattern

Command Query Responsibility Segregation for NestJS.

## When to Use CQRS

| Use CQRS When               | Skip CQRS When          |
| --------------------------- | ----------------------- |
| Complex domain logic        | Simple CRUD             |
| Different read/write models | Same model for both     |
| Separate scaling needs      | Low traffic             |
| Event sourcing              | Traditional persistence |
| Multiple read views         | Single view             |

## Basic Structure

```
libs/[domain]/application/
├── commands/
│   ├── create-order.command.ts
│   ├── create-order.handler.ts
│   └── index.ts
├── queries/
│   ├── get-order.query.ts
│   ├── get-order.handler.ts
│   └── index.ts
└── dtos/
    ├── order.dto.ts
    └── order-list.dto.ts
```

## Command Pattern

### Command Definition

```typescript
// libs/orders/application/src/lib/commands/create-order.command.ts
export class CreateOrderCommand {
  constructor(public readonly customerId: string, public readonly items: CreateOrderItemDto[], public readonly shippingAddressId: string) {}
}

export interface CreateOrderItemDto {
  productId: string;
  quantity: number;
}
```

### Command Handler

```typescript
// libs/orders/application/src/lib/commands/create-order.handler.ts
import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
  constructor(private readonly orderRepository: OrderRepository, private readonly productRepository: ProductRepository, private readonly eventBus: EventBus) {}

  async execute(command: CreateOrderCommand): Promise<string> {
    // Create aggregate
    const order = Order.create(CustomerId.fromString(command.customerId));

    // Add items with validation
    for (const item of command.items) {
      const product = await this.productRepository.findById(ProductId.fromString(item.productId));

      if (!product) {
        throw new NotFoundException(`Product ${item.productId} not found`);
      }

      order.addItem(product.id, product.name, item.quantity, product.price);
    }

    // Set shipping address
    order.setShippingAddress(AddressId.fromString(command.shippingAddressId));

    // Persist
    await this.orderRepository.save(order);

    // Publish domain events
    const events = order.domainEvents;
    order.clearDomainEvents();
    events.forEach((event) => this.eventBus.publish(event));

    return order.id.value;
  }
}
```

### Command Bus Usage

```typescript
// libs/orders/feature/src/lib/controllers/orders.controller.ts
@Controller('orders')
export class OrdersController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  async createOrder(@Body() dto: CreateOrderDto): Promise<{ id: string }> {
    const command = new CreateOrderCommand(dto.customerId, dto.items, dto.shippingAddressId);

    const orderId = await this.commandBus.execute(command);

    return { id: orderId };
  }

  @Post(':id/submit')
  async submitOrder(@Param('id') id: string): Promise<void> {
    await this.commandBus.execute(new SubmitOrderCommand(id));
  }

  @Post(':id/cancel')
  async cancelOrder(@Param('id') id: string, @Body() dto: CancelOrderDto): Promise<void> {
    await this.commandBus.execute(new CancelOrderCommand(id, dto.reason));
  }
}
```

## Query Pattern

### Query Definition

```typescript
// libs/orders/application/src/lib/queries/get-order.query.ts
export class GetOrderQuery {
  constructor(public readonly orderId: string) {}
}

export class GetOrdersListQuery {
  constructor(public readonly customerId: string, public readonly page: number = 1, public readonly limit: number = 20, public readonly status?: OrderStatus) {}
}
```

### Query Handler

```typescript
// libs/orders/application/src/lib/queries/get-order.handler.ts
import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';

@QueryHandler(GetOrderQuery)
export class GetOrderHandler implements IQueryHandler<GetOrderQuery> {
  constructor(
    private readonly prisma: PrismaService // Direct DB access for reads
  ) {}

  async execute(query: GetOrderQuery): Promise<OrderDetailDto | null> {
    // Use optimized read query
    const order = await this.prisma.order.findUnique({
      where: { id: query.orderId },
      include: {
        items: {
          include: { product: true },
        },
        customer: true,
        shippingAddress: true,
      },
    });

    if (!order) return null;

    // Map to DTO
    return {
      id: order.id,
      status: order.status,
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        email: order.customer.email,
      },
      items: order.items.map((item) => ({
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.quantity * item.unitPrice,
      })),
      shippingAddress: {
        street: order.shippingAddress.street,
        city: order.shippingAddress.city,
        // ...
      },
      total: order.totalAmount,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

@QueryHandler(GetOrdersListQuery)
export class GetOrdersListHandler implements IQueryHandler<GetOrdersListQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetOrdersListQuery): Promise<PagedResult<OrderListDto>> {
    const where = {
      customerId: query.customerId,
      ...(query.status && { status: query.status }),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          itemCount: true,
          createdAt: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.totalAmount,
        itemCount: o.itemCount,
        createdAt: o.createdAt,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
```

### Query Bus Usage

```typescript
@Controller('orders')
export class OrdersController {
  constructor(private readonly commandBus: CommandBus, private readonly queryBus: QueryBus) {}

  @Get(':id')
  async getOrder(@Param('id') id: string): Promise<OrderDetailDto> {
    const order = await this.queryBus.execute(new GetOrderQuery(id));
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  @Get()
  async getOrders(@Query() params: GetOrdersParams, @CurrentUser() user: UserContext): Promise<PagedResult<OrderListDto>> {
    return this.queryBus.execute(new GetOrdersListQuery(user.customerId, params.page, params.limit, params.status));
  }
}
```

## Module Setup

```typescript
// libs/orders/feature/src/lib/orders.module.ts
import { CqrsModule } from '@nestjs/cqrs';

const CommandHandlers = [CreateOrderHandler, SubmitOrderHandler, CancelOrderHandler];

const QueryHandlers = [GetOrderHandler, GetOrdersListHandler];

const EventHandlers = [OrderPlacedHandler, OrderCancelledHandler];

@Module({
  imports: [CqrsModule, PrismaModule],
  controllers: [OrdersController],
  providers: [
    // Repository
    {
      provide: ORDER_REPOSITORY,
      useClass: PrismaOrderRepository,
    },
    // Handlers
    ...CommandHandlers,
    ...QueryHandlers,
    ...EventHandlers,
  ],
})
export class OrdersModule {}
```

## Separate Read Models

For complex scenarios, maintain separate read models:

```typescript
// libs/orders/application/src/lib/read-models/order-summary.read-model.ts
@EventHandler(OrderCreatedEvent)
@EventHandler(OrderItemAddedEvent)
@EventHandler(OrderSubmittedEvent)
export class OrderSummaryReadModel {
  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(OrderCreatedEvent)
  async onOrderCreated(event: OrderCreatedEvent) {
    await this.prisma.orderSummary.create({
      data: {
        orderId: event.orderId,
        customerId: event.customerId,
        status: 'DRAFT',
        itemCount: 0,
        total: 0,
        createdAt: event.createdAt,
      },
    });
  }

  @OnEvent(OrderItemAddedEvent)
  async onItemAdded(event: OrderItemAddedEvent) {
    // Update denormalized summary
    await this.prisma.orderSummary.update({
      where: { orderId: event.orderId },
      data: {
        itemCount: { increment: event.quantity },
        total: { increment: event.subtotal },
      },
    });
  }

  @OnEvent(OrderSubmittedEvent)
  async onOrderSubmitted(event: OrderSubmittedEvent) {
    await this.prisma.orderSummary.update({
      where: { orderId: event.orderId },
      data: {
        status: 'SUBMITTED',
        submittedAt: event.submittedAt,
      },
    });
  }
}
```

## Testing CQRS

```typescript
// libs/orders/application/src/lib/commands/create-order.handler.spec.ts
describe('CreateOrderHandler', () => {
  let handler: CreateOrderHandler;
  let orderRepository: MockType<OrderRepository>;
  let productRepository: MockType<ProductRepository>;
  let eventBus: MockType<EventBus>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CreateOrderHandler, { provide: ORDER_REPOSITORY, useFactory: mockRepository }, { provide: PRODUCT_REPOSITORY, useFactory: mockRepository }, { provide: EventBus, useFactory: mockEventBus }],
    }).compile();

    handler = module.get(CreateOrderHandler);
    orderRepository = module.get(ORDER_REPOSITORY);
    productRepository = module.get(PRODUCT_REPOSITORY);
    eventBus = module.get(EventBus);
  });

  it('should create order with items', async () => {
    // Arrange
    const product = createMockProduct({ price: Money.of(100) });
    productRepository.findById.mockResolvedValue(product);
    orderRepository.save.mockResolvedValue(undefined);

    const command = new CreateOrderCommand('customer-1', [{ productId: 'product-1', quantity: 2 }], 'address-1');

    // Act
    const orderId = await handler.execute(command);

    // Assert
    expect(orderId).toBeDefined();
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        _customerId: expect.any(CustomerId),
        _items: expect.arrayContaining([expect.objectContaining({ _quantity: 2 })]),
      })
    );
    expect(eventBus.publish).toHaveBeenCalledWith(expect.any(OrderCreatedEvent));
  });
});
```
