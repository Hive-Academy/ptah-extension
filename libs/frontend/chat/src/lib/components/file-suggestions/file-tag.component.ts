import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ChatFile } from '../../services';

/**
 * File Tag Component - Compact Chip for Selected Files
 * - Displays included file as small removable chip (like Claude Code CLI)
 * - Shows icon + truncated name + remove button
 * - Tooltip for full path and metadata
 * - No preview - keep it minimal
 */
@Component({
  selector: 'ptah-file-tag',
  standalone: true,
  imports: [],

  template: `
    <div
      class="badge badge-lg gap-1 pr-1 bg-base-200 border-base-300 max-w-48"
      [class.border-warning]="file().isLarge"
      [attr.title]="getTooltipText()"
    >
      <!-- File Icon -->
      <span class="text-xs">{{ getFileIcon() }}</span>

      <!-- File Name (truncated) -->
      <span class="truncate text-xs">{{ file().name }}</span>

      <!-- Remove Button -->
      <button
        class="btn btn-circle btn-ghost btn-xs h-4 w-4 min-h-0"
        (click)="removeFile.emit(); $event.stopPropagation()"
        [attr.aria-label]="'Remove ' + file().name"
        type="button"
      >
        ✕
      </button>
    </div>
  `,
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTagComponent {
  // ANGULAR 20+ PATTERN: input() for reactive inputs
  readonly file = input.required<ChatFile>();

  // ANGULAR 20+ PATTERN: output() for event emitters
  readonly removeFile = output<void>();

  getFileIcon(): string {
    const fileType = this.file().type;
    if (fileType === 'image') return '🖼️';
    if (fileType === 'text') return '📄';
    // 'binary' type
    return '📦';
  }

  private formatSize(size: number): string {
    if (size < 1024) return `${size}B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
    return `${(size / 1024 / 1024).toFixed(1)}MB`;
  }

  getTooltipText(): string {
    const file = this.file();
    const parts = [`${file.path}`];

    if (file.size > 0) {
      parts.push(`Size: ${this.formatSize(file.size)}`);
    }

    if (file.isLarge) {
      parts.push('⚠️ Large file');
    }

    return parts.join('\n');
  }
}
