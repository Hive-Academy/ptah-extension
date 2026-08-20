/**
 * HarnessHealthStore specs.
 *
 * Coverage:
 *   - `refresh` / `reconcile` state transitions (loading flags, adopted report).
 *   - The cached-vs-fresh contract on `harness:health` params.
 *   - `reconcile` always asks for a full pass and adopts the returned report
 *     without a second read.
 *   - Failure paths: handler error string, thrown transport error, and the
 *     summary surviving a payload that omits it.
 *   - Re-entrancy: a second call while one is in flight is dropped.
 *   - The `harness:healthChanged` push: adopted without a call, ignored when
 *     malformed, and never touching the call-scoped loading/error signals.
 */

import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  HarnessHealth,
  HarnessHealthSummary,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES, summarizeHarnessHealth } from '@ptah-extension/shared';
import { HarnessHealthStore } from './harness-health.store';

/** Mirrors the real `RpcResult` truthiness rule (success AND data defined). */
function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess: (): boolean => false,
  };
}

function makeTarget(
  target: HarnessTargetId,
  over: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target,
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: 'supported',
      mcp: 'supported',
    },
    expected: 4,
    found: 4,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 12,
    ...over,
  };
}

function makeHealth(over: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: 'D:/repo',
    generatedAt: '2026-08-18T10:00:00.000Z',
    mode: 'full',
    reason: 'activation',
    sources: 'ok',
    targets: [makeTarget('claude')],
    collisions: [],
    ...over,
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

describe('HarnessHealthStore', () => {
  let store: HarnessHealthStore;
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      if (!factory) {
        return Promise.resolve(fail(`No responder for ${method}`));
      }
      return Promise.resolve(factory());
    }),
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();

    TestBed.configureTestingModule({
      providers: [
        HarnessHealthStore,
        { provide: ClaudeRpcService, useValue: rpcMock },
      ],
    });
    store = TestBed.inject(HarnessHealthStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('initial state', () => {
    it('starts unknown rather than pretending the harness is healthy', () => {
      expect(store.health()).toBeNull();
      expect(store.summary().level).toBe('unknown');
      expect(store.targets()).toEqual([]);
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
    });
  });

  describe('refresh', () => {
    it('adopts the report and its summary', async () => {
      const health = makeHealth();
      const summary = summarizeHarnessHealth(health);
      setResponder('harness:health', () =>
        ok({ health, summary, cached: true }),
      );

      await store.refresh();

      expect(store.health()).toEqual(health);
      expect(store.summary().level).toBe('ok');
      expect(store.summary().detectedTargets).toBe(1);
      expect(store.targets()).toHaveLength(1);
      expect(store.error()).toBeNull();
      expect(store.loading()).toBe(false);
    });

    it('asks for the cached report by default', async () => {
      setResponder('harness:health', () =>
        ok({
          health: makeHealth(),
          summary: summarizeHarnessHealth(makeHealth()),
          cached: true,
        }),
      );

      await store.refresh();

      // No `refresh` key at all — the backend default is the cache, and the
      // page mounting is not a reason to re-walk every target directory.
      expect(calls[0]?.params).toEqual({});
    });

    it('forces a fresh pass when explicitly asked', async () => {
      setResponder('harness:health', () =>
        ok({
          health: makeHealth(),
          summary: summarizeHarnessHealth(makeHealth()),
          cached: false,
        }),
      );

      await store.refresh({ refresh: true });

      expect(calls[0]?.params).toEqual({ refresh: true });
    });

    it('raises loading for the duration of the call', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      setResponder('harness:health', () =>
        gate.then(() =>
          ok({
            health: makeHealth(),
            summary: summarizeHarnessHealth(makeHealth()),
            cached: false,
          }),
        ),
      );

      const inFlight = store.refresh();
      expect(store.loading()).toBe(true);
      expect(store.busy()).toBe(true);

      release?.();
      await inFlight;

      expect(store.loading()).toBe(false);
      expect(store.busy()).toBe(false);
    });

    it('drops a second refresh while one is already in flight', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      setResponder('harness:health', () =>
        gate.then(() =>
          ok({
            health: makeHealth(),
            summary: summarizeHarnessHealth(makeHealth()),
            cached: false,
          }),
        ),
      );

      const first = store.refresh();
      await store.refresh();
      release?.();
      await first;

      expect(calls).toHaveLength(1);
    });

    it('records a handler error and leaves the last good report alone', async () => {
      const health = makeHealth();
      setResponder('harness:health', () =>
        ok({ health, summary: summarizeHarnessHealth(health), cached: false }),
      );
      await store.refresh();

      setResponder('harness:health', () => fail('workspace is locked'));
      await store.refresh();

      expect(store.error()).toBe('workspace is locked');
      // Blanking the badge on a transient failure would be worse than showing
      // the previous answer next to the error.
      expect(store.health()).toEqual(health);
      expect(store.loading()).toBe(false);
    });

    it('narrows a thrown transport error to its message', async () => {
      setResponder('harness:health', () => {
        throw new Error('postMessage bridge closed');
      });

      await store.refresh();

      expect(store.error()).toBe('postMessage bridge closed');
      expect(store.loading()).toBe(false);
    });

    it('falls back to a generic message for a non-Error throwable', async () => {
      setResponder('harness:health', () => {
        throw 'nope';
      });

      await store.refresh();

      expect(store.error()).toBe('Failed to read harness health');
    });

    it('re-derives the summary when the payload omits one', async () => {
      // An older host that predates the summary field must still light the
      // badge, and must do it with the SAME reducer the backend uses.
      const health = makeHealth({
        targets: [
          makeTarget('claude', { missing: ['.claude/skills/orchestration'] }),
        ],
      });
      setResponder('harness:health', () =>
        ok({
          health,
          summary: undefined as unknown as HarnessHealthSummary,
          cached: false,
        }),
      );

      await store.refresh();

      expect(store.summary().level).toBe('degraded');
      expect(store.summary().missing).toBe(1);
    });

    it('keeps a null report as unknown when no workspace is open', async () => {
      setResponder('harness:health', () =>
        ok({
          health: null,
          summary: summarizeHarnessHealth(null),
          cached: false,
        }),
      );

      await store.refresh();

      expect(store.health()).toBeNull();
      expect(store.summary().level).toBe('unknown');
      expect(store.targets()).toEqual([]);
    });
  });

  describe('reconcile', () => {
    it('always requests a full pass', async () => {
      const health = makeHealth();
      setResponder('harness:reconcile', () =>
        ok({ health, summary: summarizeHarnessHealth(health) }),
      );

      await store.reconcile();

      expect(calls[0]?.method).toBe('harness:reconcile');
      // A preflight only hash-checks; the button says "Reconcile now".
      expect(calls[0]?.params).toEqual({ mode: 'full' });
    });

    it('passes an explicit target list through', async () => {
      const health = makeHealth();
      setResponder('harness:reconcile', () =>
        ok({ health, summary: summarizeHarnessHealth(health) }),
      );

      await store.reconcile(['codex', 'cursor']);

      expect(calls[0]?.params).toEqual({
        mode: 'full',
        targets: ['codex', 'cursor'],
      });
    });

    it('omits an empty target list rather than asking for zero targets', async () => {
      const health = makeHealth();
      setResponder('harness:reconcile', () =>
        ok({ health, summary: summarizeHarnessHealth(health) }),
      );

      await store.reconcile([]);

      expect(calls[0]?.params).toEqual({ mode: 'full' });
    });

    it('adopts the returned report without a follow-up read', async () => {
      const before = makeHealth({
        targets: [
          makeTarget('claude', { missing: ['.claude/skills/x'], found: 3 }),
        ],
      });
      setResponder('harness:health', () =>
        ok({
          health: before,
          summary: summarizeHarnessHealth(before),
          cached: true,
        }),
      );
      await store.refresh();
      expect(store.summary().level).toBe('degraded');

      const after = makeHealth();
      setResponder('harness:reconcile', () =>
        ok({ health: after, summary: summarizeHarnessHealth(after) }),
      );
      await store.reconcile();

      expect(store.summary().level).toBe('ok');
      expect(store.health()).toEqual(after);
      // Exactly two calls: the initial read and the reconcile. A third would be
      // a second filesystem walk that can only agree with the answer in hand.
      expect(calls.map((c) => c.method)).toEqual([
        'harness:health',
        'harness:reconcile',
      ]);
    });

    it('raises reconciling, not loading, so the badge does not flicker', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const health = makeHealth();
      setResponder('harness:reconcile', () =>
        gate.then(() =>
          ok({ health, summary: summarizeHarnessHealth(health) }),
        ),
      );

      const inFlight = store.reconcile();
      expect(store.reconciling()).toBe(true);
      expect(store.loading()).toBe(false);
      expect(store.busy()).toBe(true);

      release?.();
      await inFlight;

      expect(store.reconciling()).toBe(false);
    });

    it('drops a second reconcile while one is in flight', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const health = makeHealth();
      setResponder('harness:reconcile', () =>
        gate.then(() =>
          ok({ health, summary: summarizeHarnessHealth(health) }),
        ),
      );

      const first = store.reconcile();
      await store.reconcile();
      release?.();
      await first;

      expect(calls).toHaveLength(1);
    });

    it('surfaces a reconcile failure without clearing the report', async () => {
      const health = makeHealth();
      setResponder('harness:health', () =>
        ok({ health, summary: summarizeHarnessHealth(health), cached: true }),
      );
      await store.refresh();

      setResponder('harness:reconcile', () =>
        fail('another host holds the lock'),
      );
      await store.reconcile();

      expect(store.error()).toBe('another host holds the lock');
      expect(store.health()).toEqual(health);
      expect(store.reconciling()).toBe(false);
    });

    it('clears a previous error when a new call starts', async () => {
      setResponder('harness:health', () => fail('boom'));
      await store.refresh();
      expect(store.error()).toBe('boom');

      const health = makeHealth();
      setResponder('harness:reconcile', () =>
        ok({ health, summary: summarizeHarnessHealth(health) }),
      );
      await store.reconcile();

      expect(store.error()).toBeNull();
    });
  });

  describe('harness:healthChanged push', () => {
    const push = (payload: unknown): void =>
      store.handleMessage({
        type: MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
        payload,
      });

    it('declares the push so the router will route it', () => {
      expect(store.handledMessageTypes).toContain(
        MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
      );
    });

    it('adopts a pushed report without any RPC call', () => {
      const health = makeHealth({
        targets: [makeTarget('claude', { missing: ['.claude/skills/x'] })],
      });

      push({ health, summary: summarizeHarnessHealth(health) });

      expect(store.health()).toEqual(health);
      expect(store.summary().level).toBe('degraded');
      expect(store.summary().missing).toBe(1);
      // The whole point of the push: the badge is current on first paint,
      // before anyone opens the lazy Marketplace surface.
      expect(calls).toHaveLength(0);
    });

    it('overwrites the report a call had already adopted', async () => {
      const stale = makeHealth();
      setResponder('harness:health', () =>
        ok({
          health: stale,
          summary: summarizeHarnessHealth(stale),
          cached: true,
        }),
      );
      await store.refresh();
      expect(store.summary().level).toBe('ok');

      const fresh = makeHealth({
        targets: [
          makeTarget('claude', {
            writeFailed: ['.claude/skills/orchestration/SKILL.md'],
          }),
        ],
      });
      push({ health: fresh, summary: summarizeHarnessHealth(fresh) });

      // The backend edge-triggers on a CHANGED summary, so a push is always
      // newer than whatever the last call returned.
      expect(store.health()).toEqual(fresh);
      expect(store.summary().level).toBe('error');
      expect(store.summary().writeFailed).toBe(1);
    });

    it('re-derives the summary when the push omits one', () => {
      const health = makeHealth({
        targets: [makeTarget('claude', { missing: ['.claude/agents/a.md'] })],
      });

      push({ health });

      expect(store.summary().level).toBe('degraded');
      expect(store.summary().missing).toBe(1);
    });

    it('leaves loading, reconciling and error alone', async () => {
      setResponder('harness:health', () => fail('workspace is locked'));
      await store.refresh();
      expect(store.error()).toBe('workspace is locked');

      const health = makeHealth();
      push({ health, summary: summarizeHarnessHealth(health) });

      // A background pass succeeding is not a reason to erase the error text
      // next to the button the user actually pressed.
      expect(store.error()).toBe('workspace is locked');
      expect(store.loading()).toBe(false);
      expect(store.reconciling()).toBe(false);
      expect(store.health()).toEqual(health);
    });

    it('ignores a message it does not own', () => {
      const health = makeHealth();
      store.handleMessage({
        type: 'tasks:changed',
        payload: { health, summary: summarizeHarnessHealth(health) },
      });

      expect(store.health()).toBeNull();
      expect(store.summary().level).toBe('unknown');
    });

    it('keeps the last good report when the payload is malformed', async () => {
      const health = makeHealth();
      setResponder('harness:health', () =>
        ok({ health, summary: summarizeHarnessHealth(health), cached: true }),
      );
      await store.refresh();

      // The host sending these is not version-pinned to this bundle, so a
      // payload that lost its report must not blank the badge.
      push(undefined);
      push({});
      push({ health: null });
      push({ health: { workspaceRoot: 'D:/repo' } });

      expect(store.health()).toEqual(health);
      expect(store.summary().level).toBe('ok');
    });
  });
});
