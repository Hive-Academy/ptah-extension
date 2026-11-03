import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
// The panel is the only runtime symbol, and the template names it only inside
// `@defer (on immediate)`. The compiler drops this static import when every
// symbol of the declaration is defer-only; a second runtime symbol would keep
// the whole `display-panel` barrel (and declarative-dashboard) eager.
import {
  DisplayPanelComponent,
  type DisplayPanelViewStateChange,
} from '@ptah-extension/chat-ui/display-panel';
import { SidebarTabComponent } from '@ptah-extension/chat-ui';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ArtifactRecord, TurnChangeSet } from '@ptah-extension/shared';
import { ArtifactStore } from '../../../services/artifact.store';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import {
  ChangeSetActionsService,
  runDisplayChangeSetAction,
} from '../../../services/change-set/change-set-actions.service';
import {
  selectionForKey,
  selectionKey,
} from '../../../services/display-window/display-window-wire';

/**
 * The session's Display collection as a right sidebar (TASK_2026_853_3401, D1).
 *
 * - Collapsed (`dock.open` false): a vertical "Display · N" sidebar tab, shown
 *   only when the tab has content.
 * - Open: a header (Display · N, Pin, optional Detach, Collapse) above the
 *   panel. The host sets the width; `overlay` turns it into an absolute right
 *   drawer for a narrow host.
 */
@Component({
  selector: 'ptah-display-sheet',
  standalone: true,
  imports: [DisplayPanelComponent, SidebarTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'min-w-0',
    'data-testid': 'display-sheet',
    '[style.display]': "visible() ? null : 'none'",
    '[class.sheet-open]': 'state().open',
    '[class.sheet-overlay]': 'overlay()',
  },
  styles: `
    :host {
      display: flex;
      flex: 0 0 auto;
      min-height: 0;
      height: 100%;
    }
    :host(.sheet-open) {
      flex-direction: column;
    }
    :host(.sheet-open.sheet-overlay) {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      max-width: 100%;
    }
    .sheet-shell {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      min-width: 0;
    }
    .sheet-body {
      flex: 1;
      min-height: 0;
    }
    .sheet-pulse {
      animation: sheet-pulse 600ms ease-out;
    }
    @keyframes sheet-pulse {
      0% {
        opacity: 0.45;
        transform: scale(1);
      }
      50% {
        opacity: 1;
        transform: scale(1.015);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .sheet-pulse {
        animation: none;
      }
    }
  `,
  template: `
    @if (state().open) {
      <div
        class="sheet-shell relative border-l border-base-content/15 bg-base-200"
        [attr.data-glass-surface]="overlay() ? 'overlay' : 'chrome'"
      >
        @if (pulse()) {
          <span
            class="sheet-pulse pointer-events-none absolute inset-0 border border-primary"
            aria-hidden="true"
          ></span>
        }
        <div class="flex h-9 flex-shrink-0 items-center gap-1 px-2">
          <h2
            class="min-w-0 flex-1 truncate text-sm font-semibold"
            data-testid="display-sheet-title"
          >
            Display · {{ itemCount() }}
          </h2>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            [attr.aria-pressed]="state().pinned"
            [class.text-primary]="state().pinned"
            aria-label="Pin panel"
            (click)="togglePin()"
            data-testid="display-sheet-pin"
          >
            Pin
          </button>
          @if (detachable()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              aria-label="Open Display in a separate window"
              (click)="detachRequested.emit()"
              data-testid="display-sheet-detach"
            >
              Detach
            </button>
          }
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            aria-label="Collapse display"
            [attr.aria-expanded]="true"
            [attr.aria-controls]="regionId()"
            (click)="collapse()"
            data-testid="display-sheet-close"
          >
            Collapse
          </button>
        </div>
        <section
          [id]="regionId()"
          role="region"
          aria-label="Display"
          class="sheet-body flex min-h-0 flex-col overflow-hidden border-t border-base-content/10"
          [class.overlay]="overlay()"
          (keydown.escape)="onRegionEscape($event)"
          data-testid="display-sheet-region"
        >
          @if (detachError()) {
            <p role="alert" class="px-3 py-1 text-xs text-error">
              {{ detachError() }}
            </p>
          }
          @if (linkError()) {
            <p role="alert" class="px-3 py-1 text-xs text-error">
              {{ linkError() }}
            </p>
          }
          @if (artifactStore.lastError()) {
            <p role="status" class="px-3 py-1 text-xs text-error">
              {{ artifactStore.lastError() }}
            </p>
          }
          @defer (on immediate) {
            <ptah-display-panel
              class="min-h-0 flex-1"
              [surfaces]="state().surfaces"
              [artifacts]="artifacts()"
              [open]="state().open"
              [fullscreenArtifactId]="dock.fullscreenArtifact(this.tabId())"
              (fullscreenChange)="onFullscreenChange($event)"
              [summary]="summary()?.model ?? null"
              [summaryTurnKey]="summaryTurnKey() ?? ''"
              [selectedKey]="selectedKey()"
              [scrollToSelectedOnMount]="
                (state().selection?.kind ?? 'summary') !== 'summary'
              "
              [pinned]="state().pinned"
              [viewStates]="state().viewStates"
              [actionError]="actionError()"
              (selectedKeyChange)="select($event)"
              (viewStateChange)="saveViewState($event)"
              (openFile)="openFile($event)"
              (review)="review()"
              (openExternal)="openExternal($event)"
            />
          } @placeholder {
            <p class="p-2 text-xs">Loading display…</p>
          } @error {
            <p class="p-2 text-xs text-error" role="alert">
              Display failed to load.
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                (click)="retry()"
              >
                Retry
              </button>
            </p>
          }
        </section>
      </div>
    } @else {
      <ptah-sidebar-tab
        [label]="tabLabel()"
        side="right"
        size="sm"
        [isOpen]="false"
        [newCount]="state().newCount"
        (toggled)="toggle()"
        data-testid="display-sheet-tab"
      />
    }
  `,
})
export class DisplaySheetComponent {
  protected readonly dock = inject(DisplayDockState);
  private readonly actions = inject(ChangeSetActionsService);
  protected readonly artifactStore = inject(ArtifactStore);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly tabId = input.required<string>();
  /** Shows Detach (main chat view in Electron only). */
  readonly detachable = input(false);
  /** Narrow host: an absolute right drawer over the chat. */
  readonly overlay = input(false);
  /** A failed detach, shown above the panel. */
  readonly detachError = input<string | null>(null);
  /** The user asked to move the panel into a separate window. */
  readonly detachRequested = output<void>();
  protected readonly state = computed(() => this.dock.tab(this.tabId()));
  protected readonly summary = computed(() =>
    this.dock.summaryFor(this.tabId()),
  );
  protected readonly itemCount = computed(
    () =>
      this.state().surfaces.length +
      this.state().summaries.size +
      this.artifacts().length,
  );
  /**
   * The tab's published artifacts (TASK_2026_710). The store buckets records
   * by the routing tab id, the same id the MCP publish scope carries.
   */
  protected readonly artifacts = computed<readonly ArtifactRecord[]>(() => {
    const selection = this.state().selection;
    return this.artifactStore.panelArtifacts(
      this.tabId(),
      selection?.kind === 'artifact' ? selection.artifactId : null,
    );
  });
  /** The collapsed tab's label; its button adds "n new" to the name. */
  protected readonly tabLabel = computed(() => `Display · ${this.itemCount()}`);
  protected readonly visible = computed(
    () => this.state().open || this.itemCount() > 0,
  );
  protected readonly summaryTurnKey = computed(() =>
    this.dock.summaryKeyFor(this.tabId()),
  );
  protected readonly regionId = computed(
    () => `display-sheet-${this.tabId().replace(/[^a-zA-Z0-9_-]/g, '-')}`,
  );
  protected readonly selectedKey = computed(() =>
    selectionKey(this.state().selection),
  );
  private readonly failure = signal<{ tabId: string; message: string } | null>(
    null,
  );
  protected readonly linkError = signal<string | null>(null);
  private linkErrorTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly actionError = computed(() =>
    this.failure()?.tabId === this.tabId()
      ? (this.failure()?.message ?? null)
      : null,
  );
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
        if (this.pulseTimer !== null) {
          clearTimeout(this.pulseTimer);
          this.pulseTimer = null;
        }
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
      this.pulseTimer = setTimeout(() => {
        this.pulse.set(false);
        this.pulseTimer = null;
      }, 650);
    });
    this.destroyRef.onDestroy(() => {
      if (this.pulseTimer !== null) clearTimeout(this.pulseTimer);
      if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer);
    });
  }

  protected toggle(): void {
    this.dock.toggle(this.tabId());
  }
  /** Collapses to the sidebar tab and moves focus onto it. */
  protected collapse(): void {
    this.dock.close(this.tabId());
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLButtonElement>('ptah-sidebar-tab button')
          ?.focus(),
      { injector: this.injector },
    );
  }
  protected onRegionEscape(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.defaultPrevented) return;
    if (
      event.target instanceof Element &&
      event.target.closest('[role="dialog"]')
    )
      return;
    event.preventDefault();
    this.collapse();
  }
  protected togglePin(): void {
    this.dock.setPinned(this.tabId(), !this.state().pinned);
  }
  protected select(key: string): void {
    this.dock.select(this.tabId(), selectionForKey(key));
  }
  protected onFullscreenChange(active: boolean): void {
    if (!active) this.dock.clearFullscreenArtifact(this.tabId());
  }
  private showLinkError(): void {
    this.linkError.set('Could not open the link.');
    if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer);
    this.linkErrorTimer = setTimeout(() => {
      this.linkError.set(null);
      this.linkErrorTimer = null;
    }, 5000);
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
  protected saveViewState(change: DisplayPanelViewStateChange): void {
    this.dock.setViewState(this.tabId(), change.surfaceKey, change.viewState);
  }
  protected openFile(path: string): void {
    void this.runAction((changeSet) => this.actions.openFile(changeSet, path));
  }
  protected review(): void {
    void this.runAction((changeSet) => this.actions.review(changeSet));
  }
  protected retry(): void {
    this.dock.close(this.tabId());
    queueMicrotask(() => this.dock.open(this.tabId()));
  }

  private async runAction(
    action: (changeSet: TurnChangeSet) => Promise<void>,
  ): Promise<void> {
    const tabId = this.tabId();
    this.failure.set(null);
    await runDisplayChangeSetAction(
      this.dock.summaryFor(tabId)?.changeSet ?? null,
      action,
      (message) => this.failure.set({ tabId, message }),
    );
  }
}
