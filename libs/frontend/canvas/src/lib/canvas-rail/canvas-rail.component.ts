import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { History, LucideAngularModule } from 'lucide-angular';
import type {
  CompactRailDensity,
  CompactRailState,
} from '@ptah-extension/chat-ui';
import type { CanvasTile } from '../canvas.store';
import { MAX_CANVAS_TILES } from '../canvas-layout-intent';
import {
  MAX_RUNNING_SESSIONS,
  RUNNING_CAP_MESSAGE,
} from '../canvas-running-cap';
import {
  CanvasRailCardComponent,
  SPLIT_ALREADY_FOCUSED_REASON,
} from './canvas-rail-card.component';
import { focusRailSelectButton, handleCanvasRailKeydown } from './canvas-rail-keyboard';

const TILE_BOUND_MESSAGE = `The board holds ${MAX_CANVAS_TILES} sessions. Close one to add another.`;
const AUTO_COLLAPSE_REASON = 'Widen the canvas to expand the Rail';
const CHIP_STATES = [
  { state: 'needs', label: 'needs you' },
  { state: 'error', label: 'error' },
  { state: 'running', label: 'running' },
  { state: 'done', label: 'done' },
  { state: 'idle', label: 'idle' },
] as const;

@Component({
  selector: 'ptah-canvas-rail',
  standalone: true,
  imports: [CanvasRailCardComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0' },
  styles: [
    `
      .rail-chips {
        mask-image: linear-gradient(
          to right,
          black calc(100% - 20px),
          transparent
        );
      }
      .state-needs {
        color: var(--state-ink-need, oklch(var(--wa)));
      }
      .state-error {
        color: var(--state-ink-err, oklch(var(--er)));
      }
      .state-running {
        color: var(--state-ink-run, oklch(var(--in)));
      }
      .state-done {
        color: var(--state-ink-done, oklch(var(--su)));
      }
      .state-idle {
        color: var(--state-ink-idle, oklch(var(--bc)));
      }
      /* Collapsed: the 32/24 px card row needs the rail's full inner width, so
         no scrollbar gutter; the 1 px aside border is clipped, never scrolled. */
      .rail-scroll-collapsed {
        scrollbar-width: none;
        scrollbar-gutter: auto;
        overflow-x: hidden;
      }
      .rail-scroll-collapsed::-webkit-scrollbar {
        display: none;
      }
      :host-context([data-glass='on']) header[data-glass-surface='plate'] { margin: 6px 6px 0; }
      :host-context([data-glass='on']) div[data-glass-surface='plate'] { margin: 6px; }
    `,
  ],
  template: `
    <aside
      aria-label="Sessions"
      class="flex h-full min-h-0 flex-col border-r border-base-content/10 bg-base-100"
      data-glass-surface="chrome"
      [class.w-[56px]]="collapsed()"
      [class.w-[304px]]="!collapsed() && (band() === 'xl' || band() === 'lg')"
      [class.w-[288px]]="!collapsed() && band() === 'md'"
      [class.w-[272px]]="!collapsed() && band() === 'sm'"
    >
      <header class="h-[72px] shrink-0 overflow-hidden px-2 py-1" data-glass-surface="plate">
        <div class="flex h-7 items-center gap-1 whitespace-nowrap">
          @if (!collapsed()) {
            <strong class="min-w-0 flex-1 truncate text-sm">Sessions</strong>
            <span class="text-xs text-base-content-muted"
              >{{ runningCount() }} / {{ maxRunning }} running</span
            >
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              [attr.aria-pressed]="density() === 'dense'"
              aria-label="Dense cards"
              title="Dense cards"
              [attr.aria-describedby]="
                showDensityHint() ? 'rail-density-hint' : null
              "
              (click)="densityToggled.emit()"
            >
              ≡
            </button>
          }
          <button
            type="button"
            class="btn btn-ghost btn-xs min-h-6 min-w-6"
            data-testid="rail-collapse-toggle"
            [class.opacity-60]="autoCollapsed()"
            [attr.aria-label]="collapsed() ? 'Expand rail' : 'Collapse rail'"
            [attr.aria-expanded]="!collapsed()"
            [attr.aria-disabled]="autoCollapsed() ? 'true' : null"
            [attr.aria-describedby]="
              autoCollapsed() ? 'rail-collapse-reason' : null
            "
            [attr.title]="autoCollapsed() ? autoCollapseReason : null"
            (click)="onCollapseToggle()"
          >
            {{ collapsed() ? '›' : '‹' }}
          </button>
          @if (autoCollapsed()) {
            <span id="rail-collapse-reason" class="sr-only">{{
              autoCollapseReason
            }}</span>
          }
        </div>
        @if (!collapsed()) {
          <div
            class="rail-chips flex h-7 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            @if (orderedTiles().length === 0) {
              <span class="text-xs text-base-content-muted">No sessions</span>
            }
            @for (chip of chips; track chip.state) {
              @if (count(chip.state) > 0) {
                <button
                  type="button"
                  class="btn btn-ghost btn-xs shrink-0"
                  [class.state-needs]="chip.state === 'needs'"
                  [class.state-error]="chip.state === 'error'"
                  [class.state-running]="chip.state === 'running'"
                  [class.state-done]="chip.state === 'done'"
                  [class.state-idle]="chip.state === 'idle'"
                  [attr.aria-label]="
                    count(chip.state) +
                    ' ' +
                    chip.label +
                    ', jump to the next one'
                  "
                  (click)="jumpTo.emit(chip.state)"
                >
                  {{ count(chip.state)
                  }}{{
                    chip.state === 'needs' || chip.state === 'error'
                      ? ' ' + chip.label
                      : ''
                  }}
                </button>
              }
            }
          </div>
          @if (showDensityHint()) {
            <span id="rail-density-hint" class="sr-only"
              >Dense cards show more sessions at once.</span
            >
          }
        }
      </header>
      <div
        class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        data-glass-surface="plate"
        [class.rail-scroll-collapsed]="collapsed()"
        (scroll)="onScroll($event)"
      >
        @if (orderedTiles().length === 0) {
          @if (collapsed()) {
            <!-- 56 px: the sentence cannot fit, so show a dash and keep the words for screen readers. -->
            <p
              class="py-4 text-center text-sm text-base-content-muted"
              data-testid="rail-empty"
            >
              <span aria-hidden="true">—</span
              ><span class="sr-only">No sessions yet</span>
            </p>
          } @else {
            <p
              class="px-3 py-4 text-sm text-base-content-muted"
              data-testid="rail-empty"
            >
              No sessions yet
            </p>
          }
        }
        <ul
          role="list"
          class="flex flex-col gap-2"
          [class.p-2]="!collapsed()"
          [class.py-2]="collapsed()"
          (keydown)="onKeydown($event)"
        >
          @for (
            tile of orderedTiles();
            track tile.tabId;
            let i = $index, first = $first, last = $last
          ) {
            <li
              ptah-canvas-rail-card
              [tabId]="tile.tabId"
              [density]="density()"
              [collapsed]="collapsed()"
              [index]="i + 1"
              [focused]="focusedTabId() === tile.tabId"
              [holdText]="holdTabId() === tile.tabId"
              [state]="states().get(tile.tabId) ?? 'idle'"
              [canMoveUp]="!first"
              [canMoveDown]="!last"
              [splitDisabledReason]="cardSplitReason(tile.tabId)"
              (focusRequested)="focusRequested.emit($event)"
              (railState)="railState.emit({ tabId: tile.tabId, state: $event })"
              (staleAction)="staleAction.emit($event)"
              (lanesRequested)="lanesRequested.emit($event)"
              (openBesideRequested)="openBesideRequested.emit($event)"
              (moveUpRequested)="moveUpRequested.emit($event)"
              (moveDownRequested)="moveDownRequested.emit($event)"
            ></li>
          }
        </ul>
      </div>
      <footer class="shrink-0 px-2 py-2" [class.h-[82px]]="collapsed()" [class.min-h-[120px]]="!collapsed()">
        <div class="flex flex-col gap-1.5">
        <button
          type="button"
          data-testid="canvas-footer-new-session"
          class="btn btn-outline btn-sm h-[30px] w-full"
          [attr.aria-disabled]="disabledReason() ? 'true' : null"
          [attr.aria-describedby]="
            disabledReason() ? 'rail-new-session-reason' : null
          "
          [attr.title]="disabledReason() ?? (collapsed() ? 'New session' : null)"
          [attr.aria-label]="collapsed() ? 'New session' : null"
          (click)="onNewSession($event)"
        >
          {{ collapsed() ? '+' : 'New session' }}
        </button>
        <button
          type="button"
          data-testid="rail-previous-sessions"
          data-previous-sessions-trigger
          class="btn btn-ghost btn-sm h-[30px] min-h-[30px] w-full gap-1.5 border border-[color:var(--surface-border-strong)] font-medium hover:!bg-surface-2 hover:!border-[color:var(--surface-border-strong)] [&[aria-expanded=true]]:!bg-surface-3"
          aria-haspopup="dialog"
          [attr.aria-expanded]="previousSessionsOpen()"
          [attr.aria-controls]="previousSessionsOpen() ? 'previous-sessions-dialog' : null"
          [attr.aria-label]="collapsed() ? 'Previous sessions' : null"
          [attr.title]="collapsed() ? 'Previous sessions' : null"
          (click)="previousSessionsRequested.emit()"
        >
          <lucide-angular [img]="HistoryIcon" class="w-3.5 h-3.5" aria-hidden="true" />
          @if (!collapsed()) { <span>Previous sessions</span> }
        </button>
        </div>
        @if (disabledReason(); as reason) {
          <p
            id="rail-new-session-reason"
            class="mt-1 text-xs text-base-content-muted"
            [class.sr-only]="collapsed()"
          >
            {{ reason }}
          </p>
        }
      </footer>
    </aside>
  `,
})
export class CanvasRailComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly tiles = input<readonly CanvasTile[]>([]);
  readonly states = input<ReadonlyMap<string, CompactRailState>>(new Map());
  readonly focusedTabId = input<string | null>(null);
  readonly density = input<CompactRailDensity>('comfortable');
  readonly collapsed = input(false);
  /** The board forces the 56 px form for its width; the toggle cannot expand it. */
  readonly autoCollapsed = input(false);
  readonly band = input<'xl' | 'lg' | 'md' | 'sm'>('lg');
  readonly runningCount = input(0);
  readonly canStart = input(true);
  readonly canAdd = input(true);
  readonly holdTabId = input<string | null>(null);
  readonly surfaceActive = input(true);
  readonly previousSessionsOpen = input(false);
  /** The board's reason no card can open beside (B6); null when split is possible. */
  readonly splitDisabledReason = input<string | null>(null);
  readonly focusRequested = output<string>();
  readonly collapseToggled = output<void>();
  readonly densityToggled = output<void>();
  readonly jumpTo = output<CompactRailState>();
  readonly newSession = output<HTMLElement>();
  readonly previousSessionsRequested = output<void>();
  readonly scrolled = output<number>();
  readonly railState = output<{ tabId: string; state: CompactRailState }>();
  readonly staleAction = output<string>();
  readonly lanesRequested = output<string>();
  readonly openBesideRequested = output<string>();
  readonly moveUpRequested = output<string>();
  readonly moveDownRequested = output<string>();
  readonly maxRunning = MAX_RUNNING_SESSIONS;
  readonly chips = CHIP_STATES;
  readonly autoCollapseReason = AUTO_COLLAPSE_REASON;
  protected readonly HistoryIcon = History;
  readonly orderedTiles = computed(() =>
    [...this.tiles()].sort((a, b) => a.order - b.order),
  );
  readonly showDensityHint = computed(
    () =>
      !this.collapsed() &&
      this.density() === 'comfortable' &&
      this.tiles().length >= 12,
  );
  readonly disabledReason = computed(() =>
    !this.canAdd()
      ? TILE_BOUND_MESSAGE
      : !this.canStart()
        ? RUNNING_CAP_MESSAGE
        : null,
  );
  /** The board's reason wins; otherwise only the focused card cannot open beside. */
  cardSplitReason(tabId: string): string | null {
    return (
      this.splitDisabledReason() ??
      (this.focusedTabId() === tabId ? SPLIT_ALREADY_FOCUSED_REASON : null)
    );
  }
  count(state: CompactRailState): number {
    return this.orderedTiles().filter(
      (tile) => this.states().get(tile.tabId) === state,
    ).length;
  }
  onCollapseToggle(): void {
    if (!this.autoCollapsed()) this.collapseToggled.emit();
  }
  onNewSession(event: MouseEvent): void {
    if (!this.disabledReason() && event.currentTarget instanceof HTMLElement)
      this.newSession.emit(event.currentTarget);
  }
  onScroll(event: Event): void {
    if (event.target instanceof HTMLElement)
      this.scrolled.emit(event.target.scrollTop);
  }
  onKeydown(event: KeyboardEvent): void {
    handleCanvasRailKeydown(event, {
      surfaceActive: this.surfaceActive(),
      orderedIds: this.orderedTiles().map((tile) => tile.tabId),
      focusedId: this.focusedTabId(),
      focus: (id) => this.focusRequested.emit(id),
      focusSelectButton: (id) => {
        const card = [
          ...this.host.nativeElement.querySelectorAll<HTMLElement>(
            '[data-rail-card]',
          ),
        ].find((item) => item.dataset['tabId'] === id);
        focusRailSelectButton(card);
      },
      focusInnerButtons: true,
    });
  }
}
