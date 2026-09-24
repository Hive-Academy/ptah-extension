import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

export type SplitHandleOrientation = 'vertical' | 'horizontal';

const KEYBOARD_STEP = 16;

/**
 * Drag handle between two panes. It owns no layout state: the parent keeps
 * the size of the pane BEFORE the handle and binds it back through `size`.
 *
 * - `vertical` separator: a column divider, drags on the x axis.
 * - `horizontal` separator: a row divider, drags on the y axis.
 *
 * `sizeChange` fires once per animation frame while dragging and on every
 * keyboard step. `sizeCommit` fires when a drag or key step ends, so the
 * parent can persist. Escape or a lost pointer restores the start size.
 * Double-click emits `reset`.
 */
@Component({
  selector: 'ptah-split-handle',
  standalone: true,
  template: `
    <div
      class="group flex h-full w-full touch-none items-center justify-center outline-none focus-visible:bg-primary/20"
      [class.cursor-col-resize]="orientation() === 'vertical'"
      [class.cursor-row-resize]="orientation() === 'horizontal'"
      role="separator"
      tabindex="0"
      [attr.aria-orientation]="orientation()"
      [attr.aria-label]="label()"
      [attr.aria-valuenow]="roundedSize()"
      [attr.aria-valuemin]="min()"
      [attr.aria-valuemax]="max()"
      title="Drag to resize · double-click to reset"
      (pointerdown)="onPointerDown($event)"
      (lostpointercapture)="onLostPointerCapture($event)"
      (keydown)="onKeydown($event)"
      (dblclick)="sizeReset.emit()"
    >
      <div
        class="rounded-full bg-base-content/15 transition-colors group-hover:bg-primary/60 group-active:bg-primary"
        [class.h-full]="orientation() === 'vertical'"
        [class.w-px]="orientation() === 'vertical'"
        [class.w-full]="orientation() === 'horizontal'"
        [class.h-px]="orientation() === 'horizontal'"
      ></div>
    </div>
  `,
  host: {
    class: 'block shrink-0',
    '[class.w-1.5]': "orientation() === 'vertical'",
    '[class.h-full]': "orientation() === 'vertical'",
    '[class.h-1.5]': "orientation() === 'horizontal'",
    '[class.w-full]': "orientation() === 'horizontal'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SplitHandleComponent {
  readonly orientation = input<SplitHandleOrientation>('vertical');
  readonly size = input.required<number>();
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly label = input('Resize panes');

  readonly sizeChange = output<number>();
  readonly sizeCommit = output<void>();
  readonly sizeReset = output<void>();

  protected readonly roundedSize = computed(() => Math.round(this.size()));

  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private pointerId: number | null = null;
  private startPos = 0;
  private startSize = 0;
  private pendingPos = 0;
  private frame: number | null = null;

  private readonly pointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pendingPos = this.axisPos(event);
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.sizeChange.emit(
        this.clamp(this.startSize + this.pendingPos - this.startPos),
      );
    });
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.flushPendingMove(this.axisPos(event));
    this.finishDrag();
    this.sizeCommit.emit();
  };

  private readonly pointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.cancelDrag();
  };

  private readonly windowBlur = (): void => this.cancelDrag();

  private readonly documentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.pointerId === null) return;
    event.preventDefault();
    this.cancelDrag();
  };

  constructor() {
    this.destroyRef.onDestroy(() => this.cancelDrag());
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.pointerId !== null || event.button !== 0) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.startPos = this.axisPos(event);
    this.pendingPos = this.startPos;
    this.startSize = this.size();
    try {
      (event.currentTarget as HTMLElement | null)?.setPointerCapture(
        event.pointerId,
      );
    } catch {
      // Pointer capture is an optimization; document listeners remain authoritative.
    }
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', this.pointerMove);
    document.addEventListener('pointerup', this.pointerUp);
    document.addEventListener('pointercancel', this.pointerCancel);
    document.addEventListener('keydown', this.documentKeydown);
    window.addEventListener('blur', this.windowBlur);
  }

  protected onLostPointerCapture(event: PointerEvent): void {
    if (event.pointerId === this.pointerId) this.cancelDrag();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const vertical = this.orientation() === 'vertical';
    const decrease = vertical ? 'ArrowLeft' : 'ArrowUp';
    const increase = vertical ? 'ArrowRight' : 'ArrowDown';
    let next: number | null = null;
    if (event.key === decrease) next = this.size() - KEYBOARD_STEP;
    else if (event.key === increase) next = this.size() + KEYBOARD_STEP;
    else if (event.key === 'Home') next = this.min();
    else if (event.key === 'End') next = this.max();
    if (next === null) return;
    event.preventDefault();
    this.sizeChange.emit(this.clamp(next));
    this.sizeCommit.emit();
  }

  private axisPos(event: PointerEvent): number {
    return this.orientation() === 'vertical' ? event.clientX : event.clientY;
  }

  private flushPendingMove(pos: number): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.pendingPos = pos;
    this.sizeChange.emit(
      this.clamp(this.startSize + this.pendingPos - this.startPos),
    );
  }

  private cancelDrag(): void {
    if (this.pointerId === null) return;
    this.sizeChange.emit(this.startSize);
    this.finishDrag();
  }

  private finishDrag(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    document.body.style.userSelect = '';
    document.removeEventListener('pointermove', this.pointerMove);
    document.removeEventListener('pointerup', this.pointerUp);
    document.removeEventListener('pointercancel', this.pointerCancel);
    document.removeEventListener('keydown', this.documentKeydown);
    window.removeEventListener('blur', this.windowBlur);
    if (pointerId === null) return;
    try {
      const separator = this.element.nativeElement.querySelector(
        '[role="separator"]',
      ) as HTMLElement | null;
      separator?.releasePointerCapture(pointerId);
    } catch {
      // The pointer may already have lost capture.
    }
  }

  private clamp(size: number): number {
    return Math.min(Math.max(size, this.min()), this.max());
  }
}
