import { Injectable, computed, inject, signal } from '@angular/core';
import {
  isOptOutPluginSource,
  type PluginConfigState,
  type PluginInfo,
} from '@ptah-extension/shared';

import { ClaudeRpcService } from './claude-rpc.service';
import { WorkspaceScopeService } from './workspace-scope.service';

/**
 * The one place the webview asks the host what plugins exist and which are on.
 *
 * ## Why this exists (TASK_2026_345)
 *
 * `plugins:get-config` and `plugins:list-available` were fetched by each
 * component that needed them, into component-local signals, with no sharing and
 * no in-flight dedupe. The captured session shows the pair issued FOUR times in
 * quick succession per view (`tmp/logs/log.log:978-993, 1907-1924, 1949-1968`),
 * because:
 *
 * - `PluginStatusWidgetComponent` fetches both on `ngOnInit`, and
 *   `PluginBrowserModalComponent` fetches both again when it opens — and both
 *   are mounted in the SAME view, twice over (the chat empty state and the
 *   Marketplace plugins surface);
 * - the chat empty state is rendered PER TRANSCRIPT, so N idle tabs mounted N
 *   widgets and issued N pairs on boot;
 * - `ChatEmptyStateComponent` issued a third bare `plugins:get-config` for its
 *   "setup" tab, on a view whose widget had already read it.
 *
 * None of those call sites was wrong on its own; there was simply nothing for
 * them to share. This is that thing.
 *
 * ## The contract
 *
 * - {@link ensureLoaded} is idempotent WITHIN A WORKSPACE SCOPE: the first
 *   caller performs one round trip, every caller that arrives while it is in
 *   flight awaits the SAME promise, and every caller afterwards resolves
 *   immediately from the signals.
 * - **A workspace switch invalidates all of it.** `plugins:get-config` reads
 *   `{ws}/.ptah/plugins`, and Electron keeps tabs bound to several roots alive
 *   at once, so a session-wide "already loaded" flag showed the FIRST
 *   workspace's plugin list for every workspace opened afterwards — indefinitely,
 *   because nothing on the switch path invalidated it (judge round 1). Every
 *   read is now filed under {@link WorkspaceScopeService.scopeKey}, and both the
 *   cached answer and an in-flight request are honoured only while that key
 *   still matches.
 * - {@link refresh} is the explicit "I changed it, read it again" call. It also
 *   dedupes against an in-flight read for the same scope, so a save that lands
 *   beside a newly mounted widget still costs one round trip.
 * - Nothing here polls, and nothing expires on a TIMER. Within one workspace the
 *   host's plugin config only changes because this webview changed it
 *   (`plugins:save-config`, `plugins:uninstall-external`), and that path
 *   invalidates through {@link refresh}. A TTL would put the duplicate round
 *   trips back for a case that does not happen.
 */
@Injectable({ providedIn: 'root' })
export class PluginCatalogService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly scope = inject(WorkspaceScopeService);

  /**
   * The last completed read, stamped with the scope it describes.
   *
   * One signal rather than three, because the stamp and the data it belongs to
   * must never be observed apart: a `plugins` signal that had been overwritten
   * while a separate `loadedScope` had not is exactly how the previous
   * workspace's list would leak into the new one's view.
   */
  private readonly _snapshot = signal<CatalogSnapshot | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  /**
   * The read in flight and the scope it was issued under, or `null`.
   *
   * A plain field rather than a signal: it is concurrency bookkeeping, nothing
   * renders from it, and a signal written inside an `await` chain that several
   * components are already awaiting is a write-during-read hazard for no gain.
   */
  private inFlight: { scopeKey: string; promise: Promise<void> } | null = null;

  /**
   * The completed read for the CURRENT workspace, or `null`.
   *
   * Returns `null` — not the previous workspace's answer — from the instant the
   * scope changes, so no consumer can render a stale list while the new read is
   * in flight.
   */
  private readonly current = computed<CatalogSnapshot | null>(() => {
    const snapshot = this._snapshot();
    if (snapshot === null) return null;
    return snapshot.scopeKey === this.scope.scopeKey() ? snapshot : null;
  });

  /** Every plugin the host knows about. Empty until this scope's read lands. */
  readonly plugins = computed<readonly PluginInfo[]>(
    () => this.current()?.plugins ?? [],
  );
  /** The saved enable/disable state, or `null` before this scope's read lands. */
  readonly config = computed<PluginConfigState | null>(
    () => this.current()?.config ?? null,
  );
  /** True while a read is in flight — including one someone else started. */
  readonly isLoading = this._isLoading.asReadonly();
  /** The last read's failure, cleared when a read starts. */
  readonly error = this._error.asReadonly();
  /** True once a read for the CURRENT workspace has completed, pass or fail. */
  readonly isLoaded = computed(() => this.current() !== null);

  /**
   * The plugins that are actually ACTIVE.
   *
   * Not `enabledPluginIds.length`: bundled and external plugins are opt-IN,
   * while harness-authored and skills.sh ones are opt-OUT, so a user-authored
   * skill is live without ever appearing in `enabledPluginIds`. The rule comes
   * from `isOptOutPluginSource` in `shared` rather than a literal comparison
   * here, because this count silently disagreeing with what the reconciler
   * propagates is invisible until someone toggles a plugin and the number does
   * not move.
   */
  readonly enabledCount = computed(() => {
    const config = this.config();
    if (config === null) return 0;
    return countEnabledPlugins(
      this.plugins(),
      config.enabledPluginIds,
      config.disabledPluginIds ?? [],
    );
  });

  /** How many plugins the host offers, enabled or not. */
  readonly pluginTotal = computed(() => this.plugins().length);

  /** Whether the user has opted any plugin in at all. */
  readonly hasEnabledPlugins = computed(
    () => (this.config()?.enabledPluginIds.length ?? 0) > 0,
  );

  /**
   * Read the catalog if the CURRENT workspace's copy has not been read yet.
   *
   * Safe to call from every `ngOnInit` and every "modal opened" effect — that
   * is the point. A widget re-mounting on the same workspace costs nothing; the
   * first one to mount after a switch performs exactly one read.
   */
  ensureLoaded(): Promise<void> {
    if (this.isLoaded() && this.inFlight === null) return Promise.resolve();
    return this.load();
  }

  /** Re-read the catalog. Call after anything that changed it host-side. */
  refresh(): Promise<void> {
    return this.load();
  }

  private load(): Promise<void> {
    const scopeKey = this.scope.scopeKey();
    const existing = this.inFlight;
    // Join only a request issued for the workspace we are asking about. A
    // request left over from the workspace being switched away from will be
    // answered by the host against whichever workspace is active when it
    // PROCESSES it, so its result belongs to neither scope reliably — it is
    // discarded on arrival by the same key check in `fetch`.
    if (existing !== null && existing.scopeKey === scopeKey) {
      return existing.promise;
    }

    this._isLoading.set(true);
    this._error.set(null);

    const promise = this.fetch(scopeKey).finally(() => {
      if (this.inFlight?.promise === promise) {
        this.inFlight = null;
        this._isLoading.set(false);
      }
    });
    this.inFlight = { scopeKey, promise };
    return promise;
  }

  private async fetch(scopeKey: string): Promise<void> {
    try {
      const [configResult, listResult] = await Promise.all([
        this.rpc.call('plugins:get-config', {}, { timeout: 10000 }),
        this.rpc.call('plugins:list-available', {}, { timeout: 10000 }),
      ]);

      // The user switched while this was in flight. The host resolves the
      // workspace at RPC-processing time, so this answer describes a workspace
      // we can no longer name — publishing it would be the original defect with
      // an extra step.
      if (scopeKey !== this.scope.scopeKey()) return;

      const plugins =
        listResult.isSuccess() && listResult.data
          ? listResult.data.plugins
          : [];
      const config =
        configResult.isSuccess() && configResult.data
          ? configResult.data
          : null;

      if (config === null) {
        this._error.set(configResult.error ?? 'Failed to load plugin config');
      }
      this._snapshot.set({ scopeKey, plugins, config });
    } catch (error: unknown) {
      // Never rethrow: every caller is a lifecycle hook or a view effect, and
      // a rejected `ensureLoaded` there is an unhandled rejection in the
      // renderer. The failure is reported through `error()` instead.
      if (scopeKey !== this.scope.scopeKey()) return;
      this._error.set(
        error instanceof Error ? error.message : 'Failed to load plugin status',
      );
      // Stamped as loaded-for-this-scope even though it failed, so `isLoaded`
      // means "we asked" and the Retry button is what asks again. Without this
      // every re-mounting widget would re-issue the failing pair.
      this._snapshot.set({ scopeKey, plugins: [], config: null });
    }
  }
}

/** A completed read, and the workspace scope it describes. */
interface CatalogSnapshot {
  scopeKey: string;
  plugins: readonly PluginInfo[];
  config: PluginConfigState | null;
}

/**
 * Count the plugins that are actually active.
 *
 * Kept beside the store rather than exported: it is the store's own derivation,
 * and a second copy is exactly how the widget's count and the modal's selection
 * drifted apart before they shared a source.
 */
function countEnabledPlugins(
  plugins: readonly PluginInfo[],
  enabledPluginIds: readonly string[],
  disabledPluginIds: readonly string[],
): number {
  const enabled = new Set(enabledPluginIds);
  const disabled = new Set(disabledPluginIds);

  return plugins.filter((plugin) =>
    isOptOutPluginSource(plugin.source)
      ? !disabled.has(plugin.id)
      : enabled.has(plugin.id) && !disabled.has(plugin.id),
  ).length;
}
