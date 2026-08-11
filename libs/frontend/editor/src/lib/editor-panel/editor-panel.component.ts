import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ElementRef,
  NgZone,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  LucideAngularModule,
  PanelLeftClose,
  PanelLeft,
  X,
  Columns2,
  TerminalSquare,
  AlertTriangle,
} from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';
import { CodeEditorComponent } from '../code-editor/code-editor.component';
import { DiffViewComponent } from '../diff-view/diff-view.component';
import { EditorService } from '../services/editor.service';
import type {
  EditorTab,
  GitApplyHunksResult,
  HunkApplyRequest,
  OpenDiffRequest,
} from '../services/editor/editor-tab.types';
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
            data-testid="editor-terminal-toggle"
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
              (focusin)="onPaneClick('left')"
            >
              <!-- Tab bar - minimal, clean design -->
              @if (editorService.openTabs().length > 0) {
                <div
                  class="flex items-center bg-base-300/50 border-b border-base-content/5 flex-shrink-0 overflow-x-auto scrollbar-thin"
                  role="tablist"
                  aria-label="Open editor tabs"
                >
                  @for (tab of editorService.openTabs(); track tab.filePath) {
                    <!-- The tab chrome is a PRESENTATIONAL wrapper, not a
                         control. role="presentation" keeps it out of the
                         accessibility tree so the inner role="tab" stays
                         effectively a child of the role="tablist" above; the
                         label button and the close button are SIBLINGS, never
                         nested (D1 AC1 — a button inside a button is invalid
                         HTML and the browser silently flattens it). -->
                    <div
                      class="group flex items-center pr-3 text-xs whitespace-nowrap select-none transition-colors"
                      [ngClass]="
                        tab.filePath === editorService.activeFilePath()
                          ? 'bg-base-100 text-base-content'
                          : 'bg-transparent text-base-content/50 hover:text-base-content/70 hover:bg-base-200/50'
                      "
                      role="presentation"
                    >
                      <button
                        type="button"
                        class="flex items-center gap-2 py-1.5 pl-3 pr-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]"
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
                        @if (tab.diff && tab.diff.status !== 'fresh') {
                          <lucide-angular
                            [img]="AlertTriangleIcon"
                            class="w-3 h-3 flex-shrink-0"
                            [class.text-error]="tab.diff.status === 'error'"
                            [class.text-warning]="tab.diff.status === 'stale'"
                            [class.opacity-50]="
                              tab.diff.status === 'refreshing'
                            "
                            data-testid="diff-tab-status-glyph"
                            [attr.title]="diffStatusTitle(tab)"
                            [attr.aria-label]="diffStatusTitle(tab)"
                          />
                        }
                      </button>
                      <!-- focus-visible:opacity-100 is not visual drift: this
                           control is opacity-0 until hover, so a keyboard user
                           tabbing onto it previously saw NOTHING (D1 AC7). -->
                      <button
                        type="button"
                        class="p-0.5 rounded opacity-0 group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100 hover:bg-base-content/10 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]"
                        [attr.aria-label]="'Close ' + tab.fileName"
                        (click)="onTabClose(tab.filePath)"
                      >
                        <lucide-angular [img]="XIcon" class="w-3 h-3" />
                      </button>
                    </div>
                  }
                </div>
              }
              <!-- Left pane editor content.

                   THREE ALWAYS-MOUNTED LAYERS, not a structural @if chain.
                   Both Monaco surfaces stay in the DOM for the life of the
                   panel and are only visually hidden; whichever one is not in
                   use is absolutely positioned, so it occupies no layout.

                   This is load-bearing twice over:
                   - The loading spinner is an OVERLAY, not an else-branch. A
                     structural swap here destroyed the code-editor instance the
                     first time a never-visited workspace was opened
                     (EditorWorkspaceHelper clears activeFilePath then sets
                     isLoading), throwing away the Monaco model/view-state cache
                     for EVERY open workspace (TASK_2026_154 Serious #2).
                   - Until TASK_2026_173 (N1) the final @else branch WAS
                     <ptah-code-editor>, so merely activating a diff tab
                     reintroduced exactly that teardown, and the diff editor
                     itself was reconstructed from scratch on every return
                     switch (B1). Neither surface is unmounted any more.

                   The code editor is fed undefined while a diff or an image is
                   showing: activeFilePath() then holds a diff KEY (or an image
                   path), which is not a text file it should ever open. -->
              <!-- overflow-hidden and isolate are load-bearing, not tidying.
                   The children below are absolutely positioned with z-index
                   auto, so CSS 2.1 paint order puts them in layer 8 while the
                   terminal separator and terminal panel — in-flow siblings of
                   this region — paint in layer 4. Without a clip, any Monaco
                   surface that overflows paints OVER both, and because
                   hit-testing follows paint order it also swallows the
                   mousedown on [aria-label="Resize terminal"], which is why
                   the terminal stopped being resizable (TASK_2026_196).
                   The isolate utility keeps that stacking contained here. -->
              <div class="flex-1 min-h-0 relative overflow-hidden isolate">
                <ptah-diff-view
                  class="absolute inset-0"
                  [class.invisible]="!editorService.activeDiffTab()"
                  [diffTab]="editorService.activeDiffTab()"
                  [openDiffKeys]="openDiffKeys()"
                  [applyHunks]="applyHunks"
                  (retryRequested)="onDiffRetry($event)"
                />
                <ptah-code-editor
                  class="absolute inset-0"
                  [class.invisible]="
                    !!editorService.activeDiffTab() ||
                    editorService.isActiveFileImage()
                  "
                  [filePath]="codeEditorPath()"
                  [content]="codeEditorContent()"
                  [contentIsPersisted]="sharedContentIsPersisted()"
                  [isFocused]="
                    editorService.splitActive()
                      ? editorService.focusedPane() === 'left'
                      : true
                  "
                  (contentChanged)="onContentChanged($event)"
                  (fileSaved)="onFileSaved($event)"
                />
                @if (editorService.isActiveFileImage()) {
                  <div
                    class="absolute inset-0 flex items-center justify-center bg-base-100 overflow-auto p-4"
                  >
                    <img
                      [src]="imageFileUrl()"
                      [alt]="editorService.activeFilePath()"
                      class="max-w-full max-h-full object-contain"
                      draggable="false"
                    />
                  </div>
                }
                @if (
                  editorService.isLoading() && !editorService.hasActiveFile()
                ) {
                  <div
                    class="absolute inset-0 flex items-center justify-center bg-base-100"
                  >
                    <span class="loading loading-spinner loading-md"></span>
                  </div>
                }
              </div>
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
                (focusin)="onPaneClick('right')"
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
                    [contentIsPersisted]="sharedContentIsPersisted()"
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

      <!-- Delete confirmation (TASK_2026_216).

           A native dialog element opened with showModal(), NOT a positioned
           div, matching the shape TASK_2026_227 gave the revert and
           save-conflict dialogs. Read the long version in
           diff-view.component.ts: a z-index only orders siblings inside the
           nearest ancestor that establishes a stacking context, so a dialog
           that bids with z-50 is reachable only for as long as nothing above
           its stacking context outbids it. The top layer showModal() promotes
           into is painted after the whole document and is outside every
           stacking context by construction, so reachability stops depending on
           that ordering at all.

           HONEST SCOPE, because the carrier overstates it: this modal is
           declared at the END of this template, OUTSIDE the isolation:isolate
           wrapper opened for the Monaco surfaces above — that wrapper is what
           trapped the revert dialog, which ptah-diff-view renders from inside
           it. Only the gridstack tile ever contained this one, and a live probe
           on the pre-fix markup found the buttons on top, not the canvas
           (apps/ptah-electron-e2e/src/specs/editor/file-ops-dialogs-top-layer.spec.ts).
           So this is hardening plus the accessibility shape the task was
           originally filed for — role, aria, focus in and out, no click-to-
           dismiss on a destructive question — not a reproduced defect.

           modal-open is gone: daisyUI reveals a dialog through its modal[open]
           rule, and leaving the class on would re-apply the wrapper's own scrim
           on top of ::backdrop. The modal-backdrop child is inert and
           aria-hidden — a click handler there (or a form with method="dialog",
           daisyUI's click-to-close idiom) is exactly what must not exist on a
           dialog that destroys a file, and daisyUI gives that child
           z-index: -1 so it cannot take the buttons' clicks in either shape.

           Tab containment is the UA's here rather than hand-rolled: showModal()
           confines sequential focus navigation to the dialog. The save-conflict
           dialog below still carries its own two-way toggle because that
           predates its conversion; there is no reason to add a second one. -->
      @if (deleteTarget()) {
        <dialog
          #deleteDialog
          class="modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ptah-delete-confirm-title"
          aria-describedby="ptah-delete-confirm-desc"
          data-testid="delete-confirm-dialog"
          (cancel)="onDeleteDialogCancel($event)"
        >
          <div class="modal-box max-w-sm">
            <h3 id="ptah-delete-confirm-title" class="font-bold text-base">
              Delete {{ deleteTarget()!.name }}?
            </h3>
            <p
              id="ptah-delete-confirm-desc"
              class="py-3 text-sm text-base-content/70"
            >
              @if (deleteTarget()!.type === 'directory') {
                This will permanently delete the folder and all its contents.
              } @else {
                This will permanently delete this file.
              }
            </p>
            <div class="modal-action">
              <button
                #deleteCancel
                type="button"
                class="btn btn-sm"
                data-testid="delete-confirm-cancel"
                (click)="cancelDelete()"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-sm btn-error"
                data-testid="delete-confirm-accept"
                (click)="confirmDelete()"
              >
                Delete
              </button>
            </div>
          </div>
          <div class="modal-backdrop" aria-hidden="true"></div>
        </dialog>
      }

      <!-- Name input dialog for new file / new folder / rename
           (TASK_2026_216). Same top-layer reasoning as the delete confirmation
           above, and the same honest scope: hardening, not a reproduced defect.

           The focus + selection setup moved from an afterNextRender callback
           that read document.querySelector('.modal-open input[type="text"]')
           to the effect below. That selector was a document-wide search for a
           class this element no longer carries, and it would have matched the
           FIRST such input anywhere in the page — the panel is one tile among
           several.

           Escape is the UA's close request now, not a keydown on the input:
           showModal() adds a route that never passes through a keydown listener
           at all, so binding (cancel) is the only way to see every dismissal.
           The three controls tab in their natural order inside the UA's own
           containment, so there is nothing to trap by hand. -->
      @if (inputDialogTitle()) {
        <dialog
          #inputDialog
          class="modal"
          aria-modal="true"
          aria-labelledby="ptah-name-input-title"
          data-testid="name-input-dialog"
          (cancel)="onInputDialogCancel($event)"
        >
          <div class="modal-box max-w-sm">
            <h3 id="ptah-name-input-title" class="font-bold text-base">
              {{ inputDialogTitle() }}
            </h3>
            <input
              #nameInput
              type="text"
              class="input input-bordered input-sm w-full mt-3"
              [value]="inputDialogValue()"
              [attr.aria-label]="inputDialogTitle()"
              [attr.aria-describedby]="
                inputDialogError() ? 'ptah-name-input-error' : null
              "
              [attr.aria-invalid]="inputDialogError() ? 'true' : null"
              (keydown.enter)="submitInputDialog(nameInput.value)"
              placeholder="Enter name..."
            />
            @if (inputDialogError()) {
              <p
                id="ptah-name-input-error"
                class="text-error text-xs mt-1"
                role="alert"
              >
                {{ inputDialogError() }}
              </p>
            }
            <div class="modal-action">
              <button
                type="button"
                class="btn btn-sm"
                data-testid="name-input-cancel"
                (click)="closeInputDialog()"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                data-testid="name-input-accept"
                (click)="submitInputDialog(nameInput.value)"
              >
                OK
              </button>
            </div>
          </div>
          <div class="modal-backdrop" aria-hidden="true"></div>
        </dialog>
      }

      <!-- Split-pane save conflict (C2 AC3).
           No clickable backdrop and no dismiss affordance other than the two
           buttons: this dialog exists because a keystroke is about to be
           destroyed, so an accidental click-out must not resolve it. Escape
           maps to Cancel (the non-destructive choice) in _panelKeydown.

           Keyboard containment is handled here rather than by a CDK focus trap
           because the dialog has exactly two focusable elements — Tab is a
           two-way toggle between them, which is cheaper and easier to verify
           than a general trap, and it adds no tab stop of its own (the handler
           sits on the labelled container and catches the buttons' bubbled
           keydown, so the container is never itself focusable).

           A native dialog element opened with showModal(), for the reason
           spelled out in diff-view.component.ts (TASK_2026_227): this panel is
           mounted inside a gridstack tile in the Electron layout, and the
           isolation:isolate wrapper further up this same template is a stacking
           context too, so no z-index written here can paint above either. The
           top layer is outside every stacking context by construction. Escape
           still maps to Cancel through _panelKeydown; the (cancel) binding
           covers the close request showModal() adds, which does not pass
           through a keydown listener at all. -->
      @if (saveConflict()) {
        <dialog
          #saveConflictDialog
          class="modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ptah-save-conflict-title"
          aria-describedby="ptah-save-conflict-desc"
          (cancel)="onSaveConflictCancel($event)"
          (keydown)="onSaveConflictKeydown($event)"
        >
          <div class="modal-box max-w-sm">
            <h3 id="ptah-save-conflict-title" class="font-bold text-base">
              This file was also edited in the other pane
            </h3>
            <p
              id="ptah-save-conflict-desc"
              class="py-3 text-sm text-base-content/70"
            >
              {{ saveConflictFileName() }} has unsaved changes made in the other
              split pane. Saving now writes what this pane shows and discards
              them.
            </p>
            <div class="modal-action">
              <button
                #saveConflictCancel
                class="btn btn-sm"
                (click)="cancelSaveConflict()"
              >
                Cancel
              </button>
              <button
                #saveConflictOverwrite
                class="btn btn-sm btn-warning"
                (click)="confirmSaveConflict()"
              >
                Overwrite
              </button>
            </div>
          </div>
          <div class="modal-backdrop" aria-hidden="true"></div>
        </dialog>
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
  readonly PanelLeftCloseIcon = PanelLeftClose;
  readonly PanelLeftIcon = PanelLeft;
  readonly XIcon = X;
  readonly SplitIcon = Columns2;
  readonly TerminalIcon = TerminalSquare;
  readonly AlertTriangleIcon = AlertTriangle;

  /**
   * Listeners registered by the active resize drag, stored for symmetric
   * removal. One quartet serves all three drag surfaces: they all start from a
   * `mousedown` and there is a single pointer, so at most one can be active at
   * a time — the same reasoning that lets {@link _dragFrame} be a single
   * handle. `null` means no drag is in progress.
   */
  private _dragMouseMove: ((e: MouseEvent) => void) | null = null;
  private _dragMouseUp: (() => void) | null = null;
  private _dragBlur: (() => void) | null = null;
  private _dragKeydown: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Bound document keydown handler: Ctrl+P / Cmd+P Quick Open, and Escape to
   * cancel the split-pane save conflict.
   *
   * The conflict dialog is checked first and swallows Escape, so the key that
   * dismisses a dialog cannot also reach anything behind it.
   */
  private readonly _panelKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.saveConflict()) {
      e.preventDefault();
      this.ngZone.run(() => this.cancelSaveConflict());
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      this.ngZone.run(() => {
        this.quickOpenVisible.set(true);
      });
    }
  };

  /**
   * Pending save that would discard the other split pane's unsaved edits.
   * Non-null exactly while the conflict dialog is open (C2 AC2/AC3).
   */
  protected readonly saveConflict = signal<{
    filePath: string;
    content: string;
  } | null>(null);

  private readonly saveConflictDialog =
    viewChild<ElementRef<HTMLDialogElement>>('saveConflictDialog');
  private readonly saveConflictCancel =
    viewChild<ElementRef<HTMLButtonElement>>('saveConflictCancel');
  private readonly saveConflictOverwrite = viewChild<
    ElementRef<HTMLButtonElement>
  >('saveConflictOverwrite');

  /**
   * Element that held focus when the conflict dialog opened — in practice the
   * Monaco host of the pane whose Ctrl+S raised it. Restored on close so the
   * keyboard user is returned to the editor they were in rather than to the
   * top of the document.
   */
  private saveConflictReturnFocus: HTMLElement | null = null;

  /**
   * Promote the conflict dialog into the top layer, then move focus to Cancel:
   * it is the non-destructive choice, and without this the dialog would open
   * with focus still inside the editor that raised it.
   */
  private readonly _saveConflictFocus = effect(() => {
    if (!this.saveConflict()) return;
    const dialog = this.saveConflictDialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
    this.saveConflictCancel()?.nativeElement.focus();
  });

  private readonly _workspaceBinding = effect(() => {
    const workspaceRoot = this.vscodeService.config().workspaceRoot;
    if (workspaceRoot) {
      this.editorService.switchWorkspace(workspaceRoot);
      this.gitStatus.switchWorkspace(workspaceRoot);
    }
  });

  ngOnInit(): void {
    this.gitStatus.startListening();
    this.editorService.startFileTreeWatcher();
    void this.vimModeService.loadPreference();
    document.addEventListener('keydown', this._panelKeydown);
  }

  ngOnDestroy(): void {
    this.gitStatus.stopListening();
    this.editorService.stopFileTreeWatcher();
    this.cleanupDragListeners();
    document.removeEventListener('keydown', this._panelKeydown);
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
   * Update which pane has focus. Bound to BOTH `(click)` and `(focusin)` on
   * each pane container.
   *
   * `(click)` alone made `focusedPane` a mouse-only signal, and it gates two
   * things: the Ctrl+S handler in `code-editor.component.ts` (which declines
   * unless its own pane is the focused one), and — via
   * `EditorDiffSplitHelper.setFocusedPane` — the mirror-cancel + pane
   * reconciliation that C2 relies on. A keyboard user tabbing into the split
   * pane therefore could not save from it AT ALL, and never ran the
   * reconciliation that closes the split-pane divergence window.
   *
   * `focusin` bubbles (unlike `focus`), so focus landing anywhere inside a
   * pane — Monaco's hidden textarea included — retargets that pane. The two
   * containers are siblings, so neither pane's focusin can reach the other.
   */
  protected onPaneClick(pane: 'left' | 'right'): void {
    this.editorService.setFocusedPane(pane);
  }

  /**
   * Keys of every open diff tab, handed to the always-mounted diff view so it
   * can dispose the model pair of a tab the user closed (B1 AC5) and of a whole
   * workspace's worth of tabs when `openTabs` is replaced (B1 AC6).
   */
  protected readonly openDiffKeys = computed(() =>
    this.editorService
      .openTabs()
      .filter((tab) => tab.diff)
      .map((tab) => tab.filePath),
  );

  /**
   * File path for the always-mounted code editor.
   *
   * `undefined` whenever the diff view or the image viewer is the visible
   * layer: `activeFilePath()` then holds a diff tab KEY or an image path, and
   * handing either to the code editor would create a bogus Monaco model (and,
   * for a diff, mirror the diff's modified text into the file-editing surface).
   */
  protected readonly codeEditorPath = computed(() =>
    this.editorService.activeDiffTab() || this.editorService.isActiveFileImage()
      ? undefined
      : this.editorService.activeFilePath(),
  );

  protected readonly codeEditorContent = computed(() =>
    this.editorService.activeDiffTab() || this.editorService.isActiveFileImage()
      ? ''
      : this.editorService.activeFileContent(),
  );

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
   * The tab record BOTH panes are looking at, or `null`.
   *
   * Every behaviour C2 adds in this component is gated on it: non-null only
   * when the split is open, the two panes hold the same path, and that path has
   * a tab. Different files in the two panes leave it null and nothing new runs
   * (C2 AC5).
   */
  protected readonly sharedSplitTab = computed<EditorTab | null>(() => {
    if (!this.editorService.splitActive()) return null;
    const path = this.editorService.splitFilePath();
    if (!path || path !== this.editorService.activeFilePath()) return null;
    return (
      this.editorService.openTabs().find((tab) => tab.filePath === path) ?? null
    );
  });

  /**
   * `contentIsPersisted` for both code editors.
   *
   * `undefined` — the legacy "no information" value — everywhere except the
   * shared-file split, so the ordinary editor keeps its exact pre-C2 baseline
   * behaviour. In the shared-file case the tab record's dirty flag is the
   * authority on whether the text the panes are being handed is what is on
   * disk, which is what lets the pane that did not issue a save clear its own
   * "Modified" badge (C2 AC4).
   */
  protected readonly sharedContentIsPersisted = computed<boolean | undefined>(
    () => {
      const tab = this.sharedSplitTab();
      return tab ? !tab.isDirty : undefined;
    },
  );

  /** File name shown in the save-conflict dialog. */
  protected readonly saveConflictFileName = computed(() => {
    const path = this.saveConflict()?.filePath;
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || path;
  });

  /**
   * Handle file save events from the split (right) pane editor.
   */
  protected onSplitFileSaved(event: {
    filePath: string;
    content: string;
  }): void {
    this.saveFromPane(event.filePath, event.content);
  }

  /**
   * Persist a save request from either pane.
   *
   * `EditorService.saveFile` is RPC-only and marks nothing clean — that is the
   * caller's job, and the split pane never did it, so saving from the split
   * pane left the tab strip's dirty dot lit on a file that was clean on disk
   * (C2 AC4). Both panes now route through here, so there is one save policy
   * rather than two that drifted.
   */
  private saveFromPane(filePath: string, content: string): void {
    if (this.editorService.hasUnabsorbedPeerEdit(filePath, content)) {
      // Captured BEFORE the signal flips, so it records the editor the save
      // came from rather than the Cancel button the open-effect is about to
      // focus.
      this.saveConflictReturnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      this.saveConflict.set({ filePath, content });
      return;
    }
    void this.persistSave(filePath, content);
  }

  /**
   * Keep Tab inside the dialog.
   *
   * There are exactly two focusable elements, so Tab and Shift+Tab are the same
   * two-way toggle and no direction handling is needed. Without this, Tab walks
   * straight out into the editor behind a visually blocking modal.
   */
  protected onSaveConflictKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const cancel = this.saveConflictCancel()?.nativeElement;
    const overwrite = this.saveConflictOverwrite()?.nativeElement;
    if (!cancel || !overwrite) return;
    event.preventDefault();
    (document.activeElement === cancel ? overwrite : cancel).focus();
  }

  /** Close the dialog and return focus to whatever raised it. */
  private closeSaveConflict(): void {
    // Leave the top layer before `@if` unmounts the node: an element removed
    // while still `open` skips its close steps. The focus restore stays last —
    // close() hands focus back to whatever showModal() remembered, which is not
    // necessarily the pane that raised this.
    const dialog = this.saveConflictDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.saveConflict.set(null);
    const target = this.saveConflictReturnFocus;
    this.saveConflictReturnFocus = null;
    if (target?.isConnected) target.focus();
  }

  /**
   * Escape as the browser's own close request.
   *
   * `_panelKeydown` already maps Escape to Cancel, but `showModal()` adds a
   * second route that does not pass through a keydown listener at all. Left to
   * the UA it would close the element with `saveConflict` still set and focus
   * unrestored. Routed here it is the same Cancel as the button.
   */
  protected onSaveConflictCancel(event: Event): void {
    event.preventDefault();
    this.cancelSaveConflict();
  }

  private async persistSave(filePath: string, content: string): Promise<void> {
    await this.editorService.saveFile(filePath, content);
    this.editorService.markTabClean(filePath);
  }

  /** Overwrite the other pane's unsaved edits, having said so (C2 AC2). */
  protected confirmSaveConflict(): void {
    const conflict = this.saveConflict();
    if (!conflict) return;
    this.closeSaveConflict();
    // The tab record OWNS content, so it has to end up holding what was
    // actually written — otherwise the text the user just chose to discard
    // would be mirrored straight back into both panes.
    this.editorService.updateTabContent(conflict.filePath, conflict.content);
    void this.persistSave(conflict.filePath, conflict.content);
  }

  /**
   * Abort the save. Nothing is written and no tab state changes: the other
   * pane's edits survive in the tab record and this pane keeps the text the
   * user declined to overwrite. Reconciling the two here would destroy exactly
   * the edits Cancel was pressed to protect; they converge on the next focus
   * change (C2 AC3).
   */
  protected cancelSaveConflict(): void {
    this.closeSaveConflict();
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

  /**
   * Open the diff a Source Control row stands for. The row now says WHICH
   * comparison it means, so the staged and working-tree rows no longer collapse
   * onto the same tab (A2).
   */
  protected onDiffRequested(request: OpenDiffRequest): void {
    void this.editorService.openDiff(request);
  }

  /** Re-read a diff tab from git after a failed or stale read (A1 AC7). */
  /**
   * The diff view's hunk stage / unstage / revert seam (D2).
   *
   * A bound field rather than a method reference in the template: the input is
   * a function VALUE, and `[applyHunks]="applyHunks.bind(this)"` would hand the
   * view a new identity on every change-detection pass, retriggering its
   * effects for no reason. Arrow-bound once, stable forever.
   */
  protected readonly applyHunks = (
    request: HunkApplyRequest,
  ): Promise<GitApplyHunksResult> => this.editorService.applyHunks(request);

  protected onDiffRetry(diffKey: string): void {
    if (!diffKey) return;
    void this.editorService.refreshDiffTab(diffKey);
  }

  /** Hover/screen-reader text for the tab-strip stale/error glyph. */
  protected diffStatusTitle(tab: EditorTab): string {
    const diff = tab.diff;
    if (!diff) return '';
    if (diff.errorMessage) return diff.errorMessage;
    return diff.status === 'refreshing'
      ? 'Re-reading this comparison from git…'
      : 'This comparison may be out of date.';
  }

  protected onContentChanged(content: string): void {
    const filePath = this.editorService.activeFilePath();
    if (filePath) {
      this.editorService.updateTabContent(filePath, content);
    }
  }

  protected onFileSaved(event: { filePath: string; content: string }): void {
    this.saveFromPane(event.filePath, event.content);
  }

  protected onTabClick(filePath: string): void {
    this.editorService.switchTab(filePath);
  }

  /**
   * Close a tab. Takes no event: the close button is a SIBLING of the tab
   * button, not a descendant, so activating it cannot reach `onTabClick`.
   * Isolation is structural, not a suppressed propagation (D1 AC5).
   */
  protected onTabClose(filePath: string): void {
    this.editorService.closeTab(filePath);
  }

  protected readonly ctxMenuVisible = signal(false);
  protected readonly ctxMenuX = signal(0);
  protected readonly ctxMenuY = signal(0);
  protected readonly ctxMenuNode = signal<FileTreeNode | null>(null);
  protected readonly deleteTarget = signal<FileTreeNode | null>(null);
  protected readonly inputDialogTitle = signal('');
  protected readonly inputDialogValue = signal('');
  protected readonly inputDialogError = signal('');
  private inputDialogCallback: ((name: string) => void) | null = null;

  private readonly deleteDialog =
    viewChild<ElementRef<HTMLDialogElement>>('deleteDialog');
  private readonly deleteCancel =
    viewChild<ElementRef<HTMLButtonElement>>('deleteCancel');
  private readonly inputDialog =
    viewChild<ElementRef<HTMLDialogElement>>('inputDialog');
  private readonly nameInput =
    viewChild<ElementRef<HTMLInputElement>>('nameInput');

  /**
   * Element that held focus when one of these two dialogs opened — in practice
   * the file-tree row the context menu was raised from. Restored on close so a
   * keyboard user is put back where they were rather than at the top of the
   * document. One field for both because only one can be open at a time: both
   * are raised from `onContextMenuAction`, which closes the menu and takes
   * exactly one branch.
   */
  private fileOpsReturnFocus: HTMLElement | null = null;

  /**
   * Promote the delete confirmation into the top layer, then move focus to
   * Cancel — the non-destructive choice, and without this the dialog would open
   * with focus still on whatever raised it.
   */
  private readonly _deleteDialogFocus = effect(() => {
    if (!this.deleteTarget()) return;
    const dialog = this.deleteDialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
    this.deleteCancel()?.nativeElement.focus();
  });

  /**
   * Promote the name dialog into the top layer, then focus its input and
   * pre-select the stem of the existing name so a rename can be typed straight
   * over it without clobbering the extension.
   *
   * Deliberately does NOT read {@link inputDialogError}: a rejected name leaves
   * the caret and the selection exactly where the user left them instead of
   * re-selecting the text they are in the middle of correcting.
   */
  private readonly _inputDialogFocus = effect(() => {
    if (!this.inputDialogTitle()) return;
    const dialog = this.inputDialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
    const input = this.nameInput()?.nativeElement;
    if (!input) return;
    input.focus();
    const initialValue = this.inputDialogValue();
    if (initialValue) {
      const dotIdx = initialValue.lastIndexOf('.');
      input.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialValue.length);
    }
  });

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
          // Captured BEFORE the signal flips, so it records what raised the
          // dialog rather than the Cancel button the open-effect is about to
          // focus.
          this.captureFileOpsReturnFocus();
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
    this.closeDeleteDialog();
    void this.editorService.deleteItem(
      target.path,
      target.type === 'directory',
    );
  }

  /** Dismiss the delete confirmation without deleting anything. */
  protected cancelDelete(): void {
    this.closeDeleteDialog();
  }

  /**
   * Escape as the browser's own close request.
   *
   * `showModal()` gives the UA a route to close the element that does not pass
   * through any keydown listener. Left to it, the element would close with
   * `deleteTarget` still set — a live confirmation the user can no longer see —
   * and focus unrestored. Routed here it is the same Cancel as the button.
   */
  protected onDeleteDialogCancel(event: Event): void {
    event.preventDefault();
    this.cancelDelete();
  }

  /**
   * Leave the top layer, then unmount, then restore focus — in that order.
   *
   * `close()` has to run BEFORE `@if` removes the node: an element removed from
   * the document while still `open` skips its close steps entirely, so it never
   * hands focus back. The restore stays last because `close()` hands focus to
   * whatever `showModal()` remembered, which is not necessarily what raised
   * this.
   */
  private closeDeleteDialog(): void {
    const dialog = this.deleteDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.deleteTarget.set(null);
    this.restoreFileOpsFocus();
  }

  /**
   * Escape on the name dialog. Same UA close request as the delete
   * confirmation — see {@link onDeleteDialogCancel}.
   */
  protected onInputDialogCancel(event: Event): void {
    event.preventDefault();
    this.closeInputDialog();
  }

  private captureFileOpsReturnFocus(): void {
    this.fileOpsReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }

  /**
   * Hand focus back to whatever raised the dialog, if it is still in the
   * document — the context menu that raised it is unmounted by the time either
   * dialog opens, so a disconnected element here is the ordinary case, not an
   * error.
   */
  private restoreFileOpsFocus(): void {
    const target = this.fileOpsReturnFocus;
    this.fileOpsReturnFocus = null;
    if (target?.isConnected) target.focus();
  }

  private openInputDialog(
    title: string,
    initialValue: string,
    callback: (name: string) => void,
  ): void {
    // Before the signal flips, for the same reason as the delete confirmation.
    this.captureFileOpsReturnFocus();
    this.inputDialogTitle.set(title);
    this.inputDialogValue.set(initialValue);
    this.inputDialogError.set('');
    this.inputDialogCallback = callback;
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

  /** Close order is load-bearing — see {@link closeDeleteDialog}. */
  protected closeInputDialog(): void {
    const dialog = this.inputDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.inputDialogTitle.set('');
    this.inputDialogValue.set('');
    this.inputDialogError.set('');
    this.inputDialogCallback = null;
    this.restoreFileOpsFocus();
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

    this.startDragTracking<number>({
      original: startHeight,
      compute: (e) => {
        const deltaY = startY - e.clientY;
        const newHeight = startHeight + deltaY;
        const hostElement = (event.target as HTMLElement).closest(
          '[role="main"]',
        );
        const maxHeight = hostElement ? hostElement.clientHeight * 0.6 : 600;
        return Math.max(100, Math.min(newHeight, maxHeight));
      },
      commit: (height) => this.editorService.setTerminalHeight(height),
    });
  }

  /**
   * Handle mousedown on the sidebar resize handle.
   * Starts tracking horizontal mouse movement to resize the sidebar.
   * Width is clamped between 160px and 480px.
   */
  protected onSidebarResizeStart(event: MouseEvent): void {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = this.sidebarWidth();

    this.startDragTracking<number>({
      original: startWidth,
      compute: (e) => {
        const deltaX = e.clientX - startX;
        const newWidth = startWidth + deltaX;
        return Math.max(160, Math.min(480, newWidth));
      },
      commit: (width) => this.sidebarWidth.set(width),
    });
  }

  /**
   * Handle mousedown on the split divider.
   * Starts tracking horizontal mouse movement to resize the split panes.
   * The left pane percentage is clamped between 20% and 80%.
   */
  protected onSplitResizeStart(event: MouseEvent): void {
    event.preventDefault();

    const startX = event.clientX;
    const startPercent = this.splitLeftPercent();
    const container = (event.target as HTMLElement).parentElement;
    if (!container) return;
    const containerWidth = container.clientWidth;

    this.startDragTracking<number>({
      original: startPercent,
      compute: (e) => {
        const deltaX = e.clientX - startX;
        const deltaPercent = (deltaX / containerWidth) * 100;
        const newPercent = startPercent + deltaPercent;
        return Math.max(20, Math.min(80, newPercent));
      },
      commit: (percent) => this.splitLeftPercent.set(percent),
    });
  }

  /**
   * The single drag loop behind all three resize surfaces (B5 AC4).
   *
   * Each surface supplies only what actually differs between them — the value
   * to restore on interruption, the pointer→value arithmetic (including its
   * own clamp), and the setter — and inherits one implementation of the parts
   * that must not diverge:
   *
   * - **Coalescing (AC1).** `mousemove` runs outside the Angular zone and only
   *   records the latest position + arms a single `requestAnimationFrame`, so
   *   at most one zone re-entry (one change-detection pass + one layout write)
   *   lands per frame no matter how many pointer events arrive.
   * - **No lost final update (AC2).** `mouseup` cancels the armed frame AND
   *   applies the recorded position synchronously, so the released position is
   *   always what commits.
   * - **Interruption (AC3, TASK_2026_176).** `blur` and `Escape` restore
   *   `original` and end the drag; every exit path cancels the pending frame
   *   and removes all four listeners, so nothing can fire after the drag ends
   *   or after `ngOnDestroy`.
   *
   * `compute` deliberately runs OUTSIDE the zone — only `commit` is re-entered,
   * which keeps the per-frame zone work to the signal write alone.
   *
   * @typeParam T Surface's value type (px height, px width, or percentage).
   */
  private startDragTracking<T>(surface: {
    /** Pre-drag value, re-committed when the drag is interrupted. */
    readonly original: T;
    /** Pointer position → value to commit. Pure; runs outside the zone. */
    compute: (event: MouseEvent) => T;
    /** Applies a computed value. Runs inside the Angular zone. */
    commit: (value: T) => void;
  }): void {
    // A previous drag always tears itself down on mouseup/blur/Escape; this is
    // belt-and-braces so the single listener quartet can never be orphaned by
    // an unexpected second mousedown.
    this.cleanupDragListeners();

    this.ngZone.runOutsideAngular(() => {
      let latestEvent: MouseEvent | null = null;

      const applyLatest = (): void => {
        this._dragFrame = null;
        const e = latestEvent;
        if (!e) return;
        latestEvent = null;

        const value = surface.compute(e);
        this.ngZone.run(() => {
          surface.commit(value);
        });
      };

      const endDrag = (restore: boolean): void => {
        this.cancelDragFrame();
        if (restore) {
          this.ngZone.run(() => {
            surface.commit(surface.original);
          });
        } else {
          applyLatest();
        }
        this.cleanupDragListeners();
      };

      this._dragMouseMove = (e: MouseEvent) => {
        latestEvent = e;
        if (this._dragFrame === null) {
          this._dragFrame = requestAnimationFrame(applyLatest);
        }
      };

      this._dragMouseUp = () => endDrag(false);
      this._dragBlur = () => endDrag(true);
      this._dragKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          endDrag(true);
        }
      };

      document.addEventListener('mousemove', this._dragMouseMove);
      document.addEventListener('mouseup', this._dragMouseUp);
      window.addEventListener('blur', this._dragBlur);
      document.addEventListener('keydown', this._dragKeydown);
    });
  }

  /**
   * Cancel any armed frame and remove every listener registered by
   * {@link startDragTracking}. Idempotent — safe to call when no drag is in
   * progress, which is what makes the `ngOnDestroy` teardown unconditional.
   */
  private cleanupDragListeners(): void {
    this.cancelDragFrame();
    if (this._dragMouseMove) {
      document.removeEventListener('mousemove', this._dragMouseMove);
      this._dragMouseMove = null;
    }
    if (this._dragMouseUp) {
      document.removeEventListener('mouseup', this._dragMouseUp);
      this._dragMouseUp = null;
    }
    if (this._dragBlur) {
      window.removeEventListener('blur', this._dragBlur);
      this._dragBlur = null;
    }
    if (this._dragKeydown) {
      document.removeEventListener('keydown', this._dragKeydown);
      this._dragKeydown = null;
    }
  }

  /**
   * Pending `requestAnimationFrame` handle for the active resize drag.
   *
   * Only one drag surface can be active at a time (they all start from a
   * `mousedown` and there is a single pointer), so the terminal, sidebar and
   * split drags share this one handle. `null` means no frame is armed.
   */
  private _dragFrame: number | null = null;

  /**
   * Cancel any frame armed by a resize drag.
   *
   * Called from every drag cleanup path — mouseup and `ngOnDestroy` alike — so
   * a coalesced update can never land after the drag has ended or after the
   * component has been torn down.
   */
  private cancelDragFrame(): void {
    if (this._dragFrame !== null) {
      cancelAnimationFrame(this._dragFrame);
      this._dragFrame = null;
    }
  }
}
