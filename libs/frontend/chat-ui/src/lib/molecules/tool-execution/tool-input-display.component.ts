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
import {
  countLines,
  describeToolChips,
  describeToolTarget,
} from '../../utils/tool-target.utils';
import {
  exceedsWrappedRows,
  stripSystemReminders,
  toolRetentionMessage,
} from '../../utils/tool-text.utils';
import { TOOL_OUTPUT_MARKDOWN_STYLES } from './tool-output-markdown.styles';
import {
  type ExecutionNode,
  isBashToolInput,
  isWriteToolInput,
} from '@ptah-extension/shared';

/** Argument values longer than this are cut, with "more" to show the rest. */
const ARG_PREVIEW_CHARS = 120;
/** Line height of the preview text, in em (rows * this = collapsed height). */
const LINE_HEIGHT_EM = 1.4;

let nextInputId = 0;

/** The one long input of a call, shown as its own labelled block. */
interface InputPreview {
  /** The input key this block presents. */
  readonly key: string;
  readonly kind: 'command' | 'content' | 'prompt';
  /** Section label naming the content. */
  readonly label: 'Command' | 'Content' | 'Prompt';
  readonly text: string;
  /** Rows visible while height-limited. */
  readonly rows: number;
}

/** A remaining input parameter, shown as a `key  value` row. */
interface InputArg {
  readonly key: string;
  /** Full display text of the value. */
  readonly value: string;
  /** True when the value is longer than the row shows by default. */
  readonly long: boolean;
}

/**
 * ToolInputDisplayComponent - The input facts the header does not show
 *
 * Complexity Level: 2 (Molecule with conditional expansion)
 * Patterns: derived sections, expand/collapse for long content
 *
 * Features:
 * - No generic "Input" heading: each section is labelled by its content
 * - "Command": a shell command as `$ command`, mono, wrapping, with "Copy
 *   command" (the header shows the description, or the first line)
 * - "Content": the Write content, highlighted with its language label and
 *   "Copy content"; the markdown code block's own header is suppressed
 * - "Prompt": an Agent or WebFetch prompt as a muted paragraph
 * - These blocks are height-limited (6 rows for a prompt, 11 otherwise) with
 *   "Show all N lines" / "Show less"; Escape while expanded collapses the
 *   block and refocuses its toggle
 * - "Arguments": every parameter the header does not already show, neither
 *   as the target (`describeToolTarget().keys`) nor as a chip
 *   (`describeToolChips().keys`), as `key  value` rows; values wrap, and one
 *   over 120 characters is cut with "more"
 * - Nothing left to show: no section at all
 */
@Component({
  selector: 'ptah-tool-input-display',
  standalone: true,
  imports: [SurfaceMarkdownPipe, MarkdownModule, CopyTextButtonComponent],
  template: `
    @if (hasInput()) {
      <div class="space-y-1.5">
        @if (preview(); as preview) {
          <div
            data-testid="input-preview"
            [attr.data-kind]="preview.kind"
            (keydown.escape)="collapsePreviewOnEscape($event)"
          >
            <div
              class="flex items-center gap-2 min-h-7 text-[11px] text-base-content-muted"
            >
              <span class="font-medium" data-testid="input-preview-label">{{
                preview.label
              }}</span>
              @if (preview.kind === 'content') {
                <span data-testid="input-preview-language">{{
                  writeLanguageLabel()
                }}</span>
              }
              <span class="flex-1"></span>
              @if (previewCollapsible()) {
                <button
                  #previewToggle
                  type="button"
                  class="btn btn-ghost btn-xs h-7 min-h-0 px-2 text-[11px] font-normal"
                  [attr.aria-expanded]="isPreviewExpanded()"
                  [attr.aria-controls]="previewId"
                  (click)="togglePreviewExpanded()"
                >
                  {{
                    isPreviewExpanded()
                      ? 'Show less'
                      : 'Show all ' + previewLineCount() + ' lines'
                  }}
                </button>
              }
              <ptah-copy-text-button
                [text]="preview.text"
                [label]="'Copy ' + preview.label.toLowerCase()"
              />
            </div>
            <div
              [id]="previewId"
              tabindex="0"
              role="region"
              [attr.aria-label]="previewRegionLabel()"
              class="input-preview-block rounded text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              [class.bg-base-300/50]="preview.kind !== 'prompt'"
              [class.max-h-96]="!previewClipped()"
              [class.overflow-y-auto]="!previewClipped()"
              [class.is-clipped]="previewClipped()"
              [style.max-height.em]="
                previewClipped() ? previewMaxHeightEm() : null
              "
            >
              @switch (preview.kind) {
                @case ('command') {
                  <pre
                    class="m-0 p-2 bg-transparent font-mono text-[11px] leading-[1.4] text-base-content whitespace-pre-wrap break-words"
                    data-testid="input-command"
                  ><span class="text-base-content-muted select-none" aria-hidden="true">$ </span>{{ preview.text }}</pre>
                }
                @case ('content') {
                  <markdown
                    [data]="writeMarkdown() | surfaceMarkdown: surfaceActive()"
                    class="tool-output-markdown prose prose-xs prose-invert max-w-none"
                  />
                }
                @default {
                  <p
                    class="m-0 leading-[1.4] text-base-content-muted whitespace-pre-wrap break-words"
                    data-testid="input-prompt"
                  >{{ preview.text }}</p>
                }
              }
            </div>
          </div>
        }

        @if (args().length > 0) {
          <div>
            <div
              class="flex items-center min-h-7 text-[11px] font-medium text-base-content-muted"
              [id]="argsLabelId"
            >
              Arguments
            </div>
            <dl
              class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px] leading-[1.4]"
              [attr.aria-labelledby]="argsLabelId"
              data-testid="tool-input-args"
            >
              @for (arg of args(); track arg.key) {
                <dt class="text-base-content-muted" data-testid="tool-input-arg-key">
                  {{ arg.key }}
                </dt>
                <dd
                  class="m-0 min-w-0 text-base-content whitespace-pre-wrap break-words"
                  data-testid="tool-input-arg-value"
                >{{ argText(arg) }}@if (arg.long) {<button
                      type="button"
                      class="ml-1 underline text-base-content-muted hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content"
                      [attr.aria-expanded]="expandedArgs().has(arg.key)"
                      [attr.aria-label]="
                        (expandedArgs().has(arg.key) ? 'Show less of ' : 'Show all of ') + arg.key
                      "
                      (click)="toggleArg(arg.key)"
                    >{{ expandedArgs().has(arg.key) ? 'less' : 'more' }}</button>}</dd>
              }
            </dl>
          </div>
        }
      </div>
    }
    <!--
      Deliberately OUTSIDE the hasInput() guard: a fold that preserved nothing
      leaves no parameters to show, and that is exactly the case the marker
      exists for. Real text in the document flow, readable in place by a
      screen reader.
    -->
    @if (inputRetentionMessage(); as retentionMessage) {
      <div
        class="mt-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] leading-snug text-base-content-muted"
      >
        {{ retentionMessage }}
      </div>
    }
  `,
  styles: [
    `
      .input-preview-block {
        overflow-x: hidden;
      }
      .input-preview-block.is-clipped {
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
export class ToolInputDisplayComponent {
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);

  readonly node = input.required<ExecutionNode>();
  /** "Show all N lines" state of the preview; it starts height-limited. */
  readonly isPreviewExpanded = signal(false);
  /** Keys of the long argument values shown in full. */
  protected readonly expandedArgs = signal<ReadonlySet<string>>(new Set());

  private readonly idNumber = nextInputId++;
  protected readonly previewId = `ptah-tool-input-preview-${this.idNumber}`;
  protected readonly argsLabelId = `ptah-tool-input-args-${this.idNumber}`;

  private readonly previewToggle =
    viewChild<ElementRef<HTMLButtonElement>>('previewToggle');

  /**
   * Computed: the truncation notice for this node's INPUT, or null. Reads
   * `ExecutionNode.retention` (written by `capFinalizedTree` in
   * `@ptah-extension/chat-streaming`; the typed field in
   * `@ptah-extension/shared` is the contract). Copy: `toolRetentionMessage`.
   */
  readonly inputRetentionMessage = computed((): string | null =>
    toolRetentionMessage(this.node().retention, 'toolInput'),
  );

  /**
   * The call's one long input: a shell command, the Write content, or an
   * Agent / WebFetch prompt. TodoWrite and Edit render their input as the
   * output, so they have none.
   */
  protected readonly preview = computed((): InputPreview | null => {
    const toolInput = this.node().toolInput;
    if (!toolInput || this.rendersInputAsOutput()) return null;
    if (isBashToolInput(toolInput)) {
      return {
        key: 'command',
        kind: 'command',
        label: 'Command',
        text: toolInput.command,
        rows: 11,
      };
    }
    const content = this.writeContent();
    if (content) {
      return {
        key: 'content',
        kind: 'content',
        label: 'Content',
        text: content,
        rows: 11,
      };
    }
    const prompt = toolInput['prompt'];
    if (typeof prompt === 'string' && prompt) {
      return {
        key: 'prompt',
        kind: 'prompt',
        label: 'Prompt',
        text: prompt,
        rows: 6,
      };
    }
    return null;
  });

  /** The Write tool's `content` string, or '' for any other call. */
  private readonly writeContent = computed((): string => {
    const node = this.node();
    const content = node.toolInput?.['content'];
    return node.toolName === 'Write' && typeof content === 'string'
      ? content
      : '';
  });

  /**
   * Parameters shown nowhere else: not the header target, not a chip and not
   * the preview block.
   */
  protected readonly args = computed((): InputArg[] => {
    const node = this.node();
    const toolInput = node.toolInput;
    if (!toolInput || this.rendersInputAsOutput()) return [];

    const toolName = node.toolName || '';
    const shown = new Set([
      ...describeToolTarget(toolName, toolInput).keys,
      ...describeToolChips(toolName, toolInput).keys,
    ]);
    const previewKey = this.preview()?.key;
    if (previewKey) shown.add(previewKey);

    return Object.entries(toolInput)
      .filter(([key, value]) => !shown.has(key) && value !== undefined)
      .map(([key, value]) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return { key, value: text, long: text.length > ARG_PREVIEW_CHARS };
      });
  });

  protected readonly hasInput = computed(
    () => this.preview() !== null || this.args().length > 0,
  );

  /** Lines in the preview (CRLF, CR or LF; a trailing one adds none). */
  protected readonly previewLineCount = computed(() =>
    countLines(this.preview()?.text ?? ''),
  );

  /**
   * Whether the preview is taller than its collapsed limit
   * (`exceedsWrappedRows`, the same estimate as code-output). A preview that
   * is not collapsible is never clipped: it keeps the `max-h-96` scroll.
   */
  protected readonly previewCollapsible = computed(() => {
    const preview = this.preview();
    return preview !== null && exceedsWrappedRows(preview.text, preview.rows);
  });

  protected readonly previewClipped = computed(
    () => this.previewCollapsible() && !this.isPreviewExpanded(),
  );

  /** Collapsed height in em, rounded so `11 * 1.4` reads `15.4`, not `15.399…`. */
  protected readonly previewMaxHeightEm = computed(
    () => Math.round((this.preview()?.rows ?? 0) * LINE_HEIGHT_EM * 10) / 10,
  );

  protected readonly writeLanguageLabel = computed(() => {
    const toolInput = this.node().toolInput;
    return getLanguageLabel(
      isWriteToolInput(toolInput)
        ? getLanguageFromPath(toolInput.file_path)
        : 'text',
    );
  });

  /** Accessible name of the preview region ("Command", "Content: app.ts"). */
  protected readonly previewRegionLabel = computed(() => {
    const preview = this.preview();
    if (!preview) return '';
    const toolInput = this.node().toolInput;
    if (preview.kind !== 'content' || !isWriteToolInput(toolInput)) {
      return preview.label;
    }
    const name = toolInput.file_path.replaceAll('\\', '/').split('/').pop();
    return name ? `Content: ${name}` : preview.label;
  });

  /**
   * The Write content as markdown: a markdown file renders as itself, any
   * other file as a fenced block in its language; system reminders are
   * stripped.
   */
  protected readonly writeMarkdown = computed(() => {
    const content = stripSystemReminders(this.writeContent());
    if (!content) return '';
    const filePath = this.node().toolInput?.['file_path'];
    const language =
      typeof filePath === 'string' ? getLanguageFromPath(filePath) : 'text';
    return language === 'markdown'
      ? content
      : fenceCodeBlock(content, language);
  });

  /** An argument's text, cut to 120 characters unless shown in full. */
  protected argText(arg: InputArg): string {
    if (!arg.long || this.expandedArgs().has(arg.key)) return arg.value;
    return arg.value.slice(0, ARG_PREVIEW_CHARS) + '…';
  }

  protected toggleArg(key: string): void {
    this.expandedArgs.update((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected togglePreviewExpanded(): void {
    this.isPreviewExpanded.update((val) => !val);
  }

  /**
   * Escape inside the expanded preview (decision #120(a)): collapse it,
   * return focus to its toggle and stop the event so an enclosing expandable
   * does not also collapse. While collapsed the event is left alone.
   */
  protected collapsePreviewOnEscape(event: Event): void {
    const toggle = this.previewToggle();
    if (!this.isPreviewExpanded() || toggle === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.isPreviewExpanded.set(false);
    toggle.nativeElement.focus();
  }

  /** TodoWrite and Edit render their input as the output. */
  private rendersInputAsOutput(): boolean {
    const toolName = this.node().toolName;
    return toolName === 'TodoWrite' || toolName === 'Edit';
  }
}
