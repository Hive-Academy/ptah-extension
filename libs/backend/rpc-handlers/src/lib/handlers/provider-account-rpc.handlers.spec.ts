/**
 * ProviderAccountRpcHandlers — boundary validation, authority, idempotency,
 * revision snapshots, notifications, redaction and the account actions port.
 *
 * The account service is an in-memory fake with the real service's
 * compare-and-set rules; it throws coded errors shaped like the store's.
 */

// The real class pulls the whole auth-providers graph (SQLite, SDK); the
// handler only needs it as a DI token.
jest.mock('@ptah-extension/auth-providers', () => ({
  ProviderAccountService: class ProviderAccountService {},
}));

import 'reflect-metadata';
import { container, type InjectionToken } from 'tsyringe';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { ProviderAccountService } from '@ptah-extension/auth-providers';
import {
  MESSAGE_TYPES,
  PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY,
  type ProviderAccountActionResult,
  PROVIDER_ACCOUNT_RPC_METHOD_NAMES,
  type ProviderAccountResultCode,
  type ProviderAccountScope,
  type ProviderAccountSummary,
  type ProviderAccountsChangedNotification,
} from '@ptah-extension/shared';
import {
  ProviderAccountRpcHandlers,
  type ProviderAccountBroadcaster,
  type ProviderAccountRpcActions,
  type ProviderAccountRpcService,
  type ProviderAccountRpcStateChange,
} from './provider-account-rpc.handlers';

const ROOT = '/ws/project';
const OTHER_ROOT = '/ws/other';
const PROFILE_A = 'profile-aaaa-0001';
const REQ = (n: number): string => `request-${String(n).padStart(4, '0')}`;
const SECRET_TEXT = 'C:\\Users\\me\\.claude token=sk-ant-secret';

class FakeStoreError extends Error {
  constructor(
    readonly code: Exclude<ProviderAccountResultCode, 'ok'>,
    message = 'The local account operation could not be completed.',
  ) {
    super(message);
    this.name = 'ProviderAccountStoreError';
  }
}

interface StoredSelection {
  readonly profileId: string | null;
  readonly revision: number;
}

/** In-memory service with the store's CAS rules. */
class FakeAccountService implements ProviderAccountRpcService {
  readonly calls: string[] = [];
  readonly profiles = new Map<string, ProviderAccountSummary>();
  readonly selections = new Map<string, StoredSelection>();
  failNext: Error | undefined;
  private nextId = 1;

  private guard(name: string): void {
    this.calls.push(name);
    const failure = this.failNext;
    this.failNext = undefined;
    if (failure) throw failure;
  }

  private profileAt(
    profileId: string,
    revision: number,
  ): ProviderAccountSummary {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new FakeStoreError('missing-profile');
    if (profile.revision !== revision) throw new FakeStoreError('conflict');
    return profile;
  }

  list(): readonly ProviderAccountSummary[] {
    return [...this.profiles.values()];
  }

  /** Mirrors the real service: a requestId keys the profile durably. */
  add(label: string, requestId?: string): ProviderAccountSummary {
    this.guard('add');
    const keyed = requestId === undefined ? undefined : `profile-${requestId}`;
    const prior = keyed === undefined ? undefined : this.profiles.get(keyed);
    if (prior) {
      if (prior.label !== label) throw new FakeStoreError('conflict');
      return prior;
    }
    const profileId =
      keyed ?? `profile-${String(this.nextId++).padStart(4, '0')}-new`;
    const summary: ProviderAccountSummary = {
      profileId,
      label,
      provider: 'claude',
      state: 'not-signed-in',
      owner: 'unknown',
      revision: 0,
      activeRunCount: 0,
    };
    this.profiles.set(profileId, summary);
    return summary;
  }

  rename(
    profileId: string,
    expectedRevision: number,
    label: string,
  ): ProviderAccountSummary {
    this.guard('rename');
    const profile = this.profileAt(profileId, expectedRevision);
    const next = { ...profile, label, revision: profile.revision + 1 };
    this.profiles.set(profileId, next);
    return next;
  }

  remove(profileId: string, expectedRevision: number): void {
    this.guard('remove');
    this.profileAt(profileId, expectedRevision);
    this.profiles.delete(profileId);
  }

  selection(
    workspaceRoot: string,
    scope: ProviderAccountScope,
  ): StoredSelection {
    return (
      this.selections.get(`${workspaceRoot}|${scope}`) ?? {
        profileId: null,
        revision: -1,
      }
    );
  }

  select(
    workspaceRoot: string,
    scope: ProviderAccountScope,
    profileId: string | null,
    expectedRevision: number,
    expectedProfileRevision?: number,
  ): StoredSelection {
    this.guard('select');
    if (profileId !== null)
      this.profileAt(profileId, expectedProfileRevision ?? -1);
    const current = this.selection(workspaceRoot, scope);
    if (current.revision !== expectedRevision)
      throw new FakeStoreError('conflict');
    const next = { profileId, revision: current.revision + 1 };
    this.selections.set(`${workspaceRoot}|${scope}`, next);
    return next;
  }

  setDefault(
    workspaceRoot: string,
    profileId: string | null,
    expected: Readonly<Record<ProviderAccountScope, number>>,
    expectedProfileRevision?: number,
  ): Readonly<Record<ProviderAccountScope, StoredSelection>> {
    this.guard('setDefault');
    if (profileId !== null)
      this.profileAt(profileId, expectedProfileRevision ?? -1);
    for (const scope of ['main', 'lane'] as const) {
      if (this.selection(workspaceRoot, scope).revision !== expected[scope]) {
        throw new FakeStoreError('conflict');
      }
    }
    const main = { profileId, revision: expected.main + 1 };
    const lane = { profileId, revision: expected.lane + 1 };
    this.selections.set(`${workspaceRoot}|main`, main);
    this.selections.set(`${workspaceRoot}|lane`, lane);
    return { main, lane };
  }
}

type ActionCommand = Parameters<ProviderAccountRpcActions['signOut']>[0];

const OK: ProviderAccountActionResult = { code: 'ok', summary: 'Done.' };

/** Actions port fake: records each command and answers with a queued result. */
class FakeActions implements ProviderAccountRpcActions {
  readonly commands: Array<{
    readonly method: string;
    readonly command: unknown;
  }> = [];
  readonly listeners = new Set<
    (change: ProviderAccountRpcStateChange) => void
  >();
  next: ProviderAccountActionResult & {
    fallback?: { platform: 'win32' | 'posix'; script: string };
  } = OK;

  private answer(method: string, command: unknown) {
    this.commands.push({ method, command });
    return Promise.resolve(this.next);
  }

  readStatus(target: { provider: 'claude'; profileId: string }) {
    return this.answer('readStatus', target);
  }
  startSignIn(command: ActionCommand) {
    return this.answer('startSignIn', command);
  }
  cancelSignIn(command: ActionCommand) {
    return this.answer('cancelSignIn', command);
  }
  signOut(command: ActionCommand) {
    return this.answer('signOut', command);
  }
  onStateChanged(
    listener: (change: ProviderAccountRpcStateChange) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(change: ProviderAccountRpcStateChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

function seedProfile(service: FakeAccountService, revision = 0): void {
  service.profiles.set(PROFILE_A, {
    profileId: PROFILE_A,
    label: 'Work',
    provider: 'claude',
    state: 'signed-in',
    owner: 'unknown',
    revision,
    activeRunCount: 0,
  });
}

type MethodHandler = (params: unknown) => Promise<unknown>;

function setup(
  options: {
    folders?: string[];
    service?: FakeAccountService;
    actions?: FakeActions;
  } = {},
) {
  const methods = new Map<string, MethodHandler>();
  const rpcHandler = {
    registerMethod: jest.fn((name: string, handler: MethodHandler) => {
      methods.set(name, handler);
    }),
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const workspace = {
    getWorkspaceFolders: jest.fn(() => options.folders ?? [ROOT, OTHER_ROOT]),
  };
  const sent: ProviderAccountsChangedNotification[] = [];
  const broadcaster: ProviderAccountBroadcaster & {
    broadcastMessage: jest.Mock;
  } = {
    broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
      expect(type).toBe(MESSAGE_TYPES.PROVIDER_ACCOUNTS_CHANGED);
      sent.push(payload as ProviderAccountsChangedNotification);
    }),
  };
  const service = options.service ?? new FakeAccountService();
  // Resolve through DI so every @inject token the handler declares is proved.
  const scope = container.createChildContainer();
  scope.register(TOKENS.LOGGER, { useValue: logger });
  scope.register(TOKENS.RPC_HANDLER, { useValue: rpcHandler });
  // The handler only needs the narrow service surface behind this token.
  const accountToken: InjectionToken<ProviderAccountRpcService> =
    ProviderAccountService;
  scope.register(accountToken, { useValue: service });
  scope.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { useValue: workspace });
  scope.register(TOKENS.WEBVIEW_MANAGER, { useValue: broadcaster });
  const actions = options.actions ?? new FakeActions();
  scope.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS, {
    useValue: actions,
  });
  const handlers = scope.resolve(ProviderAccountRpcHandlers);
  handlers.register();

  const call = async (method: string, params: unknown): Promise<unknown> => {
    const handler = methods.get(method);
    if (!handler) throw new Error(`not registered: ${method}`);
    return handler(params);
  };
  const flush = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));
  return {
    call,
    flush,
    service,
    sent,
    logger,
    broadcaster,
    rpcHandler,
    actions,
    handlers,
  };
}

const addParams = (n: number, label = 'Personal') => ({
  provider: 'claude',
  workspaceRoot: ROOT,
  requestId: REQ(n),
  label,
});

describe('ProviderAccountRpcHandlers', () => {
  it('registers exactly the ten provider account methods', () => {
    const { rpcHandler } = setup();
    const names = rpcHandler.registerMethod.mock.calls.map((args) => args[0]);
    expect(names).toHaveLength(PROVIDER_ACCOUNT_RPC_METHOD_NAMES.length);
    expect(new Set(names)).toEqual(new Set(PROVIDER_ACCOUNT_RPC_METHOD_NAMES));
    expect(ProviderAccountRpcHandlers.METHODS).toBe(
      PROVIDER_ACCOUNT_RPC_METHOD_NAMES,
    );
  });

  describe('invalid params have no side effects', () => {
    const invalid: ReadonlyArray<readonly [string, unknown]> = [
      ['provider:listAccounts', { provider: 'claude' }],
      [
        'provider:addAccount',
        { ...addParams(1), configDir: '/home/me/.claude' },
      ],
      [
        'provider:addAccount',
        { ...addParams(1), env: { CLAUDE_CONFIG_DIR: '/x' } },
      ],
      ['provider:addAccount', { ...addParams(1), token: 'sk-ant-secret' }],
      ['provider:addAccount', { ...addParams(1), owner: 'a'.repeat(64) }],
      ['provider:addAccount', { ...addParams(1), requestId: 'short' }],
      ['provider:addAccount', { ...addParams(1), label: ' padded ' }],
      [
        'provider:renameAccount',
        {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          profileId: '../escape',
          expectedRevision: 0,
          label: 'x',
        },
      ],
      [
        'provider:removeAccount',
        {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          profileId: PROFILE_A,
          expectedRevision: -1,
        },
      ],
      [
        'provider:getAccountStatus',
        { provider: 'gemini', profileId: PROFILE_A },
      ],
      [
        'provider:startAccountSignIn',
        {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          profileId: PROFILE_A,
        },
      ],
      [
        'provider:cancelAccountSignIn',
        {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          profileId: PROFILE_A,
          operationId: 'op',
        },
      ],
      ['provider:signOutAccount', null],
      [
        'provider:setAccountSelection',
        {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          scope: 'global',
          selection: { kind: 'ambient' },
          expectedSelectionRevision: -1,
        },
      ],
      [
        'provider:setAccountSelection',
        {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          scope: 'main',
          selection: { kind: 'named', profileId: PROFILE_A },
          expectedSelectionRevision: -1,
        },
      ],
      [
        'provider:setAccountDefault',
        {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          selection: { kind: 'ambient' },
          expectedSelectionRevisions: { main: -1 },
        },
      ],
      [
        'provider:setAccountDefault',
        {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          selection: { kind: 'ambient' },
          expectedSelectionRevisions: { main: -1, lane: -2 },
        },
      ],
    ];

    it.each(invalid)('%s rejects %j', async (method, params) => {
      const { call, flush, service, sent } = setup();
      await expect(call(method, params)).rejects.toMatchObject({
        name: 'RpcUserError',
        errorCode: 'INVALID_PARAMS',
      });
      await flush();
      expect(service.calls).toEqual([]);
      expect(service.profiles.size).toBe(0);
      expect(sent).toEqual([]);
    });
  });

  describe('authority', () => {
    it('refuses a workspace that is not open, with no side effects', async () => {
      const { call, flush, service, sent } = setup({ folders: [OTHER_ROOT] });
      const error = await call('provider:addAccount', addParams(1)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(RpcUserError);
      expect(error).toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
      await expect(
        call('provider:listAccounts', {
          provider: 'claude',
          workspaceRoot: ROOT,
        }),
      ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
      await flush();
      expect(service.calls).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('never resolves a relative workspace root', async () => {
      const { call, service } = setup({ folders: [ROOT] });
      await expect(
        call('provider:addAccount', {
          ...addParams(1),
          workspaceRoot: 'ws/project',
        }),
      ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
      expect(service.calls).toEqual([]);
    });

    it.each([
      ['provider:listAccounts', { provider: 'codex', workspaceRoot: ROOT }],
      ['provider:addAccount', { ...addParams(1), provider: 'codex' }],
      [
        'provider:getAccountStatus',
        { provider: 'codex', profileId: PROFILE_A },
      ],
      [
        'provider:startAccountSignIn',
        {
          provider: 'codex',
          workspaceRoot: ROOT,
          requestId: REQ(1),
          profileId: PROFILE_A,
          expectedRevision: 0,
        },
      ],
    ])('%s refuses a non-Claude provider', async (method, params) => {
      const { call, flush, service, sent } = setup();
      await expect(call(method, params)).resolves.toEqual({
        ok: false,
        result: {
          code: 'wrong-provider',
          summary: 'This action requires a Claude account.',
        },
      });
      await flush();
      expect(service.calls).toEqual([]);
      expect(sent).toEqual([]);
    });
  });

  describe('reads', () => {
    it('lists an empty snapshot with never-set selections', async () => {
      const { call } = setup();
      const result = await call('provider:listAccounts', {
        provider: 'claude',
        workspaceRoot: ROOT,
      });
      expect(result).toEqual({
        ok: true,
        snapshot: {
          provider: 'claude',
          workspaceRoot: ROOT,
          revision: expect.any(Number),
          accounts: [],
          selections: {
            main: {
              scope: 'main',
              selection: { kind: 'omitted' },
              revision: -1,
            },
            lane: {
              scope: 'lane',
              selection: { kind: 'omitted' },
              revision: -1,
            },
          },
        },
      });
    });

    it('returns status for a known profile and missing-profile otherwise', async () => {
      const { call, service } = setup();
      seedProfile(service);
      await expect(
        call('provider:getAccountStatus', {
          provider: 'claude',
          profileId: PROFILE_A,
        }),
      ).resolves.toEqual({
        ok: true,
        account: service.profiles.get(PROFILE_A),
      });
      await expect(
        call('provider:getAccountStatus', {
          provider: 'claude',
          profileId: 'profile-zzzz-9999',
        }),
      ).resolves.toMatchObject({
        ok: false,
        result: { code: 'missing-profile' },
      });
    });

    it('strips fields the summary contract does not name', async () => {
      const { call, service } = setup();
      // A variable, not a fresh literal: extra fields are what a future
      // store row could carry and what the handler must not forward.
      const leaky = {
        configDir: '/home/me/.claude',
        routeFingerprint: 'f'.repeat(40),
        profileId: PROFILE_A,
        label: 'Work',
        provider: 'claude' as const,
        state: 'signed-in' as const,
        owner: 'unknown' as const,
        revision: 0,
        activeRunCount: 0,
      };
      service.profiles.set(PROFILE_A, leaky);
      const result = await call('provider:listAccounts', {
        provider: 'claude',
        workspaceRoot: ROOT,
      });
      expect(JSON.stringify(result)).not.toContain('.claude');
      expect(JSON.stringify(result)).not.toContain('routeFingerprint');
    });
  });

  describe('writes', () => {
    it('adds an account, bumps the revision and pushes one notification', async () => {
      const { call, flush, service, sent } = setup();
      const before = await call('provider:listAccounts', {
        provider: 'claude',
        workspaceRoot: ROOT,
      });
      const result = await call('provider:addAccount', addParams(1));
      await flush();
      expect(result).toMatchObject({
        ok: true,
        account: { label: 'Personal', provider: 'claude', revision: 0 },
        snapshot: { workspaceRoot: ROOT, accounts: [{ label: 'Personal' }] },
      });
      const revisionBefore = (before as { snapshot: { revision: number } })
        .snapshot.revision;
      const committed = (result as { snapshot: { revision: number } }).snapshot;
      expect(committed.revision).toBe(revisionBefore + 1);
      expect(sent).toEqual([{ snapshot: committed, requestId: REQ(1) }]);
      expect(service.calls).toEqual(['add']);
    });

    it('returns the same outcome for a duplicate request without acting twice', async () => {
      const { call, flush, service, sent } = setup();
      const first = await call('provider:addAccount', addParams(1));
      const second = await call('provider:addAccount', addParams(1));
      await flush();
      expect(second).toEqual(first);
      expect(service.calls).toEqual(['add']);
      expect(service.profiles.size).toBe(1);
      expect(sent).toHaveLength(1);
    });

    it('forwards the request ID so a repeated Add after ledger eviction adds no duplicate', async () => {
      const { call, service } = setup();
      const first = (await call('provider:addAccount', addParams(1))) as {
        account: ProviderAccountSummary;
      };
      // 256 later writes push REQ(1) out of the in-memory ledger.
      for (let n = 2; n <= 257; n++)
        await call('provider:addAccount', addParams(n));
      const replay = await call('provider:addAccount', addParams(1));
      expect(replay).toMatchObject({
        ok: true,
        account: { profileId: first.account.profileId },
      });
      expect(service.profiles.size).toBe(257);
      expect(service.calls.filter((name) => name === 'add')).toHaveLength(258);
    });

    it('a repeated Add on a new handler instance (restart) adds no duplicate', async () => {
      const service = new FakeAccountService();
      const before = setup({ service });
      const first = (await before.call(
        'provider:addAccount',
        addParams(1),
      )) as {
        account: ProviderAccountSummary;
      };
      const after = setup({ service });
      const replay = await after.call('provider:addAccount', addParams(1));
      expect(replay).toMatchObject({
        ok: true,
        account: { profileId: first.account.profileId },
      });
      expect(service.profiles.size).toBe(1);
    });

    it('a different request ID still creates a new account', async () => {
      const { call, service } = setup();
      const one = (await call('provider:addAccount', addParams(1))) as {
        account: ProviderAccountSummary;
      };
      const two = (await call('provider:addAccount', addParams(2))) as {
        account: ProviderAccountSummary;
      };
      expect(two.account.profileId).not.toBe(one.account.profileId);
      expect(service.profiles.size).toBe(2);
    });

    it('refuses a reused request ID carrying different params', async () => {
      const { call, flush, service, sent } = setup();
      await call('provider:addAccount', addParams(1, 'Personal'));
      const reused = await call('provider:addAccount', addParams(1, 'Other'));
      await flush();
      expect(reused).toMatchObject({ ok: false, result: { code: 'conflict' } });
      expect(service.calls).toEqual(['add']);
      expect(sent).toHaveLength(1);
    });

    it('renames at the expected revision and refuses a stale one', async () => {
      const { call, flush, service, sent } = setup();
      seedProfile(service, 3);
      const rename = (n: number, expectedRevision: number) =>
        call('provider:renameAccount', {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(n),
          profileId: PROFILE_A,
          expectedRevision,
          label: `Renamed ${n}`,
        });
      await expect(rename(1, 2)).resolves.toEqual({
        ok: false,
        result: {
          code: 'conflict',
          summary: 'The account changed. Refresh and try again.',
        },
      });
      await expect(rename(2, 3)).resolves.toMatchObject({
        ok: true,
        account: { label: 'Renamed 2', revision: 4 },
      });
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0].requestId).toBe(REQ(2));
    });

    it('removes a profile and reports missing-profile for an unknown one', async () => {
      const { call, flush, service, sent } = setup();
      seedProfile(service);
      const remove = (n: number, profileId: string) =>
        call('provider:removeAccount', {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(n),
          profileId,
          expectedRevision: 0,
        });
      await expect(remove(1, PROFILE_A)).resolves.toMatchObject({
        ok: true,
        snapshot: { accounts: [] },
      });
      await expect(remove(2, PROFILE_A)).resolves.toMatchObject({
        ok: false,
        result: { code: 'missing-profile' },
      });
      await flush();
      expect(sent).toHaveLength(1);
    });

    it('sets one scope selection (named, then ambient) against the seen revision', async () => {
      const { call, flush, service, sent } = setup();
      seedProfile(service);
      const select = (
        n: number,
        selection: unknown,
        expectedSelectionRevision: number,
      ) =>
        call('provider:setAccountSelection', {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(n),
          scope: 'lane',
          selection,
          expectedSelectionRevision,
        });
      await expect(
        select(
          1,
          { kind: 'named', profileId: PROFILE_A, expectedProfileRevision: 0 },
          -1,
        ),
      ).resolves.toMatchObject({
        ok: true,
        snapshot: {
          selections: {
            main: { selection: { kind: 'omitted' }, revision: -1 },
            lane: {
              selection: { kind: 'named', profileId: PROFILE_A },
              revision: 0,
            },
          },
        },
      });
      await expect(select(2, { kind: 'ambient' }, -1)).resolves.toMatchObject({
        ok: false,
        result: { code: 'conflict' },
      });
      await expect(select(3, { kind: 'ambient' }, 0)).resolves.toMatchObject({
        ok: true,
        snapshot: {
          selections: { lane: { selection: { kind: 'ambient' }, revision: 1 } },
        },
      });
      await flush();
      expect(sent.map((n) => n.requestId)).toEqual([REQ(1), REQ(3)]);
    });

    it('keys selections by the registered folder, not the caller spelling', async () => {
      const { call, service } = setup({ folders: [ROOT] });
      await call('provider:setAccountSelection', {
        provider: 'claude',
        workspaceRoot: `${ROOT}/./`,
        requestId: REQ(1),
        scope: 'main',
        selection: { kind: 'ambient' },
        expectedSelectionRevision: -1,
      });
      expect([...service.selections.keys()]).toEqual([`${ROOT}|main`]);
    });

    it('sets the default for both scopes in one write', async () => {
      const { call, flush, sent } = setup();
      const result = await call('provider:setAccountDefault', {
        provider: 'claude',
        workspaceRoot: ROOT,
        requestId: REQ(1),
        selection: { kind: 'ambient' },
        expectedSelectionRevisions: { main: -1, lane: -1 },
      });
      await flush();
      expect(result).toMatchObject({
        ok: true,
        snapshot: {
          selections: {
            main: { selection: { kind: 'ambient' }, revision: 0 },
            lane: { selection: { kind: 'ambient' }, revision: 0 },
          },
        },
      });
      expect(sent).toHaveLength(1);
    });

    it('pushes one notification per committed revision, in order', async () => {
      const { call, flush, sent } = setup();
      await call('provider:addAccount', addParams(1, 'One'));
      await call('provider:addAccount', addParams(2, 'Two'));
      await call('provider:addAccount', addParams(2, 'Two'));
      await flush();
      expect(sent.map((n) => n.requestId)).toEqual([REQ(1), REQ(2)]);
      expect(sent[1].snapshot.revision).toBe(sent[0].snapshot.revision + 1);
    });

    it('keeps a committed write when the broadcast fails', async () => {
      const { call, flush, broadcaster, logger } = setup();
      broadcaster.broadcastMessage.mockImplementation(() => {
        throw new Error(SECRET_TEXT);
      });
      await expect(
        call('provider:addAccount', addParams(1)),
      ).resolves.toMatchObject({ ok: true });
      await flush();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-ant');
    });

    it('reports a committed write with an unreadable snapshot as timeout', async () => {
      const { call, flush, service, sent } = setup();
      jest.spyOn(service, 'list').mockImplementationOnce(() => {
        throw new FakeStoreError('unavailable-storage');
      });
      const result = await call('provider:addAccount', addParams(1));
      await flush();
      expect(result).toMatchObject({ ok: false, result: { code: 'timeout' } });
      expect(service.profiles.size).toBe(1);
      expect(sent).toEqual([]);
      await expect(call('provider:addAccount', addParams(1))).resolves.toEqual(
        result,
      );
    });
  });

  describe('construction and notification evidence (Batch 35)', () => {
    it('registration and construction read no account storage', () => {
      const { service, rpcHandler } = setup();
      expect(service.calls).toEqual([]);
      expect(rpcHandler.registerMethod).toHaveBeenCalledTimes(
        PROVIDER_ACCOUNT_RPC_METHOD_NAMES.length,
      );
    });

    it('pushes a sanitized snapshot: no path, email, token or fingerprint', async () => {
      const { call, flush, service, sent } = setup();
      // A variable, not a literal: extra fields model a richer store row.
      const leaky = {
        configDir: 'C:\\Users\\me\\.claude-profiles\\work',
        email: 'me@example.com',
        accessToken: 'sk-ant-secret',
        routeFingerprint: 'f'.repeat(40),
        profileId: PROFILE_A,
        label: 'Work',
        provider: 'claude' as const,
        state: 'signed-in' as const,
        owner: 'unknown' as const,
        revision: 0,
        activeRunCount: 0,
      };
      service.profiles.set(PROFILE_A, leaky);
      const result = await call('provider:addAccount', addParams(1));
      await flush();
      expect(sent).toHaveLength(1);
      for (const text of [JSON.stringify(result), JSON.stringify(sent)]) {
        for (const forbidden of [
          '.claude-profiles',
          'me@example.com',
          'sk-ant',
          'routeFingerprint',
          'configDir',
          'accessToken',
        ]) {
          expect(text).not.toContain(forbidden);
        }
      }
    });

    it('a refused write pushes nothing and leaves revisions consecutive', async () => {
      const { call, flush, service, sent } = setup();
      seedProfile(service, 3);
      await call('provider:addAccount', addParams(1));
      await expect(
        call('provider:renameAccount', {
          provider: 'claude',
          workspaceRoot: ROOT,
          requestId: REQ(2),
          profileId: PROFILE_A,
          expectedRevision: 0,
          label: 'Stale',
        }),
      ).resolves.toMatchObject({ ok: false, result: { code: 'conflict' } });
      await call('provider:addAccount', addParams(3));
      await flush();
      expect(sent.map((n) => n.requestId)).toEqual([REQ(1), REQ(3)]);
      expect(sent[1].snapshot.revision).toBe(sent[0].snapshot.revision + 1);
    });
  });

  describe('redaction', () => {
    it('maps a coded store failure to fixed copy, never its message', async () => {
      const { call, flush, service, sent, logger } = setup();
      service.failNext = new FakeStoreError('busy', SECRET_TEXT);
      const result = await call('provider:addAccount', addParams(1));
      await flush();
      expect(result).toEqual({
        ok: false,
        result: {
          code: 'busy',
          summary: 'The account is in use or has an unresolved operation.',
        },
      });
      expect(JSON.stringify(result)).not.toContain('sk-ant');
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-ant');
      expect(sent).toEqual([]);
    });

    it('maps an uncoded failure to unavailable-storage', async () => {
      const { call, service } = setup();
      service.failNext = new Error(`EACCES: open ${SECRET_TEXT}`);
      const result = await call('provider:addAccount', addParams(1));
      expect(result).toEqual({
        ok: false,
        result: {
          code: 'unavailable-storage',
          summary: 'Account storage is unavailable.',
        },
      });
      expect(JSON.stringify(result)).not.toContain('EACCES');
    });

    it('passes through a verified-safe store sentence', async () => {
      const { call, service } = setup();
      service.failNext = new FakeStoreError(
        'conflict',
        PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY,
      );
      await expect(call('provider:addAccount', addParams(1))).resolves.toEqual({
        ok: false,
        result: {
          code: 'conflict',
          summary: PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY,
        },
      });
    });
  });

  describe('account actions (Batch 17)', () => {
    const base = {
      provider: 'claude',
      workspaceRoot: ROOT,
      requestId: REQ(1),
      profileId: PROFILE_A,
    };

    it('the release-held copy is neutral', async () => {
      const { call, actions, service } = setup();
      seedProfile(service);
      actions.next = { code: 'release-held', summary: 'ignored' };
      await expect(
        call('provider:startAccountSignIn', { ...base, expectedRevision: 0 }),
      ).resolves.toEqual({
        ok: false,
        result: {
          code: 'release-held',
          summary: 'Named accounts are not available on this host.',
        },
      });
    });

    it('starts a sign-in through the port and returns its operation and fallback', async () => {
      const { call, flush, service, sent, actions, logger } = setup();
      seedProfile(service, 2);
      const script =
        'claude auth login # C:\\Users\\me\\.claude-profiles\\work';
      actions.next = { ...OK, fallback: { platform: 'win32', script } };
      const result = await call('provider:startAccountSignIn', {
        ...base,
        expectedRevision: 2,
      });
      await flush();
      expect(actions.commands).toEqual([
        {
          method: 'startSignIn',
          command: {
            provider: 'claude',
            profileId: PROFILE_A,
            operationId: expect.any(String),
            expectedRevision: 2,
          },
        },
      ]);
      const operationId = (actions.commands[0].command as ActionCommand)
        .operationId;
      expect(result).toEqual({
        ok: true,
        snapshot: expect.objectContaining({ workspaceRoot: ROOT }),
        operation: { operationId, kind: 'sign-in' },
        fallback: { platform: 'win32', script },
      });
      expect(sent.map((n) => n.requestId)).toEqual([REQ(1)]);
      // The fallback script is user content: never logged, never pushed.
      const logged = JSON.stringify([
        logger.debug.mock.calls,
        logger.info.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
      ]);
      expect(logged).not.toContain('claude-profiles');
      expect(JSON.stringify(sent)).not.toContain('claude-profiles');

      // Status carries the live operation until the port reports its end.
      await expect(
        call('provider:getAccountStatus', {
          provider: 'claude',
          profileId: PROFILE_A,
        }),
      ).resolves.toMatchObject({
        ok: true,
        operation: { operationId, kind: 'sign-in' },
      });
      actions.emit({ profileId: PROFILE_A, state: 'signed-in', revision: 4 });
      await expect(
        call('provider:getAccountStatus', {
          provider: 'claude',
          profileId: PROFILE_A,
        }),
      ).resolves.toEqual({
        ok: true,
        account: service.profiles.get(PROFILE_A),
      });
    });

    it('a replayed sign-in returns the first outcome without a second start', async () => {
      const { call, actions, service } = setup();
      seedProfile(service);
      const params = { ...base, expectedRevision: 0 };
      const [first, second] = await Promise.all([
        call('provider:startAccountSignIn', params),
        call('provider:startAccountSignIn', params),
      ]);
      expect(second).toEqual(first);
      expect(actions.commands).toHaveLength(1);
      await expect(
        call('provider:signOutAccount', params),
      ).resolves.toMatchObject({ ok: false, result: { code: 'conflict' } });
    });

    it('maps a port refusal to its fixed copy and pushes nothing', async () => {
      const { call, flush, actions, service, sent } = setup();
      seedProfile(service);
      actions.next = { code: 'busy', summary: SECRET_TEXT };
      const result = await call('provider:signOutAccount', {
        ...base,
        expectedRevision: 0,
      });
      await flush();
      expect(result).toEqual({
        ok: false,
        result: {
          code: 'busy',
          summary: 'The account is in use or has an unresolved operation.',
        },
      });
      expect(sent).toEqual([]);
    });

    it('cancels with the operation id and the current profile revision', async () => {
      const { call, flush, actions, service, sent } = setup();
      seedProfile(service, 5);
      actions.next = { code: 'cancelled', summary: 'Cancelled.' };
      const result = await call('provider:cancelAccountSignIn', {
        ...base,
        operationId: 'operation-0001',
      });
      await flush();
      expect(actions.commands).toEqual([
        {
          method: 'cancelSignIn',
          command: {
            provider: 'claude',
            profileId: PROFILE_A,
            operationId: 'operation-0001',
            expectedRevision: 5,
          },
        },
      ]);
      expect(result).toMatchObject({
        ok: true,
        snapshot: { workspaceRoot: ROOT },
      });
      expect(sent).toHaveLength(1);
    });

    it('cancel of a missing profile is refused before the port', async () => {
      const { call, actions } = setup();
      await expect(
        call('provider:cancelAccountSignIn', {
          ...base,
          operationId: 'operation-0001',
        }),
      ).resolves.toMatchObject({
        ok: false,
        result: { code: 'missing-profile' },
      });
      expect(actions.commands).toEqual([]);
    });

    it('signs out through the port and returns a sign-out operation', async () => {
      const { call, actions, service } = setup();
      seedProfile(service, 1);
      const result = await call('provider:signOutAccount', {
        ...base,
        expectedRevision: 1,
      });
      expect(actions.commands.map((c) => c.method)).toEqual(['signOut']);
      expect(result).toMatchObject({
        ok: true,
        operation: { kind: 'sign-out' },
      });
    });

    it('getAccountStatus refuses with the port code and reads no summary', async () => {
      const { call, actions, service } = setup();
      seedProfile(service);
      actions.next = { code: 'unsupported-source', summary: SECRET_TEXT };
      await expect(
        call('provider:getAccountStatus', {
          provider: 'claude',
          profileId: PROFILE_A,
        }),
      ).resolves.toEqual({
        ok: false,
        result: {
          code: 'unsupported-source',
          summary: 'The account authentication source cannot be verified.',
        },
      });
      expect(actions.commands).toEqual([
        {
          method: 'readStatus',
          command: { provider: 'claude', profileId: PROFILE_A },
        },
      ]);
    });

    it('a state change pushes one sanitized snapshot per open workspace', async () => {
      const { flush, actions, service, sent } = setup();
      seedProfile(service);
      actions.emit({ profileId: PROFILE_A, state: 'signed-in', revision: 1 });
      await flush();
      expect(sent.map((n) => n.snapshot.workspaceRoot)).toEqual([
        ROOT,
        OTHER_ROOT,
      ]);
      expect(sent.every((n) => n.requestId === undefined)).toBe(true);
      expect(sent[0].snapshot.revision).toBe(sent[1].snapshot.revision);
    });

    it('a state change whose snapshot read fails logs the code only', async () => {
      const { flush, actions, service, sent, logger } = setup();
      service.list = () => {
        throw new Error(`EACCES: ${SECRET_TEXT}`);
      };
      actions.emit({ profileId: PROFILE_A, state: 'failed', revision: 1 });
      await flush();
      expect(sent).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.any(String), {
        code: 'unavailable-storage',
      });
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-ant');
    });

    it('dispose ends the state-change subscription', () => {
      const { actions, handlers } = setup();
      expect(actions.listeners.size).toBe(1);
      handlers.register();
      expect(actions.listeners.size).toBe(1);
      handlers.dispose();
      expect(actions.listeners.size).toBe(0);
    });

    it('still denies an account action for a closed workspace', async () => {
      const { call, actions } = setup({ folders: [OTHER_ROOT] });
      await expect(
        call('provider:startAccountSignIn', { ...base, expectedRevision: 0 }),
      ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
      expect(actions.commands).toEqual([]);
    });
  });
});
