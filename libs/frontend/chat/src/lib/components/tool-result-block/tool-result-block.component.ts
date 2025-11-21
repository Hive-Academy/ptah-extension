/**
 * Tool Result Block Component
 *
 * Pure presentation component for displaying tool execution results.
 *
 * ARCHITECTURE:
 * - Level 1 component (simple, single responsibility)
 * - Formats tool output (string, ContentBlock[], or JSON)
 * - Error state handling with visual feedback
 * - VS Code themed UI with codicons
 * - OnPush change detection for performance
 *
 * USAGE:
 * <ptah-tool-result-block
 *   [toolUseId]="'call_abc123'"
 *   [content]="'File read successfully'"
 *   [isError]="false"
 * />
 */

import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';

@Component({
  selector: 'ptah-tool-result-block',
  standalone: true,
  imports: [],
  template: `
    <div class="tool-result-block" [class.error]="isError()">
      <div class="result-header">
        @if (isError()) {
        <span class="codicon codicon-error"></span>
        } @else {
        <span class="codicon codicon-check"></span>
        }
        <strong class="result-label">{{
          isError() ? 'Tool Error' : 'Tool Result'
        }}</strong>
        <span class="tool-id">({{ toolUseId() }})</span>
      </div>
      <div class="result-content">
        <pre><code>{{ formattedContent() }}</code></pre>
      </div>
    </div>
  `,
  styles: [
    `
      .tool-result-block {
        margin: 8px 0;
        padding: 12px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-left: 3px solid var(--vscode-charts-green);
        border-radius: 4px;
      }

      .tool-result-block.error {
        border-left-color: var(--vscode-charts-red);
        background: var(--vscode-inputValidation-errorBackground);
      }

      .result-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .tool-result-block:not(.error) .result-header {
        color: var(--vscode-charts-green);
      }

      .tool-result-block.error .result-header {
        color: var(--vscode-charts-red);
      }

      .codicon {
        font-size: 16px;
      }

      .result-label {
        font-weight: 600;
        color: var(--vscode-editor-foreground);
      }

      .tool-id {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        opacity: 0.7;
      }

      .result-content {
        padding: 8px;
        background: var(--vscode-editor-background);
        border-radius: 4px;
        overflow-x: auto;
      }

      .result-content pre {
        margin: 0;
        padding: 0;
      }

      .result-content code {
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size, 12px);
        color: var(--vscode-editor-foreground);
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolResultBlockComponent {
  /**
   * Unique identifier for the tool use this result corresponds to
   */
  readonly toolUseId = input.required<string>();

  /**
   * Tool result content (can be string, array of ContentBlock, or JSON)
   */
  readonly content = input.required<unknown>();

  /**
   * Whether this result represents an error
   */
  readonly isError = input<boolean>(false);

  /**
   * Formatted content for display
   */
  readonly formattedContent = computed(() => {
    const contentValue = this.content();

    if (typeof contentValue === 'string') {
      return contentValue;
    }

    if (Array.isArray(contentValue)) {
      // ContentBlock[] - extract text blocks
      return contentValue
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { text: string }) => block.text)
        .join('\n');
    }

    return JSON.stringify(contentValue, null, 2);
  });
}
