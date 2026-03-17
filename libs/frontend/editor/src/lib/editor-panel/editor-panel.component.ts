import {
  Component,
  inject,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { CodeEditorComponent } from '../code-editor/code-editor.component';
import { EditorService } from '../services/editor.service';

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

  ngOnInit(): void {
    void this.editorService.loadFileTree();
  }

  protected onFileSelected(filePath: string): void {
    void this.editorService.openFile(filePath);
  }

  protected onContentChanged(_content: string): void {
    // Content changes are tracked in the code editor component.
    // The EditorService only needs to persist on save.
  }

  protected onFileSaved(event: { filePath: string; content: string }): void {
    void this.editorService.saveFile(event.filePath, event.content);
  }

  protected dismissError(): void {
    this.editorService.clearError();
  }
}
