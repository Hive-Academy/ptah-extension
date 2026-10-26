/**
 * Provider account RPC handlers (`provider:*Account*`, TASK_2026_712 Batch 27a).
 *
 *   - `provider:listAccounts` / `provider:getAccountStatus` — reads.
 *   - `provider:addAccount` / `renameAccount` / `removeAccount` — profile
 *     metadata writes (label only; the backend allocates IDs and directories).
 *   - `provider:setAccountSelection` / `setAccountDefault` — future-start
 *     selection writes for one scope or both.
 *   - `provider:startAccountSignIn` / `cancelAccountSignIn` /
 *     `signOutAccount` — validated and authorized here, then run by the
 *     account actions port. Sign-in returns at once with its operation; the
 *     final state arrives later through `onStateChanged`.
 *   - Every actions state change pushes one sanitized snapshot per open
 *     workspace. A sign-in fallback script is returned to the caller only;
 *     it is user-facing content and is never logged.
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
 *     The ledger is a bounded in-process fast path; Add is also idempotent
 *     in storage (the profile ID derives from `requestId`), so a replay after
 *     eviction or restart returns the stored account instead of a second one.
 *     Rename/remove/selection replays are stopped by their expected revision.
 *   - A committed write bumps the snapshot revision and pushes exactly one
 *     sanitized `provider:accountsChanged` notification. Refusals push nothing.
 *
 * Host gating is data: the manifest entry that will own these methods
 * (Batch 27b) requires an account-management capability that only the
 * Electron profile enables, so this class is never registered elsewhere.
 */

import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { ProviderAccountService } from '@ptah-extension/auth-providers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountActionPort } from '@ptah-extension/auth-providers-tokens';
import {
  MESSAGE_TYPES,
  PROVIDER_ACCOUNT_RESULT_CODES,
  PROVIDER_ACCOUNT_RPC_METHOD_NAMES,
  isSafeProviderAccountSummary,
  type ProviderAccountActionResult,
  type ProviderAccountCommittedWrite,
  type ProviderAccountOperation,
  type ProviderAccountProvider,
  type ProviderAccountResultCode,
  type ProviderAccountRpcMethodName,
  type ProviderAccountRpcMethodRegistry,
  type ProviderAccountRpcResult,
  type ProviderAccountScope,
  type ProviderAccountScopeSelection,
  type ProviderAccountSelectionWrite,
  type ProviderAccountSignInFallback,
  type ProviderAccountState,
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

/** One profile state change from the actions port. No path, identity or CLI text. */
export interface ProviderAccountRpcStateChange {
  readonly profileId: string;
  readonly state: ProviderAccountState;
  readonly revision: number;
}

/**
 * The account actions this layer calls: the port, a sign-in start that may
 * carry the manual fallback script, and the state-change subscription.
 * `ProviderAccountActionsService` satisfies it structurally.
 */
export interface ProviderAccountRpcActions extends ProviderAccountActionPort {
  startSignIn(
    command: Parameters<ProviderAccountActionPort['startSignIn']>[0],
  ): Promise<
    ProviderAccountActionResult & {
      readonly fallback?: ProviderAccountSignInFallback;
    }
  >;
  onStateChanged(
    listener: (change: ProviderAccountRpcStateChange) => void,
  ): () => void;
}

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

/** Outcome of sign-in and sign-out: both return their operation. */
type OperationOutcome = Result<'provider:startAccountSignIn'>;

/** Outcome of cancel. */
type CancelOutcome = Result<'provider:cancelAccountSignIn'>;

/**
 * A remembered outcome. An action keeps its promise, so a replay while the
 * first call runs gets the same outcome and never starts a second one.
 */
type LedgerOutcome =
  | { readonly kind: 'write'; readonly value: WriteOutcome }
  | { readonly kind: 'operation'; readonly value: Promise<OperationOutcome> }
  | { readonly kind: 'cancel'; readonly value: Promise<CancelOutcome> };

/** How one action kind is stored in, and read back from, the ledger. */
interface LedgerEntryKind<T> {
  read(outcome: LedgerOutcome): Promise<T> | undefined;
  wrap(value: Promise<T>): LedgerOutcome;
}

const OPERATION_ENTRY: LedgerEntryKind<OperationOutcome> = {
  read: (outcome) => (outcome.kind === 'operation' ? outcome.value : undefined),
  wrap: (value) => ({ kind: 'operation', value }),
};

const CANCEL_ENTRY: LedgerEntryKind<CancelOutcome> = {
  read: (outcome) => (outcome.kind === 'cancel' ? outcome.value : undefined),
  wrap: (value) => ({ kind: 'cancel', value }),
};

interface WriteTarget {
  readonly provider: ProviderAccountProvider;
  readonly workspaceRoot: string;
  readonly requestId: string;
}

/** The only provider whose accounts the service manages today. */
const SERVED_PROVIDER = 'claude' satisfies ProviderAccountProvider;

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
  'release-held': 'Named accounts are not available on this host.',
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
    { readonly fingerprint: string; readonly outcome: LedgerOutcome }
  >();

  /** Sign-in or sign-out this handler started and has not seen settle, by profile. */
  private readonly operations = new Map<string, ProviderAccountOperation>();

  /** Release path of the `onStateChanged` subscription. */
  private unsubscribe: (() => void) | undefined;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(ProviderAccountService)
    private readonly accounts: ProviderAccountRpcService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly broadcaster: ProviderAccountBroadcaster,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS)
    private readonly actions: ProviderAccountRpcActions,
  ) {}

  register(): void {
    this.unsubscribe ??= this.actions.onStateChanged((change) =>
      this.stateChanged(change),
    );
    this.on('provider:listAccounts', (p) => this.listAccounts(p));
    this.on('provider:getAccountStatus', (p) => this.getAccountStatus(p));
    this.on('provider:addAccount', (p) =>
      withAccount(
        // The service keys the new profile by requestId, so a replay the
        // in-memory ledger no longer holds (eviction, restart) cannot add twice.
        this.write('provider:addAccount', p, () =>
          this.accounts.add(p.label, p.requestId),
        ),
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
      this.action('provider:startAccountSignIn', p, OPERATION_ENTRY, (root) =>
        this.startSignIn(root, p),
      ),
    );
    this.on('provider:cancelAccountSignIn', (p) =>
      this.action('provider:cancelAccountSignIn', p, CANCEL_ENTRY, (root) =>
        this.cancelSignIn(root, p),
      ),
    );
    this.on('provider:signOutAccount', (p) =>
      this.action('provider:signOutAccount', p, OPERATION_ENTRY, (root) =>
        this.signOut(root, p),
      ),
    );
  }

  /** Ends the `onStateChanged` subscription. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Registers one method; its params are parsed before `run` sees them. */
  private on<M extends ProviderAccountRpcMethodName>(
    method: M,
    run: (params: Params<M>) => Result<M> | Promise<Result<M>>,
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

  private async getAccountStatus(
    params: Params<'provider:getAccountStatus'>,
  ): Promise<Result<'provider:getAccountStatus'>> {
    if (params.provider !== SERVED_PROVIDER) return refusal('wrong-provider');
    try {
      // One status probe, or one poll tick of a sign-in this process owns.
      const status = await this.actions.readStatus({
        provider: SERVED_PROVIDER,
        profileId: params.profileId,
      });
      if (status.code !== 'ok') {
        return this.actionRefused('provider:getAccountStatus', status);
      }
      const account = this.findAccount(params.profileId);
      if (account === undefined) return refusal('missing-profile');
      const operation = this.operations.get(params.profileId);
      return operation === undefined
        ? { ok: true, account: sanitizeSummary(account) }
        : { ok: true, account: sanitizeSummary(account), operation };
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
      return prior.fingerprint === fingerprint && prior.outcome.kind === 'write'
        ? prior.outcome.value
        : refusal('conflict', REQUEST_REUSED);
    }

    const outcome = this.commit(method, root, params.requestId, apply);
    this.remember(params.requestId, fingerprint, {
      kind: 'write',
      value: outcome,
    });
    return outcome;
  }

  /**
   * One sign-in, cancel or sign-out: the same authority, provider and ledger
   * checks as a write, then the actions port. The ledger keeps the promise,
   * so a replay while the first call runs gets the same outcome.
   */
  private action<T extends OperationOutcome | CancelOutcome>(
    method: ProviderAccountRpcMethodName,
    params: WriteTarget,
    entry: LedgerEntryKind<T | Refusal>,
    run: (root: string) => Promise<T | Refusal>,
  ): Promise<T | Refusal> {
    const root = this.openRoot(params.workspaceRoot);
    if (params.provider !== SERVED_PROVIDER) {
      return Promise.resolve(refusal('wrong-provider'));
    }

    const fingerprint = `${method}\n${JSON.stringify(params)}`;
    const prior = this.ledger.get(params.requestId);
    if (prior) {
      const replay =
        prior.fingerprint === fingerprint
          ? entry.read(prior.outcome)
          : undefined;
      return replay ?? Promise.resolve(refusal('conflict', REQUEST_REUSED));
    }

    const outcome = run(root).catch((error: unknown): T | Refusal =>
      this.refusalFrom(method, error),
    );
    this.remember(params.requestId, fingerprint, entry.wrap(outcome));
    return outcome;
  }

  private async startSignIn(
    root: string,
    params: Params<'provider:startAccountSignIn'>,
  ): Promise<OperationOutcome> {
    const operation: ProviderAccountOperation = {
      operationId: randomUUID(),
      kind: 'sign-in',
    };
    const result = await this.actions.startSignIn({
      provider: SERVED_PROVIDER,
      profileId: params.profileId,
      operationId: operation.operationId,
      expectedRevision: params.expectedRevision,
    });
    if (result.code !== 'ok') {
      return this.actionRefused('provider:startAccountSignIn', result);
    }
    // The sign-in stays pending until `onStateChanged` reports its end.
    this.operations.set(params.profileId, operation);
    const committed = this.actionCommitted(
      'provider:startAccountSignIn',
      root,
      params.requestId,
    );
    if (!committed.ok) return committed;
    // The fallback script goes to the caller only; it is never logged.
    return result.fallback === undefined
      ? { ok: true, snapshot: committed.snapshot, operation }
      : {
          ok: true,
          snapshot: committed.snapshot,
          operation,
          fallback: {
            platform: result.fallback.platform,
            script: result.fallback.script,
          },
        };
  }

  private async cancelSignIn(
    root: string,
    params: Params<'provider:cancelAccountSignIn'>,
  ): Promise<CancelOutcome> {
    const account = this.findAccount(params.profileId);
    if (account === undefined) return refusal('missing-profile');
    // A live sign-in holds the revision its reservation wrote; the port
    // refuses a stale one with `conflict`.
    const result = await this.actions.cancelSignIn({
      provider: SERVED_PROVIDER,
      profileId: params.profileId,
      operationId: params.operationId,
      expectedRevision: account.revision,
    });
    if (result.code !== 'ok' && result.code !== 'cancelled') {
      return this.actionRefused('provider:cancelAccountSignIn', result);
    }
    this.settleOperation(params.profileId, params.operationId);
    return this.actionCommitted(
      'provider:cancelAccountSignIn',
      root,
      params.requestId,
    );
  }

  private async signOut(
    root: string,
    params: Params<'provider:signOutAccount'>,
  ): Promise<OperationOutcome> {
    const operation: ProviderAccountOperation = {
      operationId: randomUUID(),
      kind: 'sign-out',
    };
    // Sign-out settles before the port returns, success or not, so its
    // operation never enters `operations`: a refused sign-out must not
    // replace or delete the handle of a live sign-in for the same profile.
    const result = await this.actions.signOut({
      provider: SERVED_PROVIDER,
      profileId: params.profileId,
      operationId: operation.operationId,
      expectedRevision: params.expectedRevision,
    });
    if (result.code !== 'ok') {
      return this.actionRefused('provider:signOutAccount', result);
    }
    // An accepted sign-out leaves the profile with no live operation.
    this.operations.delete(params.profileId);
    const committed = this.actionCommitted(
      'provider:signOutAccount',
      root,
      params.requestId,
    );
    return committed.ok
      ? { ok: true, snapshot: committed.snapshot, operation }
      : committed;
  }

  /** Revision bump, snapshot and one push for an action the port accepted. */
  private actionCommitted(
    method: ProviderAccountRpcMethodName,
    root: string,
    requestId: string,
  ): ProviderAccountRpcResult<ProviderAccountCommittedWrite> {
    this.revision += 1;
    let snapshot: ProviderAccountsSnapshot;
    try {
      snapshot = this.snapshot(root);
    } catch (error: unknown) {
      this.logger.warn(`${LOG_PREFIX} ${method} snapshot read failed`, {
        code: resultCode(error),
      });
      return refusal('timeout', UNCONFIRMED_SNAPSHOT);
    }
    this.notify({ snapshot, requestId });
    return { ok: true, snapshot };
  }

  /** A port refusal keeps its closed code; the sentence is this layer's fixed copy. */
  private actionRefused(
    method: ProviderAccountRpcMethodName,
    result: ProviderAccountActionResult,
  ): Refusal {
    const code: RefusalCode =
      result.code === 'ok' ? 'unavailable-storage' : result.code;
    this.logger.debug(`${LOG_PREFIX} ${method} refused`, { code });
    return refusal(code);
  }

  /**
   * One actions state change: a sign-in that left `pending` is settled, and
   * every open workspace gets one snapshot at the next revision.
   */
  private stateChanged(change: ProviderAccountRpcStateChange): void {
    if (change.state !== 'pending') {
      const operation = this.operations.get(change.profileId);
      if (operation?.kind === 'sign-in')
        this.operations.delete(change.profileId);
    }
    this.revision += 1;
    for (const root of this.workspace.getWorkspaceFolders()) {
      let snapshot: ProviderAccountsSnapshot;
      try {
        snapshot = this.snapshot(root);
      } catch (error: unknown) {
        // degradation-audit: reported - a state push is best effort; the renderer re-reads with `provider:listAccounts`.
        this.logger.warn(`${LOG_PREFIX} state change snapshot read failed`, {
          code: resultCode(error),
        });
        return;
      }
      this.notify({ snapshot });
    }
  }

  private settleOperation(profileId: string, operationId: string): void {
    if (this.operations.get(profileId)?.operationId === operationId) {
      this.operations.delete(profileId);
    }
  }

  private findAccount(profileId: string): ProviderAccountSummary | undefined {
    return this.accounts.list().find((entry) => entry.profileId === profileId);
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
      // The write committed and only the read-back failed: `timeout` is the
      // contract's "unconfirmed, re-read the snapshot" code.
      return refusal('timeout', UNCONFIRMED_SNAPSHOT);
    }

    this.notify({ snapshot, requestId });
    return account === undefined
      ? { ok: true, snapshot }
      : { ok: true, snapshot, account: sanitizeSummary(account) };
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
      selection:
        stored.revision < 0 ? { kind: 'omitted' } : { kind: 'ambient' },
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
    outcome: LedgerOutcome,
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
  return {
    ok: false,
    result: { code, summary: summary ?? REFUSAL_COPY[code] },
  };
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
