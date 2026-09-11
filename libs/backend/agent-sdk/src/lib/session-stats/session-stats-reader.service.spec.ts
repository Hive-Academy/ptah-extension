/**
 * SessionStatsReaderService — against a REAL filesystem (TASK_2026_411 B4).
 *
 * Covers what only real files can prove: exact cache invalidation after an
 * append, a same-size rewrite, and subagent add/remove; nested and legacy
 * subagent membership; cancellation that caches nothing; and the page-level
 * work bounds (two parent files, three subagent files, yielding reads).
 *
 * The bounds are asserted as MECHANISM — in-flight counts and yield counts
 * observed through the projection seam — never as wall-clock time, so the spec
 * stays deterministic on a loaded CI host.
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SESSION_STATS_BATCH_MAX_IDS,
  registerProviderPricing,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { JsonlReaderService } from '../helpers/history/jsonl-reader.service';
import type { JsonlProjectionResult } from '../helpers/history/jsonl-reader.service';
import {
  PARENT_FILE_CONCURRENCY,
  SUBAGENT_FILE_CONCURRENCY,
  SessionStatsReaderService,
} from './session-stats-reader.service';

const uuid = (i: number): string =>
  `aaaaaaaa-bbbb-4ccc-8ddd-${i.toString(16).padStart(12, '0')}`;
const iso = (minute: number): string =>
  new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const CURRENT = { kind: 'current-context' } as const;

function usageLine(
  sessionId: string,
  id: string,
  input: number,
  model = 'zz-stats-model',
  minute = 1,
): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    timestamp: iso(minute),
    message: {
      role: 'assistant',
      id,
      model,
      content: [{ type: 'text', text: 'body' }],
      usage: { input_tokens: input, output_tokens: 1 },
    },
  });
}

function userLine(sessionId: string): string {
  return JSON.stringify({
    type: 'user',
    sessionId,
    timestamp: iso(0),
    message: { role: 'user', content: 'go' },
  });
}

describe('SessionStatsReaderService', () => {
  // Real-filesystem suite: generous per-test limit so a loaded CI host cannot
  // turn slow I/O into a failure. Nothing here asserts elapsed time.
  jest.setTimeout(120_000);

  let dir: string;
  let logger: MockLogger;
  let jsonl: JsonlReaderService;
  let reader: SessionStatsReaderService;
  let projectSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-stats-'));
    logger = createMockLogger();
    jsonl = new JsonlReaderService(logger as unknown as Logger);
    jest.spyOn(jsonl, 'findSessionsDirectory').mockResolvedValue(dir);
    projectSpy = jest.spyOn(jsonl, 'projectJsonlLines');
    reader = new SessionStatsReaderService(logger as unknown as Logger, jsonl);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeParent(id: string, lines: string[]): Promise<string> {
    const filePath = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
    return filePath;
  }

  async function writeNested(
    id: string,
    agent: string,
    lines: string[],
  ): Promise<string> {
    const subDir = path.join(dir, id, 'subagents');
    await fs.mkdir(subDir, { recursive: true });
    const filePath = path.join(subDir, `agent-${agent}.jsonl`);
    await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
    return filePath;
  }

  function projectionsOf(filePath: string): number {
    return projectSpy.mock.calls.filter(([p]) => p === filePath).length;
  }

  const read = (ids: string[], scope = CURRENT as never, signal?: AbortSignal) =>
    reader.readStats({ sessionIds: ids, workspacePath: dir, scope, signal });

  it('counts nested subagents without ever materialising history', async () => {
    const id = uuid(1);
    await writeParent(id, [userLine(id), usageLine(id, 'p1', 10)]);
    await writeNested(id, 'one', [userLine(id), usageLine(id, 's1', 5)]);
    await writeNested(id, 'two', [userLine(id), usageLine(id, 's2', 7)]);
    const history = jest.spyOn(jsonl, 'readJsonlMessages');
    const agents = jest.spyOn(jsonl, 'loadAgentSessions');

    const [entry] = await read([id]);

    expect(entry.status).toBe('ok');
    expect(entry.tokens.input).toBe(22);
    expect(entry.agentSessionCount).toBe(2);
    expect(history).not.toHaveBeenCalled();
    expect(agents).not.toHaveBeenCalled();
  });

  it('assigns legacy flat agent files by the session id on their first record', async () => {
    const mine = uuid(2);
    const other = uuid(3);
    await writeParent(mine, [userLine(mine), usageLine(mine, 'p', 1)]);
    await writeParent(other, [userLine(other), usageLine(other, 'q', 1)]);
    await fs.writeFile(
      path.join(dir, 'agent-flat-mine.jsonl'),
      `${userLine(mine)}\n${usageLine(mine, 'fm', 100)}\n`,
    );
    await fs.writeFile(
      path.join(dir, 'agent-flat-other.jsonl'),
      `${userLine(other)}\n${usageLine(other, 'fo', 1000)}\n`,
    );

    const [a, b] = await read([mine, other]);

    expect(a.tokens.input).toBe(101);
    expect(a.agentSessionCount).toBe(1);
    expect(b.tokens.input).toBe(1001);
  });

  it('returns empty for a missing transcript and rejects invalid requests', async () => {
    await expect(read([uuid(9)])).resolves.toEqual([
      expect.objectContaining({ status: 'empty', totalCost: null }),
    ]);
    await expect(read([])).resolves.toEqual([]);
    await expect(read(['../../etc/passwd'])).rejects.toThrow('non-UUID');
    await expect(
      read(Array.from({ length: SESSION_STATS_BATCH_MAX_IDS + 1 }, (_, i) => uuid(i))),
    ).rejects.toThrow('max 20');
  });

  describe('exact cache invalidation', () => {
    it('reuses projections across repeat reads and range changes', async () => {
      const id = uuid(10);
      const parent = await writeParent(id, [userLine(id), usageLine(id, 'p', 10)]);

      await read([id]);
      await read([id]);
      const [ranged] = await read([id], {
        kind: 'range',
        since: 0,
        until: Date.UTC(2030, 0, 1),
      } as never);

      expect(ranged.tokens.input).toBe(10);
      expect(projectionsOf(parent)).toBe(1);
    });

    it('re-projects after an append', async () => {
      const id = uuid(11);
      const parent = await writeParent(id, [userLine(id), usageLine(id, 'p', 10)]);
      await read([id]);

      await fs.appendFile(parent, `${usageLine(id, 'p2', 5)}\n`);
      const [entry] = await read([id]);

      expect(entry.tokens.input).toBe(15);
      expect(projectionsOf(parent)).toBe(2);
    });

    it('re-projects a same-size rewrite once the mtime moves', async () => {
      const id = uuid(12);
      const parent = await writeParent(id, [userLine(id), usageLine(id, 'p', 11)]);
      await read([id]);

      const before = await fs.stat(parent);
      await writeParent(id, [userLine(id), usageLine(id, 'p', 22)]);
      const future = new Date(before.mtimeMs + 60_000);
      await fs.utimes(parent, future, future);
      expect((await fs.stat(parent)).size).toBe(before.size);

      const [entry] = await read([id]);
      expect(entry.tokens.input).toBe(22);
    });

    it('sees an added and then a removed subagent file without re-reading the parent', async () => {
      const id = uuid(13);
      const parent = await writeParent(id, [userLine(id), usageLine(id, 'p', 10)]);
      expect((await read([id]))[0].tokens.input).toBe(10);

      const sub = await writeNested(id, 'late', [userLine(id), usageLine(id, 's', 4)]);
      const [added] = await read([id]);
      expect(added.tokens.input).toBe(14);
      expect(added.agentSessionCount).toBe(1);

      await fs.rm(sub);
      const [removed] = await read([id]);
      expect(removed.tokens.input).toBe(10);
      expect(removed.agentSessionCount).toBe(0);
      expect(projectionsOf(parent)).toBe(1);
    });

    it('prices at serve time, so a rate-card change needs no re-projection', async () => {
      const id = uuid(14);
      const parent = await writeParent(id, [
        userLine(id),
        usageLine(id, 'p', 1000, 'zz-stats-late-priced'),
      ]);

      const [before] = await read([id]);
      expect(before.totalCost).toBeNull();
      expect(before.pricingCoverage).toBe('none');

      registerProviderPricing({
        'zz-stats-late-priced': { inputCostPerToken: 0.001, outputCostPerToken: 0.002 },
      });
      const [after] = await read([id]);
      expect(after.totalCost).toBeCloseTo(1000 * 0.001 + 1 * 0.002, 6);
      expect(after.pricingCoverage).toBe('full');
      expect(projectionsOf(parent)).toBe(1);
    });
  });

  it('marks coverage partial when a member subagent cannot be read', async () => {
    const id = uuid(15);
    await writeParent(id, [userLine(id), usageLine(id, 'p', 10)]);
    const broken = await writeNested(id, 'broken', [userLine(id)]);
    const original = projectSpy.getMockImplementation();
    projectSpy.mockImplementation(async (filePath: string, ...rest: unknown[]) => {
      if (filePath === broken) throw new Error('EACCES');
      return (original ?? JsonlReaderService.prototype.projectJsonlLines).apply(
        jsonl,
        [filePath, ...rest] as never,
      );
    });

    const [entry] = await read([id]);
    expect(entry.status).toBe('ok');
    expect(entry.coverage).toBe('partial');
    expect(entry.agentSessionCount).toBe(1);
  });

  describe('cancellation', () => {
    it('reports every session as error when the page is already aborted', async () => {
      const id = uuid(20);
      await writeParent(id, [userLine(id), usageLine(id, 'p', 1)]);
      const controller = new AbortController();
      controller.abort();

      const entries = await read([id, uuid(21)], CURRENT as never, controller.signal);
      expect(entries.map((e) => e.status)).toEqual(['error', 'error']);
      expect(projectSpy).not.toHaveBeenCalled();
    });

    it('stops mid-page, fails every unfinished session, and caches nothing the aborted projection started', async () => {
      const ids = [uuid(30), uuid(31), uuid(32), uuid(33)];
      const paths = await Promise.all(
        ids.map((id) => writeParent(id, [userLine(id), usageLine(id, 'p', 3)])),
      );
      const controller = new AbortController();
      const real = JsonlReaderService.prototype.projectJsonlLines;
      let abortedAt: string | undefined;
      projectSpy.mockImplementation(async (filePath: string, ...rest: unknown[]) => {
        // Abort on the page's FIRST projection, whichever of the two parent
        // workers reaches it. No projection can have finished before it, so
        // every entry — including ids[1], which starts alongside ids[0] — has
        // a pinned outcome regardless of which stat returns first.
        if (abortedAt === undefined) {
          abortedAt = filePath;
          controller.abort();
        }
        return real.apply(jsonl, [filePath, ...rest] as never);
      });

      const entries = await read(ids, CURRENT as never, controller.signal);
      expect(entries.map((e) => e.status)).toEqual(['error', 'error', 'error', 'error']);

      const abortedPath = abortedAt as string;
      const [retried] = await read([ids[paths.indexOf(abortedPath)]]);
      expect(retried.status).toBe('ok');
      expect(projectionsOf(abortedPath)).toBe(2);
    });

    it('never fails a live page when a concurrent page on the same session aborts', async () => {
      const id = uuid(34);
      const parent = await writeParent(id, [userLine(id), usageLine(id, 'p', 3)]);
      const aborted = new AbortController();
      const live = new AbortController();
      const real = JsonlReaderService.prototype.projectJsonlLines;
      projectSpy.mockImplementation(
        async (filePath: string, visit: unknown, options?: { signal?: AbortSignal }) => {
          // The aborted page cancels the moment a projection runs under ITS
          // signal. Whichever page owns the shared projection, the live page
          // must come back 'ok'.
          if (options?.signal === aborted.signal) aborted.abort();
          return real.call(jsonl, filePath, visit as never, options);
        },
      );

      const [abortedEntries, liveEntries] = await Promise.all([
        read([id], CURRENT as never, aborted.signal),
        read([id], CURRENT as never, live.signal),
      ]);

      expect(liveEntries[0].status).toBe('ok');
      expect(liveEntries[0].tokens.input).toBe(3);
      expect(['ok', 'error']).toContain(abortedEntries[0].status);
      expect(projectionsOf(parent)).toBeLessThanOrEqual(2);
    });
  });

  describe('work bounds for a synthetic 20-id page', () => {
    const NESTED_MARKER = `${path.sep}subagents${path.sep}`;
    const isNestedSubagent = (filePath: string): boolean =>
      filePath.includes(NESTED_MARKER);
    const isAgentFile = (filePath: string): boolean =>
      path.basename(filePath).startsWith('agent-');

    function instrument(isChild: (filePath: string) => boolean = isNestedSubagent): {
      maxParents: () => number;
      maxChildren: () => number;
      results: Array<{ filePath: string; result: JsonlProjectionResult }>;
    } {
      let parents = 0;
      let children = 0;
      let peakParents = 0;
      let peakChildren = 0;
      const results: Array<{ filePath: string; result: JsonlProjectionResult }> = [];
      const real = JsonlReaderService.prototype.projectJsonlLines;
      projectSpy.mockImplementation(async (filePath: string, ...rest: unknown[]) => {
        const child = isChild(filePath);
        if (child) peakChildren = Math.max(peakChildren, ++children);
        else peakParents = Math.max(peakParents, ++parents);
        try {
          const result = await real.apply(jsonl, [filePath, ...rest] as never);
          results.push({ filePath, result });
          return result;
        } finally {
          if (child) children--;
          else parents--;
        }
      });
      return {
        maxParents: () => peakParents,
        maxChildren: () => peakChildren,
        results,
      };
    }

    it('reads at most two parents and three subagent files at once, yielding on every long file', async () => {
      const ids = Array.from({ length: SESSION_STATS_BATCH_MAX_IDS }, (_, i) => uuid(100 + i));
      for (const id of ids) {
        const lines = [userLine(id)];
        for (let n = 0; n < 600; n++) lines.push(usageLine(id, `p${n}`, 1));
        await writeParent(id, lines);
        for (const agent of ['a', 'b']) {
          const subLines = [userLine(id)];
          for (let n = 0; n < 450; n++) subLines.push(usageLine(id, `${agent}${n}`, 1));
          await writeNested(id, agent, subLines);
        }
      }
      const probe = instrument();

      const entries = await read(ids);

      expect(entries).toHaveLength(20);
      expect(entries.every((e) => e.status === 'ok')).toBe(true);
      expect(entries.every((e) => e.tokens.input === 600 + 900)).toBe(true);
      expect(probe.maxParents()).toBeLessThanOrEqual(PARENT_FILE_CONCURRENCY);
      expect(probe.maxParents()).toBe(2);
      expect(probe.maxChildren()).toBeLessThanOrEqual(SUBAGENT_FILE_CONCURRENCY);
      expect(probe.maxChildren()).toBeGreaterThanOrEqual(2);
      // 200-line yield budget: a 601-line parent yields at least 3 times and a
      // 451-line subagent at least twice.
      expect(probe.results).toHaveLength(60);
      for (const { filePath, result } of probe.results) {
        const minimum = filePath.includes(`${path.sep}subagents${path.sep}`) ? 2 : 3;
        expect(result.yields).toBeGreaterThanOrEqual(minimum);
      }
    });

    it('caps subagent reads for one session at three', async () => {
      const id = uuid(200);
      await writeParent(id, [userLine(id), usageLine(id, 'p', 1)]);
      for (const agent of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const lines = [userLine(id)];
        for (let n = 0; n < 450; n++) lines.push(usageLine(id, `${agent}${n}`, 1));
        await writeNested(id, agent, lines);
      }
      const probe = instrument();

      const [entry] = await read([id]);

      expect(entry.agentSessionCount).toBe(6);
      expect(probe.maxChildren()).toBe(SUBAGENT_FILE_CONCURRENCY);
    });

    // b4 code-logic review, minor: the legacy ownership scan awaited one flat
    // file at a time, so legacy sessions never used the subagent slots.
    it('scans legacy flat subagent files for ownership three at a time', async () => {
      const id = uuid(201);
      await writeParent(id, [userLine(id), usageLine(id, 'p', 1)]);
      for (const agent of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const lines = [userLine(id)];
        for (let n = 0; n < 450; n++) lines.push(usageLine(id, `${agent}${n}`, 1));
        await fs.writeFile(path.join(dir, `agent-flat-${agent}.jsonl`), `${lines.join('\n')}\n`);
      }
      const probe = instrument(isAgentFile);

      const [entry] = await read([id]);

      expect(entry.agentSessionCount).toBe(6);
      expect(entry.tokens.input).toBe(1 + 6 * 450);
      expect(probe.maxChildren()).toBeLessThanOrEqual(SUBAGENT_FILE_CONCURRENCY);
      expect(probe.maxChildren()).toBe(SUBAGENT_FILE_CONCURRENCY);
    });
  });

  // b4 code-logic review, minor: an unreadable flat file has no provable owner,
  // so it may be this session's — dropping it claimed complete coverage.
  it('marks coverage partial when a legacy flat subagent file cannot be read', async () => {
    const id = uuid(16);
    await writeParent(id, [userLine(id), usageLine(id, 'p', 10)]);
    const broken = path.join(dir, 'agent-flat-broken.jsonl');
    await fs.writeFile(broken, `${userLine(id)}\n${usageLine(id, 'fb', 100)}\n`);
    const real = JsonlReaderService.prototype.projectJsonlLines;
    projectSpy.mockImplementation(async (filePath: string, ...rest: unknown[]) => {
      if (filePath === broken) throw new Error('EACCES');
      return real.apply(jsonl, [filePath, ...rest] as never);
    });

    const [entry] = await read([id]);

    expect(entry.status).toBe('ok');
    expect(entry.tokens.input).toBe(10);
    expect(entry.coverage).toBe('partial');
    expect(entry.agentSessionCount).toBe(1);
  });
});
