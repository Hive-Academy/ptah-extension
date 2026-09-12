import {
  Component,
  ElementRef,
  input,
  inject,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ExternalLink } from 'lucide-angular';
import { FILE_LINK_OPENER } from '@ptah-extension/core';

/**
 * FilePathLinkComponent - Clickable file path that opens the file.
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: injected port, path shortening
 *
 * Features:
 * - Shorten paths > 2 segments to ".../last/two"
 * - Show full path on hover (title attribute)
 * - Opens through `FILE_LINK_OPENER`: Ptah's read-only viewer on desktop, the
 *   native editor in VS Code. The host element travels as `origin` so the
 *   opener can resolve the workspace this path belongs to.
 * - Emit click event for parent to handle event propagation
 *
 * This atom keeps chat-ui's single documented `@ptah-extension/core` exception
 * (see the library's guideline 1), now as a port rather than a concrete
 * service.
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
  private readonly opener = inject(FILE_LINK_OPENER);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

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
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
  }

  /**
   * Open the file through the injected opener. The atom has no error surface
   * of its own, so a rejection is logged rather than shown; the host renders
   * the failure (a blocked dock tab on desktop, a native warning in VS Code).
   */
  protected openFile(event: Event): void {
    this.clicked.emit(event); // Let parent handle stopPropagation
    const filePath = this.fullPath();
    if (!filePath) return;

    void this.opener
      .open({ path: filePath, origin: this.host.nativeElement })
      .catch((error: unknown) => {
        console.error('[FilePathLink] Failed to open', filePath, error);
      });
  }
}
