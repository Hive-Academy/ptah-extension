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

/** Rows visible inside the collapsed 9.6em limit (10px text, 1.4 line height). */
const COLLAPSED_ROWS = 6;
/** Approximate characters per wrapped row at the panel's width. */
const WRAP_CHARS = 100;

let nextBlockId = 0;

/**
 * CodeOutputComponent - Syntax-highlighted code output with content processing
 *
 * Complexity Level: 2 (Molecule with content processing pipeline)
 * Patterns: Content processing + markdown rendering
 *
 * Features:
 * - Process tool output (strip system reminders, line numbers, MCP format)
 * - Detect syntax highlighting language (`tool-language.utils`) and label it
 * - Wrap content in markdown code blocks
 * - Render with ngx-markdown
 * - Height-limited to 9.6em with a fade; "Show full output" / "Show less"
 *   lifts the limit to the `max-h-48` scroll; Escape inside the expanded
 *   block collapses it and returns focus to the toggle; "Copy output" copies
 *   the stripped text
 * - Code wraps (`pre-wrap`, `overflow-wrap: anywhere`); no horizontal scroll
 *
 * Processing Pipeline:
 * 1. Extract MCP content: [{type: "text", text: "..."}] → "..."
 * 2. Strip <system-reminder> tags
 * 3. Strip Claude CLI line number prefixes (   N→content)
 * 4. Detect language from file extension or tool type
 * 5. Wrap in markdown code blocks for syntax highlighting
 */
@Component({
  selector: 'ptah-code-output',
  standalone: true,
  imports: [SurfaceMarkdownPipe, MarkdownModule, CopyTextButtonComponent],
  host: { '(keydown.escape)': 'collapseOnEscape($event)' },
  template: `
    <div class="flex items-center gap-1 mb-0.5">
      <span
        class="badge badge-ghost badge-xs text-[10px] text-base-content-muted"
        data-testid="code-output-language"
        >{{ languageLabel() }}</span
      >
      <span class="flex-1"></span>
      @if (collapsible()) {
        <button
          #expandToggle
          type="button"
          class="btn btn-ghost btn-xs h-7 min-h-0 px-2 text-[10px] font-normal"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="blockId"
          (click)="toggleExpanded()"
        >
          {{ expanded() ? 'Show less' : 'Show full output' }}
        </button>
      }
      <ptah-copy-text-button [text]="plainOutput()" label="Copy output" />
    </div>
    <div
      [id]="blockId"
      tabindex="0"
      role="region"
      [attr.aria-label]="blockLabel()"
      class="code-output-block bg-base-300/50 rounded text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
      [class.max-h-48]="!clipped()"
      [class.overflow-y-auto]="!clipped()"
      [class.is-clipped]="clipped()"
    >
      <markdown
        [data]="formattedOutput() | surfaceMarkdown: surfaceActive()"
        class="tool-output-markdown prose prose-xs prose-invert max-w-none [&_pre]:my-0 [&_pre]:rounded-none [&_code]:text-[10px] [&_pre]:bg-transparent [&_p]:my-1 [&_p]:text-[10px]"
      />
    </div>
  `,
  styles: [
    `
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
export class CodeOutputComponent {
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);

  readonly node = input.required<ExecutionNode>();

  /** Tool output after MCP extraction and reminder, ANSI and `N→` stripping. */
  readonly plainOutput = computed(() => {
    const node = this.node();
    if (!node) return '';

    const output = node.toolOutput;
    if (!output) return '';

    let str =
      typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    str = this.extractMCPContent(str);
    str = this.stripSystemReminders(str);
    str = this.stripAnsiCodes(str);
    return this.stripLineNumbers(str);
  });

  /** Highlight language id, from `tool-language.utils`. */
  readonly language = computed(() => detectToolLanguage(this.node()));

  protected readonly languageLabel = computed(() =>
    getLanguageLabel(this.language()),
  );

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
   * Whether the output is taller than the collapsed limit. Estimated from
   * wrapped rows (no layout measurement, so no observer per tool row). Every
   * language wraps, so each line counts `max(1, ceil(length / WRAP_CHARS))`.
   * Line terminators are CRLF, CR or LF, so a `\r` never adds to a line's
   * length. A block that is not collapsible is never clipped (it keeps
   * `max-h-48`).
   */
  protected readonly collapsible = computed(() => {
    const lines = this.plainOutput().split(/\r\n|\r|\n/);
    let rows = 0;
    for (const line of lines) {
      rows += Math.max(1, Math.ceil(line.length / WRAP_CHARS));
      if (rows > COLLAPSED_ROWS) return true;
    }
    return false;
  });

  /** "Show full output" state; the block starts height-limited. */
  protected readonly expanded = signal(false);

  protected readonly clipped = computed(
    () => this.collapsible() && !this.expanded(),
  );

  protected readonly blockLabel = computed(
    () => `${this.node().toolName || 'Tool'} output`,
  );

  protected readonly blockId = `ptah-code-output-${nextBlockId++}`;

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

  /**
   * Strip ANSI escape codes (color/style sequences) from CLI output
   * CLI tools like nx output colored text with sequences like \x1b[32m
   * These render as garbled text in the webview if not stripped
   */
  private stripAnsiCodes(content: string): string {
    // eslint-disable-next-line no-control-regex
    return content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Strip <system-reminder> tags from content
   * Claude CLI adds these tags to tool results but they should not be displayed
   */
  private stripSystemReminders(content: string): string {
    return content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  }

  /**
   * Strip Claude CLI line number prefixes from Read tool output
   * Claude CLI formats Read output as "     N→content" where N is the line number
   * We strip these for cleaner display in the UI
   */
  private stripLineNumbers(content: string): string {
    return content
      .split('\n')
      .map((line) => {
        const match = line.match(/^\s*\d+→(.*)$/);
        return match ? match[1] : line;
      })
      .join('\n');
  }

  /**
   * Extract text content from MCP-style content blocks
   * MCP responses often come as: [{type: "text", text: "..."}]
   * This extracts just the text for cleaner display
   */
  private extractMCPContent(content: string): string {
    const trimmed = content.trim();
    if (!trimmed.startsWith('[')) return content;

    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return content;
      const isMCPContent = parsed.every(
        (item: unknown) =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          (item as { type: string }).type === 'text' &&
          'text' in item,
      );

      if (isMCPContent) {
        return parsed
          .map((item: { type: string; text: string }) => item.text)
          .join('\n');
      }

      return content;
    } catch {
      return content;
    }
  }
}
