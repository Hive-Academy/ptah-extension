import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  AppStateManager,
  parseMarketplaceTarget,
  type MarketplaceSection,
  type MarketplaceSourceId,
} from '@ptah-extension/core';
import { marketplaceSourcesOf } from './sections.registry';

/**
 * Owns the Marketplace's active SECTION, its active SOURCE chip, and the
 * in-view refresh trigger.
 *
 * ## What persists, and what does not
 *
 * Only the section id persists, through
 * {@link AppStateManager.marketplaceActiveProvider} — the same per-workspace
 * field the old provider selection used, with a new grammar owned by
 * `parseMarketplaceTarget` in `@ptah-extension/core`. The source chip is
 * deliberately in-memory: re-opening the Marketplace should land on the
 * section the user was last working in, not on the fourth chip of it.
 *
 * {@link AppStateManager} stays the single source of truth, read through a
 * `computed` rather than snapshotted. This service is `providedIn: 'root'`, so
 * a snapshot taken in a field initializer would be read exactly once for the
 * lifetime of the app and the section would then survive a workspace switch
 * even though the value behind it is partitioned per workspace
 * (TASK_2026_228).
 *
 * ## Deep links
 *
 * A caller outside this library (the MCP status chip, the chat empty state)
 * deep-links by writing `'<section>:<source>'` into the same field and
 * navigating. {@link consumeDeepLink} — run from a constructor `effect` — picks
 * the source up into memory and normalizes the stored value back to the bare
 * section id. It cannot loop: the value it writes has no separator, so the
 * second pass finds `source === null` and stops. It is an `effect` rather than
 * a one-shot call because the hub is kept alive across view switches, so a
 * deep link can arrive while the hub is already mounted.
 */
@Injectable({ providedIn: 'root' })
export class MarketplaceStateService {
  private readonly appState = inject(AppStateManager);

  /** The persisted value, decoded. Total — never throws, never null. */
  private readonly target = computed(() =>
    parseMarketplaceTarget(this.appState.marketplaceActiveProvider()),
  );

  /**
   * The section currently shown. Never null: every unknown, retired or
   * malformed persisted id decodes to `'connected'` (AC5).
   */
  public readonly activeSection = computed<MarketplaceSection>(
    () => this.target().section,
  );

  /** In-memory chip selection; `null` means "whatever the section opens on". */
  private readonly _source = signal<MarketplaceSourceId | null>(null);

  /**
   * The chip currently shown inside {@link activeSection}.
   *
   * Falls back to the section's FIRST chip whenever the held chip is null or
   * belongs to a different section, so switching sections can never leave the
   * strip pointing at a chip the section does not have. `null` only for
   * `connected`, which has no chips.
   */
  public readonly activeSource = computed<MarketplaceSourceId | null>(() => {
    const sources = marketplaceSourcesOf(this.activeSection());
    if (sources.length === 0) return null;
    const held = this._source();
    if (held !== null && sources.some((s) => s.id === held)) return held;
    return sources[0].id;
  });

  private readonly _refreshTrigger = signal(0);
  /** Increment-on-change counter consumed by surfaces to reload installed state. */
  public readonly refreshTrigger = this._refreshTrigger.asReadonly();

  /**
   * Adopt a `section:source` deep link written by another library.
   *
   * No-op when the stored value names no source, which is the steady state.
   */
  private readonly deepLinkEffect = effect(() => {
    this.consumeDeepLink();
  });

  /** Show a section, optionally on a specific chip. */
  public select(
    section: MarketplaceSection,
    source?: MarketplaceSourceId,
  ): void {
    this.appState.setMarketplaceActiveProvider(section);
    this._source.set(source ?? null);
  }

  /** Switch the chip inside the current section. Not persisted. */
  public selectSource(source: MarketplaceSourceId): void {
    this._source.set(source);
  }

  /** Signal that installed content changed so surfaces reload in-view. */
  public notifyContentChanged(): void {
    this._refreshTrigger.update((n) => n + 1);
  }

  /**
   * Move a `section:source` deep link out of storage and into memory.
   *
   * Exposed so a host can force the read outside an effect flush; the
   * constructor effect already calls it on every change of the stored value.
   */
  public consumeDeepLink(): void {
    const { section, source } = this.target();
    if (source === null) return;
    this._source.set(source);
    this.appState.setMarketplaceActiveProvider(section);
  }
}
