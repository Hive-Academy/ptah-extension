import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface AgentActivity {
  agentId: string;
  name: string;
  status: 'running' | 'completed';
  startTime: number;
  endTime?: number;
  activity?: string;
  result?: string;
}

@Component({
  selector: 'ptah-agent-activity-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (agents().length > 0) {
    <div class="agent-timeline">
      <div class="timeline-header">
        <span class="header-icon">🤖</span>
        <span class="header-text">Agent Activity</span>
      </div>

      @for (agent of agents(); track agent.agentId) {
      <div [class]="'agent-item status-' + agent.status">
        <div class="agent-header">
          <span class="agent-name">{{ agent.name }}</span>
          <span [class]="'agent-status badge-' + agent.status">
            {{ agent.status === 'running' ? '⏳ Running' : '✅ Completed' }}
          </span>
        </div>

        @if (agent.activity) {
        <div class="agent-activity">{{ agent.activity }}</div>
        } @if (agent.result) {
        <div class="agent-result">
          <strong>Result:</strong> {{ agent.result }}
        </div>
        }

        <div class="agent-timing">
          Started: {{ formatTimestamp(agent.startTime) }}
          @if (agent.endTime) {
          <span>
            • Duration:
            {{ calculateDuration(agent.startTime, agent.endTime) }}</span
          >
          }
        </div>
      </div>
      }
    </div>
    }
  `,
  styles: [
    `
      .agent-timeline {
        margin: 12px 0;
        padding: 12px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
      }

      .timeline-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        margin-bottom: 12px;
        color: var(--vscode-editor-foreground);
        font-size: 13px;
      }

      .header-icon {
        font-size: 16px;
      }

      .agent-item {
        padding: 10px 12px;
        margin-bottom: 8px;
        border-left: 3px solid var(--vscode-textLink-foreground);
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: 4px;
      }

      .agent-item.status-running {
        border-left-color: var(--vscode-editorInfo-foreground);
      }

      .agent-item.status-completed {
        border-left-color: var(--vscode-testing-iconPassed);
      }

      .agent-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .agent-name {
        font-weight: 600;
        color: var(--vscode-editor-foreground);
        font-size: 13px;
      }

      .agent-status {
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
      }

      .badge-running {
        background: var(--vscode-editorInfo-background);
        color: var(--vscode-editorInfo-foreground);
      }

      .badge-completed {
        background: var(--vscode-testing-iconPassed);
        color: white;
      }

      .agent-activity {
        font-size: 12px;
        color: var(--vscode-editor-foreground);
        margin-bottom: 6px;
        font-style: italic;
      }

      .agent-result {
        font-size: 12px;
        color: var(--vscode-editor-foreground);
        margin-bottom: 6px;
        padding: 6px;
        background: var(--vscode-textCodeBlock-background);
        border-radius: 3px;
      }

      .agent-timing {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 8px;
      }
    `,
  ],
})
export class AgentActivityTimelineComponent {
  agents = input.required<AgentActivity[]>();

  formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  calculateDuration(start: number, end: number): string {
    const duration = end - start;
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
    return `${(duration / 60000).toFixed(1)}m`;
  }
}
