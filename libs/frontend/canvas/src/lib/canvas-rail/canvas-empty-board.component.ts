/**
 * The canvas zero-sessions hero (TASK_2026_721 11b, design screens 02 and 02b):
 * workspace name, branch and changed files; the workspace's 90-day grid; three
 * stacked numerals (sessions, tokens, spend) as tall as the grid; the readiness
 * ring with its one link while setup is incomplete; the gold New session button
 * and the "N previous sessions" link.
 *
 * Until the store's git and usage reads settle, the staged-steps list stands in
 * for the numerals and New session stays usable. That wait is bounded
 * ({@link LOAD_STEPS_MAX_MS}): a git status that never answers (the coordinator
 * never selects this folder) must not hold the hero on its steps, so after it
 * the numerals show whatever is known and the branch line stays hidden. With
 * no usage facts and 0 confirmed sessions the grid is the Day 1 field and no
 * numerals are drawn.
 *
 * It is mounted only inside `ptah-canvas-rail-board`'s `@defer`, so it and its
 * `@ptah-extension/chat-ui/vitals` molecules load in a lazy chunk (see
 * canvas-empty-board.lazy-boundary.spec.ts). `WorkspaceVitalsStore` is
 * provided here and bound once, so its reads live as long as the hero.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  GitBranch,
  History,
  LucideAngularModule,
  Plus,
  RotateCw,
  TriangleAlert,
  X,
} from 'lucide-angular';
import { WorkspaceVitalsStore, localDayKey } from '@ptah-extension/chat';
import {
  ActivityGridComponent,
  ReadinessRingComponent,
  StagedStepsComponent,
} from '@ptah-extension/chat-ui';
// Lazy entry point: this component loads only inside the board's `@defer`.
import {
  StatCellComponent,
  StatRowComponent,
  StatValueComponent,
} from '@ptah-extension/chat-ui/vitals';
import { LoggingService, VSCodeService } from '@ptah-extension/core';
import { AuroraEffectComponent } from '@ptah-extension/ui';
import type { CanvasBoardNotice } from './canvas-rail-board.component';
import {
  previousSessionsLabel,
  toBoardGrid,
  toGitLine,
  toNumerals,
  workspaceName,
} from './canvas-empty-board.view';

const LOG_CONTEXT = 'CanvasEmptyBoard';
/**
 * Longest the staged steps stand in for the numerals. Past the store's own RPC
 * timeout (10 s), so a usage read has failed or answered by then.
 */
export const LOAD_STEPS_MAX_MS = 12_000;

@Component({
  selector: 'ptah-canvas-empty-board',
  standalone: true,
  imports: [
    LucideAngularModule,
    ActivityGridComponent,
    ReadinessRingComponent,
    StagedStepsComponent,
    StatCellComponent,
    StatRowComponent,
    StatValueComponent,
    AuroraEffectComponent,
  ],
  providers: [WorkspaceVitalsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `order-first`: the hero sits before the hidden Rail and the Sessions tab,
  // like the board's placeholder and error nodes.
  host: { class: 'order-first flex min-h-0 min-w-0 flex-1' },
  styleUrl: './canvas-empty-board.component.css',
  template: `
    <main
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
      [attr.data-glass-surface]="isElectron ? null : 'chrome'"
      data-testid="canvas-rail-empty-board"
      aria-labelledby="canvas-rail-empty-board-title"
    >
      <ptah-aurora-effect variant="board" [visible]="visible()" />
      <div
        class="ptah-empty-board__stage"
        data-testid="canvas-rail-empty-board-content"
      >
        @if (notice(); as current) {
          <div
            class="ptah-empty-board__notice surface-3 flex min-h-12 items-center gap-3 rounded-lg border border-warning px-3 py-2.5 text-sm text-base-content"
            [attr.role]="current.kind === 'cap' ? 'status' : 'alert'"
            data-testid="canvas-board-notice"
          >
            <lucide-angular
              [img]="AlertIcon"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            <span class="flex-1">{{ current.text }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              aria-label="Dismiss notice"
              (click)="noticeDismissed.emit(current.key)"
            >
              <lucide-angular
                [img]="CloseIcon"
                class="size-3.5"
                aria-hidden="true"
              />
            </button>
          </div>
        }

        <div
          class="ptah-empty-board__workspace text-base-content-muted"
          data-testid="canvas-empty-board-workspace"
        >
          <h1
            id="canvas-rail-empty-board-title"
            class="text-[15px] font-semibold text-base-content"
          >
            {{ name() }}
          </h1>
          @if (git(); as line) {
            <span class="inline-flex items-center gap-1.5">
              <lucide-angular
                [img]="BranchIcon"
                class="size-3.5"
                aria-hidden="true"
              />
              <span class="sr-only">Branch</span>
              {{ line.branch }}
            </span>
            <span>{{ line.changed }}</span>
          }
        </div>

        <div class="ptah-empty-board__zone">
          @let view = grid();
          <div
            [attr.aria-busy]="view.busy ? 'true' : null"
            data-testid="canvas-empty-board-activity"
          >
            <ptah-activity-grid
              [days]="view.days"
              [today]="view.today"
              [mode]="view.mode"
              [caption]="view.caption"
              [ariaLabel]="view.label"
            />
          </div>

          @if (!loaded()) {
            <div class="ptah-empty-board__column ptah-empty-board__steps">
              <ptah-staged-steps
                [steps]="vitals.loadSteps()"
                ariaLabel="Loading workspace"
              />
            </div>
          } @else if (numerals(); as cells) {
            <div
              class="ptah-empty-board__column ptah-empty-board__numerals"
              data-testid="canvas-empty-board-numerals"
            >
              <ptah-stat-row layout="stack">
                @for (cell of cells; track cell.label) {
                  <ptah-stat-cell [label]="cell.label" [state]="cell.state">
                    <ptah-stat-value [text]="cell.text" />
                  </ptah-stat-cell>
                }
              </ptah-stat-row>
            </div>
          }

          @let ready = readiness();
          @if (ready.unavailable) {
            <div
              class="ptah-empty-board__column items-start gap-2 text-sm text-base-content"
              role="alert"
              data-testid="canvas-empty-board-readiness-error"
            >
              <span>Readiness unavailable</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs gap-1"
                (click)="retryReadiness()"
              >
                <lucide-angular
                  [img]="RetryIcon"
                  class="size-3.5"
                  aria-hidden="true"
                />
                Retry
              </button>
            </div>
          } @else if (!ready.allReady) {
            <div
              class="ptah-empty-board__column"
              data-testid="canvas-empty-board-readiness"
            >
              <ptah-readiness-ring
                [checks]="ready.checks"
                [action]="ready.action"
                (actionRequested)="runReadinessAction($event)"
              />
            </div>
          }
        </div>

        <button
          type="button"
          class="ptah-empty-board__new btn btn-primary gap-2 rounded-full px-6"
          data-testid="canvas-hero-new-session"
          [attr.aria-disabled]="newSessionBlockReason() ? 'true' : null"
          [attr.title]="newSessionBlockReason()"
          [attr.aria-describedby]="
            newSessionBlockReason() ? 'canvas-rail-empty-board-reason' : null
          "
          (click)="requestNewSession($event)"
        >
          <lucide-angular [img]="PlusIcon" class="size-4" aria-hidden="true" />
          New session
        </button>
        @if (newSessionBlockReason(); as reason) {
          <p
            id="canvas-rail-empty-board-reason"
            class="mt-2 text-xs text-base-content-muted"
          >
            {{ reason }}
          </p>
        }
        @if (previousLabel(); as label) {
          <button
            type="button"
            class="ptah-empty-board__history text-base-content"
            data-testid="canvas-empty-board-history"
            data-previous-sessions-trigger
            (click)="previousSessionsRequested.emit()"
          >
            <lucide-angular
              [img]="HistoryIcon"
              class="size-4"
              aria-hidden="true"
            />
            {{ label }}
          </button>
        }
      </div>
    </main>
  `,
})
export class CanvasEmptyBoardComponent {
  protected readonly vitals = inject(WorkspaceVitalsStore);
  private readonly logger = inject(LoggingService);
  protected readonly isElectron = inject(VSCodeService).isElectron;

  readonly workspacePath = input.required<string>();
  /** The board is on screen (drives the non-glass aurora). */
  readonly visible = input(true);
  readonly notice = input<CanvasBoardNotice | null>(null);
  /** Why New session cannot start now (the running cap); `null` when it can. */
  readonly newSessionBlockReason = input<string | null>(null);

  /** New session was activated while allowed; carries the trigger for the popover anchor. */
  readonly newSessionRequested = output<HTMLElement>();
  readonly noticeDismissed = output<string>();
  readonly previousSessionsRequested = output<void>();

  protected readonly AlertIcon = TriangleAlert;
  protected readonly CloseIcon = X;
  protected readonly BranchIcon = GitBranch;
  protected readonly RetryIcon = RotateCw;
  protected readonly PlusIcon = Plus;
  protected readonly HistoryIcon = History;

  protected readonly name = computed(() => workspaceName(this.workspacePath()));
  protected readonly git = computed(() => toGitLine(this.vitals.git()));
  private readonly loadWaitOver = signal(false);
  protected readonly loaded = computed(
    () => this.vitals.isLoaded() || this.loadWaitOver(),
  );
  protected readonly grid = computed(() =>
    toBoardGrid(
      this.vitals.activity90(),
      this.vitals.previousSessionCount(),
      localDayKey(new Date()),
    ),
  );
  protected readonly numerals = computed(() =>
    toNumerals(this.vitals.activity90()),
  );
  protected readonly readiness = this.vitals.readiness;
  protected readonly previousLabel = computed(() =>
    previousSessionsLabel(this.vitals.previousSessionCount()),
  );

  constructor() {
    this.vitals.bind({ workspacePath: () => this.workspacePath() });
    const loadWait = setTimeout(
      () => this.loadWaitOver.set(true),
      LOAD_STEPS_MAX_MS,
    );
    inject(DestroyRef).onDestroy(() => clearTimeout(loadWait));
  }

  /**
   * The trigger stays focusable while `aria-disabled`, so its reason is still
   * read out; activating it then does nothing. A native button turns Enter
   * and Space into this click, so the guard covers the keyboard too.
   */
  protected requestNewSession(event: MouseEvent): void {
    if (this.newSessionBlockReason()) return;
    if (event.currentTarget instanceof HTMLElement) {
      this.newSessionRequested.emit(event.currentTarget);
    }
  }

  protected async runReadinessAction(id: string): Promise<void> {
    try {
      await this.vitals.runReadinessAction(id);
    } catch (error: unknown) {
      this.logger.warn(LOG_CONTEXT, 'Readiness action failed', error);
    }
  }

  protected retryReadiness(): void {
    this.vitals.retryReadiness().catch((error: unknown) => {
      this.logger.warn(LOG_CONTEXT, 'Readiness retry failed', error);
    });
  }
}
