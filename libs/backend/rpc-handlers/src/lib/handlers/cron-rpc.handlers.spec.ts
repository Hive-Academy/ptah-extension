/**
 * CronRpcHandlers — unit specs.
 *
 * Coverage (workspace-scoping review, Failure Mode 3 / Issue 7 follow-up):
 *   METHODS invariant   — exactly the 9 cron:* names
 *   cron:list           — normalizes the workspaceRoot filter before delegating
 *   cron:list           — omits the filter (undefined) when none is supplied
 *   cron:list           — rejects non-string / relative / traversal filters
 *   cron:create         — stores the canonical (normalized) workspaceRoot
 *   cron:create         — rejects `handler:` prompts + unsafe workspaceRoot
 *   cron:update         — normalizes a supplied workspaceRoot patch
 *   cron:update         — leaves workspaceRoot untouched when absent from patch
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/cron-rpc.handlers.ts
 */
import 'reflect-metadata';
import * as path from 'node:path';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  normalizeWorkspaceRoot,
  type CronScheduler,
  type ScheduledJob,
  type UpdateJobPatch,
} from '@ptah-extension/cron-scheduler';

import { CronRpcHandlers } from './cron-rpc.handlers';

function makeJob(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: (over.id ?? 'job-1') as ScheduledJob['id'],
    name: over.name ?? 'sample',
    cronExpr: over.cronExpr ?? '0 * * * *',
    timezone: over.timezone ?? 'UTC',
    prompt: over.prompt ?? 'noop',
    workspaceRoot: over.workspaceRoot ?? null,
    enabled: over.enabled ?? true,
    createdAt: over.createdAt ?? 0,
    updatedAt: over.updatedAt ?? 0,
    lastRunAt: over.lastRunAt ?? null,
    nextRunAt: over.nextRunAt ?? null,
  };
}

interface FakeScheduler {
  list: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
}

interface Suite {
  rpc: MockRpcHandler;
  scheduler: FakeScheduler;
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const scheduler: FakeScheduler = {
    list: jest.fn().mockReturnValue([]),
    create: jest.fn((input) => makeJob(input)),
    update: jest.fn((_id, patch) => makeJob(patch)),
  };

  const handlers = new CronRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    scheduler as unknown as CronScheduler,
  );
  handlers.register();

  return { rpc, scheduler };
}

function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (params: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method '${method}' was not registered`);
  return match[1];
}

describe('CronRpcHandlers.METHODS', () => {
  it('owns exactly the 9 cron:* methods', () => {
    expect([...CronRpcHandlers.METHODS]).toEqual([
      'cron:list',
      'cron:get',
      'cron:create',
      'cron:update',
      'cron:delete',
      'cron:toggle',
      'cron:runNow',
      'cron:runs',
      'cron:nextFire',
    ]);
  });
});

describe('cron:list', () => {
  it('normalizes the workspaceRoot filter before delegating', async () => {
    const { rpc, scheduler } = buildSuite();
    const handler = getHandler(rpc, 'cron:list');
    const raw = path.resolve('list-ws') + path.sep; // absolute + trailing sep

    await handler({ workspaceRoot: raw });

    expect(scheduler.list).toHaveBeenCalledWith({
      enabledOnly: undefined,
      workspaceRoot: normalizeWorkspaceRoot(raw),
    });
  });

  it('passes workspaceRoot: undefined when no filter is supplied', async () => {
    const { rpc, scheduler } = buildSuite();
    const handler = getHandler(rpc, 'cron:list');

    await handler({ enabledOnly: true });

    expect(scheduler.list).toHaveBeenCalledWith({
      enabledOnly: true,
      workspaceRoot: undefined,
    });
  });

  it('rejects a non-string workspaceRoot at the JSON-RPC boundary', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'cron:list');

    await expect(handler({ workspaceRoot: 42 })).rejects.toThrow(
      /non-empty string/,
    );
  });

  it('rejects a relative (traversal-prone) workspaceRoot filter', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'cron:list');

    // Relative paths — including `..`-bearing ones — are rejected at the
    // absolute-path gate before they could ever reach the store.
    await expect(handler({ workspaceRoot: 'relative/path' })).rejects.toThrow(
      /absolute path/,
    );
    await expect(handler({ workspaceRoot: '../escape' })).rejects.toThrow(
      /absolute path/,
    );
  });

  it('rejects an empty-string workspaceRoot filter', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'cron:list');

    await expect(handler({ workspaceRoot: '' })).rejects.toThrow(
      /non-empty string/,
    );
  });
});

describe('cron:create', () => {
  it('stores the canonical (normalized) workspaceRoot', async () => {
    const { rpc, scheduler } = buildSuite();
    const handler = getHandler(rpc, 'cron:create');
    const raw = path.resolve('create-ws') + path.sep;

    await handler({
      name: 'job',
      cronExpr: '0 * * * *',
      prompt: 'do things',
      workspaceRoot: raw,
    });

    expect(scheduler.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: normalizeWorkspaceRoot(raw) }),
    );
  });

  it('stores null when no workspaceRoot is supplied', async () => {
    const { rpc, scheduler } = buildSuite();
    const handler = getHandler(rpc, 'cron:create');

    await handler({ name: 'job', cronExpr: '0 * * * *', prompt: 'do things' });

    expect(scheduler.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: null }),
    );
  });

  it("rejects a 'handler:' prompt", async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'cron:create');

    await expect(
      handler({
        name: 'job',
        cronExpr: '0 * * * *',
        prompt: 'handler:memory:decay',
      }),
    ).rejects.toThrow(/reserved for internal jobs/);
  });

  it('rejects an unsafe (relative) workspaceRoot', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'cron:create');

    await expect(
      handler({
        name: 'job',
        cronExpr: '0 * * * *',
        prompt: 'do things',
        workspaceRoot: 'relative/path',
      }),
    ).rejects.toThrow(/absolute path/);
  });
});

describe('cron:update', () => {
  // cron:update runs the id through JobId.from, which requires a valid ULID.
  const JOB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  it('normalizes a supplied workspaceRoot patch', async () => {
    const { rpc, scheduler } = buildSuite();
    const handler = getHandler(rpc, 'cron:update');
    const raw = path.resolve('update-ws') + path.sep;

    await handler({ id: JOB_ID, patch: { workspaceRoot: raw } });

    const patch = scheduler.update.mock.calls[0][1] as UpdateJobPatch;
    expect(patch.workspaceRoot).toBe(normalizeWorkspaceRoot(raw));
  });

  it('leaves workspaceRoot absent when the patch does not include it', async () => {
    const { rpc, scheduler } = buildSuite();
    const handler = getHandler(rpc, 'cron:update');

    await handler({ id: JOB_ID, patch: { name: 'renamed' } });

    const patch = scheduler.update.mock.calls[0][1] as UpdateJobPatch;
    expect('workspaceRoot' in patch).toBe(false);
    expect(patch.name).toBe('renamed');
  });
});
