import {
  Component,
  input,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { NgOptimizedImage, NgStyle } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import {
  LucideAngularModule,
  Copy,
  ThumbsUp,
  ThumbsDown,
  User,
} from 'lucide-angular';
import { ExecutionNodeComponent } from './execution-node.component';
import { AgentExecutionComponent } from './agent-execution.component';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { VSCodeService } from '@ptah-extension/core';

/**
 * MessageBubbleComponent - Chat message with DaisyUI styling
 *
 * Complexity Level: 2 (Organism with composition)
 * Patterns: DaisyUI chat component, Role-based rendering
 *
 * Renders user messages as right-aligned bubbles (chat-end) with rawContent.
 * Renders assistant messages as left-aligned bubbles (chat-start) with ExecutionNode tree.
 *
 * Uses DaisyUI chat classes for consistent message styling.
 */
@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  imports: [
    MarkdownModule,
    ExecutionNodeComponent,
    AgentExecutionComponent,
    LucideAngularModule,
    NgStyle,
    NgOptimizedImage,
  ],
  templateUrl: './message-bubble.component.html',
  styleUrl: './message-bubble.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBubbleComponent {
  /**
   * VS Code service for webview utilities
   */
  private readonly vscode = inject(VSCodeService);

  readonly message = input.required<ExecutionChatMessage>();

  // Lucide icons
  readonly CopyIcon = Copy;
  readonly ThumbsUpIcon = ThumbsUp;
  readonly ThumbsDownIcon = ThumbsDown;
  readonly UserIcon = User;
  readonly ptahIconUri = this.vscode.getPtahIconUri();

  protected formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  protected formatDateTime(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  /**
   * Get color for agent avatar based on agent type
   * Consistent with agent-card.component.ts colors
   */
  protected getAgentColor(agentType: string): string {
    const colors: Record<string, string> = {
      // Claude Code built-in agents
      Explore: '#22c55e', // Green - exploration/discovery
      Plan: '#a855f7', // Purple - planning
      'general-purpose': '#6366f1', // Indigo
      'claude-code-guide': '#0ea5e9', // Sky blue

      // Custom project agents
      'software-architect': '#f97316',
      'frontend-developer': '#3b82f6',
      'backend-developer': '#10b981',
      'senior-tester': '#8b5cf6',
      'code-reviewer': '#ec4899',
      'team-leader': '#6366f1',
      'project-manager': '#d97706',
      'researcher-expert': '#06b6d4',
      'ui-ux-designer': '#f59e0b',
      'business-analyst': '#f43f5e',
      'modernization-detector': '#14b8a6',
    };

    return colors[agentType] || '#717171';
  }
}
