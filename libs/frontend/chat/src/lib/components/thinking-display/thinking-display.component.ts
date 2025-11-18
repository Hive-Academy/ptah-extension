import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ptah-thinking-display',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (thinking(); as thinkingData) {
    <div class="thinking-container">
      <div class="thinking-header">
        <span class="thinking-icon">💭</span>
        <span class="thinking-label">Claude is thinking...</span>
      </div>
      <div class="thinking-content">
        {{ thinkingData.content }}
      </div>
      <div class="thinking-timestamp">
        {{ formatTimestamp(thinkingData.timestamp) }}
      </div>
    </div>
    }
  `,
  styles: [
    `
      .thinking-container {
        padding: 12px 16px;
        margin: 8px 0;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-left: 3px solid var(--vscode-editorInfo-foreground);
        border-radius: 4px;
      }

      .thinking-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-weight: 600;
        color: var(--vscode-editorInfo-foreground);
      }

      .thinking-icon {
        font-size: 16px;
      }

      .thinking-content {
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
      }

      .thinking-timestamp {
        margin-top: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
    `,
  ],
})
export class ThinkingDisplayComponent {
  thinking = input<{ content: string; timestamp: number } | null>();

  formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }
}
