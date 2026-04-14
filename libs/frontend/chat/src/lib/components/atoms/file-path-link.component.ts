import {
  Component,
  Injector,
  input,
  inject,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ExternalLink } from 'lucide-angular';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';

/**
 * FilePathLinkComponent - Clickable file path that opens file in editor
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: RPC integration, path shortening, platform-aware routing
 *
 * Features:
 * - Shorten paths > 2 segments to ".../last/two"
 * - Show full path on hover (title attribute)
 * - Platform-aware file opening:
 *   - VS Code: opens via file:open RPC → vscode.window.showTextDocument()
 *   - Electron: opens in Monaco editor tab via EditorService (dynamic import)
 * - Emit click event for parent to handle event propagation
 */
@Component({
  selector: 'ptah-file-path-link',
  standalone: true,
  imports: [LucideAngularModule],
  host: { class: 'min-w-0 flex-1 overflow-hidden' },
  template: `
    <span
      class="text-info/80 truncate font-mono text-[10px] hover:text-info hover:underline cursor-pointer flex items-center gap-1"
      [title]="fullPath()"
      (click)="openFile($event)"
    >
      <span class="truncate">{{ getShortPath() }}</span>
      <lucide-angular
        [img]="ExternalLinkIcon"
        class="w-2.5 h-2.5 opacity-60 flex-shrink-0"
      />
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilePathLinkComponent {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly injector = inject(Injector);

  readonly fullPath = input.required<string>();
  readonly clicked = output<Event>(); // For parent to handle stopPropagation

  readonly ExternalLinkIcon = ExternalLink;

  /**
   * Shorten file path for display
   * Shows just the filename or last 2 path segments
   */
  protected getShortPath(): string {
    const path = this.fullPath();
    if (!path) return '';
    // Show just the filename or last 2 path segments
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
  }

  /**
   * Open file in the editor (platform-aware).
   * VS Code: sends file:open RPC which opens the file natively.
   * Electron: dynamically imports EditorService to open in Monaco editor tab.
   */
  protected openFile(event: Event): void {
    this.clicked.emit(event); // Let parent handle stopPropagation
    const filePath = this.fullPath();
    if (!filePath) return;

    if (this.vscodeService.isElectron) {
      void this.openFileInElectron(filePath);
    } else {
      void this.rpcService.openFile(filePath);
    }
  }

  /**
   * Open file in Electron's Monaco editor via dynamically-imported EditorService.
   * Uses the same dynamic-import pattern as WorkspaceCoordinatorService.
   */
  private async openFileInElectron(filePath: string): Promise<void> {
    try {
      const editorModule = await import('@ptah-extension/editor');
      const editorService = this.injector.get(editorModule.EditorService);
      await editorService.openFile(filePath);
    } catch (error) {
      console.error(
        '[FilePathLink] Electron openFile failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
