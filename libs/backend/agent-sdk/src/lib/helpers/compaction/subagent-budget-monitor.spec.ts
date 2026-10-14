import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SubagentRecord } from '@ptah-extension/shared';
import type { CompactionConfigProvider } from '../compaction-config-provider';
import { MainThreadNoticeQueue } from '../main-thread-notice-queue';
import {
  HANDOFF_FILES_TIMEOUT_MS,
  SubagentHandoffFiles,
  type SubagentHandoffPaths,
} from './subagent-handoff-files';
import {
  PARENT_PUSH_ATTEMPTS,
  PARENT_PUSH_RETRY_DELAY_MS,
} from './subagent-handoff-delivery';
import { SubagentNoticeQueue } from '../subagent-notice-queue';
import {
  MAX_STOP_ATTEMPTS,
  SubagentBudgetMonitor,
  readSubagentRequestUsage,
  readSubagentTaskText,
  requestContextTokens,
  weightedRequestTokens,
  type SubagentBudgetDispatcherPort,
  type SubagentHandoffFilesPort,
} from './subagent-budget-monitor';
import {
  adviseSubagentResume,
  type SubagentResumeAdviceInput,
} from './subagent-resume-advice';

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
  opts: {
    enabled?: boolean;
    workspace?: string;
    handoffFiles?: SubagentHandoffFilesPort;
  } = {},
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
  // Every handoff the monitor delivered, by either route.
  const streamed: string[] = [];
  const notices = new MainThreadNoticeQueue(logger as unknown as Logger);
  const subagentNotices = new SubagentNoticeQueue();
  const dispatcher = {
    stopSubagent: jest.fn().mockResolvedValue(undefined),
    pushParentMessage: jest.fn(async (_sessionId: string, content: string) => {
      streamed.push(content);
    }),
    postMainThreadNotice: jest.fn(
      (sessionId: string, text: string, onDropped?: () => void) => {
        streamed.push(text);
        notices.post(sessionId, text, onDropped);
      },
    ),
    withdrawMainThreadNotice: jest.fn((sessionId: string, text: string) =>
      notices.withdraw(sessionId, text),
    ),
    postSubagentNotice: jest.fn((agentId: string, text: string) =>
      subagentNotices.post(agentId, text),
    ),
    withdrawSubagentNotice: jest.fn((agentId: string) =>
      subagentNotices.withdraw(agentId),
    ),
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
    dispatcher as unknown as SubagentBudgetDispatcherPort,
    registry as unknown as SubagentRegistryService,
    // No workspace by default: no handoff files.
    opts.handoffFiles ??
      new SubagentHandoffFiles(
        logger as unknown as Logger,
        () => opts.workspace,
      ),
  );
  return {
    monitor,
    logger,
    dispatcher,
    registry,
    streamed,
    notices,
    subagentNotices,
  };
}

/** The main-thread user message carrying the spawning call's tool result. */
function toolResult(toolUseId = TOOL_CALL): unknown {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'Async agent launched',
        },
      ],
    },
  };
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
    expect(h.streamed[0]).toContain('spawn a fresh `Explore` subagent');
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

  describe('task id from task_started (R5)', () => {
    it('stops with the recorded task id and hands off when the registry has no record', async () => {
      const h = makeHarness(null);
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-started-1', 'Plan');
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(
        SESSION,
        'task-started-1',
      );
      expect(h.registry.update).not.toHaveBeenCalled();
      expect(h.streamed).toHaveLength(1);
      expect(h.streamed[0]).toContain('stopped subagent `Plan`');
      expect(h.streamed[0]).toContain('spawn a fresh `Plan` subagent');
      expect(h.logger.warn).not.toHaveBeenCalled();
      expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)?.stopped).toBe(true);
    });

    it('names the subagent generically when neither the registry nor task_started gives a type', async () => {
      const h = makeHarness(null);
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-started-1');
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.streamed[0]).toContain('stopped subagent `subagent`');
    });

    it('stops with the recorded task id when the registry record has none, and marks the record', async () => {
      const h = makeHarness({ taskId: undefined, teammateName: 'scout' });
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-started-1', 'Plan');
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(
        SESSION,
        'task-started-1',
      );
      expect(h.registry.update).toHaveBeenCalledWith(
        TOOL_CALL,
        expect.objectContaining({ status: 'completed' }),
      );
      // The registry record names the subagent when it exists.
      expect(h.streamed[0]).toContain("`Explore` ('scout')");
    });

    it('prefers the recorded task id over the registry one', async () => {
      const h = makeHarness();
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-started-1');
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(
        SESSION,
        'task-started-1',
      );
    });

    it('with nothing recorded and no registry record, defers with one WARN and no stop', async () => {
      const h = makeHarness(null);
      // A non-agent task (bash) under another tool_use id is not this subagent.
      h.monitor.recordTaskStarted(SESSION, 'toolu_bash_1', 'task-bash-1');
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm2' }),
      );

      expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
      expect(h.registry.update).not.toHaveBeenCalled();
      expect(h.streamed).toHaveLength(0);
      expect(h.logger.warn).toHaveBeenCalledTimes(1);
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('stop deferred'),
        expect.objectContaining({ toolCallId: TOOL_CALL }),
      );
    });

    it('a task id recorded after a deferral lets the next message stop', async () => {
      const h = makeHarness(null);
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-started-1');
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm2' }),
      );

      expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
      expect(h.streamed).toHaveLength(1);
    });

    it('ignores a blank session, tool_use or task id', async () => {
      const h = makeHarness(null);
      h.monitor.recordTaskStarted('', TOOL_CALL, 'task-started-1');
      h.monitor.recordTaskStarted(SESSION, '', 'task-started-1');
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, '');
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
    });

    it('keeps a task id recorded under the old id across a rekey, and under an alias', async () => {
      const h = makeHarness(null);
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-started-1');
      h.monitor.rekey(SESSION, 'session-2');
      h.monitor.recordTaskStarted(SESSION, 'toolu_task_2', 'task-started-2');
      await h.monitor.observe(
        'session-2',
        assistant({ input: 200_000 }, { id: 'm1' }),
      );
      await h.monitor.observe(
        'session-2',
        assistant({ input: 200_000 }, { id: 'm2', parent: 'toolu_task_2' }),
      );

      expect(h.dispatcher.stopSubagent).toHaveBeenNthCalledWith(
        1,
        'session-2',
        'task-started-1',
      );
      expect(h.dispatcher.stopSubagent).toHaveBeenNthCalledWith(
        2,
        'session-2',
        'task-started-2',
      );
    });

    it('merges task ids recorded under both ids on a rekey', async () => {
      const h = makeHarness(null);
      h.monitor.recordTaskStarted('session-2', TOOL_CALL, 'task-started-1');
      h.monitor.recordTaskStarted(SESSION, 'toolu_task_2', 'task-started-2');
      h.monitor.rekey(SESSION, 'session-2');
      await h.monitor.observe(
        'session-2',
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(
        'session-2',
        'task-started-1',
      );
    });

    it('forgets recorded task ids when the session is released', async () => {
      const h = makeHarness(null);
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-started-1');
      h.monitor.release(SESSION);
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
    });
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
    expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
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
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledWith(
      SESSION,
      h.streamed[0],
      expect.any(Function),
    );
  });

  it('reads the task from the earlier Task tool name and omits it when unknown', async () => {
    const h = makeHarness();
    await h.monitor.observe(
      SESSION,
      spawn({ prompt: 'Fix the build' }, 'Task'),
    );
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
    expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
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
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledWith(
      'session-2',
      expect.stringContaining('Its task was: Audit logs'),
      expect.any(Function),
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

    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledWith(
      'session-2',
      expect.any(String),
      expect.any(Function),
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
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
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

    expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
    expect(h.registry.update).not.toHaveBeenCalled();
    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)).toBeUndefined();
  });

  it('an old-id message after a rekey adds to the same state (G.2 FM-2)', async () => {
    const h = makeHarness();
    await h.monitor.observe(SESSION, assistant({ input: 1_000 }, { id: 'm1' }));
    h.monitor.rekey(SESSION, 'session-2');
    // Still queued under the old id when the PostCompact hook ran.
    await h.monitor.observe(SESSION, assistant({ input: 2_000 }, { id: 'm2' }));

    expect(h.monitor.currentSessionId(SESSION)).toBe('session-2');
    expect(h.monitor.getSnapshot(SESSION, TOOL_CALL)).toBeUndefined();
    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)).toEqual(
      expect.objectContaining({ contextTokens: 2_000, weightedUsed: 3_000 }),
    );

    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm3' }),
    );
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(
      'session-2',
      'task-1',
    );
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledWith(
      'session-2',
      expect.any(String),
      expect.any(Function),
    );
  });

  it('release drops the aliases of the released id: no state lands on it afterwards', async () => {
    const h = makeHarness();
    await h.monitor.observe(SESSION, assistant({ input: 1_000 }, { id: 'm1' }));
    h.monitor.rekey(SESSION, 'session-2');
    h.monitor.rekey('session-2', 'session-3');
    expect(h.monitor.currentSessionId(SESSION)).toBe('session-3');

    h.monitor.release('session-3');
    expect(h.monitor.currentSessionId(SESSION)).toBe(SESSION);
    expect(h.monitor.currentSessionId('session-2')).toBe('session-2');

    await h.monitor.observe(SESSION, assistant({ input: 5 }, { id: 'm2' }));
    expect(h.monitor.getSnapshot('session-3', TOOL_CALL)).toBeUndefined();
    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)).toBeUndefined();
  });

  it('a rekey back to an earlier id forms no alias loop', () => {
    const h = makeHarness();
    h.monitor.rekey(SESSION, 'session-2');
    h.monitor.rekey('session-2', SESSION);

    expect(h.monitor.currentSessionId(SESSION)).toBe(SESSION);
    expect(h.monitor.currentSessionId('session-2')).toBe(SESSION);
  });

  it('a rejected stop retries on the next request, not on the other blocks of the same one (FM-6)', async () => {
    const h = makeHarness();
    h.dispatcher.stopSubagent.mockRejectedValue(new Error('busy'));
    // One request streamed as three content-block messages.
    for (let i = 0; i < 3; i++) {
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );
    }
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);

    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'm2' }),
    );
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(2);
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('a stop rejecting across a rekey merge counts once and retries on the next request (rereview m3)', async () => {
    const h = makeHarness();
    let fail: (error: Error) => void = () => undefined;
    h.dispatcher.stopSubagent.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => (fail = reject)),
    );
    const pending = h.monitor.observe(
      'session-2',
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    await h.monitor.observe(SESSION, assistant({ input: 10 }, { id: 'm0' }));
    h.monitor.rekey(SESSION, 'session-2');
    fail(new Error('busy'));
    await pending;

    expect(h.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('retrying'),
      expect.objectContaining({ sessionId: 'session-2', attempt: 1 }),
    );
    expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();

    await h.monitor.observe(
      'session-2',
      assistant({ input: 200_000 }, { id: 'm2' }),
    );
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(2);
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)?.stopped).toBe(true);
  });

  it('with stops in flight on both merged records, a failure on the last attempt does not hide the other success (rereview m1, m3)', async () => {
    const h = makeHarness();
    // Source record: two attempts rejected, the third (F) left in flight.
    h.dispatcher.stopSubagent
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'));
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'a1' }),
    );
    await h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'a2' }),
    );
    let settleF: () => void = () => undefined;
    h.dispatcher.stopSubagent.mockReturnValueOnce(
      new Promise<void>((resolve) => (settleF = resolve)),
    );
    const pendingF = h.monitor.observe(
      SESSION,
      assistant({ input: 200_000 }, { id: 'a3' }),
    );
    // Target record: its own stop (E) in flight.
    let failE: (error: Error) => void = () => undefined;
    h.dispatcher.stopSubagent.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => (failE = reject)),
    );
    const pendingE = h.monitor.observe(
      'session-2',
      assistant({ input: 200_000 }, { id: 'b1' }),
    );

    h.monitor.rekey(SESSION, 'session-2');
    failE(new Error('busy'));
    await pendingE;
    settleF();
    await pendingF;

    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(4);
    expect(h.logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('giving up'),
      expect.anything(),
    );
    expect(h.registry.update).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledWith(
      'session-2',
      expect.any(String),
      expect.any(Function),
    );
    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)?.stopped).toBe(true);
  });

  it('a rekey keeps the fired target state over a fresh source one: no second stop or handoff (rereview m3)', async () => {
    const h = makeHarness();
    await h.monitor.observe(
      'session-2',
      assistant({ input: 200_000 }, { id: 'm1' }),
    );
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
    await h.monitor.observe(SESSION, assistant({ input: 10 }, { id: 'm0' }));
    h.monitor.rekey(SESSION, 'session-2');

    expect(h.monitor.getSnapshot('session-2', TOOL_CALL)?.stopped).toBe(true);
    await h.monitor.observe(
      'session-2',
      assistant({ input: 300_000 }, { id: 'm2' }),
    );
    expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
  });

  it('the handoff after a rekey restates the task recorded on the merged-away record (rereview m3)', async () => {
    const h = makeHarness();
    await h.monitor.observe(
      'session-2',
      spawn({ description: 'Trace the bug' }),
    );
    await h.monitor.observe(SESSION, assistant({ input: 10 }, { id: 'm0' }));
    h.monitor.rekey(SESSION, 'session-2');
    await h.monitor.observe(
      'session-2',
      assistant({ input: 200_000 }, { id: 'm1' }),
    );

    expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledWith(
      'session-2',
      expect.stringContaining('Its task was: Trace the bug'),
      expect.any(Function),
    );
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

  describe('handoff route', () => {
    it('background subagent (tool result already returned): streams the handoff as a parent user turn, not into the notice queue', async () => {
      const h = makeHarness();
      await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
      await h.monitor.observe(SESSION, toolResult());
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.stopSubagent).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.pushParentMessage).toHaveBeenCalledWith(
        SESSION,
        expect.stringContaining('Its task was: Map auth'),
      );
      expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
      // Turn end clears the queue; nothing of the handoff was in it.
      expect(h.notices.take(SESSION)).toBeUndefined();
      // A later tool result for the same call delivers nothing more.
      await h.monitor.observe(SESSION, toolResult());
      expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
    });

    it('the handoff names the budget monitor, not the user, and the limit', async () => {
      const h = makeHarness();
      await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
      await h.monitor.observe(SESSION, toolResult());
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      const text = h.streamed[0];
      expect(text).toContain("Ptah's subagent budget monitor stopped");
      expect(text).toContain('The user did not stop it');
      expect(text).toContain('handoff limit 150000 tokens');
    });

    it('foreground subagent: posts the handoff to the notice queue once; its drained tool result delivers nothing more', async () => {
      const h = makeHarness();
      await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.pushParentMessage).not.toHaveBeenCalled();
      // The `Agent` tool result's PostToolUse drains it.
      expect(h.notices.take(SESSION)).toContain('Its task was: Map auth');
      await h.monitor.observe(SESSION, toolResult());

      expect(h.dispatcher.withdrawMainThreadNotice).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.pushParentMessage).not.toHaveBeenCalled();
      expect(h.streamed).toHaveLength(1);
    });

    it('foreground subagent whose tool result arrives with the notice still pending: withdraws it and streams it as a user turn, once', async () => {
      const h = makeHarness();
      await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );
      await h.monitor.observe(SESSION, toolResult());
      await h.monitor.observe(SESSION, toolResult());

      expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.pushParentMessage).toHaveBeenCalledWith(
        SESSION,
        h.dispatcher.postMainThreadNotice.mock.calls[0][1],
      );
      expect(h.notices.take(SESSION)).toBeUndefined();
    });

    it('a tool result that returns while the stop is in flight routes the handoff to a user turn', async () => {
      const h = makeHarness();
      await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
      let settle: () => void = () => undefined;
      h.dispatcher.stopSubagent.mockReturnValueOnce(
        new Promise<void>((resolve) => (settle = resolve)),
      );
      const pending = h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );
      await h.monitor.observe(SESSION, toolResult());
      settle();
      await pending;

      expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
    });

    it('a call known only from task_started counts as returned once its tool result arrives', async () => {
      const h = makeHarness(null);
      h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-9', 'Explore');
      await h.monitor.observe(SESSION, toolResult());
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(SESSION, 'task-9');
      expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
    });

    describe('handoff files', () => {
      let workspace: string;
      beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-handoff-'));
      });
      afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
      });
      const dir = () => path.join(workspace, '.ptah', 'subagent-handoffs');
      const longPrompt = `Design the auth module. ${'y'.repeat(400)} END`;

      async function stopSpawned(h: ReturnType<typeof makeHarness>) {
        h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-9', 'architect');
        await h.monitor.observe(
          SESSION,
          spawn({
            description: 'Design auth',
            prompt: longPrompt,
            name: 'arch',
          }),
        );
        await h.monitor.observe(SESSION, toolResult());
        await h.monitor.observe(
          SESSION,
          assistant({ input: 200_000 }, { id: 'm1' }),
        );
        return h.streamed[0];
      }

      it('saves the full prompt and points a fresh subagent of the same type and name at the notes', async () => {
        const h = makeHarness(null, { workspace });
        fs.mkdirSync(dir(), { recursive: true });
        const notes = path.join(dir(), `${TOOL_CALL}.md`);
        fs.writeFileSync(notes, 'state: half done');

        const text = await stopSpawned(h);
        const taskFile = path.join(dir(), `${TOOL_CALL}.task.md`);

        expect(fs.readFileSync(taskFile, 'utf8')).toBe(longPrompt);
        expect(text).not.toContain(' END');
        expect(text).toContain(`saved at ${taskFile}`);
        expect(text).toContain(`Its progress notes are at ${notes}.`);
        expect(text).toContain(
          "spawn a fresh `architect` subagent named 'arch'",
        );
        expect(text).toContain(
          `"Read ${notes} first and continue from it; do not redo finished work."`,
        );
        expect(text).toContain(
          'Its output file: not yet known; it is in the task notification for task task-9.',
        );
        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
      });

      it('without a notes file still hands off and says the file is missing', async () => {
        const h = makeHarness(null, { workspace });

        const text = await stopSpawned(h);
        const notes = path.join(dir(), `${TOOL_CALL}.md`);

        expect(text).toContain(
          `Its progress notes file is missing: ${notes} was not written.`,
        );
        expect(text).not.toContain(`Read ${notes} first`);
        expect(text).toContain('do not redo finished work');
        expect(fs.existsSync(path.join(dir(), `${TOOL_CALL}.task.md`))).toBe(
          true,
        );
        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
      });

      it('without a workspace names no files and takes the prompt from the spawning call', async () => {
        const h = makeHarness(null);

        const text = await stopSpawned(h);

        expect(text).not.toContain('.ptah');
        expect(text).toContain(
          'Its progress notes file: unavailable (workspace unknown).',
        );
        expect(text).toContain(
          'its full original task prompt from the Agent call that spawned it',
        );
      });
    });

    describe('delivery under load and failure', () => {
      afterEach(() => {
        jest.useRealTimers();
      });

      /** Spawn a foreground subagent `id` with task `taskId` and stop it. */
      async function stopForeground(
        h: ReturnType<typeof makeHarness>,
        id: string,
        taskId: string,
      ): Promise<void> {
        h.monitor.recordTaskStarted(SESSION, id, taskId, 'Explore');
        await h.monitor.observe(SESSION, {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id,
                name: 'Agent',
                input: { description: `Part ${taskId}` },
              },
            ],
          },
        });
        await h.monitor.observe(
          SESSION,
          assistant({ input: 200_000 }, { id: `m-${id}`, parent: id }),
        );
      }

      it('five foreground stops before any drain: every handoff is delivered exactly once', async () => {
        const h = makeHarness(null);
        const ids = [1, 2, 3, 4, 5].map((i) => `toolu_fg_${i}`);
        for (const [i, id] of ids.entries()) {
          await stopForeground(h, id, `task-fg-${i + 1}`);
        }

        // The fifth post evicted the first; it went out as a user turn.
        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
        const drained = h.notices.take(SESSION) ?? '';
        for (const id of ids) {
          await h.monitor.observe(SESSION, toolResult(id));
        }

        const delivered = [
          drained,
          ...h.dispatcher.pushParentMessage.mock.calls.map((call) => call[1]),
        ].join('\n');
        for (let i = 1; i <= ids.length; i += 1) {
          const marker = `task notification for task task-fg-${i}.`;
          expect(delivered.split(marker)).toHaveLength(2);
        }
        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
      });

      it('background handoff whose first push rejects is retried and sent once', async () => {
        jest.useFakeTimers();
        const h = makeHarness();
        await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
        await h.monitor.observe(SESSION, toolResult());
        h.dispatcher.pushParentMessage.mockRejectedValueOnce(
          new Error('not active'),
        );
        const pending = h.monitor.observe(
          SESSION,
          assistant({ input: 200_000 }, { id: 'm1' }),
        );
        await jest.advanceTimersByTimeAsync(PARENT_PUSH_RETRY_DELAY_MS);
        await pending;

        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(2);
        expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
        expect(h.logger.warn).not.toHaveBeenCalled();
      });

      it('background handoff whose pushes all reject stays pending in the notice queue, once', async () => {
        jest.useFakeTimers();
        const h = makeHarness();
        await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
        await h.monitor.observe(SESSION, toolResult());
        h.dispatcher.pushParentMessage.mockRejectedValue(
          new Error('not active'),
        );
        const pending = h.monitor.observe(
          SESSION,
          assistant({ input: 200_000 }, { id: 'm1' }),
        );
        await jest.advanceTimersByTimeAsync(
          PARENT_PUSH_RETRY_DELAY_MS * PARENT_PUSH_ATTEMPTS,
        );
        await pending;

        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(
          PARENT_PUSH_ATTEMPTS,
        );
        expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        const warned = JSON.stringify(h.logger.warn.mock.calls[0]);
        expect(warned).not.toContain('Map auth');
        // The next main-thread tool result's PostToolUse carries it.
        expect(h.notices.take(SESSION)).toContain('Its task was: Map auth');
      });

      it('handoff file checks that never settle: a degraded handoff after the bound, and no second one', async () => {
        jest.useFakeTimers();
        let finishSave: (saved: boolean) => void = () => undefined;
        const paths: SubagentHandoffPaths = {
          notes: '/ws/.ptah/subagent-handoffs/n.md',
          task: '/ws/.ptah/subagent-handoffs/n.task.md',
        };
        const handoffFiles = {
          paths: jest.fn(() => paths),
          saveTask: jest.fn(
            () => new Promise<boolean>((resolve) => (finishSave = resolve)),
          ),
          notesExist: jest.fn(() => new Promise<boolean>(() => undefined)),
        };
        const h = makeHarness(null, { handoffFiles });
        h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-9', 'Explore');
        await h.monitor.observe(
          SESSION,
          spawn({ description: 'Map auth', prompt: 'Map the auth module' }),
        );
        await h.monitor.observe(SESSION, toolResult());
        const pending = h.monitor.observe(
          SESSION,
          assistant({ input: 200_000 }, { id: 'm1' }),
        );
        await jest.advanceTimersByTimeAsync(HANDOFF_FILES_TIMEOUT_MS);
        await pending;

        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
        const text = h.dispatcher.pushParentMessage.mock.calls[0][1];
        expect(text).toContain(
          `Its progress notes file: unavailable (the file check did not finish); look for ${paths.notes}.`,
        );
        expect(text).toContain(`If ${paths.notes} exists, read it first`);
        expect(text).not.toContain(`saved at ${paths.task}`);

        finishSave(true);
        await jest.advanceTimersByTimeAsync(HANDOFF_FILES_TIMEOUT_MS);
        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledTimes(1);
        expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
      });

      it('names the output file a background spawn result reported, with the task id', async () => {
        const h = makeHarness(null);
        h.monitor.recordTaskStarted(SESSION, TOOL_CALL, 'task-9', 'Explore');
        await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
        await h.monitor.observe(SESSION, {
          type: 'user',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: TOOL_CALL,
                content: [
                  {
                    type: 'text',
                    text: 'Async agent launched successfully.\nagentId: a1\noutput_file: /tmp/tasks/task-9.output\nThe agent is working.',
                  },
                ],
              },
            ],
          },
        });
        await h.monitor.observe(
          SESSION,
          assistant({ input: 200_000 }, { id: 'm1' }),
        );

        expect(h.dispatcher.pushParentMessage).toHaveBeenCalledWith(
          SESSION,
          expect.stringContaining(
            'Its output so far is in /tmp/tasks/task-9.output (task task-9).',
          ),
        );
      });
    });

    it("ignores a subagent's own tool results and results of calls that spawn nothing", async () => {
      const h = makeHarness();
      await h.monitor.observe(SESSION, spawn({ description: 'Map auth' }));
      await h.monitor.observe(SESSION, {
        ...(toolResult() as Record<string, unknown>),
        parent_tool_use_id: 'toolu_parent',
      });
      await h.monitor.observe(SESSION, toolResult('toolu_read'));
      await h.monitor.observe(
        SESSION,
        assistant({ input: 200_000 }, { id: 'm1' }),
      );

      expect(h.dispatcher.postMainThreadNotice).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.pushParentMessage).not.toHaveBeenCalled();
    });
  });

  describe('near-budget warning', () => {
    let workspace: string;
    beforeEach(() => {
      workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-warn-'));
    });
    afterEach(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
    });
    const notesPath = () =>
      path.join(workspace, '.ptah', 'subagent-handoffs', `${TOOL_CALL}.md`);
    /** 85% of the handoff size is 127 500 context tokens. */
    const atContext = (tokens: number, id: string) =>
      assistant({ input: tokens }, { id });

    it("goes once to the subagent's own agent id, keyed by its registry record, naming the notes path", async () => {
      const h = makeHarness({ agentId: 'agent-7' }, { workspace });
      await h.monitor.observe(SESSION, atContext(127_499, 'm0'));
      expect(h.dispatcher.postSubagentNotice).not.toHaveBeenCalled();

      await h.monitor.observe(SESSION, atContext(127_500, 'm1'));
      await h.monitor.observe(SESSION, atContext(130_000, 'm2'));
      await h.monitor.observe(SESSION, atContext(140_000, 'm3'));

      expect(h.dispatcher.postSubagentNotice).toHaveBeenCalledTimes(1);
      expect(h.registry.get).toHaveBeenCalledWith(TOOL_CALL);
      const warning = h.subagentNotices.take('agent-7');
      expect(warning).toContain(`write your progress notes to ${notesPath()}`);
      expect(warning).toContain('150000-token limit');
      expect(h.subagentNotices.take('agent-7')).toBeUndefined();
      expect(h.subagentNotices.take('a1')).toBeUndefined();
      expect(h.dispatcher.postMainThreadNotice).not.toHaveBeenCalled();
      expect(h.dispatcher.pushParentMessage).not.toHaveBeenCalled();
      expect(h.dispatcher.stopSubagent).not.toHaveBeenCalled();
    });

    it('waits for the registry record that maps the subagent to its agent id', async () => {
      const h = makeHarness(null, { workspace });
      await h.monitor.observe(SESSION, atContext(130_000, 'm1'));
      expect(h.dispatcher.postSubagentNotice).not.toHaveBeenCalled();

      h.registry.get.mockReturnValue({
        toolCallId: TOOL_CALL,
        agentType: 'Explore',
        agentId: 'agent-late',
        status: 'running',
        startedAt: 0,
      } as SubagentRecord);
      await h.monitor.observe(SESSION, atContext(131_000, 'm2'));

      expect(h.dispatcher.postSubagentNotice).toHaveBeenCalledTimes(1);
      expect(h.dispatcher.postSubagentNotice).toHaveBeenCalledWith(
        'agent-late',
        expect.any(String),
      );
    });

    it('is not sent without a workspace (no notes path) or with compaction disabled', async () => {
      const noWorkspace = makeHarness();
      await noWorkspace.monitor.observe(SESSION, atContext(130_000, 'm1'));
      const disabled = makeHarness({}, { workspace, enabled: false });
      await disabled.monitor.observe(SESSION, atContext(130_000, 'm1'));

      expect(noWorkspace.dispatcher.postSubagentNotice).not.toHaveBeenCalled();
      expect(disabled.dispatcher.postSubagentNotice).not.toHaveBeenCalled();
    });

    it('the hard stop names the same notes path, says it is missing when unwritten, and withdraws an undelivered warning', async () => {
      const h = makeHarness({ agentId: 'agent-7' }, { workspace });
      await h.monitor.observe(SESSION, atContext(130_000, 'm1'));
      await h.monitor.observe(SESSION, atContext(150_000, 'm2'));

      expect(h.dispatcher.withdrawSubagentNotice).toHaveBeenCalledWith(
        'agent-7',
      );
      expect(h.subagentNotices.take('agent-7')).toBeUndefined();
      expect(h.streamed).toHaveLength(1);
      expect(h.streamed[0]).toContain(
        `Its progress notes file is missing: ${notesPath()} was not written.`,
      );
    });

    it('the hard stop points the fresh subagent at the notes the warned subagent wrote', async () => {
      const h = makeHarness({ agentId: 'agent-7' }, { workspace });
      await h.monitor.observe(SESSION, atContext(130_000, 'm1'));
      fs.mkdirSync(path.dirname(notesPath()), { recursive: true });
      fs.writeFileSync(notesPath(), 'next: wire the guard');
      await h.monitor.observe(SESSION, atContext(150_000, 'm2'));

      expect(h.streamed[0]).toContain(
        `"Read ${notesPath()} first and continue from it; do not redo finished work."`,
      );
    });

    it('release drops a warning no tool result drained', async () => {
      const h = makeHarness({ agentId: 'agent-7' }, { workspace });
      await h.monitor.observe(SESSION, atContext(130_000, 'm1'));
      h.monitor.release(SESSION);

      expect(h.subagentNotices.take('agent-7')).toBeUndefined();
    });
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
