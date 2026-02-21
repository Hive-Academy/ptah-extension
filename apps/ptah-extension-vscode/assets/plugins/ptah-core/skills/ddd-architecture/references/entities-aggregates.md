# Entities and Aggregates

Deep dive into DDD entity and aggregate patterns.

## Entity Design Principles

1. **Identity** - Unique identifier, not attributes
2. **Lifecycle** - Created, modified, potentially deleted
3. **Behavior** - Methods that enforce business rules
4. **Encapsulation** - Internal state protected

### Entity Base Class

```typescript
// libs/shared/domain/src/lib/entity.base.ts
export abstract class Entity<TId extends EntityId> {
  protected abstract _id: TId;
  private _events: DomainEvent[] = [];

  get id(): TId {
    return this._id;
  }

  get domainEvents(): ReadonlyArray<DomainEvent> {
    return [...this._events];
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._events.push(event);
  }

  clearDomainEvents(): void {
    this._events = [];
  }

  equals(other: Entity<TId>): boolean {
    if (!other) return false;
    if (this === other) return true;
    return this._id.equals(other._id);
  }
}
```

### Entity ID Value Object

```typescript
// libs/shared/domain/src/lib/entity-id.ts
export abstract class EntityId {
  protected constructor(protected readonly _value: string) {
    if (!_value || _value.trim().length === 0) {
      throw new DomainException('Entity ID cannot be empty');
    }
  }

  get value(): string {
    return this._value;
  }

  equals(other: EntityId): boolean {
    if (!other) return false;
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}

// Domain-specific IDs
export class OrderId extends EntityId {
  private constructor(value: string) {
    super(value);
  }

  static generate(): OrderId {
    return new OrderId(randomUUID());
  }

  static fromString(value: string): OrderId {
    return new OrderId(value);
  }
}

export class CustomerId extends EntityId {
  private constructor(value: string) {
    super(value);
  }

  static fromString(value: string): CustomerId {
    return new CustomerId(value);
  }
}
```

## Aggregate Design

Aggregates define consistency boundaries. Rules:

1. **Single root** - One entity is the aggregate root
2. **Internal references by ID only** - Don't hold references to other aggregates
3. **Transactional boundary** - One aggregate per transaction
4. **Invariants** - Root enforces all business rules

### Aggregate Root Example

```typescript
// libs/orders/domain/src/lib/aggregates/order.aggregate.ts
export class Order extends Entity<OrderId> {
  protected _id: OrderId;
  private _customerId: CustomerId;
  private _items: OrderItem[] = [];
  private _status: OrderStatus;
  private _shippingAddress: Address | null = null;
  private _createdAt: Date;
  private _updatedAt: Date;

  // Private constructor - use factory methods
  private constructor(props: OrderProps) {
    super();
    this._id = props.id;
    this._customerId = props.customerId;
    this._status = props.status;
    this._items = props.items;
    this._shippingAddress = props.shippingAddress;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  // Factory: Create new order
  static create(customerId: CustomerId): Order {
    const now = new Date();
    const order = new Order({
      id: OrderId.generate(),
      customerId,
      status: OrderStatus.DRAFT,
      items: [],
      shippingAddress: null,
      createdAt: now,
      updatedAt: now,
    });

    order.addDomainEvent(
      new OrderCreatedEvent({
        orderId: order.id.value,
        customerId: customerId.value,
        createdAt: now,
      })
    );

    return order;
  }

  // Factory: Reconstitute from persistence
  static reconstitute(props: OrderProps): Order {
    return new Order(props);
  }

  // === Commands (state-modifying methods) ===

  addItem(productId: ProductId, productName: string, quantity: number, unitPrice: Money): void {
    this.assertCanModify();
    this.assertValidQuantity(quantity);

    const existingItem = this.findItem(productId);

    if (existingItem) {
      existingItem.adjustQuantity(existingItem.quantity + quantity);
    } else {
      this._items.push(
        OrderItem.create({
          productId,
          productName,
          quantity,
          unitPrice,
        })
      );
    }

    this._updatedAt = new Date();
    this.addDomainEvent(
      new OrderItemAddedEvent({
        orderId: this._id.value,
        productId: productId.value,
        quantity,
      })
    );
  }

  removeItem(productId: ProductId): void {
    this.assertCanModify();

    const index = this._items.findIndex((i) => i.productId.equals(productId));
    if (index === -1) {
      throw new DomainException('Item not found in order');
    }

    this._items.splice(index, 1);
    this._updatedAt = new Date();
  }

  setShippingAddress(address: Address): void {
    this.assertCanModify();
    this._shippingAddress = address;
    this._updatedAt = new Date();
  }

  submit(): void {
    this.assertCanModify();

    if (this._items.length === 0) {
      throw new DomainException('Cannot submit order without items');
    }

    if (!this._shippingAddress) {
      throw new DomainException('Shipping address is required');
    }

    this._status = OrderStatus.SUBMITTED;
    this._updatedAt = new Date();

    this.addDomainEvent(
      new OrderSubmittedEvent({
        orderId: this._id.value,
        customerId: this._customerId.value,
        total: this.total.amount,
        itemCount: this._items.length,
        submittedAt: this._updatedAt,
      })
    );
  }

  confirm(): void {
    if (this._status !== OrderStatus.SUBMITTED) {
      throw new DomainException('Only submitted orders can be confirmed');
    }

    this._status = OrderStatus.CONFIRMED;
    this._updatedAt = new Date();

    this.addDomainEvent(
      new OrderConfirmedEvent({
        orderId: this._id.value,
        confirmedAt: this._updatedAt,
      })
    );
  }

  cancel(reason: string): void {
    if (this._status === OrderStatus.SHIPPED) {
      throw new DomainException('Cannot cancel shipped order');
    }

    this._status = OrderStatus.CANCELLED;
    this._updatedAt = new Date();

    this.addDomainEvent(
      new OrderCancelledEvent({
        orderId: this._id.value,
        reason,
        cancelledAt: this._updatedAt,
      })
    );
  }

  // === Queries (read-only) ===

  get customerId(): CustomerId {
    return this._customerId;
  }

  get status(): OrderStatus {
    return this._status;
  }

  get items(): ReadonlyArray<OrderItem> {
    return [...this._items];
  }

  get itemCount(): number {
    return this._items.reduce((sum, item) => sum + item.quantity, 0);
  }

  get total(): Money {
    return this._items.reduce((sum, item) => sum.add(item.subtotal), Money.zero());
  }

  get shippingAddress(): Address | null {
    return this._shippingAddress;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  // === Private helpers ===

  private assertCanModify(): void {
    if (this._status !== OrderStatus.DRAFT) {
      throw new DomainException(`Cannot modify order in ${this._status} status`);
    }
  }

  private assertValidQuantity(quantity: number): void {
    if (quantity <= 0) {
      throw new DomainException('Quantity must be positive');
    }
  }

  private findItem(productId: ProductId): OrderItem | undefined {
    return this._items.find((i) => i.productId.equals(productId));
  }
}
```

### Child Entity (Within Aggregate)

```typescript
// libs/orders/domain/src/lib/entities/order-item.ts
export class OrderItem {
  private _productId: ProductId;
  private _productName: string;
  private _quantity: number;
  private _unitPrice: Money;

  private constructor(props: OrderItemProps) {
    this._productId = props.productId;
    this._productName = props.productName;
    this._quantity = props.quantity;
    this._unitPrice = props.unitPrice;
  }

  static create(props: OrderItemProps): OrderItem {
    if (props.quantity <= 0) {
      throw new DomainException('Quantity must be positive');
    }
    return new OrderItem(props);
  }

  static reconstitute(props: OrderItemProps): OrderItem {
    return new OrderItem(props);
  }

  adjustQuantity(newQuantity: number): void {
    if (newQuantity <= 0) {
      throw new DomainException('Quantity must be positive');
    }
    this._quantity = newQuantity;
  }

  get productId(): ProductId {
    return this._productId;
  }

  get productName(): string {
    return this._productName;
  }

  get quantity(): number {
    return this._quantity;
  }

  get unitPrice(): Money {
    return this._unitPrice;
  }

  get subtotal(): Money {
    return this._unitPrice.multiply(this._quantity);
  }
}
```

## Aggregate Design Guidelines

### Keep Aggregates Small

```typescript
// ❌ BAD: Too large, spans multiple concerns
class Order {
  customer: Customer; // Full customer object
  products: Product[]; // Full product objects
  payments: Payment[]; // Full payment objects
  shippingInfo: Shipping;
}

// ✅ GOOD: Small, references by ID
class Order {
  customerId: CustomerId; // Just the ID
  items: OrderItem[]; // Only order-specific data
  shippingAddressId: AddressId; // Just the ID
}
```

### One Aggregate Per Transaction

```typescript
// ❌ BAD: Modifying multiple aggregates
async placeOrder(orderId: string) {
  const order = await this.orderRepo.findById(orderId);
  const customer = await this.customerRepo.findById(order.customerId);
  const inventory = await this.inventoryRepo.findById(order.productId);

  order.place();
  customer.addPoints(order.total);     // Different aggregate!
  inventory.decreaseStock(order.qty);   // Different aggregate!

  // Transaction spans 3 aggregates - BAD!
  await this.save(order, customer, inventory);
}

// ✅ GOOD: One aggregate, events for side effects
async placeOrder(orderId: string) {
  const order = await this.orderRepo.findById(orderId);

  order.place();  // Raises OrderPlaced event

  await this.orderRepo.save(order);
  await this.eventBus.publish(order.domainEvents);
}

// Separate handlers react to events
@EventHandler(OrderPlacedEvent)
handleOrderPlaced(event: OrderPlacedEvent) {
  // Handle in separate transaction
  await this.customerService.addPoints(event.customerId, event.total);
}
```

### Reference Other Aggregates by ID

```typescript
// libs/orders/domain/src/lib/aggregates/order.aggregate.ts
export class Order {
  // References by ID, not full objects
  private _customerId: CustomerId;
  private _shippingAddressId: AddressId | null;
  private _appliedCouponId: CouponId | null;

  // If you need related data, fetch in application service
}

// libs/orders/application/src/lib/services/order.service.ts
@Injectable()
export class OrderApplicationService {
  async getOrderDetails(orderId: string): Promise<OrderDetailsDto> {
    const order = await this.orderRepo.findById(OrderId.fromString(orderId));

    // Fetch related data from other aggregates
    const customer = await this.customerRepo.findById(order.customerId);
    const address = order.shippingAddressId ? await this.addressRepo.findById(order.shippingAddressId) : null;

    return this.mapper.toDetailsDto(order, customer, address);
  }
}
```
