import 'reflect-metadata';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type {
  SessionHandoverCoordinator,
  SessionTurnStateRegistry,
} from '@ptah-extension/agent-sdk';
import type { IChildChatSessionHost } from '@ptah-extension/cli-agent-runtime';
import { MESSAGE_TYPES, type SessionHandoverState } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';

import { SessionHandoverRpcHandlers } from './session-handover-rpc.handlers';

// The real barrel reaches the tree-sitter loader, which uses `import.meta`
// and cannot load under CJS jest. The handler only needs the host token.
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    CHILD_CHAT_SESSION_HOST: Symbol.for('ChildChatSessionHost'),
  },
}));

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const OPERATION_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const SUCCESSOR_TAB_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

interface Harness {
  readonly registerMethod: jest.Mock;
  readonly coordinator: {
    begin: jest.Mock;
    cancel: jest.Mock;
    snapshotFor: jest.Mock;
    admitOrHold: jest.Mock;
    onStateChange: jest.Mock;
  };
  readonly successorHost: { acknowledgeSuccessorBound: jest.Mock };
  readonly broadcastMessage: jest.Mock;
}

function state(): SessionHandoverState {
  return {
    operationId: OPERATION_ID,
    sourceSessionId: SESSION_ID,
    reason: 'successor',
    phase: 'armed',
    revision: 3,
    heldInputCount: 0,
  };
}

function makeHarness(withCoordinator = true): Harness {
  const registerMethod = jest.fn();
  const coordinator = {
    begin: jest.fn(() => ({ accepted: true as const, state: state() })),
    cancel: jest.fn(() => []),
    snapshotFor: jest.fn(() => state()),
    admitOrHold: jest.fn(() => ({ held: true, operationId: OPERATION_ID })),
    onStateChange: jest.fn(() => () => undefined),
  };
  const successorHost = { acknowledgeSuccessorBound: jest.fn(() => true) };
  const broadcastMessage = jest.fn().mockResolvedValue(undefined);
  const handler = new SessionHandoverRpcHandlers(
    createMockLogger() as unknown as Logger,
    { registerMethod } as unknown as RpcHandler,
    (withCoordinator
      ? coordinator
      : null) as unknown as SessionHandoverCoordinator | null,
    { get: jest.fn(() => ({ phase: 'generating' })) } as unknown as SessionTurnStateRegistry,
    successorHost as unknown as IChildChatSessionHost,
    { broadcastMessage },
  );
  handler.register();
  return { registerMethod, coordinator, successorHost, broadcastMessage };
}

function registered(harness: Harness, method: string): (params: unknown) => Promise<unknown> {
  const registration = harness.registerMethod.mock.calls.find(
    ([registeredMethod]) => registeredMethod === method,
  );
  if (!registration) throw new Error(`missing ${method}`);
  return registration[1] as (params: unknown) => Promise<unknown>;
}

describe('SessionHandoverRpcHandlers', () => {
  it('registers all handover methods', () => {
    const harness = makeHarness();
    expect(harness.registerMethod.mock.calls.map(([method]) => method)).toEqual([
      'session:beginHandover',
      'session:cancelHandover',
      'session:successorBound',
      'session:getHandoverState',
    ]);
  });

  it('returns unavailable before mutating a source when no coordinator is bound', async () => {
    const harness = makeHarness(false);

    await expect(registered(harness, 'session:beginHandover')({
      sourceSessionId: SESSION_ID,
      sourceTabId: 'source-tab',
    })).resolves.toEqual({ accepted: false, error: 'unavailable' });
    expect(harness.coordinator.begin).not.toHaveBeenCalled();
  });

  it('begins a successor handover and holds composer text with the operation', async () => {
    const harness = makeHarness();

    await expect(registered(harness, 'session:beginHandover')({
      sourceSessionId: SESSION_ID,
      sourceTabId: 'source-tab',
      handoff: 'handoff notes',
      queuedInput: 'continue this work',
    })).resolves.toEqual({ accepted: true, state: state() });
    expect(harness.coordinator.begin).toHaveBeenCalledWith(
      SESSION_ID,
      'successor',
      true,
      'handoff notes',
    );
    expect(harness.coordinator.admitOrHold).toHaveBeenCalledWith(SESSION_ID, {
      content: 'continue this work',
      admission: 'require-idle',
    });
  });

  it('acknowledges only a valid successor bind correlation', async () => {
    const harness = makeHarness();

    await expect(registered(harness, 'session:successorBound')({
      operationId: OPERATION_ID,
      sourceTabId: 'source-tab',
      successorTabId: SUCCESSOR_TAB_ID,
    })).resolves.toEqual({ acknowledged: true });
    expect(harness.successorHost.acknowledgeSuccessorBound).toHaveBeenCalledWith(
      OPERATION_ID,
      'source-tab',
      SUCCESSOR_TAB_ID,
    );
  });

  it('forwards revisioned coordinator state through session:stats broadcasts', async () => {
    const harness = makeHarness();
    const listener = harness.coordinator.onStateChange.mock.calls[0][0] as (
      next: SessionHandoverState,
    ) => void;

    listener(state());
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.broadcastMessage).toHaveBeenCalledWith(MESSAGE_TYPES.SESSION_STATS, {
      sessionId: SESSION_ID,
      handover: state(),
    });
  });

  it('returns the latest coordinator handover state to a late webview', async () => {
    const harness = makeHarness();
    const latest = { ...state(), revision: 9, phase: 'awaiting-confirmation' as const };
    harness.coordinator.snapshotFor.mockReturnValue(latest);

    await expect(registered(harness, 'session:getHandoverState')({
      sourceSessionId: SESSION_ID,
    })).resolves.toEqual({ state: latest });
  });

  it('does not broadcast an older revision after a newer handover state arrives', async () => {
    const harness = makeHarness();
    const listener = harness.coordinator.onStateChange.mock.calls[0][0] as (
      next: SessionHandoverState,
    ) => void;
    const newer = { ...state(), revision: 4, phase: 'awaiting-confirmation' as const };

    listener(state());
    listener(newer);
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.broadcastMessage).toHaveBeenCalledTimes(1);
    expect(harness.broadcastMessage).toHaveBeenCalledWith(MESSAGE_TYPES.SESSION_STATS, {
      sessionId: SESSION_ID,
      handover: newer,
    });
  });
});
