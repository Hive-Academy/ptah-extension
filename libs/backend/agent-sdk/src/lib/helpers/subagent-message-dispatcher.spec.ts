/**
 * SubagentMessageDispatcher specs.
 *
 * Verifies that:
 *   - stopSubagent wraps Query.stopTask failures in RpcUserError('TASK_NOT_FOUND')
 *   - sendToSubagent wraps streamInput failures in RpcUserError('SESSION_ENDED')
 *     and shapes the coordinator-nudge payload (SendMessage instruction when
 *     the registry record has an agentId, generic nudge otherwise)
 *   - interruptSession wraps Query.interrupt failures in RpcUserError('SESSION_ENDED')
 *   - backgroundTask delegates to Query.backgroundTasks and surfaces
 *     SESSION_NOT_FOUND / SESSION_ENDED
 */

import 'reflect-metadata';
import { RpcUserError } from '@ptah-extension/vscode-core';
import { SubagentMessageDispatcher } from './subagent-message-dispatcher';
import type { SessionLifecycleManager } from './session-lifecycle-manager';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeRegistry(
  record: { agentType: string; status?: string; agentId?: string } | null = {
    agentType: 'Explore',
  },
): SubagentRegistryService {
  return {
    get: jest.fn().mockReturnValue(record),
  } as unknown as SubagentRegistryService;
}

/**
 * Build a lifecycle mock that returns the given query object as an active session.
 */
function makeLifecycleWithQuery(query: object): SessionLifecycleManager {
  return {
    find: jest.fn().mockReturnValue({ query }),
  } as unknown as SessionLifecycleManager;
}

function buildDispatcher(
  lifecycle: SessionLifecycleManager,
  registry: SubagentRegistryService = makeRegistry(),
): SubagentMessageDispatcher {
  return new SubagentMessageDispatcher(makeLogger(), lifecycle, registry);
}

// ---------------------------------------------------------------------------
// stopSubagent — TASK_NOT_FOUND on Query.stopTask failure
// ---------------------------------------------------------------------------

describe('SubagentMessageDispatcher.stopSubagent — Fix 3', () => {
  it('throws RpcUserError(TASK_NOT_FOUND) when stopTask rejects', async () => {
    const query = {
      stopTask: jest.fn().mockRejectedValue(new Error('task not running')),
    };
    const dispatcher = buildDispatcher(makeLifecycleWithQuery(query));

    await expect(
      dispatcher.stopSubagent('sess-1', 'task-x'),
    ).rejects.toMatchObject({
      errorCode: 'TASK_NOT_FOUND',
    });

    expect(
      (await dispatcher
        .stopSubagent('sess-1', 'task-x')
        .catch((e: unknown) => e)) instanceof RpcUserError,
    ).toBe(true);
  });

  it('wraps the original error message', async () => {
    const query = {
      stopTask: jest.fn().mockRejectedValue(new Error('task already finished')),
    };
    const dispatcher = buildDispatcher(makeLifecycleWithQuery(query));

    const err = await dispatcher
      .stopSubagent('sess-1', 'task-y')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RpcUserError);
    expect((err as RpcUserError).message).toContain('task already finished');
    expect((err as RpcUserError).errorCode).toBe('TASK_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// sendToSubagent — SESSION_ENDED on streamInput failure
// ---------------------------------------------------------------------------

describe('SubagentMessageDispatcher.sendToSubagent — Fix 3', () => {
  it('throws RpcUserError(SESSION_ENDED) when streamInput rejects', async () => {
    const query = {
      streamInput: jest.fn().mockRejectedValue(new Error('stream closed')),
    };
    const dispatcher = buildDispatcher(makeLifecycleWithQuery(query));

    const err = await dispatcher
      .sendToSubagent('sess-2', 'tool-use-abc', 'hello')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RpcUserError);
    expect((err as RpcUserError).errorCode).toBe('SESSION_ENDED');
    expect((err as RpcUserError).message).toContain('stream closed');
  });
});

// ---------------------------------------------------------------------------
// sendToSubagent — coordinator-nudge payload shape
//
// There is NO direct parent→subagent input channel: the CLI ignores
// `parent_tool_use_id` on incoming streamInput messages (verified against
// claude.exe 2.1.150). Every message is always enqueued to the root
// coordinator with `parent_tool_use_id: null`; the nudge text instructs the
// coordinator to relay via the SendMessage tool keyed by agentId.
// ---------------------------------------------------------------------------

describe('SubagentMessageDispatcher.sendToSubagent — coordinator nudge', () => {
  async function captureStreamedMessage(
    registry: SubagentRegistryService,
    parentToolUseId: string,
    text: string,
  ): Promise<Record<string, unknown>> {
    let captured: Record<string, unknown> | undefined;
    const streamInput = jest.fn(
      async (stream: AsyncIterable<Record<string, unknown>>) => {
        for await (const msg of stream) {
          captured = msg;
        }
      },
    );
    const dispatcher = buildDispatcher(
      makeLifecycleWithQuery({ streamInput }),
      registry,
    );
    await dispatcher.sendToSubagent('sess-1', parentToolUseId, text);
    if (!captured) throw new Error('streamInput never received a message');
    return captured;
  }

  it('always routes to the root coordinator with parent_tool_use_id=null and origin=human', async () => {
    const msg = await captureStreamedMessage(
      makeRegistry({ agentType: 'software-architect', agentId: 'a1b2c3d' }),
      'toolu_abc',
      'please pause and check the README',
    );

    expect(msg['parent_tool_use_id']).toBeNull();
    expect(msg['origin']).toEqual({ kind: 'human' });
    expect(msg['shouldQuery']).toBe(true);
    expect(msg['session_id']).toBe('sess-1');
  });

  it('emits a SendMessage instruction keyed by agentId when a live record has an agentId', async () => {
    const msg = await captureStreamedMessage(
      makeRegistry({
        agentType: 'software-architect',
        status: 'running',
        agentId: 'a1b2c3d',
      }),
      'toolu_abc',
      'please pause and check the README',
    );

    const wireMessage = msg['message'] as { role: string; content: string };
    expect(wireMessage.role).toBe('user');
    expect(wireMessage.content).toBe(
      "The user wants to steer the running 'software-architect' subagent (id: a1b2c3d). Use the SendMessage tool with to: 'a1b2c3d' to deliver this to it verbatim: please pause and check the README",
    );
  });

  it('routes a background subagent with an agentId via the SendMessage instruction too', async () => {
    const msg = await captureStreamedMessage(
      makeRegistry({
        agentType: 'Explore',
        status: 'background',
        agentId: 'bg99999',
      }),
      'toolu_bg',
      'keep going',
    );

    expect(msg['parent_tool_use_id']).toBeNull();
    const wireMessage = msg['message'] as { role: string; content: string };
    expect(wireMessage.content).toBe(
      "The user wants to steer the running 'Explore' subagent (id: bg99999). Use the SendMessage tool with to: 'bg99999' to deliver this to it verbatim: keep going",
    );
  });

  it('falls back to a generic nudge when the registry has no record', async () => {
    const msg = await captureStreamedMessage(
      makeRegistry(null),
      'toolu_missing',
      'check on this',
    );

    const wireMessage = msg['message'] as { role: string; content: string };
    expect(wireMessage.content).toBe(
      'Regarding the running subagent (toolUseId=toolu_missing): check on this',
    );
  });

  it('falls back to a generic nudge when the record has no agentId', async () => {
    const msg = await captureStreamedMessage(
      makeRegistry({ agentType: 'Explore', status: 'running' }),
      'toolu_noid',
      'still there?',
    );

    expect(msg['parent_tool_use_id']).toBeNull();
    const wireMessage = msg['message'] as { role: string; content: string };
    expect(wireMessage.content).toBe(
      'Regarding the running subagent (toolUseId=toolu_noid): still there?',
    );
  });
});

// ---------------------------------------------------------------------------
// backgroundTask — Query.backgroundTasks delegation + error paths
// ---------------------------------------------------------------------------

describe('SubagentMessageDispatcher.backgroundTask', () => {
  it('returns the result of Query.backgroundTasks and forwards the toolUseId', async () => {
    const backgroundTasks = jest.fn().mockResolvedValue(true);
    const dispatcher = buildDispatcher(
      makeLifecycleWithQuery({ backgroundTasks }),
    );

    await expect(dispatcher.backgroundTask('sess-1', 'toolu_fg')).resolves.toBe(
      true,
    );
    expect(backgroundTasks).toHaveBeenCalledWith('toolu_fg');
  });

  it('backgrounds all foreground tasks when no toolUseId is given', async () => {
    const backgroundTasks = jest.fn().mockResolvedValue(true);
    const dispatcher = buildDispatcher(
      makeLifecycleWithQuery({ backgroundTasks }),
    );

    await expect(dispatcher.backgroundTask('sess-1')).resolves.toBe(true);
    expect(backgroundTasks).toHaveBeenCalledWith(undefined);
  });

  it('returns false when the toolUseId matched no foreground task', async () => {
    const backgroundTasks = jest.fn().mockResolvedValue(false);
    const dispatcher = buildDispatcher(
      makeLifecycleWithQuery({ backgroundTasks }),
    );

    await expect(
      dispatcher.backgroundTask('sess-1', 'toolu_none'),
    ).resolves.toBe(false);
  });

  it('throws RpcUserError(SESSION_NOT_FOUND) when the session is not active', async () => {
    const lifecycle = {
      find: jest.fn().mockReturnValue(undefined),
    } as unknown as SessionLifecycleManager;
    const dispatcher = buildDispatcher(lifecycle);

    const err = await dispatcher
      .backgroundTask('sess-missing')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RpcUserError);
    expect((err as RpcUserError).errorCode).toBe('SESSION_NOT_FOUND');
  });

  it('throws RpcUserError(SESSION_ENDED) when backgroundTasks rejects', async () => {
    const backgroundTasks = jest
      .fn()
      .mockRejectedValue(new Error('session already done'));
    const dispatcher = buildDispatcher(
      makeLifecycleWithQuery({ backgroundTasks }),
    );

    const err = await dispatcher
      .backgroundTask('sess-1', 'toolu_fg')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RpcUserError);
    expect((err as RpcUserError).errorCode).toBe('SESSION_ENDED');
    expect((err as RpcUserError).message).toContain('session already done');
  });
});

// ---------------------------------------------------------------------------
// interruptSession — SESSION_ENDED on interrupt failure
// ---------------------------------------------------------------------------

describe('SubagentMessageDispatcher.interruptSession — Fix 3', () => {
  it('throws RpcUserError(SESSION_ENDED) when interrupt rejects', async () => {
    const query = {
      interrupt: jest.fn().mockRejectedValue(new Error('session already done')),
    };
    const dispatcher = buildDispatcher(makeLifecycleWithQuery(query));

    const err = await dispatcher
      .interruptSession('sess-3')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RpcUserError);
    expect((err as RpcUserError).errorCode).toBe('SESSION_ENDED');
    expect((err as RpcUserError).message).toContain('session already done');
  });
});
