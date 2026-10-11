import { SURFACE_ACTIVE } from '@ptah-extension/core';
import {
  inject,
  Component,
  input,
  signal,
  computed,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { fenceCodeBlock } from './code-fence';
import { CopyTextButtonComponent } from '../../atoms/copy-text-button.component';
import {
  getLanguageFromPath,
  getLanguageLabel,
} from '../../utils/tool-language.utils';
import { type ExecutionNode, isWriteToolInput } from '@ptah-extension/shared';

/** Parameter values other than the Bash command and Write content are cut here. */
const PARAM_PREVIEW_CHARS = 60;
/** Write content longer than this renders as the highlighted preview. */
const WRITE_PREVIEW_MIN_CHARS = 200;
/** Rows visible inside the collapsed Write preview (15.4em at 1.4 line height). */
const PREVIEW_ROWS = 11;
/** Approximate characters per wrapped row at the panel's width (as code-output). */
const WRAP_CHARS = 100;

let nextPreviewId = 0;

/**
 * ToolInputDisplayComponent - Display tool input parameters
 *
 * Complexity Level: 2 (Molecule with conditional expansion)
 * Patterns: Parameter list display with expand/collapse for large content
 *
 * Features:
 * - Hide input section for trivial inputs (e.g., Read tool with only file_path)
 * - Display all parameters as key-value pairs; values wrap, never scroll
 *   sideways
 * - The Bash `command` and the Write `content` are shown in full; other
 *   string parameters are cut to 60 characters
 * - Write content over 200 characters: highlighted preview with a language
 *   label and line count, height-limited with "Show all N lines" / "Show
 *   less" (Escape while expanded collapses it and refocuses the toggle) and
 *   "Copy content"
 */

interface InputParam {
  key: string;
  value: string;
  fullValue: unknown;
}

@Component({
  selector: 'ptah-tool-input-display',
  standalone: true,
  imports: [SurfaceMarkdownPipe, MarkdownModule, CopyTextButtonComponent],
  template: `
    @if (hasNonTrivialInput()) {
      <div class="mb-1.5 mt-1.5">
        <!-- Collapsible Input header -->
        <button
          type="button"
          class="flex items-center gap-1 text-[10px] font-semibold text-base-content-muted mb-0.5 hover:text-base-content transition-colors"
          [attr.aria-expanded]="!isInputCollapsed()"
          [attr.aria-controls]="inputBodyId"
          (click)="toggleInputCollapsed()"
        >
          <span
            class="inline-block transition-transform duration-200"
            [class.rotate-90]="!isInputCollapsed()"
            aria-hidden="true"
            >&#9654;</span
          >
          Input
        </button>

        @if (!isInputCollapsed()) {
          <div
            [id]="inputBodyId"
            class="bg-base-300/50 rounded text-[10px] font-mono"
          >
            @for (param of inputParams(); track param.key) {
              <div>
                @if (shouldExpandParam(param)) {
                  <!-- Write content: highlighted, height-limited preview -->
                  <div
                    class="px-2 py-1"
                    data-testid="write-preview"
                    (keydown.escape)="collapsePreviewOnEscape($event)"
                  >
                    <div class="flex flex-wrap items-center gap-1 mb-1">
                      <span class="text-primary/70">{{ param.key }}:</span>
                      <span
                        class="badge badge-ghost badge-xs text-[10px] text-base-content-muted"
                        data-testid="write-preview-language"
                        >{{ writeLanguageLabel() }}</span
                      >
                      <span
                        class="text-base-content-muted"
                        data-testid="write-preview-lines"
                        >{{ writeLineCount() }} line{{
                          writeLineCount() === 1 ? '' : 's'
                        }}</span
                      >
                      <span class="flex-1"></span>
                      @if (writePreviewCollapsible()) {
                        <button
                          #previewToggle
                          type="button"
                          class="btn btn-ghost btn-xs h-7 min-h-0 px-2 text-[10px] font-normal"
                          [attr.aria-expanded]="isContentExpanded()"
                          [attr.aria-controls]="previewId"
                          (click)="toggleContentExpanded($event)"
                        >
                          {{
                            isContentExpanded()
                              ? 'Show less'
                              : 'Show all ' + writeLineCount() + ' lines'
                          }}
                        </button>
                      }
                      <ptah-copy-text-button
                        [text]="getParamValueAsString(param)"
                        label="Copy content"
                      />
                    </div>
                    <div
                      [id]="previewId"
                      tabindex="0"
                      role="region"
                      [attr.aria-label]="writePreviewLabel()"
                      class="write-preview-block bg-base-300/50 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [class.max-h-96]="!previewClipped()"
                      [class.overflow-y-auto]="!previewClipped()"
                      [class.is-clipped]="previewClipped()"
                    >
                      <markdown
                        [data]="
                          getFormattedParamContent(param)
                            | surfaceMarkdown: surfaceActive()
                        "
                        class="tool-output-markdown prose prose-xs prose-invert max-w-none [&_pre]:my-0 [&_pre]:rounded-none [&_code]:text-[10px] [&_pre]:bg-transparent [&_p]:my-1 [&_p]:text-[10px]"
                      />
                    </div>
                  </div>
                } @else {
                  <!-- Normal param display -->
                  <div class="flex gap-2 px-2 py-1">
                    <span class="text-primary/70 shrink-0"
                      >{{ param.key }}:</span
                    >
                    <span
                      class="min-w-0 text-base-content-muted whitespace-pre-wrap break-all"
                      >{{ param.value }}</span
                    >
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    }
    <!--
      Deliberately OUTSIDE the hasNonTrivialInput() guard: a fold that preserved
      nothing leaves no parameters to show, and that is exactly the case the
      marker exists for. Real text in the document flow, readable in place by a
      screen reader.
    -->
    @if (inputRetentionMessage(); as retentionMessage) {
      <div
        class="mb-1.5 mt-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] leading-snug text-base-content-muted"
      >
        {{ retentionMessage }}
      </div>
    }
  `,
  styles: [
    `
      .write-preview-block.is-clipped {
        max-height: 15.4em;
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
      :host ::ng-deep .tool-output-markdown {
        pre {
          margin: 0;
          padding: 0.5rem;
          background: transparent !important;
        }
        pre,
        code {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        code {
          font-size: 10px;
          line-height: 1.4;
        }
        p {
          margin: 0.25rem 0;
          font-size: 10px;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolInputDisplayComponent {
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);

  readonly node = input.required<ExecutionNode>();
  readonly isInputCollapsed = signal(true);
  /** "Show all N lines" state of the Write preview; it starts height-limited. */
  readonly isContentExpanded = signal(false);

  protected readonly inputBodyId = `ptah-tool-input-${nextPreviewId}`;
  protected readonly previewId = `ptah-write-preview-${nextPreviewId++}`;

  private readonly previewToggle =
    viewChild<ElementRef<HTMLButtonElement>>('previewToggle');

  /**
   * Computed: the truncation notice for this node's INPUT, or null.
   *
   * Reads `ExecutionNode.retention`, written by `capFinalizedTree` in
   * `@ptah-extension/chat-streaming`. chat-ui is `type:feature` like that lib
   * and may import it, but the typed field in `@ptah-extension/shared` is the
   * contract between writer and reader, so this molecule needs no predicate
   * from chat-streaming.
   *
   * The copy names the recovery honestly: the bytes are in the session's SDK
   * transcript and come back when the session is reopened, and that reload is
   * itself partial. There is no per-message re-fetch to promise.
   */
  readonly inputRetentionMessage = computed((): string | null => {
    const retention = this.node().retention;
    if (!retention?.capped.includes('toolInput')) return null;

    const recovery =
      "The full text is in this session's transcript on disk — reopen the " +
      'session to reload it (a reload drops anything before the last compaction).';

    if (retention.foldFailed) {
      const reason = retention.reason ?? 'it could not be converted to text';
      return `Input could not be preserved (${reason}). ${recovery}`;
    }
    return (
      `Input truncated — ${retention.droppedChars.toLocaleString()} ` +
      `characters were dropped from this tool call to bound the transcript. ${recovery}`
    );
  });

  /**
   * All input parameters as key-value pairs. The Bash `command` and the Write
   * `content` keep their full text (R7.2, R7.7); other strings are cut.
   */
  protected readonly inputParams = computed((): InputParam[] => {
    const node = this.node();
    const toolInput = node?.toolInput;
    if (!toolInput) return [];

    return Object.entries(toolInput).map(([key, value]) => ({
      key,
      value: this.isFullTextParam(node.toolName, key)
        ? this.formatFullValue(value)
        : this.formatValue(value),
      fullValue: value,
    }));
  });

  /** The Write `content` string, or '' when this is not a Write call. */
  private readonly writeContent = computed((): string => {
    const node = this.node();
    if (node?.toolName !== 'Write') return '';
    const content = (node.toolInput as Record<string, unknown> | undefined)?.[
      'content'
    ];
    return typeof content === 'string' ? content : '';
  });

  /**
   * The Write content split into lines. Line terminators are CRLF, CR or LF;
   * a trailing terminator does not start an extra line.
   */
  private readonly writeLines = computed((): string[] =>
    this.writeContent()
      .replace(/(?:\r\n|\r|\n)$/, '')
      .split(/\r\n|\r|\n/),
  );

  protected readonly writeLineCount = computed(() => this.writeLines().length);

  protected readonly writeLanguageLabel = computed(() => {
    const toolInput = this.node()?.toolInput;
    return getLanguageLabel(
      isWriteToolInput(toolInput)
        ? getLanguageFromPath(toolInput.file_path)
        : 'text',
    );
  });

  protected readonly writePreviewLabel = computed(() => {
    const toolInput = this.node()?.toolInput;
    if (!isWriteToolInput(toolInput)) return 'Write content';
    const name = toolInput.file_path.replace(/\\/g, '/').split('/').pop();
    return name ? `Write content: ${name}` : 'Write content';
  });

  /**
   * Whether the Write preview is taller than its collapsed limit. Estimated
   * from wrapped rows (no layout measurement), the same rule as code-output
   * (decision #118), over the same lines as the line count (CRLF, CR or LF
   * terminators, so a `\r` never widens a row). A preview that is not
   * collapsible is never clipped: it keeps the `max-h-96` scroll.
   */
  protected readonly writePreviewCollapsible = computed(() => {
    let rows = 0;
    for (const line of this.writeLines()) {
      rows += Math.max(1, Math.ceil(line.length / WRAP_CHARS));
      if (rows > PREVIEW_ROWS) return true;
    }
    return false;
  });

  protected readonly previewClipped = computed(
    () => this.writePreviewCollapsible() && !this.isContentExpanded(),
  );

  /**
   * Toggle Input section collapsed state
   */
  protected toggleInputCollapsed(): void {
    this.isInputCollapsed.update((val) => !val);
  }

  /**
   * Get parameter value as string (the copied Write content)
   */
  protected getParamValueAsString(param: InputParam): string {
    return typeof param.fullValue === 'string'
      ? param.fullValue
      : String(param.fullValue);
  }

  /**
   * Check if tool has non-trivial input to display
   */
  protected hasNonTrivialInput(): boolean {
    const node = this.node();
    if (!node) return false;

    const toolInput = node.toolInput;
    if (!toolInput) return false;

    const toolName = node.toolName;
    if (toolName === 'TodoWrite') {
      return false;
    }
    if (toolName === 'Edit') {
      return false;
    }
    if (['Read'].includes(toolName || '')) {
      const keys = Object.keys(toolInput).filter((k) => k !== 'file_path');
      return keys.length > 0;
    }
    return Object.keys(toolInput).length > 0;
  }

  /**
   * Whether a parameter renders as the Write preview: the Write tool's
   * `content` when it is longer than 200 characters.
   */
  protected shouldExpandParam(param: InputParam): boolean {
    const node = this.node();
    if (!node) return false;

    const isWriteTool = node.toolName === 'Write';
    const isContentParam = param.key === 'content';
    const isLargeContent =
      typeof param.fullValue === 'string' &&
      param.fullValue.length > WRITE_PREVIEW_MIN_CHARS;

    return isWriteTool && isContentParam && isLargeContent;
  }

  /**
   * Format parameter content for markdown rendering
   * Detects language from file_path if available (for Write tool)
   */
  protected getFormattedParamContent(param: InputParam): string {
    let content =
      typeof param.fullValue === 'string'
        ? param.fullValue
        : JSON.stringify(param.fullValue, null, 2);
    content = this.stripSystemReminders(content);
    const node = this.node();
    if (param.key === 'content' && isWriteToolInput(node?.toolInput)) {
      const language = getLanguageFromPath(node.toolInput.file_path);
      if (language === 'markdown') {
        return content;
      }
      return fenceCodeBlock(content, language);
    }
    return fenceCodeBlock(content, '');
  }

  /**
   * Toggle the Write preview between height-limited and full
   */
  protected toggleContentExpanded(event: Event): void {
    event.stopPropagation(); // Prevent collapse toggle
    this.isContentExpanded.update((val) => !val);
  }

  /**
   * Escape inside the expanded Write preview (decision #120(a)): collapse it,
   * return focus to its toggle and stop the event so an enclosing expandable
   * does not also collapse. While collapsed the event is left alone.
   */
  protected collapsePreviewOnEscape(event: Event): void {
    const toggle = this.previewToggle();
    if (!this.isContentExpanded() || toggle === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.isContentExpanded.set(false);
    toggle.nativeElement.focus();
  }

  /** The Bash command and the Write content are never cut (R7.2, R7.7). */
  private isFullTextParam(toolName: string | undefined, key: string): boolean {
    return (
      (toolName === 'Bash' && key === 'command') ||
      (toolName === 'Write' && key === 'content')
    );
  }

  /**
   * Strip system-reminder tags from content
   */
  private stripSystemReminders(content: string): string {
    return content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  }

  /**
   * Format a full-text parameter value for display (no truncation)
   */
  private formatFullValue(value: unknown): string {
    return typeof value === 'string' ? value : this.formatValue(value);
  }

  /**
   * Format parameter value for display
   */
  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      return this.truncate(value, PARAM_PREVIEW_CHARS);
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  /**
   * Truncate string to max length
   */
  private truncate(str: string | undefined, maxLen: number): string {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }
}
