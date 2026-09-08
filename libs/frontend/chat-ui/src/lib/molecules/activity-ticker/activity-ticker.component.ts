import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { ActivityItem } from '@ptah-extension/core';

/**
 * ActivityTickerComponent — the Electron header's back-office news line
 * (TASK_2026_380, component 14e).
 *
 * Shows one {@link ActivityItem} at a time and rotates through the list on a
 * timer, so a burst of background work reads as a sentence rather than a
 * flicker. Rotation is driven by the timer and NOT by arrivals — a coalesced
 * progress stream updates the text of the line it already owns.
 *
 * Inputs only: no service injection, per the `chat-ui` presentational rule.
 * The animation is a CSS `translateY` + `opacity` transition; no animation
 * package is added for one ticker, and the reduced-motion opt-out lives in the
 * stylesheet rather than in TypeScript.
 *
 * When `idle()` is true the component collapses to a muted dot that is STILL a
 * click target and still in the DOM, so the fixed-height header never reflows
 * between busy and quiet.
 */

/** Human labels for the fallback when an emitter sent an empty summary. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  boot: 'Boot',
  memory: 'Memory',
  indexing: 'Indexing',
  skills: 'Skills',
  cron: 'Scheduler',
  harness: 'Harness',
  sessions: 'Sessions',
  embedder: 'Embedder',
  vec: 'Vector search',
  database: 'Database',
};

@Component({
  selector: 'ptah-activity-ticker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center h-full no-drag"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <button
        type="button"
        class="btn btn-ghost btn-xs gap-1.5 no-drag max-w-[22rem] font-normal"
        aria-label="Open Thoth background activity"
        (click)="activate.emit()"
      >
        <span
          [class]="'w-1.5 h-1.5 rounded-full shrink-0 ' + dotClass()"
          aria-hidden="true"
        ></span>
        @if (!idle()) {
          <span
            class="ticker-line truncate text-xs"
            [attr.data-item-id]="current()?.id"
            data-testid="activity-ticker-line"
          >
            {{ label() }}
          </span>
        }
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .ticker-line {
        animation: tickerIn 180ms ease-out both;
      }

      @keyframes tickerIn {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ticker-line {
          animation: none !important;
        }
      }
    `,
  ],
})
export class ActivityTickerComponent {
  private readonly destroyRef = inject(DestroyRef);

  /** Newest first, exactly as the service holds them. */
  readonly items = input.required<readonly ActivityItem[]>();
  readonly idle = input.required<boolean>();
  readonly rotateMs = input<number>(4000);

  /** Clicked — the shell decides where that goes. */
  readonly activate = output<void>();

  private readonly index = signal<number>(0);
  /** The head id last seen, so a fresh event can reset the rotation. */
  private headId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly current = computed<ActivityItem | null>(() => {
    const list = this.items();
    if (list.length === 0) return null;
    return list[this.index() % list.length] ?? list[0];
  });

  /** An empty summary falls back to the source, never to a blank line. */
  protected readonly label = computed<string>(() => {
    const item = this.current();
    if (!item) return '';
    if (item.summary) return item.summary;
    return SOURCE_LABELS[item.source] ?? item.source;
  });

  protected readonly dotClass = computed<string>(() => {
    if (this.idle()) return 'bg-base-content/30';
    return this.current()?.level === 'warn' ? 'bg-warning' : 'bg-success';
  });

  constructor() {
    // A newer head means the user should see the fresh line now, not when its
    // turn comes round.
    effect(() => {
      const head = this.items()[0]?.id ?? null;
      if (head === this.headId) return;
      this.headId = head;
      untracked(() => this.index.set(0));
    });

    // One interval for the component's life. `rotateMs` is read reactively, so
    // a changed interval re-arms rather than accumulating a second timer.
    effect(() => {
      const period = Math.max(250, this.rotateMs());
      this.clearTimer();
      this.timer = setInterval(() => this.advance(), period);
    });

    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  private advance(): void {
    const length = this.items().length;
    if (length <= 1) return;
    this.index.update((value) => (value + 1) % length);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
