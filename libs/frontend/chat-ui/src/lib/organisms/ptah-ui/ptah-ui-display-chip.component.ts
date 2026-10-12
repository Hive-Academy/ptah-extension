import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  ChevronDown,
  Info,
  LayoutDashboard,
  LucideAngularModule,
  PanelRight,
} from 'lucide-angular';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { PTAH_UI_HOST_SOURCES } from '../../services/ptah-ui-host-sources';
import {
  PTAH_UI_DISPLAY_DOCK,
  displayFenceKey,
  type PtahUiDisplayFenceState,
} from '../../services/ptah-ui-display-dock';

/** The chip states: the three sync states, plus a host without a dock. */
type DisplayChipState = PtahUiDisplayFenceState | 'unavailable';

/** What the fence renders as, derived from the dock status. */
type DisplayChipView =
  /** No status yet: the raw fence as ordinary markdown. */
  | { readonly mode: 'pending' }
  /** The 610 fallback: the raw fence plus `Not rendered: {reason}`. */
  | { readonly mode: 'invalid'; readonly reason: string }
  | {
      readonly mode: 'chip';
      readonly state: DisplayChipState;
      /** `null` when there is nothing to open (no dock). */
      readonly surfaceKey: string | null;
      readonly title: string;
      readonly description: string | null;
    };

interface DisplayChipCopy {
  /** The badge text in the head (the collapsed line). */
  readonly badge: string;
  /** `info` for the current version, `neutral` for every other state. */
  readonly tone: 'info' | 'neutral';
  /** The info note in the expanded body, if the state has one. */
  readonly note: { readonly title: string; readonly text: string } | null;
  /** The open action label; `null` for a plain chip (evicted). */
  readonly action: string | null;
}

const UNTITLED = 'Display';

/** Per-state copy; the badge classes stay literal in the template for Tailwind. */
const CHIP_COPY: Readonly<Record<DisplayChipState, DisplayChipCopy>> = {
  applied: {
    badge: 'In display',
    tone: 'info',
    note: null,
    action: 'Open in display',
  },
  superseded: {
    badge: 'Updated later',
    tone: 'neutral',
    note: {
      title: 'A newer version exists',
      text: 'A later block with the same id replaced this one in the display.',
    },
    action: 'Open latest',
  },
  evicted: {
    badge: 'No longer in display',
    tone: 'neutral',
    note: {
      title: 'No longer in display',
      text: 'Newer displays took its place in the panel.',
    },
    action: null,
  },
  unavailable: {
    badge: 'Display panel unavailable',
    tone: 'neutral',
    note: null,
    action: 'Open in display',
  },
};

/**
 * One collapse pattern with the panel's `accordion` (design section 7,
 * `surface-layout.component.ts`): the hidden body is `inert` and
 * `visibility:hidden`; motion only under `prefers-reduced-motion:
 * no-preference`. The pulse dot animates `opacity` only.
 */
const CHIP_STYLES = `
  :host { display: block; min-width: 0; }
  .dp-collapse { display: grid; grid-template-rows: 1fr; min-width: 0; }
  .dp-collapse[data-open='false'] { grid-template-rows: 0fr; visibility: hidden; }
  .dp-collapse-inner { min-height: 0; min-width: 0; }
  .dp-collapse[data-open='false'] > .dp-collapse-inner { overflow: hidden; }
  .dp-toggle { min-height: 2rem; }
  .dp-toggle:focus-visible { outline: 2px solid oklch(var(--bc)); outline-offset: 2px; }
  .dp-chevron[data-open='true'] { transform: rotate(180deg); }
  @media (prefers-reduced-motion: no-preference) {
    .dp-collapse { transition: grid-template-rows 220ms ease, visibility 220ms; }
    .dp-chevron { transition: transform 200ms ease; }
  }
`;

let nextChipInstance = 0;

/**
 * PtahUiDisplayChipComponent - a `ptah-ui display` fence in chat history
 * (TASK_2026_623, component 4; R1.11, R1.12, R2.10, R9; decisions #7, #9).
 *
 * The chip never runs the fence pipeline: the display sync computes each
 * fence's status once and publishes it to the dock store, keyed
 * `messageId:nodeId:ordinal`. The chip only reads it (O(1)).
 *
 * - `applied` / `superseded` / `evicted`: a collapsible chip with the title
 *   (or "Display") and the state ("In display", "Updated later", "No longer in
 *   display"). Expanded: description, the state note, and "Open in display"
 *   ("Open latest" when superseded), which opens the surface in the dock. An
 *   evicted chip stays a plain chip with no action (R1.12).
 * - `invalid`: the 610 fallback, the raw fence as markdown plus
 *   `Not rendered: {reason}` outside the code, linked by `aria-describedby`.
 * - No status yet: the raw fence as ordinary markdown.
 * - No dock store: the chip with "Display panel unavailable" and its open
 *   action disabled.
 *
 * Starts collapsed (R9.4). Enter and Space on the toggle flip it (native
 * button); Escape inside an expanded chip collapses it and refocuses the
 * toggle. Copy actions read the stored node text, never this DOM, so they
 * copy the raw fence only (R2.10).
 */
@Component({
  selector: 'ptah-ui-display-chip',
  standalone: true,
  imports: [MarkdownModule, SurfaceMarkdownPipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHIP_STYLES],
  template: `
    @let current = view();
    @if (current.mode === 'chip') {
      @let copy = chipCopy();
      <section
        class="my-2 min-w-0 rounded-box border border-base-300 bg-base-200 text-base-content"
        [class.border-dashed]="current.state !== 'applied'"
        data-testid="ptah-ui-display-chip"
        [attr.data-state]="current.state"
        (keydown.escape)="collapse($event)"
      >
        <button
          #chipToggle
          type="button"
          class="dp-toggle flex w-full min-w-0 items-start gap-2 rounded-[inherit] px-2.5 py-2 text-left"
          [id]="toggleId"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="regionId"
          (click)="toggle()"
        >
          <lucide-angular
            [img]="LayoutDashboardIcon"
            class="mt-0.5 h-4 w-4 shrink-0 text-base-content-muted"
            aria-hidden="true"
          />
          <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              class="min-w-0 break-words text-sm font-semibold"
              data-testid="ptah-ui-display-chip-title"
            >{{ current.title }}</span>
            <span
              class="badge badge-sm h-auto gap-1 whitespace-normal"
              [class.badge-info]="copy?.tone === 'info'"
              [class.badge-ghost]="copy?.tone === 'neutral'"
              data-testid="ptah-ui-display-chip-state"
            >
              @if (current.state === 'applied') {
                <span
                  class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse"
                  aria-hidden="true"
                ></span>
              }
              {{ copy?.badge }}
            </span>
          </span>
          <lucide-angular
            [img]="ChevronDownIcon"
            class="dp-chevron mt-0.5 h-4 w-4 shrink-0 text-base-content-muted"
            [attr.data-open]="open()"
            aria-hidden="true"
          />
        </button>
        <div
          [id]="regionId"
          role="region"
          [attr.aria-labelledby]="toggleId"
          class="dp-collapse"
          [attr.data-open]="open()"
          [attr.inert]="open() ? null : ''"
        >
          <div class="dp-collapse-inner">
            <div class="flex min-w-0 flex-col gap-2 px-2.5 pb-2.5">
              @if (current.description; as description) {
                <p
                  class="m-0 break-words text-xs text-base-content-muted"
                  data-testid="ptah-ui-display-chip-description"
                >{{ description }}</p>
              }
              @if (copy?.note; as note) {
                <div
                  class="flex min-w-0 gap-2 rounded-box border border-info/30 bg-info/10 px-3 py-2"
                  data-testid="ptah-ui-display-chip-note"
                >
                  <lucide-angular
                    [img]="InfoIcon"
                    class="mt-0.5 h-4 w-4 shrink-0 text-info"
                    aria-hidden="true"
                  />
                  <p class="m-0 min-w-0 break-words text-xs">
                    <strong class="block text-sm">{{ note.title }}</strong>
                    {{ note.text }}
                  </p>
                </div>
              }
              @if (current.state === 'unavailable') {
                <p
                  class="m-0 text-xs text-base-content-muted"
                  [id]="unavailableId"
                >Display panel unavailable</p>
              }
              @if (copy?.action; as action) {
                <button
                  type="button"
                  class="btn btn-xs btn-outline self-start rounded-full"
                  data-testid="ptah-ui-display-chip-open"
                  [disabled]="current.surfaceKey === null"
                  [attr.aria-describedby]="
                    current.surfaceKey === null ? unavailableId : null
                  "
                  (click)="openInDisplay()"
                >
                  <lucide-angular
                    [img]="PanelRightIcon"
                    class="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  {{ action }}
                </button>
              }
            </div>
          </div>
        </div>
      </section>
    } @else if (current.mode === 'invalid') {
      <markdown
        [data]="raw() | surfaceMarkdown: active()"
        [attr.aria-describedby]="reasonId"
      />
      <p
        data-ptah-ui-reason
        class="text-xs text-base-content-muted"
        [id]="reasonId"
      >
        Not rendered: {{ current.reason }}
      </p>
    } @else {
      <markdown [data]="raw() | surfaceMarkdown: active()" />
    }
  `,
})
export class PtahUiDisplayChipComponent {
  private readonly dock = inject(PTAH_UI_DISPLAY_DOCK, { optional: true });
  private readonly hostSources = inject(PTAH_UI_HOST_SOURCES, {
    optional: true,
  });

  /** The whole fence, opening and closing lines included. */
  readonly raw = input.required<string>();
  /** Ordinal of this fence within its text node. */
  readonly ordinal = input.required<number>();
  readonly messageId = input.required<string>();
  readonly nodeId = input.required<string>();
  /** Surface activity, forwarded to `surfaceMarkdown` exactly as the text node does. */
  readonly active = input(true);

  private readonly instanceId = `ptah-display-chip-${nextChipInstance++}`;
  protected readonly toggleId = `${this.instanceId}-toggle`;
  protected readonly regionId = `${this.instanceId}-region`;
  protected readonly reasonId = `${this.instanceId}-reason`;
  protected readonly unavailableId = `${this.instanceId}-unavailable`;

  protected readonly LayoutDashboardIcon = LayoutDashboard;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly InfoIcon = Info;
  protected readonly PanelRightIcon = PanelRight;

  /** Chips start collapsed (R9.4). */
  protected readonly open = signal(false);
  private readonly toggleButton =
    viewChild<ElementRef<HTMLButtonElement>>('chipToggle');

  protected readonly view = computed((): DisplayChipView => {
    const dock = this.dock;
    const hostSources = this.hostSources;
    if (dock === null || hostSources === null) {
      return {
        mode: 'chip',
        state: 'unavailable',
        surfaceKey: null,
        title: UNTITLED,
        description: null,
      };
    }
    const status = dock.fenceStatus(
      hostSources.tabId(),
      displayFenceKey(this.messageId(), this.nodeId(), this.ordinal()),
    );
    if (status === null) return { mode: 'pending' };
    if (status.kind === 'invalid') {
      return { mode: 'invalid', reason: status.reason };
    }
    return {
      mode: 'chip',
      state: status.kind,
      surfaceKey: status.surfaceKey,
      title: status.title?.trim() || UNTITLED,
      description: status.description?.trim() || null,
    };
  });

  protected readonly chipCopy = computed((): DisplayChipCopy | null => {
    const current = this.view();
    return current.mode === 'chip' ? CHIP_COPY[current.state] : null;
  });

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  /** Escape inside an expanded chip: collapse and return focus to the toggle. */
  protected collapse(event: Event): void {
    const toggle = this.toggleButton();
    if (!this.open() || toggle === undefined) return;
    event.stopPropagation();
    this.open.set(false);
    toggle.nativeElement.focus();
  }

  protected openInDisplay(): void {
    const current = this.view();
    if (
      current.mode !== 'chip' ||
      current.surfaceKey === null ||
      this.dock === null ||
      this.hostSources === null
    ) {
      return;
    }
    this.dock.openSurface(this.hostSources.tabId(), current.surfaceKey);
  }
}
