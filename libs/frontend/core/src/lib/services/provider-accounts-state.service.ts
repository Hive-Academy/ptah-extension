import {
  DestroyRef,
  Injectable,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import {
  MESSAGE_TYPES,
  PROVIDER_ACCOUNT_PROVIDERS,
  PROVIDER_ACCOUNT_SCOPES,
  isSafeProviderAccountSummary,
  type ProviderAccountActionResult,
  type ProviderAccountOperation,
  type ProviderAccountProvider,
  type ProviderAccountRpcMethodName,
  type ProviderAccountScope,
  type ProviderAccountSignInFallback,
  type ProviderAccountsSnapshot,
  type RpcMethodParams,
  type RpcMethodResult,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import type { MessageHandler } from './message-router.types';
import { VSCodeService } from './vscode.service';
import { WorkspaceScopeService } from './workspace-scope.service';

/** Account writes can wait on a lock or a store; the host settles them well inside this. */
const ACCOUNT_RPC_TIMEOUT_MS = 30_000;
const READ_ERROR = 'Could not load accounts. Retry.' as const;
/** Fixed copy when the host's result sentence is not safe to show. */
const FALLBACK_SUMMARY = 'This action did not complete. Refresh and try again.';

/**
 * One provider's authoritative account state for the active workspace.
 * `snapshot` is only ever a host snapshot (read, write result or push); nothing is
 * derived or optimistic. After a failed read the last snapshot stays, flagged `stale`.
 */
export interface ProviderAccountsView {
  /** `inert`: this host does not serve account methods; no RPC is ever made. */
  readonly status: 'inert' | 'idle' | 'loading' | 'ready' | 'error';
  readonly snapshot: ProviderAccountsSnapshot | null;
  readonly stale: boolean;
  readonly error: typeof READ_ERROR | null;
}

export type ProviderAccountActionKind =
  | 'add'
  | 'rename'
  | 'remove'
  | 'sign-in'
  | 'cancel-sign-in'
  | 'sign-out'
  | 'select'
  | 'default';

/**
 * One user action, keyed by its idempotency `requestId`.
 * `unconfirmed`: transport failure or host `timeout`; the write may have landed, so the
 * snapshot is re-read and the action is never reported as rolled back.
 */
export interface ProviderAccountAction {
  readonly requestId: string;
  readonly provider: ProviderAccountProvider;
  readonly kind: ProviderAccountActionKind;
  readonly profileId: string | null;
  readonly scope: ProviderAccountScope | null;
  readonly status: 'pending' | 'saved' | 'failed' | 'unconfirmed';
  /** Closed code plus a safe sentence; set only for `failed`. */
  readonly result: ProviderAccountActionResult | null;
}

export type ProviderAccountActionOutcome =
  | { readonly status: 'saved'; readonly snapshot: ProviderAccountsSnapshot }
  | { readonly status: 'failed'; readonly result: ProviderAccountActionResult }
  | { readonly status: 'unconfirmed' }
  /** Inert host, no active workspace, or a profile/snapshot the caller named is not loaded. */
  | { readonly status: 'unavailable' };

/** What a chooser emits: "Use existing default" or one profile ID. */
export type ProviderAccountChoice =
  | { readonly kind: 'ambient' }
  | { readonly kind: 'named'; readonly profileId: string };

interface Slot {
  readonly view: WritableSignal<ProviderAccountsView>;
  readonly operations: WritableSignal<
    Readonly<Record<string, ProviderAccountOperation>>
  >;
  /** Manual sign-in scripts by profile ID; kept only while that profile's sign-in is pending. */
  readonly fallbacks: WritableSignal<
    Readonly<Record<string, ProviderAccountSignInFallback>>
  >;
  opened: boolean;
  /** Revision of the applied snapshot; `null` = accept the next snapshot unconditionally. */
  revision: number | null;
  readSeq: number;
  /** Read sequence of a reconnect re-read that may replace a newer-numbered snapshot. */
  resetSeq: number | null;
}

const IDLE: ProviderAccountsView = {
  status: 'idle',
  snapshot: null,
  stale: false,
  error: null,
};
const INERT: ProviderAccountsView = { ...IDLE, status: 'inert' };

/**
 * Single owner of provider-account state (TASK_2026_712 Batch 29).
 *
 * - Talks to the host only through `ClaudeRpcService` (`provider:*Account*`) and the
 *   `provider:accountsChanged` push, which reaches it as a `MESSAGE_HANDLERS` entry
 *   (`apps/ptah-extension-webview/src/app/app.config.ts`).
 * - Inert unless the host is Electron, the only host profile with `providerAccounts`.
 * - Snapshots are applied only when their revision is newer than the held one, so a
 *   duplicate or out-of-order push/response is ignored. `reconnect()` re-reads and
 *   accepts the host's answer even when its revision is lower (host restart).
 * - Main and lane selections are read from one atomic snapshot; every write sends the
 *   revisions of that snapshot, and a selection changes only when a committed snapshot
 *   says so. Named admission is not represented here: a named selection is never
 *   reported as admitted (D7).
 *
 * Page-owned lifecycle: call `open(provider)` on entry. No constructor I/O or polling.
 */
@Injectable({ providedIn: 'root' })
export class ProviderAccountsStateService implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly workspace = inject(WorkspaceScopeService);
  private readonly enabled = inject(VSCodeService).isElectron;
  private disposed = false;
  private readonly slots = Object.fromEntries(
    PROVIDER_ACCOUNT_PROVIDERS.map((provider) => [provider, this.createSlot()]),
  ) as Record<ProviderAccountProvider, Slot>;
  private readonly actionsState = signal<
    Readonly<Record<string, ProviderAccountAction>>
  >({});

  readonly handledMessageTypes = [
    MESSAGE_TYPES.PROVIDER_ACCOUNTS_CHANGED,
  ] as const;
  /** Every action of this session by `requestId`, latest status. */
  readonly actions = this.actionsState.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
    });
    let generation = untracked(() => this.workspace.generation());
    effect(() => {
      const next = this.workspace.generation();
      if (next === generation) return;
      generation = next;
      untracked(() => this.resetForWorkspace());
    });
  }

  /** Authoritative view for one provider. */
  state(provider: ProviderAccountProvider): Signal<ProviderAccountsView> {
    return this.slots[provider].view.asReadonly();
  }

  /** Sign-in/out handles by profile ID, as issued by the host. */
  operations(
    provider: ProviderAccountProvider,
  ): Signal<Readonly<Record<string, ProviderAccountOperation>>> {
    return this.slots[provider].operations.asReadonly();
  }

  /**
   * Manual sign-in scripts by profile ID, issued when the host could not open a login
   * console. User-facing content only: never logged, never sent back to the host.
   */
  fallbacks(
    provider: ProviderAccountProvider,
  ): Signal<Readonly<Record<string, ProviderAccountSignInFallback>>> {
    return this.slots[provider].fallbacks.asReadonly();
  }

  async open(provider: ProviderAccountProvider): Promise<void> {
    if (!this.enabled) return;
    this.slots[provider].opened = true;
    await this.refresh(provider);
  }

  /** Per-region retry and the re-read after an unconfirmed write. */
  async refresh(provider: ProviderAccountProvider): Promise<void> {
    await this.read(provider, false);
  }

  /** After the host connection returns: the host's answer replaces any held revision. */
  async reconnect(provider: ProviderAccountProvider): Promise<void> {
    await this.read(provider, true);
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (
      !this.enabled ||
      this.disposed ||
      message.type !== MESSAGE_TYPES.PROVIDER_ACCOUNTS_CHANGED ||
      !isRecord(message.payload)
    ) {
      return;
    }
    const snapshot = message.payload['snapshot'];
    if (!isSnapshot(snapshot)) return;
    const slot = this.slots[snapshot.provider];
    // A push after a reconnect started is from the new connection: it is authoritative.
    if (slot.resetSeq !== null && this.isActiveWorkspace(snapshot)) {
      slot.resetSeq = null;
      slot.revision = null;
    }
    const applied = this.apply(snapshot);
    const requestId = message.payload['requestId'];
    if (applied && typeof requestId === 'string') {
      this.settle(requestId, 'saved', null);
    }
  }

  addAccount(
    provider: ProviderAccountProvider,
    label: string,
  ): Promise<ProviderAccountActionOutcome> {
    return this.write(
      { provider, kind: 'add', profileId: null, scope: null },
      'provider:addAccount',
      (base) => ({ ...base, label }),
    );
  }

  renameAccount(
    provider: ProviderAccountProvider,
    profileId: string,
    label: string,
  ): Promise<ProviderAccountActionOutcome> {
    return this.profileWrite(provider, 'rename', profileId, (p) =>
      this.write(p.action, 'provider:renameAccount', (base) => ({
        ...base,
        ...p.write,
        label,
      })),
    );
  }

  /** Removes local metadata only. A selection naming it changes only by the committed snapshot. */
  removeAccount(
    provider: ProviderAccountProvider,
    profileId: string,
  ): Promise<ProviderAccountActionOutcome> {
    return this.profileWrite(provider, 'remove', profileId, (p) =>
      this.write(p.action, 'provider:removeAccount', (base) => ({
        ...base,
        ...p.write,
      })),
    );
  }

  /** Never marks the profile signed in: the state comes from the host snapshot only. */
  startSignIn(
    provider: ProviderAccountProvider,
    profileId: string,
  ): Promise<ProviderAccountActionOutcome> {
    return this.profileWrite(provider, 'sign-in', profileId, (p) =>
      this.write(p.action, 'provider:startAccountSignIn', (base) => ({
        ...base,
        ...p.write,
      })),
    );
  }

  signOut(
    provider: ProviderAccountProvider,
    profileId: string,
  ): Promise<ProviderAccountActionOutcome> {
    return this.profileWrite(provider, 'sign-out', profileId, (p) =>
      this.write(p.action, 'provider:signOutAccount', (base) => ({
        ...base,
        ...p.write,
      })),
    );
  }

  /** Explicit Cancel only; closing a surface never cancels a sign-in. */
  async cancelSignIn(
    provider: ProviderAccountProvider,
    profileId: string,
  ): Promise<ProviderAccountActionOutcome> {
    const operation = this.slots[provider].operations()[profileId];
    if (!operation || operation.kind !== 'sign-in') {
      return { status: 'unavailable' };
    }
    return this.write(
      { provider, kind: 'cancel-sign-in', profileId, scope: null },
      'provider:cancelAccountSignIn',
      (base) => ({ ...base, profileId, operationId: operation.operationId }),
    );
  }

  /**
   * Re-reads one profile's operation handle (e.g. to offer Cancel after a reload).
   * The returned summary is not merged: account rows come from snapshots only.
   */
  async refreshAccountStatus(
    provider: ProviderAccountProvider,
    profileId: string,
  ): Promise<void> {
    if (!this.enabled || this.disposed) return;
    const response = await this.rpc.call(
      'provider:getAccountStatus',
      { provider, profileId },
      { timeout: ACCOUNT_RPC_TIMEOUT_MS },
    );
    if (this.disposed || !response.isSuccess() || !response.data.ok) return;
    const operation = response.data.operation;
    this.slots[provider].operations.update((current) => {
      const next: Record<string, ProviderAccountOperation> = { ...current };
      if (operation) next[profileId] = operation;
      else delete next[profileId];
      return next;
    });
    // The status read carries no script: a finished sign-in drops it, a running one keeps it.
    if (!operation) this.dropFallback(provider, profileId);
  }

  /** Writes one scope only, against that scope's revision in the held snapshot. */
  setSelection(
    provider: ProviderAccountProvider,
    scope: ProviderAccountScope,
    choice: ProviderAccountChoice,
  ): Promise<ProviderAccountActionOutcome> {
    const snapshot = this.slots[provider].view().snapshot;
    const selection = snapshot && this.selectionWrite(snapshot, choice);
    if (!snapshot || !selection) {
      return Promise.resolve({ status: 'unavailable' });
    }
    return this.write(
      {
        provider,
        kind: 'select',
        profileId: choice.kind === 'named' ? choice.profileId : null,
        scope,
      },
      'provider:setAccountSelection',
      (base) => ({
        ...base,
        scope,
        selection,
        expectedSelectionRevision: snapshot.selections[scope].revision,
      }),
    );
  }

  /** Both scopes in one host transaction, against both revisions of the same snapshot. */
  setDefault(
    provider: ProviderAccountProvider,
    choice: ProviderAccountChoice,
  ): Promise<ProviderAccountActionOutcome> {
    const snapshot = this.slots[provider].view().snapshot;
    const selection = snapshot && this.selectionWrite(snapshot, choice);
    if (!snapshot || !selection) {
      return Promise.resolve({ status: 'unavailable' });
    }
    return this.write(
      {
        provider,
        kind: 'default',
        profileId: choice.kind === 'named' ? choice.profileId : null,
        scope: null,
      },
      'provider:setAccountDefault',
      (base) => ({
        ...base,
        selection,
        expectedSelectionRevisions: {
          main: snapshot.selections.main.revision,
          lane: snapshot.selections.lane.revision,
        },
      }),
    );
  }

  // ---------------------------------------------------------------------------

  private createSlot(): Slot {
    return {
      view: signal(this.enabled ? IDLE : INERT),
      operations: signal({}),
      fallbacks: signal({}),
      opened: false,
      revision: null,
      readSeq: 0,
      resetSeq: null,
    };
  }

  private resetForWorkspace(): void {
    for (const provider of PROVIDER_ACCOUNT_PROVIDERS) {
      const slot = this.slots[provider];
      slot.readSeq += 1;
      slot.revision = null;
      slot.resetSeq = null;
      slot.operations.set({});
      slot.fallbacks.set({});
      slot.view.set(this.enabled ? IDLE : INERT);
      if (slot.opened) void this.refresh(provider);
    }
  }

  private async read(
    provider: ProviderAccountProvider,
    reset: boolean,
  ): Promise<void> {
    const workspaceRoot = this.workspace.activeWorkspacePath();
    if (!this.enabled || this.disposed || workspaceRoot === null) return;
    const slot = this.slots[provider];
    const seq = ++slot.readSeq;
    if (reset) slot.resetSeq = seq;
    slot.view.update((view) => ({ ...view, status: 'loading', error: null }));
    const response = await this.rpc.call(
      'provider:listAccounts',
      { provider, workspaceRoot },
      { timeout: ACCOUNT_RPC_TIMEOUT_MS },
    );
    if (this.disposed) return;
    const data = response.isSuccess() ? response.data : null;
    const snapshot =
      data?.ok && isSnapshot(data.snapshot) ? data.snapshot : null;
    if (snapshot && slot.resetSeq === seq) {
      slot.resetSeq = null;
      slot.revision = null;
    }
    if (snapshot) this.apply(snapshot);
    // Only the latest read decides the loading/error status.
    if (seq !== slot.readSeq) return;
    if (snapshot) {
      slot.view.update((view) => ({
        ...view,
        status: 'ready',
        stale: false,
        error: null,
      }));
    } else {
      if (slot.resetSeq === seq) slot.resetSeq = null;
      slot.view.update((view) => ({
        ...view,
        status: 'error',
        stale: view.snapshot !== null,
        error: READ_ERROR,
      }));
    }
  }

  /** Applies a host snapshot when it is for the active workspace and newer than the held one. */
  private apply(snapshot: ProviderAccountsSnapshot): boolean {
    if (!this.isActiveWorkspace(snapshot)) return false;
    const slot = this.slots[snapshot.provider];
    if (slot.revision !== null && snapshot.revision <= slot.revision) {
      return false;
    }
    slot.revision = snapshot.revision;
    slot.view.set({ status: 'ready', snapshot, stale: false, error: null });
    const pending = new Set(
      snapshot.accounts
        .filter((account) => account.state === 'pending')
        .map((account) => account.profileId),
    );
    slot.operations.update((current) => {
      const kept: Record<string, ProviderAccountOperation> = {};
      for (const [profileId, operation] of Object.entries(current)) {
        if (pending.has(profileId)) kept[profileId] = operation;
      }
      return kept;
    });
    slot.fallbacks.update((current) => {
      const kept: Record<string, ProviderAccountSignInFallback> = {};
      for (const [profileId, fallback] of Object.entries(current)) {
        if (pending.has(profileId)) kept[profileId] = fallback;
      }
      return kept;
    });
    return true;
  }

  private isActiveWorkspace(snapshot: ProviderAccountsSnapshot): boolean {
    return snapshot.workspaceRoot === this.workspace.activeWorkspacePath();
  }

  /** Resolves the profile and its revision from the held snapshot, or reports `unavailable`. */
  private profileWrite(
    provider: ProviderAccountProvider,
    kind: ProviderAccountActionKind,
    profileId: string,
    run: (prepared: {
      action: Omit<ProviderAccountAction, 'requestId' | 'status' | 'result'>;
      write: { profileId: string; expectedRevision: number };
    }) => Promise<ProviderAccountActionOutcome>,
  ): Promise<ProviderAccountActionOutcome> {
    const account = this.slots[provider]
      .view()
      .snapshot?.accounts.find((entry) => entry.profileId === profileId);
    if (!account) return Promise.resolve({ status: 'unavailable' });
    return run({
      action: { provider, kind, profileId, scope: null },
      write: { profileId, expectedRevision: account.revision },
    });
  }

  private selectionWrite(
    snapshot: ProviderAccountsSnapshot,
    choice: ProviderAccountChoice,
  ): RpcMethodParams<'provider:setAccountDefault'>['selection'] | null {
    if (choice.kind === 'ambient') return { kind: 'ambient' };
    const account = snapshot.accounts.find(
      (entry) => entry.profileId === choice.profileId,
    );
    return account
      ? {
          kind: 'named',
          profileId: account.profileId,
          expectedProfileRevision: account.revision,
        }
      : null;
  }

  private async write<M extends AccountWriteMethod>(
    action: Omit<ProviderAccountAction, 'requestId' | 'status' | 'result'>,
    method: M,
    params: (base: {
      provider: ProviderAccountProvider;
      workspaceRoot: string;
      requestId: string;
    }) => RpcMethodParams<M>,
  ): Promise<ProviderAccountActionOutcome> {
    const workspaceRoot = this.workspace.activeWorkspacePath();
    if (!this.enabled || this.disposed || workspaceRoot === null) {
      return { status: 'unavailable' };
    }
    // 32 hex chars: inside the 8–64 opaque-ID bound. getRandomValues needs no secure context.
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    this.actionsState.update((all) => ({
      ...all,
      [requestId]: { ...action, requestId, status: 'pending', result: null },
    }));
    const response = await this.rpc.call(
      method,
      params({ provider: action.provider, workspaceRoot, requestId }),
      { timeout: ACCOUNT_RPC_TIMEOUT_MS },
    );
    if (this.disposed) return { status: 'unconfirmed' };
    const data: AccountWriteResult | undefined = response.isSuccess()
      ? response.data
      : undefined;
    if (!data || (!data.ok && data.result.code === 'timeout')) {
      this.settle(requestId, 'unconfirmed', null);
      void this.refresh(action.provider);
      return { status: 'unconfirmed' };
    }
    if (!data.ok) {
      const result = safeResult(data.result);
      this.settle(requestId, 'failed', result);
      return { status: 'failed', result };
    }
    this.apply(data.snapshot);
    const operation = operationOf(data);
    const profileId = action.profileId;
    if (operation && profileId !== null) {
      const pending = data.snapshot.accounts.some(
        (entry) => entry.profileId === profileId && entry.state === 'pending',
      );
      if (pending) {
        this.slots[action.provider].operations.update((current) => ({
          ...current,
          [profileId]: operation,
        }));
        // Each sign-in replaces the profile's script: a console-opened retry clears an old one.
        const fallback = operation.kind === 'sign-in' ? fallbackOf(data) : null;
        if (fallback) {
          this.slots[action.provider].fallbacks.update((current) => ({
            ...current,
            [profileId]: fallback,
          }));
        } else {
          this.dropFallback(action.provider, profileId);
        }
      }
    }
    this.settle(requestId, 'saved', null);
    return { status: 'saved', snapshot: data.snapshot };
  }

  private dropFallback(provider: ProviderAccountProvider, profileId: string): void {
    this.slots[provider].fallbacks.update((current) => {
      if (!(profileId in current)) return current;
      const next: Record<string, ProviderAccountSignInFallback> = { ...current };
      delete next[profileId];
      return next;
    });
  }

  /** First settlement wins: a duplicate push or response for the same request is a no-op. */
  private settle(
    requestId: string,
    status: Exclude<ProviderAccountAction['status'], 'pending'>,
    result: ProviderAccountActionResult | null,
  ): void {
    this.actionsState.update((all) => {
      const current = all[requestId];
      if (!current || current.status !== 'pending') return all;
      return { ...all, [requestId]: { ...current, status, result } };
    });
  }
}

type AccountWriteMethod = Exclude<
  ProviderAccountRpcMethodName,
  'provider:listAccounts' | 'provider:getAccountStatus'
>;
type AccountWriteResult = RpcMethodResult<AccountWriteMethod>;

function safeResult(
  result: ProviderAccountActionResult,
): ProviderAccountActionResult {
  return isSafeProviderAccountSummary(result.summary)
    ? result
    : { code: result.code, summary: FALLBACK_SUMMARY };
}

/** Sign-in/out results carry the host's operation handle; other writes do not. */
function operationOf(data: object): ProviderAccountOperation | null {
  if (!('operation' in data) || !isRecord(data.operation)) return null;
  const { operationId, kind } = data.operation;
  return typeof operationId === 'string' &&
    (kind === 'sign-in' || kind === 'sign-out')
    ? { operationId, kind }
    : null;
}

/** Sign-in results carry a manual script when no login console opened; other writes do not. */
function fallbackOf(data: object): ProviderAccountSignInFallback | null {
  if (!('fallback' in data) || !isRecord(data.fallback)) return null;
  const { platform, script } = data.fallback;
  return (platform === 'win32' || platform === 'posix') &&
    typeof script === 'string' &&
    script.trim().length > 0
    ? { platform, script }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isScopeSelection(value: unknown, scope: ProviderAccountScope): boolean {
  return (
    isRecord(value) &&
    value['scope'] === scope &&
    typeof value['revision'] === 'number' &&
    isRecord(value['selection']) &&
    typeof value['selection']['kind'] === 'string'
  );
}

/** Structural check of a pushed or returned snapshot before it reaches view state. */
function isSnapshot(value: unknown): value is ProviderAccountsSnapshot {
  if (!isRecord(value)) return false;
  const selections = value['selections'];
  return (
    PROVIDER_ACCOUNT_PROVIDERS.some((provider) => provider === value['provider']) &&
    typeof value['workspaceRoot'] === 'string' &&
    typeof value['revision'] === 'number' &&
    Array.isArray(value['accounts']) &&
    value['accounts'].every(
      (account) =>
        isRecord(account) &&
        typeof account['profileId'] === 'string' &&
        typeof account['revision'] === 'number' &&
        typeof account['state'] === 'string',
    ) &&
    isRecord(selections) &&
    PROVIDER_ACCOUNT_SCOPES.every((scope) =>
      isScopeSelection(selections[scope], scope),
    )
  );
}
