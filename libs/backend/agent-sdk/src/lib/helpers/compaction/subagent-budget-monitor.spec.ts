import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SubagentRecord } from '@ptah-extension/shared';
import type { CompactionConfigProvider } from '../compaction-config-provider';
import {
  MAX_STOP_ATTEMPTS,
  SubagentBudgetMonitor,
  adviseSubagentResume,
  readSubagentRequestUsage,
  readSubagentTaskText,
  requestContextTokens,
  weightedRequestTokens,
  type SubagentResumeAdviceInput,
  type SubagentStopPort,
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

function makeHarness(
  record: Partial<SubagentRecord> | null = {},
  opts: { enabled?: boolean } = {},
) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = {
    getConfig: jest.fn(() => ({
      enabled: opts.enabled ?? true,
      subagentHandoffTokens: HANDOFF_TOKENS,
      subagentStopWeightedTokens: STOP_WEIGHTED,
    })),
  };
  const streamed: string[] = [];
  const dispatcher = {
    stopSubagent: jest.fn().mockResolvedValue(undefined),
    pushParentMessage: jest.fn(async (_sessionId: string, content: string) => {
      streamed.push(content);
    }),
  };
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
  const monitor = new SubagentBudgetMonitor(
    logger as unknown as Logger,
    config as unknown as CompactionConfigProvider,
    dispatcher as unknown as SubagentStopPort,
    registry as unknown as SubagentRegistryService,
  );
  return { monitor, logger, dispatcher, registry, streamed };
}

/** A parent assistant message that spawns the subagent with `input`. */
function spawn(input: Record<string, unknown>, name = 'Agent'): unknown {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'delegating' },
        { type: 'tool_use', id: TOOL_CALL, name, input },
      ],
    },
  };
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

  it('retries a rejected stop on the next subagent message and gives up after the cap', async () => {
    const h = makeHarness();
    h.dispatcher.stopSubagent.mockRejectedValue(new Error('gone'));
    for (let i = 0; i < MAX_STOP_ATTEMPTS + 3; i++) {
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: `m${i}` }),
      );
    }

    expect(MAX_STOP_ATTEMPTS).toBe(3);
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(MAX_STOP_ATTEMPTS);
    expect(h.registry.update).not.toHaveBeenCalled();
    expect(h.streamed).toHaveLength(0);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('giving up'),
      expect.objectContaining({ attempts: MAX_STOP_ATTEMPTS }),
    );
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)?.stopped).toBe(false);
  });

  it('a retried stop that succeeds hands off once', async () => {
    const h = makeHarness();
    h.dispatcher.stopSubagent.mockRejectedValueOnce(new Error('busy'));
    for (let i = 0; i < 4; i++) {
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: `m${i}` }),
      );
    }

    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(2);
    expect(h.streamed).toHaveLength(1);
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)?.stopped).toBe(true);
  });

  it('starts no second stop while one is in flight', async () => {
    const h = makeHarness();
    let settle: () => void = () => undefined;
    h.dispatcher.stopSubagent.mockReturnValueOnce(
      new Promise<void>((resolve) => (settle = resolve)),
    );
    const first = h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm2' }),
    );
    settle();
    await first;

    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
    expect(h.streamed).toHaveLength(1);
  });

  it('a stop that rejects after release is not retried and sends no handoff', async () => {
    const h = makeHarness();
    let fail: (error: Error) => void = () => undefined;
    h.dispatcher.stopSubagent.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => (fail = reject)),
    );
    const first = h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    h.monitor.release(SESSION);
    fail(new Error('session ended'));
    await first;

    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)).toBeUndefined();
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
    expect(h.registry.update).not.toHaveBeenCalled();
    expect(h.dispatcher.pushParentMessage).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
    expect(h.logger.debug).not.toHaveBeenCalled();
  });

  it('the handoff restates the task from the spawning Agent tool_use', async () => {
    const h = makeHarness();
    await h.monitor.observe(
      SESSION,
      spawn({
        description: 'Map the auth module',
        prompt: `List every auth entry point. ${'x'.repeat(400)}`,
        subagent_type: 'Explore',
      }),
    );
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm1' }),
    );

    expect(h.streamed).toHaveLength(1);
    expect(h.streamed[0]).toContain(
      'Its task was: Map the auth module: List every auth entry point.',
    );
    expect(h.streamed[0]).not.toContain('x'.repeat(301));
    expect(h.dispatcher.pushParentMessage).toHaveBeenCalledWith(
      SESSION,
      h.streamed[0],
    );
  });

  it('reads the task from the earlier Task tool name and omits it when unknown', async () => {
    const h = makeHarness();
    await h.monitor.observe(SESSION, spawn({ prompt: 'Fix the build' }, 'Task'));
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    expect(h.streamed[0]).toContain('Its task was: Fix the build');

    const other = makeHarness();
    await other.monitor.observe(SESSION, spawn({ prompt: 'ignored' }, 'Bash'));
    await other.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    expect(other.streamed[0]).not.toContain('Its task was');
  });

  it('with compaction.enabled false keeps counting but never stops, logging once', async () => {
    const h = makeHarness({}, { enabled: false });
    for (let i = 0; i < 25; i++) {
      await h.monitor.observe(
        SESSION,
        assistant({ input: 160_000, output: 30_000 }, { id: `m${i}` }),
      );
    }

    expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
    expect(h.dispatcher.pushParentMessage).not.toHaveBeenCalled();
    expect(h.registry.update).not.toHaveBeenCalled();
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)).toEqual(
      expect.objectContaining({ stopped: false, budgetReached: true }),
    );
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('compaction.enabled is false'),
      expect.objectContaining({ sessionId: SESSION, toolCallId: TOOL_CALL }),
    );
  });

  it('rekey moves the session state and the handoff goes to the new id', async () => {
    const h = makeHarness();
    await h.monitor.observe(SESSION, spawn({ description: 'Audit logs' }));
    await h.monitor.observe(SESSION, assistant({ input: 1_000 }, { id: 'm1' }));
    h.monitor.rekey(SESSION, 'session-2');

    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)).toBeUndefined();
    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)?.contextTokens).toBe(
      1_000,
    );

    await h.monitor.observe(
      'session-2',
      assistant({ input: 200_000 }, { id: 'm2' }),
    );
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(
      'session-2',
      'task-1',
    );
    expect(h.dispatcher.pushParentMessage).toHaveBeenCalledWith(
      'session-2',
      expect.stringContaining('Its task was: Audit logs'),
    );
  });

  it('rekey keeps subagents already seen under the new id and ignores no-op calls', async () => {
    const h = makeHarness();
    await h.monitor.observe(SESSION, assistant({ input: 10 }, { id: 'm1' }));
    await h.monitor.observe(
      'session-2',
      assistant({ input: 20 }, { id: 'm2', parent: 'toolu_other' }),
    );
    h.monitor.rekey(SESSION, SESSION);
    h.monitor.rekey('unknown', 'session-2');
    h.monitor.rekey(SESSION, 'session-2');

    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)?.contextTokens).toBe(
      10,
    );
    expect(
      h.monitor.getSnapshot('session-2', 'toolu_other')?.contextTokens,
    ).toBe(20);
  });

  it('a stop in flight on the merged-into session finishes once after a rekey', async () => {
    const h = makeHarness();
    let settle: () => void = () => undefined;
    h.dispatcher.stopSubagent.mockReturnValueOnce(
      new Promise<void>((resolve) => (settle = resolve)),
    );
    const pending = h.monitor.observe(
      'session-2',
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    await h.monitor.observe(SESSION, assistant({ input: 10 }, { id: 'm0' }));
    h.monitor.rekey(SESSION, 'session-2');
    settle();
    await pending;

    expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.pushParentMessage).toHaveBeenCalledWith(
      'session-2',
      expect.any(String),
    );
    expect(h.registry.update).toHaveBeenCalledTimes(1);
    expect(h.registry.update).toHaveBeenCalledWith(
      TOOL_CALL,
      expect.objectContaining({ status: 'completed' }),
    );
    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)?.stopped).toBe(true);

    await h.monitor.observe(
      'session-2',
      assistant({ input: 300_000 }, { id: 'm2' }),
    );
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
  });

  it('a stop in flight across a rekey merge sends no handoff once released', async () => {
    const h = makeHarness();
    let settle: () => void = () => undefined;
    h.dispatcher.stopSubagent.mockReturnValueOnce(
      new Promise<void>((resolve) => (settle = resolve)),
    );
    const pending = h.monitor.observe(
      'session-2',
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    await h.monitor.observe(SESSION, assistant({ input: 10 }, { id: 'm0' }));
    h.monitor.rekey(SESSION, 'session-2');
    h.monitor.release('session-2');
    settle();
    await pending;

    expect(h.dispatcher.pushParentMessage).not.toHaveBeenCalled();
    expect(h.registry.update).not.toHaveBeenCalled();
    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)).toBeUndefined();
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

describe('readSubagentTaskText', () => {
  it('joins the description and a capped prompt excerpt', () => {
    expect(readSubagentTaskText({ description: ' D ', prompt: ' P ' })).toBe(
      'D: P',
    );
    expect(readSubagentTaskText({ prompt: 'p'.repeat(301) })).toBe(
      `${'p'.repeat(300)}...`,
    );
    expect(readSubagentTaskText({ description: 'only' })).toBe('only');
    expect(readSubagentTaskText({ description: 3 })).toBeUndefined();
    expect(readSubagentTaskText(undefined)).toBeUndefined();
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
