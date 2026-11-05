import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
// Runtime symbol named only inside `@defer`, so the compiler keeps the
// display-panel chunk lazy (same rule as chat's `display-sheet.component.ts`).
import {
  DisplayPanelComponent,
  type DisplayPanelViewStateChange,
} from '@ptah-extension/chat-ui/display-panel';
import {
  ArtifactStore,
  DisplayWindowSync,
  type DisplayDockSelection,
  type DisplayDockState,
  type DisplayDockTabState,
} from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ArtifactRecord } from '@ptah-extension/shared';

const NO_ARTIFACTS: readonly ArtifactRecord[] = Object.freeze([]);
const NO_SURFACES: DisplayDockTabState['surfaces'] = Object.freeze([]);
const NO_VIEW_STATES: DisplayDockTabState['viewStates'] = new Map();
/**
 * The display panel's artifact strip key prefix, duplicated as in chat's
 * display sheet so this component does not value-import the lazy entry.
 */
const ARTIFACT_KEY_PREFIX = 'artifact:';

/** Maps a panel strip key back to the dock selection it denotes. */
function selectionForKey(key: string): DisplayDockSelection {
  if (key.startsWith(ARTIFACT_KEY_PREFIX)) {
    return { kind: 'artifact', artifactId: key.slice(ARTIFACT_KEY_PREFIX.length) };
  }
  if (key.startsWith('file:')) return { kind: 'file', fileKey: key };
  return { kind: 'surface', surfaceKey: key };
}

/** Maps a dock selection to the panel strip key. */
function keyForSelection(selection: DisplayDockSelection): string | null {
  if (selection === null) return null;
  if (selection.kind === 'artifact') {
    return `${ARTIFACT_KEY_PREFIX}${selection.artifactId}`;
  }
  if (selection.kind === 'file') return selection.fileKey;
  if (selection.kind === 'surface') return selection.surfaceKey;
  return null;
}

/**
 * The rail's Display tab: what the chat display sheet shows for the Live
 * tab — the agent's surfaces and the published artifacts — in the shared
 * `ptah-display-panel`. Surfaces come from the page's display dock, which the
 * Live embed's chat view feeds (Electron); without a dock only artifacts show.
 */
@Component({
  selector: 'ptah-command-rail-display',
  standalone: true,
  imports: [DisplayPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    @if (window && tabId()) {
      <div class="flex shrink-0 items-center justify-end gap-1 px-2 py-1">
        @if (window.error(); as error) { <p role="alert" class="mr-auto text-xs text-error">{{ error }}</p> }
        <button type="button" class="btn btn-ghost btn-xs" (click)="toggleWindow()">
          {{ window.detached() ? 'Dock' : 'Detach' }}
        </button>
      </div>
    }
    @if (linkError()) {
      <p role="alert" class="px-1 pb-1 text-xs text-error">{{ linkError() }}</p>
    }
    @if (artifactStore.lastError(); as error) {
      <p role="status" class="px-1 pb-1 text-xs text-error">{{ error }}</p>
    }
    @if (window?.detached()) {
      <p class="p-2 text-xs text-base-content-muted" role="status">Display is in a separate window.</p>
    } @else if (!hasContent()) {
      <p
        class="p-2 text-xs text-base-content-muted"
        data-testid="rail-display-empty"
      >
        Nothing displayed yet.
      </p>
    } @else if (attempt(); as run) {
      @for (key of [run]; track key) {
        @defer (on immediate) {
          <ptah-display-panel
            class="min-h-0 flex-1"
            [surfaces]="surfaces()"
            [artifacts]="artifacts()"
            [files]="files()"
            [open]="true"
            [fullscreenArtifactId]="fullscreenArtifactId()"
            [selectedKey]="selectedKey()"
            [scrollToSelectedOnMount]="selectedKey() !== null"
            [pinned]="tabState()?.pinned ?? false"
            [viewStates]="viewStates()"
            (selectedKeyChange)="select($event)"
            (viewStateChange)="saveViewState($event)"
            (fullscreenChange)="onFullscreenChange($event)"
            (openExternal)="openExternal($event)"
            (retryArtifacts)="reloadArtifacts()"
          />
        } @placeholder {
          <p class="p-2 text-xs text-base-content-muted">Loading display…</p>
        } @error {
          <p class="p-2 text-xs text-error" role="alert">
            Display failed to load.
            <button
              type="button"
              class="btn btn-ghost btn-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              (click)="retry()"
            >
              Retry
            </button>
          </p>
        }
      }
    }
  `,
})
export class CommandRailDisplayComponent {
  public readonly tabId = input<string | null>(null);
  /** The page's display dock, shared with the Live embed; `null` outside Electron. */
  public readonly dock = input<DisplayDockState | null>(null);

  protected readonly artifactStore = inject(ArtifactStore);
  protected readonly window = inject(DisplayWindowSync, { optional: true });
  private readonly rpc = inject(ClaudeRpcService);

  /** The Live tab's dock state, when there is a dock and a tab. */
  protected readonly tabState = computed(() => {
    const dock = this.dock();
    const id = this.tabId();
    return dock && id ? dock.tab(id) : null;
  });
  protected readonly surfaces = computed(() => this.tabState()?.surfaces ?? NO_SURFACES);
  protected readonly files = computed(() => this.tabState()?.files ?? []);
  protected readonly viewStates = computed(
    () => this.tabState()?.viewStates ?? NO_VIEW_STATES,
  );
  protected readonly fullscreenArtifactId = computed(() => {
    const dock = this.dock();
    const id = this.tabId();
    return dock && id ? dock.fullscreenArtifact(id) : null;
  });
  /**
   * The tab's artifacts plus the selected one from any bucket: the publishing
   * session can be routed to another tab id than the Live tab (a resumed or
   * continued session), and the panel must still show what is selected.
   */
  protected readonly artifacts = computed<readonly ArtifactRecord[]>(() => {
    const id = this.tabId();
    const key = this.selectedKey();
    const selectedArtifactId =
      key !== null && key.startsWith(ARTIFACT_KEY_PREFIX)
        ? key.slice(ARTIFACT_KEY_PREFIX.length)
        : null;
    return id
      ? this.artifactStore.panelArtifacts(id, selectedArtifactId)
      : NO_ARTIFACTS;
  });
  protected readonly hasContent = computed(
    () => this.surfaces().length > 0 || this.artifacts().length > 0 || this.files().length > 0,
  );

  /** Without a dock the selection is local; a new tab starts with none. */
  private readonly localSelectedKey = linkedSignal<string | null, string | null>({
    source: this.tabId,
    computation: () => null,
  });
  /** The open item: the dock's per-tab selection, else the local one. */
  protected readonly selectedKey = computed(() => {
    const state = this.tabState();
    return state ? keyForSelection(state.selection) : this.localSelectedKey();
  });

  protected readonly linkError = signal<string | null>(null);
  /** Rising key that remounts the deferred block for Retry. */
  protected readonly attempt = signal(1);
  private linkErrorTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer);
    });
  }

  protected retry(): void {
    this.attempt.update((value) => value + 1);
  }

  protected toggleWindow(): void {
    const displayWindow = this.window;
    if (!displayWindow) return;
    void (displayWindow.detached() ? displayWindow.attach() : displayWindow.detach());
  }

  /** The panel's Retry on a missing artifact: list the tab's artifacts again. */
  protected reloadArtifacts(): void {
    const id = this.tabId();
    if (id) void this.artifactStore.reload(id);
  }

  protected select(key: string): void {
    const dock = this.dock();
    const id = this.tabId();
    if (dock && id) dock.select(id, selectionForKey(key));
    else this.localSelectedKey.set(key);
  }

  protected saveViewState(change: DisplayPanelViewStateChange): void {
    const id = this.tabId();
    if (id) this.dock()?.setViewState(id, change.surfaceKey, change.viewState);
  }

  protected onFullscreenChange(active: boolean): void {
    const id = this.tabId();
    if (!active && id) this.dock()?.clearFullscreenArtifact(id);
  }

  /** Only the main-process allowlist opens a link, through the typed RPC. */
  protected openExternal(url: string): void {
    void this.rpc
      .call('artifacts:openLink', { url })
      .then((result) => {
        if (!(result.success && result.data?.opened === true))
          this.showLinkError();
      })
      .catch(() => this.showLinkError());
  }

  private showLinkError(): void {
    this.linkError.set('Could not open the link.');
    if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer);
    this.linkErrorTimer = setTimeout(() => {
      this.linkError.set(null);
      this.linkErrorTimer = null;
    }, 5000);
  }
}
