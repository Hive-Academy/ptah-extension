import {
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  NgZone,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  LucideAngularModule,
  PanelLeftClose,
  PanelLeft,
  X,
  Terminal as TermIcon,
} from 'lucide-angular';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { CodeEditorComponent } from '../code-editor/code-editor.component';
import { EditorService } from '../services/editor.service';
import { GitStatusService } from '../services/git-status.service';
import { GitStatusBarComponent } from '../git-status-bar/git-status-bar.component';
import { TerminalPanelComponent } from '../terminal/terminal-panel.component';

/**
 * EditorPanelComponent - Main container combining file tree sidebar, code editor,
 * and resizable terminal panel.
 *
 * Complexity Level: 2 (Medium - composition, resize drag handling, multiple signal states)
 * Patterns: Composition, signal-based state delegation, horizontal split with drag handle
 *
 * Layout (top to bottom):
 * 1. Toolbar (h-8): Explorer toggle + Terminal toggle
 * 2. Git status bar (h-7, conditional on git repo)
 * 3. Main content (flex-1): File tree sidebar (w-64) + Code editor (flex-1)
 * 4. Resize handle (h-1, conditional on terminal visible)
 * 5. Terminal panel (terminalHeight px, conditional on terminal visible)
 *
 * Communication flow:
 * 1. Component initializes -> EditorService.loadFileTree() -> RPC to backend
 * 2. Backend responds -> EditorService updates signals internally
 * 3. User clicks file -> EditorService.openFile() -> RPC to backend
 * 4. User presses Ctrl+S -> EditorService.saveFile() -> RPC to backend
 * 5. User toggles terminal -> terminalVisible signal toggles terminal panel
 * 6. User drags resize handle -> terminalHeight signal updates terminal size
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
    TerminalPanelComponent,
  ],
  template: `
    <div
      class="flex flex-col h-full w-full bg-base-100"
      role="main"
      aria-label="Editor Panel"
    >
      <!-- Editor toolbar with Explorer toggle + Terminal toggle -->
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

        <!-- Terminal toggle button (right side of toolbar) -->
        <button
          class="btn btn-square btn-ghost btn-xs ml-auto"
          [title]="terminalVisible() ? 'Hide terminal' : 'Show terminal'"
          aria-label="Toggle terminal"
          [class.text-primary]="terminalVisible()"
          (click)="toggleTerminal()"
        >
          <lucide-angular [img]="TerminalIcon" class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Git status bar (below toolbar, above content) -->
      <ptah-git-status-bar />

      <!-- Main content area with optional terminal split -->
      <div class="flex flex-col flex-1 min-h-0">
        <!-- Editor area (takes remaining space above terminal) -->
        <div
          class="flex min-h-0"
          [style.flex]="terminalVisible() ? '1 1 0' : '1 1 auto'"
        >
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

        <!-- Resize handle between editor and terminal -->
        @if (terminalVisible()) {
          <div
            class="h-1 bg-base-300 cursor-row-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0"
            role="separator"
            aria-label="Resize terminal"
            (mousedown)="onTerminalResizeStart($event)"
          ></div>
        }

        <!-- Terminal panel -->
        @if (terminalVisible()) {
          <div
            [style.height.px]="terminalHeight()"
            class="flex-shrink-0 min-h-[100px]"
          >
            <ptah-terminal-panel />
          </div>
        }
      </div>

      <!-- Error toast -->
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
export class EditorPanelComponent implements OnInit, OnDestroy {
  protected readonly editorService = inject(EditorService);
  private readonly gitStatus = inject(GitStatusService);
  private readonly ngZone = inject(NgZone);
  protected readonly explorerVisible = signal(true);

  /** Whether the terminal panel is visible. */
  protected readonly terminalVisible = signal(false);

  /** Height of the terminal panel in pixels. Default 200px, minimum 100px. */
  protected readonly terminalHeight = signal(200);

  // Icons
  readonly PanelLeftCloseIcon = PanelLeftClose;
  readonly PanelLeftIcon = PanelLeft;
  readonly XIcon = X;
  readonly TerminalIcon = TermIcon;

  /** Bound mouse event handlers for resize drag (stored for cleanup). */
  private _resizeMouseMove: ((e: MouseEvent) => void) | null = null;
  private _resizeMouseUp: (() => void) | null = null;

  ngOnInit(): void {
    void this.editorService.loadFileTree();
    this.gitStatus.startPolling();
  }

  ngOnDestroy(): void {
    this.gitStatus.stopPolling();
    this.cleanupResizeListeners();
  }

  protected toggleExplorer(): void {
    this.explorerVisible.update((v) => !v);
  }

  protected toggleTerminal(): void {
    this.terminalVisible.update((v) => !v);
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

  /**
   * Handle mousedown on the terminal resize handle.
   * Starts tracking mouse movement to resize the terminal panel.
   *
   * The drag operates by calculating the delta from the mouse start Y position
   * and subtracting it from the initial terminal height. The terminal height
   * is clamped to a minimum of 100px and a maximum of 60% of the component height.
   */
  protected onTerminalResizeStart(event: MouseEvent): void {
    event.preventDefault();

    const startY = event.clientY;
    const startHeight = this.terminalHeight();

    // Run outside Angular zone to avoid triggering change detection on every mousemove
    this.ngZone.runOutsideAngular(() => {
      this._resizeMouseMove = (e: MouseEvent) => {
        // Moving mouse UP (negative deltaY) should INCREASE terminal height
        const deltaY = startY - e.clientY;
        const newHeight = startHeight + deltaY;

        // Clamp: minimum 100px, maximum 60% of component height
        const hostElement = (event.target as HTMLElement).closest(
          '[role="main"]',
        );
        const maxHeight = hostElement ? hostElement.clientHeight * 0.6 : 600;
        const clampedHeight = Math.max(100, Math.min(newHeight, maxHeight));

        // Update signal inside Angular zone so template bindings update
        this.ngZone.run(() => {
          this.terminalHeight.set(clampedHeight);
        });
      };

      this._resizeMouseUp = () => {
        this.cleanupResizeListeners();
      };

      document.addEventListener('mousemove', this._resizeMouseMove);
      document.addEventListener('mouseup', this._resizeMouseUp);
    });
  }

  /**
   * Remove resize drag event listeners from the document.
   */
  private cleanupResizeListeners(): void {
    if (this._resizeMouseMove) {
      document.removeEventListener('mousemove', this._resizeMouseMove);
      this._resizeMouseMove = null;
    }
    if (this._resizeMouseUp) {
      document.removeEventListener('mouseup', this._resizeMouseUp);
      this._resizeMouseUp = null;
    }
  }
}
