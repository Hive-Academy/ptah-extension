/**
 * Thinking Block Component
 *
 * Pure presentation component for rendering Claude's thinking/reasoning process.
 *
 * ARCHITECTURE:
 * - Level 1 component (simple, single responsibility)
 * - Expandable details element for progressive disclosure
 * - VS Code themed UI with codicons
 * - OnPush change detection for performance
 *
 * USAGE:
 * <ptah-thinking-block [thinking]="'Claude reasoning text...'" />
 */

import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'ptah-thinking-block',
  standalone: true,
  imports: [],
  template: `
    <div class="thinking-block">
      <details>
        <summary class="thinking-summary">
          <span class="codicon codicon-lightbulb"></span>
          <span class="thinking-label">Claude's Thinking Process</span>
        </summary>
        <div class="thinking-content">
          <pre>{{ thinking() }}</pre>
        </div>
      </details>
    </div>
  `,
  styles: [
    `
      .thinking-block {
        margin: 8px 0;
        padding: 12px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-left: 3px solid var(--vscode-charts-purple);
        border-radius: 4px;
      }

      .thinking-summary {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        color: var(--vscode-charts-purple);
        font-weight: 600;
        list-style: none; /* Remove default marker */
      }

      .thinking-summary::-webkit-details-marker {
        display: none; /* Hide default triangle in WebKit */
      }

      .thinking-summary::marker {
        display: none; /* Hide default triangle in other browsers */
      }

      .thinking-summary:hover {
        opacity: 0.8;
      }

      .codicon {
        font-size: 16px;
      }

      .thinking-content {
        margin-top: 12px;
        padding: 8px;
        background: var(--vscode-editor-background);
        border-radius: 4px;
      }

      .thinking-content pre {
        margin: 0;
        padding: 0;
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size, 12px);
        color: var(--vscode-editor-foreground);
        white-space: pre-wrap;
        word-wrap: break-word;
        font-style: italic;
        opacity: 0.9;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThinkingBlockComponent {
  /**
   * The thinking/reasoning content from Claude
   */
  readonly thinking = input.required<string>();
}
