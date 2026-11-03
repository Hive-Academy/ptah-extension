/**
 * SessionHistoryReaderService.readCarryOverTranscript — bounded carry-over read.
 *
 * Runs the real `JsonlReaderService` against temp JSONL files so the tail
 * window, the partial-first-line drop and the record conversion are the
 * production ones. `findSessionsDirectory` is pointed at the temp directory;
 * `readJsonlTail` and `readJsonlMessages` are spied (pass-through) so the spec
 * can assert which read ran and with which bound.
 *
 * The compaction records follow the shape of a real compacted Claude Code
 * transcript (A1, see `compactBoundaryLine` / `compactSummaryLine`).
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AuthEnv } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';

import type { IModelResolver } from './auth-env.port';
import type { IPricingProvider } from './pricing.port';
import { SessionHistoryReaderService } from './session-history-reader.service';
import { SessionStatsOwnerService } from './session-stats/session-stats-owner.service';
import { CompactionBoundaryGenerationRegistry } from './helpers/compaction-boundary-generation-registry';
import { HistoryEventFactory } from './helpers/history/history-event-factory';
import { JsonlReaderService } from './helpers/history/jsonl-reader.service';
import type { SessionReplayService } from './helpers/history/session-replay.service';
import { LiveUsageTracker } from './helpers/live-usage-tracker';

const SESSION_ID = '3c1f8a2e-5b7d-4e9a-8c6f-0d2b4a6e8f10';
const WORKSPACE = '/workspace';
const SENTINEL = 'CARRY_OVER_SENTINEL_2a1d';

let seq = 0;
function base(): Record<string, unknown> {
  seq += 1;
  return {
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: WORKSPACE,
    sessionId: SESSION_ID,
    version: '2.0.0',
    uuid: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    timestamp: '2026-11-01T10:00:00.000Z',
  };
}

function userLine(
  content: string | unknown[],
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    ...base(),
    type: 'user',
    message: { role: 'user', content },
    ...extra,
  });
}

function assistantLine(
  content: unknown[],
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    ...base(),
    type: 'assistant',
    message: { role: 'assistant', id: `msg_${seq}`, content },
    ...extra,
  });
}

function systemLine(subtype: string): string {
  return JSON.stringify({
    ...base(),
    type: 'system',
    subtype,
    content: SENTINEL,
    isMeta: false,
    level: 'info',
  });
}

/**
 * Scrubbed from a real manual `/compact` in a local Claude Code transcript
 * (`~/.claude/projects/-home-amun-ptah-extension/3cc46d4e-….jsonl`, lines
 * 626-627): the system boundary record, then the summary as a `user` record
 * with string content, `isCompactSummary: true`,
 * `isVisibleInTranscriptOnly: true` and no `isMeta`. Ids, paths, metadata
 * values and the summary text are replaced.
 */
function compactBoundaryLine(): string {
  return JSON.stringify({
    ...base(),
    logicalParentUuid: '00000000-0000-4000-8000-ffffffffffff',
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    level: 'info',
    compactMetadata: {
      trigger: 'manual',
      preTokens: 1000,
      durationMs: 100,
      postTokens: 100,
    },
    entrypoint: 'cli',
    gitBranch: 'main',
    slug: 'scrubbed',
  });
}

function compactSummaryLine(
  summary: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    ...base(),
    parentUuid: '00000000-0000-4000-8000-eeeeeeeeeeee',
    promptId: 'scrubbed-prompt',
    type: 'user',
    message: {
      role: 'user',
      content: `This session is being continued from a previous conversation that ran out of context. ${summary}`,
    },
    isVisibleInTranscriptOnly: true,
    isCompactSummary: true,
    turnPosition: { promptIndex: 1, turnIndex: 2 },
    entrypoint: 'cli',
    gitBranch: 'main',
    slug: 'scrubbed',
    ...extra,
  });
}

const text = (t: string) => [{ type: 'text', text: t }];

describe('SessionHistoryReaderService.readCarryOverTranscript', () => {
  let dir: string;
  let sessionFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-carry-over-'));
    sessionFile = path.join(dir, `${SESSION_ID}.jsonl`);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeSession(lines: readonly string[]): Promise<string> {
    const body = lines.join('\n') + '\n';
    await fs.writeFile(sessionFile, body, 'utf8');
    return body;
  }

  function makeHarness() {
    const logger = createMockLogger();
    const jsonlReader = new JsonlReaderService(logger as unknown as Logger);
    const findDir = jest
      .spyOn(jsonlReader, 'findSessionsDirectory')
      .mockResolvedValue(dir);
    const readTail = jest.spyOn(jsonlReader, 'readJsonlTail');
    const readAll = jest.spyOn(jsonlReader, 'readJsonlMessages');
    const service = new SessionHistoryReaderService(
      logger as unknown as Logger,
      jsonlReader,
      {} as SessionReplayService,
      new HistoryEventFactory(),
      {} as IModelResolver,
      {} as AuthEnv,
      {} as IPricingProvider,
      new LiveUsageTracker(),
      new CompactionBoundaryGenerationRegistry(),
      new SessionStatsOwnerService(),
    );
    return { service, logger, findDir, readTail, readAll };
  }

  it('reads only the tail bound of a session ten times larger than it (AC 3.4, 3.10)', async () => {
    const tailBytes = 4096;
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) {
      lines.push(userLine(text(`old question ${i} ${'x'.repeat(40)}`)));
      lines.push(assistantLine(text(`old answer ${i} ${'y'.repeat(40)}`)));
    }
    lines.push(userLine(text('newest question')));
    lines.push(assistantLine(text('newest answer')));
    const body = await writeSession(lines);
    expect(Buffer.byteLength(body)).toBeGreaterThanOrEqual(10 * tailBytes);

    const h = makeHarness();
    const result = await h.service.readCarryOverTranscript(
      SESSION_ID,
      WORKSPACE,
      { tailBytes },
    );

    expect(h.readTail).toHaveBeenCalledTimes(1);
    expect(h.readTail).toHaveBeenCalledWith(sessionFile, {
      maxBytes: tailBytes,
      signal: undefined,
    });
    expect(h.readAll).not.toHaveBeenCalled();
    expect(result.windowCoversWholeHistory).toBe(false);
    expect(result.startsAtCompactionSummary).toBe(false);
    expect(result.turns.slice(-2)).toEqual([
      { role: 'user', text: 'newest question', compactionSummary: false },
      { role: 'assistant', text: 'newest answer', compactionSummary: false },
    ]);
    expect(result.turns.some((t) => t.text.includes('old question 0 '))).toBe(
      false,
    );
    expect(result.turns.length).toBeLessThan(lines.length);
  });

  it('keeps every turn in order and reports a whole-history window when it fits (AC 3.1)', async () => {
    await writeSession([
      userLine(text('first question')),
      assistantLine(text('first answer')),
      userLine('second question'),
      assistantLine(text('second answer')),
    ]);
    const result = await makeHarness().service.readCarryOverTranscript(
      SESSION_ID,
      WORKSPACE,
      { tailBytes: 1024 * 1024 },
    );
    expect(result).toEqual({
      turns: [
        { role: 'user', text: 'first question', compactionSummary: false },
        { role: 'assistant', text: 'first answer', compactionSummary: false },
        { role: 'user', text: 'second question', compactionSummary: false },
        { role: 'assistant', text: 'second answer', compactionSummary: false },
      ],
      windowCoversWholeHistory: true,
      startsAtCompactionSummary: false,
    });
  });

  it('reduces a tool pair to placeholders without its input, output or error (AC 3.5)', async () => {
    await writeSession([
      userLine(text('list the files')),
      assistantLine([
        { type: 'text', text: 'Running it.' },
        {
          type: 'tool_use',
          id: 'toolu_bash',
          name: 'Bash',
          input: { command: `echo ${SENTINEL}` },
        },
      ]),
      userLine([
        {
          type: 'tool_result',
          tool_use_id: 'toolu_bash',
          content: [{ type: 'text', text: SENTINEL }],
          is_error: true,
        },
      ]),
      userLine([
        {
          type: 'tool_result',
          tool_use_id: 'toolu_outside_window',
          content: SENTINEL,
        },
      ]),
      assistantLine(text('Done.')),
    ]);
    const result = await makeHarness().service.readCarryOverTranscript(
      SESSION_ID,
      WORKSPACE,
      { tailBytes: 1024 * 1024 },
    );
    expect(result.turns).toEqual([
      { role: 'user', text: 'list the files', compactionSummary: false },
      {
        role: 'assistant',
        text: 'Running it.\n[tool: Bash]',
        compactionSummary: false,
      },
      {
        role: 'user',
        text: '[tool result: Bash]\n\n[tool result]',
        compactionSummary: false,
      },
      { role: 'assistant', text: 'Done.', compactionSummary: false },
    ]);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('leaves out thinking, system events, compact boundaries and reminders (AC 3.6)', async () => {
    await writeSession([
      systemLine('init'),
      userLine(text(`question <system-reminder>${SENTINEL}</system-reminder>`)),
      assistantLine([
        { type: 'thinking', thinking: SENTINEL, signature: 'sig' },
        { type: 'redacted_thinking', data: SENTINEL },
        { type: 'text', text: 'answer' },
      ]),
      systemLine('status'),
      compactBoundaryLine(),
      userLine(`${SENTINEL} meta`, { isMeta: true }),
      userLine(`<task-notification>${SENTINEL}</task-notification>`),
      userLine(text('follow-up')),
    ]);
    const result = await makeHarness().service.readCarryOverTranscript(
      SESSION_ID,
      WORKSPACE,
      { tailBytes: 1024 * 1024 },
    );
    expect(result.turns).toEqual([
      { role: 'user', text: 'question', compactionSummary: false },
      { role: 'assistant', text: 'answer', compactionSummary: false },
      { role: 'user', text: 'follow-up', compactionSummary: false },
    ]);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('replaces attachments with placeholders and no content (AC 3.7)', async () => {
    await writeSession([
      userLine([
        {
          type: 'text',
          text: `look at <file path="/repo/src/app.ts">${SENTINEL}</file> and <folder path="C:\\repo\\libs" />`,
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: SENTINEL },
        },
        {
          type: 'document',
          title: 'specs/plan.pdf',
          source: { type: 'base64', data: SENTINEL },
        },
      ]),
    ]);
    const result = await makeHarness().service.readCarryOverTranscript(
      SESSION_ID,
      WORKSPACE,
      { tailBytes: 1024 * 1024 },
    );
    expect(result.turns).toEqual([
      {
        role: 'user',
        text: 'look at [file: app.ts] and [file: libs]\n[image omitted]\n[file: plan.pdf]',
        compactionSummary: false,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('excludes subagent records, including a sidechain summary (AC 3.9)', async () => {
    await writeSession([
      userLine(text('main question')),
      assistantLine(text(SENTINEL), { isSidechain: true }),
      compactSummaryLine(SENTINEL, { isSidechain: true }),
      assistantLine(text('main answer')),
    ]);
    const result = await makeHarness().service.readCarryOverTranscript(
      SESSION_ID,
      WORKSPACE,
      { tailBytes: 1024 * 1024 },
    );
    expect(result.turns).toEqual([
      { role: 'user', text: 'main question', compactionSummary: false },
      { role: 'assistant', text: 'main answer', compactionSummary: false },
    ]);
    expect(result.startsAtCompactionSummary).toBe(false);
  });

  describe('compaction summary boundary (AC 3.8, A1)', () => {
    async function writeAroundSummary(): Promise<{
      body: string;
      fromSummary: number;
    }> {
      const before = [
        userLine(text('turn before the window')),
        assistantLine(text('reply before the window')),
        compactBoundaryLine(),
      ];
      const summary = compactSummaryLine('Goal: ship the feature.');
      const after = [
        userLine(text('question after compaction')),
        assistantLine(text('answer after compaction')),
      ];
      const body = await writeSession([...before, summary, ...after]);
      const fromSummary = Buffer.byteLength(
        [summary, ...after].join('\n') + '\n',
      );
      return { body, fromSummary };
    }

    it('starts at a summary just inside the window', async () => {
      const { fromSummary } = await writeAroundSummary();
      const result = await makeHarness().service.readCarryOverTranscript(
        SESSION_ID,
        WORKSPACE,
        { tailBytes: fromSummary },
      );
      expect(result.windowCoversWholeHistory).toBe(false);
      expect(result.startsAtCompactionSummary).toBe(true);
      expect(result.turns).toEqual([
        {
          role: 'user',
          text: 'This session is being continued from a previous conversation that ran out of context. Goal: ship the feature.',
          compactionSummary: true,
        },
        {
          role: 'user',
          text: 'question after compaction',
          compactionSummary: false,
        },
        {
          role: 'assistant',
          text: 'answer after compaction',
          compactionSummary: false,
        },
      ]);
    });

    it('starts at an in-window summary and drops the turns before it when the whole file fits', async () => {
      await writeAroundSummary();
      const result = await makeHarness().service.readCarryOverTranscript(
        SESSION_ID,
        WORKSPACE,
        { tailBytes: 1024 * 1024 },
      );
      expect(result.windowCoversWholeHistory).toBe(true);
      expect(result.startsAtCompactionSummary).toBe(true);
      expect(result.turns.map((t) => t.text)).not.toContain(
        'turn before the window',
      );
      expect(result.turns[0].compactionSummary).toBe(true);
    });

    it('has no boundary when the summary is just outside the window', async () => {
      const { fromSummary } = await writeAroundSummary();
      const result = await makeHarness().service.readCarryOverTranscript(
        SESSION_ID,
        WORKSPACE,
        { tailBytes: fromSummary - 1 },
      );
      expect(result.windowCoversWholeHistory).toBe(false);
      expect(result.startsAtCompactionSummary).toBe(false);
      expect(result.turns).toEqual([
        {
          role: 'user',
          text: 'question after compaction',
          compactionSummary: false,
        },
        {
          role: 'assistant',
          text: 'answer after compaction',
          compactionSummary: false,
        },
      ]);
    });

    it('keeps text turns on both sides of a compact_boundary that has no summary', async () => {
      await writeSession([
        userLine(text('before boundary')),
        assistantLine(text('reply before boundary')),
        compactBoundaryLine(),
        userLine(text('after boundary')),
        assistantLine(text('reply after boundary')),
      ]);
      const result = await makeHarness().service.readCarryOverTranscript(
        SESSION_ID,
        WORKSPACE,
        { tailBytes: 1024 * 1024 },
      );
      expect(result.startsAtCompactionSummary).toBe(false);
      expect(result.turns.map((t) => t.text)).toEqual([
        'before boundary',
        'reply before boundary',
        'after boundary',
        'reply after boundary',
      ]);
    });

    it('keeps every prose turn around a system event', async () => {
      await writeSession([
        userLine(text('q1')),
        assistantLine(text('a1')),
        systemLine('status'),
        userLine(text('q2')),
      ]);
      const result = await makeHarness().service.readCarryOverTranscript(
        SESSION_ID,
        WORKSPACE,
        { tailBytes: 1024 * 1024 },
      );
      expect(result.turns.map((t) => t.text)).toEqual(['q1', 'a1', 'q2']);
    });

    it('starts at the later of two summaries', async () => {
      await writeSession([
        compactBoundaryLine(),
        compactSummaryLine('first summary'),
        userLine(text('between summaries')),
        compactBoundaryLine(),
        compactSummaryLine('second summary'),
        userLine(text('latest question')),
      ]);
      const result = await makeHarness().service.readCarryOverTranscript(
        SESSION_ID,
        WORKSPACE,
        { tailBytes: 1024 * 1024 },
      );
      expect(result.startsAtCompactionSummary).toBe(true);
      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toContain('second summary');
      expect(result.turns[0].compactionSummary).toBe(true);
      expect(result.turns[1]).toEqual({
        role: 'user',
        text: 'latest question',
        compactionSummary: false,
      });
    });

    it('keeps a summary marked isMeta and never merges it into the next user turn', async () => {
      await writeSession([
        userLine(text('old')),
        compactSummaryLine('meta summary', { isMeta: true }),
        userLine(text('next user turn')),
      ]);
      const result = await makeHarness().service.readCarryOverTranscript(
        SESSION_ID,
        WORKSPACE,
        { tailBytes: 1024 * 1024 },
      );
      expect(result.startsAtCompactionSummary).toBe(true);
      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].compactionSummary).toBe(true);
      expect(result.turns[1].text).toBe('next user turn');
    });
  });

  it('merges consecutive same-role records and drops empty turns', async () => {
    await writeSession([
      userLine(text('part one')),
      assistantLine([{ type: 'thinking', thinking: SENTINEL }]),
      userLine(text('part two')),
      assistantLine(text('reply')),
    ]);
    const result = await makeHarness().service.readCarryOverTranscript(
      SESSION_ID,
      WORKSPACE,
      { tailBytes: 1024 * 1024 },
    );
    expect(result.turns).toEqual([
      { role: 'user', text: 'part one\n\npart two', compactionSummary: false },
      { role: 'assistant', text: 'reply', compactionSummary: false },
    ]);
  });

  it('logs no transcript content', async () => {
    await writeSession([
      userLine(text(`question ${SENTINEL}`)),
      assistantLine(text(`answer ${SENTINEL}`)),
    ]);
    const h = makeHarness();
    const result = await h.service.readCarryOverTranscript(
      SESSION_ID,
      WORKSPACE,
      { tailBytes: 1024 * 1024 },
    );
    expect(result.turns).toHaveLength(2);
    const logged = JSON.stringify([
      h.logger.debug.mock.calls,
      h.logger.info.mock.calls,
      h.logger.warn.mock.calls,
      h.logger.error.mock.calls,
    ]);
    expect(logged).not.toContain(SENTINEL);
  });

  describe('failures throw instead of returning an empty transcript', () => {
    it('rejects an invalid id before any read (AC 2.6)', async () => {
      const h = makeHarness();
      await expect(
        h.service.readCarryOverTranscript('../etc/passwd', WORKSPACE, {
          tailBytes: 1024,
        }),
      ).rejects.toThrow('Invalid sessionId format');
      expect(h.findDir).not.toHaveBeenCalled();
      expect(h.readTail).not.toHaveBeenCalled();
      expect(h.readAll).not.toHaveBeenCalled();
    });

    it('rejects a non-positive bound before any read', async () => {
      const h = makeHarness();
      await expect(
        h.service.readCarryOverTranscript(SESSION_ID, WORKSPACE, {
          tailBytes: 0,
        }),
      ).rejects.toThrow('positive byte count');
      expect(h.readTail).not.toHaveBeenCalled();
    });

    it('rejects when the sessions directory is missing', async () => {
      const h = makeHarness();
      h.findDir.mockResolvedValue(null);
      await expect(
        h.service.readCarryOverTranscript(SESSION_ID, WORKSPACE, {
          tailBytes: 1024,
        }),
      ).rejects.toThrow('Sessions directory not found');
      expect(h.readTail).not.toHaveBeenCalled();
    });

    it('rejects when the session file is missing', async () => {
      const h = makeHarness();
      await expect(
        h.service.readCarryOverTranscript(SESSION_ID, WORKSPACE, {
          tailBytes: 1024,
        }),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects an aborted read', async () => {
      await writeSession([userLine(text('question'))]);
      const h = makeHarness();
      const controller = new AbortController();
      controller.abort();
      await expect(
        h.service.readCarryOverTranscript(SESSION_ID, WORKSPACE, {
          tailBytes: 1024,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(h.readTail).not.toHaveBeenCalled();
    });
  });
});
