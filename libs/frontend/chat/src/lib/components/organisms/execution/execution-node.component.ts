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
import {
  AgentSummaryComponent,
  ThinkingBlockComponent,
} from '@ptah-extension/chat-ui';
import { ToolCallItemComponent } from '../../molecules/tool-execution/tool-call-item.component';
import { AutoAnimateDirective } from '../../../directives/auto-animate.directive';
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
    AutoAnimateDirective,
  ],
  template: `
    @switch (node().type) {
      @case ('text') {
        <!-- Wrap each branch in fade-in keyframe so flipping between
             agent-summary and markdown cross-fades instead of popping. -->
        @if (isAgentSummaryContent()) {
          <div class="exec-text-branch" animate.enter="exec-fade-in">
            <ptah-agent-summary [content]="node().content || ''" />
          </div>
        } @else {
          <div
            class="prose prose-sm prose-invert max-w-none my-2 exec-text-branch"
            animate.enter="exec-fade-in"
          >
            <markdown [data]="node().content || ''" />
          </div>
        }
      }
      @case ('thinking') {
        <ptah-thinking-block [node]="node()" />
      }
      @case ('tool') {
        <ptah-tool-call-item
          [node]="node()"
          [permission]="
            getPermissionForTool()?.(node().toolCallId ?? '') ?? undefined
          "
          (permissionResponded)="permissionResponded.emit($event)"
        >
          <!-- RECURSIVE: Render nested children (tool results, sub-tools) -->
          <div [auto-animate] class="exec-children">
            @for (child of node().children; track child.id) {
              <ptah-execution-node
                [node]="child"
                [isStreaming]="isStreaming()"
                [getPermissionForTool]="getPermissionForTool()"
                (permissionResponded)="permissionResponded.emit($event)"
              />
            }
          </div>
        </ptah-tool-call-item>
      }
      @case ('agent') {
        <!--
      TASK_2026_103 wave B2: pass nodeTemplate so the bubble can render its
      children recursively without importing ExecutionNodeComponent. The
      ng-template below stamps a fresh ptah-execution-node per child node,
      preserving the previous recursive behavior exactly. @defer is retained
      to keep the bubble lazy-loaded.
    -->
        @defer {
          <div animate.enter="exec-fade-in">
            <ptah-inline-agent-bubble
              [node]="node()"
              [getPermissionForTool]="getPermissionForTool()"
              [nodeTemplate]="bubbleChildTemplate"
              (permissionResponded)="permissionResponded.emit($event)"
            />
          </div>
        } @placeholder {
          <!-- Placeholder height matches the loaded bubble's collapsed
               header (~2.5rem) so the swap-in doesn't jolt siblings. -->
          <div
            class="flex items-center gap-2 text-[10px] text-base-content/40 py-2 px-3 my-3 border-l-2 border-base-300/50 rounded-lg bg-base-200/30 exec-defer-placeholder"
          >
            <span>Loading agent...</span>
          </div>
        }
        <ng-template #bubbleChildTemplate let-child>
          <ptah-execution-node
            [node]="child"
            [isStreaming]="isStreaming()"
            [getPermissionForTool]="getPermissionForTool()"
            (permissionResponded)="permissionResponded.emit($event)"
          />
        </ng-template>
      }
      @case ('message') {
        <!-- Message node unwraps to its children -->
        <div [auto-animate] class="exec-children">
          @for (child of node().children; track child.id) {
            <ptah-execution-node
              [node]="child"
              [isStreaming]="isStreaming()"
              [getPermissionForTool]="getPermissionForTool()"
              (permissionResponded)="permissionResponded.emit($event)"
            />
          }
        </div>
      }
      @case ('system') {
        <!-- System messages (session init, etc.) -->
        <div class="alert alert-info my-2 text-xs">
          <lucide-angular [img]="InfoIcon" class="w-4 h-4" />
          <span>{{ node().content }}</span>
        </div>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .exec-children {
        display: flex;
        flex-direction: column;
      }

      @keyframes execFadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .exec-fade-in {
        animation: execFadeIn 180ms ease-out both;
      }

      .exec-defer-placeholder {
        min-height: 2.5rem;
        animation: execFadeIn 140ms ease-out both;
      }

      @media (prefers-reduced-motion: reduce) {
        .exec-fade-in,
        .exec-defer-placeholder {
          animation: none !important;
        }
      }
    `,
  ],
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

  // TASK_2025_109: resumeRequested output removed - now uses context injection

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
