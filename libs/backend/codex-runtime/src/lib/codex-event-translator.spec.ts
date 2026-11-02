import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { CodexEventTranslator, MAX_TOOL_OUTPUT_CHARS } from './codex-event-translator';
import type { CodexUsageEvidence } from './codex-runtime.types';
import {
  codexNotificationSchemas,
  validateCodexFrame,
} from './codex-protocol-validator';
const pinnedNotificationMethods = z
  .object({ methods: z.object({ serverNotifications: z.array(z.string()) }) })
  .parse(
    JSON.parse(
      readFileSync(
        resolve(__dirname, 'protocol/codex-app-server-protocol.manifest.json'),
        'utf8',
      ),
    ),
  ).methods.serverNotifications;

describe('ignored pinned notifications', () => {
  it.each([
    'account/rateLimits/updated',
    'serverRequest/resolved',
    'thread/status/changed',
    'thread/started',
    'turn/moderationMetadata',
    'mcpServer/startupStatus/updated',
    'remoteControl/status/changed',
    ...pinnedNotificationMethods.filter(
      (method) => !Object.hasOwn(codexNotificationSchemas, method),
    ),
  ])('ignores %s without changing event sequence or usage', (method) => {
    const translator = new CodexEventTranslator('context', 1);
    expect(
      translator.translate({
        method,
        params: { threadId: 'thread', turnId: 'turn' },
      }),
    ).toEqual([]);
    expect(translator.translate({ method, params: null })).toEqual([]);
    const events = translator.translate(terminal());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'terminal', sequence: 1 });
    expect(events[0]).not.toHaveProperty('usage');
  });

  it('keeps the unknown-method boundary and existing translator fallback', () => {
    const frame = {
      method: 'future/notification',
      params: { threadId: 'thread', turnId: 'turn' },
    };
    expect(() => validateCodexFrame(frame)).toThrow(
      expect.objectContaining({ code: 'unknownMethod' }),
    );
    expect(
      new CodexEventTranslator('context', 1).translate(frame),
    ).toMatchObject([
      { type: 'error', error: { code: 'unsupportedNotification' } },
    ]);
  });
});

const ids = { threadId: 'thread', turnId: 'turn' };
const counts = {
  inputTokens: 7,
  cachedInputTokens: 0,
  outputTokens: 3,
  reasoningOutputTokens: 1,
  totalTokens: 10,
};
function itemFrame(item: object, completed = false) {
  return {
    method: completed ? 'item/completed' : 'item/started',
    params: {
      ...ids,
      item,
      ...(completed ? { completedAtMs: 2 } : { startedAtMs: 1 }),
    },
  };
}
function terminal(status = 'completed', extra: object = {}) {
  return {
    method: 'turn/completed',
    params: {
      threadId: ids.threadId,
      turn: { id: ids.turnId, items: [], status, ...extra },
    },
  };
}
const command = {
  type: 'commandExecution',
  id: 'command-1',
  command: 'echo test',
  cwd: '/work',
  commandActions: [],
  status: 'inProgress',
};
const mcp = {
  type: 'mcpToolCall',
  id: 'mcp-1',
  server: 'ptah',
  tool: 'test',
  arguments: {},
  status: 'inProgress',
};

describe('CodexEventTranslator', () => {
  let translator: CodexEventTranslator;
  beforeEach(() => {
    translator = new CodexEventTranslator('context', 4);
  });

  it('maps a completed async question to user input and ignores sleep', () => {
    const item = {
      type: 'agentMessage', id: 'question', text: 'Choose one',
      delivery: 'async', questions: [{ title: 'Which?', options: ['A', 'B'] }],
    };
    expect(translator.translate(itemFrame(item))).toEqual([]);
    expect(translator.translate({
      method: 'item/agentMessage/delta',
      params: { ...ids, itemId: 'question', delta: 'Choose' },
    })).toEqual([]);
    expect(translator.translate(itemFrame(item, true))).toMatchObject([{
      type: 'userInputAsync', itemId: 'question', text: 'Choose one',
      questions: [{ title: 'Which?', options: ['A', 'B'] }],
    }]);
    expect(translator.translate(itemFrame({ type: 'sleep', id: 'nap', durationMs: 1000 }))).toEqual([]);
    expect(translator.translate(itemFrame({ type: 'sleep', id: 'nap', durationMs: 1000 }, true))).toEqual([]);
    expect(translator.translate(itemFrame({ type: 'agentMessage', id: 'final', text: 'Done', phase: 'final_answer' }, true)))
      .toMatchObject([{ type: 'textFinal', text: 'Done' }]);
  });

  it('marks an async completion for text presentation when started omitted delivery and deltas were visible', () => {
    const started = { type: 'agentMessage', id: 'late-async', text: '' };
    expect(translator.translate(itemFrame(started))).toEqual([]);
    expect(translator.translate({ method: 'item/agentMessage/delta',
      params: { ...ids, itemId: 'late-async', delta: 'Choose' },
    })).toMatchObject([{ type: 'textDelta', delta: 'Choose' }]);
    expect(translator.translate(itemFrame({ ...started, text: 'Choose one',
      delivery: 'async', questions: [{ title: 'Which?' }],
    }, true))).toMatchObject([{ type: 'userInputAsync', presentation: 'text' }]);
  });

  it('preserves text order, final-only text, identity and monotonic sequence', () => {
    const events = [
      translator.translate({
        method: 'item/agentMessage/delta',
        params: { ...ids, itemId: 'text', delta: 'Hi' },
      }),
      translator.translate(
        itemFrame({ type: 'agentMessage', id: 'text', text: 'Hi!' }, true),
      ),
      translator.translate(
        itemFrame(
          { type: 'agentMessage', id: 'final-only', text: 'Final only' },
          true,
        ),
      ),
      translator.translate(terminal()),
    ].flat();
    expect(events.map((e) => e.type)).toEqual([
      'textDelta',
      'textFinal',
      'textFinal',
      'terminal',
    ]);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    for (const event of events)
      expect(event).toMatchObject({
        ...ids,
        contextId: 'context',
        processGeneration: 4,
      });
    expect(events[2]).toMatchObject({ text: 'Final only' });
    expect(events[3]).not.toHaveProperty('usage');
  });

  it('does not claim command execution before approval or on decline', () => {
    expect(translator.translate(itemFrame(command))).toMatchObject([
      { type: 'toolStarted', toolId: 'command-1' },
    ]);
    expect(
      translator.translate({
        method: 'serverRequest/resolved',
        params: { ...ids, requestId: 1 },
      }),
    ).toEqual([]);
    expect(
      translator.translate(itemFrame({ ...command, status: 'declined' }, true)),
    ).toMatchObject([
      { type: 'toolCompleted', toolId: 'command-1', status: 'cancelled' },
    ]);
  });

  it('preserves MCP ids and successful output', () => {
    const result = { content: [{ type: 'text', text: 'done' }] };
    expect(translator.translate(itemFrame(mcp))).toMatchObject([
      {
        type: 'toolStarted',
        toolId: 'mcp-1',
        toolName: 'ptah/test',
        input: {},
      },
    ]);
    expect(
      translator.translate(
        itemFrame({ ...mcp, status: 'completed', result }, true),
      ),
    ).toMatchObject([
      {
        type: 'toolCompleted',
        toolId: 'mcp-1',
        output: result,
        status: 'completed',
      },
    ]);
  });

  it('derives the first baseline, preserves reported zero, and never fabricates cost', () => {
    const events = translator.translate({
      method: 'thread/tokenUsage/updated',
      params: {
        ...ids,
        tokenUsage: { last: counts, total: { ...counts, totalTokens: 100 } },
      },
    });
    expect(events[0]).toMatchObject({ type: 'usage', usage: counts });
    expect(events[0]).not.toHaveProperty('usage.costUsd');
    expect(translator.translate(terminal())[0]).toMatchObject({
      usage: counts,
    });
    expect(
      translator.translate({
        method: 'turn/completed',
        params: {
          threadId: 'thread',
          turn: { id: 'next', items: [], status: 'completed' },
        },
      })[0],
    ).not.toHaveProperty('usage');
  });

  it.each([false, true])(
    'counts every request with cached input (prior total: %s)',
    (priorTotal) => {
      const previous = {
        inputTokens: 100,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 6,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 120,
      };
      const first = {
        inputTokens: 110,
        cachedInputTokens: 44,
        cacheWriteInputTokens: 8,
        outputTokens: 23,
        reasoningOutputTokens: 6,
        totalTokens: 133,
      };
      const last = {
        inputTokens: 10,
        cachedInputTokens: 4,
        cacheWriteInputTokens: 2,
        outputTokens: 3,
        reasoningOutputTokens: 1,
        totalTokens: 13,
      };
      if (priorTotal) {
        translator.translate({
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread',
            turnId: 'previous',
            tokenUsage: { last: previous, total: previous },
          },
        });
        translator.translate({
          method: 'turn/completed',
          params: {
            threadId: 'thread',
            turn: { id: 'previous', items: [], status: 'completed' },
          },
        });
      }
      translator.translate({
        method: 'turn/started',
        params: {
          threadId: 'thread',
          turn: { id: 'turn', items: [], status: 'inProgress' },
        },
      });
      expect(
        translator.translate({
          method: 'thread/tokenUsage/updated',
          params: {
            ...ids,
            tokenUsage: { last, total: first },
          },
        }),
      ).toMatchObject([
        {
          type: 'usage',
          usage: { totalTokens: 13, lastRequestTotalTokens: 13 },
        },
      ]);
      const latest = {
        inputTokens: 125,
        cachedInputTokens: 50,
        cacheWriteInputTokens: 9,
        outputTokens: 28,
        reasoningOutputTokens: 8,
        totalTokens: 153,
      };
      const second = {
        inputTokens: 15,
        cachedInputTokens: 6,
        cacheWriteInputTokens: 1,
        outputTokens: 5,
        reasoningOutputTokens: 2,
        totalTokens: 20,
      };
      const update = {
        method: 'thread/tokenUsage/updated',
        params: { ...ids, tokenUsage: { last: second, total: latest } },
      };
      expect(translator.translate(update)).toMatchObject([
        {
          type: 'usage',
          usage: { totalTokens: 33, lastRequestTotalTokens: 20 },
        },
      ]);
      translator.translate(update); // Repeated snapshots must not double count.
      expect(translator.translate(terminal())[0]).toMatchObject({
        usage: {
          inputTokens: 25,
          cachedInputTokens: 10,
          cacheWriteInputTokens: 3,
          outputTokens: 8,
          reasoningOutputTokens: 3,
          totalTokens: 33,
          lastRequestTotalTokens: 20,
        },
      });
    },
  );

  it('emits typed absolute evidence for two requests and a repeated cumulative update', () => {
    const clocked = new CodexEventTranslator('context', 4, () => 1_234);
    const first = clocked.translate({
      method: 'thread/tokenUsage/updated',
      params: { ...ids, model: 'codex-model', tokenUsage: { last: counts, total: counts } },
    });
    const firstEvidence: CodexUsageEvidence | undefined = first[0]?.type === 'usage'
      ? first[0].evidence : undefined;
    expect(firstEvidence).toMatchObject({
      threadId: 'thread', turnId: 'turn', modelId: 'codex-model',
      total: { uncachedInputTokens: 7, outputTokens: 3, cacheReadTokens: 0,
        cacheCreationTokens: 0, reasoningOutputTokens: 1, totalTokens: 10 },
      last: { totalTokens: 10 }, terminalState: 'none', resetOrStale: false,
    });
    expect(firstEvidence?.timestamp).toBe(1_234);
    const next = {
      inputTokens: 19, cachedInputTokens: 4, cacheWriteInputTokens: 2,
      outputTokens: 8, reasoningOutputTokens: 3, totalTokens: 27,
    };
    const last = {
      inputTokens: 12, cachedInputTokens: 4, cacheWriteInputTokens: 2,
      outputTokens: 5, reasoningOutputTokens: 2, totalTokens: 17,
    };
    const update = { method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last, total: next } } };
    expect(clocked.translate(update)).toMatchObject([{
      type: 'usage', usage: { totalTokens: 27 },
      evidence: { total: { uncachedInputTokens: 13, cacheReadTokens: 4,
        cacheCreationTokens: 2, outputTokens: 8, totalTokens: 27 } },
    }]);
    expect(clocked.translate(update)).toMatchObject([{
      type: 'usage', usage: { totalTokens: 27 },
      evidence: { resetOrStale: false, total: { totalTokens: 27 } },
    }]);
    expect(clocked.translate(terminal())).toMatchObject([{
      type: 'terminal', usage: { totalTokens: 27 },
      evidence: { terminalState: 'completed', total: { totalTokens: 27 } },
    }]);
  });

  it('marks decreasing and inconsistent equal totals as stale without negative usage', () => {
    translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: counts, total: counts } } });
    const stale = translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: { ...counts, inputTokens: 6,
        totalTokens: 9 }, total: { ...counts, inputTokens: 6, totalTokens: 9 } } } });
    expect(stale).toMatchObject([{
      type: 'usage', usage: { totalTokens: 10 },
      evidence: { resetOrStale: true, total: { totalTokens: 9 } },
    }]);
    const inconsistent = translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: counts,
        total: { ...counts, inputTokens: 8 } } } });
    expect(inconsistent).toMatchObject([{
      evidence: { resetOrStale: true }, usage: { totalTokens: 10 },
    }]);
    expect(translator.translate(terminal())).toMatchObject([{
      usage: { totalTokens: 10 }, evidence: { total: { totalTokens: 10 } },
    }]);
  });

  it('reports malformed native usage without advancing counters', () => {
    expect(translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: counts,
        total: { ...counts, inputTokens: -1 } } } })).toMatchObject([{
      type: 'error', error: { code: 'usageNotificationInvalid' },
      diagnostic: 'invalid-payload',
    }]);
    expect(translator.translate(terminal())[0]).not.toHaveProperty('usage');
  });

  it('retains cache-write-heavy counters with a content-free ambiguity diagnostic', () => {
    const heavy = { inputTokens: 3, cachedInputTokens: 4,
      cacheWriteInputTokens: 8, outputTokens: 2,
      reasoningOutputTokens: 1, totalTokens: 5 };
    expect(translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: heavy, total: heavy } } })).toMatchObject([{
      type: 'usage', usage: { totalTokens: 5 },
      evidence: { accepted: true, cacheSemanticsAmbiguous: true,
        total: { uncachedInputTokens: 0, cacheReadTokens: 4,
          cacheCreationTokens: 8 },
        diagnostics: ['cache-semantics-ambiguous', 'classes-inconsistent'] },
    }]);
  });

  it('retains a last request larger than total and marks partial evidence', () => {
    const total = { ...counts, inputTokens: 2, outputTokens: 1,
      reasoningOutputTokens: 0, totalTokens: 3 };
    expect(translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: counts, total } } })).toMatchObject([{
      type: 'usage', usage: { totalTokens: 3 },
      evidence: { accepted: true, lastExceedsTotal: true,
        diagnostics: ['last-exceeds-total'] },
    }]);
  });

  it('emits empty turn usage and a diagnostic for stale evidence without a snapshot', () => {
    translator.translate({ method: 'thread/tokenUsage/updated',
      params: { threadId: 'thread', turnId: 'previous',
        tokenUsage: { last: counts, total: counts } } });
    const lower = { ...counts, inputTokens: 6, totalTokens: 9 };
    expect(translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: lower, total: lower } } })).toMatchObject([{
      type: 'usage', usage: {}, evidence: { accepted: false, resetOrStale: true,
        diagnostics: ['stale-cumulative'] },
    }]);
  });

  it('rebases only on explicit reset proof and accepts later epoch updates', () => {
    translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: counts, total: counts } } });
    const low = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1,
      reasoningOutputTokens: 0, totalTokens: 2 };
    const update = (total: typeof low, counterReset?: true) => ({
      method: 'thread/tokenUsage/updated', params: { ...ids,
        tokenUsage: { last: total, total, counterReset } },
    });
    expect(translator.translate(update(low))).toMatchObject([{
      usage: { totalTokens: 10 }, evidence: { accepted: false, epoch: 0,
        diagnostics: ['stale-cumulative'] },
    }]);
    expect(translator.translate(update(low, true))).toMatchObject([{
      usage: { totalTokens: 12 }, evidence: { accepted: true, epoch: 1,
        resetOrStale: true, diagnostics: ['counter-reset'] },
    }]);
    const higher = { ...low, inputTokens: 3, outputTokens: 2, totalTokens: 5 };
    expect(translator.translate(update(higher))).toMatchObject([{
      usage: { totalTokens: 15 }, evidence: { accepted: true, epoch: 1,
        resetOrStale: false },
    }]);
  });

  it('emits late native usage with the failed terminal state', () => {
    translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: counts, total: counts } } });
    translator.translate(terminal('failed'));
    const later = { ...counts, inputTokens: 11, outputTokens: 4,
      totalTokens: 15 };
    expect(translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: later, total: later } } })).toMatchObject([{
      type: 'usage', usage: { totalTokens: 15 },
      evidence: { accepted: true, terminalState: 'failed',
        total: { totalTokens: 15 } },
    }]);
  });

  it.each(['failed', 'interrupted'] as const)(
    'retains observed evidence and usage on a %s terminal', (status) => {
      translator.translate({ method: 'thread/tokenUsage/updated',
        params: { ...ids, tokenUsage: { last: counts, total: counts } } });
      expect(translator.translate(terminal(status))).toMatchObject([{
        type: 'terminal', status, usage: { totalTokens: 10 },
        evidence: { terminalState: status, total: { totalTokens: 10 } },
      }]);
    },
  );

  it('keeps compaction and child thread evidence separate from the parent', () => {
    translator.translate({ method: 'thread/tokenUsage/updated',
      params: { ...ids, tokenUsage: { last: counts, total: counts } } });
    translator.translate(itemFrame({ type: 'contextCompaction', id: 'compact' }, true));
    const child = translator.translate({ method: 'thread/tokenUsage/updated',
      params: { threadId: 'child', turnId: 'child-turn', parentThreadId: 'thread',
        tokenUsage: { last: counts, total: counts } } });
    expect(child).toMatchObject([{
      threadId: 'child', turnId: 'child-turn',
      evidence: { threadId: 'child', turnId: 'child-turn', parentThreadId: 'thread',
        total: { totalTokens: 10 } },
    }]);
    expect(translator.translate(terminal())).toMatchObject([{
      threadId: 'thread', evidence: { total: { totalTokens: 10 } },
    }]);
  });

  it('defaults omitted cache writes to zero on the first turn', () => {
    translator.translate({
      method: 'thread/tokenUsage/updated',
      params: {
        ...ids,
        tokenUsage: { last: counts, total: counts },
      },
    });
    expect(translator.translate(terminal())[0]).toMatchObject({
      usage: { ...counts, cacheWriteInputTokens: 0 },
    });
  });

  it('carries only a positive server-reported context window', () => {
    const reported = {
      ...counts,
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
    };
    const update = (modelContextWindow?: number | null) => ({
      method: 'thread/tokenUsage/updated',
      params: {
        ...ids,
        tokenUsage: { last: counts, total: reported, modelContextWindow },
      },
    });
    for (const absent of [null, undefined, 0])
      expect(
        translator.translate(update(absent))[0],
      ).not.toHaveProperty('usage.modelContextWindow');
    expect(translator.translate(update(272_000))).toMatchObject([
      { type: 'usage', usage: { modelContextWindow: 272_000 } },
    ]);
    // The terminal reuses the turn's latest snapshot, window included.
    expect(translator.translate(terminal())[0]).toMatchObject({
      usage: { modelContextWindow: 272_000 },
    });
  });

  it.each(['completed', 'failed', 'interrupted'])(
    'emits exactly one %s terminal and ignores late non-usage events',
    (status) => {
      expect(translator.translate(terminal(status))).toMatchObject([
        { type: 'terminal', status },
      ]);
      expect(translator.translate(terminal(status))).toEqual([]);
      expect(translator.translate(itemFrame(command))).toEqual([]);
      expect(
        translator.translate({
          method: 'thread/tokenUsage/updated',
          params: { ...ids, tokenUsage: { last: counts, total: counts } },
        }),
      ).toMatchObject([{ type: 'usage', evidence: { terminalState: status } }]);
    },
  );

  it('isolates terminal deduplication by thread and releases state on dispose', () => {
    translator.translate(terminal());
    expect(
      translator.translate({
        method: 'turn/completed',
        params: {
          threadId: 'other',
          turn: { id: 'turn', items: [], status: 'completed' },
        },
      }),
    ).toHaveLength(1);
    translator.dispose();
    expect(translator.translate(itemFrame(mcp))).toEqual([]);
  });

  it('sanitizes retry and terminal errors without ending retries early', () => {
    const secret =
      'C:\\Users\\private\\.codex /home/private token=sk-private password=hunter2';
    const retry = translator.translate({
      method: 'error',
      params: {
        ...ids,
        error: { message: secret, additionalDetails: secret },
        willRetry: true,
      },
    });
    expect(retry).toMatchObject([
      { type: 'error', error: { retryable: true } },
    ]);
    const events = [
      ...retry,
      ...translator.translate(
        terminal('failed', {
          error: { message: secret, codexErrorInfo: secret },
        }),
      ),
    ];
    expect(events.filter((e) => e.type === 'terminal')).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(
      /private|hunter2|Users|\/home|sk-/,
    );
  });

  it('forwards real command and MCP failure detail instead of invented text', () => {
    const events = [
      ...translator.translate(
        itemFrame(
          {
            ...command,
            status: 'failed',
            aggregatedOutput: 'access denied',
            exitCode: 1,
          },
          true,
        ),
      ),
      ...translator.translate(
        itemFrame(
          { ...mcp, status: 'failed', error: { message: 'upstream failed' } },
          true,
        ),
      ),
    ];
    expect(events).toMatchObject([
      {
        type: 'toolCompleted',
        toolId: 'command-1',
        status: 'failed',
        output: 'access denied',
        exitCode: 1,
      },
      {
        type: 'toolCompleted',
        toolId: 'mcp-1',
        status: 'failed',
        output: null,
        errorText: 'upstream failed',
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/could not complete/);
  });

  it('passes a failed command with empty output as exit code only', () => {
    const reported = translator.translate(
      itemFrame(
        { ...command, status: 'failed', aggregatedOutput: null, exitCode: 0 },
        true,
      ),
    );
    expect(reported).toMatchObject([
      { type: 'toolCompleted', status: 'failed', output: null, exitCode: 0 },
    ]);
    const unreported = translator.translate(
      itemFrame(
        { ...command, status: 'failed', aggregatedOutput: '', exitCode: null },
        true,
      ),
    );
    expect(unreported).toMatchObject([
      { type: 'toolCompleted', status: 'failed', output: '' },
    ]);
    expect(unreported[0]).not.toHaveProperty('exitCode');
  });

  it('bounds forwarded tool output and marks the cut', () => {
    const long = `${'x'.repeat(MAX_TOOL_OUTPUT_CHARS)}y`;
    const bounded = `${'x'.repeat(MAX_TOOL_OUTPUT_CHARS)}\n[output truncated]`;
    const [commanded] = translator.translate(
      itemFrame(
        {
          ...command,
          status: 'completed',
          aggregatedOutput: long,
          exitCode: 0,
        },
        true,
      ),
    );
    expect(commanded).toMatchObject({
      type: 'toolCompleted',
      status: 'completed',
      exitCode: 0,
      output: bounded,
    });
    const [mcpResult] = translator.translate(
      itemFrame(
        {
          ...mcp,
          status: 'completed',
          result: { content: [{ type: 'text', text: long }] },
        },
        true,
      ),
    );
    expect(mcpResult).toMatchObject({
      output: { content: [{ type: 'text', text: bounded }] },
    });
  });

  it('reports a declined command as cancelled with no invented text', () => {
    const [event] = translator.translate(
      itemFrame({ ...command, status: 'declined' }, true),
    );
    expect(event).toMatchObject({
      type: 'toolCompleted',
      toolId: 'command-1',
      status: 'cancelled',
      output: null,
    });
    expect(event).not.toHaveProperty('exitCode');
    expect(JSON.stringify([event])).not.toMatch(/could not complete/);
  });

  it('maps interrupted to cancelled and keeps failed distinct', () => {
    const collab = {
      type: 'collabAgentToolCall',
      id: 'a',
      senderThreadId: 'sender',
      receiverThreadIds: ['child'],
      tool: 'wait',
      agentsStates: {},
    };
    expect(
      translator.translate(
        itemFrame({ ...collab, status: 'interrupted' }, true),
      ),
    ).toMatchObject([{ type: 'toolCompleted', status: 'cancelled' }]);
    expect(
      translator.translate(itemFrame({ ...collab, status: 'failed' }, true)),
    ).toMatchObject([{ type: 'toolCompleted', status: 'failed' }]);
    expect(
      translator.translate(
        itemFrame({ ...command, status: 'failed', exitCode: 2 }, true),
      ),
    ).toMatchObject([{ type: 'toolCompleted', status: 'failed', exitCode: 2 }]);
  });

  it('passes MCP failure result content with the error text and drops _meta', () => {
    const result = {
      content: [{ type: 'text', text: 'partial' }],
      structuredContent: { ok: false },
    };
    const [failed] = translator.translate(
      itemFrame(
        {
          ...mcp,
          status: 'failed',
          error: { message: 'upstream failed' },
          result,
        },
        true,
      ),
    );
    expect(failed).toMatchObject({
      type: 'toolCompleted',
      status: 'failed',
      output: result,
      errorText: 'upstream failed',
    });
    const [dropped] = translator.translate(
      itemFrame(
        { ...mcp, status: 'completed', result: { ...result, _meta: { z: 1 } } },
        true,
      ),
    );
    expect(dropped).toMatchObject({ output: result });
    expect(JSON.stringify(dropped)).not.toMatch(/"z"/);
  });

  it('passes a failed dynamic tool its own content items', () => {
    const [event] = translator.translate(
      itemFrame(
        {
          type: 'dynamicToolCall',
          id: 'd',
          tool: 'dyn',
          arguments: {},
          status: 'failed',
          success: false,
          contentItems: [{ type: 'inputText', text: 'partial work' }],
        },
        true,
      ),
    );
    expect(event).toMatchObject({
      type: 'toolCompleted',
      status: 'failed',
      output: [{ type: 'inputText', text: 'partial work' }],
    });
    expect(JSON.stringify([event])).not.toMatch(/could not complete/);
  });

  it('streams reasoning summary deltas and keeps the final text authoritative', () => {
    const events = [
      ...translator.translate({
        method: 'item/reasoning/summaryTextDelta',
        params: { ...ids, itemId: 'r', summaryIndex: 0, delta: 'thinking ' },
      }),
      ...translator.translate({
        method: 'item/reasoning/summaryTextDelta',
        params: { ...ids, itemId: 'r', summaryIndex: 0, delta: 'about A' },
      }),
      ...translator.translate(
        itemFrame(
          { type: 'reasoning', id: 'r', summary: ['final text'] },
          true,
        ),
      ),
    ];
    expect(events.map((e) => e.type)).toEqual([
      'reasoning',
      'reasoning',
      'reasoning',
    ]);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(events[0]).toMatchObject({ phase: 'delta', text: 'thinking ' });
    expect(events[1]).toMatchObject({ phase: 'delta', text: 'about A' });
    expect(events[2]).toMatchObject({ phase: 'final', text: 'final text' });
  });

  it('streams raw reasoning text only until a summary delta arrives', () => {
    expect(
      translator.translate({
        method: 'item/reasoning/textDelta',
        params: {
          ...ids,
          itemId: 'raw',
          contentIndex: 0,
          delta: 'raw thought',
        },
      }),
    ).toMatchObject([
      { type: 'reasoning', phase: 'delta', text: 'raw thought' },
    ]);
    expect(
      translator.translate({
        method: 'item/reasoning/summaryTextDelta',
        params: { ...ids, itemId: 'raw', summaryIndex: 0, delta: 'summary' },
      }),
    ).toMatchObject([{ type: 'reasoning', phase: 'delta', text: 'summary' }]);
    expect(
      translator.translate({
        method: 'item/reasoning/textDelta',
        params: { ...ids, itemId: 'raw', contentIndex: 1, delta: 'more raw' },
      }),
    ).toEqual([]);
  });

  it('emits no delta events for empty reasoning and still completes the item', () => {
    expect(
      translator.translate({
        method: 'item/reasoning/summaryTextDelta',
        params: { ...ids, itemId: 'r', summaryIndex: 0, delta: '' },
      }),
    ).toEqual([]);
    // An empty summary delta does not claim the item; raw text still streams.
    expect(
      translator.translate({
        method: 'item/reasoning/textDelta',
        params: { ...ids, itemId: 'r', contentIndex: 0, delta: 'raw' },
      }),
    ).toMatchObject([{ type: 'reasoning', phase: 'delta', text: 'raw' }]);
    expect(
      translator.translate({
        method: 'item/reasoning/textDelta',
        params: { ...ids, itemId: 'r', contentIndex: 1, delta: '' },
      }),
    ).toEqual([]);
    expect(
      translator.translate(
        itemFrame({ type: 'reasoning', id: 'r', summary: [] }, true),
      ),
    ).toMatchObject([{ type: 'reasoning', phase: 'final', text: '' }]);
  });

  it('rejects malformed reasoning deltas through the notification boundary', () => {
    expect(
      translator.translate({
        method: 'item/reasoning/summaryTextDelta',
        params: { ...ids, itemId: 'r', delta: 'missing summaryIndex' },
      }),
    ).toMatchObject([
      { type: 'error', error: { code: 'unsupportedNotification' } },
    ]);
    expect(
      translator.translate({
        method: 'item/reasoning/textDelta',
        params: { threadId: 'thread', turnId: 'turn' },
      }),
    ).toMatchObject([
      { type: 'error', error: { code: 'unsupportedNotification' } },
    ]);
  });

  it('surfaces unknown and unrepresentable items without echoing payloads or throwing', () => {
    for (const item of [
      { type: '/home/secret', id: 'future', token: 'sk-secret' },
      { type: 'imageView', id: 'image', path: '/home/secret' },
    ]) {
      const events = translator.translate(itemFrame(item));
      expect(events).toMatchObject([
        { type: 'error', error: { code: 'unsupportedItem' } },
      ]);
      expect(JSON.stringify(events)).not.toMatch(/secret|token/);
    }
  });

  it('handles malformed notifications safely and does not fabricate usage or a terminal', () => {
    expect(
      translator.translate({
        method: 'thread/tokenUsage/updated',
        params: { ...ids, tokenUsage: { last: { inputTokens: 1 }, total: {} } },
      }),
    ).toMatchObject([{ type: 'error' }]);
    expect(translator.translate(terminal('inProgress'))).toMatchObject([
      { type: 'error' },
    ]);
    expect(
      translator.translate({ method: 'item/started', params: null }),
    ).toEqual([]);
    expect(translator.translate(terminal())[0]).not.toHaveProperty('usage');
  });

  it('maps reasoning, plan, compaction and successful file changes', () => {
    expect(
      translator.translate(
        itemFrame(
          { type: 'reasoning', id: 'r', summary: ['one', 'two'] },
          true,
        ),
      ),
    ).toMatchObject([{ type: 'reasoning', phase: 'final', text: 'one\ntwo' }]);
    expect(
      translator.translate(
        itemFrame({ type: 'plan', id: 'p', text: 'plan' }, true),
      ),
    ).toMatchObject([{ type: 'reasoning', text: 'plan' }]);
    for (const completed of [false, true])
      expect(
        translator.translate(
          itemFrame({ type: 'contextCompaction', id: 'c' }, completed),
        ),
      ).toMatchObject([
        { type: 'compaction', phase: completed ? 'completed' : 'started' },
      ]);
    const file = {
      type: 'fileChange',
      id: 'f',
      status: 'completed',
      changes: [{ path: 'file.ts', diff: '+test', kind: { type: 'add' } }],
    };
    expect(translator.translate(itemFrame(file))).toMatchObject([
      { type: 'toolStarted', toolId: 'f' },
    ]);
    expect(translator.translate(itemFrame(file, true))).toMatchObject([
      { type: 'toolCompleted', toolId: 'f' },
      { type: 'file', operation: 'add', path: 'file.ts', diff: '+test' },
    ]);
    expect(
      translator.translate(itemFrame({ ...file, status: 'declined' }, true)),
    ).toMatchObject([{ type: 'toolCompleted', status: 'cancelled' }]);
  });

  it.each([
    {
      type: 'dynamicToolCall',
      id: 'd',
      tool: 'dynamic',
      arguments: {},
      status: 'completed',
      success: true,
      contentItems: [],
    },
    {
      type: 'collabAgentToolCall',
      id: 'a',
      tool: 'spawnAgent',
      senderThreadId: 'sender',
      receiverThreadIds: ['child'],
      status: 'completed',
      agentsStates: {},
    },
    { type: 'webSearch', id: 'w', query: 'test', results: [] },
  ])('maps $type through the existing tool lifecycle union', (item) => {
    expect(translator.translate(itemFrame(item))).toMatchObject([
      { type: 'toolStarted', toolId: item.id },
    ]);
    expect(translator.translate(itemFrame(item, true))).toMatchObject([
      { type: 'toolCompleted', toolId: item.id, status: 'completed' },
    ]);
  });
});

// Recorded evidence supplies ORDER AND ITEM TYPES ONLY. Payloads below are synthetic;
// sanitized transcripts deliberately omit real text, tool arguments, ids and usage counts.
const transcript = z.array(
  z.array(
    z.strictObject({
      method: z.string(),
      itemType: z.string().optional(),
    }),
  ),
);
describe.each(['6h', '6i', '6j'])(
  'recorded evidence order: spike-run-%s',
  (run) => {
    it('replays recorded notification order with explicitly synthetic payloads', () => {
      const data = transcript.parse(
        JSON.parse(
          readFileSync(
            resolve(__dirname, '__fixtures__', `spike-run-${run}.json`),
            'utf8',
          ),
        ),
      );
      let terminalCount = 0;
      for (const recorded of data) {
        const translator = new CodexEventTranslator('replay', 1);
        let nextId = 0;
        let currentId = '';
        const toolIds: string[] = [];
        for (const event of recorded) {
          let events: ReturnType<CodexEventTranslator['translate']> = [];
          if (
            event.method === 'item/started' ||
            event.method === 'item/completed'
          ) {
            if (event.method === 'item/started')
              currentId = `synthetic-${++nextId}`;
            const completed = event.method === 'item/completed';
            const item =
              event.itemType === 'agentMessage'
                ? {
                    type: 'agentMessage',
                    id: currentId,
                    text: 'synthetic text',
                  }
                : event.itemType === 'commandExecution'
                  ? {
                      ...command,
                      id: currentId,
                      status: completed ? 'completed' : 'inProgress',
                    }
                  : event.itemType === 'mcpToolCall'
                    ? {
                        ...mcp,
                        id: currentId,
                        status: completed ? 'completed' : 'inProgress',
                      }
                    : event.itemType === 'userMessage'
                      ? { type: 'userMessage', id: currentId, content: [] }
                      : { type: event.itemType, id: currentId };
            events = translator.translate(itemFrame(item, completed));
          } else if (event.method === 'item/agentMessage/delta') {
            events = translator.translate({
              method: event.method,
              params: { ...ids, itemId: currentId, delta: 'synthetic delta' },
            });
          } else if (event.method === 'thread/tokenUsage/updated') {
            events = translator.translate({
              method: event.method,
              params: { ...ids, tokenUsage: { last: counts, total: counts } },
            });
          } else if (event.method === 'turn/completed') {
            events = translator.translate(terminal());
          } else if (event.method === 'serverRequest/resolved') {
            expect(
              translator.translate({ method: event.method, params: ids }),
            ).toEqual([]);
          }
          for (const translated of events) {
            if (translated.type === 'toolStarted')
              toolIds.push(translated.toolId);
            if (translated.type === 'toolCompleted')
              expect(toolIds).toContain(translated.toolId);
            if (translated.type === 'terminal') terminalCount++;
          }
        }
        translator.dispose();
      }
      expect(terminalCount).toBeGreaterThan(0);
    });
  },
);
