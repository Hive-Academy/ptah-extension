import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
// The panel is the only runtime symbol, and the template names it only inside
// `@defer (on immediate)`. The compiler drops this static import when every
// symbol of the declaration is defer-only; a second runtime symbol would keep
// the whole `display-panel` barrel (and declarative-dashboard) eager.
import { DisplayPanelComponent, type DisplayPanelViewStateChange } from '@ptah-extension/chat-ui/display-panel';
import type { TurnChangeSet } from '@ptah-extension/shared';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
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
    <div class="sheet-shell relative border-t border-base-content/15 bg-base-200">
      @if (pulse()) { <span class="sheet-pulse pointer-events-none absolute inset-0 border border-primary" aria-hidden="true"></span> }
      <div class="flex h-9 items-center gap-1 px-2">
        <button #bar type="button" class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start focus-visible:outline focus-visible:outline-2"
          [attr.aria-expanded]="state().open" [attr.aria-controls]="regionId()"
          [attr.aria-label]="'Display, ' + itemCount() + ' items'"
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
      @if (everOpened()) {
        <section [id]="regionId()" role="region" aria-label="Display" class="sheet-body flex min-h-0 flex-col overflow-hidden border-t border-base-content/10"
          [class.full]="mode() === 'full'" [hidden]="!state().open" [attr.inert]="state().open ? null : ''"
          [style.display]="state().open ? null : 'none'" (keydown.escape)="onRegionEscape($event)" data-testid="display-sheet-region">
          @defer (on immediate) {
            <ptah-display-panel class="min-h-0 flex-1" [surfaces]="state().surfaces"
              [summary]="summary()?.model ?? null" [summaryTurnKey]="summaryTurnKey() ?? ''"
              [selectedKey]="selectedKey()" [scrollToSelectedOnMount]="state().selection?.kind === 'surface'" [pinned]="state().pinned" [viewStates]="state().viewStates"
              [actionError]="actionError()" (selectedKeyChange)="select($event)"
              (viewStateChange)="saveViewState($event)" (openFile)="openFile($event)" (review)="review()" />
          } @placeholder { <p class="p-2 text-xs">Loading display…</p> }
          @error { <p class="p-2 text-xs text-error" role="alert">Display failed to load. <button type="button" class="btn btn-ghost btn-xs" (click)="retry()">Retry</button></p> }
        </section>
      }
    </div>
  `,
})
export class DisplaySheetComponent {
  private readonly dock = inject(DisplayDockState);
  private readonly sheet = inject(DisplaySheetState);
  private readonly actions = inject(ChangeSetActionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bar = viewChild<ElementRef<HTMLButtonElement>>('bar');
  readonly tabId = input.required<string>();
  protected readonly state = computed(() => this.dock.tab(this.tabId()));
  protected readonly mode = computed(() => this.sheet.mode(this.tabId()));
  protected readonly summary = computed(() => this.dock.summaryFor(this.tabId()));
  protected readonly itemCount = computed(() => this.state().surfaces.length + this.state().summaries.size);
  protected readonly visible = computed(() => this.state().open || this.itemCount() > 0);
  protected readonly summaryTurnKey = computed(() => this.dock.summaryKeyFor(this.tabId()));
  protected readonly regionId = computed(() => `display-sheet-${this.tabId().replace(/[^a-zA-Z0-9_-]/g, '-')}`);
  protected readonly selectedKey = computed(() => {
    const selection = this.state().selection;
    return selection?.kind === 'summary' ? DISPLAY_PANEL_SUMMARY_KEY : selection?.kind === 'surface' ? selection.surfaceKey : null;
  });
  private readonly failure = signal<{ tabId: string; message: string } | null>(null);
  protected readonly actionError = computed(() => this.failure()?.tabId === this.tabId() ? this.failure()?.message ?? null : null);
  protected readonly pulse = signal(false);
  protected readonly everOpened = signal(false);
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
    effect(() => { if (this.state().open) this.everOpened.set(true); });
    this.destroyRef.onDestroy(() => { if (this.pulseTimer !== null) clearTimeout(this.pulseTimer); });
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
    event.preventDefault();
    this.collapse();
  }
  protected toggleHeight(): void { this.sheet.setMode(this.tabId(), this.mode() === 'full' ? 'peek' : 'full'); }
  protected togglePin(): void { this.dock.setPinned(this.tabId(), !this.state().pinned); }
  protected select(key: string): void {
    this.dock.select(this.tabId(), key === DISPLAY_PANEL_SUMMARY_KEY ? { kind: 'summary' } : { kind: 'surface', surfaceKey: key });
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
