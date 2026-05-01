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
          <!-- TASK_2026_TREE_STABILITY Fix 5/8: animate.enter is gated to
               !isFinalizing() so the fade wave doesn't stack on top of the
               finalize layout settle. We swap to a class-driven keyframe so
               the gate can flip dynamically (animate.enter is a static dir). -->
          <div class="exec-text-branch" [class.exec-fade-in]="!isFinalizing()">
            <ptah-agent-summary [content]="node().content || ''" />
          </div>
        } @else {
          <div
            class="prose prose-sm prose-invert max-w-none my-2 exec-text-branch"
            [class.exec-fade-in]="!isFinalizing()"
          >
            <!-- TASK_2026_TREE_STABILITY Fix 6/8: bind to renderedContent()
                 so ngx-markdown only re-tokenizes when the underlying string
                 differs by content (computed memoizes on string equality). -->
            <markdown [data]="renderedContent()" />
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
                [isFinalizing]="isFinalizing()"
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
      children recursively without importing ExecutionNodeComponent.
      TASK_2026_TREE_STABILITY Fix 4/8: @defer removed. The defer block was
      re-firing on every input identity change, causing a remount of the
      agent bubble whenever the tree built a fresh node reference (which
      Fix 3 mostly eliminates, but the defer trigger remained a remount
      vector independently). InlineAgentBubbleComponent is already in the
      imports array and the cycle was already broken via nodeTemplate, so a
      direct render is safe and zoneless-stable. animate.enter is now gated
      by isFinalizing() (Fix 5) to avoid fade waves during the finalize burst.
    -->
        <div [class.exec-fade-in]="!isFinalizing()">
          <ptah-inline-agent-bubble
            [node]="node()"
            [getPermissionForTool]="getPermissionForTool()"
            [nodeTemplate]="bubbleChildTemplate"
            [isFinalizing]="isFinalizing()"
            (permissionResponded)="permissionResponded.emit($event)"
          />
        </div>
        <ng-template #bubbleChildTemplate let-child>
          <ptah-execution-node
            [node]="child"
            [isStreaming]="isStreaming()"
            [isFinalizing]="isFinalizing()"
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
              [isFinalizing]="isFinalizing()"
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
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .exec-fade-in {
        animation: execFadeIn 280ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      }

      .exec-defer-placeholder {
        min-height: 2.5rem;
        animation: execFadeIn 200ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
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
   * TASK_2026_TREE_STABILITY Fix 5/8: Whether the chat is currently in the
   * streaming → finalized transition window. When true, animate.enter is
   * suppressed via class binding so the cross-fade doesn't stack on top of
   * the layout settle (which produced the visible "flicker"). Forwarded
   * down through the recursive tree from chat-view.
   */
  readonly isFinalizing = input<boolean>(false);

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
   * TASK_2026_TREE_STABILITY Fix 6/8: Memoize markdown rendering input.
   * `<markdown [data]>` re-tokenizes whenever the bound expression returns
   * a different reference. By caching the last seen string we guarantee
   * identity stability when the content string is value-equal across
   * rebuilds — eliminating one of the per-delta flicker sources during
   * streaming. Stored on the instance so the same string reference is
   * returned on every read with an unchanged value.
   */
  private _lastRenderedContent = '';
  protected renderedContent = computed(() => {
    const next = this.node().content ?? '';
    if (next === this._lastRenderedContent) return this._lastRenderedContent;
    this._lastRenderedContent = next;
    return next;
  });

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
