/**
 * Workspace Sidebar Component
 *
 * Electron desktop workspace navigation panel. Displays a list of open
 * workspace folders with active highlighting, add/remove actions,
 * and Ptah branding.
 *
 * Communicates with ElectronLayoutService for folder state and
 * triggers Electron dialog.showOpenDialog via RPC for adding folders.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
} from '@angular/core';
import { LucideAngularModule, FolderOpen, FolderPlus, X } from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-workspace-sidebar',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      height: 100%;
    }

    .sidebar-item:hover .remove-btn {
      opacity: 1;
    }
  `,
  template: `
    <div
      class="flex flex-col h-full bg-base-200 border-r border-base-content/10"
      [style.width.px]="width()"
    >
      <!-- Workspace label -->
      <div class="px-3 pt-2.5 pb-1">
        <span
          class="text-[10px] font-semibold uppercase tracking-wider text-base-content/40"
        >
          Workspaces
        </span>
      </div>

      <!-- Folder list -->
      <div class="flex-1 overflow-y-auto px-2">
        @for (folder of layout.workspaceFolders(); track folder.path; let i =
        $index) {
        <div
          class="sidebar-item group relative flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors duration-150 mb-0.5 hover:bg-base-300"
          [class.bg-base-300]="i === layout.activeWorkspaceIndex()"
          [class.text-primary]="i === layout.activeWorkspaceIndex()"
          (click)="layout.switchWorkspace(i)"
          [title]="folder.path"
        >
          <lucide-angular
            [img]="FolderOpenIcon"
            class="w-4 h-4 flex-shrink-0"
            [class.text-primary]="i === layout.activeWorkspaceIndex()"
            [class.opacity-50]="i !== layout.activeWorkspaceIndex()"
          />
          <span class="text-sm truncate flex-1">{{ folder.name }}</span>
          <!-- Remove button (hover reveal) -->
          <button
            class="remove-btn opacity-0 btn btn-ghost btn-xs btn-square p-0 min-h-0 w-5 h-5 text-base-content/30 hover:text-error transition-opacity duration-200"
            (click)="onRemoveFolder($event, i)"
            title="Remove workspace"
            aria-label="Remove workspace"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" />
          </button>
        </div>
        } @empty {
        <div
          class="flex flex-col items-center justify-center py-8 text-center px-4"
        >
          <lucide-angular
            [img]="FolderOpenIcon"
            class="w-10 h-10 opacity-15 mb-2"
          />
          <span class="text-xs opacity-40">No workspaces open</span>
          <span class="text-[10px] opacity-25 mt-1">
            Add a folder to get started
          </span>
        </div>
        }
      </div>

      <!-- Add folder button -->
      <div class="p-2 border-t border-base-content/10">
        <button
          class="btn btn-ghost btn-sm w-full gap-2 text-base-content/60 hover:text-base-content justify-start"
          (click)="layout.addFolder()"
          aria-label="Add workspace folder"
        >
          <lucide-angular [img]="FolderPlusIcon" class="w-4 h-4" />
          <span class="text-xs">Add Folder</span>
        </button>
      </div>
    </div>
  `,
})
export class WorkspaceSidebarComponent {
  protected readonly layout = inject(ElectronLayoutService);

  /** Sidebar width in pixels (controlled by parent via resize handle) */
  readonly width = input<number>(220);

  // Icons
  readonly FolderOpenIcon = FolderOpen;
  readonly FolderPlusIcon = FolderPlus;
  readonly XIcon = X;

  onRemoveFolder(event: Event, index: number): void {
    event.stopPropagation();
    this.layout.removeFolder(index);
  }
}
