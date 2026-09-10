import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { CanvasStore } from './canvas.store';
import type { ColumnsPreference } from './canvas-layout-intent';

const PREFERENCES: readonly ColumnsPreference[] = ['auto', 1, 2, 3];

@Component({
  selector: 'ptah-canvas-layout-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="join bg-base-200 shadow-sm"
      role="group"
      aria-label="Maximum tiles per row"
    >
      @for (preference of preferences; track preference) {
        <button
          type="button"
          class="join-item btn btn-xs"
          [class.btn-active]="selected() === preference"
          [disabled]="locked()"
          [attr.aria-pressed]="selected() === preference"
          [attr.aria-label]="label(preference)"
          (click)="select(preference)"
        >
          {{ preference === 'auto' ? 'Auto' : preference }}
        </button>
      }
    </div>
  `,
})
export class CanvasLayoutControlsComponent {
  readonly locked = input(false);
  private readonly store = inject(CanvasStore);
  protected readonly preferences = PREFERENCES;
  protected readonly selected = computed(() => {
    const path = this.store.activeWorkspacePath();
    return path === null ? 'auto' : this.store.columnsPreferenceFor(path);
  });

  protected select(preference: ColumnsPreference): void {
    if (this.locked()) return;
    this.store.setColumnsPreference(preference);
  }

  protected label(preference: ColumnsPreference): string {
    return preference === 'auto'
      ? 'Automatically choose tiles per row'
      : `At most ${preference} tile${preference === 1 ? '' : 's'} per row`;
  }
}
