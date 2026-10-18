import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { PTAH_UI_HOST_SOURCES } from '../../services/ptah-ui-host-sources';
import {
  PTAH_UI_DISPLAY_DOCK,
  displayFenceKey,
  type PtahUiDisplayFenceStatus,
} from '../../services/ptah-ui-display-dock';

/** Status and collection action beside a full inline display fence. */
@Component({
  selector: 'ptah-ui-display-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (available()) {
      @let current = status();
      <div
        class="my-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-base-content-muted"
        data-testid="ptah-ui-display-chip"
        [attr.data-state]="current?.kind ?? 'pending'"
      >
        <span data-testid="ptah-ui-display-chip-state">
          @if (current === null) {
            Pending display
          } @else if (current.kind === 'invalid') {
            Not in display
          } @else if (current.kind === 'applied') {
            In display
          } @else if (current.kind === 'superseded') {
            Updated later
          } @else {
            No longer in display
          }
        </span>
        @if (
          current !== null &&
          current.kind !== 'invalid' &&
          current.kind !== 'evicted'
        ) {
          <button
            type="button"
            class="btn btn-xs btn-outline rounded-full"
            data-testid="ptah-ui-display-chip-open"
            (click)="openInDisplay(current.surfaceKey)"
          >
            {{
              current.kind === 'superseded' ? 'Open latest' : 'Open in display'
            }}
          </button>
        }
      </div>
    }
  `,
})
export class PtahUiDisplayChipComponent {
  private readonly dock = inject(PTAH_UI_DISPLAY_DOCK, { optional: true });
  private readonly hostSources = inject(PTAH_UI_HOST_SOURCES, {
    optional: true,
  });

  readonly raw = input.required<string>();
  readonly ordinal = input.required<number>();
  readonly messageId = input.required<string>();
  readonly nodeId = input.required<string>();
  readonly active = input(true);
  /** Batch 4 binds this request to sheet navigation. */
  readonly openInDisplayRequested = output<string>();

  protected readonly available = computed(
    () => this.dock !== null && this.hostSources !== null,
  );
  protected readonly status = computed((): PtahUiDisplayFenceStatus | null => {
    if (this.dock === null || this.hostSources === null) return null;
    return this.dock.fenceStatus(
      this.hostSources.tabId(),
      displayFenceKey(this.messageId(), this.nodeId(), this.ordinal()),
    );
  });

  protected openInDisplay(surfaceKey: string): void {
    this.openInDisplayRequested.emit(surfaceKey);
  }
}
