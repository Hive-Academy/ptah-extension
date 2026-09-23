import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import {
  ClaudeRpcService,
  CommandDiscoveryFacade,
  PluginCatalogService,
  WorkspaceScopeService,
} from '@ptah-extension/core';
import {
  groupInstalledServers,
  removeInstalledGroup,
  type InstalledServerGroup,
} from '@ptah-extension/chat-ui';
import {
  SessionMcpStatusRegistry,
  type SessionMcpStatus,
} from '@ptah-extension/chat-state';
import type {
  ExternalPluginListing,
  InstalledMcpServer,
  InstalledSkill,
  PluginInfo,
} from '@ptah-extension/shared';
import { toConnectorRows } from '../mcp-connector-rows';
import { encodeServerRef } from './server-ref';
import { encodeSkillRef } from './skill-ref';

// ── Public model ──────────────────────────────────────────────────────────────

/** The four independently loaded inventory lists. */
export type InventorySliceId =
  'installed' | 'plugins' | 'community' | 'marketplaces';

/** Load state of one slice. `idle` means nothing has asked for it yet. */
export type InventorySliceState = 'idle' | 'loading' | 'ready' | 'error';

/** One slice as a page reads it. */
export interface InventorySlice<T> {
  readonly state: InventorySliceState;
  /**
   * The last successful read for the CURRENT workspace. Empty before the first
   * read, after a failed read, and from the instant the workspace changes.
   */
  readonly data: readonly T[];
  /** The load failure, present only when `state === 'error'`. */
  readonly error?: string;
  /** An inline removal failure; the rows stay in place. */
  readonly actionError?: string;
}

/**
 * Why a blocked row cannot be removed from here, and the command that can.
 *
 * Built ONLY for `removal: 'none'` rows (see {@link removalLockOf}).
 */
export interface RemovalLock {
  readonly reason: string;
  /** A shell-safe command, present only when the backend could build one. */
  readonly fixCommand?: string;
}

/** Something a removal can target. */
export type InventoryRemovalRef =
  | {
      readonly kind: 'server';
      readonly group: InstalledServerGroup;
      /** Required for `removal: 'direct'` rows, ignored for every other kind. */
      readonly confirmedDirect?: boolean;
    }
  | { readonly kind: 'community-skill'; readonly name: string }
  | {
      readonly kind: 'marketplace-plugin';
      readonly listing: ExternalPluginListing;
    };

/** What happened to one removal request. */
export type InventoryRemovalOutcome =
  | { readonly status: 'removed' }
  | { readonly status: 'failed'; readonly message: string }
  | {
      readonly status: 'refused';
      readonly reason: 'blocked';
      readonly message: string;
      readonly lock: RemovalLock;
    }
  | {
      readonly status: 'refused';
      readonly reason: 'needs-confirmation' | 'in-progress';
      readonly message: string;
    };

/** One entry of {@link MarketplaceInventoryStore.removeMany}'s result. */
export interface InventoryRemovalResult {
  /** The row's route ref, the same id {@link MarketplaceInventoryStore.pendingIds} uses. */
  readonly id: string;
  readonly ref: InventoryRemovalRef;
  readonly outcome: InventoryRemovalOutcome;
}

/** Nav-badge counts: a number only for a `ready` slice, `null` otherwise. */
export type InventoryCounts = Readonly<Record<InventorySliceId, number | null>>;

// ── Pure helpers ──────────────────────────────────────────────────────────────

const BLOCKED_FALLBACK_REASON = 'Ptah cannot remove this server from here.';

/**
 * The lock of a blocked row, or `null` for every row that CAN be removed.
 *
 * `removalFixCommand` is read here and nowhere else in the store, and only
 * behind the `removal === 'none'` check: the wire type does not tie the field
 * to blocked rows, so a removable row that happens to carry one must never
 * surface a "run this to remove it" command beside a working Remove button.
 */
export function removalLockOf(group: InstalledServerGroup): RemovalLock | null {
  if (group.removal !== 'none') return null;
  const reason = group.removalBlockedReason ?? BLOCKED_FALLBACK_REASON;
  return group.removalFixCommand
    ? { reason, fixCommand: group.removalFixCommand }
    : { reason };
}

/**
 * The stable id of a removal target: the same ref its detail route uses, so a
 * page can match a pending removal to the row or detail it is showing.
 */
export function removalIdOf(ref: InventoryRemovalRef): string {
  switch (ref.kind) {
    case 'server':
      return encodeServerRef({
        origin: ref.group.origin,
        serverKey: ref.group.serverKey,
      });
    case 'community-skill':
      return encodeSkillRef({ kind: 'community-skill', id: ref.name });
    case 'marketplace-plugin':
      return encodeSkillRef({ kind: 'marketplace-plugin', id: ref.listing.id });
  }
}

/** The slice a removal belongs to, and the name its messages use. */
function describeRemoval(ref: InventoryRemovalRef): {
  slice: InventorySliceId;
  label: string;
} {
  switch (ref.kind) {
    case 'server':
      return { slice: 'installed', label: ref.group.serverKey };
    case 'community-skill':
      return { slice: 'community', label: ref.name };
    case 'marketplace-plugin':
      return { slice: 'marketplaces', label: ref.listing.name };
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// ── Internal slice machinery ──────────────────────────────────────────────────

/** What each slice stores from its own read. Plugins read the root catalogue. */
interface SliceData {
  /** `null` until a read lands: connector rows need the installed keys first. */
  installed: readonly InstalledMcpServer[] | null;
  plugins: null;
  community: readonly InstalledSkill[];
  marketplaces: readonly ExternalPluginListing[];
}

interface SliceStatus {
  readonly state: InventorySliceState;
  readonly error?: string;
  readonly actionError?: string;
}

interface SliceCell<T> {
  readonly status: WritableSignal<SliceStatus>;
  readonly data: WritableSignal<T>;
  readonly empty: T;
  /** Bumped per load; a load publishes only while it is still the newest. */
  generation: number;
}

type Loaded<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

/** `ensure` may be served by a root cache; `reload` must re-read. */
type LoadMode = 'ensure' | 'reload';

const LOAD_FALLBACK: Readonly<Record<InventorySliceId, string>> = {
  installed: 'Could not read installed MCP servers.',
  plugins: 'Could not read the Ptah plugin catalogue.',
  community: 'Could not read installed community skills.',
  marketplaces: 'Could not read installed marketplace plugins.',
};

const SLICE_IDS = Object.keys(LOAD_FALLBACK) as readonly InventorySliceId[];

/** A slice whose rows are exactly its own read. */
function sliceView<T>(
  slice: SliceCell<readonly T[]>,
): Signal<InventorySlice<T>> {
  return computed(() => ({ ...slice.status(), data: slice.data() }));
}

function cell<T>(empty: T): SliceCell<T> {
  return {
    status: signal<SliceStatus>({ state: 'idle' }),
    data: signal<T>(empty),
    empty,
    generation: 0,
  };
}

/**
 * MarketplaceInventoryStore — everything the user has installed, connected or
 * enabled, as four independently loaded slices, plus removal (plan C3, D4).
 *
 * ## Loading only on request (the zero-RPC rule)
 *
 * Construction reads nothing. A slice leaves `idle` only when a page calls
 * {@link ensure} for it; reading a slice, {@link counts} (nav badges, status
 * bar) or {@link newestSessionStatus} never loads anything. Every later reload
 * — after an install or removal ({@link notifyContentChanged}) or a workspace
 * switch — touches only the slices some page already asked for.
 *
 * ## Failure isolation
 *
 * Lifted from the Connected view: each slice owns its `state`, fails alone with
 * its own `error`, and retries alone. There is no store-wide spinner or error.
 * A per-slice generation drops a result that a newer load of the same slice has
 * superseded, so a Retry racing a reload cannot land out of order.
 *
 * ## Workspace switches without navigation
 *
 * TASK_2026_540 keeps configuration surfaces on screen across a workspace
 * switch, so nothing re-creates this store. It therefore follows
 * `WorkspaceScopeService.generation` itself: a bump discards the previous
 * workspace's rows and reloads every non-idle slice. A load that started under
 * the previous workspace is dropped on arrival even if the reload has not been
 * scheduled yet.
 *
 * Status decoration (live OAuth/Smithery state) is NOT read here: it comes from
 * `ConnectorLinksStore.statusFor` (plan C4), so no decoration read can add,
 * drop or fail an inventory row.
 *
 * No `providedIn`: one instance per Marketplace visit, listed in the shell's
 * `providers` (plan D4 rejects a root store that outlives the visit).
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- shell-scoped, provided by MarketplaceShellComponent; see the class note.
@Injectable()
export class MarketplaceInventoryStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly catalog = inject(PluginCatalogService);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);
  private readonly scope = inject(WorkspaceScopeService);
  private readonly mcpStatus = inject(SessionMcpStatusRegistry);

  private readonly cells: { [K in InventorySliceId]: SliceCell<SliceData[K]> } =
    {
      installed: cell<readonly InstalledMcpServer[] | null>(null),
      plugins: cell<null>(null),
      community: cell<readonly InstalledSkill[]>([]),
      marketplaces: cell<readonly ExternalPluginListing[]>([]),
    };

  private readonly loaders: {
    [K in InventorySliceId]: (mode: LoadMode) => Promise<Loaded<SliceData[K]>>;
  } = {
    installed: () => this.readInstalled(),
    plugins: (mode) => this.readPlugins(mode),
    community: () => this.readCommunity(),
    marketplaces: () => this.readMarketplaces(),
  };

  private readonly _pendingIds = signal<ReadonlySet<string>>(new Set());
  private destroyed = false;
  private seenWorkspaceGeneration = this.scope.generation();

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
  }

  /**
   * The newest session's MCP picture, or `null` when no session ever reported.
   *
   * The Marketplace owns no session, so it reads the MOST RECENTLY RECORDED one:
   * `SessionMcpStatusRegistry.record` re-inserts a session on every write, so
   * the last key is the newest report — the connector picture most likely to
   * match a turn started right now.
   */
  public readonly newestSessionStatus: Signal<SessionMcpStatus | null> =
    computed(() => {
      const sessions = this.mcpStatus.sessions();
      const newest = sessions[sessions.length - 1];
      return newest ? this.mcpStatus.peek(newest) : null;
    });

  /**
   * Installed MCP servers, grouped per origin + key, with the claude.ai account
   * connectors of the newest session appended.
   *
   * The connector rows are re-derived against THIS slice's own read on every
   * change of either input, so a session that reports later re-derives the rows
   * without another `listInstalled`, and a connector that also reaches us from
   * disk is listed once, under its disk origin.
   */
  public readonly installed: Signal<InventorySlice<InstalledServerGroup>> =
    computed(() => {
      const status = this.cells.installed.status();
      const servers = this.cells.installed.data();
      if (servers === null) return { ...status, data: [] };
      const entries = this.newestSessionStatus()?.servers ?? [];
      const connectors = toConnectorRows(
        entries,
        servers.map((server) => server.serverKey),
      );
      return {
        ...status,
        data: groupInstalledServers([...servers, ...connectors]),
      };
    });

  /** Enabled Ptah plugins, straight from the root catalogue once this slice loaded. */
  public readonly plugins: Signal<InventorySlice<PluginInfo>> = computed(() => {
    const status = this.cells.plugins.status();
    return {
      ...status,
      data: status.state === 'ready' ? this.catalog.enabledPlugins() : [],
    };
  });

  /** skills.sh skills installed on this machine. */
  public readonly community = sliceView(this.cells.community);

  /** External marketplace plugins with a consent record. */
  public readonly marketplaces = sliceView(this.cells.marketplaces);

  /**
   * Badge counts for the nav and status bar. A slice that is not `ready`
   * counts as `null` ("unknown"), and reading this never loads anything.
   */
  public readonly counts: Signal<InventoryCounts> = computed(() => ({
    installed: this.countOf(this.installed()),
    plugins: this.countOf(this.plugins()),
    community: this.countOf(this.community()),
    marketplaces: this.countOf(this.marketplaces()),
  }));

  /** Ids ({@link removalIdOf}) of removals in flight; only these rows disable. */
  public readonly pendingIds: Signal<ReadonlySet<string>> =
    this._pendingIds.asReadonly();

  /**
   * Reload what is on screen when the active workspace changes. The first run
   * sees the generation captured at construction and does nothing, so creating
   * the store stays RPC-free.
   */
  private readonly workspaceEffect = effect(() => {
    const generation = this.scope.generation();
    if (generation === this.seenWorkspaceGeneration) return;
    this.seenWorkspaceGeneration = generation;
    untracked(() => this.reloadRequested(true));
  });

  // ── Loading ────────────────────────────────────────────────────────────────

  /** Load a slice for the first time. A no-op unless the slice is `idle`. */
  public ensure(id: InventorySliceId): Promise<void> {
    if (this.cells[id].status().state !== 'idle') return Promise.resolve();
    return this.load(id, 'ensure', false);
  }

  /** Re-read a slice now, superseding any read in flight for it. */
  public reload(id: InventorySliceId): Promise<void> {
    return this.load(id, 'reload', false);
  }

  /**
   * The error state's Retry. Only a failed slice re-reads, so a second click
   * while the retry is already loading does not start another read.
   */
  public retry(id: InventorySliceId): Promise<void> {
    if (this.cells[id].status().state !== 'error') return Promise.resolve();
    return this.load(id, 'reload', false);
  }

  /**
   * Call after anything was installed, uninstalled or connected anywhere in
   * the Marketplace. Clears the `/command` + `@agent` autocomplete cache (ported
   * from the hub) and reloads only the slices some page already asked for.
   */
  public notifyContentChanged(): void {
    this.commandDiscovery.clearCache();
    this.reloadRequested(false);
  }

  private reloadRequested(discardData: boolean): void {
    for (const id of SLICE_IDS) {
      if (this.cells[id].status().state === 'idle') continue;
      void this.load(id, 'reload', discardData);
    }
  }

  private async load<K extends InventorySliceId>(
    id: K,
    mode: LoadMode,
    discardData: boolean,
  ): Promise<void> {
    const slice: SliceCell<SliceData[K]> = this.cells[id];
    const generation = ++slice.generation;
    const workspace = this.scope.generation();
    slice.status.set({ state: 'loading' });
    if (discardData) slice.data.set(slice.empty);

    let outcome: Loaded<SliceData[K]>;
    try {
      outcome = await this.loaders[id](mode);
    } catch (error: unknown) {
      // degradation-audit: reported — the failure becomes this slice's `error`
      // state, which the page renders inline beside a Retry.
      outcome = { ok: false, error: messageOf(error, LOAD_FALLBACK[id]) };
    }

    if (
      this.destroyed ||
      slice.generation !== generation ||
      this.scope.generation() !== workspace
    ) {
      return;
    }
    // Starting the load cleared `actionError`; one written while it was in
    // flight (a removal that failed meanwhile) is newer than this read and
    // survives it.
    const { actionError } = slice.status();
    const kept = actionError === undefined ? {} : { actionError };
    if (outcome.ok) {
      slice.data.set(outcome.data);
      slice.status.set({ state: 'ready', ...kept });
    } else {
      slice.data.set(slice.empty);
      slice.status.set({ state: 'error', error: outcome.error, ...kept });
    }
  }

  private async readInstalled(): Promise<Loaded<SliceData['installed']>> {
    const result = await this.rpc.call('mcpDirectory:listInstalled', {});
    if (!result.isSuccess()) {
      return { ok: false, error: result.error ?? LOAD_FALLBACK.installed };
    }
    return { ok: true, data: result.data.servers };
  }

  /**
   * The catalogue is a root, workspace-scoped cache that never rejects: it
   * publishes a failure on `error()` instead. `ensure` lets it answer from
   * cache; a reload or Retry asks it to re-read.
   */
  private async readPlugins(mode: LoadMode): Promise<Loaded<null>> {
    await (mode === 'ensure'
      ? this.catalog.ensureLoaded()
      : this.catalog.refresh());
    const error = this.catalog.error();
    return error === null ? { ok: true, data: null } : { ok: false, error };
  }

  private async readCommunity(): Promise<Loaded<SliceData['community']>> {
    const result = await this.rpc.call('skillsSh:listInstalled', {});
    if (!result.isSuccess()) {
      return { ok: false, error: result.error ?? LOAD_FALLBACK.community };
    }
    return { ok: true, data: result.data.skills };
  }

  private async readMarketplaces(): Promise<Loaded<SliceData['marketplaces']>> {
    const result = await this.rpc.call('plugins:list-marketplaces', {});
    if (!result.isSuccess()) {
      return { ok: false, error: result.error ?? LOAD_FALLBACK.marketplaces };
    }
    return { ok: true, data: result.data.installed };
  }

  private countOf<T>(slice: InventorySlice<T>): number | null {
    return slice.state === 'ready' ? slice.data.length : null;
  }

  // ── Removal ────────────────────────────────────────────────────────────────

  /**
   * Remove or disconnect one installed server through its own removal path.
   * A `direct` row (a config file Ptah did not write) is refused unless the
   * caller confirmed it; a blocked row is refused with its lock.
   */
  public removeServer(
    group: InstalledServerGroup,
    options: { readonly confirmedDirect?: boolean } = {},
  ): Promise<InventoryRemovalOutcome> {
    return this.removeAndNotify({
      kind: 'server',
      group,
      confirmedDirect: options.confirmedDirect,
    });
  }

  public removeCommunitySkill(name: string): Promise<InventoryRemovalOutcome> {
    return this.removeAndNotify({ kind: 'community-skill', name });
  }

  public removeMarketplacePlugin(
    listing: ExternalPluginListing,
  ): Promise<InventoryRemovalOutcome> {
    return this.removeAndNotify({ kind: 'marketplace-plugin', listing });
  }

  /**
   * Remove several items one after another. A failure or refusal never stops
   * the rest; every item gets its own outcome. Slices reload once at the end,
   * and only if something was actually removed.
   */
  public async removeMany(
    refs: readonly InventoryRemovalRef[],
  ): Promise<readonly InventoryRemovalResult[]> {
    const results: InventoryRemovalResult[] = [];
    for (const ref of refs) {
      const outcome = await this.removeOne(ref);
      results.push({ id: removalIdOf(ref), ref, outcome });
    }
    if (this.destroyed) return results;

    if (results.some((result) => result.outcome.status === 'removed')) {
      this.notifyContentChanged();
    }
    // Written AFTER the reload started (a load clears `actionError` when it
    // begins), so the failures of a partly successful batch stay visible.
    this.publishBulkFailures(results);
    return results;
  }

  private async removeAndNotify(
    ref: InventoryRemovalRef,
  ): Promise<InventoryRemovalOutcome> {
    const outcome = await this.removeOne(ref);
    if (outcome.status === 'removed' && !this.destroyed) {
      this.notifyContentChanged();
    }
    return outcome;
  }

  private async removeOne(
    ref: InventoryRemovalRef,
  ): Promise<InventoryRemovalOutcome> {
    const id = removalIdOf(ref);
    const refusal = this.refusalFor(ref, id);
    if (refusal !== null) return refusal;

    const { slice } = describeRemoval(ref);
    this.setPending(id, true);
    try {
      const failure = await this.performRemoval(ref);
      if (failure !== null) {
        this.setActionError(slice, failure);
        return { status: 'failed', message: failure };
      }
      this.setActionError(slice, undefined);
      return { status: 'removed' };
    } catch (error: unknown) {
      // degradation-audit: reported — returned as a `failed` outcome and shown
      // as the slice's inline `actionError`; the row stays in place.
      const message = messageOf(error, 'Removal failed.');
      this.setActionError(slice, message);
      return { status: 'failed', message };
    } finally {
      this.setPending(id, false);
    }
  }

  private refusalFor(
    ref: InventoryRemovalRef,
    id: string,
  ): InventoryRemovalOutcome | null {
    const { label } = describeRemoval(ref);
    if (this._pendingIds().has(id)) {
      return {
        status: 'refused',
        reason: 'in-progress',
        message: `"${label}" is already being removed.`,
      };
    }
    if (ref.kind !== 'server') return null;

    const lock = removalLockOf(ref.group);
    if (lock !== null) {
      return {
        status: 'refused',
        reason: 'blocked',
        message: lock.reason,
        lock,
      };
    }
    if (ref.group.removal === 'direct' && ref.confirmedDirect !== true) {
      return {
        status: 'refused',
        reason: 'needs-confirmation',
        message: `Ptah did not write "${label}". Confirm before removing it from ${
          ref.group.configPaths.join(', ') || 'its config file'
        }.`,
      };
    }
    return null;
  }

  /** `null` on full success, a user-facing message otherwise. */
  private async performRemoval(
    ref: InventoryRemovalRef,
  ): Promise<string | null> {
    switch (ref.kind) {
      case 'server':
        return removeInstalledGroup(this.rpc, ref.group);

      case 'community-skill': {
        const result = await this.rpc.call('skillsSh:uninstall', {
          name: ref.name,
        });
        if (!result.isSuccess()) {
          return result.error ?? `Could not uninstall "${ref.name}".`;
        }
        return result.data.success
          ? null
          : (result.data.error ?? `Could not uninstall "${ref.name}".`);
      }

      case 'marketplace-plugin': {
        const result = await this.rpc.call('plugins:uninstall-external', {
          pluginId: ref.listing.id,
        });
        if (!result.isSuccess()) {
          return result.error ?? `Could not uninstall "${ref.listing.name}".`;
        }
        return result.data.removed
          ? null
          : `"${ref.listing.name}" was already gone; nothing was removed.`;
      }
    }
  }

  private publishBulkFailures(
    results: readonly InventoryRemovalResult[],
  ): void {
    const failures = new Map<InventorySliceId, string[]>();
    for (const { ref, outcome } of results) {
      if (outcome.status !== 'failed') continue;
      const { slice } = describeRemoval(ref);
      failures.set(slice, [...(failures.get(slice) ?? []), outcome.message]);
    }
    for (const [slice, messages] of failures) {
      this.setActionError(
        slice,
        messages.length === 1
          ? messages[0]
          : `${messages.length} removals failed. ${messages[0]}`,
      );
    }
  }

  private setActionError(
    id: InventorySliceId,
    actionError: string | undefined,
  ): void {
    if (this.destroyed) return;
    this.cells[id].status.update(({ state, error }) => ({
      state,
      ...(error === undefined ? {} : { error }),
      ...(actionError === undefined ? {} : { actionError }),
    }));
  }

  private setPending(id: string, pending: boolean): void {
    if (this.destroyed) return;
    this._pendingIds.update((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
