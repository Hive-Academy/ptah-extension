import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { NativeTabGroupComponent, type NativeTab } from '@ptah-extension/ui';
import { GitDockHeaderComponent } from '../git-dock/git-dock-header.component';
import { ReviewCanvasComponent } from '../review-canvas/review-canvas.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { FileContentChangesService } from '../services/file-content-changes.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStashService } from '../services/git-stash.service';
import { GitStatusService } from '../services/git-status.service';
import {
  ReviewNavigationService,
  type ReviewTab,
} from '../services/review-navigation.service';
import { statusUnavailableLabel } from '../source-control/source-control-panel.component';
import { SpotEditorComponent } from '../spot-editor/spot-editor.component';

/** Below this shell width the file tree stacks above the diff (design-spec §6.1a). */
const STACK_BELOW_PX = 520;

/**
 * The tabs this shell has so far. Commit, Task and History join with Batches
 * 48, 50 and 56; the shell is not mounted before then (V3).
 */
const SHELL_TABS: readonly ReviewTab[] = ['changes'];

/**
 * What the spot editor exposes to the shell. Structural, so this file never
 * names `SpotEditorComponent` outside `imports` and the `@defer` block — any
 * other reference would pull the editor out of its lazy chunk.
 */
interface DiskChangeSink {
  notifyDiskChange(filePaths: readonly string[], truncated: boolean): void;
}

type BodyNotice = 'loading' | 'unavailable' | 'not-a-repo';

/**
 * ReviewShellComponent — the Electron dock body (implementation-plan
 * Component 23, design-spec §3): the git header, the conflict-banner slot and
 * the review tabs. It replaces `GitDockComponent` at cutover (Batch 58), which
 * keeps the lazy-mount contract of `electron-shell.component.ts`.
 *
 * - **Arming.** The constructor arms `GitStatusService` and
 *   `GitBranchesService` (with a branch read) and detects editor targets;
 *   destroy disarms both. Re-arming after a dock close is idempotent because
 *   `startListening()` fetches eagerly.
 * - **Stash routing.** While mounted it registers with
 *   `GitStashService.registerReviewCanvas()`, so a stash file opens here as a
 *   historical comparison; destroy releases the registration.
 * - **States (RC3).** "Loading repository…" only before anything was read; a
 *   failed read with no earlier good one says the status is unavailable,
 *   never "not a Git repository"; a failed re-read after a good one keeps the
 *   last known changes and marks them stale. A re-read never unmounts the tab
 *   body, so nothing in it loses state.
 * - **Changes tab.** The review canvas, or the spot editor when navigation
 *   targets a file (design-spec §3.3, "Back to review" returns). Both bodies
 *   are `@defer` blocks, so the canvas (and Pierre behind it) and CodeMirror
 *   stay in lazy chunks. The spot editor also opens outside a repository.
 * - **Width.** One `ResizeObserver` on the host decides `stacked` (< 520 px)
 *   for the canvas; it is disconnected on destroy.
 * - **Disk changes.** `file:content-changed` batches reach the open spot
 *   editor through {@link FileContentChangesService}.
 */
@Component({
  selector: 'ptah-review-shell',
  standalone: true,
  imports: [
    GitDockHeaderComponent,
    NativeTabGroupComponent,
    ReviewCanvasComponent,
    SpotEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full' },
  template: `
    <div class="flex h-full min-h-0 flex-col" data-testid="review-shell">
      <ptah-git-dock-header />

      <!-- Cross-cutting notices sit above the tabs (design-spec §3.2); the
           conflict banner (design-spec §11) joins this slot. -->
      @if (staleLabel(); as label) {
        <div
          role="status"
          class="flex flex-shrink-0 items-start gap-1 border-b border-l-2 border-base-content/10 border-l-warning bg-base-200 px-2 py-1.5 text-xs text-base-content"
          data-testid="review-shell-stale"
        >
          Git status is unavailable ({{ label }}) — showing the last known
          changes.
        </div>
      }

      @if (bodyNotice(); as notice) {
        <div class="flex-1 p-4 text-sm text-base-content">
          @switch (notice) {
            @case ('loading') {
              <span role="status" data-testid="review-shell-loading"
                >Loading repository…</span
              >
            }
            @case ('unavailable') {
              <!-- A failed read proves nothing about the repository: only a
                   readable result saying isGitRepo:false earns the "not a Git
                   repository" line (TASK_2026_576 RC3). -->
              <span role="status" data-testid="review-shell-status-unavailable"
                >Git status is unavailable ({{ unavailableLabel() }}).</span
              >
            }
            @default {
              <span data-testid="review-shell-not-a-repo"
                >The active workspace is not a Git repository.</span
              >
            }
          }
        </div>
      } @else {
        <ptah-native-tab-group
          class="!flex min-h-0 flex-1 flex-col [&>div:first-child>button:focus-visible]:outline [&>div:first-child>button:focus-visible]:outline-2 [&>div:first-child>button:focus-visible]:outline-offset-[-2px] [&>div:first-child>button:focus-visible]:outline-[oklch(var(--s))] [&>div:first-child]:flex-shrink-0 [&>div:first-child]:bg-base-100 [&>div:first-child]:px-2 [&>div:last-child:focus-visible]:outline [&>div:last-child:focus-visible]:outline-2 [&>div:last-child:focus-visible]:outline-offset-[-2px] [&>div:last-child:focus-visible]:outline-[oklch(var(--s))] [&>div:last-child]:flex [&>div:last-child]:min-h-0 [&>div:last-child]:flex-1 [&>div:last-child]:flex-col"
          ariaLabel="Review"
          [tabs]="tabs()"
          [activeId]="activeTab()"
          (tabSelected)="onTabSelected($event)"
        >
          <!-- The header's collapse control names this id in aria-controls;
               the changed-file tree it collapses is inside. -->
          <div
            id="git-source-control-rail"
            class="flex min-h-0 flex-1 flex-col"
          >
            @if (fileTarget(); as target) {
              @defer (on immediate) {
                <ptah-spot-editor
                  #spotEditor
                  class="min-h-0 flex-1"
                  [request]="target.request"
                  [startEditable]="target.editable === true"
                  [editorTargets]="launchers.targets()"
                  (backToReview)="onBackToReview()"
                  (openExternal)="launchers.openLinkedFile($event)"
                />
              } @placeholder {
                <p
                  class="p-4 text-xs text-base-content-muted"
                  role="status"
                  data-testid="review-shell-body-loading"
                >
                  Loading the editor…
                </p>
              } @error {
                <p
                  class="p-4 text-xs text-base-content"
                  role="alert"
                  data-testid="review-shell-body-error"
                >
                  The editor could not be loaded. Reload the window to try
                  again.
                </p>
              }
            } @else {
              @defer (on immediate) {
                <ptah-review-canvas class="flex-1" [stacked]="stacked()" />
              } @placeholder {
                <p
                  class="p-4 text-xs text-base-content-muted"
                  role="status"
                  data-testid="review-shell-body-loading"
                >
                  Loading the review…
                </p>
              } @error {
                <p
                  class="p-4 text-xs text-base-content"
                  role="alert"
                  data-testid="review-shell-body-error"
                >
                  The review could not be loaded. Reload the window to try
                  again.
                </p>
              }
            }
          </div>
        </ptah-native-tab-group>
      }
    </div>
  `,
})
export class ReviewShellComponent {
  protected readonly gitStatus = inject(GitStatusService);
  private readonly gitBranches = inject(GitBranchesService);
  private readonly navigation = inject(ReviewNavigationService);
  protected readonly launchers = inject(EditorLauncherService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  private readonly spotEditor = viewChild<DiskChangeSink>('spotEditor');

  /** The shell is narrower than {@link STACK_BELOW_PX}. */
  protected readonly stacked = signal(false);
  private resizeObserver: ResizeObserver | null = null;

  /** The spot editor target, or `null` while the canvas shows. */
  protected readonly fileTarget = computed(() => {
    const target = this.navigation.current().target;
    return target.kind === 'file' ? target : null;
  });

  protected readonly activeTab = computed(() => this.navigation.current().tab);

  protected readonly tabs = computed<readonly NativeTab[]>(() => {
    const count = this.gitStatus.isGitRepo()
      ? this.gitStatus.changedFileCount()
      : null;
    return [
      {
        id: 'changes',
        label: 'Changes',
        count,
        ...(count === null
          ? {}
          : {
              ariaLabel: `Changes, ${count} changed ${count === 1 ? 'file' : 'files'}`,
            }),
      },
    ];
  });

  /**
   * What replaces the tabs when there is no repository to review. A spot
   * editor target still opens: a linked file needs no repository.
   */
  protected readonly bodyNotice = computed<BodyNotice | null>(() => {
    if (this.gitStatus.isGitRepo() || this.fileTarget()) return null;
    if (this.gitStatus.isLoading()) return 'loading';
    return this.gitStatus.statusUnavailable() ? 'unavailable' : 'not-a-repo';
  });

  protected readonly unavailableLabel = computed(() => {
    const reason = this.gitStatus.statusUnavailable();
    return reason ? statusUnavailableLabel(reason) : '';
  });

  /** The latest read failed after a good one: the changes shown are stale. */
  protected readonly staleLabel = computed(() => {
    const reason = this.gitStatus.staleReason();
    return reason && this.gitStatus.isGitRepo()
      ? statusUnavailableLabel(reason)
      : null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    this.gitStatus.startListening();
    this.gitBranches.startListening();
    void this.gitBranches.refreshBranches();
    void this.launchers.detect();

    const releaseStash = inject(GitStashService).registerReviewCanvas();
    const releaseDiskChanges = inject(FileContentChangesService).listen(
      (change) =>
        this.spotEditor()?.notifyDiskChange(change.filePaths, change.truncated),
    );

    afterNextRender(() => this.observeWidth());

    destroyRef.onDestroy(() => {
      this.gitStatus.stopListening();
      this.gitBranches.stopListening();
      releaseStash();
      releaseDiskChanges();
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  protected onTabSelected(id: string): void {
    const tab = SHELL_TABS.find((candidate) => candidate === id);
    if (tab) this.navigation.selectTab(tab);
  }

  /**
   * Leave the spot editor. Its Back button goes away with it, so focus moves
   * to the tab panel instead of falling to the page.
   */
  protected onBackToReview(): void {
    this.navigation.backToReview();
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        this.host.nativeElement
          .querySelector<HTMLElement>('[role="tabpanel"]')
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  private observeWidth(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries.at(-1)?.contentRect.width ?? 0;
      // A hidden dock measures 0: keep the last real layout.
      if (width > 0) this.stacked.set(width < STACK_BELOW_PX);
    });
    this.resizeObserver.observe(this.host.nativeElement);
  }
}
