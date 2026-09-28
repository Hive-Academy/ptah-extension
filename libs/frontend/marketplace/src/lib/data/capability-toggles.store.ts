import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { ClaudeRpcService, WorkspaceScopeService } from '@ptah-extension/core';
import {
  capabilityKey,
  type CapabilitiesGetStateResult,
  type CapabilityEntry,
  type CapabilityKey,
  type CapabilityPolicyReason,
  type CapabilityPolicyStatus,
  type CapabilityScope,
} from '@ptah-extension/shared';

/** Load state of the capability inventory. `ensure()` loads only from `idle`. */
export type CapabilityTogglesState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The policy banner: shown while the policy is `unverified`. Every reason
 * names one file Ptah could not read, so the user knows what to fix or delete.
 */
export interface CapabilityPolicyBanner {
  readonly reasons: readonly CapabilityPolicyReason[];
}

/** A failed toggle, kept against the item it belongs to. */
export interface CapabilityToggleError {
  readonly key: CapabilityKey;
  readonly message: string;
}

/**
 * What {@link CapabilityTogglesStore.setEnabled} did.
 *
 * - `saved`: the write landed and the row now shows the persisted entry.
 * - `reverted`: the write failed; the row is back to its prior state and
 *   {@link CapabilityTogglesStore.actionError} names the item.
 * - `skipped`: nothing was sent (unknown row, or a write for it in flight).
 */
export type CapabilityToggleOutcome = 'saved' | 'reverted' | 'skipped';

const LOAD_FAILURE = 'Failed to load capability settings';

/**
 * CapabilityTogglesStore — the per-workspace and global on/off state of MCP
 * servers, skills and plugins (TASK_2026_560, plan C10).
 *
 * ## Reads
 *
 * One call, `capabilities:getState`, returns every row and the policy state it
 * was resolved under. Nothing is read until a page calls {@link ensure}; the
 * shell's banner reads what is already here and never loads.
 *
 * ## Writes
 *
 * {@link setEnabled} is optimistic: the row flips at once, then is replaced by
 * the entry `capabilities:setEnabled` returns (the persisted, re-resolved
 * row). On failure the row goes back to exactly what it was and
 * {@link actionError} names the item (AC-1.4). Nothing partial is kept: the
 * backend writes one item file atomically or not at all.
 *
 * ## Fail-closed
 *
 * An `unverified` policy fills {@link policyBanner} with each unreadable path.
 * Entries then carry `effectiveEnabled: null` ("Unknown"). Writes still go
 * through, because each item is its own file; a write while unverified
 * re-reads the whole state, since fixing a bad item file can clear the banner.
 *
 * ## Workspace switches
 *
 * Every row belongs to the active workspace, and the write handler addresses
 * the host's active workspace. On a switch the rows are dropped before the
 * re-read, so a stale row can never be written into the new workspace.
 *
 * No `providedIn`: one instance per Marketplace visit, listed in the shell's
 * `providers`, like `ConnectorLinksStore`.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- shell-scoped, provided by MarketplaceShellComponent; see the class note.
@Injectable()
export class CapabilityTogglesStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly scope = inject(WorkspaceScopeService);

  private readonly _state = signal<CapabilityTogglesState>('idle');
  private readonly _loadError = signal<string | null>(null);
  private readonly _entries = signal<readonly CapabilityEntry[]>([]);
  private readonly _status = signal<CapabilityPolicyStatus | null>(null);
  private readonly _reasons = signal<readonly CapabilityPolicyReason[]>([]);
  private readonly _actionError = signal<CapabilityToggleError | null>(null);
  private readonly _pendingKeys = signal<ReadonlySet<CapabilityKey>>(new Set());

  /** Bumped per load; a load whose number is no longer current publishes nothing. */
  private loadGeneration = 0;
  private destroyed = false;
  private seenWorkspaceGeneration = this.scope.generation();

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
  }

  /** `idle` until a page calls {@link ensure}. */
  public readonly state: Signal<CapabilityTogglesState> =
    this._state.asReadonly();
  public readonly loading: Signal<boolean> = computed(
    () => this._state() === 'loading',
  );
  public readonly loadError: Signal<string | null> =
    this._loadError.asReadonly();
  /** Every row, in the order the backend resolved them. */
  public readonly entries: Signal<readonly CapabilityEntry[]> =
    this._entries.asReadonly();
  /** The policy state of the last read, or `null` before one lands. */
  public readonly status: Signal<CapabilityPolicyStatus | null> =
    this._status.asReadonly();
  /** The last failed toggle, cleared when the next toggle starts. */
  public readonly actionError: Signal<CapabilityToggleError | null> =
    this._actionError.asReadonly();
  /** Rows with a write in flight. */
  public readonly pendingKeys: Signal<ReadonlySet<CapabilityKey>> =
    this._pendingKeys.asReadonly();

  /** The unverified-policy banner, or `null` while the policy is readable. */
  public readonly policyBanner: Signal<CapabilityPolicyBanner | null> =
    computed(() =>
      this._status() === 'unverified' ? { reasons: this._reasons() } : null,
    );

  private readonly byKey = computed(() => {
    const byKey = new Map<CapabilityKey, CapabilityEntry>();
    for (const entry of this._entries()) byKey.set(keyOf(entry), entry);
    return byKey;
  });

  /**
   * Drop the old workspace's rows and re-read. The first run sees the
   * generation captured at construction and does nothing, so creating the
   * store stays RPC-free, and an idle store stays idle.
   */
  private readonly workspaceEffect = effect(() => {
    const generation = this.scope.generation();
    if (generation === this.seenWorkspaceGeneration) return;
    this.seenWorkspaceGeneration = generation;
    untracked(() => {
      if (this._state() === 'idle') return;
      this._entries.set([]);
      this._status.set(null);
      this._reasons.set([]);
      this._pendingKeys.set(new Set());
      this._actionError.set(null);
      void this.load();
    });
  });

  // ── Reads ──────────────────────────────────────────────────────────────────

  public entryOf(
    entry: Pick<CapabilityEntry, 'kind' | 'id'>,
  ): CapabilityEntry | undefined {
    return this.byKey().get(keyOf(entry));
  }

  public isPending(entry: Pick<CapabilityEntry, 'kind' | 'id'>): boolean {
    return this._pendingKeys().has(keyOf(entry));
  }

  /** The failure text for this row, or `null` when its last toggle did not fail. */
  public errorFor(entry: Pick<CapabilityEntry, 'kind' | 'id'>): string | null {
    const error = this._actionError();
    return error !== null && error.key === keyOf(entry) ? error.message : null;
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  /** Load for the first time. A no-op unless the store is `idle`. */
  public ensure(): Promise<void> {
    if (this._state() !== 'idle') return Promise.resolve();
    return this.load();
  }

  /** Re-read now, superseding any read in flight. */
  public reload(): Promise<void> {
    return this.load();
  }

  public dismissActionError(): void {
    this._actionError.set(null);
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  /**
   * Turn one capability on or off in `scope`: optimistic, then reconciled with
   * the persisted entry, or reverted with an error naming the item.
   */
  public async setEnabled(
    target: Pick<CapabilityEntry, 'kind' | 'id'>,
    scope: CapabilityScope,
    enabled: boolean,
  ): Promise<CapabilityToggleOutcome> {
    const key = keyOf(target);
    const prior = this.byKey().get(key);
    if (prior === undefined || this._pendingKeys().has(key)) return 'skipped';

    const workspace = this.scope.generation();
    const optimistic = optimisticEntry(prior, scope, enabled);
    // The item name plus a fixed sentence. Backend and transport text can
    // carry paths or other detail, so it goes to the console only.
    const failure = `Couldn't turn ${prior.label} ${enabled ? 'on' : 'off'}. The change wasn't saved; try again.`;
    this._actionError.set(null);
    this.addPending(key);
    this.replaceEntry(key, optimistic);

    try {
      const result = await this.rpc.call('capabilities:setEnabled', {
        scope,
        kind: prior.kind,
        id: prior.id,
        enabled,
      });
      if (this.isStale(workspace)) return 'skipped';
      if (!result.isSuccess()) {
        console.warn(
          '[CapabilityTogglesStore] setEnabled failed:',
          result.error,
        );
        return this.revert(key, prior, optimistic, failure);
      }
      this.replaceEntry(key, result.data.entry);
      if (this._status() === 'unverified') void this.load();
      return 'saved';
    } catch (error: unknown) {
      console.warn('[CapabilityTogglesStore] setEnabled threw:', error);
      if (this.isStale(workspace)) return 'skipped';
      return this.revert(key, prior, optimistic, failure);
    } finally {
      // After a workspace switch the pending set belongs to the new
      // workspace, where the same key may have its own write in flight.
      if (!this.isStale(workspace)) this.removePending(key);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    const workspace = this.scope.generation();
    this._state.set('loading');
    this._loadError.set(null);

    let inventory: CapabilitiesGetStateResult | null = null;
    try {
      const result = await this.rpc.call('capabilities:getState', {});
      if (result.isSuccess()) inventory = result.data;
    } catch (error: unknown) {
      // degradation-audit: reported — the store's `error` state renders it.
      console.warn('[CapabilityTogglesStore] getState threw:', error);
    }

    if (
      this.destroyed ||
      generation !== this.loadGeneration ||
      workspace !== this.scope.generation()
    ) {
      return;
    }
    if (inventory === null) {
      this._loadError.set(LOAD_FAILURE);
      this._state.set('error');
      return;
    }
    this._entries.set(inventory.entries);
    this._status.set(inventory.status);
    this._reasons.set(inventory.reasons);
    this._state.set('ready');
  }

  /**
   * True when the store was destroyed or the workspace changed since the write
   * started. The same id can exist in the next workspace, so an answer for the
   * old one must not touch its row.
   */
  private isStale(workspace: number): boolean {
    return this.destroyed || workspace !== this.scope.generation();
  }

  /**
   * Put the row back. Only when it still shows this write's optimistic value:
   * a reload that landed meanwhile holds a fresher answer than `prior`.
   */
  private revert(
    key: CapabilityKey,
    prior: CapabilityEntry,
    optimistic: CapabilityEntry,
    message: string,
  ): CapabilityToggleOutcome {
    if (this.byKey().get(key) === optimistic) this.replaceEntry(key, prior);
    this._actionError.set({ key, message });
    return 'reverted';
  }

  private replaceEntry(key: CapabilityKey, next: CapabilityEntry): void {
    this._entries.update((entries) =>
      entries.map((entry) => (keyOf(entry) === key ? next : entry)),
    );
  }

  private addPending(key: CapabilityKey): void {
    this._pendingKeys.update((keys) => new Set([...keys, key]));
  }

  private removePending(key: CapabilityKey): void {
    this._pendingKeys.update((keys) => {
      if (!keys.has(key)) return keys;
      const next = new Set(keys);
      next.delete(key);
      return next;
    });
  }
}

function keyOf(entry: Pick<CapabilityEntry, 'kind' | 'id'>): CapabilityKey {
  return capabilityKey(entry.kind, entry.id);
}

/**
 * The row as it will most likely look once the write lands, shown until the
 * persisted entry replaces it.
 *
 * - A workspace write decides the row, except that a skill of a plugin that is
 *   off stays off.
 * - A global write moves the effective value only when the row follows global
 *   (its value came from the global layer or the default); a workspace or
 *   imported decision still wins.
 * - An `unknown` row (`effectiveEnabled: null`) stays unknown: the policy is
 *   unreadable, so only the recorded value for the scope changes.
 */
export function optimisticEntry(
  entry: CapabilityEntry,
  scope: CapabilityScope,
  enabled: boolean,
): CapabilityEntry {
  const known = entry.effectiveEnabled !== null;
  if (scope === 'workspace') {
    const next: CapabilityEntry = { ...entry, workspaceEnabled: enabled };
    if (!known || entry.inheritedFrom === 'parent-plugin') return next;
    return { ...next, effectiveEnabled: enabled, inheritedFrom: 'workspace' };
  }
  const next: CapabilityEntry = { ...entry, globalEnabled: enabled };
  const followsGlobal =
    entry.inheritedFrom === 'global' || entry.inheritedFrom === 'default';
  if (!known || !followsGlobal) return next;
  return { ...next, effectiveEnabled: enabled, inheritedFrom: 'global' };
}
