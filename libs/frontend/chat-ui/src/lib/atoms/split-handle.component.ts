import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

export type SplitHandleOrientation = 'vertical' | 'horizontal';
export type SplitHandleAppearance = 'line' | 'grip';

const KEYBOARD_STEP = 16;
const SHIFT_STEP_FACTOR = 3;

const SEPARATOR_BASE =
  'group flex h-full w-full touch-none items-center justify-center outline-none';

/** Grip-only separator classes, on top of `SEPARATOR_BASE`. */
const GRIP_SEPARATOR_EXTRA =
  'relative transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-base-content';

/**
 * Drag handle between two panes. It owns no layout state: the parent keeps
 * the size of one pane and binds it back through `size`. By default that is
 * the pane BEFORE the handle; with `inverted` it is the pane AFTER it, so
 * dragging toward that pane shrinks it and the arrow keys swap.
 *
 * - `vertical` separator: a column divider, drags on the x axis.
 * - `horizontal` separator: a row divider, drags on the y axis.
 * - `appearance="line"` (default): a thin line; the host sizes itself.
 * - `appearance="grip"`: a visible grip, a width readout and a solid focus
 *   outline; the parent positions and sizes the host.
 *
 * `sizeChange` fires once per animation frame while dragging and on every
 * keyboard step (Shift triples the step). `sizeCommit` fires when a drag or
 * key step ends, so the parent can persist. Escape, window blur or a lost
 * pointer restores the start size and then emits `sizeCancel`.
 * `draggingChange` is a visual flag only. Double-click emits `sizeReset`.
 */
@Component({
  selector: 'ptah-split-handle',
  standalone: true,
  template: `
    <div
      [class]="separatorClass()"
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
      @if (appearance() === 'grip') {
        <span [class]="gripLineClass()" data-testid="split-handle-line"></span>
        <span [class]="gripClass()" data-testid="split-handle-grip"></span>
        <span
          [class]="readoutClass()"
          aria-hidden="true"
          data-testid="split-handle-readout"
          >{{ roundedSize() }} px</span
        >
      } @else {
        <div
          class="rounded-full bg-base-content/15 transition-colors group-hover:bg-primary/60 group-active:bg-primary"
          [class.h-full]="orientation() === 'vertical'"
          [class.w-px]="orientation() === 'vertical'"
          [class.w-full]="orientation() === 'horizontal'"
          [class.h-px]="orientation() === 'horizontal'"
        ></div>
      }
    </div>
  `,
  host: {
    class: 'block shrink-0',
    '[class.w-1]': "appearance() === 'line' && orientation() === 'vertical'",
    '[class.h-full]': "orientation() === 'vertical'",
    '[class.h-1]': "appearance() === 'line' && orientation() === 'horizontal'",
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
  /** `size` belongs to the pane AFTER the handle instead of the one before. */
  readonly inverted = input(false);
  readonly appearance = input<SplitHandleAppearance>('line');

  readonly sizeChange = output<number>();
  readonly sizeCommit = output<void>();
  readonly sizeReset = output<void>();
  /** Emitted after a cancelled drag has restored the start size. */
  readonly sizeCancel = output<void>();
  /** Visual flag only: on pointerup it turns false before `sizeCommit`. */
  readonly draggingChange = output<boolean>();

  protected readonly roundedSize = computed(() => Math.round(this.size()));
  protected readonly dragging = signal(false);

  /**
   * Classes of the one separator both appearances share. `line` keeps its
   * original class string; `grip` adds its outline, tone and transition.
   */
  protected readonly separatorClass = computed(() => {
    const cursor =
      this.orientation() === 'vertical'
        ? 'cursor-col-resize'
        : 'cursor-row-resize';
    if (this.appearance() !== 'grip') {
      return `${SEPARATOR_BASE} focus-visible:bg-primary/20 ${cursor}`;
    }
    const tone = this.dragging()
      ? 'bg-primary/20'
      : 'focus-visible:bg-base-content/[0.08]';
    return `${SEPARATOR_BASE} ${GRIP_SEPARATOR_EXTRA} ${tone} ${cursor}`;
  });

  protected readonly gripLineClass = computed(() => {
    const vertical = this.orientation() === 'vertical';
    const edge = vertical
      ? `inset-y-0 w-px ${this.inverted() ? 'left-0' : 'right-0'}`
      : `inset-x-0 h-px ${this.inverted() ? 'top-0' : 'bottom-0'}`;
    const tone = this.dragging()
      ? 'bg-primary'
      : 'bg-base-content/15 group-hover:bg-primary/60';
    return `pointer-events-none absolute ${edge} transition-colors duration-150 motion-reduce:transition-none ${tone}`;
  });

  protected readonly gripClass = computed(() => {
    const shape = this.orientation() === 'vertical' ? 'w-1 h-8' : 'h-1 w-8';
    const tone = this.dragging()
      ? 'bg-base-content'
      : 'bg-base-content/60 group-hover:bg-base-content/80';
    return `pointer-events-none relative rounded-full ${shape} transition-colors duration-150 motion-reduce:transition-none ${tone}`;
  });

  protected readonly readoutClass = computed(() => {
    const vertical = this.orientation() === 'vertical';
    const inverted = this.inverted();
    // Mid-handle, just past the 32 px grip (half is 16 px, so 20 px clears
    // it): a top/left anchor sat over the docked pane's title row.
    const anchor = vertical
      ? `top-1/2 mt-5 ${inverted ? 'left-0' : 'right-0'}`
      : `left-1/2 ml-5 ${inverted ? 'top-0' : 'bottom-0'}`;
    const visibility = this.dragging()
      ? 'block'
      : 'hidden group-focus-visible:block';
    return `pointer-events-none absolute z-10 ${anchor} ${visibility} whitespace-nowrap rounded bg-base-300 px-1.5 py-0.5 text-[11px] leading-4 tabular-nums text-base-content`;
  });

  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private pointerId: number | null = null;
  private startPos = 0;
  private startSize = 0;
  private pendingPos = 0;
  private frame: number | null = null;
  /** Body inline styles from before the drag, restored when it ends. */
  private bodyStyleBefore: { userSelect: string; cursor: string } | null = null;

  private readonly pointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pendingPos = this.axisPos(event);
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.sizeChange.emit(this.dragSize());
    });
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.flushPendingMove(this.axisPos(event));
    this.finishDrag(true);
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
    // Outputs are already torn down here, so emitting would log NG0953.
    // Release listeners, capture and body styles silently.
    this.destroyRef.onDestroy(() => this.finishDrag(false));
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
    const body = document.body.style;
    this.bodyStyleBefore = { userSelect: body.userSelect, cursor: body.cursor };
    body.userSelect = 'none';
    body.cursor =
      this.orientation() === 'vertical' ? 'col-resize' : 'row-resize';
    document.addEventListener('pointermove', this.pointerMove);
    document.addEventListener('pointerup', this.pointerUp);
    document.addEventListener('pointercancel', this.pointerCancel);
    document.addEventListener('keydown', this.documentKeydown);
    window.addEventListener('blur', this.windowBlur);
    this.dragging.set(true);
    this.draggingChange.emit(true);
  }

  protected onLostPointerCapture(event: PointerEvent): void {
    if (event.pointerId === this.pointerId) this.cancelDrag();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const vertical = this.orientation() === 'vertical';
    const before = vertical ? 'ArrowLeft' : 'ArrowUp';
    const after = vertical ? 'ArrowRight' : 'ArrowDown';
    const [decrease, increase] = this.inverted()
      ? [after, before]
      : [before, after];
    const step = event.shiftKey
      ? KEYBOARD_STEP * SHIFT_STEP_FACTOR
      : KEYBOARD_STEP;
    let next: number | null = null;
    if (event.key === decrease) next = this.size() - step;
    else if (event.key === increase) next = this.size() + step;
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

  private dragSize(): number {
    const delta = this.pendingPos - this.startPos;
    return this.clamp(
      this.inverted() ? this.startSize - delta : this.startSize + delta,
    );
  }

  private flushPendingMove(pos: number): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.pendingPos = pos;
    this.sizeChange.emit(this.dragSize());
  }

  private cancelDrag(): void {
    if (this.pointerId === null) return;
    this.sizeChange.emit(this.startSize);
    this.finishDrag(true);
    this.sizeCancel.emit();
  }

  /**
   * Ends a drag on every exit path. `notify` is false only on destroy, where
   * the outputs no longer exist.
   */
  private finishDrag(notify: boolean): void {
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
    // Restore what the body had before this drag, not '' (another owner may
    // still hold a cursor or selection style).
    const before = this.bodyStyleBefore;
    this.bodyStyleBefore = null;
    document.body.style.userSelect = before?.userSelect ?? '';
    document.body.style.cursor = before?.cursor ?? '';
    try {
      const separator = this.element.nativeElement.querySelector(
        '[role="separator"]',
      ) as HTMLElement | null;
      separator?.releasePointerCapture(pointerId);
    } catch {
      // The pointer may already have lost capture.
    }
    this.dragging.set(false);
    if (notify) this.draggingChange.emit(false);
  }

  private clamp(size: number): number {
    return Math.min(Math.max(size, this.min()), this.max());
  }
}
