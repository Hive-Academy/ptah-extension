/**
 * ProviderCarryOverService specs (TASK_2026_865, Batch 6).
 *
 * Harness: a mocked `ClaudeRpcService` whose responses are deferred promises
 * resolved by each case, the real `AuthStateService` banner signal, a stub
 * `TabManagerService` backed by a tab map, and a stub `ActionBannerService`.
 * The host side (`chat:carry-over-check`, `chat:carry-over`) is mocked.
 */
import { TestBed } from '@angular/core/testing';
import {
  AuthStateService,
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  PlanLimitsStore,
  VSCodeService,
  type RpcResult,
} from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import {
  CHAT_ADMISSION_RPC_TIMEOUT_MS,
  type ChatCarryOverCheckResult,
  type ChatCarryOverResult,
  type SessionId,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ActionBannerService } from './action-banner.service';
import {
  CARRY_OVER_BUSY_TEXT,
  CARRY_OVER_CHECK_TIMEOUT_MS,
  CARRY_OVER_EXPIRED_TEXT,
  CARRY_OVER_LATE_RESOLUTION_MS,
  CARRY_OVER_NOTICE_MS,
  CARRY_OVER_RECOVERY_MS,
  CARRY_OVER_START_FAILED_TEXT,
  CARRY_OVER_UNREADABLE_TEXT,
  ProviderCarryOverService,
  carryOverNotice,
  type CarryOverOffer,
} from './provider-carry-over.service';

const OLD = '11111111-1111-4111-8111-111111111111' as SessionId;
const NEW = '22222222-2222-4222-8222-222222222222' as SessionId;
const OTHER = '33333333-3333-4333-8333-333333333333' as SessionId;
const RETRY = '44444444-4444-4444-8444-444444444444' as SessionId;
const TAB = 'tab-refused';
const TAB_B = 'tab-other';
const WS = '/work/project';
const ORIGIN = { sessionId: OLD, tabId: TAB, workspacePath: WS };
const ELIGIBLE: ChatCarryOverCheckResult = {
  eligible: true,
  providerId: 'openai-codex',
  providerName: 'Codex',
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface RecordedCall {
  method: string;
  params: unknown;
  options?: { timeout?: number };
}

describe('ProviderCarryOverService', () => {
  let rpc: MockRpcService;
  let calls: RecordedCall[];
  let responders: Record<string, Array<Deferred<RpcResult<unknown>>>>;
  let tabs: Map<string, { id: string; claudeSessionId: SessionId | null; name: string }>;
  let showInfo: jest.Mock;
  let auth: AuthStateService;
  let service: ProviderCarryOverService;

  /** Queue a deferred response for the next call of `method`. */
  function expectCall<T>(method: string): Deferred<RpcResult<T>> {
    const d = deferred<RpcResult<T>>();
    (responders[method] ??= []).push(d as Deferred<RpcResult<unknown>>);
    return d;
  }

  function callsOf(method: string): RecordedCall[] {
    return calls.filter((c) => c.method === method);
  }

  /** Let pending microtasks (awaited RPCs) run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  function failure(
    reason: Extract<ChatCarryOverResult, { success: false }>['reason'],
    extra: Partial<Extract<ChatCarryOverResult, { success: false }>> = {},
  ): RpcResult<ChatCarryOverResult> {
    return rpcSuccess<ChatCarryOverResult>({
      success: false,
      reason,
      error: `host ${reason}`,
      ...extra,
    });
  }

  const SUCCESS = rpcSuccess<ChatCarryOverResult>({
    success: true,
    providerId: 'openai-codex',
    providerName: 'Codex',
  });

  /** Flag a refusal for TAB/OLD and resolve its eligibility check. */
  async function offerReady(message = 'Sign in to Claude'): Promise<CarryOverOffer> {
    const generation = auth.flagAuthRequired('anthropic', message, ORIGIN);
    const check = expectCall<ChatCarryOverCheckResult>('chat:carry-over-check');
    const pending = service.offerFor(generation);
    check.resolve(rpcSuccess(ELIGIBLE));
    await pending;
    const offer = service.offer();
    if (!offer) throw new Error('expected an offer');
    return offer;
  }

  beforeEach(() => {
    calls = [];
    responders = {};
    tabs = new Map([
      [TAB, { id: TAB, claudeSessionId: OLD, name: 'Refused chat' }],
      [TAB_B, { id: TAB_B, claudeSessionId: OTHER, name: 'Other chat' }],
    ]);
    showInfo = jest.fn();
    rpc = createMockRpcService();
    rpc.call.mockImplementation((async (
      method: string,
      params: unknown,
      options?: { timeout?: number },
    ) => {
      calls.push({ method, params, options });
      const next = responders[method]?.shift();
      if (next) return next.promise;
      return rpcSuccess(undefined);
    }) as unknown as MockRpcService['call']);

    TestBed.configureTestingModule({
      providers: [
        ProviderCarryOverService,
        AuthStateService,
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: ModelStateService, useValue: { refreshModels: jest.fn() } },
        { provide: EffortStateService, useValue: { refreshEffort: jest.fn() } },
        { provide: PlanLimitsStore, useValue: { load: jest.fn() } },
        { provide: VSCodeService, useValue: { isElectron: true } },
        { provide: ActionBannerService, useValue: { showInfo } },
        {
          provide: TabManagerService,
          useValue: {
            activeTabId: () => TAB_B,
            findTabByIdAcrossWorkspaces: (tabId: string) => {
              const tab = tabs.get(tabId);
              return tab ? { tab, workspacePath: WS } : null;
            },
          },
        },
      ],
    });
    auth = TestBed.inject(AuthStateService);
    service = TestBed.inject(ProviderCarryOverService);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('offerFor', () => {
    it('makes the same decision when only the refusal text differs (AC 1.4)', async () => {
      const first = await offerReady('Claude needs sign-in');
      auth.clearAuthRequiredBanner();
      const second = await offerReady('A completely different refusal text');

      const checks = callsOf('chat:carry-over-check');
      expect(checks).toHaveLength(2);
      expect(checks[0].params).toEqual(checks[1].params);
      const { generation: g1, ...rest1 } = first;
      const { generation: g2, ...rest2 } = second;
      expect(rest1).toEqual(rest2);
      expect(g2).toBeGreaterThan(g1);
    });

    it('carries the four identity fields and the generation (AC 7.1)', async () => {
      const offer = await offerReady();
      expect(callsOf('chat:carry-over-check')[0].params).toEqual({
        sessionId: OLD,
        workspacePath: WS,
      });
      expect(offer).toEqual({
        generation: auth.authRequiredBanner()?.generation,
        sessionId: OLD,
        tabId: TAB,
        workspacePath: WS,
        providerId: 'openai-codex',
        providerName: 'Codex',
      });
    });

    it('makes no offer when the session is not eligible (AC 1.2)', async () => {
      const generation = auth.flagAuthRequired('anthropic', 'x', ORIGIN);
      const check = expectCall<ChatCarryOverCheckResult>('chat:carry-over-check');
      const pending = service.offerFor(generation);
      check.resolve(rpcSuccess({ eligible: false }));
      await pending;
      expect(service.offer()).toBeNull();
    });

    it('makes no offer when the check fails (AC 1.3)', async () => {
      const generation = auth.flagAuthRequired('anthropic', 'x', ORIGIN);
      const check = expectCall<ChatCarryOverCheckResult>('chat:carry-over-check');
      const pending = service.offerFor(generation);
      check.resolve(rpcError('RPC timeout: chat:carry-over-check'));
      await pending;
      expect(service.offer()).toBeNull();
    });

    it('makes no offer when a newer refusal replaced the banner during the check (AC 1.6)', async () => {
      const generation = auth.flagAuthRequired('anthropic', 'x', ORIGIN);
      const check = expectCall<ChatCarryOverCheckResult>('chat:carry-over-check');
      const pending = service.offerFor(generation);
      auth.flagAuthRequired('anthropic', 'newer', ORIGIN);
      check.resolve(rpcSuccess(ELIGIBLE));
      await pending;
      expect(service.offer()).toBeNull();
    });

    it('sends no check for a stale generation or a banner without origin', async () => {
      const stale = auth.flagAuthRequired('anthropic', 'x', ORIGIN);
      auth.flagAuthRequired('anthropic', 'y', ORIGIN);
      await service.offerFor(stale);
      const noOrigin = auth.flagAuthRequired('anthropic', 'start refusal');
      await service.offerFor(noOrigin);
      expect(callsOf('chat:carry-over-check')).toHaveLength(0);
    });

    it('a cleared banner hides the offer and never revives it (P8)', async () => {
      await offerReady();
      auth.clearAuthRequiredBanner();
      expect(service.offer()).toBeNull();
      auth.flagAuthRequired('anthropic', 'later refusal', ORIGIN);
      expect(service.offer()).toBeNull();
    });
  });

  describe('start (button) click checks', () => {
    it('sends nothing for a stale generation and drops the offer (AC 7.2)', async () => {
      const offer = await offerReady();
      auth.flagAuthRequired('anthropic', 'newer', ORIGIN);
      await service.start(offer);
      expect(callsOf('chat:carry-over')).toHaveLength(0);
      expect(service.isPending(TAB)).toBe(false);
    });

    it('a closed refused tab sends nothing and clears the banner (AC 4.5)', async () => {
      const offer = await offerReady();
      tabs.delete(TAB);
      await service.start(offer);
      expect(callsOf('chat:carry-over')).toHaveLength(0);
      expect(auth.authRequiredBanner()).toBeNull();
      expect(service.offer()).toBeNull();
    });

    it('a rebound tab sends nothing and drops the offer, keeping the banner (AC 7.2)', async () => {
      const offer = await offerReady();
      tabs.set(TAB, { id: TAB, claudeSessionId: OTHER, name: 'x' });
      await service.start(offer);
      expect(callsOf('chat:carry-over')).toHaveLength(0);
      expect(service.offer()).toBeNull();
      expect(auth.authRequiredBanner()?.generation).toBe(offer.generation);
    });

    it('a double click sends one request (AC 5.4)', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const first = service.start(offer);
      const second = service.start(offer);
      await second;
      expect(callsOf('chat:carry-over')).toHaveLength(1);
      expect(service.isPending(TAB)).toBe(true);
      expect(service.isBusy(OLD)).toBe(true);
      expect(service.offer()).toEqual(offer);
      launch.resolve(SUCCESS);
      await first;
    });

    it('names the refused session and tab, not the tab in view (AC 7.1, 7.3)', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      launch.resolve(SUCCESS);
      await started;
      const [call] = callsOf('chat:carry-over');
      expect(call.params).toEqual({
        sessionId: OLD,
        tabId: TAB,
        workspacePath: WS,
        name: 'Refused chat',
        ptahUiFence: true,
      });
      expect(call.options).toEqual({ timeout: CHAT_ADMISSION_RPC_TIMEOUT_MS });
    });
  });

  describe('success and binding', () => {
    it('keeps the tab busy until the bind and shows the notice only after completeBinding (AC 4.3, 4.4)', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      launch.resolve(SUCCESS);
      await started;

      expect(service.isPending(TAB)).toBe(true);
      expect(showInfo).not.toHaveBeenCalled();
      expect(auth.authRequiredBanner()).not.toBeNull();

      expect(service.claimSessionResolution(TAB, NEW)).toBe('bind');
      expect(service.isPending(TAB)).toBe(true);
      service.completeBinding(TAB);

      expect(showInfo).toHaveBeenCalledTimes(1);
      expect(showInfo).toHaveBeenCalledWith(
        carryOverNotice('Codex'),
        TAB,
        CARRY_OVER_NOTICE_MS,
      );
      expect(carryOverNotice('Codex')).toBe(
        "Continued with Codex in a new chat from a summary of this conversation. The original conversation is unchanged. This conversation's text was sent to Codex.",
      );
      expect(auth.authRequiredBanner()).toBeNull();
      expect(service.offer()).toBeNull();
      expect(service.isPending(TAB)).toBe(false);
    });

    it('completeBinding twice shows one notice', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      launch.resolve(SUCCESS);
      await started;
      service.completeBinding(TAB);
      service.completeBinding(TAB);
      expect(showInfo).toHaveBeenCalledTimes(1);
    });

    it('a resolution of the old id returns none and keeps the entry', async () => {
      const offer = await offerReady();
      expectCall<ChatCarryOverResult>('chat:carry-over');
      void service.start(offer);
      await flush();
      expect(service.claimSessionResolution(TAB, OLD)).toBe('none');
      expect(service.claimSessionResolution(TAB_B, NEW)).toBe('none');
      expect(service.isPending(TAB)).toBe(true);
    });
  });

  describe('deferred races (AC 7.8)', () => {
    it('a tab switch after the click still binds only the refused tab (AC 7.4)', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      // The tab in view is TAB_B throughout; it is never named or claimed.
      launch.resolve(SUCCESS);
      await started;
      expect(service.claimSessionResolution(TAB_B, NEW)).toBe('none');
      expect(service.claimSessionResolution(TAB, NEW)).toBe('bind');
      service.completeBinding(TAB);
      expect(showInfo).toHaveBeenCalledWith(expect.any(String), TAB, CARRY_OVER_NOTICE_MS);
    });

    it('a newer refusal mid-flight survives the completion (AC 7.5)', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      await flush();
      const newer = auth.flagAuthRequired('anthropic', 'newer refusal', {
        ...ORIGIN,
        tabId: TAB_B,
        sessionId: OTHER,
      });
      launch.resolve(SUCCESS);
      await started;
      expect(service.claimSessionResolution(TAB, NEW)).toBe('bind');
      service.completeBinding(TAB);
      expect(auth.authRequiredBanner()).toEqual(
        expect.objectContaining({ generation: newer, message: 'newer refusal' }),
      );
      expect(showInfo).toHaveBeenCalledTimes(1);
      expect(showInfo.mock.calls[0][1]).toBe(TAB);
    });

    it('a tab closed mid-flight is skipped with no abort (AC 7.6)', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      await flush();
      tabs.delete(TAB);
      launch.resolve(SUCCESS);
      await started;
      expect(service.claimSessionResolution(TAB, NEW)).toBe('skip');
      expect(service.isPending(TAB)).toBe(false);
      expect(callsOf('chat:abort')).toHaveLength(0);
      service.completeBinding(TAB);
      expect(showInfo).not.toHaveBeenCalled();
    });

    it('a tab rebound mid-flight is skipped and the new session aborted (AC 7.7)', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      await flush();
      tabs.set(TAB, { id: TAB, claudeSessionId: OTHER, name: 'x' });
      launch.resolve(SUCCESS);
      await started;
      expect(service.claimSessionResolution(TAB, NEW)).toBe('skip');
      expect(callsOf('chat:abort').map((c) => c.params)).toEqual([{ sessionId: NEW }]);
      expect(service.isPending(TAB)).toBe(false);
      expect(showInfo).not.toHaveBeenCalled();
    });

    it('a resolution that arrives before the RPC returns still binds', async () => {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      await flush();
      expect(service.claimSessionResolution(TAB, NEW)).toBe('bind');
      service.completeBinding(TAB);
      launch.resolve(SUCCESS);
      await started;
      expect(service.isPending(TAB)).toBe(false);
      expect(showInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure mappings (button)', () => {
    async function failWith(result: RpcResult<ChatCarryOverResult>): Promise<CarryOverOffer> {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      launch.resolve(result);
      await started;
      return offer;
    }

    it('HISTORY_UNREADABLE replaces the banner with the fixed text and removes the button (AC 5.1)', async () => {
      const offer = await failWith(failure('HISTORY_UNREADABLE'));
      const banner = auth.authRequiredBanner();
      expect(banner?.message).toBe(CARRY_OVER_UNREADABLE_TEXT);
      expect(banner?.providerId).toBe('anthropic');
      expect(banner?.origin).toEqual(ORIGIN);
      expect(banner?.generation).toBeGreaterThan(offer.generation);
      expect(service.offer()).toBeNull();
      expect(service.isPending(TAB)).toBe(false);
      expect(showInfo).not.toHaveBeenCalled();
    });

    it('START_FAILED flags the active provider refusal (AC 5.2)', async () => {
      await failWith(
        failure('START_FAILED', {
          errorCode: 'AUTH_REQUIRED',
          providerId: 'openai-codex',
          error: 'Codex needs sign-in.',
        }),
      );
      expect(auth.authRequiredBanner()).toEqual(
        expect.objectContaining({
          providerId: 'openai-codex',
          message: 'Codex needs sign-in.',
          origin: ORIGIN,
        }),
      );
      expect(service.offer()).toBeNull();
      expect(service.isPending(TAB)).toBe(false);
      expect(tabs.get(TAB)?.claudeSessionId).toBe(OLD);
    });

    it('NOT_ELIGIBLE drops the offer and keeps the banner', async () => {
      const offer = await failWith(failure('NOT_ELIGIBLE'));
      expect(service.offer()).toBeNull();
      expect(auth.authRequiredBanner()?.generation).toBe(offer.generation);
      expect(service.isPending(TAB)).toBe(false);
    });

    it('IN_FLIGHT changes no UI and releases the tab', async () => {
      const offer = await failWith(failure('IN_FLIGHT'));
      expect(service.offer()).toEqual(offer);
      expect(auth.authRequiredBanner()?.generation).toBe(offer.generation);
      expect(service.isPending(TAB)).toBe(false);
    });

    it.each(['HISTORY_UNREADABLE', 'START_FAILED'] as const)(
      'a newer refusal survives a late %s (F2)',
      async (reason) => {
        const offer = await offerReady();
        const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
        const started = service.start(offer);
        await flush();
        const newer = auth.flagAuthRequired('anthropic', 'newer refusal', ORIGIN);
        launch.resolve(failure(reason));
        await started;
        expect(auth.authRequiredBanner()).toEqual(
          expect.objectContaining({ generation: newer, message: 'newer refusal' }),
        );
        expect(service.isPending(TAB)).toBe(false);
      },
    );

    it.each(['HISTORY_UNREADABLE', 'START_FAILED'] as const)(
      'a rebound tab keeps its banner on a late %s',
      async (reason) => {
        const offer = await offerReady();
        const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
        const started = service.start(offer);
        await flush();
        tabs.set(TAB, { id: TAB, claudeSessionId: OTHER, name: 'x' });
        launch.resolve(failure(reason));
        await started;
        expect(auth.authRequiredBanner()?.generation).toBe(offer.generation);
        expect(auth.authRequiredBanner()?.message).toBe('Sign in to Claude');
      },
    );

    it('a transport timeout keeps the entry until onChatError releases it', async () => {
      await failWith(rpcError('RPC timeout: chat:carry-over'));
      expect(service.isPending(TAB)).toBe(true);
      expect(service.isBusy(OLD)).toBe(true);
      service.onChatError(TAB_B);
      expect(service.isPending(TAB)).toBe(true);
      service.onChatError(TAB);
      expect(service.isPending(TAB)).toBe(false);
      expect(showInfo).not.toHaveBeenCalled();
    });

    it('an unresolved entry of a closed tab is dropped at the next launch', async () => {
      await failWith(rpcError('RPC timeout: chat:carry-over'));
      tabs.delete(TAB);
      tabs.set('tab-new', { id: 'tab-new', claudeSessionId: OLD, name: 'Reopened' });
      expectCall<ChatCarryOverCheckResult>('chat:carry-over-check').resolve(
        rpcSuccess(ELIGIBLE),
      );
      expectCall<ChatCarryOverResult>('chat:carry-over').resolve(SUCCESS);
      const result = await service.tryCompact({
        sessionId: OLD,
        tabId: 'tab-new',
        workspacePath: WS,
      });
      expect(result).toEqual({ success: true });
      expect(service.isPending(TAB)).toBe(false);
    });
  });

  describe('/compact trigger', () => {
    const COMPACT = {
      sessionId: OLD,
      tabId: TAB,
      workspacePath: WS,
      name: 'Refused chat',
      providerId: 'openai-codex',
      providerName: 'Codex',
    };

    it('with no banner: success binds, shows the notice and clears no banner (AC 9.4, 8.4)', async () => {
      const clear = jest.spyOn(auth, 'clearAuthRequiredBanner');
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.startFromCompact(COMPACT);
      expect(service.isPending(TAB)).toBe(true);
      launch.resolve(SUCCESS);
      expect(await started).toEqual({ success: true });
      expect(showInfo).not.toHaveBeenCalled();
      expect(service.claimSessionResolution(TAB, NEW)).toBe('bind');
      service.completeBinding(TAB);
      expect(showInfo).toHaveBeenCalledWith(carryOverNotice('Codex'), TAB, CARRY_OVER_NOTICE_MS);
      expect(clear).not.toHaveBeenCalled();
    });

    it('with a matching banner: success clears that banner and its offer', async () => {
      await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.startFromCompact(COMPACT);
      launch.resolve(SUCCESS);
      await started;
      service.completeBinding(TAB);
      expect(auth.authRequiredBanner()).toBeNull();
      expect(service.offer()).toBeNull();
    });

    it('with another tab\'s banner: success leaves that banner', async () => {
      const other = auth.flagAuthRequired('anthropic', 'other', {
        sessionId: OTHER,
        tabId: TAB_B,
        workspacePath: WS,
      });
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.startFromCompact(COMPACT);
      launch.resolve(SUCCESS);
      await started;
      service.completeBinding(TAB);
      expect(auth.authRequiredBanner()?.generation).toBe(other);
    });

    it('NOT_ELIGIBLE gives not-eligible', async () => {
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.startFromCompact(COMPACT);
      launch.resolve(failure('NOT_ELIGIBLE'));
      expect(await started).toBe('not-eligible');
      expect(service.isPending(TAB)).toBe(false);
    });

    it('HISTORY_UNREADABLE without a banner gives the fixed-text outcome (AC 5.1)', async () => {
      const flag = jest.spyOn(auth, 'flagAuthRequired');
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.startFromCompact(COMPACT);
      launch.resolve(failure('HISTORY_UNREADABLE'));
      expect(await started).toEqual({
        success: false,
        error: CARRY_OVER_UNREADABLE_TEXT,
      });
      expect(flag).not.toHaveBeenCalled();
    });

    it('HISTORY_UNREADABLE with the tab\'s own banner replaces that banner', async () => {
      await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.startFromCompact(COMPACT);
      launch.resolve(failure('HISTORY_UNREADABLE'));
      expect(await started).toEqual({ success: false, errorAlreadyShown: true });
      expect(auth.authRequiredBanner()?.message).toBe(CARRY_OVER_UNREADABLE_TEXT);
    });

    it('START_FAILED AUTH_REQUIRED without a banner flags with no origin (AC 5.2)', async () => {
      const flag = jest.spyOn(auth, 'flagAuthRequired');
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.startFromCompact(COMPACT);
      launch.resolve(
        failure('START_FAILED', { errorCode: 'AUTH_REQUIRED', error: 'Sign in.' }),
      );
      expect(await started).toEqual({ success: false, errorAlreadyShown: true });
      expect(flag).toHaveBeenCalledWith(null, 'Sign in.');
      expect(auth.authRequiredBanner()?.origin).toBeNull();
      expect(service.offer()).toBeNull();
    });

    it('START_FAILED without AUTH_REQUIRED and without a banner is the send failure', async () => {
      const flag = jest.spyOn(auth, 'flagAuthRequired');
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.startFromCompact(COMPACT);
      launch.resolve(
        failure('START_FAILED', { errorCode: 'CODEX_UNAVAILABLE', error: 'Codex chat could not start.' }),
      );
      expect(await started).toEqual({
        success: false,
        error: 'Codex chat could not start.',
      });
      expect(flag).not.toHaveBeenCalled();
    });

    it('IN_FLIGHT and a transport failure give the busy text', async () => {
      const inFlight = expectCall<ChatCarryOverResult>('chat:carry-over');
      const first = service.startFromCompact(COMPACT);
      inFlight.resolve(failure('IN_FLIGHT'));
      expect(await first).toEqual({ success: false, error: CARRY_OVER_BUSY_TEXT });

      const timeout = expectCall<ChatCarryOverResult>('chat:carry-over');
      const second = service.startFromCompact(COMPACT);
      timeout.resolve(rpcError('RPC timeout: chat:carry-over'));
      expect(await second).toEqual({ success: false, error: CARRY_OVER_BUSY_TEXT });
      expect(service.isPending(TAB)).toBe(true);
    });

    it('a pending tab or busy session gives busy with no RPC', async () => {
      expectCall<ChatCarryOverResult>('chat:carry-over');
      void service.startFromCompact(COMPACT);
      expect(await service.startFromCompact(COMPACT)).toBe('busy');
      tabs.set(TAB_B, { id: TAB_B, claudeSessionId: OLD, name: 'Same session' });
      expectCall<ChatCarryOverCheckResult>('chat:carry-over-check').resolve(
        rpcSuccess(ELIGIBLE),
      );
      expect(
        await service.tryCompact({ ...COMPACT, tabId: TAB_B }),
      ).toBe('busy');
      expect(callsOf('chat:carry-over')).toHaveLength(1);
    });

    describe('tryCompact', () => {
      const ORIGIN_C = { sessionId: OLD, tabId: TAB, workspacePath: WS, name: 'Refused chat' };

      it('checks with the 5 s cap and launches when eligible', async () => {
        expectCall<ChatCarryOverCheckResult>('chat:carry-over-check').resolve(
          rpcSuccess(ELIGIBLE),
        );
        expectCall<ChatCarryOverResult>('chat:carry-over').resolve(SUCCESS);
        expect(await service.tryCompact(ORIGIN_C)).toEqual({ success: true });
        const [check] = callsOf('chat:carry-over-check');
        expect(check.params).toEqual({ sessionId: OLD, workspacePath: WS });
        expect(check.options).toEqual({ timeout: CARRY_OVER_CHECK_TIMEOUT_MS });
        expect(CARRY_OVER_CHECK_TIMEOUT_MS).toBe(5_000);
        expect(callsOf('chat:carry-over')[0].params).toEqual({
          sessionId: OLD,
          tabId: TAB,
          workspacePath: WS,
          name: 'Refused chat',
          ptahUiFence: true,
        });
      });

      it('not eligible gives not-eligible with no launch', async () => {
        expectCall<ChatCarryOverCheckResult>('chat:carry-over-check').resolve(
          rpcSuccess({ eligible: false }),
        );
        expect(await service.tryCompact(ORIGIN_C)).toBe('not-eligible');
        expect(callsOf('chat:carry-over')).toHaveLength(0);
      });

      it.each([
        ['an RPC error', 'Method failed'],
        ['a 5 s timeout', 'RPC timeout: chat:carry-over-check'],
      ])('%s gives check-failed with no launch (AC 9.3, row 38)', async (_label, error) => {
        expectCall<ChatCarryOverCheckResult>('chat:carry-over-check').resolve(
          rpcError(error),
        );
        expect(await service.tryCompact(ORIGIN_C)).toBe('check-failed');
        expect(callsOf('chat:carry-over')).toHaveLength(0);
        expect(service.isPending(TAB)).toBe(false);
      });
    });
  });

  describe('launch recovery (Finding 2)', () => {
    const COMPACT = {
      sessionId: OLD,
      tabId: TAB,
      workspacePath: WS,
      providerId: 'openai-codex',
      providerName: 'Codex',
    };
    const TIMEOUT = rpcError<ChatCarryOverResult>('RPC timeout: chat:carry-over');

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /** Click the offer and let the launch end with `result`. */
    async function launchWith(
      result: RpcResult<ChatCarryOverResult>,
    ): Promise<CarryOverOffer> {
      const offer = await offerReady();
      const launch = expectCall<ChatCarryOverResult>('chat:carry-over');
      const started = service.start(offer);
      launch.resolve(result);
      await started;
      return offer;
    }

    async function expireLaunch(): Promise<CarryOverOffer> {
      const offer = await launchWith(TIMEOUT);
      jest.advanceTimersByTime(CARRY_OVER_RECOVERY_MS);
      return offer;
    }

    it('a host error envelope releases the tab at once and shows the failure (button)', async () => {
      await launchWith(rpcError('Invalid carry-over request', 'INVALID_PARAMS'));
      expect(service.isPending(TAB)).toBe(false);
      expect(service.isBusy(OLD)).toBe(false);
      expect(auth.authRequiredBanner()?.message).toBe(CARRY_OVER_START_FAILED_TEXT);
      expect(auth.authRequiredBanner()?.origin).toEqual(ORIGIN);
    });

    it('a host error envelope releases the tab at once and gives the failure text (/compact)', async () => {
      expectCall<ChatCarryOverResult>('chat:carry-over').resolve(
        rpcError('Internal error'),
      );
      expect(await service.startFromCompact(COMPACT)).toEqual({
        success: false,
        error: CARRY_OVER_START_FAILED_TEXT,
      });
      expect(service.isPending(TAB)).toBe(false);
    });

    it('a renderer timeout holds the tab until the deadline, then releases it with a notice', async () => {
      const offer = await launchWith(TIMEOUT);
      jest.advanceTimersByTime(CARRY_OVER_RECOVERY_MS - 1);
      expect(service.isPending(TAB)).toBe(true);
      expect(showInfo).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(service.isPending(TAB)).toBe(false);
      expect(service.isBusy(OLD)).toBe(false);
      expect(showInfo).toHaveBeenCalledWith(
        CARRY_OVER_EXPIRED_TEXT,
        TAB,
        CARRY_OVER_NOTICE_MS,
      );
      // The offer is still on screen, so the user can retry.
      expect(service.offer()).toEqual(offer);
      expectCall<ChatCarryOverResult>('chat:carry-over').resolve(SUCCESS);
      await service.start(offer);
      expect(callsOf('chat:carry-over')).toHaveLength(2);
      expect(service.isPending(TAB)).toBe(true);
    });

    it('a thrown RPC is indeterminate and is released at the deadline', async () => {
      const offer = await offerReady();
      rpc.call.mockRejectedValueOnce(new Error('post failed'));
      await service.start(offer);
      expect(service.isPending(TAB)).toBe(true);
      jest.advanceTimersByTime(CARRY_OVER_RECOVERY_MS);
      expect(service.isPending(TAB)).toBe(false);
      expect(showInfo).toHaveBeenCalledWith(
        CARRY_OVER_EXPIRED_TEXT,
        TAB,
        CARRY_OVER_NOTICE_MS,
      );
    });

    it('a resolution within the window binds as usual and cancels the deadline', async () => {
      await launchWith(TIMEOUT);
      expect(service.claimSessionResolution(TAB, NEW)).toBe('bind');
      service.completeBinding(TAB);
      expect(showInfo).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(CARRY_OVER_RECOVERY_MS);
      expect(showInfo).toHaveBeenCalledTimes(1);
      expect(showInfo).toHaveBeenCalledWith(
        carryOverNotice('Codex'),
        TAB,
        CARRY_OVER_NOTICE_MS,
      );
    });

    it('a late resolution after expiry does not bind and its session is aborted', async () => {
      await expireLaunch();
      expect(service.claimSessionResolution(TAB, NEW)).toBe('skip');
      expect(callsOf('chat:abort').map((c) => c.params)).toEqual([{ sessionId: NEW }]);
      expect(service.isPending(TAB)).toBe(false);
      service.completeBinding(TAB);
      expect(showInfo).toHaveBeenCalledTimes(1);
      // The marker is used once; a resolution of the old session is none.
      expect(service.claimSessionResolution(TAB, OLD)).toBe('none');
    });

    it('a late resolution cannot clobber a retry that already bound', async () => {
      const offer = await expireLaunch();
      expectCall<ChatCarryOverResult>('chat:carry-over').resolve(SUCCESS);
      await service.start(offer);
      expect(service.claimSessionResolution(TAB, RETRY)).toBe('bind');
      service.completeBinding(TAB);
      tabs.set(TAB, { id: TAB, claudeSessionId: RETRY, name: 'Refused chat' });

      // A repeat of the retry's own resolution is not touched.
      expect(service.claimSessionResolution(TAB, RETRY)).toBe('none');
      // The expired launch's late session is skipped and aborted.
      expect(service.claimSessionResolution(TAB, NEW)).toBe('skip');
      expect(callsOf('chat:abort').map((c) => c.params)).toEqual([{ sessionId: NEW }]);
    });

    it('the late-resolution marker lapses after its window', async () => {
      await expireLaunch();
      jest.advanceTimersByTime(CARRY_OVER_LATE_RESOLUTION_MS + 1);
      expect(service.claimSessionResolution(TAB, NEW)).toBe('none');
      expect(callsOf('chat:abort')).toHaveLength(0);
    });

    it('a launch released by a chat error before the deadline shows no expiry notice', async () => {
      await launchWith(TIMEOUT);
      service.onChatError(TAB);
      jest.advanceTimersByTime(CARRY_OVER_RECOVERY_MS);
      expect(showInfo).not.toHaveBeenCalled();
      expect(service.claimSessionResolution(TAB, NEW)).toBe('none');
    });
  });
});
