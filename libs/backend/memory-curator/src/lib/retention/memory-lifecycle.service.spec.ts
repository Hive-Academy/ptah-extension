import 'reflect-metadata';
import type {
  BackgroundWorkAdmission,
  Logger,
} from '@ptah-extension/vscode-core';
import {
  FILE_BASED_SETTINGS_DEFAULTS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { MemoryStore } from '../memory.store';
import {
  MEMORY_LIFECYCLE_DEFAULTS,
  MEMORY_LIFECYCLE_KEYS,
  readMemoryLifecycleSettings,
} from './memory-lifecycle-config';
import { MemoryLifecycleService } from './memory-lifecycle.service';
import type {
  MemoryLifecycleStore,
  OverCapWorkspace,
} from './memory-lifecycle.store';
import {
  MEMORY_RETENTION_LIMITS,
  type MemoryRetentionLimits,
} from './memory-retention-config';
import { RetentionRunBudget } from './retention-run-budget';
import { RetentionStepError } from './observation-retention.store';

function logger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

class FakeStore {
  allowed = true;
  deletes: number[] = [0];
  archives: number[] = [0];
  evictions: number[] = [];
  caps: readonly OverCapWorkspace[] = [];
  capReadErrors: readonly string[] = [];
  previewReadErrors: readonly string[] = [];
  calls: string[] = [];
  onBatch: (() => void) | null = null;

  canDelete() {
    this.calls.push('canDelete');
    return this.allowed
      ? ({ allowed: true } as const)
      : ({ allowed: false, reason: 'vec-unavailable' } as const);
  }
  deleteArchivedBatch(_cutoff: number, _limit: number) {
    this.calls.push('delete');
    this.onBatch?.();
    const deleted = this.deletes.shift() ?? 0;
    return { deleted, workspaceRoots: deleted ? ['/delete'] : [] };
  }
  archiveBatch(_cutoff: number, _now: number, _limit: number) {
    this.calls.push('archive');
    this.onBatch?.();
    const archived = this.archives.shift() ?? 0;
    return { archived, workspaceRoots: archived ? ['/archive', null] : [] };
  }
  overCapWorkspaces(_cap: number) {
    this.calls.push('cap');
    return { workspaces: this.caps, readErrors: this.capReadErrors };
  }
  evictBatch(
    root: string | null,
    tier: 'archival' | 'recall',
    grace: number,
    _limit: number,
  ) {
    this.calls.push(`evict:${tier}:${root}:${grace}`);
    this.onBatch?.();
    return { evicted: this.evictions.shift() ?? 0 };
  }
  readPreview() {
    this.calls.push('preview');
    return {
      archiveEligible: 1,
      deleteEligible: 2,
      overCap: 3,
      readErrors: this.previewReadErrors,
    };
  }
}

function harness(
  input: {
    settings?: Record<string, unknown>;
    limits?: Partial<MemoryRetentionLimits>;
    governor?: BackgroundWorkAdmission | null;
  } = {},
) {
  const clock = { value: 0 };
  const log = logger();
  const store = new FakeStore();
  const changed: Array<readonly (string | null)[]> = [];
  const memoryStore = {
    markWorkspacesChanged: (roots: Iterable<string | null>) =>
      changed.push([...roots]),
  } as unknown as MemoryStore;
  const workspace = {
    getConfiguration: (_section: string, key: string, fallback?: unknown) =>
      key in (input.settings ?? {}) ? input.settings?.[key] : fallback,
  } as IWorkspaceProvider;
  const limits = { ...MEMORY_RETENTION_LIMITS, ...input.limits };
  const service = new MemoryLifecycleService(
    log,
    workspace,
    store as unknown as MemoryLifecycleStore,
    memoryStore,
    limits,
  );
  const budget = new RetentionRunBudget({
    options: {
      signal: new AbortController().signal,
      isOnBattery: () => false,
      msSinceForegroundActivity: () => Infinity,
    },
    limits,
    now: () => clock.value,
    startedAt: 0,
    logger: log,
    governor: input.governor ?? null,
    queueBatchSize: 500,
    archiveBatchSize: 500,
    deleteBatchSize: 200,
  });
  return { service, budget, store, changed, clock, log, workspace };
}

describe('MemoryLifecycleService', () => {
  it('runs age delete, archive, cap and preview in order and marks the root union', async () => {
    const h = harness();
    h.store.deletes = [1, 0];
    h.store.archives = [1, 0];
    const result = await h.service.runStep(h.budget, 1_000_000);
    expect(h.store.calls).toEqual([
      'canDelete',
      'delete',
      'delete',
      'archive',
      'archive',
      'cap',
      'preview',
    ]);
    expect(result).toMatchObject({
      deleted: 1,
      archived: 1,
      evicted: 0,
      exhausted: true,
      stop: null,
    });
    expect(new Set(h.changed[0])).toEqual(
      new Set(['/delete', '/archive', null]),
    );
  });

  it('disabled performs preview only and does not wait for the governor', async () => {
    const governor = {
      isClear: () => false,
      whenClear: jest.fn(),
    } as BackgroundWorkAdmission;
    const h = harness({
      settings: { [MEMORY_LIFECYCLE_KEYS.enabled]: false },
      governor,
    });
    const result = await h.service.runStep(h.budget, 1_000);
    expect(result).toMatchObject({
      note: 'disabled',
      exhausted: true,
      preview: expect.any(Object),
    });
    expect(h.store.calls).toEqual(['preview']);
    expect(governor.whenClear).not.toHaveBeenCalled();
  });

  it('vec unavailable archives but performs no delete or cap eviction', async () => {
    const h = harness();
    h.store.allowed = false;
    h.store.archives = [1, 0];
    const result = await h.service.runStep(h.budget, 1_000);
    expect(result).toMatchObject({
      note: 'vec-unavailable',
      archived: 1,
      deleted: 0,
      evicted: 0,
      exhausted: true,
    });
    expect(h.store.calls).toEqual([
      'canDelete',
      'archive',
      'archive',
      'preview',
    ]);
    expect(h.log.warn).toHaveBeenCalledTimes(1);
  });

  it('stops on the independent memory row budget and omits preview', async () => {
    const h = harness({ limits: { maxMemoryRowsPerRun: 1 } });
    h.store.deletes = [1, 1];
    const result = await h.service.runStep(h.budget, 1_000);
    expect(result).toMatchObject({
      deleted: 1,
      stop: 'memory-row-budget',
      exhausted: false,
      preview: null,
    });
  });

  it('stops after a mid-step hard stop and keeps committed counts', async () => {
    const h = harness();
    h.store.deletes = [1, 1];
    h.store.onBatch = () => {
      h.clock.value = MEMORY_RETENTION_LIMITS.maxRunMs;
    };
    const result = await h.service.runStep(h.budget, 1_000);
    expect(result).toMatchObject({
      deleted: 1,
      stop: 'time-budget',
      exhausted: false,
      preview: null,
    });
    expect(h.store.calls.filter((call) => call === 'delete')).toHaveLength(1);
  });

  it('returns committed counts and invalidates touched roots after a mid-step error', async () => {
    const h = harness();
    h.store.deletes = Array.from({ length: 11 }, () => 1);
    let calls = 0;
    h.store.onBatch = () => {
      calls++;
      if (calls === 11) {
        throw new RetentionStepError(
          'sql-error',
          'delete-archived',
          new Error('injected delete failure'),
        );
      }
    };

    await expect(h.service.runStep(h.budget, 1_000)).resolves.toMatchObject({
      deleted: 10,
      exhausted: false,
      error: expect.objectContaining({ reason: 'sql-error' }),
    });
    expect(h.changed).toEqual([['/delete']]);
  });

  it('evicts archival first, then recall only when recall alone exceeds cap', async () => {
    const h = harness({
      settings: { [MEMORY_LIFECYCLE_KEYS.maxPerWorkspace]: 1_000 },
    });
    h.store.caps = [
      { workspaceRoot: '/a', evictable: 1_500, recallEvictable: 1_200 },
    ];
    h.store.evictions = [500, 200];
    const result = await h.service.runStep(h.budget, 8 * 86_400_000);
    expect(
      h.store.calls
        .filter((call) => call.startsWith('evict:'))
        .map((call) => call.split(':')[1]),
    ).toEqual(['archival', 'recall']);
    expect(result.evicted).toBe(700);
  });

  it('fails an over-cap read closed without throwing or evicting and reports it', async () => {
    const h = harness();
    h.store.capReadErrors = ['overCapWorkspaces: forced read failure'];
    await expect(h.service.runStep(h.budget, 1_000)).resolves.toMatchObject({
      exhausted: true,
      readErrors: ['overCapWorkspaces: forced read failure'],
    });
    expect(h.store.calls.some((call) => call.startsWith('evict:'))).toBe(false);
  });

  it('passes preview read errors through the step result', async () => {
    const h = harness();
    h.store.previewReadErrors = ['archiveEligible: forced read failure'];
    await expect(h.service.runStep(h.budget, 1_000)).resolves.toMatchObject({
      preview: expect.any(Object),
      readErrors: ['archiveEligible: forced read failure'],
    });
  });

  it('waits before every lifecycle batch and calls none while the governor is held', async () => {
    const waiter: { release?: () => void } = {};
    let held = true;
    const governor = {
      isClear: () => false,
      whenClear: jest.fn(() =>
        held
          ? new Promise<'clear'>((resolve) => {
              waiter.release = () => resolve('clear');
            })
          : Promise.resolve('clear' as const),
      ),
    };
    const h = harness({ governor });
    h.store.deletes = [1, 0];
    h.store.archives = [1, 0];
    const pending = h.service.runStep(h.budget, 1_000);
    await Promise.resolve();
    expect(h.store.calls).toEqual(['canDelete']);
    held = false;
    if (!waiter.release) throw new Error('governor wait was not installed');
    waiter.release();
    await expect(pending).resolves.toMatchObject({ deleted: 1, archived: 1 });
    expect(governor.whenClear).toHaveBeenCalledTimes(4);
  });

  it('stops on AbortError from a governor wait with no preview', async () => {
    let waits = 0;
    const governor = {
      isClear: () => false,
      whenClear: jest.fn(async () => {
        waits++;
        if (waits === 2)
          throw Object.assign(new Error('shutdown'), { name: 'AbortError' });
        return 'clear' as const;
      }),
    };
    const h = harness({ governor });
    h.store.deletes = [1, 1];
    const result = await h.service.runStep(h.budget, 1_000);
    expect(result).toMatchObject({
      deleted: 1,
      stop: 'aborted',
      preview: null,
    });
    expect(h.store.calls.filter((call) => call === 'delete')).toHaveLength(1);
  });

  it('matches platform defaults and clamps every numeric setting', () => {
    for (const [name, key] of Object.entries(MEMORY_LIFECYCLE_KEYS)) {
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(
        MEMORY_LIFECYCLE_DEFAULTS[
          name as keyof typeof MEMORY_LIFECYCLE_DEFAULTS
        ],
      );
    }
    const workspace = {
      getConfiguration: (_section: string, key: string) =>
        ({
          [MEMORY_LIFECYCLE_KEYS.enabled]: 'bad',
          [MEMORY_LIFECYCLE_KEYS.archiveAfterDays]: 1,
          [MEMORY_LIFECYCLE_KEYS.deleteAfterDays]: 10_000,
          [MEMORY_LIFECYCLE_KEYS.maxPerWorkspace]: Number.NaN,
        })[key],
    } as IWorkspaceProvider;
    expect(readMemoryLifecycleSettings(workspace)).toEqual({
      enabled: true,
      archiveAfterDays: 7,
      deleteAfterDays: 730,
      maxPerWorkspace: 25_000,
    });
  });
});
