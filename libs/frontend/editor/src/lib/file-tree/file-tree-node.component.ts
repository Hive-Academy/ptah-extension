import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FileTreeNode } from '../models/file-tree.model';

/**
 * FileTreeNodeComponent - Recursive tree node for file explorer.
 *
 * Complexity Level: 2 (Medium - recursive rendering, interactive state)
 * Patterns: Standalone component, signal-based state, recursive composition
 *
 * Renders a single file or directory node with:
 * - Indentation based on depth level
 * - Expand/collapse toggle for directories
 * - File/folder icons
 * - Active file highlighting
 * - Click-to-select for files, click-to-toggle for directories
 */
@Component({
  selector: 'ptah-file-tree-node',
  standalone: true,
  imports: [FileTreeNodeComponent],
  template: `
    <div
      class="flex items-center gap-1 px-2 py-0.5 cursor-pointer rounded text-sm select-none hover:bg-base-300 transition-colors"
      [class.bg-primary]="isActive()"
      [class.text-primary-content]="isActive()"
      [style.padding-left.px]="depth() * 16 + 8"
      (click)="onNodeClick()"
      role="treeitem"
      [attr.aria-expanded]="node().type === 'directory' ? expanded() : null"
      [attr.aria-selected]="isActive()"
      [attr.aria-label]="node().name"
    >
      @if (node().type === 'directory') {
      <span class="text-xs w-4 text-center opacity-70 flex-shrink-0">{{
        expanded() ? '&#9660;' : '&#9654;'
      }}</span>
      <span class="flex-shrink-0">&#128193;</span>
      } @else {
      <span class="w-4 flex-shrink-0"></span>
      <span class="flex-shrink-0">{{ getFileIcon() }}</span>
      }
      <span class="truncate">{{ node().name }}</span>
    </div>
    @if (node().type === 'directory' && expanded()) { @for (child of
    sortedChildren(); track child.path) {
    <ptah-file-tree-node
      [node]="child"
      [depth]="depth() + 1"
      [activeFilePath]="activeFilePath()"
      (fileClicked)="fileClicked.emit($event)"
    />
    } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTreeNodeComponent {
  readonly node = input.required<FileTreeNode>();
  readonly depth = input<number>(0);
  readonly activeFilePath = input<string | undefined>(undefined);

  readonly fileClicked = output<string>();

  readonly expanded = signal(false);

  protected isActive(): boolean {
    return (
      this.node().type === 'file' && this.node().path === this.activeFilePath()
    );
  }

  protected sortedChildren(): FileTreeNode[] {
    const children = this.node().children;
    if (!children) return [];
    return [...children].sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
  }

  protected onNodeClick(): void {
    if (this.node().type === 'directory') {
      this.expanded.update((v) => !v);
    } else {
      this.fileClicked.emit(this.node().path);
    }
  }

  protected getFileIcon(): string {
    const name = this.node().name;
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return '\uD83D\uDCD8'; // blue book
      case 'js':
      case 'jsx':
        return '\uD83D\uDCD9'; // orange book
      case 'json':
        return '\u2699\uFE0F'; // gear
      case 'html':
        return '\uD83C\uDF10'; // globe
      case 'css':
      case 'scss':
      case 'less':
        return '\uD83C\uDFA8'; // palette
      case 'md':
        return '\uD83D\uDCDD'; // memo
      case 'py':
        return '\uD83D\uDC0D'; // snake
      default:
        return '\uD83D\uDCC4'; // page
    }
  }
}
