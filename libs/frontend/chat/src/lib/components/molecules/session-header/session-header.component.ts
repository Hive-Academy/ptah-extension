import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  GitBranch,
  LucideAngularModule,
  PanelRight,
  TriangleAlert,
} from 'lucide-angular';
import {
  ContextRingComponent,
  type SessionLimitSummary,
} from '@ptah-extension/chat-ui';

/** Per-instance id source for the toggle's `aria-describedby` target. */
let nextHeaderId = 0;

/**
 * SessionHeaderComponent — the one header row above a full session view
 * (TASK_2026_677, plan part A2 component 1).
 *
 * Presentational only: the host (chat-view) passes every value and handles
 * `inspectorToggled`; nothing is injected. DOM order is tab order: title,
 * projected kind chip, branch chip, needs-you chip, limit chip, projected
 * actions, inspector toggle. There is no sidebar toggle here (decision
 * D-A2-1).
 *
 * The toggle dot is drawn from `data-dot` on the toggle, so a new dot kind is
 * one more `[data-dot='…']` rule and one more member of the input's union.
 * The host composes the dot (`limitAwareDot`), which is `null` while the
 * inspector is open.
 *
 * Closed-state cues (Delta 3, design D3.7): the limit chip, the 28 px context
 * ring around the toggle icon and the toggle's `aria-describedby` text show
 * only while the inspector is closed; open, the inspector says the same.
 *
 * `titleEl` and `toggleEl` are exposed for the inspector controller's
 * `attach(shell, opener, title)`. Both live inside the host's `@if`, so the
 * host reads them lazily.
 */
@Component({
  selector: 'ptah-session-header',
  standalone: true,
  imports: [LucideAngularModule, ContextRingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
      }
      /* Shown only when the shell (a size container) is at least 640 px wide. */
      @container (max-width: 639px) {
        .session-header-branch {
          display: none;
        }
      }
      /* The limit chip drops its glyph below 440 px and keeps the word. */
      @container (max-width: 439px) {
        .session-header-limit-glyph {
          display: none;
        }
      }
      /* Need ink at 55% for the border, transparent fill (design-spec 5 item 5). */
      .session-header-needs,
      .session-header-limit[data-state='near'] {
        border-color: color-mix(
          in oklch,
          var(--state-ink-need, oklch(var(--wa))) 55%,
          transparent
        );
      }
      .session-header-limit[data-state='at'] {
        border-color: color-mix(
          in oklch,
          var(--state-ink-err, oklch(var(--er))) 55%,
          transparent
        );
      }
      /* 7 px dot, 2 px base-100 ring, top-right of the toggle. */
      .session-header-dot {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 7px;
        height: 7px;
        border-radius: 9999px;
        box-shadow: 0 0 0 2px oklch(var(--b1));
        pointer-events: none;
      }
      [data-dot='need'] > .session-header-dot {
        background-color: var(--state-ink-need, oklch(var(--wa)));
      }
      [data-dot='err'] > .session-header-dot {
        background-color: var(--state-ink-err, oklch(var(--er)));
      }
      /* The selected-indicator ink (design-spec --sel): brand gold, theme-aware. */
      [data-dot='sel'] > .session-header-dot {
        background-color: var(--sel, var(--ptah-gold, oklch(var(--s))));
      }
    `,
  ],
  template: `
    <header
      class="flex h-12 min-w-0 items-center gap-2.5 border-b border-surface-border bg-base-100 px-4"
      data-test="session-header"
    >
      <h1
        #titleRef
        tabindex="-1"
        class="min-w-0 truncate text-[13px] font-semibold focus:outline-none"
        [attr.title]="title() || null"
      >
        {{ title() }}
      </h1>
      <span class="flex-1" aria-hidden="true"></span>
      <ng-content select="[sessionHeaderChip]" />
      @if (branch(); as branchName) {
        <span
          class="session-header-branch inline-flex h-[22px] max-w-[200px] shrink-0 items-center gap-1 rounded-md border border-surface-border px-2 font-mono text-[11px] text-base-content-muted"
          data-test="session-header-branch"
          [attr.title]="branchName"
        >
          <lucide-angular
            [img]="GitBranchIcon"
            class="h-3 w-3 shrink-0"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate">{{ branchName }}</span>
        </span>
      }
      @if (needsYouCount() > 0) {
        <span
          role="status"
          class="session-header-needs inline-flex h-[22px] shrink-0 items-center rounded-md border px-2 text-[11px] font-medium text-state-need"
          data-test="session-header-needs-you"
          title="Open This session to answer"
        >
          {{ needsYouText() }}
        </span>
      }
      @if (shownLimit(); as limit) {
        <span
          role="status"
          class="session-header-limit inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium"
          [class.text-state-need]="limit.state === 'near'"
          [class.text-state-err]="limit.state === 'at'"
          data-test="session-header-limit"
          [attr.data-state]="limit.state"
          [attr.title]="limit.fullText"
        >
          <lucide-angular
            [img]="TriangleAlertIcon"
            class="session-header-limit-glyph h-3 w-3 shrink-0"
            aria-hidden="true"
          />
          {{ limit.state === 'at' ? 'At limit' : 'Limit near' }}
          @if (limit.fullText) {
            <span class="sr-only">: {{ limit.fullText }}</span>
          }
        </span>
      }
      <ng-content select="[sessionHeaderAction]" />
      @let ringPercent = shownRingPercent();
      @let description = shownDescription();
      <button
        #toggle
        type="button"
        class="btn btn-ghost btn-square relative h-7 min-h-0 w-7 shrink-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
        data-test="session-header-inspector-toggle"
        [attr.aria-pressed]="inspectorOpen()"
        [attr.aria-controls]="inspectorId()"
        [attr.aria-label]="toggleLabel()"
        [attr.aria-describedby]="description ? descriptionId : null"
        [attr.title]="toggleLabel()"
        [attr.data-dot]="inspectorDot()"
        (click)="inspectorToggled.emit()"
      >
        @if (ringPercent !== null) {
          <ptah-context-ring
            class="pointer-events-none absolute inset-0"
            data-test="session-header-context-ring"
            [percent]="ringPercent"
            [size]="28"
          />
        }
        <lucide-angular
          [img]="PanelRightIcon"
          class="h-4 w-4"
          aria-hidden="true"
        />
        @if (inspectorDot()) {
          <span class="session-header-dot" aria-hidden="true"></span>
        }
      </button>
      @if (description) {
        <span class="sr-only" [id]="descriptionId">{{ description }}</span>
      }
    </header>
  `,
})
export class SessionHeaderComponent {
  protected readonly GitBranchIcon = GitBranch;
  protected readonly PanelRightIcon = PanelRight;
  protected readonly TriangleAlertIcon = TriangleAlert;
  /** `aria-describedby` target of this header's toggle. */
  protected readonly descriptionId = `ptah-session-header-desc-${nextHeaderId++}`;

  /** Session name; truncates, never wraps. */
  readonly title = input('');
  /** Working branch, or `null` to hide the chip. */
  readonly branch = input<string | null>(null);
  /** Unique pending requests of this session; the chip shows only when > 0. */
  readonly needsYouCount = input(0);
  /** Drives `aria-pressed` on the toggle. */
  readonly inspectorOpen = input(false);
  /** Toggle dot kind (`limitAwareDot` precedence); `null` draws no dot. */
  readonly inspectorDot = input<'need' | 'err' | 'sel' | null>(null);
  /** Accessible name of the toggle; does not change with the dot. */
  readonly toggleLabel = input.required<string>();
  /** `aria-controls` target: the inspector `<aside>` id. */
  readonly inspectorId = input('inspector');
  /** Session limit summary; the chip shows while closed and not `none`. */
  readonly limitCue = input<SessionLimitSummary | null>(null);
  /** Context window percent; the toggle ring shows while closed and known. */
  readonly contextRingPercent = input<number | null>(null);
  /** What is behind the closed toggle; never changes the accessible name. */
  readonly toggleDescription = input<string>('');

  readonly inspectorToggled = output<void>();

  /** The title heading, focus target when the inspector closes. */
  readonly titleEl = viewChild<ElementRef<HTMLElement>>('titleRef');
  /** The inspector toggle, the inspector's opener. */
  readonly toggleEl = viewChild<ElementRef<HTMLButtonElement>>('toggle');

  protected readonly needsYouText = computed(() => {
    const count = this.needsYouCount();
    return count === 1 ? '1 needs you' : `${count} need you`;
  });

  protected readonly shownLimit = computed(() => {
    const cue = this.limitCue();
    return !this.inspectorOpen() && cue !== null && cue.state !== 'none'
      ? cue
      : null;
  });

  protected readonly shownRingPercent = computed(() =>
    this.inspectorOpen() ? null : this.contextRingPercent(),
  );

  protected readonly shownDescription = computed(() =>
    this.inspectorOpen() ? '' : this.toggleDescription(),
  );
}
