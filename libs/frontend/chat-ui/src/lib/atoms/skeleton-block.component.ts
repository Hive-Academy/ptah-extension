import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * SkeletonBlockComponent — the repository's one daisyui loading-row skeleton.
 *
 * The exact "avatar + title line + subtitle line + optional trailing action"
 * markup was duplicated verbatim in `plugin-status-widget.component.ts` and
 * `setup-status-widget.component.ts`, differing only in the two line widths.
 * TASK_2026_380 needed a third and fourth copy for the boot handover
 * (session sidebar, canvas region), which is what makes one atom worth it.
 *
 * Purely presentational: inputs only, no service, no timer.
 */
@Component({
  selector: 'ptah-skeleton-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col gap-2 w-full"
      aria-hidden="true"
      data-testid="skeleton-block"
    >
      @for (row of rowIndexes(); track row) {
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-1">
            @if (showAvatar()) {
              <div class="skeleton w-6 h-6 rounded-full shrink-0"></div>
            }
            <div class="flex-1">
              <div [class]="'skeleton h-3 mb-1 ' + titleWidthClass()"></div>
              <div [class]="'skeleton h-2 ' + subtitleWidthClass()"></div>
            </div>
          </div>
          @if (showAction()) {
            <div class="skeleton h-6 w-16"></div>
          }
        </div>
      }
    </div>
  `,
})
export class SkeletonBlockComponent {
  /** How many placeholder rows to paint. */
  readonly rows = input<number>(1);
  readonly showAvatar = input<boolean>(true);
  readonly showAction = input<boolean>(false);
  /** Tailwind width class for the title line. */
  readonly titleWidthClass = input<string>('w-16');
  /** Tailwind width class for the subtitle line. */
  readonly subtitleWidthClass = input<string>('w-24');

  protected readonly rowIndexes = computed<readonly number[]>(() =>
    Array.from({ length: Math.max(1, this.rows()) }, (_unused, index) => index),
  );
}
