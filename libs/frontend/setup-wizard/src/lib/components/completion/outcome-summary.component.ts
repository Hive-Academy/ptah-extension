import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  FileOutcome,
  GenerationTargetInfo,
} from '@ptah-extension/shared';

/** One processed agent file on a completion surface. */
export interface OutcomeFileRow {
  readonly id: string;
  /** File name shown under `.claude/agents/`, e.g. `tester.md`. */
  readonly fileName: string;
  readonly status: FileOutcome;
  readonly error?: string;
}

/** Counter order and labels (design-spec section 5, "outcomes"). */
const OUTCOME_LABELS: ReadonlyArray<readonly [FileOutcome, string]> = [
  ['written', 'Written'],
  ['kept', 'Kept (your file)'],
  ['unchanged', 'Already current'],
  ['changed-since-preview', 'Changed since preview (kept)'],
  ['failed', 'Failed'],
];

const OUTCOME_LABEL = new Map<FileOutcome, string>(OUTCOME_LABELS);

/**
 * Whether Library copy (diverged naming, grade copy, stale notice) applies:
 * only in Electron (VS Code has no Library, D3) and only when the agents went
 * to the root the Library reads. An unknown target shows no Library copy.
 */
export function libraryReachable(
  isElectron: boolean,
  target: GenerationTargetInfo | undefined,
): boolean {
  if (!isElectron || !target) return false;
  return target.chosen === 'harness-root' || target.openedIsHarnessRoot;
}

/**
 * C9 OutcomeSummary: five outcome counters, the per-file list and the named
 * diverged Library copies of one wizard generation run. Counters are derived
 * from the rows, so they always add up to the list. A diverged name is shown
 * only for a row this run wrote, so a kept file is never named.
 */
@Component({
  selector: 'ptah-outcome-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      [class]="
        compact() ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-5'
      "
      role="list"
      aria-label="Outcome counts"
    >
      @for (counter of counters(); track counter.status) {
        <div
          class="rounded-lg border border-base-300 bg-base-200/50 px-3 py-2 text-xs"
          role="listitem"
          [attr.data-outcome]="counter.status"
        >
          <b class="block text-base font-semibold">{{ counter.count }}</b>
          {{ counter.label }}
        </div>
      }
    </div>

    @if (openedFolderNotice()) {
      <p class="alert alert-warning mt-3 block text-xs" role="alert">
        These agents are in
        <code class="[overflow-wrap:anywhere]">{{ outputDirectory() }}</code
        >. {{ openedFolderNotice() }}
      </p>
    }

    @if (rows().length > 0) {
      <details open class="mt-3 text-sm">
        <summary class="cursor-pointer text-xs">Per-file results</summary>
        <ul class="mt-2 space-y-2">
          @for (row of rows(); track row.id) {
            <li
              class="rounded-lg border border-base-300 bg-base-200/40 px-3 py-2"
              [attr.data-status]="row.status"
            >
              <div class="flex items-center gap-2">
                <code class="grow text-xs [overflow-wrap:anywhere]"
                  >.claude/agents/{{ row.fileName }}</code
                >
                <span
                  class="badge badge-sm shrink-0"
                  [class.badge-ghost]="row.status === 'changed-since-preview'"
                  [class.badge-error]="row.status === 'failed'"
                  [class.badge-outline]="
                    row.status !== 'changed-since-preview' &&
                    row.status !== 'failed'
                  "
                  >{{ label(row.status) }}</span
                >
              </div>
              @if (note(row); as text) {
                <p class="mt-1 text-xs text-base-content-muted">{{ text }}</p>
              }
            </li>
          }
        </ul>
      </details>
    }

    @for (row of failedRows(); track row.id) {
      <div
        class="alert alert-error mt-3 block text-xs"
        role="alert"
        data-testid="outcome-failure"
      >
        <strong>Failed.</strong> .claude/agents/{{ row.fileName }}:
        {{ row.error ?? 'the write failed' }}. This file was not changed. It is
        not counted as kept or written.
      </div>
    }

    @if (divergedNames().length > 0) {
      <div
        class="alert alert-info mt-3 block text-xs"
        role="status"
        data-testid="outcome-diverged"
      >
        <strong
          >{{ divergedNames().length }} Library
          {{ divergedNames().length === 1 ? 'copy now differs' : 'copies now differ' }}
          from {{ divergedNames().length === 1 ? 'its' : 'their' }} new
          source:</strong
        >
        {{ divergedNames().join(', ') }}. Choose rebase or keep in the Library.
        <div class="mt-2">
          <button
            type="button"
            class="btn btn-outline btn-xs"
            (click)="openLibrary.emit()"
          >
            Open the Library
          </button>
        </div>
      </div>
    }
  `,
})
export class OutcomeSummaryComponent {
  public readonly rows = input.required<readonly OutcomeFileRow[]>();
  /** Agent ids whose Library copy now differs from the source this run wrote. */
  public readonly libraryDiverged = input<readonly string[]>([]);
  public readonly target = input<GenerationTargetInfo | undefined>(undefined);
  public readonly isElectron = input(true);
  /** Sidebar width: the Failed counter is hidden while it is 0. */
  public readonly compact = input(false);
  /** Absolute directory the agents were written to. */
  public readonly outputDirectory = input<string | null>(null);
  public readonly openLibrary = output<void>();

  private readonly showsLibrary = computed(() =>
    libraryReachable(this.isElectron(), this.target()),
  );

  protected readonly counters = computed(() => {
    const rows = this.rows();
    return OUTCOME_LABELS.map(([status, label]) => ({
      status,
      label,
      count: rows.filter((row) => row.status === status).length,
    })).filter(
      (counter) =>
        !(this.compact() && counter.status === 'failed' && counter.count === 0),
    );
  });

  protected readonly failedRows = computed(() =>
    this.rows().filter((row) => row.status === 'failed'),
  );

  private readonly divergedIds = computed<ReadonlySet<string>>(() => {
    if (!this.showsLibrary()) return new Set();
    const written = new Set(
      this.rows()
        .filter((row) => row.status === 'written')
        .map((row) => row.id),
    );
    return new Set(this.libraryDiverged().filter((id) => written.has(id)));
  });

  protected readonly divergedNames = computed(() => [...this.divergedIds()]);

  /** Opened-folder copy when the agents are outside the root other CLIs read. */
  protected readonly openedFolderNotice = computed<string | null>(() => {
    const target = this.target();
    if (
      !target ||
      target.chosen !== 'opened-folder' ||
      target.openedIsHarnessRoot ||
      !this.outputDirectory()
    ) {
      return null;
    }
    return this.isElectron()
      ? 'They will not reach other CLIs and will not appear in the Library.'
      : 'They will not reach other CLIs.';
  });

  protected label(status: FileOutcome): string {
    return OUTCOME_LABEL.get(status) ?? status;
  }

  protected note(row: OutcomeFileRow): string | null {
    switch (row.status) {
      case 'written':
        return this.divergedIds().has(row.id)
          ? 'You chose Replace. The Library copy now differs from its new source.'
          : null;
      case 'kept':
        return 'Kept: not regenerated (no content was generated for it).';
      case 'unchanged':
        return 'The generated content matched the file on disk.';
      case 'changed-since-preview':
        return 'The file changed after you reviewed it, so Ptah left it alone and did not regenerate it.';
      case 'failed':
        return null;
    }
  }
}
