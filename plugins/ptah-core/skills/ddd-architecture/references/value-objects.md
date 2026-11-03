# Value Objects

Immutable objects defined by their attributes, not identity.

## Value Object Principles

1. **Immutability** - Once created, never changes
2. **Equality by value** - Equal if all attributes are equal
3. **Self-validation** - Invalid values can't be created
4. **Side-effect free** - Methods return new instances

## Value Object Base Class

```typescript
// libs/shared/domain/src/lib/value-object.base.ts
export abstract class ValueObject<T extends Record<string, any>> {
  protected readonly props: T;

  protected constructor(props: T) {
    this.props = Object.freeze(props);
  }

  equals(other: ValueObject<T>): boolean {
    if (!other) return false;
    if (this === other) return true;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }

  // For serialization
  toValue(): T {
    return { ...this.props };
  }
}
```

## Common Value Objects

### Money

```typescript
// libs/shared/domain/src/lib/value-objects/money.ts
export class Money extends ValueObject<{ amount: number; currency: string }> {
  private constructor(amount: number, currency: string) {
    super({ amount, currency });
  }

  static of(amount: number, currency = 'USD'): Money {
    if (amount < 0) {
      throw new DomainException('Amount cannot be negative');
    }
    // Round to 2 decimal places
    const rounded = Math.round(amount * 100) / 100;
    return new Money(rounded, currency.toUpperCase());
  }

  static zero(currency = 'USD'): Money {
    return new Money(0, currency.toUpperCase());
  }

  static fromCents(cents: number, currency = 'USD'): Money {
    return new Money(cents / 100, currency.toUpperCase());
  }

  get amount(): number {
    return this.props.amount;
  }

  get currency(): string {
    return this.props.currency;
  }

  get cents(): number {
    return Math.round(this.props.amount * 100);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.amount - other.amount;
    if (result < 0) {
      throw new DomainException('Result cannot be negative');
    }
    return Money.of(result, this.currency);
  }

  multiply(factor: number): Money {
    if (factor < 0) {
      throw new DomainException('Factor cannot be negative');
    }
    return Money.of(this.amount * factor, this.currency);
  }

  percentage(percent: number): Money {
    return this.multiply(percent / 100);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount < other.amount;
  }

  format(locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
    }).format(this.amount);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainException(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
```

### Email

```typescript
// libs/shared/domain/src/lib/value-objects/email.ts
export class Email extends ValueObject<{ value: string }> {
  private static readonly PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  private constructor(value: string) {
    super({ value });
  }

  static create(value: string): Email {
    const trimmed = value.trim().toLowerCase();

    if (!Email.PATTERN.test(trimmed)) {
      throw new DomainException(`Invalid email format: ${value}`);
    }

    return new Email(trimmed);
  }

  get value(): string {
    return this.props.value;
  }

  get domain(): string {
    return this.props.value.split('@')[1];
  }

  get localPart(): string {
    return this.props.value.split('@')[0];
  }
}
```

### Address

```typescript
// libs/shared/domain/src/lib/value-objects/address.ts
interface AddressProps {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  line2?: string;
}

export class Address extends ValueObject<AddressProps> {
  private constructor(props: AddressProps) {
    super(props);
  }

  static create(props: AddressProps): Address {
    if (!props.street?.trim()) {
      throw new DomainException('Street is required');
    }
    if (!props.city?.trim()) {
      throw new DomainException('City is required');
    }
    if (!props.postalCode?.trim()) {
      throw new DomainException('Postal code is required');
    }
    if (!props.country?.trim()) {
      throw new DomainException('Country is required');
    }

    return new Address({
      street: props.street.trim(),
      city: props.city.trim(),
      state: props.state?.trim() || '',
      postalCode: props.postalCode.trim(),
      country: props.country.trim().toUpperCase(),
      line2: props.line2?.trim(),
    });
  }

  get street(): string {
    return this.props.street;
  }
  get line2(): string | undefined {
    return this.props.line2;
  }
  get city(): string {
    return this.props.city;
  }
  get state(): string {
    return this.props.state;
  }
  get postalCode(): string {
    return this.props.postalCode;
  }
  get country(): string {
    return this.props.country;
  }

  format(): string {
    const lines = [this.street, this.line2, `${this.city}, ${this.state} ${this.postalCode}`, this.country].filter(Boolean);
    return lines.join('\n');
  }

  formatOneLine(): string {
    return `${this.street}, ${this.city}, ${this.state} ${this.postalCode}, ${this.country}`;
  }

  withStreet(street: string): Address {
    return Address.create({ ...this.props, street });
  }
}
```

### DateRange

```typescript
// libs/shared/domain/src/lib/value-objects/date-range.ts
interface DateRangeProps {
  start: Date;
  end: Date;
}

export class DateRange extends ValueObject<DateRangeProps> {
  private constructor(start: Date, end: Date) {
    super({ start, end });
  }

  static create(start: Date, end: Date): DateRange {
    if (end < start) {
      throw new DomainException('End date must be after start date');
    }
    return new DateRange(new Date(start), new Date(end));
  }

  static fromNow(durationMs: number): DateRange {
    const start = new Date();
    const end = new Date(start.getTime() + durationMs);
    return new DateRange(start, end);
  }

  get start(): Date {
    return new Date(this.props.start);
  }
  get end(): Date {
    return new Date(this.props.end);
  }

  get durationMs(): number {
    return this.props.end.getTime() - this.props.start.getTime();
  }

  get durationDays(): number {
    return Math.ceil(this.durationMs / (1000 * 60 * 60 * 24));
  }

  contains(date: Date): boolean {
    return date >= this.props.start && date <= this.props.end;
  }

  overlaps(other: DateRange): boolean {
    return this.props.start <= other.end && this.props.end >= other.start;
  }

  isActive(): boolean {
    const now = new Date();
    return this.contains(now);
  }

  extend(durationMs: number): DateRange {
    return DateRange.create(this.props.start, new Date(this.props.end.getTime() + durationMs));
  }
}
```

### Percentage

```typescript
// libs/shared/domain/src/lib/value-objects/percentage.ts
export class Percentage extends ValueObject<{ value: number }> {
  private constructor(value: number) {
    super({ value });
  }

  static of(value: number): Percentage {
    if (value < 0 || value > 100) {
      throw new DomainException('Percentage must be between 0 and 100');
    }
    return new Percentage(value);
  }

  static fromDecimal(decimal: number): Percentage {
    return Percentage.of(decimal * 100);
  }

  get value(): number {
    return this.props.value;
  }
  get decimal(): number {
    return this.props.value / 100;
  }

  applyTo(amount: number): number {
    return amount * this.decimal;
  }

  applyToMoney(money: Money): Money {
    return money.multiply(this.decimal);
  }

  add(other: Percentage): Percentage {
    return Percentage.of(this.value + other.value);
  }

  format(): string {
    return `${this.value}%`;
  }
}
```

## Using Value Objects in Entities

```typescript
export class Order {
  private _total: Money;
  private _shippingAddress: Address;
  private _customerEmail: Email;
  private _validUntil: DateRange;
  private _discount: Percentage;

  applyDiscount(discount: Percentage): void {
    this._discount = discount;
    // Recalculate total
    const discountAmount = discount.applyToMoney(this._subtotal);
    this._total = this._subtotal.subtract(discountAmount);
  }

  setShippingAddress(address: Address): void {
    // Value object ensures validation
    this._shippingAddress = address;
  }
}
```

## Persistence Mapping

Value objects need to be mapped to/from database:

```typescript
// In repository implementation
class OrderRepository {
  async save(order: Order): Promise<void> {
    await this.prisma.order.create({
      data: {
        id: order.id.value,
        // Map Money value object to columns
        totalAmount: order.total.amount,
        totalCurrency: order.total.currency,
        // Map Address to JSON or separate columns
        shippingAddress: order.shippingAddress?.toValue(),
        // Map Email directly
        customerEmail: order.customerEmail.value,
      },
    });
  }

  async findById(id: OrderId): Promise<Order | null> {
    const data = await this.prisma.order.findUnique({
      where: { id: id.value },
    });

    if (!data) return null;

    return Order.reconstitute({
      id: OrderId.fromString(data.id),
      total: Money.of(data.totalAmount, data.totalCurrency),
      shippingAddress: data.shippingAddress ? Address.create(data.shippingAddress) : null,
      customerEmail: Email.create(data.customerEmail),
    });
  }
}
```
