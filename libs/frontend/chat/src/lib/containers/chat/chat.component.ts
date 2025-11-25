/**
 * ChatComponent - PURGED for TASK_2025_023
 *
 * Will be rebuilt in Batch 5 with:
 * - ExecutionNode recursive rendering
 * - DaisyUI components (collapse, card, badge)
 * - Tailwind CSS styling
 * - ngx-markdown for content rendering
 */

import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * TEMPORARY: Minimal ChatComponent shell
 * Full implementation in Batch 5
 */
@Component({
  selector: 'ptah-chat',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chat-shell">
      <div class="chat-placeholder">
        <h2>Ptah Chat</h2>
        <p>TASK_2025_023: Rebuilding with ExecutionNode architecture</p>
        <p class="status">Dependencies: Tailwind + DaisyUI + ngx-markdown</p>
        <p class="hint">User will install dependencies separately</p>
      </div>
    </div>
  `,
  styles: [
    `
      .chat-shell {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
      }

      .chat-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        gap: 12px;
        text-align: center;
        padding: 24px;
      }

      h2 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      p {
        margin: 0;
        font-size: 14px;
        color: var(--vscode-descriptionForeground);
      }

      .status {
        padding: 8px 16px;
        background-color: var(--vscode-inputOption-activeBackground);
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
      }

      .hint {
        font-style: italic;
        opacity: 0.7;
      }
    `,
  ],
})
export class ChatComponent {
  // Minimal placeholder - will be rebuilt in Batch 5
  readonly placeholder = signal('TASK_2025_023: Awaiting rebuild');
}
