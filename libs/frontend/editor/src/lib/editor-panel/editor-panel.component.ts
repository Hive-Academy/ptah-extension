import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  NgZone,
  afterNextRender,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  LucideAngularModule,
  PanelLeftClose,
  PanelLeft,
  X,
  Columns2,
  TerminalSquare,
} from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';
import { CodeEditorComponent } from '../code-editor/code-editor.component';
import { DiffViewComponent } from '../diff-view/diff-view.component';
import { EditorService } from '../services/editor.service';
import { GitStatusService } from '../services/git-status.service';
import { VimModeService } from '../services/vim-mode.service';
import { GitStatusBarComponent } from '../git-status-bar/git-status-bar.component';
import { TerminalPanelComponent } from '../terminal/terminal-panel.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import {
  FileTreeContextMenuComponent,
  type ContextMenuAction,
} from '../file-tree/file-tree-context-menu.component';
import { QuickOpenComponent } from '../quick-open/quick-open.component';
import type { FileTreeNode } from '../models/file-tree.model';

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
 * 1. Workspace switch coordination -> EditorService.switchWorkspace() -> loadFileTree() -> RPC to backend
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
    CodeEditorComponent,
    DiffViewComponent,
    LucideAngularModule,
    GitStatusBarComponent,
    TerminalPanelComponent,
    SidebarComponent,
    FileTreeContextMenuComponent,
    QuickOpenComponent,
  ],
  template: `
    <div
      class="flex flex-col h-full w-full bg-base-100"
      role="main"
      aria-label="Editor Panel"
    >
      <!-- Editor toolbar - minimal design with grouped actions -->
      <div
        class="flex items-center h-8 px-2 bg-base-200 border-b border-base-content/10 flex-shrink-0"
      >
        <!-- Left: View controls -->
        <div class="flex items-center gap-0.5">
          <button
            class="btn btn-ghost btn-xs px-2 text-base-content/60 hover:text-base-content"
            [class.text-primary]="sidebarVisible()"
            [title]="sidebarVisible() ? 'Hide sidebar' : 'Show sidebar'"
            aria-label="Toggle sidebar"
            (click)="toggleSidebar()"
          >
            <lucide-angular
              [img]="sidebarVisible() ? PanelLeftCloseIcon : PanelLeftIcon"
              class="w-4 h-4"
            />
          </button>
        </div>

        <!-- Right: Editor controls -->
        <div class="flex items-center gap-0.5 ml-auto">
          <!-- Vim mode toggle (always visible) -->
          <button
            class="px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors"
            [class]="
              vimModeService.enabled()
                ? 'bg-primary/15 text-primary'
                : 'text-base-content/30 hover:text-base-content/50 hover:bg-base-content/5'
            "
            [title]="
              vimModeService.enabled() ? 'Disable Vim mode' : 'Enable Vim mode'
            "
            aria-label="Toggle Vim mode"
            (click)="toggleVimMode()"
          >
            VIM
          </button>

          <button
            class="btn btn-ghost btn-xs px-2 text-base-content/60 hover:text-base-content"
            [class.text-primary]="editorService.splitActive()"
            [disabled]="!editorService.hasActiveFile()"
            title="Split editor"
            aria-label="Split editor"
            (click)="toggleSplit()"
          >
            <lucide-angular [img]="SplitIcon" class="w-4 h-4" />
          </button>

          <button
            class="btn btn-ghost btn-xs px-2 text-base-content/60 hover:text-base-content"
            [class.text-primary]="editorService.terminalVisible()"
            [title]="
              editorService.terminalVisible()
                ? 'Hide terminal'
                : 'Show terminal'
            "
            aria-label="Toggle terminal"
            (click)="toggleTerminal()"
          >
            <lucide-angular [img]="TerminalIcon" class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Git status bar (below toolbar, above content) -->
      <ptah-git-status-bar />

      <!-- Main content area with optional terminal split -->
      <div class="flex flex-col flex-1 min-h-0">
        <!-- Editor area (takes remaining space above terminal) -->
        <div
          class="flex min-h-0"
          [style.flex]="editorService.terminalVisible() ? '1 1 0' : '1 1 auto'"
        >
          @if (sidebarVisible()) {
            <ptah-sidebar
              [width]="sidebarWidth()"
              [files]="editorService.fileTree()"
              [activeFilePath]="editorService.activeFilePath()"
              [changedFiles]="gitStatus.files()"
              (fileSelected)="onFileSelected($event)"
              (diffRequested)="onDiffRequested($event)"
              (searchResultSelected)="onSearchResultSelected($event)"
              (contextMenuRequested)="onContextMenu($event)"
            />

            <!-- Sidebar resize handle (vertical, draggable) -->
            <div
              class="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0"
              role="separator"
              aria-label="Resize sidebar"
              (mousedown)="onSidebarResizeStart($event)"
            ></div>
          }

          <!-- Editor panes container (flex row for split view) -->
          <div class="flex-1 min-w-0 flex flex-row">
            <!-- LEFT PANE (primary editor) -->
            <div
              class="min-w-0 flex flex-col"
              [class.border-l-2]="
                editorService.splitActive() &&
                editorService.focusedPane() === 'left'
              "
              [class.border-primary]="
                editorService.splitActive() &&
                editorService.focusedPane() === 'left'
              "
              [style.flex]="
                editorService.splitActive()
                  ? '0 0 ' + splitLeftPercent() + '%'
                  : '1 1 auto'
              "
              (click)="onPaneClick('left')"
            >
              <!-- Tab bar - minimal, clean design -->
              @if (editorService.openTabs().length > 0) {
                <div
                  class="flex items-center bg-base-300/50 border-b border-base-content/5 flex-shrink-0 overflow-x-auto scrollbar-thin"
                  role="tablist"
                  aria-label="Open editor tabs"
                >
                  @for (tab of editorService.openTabs(); track tab.filePath) {
                    <button
                      class="group flex items-center gap-2 px-3 py-1.5 text-xs whitespace-nowrap select-none transition-colors"
                      [ngClass]="
                        tab.filePath === editorService.activeFilePath()
                          ? 'bg-base-100 text-base-content'
                          : 'bg-transparent text-base-content/50 hover:text-base-content/70 hover:bg-base-200/50'
                      "
                      role="tab"
                      [attr.aria-selected]="
                        tab.filePath === editorService.activeFilePath()
                      "
                      [attr.aria-label]="'Switch to ' + tab.fileName"
                      (click)="onTabClick(tab.filePath)"
                    >
                      <span class="truncate max-w-[120px]">{{
                        tab.fileName
                      }}</span>
                      @if (tab.isDirty) {
                        <span
                          class="w-1.5 h-1.5 rounded-full bg-primary/70 flex-shrink-0"
                          title="Unsaved changes"
                        ></span>
                      }
                      <button
                        class="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-base-content/10 transition-all"
                        [attr.aria-label]="'Close ' + tab.fileName"
                        (click)="onTabClose($event, tab.filePath)"
                      >
                        <lucide-angular [img]="XIcon" class="w-3 h-3" />
                      </button>
                    </button>
                  }
                </div>
              }
              <!-- Left pane editor content -->
              @if (
                editorService.isLoading() && !editorService.hasActiveFile()
              ) {
                <div class="flex-1 flex items-center justify-center">
                  <span class="loading loading-spinner loading-md"></span>
                </div>
              } @else {
                <div class="flex-1 min-h-0">
                  @if (editorService.activeDiffTab()) {
                    <ptah-diff-view
                      [filePath]="
                        editorService.activeDiffTab()!.diffRelativePath!
                      "
                      [originalContent]="
                        editorService.activeDiffTab()!.originalContent!
                      "
                      [modifiedContent]="editorService.activeDiffTab()!.content"
                    />
                  } @else if (editorService.isActiveFileImage()) {
                    <div
                      class="h-full w-full flex items-center justify-center bg-base-100 overflow-auto p-4"
                    >
                      <img
                        [src]="imageFileUrl()"
                        [alt]="editorService.activeFilePath()"
                        class="max-w-full max-h-full object-contain"
                        draggable="false"
                      />
                    </div>
                  } @else {
                    <ptah-code-editor
                      [filePath]="editorService.activeFilePath()"
                      [content]="editorService.activeFileContent()"
                      [isFocused]="
                        editorService.splitActive()
                          ? editorService.focusedPane() === 'left'
                          : true
                      "
                      (contentChanged)="onContentChanged($event)"
                      (fileSaved)="onFileSaved($event)"
                    />
                  }
                </div>
              }
            </div>

            <!-- SPLIT DIVIDER (vertical, draggable) -->
            @if (editorService.splitActive()) {
              <div
                class="w-1 bg-base-300 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0"
                role="separator"
                aria-label="Resize split panes"
                (mousedown)="onSplitResizeStart($event)"
              ></div>
            }

            <!-- RIGHT PANE (split editor) -->
            @if (editorService.splitActive()) {
              <div
                class="flex-1 min-w-0 flex flex-col"
                [class.border-l-2]="editorService.focusedPane() === 'right'"
                [class.border-primary]="editorService.focusedPane() === 'right'"
                (click)="onPaneClick('right')"
              >
                <!-- Right pane header bar with file name and close button -->
                <div
                  class="flex items-center bg-base-300/50 border-b border-base-content/5 flex-shrink-0 px-3 py-1.5"
                >
                  <span
                    class="text-xs text-base-content/60 truncate"
                    [attr.title]="editorService.splitFilePath()"
                    >{{ splitFileName() }}</span
                  >
                  <button
                    class="ml-auto p-0.5 rounded opacity-50 hover:opacity-100 hover:bg-base-content/10 transition-all"
                    aria-label="Close split pane"
                    title="Close split pane"
                    (click)="closeSplit($event)"
                  >
                    <lucide-angular [img]="XIcon" class="w-3 h-3" />
                  </button>
                </div>
                <!-- Right pane editor content -->
                <div class="flex-1 min-h-0">
                  <ptah-code-editor
                    [filePath]="editorService.splitFilePath()"
                    [content]="editorService.splitFileContent()"
                    [isFocused]="editorService.focusedPane() === 'right'"
                    (contentChanged)="onSplitContentChanged($event)"
                    (fileSaved)="onSplitFileSaved($event)"
                  />
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Resize handle between editor and terminal -->
        @if (editorService.terminalVisible()) {
          <div
            class="h-1 bg-base-300 cursor-row-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0"
            role="separator"
            aria-label="Resize terminal"
            (mousedown)="onTerminalResizeStart($event)"
          ></div>
        }

        <!-- Terminal panel -->
        @if (editorService.terminalVisible()) {
          <div
            [style.height.px]="editorService.terminalHeight()"
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

      <!-- Context menu (rendered at page level to avoid overflow clipping) -->
      @if (ctxMenuVisible()) {
        <ptah-file-tree-context-menu
          [x]="ctxMenuX()"
          [y]="ctxMenuY()"
          [node]="ctxMenuNode()"
          (action)="onContextMenuAction($event)"
          (closed)="ctxMenuVisible.set(false)"
        />
      }

      <!-- Delete confirmation modal -->
      @if (deleteTarget()) {
        <div class="modal modal-open z-50">
          <div class="modal-box max-w-sm">
            <h3 class="font-bold text-base">
              Delete {{ deleteTarget()!.name }}?
            </h3>
            <p class="py-3 text-sm text-base-content/70">
              @if (deleteTarget()!.type === 'directory') {
                This will permanently delete the folder and all its contents.
              } @else {
                This will permanently delete this file.
              }
            </p>
            <div class="modal-action">
              <button class="btn btn-sm" (click)="deleteTarget.set(null)">
                Cancel
              </button>
              <button class="btn btn-sm btn-error" (click)="confirmDelete()">
                Delete
              </button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="deleteTarget.set(null)"></div>
        </div>
      }

      <!-- Name input modal (new file/folder/rename) -->
      @if (inputDialogTitle()) {
        <div class="modal modal-open z-50">
          <div class="modal-box max-w-sm">
            <h3 class="font-bold text-base">{{ inputDialogTitle() }}</h3>
            <input
              #nameInput
              type="text"
              class="input input-bordered input-sm w-full mt-3"
              [value]="inputDialogValue()"
              (keydown.enter)="submitInputDialog(nameInput.value)"
              (keydown.escape)="closeInputDialog()"
              placeholder="Enter name..."
            />
            @if (inputDialogError()) {
              <p class="text-error text-xs mt-1">{{ inputDialogError() }}</p>
            }
            <div class="modal-action">
              <button class="btn btn-sm" (click)="closeInputDialog()">
                Cancel
              </button>
              <button
                class="btn btn-sm btn-primary"
                (click)="submitInputDialog(nameInput.value)"
              >
                OK
              </button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="closeInputDialog()"></div>
        </div>
      }

      <!-- Quick Open file picker (Ctrl+P / Cmd+P) -->
      @if (quickOpenVisible()) {
        <ptah-quick-open
          (fileSelected)="onQuickOpenFileSelected($event)"
          (closed)="quickOpenVisible.set(false)"
        />
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
  protected readonly gitStatus = inject(GitStatusService);
  protected readonly vimModeService = inject(VimModeService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly ngZone = inject(NgZone);
  protected readonly sidebarVisible = signal(true);

  /** Width of the sidebar in pixels. Default 256px, min 160px, max 480px. */
  protected readonly sidebarWidth = signal(256);

  /** Whether the Quick Open file picker is visible (Ctrl+P / Cmd+P). */
  protected readonly quickOpenVisible = signal(false);

  /**
   * Ratio of the left pane width as a percentage (0-100).
   * Default 50 for a 50/50 split. Adjusted by the split divider drag.
   */
  protected readonly splitLeftPercent = signal(50);

  // Icons
  readonly PanelLeftCloseIcon = PanelLeftClose;
  readonly PanelLeftIcon = PanelLeft;
  readonly XIcon = X;
  readonly SplitIcon = Columns2;
  readonly TerminalIcon = TerminalSquare;

  /** Bound mouse event handlers for terminal resize drag (stored for cleanup). */
  private _resizeMouseMove: ((e: MouseEvent) => void) | null = null;
  private _resizeMouseUp: (() => void) | null = null;

  /** Bound mouse event handlers for sidebar resize drag (stored for cleanup). */
  private _sidebarResizeMouseMove: ((e: MouseEvent) => void) | null = null;
  private _sidebarResizeMouseUp: (() => void) | null = null;

  /** Bound mouse event handlers for split divider drag (stored for cleanup). */
  private _splitResizeMouseMove: ((e: MouseEvent) => void) | null = null;
  private _splitResizeMouseUp: (() => void) | null = null;

  /** Bound keydown handler for Ctrl+P / Cmd+P Quick Open shortcut. */
  private readonly _quickOpenKeydown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      this.ngZone.run(() => {
        this.quickOpenVisible.set(true);
      });
    }
  };

  ngOnInit(): void {
    // Bootstrap file tree if a workspace is already active.
    // When the editor chunk loads after workspace coordination has already
    // fired, switchWorkspace() would never be called, leaving the explorer empty.
    const workspaceRoot = this.vscodeService.config().workspaceRoot;
    if (workspaceRoot) {
      this.editorService.switchWorkspace(workspaceRoot);
    }

    this.gitStatus.startListening();

    // Listen for file:tree-changed push events from the backend so the
    // file explorer updates when files are added/deleted (e.g. git pull).
    this.editorService.startFileTreeWatcher();

    // Load vim mode preference from backend settings
    void this.vimModeService.loadPreference();

    // Register Ctrl+P / Cmd+P keyboard shortcut for Quick Open
    document.addEventListener('keydown', this._quickOpenKeydown);
  }

  ngOnDestroy(): void {
    this.gitStatus.stopListening();
    this.editorService.stopFileTreeWatcher();
    this.cleanupResizeListeners();
    this.cleanupSidebarResizeListeners();
    this.cleanupSplitResizeListeners();
    document.removeEventListener('keydown', this._quickOpenKeydown);
  }

  protected toggleSidebar(): void {
    this.sidebarVisible.update((v) => !v);
  }

  protected toggleVimMode(): void {
    void this.vimModeService.toggle();
  }

  protected toggleTerminal(): void {
    this.editorService.toggleTerminal();
  }

  /**
   * Toggle split editor mode. If no split is active, opens the current file
   * in a split pane. If split is active, closes the split.
   */
  protected toggleSplit(): void {
    if (this.editorService.splitActive()) {
      this.editorService.closeSplit();
    } else {
      const currentFile = this.editorService.activeFilePath();
      if (currentFile) {
        void this.editorService.openFileInSplit(currentFile);
      }
    }
  }

  /**
   * Close the split pane. Stops event propagation to prevent the click
   * from triggering pane focus change.
   */
  protected closeSplit(event: MouseEvent): void {
    event.stopPropagation();
    this.editorService.closeSplit();
  }

  /**
   * Handle click on a pane to update which pane has focus.
   */
  protected onPaneClick(pane: 'left' | 'right'): void {
    this.editorService.setFocusedPane(pane);
  }

  protected readonly imageFileUrl = computed(() => {
    const filePath = this.editorService.activeFilePath();
    if (!filePath) return '';
    const normalized = filePath.replace(/\\/g, '/');
    const encoded = normalized.split('/').map(encodeURIComponent).join('/');
    return 'file:///' + encoded;
  });

  /**
   * Display file name for the split pane header, derived from splitFilePath.
   */
  protected readonly splitFileName = computed(() => {
    const path = this.editorService.splitFilePath();
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  });

  /**
   * Handle content changes in the split (right) pane editor.
   */
  protected onSplitContentChanged(content: string): void {
    this.editorService.updateSplitContent(content);
  }

  /**
   * Handle file save events from the split (right) pane editor.
   */
  protected onSplitFileSaved(event: {
    filePath: string;
    content: string;
  }): void {
    void this.editorService.saveFile(event.filePath, event.content);
  }

  protected onFileSelected(filePath: string): void {
    void this.editorService.openFile(filePath);
  }

  /** Handle file selection from the Quick Open picker */
  protected onQuickOpenFileSelected(event: { filePath: string }): void {
    this.quickOpenVisible.set(false);
    const wsRoot = this.editorService.activeWorkspacePath;
    const absolutePath = wsRoot
      ? wsRoot.replace(/\\/g, '/').replace(/\/$/, '') + '/' + event.filePath
      : event.filePath;
    void this.editorService.openFile(absolutePath);
  }

  protected onSearchResultSelected(event: {
    filePath: string;
    line: number;
  }): void {
    void this.editorService.openFileAtLine(event.filePath, event.line);
  }

  protected onDiffRequested(relativePath: string): void {
    const workspaceRoot = this.gitStatus.activeWorkspacePath();
    if (!workspaceRoot) return;
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
    const root = normalizedRoot.endsWith('/')
      ? normalizedRoot
      : normalizedRoot + '/';
    const absolutePath = root + relativePath.replace(/\\/g, '/');
    void this.editorService.openDiff(relativePath, absolutePath);
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

  // ============================================================================
  // CONTEXT MENU & FILE CRUD
  // ============================================================================

  protected readonly ctxMenuVisible = signal(false);
  protected readonly ctxMenuX = signal(0);
  protected readonly ctxMenuY = signal(0);
  protected readonly ctxMenuNode = signal<FileTreeNode | null>(null);
  protected readonly deleteTarget = signal<FileTreeNode | null>(null);

  // Input dialog state (replaces window.prompt which is unavailable in Electron)
  protected readonly inputDialogTitle = signal('');
  protected readonly inputDialogValue = signal('');
  protected readonly inputDialogError = signal('');
  private inputDialogCallback: ((name: string) => void) | null = null;

  protected onContextMenu(event: {
    event: MouseEvent;
    node: FileTreeNode | null;
  }): void {
    event.event.preventDefault();
    this.ctxMenuX.set(event.event.clientX);
    this.ctxMenuY.set(event.event.clientY);
    this.ctxMenuNode.set(event.node);
    this.ctxMenuVisible.set(true);
  }

  protected onContextMenuAction(action: {
    type: ContextMenuAction;
    node: FileTreeNode | null;
  }): void {
    this.ctxMenuVisible.set(false);
    const node = action.node;

    switch (action.type) {
      case 'newFile':
      case 'newFolder': {
        const type = action.type === 'newFile' ? 'file' : 'folder';
        const targetDir = node?.type === 'directory' ? node : null;
        let dirPath: string;

        if (targetDir) {
          dirPath = targetDir.path.replace(/\\/g, '/');
        } else if (node) {
          const parentPath = node.path.replace(/\\/g, '/');
          dirPath = parentPath.substring(0, parentPath.lastIndexOf('/'));
        } else {
          const root = this.editorService.activeWorkspacePath;
          if (!root) return;
          dirPath = root.replace(/\\/g, '/');
        }

        this.openInputDialog(
          type === 'file' ? 'New file name' : 'New folder name',
          '',
          (name) => {
            const newPath = dirPath + '/' + name;
            if (type === 'file') {
              void this.editorService.createFile(newPath);
            } else {
              void this.editorService.createFolder(newPath);
            }
          },
        );
        break;
      }
      case 'rename':
        if (node) {
          this.openInputDialog('Rename to', node.name, (newName) => {
            if (newName === node.name) return;
            const currentPath = node.path.replace(/\\/g, '/');
            const parentPath = currentPath.substring(
              0,
              currentPath.lastIndexOf('/'),
            );
            void this.editorService.renameItem(
              currentPath,
              parentPath + '/' + newName,
            );
          });
        }
        break;
      case 'delete':
        if (node) {
          this.deleteTarget.set(node);
        }
        break;
      case 'copyPath':
        if (node) {
          void navigator.clipboard.writeText(node.path);
        }
        break;
    }
  }

  protected confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target) return;
    this.deleteTarget.set(null);
    void this.editorService.deleteItem(
      target.path,
      target.type === 'directory',
    );
  }

  private openInputDialog(
    title: string,
    initialValue: string,
    callback: (name: string) => void,
  ): void {
    this.inputDialogTitle.set(title);
    this.inputDialogValue.set(initialValue);
    this.inputDialogError.set('');
    this.inputDialogCallback = callback;

    // Auto-focus the input after the modal renders
    afterNextRender(() => {
      const input = document.querySelector<HTMLInputElement>(
        '.modal-open input[type="text"]',
      );
      if (input) {
        input.focus();
        // For rename, select just the filename part (before last dot)
        if (initialValue) {
          const dotIdx = initialValue.lastIndexOf('.');
          input.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialValue.length);
        }
      }
    });
  }

  protected submitInputDialog(value: string): void {
    const name = value.trim();
    if (!name) {
      this.inputDialogError.set('Name cannot be empty.');
      return;
    }
    if (name.includes('/') || name.includes('\\')) {
      this.inputDialogError.set('Name cannot contain / or \\.');
      return;
    }
    const cb = this.inputDialogCallback;
    this.closeInputDialog();
    cb?.(name);
  }

  protected closeInputDialog(): void {
    this.inputDialogTitle.set('');
    this.inputDialogValue.set('');
    this.inputDialogError.set('');
    this.inputDialogCallback = null;
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
    const startHeight = this.editorService.terminalHeight();

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
          this.editorService.setTerminalHeight(clampedHeight);
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

  // ============================================================================
  // SIDEBAR RESIZE
  // ============================================================================

  /**
   * Handle mousedown on the sidebar resize handle.
   * Starts tracking horizontal mouse movement to resize the sidebar.
   * Width is clamped between 160px and 480px.
   */
  protected onSidebarResizeStart(event: MouseEvent): void {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = this.sidebarWidth();

    this.ngZone.runOutsideAngular(() => {
      this._sidebarResizeMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - startX;
        const newWidth = startWidth + deltaX;
        const clampedWidth = Math.max(160, Math.min(480, newWidth));

        this.ngZone.run(() => {
          this.sidebarWidth.set(clampedWidth);
        });
      };

      this._sidebarResizeMouseUp = () => {
        this.cleanupSidebarResizeListeners();
      };

      document.addEventListener('mousemove', this._sidebarResizeMouseMove);
      document.addEventListener('mouseup', this._sidebarResizeMouseUp);
    });
  }

  private cleanupSidebarResizeListeners(): void {
    if (this._sidebarResizeMouseMove) {
      document.removeEventListener('mousemove', this._sidebarResizeMouseMove);
      this._sidebarResizeMouseMove = null;
    }
    if (this._sidebarResizeMouseUp) {
      document.removeEventListener('mouseup', this._sidebarResizeMouseUp);
      this._sidebarResizeMouseUp = null;
    }
  }

  // ============================================================================
  // SPLIT DIVIDER RESIZE
  // ============================================================================

  /**
   * Handle mousedown on the split divider.
   * Starts tracking horizontal mouse movement to resize the split panes.
   * The left pane percentage is clamped between 20% and 80%.
   */
  protected onSplitResizeStart(event: MouseEvent): void {
    event.preventDefault();

    const startX = event.clientX;
    const startPercent = this.splitLeftPercent();

    // Get the parent container width for percentage calculation
    const container = (event.target as HTMLElement).parentElement;
    if (!container) return;
    const containerWidth = container.clientWidth;

    this.ngZone.runOutsideAngular(() => {
      this._splitResizeMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - startX;
        const deltaPercent = (deltaX / containerWidth) * 100;
        const newPercent = startPercent + deltaPercent;

        // Clamp between 20% and 80% to prevent either pane from becoming too small
        const clampedPercent = Math.max(20, Math.min(80, newPercent));

        this.ngZone.run(() => {
          this.splitLeftPercent.set(clampedPercent);
        });
      };

      this._splitResizeMouseUp = () => {
        this.cleanupSplitResizeListeners();
      };

      document.addEventListener('mousemove', this._splitResizeMouseMove);
      document.addEventListener('mouseup', this._splitResizeMouseUp);
    });
  }

  /**
   * Remove split divider resize drag event listeners from the document.
   */
  private cleanupSplitResizeListeners(): void {
    if (this._splitResizeMouseMove) {
      document.removeEventListener('mousemove', this._splitResizeMouseMove);
      this._splitResizeMouseMove = null;
    }
    if (this._splitResizeMouseUp) {
      document.removeEventListener('mouseup', this._splitResizeMouseUp);
      this._splitResizeMouseUp = null;
    }
  }
}
