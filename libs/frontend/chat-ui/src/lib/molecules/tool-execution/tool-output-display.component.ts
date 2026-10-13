import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TodoListDisplayComponent } from './todo-list-display.component';
import { DiffDisplayComponent } from './diff-display.component';
import { CodeOutputComponent } from './code-output.component';
import {
  type ExecutionNode,
  isTodoWriteToolInput,
  isEditToolInput,
  isEditToolOutput,
  type TodoWriteToolInput,
  type EditToolInput,
} from '@ptah-extension/shared';
import {
  outputShowsError,
  toolOutputPlainText,
  toolRetentionMessage,
} from '../../utils/tool-text.utils';
import { detectToolLanguage } from '../../utils/tool-language.utils';

/**
 * Markdown syntax whose rendering can hide text, not only drop markers:
 * HTML (`<b>`, removed or sanitised), entities (`&lt;` renders as `<`),
 * backslash escapes, and links and images (`[label](url)` hides the URL,
 * `![alt](url)` moves the text into a non-visible `alt` attribute).
 */
const MARKDOWN_MAY_HIDE_TEXT = /[<&\\[\]]/;

/**
 * ToolOutputDisplayComponent - Output section orchestrator
 *
 * Complexity Level: 2 (Molecule orchestrator)
 * Patterns: Conditional rendering based on tool type
 *
 * Features:
 * - Route TodoWrite tool to TodoListDisplayComponent, under a "Tasks" label
 * - Route Edit tool to DiffDisplayComponent (labelled "Diff" in its own row)
 * - Route all other tools to CodeOutputComponent, which labels itself
 *   ("Result", "Content", "Matches", "Error") in its one header row
 * - No generic "Output" heading: each section is named by its content
 * - A call's `error` renders as one "Error" block (`bg-error/10`, text in
 *   `text-base-content`), left out only when the displayed output already
 *   holds the same message whole
 *
 * Routing Logic:
 * - TodoWrite → TodoListDisplayComponent (specialized task list UI)
 * - Edit → DiffDisplayComponent (VS Code-style diff visualization)
 * - All others → CodeOutputComponent (syntax-highlighted code)
 */
@Component({
  selector: 'ptah-tool-output-display',
  standalone: true,
  imports: [TodoListDisplayComponent, DiffDisplayComponent, CodeOutputComponent],
  template: `
    @if (node().toolOutput || editInput()) {
      <div>
        @if (todoInput()) {
          <div
            class="flex items-center min-h-7 text-[11px] font-medium text-base-content-muted"
          >
            Tasks
          </div>
          <ptah-todo-list-display [toolInput]="todoInput()!" />
        } @else if (editInput()) {
          <ptah-diff-display
            [toolInput]="editInput()!"
            [replacements]="editReplacements()"
          />
        } @else {
          <ptah-code-output
            [node]="node()"
            [awaitingPermission]="awaitingPermission()"
          />
        }
      </div>
    }
    <!--
      Deliberately OUTSIDE the guard above: a fold that preserved nothing
      leaves no toolOutput at all, and that is exactly the case the marker
      exists for. Real text in the document flow, so a screen reader reads it
      in place — not a title attribute and not a decorative icon.
    -->
    @if (outputRetentionMessage(); as retentionMessage) {
      <div
        class="mt-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] leading-snug text-base-content-muted"
      >
        {{ retentionMessage }}
      </div>
    }
    @if (errorMessage(); as message) {
      <div data-testid="tool-error">
        <div
          class="flex items-center min-h-7 text-[11px] font-medium text-base-content"
        >
          Error
        </div>
        <div
          class="rounded bg-error/10 px-2 py-1.5 font-mono text-[11px] leading-snug text-base-content whitespace-pre-wrap break-words"
          >{{ message }}</div
        >
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolOutputDisplayComponent {
  readonly node = input.required<ExecutionNode>();

  /**
   * A permission request for this call is waiting on the user; forwarded to
   * `ptah-code-output` so its output is not styled as a failure.
   */
  readonly awaitingPermission = input(false);

  /**
   * Computed: the truncation notice for this node's OUTPUT, or null. Reads
   * `ExecutionNode.retention` (written by `capFinalizedTree` in
   * `@ptah-extension/chat-streaming`; the typed field in
   * `@ptah-extension/shared` is the contract). Copy: `toolRetentionMessage`.
   */
  readonly outputRetentionMessage = computed((): string | null =>
    toolRetentionMessage(this.node().retention, 'toolOutput'),
  );

  /**
   * The call's error text, or null. It is left out only when the output
   * block, as displayed, already holds the same message whole
   * (`outputShowsError`); an incidental mention in the output does not count.
   * Markdown output (MCP results that use markdown syntax, `.md` content) is
   * parsed and sanitised before display. Emphasis, headings and list markers
   * drop only their markers, so the block is left out for markdown output
   * too, unless the error text holds syntax whose rendering can hide text
   * (`MARKDOWN_MAY_HIDE_TEXT`): then the output may not show the message.
   * A whitespace-only error still shows the block, with a stated fallback.
   */
  readonly errorMessage = computed((): string | null => {
    const node = this.node();
    const { error, toolOutput } = node;
    if (!error) return null;
    if (!error.trim()) return 'The tool reported an error without a message.';
    const renderingMayHideIt =
      MARKDOWN_MAY_HIDE_TEXT.test(error) &&
      detectToolLanguage(node) === 'markdown';
    const shownAsOutput =
      !this.todoInput() &&
      !this.editInput() &&
      !renderingMayHideIt &&
      outputShowsError(toolOutputPlainText(toolOutput), error);
    return shownAsOutput ? null : error;
  });

  /**
   * Computed: Get typed TodoWrite input using type guard
   * Returns null if not a TodoWrite tool or input is invalid
   */
  readonly todoInput = computed((): TodoWriteToolInput | null => {
    const node = this.node();
    if (node?.toolName !== 'TodoWrite') return null;
    if (!isTodoWriteToolInput(node.toolInput)) return null;
    return node.toolInput;
  });

  /**
   * Computed: Get typed Edit tool input using type guard
   * Returns null if not an Edit tool or input is invalid
   */
  readonly editInput = computed((): EditToolInput | null => {
    const node = this.node();
    if (node?.toolName !== 'Edit') return null;
    if (!isEditToolInput(node.toolInput)) return null;
    return node.toolInput;
  });

  /**
   * Computed: Get replacement count from Edit tool output
   */
  readonly editReplacements = computed((): number => {
    const node = this.node();
    if (node?.toolName !== 'Edit') return 0;
    if (isEditToolOutput(node.toolOutput)) {
      return node.toolOutput.replacements;
    }
    return 1; // Default to 1 if output doesn't have replacements
  });
}
