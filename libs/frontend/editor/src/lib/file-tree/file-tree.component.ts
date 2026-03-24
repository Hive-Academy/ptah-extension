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
 * - "EXPLORER" header
 * - Recursive file/directory rendering
 * - File selection events
 * - DaisyUI-styled sidebar with scrollable content
 */
@Component({
  selector: 'ptah-file-tree',
  standalone: true,
  imports: [FileTreeNodeComponent],
  template: `
    <aside
      class="w-64 h-full overflow-y-auto bg-base-200 border-r border-base-300 flex flex-col flex-shrink-0"
      role="tree"
      aria-label="File Explorer"
    >
      <div
        class="text-xs font-semibold tracking-wider mb-1 px-3 pt-3 pb-1 opacity-60 uppercase"
      >
        Explorer
      </div>
      @if (files().length === 0) {
      <div class="px-3 py-4 text-sm opacity-50 text-center">
        No files to display
      </div>
      } @else { @for (node of files(); track node.path) {
      <ptah-file-tree-node
        [node]="node"
        [depth]="0"
        [activeFilePath]="activeFilePath()"
        (fileClicked)="fileSelected.emit($event)"
      />
      } }
    </aside>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTreeComponent {
  readonly files = input<FileTreeNode[]>([]);
  readonly activeFilePath = input<string | undefined>(undefined);

  readonly fileSelected = output<string>();
}
