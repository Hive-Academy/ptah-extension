import 'reflect-metadata';
import { RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type {
  PeerSessionDirectory,
  PeerSessionMessenger,
} from '@ptah-extension/agent-sdk';
import type {
  PeerSessionListResult,
  PeerSessionSendResult,
} from '@ptah-extension/shared';
import { ALLOWED_METHOD_PREFIXES } from '@ptah-extension/vscode-core';
import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { PeerSessionRpcHandlers } from './peer-session-rpc.handlers';

const PEER_ID = 'b8fc48ad-d055-4ec1-884e-da0a3f400ca2';
const MINE = '54a3aa49-0260-4d74-8f98-0b70a3b2d0c7';

const LIST_RESULT: PeerSessionListResult = {
  sessions: [],
  currentWorkspace: 'D:\\projects\\ptah-extension',
  crossWorkspacePolicy: 'include-all-workspaces',
  livenessVerifiable: true,
};

const SEND_RESULT: PeerSessionSendResult = {
  outcome: 'accepted',
  route: 'model-mediated-cli-tool',
  costsATurn: true,
  modelMayDecline: true,
  acceptanceCaveat: 'Accepted means …',
};

interface Harness {
  readonly handlers: PeerSessionRpcHandlers;
  readonly registered: Map<string, (params: unknown) => Promise<unknown>>;
  readonly list: jest.Mock;
  readonly send: jest.Mock;
  readonly logger: Logger;
}

const PROJECT_A = 'D:\\projects\\a';
const PROJECT_B = 'D:\\projects\\b';

/**
 * PROJECT_A is the active folder; MINE belongs to PROJECT_B.
 */
function harness(
  sessions: Record<string, { workspaceId: string }> = {
    [MINE]: { workspaceId: PROJECT_B },
  },
): Harness {
  const registered = new Map<string, (params: unknown) => Promise<unknown>>();
  const rpcHandler = {
    registerMethod: jest.fn(
      (method: string, fn: (params: unknown) => Promise<unknown>) => {
        registered.set(method, fn);
      },
    ),
  } as unknown as RpcHandler;

  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const list = jest.fn().mockResolvedValue(LIST_RESULT);
  const send = jest.fn().mockResolvedValue(SEND_RESULT);

  const handlers = new PeerSessionRpcHandlers(
    logger,
    rpcHandler,
    { list } as unknown as PeerSessionDirectory,
    { send } as unknown as PeerSessionMessenger,
    {
      get: jest.fn(async (id: string) => sessions[id] ?? null),
      // Took the workspace provider's place. Kept so the old code, which read
      // the active folder from this slot, runs and gives PROJECT_A.
      getWorkspaceRoot: () => PROJECT_A,
    } as never,
  );
  handlers.register();

  return { handlers, registered, list, send, logger };
}

describe('PeerSessionRpcHandlers — dual registration', () => {
  it('declares both methods, and both exist in the shared registry', () => {
    expect(PeerSessionRpcHandlers.METHODS).toEqual([
      'peerSession:list',
      'peerSession:send',
    ]);
    for (const method of PeerSessionRpcHandlers.METHODS) {
      expect(RPC_METHOD_NAMES).toContain(method);
    }
  });

  it('has its prefix in the runtime allowlist', () => {
    // The other half of the dual registration. Missing it makes both methods
    // silently unreachable — the transport rejects the registration.
    expect(ALLOWED_METHOD_PREFIXES).toContain('peerSession:');
  });

  it('registers both methods on the transport', () => {
    expect([...harness().registered.keys()]).toEqual([
      'peerSession:list',
      'peerSession:send',
    ]);
  });
});

describe('peerSession:list', () => {
  it("flags rows against the asking session's project, not the active folder", async () => {
    const h = harness();

    await h.registered.get('peerSession:list')?.({ excludeSessionId: MINE });

    expect(h.list).toHaveBeenCalledWith({
      currentWorkspace: PROJECT_B,
      excludeSessionId: MINE,
    });
  });

  it('omits the workspace when no session is asking', async () => {
    const h = harness();

    await h.registered.get('peerSession:list')?.({});

    expect(h.list).toHaveBeenCalledWith({});
  });

  it('omits the workspace for an unknown session instead of failing', async () => {
    const h = harness({});

    await h.registered.get('peerSession:list')?.({ excludeSessionId: MINE });

    expect(h.list).toHaveBeenCalledWith({ excludeSessionId: MINE });
  });

  it('omits the workspace when the session read fails', async () => {
    const h = harness();
    const handlers = h.handlers as unknown as {
      metadataStore: { get: jest.Mock };
    };
    handlers.metadataStore.get.mockRejectedValue(new Error('store closed'));

    await h.registered.get('peerSession:list')?.({ excludeSessionId: MINE });

    expect(h.list).toHaveBeenCalledWith({ excludeSessionId: MINE });
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it('accepts no params at all', async () => {
    const h = harness();
    await expect(
      h.registered.get('peerSession:list')?.(undefined),
    ).resolves.toEqual(LIST_RESULT);
  });

  it('rejects an unexpected field instead of dropping it', async () => {
    const h = harness();
    await expect(
      h.registered.get('peerSession:list')?.({ sessionId: PEER_ID }),
    ).rejects.toBeInstanceOf(RpcUserError);
  });
});

describe('peerSession:send', () => {
  it("forwards a valid request with the sender's project folder", async () => {
    const h = harness();

    const result = await h.registered.get('peerSession:send')?.({
      sessionId: PEER_ID,
      fromSessionId: MINE,
      message: 'ship it',
    });

    expect(h.send).toHaveBeenCalledWith({
      sessionId: PEER_ID,
      fromSessionId: MINE,
      message: 'ship it',
      currentWorkspace: PROJECT_B,
    });
    expect(result).toEqual(SEND_RESULT);
  });

  it.each([
    ['no params', undefined],
    ['a missing target', { fromSessionId: MINE, message: 'x' }],
    ['a missing sender', { sessionId: PEER_ID, message: 'x' }],
    [
      'an empty message',
      { sessionId: PEER_ID, fromSessionId: MINE, message: '' },
    ],
    [
      'an unexpected field',
      { sessionId: PEER_ID, fromSessionId: MINE, message: 'x', urgent: true },
    ],
  ])('rejects %s as an error, never a fallback', async (_label, params) => {
    const h = harness();

    await expect(
      h.registered.get('peerSession:send')?.(params),
    ).rejects.toBeInstanceOf(RpcUserError);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('rejects an over-size message rather than truncating it', async () => {
    const h = harness();

    await expect(
      h.registered.get('peerSession:send')?.({
        sessionId: PEER_ID,
        fromSessionId: MINE,
        message: 'x'.repeat(1_048_577),
      }),
    ).rejects.toBeInstanceOf(RpcUserError);
  });

  it('logs a refusal at warn so it is not invisible', async () => {
    const h = harness();
    h.send.mockResolvedValue({
      ...SEND_RESULT,
      outcome: 'refused',
      reason: 'session-unreachable',
    });

    await h.registered.get('peerSession:send')?.({
      sessionId: PEER_ID,
      fromSessionId: MINE,
      message: 'x',
    });

    expect(h.logger.warn).toHaveBeenCalledWith(
      '[peerSession] send refused',
      expect.objectContaining({ reason: 'session-unreachable' }),
    );
  });
});
