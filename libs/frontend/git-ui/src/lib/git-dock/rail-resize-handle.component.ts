import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

const KEYBOARD_STEP = 16;

@Component({
  selector: 'ptah-git-rail-resize-handle',
  standalone: true,
  template: `
    <div
      class="h-full w-1 flex-shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary/30 active:bg-primary/50"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize source control"
      tabindex="0"
      [attr.aria-valuenow]="width()"
      [attr.aria-valuemin]="min()"
      [attr.aria-valuemax]="max()"
      (pointerdown)="onPointerDown($event)"
      (lostpointercapture)="onLostPointerCapture($event)"
      (keydown)="onKeydown($event)"
    ></div>
  `,
  host: { class: 'block h-full flex-shrink-0' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RailResizeHandleComponent {
  readonly width = input.required<number>();
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly widthChange = output<number>();
  readonly widthCommit = output<void>();

  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private pointerId: number | null = null;
  private startX = 0;
  private startWidth = 0;
  private pendingX = 0;
  private frame: number | null = null;

  private readonly pointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pendingX = event.clientX;
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.widthChange.emit(
        this.clamp(this.startWidth + this.pendingX - this.startX),
      );
    });
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.flushPendingMove(event.clientX);
    this.finishDrag();
    this.widthCommit.emit();
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
    if (this.pointerId !== null) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.pendingX = event.clientX;
    this.startWidth = this.width();
    try {
      (event.currentTarget as HTMLElement | null)?.setPointerCapture(
        event.pointerId,
      );
    } catch {
      // Pointer capture is an optimization; document listeners remain authoritative.
    }
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
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = this.width() - KEYBOARD_STEP;
    else if (event.key === 'ArrowRight') next = this.width() + KEYBOARD_STEP;
    else if (event.key === 'Home') next = this.min();
    else if (event.key === 'End') next = this.max();
    if (next === null) return;
    event.preventDefault();
    this.widthChange.emit(this.clamp(next));
    this.widthCommit.emit();
  }

  private flushPendingMove(clientX: number): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.pendingX = clientX;
    this.widthChange.emit(
      this.clamp(this.startWidth + this.pendingX - this.startX),
    );
  }

  private cancelDrag(): void {
    if (this.pointerId === null) return;
    this.widthChange.emit(this.startWidth);
    this.finishDrag();
  }

  private finishDrag(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
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

  private clamp(width: number): number {
    return Math.min(Math.max(width, this.min()), this.max());
  }
}
