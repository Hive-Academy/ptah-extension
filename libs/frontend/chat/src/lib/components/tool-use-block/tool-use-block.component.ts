/**
 * Tool Use Block Component
 *
 * Pure presentation component for displaying Claude's tool invocations.
 *
 * ARCHITECTURE:
 * - Level 1 component (simple, single responsibility)
 * - Formats tool input (string or JSON object)
 * - VS Code themed UI with codicons
 * - OnPush change detection for performance
 *
 * USAGE:
 * <ptah-tool-use-block
 *   [toolUseId]="'call_abc123'"
 *   [toolName]="'Read'"
 *   [input]="{ file_path: '/path/to/file.ts' }"
 * />
 */

import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';

@Component({
  selector: 'ptah-tool-use-block',
  standalone: true,
  imports: [],
  template: `
    <div class="tool-use-block">
      <div class="tool-header">
        <span class="codicon codicon-tools"></span>
        <strong class="tool-name">Tool: {{ toolName() }}</strong>
        <span class="tool-id">({{ toolUseId() }})</span>
      </div>
      <div class="tool-input">
        <pre><code>{{ formattedInput() }}</code></pre>
      </div>
    </div>
  `,
  styles: [
    `
      .tool-use-block {
        margin: 8px 0;
        padding: 12px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-left: 3px solid var(--vscode-charts-blue);
        border-radius: 4px;
      }

      .tool-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        color: var(--vscode-charts-blue);
      }

      .codicon {
        font-size: 16px;
      }

      .tool-name {
        font-weight: 600;
        color: var(--vscode-editor-foreground);
      }

      .tool-id {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        opacity: 0.7;
      }

      .tool-input {
        padding: 8px;
        background: var(--vscode-editor-background);
        border-radius: 4px;
        overflow-x: auto;
      }

      .tool-input pre {
        margin: 0;
        padding: 0;
      }

      .tool-input code {
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size, 12px);
        color: var(--vscode-editor-foreground);
        white-space: pre;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolUseBlockComponent {
  /**
   * Unique identifier for this tool use
   */
  readonly toolUseId = input.required<string>();

  /**
   * Name of the tool being invoked (e.g., "Read", "Write", "Bash")
   */
  readonly toolName = input.required<string>();

  /**
   * Tool input parameters (can be string or JSON object)
   */
  readonly input = input.required<unknown>();

  /**
   * Formatted input for display
   */
  readonly formattedInput = computed(() => {
    const inputValue = this.input();

    if (typeof inputValue === 'string') {
      return inputValue;
    }

    return JSON.stringify(inputValue, null, 2);
  });
}
