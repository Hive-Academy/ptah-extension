import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FileTreeNode } from '../models/file-tree.model';
import type { GitFileStatus } from '@ptah-extension/shared';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { SourceControlPanelComponent } from '../source-control/source-control-panel.component';
import { SearchPanelComponent } from '../search/search-panel.component';

/**
 * SidebarComponent - Tabbed container switching between Explorer and Source Control panels.
 *
 * Complexity Level: 1 (Simple tab container, delegates rendering to child components)
 * Patterns: Standalone, OnPush, signal-based tab state, composition
 *
 * Replaces the direct <ptah-file-tree> in the editor panel with a tabbed sidebar
 * that can switch between file explorer and source control views.
 *
 * TASK_2025_273
 */
@Component({
  selector: 'ptah-sidebar',
  standalone: true,
  imports: [
    FileTreeComponent,
    SourceControlPanelComponent,
    SearchPanelComponent,
  ],
  template: `
    <aside
      class="w-64 h-full flex flex-col flex-shrink-0 bg-base-200 border-r border-base-300"
      role="complementary"
      aria-label="Sidebar"
    >
      <!-- Tab bar -->
      <div
        class="flex items-center px-1 h-8 border-b border-base-300 flex-shrink-0"
        role="tablist"
        aria-label="Sidebar tabs"
      >
        <button
          class="px-2.5 py-1 text-xs font-medium rounded transition-colors"
          role="tab"
          [attr.aria-selected]="activeTab() === 'explorer'"
          [class]="
            activeTab() === 'explorer'
              ? 'text-base-content bg-base-content/10'
              : 'text-base-content/50 hover:text-base-content/70 hover:bg-base-content/5'
          "
          (click)="activeTab.set('explorer')"
        >
          Explorer
        </button>

        <button
          class="px-2.5 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1.5"
          role="tab"
          [attr.aria-selected]="activeTab() === 'source-control'"
          [class]="
            activeTab() === 'source-control'
              ? 'text-base-content bg-base-content/10'
              : 'text-base-content/50 hover:text-base-content/70 hover:bg-base-content/5'
          "
          (click)="activeTab.set('source-control')"
        >
          Git
          @if (changeCount() > 0) {
            <span class="text-[10px] text-primary font-semibold">{{
              changeCount()
            }}</span>
          }
        </button>

        <button
          class="px-2.5 py-1 text-xs font-medium rounded transition-colors"
          role="tab"
          [attr.aria-selected]="activeTab() === 'search'"
          [class]="
            activeTab() === 'search'
              ? 'text-base-content bg-base-content/10'
              : 'text-base-content/50 hover:text-base-content/70 hover:bg-base-content/5'
          "
          (click)="activeTab.set('search')"
        >
          Search
        </button>
      </div>

      <!-- Tab content -->
      <div class="flex-1 min-h-0">
        @switch (activeTab()) {
          @case ('explorer') {
            <ptah-file-tree
              [files]="files()"
              [activeFilePath]="activeFilePath()"
              (fileSelected)="fileSelected.emit($event)"
              (contextMenuRequested)="contextMenuRequested.emit($event)"
            />
          }
          @case ('source-control') {
            <ptah-source-control-panel
              [files]="changedFiles()"
              (fileClicked)="fileSelected.emit($event)"
              (diffRequested)="diffRequested.emit($event)"
            />
          }
          @case ('search') {
            <ptah-search-panel
              (searchResultSelected)="searchResultSelected.emit($event)"
            />
          }
        }
      </div>
    </aside>
  `,
  styles: `
    :host ptah-file-tree {
      display: contents;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  // Inputs
  readonly files = input<FileTreeNode[]>([]);
  readonly activeFilePath = input<string | undefined>(undefined);
  readonly changedFiles = input<GitFileStatus[]>([]);
  readonly branchName = input<string>('');

  // Outputs
  readonly fileSelected = output<string>();
  readonly diffRequested = output<string>();
  readonly searchResultSelected = output<{ filePath: string; line: number }>();
  readonly contextMenuRequested = output<{
    event: MouseEvent;
    node: FileTreeNode | null;
  }>();

  // Tab state
  protected readonly activeTab = signal<
    'explorer' | 'source-control' | 'search'
  >('explorer');

  // Computed
  protected readonly changeCount = computed(() => this.changedFiles().length);
}
