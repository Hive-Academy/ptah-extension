/**
 * SubagentMessageDispatcher specs — Fix 3 error path coverage.
 *
 * Verifies that:
 *   - stopSubagent wraps Query.stopTask failures in RpcUserError('TASK_NOT_FOUND')
 *   - sendToSubagent wraps streamInput failures in RpcUserError('SESSION_ENDED')
 *   - interruptSession wraps Query.interrupt failures in RpcUserError('SESSION_ENDED')
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

function makeRegistry(): SubagentRegistryService {
  return {} as unknown as SubagentRegistryService;
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
): SubagentMessageDispatcher {
  return new SubagentMessageDispatcher(makeLogger(), lifecycle, makeRegistry());
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
