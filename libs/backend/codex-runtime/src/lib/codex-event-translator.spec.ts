import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { CodexEventTranslator } from './codex-event-translator';
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
    'emits exactly one %s terminal and ignores late events',
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
      ).toEqual([]);
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

  it('sanitizes retry, terminal, command, and MCP errors without ending retries early', () => {
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
        itemFrame(
          { ...command, status: 'failed', aggregatedOutput: secret },
          true,
        ),
      ),
      ...translator.translate(
        itemFrame(
          { ...mcp, status: 'failed', error: { message: secret } },
          true,
        ),
      ),
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
