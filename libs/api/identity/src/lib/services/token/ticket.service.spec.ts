/**
 * Unit tests for TicketService (TASK_2025_294 W1.B2.1).
 *
 * Scope: Short-lived SSE tickets — real crypto round-trip with frozen clock.
 * Coverage:
 *   - Token generation: 64-char hex (256-bit entropy via crypto.randomBytes).
 *   - Round-trip: create → validate resolves to user context.
 *   - Single-use: second validate returns null (replay protection).
 *   - TTL expiry (30s) via frozen clock — auto-deletion timer fires.
 *   - Email normalized to lowercase on store.
 *   - Cross-ticket isolation: distinct tickets cannot be swapped.
 *   - onModuleDestroy clears pending timers and storage.
 *   - `validateAndConsume` deprecated alias delegates to `validate`.
 *
 * Real crypto throughout; no mocks — service has no injected deps.
 */
import { freezeTime, type FrozenClock } from '@ptah-extension/shared/testing';
import { TicketService } from './ticket.service';

const TTL_MS = 30_000;

describe('TicketService', () => {
  let service: TicketService;
  let clock: FrozenClock;

  beforeEach(() => {
    clock = freezeTime('2026-04-24T12:00:00.000Z');
    service = new TicketService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    clock.restore();
  });

  describe('create', () => {
    it('emits a 64-char lowercase hex ticket (256-bit entropy)', async () => {
      const ticket = await service.create(
        'user-1',
        'tenant-1',
        'u@example.com',
      );

      expect(ticket).toHaveLength(64);
      expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates 100 unique tickets (collision-safe)', async () => {
      const tickets = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tickets.add(
          await service.create('user-1', 'tenant-1', 'u@example.com'),
        );
      }
      expect(tickets.size).toBe(100);
    });
  });

  describe('validate — round-trip', () => {
    it('resolves the exact user context bound to the ticket', async () => {
      const ticket = await service.create(
        'user-42',
        'tenant-7',
        'user@example.com',
      );

      const result = await service.validate(ticket);

      expect(result).toEqual({
        userId: 'user-42',
        tenantId: 'tenant-7',
        email: 'user@example.com',
      });
    });

    it('normalizes email to lowercase on store', async () => {
      const ticket = await service.create(
        'user-1',
        'tenant-1',
        'Mixed.Case@Example.COM',
      );

      const result = await service.validate(ticket);

      expect(result?.email).toBe('mixed.case@example.com');
    });
  });

  describe('validate — single-use', () => {
    it('rejects the second validation for replay protection', async () => {
      const ticket = await service.create(
        'user-1',
        'tenant-1',
        'u@example.com',
      );

      const first = await service.validate(ticket);
      const second = await service.validate(ticket);

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('does not cross-map between independently issued tickets', async () => {
      const a = await service.create('user-a', 'tenant-a', 'a@example.com');
      const b = await service.create('user-b', 'tenant-b', 'b@example.com');

      expect((await service.validate(a))?.userId).toBe('user-a');
      expect((await service.validate(b))?.userId).toBe('user-b');
    });

    it('returns null for an unknown ticket', async () => {
      expect(await service.validate('deadbeef'.repeat(8))).toBeNull();
    });
  });

  describe('TTL expiry (frozen clock)', () => {
    it('accepts validation just before the 30-second window closes', async () => {
      const ticket = await service.create(
        'user-1',
        'tenant-1',
        'u@example.com',
      );

      clock.advanceBy(TTL_MS - 1);

      const result = await service.validate(ticket);
      expect(result).not.toBeNull();
    });

    it('auto-deletes the ticket when the setTimeout fires at TTL', async () => {
      const ticket = await service.create(
        'user-1',
        'tenant-1',
        'u@example.com',
      );

      // Advance past TTL — the internal setTimeout should fire and delete
      // the entry. freezeTime uses Jest fake timers, which execute pending
      // callbacks as the clock advances.
      clock.advanceBy(TTL_MS + 1);

      expect(await service.validate(ticket)).toBeNull();
    });
  });

  describe('validateAndConsume — deprecated alias', () => {
    it('delegates to validate()', async () => {
      const ticket = await service.create(
        'user-1',
        'tenant-1',
        'u@example.com',
      );

      const result = await service.validateAndConsume(ticket);

      expect(result?.userId).toBe('user-1');
      // Deprecated alias also enforces single-use.
      expect(await service.validateAndConsume(ticket)).toBeNull();
    });
  });

  describe('onModuleDestroy', () => {
    it('clears all pending timeouts and storage', async () => {
      const ticket = await service.create(
        'user-1',
        'tenant-1',
        'u@example.com',
      );

      service.onModuleDestroy();

      // After destroy, ticket store is cleared — ticket resolves to null.
      expect(await service.validate(ticket)).toBeNull();

      // Also: advancing past TTL must not throw (timers were cleared).
      expect(() => clock.advanceBy(TTL_MS + 1)).not.toThrow();
    });
  });
});
