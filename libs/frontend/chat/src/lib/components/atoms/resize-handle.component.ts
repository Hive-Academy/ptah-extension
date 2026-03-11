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

@Component({
  selector: 'ptah-resize-handle',
  standalone: true,
  imports: [CdkDrag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      flex-shrink: 0;
    }

    .resize-handle {
      width: 6px;
      cursor: col-resize;
      background: transparent;
      position: relative;
      height: 100%;
      z-index: 10;
      transition: background-color 150ms;
    }

    .resize-handle:hover {
      background-color: oklch(var(--p) / 0.3);
    }

    .resize-handle:active {
      background-color: oklch(var(--p) / 0.5);
    }

    /* Grip indicator (thin vertical line) */
    .resize-handle::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 2px;
      height: 24px;
      border-radius: 1px;
      background-color: oklch(var(--bc) / 0.15);
      transition: background-color 150ms;
    }

    .resize-handle:hover::after {
      background-color: oklch(var(--bc) / 0.4);
    }
  `,
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
