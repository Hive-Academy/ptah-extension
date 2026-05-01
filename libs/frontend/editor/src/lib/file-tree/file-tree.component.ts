import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FileTreeNode } from '../models/file-tree.model';
import { FileTreeNodeComponent } from './file-tree-node.component';

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
 */
@Component({
  selector: 'ptah-file-tree',
  standalone: true,
  imports: [FileTreeNodeComponent],
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
        @for (node of files(); track node.path) {
          <ptah-file-tree-node
            [node]="node"
            [depth]="0"
            [activeFilePath]="activeFilePath()"
            (fileClicked)="fileSelected.emit($event)"
            (contextMenuRequested)="contextMenuRequested.emit($event)"
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

  protected onBlankAreaRightClick(event: MouseEvent): void {
    // Only fire if the click was directly on the aside (blank area), not on a node
    if (event.target === event.currentTarget) {
      event.preventDefault();
      this.contextMenuRequested.emit({ event, node: null });
    }
  }
}
