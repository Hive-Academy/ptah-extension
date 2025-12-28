import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { StaticSessionProvider } from '../services/static-session.provider';

/**
 * DemoChatViewComponent - Simplified demo chat display for landing page
 *
 * This is a simplified version that renders demo chat messages without
 * depending on the complex ExecutionNodeComponent tree rendering.
 *
 * Features:
 * - User messages as right-aligned bubbles
 * - Assistant messages with markdown rendering
 * - Collapsible tool call cards
 * - Nested agent display
 * - DaisyUI styling
 */
@Component({
  selector: 'ptah-demo-chat-view',
  standalone: true,
  imports: [CommonModule, MarkdownModule],
  template: `
    <div
      class="demo-chat-container h-full overflow-y-auto p-4 space-y-4"
      style="scrollbar-width: thin; scrollbar-color: rgba(212, 175, 55, 0.4) transparent;"
    >
      @if (provider.isLoading()) {
      <div class="flex items-center justify-center h-full">
        <div class="loading loading-spinner loading-lg text-secondary"></div>
      </div>
      } @else if (provider.error()) {
      <div class="alert alert-error">
        <span>{{ provider.error() }}</span>
      </div>
      } @else { @for (message of provider.messages(); track message.id) { @if
      (message.role === 'user') {
      <!-- User Message -->
      <div class="chat chat-end">
        <div class="chat-bubble bg-primary text-primary-content">
          {{ message.rawContent }}
        </div>
      </div>
      } @else {
      <!-- Assistant Message -->
      <div class="chat chat-start">
        <div class="chat-image avatar">
          <div
            class="w-10 rounded-full bg-secondary/20 p-2 flex items-center justify-center"
          >
            <span class="text-secondary text-lg">⚒</span>
          </div>
        </div>
        <div
          class="chat-bubble bg-base-300 text-base-content w-full max-w-none"
        >
          @if (message.executionTree) {
          <!-- Render execution tree children -->
          @for (child of message.executionTree.children; track child.id) {
          @switch (child.type) { @case ('text') {
          <div class="prose prose-sm prose-invert max-w-none my-2">
            <markdown [data]="child.content || ''" />
          </div>
          } @case ('tool') {
          <!-- Tool call card -->
          <div
            class="my-2 rounded-lg bg-base-200 border border-base-300 overflow-hidden"
          >
            <div class="flex items-center gap-2 px-3 py-2 bg-base-300/50">
              <span
                class="badge badge-sm"
                [class]="getToolBadgeClass(child.toolName)"
              >
                {{ child.toolName }}
              </span>
              @if (child.toolInput) {
              <span class="text-xs text-base-content/50 truncate">
                {{ getToolInputSummary(child.toolInput) }}
              </span>
              }
            </div>
            @if (child.toolOutput) {
            <div
              class="px-3 py-2 text-xs font-mono text-base-content/70 max-h-24 overflow-hidden"
            >
              {{ truncateOutput(getToolOutput(child.toolOutput)) }}
            </div>
            }
          </div>
          } @case ('agent') {
          <!-- Agent execution card -->
          <div
            class="my-3 border-l-2 rounded-lg bg-base-200/50 overflow-hidden"
            [style.border-left-color]="getAgentColor(child.agentType)"
          >
            <div class="flex items-center gap-2 px-3 py-2">
              <div
                class="w-6 h-6 rounded-full flex items-center justify-center"
                [style.background-color]="getAgentColor(child.agentType)"
              >
                <span class="text-white text-[10px] font-bold">
                  {{ child.agentType?.charAt(0)?.toUpperCase() }}
                </span>
              </div>
              <span class="text-[11px] font-semibold text-base-content/80">
                {{ child.agentType }}
              </span>
              @if (child.agentDescription) {
              <span class="text-[10px] text-base-content/50 truncate">
                {{ child.agentDescription }}
              </span>
              }
              <span class="badge badge-xs badge-ghost ml-auto">
                {{ child.children?.length || 0 }} items
              </span>
            </div>
            <!-- Agent children -->
            <div class="px-3 pb-2 border-t border-base-300/30">
              @for (agentChild of child.children; track agentChild.id) { @if
              (agentChild.type === 'text') {
              <div class="prose prose-xs prose-invert max-w-none my-1">
                <markdown [data]="agentChild.content || ''" />
              </div>
              } @else if (agentChild.type === 'tool') {
              <div class="my-1 rounded bg-base-300/50 px-2 py-1">
                <div class="flex items-center gap-2">
                  <span
                    class="badge badge-xs"
                    [class]="getToolBadgeClass(agentChild.toolName)"
                  >
                    {{ agentChild.toolName }}
                  </span>
                  <span class="text-[10px] text-base-content/50 truncate">
                    {{ getToolInputSummary(agentChild.toolInput) }}
                  </span>
                </div>
              </div>
              } }
            </div>
          </div>
          } } } }
        </div>
      </div>
      } } }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .demo-chat-container::-webkit-scrollbar {
        width: 8px;
      }
      .demo-chat-container::-webkit-scrollbar-track {
        background: transparent;
      }
      .demo-chat-container::-webkit-scrollbar-thumb {
        background: rgba(212, 175, 55, 0.4);
        border-radius: 4px;
      }
      .demo-chat-container::-webkit-scrollbar-thumb:hover {
        background: rgba(212, 175, 55, 0.6);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoChatViewComponent implements OnInit {
  readonly provider = inject(StaticSessionProvider);

  ngOnInit(): void {
    if (this.provider.messages().length === 0 && !this.provider.isLoading()) {
      this.provider.loadSession();
    }
  }

  getToolBadgeClass(toolName?: string): string {
    const classes: Record<string, string> = {
      Read: 'badge-info',
      Write: 'badge-success',
      Bash: 'badge-warning',
      Task: 'badge-secondary',
    };
    return classes[toolName || ''] || 'badge-ghost';
  }

  getToolInputSummary(input?: Record<string, unknown>): string {
    if (!input) return '';
    if (input['file_path']) return String(input['file_path']);
    if (input['command']) return String(input['command']).slice(0, 40);
    if (input['description']) return String(input['description']);
    return '';
  }

  getToolOutput(output: unknown): string {
    if (typeof output === 'string') return output;
    if (output === null || output === undefined) return '';
    return JSON.stringify(output);
  }

  truncateOutput(output?: string): string {
    if (!output) return '';
    return output.length > 150 ? output.slice(0, 150) + '...' : output;
  }

  getAgentColor(agentType?: string): string {
    const colors: Record<string, string> = {
      'software-architect': '#f97316',
      'frontend-developer': '#3b82f6',
      'backend-developer': '#10b981',
      'senior-tester': '#8b5cf6',
      'code-reviewer': '#ec4899',
      'team-leader': '#6366f1',
      'project-manager': '#d97706',
      'researcher-expert': '#06b6d4',
      Explore: '#22c55e',
      Plan: '#a855f7',
    };
    return colors[agentType || ''] || '#717171';
  }
}
