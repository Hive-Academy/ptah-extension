import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import type { DoCheck } from '@angular/core';
import type {
  CompactGitState,
  CompactTodoState,
} from './compact-session-metrics';
import { gitTitle, todoTitle } from './compact-session-metrics';
import type { CompactSessionSummary } from './compact-session-summary';
import {
  COMPACT_RAIL_CARD_HEIGHT,
  type CompactCallout,
  type CompactLaneSummary,
  type CompactPermissionCallout,
  type CompactRailDensity,
  type CompactRailState,
} from './compact-lane.types';

const EMPTY_LANES: CompactLaneSummary = {
  rows: [],
  moreCount: 0,
  total: 0,
  counts: { running: 0, waiting: 0, error: 0, done: 0, stopped: 0 },
  kinds: { cli: 0, subagent: 0, background: 0 },
};

@Component({
  selector: 'ptah-compact-rail-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'rc-card block relative overflow-hidden rounded-lg border border-base-content/10 bg-base-200 text-base-content',
    '[style.height.px]': 'cardHeight()',
    '[class.rc-dense]': 'density() === "dense"',
    '[class.rc-corner-reserved]': 'reserveActionCorner()',
    '[class.rc-focused]': 'focused()',
    '[attr.data-state]': 'state()',
  },
  styles: [
    `
      /* The focused frame ink, at least 3:1 on the page and on an unfocused
         card. anubis primary #2563eb: 3.59:1 on base-100, 3.35:1 on base-200.
         anubis-light primary is a bright teal (1.40:1 on its cream), so that
         theme uses the deep teal primary-content: 9.80:1 and 8.75:1. */
      :host {
        box-sizing: border-box;
        padding: 4px 10px 4px 14px;
        --rc-focus-frame: oklch(var(--p));
      }
      :host-context([data-theme='anubis-light']) {
        --rc-focus-frame: oklch(var(--pc));
      }
      :host::before {
        content: '';
        position: absolute;
        inset: 0 auto 0 0;
        width: 4px;
        background: var(--rail-state-ink);
      }
      :host([data-state='running']) {
        --rail-state-ink: var(--state-ink-run, oklch(var(--in)));
      }
      :host([data-state='needs']) {
        --rail-state-ink: var(--state-ink-need, oklch(var(--wa)));
      }
      :host([data-state='error']) {
        --rail-state-ink: var(--state-ink-err, oklch(var(--er)));
      }
      :host([data-state='done']) {
        --rail-state-ink: var(--state-ink-done, oklch(var(--su)));
      }
      :host([data-state='idle']) {
        --rail-state-ink: var(--state-ink-idle, oklch(var(--bc)));
      }
      .rc-body {
        height: 100%;
        display: grid;
        grid-template-rows: 26px 16px 20px 70px 22px;
        min-width: 0;
      }
      :host(.rc-dense) .rc-body {
        grid-template-rows: 26px 20px 22px 18px;
      }
      .rc-line {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        overflow: hidden;
        white-space: nowrap;
      }
      /* A host-owned 24 px control sits 6 px inside the top-right corner,
         over the title line: 6 + 24 + a 3 px gap, less the border 1 and the
         right padding 10, keeps the title and state pill clear of it. */
      :host(.rc-corner-reserved) .rc-title {
        padding-right: 22px;
      }
      .rc-ellipsis {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rc-select {
        position: absolute;
        inset: 0;
        z-index: 0;
        opacity: 0;
        pointer-events: none;
      }
      .rc-content {
        position: relative;
        z-index: 1;
        pointer-events: none;
      }
      .rc-content button {
        pointer-events: auto;
      }
      .rc-action {
        position: relative;
        flex-shrink: 0;
        min-width: 39px;
        height: 18px;
        padding: 0 4px;
        border-radius: 3px;
        font-size: 10px;
        line-height: 18px;
      }
      .rc-action.rc-lane-overflow {
        height: 16px;
        line-height: 16px;
      }
      .rc-action.rc-lane-overflow:focus-visible {
        outline-offset: -2px;
      }
      .rc-action::after {
        content: '';
        position: absolute;
        inset: -3px 0;
      }
      .rc-action:focus-visible {
        outline: 2px solid var(--rail-state-ink);
        outline-offset: 1px;
      }
      /* .rc-select is opacity 0, which hides its own outline, so the host
         draws the keyboard ring. Inset 4 px: inside the 2 px focused frame and
         clear of the parent's overflow clip. */
      :host(:has(.rc-select:focus-visible)) {
        outline: 2px solid var(--rail-state-ink);
        outline-offset: -4px;
      }
      /* Hover changes paint only (no padding, border width or size), so the
         176/96 px card and the 70 px lane block never shift. The state inks
         clear 3:1 on base-100/200/300 in both themes (state-ink-contrast.spec). */
      :host(:hover) {
        border-color: var(--rail-state-ink);
      }
      /* The active session: a focus frame (the 1 px border plus a 1 px
         inset ring, so no size change and nothing for the parent's overflow
         to clip) over a primary-tinted surface, in both themes. After
         :host(:hover) so hover never repaints the active frame; the left
         state stripe paints over the ring's left edge. */
      :host(.rc-focused) {
        border-color: var(--rc-focus-frame);
        box-shadow: inset 0 0 0 1px var(--rc-focus-frame);
        background-color: color-mix(in oklch, oklch(var(--p)) 14%, oklch(var(--b2)));
      }
      .rc-action:hover {
        box-shadow: inset 0 0 0 1px currentColor;
      }
      .rc-lane-row:hover {
        background-color: oklch(var(--bc) / 0.1);
      }
      .rc-lane-row:focus-visible {
        outline: 2px solid var(--rail-state-ink);
        outline-offset: -2px;
      }
      .rc-callout {
        min-width: 0;
        border: 1px solid var(--rail-state-ink);
        border-radius: 4px;
        background: color-mix(in oklch, var(--rail-state-ink) 14%, transparent);
        color: oklch(var(--bc));
      }
      /* 10 px pill text needs 4.5:1. The raw state inks are a 3:1 UI tier
         (idle 3.18:1 on the dark focused tint), so the pill pulls its ink 30%
         toward base-content in OKLab (no hue rotation): at least 4.99:1 on
         the focused tint and 5.63:1 on base-200 in both anubis themes. */
      .rc-pill {
        color: color-mix(in oklab, var(--rail-state-ink) 70%, oklch(var(--bc)));
      }
      .rc-lanes {
        min-height: 0;
        overflow: hidden;
      }
      :host(.rc-dense) .rc-meta,
      :host(.rc-dense) .rc-lane-rows {
        display: none;
      }
      :host(.rc-dense) .rc-lanes {
        height: 22px;
      }
    `,
  ],
  template: `
    <button
      #selectButton
      type="button"
      class="rc-select"
      [attr.aria-label]="selectName()"
      [attr.aria-current]="focused() ? 'true' : null"
      [tabIndex]="focused() ? 0 : -1"
      (click)="selectRequested.emit()"
    ></button>
    <div class="rc-body rc-content text-xs">
      <div class="rc-line rc-title">
        <span
          aria-hidden="true"
          class="h-2 w-2 shrink-0 rounded-full"
          [style.background]="'var(--rail-state-ink)'"
        ></span>
        <span class="rc-ellipsis flex-1 font-semibold" [title]="title()">{{
          title()
        }}</span>
        <span class="rc-pill shrink-0 text-[10px]">{{ state() }}</span>
      </div>
      @if (density() === 'comfortable') {
        <div class="rc-line rc-meta text-[11px] text-base-content-muted">
          <span class="rc-ellipsis"
            >{{ branch() || '—' }} · {{ model() || '—' }} ·
            {{ elapsed() }}</span
          >
        </div>
      }
      <div class="rc-line text-base-content-muted">
        <span class="shrink-0">Now</span
        ><span class="rc-ellipsis" [title]="shownNow()">{{ shownNow() }}</span>
      </div>
      <div class="rc-lanes">
        @if (callout(); as current) {
          @for (c of [current]; track c.requestId) {
            <div
              class="rc-callout rc-line h-full px-1"
              [attr.data-rid]="c.requestId"
              [attr.aria-label]="c.kind + ' request'"
              role="group"
            >
              <span class="rc-ellipsis flex-1" [title]="c.text">{{
                c.text
              }}</span>
              @if (c.kind === 'permission') {
                <button
                  type="button"
                  class="rc-action bg-success/20"
                  [attr.data-rid]="c.requestId"
                  [attr.aria-label]="'Allow ' + c.text"
                  [tabIndex]="innerTabbable() ? 0 : -1"
                  (click)="allow.emit(c)"
                >
                  Allow
                </button>
                <button
                  type="button"
                  class="rc-action bg-error/20"
                  [attr.data-rid]="c.requestId"
                  [attr.aria-label]="'Deny ' + c.text"
                  [tabIndex]="innerTabbable() ? 0 : -1"
                  (click)="deny.emit(c)"
                >
                  Deny
                </button>
                <button
                  type="button"
                  class="rc-action bg-base-300"
                  [attr.data-rid]="c.requestId"
                  [attr.aria-label]="'Open ' + title()"
                  [tabIndex]="innerTabbable() ? 0 : -1"
                  (click)="openRequest.emit(c)"
                >
                  Open
                </button>
              } @else if (c.kind === 'question') {
                <button
                  type="button"
                  class="rc-action bg-warning/20"
                  [attr.data-rid]="c.requestId"
                  [attr.aria-label]="'Answer ' + c.text"
                  [tabIndex]="innerTabbable() ? 0 : -1"
                  (click)="answer.emit(c.requestId)"
                >
                  Answer
                </button>
              } @else {
                <button
                  type="button"
                  class="rc-action bg-base-300"
                  [attr.data-rid]="c.requestId"
                  [attr.aria-label]="'Show output of ' + title()"
                  [tabIndex]="innerTabbable() ? 0 : -1"
                  (click)="showOutput.emit(c.requestId)"
                >
                  Output
                </button>
              }
            </div>
          }
        } @else if (density() === 'dense') {
          <div class="rc-line h-full text-base-content-muted">
            @if (lanes().total >= 1) {
              <button
                type="button"
                class="rc-action bg-base-300 text-base-content"
                [attr.aria-label]="
                  'Open the ' + lanes().total + ' lanes of ' + title()
                "
                [tabIndex]="innerTabbable() ? 0 : -1"
                (click)="moreLanes.emit()"
              >
                +{{ lanes().total }}
              </button>
            }
          </div>
        } @else {
          <div class="rc-lane-rows">
            <div class="rc-line h-4 text-base-content-muted">
              @if (lanes().moreCount > 0) {
                <button
                  type="button"
                  class="rc-action rc-lane-overflow ml-auto bg-base-300 text-base-content"
                  [attr.aria-label]="
                    'Open ' +
                    lanes().moreCount +
                    ' more lanes of ' +
                    title()
                  "
                  [tabIndex]="innerTabbable() ? 0 : -1"
                  (click)="moreLanes.emit()"
                >
                  +{{ lanes().moreCount }} more
                </button>
              }
            </div>
            <div class="rc-lane-buttons">
              @for (row of lanes().rows.slice(0, 3); track row.id) {
                <button
                  type="button"
                  class="rc-line rc-lane-row h-[18px] w-full rounded-sm text-left text-[11px]"
                  [attr.aria-label]="
                    'Open ' + row.name + ' output, ' + row.status
                  "
                  [tabIndex]="innerTabbable() ? 0 : -1"
                  (click)="laneSelected.emit(row.id)"
                >
                  {{ row.name }} · {{ row.status }}
                </button>
              }
            </div>
          </div>
        }
      </div>
      <div
        class="rc-line text-[11px] text-base-content-muted"
        [title]="todoTitle(todos()) + '; ' + gitTitle(gitStats())"
      >
        @if (todos().kind === 'known') { <span>{{ todoCount() }}</span> }
        @if (summary().metrics.agentCount > 0) {
          <span class="badge badge-xs badge-outline">{{ summary().metrics.agentCount }} {{ summary().metrics.agentCount === 1 ? 'agent' : 'agents' }}</span>
        }
        @if (cliCount(); as count) {
          <span class="badge badge-xs badge-outline">{{ count }} CLI</span>
        }
        @if (roundedContextPercent() !== null) {
          <span class="badge badge-xs badge-outline" aria-label="Context used">{{ roundedContextPercent() }}% ctx</span>
        }
        <span class="ml-auto shrink-0">{{ gitCount() }}</span>
      </div>
    </div>
  `,
})
export class CompactRailCardComponent implements DoCheck {
  readonly todoTitle = todoTitle;
  readonly gitTitle = gitTitle;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  readonly title = input('');
  readonly summary = input.required<CompactSessionSummary>();
  readonly lanes = input<CompactLaneSummary>(EMPTY_LANES);
  readonly callout = input<CompactCallout>(null);
  readonly branch = input<string | null>(null);
  readonly model = input<string | null>(null);
  readonly elapsed = input('');
  readonly contextPercent = input<number | null>(null);
  readonly todos = input<CompactTodoState>({ kind: 'none' });
  readonly gitStats = input<CompactGitState>({ kind: 'none' });
  readonly state = input<CompactRailState>('idle');
  readonly density = input<CompactRailDensity>('comfortable');
  readonly focused = input(false);
  readonly innerTabbable = input(false);
  readonly holdText = input(false);
  /** The host overlays a control on the top-right corner; keep the title clear of it. */
  readonly reserveActionCorner = input(false);
  readonly selectRequested = output<void>();
  readonly laneSelected = output<string>();
  readonly allow = output<CompactPermissionCallout>();
  readonly deny = output<CompactPermissionCallout>();
  readonly openRequest = output<CompactPermissionCallout>();
  readonly answer = output<string>();
  readonly showOutput = output<string>();
  readonly moreLanes = output<void>();
  readonly cardHeight = computed(
    () => COMPACT_RAIL_CARD_HEIGHT[this.density()],
  );
  // The hold freezes only the live-changing summary under a press
  // or text selection. The title is never latched: it changes only by an
  // explicit rename, which must show at once even while a selection holds.
  private readonly latched = signal('');
  readonly shownNow = computed(() =>
    this.holdText() ? this.latched() : this.summary().content.text,
  );
  readonly selectName = computed(
    () =>
      `${this.title()}, ${this.state()}${this.branch() ? ', branch ' + this.branch() : ''}${this.callout()?.kind === 'permission' ? ', asks permission' : ''}${this.focused() ? ', in focus' : ''}`,
  );
  /** Every CLI lane of the session, including rows capped into `+N more`. */
  readonly cliCount = computed(() => this.lanes().kinds.cli);
  readonly todoCount = computed(() => {
    const t = this.todos();
    return t.kind === 'known' ? `${t.done}/${t.total}` : '—';
  });
  readonly roundedContextPercent = computed(() => {
    const percent = this.contextPercent();
    return percent === null ? null : Math.round(percent);
  });
  readonly gitCount = computed(() => {
    const g = this.gitStats();
    return g.kind === 'known' ? `+${g.additions} −${g.deletions}` : '—';
  });
  private seenRequestId: string | null = null;

  constructor() {
    effect(() => {
      if (!this.holdText())
        this.latched.set(this.summary().content.text);
    });
  }

  ngDoCheck(): void {
    const id = this.callout()?.requestId ?? null;
    if (id !== this.seenRequestId) {
      const active = this.host.nativeElement.ownerDocument.activeElement;
      const previous = (
        this.host.nativeElement as HTMLElement
      ).querySelector<HTMLElement>('.rc-callout');
      if (previous && active && previous.contains(active)) {
        afterNextRender(
          () => {
            (this.host.nativeElement as HTMLElement)
              .querySelector<HTMLButtonElement>('.rc-select')
              ?.focus();
          },
          { injector: this.injector },
        );
      }
      this.seenRequestId = id;
    }
  }

}
