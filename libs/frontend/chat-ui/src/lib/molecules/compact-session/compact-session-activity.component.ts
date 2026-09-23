import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  afterRenderEffect,
  type ElementRef,
} from '@angular/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { CompactSessionStatsComponent } from './compact-session-stats.component';
import { stripMarkdownToPlainText } from './compact-plain-text';
import { shortenRowText } from './compact-wire-text';
import {
  SplitHandleComponent,
  type SplitHandleOrientation,
} from '../../atoms/split-handle.component';
import type {
  CompactSemanticMark,
  CompactSemanticMarkKind,
  CompactSessionSummary,
  CompactSummaryStatusTone,
} from './compact-session-summary';

export type FeedFilter = 'all' | 'error' | 'warn';

export interface CompactFeedRow {
  readonly mark: CompactSemanticMark;
  /** Plain-text label. */
  readonly label: string;
  /** Primary one-line row text: the mark detail when present, else the label. */
  readonly text: string;
  /** Row title/tooltip: the label plus the full detail line. */
  readonly title: string;
  /** Full plain-text detail for the inline expanded block; null when absent. */
  readonly detail: string | null;
}

interface PaneSize {
  readonly width: number;
  readonly height: number;
}

const KIND_LABEL: Record<CompactSemanticMarkKind, string> = {
  tool: 'TOOL',
  agent: 'AGENT',
  prose: 'PROSE',
  prompt: 'ASK',
  compaction: 'COMP',
  terminal: 'TERM',
};

/**
 * Badge colour is coded by mark KIND (like the wire-console prototype), while
 * tone stays dual-coded through the glyph and the row accent.
 */
type WireBadgeTone = 'info' | 'secondary' | 'primary' | 'warning' | 'error';

const KIND_BADGE_TONE: Record<CompactSemanticMarkKind, WireBadgeTone> = {
  tool: 'info',
  agent: 'secondary',
  prose: 'primary',
  prompt: 'warning',
  compaction: 'warning',
  terminal: 'error',
};

const BADGE_CLASSES: Record<WireBadgeTone, string> = {
  info: 'border-info/30 bg-info/10 text-info',
  secondary: 'border-secondary/30 bg-secondary/10 text-secondary',
  primary: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  error: 'border-error/30 bg-error/10 text-error',
};

/**
 * Full class string for a wire badge. Bound through a single `[class]` so
 * the static layout classes and the kind-coded colours do not collide with
 * the no-duplicate-attributes template rule.
 */
const BADGE_BASE_CLASSES =
  'inline-flex min-w-[60px] shrink-0 items-center justify-center gap-1 rounded border px-1.5 py-px text-center text-[9px] font-bold';

/** Input bound for conversion; tool output can be very large. */
const DETAIL_SOURCE_LIMIT = 4000;
/** The detail block wraps and scrolls, so 600 plain chars is plenty. */
const DETAIL_TEXT_LIMIT = 600;
/** The row description is one visually truncated line. */
const ROW_TEXT_LIMIT = 120;

/** Same threshold as the CSS `@container (max-width: 600px)` stacked tier. */
const STACKED_BREAKPOINT_PX = 600;
const SIDE_MIN_RECAP_WIDTH = 200;
const SIDE_MIN_FEED_WIDTH = 280;
const SIDE_HANDLE_MIN_BODY_WIDTH = 480;
const STACKED_MIN_RECAP_HEIGHT = 72;
const STACKED_MIN_FEED_HEIGHT = 96;
const STACKED_HANDLE_MIN_BODY_HEIGHT = 200;
const FALLBACK_BODY_WIDTH = 640;
const FALLBACK_BODY_HEIGHT = 400;
const FALLBACK_RECAP_WIDTH = 320;
const FALLBACK_RECAP_HEIGHT = 180;

/**
 * Tone is dual-coded: every badge pairs this glyph with a colour class so
 * tone reads correctly without colour vision.
 */
const TONE_GLYPH: Record<CompactSummaryStatusTone, string> = {
  idle: '○',
  live: '▶',
  success: '✓',
  warning: '▲',
  error: '✖',
};

/**
 * Bounded, dual-pane wire console body for compact sessions:
 * - Left pane: Executive assistant recap (rendered via MarkdownBlockComponent for
 *   rich content, or plain text for interactive prompts) and agent context.
 * - Right pane: Real-time teletype activity feed with kind-coded badges, live
 *   auto-scroll, expandable detail rows, filter chips, and terminal prompt footer.
 * - The recap/feed split is resizable through a drag handle; sizes flow through
 *   the --cs-recap-w / --cs-recap-h custom properties, so the CSS defaults
 *   apply until the user resizes.
 *
 * Uses size container queries on the body host to adapt progressively across tile sizes.
 */
@Component({
  selector: 'ptah-compact-session-activity',
  standalone: true,
  imports: [
    CompactSessionStatsComponent,
    MarkdownBlockComponent,
    SplitHandleComponent,
  ],
  host: {
    class: 'block h-full min-h-0 overflow-hidden',
  },
  styles: [
    `
      .cs-body-host {
        container-type: size;
      }
      .cs-body {
        --cs-recap-w: clamp(240px, 34%, 420px);
        --cs-recap-h: fit-content(45%);
        display: grid;
        grid-template-columns: var(--cs-recap-w) auto 1fr;
        min-height: 0;
        height: 100%;
      }
      .cs-body.cs-no-handle {
        grid-template-columns: var(--cs-recap-w) 1fr;
      }
      .cs-recap-pane {
        border-right: 1px solid oklch(var(--bc) / 0.1);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
      }
      .cs-recap-scroll {
        flex: 1 1 0%;
        min-height: 0;
        overflow-y: auto;
        mask-image: linear-gradient(
          to bottom,
          black calc(100% - 16px),
          transparent 100%
        );
        -webkit-mask-image: linear-gradient(
          to bottom,
          black calc(100% - 16px),
          transparent 100%
        );
      }
      .cs-feed-pane {
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
        background-color: oklch(0 0 0 / 0.16);
      }
      /* Static scanline overlay, under the content, never intercepting input. */
      .cs-feed-pane::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 2;
        background: repeating-linear-gradient(
          0deg,
          rgba(0, 0, 0, 0.16) 0px,
          rgba(0, 0, 0, 0.16) 1px,
          transparent 1px,
          transparent 2px
        );
        pointer-events: none;
      }
      .cs-feed-pane > * {
        position: relative;
        z-index: 3;
      }
      .cs-row-detail {
        max-height: 12em;
        overflow-y: auto;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }
      .cs-agent-context {
        display: none;
      }
      .cs-filter-chips {
        display: none;
      }
      .cs-feed-counter {
        display: inline-block;
      }
      .cs-terminal-footer {
        display: none;
      }
      .blinking-cursor {
        display: inline-block;
        width: 6px;
        height: 11px;
        background-color: oklch(var(--p));
        margin-left: 4px;
        vertical-align: middle;
        animation: cs-blink 1s step-start infinite;
      }
      @keyframes cs-blink {
        50% {
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .blinking-cursor {
          animation: none;
          opacity: 1;
        }
      }

      @container (min-height: 300px) {
        .cs-agent-context {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .cs-filter-chips {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .cs-feed-counter {
          display: none;
        }
      }

      @container (min-height: 500px) {
        .cs-terminal-footer {
          display: flex;
        }
      }

      @container (max-width: 600px) {
        .cs-body {
          grid-template-columns: 1fr;
          /* The cap lives on the track: a percentage max-height on the item is
             ignored while an auto track sizes, which gave the feed 0px. */
          grid-template-rows: var(--cs-recap-h) auto minmax(0, 1fr);
        }
        .cs-body.cs-no-handle {
          grid-template-rows: var(--cs-recap-h) minmax(0, 1fr);
          /* Override the two-column base rule: a stacked body without a
             handle must stay single-column. */
          grid-template-columns: 1fr;
        }
        .cs-recap-pane {
          border-right: 0;
          border-bottom: 1px solid oklch(var(--bc) / 0.1);
        }
      }

      :host ::ng-deep .cs-recap-md {
        font-size: 0.75rem;
        line-height: 1.45;
        color: oklch(var(--bc));
      }
      :host ::ng-deep .cs-recap-md h1,
      :host ::ng-deep .cs-recap-md h2,
      :host ::ng-deep .cs-recap-md h3,
      :host ::ng-deep .cs-recap-md h4,
      :host ::ng-deep .cs-recap-md h5,
      :host ::ng-deep .cs-recap-md h6 {
        font-size: 0.8125rem;
        font-weight: 700;
        line-height: 1.3;
        margin-top: 0.5rem;
        margin-bottom: 0.25rem;
        color: oklch(var(--bc));
      }
      :host ::ng-deep .cs-recap-md p {
        margin-top: 0.25rem;
        margin-bottom: 0.25rem;
        font-size: 0.75rem;
        line-height: 1.45;
      }
      :host ::ng-deep .cs-recap-md code {
        font-size: 0.6875rem;
        padding: 0.1rem 0.25rem;
        border-radius: 0.2rem;
        background-color: oklch(var(--b3) / 0.5);
      }
      :host ::ng-deep .cs-recap-md pre {
        max-height: 120px;
        overflow: auto;
        margin: 0.375rem 0;
        padding: 0.375rem 0.5rem;
        border-radius: 0.25rem;
        background-color: oklch(var(--b3) / 0.4);
        border: 1px solid oklch(var(--bc) / 0.1);
      }
      :host ::ng-deep .cs-recap-md pre code {
        padding: 0;
        background-color: transparent;
      }
      :host ::ng-deep .cs-recap-md table {
        display: block;
        overflow-x: auto;
        max-width: 100%;
        border-collapse: collapse;
        margin: 0.375rem 0;
        font-size: 0.6875rem;
      }
      :host ::ng-deep .cs-recap-md th,
      :host ::ng-deep .cs-recap-md td {
        border: 1px solid oklch(var(--bc) / 0.15);
        padding: 0.2rem 0.4rem;
      }
      :host ::ng-deep .cs-recap-md th {
        background-color: oklch(var(--b3) / 0.4);
        font-weight: 600;
      }
      :host ::ng-deep .cs-recap-md a {
        color: oklch(var(--p));
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      :host ::ng-deep .cs-recap-md ul,
      :host ::ng-deep .cs-recap-md ol {
        margin: 0.25rem 0;
        padding-left: 1.25rem;
      }
      :host ::ng-deep .cs-recap-md li {
        margin: 0.125rem 0;
      }
      :host ::ng-deep .cs-recap-md blockquote {
        margin: 0.25rem 0;
        padding-left: 0.5rem;
        border-left: 2px solid oklch(var(--bc) / 0.2);
        font-style: italic;
      }
    `,
  ],
  template: `
    <section
      class="grid h-full min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden"
      aria-label="Compact session status"
      data-testid="compact-session-summary"
    >
      <div
        class="flex min-w-0 items-center gap-2 border-b border-base-content/10 px-3 py-2"
        data-zone="status"
      >
        <span
          class="session-dot h-2.5 w-2.5 shrink-0 rounded-full"
          [style.background-color]="summary().status.sessionColor"
          [style.box-shadow]="'0 0 6px ' + summary().status.sessionColor"
          aria-hidden="true"
        ></span>
        <span class="shrink-0 text-xs" aria-hidden="true">{{
          summary().status.icon
        }}</span>
        <span class="truncate text-xs font-semibold">{{
          summary().status.text
        }}</span>
        <span
          class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] font-bold"
          [class.border-primary/30]="summary().status.tone === 'live'"
          [class.bg-primary/10]="summary().status.tone === 'live'"
          [class.text-primary]="summary().status.tone === 'live'"
          [class.border-success/30]="summary().status.tone === 'success'"
          [class.bg-success/10]="summary().status.tone === 'success'"
          [class.text-success]="summary().status.tone === 'success'"
          [class.border-warning/30]="summary().status.tone === 'warning'"
          [class.bg-warning/10]="summary().status.tone === 'warning'"
          [class.text-warning]="summary().status.tone === 'warning'"
          [class.border-error/30]="summary().status.tone === 'error'"
          [class.bg-error/10]="summary().status.tone === 'error'"
          [class.text-error]="summary().status.tone === 'error'"
          [class.border-base-content/20]="summary().status.tone === 'idle'"
          [class.text-base-content-muted]="summary().status.tone === 'idle'"
        >
          <span aria-hidden="true">{{ statusToneBadge().glyph }}</span>
          {{ statusToneBadge().label }}
        </span>
        <span
          class="ml-auto truncate font-mono text-[10px] text-base-content-muted"
        >
          {{ summary().status.workspaceLabel }}
        </span>
      </div>

      <div class="cs-body-host min-h-0 overflow-hidden" #bodyHost>
        <div
          class="cs-body h-full min-h-0"
          [class.cs-no-handle]="!handleVisible()"
          [style.--cs-recap-w]="recapWidthStyle()"
          [style.--cs-recap-h]="recapHeightStyle()"
        >
          <div
            #recapPane
            class="cs-recap-pane bg-base-200/20 p-3"
            data-zone="recap"
          >
            <div
              class="flex shrink-0 items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wide text-base-content-muted"
            >
              <span>Assistant recap</span>
              <span
                class="shrink-0 rounded border px-1.5 py-px font-mono text-[9px] font-bold uppercase"
                [class.border-primary/30]="summary().status.tone === 'live'"
                [class.bg-primary/10]="summary().status.tone === 'live'"
                [class.text-primary]="summary().status.tone === 'live'"
                [class.border-success/30]="summary().status.tone === 'success'"
                [class.bg-success/10]="summary().status.tone === 'success'"
                [class.text-success]="summary().status.tone === 'success'"
                [class.border-warning/30]="summary().status.tone === 'warning'"
                [class.bg-warning/10]="summary().status.tone === 'warning'"
                [class.text-warning]="summary().status.tone === 'warning'"
                [class.border-error/30]="summary().status.tone === 'error'"
                [class.bg-error/10]="summary().status.tone === 'error'"
                [class.text-error]="summary().status.tone === 'error'"
                [class.border-base-content/20]="
                  summary().status.tone === 'idle'
                "
                [class.bg-base-content/5]="summary().status.tone === 'idle'"
                [class.text-base-content-muted]="
                  summary().status.tone === 'idle'
                "
              >
                {{ outcomeTag() }}
              </span>
            </div>

            <div class="cs-recap-scroll my-2 pr-1">
              @if (isMarkdownContent()) {
                <div class="cs-recap-md">
                  <ptah-markdown-block [content]="summary().content.text" />
                </div>
              } @else {
                <p
                  class="whitespace-pre-line text-xs leading-relaxed"
                  [class.text-error]="summary().content.kind === 'error'"
                  [class.text-base-content]="summary().content.kind !== 'error'"
                >
                  {{ summary().content.text }}
                </p>
              }
              @if (summary().content.additionalPromptCount > 0) {
                <span
                  class="mt-1 inline-block text-[11px] font-semibold text-warning"
                >
                  +{{ summary().content.additionalPromptCount }} more
                </span>
              }
            </div>

            <div class="flex shrink-0 flex-col gap-2 pt-1">
              <div
                class="cs-agent-context rounded border border-base-content/10 bg-base-300/20 p-2 font-mono text-[10px] text-base-content-muted"
              >
                <div>
                  Agent:
                  <span class="font-semibold text-base-content">{{
                    activeAgentName()
                  }}</span>
                </div>
                <div>
                  Events:
                  <span class="font-semibold text-base-content">{{
                    feedCounts().all
                  }}</span>
                </div>
                @if (lastErrorLabel(); as lastError) {
                  <div class="truncate text-error" [title]="lastError">
                    Last error: {{ lastError }}
                  </div>
                }
              </div>
              @if (summary().content.actionable) {
                <button
                  type="button"
                  class="btn btn-primary btn-xs w-full"
                  (click)="openFullView.emit()"
                >
                  Open full view
                </button>
              }
            </div>
          </div>

          @if (handleVisible()) {
            <ptah-split-handle
              data-testid="cs-split-handle"
              [orientation]="handleOrientation()"
              [size]="handleSize()"
              [min]="handleMin()"
              [max]="handleMax()"
              [label]="splitHandleLabel()"
              (sizeChange)="onSplitSizeChange($event)"
              (reset)="onSplitReset()"
            />
          }

          <div class="cs-feed-pane" data-zone="feed">
            <div
              class="flex shrink-0 items-center justify-between border-b border-base-content/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-base-content-muted"
            >
              <span>Teletype wire stream</span>
              <span class="cs-feed-counter"
                >{{ summary().marks.length }} EVENTS</span
              >
              <div
                class="cs-filter-chips items-center gap-1 font-mono text-[10px]"
              >
                <button
                  type="button"
                  class="cursor-pointer rounded px-1.5 py-0.5 transition-colors"
                  [class.bg-base-300]="activeFilter() === 'all'"
                  [class.text-base-content]="activeFilter() === 'all'"
                  [class.font-bold]="activeFilter() === 'all'"
                  [class.text-base-content-muted]="activeFilter() !== 'all'"
                  [class.hover:text-base-content]="activeFilter() !== 'all'"
                  [attr.aria-pressed]="activeFilter() === 'all'"
                  (click)="setFilter('all')"
                >
                  ALL ({{ feedCounts().all }})
                </button>
                <span class="text-base-content-muted" aria-hidden="true"
                  >&bull;</span
                >
                <button
                  type="button"
                  class="cursor-pointer rounded px-1.5 py-0.5 transition-colors"
                  [class.bg-error/20]="activeFilter() === 'error'"
                  [class.text-error]="
                    activeFilter() === 'error' || feedCounts().error > 0
                  "
                  [class.font-bold]="activeFilter() === 'error'"
                  [class.text-base-content-muted]="
                    activeFilter() !== 'error' && feedCounts().error === 0
                  "
                  [attr.aria-pressed]="activeFilter() === 'error'"
                  (click)="setFilter('error')"
                >
                  ERR ({{ feedCounts().error }})
                </button>
                <span class="text-base-content-muted" aria-hidden="true"
                  >&bull;</span
                >
                <button
                  type="button"
                  class="cursor-pointer rounded px-1.5 py-0.5 transition-colors"
                  [class.bg-warning/20]="activeFilter() === 'warn'"
                  [class.text-warning]="
                    activeFilter() === 'warn' || feedCounts().warn > 0
                  "
                  [class.font-bold]="activeFilter() === 'warn'"
                  [class.text-base-content-muted]="
                    activeFilter() !== 'warn' && feedCounts().warn === 0
                  "
                  [attr.aria-pressed]="activeFilter() === 'warn'"
                  (click)="setFilter('warn')"
                >
                  WARN ({{ feedCounts().warn }})
                </button>
              </div>
            </div>

            <ul
              #feedList
              (scroll)="onFeedScroll($event)"
              class="min-h-0 flex-1 overflow-y-auto"
              role="list"
              aria-label="Session activity feed"
            >
              @for (row of feedRows(); track row.mark.id) {
                <li
                  class="flex flex-col border-l-2 border-transparent transition-colors hover:bg-base-content/5"
                  [class.border-error]="row.mark.tone === 'error'"
                  [class.bg-error/5]="row.mark.tone === 'error'"
                  [class.border-warning]="row.mark.tone === 'warning'"
                  [class.bg-warning/5]="row.mark.tone === 'warning'"
                  [class.border-primary]="row.mark.tone === 'live'"
                  [class.bg-primary/5]="row.mark.tone === 'live'"
                  role="listitem"
                >
                  <div
                    class="cs-row-line flex items-center gap-2 rounded px-2.5 py-1 font-mono text-[11px] leading-snug outline-none focus-visible:bg-primary/10"
                    [class.cursor-pointer]="row.detail !== null"
                    [attr.role]="row.detail !== null ? 'button' : null"
                    [attr.tabindex]="row.detail !== null ? 0 : null"
                    [attr.aria-expanded]="
                      row.detail !== null
                        ? expandedMarkId() === row.mark.id
                        : null
                    "
                    [attr.aria-controls]="
                      row.detail !== null ? row.mark.id + '-detail' : null
                    "
                    [attr.title]="row.title"
                    (click)="toggleExpanded(row)"
                    (keydown)="onRowKeydown($event, row)"
                  >
                    <span
                      class="w-[50px] shrink-0 text-[10px] tabular-nums text-base-content-muted"
                    >
                      {{ formatWireTime(row.mark.timestamp) }}
                    </span>
                    <span [class]="wireBadgeClass(row.mark)">
                      <span aria-hidden="true">{{
                        toneGlyph(row.mark.tone)
                      }}</span>
                      {{ kindLabel(row.mark.kind) }}
                    </span>
                    <span class="min-w-0 flex-1 truncate">
                      {{ row.text }}
                      @if (newestLiveMarkId() === row.mark.id) {
                        <span class="blinking-cursor" aria-hidden="true"></span>
                      }
                    </span>
                  </div>
                  @if (
                    row.detail !== null && expandedMarkId() === row.mark.id
                  ) {
                    <div
                      class="cs-row-detail mb-1 ml-2.5 mr-2.5 rounded border border-base-content/10 bg-base-content/5 px-2 py-1.5 font-mono text-[10px] leading-normal text-base-content/70"
                      [attr.id]="row.mark.id + '-detail'"
                    >
                      {{ row.detail }}
                    </div>
                  }
                </li>
              } @empty {
                <li
                  class="px-3 py-2 font-mono text-[10px] text-base-content-muted"
                  role="listitem"
                >
                  No matching events
                </li>
              }
            </ul>

            <div
              class="cs-terminal-footer shrink-0 items-center justify-between border-t border-dashed border-base-content/15 bg-base-300/20 px-3 py-1.5 font-mono text-[10px] text-base-content-muted"
            >
              <div class="flex items-center gap-1 truncate">
                <span class="font-semibold text-primary">ptah</span>:<span
                  class="text-info"
                  >{{ summary().status.workspaceLabel }}</span
                >$
                <span class="font-medium text-base-content">{{
                  terminalPromptStatus()
                }}</span>
                @if (summary().status.tone === 'live') {
                  <span class="blinking-cursor" aria-hidden="true"></span>
                }
              </div>
              <span class="shrink-0 text-[10px] tabular-nums"
                >{{ summary().marks.length }} events</span
              >
            </div>
          </div>
        </div>
      </div>

      <ptah-compact-session-stats
        data-zone="metrics"
        [metrics]="summary().metrics"
      />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionActivityComponent {
  readonly summary = input.required<CompactSessionSummary>();
  readonly openFullView = output<void>();

  readonly activeFilter = signal<FeedFilter>('all');
  readonly feedListRef = viewChild<ElementRef<HTMLElement>>('feedList');
  readonly bodyHostRef = viewChild<ElementRef<HTMLElement>>('bodyHost');
  readonly recapPaneRef = viewChild<ElementRef<HTMLElement>>('recapPane');
  private isUserScrolledUp = false;

  /** Id of the single feed row whose detail block is expanded, if any. */
  readonly expandedMarkId = signal<string | null>(null);

  /** Body host size, from a ResizeObserver (null before the first callback). */
  readonly bodySize = signal<PaneSize | null>(null);
  /** Recap pane size, measured so the handle can drag from the live default. */
  readonly paneSize = signal<PaneSize | null>(null);
  /** User-set recap width/height in px; null means the CSS default applies. */
  readonly recapWidth = signal<number | null>(null);
  readonly recapHeight = signal<number | null>(null);

  readonly feedCounts = computed(() => {
    const marks = this.summary().marks;
    let errors = 0;
    let warnings = 0;
    for (const mark of marks) {
      if (mark.tone === 'error') errors += 1;
      else if (mark.tone === 'warning') warnings += 1;
    }
    return {
      all: marks.length,
      error: errors,
      warn: warnings,
    };
  });

  readonly filteredMarks = computed<readonly CompactSemanticMark[]>(() => {
    const marks = this.summary().marks;
    const filter = this.activeFilter();
    if (filter === 'error') {
      return marks.filter((mark) => mark.tone === 'error');
    }
    if (filter === 'warn') {
      return marks.filter((mark) => mark.tone === 'warning');
    }
    return marks;
  });

  readonly feedRows = computed<readonly CompactFeedRow[]>(() =>
    this.filteredMarks().map((mark) => {
      const label = stripMarkdownToPlainText(mark.label);
      const detail = mark.text
        ? stripMarkdownToPlainText(
            mark.text.slice(0, DETAIL_SOURCE_LIMIT),
          ).slice(0, DETAIL_TEXT_LIMIT)
        : null;
      const fullText = detail || label;
      return {
        mark,
        label,
        detail: detail || null,
        text: shortenRowText(fullText, ROW_TEXT_LIMIT),
        title: detail ? `${label} — ${detail}` : label,
      };
    }),
  );

  /** Newest agent-kind mark, read from the full mark set. */
  readonly latestAgentMark = computed<CompactSemanticMark | null>(() => {
    const marks = this.summary().marks;
    for (let index = marks.length - 1; index >= 0; index -= 1) {
      if (marks[index].kind === 'agent') return marks[index];
    }
    return null;
  });

  readonly activeAgentName = computed<string>(() => {
    const mark = this.latestAgentMark();
    if (!mark) return 'assistant';
    const label = stripMarkdownToPlainText(mark.label);
    const match = label.match(/Agent (?:started|completed):\s*(.+)/i);
    if (match) return match[1].trim();
    return label || 'assistant';
  });

  readonly lastErrorLabel = computed<string | null>(() => {
    const marks = this.summary().marks;
    for (let i = marks.length - 1; i >= 0; i -= 1) {
      if (marks[i].tone === 'error') {
        return stripMarkdownToPlainText(marks[i].label);
      }
    }
    return null;
  });

  readonly newestLiveMarkId = computed<string | null>(() => {
    const marks = this.filteredMarks();
    for (let i = marks.length - 1; i >= 0; i -= 1) {
      if (marks[i].tone === 'live') return marks[i].id;
    }
    return null;
  });

  /** Same 600px threshold as the CSS stacked container-query tier. */
  readonly isStacked = computed(() => {
    const size = this.bodySize();
    return size !== null && size.width <= STACKED_BREAKPOINT_PX;
  });

  readonly handleVisible = computed(() => {
    const size = this.bodySize();
    if (size === null) return true;
    if (size.width <= STACKED_BREAKPOINT_PX) {
      return size.height >= STACKED_HANDLE_MIN_BODY_HEIGHT;
    }
    return size.width >= SIDE_HANDLE_MIN_BODY_WIDTH;
  });

  readonly handleOrientation = computed<SplitHandleOrientation>(() =>
    this.isStacked() ? 'horizontal' : 'vertical',
  );

  private readonly sideMaxRecapWidth = computed(() =>
    Math.max(
      SIDE_MIN_RECAP_WIDTH,
      (this.bodySize()?.width ?? FALLBACK_BODY_WIDTH) - SIDE_MIN_FEED_WIDTH,
    ),
  );

  private readonly stackedMaxRecapHeight = computed(() =>
    Math.max(
      STACKED_MIN_RECAP_HEIGHT,
      (this.bodySize()?.height ?? FALLBACK_BODY_HEIGHT) -
        STACKED_MIN_FEED_HEIGHT,
    ),
  );

  readonly handleMin = computed(() =>
    this.isStacked() ? STACKED_MIN_RECAP_HEIGHT : SIDE_MIN_RECAP_WIDTH,
  );

  readonly handleMax = computed(() =>
    this.isStacked() ? this.stackedMaxRecapHeight() : this.sideMaxRecapWidth(),
  );

  /** Re-clamps the stored size whenever the tile shrinks. */
  private readonly clampedRecapWidth = computed(() => {
    const size = this.recapWidth();
    if (size === null) return null;
    return Math.min(
      Math.max(size, SIDE_MIN_RECAP_WIDTH),
      this.sideMaxRecapWidth(),
    );
  });

  private readonly clampedRecapHeight = computed(() => {
    const size = this.recapHeight();
    if (size === null) return null;
    return Math.min(
      Math.max(size, STACKED_MIN_RECAP_HEIGHT),
      this.stackedMaxRecapHeight(),
    );
  });

  protected readonly recapWidthStyle = computed(() => {
    const size = this.clampedRecapWidth();
    return size === null ? null : `${Math.round(size)}px`;
  });

  protected readonly recapHeightStyle = computed(() => {
    const size = this.clampedRecapHeight();
    return size === null ? null : `${Math.round(size)}px`;
  });

  protected readonly handleSize = computed(() =>
    this.isStacked()
      ? (this.clampedRecapHeight() ??
        this.paneSize()?.height ??
        FALLBACK_RECAP_HEIGHT)
      : (this.clampedRecapWidth() ??
        this.paneSize()?.width ??
        FALLBACK_RECAP_WIDTH),
  );

  protected readonly splitHandleLabel = computed(() =>
    this.isStacked() ? 'Resize recap pane height' : 'Resize recap pane width',
  );

  private readonly destroyRef = inject(DestroyRef);
  private resizeObserver: ResizeObserver | null = null;
  private resizeObserverStarted = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });

    afterRenderEffect(() => {
      this.filteredMarks();
      // Never auto-scroll while a row is expanded: the user is reading it.
      if (this.expandedMarkId() !== null) return;
      const el = this.feedListRef()?.nativeElement;
      if (el && !this.isUserScrolledUp) {
        el.scrollTop = el.scrollHeight;
      }
    });

    afterRenderEffect(() => {
      if (this.resizeObserverStarted) return;
      const host = this.bodyHostRef()?.nativeElement;
      const pane = this.recapPaneRef()?.nativeElement;
      if (!host || !pane) return;
      this.resizeObserverStarted = true;
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === host) {
            this.bodySize.set({
              width: Math.round(entry.contentRect.width),
              height: Math.round(entry.contentRect.height),
            });
            continue;
          }
          // The recap pane's contentRect excludes its p-3 padding, but the
          // handle drags the grid track, so measure the pane's border box.
          const borderBox = entry.borderBoxSize?.[0];
          const rect = borderBox
            ? { width: borderBox.inlineSize, height: borderBox.blockSize }
            : entry.target.getBoundingClientRect();
          this.paneSize.set({
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      });
      observer.observe(host);
      observer.observe(pane);
      this.resizeObserver = observer;
    });
  }

  protected onFeedScroll(event: Event): void {
    const el = event.target as HTMLElement | null;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.isUserScrolledUp = distanceToBottom > 20;
  }

  protected setFilter(filter: FeedFilter): void {
    this.activeFilter.set(filter);
    this.isUserScrolledUp = false;
    const el = this.feedListRef()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  protected toggleExpanded(row: CompactFeedRow): void {
    if (row.detail === null) return;
    this.expandedMarkId.update((id) =>
      id === row.mark.id ? null : row.mark.id,
    );
  }

  protected onRowKeydown(event: KeyboardEvent, row: CompactFeedRow): void {
    if (row.detail === null) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleExpanded(row);
  }

  onSplitSizeChange(size: number): void {
    const rounded = Math.round(size);
    if (this.isStacked()) {
      this.recapHeight.set(
        Math.min(
          Math.max(rounded, STACKED_MIN_RECAP_HEIGHT),
          this.stackedMaxRecapHeight(),
        ),
      );
    } else {
      this.recapWidth.set(
        Math.min(
          Math.max(rounded, SIDE_MIN_RECAP_WIDTH),
          this.sideMaxRecapWidth(),
        ),
      );
    }
  }

  onSplitReset(): void {
    this.recapWidth.set(null);
    this.recapHeight.set(null);
  }

  protected isMarkdownContent(): boolean {
    const kind = this.summary().content.kind;
    return kind === 'prose' || kind === 'result' || kind === 'error';
  }

  protected kindLabel(kind: CompactSemanticMarkKind): string {
    return KIND_LABEL[kind];
  }

  protected toneGlyph(tone: CompactSummaryStatusTone): string {
    return TONE_GLYPH[tone];
  }

  protected wireBadgeClass(mark: CompactSemanticMark): string {
    const tone: WireBadgeTone =
      mark.tone === 'error' ? 'error' : KIND_BADGE_TONE[mark.kind];
    return `${BADGE_BASE_CLASSES} ${BADGE_CLASSES[tone]}`;
  }

  protected statusToneBadge(): { glyph: string; label: string } {
    const tone = this.summary().status.tone;
    switch (tone) {
      case 'live':
        return { glyph: '▶', label: 'RUN' };
      case 'success':
        return { glyph: '✓', label: 'DONE' };
      case 'warning':
        return { glyph: '▲', label: 'WARN' };
      case 'error':
        return { glyph: '✖', label: 'ERR' };
      case 'idle':
      default:
        return { glyph: '○', label: 'IDLE' };
    }
  }

  protected outcomeTag(): string {
    const tone = this.summary().status.tone;
    switch (tone) {
      case 'success':
        return 'FINISHED';
      case 'error':
        return 'FAILED';
      case 'warning':
        return 'ATTENTION';
      case 'live':
        return 'ACTIVE';
      case 'idle':
      default:
        return 'IDLE';
    }
  }

  protected terminalPromptStatus(): string {
    const tone = this.summary().status.tone;
    if (tone === 'live') return 'running...';
    if (tone === 'error') return 'failed';
    if (tone === 'warning') return 'waiting';
    return 'ready';
  }

  protected formatWireTime(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}
