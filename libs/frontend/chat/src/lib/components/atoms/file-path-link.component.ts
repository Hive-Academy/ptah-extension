import {
  Component,
  input,
  inject,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ExternalLink } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * FilePathLinkComponent - Clickable file path that opens file in VS Code editor
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: RPC integration, path shortening
 *
 * Features:
 * - Shorten paths > 2 segments to ".../last/two"
 * - Show full path on hover (title attribute)
 * - Open file in VS Code on click via ClaudeRpcService
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

  readonly fullPath = input.required<string>();
  readonly clicked = output<Event>(); // For parent to handle stopPropagation

  readonly ExternalLinkIcon = ExternalLink;

  /**
   * Shorten file path for display
   * Extracted from tool-call-item.component.ts:654-660
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
   * Open file in VS Code editor
   * Extracted from tool-call-item.component.ts:351-358
   * Uses RPC to open file in VS Code
   */
  protected openFile(event: Event): void {
    this.clicked.emit(event); // Let parent handle stopPropagation
    const filePath = this.fullPath();
    if (filePath) {
      // Use RPC to open file in VS Code
      this.rpcService.call('file:open', { path: filePath });
    }
  }
}
