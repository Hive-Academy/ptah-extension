import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { GitBranch, LucideAngularModule, PanelRight } from 'lucide-angular';

/**
 * SessionHeaderComponent — the one header row above a full session view
 * (TASK_2026_677, plan part A2 component 1).
 *
 * Presentational only: the host (chat-view) passes every value and handles
 * `inspectorToggled`; nothing is injected. DOM order is tab order: title,
 * projected kind chip, branch chip, needs-you chip, projected actions,
 * inspector toggle. There is no sidebar toggle here (decision D-A2-1).
 *
 * The toggle dot is drawn from `data-dot` on the toggle, so a new dot kind is
 * one more `[data-dot='…']` rule and one more member of the input's union.
 * The host binds the inspector controller's `showDot()` directly; that signal
 * is already `null` while the inspector is open.
 *
 * `titleEl` and `toggleEl` are exposed for the inspector controller's
 * `attach(shell, opener, title)`. Both live inside the host's `@if`, so the
 * host reads them lazily.
 */
@Component({
  selector: 'ptah-session-header',
  standalone: true,
  imports: [LucideAngularModule],
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
      /* Need ink at 55% for the border, transparent fill (design-spec 5 item 5). */
      .session-header-needs {
        border-color: color-mix(
          in oklch,
          var(--state-ink-need, oklch(var(--wa))) 55%,
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
      <ng-content select="[sessionHeaderAction]" />
      <button
        #toggle
        type="button"
        class="btn btn-ghost btn-square relative h-7 min-h-0 w-7 shrink-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
        data-test="session-header-inspector-toggle"
        [attr.aria-pressed]="inspectorOpen()"
        [attr.aria-controls]="inspectorId()"
        [attr.aria-label]="toggleLabel()"
        [attr.title]="toggleLabel()"
        [attr.data-dot]="inspectorDot()"
        (click)="inspectorToggled.emit()"
      >
        <lucide-angular
          [img]="PanelRightIcon"
          class="h-4 w-4"
          aria-hidden="true"
        />
        @if (inspectorDot()) {
          <span class="session-header-dot" aria-hidden="true"></span>
        }
      </button>
    </header>
  `,
})
export class SessionHeaderComponent {
  protected readonly GitBranchIcon = GitBranch;
  protected readonly PanelRightIcon = PanelRight;

  /** Session name; truncates, never wraps. */
  readonly title = input('');
  /** Working branch, or `null` to hide the chip. */
  readonly branch = input<string | null>(null);
  /** Unique pending requests of this session; the chip shows only when > 0. */
  readonly needsYouCount = input(0);
  /** Drives `aria-pressed` on the toggle. */
  readonly inspectorOpen = input(false);
  /** Toggle dot kind; `null` draws no dot. */
  readonly inspectorDot = input<'need' | 'sel' | null>(null);
  /** Accessible name of the toggle; does not change with the dot. */
  readonly toggleLabel = input.required<string>();
  /** `aria-controls` target: the inspector `<aside>` id. */
  readonly inspectorId = input('inspector');

  readonly inspectorToggled = output<void>();

  /** The title heading, focus target when the inspector closes. */
  readonly titleEl = viewChild<ElementRef<HTMLElement>>('titleRef');
  /** The inspector toggle, the inspector's opener. */
  readonly toggleEl = viewChild<ElementRef<HTMLButtonElement>>('toggle');

  protected readonly needsYouText = computed(() => {
    const count = this.needsYouCount();
    return count === 1 ? '1 needs you' : `${count} need you`;
  });
}
