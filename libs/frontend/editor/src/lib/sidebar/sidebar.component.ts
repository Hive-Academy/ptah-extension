import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, FolderOpen, GitBranch } from 'lucide-angular';
import type { FileTreeNode } from '../models/file-tree.model';
import type { GitFileStatus } from '@ptah-extension/shared';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { SourceControlPanelComponent } from '../source-control/source-control-panel.component';

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
    LucideAngularModule,
    FileTreeComponent,
    SourceControlPanelComponent,
  ],
  template: `
    <aside
      class="w-64 h-full flex flex-col flex-shrink-0 bg-base-200 border-r border-base-300"
      role="complementary"
      aria-label="Sidebar"
    >
      <!-- Tab bar -->
      <div
        class="flex items-center border-b border-base-300 flex-shrink-0"
        role="tablist"
        aria-label="Sidebar tabs"
      >
        <button
          class="flex items-center gap-1 px-3 py-1.5 text-xs transition-colors"
          role="tab"
          [attr.aria-selected]="activeTab() === 'explorer'"
          [class]="
            activeTab() === 'explorer'
              ? 'border-b-2 border-primary text-base-content'
              : 'text-base-content/50 hover:text-base-content/80'
          "
          (click)="activeTab.set('explorer')"
        >
          <lucide-angular [img]="FolderOpenIcon" class="w-3.5 h-3.5" />
          <span>Explorer</span>
        </button>

        <button
          class="flex items-center gap-1 px-3 py-1.5 text-xs transition-colors"
          role="tab"
          [attr.aria-selected]="activeTab() === 'source-control'"
          [class]="
            activeTab() === 'source-control'
              ? 'border-b-2 border-primary text-base-content'
              : 'text-base-content/50 hover:text-base-content/80'
          "
          (click)="activeTab.set('source-control')"
        >
          <lucide-angular [img]="GitBranchIcon" class="w-3.5 h-3.5" />
          <span>Source Control</span>
          @if (changeCount() > 0) {
            <span class="badge badge-xs badge-primary ml-0.5">{{
              changeCount()
            }}</span>
          }
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
            />
          }
          @case ('source-control') {
            <ptah-source-control-panel
              [files]="changedFiles()"
              (fileClicked)="fileSelected.emit($event)"
              (diffRequested)="diffRequested.emit($event)"
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

  // Tab state
  protected readonly activeTab = signal<'explorer' | 'source-control'>(
    'explorer',
  );

  // Icons
  readonly FolderOpenIcon = FolderOpen;
  readonly GitBranchIcon = GitBranch;

  // Computed
  protected readonly changeCount = computed(() => this.changedFiles().length);
}
