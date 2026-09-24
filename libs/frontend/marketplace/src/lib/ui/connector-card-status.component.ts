import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CircleAlert,
  Clock,
  LoaderCircle,
  LucideAngularModule,
  RotateCw,
  X,
} from 'lucide-angular';

import type { ConnectorCardState } from './connector-card-state';
import { StatusPillComponent } from './status-pill.component';

/**
 * The `[card-status]` content of a connector: pill, "managed outside Ptah",
 * the error reason, the in-flight line, the timed-out setup with Retry, the
 * Smithery key link and the action error with Dismiss. Render it only when
 * `card.hasStatus` so an empty slot collapses.
 */
@Component({
  selector: 'ptah-connector-card-status',
  standalone: true,
  imports: [LucideAngularModule, RouterLink, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col gap-2',
    'data-testid': 'connector-card-status',
  },
  template: `
    @if (card().pill || card().managedElsewhere) {
      <div class="flex flex-wrap items-center gap-2">
        @if (card().pill; as pill) {
          <ptah-status-pill [status]="pill" />
        }
        @if (card().managedElsewhere) {
          <span
            class="text-[11px] text-base-content-muted"
            data-testid="connector-card-managed"
            >Managed outside Ptah</span
          >
        }
      </div>
    }
    @if (card().detail; as detail) {
      <p
        class="m-0 text-xs text-base-content-muted"
        data-testid="connector-card-detail"
      >
        {{ detail }}
      </p>
    }
    @if (card().activity; as activity) {
      <p
        class="m-0 flex items-center gap-1.5 text-xs text-base-content-muted"
        role="status"
        [attr.data-activity]="activity"
        data-testid="connector-card-activity"
      >
        <lucide-angular
          [img]="SpinnerIcon"
          class="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {{
          activity === 'polling'
            ? 'Finish the setup in your browser…'
            : 'Working…'
        }}
      </p>
    }
    @if (card().timedOut && !card().activity) {
      <div
        class="flex flex-wrap items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-base-content"
        role="status"
        data-testid="connector-card-timeout"
      >
        <lucide-angular
          [img]="TimeoutIcon"
          class="h-3.5 w-3.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1"
          >Setup was not confirmed within 5 minutes.</span
        >
        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          [attr.aria-label]="'Retry setup for ' + card().connector.label"
          data-testid="connector-card-timeout-retry"
          (click)="retry.emit()"
        >
          <lucide-angular
            [img]="RetryIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
          Retry
        </button>
      </div>
    }
    @if (card().needsSmitheryKey && smitheryKeyLink(); as link) {
      <a
        class="link link-primary w-fit text-xs"
        [routerLink]="link"
        data-testid="connector-card-smithery-key"
        >Add a Smithery key</a
      >
    }
    @if (card().error; as message) {
      <div
        class="flex items-start gap-1.5 rounded-lg border border-error/40 bg-error/10 px-2 py-1.5 text-xs text-base-content"
        role="alert"
        data-testid="connector-card-error"
      >
        <lucide-angular
          [img]="AlertIcon"
          class="mt-px h-3.5 w-3.5 shrink-0 text-error"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 break-words">{{ message }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs h-5 min-h-0 w-5 p-0"
          aria-label="Dismiss error"
          data-testid="connector-card-error-dismiss"
          (click)="dismissError.emit()"
        >
          <lucide-angular
            [img]="DismissIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
        </button>
      </div>
    }
  `,
})
export class ConnectorCardStatusComponent {
  protected readonly SpinnerIcon = LoaderCircle;
  protected readonly TimeoutIcon = Clock;
  protected readonly RetryIcon = RotateCw;
  protected readonly AlertIcon = CircleAlert;
  protected readonly DismissIcon = X;

  public readonly card = input.required<ConnectorCardState>();

  /** Router commands of the Smithery key page; `null` draws no key link. */
  public readonly smitheryKeyLink = input<readonly string[] | null>(null);

  /** Retry was pressed on a timed-out setup. */
  public readonly retry = output<void>();

  /** The action error was dismissed. */
  public readonly dismissError = output<void>();
}
