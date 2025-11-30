import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TodoListDisplayComponent, type TodoWriteInput } from './todo-list-display.component';
import { CodeOutputComponent } from './code-output.component';
import { ErrorAlertComponent } from '../atoms/error-alert.component';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * ToolOutputDisplayComponent - Output section orchestrator
 *
 * Complexity Level: 2 (Molecule orchestrator)
 * Patterns: Conditional rendering based on tool type
 *
 * Features:
 * - Route TodoWrite tool to TodoListDisplayComponent
 * - Route all other tools to CodeOutputComponent
 * - Display error alerts below output section
 * - Show "Output" header above content
 *
 * Routing Logic:
 * - TodoWrite → TodoListDisplayComponent (specialized task list UI)
 * - All others → CodeOutputComponent (syntax-highlighted code)
 */
@Component({
  selector: 'ptah-tool-output-display',
  standalone: true,
  imports: [TodoListDisplayComponent, CodeOutputComponent, ErrorAlertComponent],
  template: `
    @if (node().toolOutput) {
    <div class="mt-1.5">
      <div class="text-[10px] font-semibold text-base-content/50 mb-0.5">Output</div>

      @if (isTodoWriteTool() && node().toolInput) {
      <ptah-todo-list-display [toolInput]="getTodoInput()" />
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
   * Computed: Detect TodoWrite tool
   * TodoWrite gets specialized rendering with task list UI
   */
  readonly isTodoWriteTool = computed(() => this.node().toolName === 'TodoWrite');

  /**
   * Get properly typed TodoWrite input
   */
  getTodoInput(): TodoWriteInput {
    return this.node().toolInput as unknown as TodoWriteInput;
  }
}
