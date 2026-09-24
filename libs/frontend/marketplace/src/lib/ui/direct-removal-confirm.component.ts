import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/** A server Ptah did not write, and the config files removing it edits. */
export interface DirectRemovalTarget {
  readonly title: string;
  readonly configPaths: readonly string[];
}

/**
 * The inline confirmation before Ptah edits a config file it did not write
 * (a `direct` removal): names every server and every file the removal
 * touches, then "Remove anyway" or "Cancel". Follows the Registry browser's
 * confirm step (`mcp-directory-browser.component.ts:380-425`).
 *
 * Two forms:
 * - single (`selectedCount` null): one server, its paths listed bare;
 * - bulk (`selectedCount` set): "N of the M selected servers…", each path
 *   prefixed with its server's name.
 *
 * Presentational: the parent owns what is pending, runs the removal on
 * `confirmed` and hides this on `cancelled`. Escape is the parent's.
 *
 * @example
 * ```html
 * <ptah-direct-removal-confirm
 *   [targets]="[row]"
 *   (confirmed)="remove(true)"
 *   (cancelled)="confirming.set(false)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-direct-removal-confirm',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      role="group"
      class="space-y-2 rounded-lg border border-warning/40 bg-base-200 p-3"
      [attr.aria-label]="groupLabel()"
      data-testid="direct-removal-confirm"
    >
      <p class="text-xs leading-relaxed text-base-content">
        @if (bulk()) {
          {{ targets().length }} of the {{ selectedCount() }} selected servers
          were not installed by Ptah. Removing them edits config files you own:
        } @else {
          Ptah did not install
          <span class="font-medium">{{ targets()[0]?.title }}</span
          >. Removing it edits a config file you own:
        }
      </p>
      <ul class="space-y-1" aria-label="Config files that will be edited">
        @for (target of targets(); track target.title) {
          @for (path of target.configPaths; track path) {
            <li
              class="break-all font-mono text-[11px] text-base-content-muted"
              data-testid="direct-removal-path"
            >
              @if (bulk()) {
                <span class="font-sans font-medium text-base-content">{{
                  target.title
                }}</span>
                —
              }
              {{ path }}
            </li>
          }
        }
      </ul>
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-error btn-xs"
          data-testid="direct-removal-confirm-button"
          (click)="confirmed.emit()"
        >
          Remove anyway
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-testid="direct-removal-cancel"
          (click)="cancelled.emit()"
        >
          Cancel
        </button>
      </div>
    </div>
  `,
})
export class DirectRemovalConfirmComponent {
  /** The `direct` servers whose config files the removal edits. */
  public readonly targets = input.required<readonly DirectRemovalTarget[]>();

  /**
   * How many servers the bulk run removes in total; `null` for a single
   * removal. @default null
   */
  public readonly selectedCount = input<number | null>(null);

  /** The user chose "Remove anyway". */
  public readonly confirmed = output<void>();

  /** The user chose "Cancel". */
  public readonly cancelled = output<void>();

  protected readonly bulk = computed(() => this.selectedCount() !== null);

  protected readonly groupLabel = computed(() =>
    this.bulk()
      ? `Confirm removal of ${this.selectedCount()} servers`
      : `Confirm removal of ${this.targets()[0]?.title ?? 'this server'}`,
  );
}
