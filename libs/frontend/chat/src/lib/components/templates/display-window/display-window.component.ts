import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
// The panel is named only inside `@defer`, so the compiler loads its entry
// lazily (the display sheet's rule); the type import is erased.
import {
  DisplayPanelComponent,
  type DisplayPanelViewStateChange,
} from '@ptah-extension/chat-ui/display-panel';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  actionToWire,
  type DisplayWindowParsedAction,
} from '../../../services/display-window/display-window-wire';
import { DisplayWindowStateHandler } from './display-window-state.handler';

const LINK_ERROR_TEXT = 'Could not open the link.';
const ACTION_ERROR_TEXT = 'The main window did not receive that action.';
const LINK_ERROR_MS = 5000;

/**
 * The detached Display window's root view (TASK_2026_853_3401, D4).
 *
 * It renders `<ptah-display-panel>` from the main renderer's published
 * snapshot (`DisplayWindowStateHandler`), and turns every panel output into a
 * `displayWindow:action` for the main renderer, which owns the dock state.
 * Links go through `artifacts:openLink` (the main-process allowlist), never
 * `window.open`. Re-attach sends the `attach` action; before any snapshot it
 * closes the window directly. The window's theme follows the snapshot through
 * the `data-theme` and `data-theme-mode` root attributes.
 */
@Component({
  selector: 'ptah-display-window',
  standalone: true,
  imports: [DisplayPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-dvh min-h-0 flex-col bg-base-100 text-base-content' },
  template: `
    <header
      class="flex shrink-0 items-center gap-2 border-b border-base-content/10 px-3 py-2"
    >
      <h1
        class="min-w-0 flex-1 truncate text-sm font-semibold"
        data-testid="display-window-title"
      >
        Display
        @if (view(); as current) {
          · {{ current.count }}
        }
      </h1>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        (click)="reattach()"
        data-testid="display-window-reattach"
      >
        Re-attach
      </button>
    </header>
    @if (linkError()) {
      <p role="alert" class="px-3 py-1 text-xs text-error">{{ linkError() }}</p>
    }
    @if (actionError()) {
      <p role="alert" class="px-3 py-1 text-xs text-error">
        {{ actionError() }}
      </p>
    }
    @if (stateError(); as error) {
      <p
        role="alert"
        class="px-3 py-1 text-xs text-error"
        data-testid="display-window-error"
      >
        {{ error }}
        <button type="button" class="btn btn-ghost btn-xs" (click)="reload()">
          Retry
        </button>
      </p>
    }
    <main class="flex min-h-0 flex-1 flex-col" aria-label="Display">
      @if (view(); as current) {
        @if (current.notice) {
          <p
            class="p-3 text-xs text-base-content-muted"
            role="status"
            data-testid="display-window-notice"
          >
            {{ current.notice }}
          </p>
        } @else {
          @defer (on immediate) {
            <ptah-display-panel
              class="min-h-0 flex-1"
              [surfaces]="current.surfaces"
              [artifacts]="current.artifacts"
              [open]="current.open"
              [fullscreenArtifactId]="current.fullscreenArtifactId"
              [summary]="current.summary"
              [summaryTurnKey]="current.summaryTurnKey"
              [selectedKey]="current.selectedKey"
              [scrollToSelectedOnMount]="current.scrollToSelectedOnMount"
              [pinned]="current.pinned"
              [viewStates]="current.viewStates"
              [actionError]="current.actionError"
              (selectedKeyChange)="send({ type: 'select', key: $event })"
              (fullscreenChange)="onFullscreenChange($event)"
              (viewStateChange)="onViewStateChange($event)"
              (openFile)="send({ type: 'open-file', path: $event })"
              (review)="send({ type: 'review' })"
              (openExternal)="openExternal($event)"
              (retryArtifacts)="reload()"
            />
          } @placeholder {
            <p class="p-3 text-xs text-base-content-muted">Loading display…</p>
          } @error {
            <p class="p-3 text-xs text-error" role="alert">
              Display failed to load.
            </p>
          }
        }
      } @else {
        <p
          class="p-3 text-xs text-base-content-muted"
          role="status"
          data-testid="display-window-waiting"
        >
          Waiting for the main window…
        </p>
      }
    </main>
  `,
})
export class DisplayWindowComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly state = inject(DisplayWindowStateHandler);
  private readonly document = inject(DOCUMENT);

  protected readonly view = computed(() => this.state.snapshot()?.view ?? null);
  protected readonly stateError = this.state.error;
  protected readonly linkError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  private linkErrorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const theme = this.view()?.theme;
      if (theme === undefined) return;
      const root = this.document.documentElement;
      root.setAttribute('data-theme', theme.name);
      root.setAttribute('data-theme-mode', theme.mode);
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer);
    });
    void this.state.load();
  }

  protected reload(): void {
    void this.state.load();
  }

  protected onFullscreenChange(active: boolean): void {
    if (!active) this.send({ type: 'fullscreen-closed' });
  }

  protected onViewStateChange(change: DisplayPanelViewStateChange): void {
    this.send({
      type: 'view-state',
      surfaceKey: change.surfaceKey,
      viewState: change.viewState,
    });
  }

  /** Re-attach: the main window shows the panel again and this window closes. */
  protected reattach(): void {
    if (this.state.snapshot() !== null) {
      this.send({ type: 'attach' });
      return;
    }
    void this.rpc.call('displayWindow:close', {}).then(
      (result) =>
        this.actionError.set(result.success ? null : ACTION_ERROR_TEXT),
      () => this.actionError.set(ACTION_ERROR_TEXT),
    );
  }

  /** Relays one panel action to the main renderer for the snapshot's tab. */
  protected send(action: DisplayWindowParsedAction): void {
    const snapshot = this.state.snapshot();
    if (snapshot === null) return;
    void this.rpc
      .call('displayWindow:action', actionToWire(snapshot.tabId, action))
      .then(
        (result) =>
          this.actionError.set(
            result.success && result.data?.relayed === true
              ? null
              : ACTION_ERROR_TEXT,
          ),
        () => this.actionError.set(ACTION_ERROR_TEXT),
      );
  }

  /** A validated `open-link` from the artifact viewer: the host allowlist decides. */
  protected openExternal(url: string): void {
    void this.rpc.call('artifacts:openLink', { url }).then(
      (result) => {
        if (!(result.success && result.data?.opened === true))
          this.showLinkError();
      },
      () => this.showLinkError(),
    );
  }

  private showLinkError(): void {
    this.linkError.set(LINK_ERROR_TEXT);
    if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer);
    this.linkErrorTimer = setTimeout(() => {
      this.linkError.set(null);
      this.linkErrorTimer = null;
    }, LINK_ERROR_MS);
  }
}
