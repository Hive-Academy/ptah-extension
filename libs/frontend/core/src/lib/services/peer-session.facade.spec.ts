import { TestBed } from '@angular/core/testing';
import type {
  PeerSessionListParams,
  PeerSessionListResult,
  PeerSessionRow,
  PeerSessionSendParams,
  PeerSessionSendResult,
} from '@ptah-extension/shared';
import { PeerSessionFacade } from './peer-session.facade';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';

function rpcSuccess<T>(data: T): RpcResult<T> {
  return new RpcResult<T>(true, data, undefined, undefined);
}

function rpcError(message: string): RpcResult<never> {
  return new RpcResult<never>(false, undefined, message);
}

function buildMockRpc() {
  return {
    call: jest.fn(),
    handledMessageTypes: [],
    handleMessage: jest.fn(),
  };
}

const mockReachableRow: PeerSessionRow = {
  sessionId: 'session-1',
  name: 'ptah-main-task-402',
  nameSource: 'user',
  workspace: 'D:\\projects\\alpha',
  workspaceLabel: 'alpha',
  inCurrentWorkspace: true,
  reachability: 'reachable',
  pid: 1234,
};

const mockUnreachableRow: PeerSessionRow = {
  sessionId: 'session-2',
  name: 'ptah-other-worker',
  nameSource: 'derived',
  workspace: 'D:\\projects\\beta',
  workspaceLabel: 'beta',
  inCurrentWorkspace: false,
  reachability: 'unreachable',
  unreachableReason: 'process-not-running',
  pid: 5678,
};

const mockListResult: PeerSessionListResult = {
  sessions: [mockReachableRow, mockUnreachableRow],
  currentWorkspace: 'D:\\projects\\alpha',
  crossWorkspacePolicy: 'include-all-workspaces',
  livenessVerifiable: true,
};

const mockAcceptedSendResult: PeerSessionSendResult = {
  outcome: 'accepted',
  route: 'model-mediated-cli-tool',
  costsATurn: true,
  modelMayDecline: true,
  acceptanceCaveat:
    'Accepted by transport. Message will be composed as a model turn.',
  target: {
    sessionId: 'session-1',
    name: 'ptah-main-task-402',
    workspace: 'D:\\projects\\alpha',
  },
};

const mockRefusedSendResult: PeerSessionSendResult = {
  outcome: 'refused',
  route: 'model-mediated-cli-tool',
  costsATurn: true,
  modelMayDecline: true,
  acceptanceCaveat:
    'Send was refused before composition.',
  reason: 'session-unreachable',
  detail: 'Target session is not reachable',
  target: {
    sessionId: 'session-2',
    name: 'ptah-other-worker',
    workspace: 'D:\\projects\\beta',
  },
};

describe('PeerSessionFacade', () => {
  let facade: PeerSessionFacade;
  let mockRpc: ReturnType<typeof buildMockRpc>;

  beforeEach(() => {
    mockRpc = buildMockRpc();
    TestBed.configureTestingModule({
      providers: [
        PeerSessionFacade,
        { provide: ClaudeRpcService, useValue: mockRpc },
      ],
    });
    facade = TestBed.inject(PeerSessionFacade);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── Initial State ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts with default signals', () => {
      expect(facade.isLoading()).toBe(false);
      expect(facade.sessions()).toEqual([]);
      expect(facade.currentWorkspace()).toBeNull();
      expect(facade.crossWorkspacePolicy()).toBeNull();
      expect(facade.livenessVerifiable()).toBe(true);
      expect(facade.error()).toBeNull();
      expect(facade.isSending()).toBe(false);
      expect(facade.lastSendResult()).toBeNull();
    });
  });

  // ── fetchSessions ─────────────────────────────────────────────────────────

  describe('fetchSessions', () => {
    it('populates sessions and metadata on RPC success', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockListResult));

      const result = await facade.fetchSessions();

      expect(mockRpc.call).toHaveBeenCalledWith('peerSession:list', {});
      expect(result).toEqual(mockListResult);
      expect(facade.sessions()).toEqual(mockListResult.sessions);
      expect(facade.currentWorkspace()).toBe('D:\\projects\\alpha');
      expect(facade.crossWorkspacePolicy()).toBe('include-all-workspaces');
      expect(facade.livenessVerifiable()).toBe(true);
      expect(facade.isLoading()).toBe(false);
      expect(facade.error()).toBeNull();
    });

    it('passes params like excludeSessionId to RPC call', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockListResult));
      const params: PeerSessionListParams = { excludeSessionId: 'my-session' };

      await facade.fetchSessions(params);

      expect(mockRpc.call).toHaveBeenCalledWith('peerSession:list', params);
    });

    it('faithfully preserves unreachable rows without re-deriving reachability', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockListResult));

      await facade.fetchSessions();

      const unreachable = facade.sessions().find((s) => s.reachability === 'unreachable');
      expect(unreachable).toBeDefined();
      expect(unreachable?.sessionId).toBe('session-2');
      expect(unreachable?.unreachableReason).toBe('process-not-running');
    });

    it('faithfully preserves cross-workspace rows without re-filtering', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockListResult));

      await facade.fetchSessions();

      const crossWs = facade.sessions().find((s) => !s.inCurrentWorkspace);
      expect(crossWs).toBeDefined();
      expect(crossWs?.workspace).toBe('D:\\projects\\beta');
    });

    it('skips concurrent fetch when isLoading is already true', async () => {
      let resolveFirst!: (value: RpcResult<PeerSessionListResult>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<PeerSessionListResult>>((res) => {
          resolveFirst = res;
        }),
      );

      const first = facade.fetchSessions();
      const second = facade.fetchSessions();

      expect(facade.isLoading()).toBe(true);
      resolveFirst(rpcSuccess(mockListResult));

      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult).toEqual(mockListResult);
      expect(secondResult).toBeNull();
      expect(mockRpc.call).toHaveBeenCalledTimes(1);
    });

    it('bypasses loading guard when options.force is true', async () => {
      let resolveFirst!: (value: RpcResult<PeerSessionListResult>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<PeerSessionListResult>>((res) => {
          resolveFirst = res;
        }),
      );

      const first = facade.fetchSessions();
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockListResult));
      const second = facade.fetchSessions(undefined, { force: true });

      resolveFirst(rpcSuccess({ ...mockListResult, sessions: [] }));
      const [firstResult, secondResult] = await Promise.all([first, second]);

      // The first call was superseded by the force call bumping generation
      expect(firstResult).toBeNull();
      expect(secondResult).toEqual(mockListResult);
      expect(facade.sessions()).toEqual(mockListResult.sessions);
      expect(mockRpc.call).toHaveBeenCalledTimes(2);
    });

    it('sets error and resets sessions when RPC returns failure', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      mockRpc.call.mockResolvedValueOnce(rpcError('Backend listing error'));

      const result = await facade.fetchSessions();

      expect(result).toBeNull();
      expect(facade.error()).toBe('Backend listing error');
      expect(facade.sessions()).toEqual([]);
      expect(facade.isLoading()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PeerSessionFacade]'),
        'Backend listing error',
      );
      warnSpy.mockRestore();
    });

    it('catches thrown Error, sets error signal, and resets sessions', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockRpc.call.mockRejectedValueOnce(new Error('Network disconnected'));

      const result = await facade.fetchSessions();

      expect(result).toBeNull();
      expect(facade.error()).toBe('Network disconnected');
      expect(facade.sessions()).toEqual([]);
      expect(facade.isLoading()).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('handles non-Error rejection gracefully', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockRpc.call.mockRejectedValueOnce('raw string error');

      const result = await facade.fetchSessions();

      expect(result).toBeNull();
      expect(facade.error()).toBe('Failed to fetch peer sessions');
      expect(facade.sessions()).toEqual([]);
      errorSpy.mockRestore();
    });
  });

  // ── refreshSessions ───────────────────────────────────────────────────────

  describe('refreshSessions', () => {
    it('forces a fresh fetch using force option', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockListResult));

      const result = await facade.refreshSessions({ excludeSessionId: 'current' });

      expect(mockRpc.call).toHaveBeenCalledWith('peerSession:list', {
        excludeSessionId: 'current',
      });
      expect(result).toEqual(mockListResult);
    });
  });

  // ── searchSessions ────────────────────────────────────────────────────────

  describe('searchSessions', () => {
    beforeEach(async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockListResult));
      await facade.fetchSessions();
    });

    it('returns all sessions when query is empty', () => {
      const matches = facade.searchSessions('');
      expect(matches).toEqual(mockListResult.sessions);
    });

    it('filters by session name (case-insensitive)', () => {
      const matches = facade.searchSessions('TASK-402');
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe('ptah-main-task-402');
    });

    it('filters by workspaceLabel', () => {
      const matches = facade.searchSessions('beta');
      expect(matches).toHaveLength(1);
      expect(matches[0].workspaceLabel).toBe('beta');
    });

    it('filters by workspace path', () => {
      const matches = facade.searchSessions('projects\\alpha');
      expect(matches).toHaveLength(1);
      expect(matches[0].workspace).toBe('D:\\projects\\alpha');
    });

    it('returns empty array when no session matches', () => {
      const matches = facade.searchSessions('non-existent-session-name');
      expect(matches).toHaveLength(0);
    });
  });

  // ── send / sendMessage ────────────────────────────────────────────────────

  describe('send and sendMessage', () => {
    const sendParams: PeerSessionSendParams = {
      sessionId: 'session-1',
      fromSessionId: 'session-0',
      message: 'Hello peer agent',
    };

    it('returns accepted outcome with unmodified caveat on transport acceptance', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockAcceptedSendResult));

      const promise = facade.send(sendParams);
      expect(facade.isSending()).toBe(true);

      const result = await promise;

      expect(mockRpc.call).toHaveBeenCalledWith('peerSession:send', sendParams);
      expect(result.outcome).toBe('accepted');
      expect(result.acceptanceCaveat).toBe(mockAcceptedSendResult.acceptanceCaveat);
      expect(result.costsATurn).toBe(true);
      expect(result.modelMayDecline).toBe(true);
      expect(facade.lastSendResult()).toEqual(mockAcceptedSendResult);
      expect(facade.isSending()).toBe(false);
      expect(facade.error()).toBeNull();
    });

    it('returns refused outcome with unmodified caveat and reason', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockRefusedSendResult));

      const result = await facade.send(sendParams);

      expect(result.outcome).toBe('refused');
      expect(result.reason).toBe('session-unreachable');
      expect(result.acceptanceCaveat).toBe(mockRefusedSendResult.acceptanceCaveat);
      expect(facade.lastSendResult()).toEqual(mockRefusedSendResult);
      expect(facade.isSending()).toBe(false);
    });

    it('sets error and throws when RPC returns failure', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcError('Dispatch error'));

      await expect(facade.send(sendParams)).rejects.toThrow('Dispatch error');

      expect(facade.error()).toBe('Dispatch error');
      expect(facade.isSending()).toBe(false);
    });

    it('sets error and throws when RPC rejects with Error', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockRpc.call.mockRejectedValueOnce(new Error('RPC call timed out'));

      await expect(facade.send(sendParams)).rejects.toThrow('RPC call timed out');

      expect(facade.error()).toBe('RPC call timed out');
      expect(facade.isSending()).toBe(false);
      errorSpy.mockRestore();
    });

    it('sendMessage delegates to send', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess(mockAcceptedSendResult));

      const result = await facade.sendMessage(sendParams);

      expect(mockRpc.call).toHaveBeenCalledWith('peerSession:send', sendParams);
      expect(result).toEqual(mockAcceptedSendResult);
    });
  });

  // ── clear ─────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('resets sessions, currentWorkspace, crossWorkspacePolicy, error and cancels in-flight fetch', async () => {
      let resolveFetch!: (value: RpcResult<PeerSessionListResult>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<PeerSessionListResult>>((res) => {
          resolveFetch = res;
        }),
      );

      const inFlight = facade.fetchSessions();
      expect(facade.isLoading()).toBe(true);

      facade.clear();

      expect(facade.sessions()).toEqual([]);
      expect(facade.currentWorkspace()).toBeNull();
      expect(facade.crossWorkspacePolicy()).toBeNull();
      expect(facade.error()).toBeNull();
      expect(facade.isLoading()).toBe(false);

      resolveFetch(rpcSuccess(mockListResult));
      const result = await inFlight;

      expect(result).toBeNull();
      expect(facade.sessions()).toEqual([]);
    });
  });
});
