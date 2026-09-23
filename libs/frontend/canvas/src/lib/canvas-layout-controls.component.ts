import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  untracked,
} from '@angular/core';
import {
  LucideAngularModule,
  LayoutGrid,
  Grid3x3,
  PanelsTopLeft,
  Rows2,
  Lock,
  Unlock,
} from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import type { CanvasLayoutPreset } from './canvas-layout-intent';

const PRESETS: ReadonlyArray<{
  readonly preset: CanvasLayoutPreset;
  readonly title: string;
  readonly label: string;
  readonly icon: typeof LayoutGrid;
}> = [
  {
    preset: 'even-grid',
    title: 'Even grid',
    label: 'Even grid preset: changes all tile widths to equal rows of three',
    icon: Grid3x3,
  },
  {
    preset: 'one-plus-two',
    title: '1 + 2',
    label:
      'One plus two preset: changes all tile widths to one full-width tile, then pairs',
    icon: PanelsTopLeft,
  },
  {
    preset: 'focus-plus-stack',
    title: 'Focus + stack',
    label:
      'Focus plus stack preset: changes all tile widths to the active tile at full width, then pairs',
    icon: Rows2,
  },
];

@Component({
  selector: 'ptah-canvas-layout-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, NativePopoverComponent],
  template: `
    <ptah-native-popover
      [isOpen]="isOpen()"
      [placement]="'bottom-end'"
      [hasBackdrop]="true"
      [backdropClass]="'transparent'"
      (closed)="close()"
    >
      <!-- Floating-looking layout trigger button -->
      <button
        trigger
        type="button"
        class="btn btn-xs btn-ghost gap-1.5 shadow-sm border border-base-content/10 bg-base-100/90 hover:bg-base-200"
        [class.btn-active]="isOpen()"
        [disabled]="disabled()"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-haspopup]="'true'"
        aria-label="Layout options"
        title="Layout options"
        (click)="toggleOpen()"
      >
        <lucide-angular [img]="LayoutGridIcon" class="w-3.5 h-3.5" />
        <span class="text-xs font-medium">Layout</span>
      </button>

      <!-- Expandable dock actions: layout presets and lock/unlock -->
      <div
        content
        class="p-1 flex items-center gap-1 bg-base-200 border border-base-content/10 rounded-lg shadow-lg"
        role="group"
        aria-label="Layout presets"
        (keydown.escape)="close()"
      >
        @for (item of presets; track item.preset) {
          <button
            type="button"
            class="btn btn-xs btn-square btn-ghost"
            [disabled]="presetActionsDisabled()"
            [attr.aria-label]="item.label"
            [attr.data-preset]="item.preset"
            [title]="item.title"
            (click)="select(item.preset)"
          >
            <lucide-angular [img]="item.icon" class="w-3.5 h-3.5" />
          </button>
        }
        <div
          class="w-px h-4 bg-base-content/10 my-0.5 mx-0.5"
          aria-hidden="true"
        ></div>
        <button
          type="button"
          class="btn btn-xs btn-square btn-ghost"
          [class.btn-active]="locked()"
          [disabled]="lockActionDisabled()"
          [attr.aria-pressed]="locked()"
          [attr.aria-label]="locked() ? 'Unlock tiles' : 'Lock tiles'"
          [title]="
            locked()
              ? 'Unlock tiles (enable layout changes)'
              : 'Lock tiles (freeze layout)'
          "
          (click)="handleToggleLock()"
        >
          <lucide-angular
            [img]="locked() ? LockIcon : UnlockIcon"
            class="w-3.5 h-3.5"
          />
        </button>
      </div>
    </ptah-native-popover>
  `,
})
export class CanvasLayoutControlsComponent {
  readonly locked = input(false);
  readonly tileCount = input<number | null>(null);
  readonly isOpen = model(false);
  readonly lockToggled = output<void>();
  /** The parent applies the preset to the active workspace's intent. */
  readonly presetRequested = output<CanvasLayoutPreset>();

  protected readonly presets = PRESETS;
  protected readonly LayoutGridIcon = LayoutGrid;
  protected readonly LockIcon = Lock;
  protected readonly UnlockIcon = Unlock;

  readonly isSingleton = computed(() => {
    const count = this.tileCount();
    return count !== null && count <= 1;
  });
  readonly disabled = computed(() => this.tileCount() === 0);
  readonly presetActionsDisabled = computed(
    () => this.locked() || this.isSingleton(),
  );
  readonly lockActionDisabled = computed(() => this.disabled());

  constructor() {
    effect(() => {
      if (this.disabled()) {
        untracked(() => this.isOpen.set(false));
      }
    });
  }

  open(): void {
    if (!this.disabled()) {
      this.isOpen.set(true);
    }
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggleOpen(): void {
    if (this.disabled()) return;
    this.isOpen.set(!this.isOpen());
  }

  /** Closing returns focus to the dock trigger through the popover. */
  protected select(preset: CanvasLayoutPreset): void {
    if (this.presetActionsDisabled()) return;
    this.presetRequested.emit(preset);
    this.close();
  }

  protected handleToggleLock(): void {
    if (this.lockActionDisabled()) return;
    this.lockToggled.emit();
  }
}
