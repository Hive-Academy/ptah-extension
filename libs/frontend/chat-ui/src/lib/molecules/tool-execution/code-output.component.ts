import { SURFACE_ACTIVE } from '@ptah-extension/core';
import {
  signal,
  inject,
  Component,
  input,
  computed,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { fenceCodeBlock } from './code-fence';
import type { ExecutionNode } from '@ptah-extension/shared';
import { CopyTextButtonComponent } from '../../atoms/copy-text-button.component';
import {
  detectToolLanguage,
  getLanguageLabel,
} from '../../utils/tool-language.utils';
import { countLines } from '../../utils/tool-target.utils';
import { toolStatusPresentation } from '../../utils/tool-status.utils';
import {
  exceedsWrappedRows,
  toolOutputPlainText,
} from '../../utils/tool-text.utils';
import { TOOL_OUTPUT_MARKDOWN_STYLES } from './tool-output-markdown.styles';

/** Rows visible inside the collapsed 9.6em limit (11px text, 1.4 line height). */
const COLLAPSED_ROWS = 6;
/** Languages read as plain text: short output in them gets no label row. */
const TEXT_LANGUAGES: ReadonlySet<string> = new Set(['text', 'markdown']);

let nextBlockId = 0;

/**
 * CodeOutputComponent - Syntax-highlighted code output with content processing
 *
 * Complexity Level: 2 (Molecule with content processing pipeline)
 * Patterns: Content processing + markdown rendering
 *
 * Features:
 * - Process tool output (`toolOutputPlainText`: MCP format, system
 *   reminders, ANSI codes, line numbers)
 * - One header row, only when the block is expandable or has a non-text
 *   language: a label naming the content ("Result", "Content", "Matches",
 *   "Error"), the language label for code (`tool-language.utils`; none for
 *   plain text), the line count, the expand toggle and "Copy output". The
 *   row wraps; the actions never shrink, so they stay whole at 360 px. Short
 *   plain text has no row, only a floating "Copy output" (shown on hover /
 *   focus-within, always tabbable)
 * - Wrap content in markdown code blocks
 * - Render with ngx-markdown; the code block's own header and "Collapse"
 *   summary are hidden, so nothing repeats the label or eats the limit
 * - Height-limited to 9.6em with a fade; "Show full output" / "Show less"
 *   lifts the limit to the `max-h-96` scroll; Escape inside the expanded
 *   block collapses it and returns focus to the toggle; "Copy output" copies
 *   the stripped text
 * - A failed call's output is the error block (`bg-error/10`, text in
 *   `text-base-content`); there is no second alert for the same text
 * - Code wraps (`pre-wrap`, `overflow-wrap: anywhere`); no horizontal scroll
 *
 * Processing Pipeline:
 * 1. `toolOutputPlainText` (MCP extraction and stripping, `tool-text.utils`)
 * 2. Detect language from file extension or tool type
 * 3. Wrap in markdown code blocks for syntax highlighting
 */
@Component({
  selector: 'ptah-code-output',
  standalone: true,
  imports: [SurfaceMarkdownPipe, MarkdownModule, CopyTextButtonComponent],
  host: { '(keydown.escape)': 'collapseOnEscape($event)' },
  template: `
    <div class="relative group/output">
      @if (showHeaderRow()) {
        <div
          class="flex flex-wrap items-center gap-x-2 min-h-7 text-[11px] text-base-content-muted"
          data-testid="code-output-header"
        >
          <span
            class="font-medium shrink-0"
            [class.text-base-content]="failed()"
            data-testid="code-output-label"
            >{{ sectionLabel() }}</span
          >
          @if (showLanguageLabel()) {
            <span class="shrink-0" data-testid="code-output-language">{{
              languageLabel()
            }}</span>
          }
          <span class="shrink-0" data-testid="code-output-lines"
            >{{ lineCount() }} line{{ lineCount() === 1 ? '' : 's' }}</span
          >
          <span
            class="ml-auto flex items-center shrink-0"
            data-testid="code-output-actions"
          >
            @if (collapsible()) {
              <button
                #expandToggle
                type="button"
                class="btn btn-ghost btn-xs h-7 min-h-0 px-2 text-[11px] font-normal shrink-0"
                [attr.aria-expanded]="expanded()"
                [attr.aria-controls]="blockId"
                (click)="toggleExpanded()"
              >
                {{ expanded() ? 'Show less' : 'Show full output' }}
              </button>
            }
            <ptah-copy-text-button
              [text]="plainOutput()"
              label="Copy output"
            />
          </span>
        </div>
      } @else {
        <!-- Short plain text: no label row, only a floating Copy. Always in
             the DOM and the tab order; shown on hover or keyboard focus. -->
        <span
          class="absolute top-0 right-0 z-10 opacity-0 group-hover/output:opacity-100 group-focus-within/output:opacity-100"
          data-testid="code-output-floating-copy"
        >
          <ptah-copy-text-button [text]="plainOutput()" label="Copy output" />
        </span>
      }
      <div
        [id]="blockId"
        tabindex="0"
        role="region"
        [attr.aria-label]="blockLabel()"
        class="code-output-block rounded text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
        [class.bg-base-300/50]="!failed()"
        [class.bg-error/10]="failed()"
        [class.text-base-content]="failed()"
        [class.max-h-96]="!clipped()"
        [class.overflow-y-auto]="!clipped()"
        [class.is-clipped]="clipped()"
      >
        <markdown
          [data]="formattedOutput() | surfaceMarkdown: surfaceActive()"
          class="tool-output-markdown prose prose-xs prose-invert max-w-none"
        />
      </div>
    </div>
  `,
  styles: [
    `
      .code-output-block {
        overflow-x: hidden;
      }
      .code-output-block.is-clipped {
        max-height: 9.6em;
        overflow-y: hidden;
        -webkit-mask-image: linear-gradient(
          to bottom,
          #000 calc(100% - 2.4em),
          transparent
        );
        mask-image: linear-gradient(
          to bottom,
          #000 calc(100% - 2.4em),
          transparent
        );
      }
    `,
    TOOL_OUTPUT_MARKDOWN_STYLES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeOutputComponent {
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);

  readonly node = input.required<ExecutionNode>();

  /** Tool output as displayed (`toolOutputPlainText`). */
  readonly plainOutput = computed(() =>
    toolOutputPlainText(this.node()?.toolOutput),
  );

  /** Highlight language id, from `tool-language.utils`. */
  readonly language = computed(() => detectToolLanguage(this.node()));

  protected readonly languageLabel = computed(() =>
    getLanguageLabel(this.language()),
  );

  /**
   * The language label names a code language only. Plain text (Bash,
   * PowerShell, Grep and Glob output) gets none: "Text" adds nothing, and a
   * shell label would read as the tool's name again.
   */
  protected readonly showLanguageLabel = computed(
    () => this.language() !== 'text',
  );

  /** A permission request for this call is waiting on the user. */
  readonly awaitingPermission = input(false);

  /**
   * A failed call: its output is the error text. From
   * `toolStatusPresentation`, so a pending permission (which can arrive with
   * `status: 'error'`) is not styled as a failure, matching rail and header.
   */
  protected readonly failed = computed(
    () =>
      toolStatusPresentation(this.node().status, {
        command: false,
        awaitingPermission: this.awaitingPermission(),
      }).failed,
  );

  /** The label that names what the block holds. */
  protected readonly sectionLabel = computed(() => {
    if (this.failed()) return 'Error';
    const toolName = this.node().toolName;
    if (toolName === 'Read') return 'Content';
    if (toolName === 'Grep' || toolName === 'Glob') return 'Matches';
    return 'Result';
  });

  /** Lines in the stripped output (CRLF, CR or LF; a trailing one adds none). */
  protected readonly lineCount = computed(() => countLines(this.plainOutput()));

  /**
   * Computed formatted output
   */
  readonly formattedOutput = computed(() => {
    const str = this.plainOutput();
    if (!str) return '';

    const language = this.language();
    if (language === 'markdown') return str;
    return fenceCodeBlock(str, language);
  });

  /**
   * Whether the output is taller than the collapsed limit
   * (`exceedsWrappedRows`; estimated, so no observer per tool row). A block
   * that is not collapsible is never clipped (it keeps `max-h-96`).
   */
  protected readonly collapsible = computed(() =>
    exceedsWrappedRows(this.plainOutput(), COLLAPSED_ROWS),
  );

  /**
   * The label row shows only when it carries something: an expand toggle or
   * a code language. Markdown (an MCP or agent text result) renders as prose,
   * so it counts as text here, as Direction A labels it.
   */
  protected readonly showHeaderRow = computed(
    () => this.collapsible() || !TEXT_LANGUAGES.has(this.language()),
  );

  /** "Show full output" state; the block starts height-limited. */
  protected readonly expanded = signal(false);

  protected readonly clipped = computed(
    () => this.collapsible() && !this.expanded(),
  );

  private readonly blockNumber = nextBlockId++;
  protected readonly blockId = `ptah-code-output-${this.blockNumber}`;
  /** The region's spoken name; a failed call says so ("Bash output 3, failed"). */
  protected readonly blockLabel = computed(() => {
    const label = `${this.node().toolName || 'Tool'} output ${this.blockNumber}`;
    return this.failed() ? `${label}, failed` : label;
  });

  private readonly expandToggle =
    viewChild<ElementRef<HTMLButtonElement>>('expandToggle');

  protected toggleExpanded(): void {
    this.expanded.update((expanded) => !expanded);
  }

  /**
   * Escape inside the expanded block: collapse, return focus to the toggle and
   * stop the event so an enclosing expandable does not also collapse. While
   * collapsed the event is left alone and bubbles.
   */
  protected collapseOnEscape(event: Event): void {
    const toggle = this.expandToggle();
    if (!this.expanded() || toggle === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.expanded.set(false);
    toggle.nativeElement.focus();
  }
}
