import 'reflect-metadata';
import { container } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { CuratorRateLimitService } from './curator-rate-limit.service';
import { SDK_TOKENS } from '../di/tokens';

const makeLogger = (): jest.Mocked<Logger> =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as jest.Mocked<Logger>;

describe('CuratorRateLimitService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-21T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the first N calls and rejects the (N+1)th with resetAt/usedThisWindow/limit', () => {
    const service = new CuratorRateLimitService(makeLogger());

    expect(service.tryAcquire('memory.curate', 3)).toEqual({ allowed: true });
    expect(service.tryAcquire('memory.curate', 3)).toEqual({ allowed: true });
    expect(service.tryAcquire('memory.curate', 3)).toEqual({ allowed: true });

    const rejected = service.tryAcquire('memory.curate', 3);
    expect(rejected.allowed).toBe(false);
    if (!rejected.allowed) {
      expect(rejected.usedThisWindow).toBe(3);
      expect(rejected.limit).toBe(3);
      expect(typeof rejected.resetAt).toBe('number');
      const expectedReset =
        Math.floor(new Date('2026-05-21T12:00:00Z').getTime() / 3_600_000) *
          3_600_000 +
        3_600_000;
      expect(rejected.resetAt).toBe(expectedReset);
    }
  });

  it('resets the counter after the hour boundary rolls over', () => {
    const service = new CuratorRateLimitService(makeLogger());

    expect(service.tryAcquire('memory.curate', 2)).toEqual({ allowed: true });
    expect(service.tryAcquire('memory.curate', 2)).toEqual({ allowed: true });
    expect(service.tryAcquire('memory.curate', 2).allowed).toBe(false);

    jest.setSystemTime(new Date('2026-05-21T13:05:00Z'));

    expect(service.tryAcquire('memory.curate', 2)).toEqual({ allowed: true });
    const snap = service.snapshot('memory.curate');
    expect(snap?.count).toBe(1);
  });

  it('returns allowed when maxPerHour is zero or negative', () => {
    const service = new CuratorRateLimitService(makeLogger());
    expect(service.tryAcquire('any', 0)).toEqual({ allowed: true });
    expect(service.tryAcquire('any', -5)).toEqual({ allowed: true });
    expect(service.snapshot('any')).toBeNull();
  });

  it('returns allowed when maxPerHour is non-finite (NaN or Infinity)', () => {
    const service = new CuratorRateLimitService(makeLogger());
    expect(service.tryAcquire('any', Number.NaN)).toEqual({ allowed: true });
    expect(service.tryAcquire('any', Number.POSITIVE_INFINITY)).toEqual({
      allowed: true,
    });
    expect(service.snapshot('any')).toBeNull();
  });

  it('isolates buckets across different keys', () => {
    const service = new CuratorRateLimitService(makeLogger());

    expect(service.tryAcquire('memory.curate', 1)).toEqual({ allowed: true });
    expect(service.tryAcquire('memory.curate', 1).allowed).toBe(false);

    expect(service.tryAcquire('skill.analyze', 1)).toEqual({ allowed: true });
    expect(service.tryAcquire('skill.analyze', 1).allowed).toBe(false);

    expect(service.snapshot('memory.curate')?.count).toBe(1);
    expect(service.snapshot('skill.analyze')?.count).toBe(1);
  });

  it('snapshot returns null for unknown keys and an object for known keys', () => {
    const service = new CuratorRateLimitService(makeLogger());
    expect(service.snapshot('never-seen')).toBeNull();

    service.tryAcquire('seen', 5);
    const snap = service.snapshot('seen');
    expect(snap).not.toBeNull();
    expect(snap?.count).toBe(1);
    expect(typeof snap?.windowStartMs).toBe('number');
  });

  it('resolves via DI under SDK_CURATOR_RATE_LIMIT token', () => {
    const testContainer = container.createChildContainer();
    testContainer.registerInstance(TOKENS.LOGGER, makeLogger());
    testContainer.registerSingleton(
      SDK_TOKENS.SDK_CURATOR_RATE_LIMIT,
      CuratorRateLimitService,
    );

    const resolved = testContainer.resolve<CuratorRateLimitService>(
      SDK_TOKENS.SDK_CURATOR_RATE_LIMIT,
    );

    expect(resolved).toBeInstanceOf(CuratorRateLimitService);
    expect(resolved.tryAcquire('di-key', 1)).toEqual({ allowed: true });
  });
});
