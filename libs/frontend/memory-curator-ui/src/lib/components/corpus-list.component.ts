import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  SessionId,
  type CorpusBuildParams,
  type CorpusEntry,
  type CorpusSuggestion,
} from '@ptah-extension/shared';

import { MemoryRpcService } from '../services/memory-rpc.service';

import { CorpusBuildDialogComponent } from './corpus-build-dialog.component';
import { CorpusSuggestionsComponent } from './corpus-suggestions.component';

/**
 * Optional injection slot for the chat navigator. The Thoth shell binds this
 * to a function delegating to `ChatStore.switchSession(sessionId)`. We use a
 * token (rather than importing `@ptah-extension/chat`) to keep this lib's
 * jest config free of ngx-markdown's ESM transform (the chat barrel pulls
 * `markdown` which pulls `ngx-markdown`).
 */
export interface CorpusChatNavigator {
  switchSession(sessionId: SessionId): Promise<void> | void;
}

export const CORPUS_CHAT_NAVIGATOR = new InjectionToken<CorpusChatNavigator>(
  'CorpusChatNavigator',
);

/**
 * CorpusListComponent
 *
 * Smart container for the Memory tab's Corpus panel. Loads the
 * workspace-scoped corpus list on init, supports build / prime /
 * reprime / rebuild / delete actions, and routes "Prime in new chat"
 * through `ChatStore.switchSession()` so the priming session opens in
 * the existing chat shell.
 */
@Component({
  selector: 'ptah-corpus-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    CorpusBuildDialogComponent,
    CorpusSuggestionsComponent,
  ],
  template: `
    <div class="flex h-full w-full flex-col gap-3">
      <ptah-corpus-suggestions
        [suggestions]="visibleSuggestions()"
        [loading]="suggestLoading()"
        [busyName]="busyName()"
        (create)="onCreateSuggestion($event)"
        (dismiss)="onDismissSuggestion($event)"
      />

      <header class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold">Knowledge corpora</span>
        <span class="text-xs text-base-content/60">
          {{ corpora().length }} corpora
        </span>
        <div class="ml-auto flex gap-1">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            [disabled]="loading()"
            (click)="onRefresh()"
            aria-label="Refresh corpus list"
          >
            @if (loading()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Refresh
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            (click)="onOpenBuild()"
            aria-label="Open build corpus dialog"
          >
            Build corpus
          </button>
        </div>
      </header>

      @if (error()) {
        <div
          class="rounded-xl border border-error/40 bg-error/5 px-4 py-2"
          role="alert"
        >
          <span class="text-sm text-error">{{ error() }}</span>
        </div>
      }
      @if (info()) {
        <div
          class="rounded-xl border border-success/40 bg-success/5 px-4 py-2"
          role="status"
        >
          <span class="text-sm text-success">{{ info() }}</span>
        </div>
      }

      @if (loading() && corpora().length === 0) {
        <div
          class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
        >
          <div class="divide-y divide-base-300/70">
            @for (n of skeletonRows; track n) {
              <div class="flex items-center gap-3 px-4 py-3">
                <div class="skeleton h-3 w-40"></div>
                <div class="skeleton h-3 flex-1"></div>
              </div>
            }
          </div>
        </div>
      } @else if (corpora().length === 0) {
        <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p class="text-sm font-medium">No corpora yet</p>
          <p class="text-xs text-base-content/60">
            Click Build corpus to snapshot a memory filter into a named,
            primeable bundle.
          </p>
        </div>
      } @else {
        <ul
          class="divide-y divide-base-300/70 overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
        >
          @for (corpus of corpora(); track corpus.id) {
            <li
              class="group flex flex-col gap-2 px-4 py-3 transition-colors duration-150 hover:bg-base-300/30 md:flex-row md:items-center"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span class="text-sm font-medium">{{ corpus.name }}</span>
                  <span class="text-xs text-base-content/60">
                    {{ corpus.count }} memories · built
                    {{ formatTimestamp(corpus.builtAt) }}
                  </span>
                  @if (corpus.rebuiltAt !== null) {
                    <span class="text-xs text-base-content/60">
                      · rebuilt {{ formatTimestamp(corpus.rebuiltAt) }}
                    </span>
                  }
                </div>
              </div>
              <div
                class="flex shrink-0 flex-wrap gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
              >
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  [disabled]="busyName() === corpus.name"
                  (click)="onPrimeInNewChat(corpus)"
                  [attr.aria-label]="
                    'Prime corpus ' + corpus.name + ' in a new chat'
                  "
                >
                  Prime in new chat
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  [disabled]="busyName() === corpus.name"
                  (click)="onReprime(corpus)"
                  [attr.aria-label]="'Reprime corpus ' + corpus.name"
                >
                  Reprime
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  [disabled]="busyName() === corpus.name"
                  (click)="onRebuild(corpus)"
                  [attr.aria-label]="'Rebuild corpus ' + corpus.name"
                >
                  Rebuild
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost text-error"
                  [disabled]="busyName() === corpus.name"
                  (click)="onDelete(corpus)"
                  [attr.aria-label]="'Delete corpus ' + corpus.name"
                >
                  Delete
                </button>
              </div>
            </li>
          }
        </ul>
      }

      @if (buildOpen()) {
        <ptah-corpus-build-dialog
          (submitParams)="onSubmitBuild($event)"
          (cancelDialog)="onCloseBuild()"
        />
      }
    </div>
  `,
})
export class CorpusListComponent implements OnInit {
  private readonly rpc = inject(MemoryRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);
  private readonly chatNavigator = inject(CORPUS_CHAT_NAVIGATOR, {
    optional: true,
  });

  protected readonly corpora = signal<readonly CorpusEntry[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);
  protected readonly buildOpen = signal<boolean>(false);
  protected readonly busyName = signal<string | null>(null);
  protected readonly skeletonRows = [0, 1, 2] as const;

  protected readonly suggestions = signal<readonly CorpusSuggestion[]>([]);
  protected readonly suggestLoading = signal<boolean>(false);
  /** Session-scoped set of dismissed suggestion names (no persistence, no RPC). */
  private readonly dismissed = signal<ReadonlySet<string>>(new Set());
  protected readonly visibleSuggestions = computed(() => {
    const hidden = this.dismissed();
    return this.suggestions().filter((s) => !hidden.has(s.suggestedName));
  });

  public ngOnInit(): void {
    // `refresh()` tail-calls `loadSuggestions()`, so a single call loads both
    // the corpus list and the suggestion strip — no separate suggest fetch here.
    void this.refresh();
  }

  protected onRefresh(): void {
    void this.refresh();
  }

  protected onOpenBuild(): void {
    this.buildOpen.set(true);
  }

  protected onCloseBuild(): void {
    this.buildOpen.set(false);
  }

  protected onSubmitBuild(params: CorpusBuildParams): void {
    this.buildOpen.set(false);
    void this.runBuild(params);
  }

  protected onCreateSuggestion(suggestion: CorpusSuggestion): void {
    // `filter` is a complete CorpusBuildParams — reuse the existing build path
    // (sets the banner + refreshes). Backend dedupe drops the created concept
    // from the next suggest pass, so the card falls out of the strip.
    void this.runBuild(suggestion.filter);
  }

  protected onDismissSuggestion(suggestion: CorpusSuggestion): void {
    this.dismissed.update((prev) => {
      const next = new Set(prev);
      next.add(suggestion.suggestedName);
      return next;
    });
  }

  protected onPrimeInNewChat(corpus: CorpusEntry): void {
    void this.runPrime(corpus);
  }

  protected onReprime(corpus: CorpusEntry): void {
    void this.runReprime(corpus);
  }

  protected onRebuild(corpus: CorpusEntry): void {
    void this.runRebuild(corpus);
  }

  protected onDelete(corpus: CorpusEntry): void {
    const confirmed = window.confirm(
      `Delete corpus '${corpus.name}'? Underlying memories are kept; only the snapshot is removed.`,
    );
    if (!confirmed) return;
    void this.runDelete(corpus);
  }

  protected formatTimestamp(ms: number): string {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return String(ms);
    }
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const root = this.appState.workspaceInfo()?.path;
      const result = await this.rpc.listCorpora(root);
      this.corpora.set(result.corpora);
    } catch (err) {
      this.error.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
    void this.loadSuggestions();
  }

  /**
   * Load the "Suggested boards" strip. Tolerant by design: a suggest failure
   * only clears the strip and must NEVER surface an error banner or block the
   * corpus list (which is the primary content of this panel).
   */
  private async loadSuggestions(): Promise<void> {
    this.suggestLoading.set(true);
    try {
      const root = this.appState.workspaceInfo()?.path;
      const result = await this.rpc.suggestCorpora(
        root !== undefined ? { workspaceRoot: root } : undefined,
      );
      this.suggestions.set(result.suggestions);
    } catch {
      this.suggestions.set([]);
    } finally {
      this.suggestLoading.set(false);
    }
  }

  private async runBuild(params: CorpusBuildParams): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    this.busyName.set(params.name);
    try {
      const result = await this.rpc.buildCorpus(params);
      this.info.set(
        `Built corpus '${result.corpus.name}' (${result.corpus.count} memories).`,
      );
      await this.refresh();
    } catch (err) {
      this.error.set(toErrorMessage(err));
    } finally {
      this.busyName.set(null);
    }
  }

  private async runPrime(corpus: CorpusEntry): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    this.busyName.set(corpus.name);
    try {
      const result = await this.rpc.primeCorpus(corpus.name);
      const opened = await this.routeToChat(result.sessionId);
      if (opened) {
        this.info.set(
          `Primed '${corpus.name}' — opened priming session ${result.sessionId}.`,
        );
      } else {
        this.info.set(
          `Primed '${corpus.name}' — session id ${result.sessionId}.`,
        );
      }
    } catch (err) {
      this.error.set(toErrorMessage(err));
    } finally {
      this.busyName.set(null);
    }
  }

  private async runReprime(corpus: CorpusEntry): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    this.busyName.set(corpus.name);
    try {
      const result = await this.rpc.reprimeCorpus(corpus.name);
      this.info.set(
        `Reprimed '${corpus.name}' — new session ${result.sessionId}.`,
      );
    } catch (err) {
      this.error.set(toErrorMessage(err));
    } finally {
      this.busyName.set(null);
    }
  }

  private async runRebuild(corpus: CorpusEntry): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    this.busyName.set(corpus.name);
    try {
      const result = await this.rpc.rebuildCorpus(corpus.name);
      this.info.set(
        `Rebuilt '${corpus.name}' — added ${result.added}, removed ${result.removed}.`,
      );
      await this.refresh();
    } catch (err) {
      this.error.set(toErrorMessage(err));
    } finally {
      this.busyName.set(null);
    }
  }

  private async routeToChat(rawSessionId: string): Promise<boolean> {
    if (!SessionId.validate(rawSessionId)) return false;
    const sessionId = rawSessionId as SessionId;
    if (this.chatNavigator !== null) {
      await this.chatNavigator.switchSession(sessionId);
      return true;
    }
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.CHAT_SWITCH_SESSION,
      payload: { sessionId },
    });
    return true;
  }

  private async runDelete(corpus: CorpusEntry): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    this.busyName.set(corpus.name);
    try {
      await this.rpc.deleteCorpus(corpus.name);
      this.info.set(`Deleted '${corpus.name}'.`);
      await this.refresh();
    } catch (err) {
      this.error.set(toErrorMessage(err));
    } finally {
      this.busyName.set(null);
    }
  }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown corpus error';
}
