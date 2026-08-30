/**
 * Pass cancellation and its commit point (TASK_2026_323 / B8).
 *
 * Preflight races every reconcile against a 1500 ms budget, and until this task
 * the losing pass was simply left running — a recursive synchronous walk of
 * `~/.ptah/user` reading and sha256-ing every file, on the Electron main
 * process's event loop, for a session that had already given up on it. Three
 * chat tabs plus a handful of rival CLI agents each start their own preflight,
 * so that background work compounds into the freeze this task exists to fix.
 *
 * Cancelling it is only safe because of the COMMIT POINT, and that is what this
 * file pins. Two rules, and the whole design lives between them:
 *
 * 1. While the pass is only READING — building the desired state, planning each
 *    target — an abort abandons it, and nothing is written or recorded.
 * 2. From the first write onward the signal is detached, so an abort that
 *    arrives mid-apply changes nothing. A half-populated target with no
 *    manifest entry for what landed stays impossible, which is the invariant
 *    `harness-sync/CLAUDE.md` cares about and the original reason the losing
 *    pass was left alone.
 *
 * Technique: hand-written `IHarnessTarget` stubs rather than real targets, for
 * the same reason `harness-reconciler.write-failure.spec.ts` uses one — the
 * invariant under test lives in `HarnessReconcilerService.reconcileTarget`,
 * not in any target's file layout, and a stub isolates it deterministically.
 *
 * Source-under-test: `HarnessReconcilerService.runReconcile` /
 * `reconcileTarget`, `abort/pass-abort.ts`.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessPassAbortedError } from '../abort/pass-abort';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import {
  ManagedManifestStore,
  managedEntry,
  type ManagedManifest,
} from '../manifest-store/managed-manifest';
import type { HarnessSourceState } from '../sources/harness-source.port';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type {
  HarnessApplyResult,
  HarnessPlan,
  IHarnessTarget,
} from '../targets/harness-target.port';
import { HarnessReconcilerService } from './harness-reconciler.service';

function makeFakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const FACETS = {
  skills: 'supported',
  commands: 'supported',
  agents: 'unsupported',
  mcp: 'supported',
} as const;

/**
 * A target that reports what it saw, and lets a test decide what happens when
 * `plan` and `apply` are reached.
 */
class ProbeTarget implements IHarnessTarget {
  readonly facets = FACETS;
  planCalls = 0;
  applyCalls = 0;
  /** The signal state observed at the moment `apply` started. */
  abortedAtApply: boolean | undefined;
  private signal: AbortSignal | undefined;

  constructor(
    readonly id: HarnessTargetId,
    private readonly onPlan: (
      target: ProbeTarget,
    ) => void | Promise<void> = () => undefined,
  ) {}

  async detect(): Promise<boolean> {
    return true;
  }

  preflightKeys(): ReadonlyMap<string, string> {
    return new Map();
  }

  async plan(
    _desired: HarnessDesiredState,
    _workspaceRoot: string,
    manifest: ManagedManifest,
    signal?: AbortSignal,
  ): Promise<HarnessPlan> {
    this.planCalls++;
    this.signal = signal;
    await this.onPlan(this);
    // The real targets check the signal between whole files; a stub checks it
    // once, at the same point in the lifecycle.
    if (signal?.aborted === true) throw new HarnessPassAbortedError();
    return {
      target: this.id,
      writes: [
        {
          relPath: `${this.id}-entry`,
          kind: 'skill',
          source: `/src/${this.id}`,
          hash: `hash-${this.id}`,
          isDirectory: true,
          reason: 'create',
          overwritesLocalEdit: false,
        },
      ],
      removals: [],
      foreign: [],
      blocked: [],
      collisions: [],
      migrations: [],
      adopted: [],
      baseEntries: { ...manifest.entries },
      unchanged: 0,
      expected: 1,
    };
  }

  async apply(): Promise<HarnessApplyResult> {
    this.applyCalls++;
    this.abortedAtApply = this.signal?.aborted;
    return {
      written: {
        [`${this.id}-entry`]: managedEntry(
          `hash-${this.id}`,
          `/src/${this.id}`,
          'skill',
        ),
      },
      removed: [],
      writeFailed: [],
      overwrittenLocalEdit: [],
    };
  }

  async verify(): Promise<HarnessTargetHealth> {
    throw new Error('verify() is not exercised by this test');
  }
}

function makeReconciler(
  ws: string,
  targets: IHarnessTarget[],
): { reconciler: HarnessReconcilerService; store: ManagedManifestStore } {
  const store = new ManagedManifestStore();
  const sourceState: HarnessSourceState = {
    layout: {
      skillsRoot: join(ws, 'unused-skills'),
      commandsRoot: join(ws, 'unused-commands'),
      agentsRoot: join(ws, 'unused-agents'),
    },
    overlayPluginPaths: [],
    disabledSkillIds: [],
    disabledPluginIds: [],
  };
  return {
    reconciler: new HarnessReconcilerService(
      makeFakeLogger(),
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState),
      targets,
    ),
    store,
  };
}

describe('HarnessReconcilerService — pass cancellation (B8)', () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-cancel-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it('abandons the pass when the signal fires during a READ phase, writing no manifest', async () => {
    const controller = new AbortController();
    const target = new ProbeTarget('claude', () => controller.abort());
    const { reconciler, store } = makeReconciler(ws, [target]);

    await expect(
      reconciler.reconcile(ws, {
        mode: 'full',
        reason: 'test',
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(HarnessPassAbortedError);

    expect(target.applyCalls).toBe(0);
    // Nothing recorded: the pass produced no answer, so it must leave no trace
    // a later pass or a health badge could mistake for one.
    expect(Object.keys(store.load(ws, 'claude').entries)).toEqual([]);
    expect(reconciler.getLastHealth()).toBeNull();
  });

  it('rejects before any target runs when the signal is already aborted', async () => {
    const target = new ProbeTarget('claude');
    const { reconciler } = makeReconciler(ws, [target]);

    await expect(
      reconciler.reconcile(ws, {
        mode: 'full',
        reason: 'test',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toBeInstanceOf(HarnessPassAbortedError);

    // The desired-state walk is the first thing the signal cuts, and it runs
    // before the workspace lock — so an already-expired budget costs nothing.
    expect(target.planCalls).toBe(0);
  });

  it('THE COMMIT POINT: an abort arriving after planning never reaches apply', async () => {
    // Abort from inside `apply` itself, which is as late as a signal can
    // possibly arrive. The pass must complete and persist ownership anyway —
    // this is the rule that keeps a target from being left half populated with
    // no manifest entry for what landed.
    const controller = new AbortController();
    const target = new ProbeTarget('claude');
    const { reconciler, store } = makeReconciler(ws, [target]);
    const originalApply = target.apply.bind(target);
    target.apply = async () => {
      controller.abort();
      return originalApply();
    };

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
      signal: controller.signal,
    });

    expect(health.targets[0]?.writeFailed).toEqual([]);
    expect(target.abortedAtApply).toBe(false);
    expect(store.load(ws, 'claude').entries['claude-entry']).toEqual(
      managedEntry('hash-claude', '/src/claude', 'skill'),
    );
  });

  it('a target that has already applied is not undone by a later target being cancelled', async () => {
    // Multi-target passes commit per target. The first one's copies and its
    // manifest are already on disk; cancelling the second must not roll that
    // back or report it as a failure — it simply is not answered this pass.
    const controller = new AbortController();
    const first = new ProbeTarget('claude');
    const second = new ProbeTarget('codex', () => controller.abort());
    const { reconciler, store } = makeReconciler(ws, [first, second]);

    await expect(
      reconciler.reconcile(ws, {
        mode: 'full',
        reason: 'test',
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(HarnessPassAbortedError);

    expect(first.applyCalls).toBe(1);
    expect(store.load(ws, 'claude').entries['claude-entry']).toBeDefined();
    expect(second.applyCalls).toBe(0);
    expect(Object.keys(store.load(ws, 'codex').entries)).toEqual([]);
  });

  it('runs to completion when no signal is supplied at all', async () => {
    // Every non-preflight trigger — activation, a plugin toggle, the wizard —
    // passes none, and must keep the pre-B8 behaviour exactly.
    const target = new ProbeTarget('claude');
    const { reconciler } = makeReconciler(ws, [target]);

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });

    expect(health.targets[0]?.detected).toBe(true);
    expect(target.applyCalls).toBe(1);
    expect(target.abortedAtApply).toBeUndefined();
  });
});
