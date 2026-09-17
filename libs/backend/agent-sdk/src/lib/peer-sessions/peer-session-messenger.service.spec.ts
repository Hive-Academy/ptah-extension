import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IAgentAdapter,
  PeerSessionListResult,
  PeerSessionRow,
} from '@ptah-extension/shared';
import type { PeerSessionDirectory } from './peer-session-directory.service';
import { PeerSessionMessenger } from './peer-session-messenger.service';

const PEER_ID = 'b8fc48ad-d055-4ec1-884e-da0a3f400ca2';
const MINE = '54a3aa49-0260-4d74-8f98-0b70a3b2d0c7';

function logger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function row(overrides: Partial<PeerSessionRow> = {}): PeerSessionRow {
  return {
    sessionId: PEER_ID,
    name: 'architect-402',
    nameSource: 'user',
    workspace: 'D:\\projects\\ptah-extension',
    workspaceLabel: 'ptah-extension',
    inCurrentWorkspace: true,
    reachability: 'reachable',
    pid: 16288,
    ...overrides,
  };
}

function directoryReturning(...sessions: PeerSessionRow[]): PeerSessionDirectory {
  const result: PeerSessionListResult = {
    sessions,
    currentWorkspace: 'D:\\projects\\ptah-extension',
    crossWorkspacePolicy: 'include-all-workspaces',
    livenessVerifiable: true,
  };
  return { list: jest.fn().mockResolvedValue(result) } as unknown as PeerSessionDirectory;
}

function adapter(overrides: Partial<IAgentAdapter> = {}): IAgentAdapter {
  return {
    isSessionActive: jest.fn().mockReturnValue(true),
    sendMessageToSession: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IAgentAdapter;
}

function messenger(
  directory: PeerSessionDirectory,
  agentAdapter: IAgentAdapter | null = adapter(),
): PeerSessionMessenger {
  return new PeerSessionMessenger(logger(), directory, agentAdapter);
}

describe('PeerSessionMessenger.send — the accepted path', () => {
  it('composes the relay request into the SENDING session and reports acceptance', async () => {
    const sendMessageToSession = jest.fn().mockResolvedValue(undefined);
    const result = await messenger(
      directoryReturning(row()),
      adapter({ sendMessageToSession }),
    ).send({ sessionId: PEER_ID, fromSessionId: MINE, message: 'ship it' });

    expect(result.outcome).toBe('accepted');
    expect(result.target).toEqual({
      sessionId: PEER_ID,
      name: 'architect-402',
      workspace: 'D:\\projects\\ptah-extension',
    });
    expect(sendMessageToSession).toHaveBeenCalledTimes(1);
    // The turn goes into the sender's own session — that is the whole route.
    expect(sendMessageToSession.mock.calls[0][0]).toBe(MINE);
    expect(sendMessageToSession.mock.calls[0][1]).toContain('ship it');
  });

  it('names the route and both of its costs on the response', async () => {
    const result = await messenger(directoryReturning(row())).send({
      sessionId: PEER_ID,
      fromSessionId: MINE,
      message: 'hello',
    });

    expect(result.route).toBe('model-mediated-cli-tool');
    expect(result.costsATurn).toBe(true);
    expect(result.modelMayDecline).toBe(true);
  });

  it('carries the acceptance caveat, which denies knowledge of arrival', async () => {
    const result = await messenger(directoryReturning(row())).send({
      sessionId: PEER_ID,
      fromSessionId: MINE,
      message: 'hello',
    });

    expect(result.acceptanceCaveat).toContain('cannot observe');
    expect(result.acceptanceCaveat).toContain('Confirm');
  });
});

describe('PeerSessionMessenger.send — refusals', () => {
  it('refuses an unknown session id rather than sending anywhere', async () => {
    const sendMessageToSession = jest.fn();
    const result = await messenger(
      directoryReturning(),
      adapter({ sendMessageToSession }),
    ).send({ sessionId: PEER_ID, fromSessionId: MINE, message: 'hi' });

    expect(result).toMatchObject({
      outcome: 'refused',
      reason: 'unknown-session',
    });
    expect(sendMessageToSession).not.toHaveBeenCalled();
  });

  it('refuses an unreachable session and names why it was unreachable', async () => {
    const result = await messenger(
      directoryReturning(
        row({
          reachability: 'unreachable',
          unreachableReason: 'process-identity-mismatch',
        }),
      ),
    ).send({ sessionId: PEER_ID, fromSessionId: MINE, message: 'hi' });

    expect(result.outcome).toBe('refused');
    expect(result.reason).toBe('session-unreachable');
    expect(result.detail).toContain('process-identity-mismatch');
  });

  it('refuses a session addressing itself', async () => {
    const result = await messenger(directoryReturning(row())).send({
      sessionId: PEER_ID,
      fromSessionId: PEER_ID,
      message: 'hi',
    });

    expect(result.reason).toBe('self-addressed');
  });

  it('refuses when this host has no chat runtime to compose into', async () => {
    const result = await messenger(directoryReturning(row()), null).send({
      sessionId: PEER_ID,
      fromSessionId: MINE,
      message: 'hi',
    });

    expect(result.reason).toBe('chat-runtime-unavailable');
  });

  it('refuses when the sending session is not live', async () => {
    const result = await messenger(
      directoryReturning(row()),
      adapter({ isSessionActive: jest.fn().mockReturnValue(false) }),
    ).send({ sessionId: PEER_ID, fromSessionId: MINE, message: 'hi' });

    expect(result.reason).toBe('origin-session-not-active');
  });

  it('refuses a malformed sending session id without calling the adapter', async () => {
    const sendMessageToSession = jest.fn();
    const result = await messenger(
      directoryReturning(row()),
      adapter({ sendMessageToSession }),
    ).send({ sessionId: PEER_ID, fromSessionId: 'not-a-uuid', message: 'hi' });

    expect(result.reason).toBe('origin-session-not-active');
    expect(sendMessageToSession).not.toHaveBeenCalled();
  });

  it('reports a dispatch failure as a refusal, never as an accepted send', async () => {
    const result = await messenger(
      directoryReturning(row()),
      adapter({
        sendMessageToSession: jest
          .fn()
          .mockRejectedValue(new Error('session busy')),
      }),
    ).send({ sessionId: PEER_ID, fromSessionId: MINE, message: 'hi' });

    expect(result.outcome).toBe('refused');
    expect(result.reason).toBe('dispatch-failed');
    expect(result.detail).toBe('session busy');
  });

  it('carries the caveat on refusals too, so the limit always travels', async () => {
    const result = await messenger(directoryReturning()).send({
      sessionId: PEER_ID,
      fromSessionId: MINE,
      message: 'hi',
    });

    expect(result.acceptanceCaveat).toContain('cannot observe');
  });
});
