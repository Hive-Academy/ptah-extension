/**
 * Resize Handle Component
 *
 * Self-contained, pluggable drag handle for resizing an adjacent panel.
 * Uses Angular CDK Drag with horizontal axis lock.
 *
 * Usage:
 *   <ptah-resize-handle />
 *
 * Place as a flex sibling between the content area and the panel to resize.
 * Injects PanelResizeService to update width state.
 *
 * Features:
 *   - CDK drag with x-axis lock
 *   - col-resize cursor, grip indicator, hover highlight
 *   - Double-click to reset to responsive defaults
 *   - Disables text selection during drag
 *   - Sets body cursor during drag for seamless feel
 */

import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CdkDrag, CdkDragMove } from '@angular/cdk/drag-drop';
import { PanelResizeService } from '../../services/panel-resize.service';
import { RESIZE_HANDLE_STYLES } from '@ptah-extension/chat-ui';

@Component({
  selector: 'ptah-resize-handle',
  standalone: true,
  imports: [CdkDrag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: RESIZE_HANDLE_STYLES,
  template: `
    <div
      class="resize-handle"
      role="separator"
      aria-orientation="vertical"
      cdkDrag
      cdkDragLockAxis="x"
      (cdkDragStarted)="onDragStarted()"
      (cdkDragMoved)="onDragMoved($event)"
      (cdkDragEnded)="onDragEnded()"
      (dblclick)="onDoubleClick()"
    ></div>
  `,
})
export class ResizeHandleComponent {
  private readonly resizeService = inject(PanelResizeService);

  onDragStarted(): void {
    this.resizeService.setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  onDragMoved(event: CdkDragMove): void {
    // Reset CDK's built-in transform — we resize the panel, not translate the handle
    event.source.element.nativeElement.style.transform = 'none';

    // Panel width = distance from pointer to right edge of viewport
    const newWidth = window.innerWidth - event.pointerPosition.x;
    this.resizeService.setCustomWidth(newWidth);
  }

  onDragEnded(): void {
    this.resizeService.setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  onDoubleClick(): void {
    this.resizeService.resetWidth();
  }
}
