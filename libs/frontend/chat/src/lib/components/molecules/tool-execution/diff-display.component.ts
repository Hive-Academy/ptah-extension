import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { LucideAngularModule, FileEdit, CheckCircle } from 'lucide-angular';
import { FilePathLinkComponent } from '../../atoms/file-path-link.component';
import type { EditToolInput } from '@ptah-extension/shared';

/**
 * DiffDisplayComponent - VS Code-style diff visualization for Edit tool
 *
 * Complexity Level: 2 (Molecule with diff formatting)
 * Patterns: Diff generation, syntax highlighting
 *
 * Features:
 * - Show old_string (removed) in red with - prefix
 * - Show new_string (added) in green with + prefix
 * - File path display with link
 * - Replacement count badge
 * - VS Code-style diff coloring via CSS
 *
 * Note: Uses 'diff' language for Prism.js syntax highlighting
 * which requires prism-diff.min.js in project.json scripts
 */
@Component({
  selector: 'ptah-diff-display',
  standalone: true,
  imports: [MarkdownModule, LucideAngularModule, FilePathLinkComponent],
  template: `
    <div class="mt-1.5">
      <!-- Header with file path and replacement count -->
      <div
        class="flex items-center gap-2 text-[10px] text-base-content/60 mb-1"
      >
        <lucide-angular [img]="FileEditIcon" class="w-3 h-3" />
        <ptah-file-path-link [fullPath]="filePath()" />
        @if (replacements() > 0) {
        <span class="badge badge-xs badge-success gap-0.5">
          <lucide-angular [img]="CheckCircleIcon" class="w-2.5 h-2.5" />
          {{ replacements() }} replacement{{ replacements() > 1 ? 's' : '' }}
        </span>
        }
      </div>

      <!-- Diff view -->
      <div
        class="bg-base-300/50 rounded max-h-64 overflow-y-auto overflow-x-auto diff-container"
      >
        <markdown
          [data]="formattedDiff()"
          class="diff-markdown prose prose-xs prose-invert max-w-none [&_pre]:my-0 [&_pre]:rounded-none [&_code]:text-[10px] [&_pre]:bg-transparent"
        />
      </div>
    </div>
  `,
  styles: [
    `
      :host ::ng-deep .diff-markdown {
        pre {
          margin: 0;
          padding: 0.5rem;
          background: transparent !important;
        }
        code {
          font-size: 10px;
          line-height: 1.5;
        }
        /* Theme-aware diff colors using DaisyUI semantic colors */
        .token.deleted,
        .token.deleted-sign {
          color: oklch(
            var(--er)
          ) !important; /* error color (theme-aware red) */
          background-color: oklch(var(--er) / 0.15) !important;
        }
        .token.inserted,
        .token.inserted-sign {
          color: oklch(
            var(--su)
          ) !important; /* success color (theme-aware green) */
          background-color: oklch(var(--su) / 0.15) !important;
        }
        /* Prefix signs */
        .token.prefix.deleted {
          color: oklch(var(--er)) !important;
        }
        .token.prefix.inserted {
          color: oklch(var(--su)) !important;
        }
        /* Line highlighting */
        .token.coord {
          color: oklch(
            var(--in)
          ) !important; /* info color (theme-aware blue) */
        }
      }
      :host .diff-container {
        border-left: 3px solid oklch(var(--bc) / 0.2);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffDisplayComponent {
  readonly toolInput = input.required<EditToolInput>();
  readonly replacements = input<number>(1);

  readonly FileEditIcon = FileEdit;
  readonly CheckCircleIcon = CheckCircle;

  /**
   * Get file path from tool input
   */
  readonly filePath = computed(() => this.toolInput().file_path);

  /**
   * Format diff output for markdown rendering
   * Creates a unified diff format that Prism.js can highlight
   */
  readonly formattedDiff = computed(() => {
    const input = this.toolInput();
    if (!input) return '';

    const oldStr = input.old_string || '';
    const newStr = input.new_string || '';

    // Generate unified diff format
    const diffLines = this.generateUnifiedDiff(oldStr, newStr);

    // Wrap in diff code block for Prism.js highlighting
    return '```diff\n' + diffLines + '\n```';
  });

  /**
   * Generate unified diff format from old and new strings
   * Shows removed lines with - prefix and added lines with + prefix
   */
  private generateUnifiedDiff(oldStr: string, newStr: string): string {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');

    const result: string[] = [];

    // Add header showing file context
    result.push(`@@ Edit @@`);

    // Show removed lines (old_string)
    for (const line of oldLines) {
      result.push(`- ${line}`);
    }

    // Show added lines (new_string)
    for (const line of newLines) {
      result.push(`+ ${line}`);
    }

    return result.join('\n');
  }
}
