import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import type { EditToolInput } from '@ptah-extension/shared';
import {
  getLanguageFromPath,
  getLanguageLabel,
} from '../../utils/tool-language.utils';

/** One rendered diff row: removed rows first, then added rows. */
interface DiffRow {
  kind: 'removed' | 'added';
  /**
   * 1-based line number within the old (removed) or new (added) snippet, not
   * within the file: the Edit input carries no file offset (decision #132).
   */
  lineNumber: number;
  text: string;
}

/**
 * Lines of an Edit string; an empty string has none. Line terminators are
 * CRLF, CR or LF, so no `\r` is left in a row's text.
 */
function splitLines(value: string | undefined): string[] {
  return value ? value.split(/\r\n|\r|\n/) : [];
}

/**
 * DiffDisplayComponent - diff view for the Edit tool
 *
 * Complexity Level: 2 (Molecule with diff formatting)
 * Patterns: signal-derived rows, OnPush
 *
 * Features:
 * - One header row: "Diff", the language label, removed and added line
 *   counts, the replacement count and the gutter caption. The file is named
 *   once, in the tool-call header (with its Open button), not again here
 * - Body: old lines then new lines, each with a line-number gutter, a sign
 *   gutter (`-` / `+` glyph named "removed" / "added") and a row tint, so
 *   colour is never the only signal
 * - Height-limited (`max-h-64`, vertical scroll); lines wrap and never scroll
 *   sideways; the block is focusable and labelled
 */
@Component({
  selector: 'ptah-diff-display',
  standalone: true,
  template: `
    <div>
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-7 text-[11px] text-base-content-muted"
      >
        <span class="font-medium" data-testid="diff-label">Diff</span>
        <span data-testid="diff-language">{{ languageLabel() }}</span>
        <span class="font-mono" data-testid="diff-counts">
          <!-- Status colour on the sign glyph only (icon contrast); the
               number is body text, so it is text-base-content -->
          <span aria-hidden="true"
            ><span class="text-error">-</span
            ><span class="text-base-content">{{ removedCount() }}</span></span
          >
          <span class="ml-1" aria-hidden="true"
            ><span class="text-success">+</span
            ><span class="text-base-content">{{ addedCount() }}</span></span
          >
          <span class="sr-only">{{ countsLabel() }}</span>
        </span>
        @if (replacements() > 0) {
          <span data-testid="diff-replacements"
            >{{ replacements() }} replacement{{
              replacements() > 1 ? 's' : ''
            }}</span
          >
        }
        <!-- Gutter numbers count within the snippet; Edit input has no file offset -->
        <span
          class="text-[11px] text-base-content-muted"
          data-testid="diff-gutter-caption"
          >Snippet lines</span
        >
      </div>

      <div
        tabindex="0"
        role="region"
        [attr.aria-label]="blockLabel()"
        class="diff-container bg-base-300/50 rounded max-h-64 overflow-y-auto font-mono text-[11px] leading-normal py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
      >
        @for (row of rows(); track $index) {
          <div
            class="diff-row flex"
            [class.bg-error/10]="row.kind === 'removed'"
            [class.bg-success/10]="row.kind === 'added'"
            [attr.data-kind]="row.kind"
          >
            <span
              class="diff-line-number shrink-0 w-8 pr-1 text-right text-base-content-muted select-none"
              aria-hidden="true"
              >{{ row.lineNumber }}</span
            >
            <span
              class="diff-sign shrink-0 w-3 text-center select-none"
              role="img"
              [class.text-error]="row.kind === 'removed'"
              [class.text-success]="row.kind === 'added'"
              [attr.aria-label]="row.kind"
              >{{ row.kind === 'removed' ? '-' : '+' }}</span
            >
            <span class="diff-code min-w-0 flex-1 pr-2">{{ row.text }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host .diff-container {
        border-left: 3px solid oklch(var(--bc) / 0.2);
      }
      :host .diff-code {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffDisplayComponent {
  readonly toolInput = input.required<EditToolInput>();
  readonly replacements = input<number>(1);

  /**
   * Get file path from tool input
   */
  readonly filePath = computed(() => this.toolInput().file_path);

  private readonly oldLines = computed(() =>
    splitLines(this.toolInput()?.old_string),
  );
  private readonly newLines = computed(() =>
    splitLines(this.toolInput()?.new_string),
  );

  readonly removedCount = computed(() => this.oldLines().length);
  readonly addedCount = computed(() => this.newLines().length);

  /** Old lines (removed) then new lines (added), the order the tool applies. */
  readonly rows = computed((): DiffRow[] => [
    ...this.oldLines().map((text, i) => ({
      kind: 'removed' as const,
      lineNumber: i + 1,
      text,
    })),
    ...this.newLines().map((text, i) => ({
      kind: 'added' as const,
      lineNumber: i + 1,
      text,
    })),
  ]);

  protected readonly languageLabel = computed(() =>
    getLanguageLabel(getLanguageFromPath(this.filePath() ?? '')),
  );

  protected readonly countsLabel = computed(() => {
    const removed = this.removedCount();
    const added = this.addedCount();
    return (
      `${removed} line${removed === 1 ? '' : 's'} removed, ` +
      `${added} line${added === 1 ? '' : 's'} added`
    );
  });

  protected readonly blockLabel = computed(() => {
    const path = (this.filePath() ?? '').replaceAll('\\', '/');
    const name = path.split('/').pop() || 'file';
    return `Diff of ${name}, line numbers count within the replaced snippet`;
  });
}
