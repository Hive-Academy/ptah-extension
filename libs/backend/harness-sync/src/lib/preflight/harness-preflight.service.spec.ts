/**
 * `HarnessPreflightService` — the bounded session-start check (Batch 3, E2/E14/E24).
 *
 * Four properties are load-bearing and each has a test that would fail if it
 * regressed: it never blocks a session past its budget, it never throws, it
 * resolves a sub-folder cwd to the workspace root, and it collapses bursts so
 * the background drain can afford it.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HarnessHealth } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessPassAbortedError } from '../abort/pass-abort';
import {
  DEFAULT_PREFLIGHT_TIMEOUT_MS,
  HarnessPreflightService,
} from './harness-preflight.service';
import type { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeHealth(over: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: '/ws',
    generatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'preflight',
    reason: 'session-preflight:preflight',
    sources: 'ok',
    targets: [],
    collisions: [],
    ...over,
  };
}

/**
 * A workspace carrying a real root marker, so `resolveHarnessWorkspaceRoot` has
 * work to do. `.ptah/` and `.git/` are the only markers — `package.json` is
 * deliberately NOT one, because a monorepo package has one too and that is
 * precisely the sub-folder E14 is about.
 */
function makeWorkspace(): { root: string; nested: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'ptah-preflight-'));
  mkdirSync(join(root, '.ptah'), { recursive: true });
  const nested = join(root, 'packages', 'api', 'src');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'package.json'), '{}', 'utf8');
  return {
    root,
    nested,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function build(
  reconcile: jest.Mock,
  deps: ConstructorParameters<typeof HarnessPreflightService>[2] = {},
): { service: HarnessPreflightService; logger: Logger } {
  const logger = makeLogger();
  const service = new HarnessPreflightService(
    logger,
    { reconcile } as unknown as HarnessReconcilerService,
    // Throttling off by default so each test controls its own bursts.
    { minIntervalMs: 0, ...deps },
  );
  return { service, logger };
}

describe('HarnessPreflightService', () => {
  let ws: ReturnType<typeof makeWorkspace>;

  beforeEach(() => {
    ws = makeWorkspace();
  });
  afterEach(() => ws.cleanup());

  it('reconciles in preflight mode and returns the health report', async () => {
    const reconcile = jest.fn().mockResolvedValue(makeHealth());
    const { service } = build(reconcile);

    const health = await service.ensure(ws.root);

    expect(health).not.toBeNull();
    expect(reconcile).toHaveBeenCalledWith(ws.root, {
      mode: 'preflight',
      reason: 'session-preflight:preflight',
      // The budget's cancellation handle (TASK_2026_323 / B8). Every pass now
      // carries one — see "cancels the losing pass" below for what it does.
      signal: expect.any(AbortSignal),
    });
  });

  it('resolves a sub-folder cwd to the workspace root (E14)', async () => {
    // A rival CLI spawned for one package of a monorepo hands us its own cwd.
    // Every CLI-discoverable directory lives at the ROOT, so a preflight keyed
    // on the sub-folder would reconcile a workspace nothing reads.
    const reconcile = jest.fn().mockResolvedValue(makeHealth());
    const { service } = build(reconcile);

    await service.ensure(ws.nested);

    expect(reconcile).toHaveBeenCalledWith(ws.root, expect.anything());
  });

  it('returns null and lets the session continue when the budget expires', async () => {
    let settle: (health: HarnessHealth) => void = () => undefined;
    const reconcile = jest.fn().mockImplementation(
      () =>
        new Promise<HarnessHealth>((resolve) => {
          settle = resolve;
        }),
    );
    const { service, logger } = build(reconcile);

    const health = await service.ensure(ws.root, { timeoutMs: 5 });

    expect(health).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
      expect.anything(),
    );
    settle(makeHealth());
  });

  /**
   * B8 (TASK_2026_323). The losing pass used to be left running: a synchronous
   * recursive walk of `~/.ptah/user`, hashing every byte of every skill, on the
   * Electron main thread, for a session that had already moved on. It is now
   * cancelled — but only while it is still READING, which the reconciler
   * guarantees with its commit point (`abort/pass-abort.ts`).
   */
  describe('cancels the losing pass (B8)', () => {
    it('aborts the signal it handed the reconciler once the budget expires', async () => {
      let handed: AbortSignal | undefined;
      const reconcile = jest
        .fn()
        .mockImplementation(
          (_root: string, options: { signal?: AbortSignal }) => {
            handed = options.signal;
            return new Promise<HarnessHealth>(() => undefined);
          },
        );
      const { service } = build(reconcile);

      expect(await service.ensure(ws.root, { timeoutMs: 5 })).toBeNull();

      expect(handed).toBeInstanceOf(AbortSignal);
      expect(handed?.aborted).toBe(true);
    });

    it('does not abort a pass that finished inside the budget while it was running', async () => {
      // The abort in the `finally` is a listener cleanup, not a cancellation:
      // by then the reconciler has already detached and returned a report. What
      // must never happen is the signal firing DURING a pass that is about to
      // succeed.
      let abortedDuringPass: boolean | undefined;
      const reconcile = jest
        .fn()
        .mockImplementation(
          async (_root: string, options: { signal?: AbortSignal }) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            abortedDuringPass = options.signal?.aborted;
            return makeHealth();
          },
        );
      const { service } = build(reconcile);

      expect(
        await service.ensure(ws.root, { timeoutMs: 5_000 }),
      ).not.toBeNull();
      expect(abortedDuringPass).toBe(false);
    });

    it('reports a cancelled pass as debug, not as a failure', async () => {
      // A workspace too large to hash inside the budget would otherwise warn on
      // every single session start, which trains the user to ignore the log.
      const reconcile = jest
        .fn()
        .mockRejectedValue(new HarnessPassAbortedError());
      const { service, logger } = build(reconcile);

      await expect(service.ensure(ws.root)).resolves.toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('cancelled'),
        expect.anything(),
      );
    });
  });

  it('never throws when the reconciler rejects', async () => {
    const reconcile = jest.fn().mockRejectedValue(new Error('EBUSY'));
    const { service, logger } = build(reconcile);

    await expect(service.ensure(ws.root)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('waits for an in-flight download and re-runs when sources were pending (E2)', async () => {
    const reconcile = jest
      .fn()
      .mockResolvedValueOnce(makeHealth({ sources: 'pending-download' }))
      .mockResolvedValueOnce(makeHealth({ mode: 'full', sources: 'ok' }));
    const awaitContentReady = jest.fn().mockResolvedValue(true);
    const { service } = build(reconcile, {
      contentGate: { awaitContentReady },
    });

    const health = await service.ensure(ws.root);

    expect(awaitContentReady).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
    // The retry is a FULL pass: the download just wrote the sources, so a drift
    // check could only fall through to the same apply one call later.
    expect(reconcile.mock.calls[1][1]).toMatchObject({ mode: 'full' });
    expect(health?.sources).toBe('ok');
  });

  it('keeps the pending-download report when the download does not land (offline)', async () => {
    const pending = makeHealth({ sources: 'pending-download' });
    const reconcile = jest.fn().mockResolvedValue(pending);
    const awaitContentReady = jest.fn().mockResolvedValue(false);
    const { service } = build(reconcile, {
      contentGate: { awaitContentReady },
    });

    const health = await service.ensure(ws.root);

    expect(health?.sources).toBe('pending-download');
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of session starts for one workspace', async () => {
    // What makes this affordable for the skill-synthesis drain, which starts
    // dozens of one-shot sessions a night through the same shared path.
    const reconcile = jest.fn().mockResolvedValue(makeHealth());
    const { service } = build(reconcile, { minIntervalMs: 60_000 });

    await service.ensure(ws.root);
    await service.ensure(ws.root);
    await service.ensure(ws.nested);

    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('honours force for an explicit user action', async () => {
    const reconcile = jest.fn().mockResolvedValue(makeHealth());
    const { service } = build(reconcile, { minIntervalMs: 60_000 });

    await service.ensure(ws.root);
    await service.ensure(ws.root, { force: true });

    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('prefers the configured timeout over the default, and the per-call one over both', async () => {
    let observed = 0;
    const reconcile = jest.fn().mockImplementation(
      () =>
        new Promise<HarnessHealth>((resolve) => {
          // Never settles inside the budget; the race decides.
          setTimeout(() => resolve(makeHealth()), 10_000).unref?.();
        }),
    );
    const readTimeoutMs = jest.fn().mockReturnValue(25);
    const { service } = build(reconcile, { readTimeoutMs });

    const startedAt = Date.now();
    await service.ensure(ws.root);
    observed = Date.now() - startedAt;

    expect(readTimeoutMs).toHaveBeenCalled();
    // Configured 25ms must win over the 1500ms default, or this exceeds it.
    expect(observed).toBeLessThan(DEFAULT_PREFLIGHT_TIMEOUT_MS);
  });

  it.each([undefined, '', '   '])(
    'is a no-op for a missing cwd (%p)',
    async (cwd) => {
      const reconcile = jest.fn();
      const { service } = build(reconcile);

      await expect(
        service.ensure(cwd as unknown as string),
      ).resolves.toBeNull();
      expect(reconcile).not.toHaveBeenCalled();
    },
  );
});
