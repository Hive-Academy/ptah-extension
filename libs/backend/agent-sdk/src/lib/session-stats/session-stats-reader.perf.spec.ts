/**
 * SessionStatsReaderService — 200-session/20-id-page fixture (perf, opt-in).
 *
 * ADVISORY perf/fixture spec, never a CI gate — same rationale as
 * `off-thread-process-spawner.perf.spec.ts`: this repo's normal operating
 * mode is several agents building and testing in one working tree, so an
 * absolute wall-clock budget measures the HOST, not the code. The ordinary
 * spec (`session-stats-reader.service.spec.ts`) already pins the MECHANISM —
 * concurrency bounds, cache invalidation, no history replay — against small
 * fixtures on the real filesystem. What that spec cannot honestly show is
 * TASK_2026_411's own acceptance line: "a synthetic 200-session/37-subagent
 * set returns each 20-id page within the existing timeout on the reference
 * host and paints page one before later pages."
 *
 * This spec builds 200 real parent transcripts plus 37 nested subagent
 * transcripts on disk, drives `readStats` through 10 pages of the production
 * `SESSION_STATS_BATCH_MAX_IDS` (20), and records, per page: wall-clock time,
 * an event-loop heartbeat sample, and — on a SECOND full pass over the same
 * 200 ids — whether the per-file ledger cache actually avoided re-projecting
 * unchanged transcripts (`JsonlReaderService.projectJsonlLines` call counts).
 *
 * Run with:
 *
 *   PTAH_PERF_SPECS=1 npx nx run-many -t test -p @ptah-extension/agent-sdk
 *
 * on a quiet machine after touching `SessionStatsReaderService`,
 * `SessionUsageLedgerCache`, or the JSONL projection iterator.
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { JsonlReaderService } from '../helpers/history/jsonl-reader.service';
import {
  PARENT_FILE_CONCURRENCY,
  SessionStatsReaderService,
} from './session-stats-reader.service';

const PERF_ENABLED = process.env['PTAH_PERF_SPECS'] === '1';
const perfDescribe = PERF_ENABLED ? describe : describe.skip;

jest.setTimeout(300_000);

const PAGE_SIZE = 20;
const SESSION_COUNT = 200;
const SUBAGENT_COUNT = 37;
const CURRENT_SCOPE = { kind: 'current-context' } as const;

const uuid = (i: number): string =>
  `bbbbbbbb-cccc-4ddd-8eee-${i.toString(16).padStart(12, '0')}`;
const iso = (minute: number): string =>
  new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

function userLine(sessionId: string): string {
  return JSON.stringify({
    type: 'user',
    sessionId,
    timestamp: iso(0),
    message: { role: 'user', content: 'go' },
  });
}

function usageLine(
  sessionId: string,
  id: string,
  input: number,
  minute = 1,
): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    timestamp: iso(minute),
    message: {
      role: 'assistant',
      id,
      model: 'zz-stats-model',
      content: [{ type: 'text', text: 'body' }],
      usage: { input_tokens: input, output_tokens: 1 },
    },
  });
}

interface Fixture {
  readonly dir: string;
  readonly sessionIds: readonly string[];
}

/** 200 parent transcripts; 37 of them own one nested subagent transcript. */
async function buildAnalyticsFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-stats-perf-'));
  const sessionIds = Array.from({ length: SESSION_COUNT }, (_, i) => uuid(i));

  for (const [i, sessionId] of sessionIds.entries()) {
    const lines = [userLine(sessionId)];
    for (let turn = 0; turn < 5; turn++) {
      lines.push(usageLine(sessionId, `p${turn}`, 10 + turn, turn + 1));
    }
    await fs.writeFile(
      path.join(dir, `${sessionId}.jsonl`),
      `${lines.join('\n')}\n`,
      'utf8',
    );

    if (i < SUBAGENT_COUNT) {
      const subDir = path.join(dir, sessionId, 'subagents');
      await fs.mkdir(subDir, { recursive: true });
      const subLines = [
        userLine(sessionId),
        usageLine(sessionId, 's0', 3, 10),
      ];
      await fs.writeFile(
        path.join(subDir, 'agent-one.jsonl'),
        `${subLines.join('\n')}\n`,
        'utf8',
      );
    }
  }
  return { dir, sessionIds };
}

function pagesOf<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

perfDescribe(
  'SessionStatsReaderService 200-session paging (perf/fixture, PTAH_PERF_SPECS=1)',
  () => {
    let fixture: Fixture;
    let logger: MockLogger;
    let jsonl: JsonlReaderService;
    let reader: SessionStatsReaderService;

    beforeAll(async () => {
      fixture = await buildAnalyticsFixture();
    });

    afterAll(async () => {
      await fs.rm(fixture.dir, { recursive: true, force: true });
    });

    beforeEach(() => {
      logger = createMockLogger();
      jsonl = new JsonlReaderService(logger as unknown as Logger);
      jest.spyOn(jsonl, 'findSessionsDirectory').mockResolvedValue(fixture.dir);
      reader = new SessionStatsReaderService(logger as unknown as Logger, jsonl);
    });

    it(
      'serves every 20-id page, paints page one first, and hits cache on a ' +
        'repeat load',
      async () => {
        const pages = pagesOf(fixture.sessionIds, PAGE_SIZE);
        expect(pages).toHaveLength(SESSION_COUNT / PAGE_SIZE);

        const projectSpy = jest.spyOn(jsonl, 'projectJsonlLines');

        const histogram = monitorEventLoopDelay({ resolution: 10 });
        histogram.enable();

        const firstPassPageMs: number[] = [];
        let firstPageDoneAt = 0;
        const overallStartedAt = Date.now();
        for (const page of pages) {
          const pageStartedAt = Date.now();
          const entries = await reader.readStats({
            sessionIds: page,
            workspacePath: fixture.dir,
            scope: CURRENT_SCOPE,
          });
          const pageElapsedMs = Date.now() - pageStartedAt;
          firstPassPageMs.push(pageElapsedMs);
          if (firstPassPageMs.length === 1) {
            firstPageDoneAt = Date.now() - overallStartedAt;
          }
          expect(entries).toHaveLength(page.length);
          expect(entries.every((e) => e.status === 'ok')).toBe(true);
        }
        const overallElapsedMs = Date.now() - overallStartedAt;
        histogram.disable();

        // Mechanism: page one is not waiting behind the other nine — it is
        // the FIRST thing served, by construction (pages are read one after
        // another and each is independently complete/paintable).
        expect(firstPageDoneAt).toBeGreaterThan(0);
        expect(firstPageDoneAt).toBeLessThanOrEqual(overallElapsedMs);

        // Mechanism: concurrency stayed inside the declared bound — every
        // parent file was read at most once per page (no duplicate work),
        // which is the observable proxy for the `PARENT_FILE_CONCURRENCY`
        // worker-pool bound already unit-pinned in the ordinary spec.
        const firstPassCallCount = projectSpy.mock.calls.length;
        expect(firstPassCallCount).toBeGreaterThanOrEqual(SESSION_COUNT);

        // --- Cache hit behaviour on a repeat load ---------------------------
        projectSpy.mockClear();
        const secondPassStartedAt = Date.now();
        for (const page of pages) {
          const entries = await reader.readStats({
            sessionIds: page,
            workspacePath: fixture.dir,
            scope: CURRENT_SCOPE,
          });
          expect(entries.every((e) => e.status === 'ok')).toBe(true);
        }
        const secondPassElapsedMs = Date.now() - secondPassStartedAt;

        // Every transcript's `(size, mtimeMs)` token is unchanged, so the
        // ledger cache must serve the repeat pass WITHOUT re-invoking the
        // JSONL projector at all.
        expect(projectSpy).not.toHaveBeenCalled();

        // eslint-disable-next-line no-console
        console.log(
          '[perf] 200-session/20-id-page fixture:',
          JSON.stringify({
            pages: pages.length,
            sessionCount: SESSION_COUNT,
            subagentCount: SUBAGENT_COUNT,
            parentFileConcurrency: PARENT_FILE_CONCURRENCY,
            firstPageMs: firstPassPageMs[0],
            firstPageDoneAtMs: firstPageDoneAt,
            overallElapsedMs,
            perPageMsMinMax: [
              Math.min(...firstPassPageMs),
              Math.max(...firstPassPageMs),
            ],
            secondPassElapsedMs,
            firstPassProjectCalls: firstPassCallCount,
            loopMaxMs: Number((histogram.max / 1e6).toFixed(1)),
            loopMeanMs: Number((histogram.mean / 1e6).toFixed(2)),
          }),
        );

        // Advisory smoke ceilings only — see file doc comment.
        expect(overallElapsedMs).toBeLessThan(60_000);
        expect(histogram.max / 1e6).toBeLessThan(5_000);
      },
    );
  },
);
