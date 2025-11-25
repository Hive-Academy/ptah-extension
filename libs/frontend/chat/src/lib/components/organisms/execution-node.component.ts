import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { AgentCardComponent } from '../molecules/agent-card.component';
import { ThinkingBlockComponent } from '../molecules/thinking-block.component';
import { ToolCallItemComponent } from '../molecules/tool-call-item.component';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * ExecutionNodeComponent - THE KEY RECURSIVE COMPONENT
 *
 * Complexity Level: 3 (Complex recursive organism)
 * Patterns: Recursive composition, Discriminated union rendering
 *
 * This is the revolutionary component that enables nested agent visualization.
 * It recursively renders ExecutionNode trees of ANY depth:
 * - Agents INSIDE agents
 * - Tools INSIDE agents
 * - Results INSIDE tools
 *
 * The @switch directive discriminates on node.type and renders appropriate
 * child components, which may recursively render more ExecutionNodeComponents.
 *
 * This creates the visual nesting that mirrors Claude CLI terminal output,
 * something NO other VS Code extension can do.
 */
@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  imports: [
    MarkdownModule,
    AgentCardComponent,
    ThinkingBlockComponent,
    ToolCallItemComponent,
  ],
  template: `
    @switch (node().type) { @case ('text') {
    <div class="prose prose-sm prose-invert max-w-none my-2">
      <markdown [data]="node().content || ''" />
    </div>
    } @case ('thinking') {
    <ptah-thinking-block [node]="node()" />
    } @case ('tool') {
    <ptah-tool-call-item [node]="node()">
      <!-- RECURSIVE: Render nested children (tool results, sub-tools) -->
      @for (child of node().children; track child.id) {
      <ptah-execution-node [node]="child" />
      }
    </ptah-tool-call-item>
    } @case ('agent') {
    <ptah-agent-card [node]="node()">
      <!-- RECURSIVE: Render agent's children (tools, nested agents) -->
      @for (child of node().children; track child.id) {
      <ptah-execution-node [node]="child" />
      }
    </ptah-agent-card>
    } @case ('message') {
    <!-- Message node unwraps to its children -->
    @for (child of node().children; track child.id) {
    <ptah-execution-node [node]="child" />
    } } @case ('system') {
    <!-- System messages (session init, etc.) -->
    <div class="alert alert-info my-2 text-xs">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <span>{{ node().content }}</span>
    </div>
    } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionNodeComponent {
  readonly node = input.required<ExecutionNode>();
}
