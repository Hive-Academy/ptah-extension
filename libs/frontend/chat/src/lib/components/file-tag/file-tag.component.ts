import { Component, computed, signal, input, output } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';

/**
 * File information for inclusion in chat messages
 */
export interface ChatFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly type: 'text' | 'image' | 'binary';
  readonly content?: string;
  readonly encoding?: string;
  readonly preview?: string;
  readonly isLarge: boolean;
  readonly tokenEstimate: number;
}

/**
 * File Tag Component - Pure Presentation Component
 * - Displays included file as removable tag
 * - Shows file metadata and preview
 * - Handles removal action
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 */
@Component({
  selector: 'ptah-file-tag',
  standalone: true,
  imports: [CommonModule, NgOptimizedImage],

  template: `
    <div
      class="vscode-file-tag"
      [class.vscode-file-tag-large]="file().isLarge"
      [class.vscode-file-tag-image]="file().type === 'image'"
      [class.vscode-file-tag-text]="file().type === 'text'"
      [class.vscode-file-tag-expanded]="isExpanded()"
      [attr.title]="getTooltipText()"
      [attr.role]="'button'"
      [attr.aria-label]="getAriaLabel()"
    >
      <!-- File Icon and Name -->
      <div
        class="vscode-file-tag-content"
        (click)="toggleExpanded()"
        (keydown.enter)="toggleExpanded()"
        (keydown.space)="toggleExpanded()"
        [attr.tabindex]="hasPreview() ? 0 : -1"
      >
        <div class="vscode-file-tag-icon">
          {{ getFileIcon() }}
        </div>

        <div class="vscode-file-tag-info">
          <div class="vscode-file-tag-name">
            {{ file().name }}
          </div>

          @if (showMetadata()) {
          <div class="vscode-file-tag-meta">
            <span class="vscode-file-tag-size">{{
              formatSize(file().size)
            }}</span>
            @if (file().tokenEstimate > 0) {
            <span class="vscode-file-tag-tokens"
              >{{ formatTokens(file().tokenEstimate) }} tokens</span
            >
            } @if (file().isLarge) {
            <span class="vscode-file-tag-warning">Large file</span>
            }
          </div>
          }
        </div>

        <!-- Expand/Collapse indicator -->
        @if (hasPreview()) {
        <div class="vscode-file-tag-expand">
          {{ isExpanded() ? '🔽' : '▶️' }}
        </div>
        }
      </div>

      <!-- Remove Button -->
      <button
        class="vscode-file-tag-remove"
        (click)="removeFile.emit()"
        [attr.aria-label]="'Remove ' + file().name"
        type="button"
      >
        ❌
      </button>

      <!-- Expanded Preview -->
      @if (isExpanded() && file().preview) {
      <div class="vscode-file-tag-preview">
        @if (file().type === 'image') {
        <img
          [ngSrc]="file().preview || ''"
          [alt]="file().name"
          class="vscode-file-tag-image-preview"
          width="200"
          height="150"
          priority
        />
        } @else if (file().type === 'text') {
        <pre class="vscode-file-tag-text-preview">{{ file().preview }}</pre>
        }
      </div>
      }
    </div>
  `,
  styles: [
    `
      .vscode-file-tag {
        display: inline-flex;
        flex-direction: column;
        background-color: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 4px;
        border: 1px solid var(--vscode-widget-border);
        font-family: var(--vscode-font-family);
        font-size: 11px;
        max-width: 280px;
        transition: all 0.15s ease;
        position: relative;
      }

      .vscode-file-tag:hover {
        background-color: var(--vscode-list-hoverBackground);
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .vscode-file-tag-content {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        cursor: pointer;
        flex: 1;
      }

      .vscode-file-tag-icon {
        flex-shrink: 0;
        font-size: 14px;
        width: 16px;
        text-align: center;
      }

      .vscode-file-tag-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .vscode-file-tag-name {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
      }

      .vscode-file-tag-meta {
        display: flex;
        gap: 8px;
        align-items: center;
        opacity: 0.8;
        font-size: 10px;
      }

      .vscode-file-tag-size {
        color: var(--vscode-descriptionForeground);
      }

      .vscode-file-tag-tokens {
        color: var(--vscode-charts-blue);
      }

      .vscode-file-tag-warning {
        color: var(--vscode-charts-orange);
        font-weight: 500;
      }

      .vscode-file-tag-expand {
        flex-shrink: 0;
        font-size: 10px;
        opacity: 0.7;
        transition: transform 0.15s ease;
      }

      .vscode-file-tag-expanded .vscode-file-tag-expand {
        transform: rotate(0deg);
      }

      .vscode-file-tag-remove {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 18px;
        height: 18px;
        border: none;
        border-radius: 50%;
        background-color: var(--vscode-inputValidation-errorBackground);
        color: var(--vscode-inputValidation-errorForeground);
        font-size: 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.15s ease;
        z-index: 1;
      }

      .vscode-file-tag:hover .vscode-file-tag-remove {
        opacity: 1;
      }

      .vscode-file-tag-remove:hover {
        transform: scale(1.1);
        background-color: var(--vscode-charts-red);
      }

      .vscode-file-tag-remove:focus {
        opacity: 1;
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }

      /* Preview styles */
      .vscode-file-tag-preview {
        border-top: 1px solid var(--vscode-widget-border);
        padding: 8px;
        background-color: var(--vscode-panel-background);
        max-height: 120px;
        overflow: auto;
      }

      .vscode-file-tag-image-preview {
        max-width: 100%;
        max-height: 100px;
        object-fit: contain;
        border-radius: 2px;
      }

      .vscode-file-tag-text-preview {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 10px;
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--vscode-editor-foreground);
        background: none;
        line-height: 1.3;
      }

      /* File type specific styling */
      .vscode-file-tag-image {
        border-left: 3px solid var(--vscode-charts-blue);
      }

      .vscode-file-tag-text {
        border-left: 3px solid var(--vscode-charts-green);
      }

      .vscode-file-tag-large {
        border-left: 3px solid var(--vscode-charts-orange);
      }

      .vscode-file-tag-large .vscode-file-tag-name {
        color: var(--vscode-charts-orange);
      }

      /* High contrast mode */
      @media (prefers-contrast: high) {
        .vscode-file-tag {
          border-width: 2px;
        }

        .vscode-file-tag-remove {
          border: 1px solid var(--vscode-contrastBorder);
        }
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        .vscode-file-tag,
        .vscode-file-tag-expand,
        .vscode-file-tag-remove {
          transition: none;
        }

        .vscode-file-tag:hover {
          transform: none;
        }
      }

      /* Scrollbar styling for preview */
      .vscode-file-tag-preview::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }

      .vscode-file-tag-preview::-webkit-scrollbar-track {
        background: var(--vscode-scrollbarSlider-background);
      }

      .vscode-file-tag-preview::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-hoverBackground);
        border-radius: 3px;
      }
    `,
  ],
})
export class FileTagComponent {
  // ANGULAR 20+ PATTERN: input() for reactive inputs
  readonly file = input.required<ChatFile>();
  readonly showMetadata = input(true);

  // ANGULAR 20+ PATTERN: output() for event emitters
  readonly removeFile = output<void>();

  // ANGULAR 20 PATTERN: Private signals for component state
  private readonly _isExpanded = signal(false);

  // ANGULAR 20 PATTERN: Readonly signals for template access
  readonly isExpanded = this._isExpanded.asReadonly();

  // ANGULAR 20 PATTERN: Computed signals for derived state
  readonly hasPreview = computed(() =>
    Boolean(
      this.file().preview &&
        (this.file().type === 'image' || this.file().type === 'text')
    )
  );

  toggleExpanded(): void {
    if (this.hasPreview()) {
      this._isExpanded.update((expanded) => !expanded);
    }
  }

  getFileIcon(): string {
    const fileType = this.file().type;
    if (fileType === 'image') return '🖼️';
    if (fileType === 'text') return '📄';
    return '📁';
  }

  formatSize(size: number): string {
    if (size < 1024) return `${size}B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
    return `${(size / 1024 / 1024).toFixed(1)}MB`;
  }

  formatTokens(tokens: number): string {
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  }

  getTooltipText(): string {
    const file = this.file();
    const parts = [
      `File: ${file.name}`,
      `Path: ${file.path}`,
      `Size: ${this.formatSize(file.size)}`,
    ];

    if (file.tokenEstimate > 0) {
      parts.push(`Tokens: ${this.formatTokens(file.tokenEstimate)}`);
    }

    if (file.isLarge) {
      parts.push('⚠️ Large file - may impact performance');
    }

    return parts.join('\n');
  }

  getAriaLabel(): string {
    const file = this.file();
    return `File ${file.name}, ${this.formatSize(file.size)}${
      file.isLarge ? ', large file' : ''
    }. Click to ${
      this.hasPreview()
        ? (this.isExpanded() ? 'collapse' : 'expand') + ' preview or '
        : ''
    }remove.`;
  }
}
