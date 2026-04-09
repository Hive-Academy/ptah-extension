# Retry and Fallback Patterns

## Overview

External services fail. Networks time out, APIs return 503s, rate limits trigger 429s. These patterns ensure your application degrades gracefully instead of crashing on every transient failure.

## Pattern 1: Retry with Exponential Backoff

### The Utility Function

```typescript
// libs/shared/resilience/src/lib/with-retry.ts
export interface RetryOptions {
  maxAttempts?: number; // Default: 3
  baseDelayMs?: number; // Default: 1000. Actual: baseDelay * 2^(attempt-1)
  maxDelayMs?: number; // Default: 30000
  isRetryable?: (error: unknown) => boolean; // Default: all errors
  logger?: Logger;
  operationName?: string;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 30000, isRetryable = () => true, logger, operationName = 'operation' } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) break;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      logger?.warn(`${operationName} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

### Retryable Error Detection

Not all errors should be retried. A 400 Bad Request will fail every time.

```typescript
// libs/shared/resilience/src/lib/retryable-errors.ts
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableHttpError(error: unknown): boolean {
  if (error instanceof Error) {
    if ('code' in error) {
      const code = (error as NodeJS.ErrnoException).code;
      return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(code ?? '');
    }
    if ('status' in error) {
      return RETRYABLE_STATUS_CODES.has((error as { status: number }).status);
    }
  }
  return false;
}
```

### Using Retry in a Service

```typescript
@Injectable()
export class PaymentApiService {
  private readonly logger = new Logger(PaymentApiService.name);

  constructor(@Inject('PAYMENT_CLIENT') private readonly client: IPaymentClient) {}

  async createSubscription(data: CreateSubscriptionInput): Promise<PaymentSubscription> {
    return withRetry(() => this.client.createSubscription(data), { maxAttempts: 3, baseDelayMs: 1000, isRetryable: isRetryableHttpError, logger: this.logger, operationName: 'PaymentAPI.createSubscription' });
  }
}
```

### Timing: `baseDelayMs: 1000`, `maxAttempts: 3`

```
Attempt 1: immediate     -> FAIL -> wait 1s
Attempt 2: after 1s      -> FAIL -> wait 2s
Attempt 3: after 2s      -> FAIL -> throw
Total wait before failure: ~3 seconds + operation time
```

## Pattern 2: Fallback Strategy

When an external service is down, fall back to a secondary data source.

```typescript
@Injectable()
export class SubscriptionSyncService {
  private readonly logger = new Logger(SubscriptionSyncService.name);

  constructor(
    private readonly paymentApi: PaymentApiService,
    private readonly dbService: SubscriptionDbService,
  ) {}

  async getSubscriptionStatus(userId: string, externalId: string): Promise<SubscriptionInfo> {
    try {
      // Primary: external API (retry built into PaymentApiService)
      const remote = await this.paymentApi.getSubscription(externalId);
      await this.dbService.updateStatus(externalId, remote.status); // Cache locally
      return { ...remote, requiresSync: false };
    } catch (error) {
      // Fallback: local database
      this.logger.warn(`Payment API unavailable for ${externalId}, using local data`);
      const local = await this.dbService.findByExternalId(externalId);
      if (!local) throw new NotFoundException(`Subscription ${externalId} not found`);
      return { externalId: local.externalId, status: local.status, plan: local.plan, currentPeriodEnd: local.currentPeriodEnd, requiresSync: true };
    }
  }
}
```

The `requiresSync: true` flag marks stale data. A scheduled job reconciles later:

```typescript
@Injectable()
export class SyncReconciliationJob {
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile() {
    const stale = await this.dbService.findRequiringSync();
    for (const sub of stale) {
      try {
        const remote = await this.paymentApi.getSubscription(sub.externalId);
        await this.dbService.updateFromRemote(sub.id, remote);
      } catch {
        /* Still unavailable -- will retry next cycle */
      }
    }
  }
}
```

## Pattern 3: Circuit Breaker (Advanced)

For high-volume external calls, a circuit breaker prevents cascading failures.

```
CLOSED (normal)  ->  failures exceed threshold  ->  OPEN (fail fast)
                                                     |  timeout elapsed
                     HALF_OPEN (test one request) <--+
                       success -> CLOSED
                       failure -> OPEN
```

```bash
npm install opossum
```

```typescript
import CircuitBreaker from 'opossum';

export function createCircuitBreaker<T extends unknown[], R>(fn: (...args: T) => Promise<R>, options: { name?: string; timeout?: number; errorThresholdPercentage?: number; resetTimeout?: number } = {}): CircuitBreaker<T, R> {
  const logger = new Logger(`CircuitBreaker:${options.name ?? 'default'}`);
  const breaker = new CircuitBreaker(fn, {
    timeout: options.timeout ?? 5000,
    errorThresholdPercentage: options.errorThresholdPercentage ?? 50,
    resetTimeout: options.resetTimeout ?? 30000,
  });
  breaker.on('open', () => logger.warn('Circuit OPENED'));
  breaker.on('close', () => logger.log('Circuit CLOSED'));
  return breaker;
}
```

## Combining All Three

```
Request -> Circuit Breaker (fail fast) -> Retry (handle transient) -> Fallback (local data)
```

```typescript
@Injectable()
export class ResilientPaymentService implements OnModuleInit {
  private breaker: CircuitBreaker<[string], PaymentSubscription>;

  constructor(
    @Inject('PAYMENT_CLIENT') private readonly client: IPaymentClient,
    private readonly dbService: SubscriptionDbService,
  ) {}

  onModuleInit() {
    this.breaker = createCircuitBreaker((id: string) => withRetry(() => this.client.getSubscription(id), { maxAttempts: 3, baseDelayMs: 500, isRetryable: isRetryableHttpError }), { name: 'PaymentAPI', timeout: 10000, resetTimeout: 60000 });
  }

  async getSubscription(externalId: string): Promise<SubscriptionInfo> {
    try {
      const remote = await this.breaker.fire(externalId);
      return { ...remote, requiresSync: false };
    } catch {
      const local = await this.dbService.findByExternalId(externalId);
      if (!local) throw new NotFoundException(`Subscription ${externalId} not found`);
      return { ...local, requiresSync: true };
    }
  }
}
```

## When to Use Each

| Pattern         | Use When                                                 | Overhead |
| --------------- | -------------------------------------------------------- | -------- |
| Retry           | Transient failures (timeouts, 503s)                      | Low      |
| Fallback        | App must work when external service is completely down   | Low      |
| Circuit breaker | Hundreds of requests/min AND extended downstream outages | Medium   |

**Start with retry only.** Add fallback when uptime is critical. Add circuit breaker when call volume is high.

## Testing

```typescript
describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    const op = jest.fn().mockResolvedValue('ok');
    expect(await withRetry(op)).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('should retry and succeed on second attempt', async () => {
    const op = jest.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');
    expect(await withRetry(op, { baseDelayMs: 1 })).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('should throw after max attempts', async () => {
    const op = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(op, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow('fail');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('should not retry non-retryable errors', async () => {
    const op = jest.fn().mockRejectedValue(new Error('bad'));
    await expect(withRetry(op, { isRetryable: () => false, baseDelayMs: 1 })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionSyncService', () => {
  it('should use fallback when API fails', async () => {
    paymentApi.getSubscription.mockRejectedValue(new Error('down'));
    dbService.findByExternalId.mockResolvedValue({ externalId: 'ext-1', status: 'active', plan: 'pro', currentPeriodEnd: new Date() } as any);

    const result = await service.getSubscriptionStatus('user-1', 'ext-1');
    expect(result.requiresSync).toBe(true);
  });
});
```
