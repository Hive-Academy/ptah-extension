import 'reflect-metadata';

import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InMemoryLaneOutcomeStore,
  LaneOutcomeRecorder,
  OutcomeWritePipeline,
} from '@ptah-extension/lane-outcomes';
import { FileType, type IFileSystemProvider } from '@ptah-extension/platform-core';
import { AgentId, type AgentProcessInfo, type IAgentAdapter, type LaneCompletionDelivery } from '@ptah-extension/shared';
import { Logger } from '@ptah-extension/vscode-core';
import { LaneCompletionNotifier, type LaneCompletionContext } from './lane-completion-notifier.service';

const STARTED = '2026-10-30T10:00:00.000Z';
const ENDED = '2026-10-30T10:01:00.000Z';
const PARENT = '11111111-2222-4333-8444-555555555555';
const AGENT = AgentId.from('22222222-2222-4222-8222-222222222222');
const REVIEWER = AgentId.from('33333333-3333-4333-8333-333333333333');

function loggerFixture(): Logger {
  const logger = Object.create(Logger.prototype) as Logger;
  jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
  jest.spyOn(logger, 'info').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  return logger;
}

async function fixture(withRecorder = true) {
  const directory = await mkdtemp(join(tmpdir(), 'ptah-lane-terminal-'));
  const logger = loggerFixture();
  const store = new InMemoryLaneOutcomeStore();
  const pipeline = new OutcomeWritePipeline(store, logger);
  const recorder = new LaneOutcomeRecorder(pipeline, store, logger);
  const recorded = jest.spyOn(recorder, 'recordLaneCompletion');
  const fileSystem = {
    exists: async (path: string) => stat(path).then(() => true, () => false),
    stat: async (path: string) => {
      const result = await stat(path);
      return { type: FileType.File, ctime: result.ctimeMs, mtime: result.mtimeMs, size: result.size };
    },
    readFile: async (path: string) => readFile(path, 'utf8'),
  } as IFileSystemProvider;
  const messages: string[] = [];
  const adapter = Object.assign(Object.create(null) as IAgentAdapter, {
    isSessionActive: () => true,
    sendMessageToSession: async (_session: string, message: string) => { messages.push(message); },
  });
  const notifier = new LaneCompletionNotifier(
    logger, fileSystem, adapter, () => withRecorder ? recorder : null,
  );
  const info = (changes: Partial<AgentProcessInfo> = {}): AgentProcessInfo => ({
    agentId: AGENT, cli: 'codex', task: 'Implement a change',
    workingDirectory: directory, status: 'completed', startedAt: STARTED,
    completedAt: ENDED, exitCode: 0, parentSessionId: PARENT,
    deliverables: ['report.md'], ...changes,
  } as AgentProcessInfo);
  const write = async (text: string, fresh = true, name = 'report.md') => {
    const path = join(directory, name);
    await writeFile(path, text, 'utf8');
    const when = new Date(Date.parse(STARTED) + (fresh ? 1000 : -1000));
    await utimes(path, when, when);
  };
  const flush = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await pipeline.flush();
  };
  const close = async () => {
    await pipeline.dispose();
    await rm(directory, { recursive: true, force: true });
  };
  return { directory, logger, store, pipeline, recorder, recorded, notifier, info, write, flush, close, messages };
}

async function waitForReview(run: Awaited<ReturnType<typeof fixture>>, targetId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await run.flush();
    const row = await run.store.get(targetId);
    if (row?.reviseRounds === 1) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('review capture did not reach target row');
}

async function waitForHeldReview(run: Awaited<ReturnType<typeof fixture>>) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await run.flush();
    if ((await run.store.listHeldReports(Date.now())).length > 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('review capture did not hold before target');
}

function signalOf(delivery: LaneCompletionDelivery) {
  expect(delivery.delivered).toBe(true);
  if (!delivery.delivered || !delivery.signal) throw new Error('completion signal was not delivered');
  return delivery.signal;
}

describe('lane terminal outcomes integration', () => {
  it.each([
    ['exit', {}, 'delivered', null],
    ['failed exit', { status: 'failed', exitCode: 1 }, 'failed', 'crash'],
    ['quota', { status: 'failed', failureKind: 'quota', exitCode: 1 }, 'failed', 'usage-limit'],
    ['timeout', { status: 'timeout', exitCode: undefined }, 'failed', 'timeout'],
    ['caller stop', { status: 'stopped', exitCode: undefined }, 'failed', null],
  ] as const)('%s persists the terminal verdict', async (_name, changes, verdict, failureClass) => {
    const run = await fixture();
    try {
      await run.write('fresh result');
      const signal = signalOf(await run.notifier.signal(run.info(changes)));
      await run.flush();
      expect(signal.verdict).toBe(verdict);
      expect(await run.store.get(`${AGENT}:${ENDED}`)).toMatchObject({
        verdict, failureClass,
      });
      if (verdict === 'failed') expect(signal.verdict).not.toBe('delivered');
    } finally { await run.close(); }
  });

  it.each([
    ['stale file', false, false, 'no-deliverable', 'bad-output'],
    ['exit-0 429 with stale file', false, true, 'failed', 'usage-limit'],
    ['fresh file', true, false, 'delivered', null],
    ['fresh file after 429', true, true, 'delivered', null],
  ] as const)('%s checks signal and stored row', async (_name, fresh, rateLimited, verdict, failureClass) => {
    const run = await fixture();
    try {
      await run.write('result', fresh);
      const context: LaneCompletionContext = { reportsDelivered: 0, rateLimited };
      const signal = signalOf(await run.notifier.signal(run.info(), context));
      await run.flush();
      expect(signal.verdict).toBe(verdict);
      expect(signal.deliverables[0].writtenAfterSpawn).toBe(fresh);
      if (!fresh) expect(run.messages[0]).toContain('NOT written by this run');
      expect(await run.store.get(`${AGENT}:${ENDED}`)).toMatchObject({
        verdict, failureClass,
      });
      expect(run.recorded.mock.calls[0][0].failureKind).toBeNull();
      const row = await run.store.get(`${AGENT}:${ENDED}`);
      expect(JSON.stringify(row)).not.toContain('429');
      expect(JSON.stringify(jest.mocked(run.logger.warn).mock.calls)).not.toContain('429');
    } finally { await run.close(); }
  });

  it('dedupes one terminal event and records a continuation with its own id', async () => {
    const run = await fixture();
    try {
      await run.write('result');
      const first = run.info();
      expect(signalOf(await run.notifier.signal(first)).verdict).toBe('delivered');
      expect(await run.notifier.signal(first)).toMatchObject({ delivered: false, reason: 'already-signalled' });
      const continuedAt = '2026-10-30T10:02:00.000Z';
      expect(signalOf(await run.notifier.signal(run.info({ completedAt: continuedAt }))).completedAt).toBe(continuedAt);
      await run.flush();
      expect(await run.store.get(`${AGENT}:${ENDED}`)).toBeDefined();
      expect(await run.store.get(`${AGENT}:${continuedAt}`)).toBeDefined();
      expect(await run.store.listByLane('codex', 0)).toHaveLength(2);
    } finally { await run.close(); }
  });

  it('still signals when the optional recorder is absent', async () => {
    const run = await fixture(false);
    try {
      await run.write('result');
      expect(signalOf(await run.notifier.signal(run.info())).verdict).toBe('delivered');
      expect(await run.store.get(`${AGENT}:${ENDED}`)).toBeNull();
      expect(jest.mocked(run.logger.debug)).toHaveBeenCalledWith(
        '[LaneCompletionNotifier] Outcome not recorded', { runId: `${AGENT}:${ENDED}` },
      );
    } finally { await run.close(); }
  });

  it.each(['review after target', 'review before target'] as const)(
    '%s applies one review', async (order) => {
      const run = await fixture();
      try {
        const targetId = `${AGENT}:${ENDED}`;
        await run.write('implementation');
        await run.write(`Reviewed-Run: ${targetId}\nVerdict: REVISE`, true, 'review.md');
        const reviewer = run.info({
          agentId: REVIEWER, role: 'code-logic-reviewer', taskKind: 'review',
          deliverables: ['review.md'], completedAt: '2026-10-30T10:03:00.000Z',
        });
        if (order === 'review before target') {
          await run.notifier.signal(reviewer);
          await waitForHeldReview(run);
        }
        await run.notifier.signal(run.info());
        await run.flush();
        if (order === 'review after target') {
          await run.notifier.signal(reviewer);
        }
        await waitForReview(run, targetId);
        expect(await run.store.get(targetId)).toMatchObject({ reviseRounds: 1, finalReview: null });
        await run.notifier.signal(reviewer);
        await run.flush();
        expect(await run.store.get(targetId)).toMatchObject({ reviseRounds: 1 });
      } finally { await run.close(); }
    },
  );

  it('leaves the target unchanged for a review without a reviewed-run line', async () => {
    const run = await fixture();
    try {
      const targetId = `${AGENT}:${ENDED}`;
      await run.write('implementation');
      await run.write('Verdict: REVISE', true, 'review.md');
      await run.notifier.signal(run.info());
      await run.flush();
      await run.notifier.signal(run.info({
        agentId: REVIEWER, role: 'code-logic-reviewer', taskKind: 'review',
        deliverables: ['review.md'], completedAt: '2026-10-30T10:03:00.000Z',
      }));
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      await run.flush();
      expect(await run.store.get(targetId)).toMatchObject({ reviseRounds: 0, finalReview: null });
      expect(jest.mocked(run.logger.warn)).toHaveBeenCalledWith(
        'Review capture refused', expect.objectContaining({ refusal: 'no-target' }),
      );
    } finally { await run.close(); }
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    'captures a %s review verdict from the declared file', async (verdict) => {
      const run = await fixture();
      try {
        const targetId = `${AGENT}:${ENDED}`;
        await run.write('implementation');
        await run.write(`Reviewed-Run: ${targetId}\nVerdict: ${verdict}`, true, 'review.md');
        await run.notifier.signal(run.info());
        await run.flush();
        await run.notifier.signal(run.info({
          agentId: REVIEWER, role: 'code-logic-reviewer', taskKind: 'review',
          deliverables: ['review.md'], completedAt: '2026-10-30T10:03:00.000Z',
        }));
        let captured = false;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          await run.flush();
          if ((await run.store.get(targetId))?.finalReview === verdict.toLowerCase()) {
            captured = true;
            break;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        expect(captured).toBe(true);
        expect(await run.store.get(targetId)).toMatchObject({
          finalReview: verdict.toLowerCase(), reviseRounds: 0,
        });
      } finally { await run.close(); }
    },
  );
});
