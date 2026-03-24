/**
 * Electron Resize Handle Component
 *
 * Generic drag handle for resizing adjacent panels in the Electron shell.
 * Unlike the existing ResizeHandleComponent (which uses PanelResizeService
 * for the agent monitor panel), this one emits drag events so the parent
 * can control any panel width.
 *
 * Usage:
 *   <ptah-electron-resize-handle
 *     [direction]="'left'"
 *     (dragStarted)="onDragStarted()"
 *     (dragMoved)="onDragMoved($event)"
 *     (dragEnded)="onDragEnded()"
 *   />
 *
 * direction='left'  → panel is to the left, width = pointerX
 * direction='right' → panel is to the right, width = viewport - pointerX
 */

import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { CdkDrag, CdkDragMove } from '@angular/cdk/drag-drop';
import { RESIZE_HANDLE_STYLES } from './resize-handle.styles';

@Component({
  selector: 'ptah-electron-resize-handle',
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
      (cdkDragStarted)="onDragStart()"
      (cdkDragMoved)="onDrag($event)"
      (cdkDragEnded)="onDragEnd()"
    ></div>
  `,
})
export class ElectronResizeHandleComponent {
  /**
   * Which side the resizable panel is on.
   * 'left'  → width = pointer X position
   * 'right' → width = viewport width - pointer X position
   */
  readonly direction = input<'left' | 'right'>('left');

  readonly dragStarted = output<void>();
  readonly dragMoved = output<number>(); // emits calculated width
  readonly dragEnded = output<void>();

  onDragStart(): void {
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    this.dragStarted.emit();
  }

  onDrag(event: CdkDragMove): void {
    // Reset CDK transform — we resize the panel, not translate the handle
    event.source.element.nativeElement.style.transform = 'none';

    const pointerX = event.pointerPosition.x;
    const width =
      this.direction() === 'left' ? pointerX : window.innerWidth - pointerX;

    this.dragMoved.emit(width);
  }

  onDragEnd(): void {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    this.dragEnded.emit();
  }
}
