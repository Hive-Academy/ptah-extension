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
import { DisplayPanelComponent } from '@ptah-extension/chat-ui/display-panel';
import { ArtifactStore } from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ArtifactRecord } from '@ptah-extension/shared';

const NO_ARTIFACTS: readonly ArtifactRecord[] = Object.freeze([]);

/**
 * The rail's Display tab: the session's published artifacts in the shared
 * `ptah-display-panel`, keyed by the Live tab id the way the chat display
 * sheet reads `ArtifactStore`. Charts and summaries the transcript renders
 * stay in the Live tab's own display sheet, because their dock state belongs
 * to that chat view.
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
    @if (attempt(); as run) {
      @for (key of [run]; track key) {
        @defer (on immediate) {
          <ptah-display-panel
            class="min-h-0 flex-1"
            [artifacts]="artifacts()"
            [open]="true"
            [selectedKey]="selectedKey()"
            (selectedKeyChange)="selectedKey.set($event)"
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

  protected readonly artifactStore = inject(ArtifactStore);
  private readonly rpc = inject(ClaudeRpcService);
  /** The open artifact belongs to one tab, so a new tab starts with none selected. */
  protected readonly selectedKey = linkedSignal<string | null, string | null>({
    source: this.tabId,
    computation: () => null,
  });
  protected readonly linkError = signal<string | null>(null);
  /** Rising key that remounts the deferred block for Retry. */
  protected readonly attempt = signal(1);
  protected readonly artifacts = computed<readonly ArtifactRecord[]>(() => {
    const id = this.tabId();
    return id ? (this.artifactStore.records()[id] ?? NO_ARTIFACTS) : NO_ARTIFACTS;
  });
  private linkErrorTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.linkErrorTimer !== null) clearTimeout(this.linkErrorTimer);
    });
  }

  protected retry(): void {
    this.attempt.update((value) => value + 1);
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
