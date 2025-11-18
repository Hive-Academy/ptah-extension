import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface ToolExecution {
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  output?: unknown;
  error?: string;
  progress?: string;
  duration?: number;
}

@Component({
  selector: 'ptah-tool-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (executions().length > 0) {
    <div class="tool-timeline">
      <div class="timeline-header">Tool Executions</div>
      @for (exec of executions(); track exec.toolCallId) {
      <div [class]="'tool-execution status-' + exec.status">
        <div class="tool-header">
          <span class="tool-icon">{{ getToolIcon(exec.tool) }}</span>
          <span class="tool-name">{{ exec.tool }}</span>
          <span [class]="'tool-status badge-' + exec.status">
            {{ exec.status }}
          </span>
        </div>

        @if (exec.progress) {
        <div class="tool-progress">{{ exec.progress }}</div>
        } @if (exec.error) {
        <div class="tool-error">❌ {{ exec.error }}</div>
        } @if (exec.duration) {
        <div class="tool-duration">⏱️ {{ exec.duration }}ms</div>
        }
      </div>
      }
    </div>
    }
  `,
  styles: [
    `
      .tool-timeline {
        margin: 12px 0;
        padding: 12px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
      }

      .timeline-header {
        font-weight: 600;
        margin-bottom: 12px;
        color: var(--vscode-editor-foreground);
        font-size: 13px;
      }

      .tool-execution {
        padding: 8px 12px;
        margin-bottom: 8px;
        border-left: 3px solid var(--vscode-textLink-foreground);
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: 4px;
      }

      .tool-execution.status-running {
        border-left-color: var(--vscode-editorInfo-foreground);
      }

      .tool-execution.status-success {
        border-left-color: var(--vscode-testing-iconPassed);
      }

      .tool-execution.status-error {
        border-left-color: var(--vscode-errorForeground);
      }

      .tool-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }

      .tool-icon {
        font-size: 14px;
      }

      .tool-name {
        font-weight: 600;
        color: var(--vscode-editor-foreground);
        font-size: 12px;
      }

      .tool-status {
        margin-left: auto;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
      }

      .badge-running {
        background: var(--vscode-editorInfo-background);
        color: var(--vscode-editorInfo-foreground);
      }

      .badge-success {
        background: var(--vscode-testing-iconPassed);
        color: white;
      }

      .badge-error {
        background: var(--vscode-errorForeground);
        color: white;
      }

      .tool-progress {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
      }

      .tool-error {
        font-size: 11px;
        color: var(--vscode-errorForeground);
        margin-top: 4px;
      }

      .tool-duration {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
      }
    `,
  ],
})
export class ToolTimelineComponent {
  executions = input.required<ToolExecution[]>();

  getToolIcon(tool: string): string {
    const icons: Record<string, string> = {
      Read: '📖',
      Write: '✍️',
      Edit: '✏️',
      Bash: '⚡',
      Grep: '🔍',
      Glob: '🗂️',
      Task: '🤖',
    };
    return icons[tool] || '🔧';
  }
}
