import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
} from '@angular/core';
import {
  LucideAngularModule,
  LayoutGrid,
  Square,
  Columns2,
  Columns3,
  Lock,
  Unlock,
} from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { CanvasStore } from './canvas.store';

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
        [attr.aria-label]="
          isSingleton()
            ? 'Layout controls not applicable for a single session'
            : 'Layout options'
        "
        [title]="
          isSingleton()
            ? 'Layout controls require multiple sessions'
            : 'Layout options'
        "
        (click)="toggleOpen()"
      >
        <lucide-angular [img]="LayoutGridIcon" class="w-3.5 h-3.5" />
        <span class="text-xs font-medium">Layout</span>
      </button>

      <!-- Expandable dock actions: 1, 2, 3 columns and lock/unlock -->
      <div
        content
        class="p-1 flex items-center gap-1 bg-base-200 border border-base-content/10 rounded-lg shadow-lg"
        role="group"
        aria-label="Maximum tiles per row"
        (keydown.escape)="close()"
      >
        <button
          type="button"
          class="btn btn-xs btn-square btn-ghost"
          [class.btn-active]="selected() === 1"
          [disabled]="columnActionsDisabled()"
          [attr.aria-pressed]="selected() === 1"
          aria-label="1 column"
          title="1 column"
          (click)="select(1)"
        >
          <lucide-angular [img]="SquareIcon" class="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          class="btn btn-xs btn-square btn-ghost"
          [class.btn-active]="selected() === 2"
          [disabled]="columnActionsDisabled()"
          [attr.aria-pressed]="selected() === 2"
          aria-label="2 columns"
          title="2 columns"
          (click)="select(2)"
        >
          <lucide-angular [img]="Columns2Icon" class="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          class="btn btn-xs btn-square btn-ghost"
          [class.btn-active]="selected() === 3"
          [disabled]="columnActionsDisabled()"
          [attr.aria-pressed]="selected() === 3"
          aria-label="3 columns"
          title="3 columns"
          (click)="select(3)"
        >
          <lucide-angular [img]="Columns3Icon" class="w-3.5 h-3.5" />
        </button>
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
              ? 'Unlock tiles (enable drag & resize)'
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

  private readonly store = inject(CanvasStore);

  protected readonly LayoutGridIcon = LayoutGrid;
  protected readonly SquareIcon = Square;
  protected readonly Columns2Icon = Columns2;
  protected readonly Columns3Icon = Columns3;
  protected readonly LockIcon = Lock;
  protected readonly UnlockIcon = Unlock;

  readonly isSingleton = computed(() => {
    const count = this.tileCount();
    return count !== null && count <= 1;
  });
  readonly disabled = computed(() => this.isSingleton());
  readonly columnActionsDisabled = computed(
    () => this.locked() || this.isSingleton(),
  );
  readonly lockActionDisabled = computed(() => this.isSingleton());

  protected readonly selected = computed(() => {
    const path = this.store.activeWorkspacePath();
    return path === null ? 'auto' : this.store.columnsPreferenceFor(path);
  });

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

  protected select(preference: 1 | 2 | 3): void {
    if (this.locked() || this.isSingleton()) return;
    if (this.selected() === preference) {
      this.store.setColumnsPreference('auto');
    } else {
      this.store.setColumnsPreference(preference);
    }
  }

  protected handleToggleLock(): void {
    if (this.isSingleton()) return;
    this.lockToggled.emit();
  }
}
