import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { CuratorRateLimitService } from './curator-rate-limit.service';

const makeLogger = (): jest.Mocked<Logger> =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as jest.Mocked<Logger>;

describe('CuratorRateLimitService integration — joint memory + skill pipelines', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-21T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('independent buckets: 12 memory.curate + 6 skill.analyze allowed; 13th memory and 7th skill blocked independently', () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());

    for (let i = 0; i < 12; i++) {
      expect(rateLimiter.tryAcquire('memory.curate', 12)).toEqual({
        allowed: true,
      });
    }
    for (let i = 0; i < 6; i++) {
      expect(rateLimiter.tryAcquire('skill.analyze', 6)).toEqual({
        allowed: true,
      });
    }

    const memDenied = rateLimiter.tryAcquire('memory.curate', 12);
    expect(memDenied.allowed).toBe(false);
    if (!memDenied.allowed) {
      expect(memDenied.limit).toBe(12);
      expect(memDenied.usedThisWindow).toBe(12);
    }

    const skillDenied = rateLimiter.tryAcquire('skill.analyze', 6);
    expect(skillDenied.allowed).toBe(false);
    if (!skillDenied.allowed) {
      expect(skillDenied.limit).toBe(6);
      expect(skillDenied.usedThisWindow).toBe(6);
    }

    expect(rateLimiter.snapshot('memory.curate')?.count).toBe(12);
    expect(rateLimiter.snapshot('skill.analyze')?.count).toBe(6);
  });

  it('hour rollover resets both buckets independently', () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const t0 = Date.UTC(2026, 4, 21, 12, 0, 0);
    jest.setSystemTime(new Date(t0));

    for (let i = 0; i < 12; i++) {
      rateLimiter.tryAcquire('memory.curate', 12);
    }
    for (let i = 0; i < 6; i++) {
      rateLimiter.tryAcquire('skill.analyze', 6);
    }
    expect(rateLimiter.tryAcquire('memory.curate', 12).allowed).toBe(false);
    expect(rateLimiter.tryAcquire('skill.analyze', 6).allowed).toBe(false);

    jest.setSystemTime(new Date(t0 + 3_600_001));

    expect(rateLimiter.tryAcquire('memory.curate', 12)).toEqual({
      allowed: true,
    });
    expect(rateLimiter.tryAcquire('skill.analyze', 6)).toEqual({
      allowed: true,
    });
    expect(rateLimiter.snapshot('memory.curate')?.count).toBe(1);
    expect(rateLimiter.snapshot('skill.analyze')?.count).toBe(1);
  });

  it('workspace-wide key semantics: memory.curate bucket is keyed by string only (no session suffix); same key shares state', () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());

    expect(rateLimiter.tryAcquire('memory.curate', 1)).toEqual({
      allowed: true,
    });
    const denied = rateLimiter.tryAcquire('memory.curate', 1);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.limit).toBe(1);
      expect(denied.usedThisWindow).toBe(1);
    }

    expect(rateLimiter.tryAcquire('skill.analyze', 1)).toEqual({
      allowed: true,
    });
  });

  it('joint stress: interleaved memory + skill acquires preserve bucket independence', () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());

    for (let i = 0; i < 6; i++) {
      expect(rateLimiter.tryAcquire('memory.curate', 12)).toEqual({
        allowed: true,
      });
      expect(rateLimiter.tryAcquire('skill.analyze', 6)).toEqual({
        allowed: true,
      });
    }

    expect(rateLimiter.snapshot('memory.curate')?.count).toBe(6);
    expect(rateLimiter.snapshot('skill.analyze')?.count).toBe(6);
    expect(rateLimiter.tryAcquire('skill.analyze', 6).allowed).toBe(false);
    for (let i = 0; i < 6; i++) {
      expect(rateLimiter.tryAcquire('memory.curate', 12)).toEqual({
        allowed: true,
      });
    }
    expect(rateLimiter.tryAcquire('memory.curate', 12).allowed).toBe(false);
  });
});
