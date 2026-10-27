import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
// The panel is the only runtime symbol, and the template names it only inside
// `@defer (on immediate)`. The compiler drops this static import when every
// symbol of the declaration is defer-only; a second runtime symbol would keep
// the whole `display-panel` barrel (and declarative-dashboard) eager.
import { DisplayPanelComponent, type DisplayPanelViewStateChange } from '@ptah-extension/chat-ui/display-panel';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ArtifactRecord, TurnChangeSet } from '@ptah-extension/shared';
import { ArtifactStore } from '../../../services/artifact.store';
import { DisplayDockState, type DisplayDockSelection } from '../../../services/display-dock/display-dock.state';
import { ChangeSetActionsService } from '../../../services/change-set/change-set-actions.service';
import { DisplaySheetState } from './display-sheet.state';

/**
 * Same string as `DISPLAY_PANEL_SUMMARY_KEY` in
 * `display-panel.component.ts` (`id:` / `anon:` surface keys never match it).
 * Duplicated so this eager sheet does not value-import the lazy entry.
 */
const DISPLAY_PANEL_SUMMARY_KEY = 'summary';
const NO_CHANGE_SET_TEXT = 'This turn has no recorded file changes to open.';
const ACTION_FAILED_TEXT = 'The review action failed.';

/**
 * The prefix the display panel gives artifact strip items (`artifact:<id>`).
 * Duplicated for the same reason as {@link DISPLAY_PANEL_SUMMARY_KEY}: this
 * eager sheet must not value-import the lazy entry.
 */
const DISPLAY_PANEL_ARTIFACT_KEY_PREFIX = 'artifact:';

const NO_ARTIFACTS: readonly ArtifactRecord[] = Object.freeze([]);

/** Maps a panel strip key back to the dock selection kind it denotes. */
function selectionForKey(key: string): DisplayDockSelection {
  if (key === DISPLAY_PANEL_SUMMARY_KEY) return { kind: 'summary' };
  if (key.startsWith(DISPLAY_PANEL_ARTIFACT_KEY_PREFIX)) {
    return {
      kind: 'artifact',
      artifactId: key.slice(DISPLAY_PANEL_ARTIFACT_KEY_PREFIX.length),
    };
  }
  return { kind: 'surface', surfaceKey: key };
}

/** Session-local display collection between transcript and composer. */
@Component({
  selector: 'ptah-display-sheet',
  standalone: true,
  imports: [DisplayPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'min-w-0', 'data-testid': 'display-sheet', '[style.display]': "visible() ? null : 'none'", '[class.sheet-open]': 'state().open', '[class.sheet-full]': "state().open && mode() === 'full'" },
  styles: `
    :host { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; }
    :host(.sheet-open) { flex: 0 1 40%; min-height: 2.25rem; }
    :host(.sheet-full) { flex: 1 1 100%; }
    .sheet-shell { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .sheet-body { flex: 1; min-height: 0; }
    .sheet-pulse { animation: sheet-pulse 600ms ease-out; }
    @keyframes sheet-pulse { 0% { opacity: .45; transform: scale(1); } 50% { opacity: 1; transform: scale(1.015); } 100% { opacity: 1; transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) { .sheet-pulse { animation: none; } }
  `,
  template: `
    <div class="sheet-shell relative border-t border-base-content/15 bg-base-200" data-glass-surface="chrome">
      @if (pulse()) { <span class="sheet-pulse pointer-events-none absolute inset-0 border border-primary" aria-hidden="true"></span> }
      <div class="flex h-9 items-center gap-1 px-2">
        <button #bar type="button" class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start focus-visible:outline focus-visible:outline-2"
          [attr.aria-expanded]="state().open" [attr.aria-controls]="regionId()"
          [attr.aria-label]="barLabel()"
          (click)="toggle()" (keydown)="onBarKeydown($event)" data-testid="display-sheet-bar">
          Display · {{ itemCount() }}
          @if (state().newCount > 0) { <span class="badge badge-primary badge-xs" [attr.aria-label]="state().newCount + ' new items'">{{ state().newCount }}</span> }
        </button>
        @if (state().open) {
          <button type="button" class="btn btn-ghost btn-xs" [attr.aria-label]="mode() === 'full' ? 'Reduce display height' : 'Fill chat height'"
            (click)="toggleHeight()" data-testid="display-sheet-height">{{ mode() === 'full' ? 'Reduce' : 'Expand' }}</button>
          <button type="button" class="btn btn-ghost btn-xs" [attr.aria-pressed]="state().pinned"
            [class.text-primary]="state().pinned" aria-label="Pin panel" (click)="togglePin()" data-testid="display-sheet-pin">Pin</button>
          <button type="button" class="btn btn-ghost btn-xs" aria-label="Collapse display" (click)="collapse()" data-testid="display-sheet-close">Collapse</button>
        }
      </div>
       @if (state().open) {
        <section [id]="regionId()" role="region" aria-label="Display" class="sheet-body flex min-h-0 flex-col overflow-hidden border-t border-base-content/10"
          [class.full]="mode() === 'full'" (keydown.escape)="onRegionEscape($event)" data-testid="display-sheet-region">
          @if (linkError()) { <p role="alert" class="px-3 py-1 text-xs text-error">{{ linkError() }}</p> }
          @if (artifactStore.lastError()) { <p role="status" class="px-3 py-1 text-xs text-error">{{ artifactStore.lastError() }}</p> }
          @defer (on immediate) {
            <ptah-display-panel class="min-h-0 flex-1" [surfaces]="state().surfaces"
              [artifacts]="artifacts()"
              [open]="state().open" [fullscreenArtifactId]="dock.fullscreenArtifact(this.tabId())"
              (fullscreenChange)="onFullscreenChange($event)"
              [summary]="summary()?.model ?? null" [summaryTurnKey]="summaryTurnKey() ?? ''"
              [selectedKey]="selectedKey()" [scrollToSelectedOnMount]="(state().selection?.kind ?? 'summary') !== 'summary'" [pinned]="state().pinned" [viewStates]="state().viewStates"
              [actionError]="actionError()" (selectedKeyChange)="select($event)"
              (viewStateChange)="saveViewState($event)" (openFile)="openFile($event)" (review)="review()"
              (openExternal)="openExternal($event)" />
          } @placeholder { <p class="p-2 text-xs">Loading display…</p> }
          @error { <p class="p-2 text-xs text-error" role="alert">Display failed to load. <button type="button" class="btn btn-ghost btn-xs" (click)="retry()">Retry</button></p> }
        </section>
      }
    </div>
  `,
})
export class DisplaySheetComponent {
  protected readonly dock = inject(DisplayDockState);
  private readonly sheet = inject(DisplaySheetState);
  private readonly actions = inject(ChangeSetActionsService);
  protected readonly artifactStore = inject(ArtifactStore);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bar = viewChild<ElementRef<HTMLButtonElement>>('bar');
  readonly tabId = input.required<string>();
  protected readonly state = computed(() => this.dock.tab(this.tabId()));
  protected readonly mode = computed(() => this.sheet.mode(this.tabId()));
  protected readonly summary = computed(() => this.dock.summaryFor(this.tabId()));
  protected readonly itemCount = computed(() => this.state().surfaces.length + this.state().summaries.size + this.artifacts().length);
  /**
   * The tab's published artifacts (TASK_2026_710). The store buckets records
   * by the routing tab id, the same id the MCP publish scope carries.
   */
  protected readonly artifacts = computed<readonly ArtifactRecord[]>(
    () => this.artifactStore.records()[this.tabId()] ?? NO_ARTIFACTS,
  );
  /**
   * The bar's accessible name. `aria-label` replaces the visible "Display · N"
   * and the badge, so a non-zero `newCount` has to be part of this string.
   * Zero stays "Display, N items" — the badge is absent, and appending "0 new"
   * would announce a count the sighted UI does not show.
   */
  protected readonly barLabel = computed(() => {
    const items = `Display, ${this.itemCount()} items`;
    const fresh = this.state().newCount;
    return fresh > 0 ? `${items}, ${fresh} new` : items;
  });
  protected readonly visible = computed(() => this.state().open || this.itemCount() > 0);
  protected readonly summaryTurnKey = computed(() => this.dock.summaryKeyFor(this.tabId()));
  protected readonly regionId = computed(() => `display-sheet-${this.tabId().replace(/[^a-zA-Z0-9_-]/g, '-')}`);
  protected readonly selectedKey = computed(() => {
    const selection = this.state().selection;
    if (selection === null) return null;
    if (selection.kind === 'summary') return DISPLAY_PANEL_SUMMARY_KEY;
    if (selection.kind === 'artifact') {
      return `${DISPLAY_PANEL_ARTIFACT_KEY_PREFIX}${selection.artifactId}`;
    }
    return selection.surfaceKey;
  });
  private readonly failure = signal<{ tabId: string; message: string } | null>(null);
  protected readonly linkError = signal<string | null>(null);
  private linkErrorTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly actionError = computed(() => this.failure()?.tabId === this.tabId() ? this.failure()?.message ?? null : null);
  protected readonly pulse = signal(false);
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRevision = 0;
  private visibleTabId: string | null = null;

  constructor() {
    effect(() => {
      const tabId = this.tabId();
      const revision = this.state().surfaceRevision;
      if (tabId !== this.visibleTabId) {
        this.visibleTabId = tabId;
        this.lastRevision = revision;
        this.pulse.set(false);
        if (this.pulseTimer !== null) { clearTimeout(this.pulseTimer); this.pulseTimer = null; }
        return;
      }
      const previous = this.lastRevision;
      this.lastRevision = revision;
      if (revision <= previous) return;
      this.pulse.set(false);
      queueMicrotask(() => {
        if (this.destroyRef.destroyed || this.visibleTabId !== tabId) return;
        this.pulse.set(true);
      });
      if (this.pulseTimer !== null) clearTimeout(this.pulseTimer);
      this.pulseTimer = setTimeout(() => { this.pulse.set(false); this.pulseTimer = null; }, 650);
    });
    this.destroyRef.onDestroy(() => { if (this.pulseTimer !== null) clearTimeout(this.pulseTimer); if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer); });
  }

  protected toggle(): void { this.dock.toggle(this.tabId()); }
  protected onBarKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.state().open) { event.preventDefault(); this.collapse(); }
    else if (event.key === 'ArrowUp' || event.key === 'End') { event.preventDefault(); this.dock.open(this.tabId()); this.sheet.setMode(this.tabId(), 'full'); }
    else if (event.key === 'ArrowDown' || event.key === 'Home') { event.preventDefault(); this.dock.open(this.tabId()); this.sheet.setMode(this.tabId(), 'peek'); }
  }
  protected collapse(): void { this.dock.close(this.tabId()); this.bar()?.nativeElement.focus(); }
  protected onRegionEscape(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
    event.preventDefault();
    this.collapse();
  }
  protected toggleHeight(): void { this.sheet.setMode(this.tabId(), this.mode() === 'full' ? 'peek' : 'full'); }
  protected togglePin(): void { this.dock.setPinned(this.tabId(), !this.state().pinned); }
  protected select(key: string): void {
    this.dock.select(this.tabId(), selectionForKey(key));
  }
  protected onFullscreenChange(active: boolean): void {
    if (!active) this.dock.clearFullscreenArtifact(this.tabId());
  }
  private showLinkError(): void {
    this.linkError.set('Could not open the link.');
    if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer);
    this.linkErrorTimer = setTimeout(() => { this.linkError.set(null); this.linkErrorTimer = null; }, 5000);
  }
  /**
   * The artifact viewer relayed a validated `open-link` request: only the
   * main-process allowlist may open it, through the typed `artifacts:openLink`
   * RPC — never `window.open` from the webview.
   */
  protected openExternal(url: string): void {
    void this.rpc
      .call('artifacts:openLink', { url })
      .then((result) => {
        if (result.success && result.data?.opened === true) return;
        this.showLinkError();
      })
      .catch(() => {
        this.showLinkError();
      });
  }
  protected saveViewState(change: DisplayPanelViewStateChange): void { this.dock.setViewState(this.tabId(), change.surfaceKey, change.viewState); }
  protected openFile(path: string): void { void this.runAction((changeSet) => this.actions.openFile(changeSet, path)); }
  protected review(): void { void this.runAction((changeSet) => this.actions.review(changeSet)); }
  protected retry(): void { this.dock.close(this.tabId()); queueMicrotask(() => this.dock.open(this.tabId())); }

  private async runAction(action: (changeSet: TurnChangeSet) => Promise<void>): Promise<void> {
    const tabId = this.tabId();
    const changeSet = this.dock.summaryFor(tabId)?.changeSet ?? null;
    this.failure.set(null);
    if (changeSet === null) { this.failure.set({ tabId, message: NO_CHANGE_SET_TEXT }); return; }
    try { await action(changeSet); }
    catch (error) { this.failure.set({ tabId, message: error instanceof Error && error.message ? error.message : ACTION_FAILED_TEXT }); }
  }
}
