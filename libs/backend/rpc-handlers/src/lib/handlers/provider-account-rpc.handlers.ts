/**
 * Provider account RPC handlers (`provider:*Account*`, TASK_2026_712 Batch 27a).
 *
 *   - `provider:listAccounts` / `provider:getAccountStatus` — reads.
 *   - `provider:addAccount` / `renameAccount` / `removeAccount` — profile
 *     metadata writes (label only; the backend allocates IDs and directories).
 *   - `provider:setAccountSelection` / `setAccountDefault` — future-start
 *     selection writes for one scope or both.
 *   - `provider:startAccountSignIn` / `cancelAccountSignIn` /
 *     `signOutAccount` — release-held (decisions.md D7): validated, then
 *     refused with `release-held`. Nothing is launched and success is never
 *     reported.
 *
 * Boundary rules:
 *   - Params pass the strict schemas in `provider-account-rpc.schema.ts`
 *     first; a failed parse throws `INVALID_PARAMS` before anything runs.
 *   - `workspaceRoot` must name an open workspace folder; the registered
 *     folder string, not the caller's spelling, keys every selection.
 *   - Only `claude` accounts are served; another provider is `wrong-provider`.
 *   - Domain failures become `{ ok: false, result }` with a closed code and a
 *     fixed or verified-safe sentence. Exception messages, paths and
 *     credentials never cross this layer, and logs carry codes only.
 *   - Every write carries a `requestId`. A repeat with the same request
 *     returns the first outcome; the same ID with different params is
 *     `conflict`. Stale revisions are refused by the service (`conflict`).
 *   - A committed write bumps the snapshot revision and pushes exactly one
 *     sanitized `provider:accountsChanged` notification. Refusals push nothing.
 *
 * Host gating is data: the manifest entry that will own these methods
 * (Batch 27b) requires an account-management capability that only the
 * Electron profile enables, so this class is never registered elsewhere.
 */

import * as path from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { ProviderAccountService } from '@ptah-extension/auth-providers';
import {
  MESSAGE_TYPES,
  PROVIDER_ACCOUNT_RESULT_CODES,
  PROVIDER_ACCOUNT_RPC_METHOD_NAMES,
  isSafeProviderAccountSummary,
  type ProviderAccountCommittedWrite,
  type ProviderAccountProvider,
  type ProviderAccountResultCode,
  type ProviderAccountRpcMethodName,
  type ProviderAccountRpcMethodRegistry,
  type ProviderAccountRpcResult,
  type ProviderAccountScope,
  type ProviderAccountScopeSelection,
  type ProviderAccountSelectionWrite,
  type ProviderAccountSummary,
  type ProviderAccountsChangedNotification,
  type ProviderAccountsSnapshot,
} from '@ptah-extension/shared';
import { PROVIDER_ACCOUNT_RPC_SCHEMAS } from './provider-account-rpc.schema';

/** The account operations this layer calls. Kept narrow for a test fake. */
export type ProviderAccountRpcService = Pick<
  ProviderAccountService,
  'list' | 'add' | 'rename' | 'remove' | 'selection' | 'select' | 'setDefault'
>;

/** The host push path every webview-facing handler uses. */
export interface ProviderAccountBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

type Params<M extends ProviderAccountRpcMethodName> =
  ProviderAccountRpcMethodRegistry[M]['params'];
type Result<M extends ProviderAccountRpcMethodName> =
  ProviderAccountRpcMethodRegistry[M]['result'];
type RefusalCode = Exclude<ProviderAccountResultCode, 'ok'>;
type Refusal = Extract<ProviderAccountRpcResult<object>, { ok: false }>;

/** Outcome of any committed-write method; Add and Rename also carry `account`. */
type WriteOutcome = ProviderAccountRpcResult<
  ProviderAccountCommittedWrite & { readonly account?: ProviderAccountSummary }
>;

interface WriteTarget {
  readonly provider: ProviderAccountProvider;
  readonly workspaceRoot: string;
  readonly requestId: string;
}

/** The only provider whose accounts the service manages today. */
const SERVED_PROVIDER: ProviderAccountProvider = 'claude';

/** Remembered write outcomes. Oldest is evicted first; no timer. */
const REQUEST_LEDGER_LIMIT = 256;

const LOG_PREFIX = '[providerAccounts]';

/** Fixed caller-facing copy per refusal code. Never an exception message. */
const REFUSAL_COPY: Record<RefusalCode, string> = {
  'missing-profile': 'This account is no longer available.',
  'wrong-provider': 'This action requires a Claude account.',
  'unsupported-store': 'This account store cannot be verified.',
  'unsupported-source': 'The account authentication source cannot be verified.',
  'identity-mismatch': 'The account identity has changed.',
  'identity-unproved': 'The account identity could not be verified.',
  'route-changed': 'The account directory has changed.',
  busy: 'The account is in use or has an unresolved operation.',
  'unavailable-storage': 'Account storage is unavailable.',
  conflict: 'The account changed. Refresh and try again.',
  cancelled: 'Sign in was cancelled. Check status before trying again.',
  timeout: 'The account operation timed out. Check status before trying again.',
  'release-held': 'Named account commands are awaiting release authorization.',
  'invalid-bound': 'The account binding is invalid.',
};

/** The write committed but its snapshot could not be read back. */
const UNCONFIRMED_SNAPSHOT =
  'The change may have been saved, but account storage could not be read. Refresh to check.';

/**
 * `ProviderAccountStoreError`'s default sentence. It says nothing the code does
 * not, so the fixed copy for the code is used instead.
 */
const GENERIC_STORE_SUMMARY =
  'The local account operation could not be completed.';

const REQUEST_REUSED =
  'This request was already used for a different change. Refresh and try again.';

@injectable()
export class ProviderAccountRpcHandlers {
  static readonly METHODS = PROVIDER_ACCOUNT_RPC_METHOD_NAMES;

  /**
   * Snapshot revision. Seeded from the clock so a revision issued after a
   * host restart is still newer than any the renderer kept; bumped once per
   * committed write.
   */
  private revision = Date.now();

  /** requestId → the params fingerprint and the outcome it produced. */
  private readonly ledger = new Map<
    string,
    { readonly fingerprint: string; readonly outcome: WriteOutcome }
  >();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(ProviderAccountService)
    private readonly accounts: ProviderAccountRpcService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly broadcaster: ProviderAccountBroadcaster,
  ) {}

  register(): void {
    this.on('provider:listAccounts', (p) => this.listAccounts(p));
    this.on('provider:getAccountStatus', (p) => this.getAccountStatus(p));
    this.on('provider:addAccount', (p) =>
      withAccount(
        this.write('provider:addAccount', p, () => this.accounts.add(p.label)),
      ),
    );
    this.on('provider:renameAccount', (p) =>
      withAccount(
        this.write('provider:renameAccount', p, () =>
          this.accounts.rename(p.profileId, p.expectedRevision, p.label),
        ),
      ),
    );
    this.on('provider:removeAccount', (p) =>
      this.write('provider:removeAccount', p, () => {
        this.accounts.remove(p.profileId, p.expectedRevision);
        return undefined;
      }),
    );
    this.on('provider:setAccountSelection', (p) =>
      this.write('provider:setAccountSelection', p, (root) => {
        const named = namedProfile(p.selection);
        this.accounts.select(
          root,
          p.scope,
          named.profileId,
          p.expectedSelectionRevision,
          named.expectedProfileRevision,
        );
        return undefined;
      }),
    );
    this.on('provider:setAccountDefault', (p) =>
      this.write('provider:setAccountDefault', p, (root) => {
        const named = namedProfile(p.selection);
        this.accounts.setDefault(
          root,
          named.profileId,
          p.expectedSelectionRevisions,
          named.expectedProfileRevision,
        );
        return undefined;
      }),
    );
    this.on('provider:startAccountSignIn', (p) =>
      this.releaseHeld('provider:startAccountSignIn', p),
    );
    this.on('provider:cancelAccountSignIn', (p) =>
      this.releaseHeld('provider:cancelAccountSignIn', p),
    );
    this.on('provider:signOutAccount', (p) =>
      this.releaseHeld('provider:signOutAccount', p),
    );
  }

  /** Registers one method; its params are parsed before `run` sees them. */
  private on<M extends ProviderAccountRpcMethodName>(
    method: M,
    run: (params: Params<M>) => Result<M>,
  ): void {
    this.rpcHandler.registerMethod<Params<M>, Result<M>>(
      method,
      async (params: unknown) => run(this.parse(method, params)),
    );
  }

  private parse<M extends ProviderAccountRpcMethodName>(
    method: M,
    params: unknown,
  ): Params<M> {
    const parsed = PROVIDER_ACCOUNT_RPC_SCHEMAS[method].safeParse(params);
    if (!parsed.success) {
      throw new RpcUserError(`${method}: invalid params`, 'INVALID_PARAMS');
    }
    return parsed.data;
  }

  private listAccounts(
    params: Params<'provider:listAccounts'>,
  ): Result<'provider:listAccounts'> {
    const root = this.openRoot(params.workspaceRoot);
    if (params.provider !== SERVED_PROVIDER) return refusal('wrong-provider');
    try {
      return { ok: true, snapshot: this.snapshot(root) };
    } catch (error: unknown) {
      return this.refusalFrom('provider:listAccounts', error);
    }
  }

  private getAccountStatus(
    params: Params<'provider:getAccountStatus'>,
  ): Result<'provider:getAccountStatus'> {
    if (params.provider !== SERVED_PROVIDER) return refusal('wrong-provider');
    try {
      const account = this.accounts
        .list()
        .find((entry) => entry.profileId === params.profileId);
      // No sign-in or sign-out runs while those commands are release-held,
      // so a status never carries an `operation`.
      return account
        ? { ok: true, account: sanitizeSummary(account) }
        : refusal('missing-profile');
    } catch (error: unknown) {
      return this.refusalFrom('provider:getAccountStatus', error);
    }
  }

  /**
   * One committed write: authority and provider checks, the request ledger,
   * the service call, then revision bump, snapshot and a single push. Runs
   * without an `await`, so writes cannot interleave and notifications leave
   * in revision order.
   */
  private write(
    method: ProviderAccountRpcMethodName,
    params: WriteTarget,
    apply: (root: string) => ProviderAccountSummary | undefined,
  ): WriteOutcome {
    const root = this.openRoot(params.workspaceRoot);
    if (params.provider !== SERVED_PROVIDER) return refusal('wrong-provider');

    const fingerprint = `${method}\n${JSON.stringify(params)}`;
    const prior = this.ledger.get(params.requestId);
    if (prior) {
      return prior.fingerprint === fingerprint
        ? prior.outcome
        : refusal('conflict', REQUEST_REUSED);
    }

    const outcome = this.commit(method, root, params.requestId, apply);
    this.remember(params.requestId, fingerprint, outcome);
    return outcome;
  }

  private commit(
    method: ProviderAccountRpcMethodName,
    root: string,
    requestId: string,
    apply: (root: string) => ProviderAccountSummary | undefined,
  ): WriteOutcome {
    let account: ProviderAccountSummary | undefined;
    try {
      account = apply(root);
    } catch (error: unknown) {
      return this.refusalFrom(method, error);
    }

    this.revision += 1;
    let snapshot: ProviderAccountsSnapshot;
    try {
      snapshot = this.snapshot(root);
    } catch (error: unknown) {
      this.logger.warn(`${LOG_PREFIX} ${method} snapshot read failed`, {
        code: resultCode(error),
      });
      return refusal('unavailable-storage', UNCONFIRMED_SNAPSHOT);
    }

    this.notify({ snapshot, requestId });
    return account === undefined
      ? { ok: true, snapshot }
      : { ok: true, snapshot, account: sanitizeSummary(account) };
  }

  /**
   * Named sign-in, cancel and sign-out stay release-held (decisions.md D7).
   * The request is still validated and authorized so a forbidden caller gets
   * the same denial it would get once the commands are live.
   */
  private releaseHeld(
    method: ProviderAccountRpcMethodName,
    params: WriteTarget,
  ): Refusal {
    this.openRoot(params.workspaceRoot);
    if (params.provider !== SERVED_PROVIDER) return refusal('wrong-provider');
    this.logger.debug(`${LOG_PREFIX} ${method} refused: release-held`);
    return refusal('release-held');
  }

  /**
   * Returns the registered folder the caller named. A relative path is never
   * resolved against the process directory.
   */
  private openRoot(workspaceRoot: string): string {
    const match = path.isAbsolute(workspaceRoot)
      ? this.workspace
          .getWorkspaceFolders()
          .find((folder) => isSameRoot(folder, workspaceRoot))
      : undefined;
    if (match === undefined) {
      throw new RpcUserError(
        'This workspace is not open in Ptah',
        'UNAUTHORIZED_WORKSPACE',
      );
    }
    return match;
  }

  /** Built field by field: no directory, fingerprint or owner key leaves. */
  private snapshot(root: string): ProviderAccountsSnapshot {
    return {
      provider: SERVED_PROVIDER,
      workspaceRoot: root,
      revision: this.revision,
      accounts: this.accounts.list().map(sanitizeSummary),
      selections: {
        main: this.scopeSelection(root, 'main'),
        lane: this.scopeSelection(root, 'lane'),
      },
    };
  }

  private scopeSelection(
    root: string,
    scope: ProviderAccountScope,
  ): ProviderAccountScopeSelection {
    const stored = this.accounts.selection(root, scope);
    if (stored.profileId !== null) {
      return {
        scope,
        selection: { kind: 'named', profileId: stored.profileId },
        revision: stored.revision,
      };
    }
    return {
      scope,
      selection: stored.revision < 0 ? { kind: 'omitted' } : { kind: 'ambient' },
      revision: stored.revision,
    };
  }

  /**
   * Pushes one notification. Deferred to a microtask so a broadcaster that
   * throws synchronously cannot turn a committed write into a failed RPC.
   */
  private notify(notification: ProviderAccountsChangedNotification): void {
    void Promise.resolve()
      .then(() =>
        this.broadcaster.broadcastMessage(
          MESSAGE_TYPES.PROVIDER_ACCOUNTS_CHANGED,
          notification,
        ),
      )
      .catch((error: unknown) => {
        // degradation-audit: reported - delivery is best effort by contract; the renderer recovers with a `provider:listAccounts` re-read, never a replay.
        this.logger.warn(`${LOG_PREFIX} accountsChanged broadcast failed`, {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      });
  }

  private remember(
    requestId: string,
    fingerprint: string,
    outcome: WriteOutcome,
  ): void {
    if (this.ledger.size >= REQUEST_LEDGER_LIMIT) {
      const oldest = this.ledger.keys().next();
      if (!oldest.done) this.ledger.delete(oldest.value);
    }
    this.ledger.set(requestId, { fingerprint, outcome });
  }

  /** Domain failure → closed code and safe sentence. Logs the code only. */
  private refusalFrom(
    method: ProviderAccountRpcMethodName,
    error: unknown,
  ): Refusal {
    const code = resultCode(error);
    this.logger.warn(`${LOG_PREFIX} ${method} refused`, { code });
    return refusal(code, safeStoreSummary(error));
  }
}

function refusal(code: RefusalCode, summary?: string): Refusal {
  return { ok: false, result: { code, summary: summary ?? REFUSAL_COPY[code] } };
}

/** Add and Rename always commit with the account they wrote. */
function withAccount(
  outcome: WriteOutcome,
): ProviderAccountRpcResult<
  ProviderAccountCommittedWrite & { readonly account: ProviderAccountSummary }
> {
  if (!outcome.ok) return outcome;
  if (outcome.account === undefined) return refusal('conflict');
  return { ok: true, snapshot: outcome.snapshot, account: outcome.account };
}

function namedProfile(selection: ProviderAccountSelectionWrite): {
  readonly profileId: string | null;
  readonly expectedProfileRevision: number | undefined;
} {
  return selection.kind === 'named'
    ? {
        profileId: selection.profileId,
        expectedProfileRevision: selection.expectedProfileRevision,
      }
    : { profileId: null, expectedProfileRevision: undefined };
}

function sanitizeSummary(
  summary: ProviderAccountSummary,
): ProviderAccountSummary {
  return {
    profileId: summary.profileId,
    label: summary.label,
    provider: summary.provider,
    state: summary.state,
    owner: summary.owner,
    revision: summary.revision,
    activeRunCount: summary.activeRunCount,
  };
}

/** The store's closed code, or `unavailable-storage` for anything else. */
function resultCode(error: unknown): RefusalCode {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'unavailable-storage';
  }
  const code: unknown = error.code;
  const known = PROVIDER_ACCOUNT_RESULT_CODES.find(
    (value): value is RefusalCode => value !== 'ok' && value === code,
  );
  return known ?? 'unavailable-storage';
}

/**
 * The store's own sentence when it is a store refusal that passes the shared
 * safe-summary check (for example the duplicate-route copy); otherwise the
 * fixed copy for its code.
 */
function safeStoreSummary(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    error.name === 'ProviderAccountStoreError' &&
    error.message !== GENERIC_STORE_SUMMARY &&
    isSafeProviderAccountSummary(error.message)
  ) {
    return error.message;
  }
  return undefined;
}

function isSameRoot(registered: string, requested: string): boolean {
  const a = path.resolve(registered);
  const b = path.resolve(requested);
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}
