/**
 * Electron Resize Handle Component
 *
 * Generic drag handle for resizing adjacent panels in the Electron shell.
 * Uses raw mousedown/mousemove/mouseup for reliable, jank-free resizing.
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
  inject,
  NgZone,
  OnDestroy,
} from '@angular/core';
import { RESIZE_HANDLE_STYLES } from './resize-handle.styles';

@Component({
  selector: 'ptah-electron-resize-handle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: RESIZE_HANDLE_STYLES,
  template: `
    <div
      class="resize-handle"
      role="separator"
      aria-orientation="vertical"
      (mousedown)="onMouseDown($event)"
    ></div>
  `,
})
export class ElectronResizeHandleComponent implements OnDestroy {
  private readonly ngZone = inject(NgZone);

  /**
   * Which side the resizable panel is on.
   * 'left'  → width = pointer X position
   * 'right' → width = viewport width - pointer X position
   */
  readonly direction = input<'left' | 'right'>('left');

  readonly dragStarted = output<void>();
  readonly dragMoved = output<number>();
  readonly dragEnded = output<void>();

  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseUpHandler: (() => void) | null = null;

  onMouseDown(event: MouseEvent): void {
    event.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    this.dragStarted.emit();

    this.ngZone.runOutsideAngular(() => {
      this.mouseMoveHandler = (e: MouseEvent) => {
        const pointerX = e.clientX;
        const width =
          this.direction() === 'left' ? pointerX : window.innerWidth - pointerX;
        this.ngZone.run(() => this.dragMoved.emit(width));
      };

      this.mouseUpHandler = () => {
        this.cleanup();
        this.ngZone.run(() => this.dragEnded.emit());
      };

      document.addEventListener('mousemove', this.mouseMoveHandler);
      document.addEventListener('mouseup', this.mouseUpHandler);
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private cleanup(): void {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
    if (this.mouseUpHandler) {
      document.removeEventListener('mouseup', this.mouseUpHandler);
      this.mouseUpHandler = null;
    }
  }
}
