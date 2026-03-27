import {
  Component,
  inject,
  signal,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  LucideAngularModule,
  PanelLeftClose,
  PanelLeft,
  X,
} from 'lucide-angular';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { CodeEditorComponent } from '../code-editor/code-editor.component';
import { EditorService } from '../services/editor.service';
import { GitStatusService } from '../services/git-status.service';
import { GitStatusBarComponent } from '../git-status-bar/git-status-bar.component';

/**
 * EditorPanelComponent - Main container combining file tree sidebar and code editor.
 *
 * Complexity Level: 1 (Simple - delegates all RPC and state to EditorService)
 * Patterns: Composition, signal-based state delegation to EditorService
 *
 * Layout: Split view with file tree sidebar (w-64) on the left and
 * Monaco code editor (flex-1) on the right.
 *
 * Communication flow:
 * 1. Component initializes -> EditorService.loadFileTree() -> RPC to backend
 * 2. Backend responds -> EditorService updates signals internally
 * 3. User clicks file -> EditorService.openFile() -> RPC to backend
 * 4. User presses Ctrl+S -> EditorService.saveFile() -> RPC to backend
 */
@Component({
  selector: 'ptah-editor-panel',
  standalone: true,
  imports: [
    NgClass,
    FileTreeComponent,
    CodeEditorComponent,
    LucideAngularModule,
    GitStatusBarComponent,
  ],
  template: `
    <div
      class="flex flex-col h-full w-full bg-base-100"
      role="main"
      aria-label="Editor Panel"
    >
      <!-- Editor toolbar with Explorer toggle -->
      <div
        class="flex items-center h-8 px-2 bg-base-200 border-b border-base-content/10 flex-shrink-0"
      >
        <button
          class="btn btn-square btn-ghost btn-xs"
          [title]="explorerVisible() ? 'Hide explorer' : 'Show explorer'"
          aria-label="Toggle explorer"
          (click)="toggleExplorer()"
        >
          <lucide-angular
            [img]="explorerVisible() ? PanelLeftCloseIcon : PanelLeftIcon"
            class="w-3.5 h-3.5"
          />
        </button>
        <span
          class="text-xs font-semibold tracking-wider opacity-60 uppercase ml-1 select-none"
          >Editor</span
        >
      </div>

      <!-- Git status bar (below toolbar, above content) -->
      <ptah-git-status-bar />

      <!-- Content area: file tree + code editor -->
      <div class="flex flex-1 min-h-0">
        @if (explorerVisible()) {
          <ptah-file-tree
            [files]="editorService.fileTree()"
            [activeFilePath]="editorService.activeFilePath()"
            (fileSelected)="onFileSelected($event)"
          />
        }
        <div class="flex-1 min-w-0 flex flex-col">
          <!-- Tab bar -->
          @if (editorService.openTabs().length > 0) {
            <div
              class="flex items-center bg-base-300 border-b border-base-content/10 flex-shrink-0 overflow-x-auto scrollbar-thin"
              role="tablist"
              aria-label="Open editor tabs"
            >
              @for (tab of editorService.openTabs(); track tab.filePath) {
                <button
                  class="group flex items-center gap-1 px-3 py-1 text-xs border-r border-base-content/5 whitespace-nowrap select-none transition-colors"
                  [ngClass]="
                    tab.filePath === editorService.activeFilePath()
                      ? 'bg-base-100 text-base-content'
                      : 'bg-base-300 text-base-content/60 hover:bg-base-200'
                  "
                  role="tab"
                  [attr.aria-selected]="
                    tab.filePath === editorService.activeFilePath()
                  "
                  [attr.aria-label]="'Switch to ' + tab.fileName"
                  (click)="onTabClick(tab.filePath)"
                >
                  <span>{{ tab.fileName }}</span>
                  @if (tab.isDirty) {
                    <span
                      class="w-2 h-2 rounded-full bg-warning inline-block flex-shrink-0"
                      title="Unsaved changes"
                    ></span>
                  }
                  <button
                    class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-content/10 transition-opacity"
                    [attr.aria-label]="'Close ' + tab.fileName"
                    (click)="onTabClose($event, tab.filePath)"
                  >
                    <lucide-angular [img]="XIcon" class="w-3 h-3" />
                  </button>
                </button>
              }
            </div>
          }
          <!-- Editor content -->
          @if (editorService.isLoading() && !editorService.hasActiveFile()) {
            <div class="flex-1 flex items-center justify-center">
              <span class="loading loading-spinner loading-md"></span>
            </div>
          } @else {
            <div class="flex-1 min-h-0">
              <ptah-code-editor
                [filePath]="editorService.activeFilePath()"
                [content]="editorService.activeFileContent()"
                (contentChanged)="onContentChanged($event)"
                (fileSaved)="onFileSaved($event)"
              />
            </div>
          }
        </div>
      </div>
      @if (editorService.error()) {
        <div class="toast toast-end toast-bottom">
          <div class="alert alert-error text-sm gap-1">
            <span>{{ editorService.error() }}</span>
            <button class="btn btn-ghost btn-xs" (click)="dismissError()">
              &#x2715;
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorPanelComponent implements OnInit {
  protected readonly editorService = inject(EditorService);
  private readonly gitStatus = inject(GitStatusService);
  protected readonly explorerVisible = signal(true);

  // Icons
  readonly PanelLeftCloseIcon = PanelLeftClose;
  readonly PanelLeftIcon = PanelLeft;
  readonly XIcon = X;

  ngOnInit(): void {
    void this.editorService.loadFileTree();
    this.gitStatus.startPolling();
  }

  protected toggleExplorer(): void {
    this.explorerVisible.update((v) => !v);
  }

  protected onFileSelected(filePath: string): void {
    void this.editorService.openFile(filePath);
  }

  protected onContentChanged(content: string): void {
    const filePath = this.editorService.activeFilePath();
    if (filePath) {
      this.editorService.updateTabContent(filePath, content);
    }
  }

  protected onFileSaved(event: { filePath: string; content: string }): void {
    void this.editorService.saveFile(event.filePath, event.content).then(() => {
      this.editorService.markTabClean(event.filePath);
    });
  }

  protected onTabClick(filePath: string): void {
    this.editorService.switchTab(filePath);
  }

  protected onTabClose(event: MouseEvent, filePath: string): void {
    event.stopPropagation();
    this.editorService.closeTab(filePath);
  }

  protected dismissError(): void {
    this.editorService.clearError();
  }
}
