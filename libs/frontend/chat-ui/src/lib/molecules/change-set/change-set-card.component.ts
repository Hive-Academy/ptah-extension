import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, ChevronRight, FileDiff } from 'lucide-angular';
import { FileStatusBadgeComponent } from '@ptah-extension/ui';
import type { TurnChangeSet, TurnChangeSetFile } from '@ptah-extension/shared';

/** The host the card renders in; it changes labels, not structure. */
export type ChangeSetCardHost = 'electron' | 'vscode';

/** How one file row presents. Precedence: conflicted, then reconciled. */
type ChangeSetRowState = 'changed' | 'conflicted' | 'reconciled';

interface ChangeSetRow {
  readonly file: TurnChangeSetFile;
  readonly state: ChangeSetRowState;
  /** `+N −N` text, or `?` when the count is unknown. Never a made-up zero. */
  readonly counts: string;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * The left accent follows the dominant change type (design-spec §4.1):
 * success when mostly additions, error when mostly deletions, warning when
 * mixed, neutral when the counts are unknown or empty. A border, not text.
 * Neutral is the opaque muted-text tier (`--bcm`, >= 4.5:1 on every base layer
 * in both anubis themes per base-content-muted.spec.ts), so it holds 3:1; the
 * old `--bc / 0.3` measured 2.40 dark / 1.93 light.
 */
const ACCENT = {
  additions: 'oklch(var(--su))',
  deletions: 'oklch(var(--er))',
  mixed: 'oklch(var(--wa))',
  neutral: 'oklch(var(--bcm, var(--bc)))',
} as const;

/** Share of additions at or above which a set reads as "mostly additions". */
const DOMINANT_SHARE = 0.75;

/** Sets with more files than this start collapsed. */
export const AUTO_EXPAND_MAX_FILES = 5;

/** Rows rendered per group before a "Show more" step. */
export const ROW_PAGE_SIZE = 50;

let nextBodyId = 0;

/**
 * Per-file counts as the row shows them. A binary file reads `binary` (git
 * has no line counts for it); unknown counts (the set's or the file's) read
 * `?`; a zero side is omitted unless both sides are zero.
 */
export function formatFileCounts(
  file: TurnChangeSetFile,
  countsUnavailable: boolean,
): string {
  if (file.binary === true) return 'binary';
  const { additions, deletions } = file;
  if (countsUnavailable || additions === null || deletions === null) {
    return '?';
  }
  if (additions === 0 && deletions === 0) return '+0 −0';
  const parts: string[] = [];
  if (additions > 0) parts.push(`+${additions}`);
  if (deletions > 0) parts.push(`−${deletions}`);
  return parts.join(' ');
}

/** A row's state; conflicted wins over reconciled. */
function rowState(
  path: string,
  conflicted: ReadonlySet<string>,
  reconciled: ReadonlySet<string>,
): ChangeSetRowState {
  if (conflicted.has(path)) return 'conflicted';
  if (reconciled.has(path)) return 'reconciled';
  return 'changed';
}

/** The accent colour for a set, from its header totals. */
export function changeSetAccent(changeSet: TurnChangeSet): string {
  if (changeSet.countsUnavailable) return ACCENT.neutral;
  const { additions, deletions } = changeSet.totals;
  const total = additions + deletions;
  if (total === 0) return ACCENT.neutral;
  const share = additions / total;
  if (share >= DOMINANT_SHARE) return ACCENT.additions;
  if (share <= 1 - DOMINANT_SHARE) return ACCENT.deletions;
  return ACCENT.mixed;
}

/**
 * The card a turn that changed files leaves in the transcript (TASK_2026_576
 * Requirement 4, both hosts; design-spec §4.1 and §5).
 *
 * Presentational only: the store decides which files are reconciled or
 * conflicted and the actions service decides what a click opens (diff, merge
 * editor, dock). Each actionable file row is one `<button>` with no nested
 * control; a reconciled row is plain text because there is nothing to open.
 *
 * Contrast: text uses `text-base-content` / `text-base-content-muted` and the
 * AA-measured `.diff-add-text`, `.diff-del-text` and `.err-solid-text`
 * overrides (webview `styles.css`), never an alpha `text-base-content/NN`.
 * The 9 px ghost badges use full `text-base-content`: muted measured 4.48:1
 * on the ghost fill in anubis-light. Row focus is the global 2 px
 * `button:focus-visible` outline (`--s` gold; `--ptah-gold-strong` in
 * anubis-light, both >= 3:1), drawn inset so the card never clips it.
 *
 * Narrow tiles (the chat tile squeezed by the Review dock): the header wraps
 * so Review stays on the card, and at 240 px or less each row puts
 * its path on a full-width second line, left-truncated so the file name end
 * stays visible, and drops the decorative chevron. Nothing overflows the card.
 *
 * Size: the header toggles the body. Sets of more than
 * {@link AUTO_EXPAND_MAX_FILES} files, and sets with nothing left to open,
 * start collapsed; a conflict opens the card. Reconciled rows sit in their own
 * collapsed group, and each group renders {@link ROW_PAGE_SIZE} rows per step.
 */
@Component({
  selector: 'ptah-change-set-card',
  standalone: true,
  imports: [LucideAngularModule, FileStatusBadgeComponent],
  template: `
    <section
      class="surface-2 rounded-box border-l-2 overflow-hidden text-base-content"
      [style.border-left-color]="accent()"
      [attr.aria-label]="filesLabel()"
      data-testid="change-set-card"
    >
      <div
        class="cs-pad py-1.5 px-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]"
        data-testid="change-set-header"
      >
        <button
          type="button"
          class="flex flex-1 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-left rounded focus-visible:-outline-offset-2"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="bodyId"
          data-testid="change-set-toggle"
          (click)="toggleExpanded()"
        >
          <lucide-angular
            [img]="ChevronRightIcon"
            class="w-3 h-3 shrink-0 text-base-content-muted transition-transform duration-150"
            [class.rotate-90]="expanded()"
            aria-hidden="true"
          />
          <lucide-angular
            [img]="FileDiffIcon"
            class="w-3 h-3 shrink-0 text-base-content-muted"
            aria-hidden="true"
          />
          <span
            class="font-semibold text-base-content-muted"
            data-testid="change-set-files"
            >{{ filesLabel() }}</span
          >
          @if (changeSet().countsUnavailable) {
            <span
              class="cs-badge badge badge-ghost badge-xs text-base-content"
              data-testid="change-set-counts-unavailable"
              >counts unavailable</span
            >
          } @else if (hasLineCounts()) {
            <span
              class="inline-flex flex-wrap gap-1 font-mono text-[10px]"
              data-testid="change-set-totals"
            >
              <span class="diff-add-text"
                >+{{ changeSet().totals.additions }}</span
              >
              <span class="diff-del-text"
                >−{{ changeSet().totals.deletions }}</span
              >
            </span>
          }
          @if (conflictedCount() > 0) {
            <span
              class="cs-badge badge badge-xs bg-error border-error err-solid-text"
              data-testid="change-set-conflicted-count"
              >{{ conflictedCount() }} conflicted</span
            >
          }
          @if (reconciledRows().length > 0) {
            <span
              class="cs-badge badge badge-ghost badge-xs text-base-content"
              data-testid="change-set-reconciled-summary"
              >{{ reconciledSummary() }}</span
            >
          }
        </button>
        <button
          type="button"
          class="btn btn-primary btn-xs shrink-0"
          data-testid="change-set-review"
          (click)="review.emit()"
        >
          {{ reviewLabel() }}
        </button>
      </div>

      @if (expanded()) {
        <div [id]="bodyId" data-testid="change-set-body">
          @if (changeSet().baselineMissing) {
            <p
              class="px-2 pb-1.5 text-[10px] text-base-content-muted"
              data-testid="change-set-baseline-missing"
            >
              May include changes made before this turn started.
            </p>
          }

          <ul class="border-t border-base-content/10" role="list">
            @for (row of visibleActiveRows(); track row.file.path) {
              <li>
                <button
                  type="button"
                  class="cs-pad cs-row w-full flex items-center gap-2 px-2 py-1 text-[11px] text-left text-base-content hover:bg-base-200/60 focus-visible:bg-base-300/50 focus-visible:-outline-offset-2"
                  [title]="rowTitle(row)"
                  data-testid="change-set-row"
                  (click)="openFile.emit(row.file.path)"
                >
                  <ptah-file-status-badge
                    [status]="
                      row.state === 'conflicted' ? 'U' : row.file.status
                    "
                  />
                  <span
                    class="cs-path font-mono truncate flex-1 min-w-0 text-left"
                    dir="rtl"
                    ><bdi dir="ltr"
                      >{{ row.file.path }}
                      @if (row.file.origPath) {
                        <span class="sr-only"> renamed from </span
                        ><span
                          class="text-base-content-muted"
                          aria-hidden="true"
                        >
                          ← </span
                        ><span class="text-base-content-muted">{{
                          row.file.origPath
                        }}</span>
                      }
                    </bdi></span
                  >
                  @if (row.state === 'conflicted') {
                    <span
                      class="cs-badge badge badge-xs bg-error border-error err-solid-text"
                      data-testid="change-set-row-conflicted"
                      >Conflicted</span
                    >
                  } @else {
                    <span
                      class="text-[10px] text-base-content-muted font-mono shrink-0"
                      data-testid="change-set-row-counts"
                      >{{ row.counts }}</span
                    >
                  }
                  <lucide-angular
                    [img]="ChevronRightIcon"
                    class="cs-chevron w-3 h-3 shrink-0 text-base-content-muted"
                    aria-hidden="true"
                  />
                </button>
              </li>
            }
            @if (hiddenActiveCount() > 0) {
              <li>
                <button
                  type="button"
                  class="w-full px-2 py-1 text-[10px] text-left text-base-content-muted hover:bg-base-200/60 focus-visible:-outline-offset-2"
                  data-testid="change-set-show-more"
                  (click)="showMoreActive()"
                >
                  {{ showMoreLabel(hiddenActiveCount()) }}
                </button>
              </li>
            }
            @if (changeSet().truncatedCount > 0) {
              <li
                class="px-2 py-1 text-[10px] text-base-content-muted"
                data-testid="change-set-truncated"
              >
                {{ truncatedLabel() }}
              </li>
            }
          </ul>

          @if (reconciledRows().length > 0) {
            <div class="border-t border-base-content/10">
              <button
                type="button"
                class="cs-pad w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-left text-base-content-muted hover:bg-base-200/60 focus-visible:-outline-offset-2"
                [attr.aria-expanded]="reconciledExpanded()"
                data-testid="change-set-reconciled-toggle"
                (click)="reconciledExpanded.set(!reconciledExpanded())"
              >
                <lucide-angular
                  [img]="ChevronRightIcon"
                  class="w-3 h-3 shrink-0 transition-transform duration-150"
                  [class.rotate-90]="reconciledExpanded()"
                  aria-hidden="true"
                />
                {{ reconciledToggleLabel() }}
              </button>
              @if (reconciledExpanded()) {
                <ul role="list">
                  @for (row of visibleReconciledRows(); track row.file.path) {
                    <li>
                      <!-- The path spells out truncation instead of using the
                           .truncate class: anubis-light forces full ink on
                           every .truncate (styles.css "Tab Bar Fixes"), which
                           undid the muted dimming of this inert row in light
                           only. -->
                      <div
                        class="cs-pad cs-row w-full flex items-center gap-2 px-2 py-1 text-[11px] text-base-content-muted"
                        data-testid="change-set-row-reconciled"
                      >
                        <ptah-file-status-badge [status]="row.file.status" />
                        <span
                          class="cs-path font-mono overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 text-left text-base-content-muted"
                          dir="rtl"
                          [title]="row.file.path"
                          data-testid="change-set-row-reconciled-path"
                          ><bdi dir="ltr">{{ row.file.path }}</bdi></span
                        >
                        <span
                          class="cs-badge badge badge-ghost badge-xs text-base-content"
                          >No longer changes HEAD</span
                        >
                      </div>
                    </li>
                  }
                  @if (hiddenReconciledCount() > 0) {
                    <li>
                      <button
                        type="button"
                        class="w-full px-2 py-1 text-[10px] text-left text-base-content-muted hover:bg-base-200/60 focus-visible:-outline-offset-2"
                        data-testid="change-set-show-more-reconciled"
                        (click)="showMoreReconciled()"
                      >
                        {{ showMoreLabel(hiddenReconciledCount()) }}
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>
          }

          @if (host() === 'vscode') {
            <div class="border-t border-base-content/10 px-2 py-1.5">
              <button
                type="button"
                class="btn btn-ghost btn-xs text-base-content"
                data-testid="change-set-open-scm"
                (click)="openScm.emit()"
              >
                Open Source Control
              </button>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        container-type: inline-size;
      }
      /* Narrow tile (e.g. the chat tile beside an open Review dock). */
      @container (max-width: 240px) {
        .cs-pad {
          padding-inline: 0.25rem;
        }
        .cs-row {
          flex-wrap: wrap;
          row-gap: 0.125rem;
        }
        /* Path on its own full-width line, after the status chip and meta. */
        .cs-path {
          order: 1;
          flex-basis: 100%;
        }
        .cs-chevron {
          display: none;
        }
        .cs-badge {
          max-width: 100%;
          height: auto;
          white-space: normal;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeSetCardComponent {
  readonly changeSet = input.required<TurnChangeSet>();
  readonly host = input.required<ChangeSetCardHost>();
  /** Paths whose diff against HEAD is now empty (committed or reverted). */
  readonly reconciled = input<ReadonlySet<string>>(EMPTY_SET);
  /**
   * Paths to show as conflicted: unmerged in the current status, or recorded
   * `U` when no trustworthy status exists. A recorded status is not re-read.
   */
  readonly conflicted = input<ReadonlySet<string>>(EMPTY_SET);

  /** Review the whole set: the dock on Electron, `vscode.changes` in VS Code. */
  readonly review = output<void>();
  /** Open one file's diff (or merge editor when conflicted); emits its path. */
  readonly openFile = output<string>();
  /** Open the host's source-control view (VS Code). */
  readonly openScm = output<void>();

  protected readonly FileDiffIcon = FileDiff;
  protected readonly ChevronRightIcon = ChevronRight;

  protected readonly rows = computed<readonly ChangeSetRow[]>(() => {
    const changeSet = this.changeSet();
    const reconciled = this.reconciled();
    const conflicted = this.conflicted();
    // The inputs alone decide: the store derives them from the current status
    // and falls back to the recorded `U` only when it has no trustworthy read,
    // so a conflict resolved since the turn can reconcile.
    return changeSet.files.map((file) => ({
      file,
      state: rowState(file.path, conflicted, reconciled),
      counts: formatFileCounts(file, changeSet.countsUnavailable),
    }));
  });

  protected readonly activeRows = computed(() =>
    this.rows().filter((row) => row.state !== 'reconciled'),
  );
  protected readonly reconciledRows = computed(() =>
    this.rows().filter((row) => row.state === 'reconciled'),
  );
  protected readonly conflictedCount = computed(
    () => this.rows().filter((row) => row.state === 'conflicted').length,
  );

  /** Null until the user toggles; then the user's choice wins. */
  private readonly userExpanded = signal<boolean | null>(null);
  /**
   * Small sets open, large sets and sets with nothing left to open collapse,
   * unless a conflict needs attention.
   */
  protected readonly expanded = computed(() => {
    const choice = this.userExpanded();
    if (choice !== null) return choice;
    if (this.conflictedCount() > 0) return true;
    const active = this.activeRows().length;
    return active > 0 && this.rows().length <= AUTO_EXPAND_MAX_FILES;
  });
  protected readonly reconciledExpanded = signal(false);

  private readonly activeLimit = signal(ROW_PAGE_SIZE);
  private readonly reconciledLimit = signal(ROW_PAGE_SIZE);
  protected readonly visibleActiveRows = computed(() =>
    this.activeRows().slice(0, this.activeLimit()),
  );
  protected readonly visibleReconciledRows = computed(() =>
    this.reconciledRows().slice(0, this.reconciledLimit()),
  );
  protected readonly hiddenActiveCount = computed(
    () => this.activeRows().length - this.visibleActiveRows().length,
  );
  protected readonly hiddenReconciledCount = computed(
    () => this.reconciledRows().length - this.visibleReconciledRows().length,
  );

  protected readonly bodyId = `change-set-body-${nextBodyId++}`;

  protected readonly accent = computed(() => changeSetAccent(this.changeSet()));

  /** `+0 −0` says nothing (e.g. a set whose files a commit already took). */
  protected readonly hasLineCounts = computed(() => {
    const { additions, deletions } = this.changeSet().totals;
    return additions + deletions > 0;
  });

  protected readonly reconciledSummary = computed(() => {
    const count = this.reconciledRows().length;
    return count === this.rows().length
      ? 'No longer changes HEAD'
      : `${count} no longer ${count === 1 ? 'changes' : 'change'} HEAD`;
  });

  protected readonly reconciledToggleLabel = computed(() => {
    const count = this.reconciledRows().length;
    return `${count} ${count === 1 ? 'file' : 'files'} committed or reverted since this turn`;
  });

  protected readonly filesLabel = computed(() => {
    const count = this.changeSet().totals.files;
    return `${count} ${count === 1 ? 'file' : 'files'} changed`;
  });

  protected readonly reviewLabel = computed(() =>
    this.host() === 'vscode' ? 'Review all' : 'Review',
  );

  protected readonly truncatedLabel = computed(() => {
    const count = this.changeSet().truncatedCount;
    return `${count} more ${count === 1 ? 'file' : 'files'} not listed`;
  });

  protected toggleExpanded(): void {
    this.userExpanded.set(!this.expanded());
  }

  protected showMoreActive(): void {
    this.activeLimit.update((limit) => limit + ROW_PAGE_SIZE);
  }

  protected showMoreReconciled(): void {
    this.reconciledLimit.update((limit) => limit + ROW_PAGE_SIZE);
  }

  protected showMoreLabel(hidden: number): string {
    return `Show ${Math.min(hidden, ROW_PAGE_SIZE)} more (${hidden} hidden)`;
  }

  protected rowTitle(row: ChangeSetRow): string {
    if (row.state === 'conflicted') {
      return this.host() === 'vscode'
        ? `Open ${row.file.path} in the merge editor`
        : `Resolve ${row.file.path}`;
    }
    return this.host() === 'vscode'
      ? `Open the diff of ${row.file.path} against HEAD`
      : `Show ${row.file.path} in review`;
  }
}
