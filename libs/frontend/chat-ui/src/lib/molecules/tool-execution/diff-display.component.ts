import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, FileEdit, CheckCircle } from 'lucide-angular';
import { FilePathLinkComponent } from '../../atoms/file-path-link.component';
import type { EditToolInput } from '@ptah-extension/shared';
import {
  getLanguageFromPath,
  getLanguageLabel,
} from '../../utils/tool-language.utils';

/** One rendered diff row: removed rows first, then added rows. */
interface DiffRow {
  kind: 'removed' | 'added';
  /** 1-based line number within the old (removed) or new (added) text. */
  lineNumber: number;
  text: string;
}

/** Lines of an Edit string; an empty string has none. */
function splitLines(value: string | undefined): string[] {
  return value ? value.split('\n') : [];
}

/**
 * DiffDisplayComponent - diff view for the Edit tool
 *
 * Complexity Level: 2 (Molecule with diff formatting)
 * Patterns: signal-derived rows, OnPush
 *
 * Features:
 * - Header: file path link (opens through `FILE_LINK_OPENER`), language label,
 *   removed and added line counts, replacement count badge
 * - Body: old lines then new lines, each with a line-number gutter, a sign
 *   gutter (`-` / `+` glyph named "removed" / "added") and a row tint, so
 *   colour is never the only signal
 * - Height-limited (`max-h-64`, vertical scroll); lines wrap and never scroll
 *   sideways; the block is focusable and labelled
 */
@Component({
  selector: 'ptah-diff-display',
  standalone: true,
  imports: [LucideAngularModule, FilePathLinkComponent],
  template: `
    <div class="mt-1.5">
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-base-content-muted mb-1"
      >
        <lucide-angular
          [img]="FileEditIcon"
          class="w-3 h-3"
          aria-hidden="true"
        />
        <ptah-file-path-link [fullPath]="filePath()" />
        <span
          class="badge badge-ghost badge-xs text-[10px]"
          data-testid="diff-language"
          >{{ languageLabel() }}</span
        >
        <span class="font-mono" data-testid="diff-counts">
          <span class="text-error" aria-hidden="true"
            >-{{ removedCount() }}</span
          >
          <span class="text-success ml-1" aria-hidden="true"
            >+{{ addedCount() }}</span
          >
          <span class="sr-only">{{ countsLabel() }}</span>
        </span>
        @if (replacements() > 0) {
          <span class="badge badge-xs badge-success gap-0.5">
            <lucide-angular
              [img]="CheckCircleIcon"
              class="w-2.5 h-2.5"
              aria-hidden="true"
            />
            {{ replacements() }} replacement{{ replacements() > 1 ? 's' : '' }}
          </span>
        }
      </div>

      <div
        tabindex="0"
        role="region"
        [attr.aria-label]="blockLabel()"
        class="diff-container bg-base-300/50 rounded max-h-64 overflow-y-auto font-mono text-[10px] leading-normal py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
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

  readonly FileEditIcon = FileEdit;
  readonly CheckCircleIcon = CheckCircle;

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
    const path = (this.filePath() ?? '').replace(/\\/g, '/');
    const name = path.split('/').pop() || 'file';
    return `Diff of ${name}`;
  });
}
