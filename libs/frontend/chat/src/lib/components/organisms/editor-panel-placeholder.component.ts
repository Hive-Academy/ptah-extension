/**
 * Editor Panel Placeholder Component
 *
 * Lightweight placeholder for the Electron desktop editor panel.
 * Will be replaced with the full Monaco-based EditorPanelComponent
 * once ngx-monaco-editor-v2 is installed.
 *
 * Shows a "Coming Soon" state with file tree placeholder.
 */

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Code2, FolderTree } from 'lucide-angular';

@Component({
  selector: 'ptah-editor-panel-placeholder',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
  `,
  template: `
    <div class="flex flex-col h-full bg-base-100">
      <!-- Header -->
      <div
        class="flex items-center gap-2 px-3 py-2 bg-base-200 border-b border-base-content/10"
      >
        <lucide-angular
          [img]="FolderTreeIcon"
          class="w-4 h-4 text-base-content/50"
        />
        <span
          class="text-xs font-medium text-base-content/60 uppercase tracking-wider"
          >Explorer</span
        >
      </div>

      <!-- Placeholder content -->
      <div
        class="flex-1 flex flex-col items-center justify-center p-6 text-center"
      >
        <lucide-angular
          [img]="Code2Icon"
          class="w-12 h-12 text-base-content/15 mb-3"
        />
        <span class="text-sm text-base-content/40 font-medium"
          >Code Editor</span
        >
        <span class="text-xs text-base-content/25 mt-1 max-w-[200px]">
          Monaco editor panel — coming soon. Toggle with the panel button.
        </span>
      </div>
    </div>
  `,
})
export class EditorPanelPlaceholderComponent {
  readonly Code2Icon = Code2;
  readonly FolderTreeIcon = FolderTree;
}
