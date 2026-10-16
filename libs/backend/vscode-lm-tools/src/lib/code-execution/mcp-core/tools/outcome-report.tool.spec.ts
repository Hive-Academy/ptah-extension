import 'reflect-metadata';
import { resolve } from 'node:path';
import type {
  IFileSystemProvider,
  IStateStorage,
} from '@ptah-extension/platform-core';
import {
  InMemoryLaneOutcomeStore,
  KeyValueOutcomeJournal,
  OutcomeWritePipeline,
  type LaneOutcomeLogger,
} from '@ptah-extension/lane-outcomes';
import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { runOutcomeReport } from './outcome-report.tool';
import { handleOutcomeReportToolCall } from './outcome-report.handler';

const root = resolve('outcome-report-fixture');
const logger: LaneOutcomeLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const files = new Map<string, { size: number; mtime: number }>();
const fileSystem = {
  exists: async (path: string) => files.has(path),
  stat: async (path: string) => {
    const file = files.get(path);
    if (!file) throw new Error('missing');
    return { ...file, type: 1, ctime: file.mtime };
  },
} as IFileSystemProvider;

function row(runId: string, agentId = runId): LaneOutcomeRecord {
  return {
    runId,
    executorKind: 'subagent',
    laneId: 'same-slug',
    agentId,
    family: 'subagent',
    provider: null,
    model: 'test',
    role: null,
    taskKind: null,
    taskId: null,
    verdict: 'unverified',
    failureClass: null,
    startedAt: 100,
    endedAt: 200,
    durationMs: 100,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    routingSource: 'not-routed',
    reviseRounds: 0,
    finalReview: null,
    deliverablesDeclaredAt: null,
    telemetryJoin: 'not-applicable',
    skillsLoaded: null,
    sessionEvidenceClass: null,
  };
}

function fixture(closed = false) {
  const store = new InMemoryLaneOutcomeStore();
  const values = new Map<string, unknown>();
  const storage = {
    get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
  } as IStateStorage;
  let open = !closed;
  let onOpen: (() => void) | undefined;
  const pipeline = new OutcomeWritePipeline(store, logger, storage, {
    isOpen: () => open,
    onDidOpen: (callback) => {
      onOpen = callback;
      return {
        dispose: () => {
          onOpen = undefined;
        },
      };
    },
  });
  return {
    store,
    pipeline,
    storage,
    deps: { store, pipeline, fileSystem, workspaceRoot: root, logger },
    reopen: () => {
      open = true;
      onOpen?.();
    },
  };
}

const deliverables = (
  target: { runId: string } | { agentId: string },
  path: string,
) => ({
  kind: 'deliverables' as const,
  target,
  paths: [path],
});

describe('ptah_outcome_report', () => {
  beforeEach(() => files.clear());

  it('returns a tool error without writing when the session workspace is unavailable', async () => {
    const f = fixture();
    const before = new KeyValueOutcomeJournal(f.storage).snapshot();
    const submit = jest.spyOn(f.pipeline, 'submit');
    const reply = await handleOutcomeReportToolCall(
      deliverables({ runId: 'subagent:A' }, 'missing.txt'),
      { ...f.deps, workspaceRoot: '' },
      {} as Logger,
    );

    expect(reply).toMatchObject({
      isError: true,
      invalidArguments: false,
      text: expect.stringContaining('session workspace root unavailable'),
    });
    expect(submit).not.toHaveBeenCalled();
    expect(new KeyValueOutcomeJournal(f.storage).snapshot()).toEqual(before);
    expect(await f.store.get('subagent:A')).toBeNull();
    await f.pipeline.dispose();
  });

  it.each(['runId', 'agentId'] as const)(
    'keeps concurrent and repeated same-slug runs separate by %s',
    async (key) => {
      const f = fixture();
      for (const id of ['A', 'B']) {
        f.pipeline.enqueue({
          kind: 'subagent-stop',
          row: row(`subagent:${id}`, id),
        });
      }
      await f.pipeline.flush();
      files.set(resolve(root, 'b.txt'), { size: 4, mtime: 150 });
      const target = (id: string) =>
        key === 'runId' ? { runId: `subagent:${id}` } : { agentId: id };
      const b = await runOutcomeReport(
        deliverables(target('B'), 'b.txt'),
        f.deps,
      );
      const a = await runOutcomeReport(
        deliverables(target('A'), 'a.txt'),
        f.deps,
      );
      expect(b.recorded).toBe('applied');
      expect(a.recorded).toBe('applied');
      expect(await f.store.get('subagent:B')).toMatchObject({
        verdict: 'delivered',
      });
      expect(await f.store.get('subagent:A')).toMatchObject({
        verdict: 'no-deliverable',
      });
      f.pipeline.enqueue({
        kind: 'subagent-stop',
        row: row('subagent:C', 'C'),
      });
      await f.pipeline.flush();
      files.set(resolve(root, 'c.txt'), { size: 1, mtime: 180 });
      expect(
        (await runOutcomeReport(deliverables(target('C'), 'c.txt'), f.deps))
          .recorded,
      ).toBe('applied');
      expect(await f.store.get('subagent:C')).toMatchObject({
        verdict: 'delivered',
      });
      expect(await f.store.get('subagent:A')).toMatchObject({
        verdict: 'no-deliverable',
      });
      for (const [id, verdict] of [
        ['A', 'revise'],
        ['A', 'approved'],
        ['B', 'rejected'],
      ] as const) {
        expect(
          (
            await runOutcomeReport(
              { kind: 'review', target: { runId: `subagent:${id}` }, verdict },
              f.deps,
            )
          ).recorded,
        ).toBe('applied');
      }
      expect(await f.store.get('subagent:A')).toMatchObject({
        reviseRounds: 1,
        finalReview: 'approved',
      });
      expect(await f.store.get('subagent:B')).toMatchObject({
        finalReview: 'rejected',
      });
      expect(await f.store.get('subagent:C')).toMatchObject({
        finalReview: null,
      });
      await f.pipeline.dispose();
    },
  );

  it('holds reports before stop, joins a held review, and writes receipts', async () => {
    const f = fixture();
    files.set(resolve(root, 'a.txt'), { size: 1, mtime: 150 });
    const a = await runOutcomeReport(
      deliverables({ runId: 'subagent:A' }, 'a.txt'),
      f.deps,
    );
    const b = await runOutcomeReport(
      deliverables({ agentId: 'B' }, 'missing.txt'),
      f.deps,
    );
    const review = await runOutcomeReport(
      { kind: 'review', target: { runId: 'subagent:A' }, verdict: 'revise' },
      f.deps,
    );
    expect([a.recorded, b.recorded, review.recorded]).toEqual([
      'held',
      'held',
      'held',
    ]);
    f.pipeline.enqueue({ kind: 'subagent-stop', row: row('subagent:B', 'B') });
    f.pipeline.enqueue({ kind: 'subagent-stop', row: row('subagent:A', 'A') });
    await f.pipeline.flush();
    expect(await f.store.get('subagent:A')).toMatchObject({
      verdict: 'delivered',
      reviseRounds: 1,
    });
    expect(await f.store.get('subagent:B')).toMatchObject({
      verdict: 'no-deliverable',
    });
    for (const result of [a, b, review]) {
      if ('reportId' in result)
        expect(await f.store.hasReceipt(result.reportId)).toBe(true);
    }
    expect(await f.store.listHeldReports(Date.now())).toHaveLength(0);
    await f.pipeline.dispose();
  });

  it('refuses unknown review in a closed store without changing journal, row, receipt, or hold', async () => {
    const f = fixture(true);
    f.pipeline.enqueue({ kind: 'lane-completion', row: row('L1') });
    await f.pipeline.flush();
    const before = new KeyValueOutcomeJournal(f.storage).snapshot();
    const submit = jest.spyOn(f.pipeline, 'submit');
    const rejected = await runOutcomeReport(
      { kind: 'review', target: { runId: 'L9' }, verdict: 'approved' },
      f.deps,
    );
    expect(rejected).toMatchObject({
      recorded: false,
      reason: expect.stringContaining('L9'),
    });
    const rejectedId = submit.mock.calls[0]?.[0].report.reportId;
    expect(rejectedId).toBeDefined();
    expect(new KeyValueOutcomeJournal(f.storage).snapshot()).toEqual(before);
    expect(
      (await runOutcomeReport(deliverables({ runId: 'L1' }, 'x'), f.deps))
        .recorded,
    ).toBe('queued');
    expect(
      (
        await runOutcomeReport(
          deliverables({ runId: 'subagent:held' }, 'x'),
          f.deps,
        )
      ).recorded,
    ).toBe('held');
    f.reopen();
    await f.pipeline.flush();
    expect(await f.store.get('L9')).toBeNull();
    expect(await f.store.hasReceipt(rejectedId ?? '')).toBe(false);
    const holds = await f.store.listHeldReports(Date.now());
    expect(holds).toHaveLength(1);
    expect(holds.some((hold) => hold.runId === 'L9')).toBe(false);
    expect(await f.store.hasHeldDeliverables('L9', Date.now())).toBe(false);
    await f.pipeline.dispose();
  });

  it('rejects escaping paths and does not persist source paths', async () => {
    const f = fixture();
    f.pipeline.enqueue({ kind: 'subagent-stop', row: row('subagent:A', 'A') });
    await f.pipeline.flush();
    await expect(
      runOutcomeReport(
        deliverables({ runId: 'subagent:A' }, '../outside'),
        f.deps,
      ),
    ).rejects.toThrow('escapes workspace');
    files.set(resolve(root, 'secret.txt'), { size: 2, mtime: 150 });
    const result = await runOutcomeReport(
      deliverables({ runId: 'subagent:A' }, 'secret.txt'),
      f.deps,
    );
    expect(result.recorded).toBe('applied');
    expect(
      JSON.stringify(new KeyValueOutcomeJournal(f.storage).snapshot()),
    ).not.toContain('secret.txt');
    await f.pipeline.dispose();
  });
});
