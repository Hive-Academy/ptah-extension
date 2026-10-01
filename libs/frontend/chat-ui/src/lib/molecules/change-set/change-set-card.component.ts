import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
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
 */
const ACCENT = {
  additions: 'oklch(var(--su))',
  deletions: 'oklch(var(--er))',
  mixed: 'oklch(var(--wa))',
  neutral: 'oklch(var(--bc) / 0.3)',
} as const;

/** Share of additions at or above which a set reads as "mostly additions". */
const DOMINANT_SHARE = 0.75;

/**
 * Per-file counts as the row shows them. Unknown counts (the set's or the
 * file's) read `?`; a zero side is omitted unless both sides are zero.
 */
export function formatFileCounts(
  file: TurnChangeSetFile,
  countsUnavailable: boolean,
): string {
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
 */
@Component({
  selector: 'ptah-change-set-card',
  standalone: true,
  imports: [LucideAngularModule, FileStatusBadgeComponent],
  template: `
    <section
      class="bg-base-300/30 rounded border-l-2 max-w-md text-base-content"
      [style.border-left-color]="accent()"
      [attr.aria-label]="filesLabel()"
      data-testid="change-set-card"
    >
      <div class="py-1.5 px-2 flex items-center gap-1.5 text-[11px]">
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
            class="badge badge-ghost badge-xs text-base-content-muted"
            data-testid="change-set-counts-unavailable"
            >counts unavailable</span
          >
        } @else {
          <span
            class="inline-flex gap-1 font-mono text-[10px]"
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
        <span class="ml-auto"></span>
        <button
          type="button"
          class="btn btn-primary btn-xs"
          data-testid="change-set-review"
          (click)="review.emit()"
        >
          {{ reviewLabel() }}
        </button>
      </div>

      @if (changeSet().baselineMissing) {
        <p
          class="px-2 pb-1.5 text-[10px] text-base-content-muted"
          data-testid="change-set-baseline-missing"
        >
          May include changes made before this turn started.
        </p>
      }

      <ul class="border-t border-base-300/30" role="list">
        @for (row of rows(); track row.file.path) {
          <li>
            @if (row.state === 'reconciled') {
              <div
                class="w-full flex items-center gap-2 px-2 py-1 text-[11px] text-base-content-muted"
                data-testid="change-set-row-reconciled"
              >
                <ptah-file-status-badge [status]="row.file.status" />
                <span
                  class="font-mono truncate flex-1 min-w-0 text-left"
                  dir="rtl"
                  [title]="row.file.path"
                  ><bdi dir="ltr">{{ row.file.path }}</bdi></span
                >
                <span class="badge badge-ghost badge-xs text-base-content-muted"
                  >No longer changes HEAD</span
                >
              </div>
            } @else {
              <button
                type="button"
                class="w-full flex items-center gap-2 px-2 py-1 text-[11px] text-left text-base-content hover:bg-base-300/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
                [title]="rowTitle(row)"
                data-testid="change-set-row"
                (click)="openFile.emit(row.file.path)"
              >
                <ptah-file-status-badge
                  [status]="row.state === 'conflicted' ? 'U' : row.file.status"
                />
                <span
                  class="font-mono truncate flex-1 min-w-0 text-left"
                  dir="rtl"
                  ><bdi dir="ltr"
                    >{{ row.file.path }}
                    @if (row.file.origPath) {
                      <span class="sr-only"> renamed from </span
                      ><span class="text-base-content-muted" aria-hidden="true">
                        ← </span
                      ><span class="text-base-content-muted">{{
                        row.file.origPath
                      }}</span>
                    }
                  </bdi></span
                >
                @if (row.state === 'conflicted') {
                  <span
                    class="badge badge-xs bg-error border-error err-solid-text"
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
                  class="w-3 h-3 shrink-0 text-base-content-muted"
                  aria-hidden="true"
                />
              </button>
            }
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

      @if (host() === 'vscode') {
        <div class="border-t border-base-300/30 px-2 py-1.5">
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
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeSetCardComponent {
  readonly changeSet = input.required<TurnChangeSet>();
  readonly host = input.required<ChangeSetCardHost>();
  /** Paths whose diff against HEAD is now empty (committed or reverted). */
  readonly reconciled = input<ReadonlySet<string>>(EMPTY_SET);
  /** Paths git currently reports as unmerged. */
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
    return changeSet.files.map((file) => ({
      file,
      state:
        conflicted.has(file.path) || file.status === 'U'
          ? 'conflicted'
          : reconciled.has(file.path)
            ? 'reconciled'
            : 'changed',
      counts: formatFileCounts(file, changeSet.countsUnavailable),
    }));
  });

  protected readonly accent = computed(() => changeSetAccent(this.changeSet()));

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
