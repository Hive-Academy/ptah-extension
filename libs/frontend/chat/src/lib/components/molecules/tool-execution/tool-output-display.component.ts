import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  TodoListDisplayComponent,
  type TodoWriteInput,
} from './todo-list-display.component';
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
  type EditToolOutput,
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
      <div class="text-[10px] font-semibold text-base-content/50 mb-0.5">
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
    } @if (node().error) {
    <ptah-error-alert [errorMessage]="node().error!" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolOutputDisplayComponent {
  readonly node = input.required<ExecutionNode>();

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
