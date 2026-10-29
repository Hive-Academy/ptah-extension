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
  ChangeSetActionsService,
  type DisplayDockSelection,
  type DisplayDockState,
  type DisplayDockTabState,
} from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ArtifactRecord, TurnChangeSet } from '@ptah-extension/shared';

const NO_ARTIFACTS: readonly ArtifactRecord[] = Object.freeze([]);
const NO_SURFACES: DisplayDockTabState['surfaces'] = Object.freeze([]);
const NO_VIEW_STATES: DisplayDockTabState['viewStates'] = new Map();
/**
 * The display panel's strip keys (`summary`, `artifact:<id>`), duplicated as
 * in chat's display sheet so this component does not value-import the lazy
 * entry.
 */
const SUMMARY_KEY = 'summary';
const ARTIFACT_KEY_PREFIX = 'artifact:';
const NO_CHANGE_SET_TEXT = 'This turn has no recorded file changes to open.';
const ACTION_FAILED_TEXT = 'The review action failed.';

/** Maps a panel strip key back to the dock selection it denotes. */
function selectionForKey(key: string): DisplayDockSelection {
  if (key === SUMMARY_KEY) return { kind: 'summary' };
  if (key.startsWith(ARTIFACT_KEY_PREFIX)) {
    return { kind: 'artifact', artifactId: key.slice(ARTIFACT_KEY_PREFIX.length) };
  }
  return { kind: 'surface', surfaceKey: key };
}

/** Maps a dock selection to the panel strip key. */
function keyForSelection(selection: DisplayDockSelection): string | null {
  if (selection === null) return null;
  if (selection.kind === 'summary') return SUMMARY_KEY;
  if (selection.kind === 'artifact') {
    return `${ARTIFACT_KEY_PREFIX}${selection.artifactId}`;
  }
  return selection.surfaceKey;
}

/**
 * The rail's Display tab: what the chat display sheet shows for the Live
 * tab — the agent's surfaces, the turn summary and the published artifacts —
 * in the shared `ptah-display-panel`. Surfaces and summaries come from the
 * page's display dock, which the Live embed's chat view feeds (Electron);
 * without a dock only artifacts show.
 */
@Component({
  selector: 'ptah-command-rail-display',
  standalone: true,
  imports: [DisplayPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    @if (linkError()) {
      <p role="alert" class="px-1 pb-1 text-xs text-error">{{ linkError() }}</p>
    }
    @if (artifactStore.lastError(); as error) {
      <p role="status" class="px-1 pb-1 text-xs text-error">{{ error }}</p>
    }
    @if (!hasContent()) {
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
            [open]="true"
            [fullscreenArtifactId]="fullscreenArtifactId()"
            [summary]="summary()?.model ?? null"
            [summaryTurnKey]="summaryTurnKey() ?? ''"
            [selectedKey]="selectedKey()"
            [scrollToSelectedOnMount]="selectedKey() !== null && selectedKey() !== summaryKey"
            [pinned]="tabState()?.pinned ?? false"
            [viewStates]="viewStates()"
            [actionError]="actionError()"
            (selectedKeyChange)="select($event)"
            (viewStateChange)="saveViewState($event)"
            (fullscreenChange)="onFullscreenChange($event)"
            (openFile)="openFile($event)"
            (review)="review()"
            (openExternal)="openExternal($event)"
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
  private readonly rpc = inject(ClaudeRpcService);
  private readonly actions = inject(ChangeSetActionsService);
  protected readonly summaryKey = SUMMARY_KEY;

  /** The Live tab's dock state, when there is a dock and a tab. */
  protected readonly tabState = computed(() => {
    const dock = this.dock();
    const id = this.tabId();
    return dock && id ? dock.tab(id) : null;
  });
  protected readonly surfaces = computed(() => this.tabState()?.surfaces ?? NO_SURFACES);
  protected readonly viewStates = computed(
    () => this.tabState()?.viewStates ?? NO_VIEW_STATES,
  );
  protected readonly summary = computed(() => {
    const dock = this.dock();
    const id = this.tabId();
    return dock && id ? dock.summaryFor(id) : null;
  });
  protected readonly summaryTurnKey = computed(() => {
    const dock = this.dock();
    const id = this.tabId();
    return dock && id ? dock.summaryKeyFor(id) : null;
  });
  protected readonly fullscreenArtifactId = computed(() => {
    const dock = this.dock();
    const id = this.tabId();
    return dock && id ? dock.fullscreenArtifact(id) : null;
  });
  protected readonly artifacts = computed<readonly ArtifactRecord[]>(() => {
    const id = this.tabId();
    return id ? (this.artifactStore.records()[id] ?? NO_ARTIFACTS) : NO_ARTIFACTS;
  });
  protected readonly hasContent = computed(
    () =>
      this.surfaces().length > 0 ||
      this.summary() !== null ||
      this.artifacts().length > 0,
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

  private readonly failure = signal<{ tabId: string; message: string } | null>(
    null,
  );
  protected readonly actionError = computed(() => {
    const failure = this.failure();
    return failure !== null && failure.tabId === this.tabId()
      ? failure.message
      : null;
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

  protected openFile(path: string): void {
    void this.runAction((changeSet) => this.actions.openFile(changeSet, path));
  }

  protected review(): void {
    void this.runAction((changeSet) => this.actions.review(changeSet));
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

  private async runAction(
    action: (changeSet: TurnChangeSet) => Promise<void>,
  ): Promise<void> {
    const id = this.tabId();
    if (!id) return;
    const changeSet = this.summary()?.changeSet ?? null;
    this.failure.set(null);
    if (changeSet === null) {
      this.failure.set({ tabId: id, message: NO_CHANGE_SET_TEXT });
      return;
    }
    try {
      await action(changeSet);
    } catch (error) {
      this.failure.set({
        tabId: id,
        message:
          error instanceof Error && error.message
            ? error.message
            : ACTION_FAILED_TEXT,
      });
    }
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
