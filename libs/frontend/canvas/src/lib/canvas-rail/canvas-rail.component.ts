import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
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
import { CanvasRailCardComponent } from './canvas-rail-card.component';
import { handleCanvasRailKeydown } from './canvas-rail-keyboard';

const TILE_BOUND_MESSAGE = `The board holds ${MAX_CANVAS_TILES} sessions. Close one to add another.`;
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
  imports: [CanvasRailCardComponent],
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
    `,
  ],
  template: `
    <aside
      aria-label="Sessions"
      class="flex h-full min-h-0 flex-col border-r border-base-content/10 bg-base-100"
      [class.w-[56px]]="collapsed()"
      [class.w-[304px]]="!collapsed() && (band() === 'xl' || band() === 'lg')"
      [class.w-[288px]]="!collapsed() && band() === 'md'"
      [class.w-[272px]]="!collapsed() && band() === 'sm'"
    >
      <header class="h-[72px] shrink-0 overflow-hidden px-2 py-1">
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
            class="btn btn-ghost btn-xs"
            [attr.aria-label]="collapsed() ? 'Expand rail' : 'Collapse rail'"
            (click)="collapseToggled.emit()"
          >
            {{ collapsed() ? '›' : '‹' }}
          </button>
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
        (scroll)="onScroll($event)"
      >
        @if (orderedTiles().length === 0) {
          <p class="px-3 py-4 text-sm text-base-content-muted">
            No sessions yet
          </p>
        }
        <ul
          role="list"
          class="flex flex-col gap-2 p-2"
          (keydown)="onKeydown($event)"
        >
          @for (tile of orderedTiles(); track tile.tabId; let i = $index) {
            <li
              ptah-canvas-rail-card
              [tabId]="tile.tabId"
              [density]="density()"
              [collapsed]="collapsed()"
              [index]="i + 1"
              [focused]="focusedTabId() === tile.tabId"
              [holdText]="holdTabId() === tile.tabId"
              [state]="states().get(tile.tabId) ?? 'idle'"
              (focusRequested)="focusRequested.emit($event)"
              (railState)="railState.emit({ tabId: tile.tabId, state: $event })"
              (staleAction)="staleAction.emit($event)"
              (lanesRequested)="lanesRequested.emit($event)"
            ></li>
          }
        </ul>
      </div>
      <footer class="h-[84px] shrink-0 px-2 py-2">
        <button
          type="button"
          class="btn btn-primary btn-sm h-[30px] w-full"
          [attr.aria-disabled]="disabledReason() ? 'true' : null"
          [attr.aria-describedby]="
            disabledReason() ? 'rail-new-session-reason' : null
          "
          (click)="onNewSession()"
        >
          {{ collapsed() ? '+' : 'New session' }}
        </button>
        @if (disabledReason(); as reason) {
          <p
            id="rail-new-session-reason"
            class="mt-1 text-xs text-base-content-muted"
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
  readonly band = input<'xl' | 'lg' | 'md' | 'sm'>('lg');
  readonly runningCount = input(0);
  readonly canStart = input(true);
  readonly canAdd = input(true);
  readonly holdTabId = input<string | null>(null);
  readonly surfaceActive = input(true);
  readonly focusRequested = output<string>();
  readonly collapseToggled = output<void>();
  readonly densityToggled = output<void>();
  readonly jumpTo = output<CompactRailState>();
  readonly newSession = output<void>();
  readonly scrolled = output<number>();
  readonly railState = output<{ tabId: string; state: CompactRailState }>();
  readonly staleAction = output<string>();
  readonly lanesRequested = output<string>();
  readonly maxRunning = MAX_RUNNING_SESSIONS;
  readonly chips = CHIP_STATES;
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
  count(state: CompactRailState): number {
    return this.orderedTiles().filter(
      (tile) => this.states().get(tile.tabId) === state,
    ).length;
  }
  onNewSession(): void {
    if (!this.disabledReason()) this.newSession.emit();
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
        card?.querySelector<HTMLButtonElement>('.rc-select, button')?.focus();
      },
      focusInnerButtons: true,
    });
  }
}
