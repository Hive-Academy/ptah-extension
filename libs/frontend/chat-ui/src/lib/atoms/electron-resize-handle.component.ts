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
  private blurHandler: (() => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private dragFrame: number | null = null;
  private startWidth: number | null = null;

  onMouseDown(event: MouseEvent): void {
    event.preventDefault();
    this.startWidth =
      this.direction() === 'left'
        ? event.clientX
        : window.innerWidth - event.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    this.dragStarted.emit();

    this.ngZone.runOutsideAngular(() => {
      let latestEvent: MouseEvent | null = null;

      const applyLatest = (): void => {
        this.dragFrame = null;
        const e = latestEvent;
        latestEvent = null;
        if (!e) return;
        const pointerX = e.clientX;
        const width =
          this.direction() === 'left' ? pointerX : window.innerWidth - pointerX;
        this.ngZone.run(() => this.dragMoved.emit(width));
      };

      const startWidth = this.startWidth;

      const endDrag = (restore = false): void => {
        this.cancelDragFrame();
        if (restore && startWidth !== null) {
          this.ngZone.run(() => this.dragMoved.emit(startWidth));
        } else {
          applyLatest();
        }
        this.cleanup();
        this.ngZone.run(() => this.dragEnded.emit());
      };

      this.mouseMoveHandler = (e: MouseEvent) => {
        latestEvent = e;
        if (this.dragFrame === null) {
          this.dragFrame = requestAnimationFrame(applyLatest);
        }
      };

      this.mouseUpHandler = () => endDrag(false);
      this.blurHandler = () => endDrag(true);
      this.keydownHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          endDrag(true);
        }
      };

      document.addEventListener('mousemove', this.mouseMoveHandler);
      document.addEventListener('mouseup', this.mouseUpHandler);
      window.addEventListener('blur', this.blurHandler);
      document.addEventListener('keydown', this.keydownHandler);
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private cleanup(): void {
    this.cancelDragFrame();
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
    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler);
      this.blurHandler = null;
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private cancelDragFrame(): void {
    if (this.dragFrame !== null) {
      cancelAnimationFrame(this.dragFrame);
      this.dragFrame = null;
    }
  }
}
