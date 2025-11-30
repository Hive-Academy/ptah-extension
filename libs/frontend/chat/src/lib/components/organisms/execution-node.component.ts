import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { LucideAngularModule, Info } from 'lucide-angular';
import { AgentCardComponent } from '../molecules/agent-card.component';
import { AgentSummaryComponent } from '../molecules/agent-summary.component';
import { ThinkingBlockComponent } from '../molecules/thinking-block.component';
import { ToolCallItemComponent } from '../molecules/tool-call-item.component';
import { TypingCursorComponent } from '../atoms/typing-cursor.component';
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
    LucideAngularModule,
    AgentCardComponent,
    AgentSummaryComponent,
    ThinkingBlockComponent,
    ToolCallItemComponent,
    TypingCursorComponent,
  ],
  template: `
    @switch (node().type) { @case ('text') { @if (isAgentSummaryContent()) {
    <!-- Agent summary with XML-like format (function_calls, thinking, etc.) -->
    <ptah-agent-summary
      [content]="node().content || ''"
      [class.animate-pulse]="isStreaming()"
    />
    } @else { @if (isStreaming()) {
    <!-- DUAL-PHASE: Phase 1 - Plain text + cursor during streaming -->
    <div
      class="prose prose-sm prose-invert max-w-none my-2 whitespace-pre-wrap transition-opacity duration-300"
    >
      {{ node().content }}
      <ptah-typing-cursor colorClass="text-neutral-content/70" />
    </div>
    } @else {
    <!-- DUAL-PHASE: Phase 2 - Full markdown after completion -->
    <div
      class="prose prose-sm prose-invert max-w-none my-2 transition-opacity duration-300"
    >
      <markdown [data]="node().content || ''" />
    </div>
    } } } @case ('thinking') {
    <ptah-thinking-block [node]="node()" />
    } @case ('tool') {
    <ptah-tool-call-item [node]="node()">
      <!-- RECURSIVE: Render nested children (tool results, sub-tools) -->
      @for (child of node().children; track child.id) {
      <ptah-execution-node [node]="child" [isStreaming]="isStreaming()" />
      }
    </ptah-tool-call-item>
    } @case ('agent') {
    <ptah-agent-card [node]="node()">
      <!-- RECURSIVE: Render agent's children using AGENT's streaming status -->
      <!-- This separates agent streaming from main thread streaming -->
      @for (child of node().children; track child.id) {
      <ptah-execution-node
        [node]="child"
        [isStreaming]="node().status === 'streaming'"
      />
      }
    </ptah-agent-card>
    } @case ('message') {
    <!-- Message node unwraps to its children -->
    @for (child of node().children; track child.id) {
    <ptah-execution-node [node]="child" [isStreaming]="isStreaming()" />
    } } @case ('system') {
    <!-- System messages (session init, etc.) -->
    <div class="alert alert-info my-2 text-xs">
      <lucide-angular [img]="InfoIcon" class="w-4 h-4" />
      <span>{{ node().content }}</span>
    </div>
    } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionNodeComponent {
  readonly node = input.required<ExecutionNode>();

  /** Global streaming state passed from parent */
  readonly isStreaming = input<boolean>(false);

  // Lucide icons
  readonly InfoIcon = Info;

  /**
   * Detect if text content contains Claude's XML-like agent summary format.
   * This format includes <function_calls>, <invoke>, <thinking>, <parameter> tags.
   */
  protected isAgentSummaryContent = computed(() => {
    const content = this.node().content;
    if (!content || this.node().type !== 'text') return false;

    // Check for XML-like tags that indicate agent summary format
    return (
      content.includes('<function_calls>') ||
      content.includes('<thinking>') ||
      content.includes('<invoke name=')
    );
  });
}
