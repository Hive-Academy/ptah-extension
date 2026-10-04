import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SubagentRecord } from '@ptah-extension/shared';
import type { CompactionConfigProvider } from '../compaction-config-provider';
import type { SessionLifecycleManager } from '../session-lifecycle-manager';
import type { SubagentMessageDispatcher } from '../subagent-message-dispatcher';
import {
  SubagentBudgetMonitor,
  adviseSubagentResume,
  readSubagentRequestUsage,
  requestContextTokens,
  weightedRequestTokens,
  type SubagentResumeAdviceInput,
} from './subagent-budget-monitor';

const SESSION = 'session-1';
const TOOL_CALL = 'toolu_task_1';
const HANDOFF_TOKENS = 150_000;
const STOP_WEIGHTED = 3_000_000;

interface Usage {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  write1h?: number;
}

function assistant(
  usage: Usage | null,
  opts: { id?: string; parent?: string | null } = {},
): unknown {
  return {
    type: 'assistant',
    parent_tool_use_id: opts.parent === undefined ? TOOL_CALL : opts.parent,
    message: {
      ...(opts.id ? { id: opts.id } : {}),
      role: 'assistant',
      content: [],
      ...(usage
        ? {
            usage: {
              input_tokens: usage.input ?? 0,
              cache_read_input_tokens: usage.cacheRead ?? 0,
              cache_creation_input_tokens: usage.cacheWrite ?? 0,
              output_tokens: usage.output ?? 0,
              ...(usage.write1h !== undefined
                ? {
                    cache_creation: {
                      ephemeral_5m_input_tokens:
                        (usage.cacheWrite ?? 0) - usage.write1h,
                      ephemeral_1h_input_tokens: usage.write1h,
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  };
}

function makeHarness(record: Partial<SubagentRecord> | null = {}) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = {
    getConfig: jest.fn(() => ({
      subagentHandoffTokens: HANDOFF_TOKENS,
      subagentStopWeightedTokens: STOP_WEIGHTED,
    })),
  };
  const dispatcher = { stopSubagent: jest.fn().mockResolvedValue(undefined) };
  const registry = {
    get: jest.fn(() =>
      record === null
        ? null
        : ({
            toolCallId: TOOL_CALL,
            agentType: 'Explore',
            agentId: 'a1',
            status: 'running',
            startedAt: 0,
            taskId: 'task-1',
            ...record,
          } as SubagentRecord),
    ),
    update: jest.fn(),
  };
  const streamed: string[] = [];
  const query = {
    streamInput: jest.fn(
      async (iter: AsyncIterable<{ message: { content: string } }>) => {
        for await (const m of iter) streamed.push(m.message.content);
      },
    ),
  };
  const lifecycle = { find: jest.fn(() => ({ query })) };
  const monitor = new SubagentBudgetMonitor(
    logger as unknown as Logger,
    config as unknown as CompactionConfigProvider,
    dispatcher as unknown as SubagentMessageDispatcher,
    registry as unknown as SubagentRegistryService,
    lifecycle as unknown as SessionLifecycleManager,
  );
  return { monitor, logger, dispatcher, registry, streamed, query };
}

describe('SubagentBudgetMonitor', () => {
  it('takes no action below the thresholds', async () => {
    const h = makeHarness();
    await h.monitor.observe(
      SESSION,
      assistant({
        input: 10,
        cacheRead: 100_000,
        cacheWrite: 40_000,
        output: 50,
      }),
    );

    expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
    expect(h.registry.update).not.toHaveBeenCalled();
    expect(h.streamed).toHaveLength(0);
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)).toEqual({
      contextTokens: 140_010,
      weightedUsed: 10 + 10_000 + 50_000 + 250,
      stopped: false,
      budgetReached: false,
    });
  });

  it('ignores parent messages and non-assistant messages', async () => {
    const h = makeHarness();
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { parent: null }),
    );
    await h.monitor.observe(SESSION, {
      type: 'user',
      parent_tool_use_id: TOOL_CALL,
    });

    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)).toBeUndefined();
    expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
  });

  it('at the handoff size stops the subagent, marks it not resumable and streams one parent message, once', async () => {
    const h = makeHarness({ teammateName: 'scout' });
    await h.monitor.observe(
      SESSION,
      assistant({ input: 1, cacheRead: 149_999 }, { id: 'm1' }),
    );
    await h.monitor.observe(
      SESSION,
      assistant({ input: 1, cacheRead: 160_000 }, { id: 'm2' }),
    );

    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(SESSION, 'task-1');
    expect(h.registry.update).toHaveBeenCalledWith(
      TOOL_CALL,
      expect.objectContaining({ status: 'completed' }),
    );
    expect(h.streamed).toHaveLength(1);
    expect(h.streamed[0]).toContain('`Explore`');
    expect(h.streamed[0]).toContain('150000 context tokens');
    expect(h.streamed[0]).toContain('start a fresh `Explore` subagent');
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)?.stopped).toBe(true);
  });

  it('weighted safety stop fires once on the same stop path', async () => {
    const h = makeHarness();
    // Each request weighs 151k (output 5x) while its context stays at 1k; the 20th crosses 3M.
    for (let i = 0; i < 25; i++) {
      await h.monitor.observe(
        SESSION,
        assistant({ input: 1_000, output: 30_000 }, { id: `m${i}` }),
      );
    }

    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
    expect(h.streamed).toHaveLength(1);
    expect(h.streamed[0]).toContain('safety limit 3000000');
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)?.budgetReached).toBe(true);
  });

  it('counts a request streamed as several messages with one id only once', async () => {
    const h = makeHarness();
    await h.monitor.observe(
      SESSION,
      assistant({ input: 100, output: 10 }, { id: 'm1' }),
    );
    await h.monitor.observe(
      SESSION,
      assistant({ input: 100, output: 20 }, { id: 'm1' }),
    );

    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)?.weightedUsed).toBe(200);
  });

  it('defers the stop until the task id is known, logging once', async () => {
    const h = makeHarness({ taskId: undefined });
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm2' }),
    );

    expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);

    h.registry.get.mockReturnValue({
      toolCallId: TOOL_CALL,
      agentType: 'Explore',
      agentId: 'a1',
      status: 'running',
      startedAt: 0,
      taskId: 'task-1',
    } as SubagentRecord);
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm3' }),
    );
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
  });

  it('a failed stop is logged, sends no handoff and is not retried', async () => {
    const h = makeHarness();
    h.dispatcher.stopSubagent.mockRejectedValue(new Error('gone'));
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm2' }),
    );

    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
    expect(h.registry.update).not.toHaveBeenCalled();
    expect(h.streamed).toHaveLength(0);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('without usage is observe-only and logs once per session', async () => {
    const h = makeHarness();
    await h.monitor.observe(SESSION, assistant(null));
    await h.monitor.observe(
      SESSION,
      assistant(null, { parent: 'toolu_other' }),
    );

    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)).toBeUndefined();

    await h.monitor.observe('session-2', assistant(null));
    expect(h.logger.info).toHaveBeenCalledTimes(2);
  });

  it('release forgets the session', async () => {
    const h = makeHarness();
    await h.monitor.observe(SESSION, assistant({ input: 10 }));
    h.monitor.release(SESSION);
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)).toBeUndefined();
  });
});

describe('weighted and context tokens', () => {
  it('uses the TTL split when present and the fallback TTL otherwise', () => {
    const split = readSubagentRequestUsage(
      assistant({ cacheWrite: 1_000, write1h: 400 }),
    );
    expect(split && weightedRequestTokens(split, '5m')).toBe(
      600 * 1.25 + 400 * 2,
    );

    const noSplit = readSubagentRequestUsage(assistant({ cacheWrite: 1_000 }));
    expect(noSplit && weightedRequestTokens(noSplit, '1h')).toBe(2_000);
    expect(noSplit && weightedRequestTokens(noSplit, '5m')).toBe(1_250);
  });

  it('parses the sanitized AS10 subagent transcript fixture', () => {
    const line = fs
      .readFileSync(
        path.join(
          __dirname,
          '__fixtures__',
          'as10-subagent-assistant-usage.jsonl',
        ),
        'utf8',
      )
      .trim();
    const raw = JSON.parse(line) as {
      message: { usage: Record<string, number> };
    };
    const usage = readSubagentRequestUsage(raw);

    expect(usage).toBeDefined();
    if (!usage) return;
    const u = raw.message.usage;
    expect(requestContextTokens(usage)).toBe(
      u['input_tokens'] +
        u['cache_read_input_tokens'] +
        u['cache_creation_input_tokens'],
    );
    expect(usage.cacheWriteByTtl).toBeDefined();
    expect(weightedRequestTokens(usage, '5m')).toBeGreaterThan(0);
  });
});

describe('adviseSubagentResume', () => {
  const warm: SubagentResumeAdviceInput = {
    stopped: false,
    cacheState: 'warm',
    contextTokens: 10_000,
    handoffTokens: HANDOFF_TOKENS,
    budgetReached: false,
  };

  it.each<[string, Partial<SubagentResumeAdviceInput>]>([
    ['stopped', { stopped: true }],
    ['cold', { cacheState: 'cold' }],
    ['context at the handoff size', { contextTokens: HANDOFF_TOKENS }],
    ['budget reached', { budgetReached: true }],
  ])('is fresh when %s', (_label, change) => {
    expect(adviseSubagentResume({ ...warm, ...change })).toBe('fresh');
  });

  it('is resume for a warm, small, running subagent', () => {
    expect(adviseSubagentResume(warm)).toBe('resume');
    expect(adviseSubagentResume({ ...warm, contextTokens: undefined })).toBe(
      'resume',
    );
  });
});
