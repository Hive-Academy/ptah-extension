import {
  Component,
  computed,
  signal,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { ChatFile } from '../../services';

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
      class="card card-compact bg-base-200 border border-base-300 shadow-sm w-64 relative"
      [class.border-warning]="file().isLarge"
      [attr.title]="getTooltipText()"
      [attr.role]="'button'"
      [attr.aria-label]="getAriaLabel()"
    >
      <!-- Card Body -->
      <div class="card-body">
        <div class="flex items-center gap-2">
          <!-- File Icon -->
          <span class="text-lg">{{ getFileIcon() }}</span>

          <!-- File Info -->
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm truncate">{{ file().name }}</div>
            @if (showMetadata()) {
            <div class="flex items-center gap-2 text-xs text-base-content/60">
              <span class="badge badge-sm badge-ghost">{{
                formatSize(file().size)
              }}</span>
              @if (file().tokenEstimate > 0) {
              <span class="badge badge-sm badge-info"
                >{{ formatTokens(file().tokenEstimate) }} tokens</span
              >
              } @if (file().isLarge) {
              <span class="badge badge-sm badge-warning">Large file</span>
              }
            </div>
            }
          </div>

          <!-- Remove Button -->
          <button
            class="btn btn-circle btn-ghost btn-xs"
            (click)="removeFile.emit()"
            [attr.aria-label]="'Remove ' + file().name"
            type="button"
          >
            ❌
          </button>
        </div>

        <!-- Expandable Preview (if hasPreview) -->
        @if (hasPreview()) {
        <div
          class="collapse collapse-arrow"
          [class.collapse-open]="isExpanded()"
        >
          <input
            type="checkbox"
            [checked]="isExpanded()"
            (change)="toggleExpanded()"
          />
          <div class="collapse-title text-xs font-medium">Preview</div>
          <div class="collapse-content">
            @if (file().type === 'image') {
            <img
              [ngSrc]="file().preview || ''"
              [alt]="file().name"
              class="rounded-lg max-w-full max-h-32 object-contain"
              width="200"
              height="128"
              priority
            />
            } @else if (file().type === 'text') {
            <pre
              class="text-xs bg-base-300 p-2 rounded overflow-auto max-h-32"
              >{{ file().preview }}</pre
            >
            }
          </div>
        </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      /* Remove button hover effect */
      .btn-circle:hover {
        transform: scale(1.1);
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        .btn-circle {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
