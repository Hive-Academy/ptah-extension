import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import {
  LucideAngularModule,
  File,
  Terminal,
  Search,
  FileEdit,
  FolderSearch,
} from 'lucide-angular';

/**
 * ToolIconComponent - Display tool-specific icon with semantic color
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Features:
 * - Map tool name to lucide icon (Read→File, Bash→Terminal, etc.)
 * - Apply semantic color coding (blue=Read, green=Write, yellow=Bash)
 * - Support 6 tool types + default fallback
 * - Consistent 14px size (w-3.5 h-3.5)
 */
@Component({
  selector: 'ptah-tool-icon',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <lucide-angular
      [img]="getIcon()"
      [class]="'w-3.5 h-3.5 flex-shrink-0 ' + getColorClass()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolIconComponent {
  readonly toolName = input.required<string>();

  // Icon references
  private readonly FileIcon = File;
  private readonly TerminalIcon = Terminal;
  private readonly SearchIcon = Search;
  private readonly FileEditIcon = FileEdit;
  private readonly FolderSearchIcon = FolderSearch;

  /**
   * Map tool name to lucide icon
   */
  protected getIcon(): typeof File {
    const name = this.toolName();
    switch (name) {
      case 'Read':
      case 'Write':
        return this.FileIcon;
      case 'Bash':
        return this.TerminalIcon;
      case 'Grep':
        return this.SearchIcon;
      case 'Edit':
        return this.FileEditIcon;
      case 'Glob':
        return this.FolderSearchIcon;
      default:
        return this.TerminalIcon;
    }
  }

  /**
   * Map tool name to semantic color class
   * Uses DaisyUI semantic color classes for theme-aware styling
   */
  protected getColorClass(): string {
    const name = this.toolName();
    switch (name) {
      case 'Read':
        return 'text-info'; // info (blue) - file reading
      case 'Write':
        return 'text-success'; // success (green) - file creation
      case 'Bash':
        return 'text-warning'; // warning (amber) - shell commands
      case 'Grep':
        return 'text-secondary'; // secondary - search operations
      case 'Edit':
        return 'text-accent'; // accent - file modifications
      case 'Glob':
        return 'text-info'; // info - file pattern matching
      default:
        return 'text-base-content/60';
    }
  }
}
