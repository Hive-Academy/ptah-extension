import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { CodeEditorComponent } from '../code-editor/code-editor.component';
import { EditorService } from '../services/editor.service';
import { FileTreeNode } from '../models/file-tree.model';

/**
 * EditorPanelComponent - Main container combining file tree sidebar and code editor.
 *
 * Complexity Level: 2 (Medium - composes file tree + editor, RPC communication)
 * Patterns: Composition, signal-based state delegation to EditorService
 *
 * Layout: Split view with file tree sidebar (w-64) on the left and
 * Monaco code editor (flex-1) on the right.
 *
 * Communication flow:
 * 1. Component initializes -> EditorService.loadFileTree() -> RPC to backend
 * 2. Backend responds with file tree -> EditorService.setFileTree()
 * 3. User clicks file -> EditorService.openFile() -> RPC to backend
 * 4. Backend responds with content -> EditorService.setFileContent()
 * 5. User presses Ctrl+S -> EditorService.saveFile() -> RPC to backend
 *
 * Message handling:
 * - Listens on window message events for RPC responses
 * - Routes responses to EditorService state updates
 */
@Component({
  selector: 'ptah-editor-panel',
  standalone: true,
  imports: [FileTreeComponent, CodeEditorComponent],
  template: `
    <div
      class="flex h-full w-full bg-base-100"
      role="main"
      aria-label="Editor Panel"
    >
      <ptah-file-tree
        [files]="editorService.fileTree()"
        [activeFilePath]="editorService.activeFilePath()"
        (fileSelected)="onFileSelected($event)"
      />
      <div class="flex-1 min-w-0">
        @if (editorService.isLoading() && !editorService.hasActiveFile()) {
        <div class="h-full flex items-center justify-center">
          <span class="loading loading-spinner loading-md"></span>
        </div>
        } @else {
        <ptah-code-editor
          [filePath]="editorService.activeFilePath()"
          [content]="editorService.activeFileContent()"
          (contentChanged)="onContentChanged($event)"
          (fileSaved)="onFileSaved($event)"
        />
        }
      </div>
      @if (editorService.error()) {
      <div class="toast toast-end toast-bottom">
        <div class="alert alert-error text-sm">
          <span>{{ editorService.error() }}</span>
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

  private messageHandler: ((event: MessageEvent) => void) | null = null;

  ngOnInit(): void {
    this.setupMessageListener();
    this.editorService.loadFileTree();
  }

  ngOnDestroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
  }

  protected onFileSelected(filePath: string): void {
    this.editorService.openFile(filePath);
  }

  protected onContentChanged(_content: string): void {
    // Content changes are tracked in the code editor component.
    // The EditorService only needs to persist on save.
  }

  protected onFileSaved(event: { filePath: string; content: string }): void {
    this.editorService.saveFile(event.filePath, event.content);
  }

  /**
   * Listen for RPC response messages from the backend (main process).
   *
   * The preload script dispatches window MessageEvents for all
   * messages sent from the main process via webContents.send().
   * We filter for editor-related RPC responses here.
   */
  private setupMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Handle RPC responses for editor methods
      if (data.type === 'rpc:response' && data.method) {
        this.handleRpcResponse(data);
      }

      // Handle direct editor messages (alternative pattern used by some backends)
      if (data.type === 'editor:fileTree') {
        this.editorService.setFileTree(data.payload?.tree ?? []);
      }

      if (data.type === 'editor:fileContent') {
        const payload = data.payload;
        if (payload?.filePath && typeof payload.content === 'string') {
          this.editorService.setFileContent(payload.filePath, payload.content);
        }
      }

      if (data.type === 'editor:saveResult') {
        if (data.payload?.success) {
          this.editorService.confirmSave();
        } else {
          this.editorService.setError(
            data.payload?.error ?? 'Failed to save file'
          );
        }
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  private handleRpcResponse(data: Record<string, unknown>): void {
    const method = data['method'] as string;
    const success = data['success'] as boolean;
    const responseData = data['data'] as Record<string, unknown> | undefined;
    const error = data['error'] as string | undefined;

    if (!success && error) {
      this.editorService.setError(error);
      return;
    }

    switch (method) {
      case 'editor:getFileTree':
        if (responseData && Array.isArray(responseData['tree'])) {
          this.editorService.setFileTree(
            responseData['tree'] as FileTreeNode[]
          );
        } else if (Array.isArray(responseData)) {
          this.editorService.setFileTree(responseData as FileTreeNode[]);
        }
        break;

      case 'editor:openFile':
        if (responseData && typeof responseData['content'] === 'string') {
          const filePath =
            (responseData['filePath'] as string) ??
            this.editorService.activeFilePath();
          if (filePath) {
            this.editorService.setFileContent(
              filePath,
              responseData['content'] as string
            );
          }
        }
        break;

      case 'editor:saveFile':
        this.editorService.confirmSave();
        break;
    }
  }
}
