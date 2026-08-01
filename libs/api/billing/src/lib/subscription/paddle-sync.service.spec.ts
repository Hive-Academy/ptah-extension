/**
 * Unit tests for PaddleSyncService (TASK_2025_294 W1.B3).
 *
 * Exercises the full public surface:
 *   - findSubscriptionByCustomerId (happy / not_found / error / timeout)
 *   - findCustomerByEmail          (happy / not_found / error / timeout)
 *   - findSubscriptionByEmail      (delegates to the two above)
 *   - createPortalSession          (happy / null / thrown / timeout)
 *   - isActiveStatus               (pure predicate)
 *
 * Strategy: we supply a narrow `PaddleClient`-shaped stub that only
 * implements the `.subscriptions.list`, `.customers.list`, and
 * `.customerPortalSessions.create` methods the service touches. Both
 * `list()` methods return an async-iterable that we construct locally.
 *
 * Frozen timers: the service races real `setTimeout(3000)` against the
 * fetch promise. We use Jest's modern fake timers via
 * `@ptah-extension/shared/testing`'s `freezeTime()` so timeout cases can
 * be tested deterministically without 3-second sleeps.
 */

import { freezeTime, type FrozenClock } from '@ptah-extension/shared/testing';
import { PaddleSyncService } from './paddle-sync.service';
import type {
  PaddleClient,
  PaddleSubscriptionStatus,
} from '../paddle/providers/paddle.provider';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build an async-iterable collection over a fixed array of items. */
function asAsyncCollection<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let idx = 0;
      return {
        next: async (): Promise<IteratorResult<T>> => {
          if (idx >= items.length) {
            return { value: undefined as unknown as T, done: true };
          }
          return { value: items[idx++], done: false };
        },
      };
    },
  };
}

/**
 * Build an async-iterable that never yields — the consumer's for-await
 * loop suspends indefinitely, which is exactly what we want to simulate
 * a Paddle API that hasn't returned within the 3s timeout.
 */
function asPendingCollection<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: (): Promise<IteratorResult<T>> => new Promise(() => undefined),
      };
    },
  };
}

interface PaddleSDKSubShape {
  id: string;
  customerId: string;
  status: PaddleSubscriptionStatus | string;
  items: Array<{
    price?: { id: string };
    trialDates?: { endsAt: string } | null;
  }>;
  currentBillingPeriod?: { endsAt: string } | null;
  canceledAt: string | null;
}

/** Thin stub for `PaddleClient` exposing only what PaddleSyncService uses. */
interface PaddleClientStub {
  subscriptions: { list: jest.Mock };
  customers: { list: jest.Mock };
  customerPortalSessions: { create: jest.Mock };
}

function createPaddleClientStub(): PaddleClientStub {
  return {
    subscriptions: { list: jest.fn() },
    customers: { list: jest.fn() },
    customerPortalSessions: { create: jest.fn() },
  };
}

/** Cast helper: treats the minimal stub as the real `PaddleClient`. */
function asPaddleClient(stub: PaddleClientStub): PaddleClient {
  return stub as unknown as PaddleClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PaddleSyncService', () => {
  let paddle: PaddleClientStub;
  let service: PaddleSyncService;
  let clock: FrozenClock | undefined;

  beforeEach(() => {
    paddle = createPaddleClientStub();
    service = new PaddleSyncService(asPaddleClient(paddle));
  });

  afterEach(() => {
    clock?.restore();
    clock = undefined;
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // findSubscriptionByCustomerId
  // -------------------------------------------------------------------------
  describe('findSubscriptionByCustomerId', () => {
    it('returns { status: found, data } normalised from the first yielded subscription', async () => {
      const sub: PaddleSDKSubShape = {
        id: 'pdl_sub_1',
        customerId: 'pdl_cust_1',
        status: 'active',
        items: [
          {
            price: { id: 'pri_pro_monthly' },
            trialDates: { endsAt: '2026-04-01T00:00:00Z' },
          },
        ],
        currentBillingPeriod: { endsAt: '2026-12-31T00:00:00Z' },
        canceledAt: null,
      };
      paddle.subscriptions.list.mockReturnValueOnce(asAsyncCollection([sub]));

      const result = await service.findSubscriptionByCustomerId('pdl_cust_1');

      expect(paddle.subscriptions.list).toHaveBeenCalledWith({
        customerId: ['pdl_cust_1'],
      });
      expect(result).toEqual({
        status: 'found',
        data: {
          id: 'pdl_sub_1',
          customerId: 'pdl_cust_1',
          status: 'active',
          priceId: 'pri_pro_monthly',
          currentPeriodEnd: '2026-12-31T00:00:00Z',
          canceledAt: null,
          trialEnd: '2026-04-01T00:00:00Z',
        },
      });
    });

    it('handles subscriptions with missing price / trial / billing period', async () => {
      const sub: PaddleSDKSubShape = {
        id: 'pdl_sub_2',
        customerId: 'pdl_cust_2',
        status: 'canceled',
        items: [{}],
        currentBillingPeriod: null,
        canceledAt: '2026-04-20T00:00:00Z',
      };
      paddle.subscriptions.list.mockReturnValueOnce(asAsyncCollection([sub]));

      const result = await service.findSubscriptionByCustomerId('pdl_cust_2');

      expect(result).toEqual({
        status: 'found',
        data: {
          id: 'pdl_sub_2',
          customerId: 'pdl_cust_2',
          status: 'canceled',
          priceId: undefined,
          currentPeriodEnd: null,
          canceledAt: '2026-04-20T00:00:00Z',
          trialEnd: null,
        },
      });
    });

    it('returns { status: not_found } when the collection yields nothing', async () => {
      paddle.subscriptions.list.mockReturnValueOnce(asAsyncCollection([]));
      const result = await service.findSubscriptionByCustomerId('pdl_cust_3');
      expect(result).toEqual({ status: 'not_found' });
    });

    it('returns { status: error, reason } when list() throws synchronously', async () => {
      paddle.subscriptions.list.mockImplementationOnce(() => {
        throw new Error('boom');
      });

      const result = await service.findSubscriptionByCustomerId('pdl_cust_4');
      expect(result).toEqual({ status: 'error', reason: 'boom' });
    });

    it('returns { status: error, reason } when the async iterator rejects', async () => {
      paddle.subscriptions.list.mockReturnValueOnce({
        [Symbol.asyncIterator](): AsyncIterator<never> {
          return {
            next: (): Promise<IteratorResult<never>> =>
              Promise.reject(new Error('network down')),
          };
        },
      });

      const result = await service.findSubscriptionByCustomerId('pdl_cust_5');
      expect(result).toEqual({ status: 'error', reason: 'network down' });
    });

    it('returns { status: error, reason: timeout } when Paddle never responds within 3s', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      paddle.subscriptions.list.mockReturnValueOnce(asPendingCollection());

      const pending = service.findSubscriptionByCustomerId('pdl_cust_6');
      // Advance past the 3-second deadline so the timeout branch wins.
      clock.advanceBy(3001);

      await expect(pending).resolves.toEqual({
        status: 'error',
        reason: 'timeout',
      });
    });

    it('reports "Unknown error" when a non-Error is thrown', async () => {
      paddle.subscriptions.list.mockImplementationOnce(() => {
        throw 'string-error';
      });
      const result = await service.findSubscriptionByCustomerId('pdl_cust_7');
      expect(result).toEqual({ status: 'error', reason: 'Unknown error' });
    });
  });

  // -------------------------------------------------------------------------
  // findCustomerByEmail
  // -------------------------------------------------------------------------
  describe('findCustomerByEmail', () => {
    it('returns { status: found, customerId } for the first customer', async () => {
      paddle.customers.list.mockReturnValueOnce(
        asAsyncCollection([{ id: 'pdl_cust_1' }]),
      );

      const result = await service.findCustomerByEmail('alice@example.com');

      expect(paddle.customers.list).toHaveBeenCalledWith({
        email: ['alice@example.com'],
      });
      expect(result).toEqual({ status: 'found', customerId: 'pdl_cust_1' });
    });

    it('returns { status: not_found } when no customer matches', async () => {
      paddle.customers.list.mockReturnValueOnce(asAsyncCollection([]));
      const result = await service.findCustomerByEmail('ghost@example.com');
      expect(result).toEqual({ status: 'not_found' });
    });

    it('returns { status: error, reason: timeout } on timeout', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      paddle.customers.list.mockReturnValueOnce(asPendingCollection());

      const pending = service.findCustomerByEmail('slow@example.com');
      clock.advanceBy(3001);

      await expect(pending).resolves.toEqual({
        status: 'error',
        reason: 'timeout',
      });
    });

    it('returns { status: error, reason } when list() throws', async () => {
      paddle.customers.list.mockImplementationOnce(() => {
        throw new Error('rate-limited');
      });
      const result = await service.findCustomerByEmail('any@example.com');
      expect(result).toEqual({ status: 'error', reason: 'rate-limited' });
    });
  });

  // -------------------------------------------------------------------------
  // findSubscriptionByEmail — delegates to the two primitives
  // -------------------------------------------------------------------------
  describe('findSubscriptionByEmail', () => {
    it('normalises the email to lowercase before customer lookup', async () => {
      paddle.customers.list.mockReturnValueOnce(
        asAsyncCollection([{ id: 'pdl_cust_1' }]),
      );
      paddle.subscriptions.list.mockReturnValueOnce(asAsyncCollection([]));

      await service.findSubscriptionByEmail('Alice@Example.COM');

      expect(paddle.customers.list).toHaveBeenCalledWith({
        email: ['alice@example.com'],
      });
      expect(paddle.subscriptions.list).toHaveBeenCalledWith({
        customerId: ['pdl_cust_1'],
      });
    });

    it('bubbles { status: not_found } from the customer lookup', async () => {
      paddle.customers.list.mockReturnValueOnce(asAsyncCollection([]));

      const result = await service.findSubscriptionByEmail('ghost@example.com');

      expect(result).toEqual({ status: 'not_found' });
      expect(paddle.subscriptions.list).not.toHaveBeenCalled();
    });

    it('bubbles { status: error, reason } from the customer lookup', async () => {
      paddle.customers.list.mockImplementationOnce(() => {
        throw new Error('paddle-500');
      });

      const result = await service.findSubscriptionByEmail('any@example.com');

      expect(result).toEqual({ status: 'error', reason: 'paddle-500' });
      expect(paddle.subscriptions.list).not.toHaveBeenCalled();
    });

    it('returns found data when customer exists and has a subscription', async () => {
      paddle.customers.list.mockReturnValueOnce(
        asAsyncCollection([{ id: 'pdl_cust_1' }]),
      );
      const sub: PaddleSDKSubShape = {
        id: 'pdl_sub_1',
        customerId: 'pdl_cust_1',
        status: 'trialing',
        items: [
          {
            price: { id: 'pri_pro_monthly' },
            trialDates: { endsAt: '2026-04-01T00:00:00Z' },
          },
        ],
        currentBillingPeriod: { endsAt: '2026-05-01T00:00:00Z' },
        canceledAt: null,
      };
      paddle.subscriptions.list.mockReturnValueOnce(asAsyncCollection([sub]));

      const result = await service.findSubscriptionByEmail('alice@example.com');

      expect(result.status).toBe('found');
      if (result.status === 'found') {
        expect(result.data.id).toBe('pdl_sub_1');
        expect(result.data.status).toBe('trialing');
        expect(result.data.trialEnd).toBe('2026-04-01T00:00:00Z');
      }
    });
  });

  // -------------------------------------------------------------------------
  // createPortalSession
  // -------------------------------------------------------------------------
  describe('createPortalSession', () => {
    it('returns { url } from the portal session result', async () => {
      paddle.customerPortalSessions.create.mockResolvedValueOnce({
        urls: {
          general: { overview: 'https://paddle.com/portal/abc' },
        },
      });

      const result = await service.createPortalSession('pdl_cust_1', [
        'pdl_sub_1',
      ]);

      expect(paddle.customerPortalSessions.create).toHaveBeenCalledWith(
        'pdl_cust_1',
        ['pdl_sub_1'],
      );
      expect(result).toEqual({ url: 'https://paddle.com/portal/abc' });
    });

    it('returns null when the SDK throws', async () => {
      paddle.customerPortalSessions.create.mockRejectedValueOnce(
        new Error('paddle-500'),
      );
      const result = await service.createPortalSession('pdl_cust_1', []);
      expect(result).toBeNull();
    });

    it('returns null when the SDK never responds within 3s', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      paddle.customerPortalSessions.create.mockReturnValueOnce(
        new Promise(() => undefined),
      );

      const pending = service.createPortalSession('pdl_cust_1', ['pdl_sub_1']);
      clock.advanceBy(3001);

      await expect(pending).resolves.toBeNull();
    });

    it('returns null when the SDK returns a falsy value', async () => {
      paddle.customerPortalSessions.create.mockResolvedValueOnce(null);
      const result = await service.createPortalSession('pdl_cust_1', []);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // isActiveStatus
  // -------------------------------------------------------------------------
  describe('isActiveStatus', () => {
    it.each(['active', 'trialing', 'past_due'] as const)(
      'returns true for %s',
      (status) => {
        expect(service.isActiveStatus(status)).toBe(true);
      },
    );

    it.each(['canceled', 'paused', 'expired', 'unknown'] as const)(
      'returns false for %s',
      (status) => {
        expect(service.isActiveStatus(status)).toBe(false);
      },
    );
  });
});
