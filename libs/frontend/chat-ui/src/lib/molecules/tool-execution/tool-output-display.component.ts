import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TodoListDisplayComponent } from './todo-list-display.component';
import { DiffDisplayComponent } from './diff-display.component';
import { CodeOutputComponent } from './code-output.component';
import { ErrorAlertComponent } from '../../atoms/error-alert.component';
import {
  type ExecutionNode,
  isTodoWriteToolInput,
  isEditToolInput,
  isEditToolOutput,
  type TodoWriteToolInput,
  type EditToolInput,
} from '@ptah-extension/shared';

/**
 * ToolOutputDisplayComponent - Output section orchestrator
 *
 * Complexity Level: 2 (Molecule orchestrator)
 * Patterns: Conditional rendering based on tool type
 *
 * Features:
 * - Route TodoWrite tool to TodoListDisplayComponent
 * - Route Edit tool to DiffDisplayComponent (VS Code-style diff view)
 * - Route all other tools to CodeOutputComponent
 * - Display error alerts below output section
 * - Show "Output" header above content
 *
 * Routing Logic:
 * - TodoWrite → TodoListDisplayComponent (specialized task list UI)
 * - Edit → DiffDisplayComponent (VS Code-style diff visualization)
 * - All others → CodeOutputComponent (syntax-highlighted code)
 */
@Component({
  selector: 'ptah-tool-output-display',
  standalone: true,
  imports: [
    TodoListDisplayComponent,
    DiffDisplayComponent,
    CodeOutputComponent,
    ErrorAlertComponent,
  ],
  template: `
    @if (node().toolOutput || editInput()) {
      <div class="mt-1.5">
        <div class="text-[10px] font-semibold text-base-content-muted mb-0.5">
          Output
        </div>

        @if (todoInput()) {
          <ptah-todo-list-display [toolInput]="todoInput()!" />
        } @else if (editInput()) {
          <ptah-diff-display
            [toolInput]="editInput()!"
            [replacements]="editReplacements()"
          />
        } @else {
          <ptah-code-output [node]="node()" />
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
        class="mt-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] leading-snug text-base-content-muted"
      >
        {{ retentionMessage }}
      </div>
    }
    @if (node().error) {
      <ptah-error-alert [errorMessage]="node().error!" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolOutputDisplayComponent {
  readonly node = input.required<ExecutionNode>();

  /**
   * Computed: the truncation notice for this node's OUTPUT, or null.
   *
   * Reads `ExecutionNode.retention`, written by `capFinalizedTree` in
   * `@ptah-extension/chat-streaming`. The typed field is the only legal route
   * across that boundary — chat-ui is `type:ui` and cannot import a predicate
   * from a `type:feature` lib.
   *
   * The copy names the recovery honestly: the bytes are in the session's SDK
   * transcript and come back when the session is reopened, and that reload is
   * itself partial. There is no per-message re-fetch to promise.
   */
  readonly outputRetentionMessage = computed((): string | null => {
    const retention = this.node().retention;
    if (!retention?.capped.includes('toolOutput')) return null;

    const recovery =
      "The full text is in this session's transcript on disk — reopen the " +
      'session to reload it (a reload drops anything before the last compaction).';

    if (retention.foldFailed) {
      const reason = retention.reason ?? 'it could not be converted to text';
      return `Output could not be preserved (${reason}). ${recovery}`;
    }
    return (
      `Output truncated — ${retention.droppedChars.toLocaleString()} ` +
      `characters were dropped from this tool call to bound the transcript. ${recovery}`
    );
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
