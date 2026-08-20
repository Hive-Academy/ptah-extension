import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FileTreeNode } from '../models/file-tree.model';
import { FileTreeNodeComponent } from './file-tree-node.component';
import { FileTreeMoreRowComponent } from './file-tree-more-row.component';
import { createFileTreeWindow } from './file-tree-window';

/**
 * FileTreeComponent - File explorer sidebar for the editor panel.
 *
 * Complexity Level: 1 (Simple - delegates rendering to FileTreeNodeComponent)
 * Patterns: Standalone component, composition with child component
 *
 * Displays a hierarchical file tree with:
 * - Recursive file/directory rendering
 * - File selection events
 * - Context menu events (bubbled from child nodes)
 * - DaisyUI-styled sidebar with scrollable content
 *
 * The root list is windowed by the same primitive every expanded directory
 * uses (`file-tree-window.ts`). A workspace root with thousands of entries is
 * rarer than a `node_modules` with thousands, but it is the same unbounded
 * mount, and sharing the primitive means it cannot be fixed in one place only.
 */
@Component({
  selector: 'ptah-file-tree',
  standalone: true,
  imports: [FileTreeNodeComponent, FileTreeMoreRowComponent],
  template: `
    <aside
      class="w-full h-full overflow-y-auto flex flex-col"
      role="tree"
      aria-label="File Explorer"
      (contextmenu)="onBlankAreaRightClick($event)"
    >
      @if (files().length === 0) {
        <div class="px-3 py-4 text-sm opacity-50 text-center">
          No files to display
        </div>
      } @else {
        @for (node of visibleRoots(); track node.path) {
          <ptah-file-tree-node
            [node]="node"
            [depth]="0"
            [activeFilePath]="activeFilePath()"
            (fileClicked)="fileSelected.emit($event)"
            (contextMenuRequested)="contextMenuRequested.emit($event)"
          />
        }
        @if (hiddenRootCount() > 0) {
          <ptah-file-tree-more-row
            [hiddenCount]="hiddenRootCount()"
            [depth]="0"
            (revealMore)="rootWindow.showMore()"
          />
        }
      }
    </aside>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTreeComponent {
  readonly files = input<FileTreeNode[]>([]);
  readonly activeFilePath = input<string | undefined>(undefined);

  readonly fileSelected = output<string>();
  readonly contextMenuRequested = output<{
    event: MouseEvent;
    node: FileTreeNode | null;
  }>();

  /**
   * The root list arrives already sorted from the backend (`buildFileTree`
   * puts directories first, then sorts by name), so unlike a directory's
   * children it needs the window only — there is no sort in front of it.
   */
  protected readonly rootWindow = createFileTreeWindow(
    () => this.files(),
    () => this.activeFilePath(),
  );
  protected readonly visibleRoots = this.rootWindow.visible;
  protected readonly hiddenRootCount = this.rootWindow.hiddenCount;

  protected onBlankAreaRightClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      this.contextMenuRequested.emit({ event, node: null });
    }
  }
}
