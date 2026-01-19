import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { LucideAngularModule, Info } from 'lucide-angular';
import { InlineAgentBubbleComponent } from './inline-agent-bubble.component';
import { AgentSummaryComponent } from '../molecules/agent-summary.component';
import { ThinkingBlockComponent } from '../molecules/thinking-block.component';
import { ToolCallItemComponent } from '../molecules/tool-call-item.component';
import type {
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';

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
    InlineAgentBubbleComponent, // Required in imports even with @defer - Angular needs to know about it
    AgentSummaryComponent,
    ThinkingBlockComponent,
    ToolCallItemComponent,
  ],
  template: `
    @switch (node().type) { @case ('text') { @if (isAgentSummaryContent()) {
    <!-- Agent summary with XML-like format (function_calls, thinking, etc.) -->
    <ptah-agent-summary
      [content]="node().content || ''"
      [class.animate-pulse]="isStreaming()"
    />
    } @else {
    <!-- Always render markdown for text nodes (live updates like ChatGPT/Claude web) -->
    <div
      class="prose prose-sm prose-invert max-w-none my-2 transition-opacity duration-300"
      [class.animate-pulse]="isStreaming()"
    >
      <markdown [data]="node().content || ''" />
    </div>
    } } @case ('thinking') {
    <ptah-thinking-block [node]="node()" />
    } @case ('tool') {
    <ptah-tool-call-item
      [node]="node()"
      [permission]="getPermissionForTool()?.(node().toolCallId ?? '') ?? undefined"
      (permissionResponded)="permissionResponded.emit($event)"
    >
      <!-- RECURSIVE: Render nested children (tool results, sub-tools) -->
      @for (child of node().children; track child.id) {
      <ptah-execution-node
        [node]="child"
        [isStreaming]="isStreaming()"
        [getPermissionForTool]="getPermissionForTool()"
        (permissionResponded)="permissionResponded.emit($event)"
        (resumeRequested)="resumeRequested.emit($event)"
      />
      }
    </ptah-tool-call-item>
    } @case ('agent') {
    <!-- Use @defer to break circular dependency and lazy-load InlineAgentBubbleComponent -->
    @defer {
    <ptah-inline-agent-bubble
      [node]="node()"
      [getPermissionForTool]="getPermissionForTool()"
      (permissionResponded)="permissionResponded.emit($event)"
      (resumeRequested)="resumeRequested.emit($event)"
    />
    } @placeholder {
    <div class="flex items-center gap-2 text-[10px] text-base-content/40 py-2">
      <span>Loading agent...</span>
    </div>
    } } @case ('message') {
    <!-- Message node unwraps to its children -->
    @for (child of node().children; track child.id) {
    <ptah-execution-node
      [node]="child"
      [isStreaming]="isStreaming()"
      [getPermissionForTool]="getPermissionForTool()"
      (permissionResponded)="permissionResponded.emit($event)"
      (resumeRequested)="resumeRequested.emit($event)"
    />
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

  /**
   * Permission lookup function forwarded from parent
   * Enables tool cards to check if they have pending permissions
   */
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();

  /**
   * Emits when user responds to permission request
   * Bubbles up from tool-call-item through component tree
   */
  readonly permissionResponded = output<PermissionResponse>();

  /**
   * TASK_2025_103: Emits when user requests to resume an interrupted agent
   * Bubbles up from inline-agent-bubble through component tree to chat-view
   */
  readonly resumeRequested = output<string>(); // Emits toolCallId

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
