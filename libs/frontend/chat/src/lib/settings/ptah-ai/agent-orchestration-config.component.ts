import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  ChevronDown,
  ChevronUp,
  LucideAngularModule,
  Pencil,
  RefreshCw,
  X,
} from 'lucide-angular';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import {
  NativePopoverComponent,
  SurfaceSectionComponent,
} from '@ptah-extension/ui';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { cliMatrixRows } from './cli-matrix-rows';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
/** One order chip (the strip, its measuring copy and "+N"). */
const CHIP =
  'shrink-0 whitespace-nowrap rounded border border-base-300 bg-base-100 px-1.5 py-0.5 font-bold';
/** `gap-1` between the strip's items. */
const ORDER_GAP_PX = 4;
/**
 * ▲/▼ in the order popover: 24×24 px targets (WCAG 2.5.8). `aria-disabled` looks like `disabled` but keeps focus (Batch
 * 36: a native `disabled` on the focused button during a save dropped focus to the page, where Esc missed the popover).
 * The disabled look is the shared Settings rule in the app styles (Batch 51); both states keep the ghost (transparent) fill.
 */
const MOVE = `btn btn-ghost btn-xs btn-square h-6 min-h-6 w-6 p-0 text-base-content disabled:border-transparent disabled:bg-transparent aria-disabled:border-transparent aria-disabled:bg-transparent ${FOCUS}`;
/** Orchestration policy lives in the user settings (plan §3 rows 891-892), like the CLI matrix's writes. */
const SAVE_SCOPE = 'global';
const DETECT_FAILED =
  'Could not re-detect CLI agents. Your saved settings have not changed.';
const ORDER_NOT_SAVED =
  'Could not save the preferred order. The order shown is the saved one.';

/** One preferred-order entry: an installed system CLI or a Ptah CLI instance, in the matrix's rank order. */
interface OrderChip {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

/**
 * Agent Orchestration policy bar (plan :702-709, design-spec §1.2 item 2, prototype `orchestration.html` :107-147).
 * One row: max concurrent agents (range 1-20 with its live value), the preferred agent order as compact read-only chips
 * (the prototype's `1. Codex → 2. Antigravity → …`), and Re-detect CLIs.
 * - The chip group opens the order popover (the "popover for short choices" save model): one row per agent with ▲/▼
 *   buttons of 24×24 px (deviation 5: chevrons, no grip, no drag; `moveAgentUp/Down` kept). Each move saves.
 * - Reads `state.orchestration()` and `state.cliAgents()`; the chips are the CLI matrix's installed rows
 *   (`cliMatrixRows`, same rank rule), so the bar and the matrix always show one order.
 * - Every write is `state.saveSettings({orchestration:{…}})` through `SettingsSaveFeedbackService` (toast, Undo, D15:
 *   the shown values are the read-back ones). Re-detect is `state.redetectClis()`. Failures show fixed sentences.
 * Since Batch 33 the old body (system CLI cards, the Copilot toggle now in the matrix, the "Manage … in Providers"
 * links, RUX-9) and its private `agent:*` calls are gone. Class and selector are kept (exported from the barrel).
 */
@Component({
  selector: 'ptah-agent-orchestration-config',
  standalone: true,
  imports: [
    SettingsBusyDisabledDirective,
    LucideAngularModule,
    NativePopoverComponent,
    SurfaceSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-surface-section
      tone="subtle"
      padding="md"
      aria-label="Orchestration policy"
      data-testid="settings-section-orchestration-policy"
    >
      <!-- One row in both hosts: the chips clip at the end in a narrow box; the trigger names the whole order. -->
      <div class="flex items-center gap-2.5 text-xs text-base-content">
        <div class="flex shrink-0 items-center gap-1.5">
          <label
            for="agent-max-concurrent"
            class="whitespace-nowrap text-xs font-bold"
            >Max Concurrent:</label
          >
          <span
            class="badge badge-xs border-primary/30 bg-primary/10 font-mono font-bold text-base-content"
            aria-hidden="true"
            data-testid="policy-max-concurrent-value"
            >{{ maxConcurrent() ?? '—' }}</span
          >
          <input
            id="agent-max-concurrent"
            type="range"
            min="1"
            max="20"
            step="1"
            [class]="'range range-xs range-primary h-3.5 w-16 ' + focusRing"
            [value]="maxConcurrent() ?? 1"
            [disabled]="maxConcurrent() === null || !canWrite()"
            [attr.aria-valuetext]="
              maxConcurrent() === null
                ? null
                : maxConcurrent() + ' agents at once'
            "
            (input)="previewMaxConcurrent($event)"
            (change)="saveMaxConcurrent($event)"
          />
        </div>

        <div class="relative flex min-w-0 flex-1 items-center gap-1.5">
          <span
            class="shrink-0 whitespace-nowrap text-xs font-semibold text-base-content-muted"
            aria-hidden="true"
            >Order:</span
          >
          @if (chips().length) {
            <!-- Read-only chips (the prototype's row). Only whole chips that fit are shown, then "+N" for the rest
                 (Batch 53.4, B38-4: never a chip cut mid-glyph). The Edit button names the whole order for screen readers,
                 and its popover lists it. -->
            <span
              #orderStrip
              class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs"
              aria-hidden="true"
              data-testid="policy-order"
            >
              @for (
                chip of shownChips();
                track chip.id;
                let i = $index, first = $first
              ) {
                @if (!first) {
                  <span class="shrink-0 text-xs text-base-content-muted"
                    >→</span
                  >
                }
                <span
                  [class]="chipClass"
                  [class.text-base-content]="chip.enabled"
                  [class.text-base-content-muted]="!chip.enabled"
                  [attr.data-testid]="'policy-order-chip-' + chip.id"
                  >{{ i + 1 }}. {{ chip.name }}</span
                >
              }
              @if (hiddenCount()) {
                @if (shownChips().length) {
                  <span class="shrink-0 text-xs text-base-content-muted"
                    >→</span
                  >
                }
                <span
                  [class]="chipClass + ' text-base-content'"
                  [title]="orderSummary()"
                  data-testid="policy-order-more"
                  >+{{ hiddenCount() }}</span
                >
              }
            </span>
            <!-- Measuring copy of every chip (invisible, out of the flow): the widths decide how many whole chips fit. -->
            <span
              #orderMeasure
              class="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap text-xs"
              aria-hidden="true"
            >
              <span data-measure="arrow" class="text-xs">→</span>
              @for (chip of chips(); track chip.id; let i = $index) {
                <span data-measure="chip" [class]="chipClass"
                  >{{ i + 1 }}. {{ chip.name }}</span
                >
              }
              <span data-measure="more" [class]="chipClass"
                >+{{ chips().length }}</span
              >
            </span>
            <ptah-native-popover
              class="shrink-0"
              [isOpen]="orderOpen()"
              placement="bottom-end"
              [hasBackdrop]="true"
              backdropClass="transparent"
              (closed)="closeOrder()"
              (opened)="focusFirstMove()"
            >
              <button
                trigger
                type="button"
                [class]="moveClass"
                [attr.aria-label]="orderSummary() + '. Edit order'"
                aria-haspopup="dialog"
                [attr.aria-expanded]="orderOpen()"
                (click)="toggleOrder()"
                data-testid="policy-order-edit"
              >
                <lucide-angular
                  [img]="EditIcon"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </button>
              @if (orderOpen()) {
                <div
                  content
                  role="dialog"
                  aria-labelledby="policy-order-title"
                  class="w-[16rem] max-w-[calc(100vw-2rem)] space-y-2 p-3"
                  data-testid="policy-order-popover"
                >
                  <div
                    class="flex items-center justify-between gap-2 border-b border-base-300 pb-1.5"
                  >
                    <!-- A plain title, not a heading: the popover sits in the page outline below the tab heading (axe heading-order). -->
                    <p
                      id="policy-order-title"
                      class="text-xs font-bold text-base-content"
                    >
                      Preferred order
                    </p>
                    <button
                      type="button"
                      [class]="moveClass"
                      aria-label="Close"
                      (click)="closeOrder()"
                    >
                      <lucide-angular
                        [img]="CloseIcon"
                        class="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <ol class="space-y-1">
                    @for (
                      chip of chips();
                      track chip.id;
                      let i = $index, first = $first, last = $last
                    ) {
                      <li
                        class="flex items-center gap-1 text-xs"
                        [attr.data-testid]="'policy-order-row-' + chip.id"
                      >
                        <span
                          class="min-w-0 flex-1 truncate font-bold"
                          [class.text-base-content]="chip.enabled"
                          [class.text-base-content-muted]="!chip.enabled"
                          >{{ i + 1 }}. {{ chip.name }}</span
                        >
                        @if (!chip.enabled) {
                          <span class="text-xs text-base-content-muted"
                            >off</span
                          >
                        }
                        <!-- Native disabled only at the ends; while a move cannot run (saving, not read) the buttons are
                             aria-disabled and ignore clicks, so the focused one keeps focus and Esc closes the popover. -->
                        <button
                          type="button"
                          [class]="moveClass"
                          [disabled]="first"
                          [attr.aria-disabled]="canReorder() ? null : 'true'"
                          [attr.aria-label]="'Move ' + chip.name + ' up'"
                          [attr.data-testid]="'policy-order-up-' + chip.id"
                          (click)="moveAgentUp(i)"
                        >
                          <lucide-angular
                            [img]="UpIcon"
                            class="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          [class]="moveClass"
                          [disabled]="last"
                          [attr.aria-disabled]="canReorder() ? null : 'true'"
                          [attr.aria-label]="'Move ' + chip.name + ' down'"
                          [attr.data-testid]="'policy-order-down-' + chip.id"
                          (click)="moveAgentDown(i)"
                        >
                          <lucide-angular
                            [img]="DownIcon"
                            class="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    }
                  </ol>
                  @if (orderError(); as message) {
                    <p
                      class="text-xs text-base-content"
                      role="alert"
                      data-testid="policy-order-error"
                    >
                      {{ message }}
                    </p>
                  }
                  <p class="text-xs text-base-content-muted">
                    The first available agent is used when no CLI is specified.
                  </p>
                </div>
              }
            </ptah-native-popover>
          } @else {
            <span
              class="text-xs text-base-content-muted"
              data-testid="policy-order-empty"
            >
              {{ loaded() ? 'No CLI agent installed yet.' : 'Loading…' }}
            </span>
          }
        </div>

        <button
          type="button"
          [class]="
            'btn btn-outline btn-xs h-6 min-h-6 shrink-0 gap-1 border-base-content-muted text-[11px] text-base-content ' +
            focusRing
          "
          [ptahBusyDisabled]="detecting()"
          (click)="redetectClis()"
          aria-label="Re-detect CLI agents"
          data-testid="policy-redetect"
        >
          @if (detecting()) {
            <span
              class="loading loading-spinner loading-xs"
              aria-hidden="true"
            ></span>
            Detecting…
          } @else {
            <lucide-angular
              [img]="RefreshIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
            Re-detect CLIs
          }
        </button>
      </div>
      @if (detectFailed()) {
        <p
          class="mt-1 text-xs text-base-content"
          role="alert"
          data-testid="policy-redetect-error"
        >
          {{ detectFailedMessage }}
        </p>
      }
      <span class="sr-only" role="status" aria-live="polite">{{
        detectDone() ? 'CLI agents re-detected.' : ''
      }}</span>
    </ptah-surface-section>
  `,
})
export class AgentOrchestrationConfigComponent {
  protected readonly UpIcon = ChevronUp;
  protected readonly DownIcon = ChevronDown;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly EditIcon = Pencil;
  protected readonly CloseIcon = X;
  protected readonly focusRing = FOCUS;
  protected readonly moveClass = MOVE;
  protected readonly detectFailedMessage = DETECT_FAILED;

  private readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The slider's value while it is dragged; `null` shows the saved (read-back) value. */
  private readonly draft = signal<number | null>(null);
  /** The live value: the dragged one, else the saved one, else `null` before the first read. */
  protected readonly maxConcurrent = computed(
    () =>
      this.draft() ??
      this.state.orchestration().data?.maxConcurrentAgents ??
      null,
  );
  protected readonly loaded = computed(
    () => this.state.orchestration().data !== null,
  );
  /** The installed rows of the CLI matrix, in its order (system CLIs and Ptah CLI instances). */
  protected readonly chips = computed((): readonly OrderChip[] =>
    cliMatrixRows({
      orchestration: this.state.orchestration().data,
      cliAgents: this.state.cliAgents().data,
      cliModels: null,
      cliTest: null,
    }).installed.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
    })),
  );
  /** The whole order for the trigger's accessible name (the chips may clip in a narrow box). */
  protected readonly orderSummary = computed(
    () =>
      'Preferred order: ' +
      this.chips()
        .map(
          (chip, i) => `${i + 1}. ${chip.name}${chip.enabled ? '' : ' (off)'}`,
        )
        .join(', '),
  );
  /** The slider stays enabled while a save runs (disabling it would drop its focus); the save is refused then (D3). */
  protected readonly canWrite = computed(
    () =>
      this.state.scopes().status === 'ready' &&
      this.state.reviewContext() !== null,
  );
  /** Both lists must be read: an order written from one of them would drop the other's ids. No move while saving. */
  protected readonly canReorder = computed(
    () =>
      this.canWrite() &&
      !this.feedback.saving() &&
      this.state.orchestration().data !== null &&
      this.state.cliAgents().data !== null,
  );

  /** How many whole chips fit the strip (Batch 53.4); all of them until measured (and in a layout-less test DOM). */
  private readonly fittingCount = signal<number | null>(null);
  protected readonly chipClass = CHIP;
  protected readonly shownChips = computed(() => {
    const count = this.fittingCount();
    return count === null ? this.chips() : this.chips().slice(0, count);
  });
  protected readonly hiddenCount = computed(
    () => this.chips().length - this.shownChips().length,
  );
  private readonly orderStrip =
    viewChild<ElementRef<HTMLElement>>('orderStrip');
  private readonly orderMeasure =
    viewChild<ElementRef<HTMLElement>>('orderMeasure');

  constructor() {
    // A changed list recounts the chips that fit.
    effect(() => {
      this.chips();
      this.orderStrip();
      untracked(() =>
        afterNextRender(() => this.measureChips(), { injector: this.injector }),
      );
    });
    // A resize does too. The strip lives under `@if (chips().length)`, so an order that empties and refills makes a new
    // element: the observer follows the current strip, and the previous one is disconnected (on re-run and on destroy).
    effect((onCleanup) => {
      const strip = this.orderStrip()?.nativeElement;
      if (!strip || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.measureChips());
      observer.observe(strip);
      onCleanup(() => observer.disconnect());
    });
  }

  /** Whole chips that fit the strip's width; when not all fit, room is kept for "→ +N". */
  private measureChips(): void {
    const strip = this.orderStrip()?.nativeElement,
      measure = this.orderMeasure()?.nativeElement;
    if (!strip || !measure) return;
    const available = strip.clientWidth;
    const widths = Array.from(
      measure.querySelectorAll<HTMLElement>('[data-measure="chip"]'),
    ).map((node) => node.offsetWidth);
    const arrow =
      measure.querySelector<HTMLElement>('[data-measure="arrow"]')
        ?.offsetWidth ?? 0;
    const more =
      measure.querySelector<HTMLElement>('[data-measure="more"]')
        ?.offsetWidth ?? 0;
    if (!available || widths.some((width) => width === 0)) {
      this.fittingCount.set(null);
      return;
    }
    const step = (i: number) =>
      widths[i] + (i > 0 ? arrow + 2 * ORDER_GAP_PX : 0);
    const total = widths.reduce((sum, _width, i) => sum + step(i), 0);
    if (total <= available) {
      this.fittingCount.set(null);
      return;
    }
    let used = 0,
      count = 0;
    const tail = (shown: number) =>
      (shown > 0 ? arrow + 2 * ORDER_GAP_PX : 0) + more;
    while (
      count < widths.length &&
      used + step(count) + tail(count + 1) <= available
    )
      used += step(count++);
    this.fittingCount.set(count);
  }

  protected readonly orderOpen = signal(false);
  protected readonly orderError = signal<string | null>(null);

  private readonly redetecting = signal(false);
  protected readonly detecting = computed(
    () => this.redetecting() || this.state.cliDetection().status === 'loading',
  );
  /** Set by this bar's own Re-detect only, so a failure elsewhere never shows here. */
  protected readonly detectFailed = signal(false);
  protected readonly detectDone = signal(false);

  protected toggleOrder(): void {
    this.orderError.set(null);
    this.orderOpen.update((open) => !open);
  }

  /** Esc, the backdrop and Close end here; the popover returns focus to the trigger. */
  protected closeOrder(): void {
    this.orderOpen.set(false);
    this.orderError.set(null);
  }

  /** The panel takes focus when positioned; then its first enabled move button does. */
  protected focusFirstMove(): void {
    this.element.nativeElement
      .querySelector<HTMLButtonElement>(
        '[data-testid="policy-order-popover"] li button:not([disabled])',
      )
      ?.focus();
  }

  protected previewMaxConcurrent(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isInteger(value)) this.draft.set(value);
  }

  /** Saves on release; the slider then shows the read-back value (the draft is dropped either way). */
  protected async saveMaxConcurrent(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const value = input.valueAsNumber;
    const previous = this.state.orchestration().data?.maxConcurrentAgents;
    const context = this.state.reviewContext();
    try {
      if (
        !context ||
        previous === undefined ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 20 ||
        value === previous
      )
        return;
      await this.feedback.save({
        label: 'max concurrent agents',
        scope: SAVE_SCOPE,
        write: () =>
          this.state.saveSettings(
            { orchestration: { maxConcurrentAgents: value } },
            context,
          ),
        undo: () =>
          this.state.saveSettings(
            { orchestration: { maxConcurrentAgents: previous } },
            context,
          ),
      });
    } finally {
      this.draft.set(null);
      // The binding may not change (the same saved value), so the thumb is moved to the read-back value directly.
      const saved = this.state.orchestration().data?.maxConcurrentAgents;
      if (saved !== undefined) input.value = String(saved);
    }
  }

  /** Move an agent one place earlier in the preferred order. */
  moveAgentUp(index: number): void {
    if (index <= 0 || !this.canReorder()) return;
    const ids = this.chips().map((chip) => chip.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    void this.savePreferredOrder(ids, ids[index - 1], 'up');
  }

  /** Move an agent one place later in the preferred order. */
  moveAgentDown(index: number): void {
    const ids = this.chips().map((chip) => chip.id);
    if (index >= ids.length - 1 || !this.canReorder()) return;
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    void this.savePreferredOrder(ids, ids[index + 1], 'down');
  }

  async redetectClis(): Promise<void> {
    if (this.detecting()) return;
    this.redetecting.set(true);
    this.detectFailed.set(false);
    this.detectDone.set(false);
    try {
      await this.state.redetectClis();
      const ok = this.state.cliDetection().status === 'ready';
      this.detectFailed.set(!ok);
      this.detectDone.set(ok);
    } catch (error: unknown) {
      // The state settles its own read failures; a throw means the command itself broke.
      void error;
      this.detectFailed.set(true);
    } finally {
      this.redetecting.set(false);
    }
  }

  /**
   * One move = one write of the whole order, with Undo. The rows show the read-back order (D15); when this move's own
   * write did not save (refused, failed or threw), a fixed sentence says so in the popover (the toast carries the
   * details). `commit()` alone is not enough: a refused move leaves an earlier save's `saved` there (Gate V 36, m-1).
   */
  private async savePreferredOrder(
    order: string[],
    movedId: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    const context = this.state.reviewContext();
    if (!context || !this.canReorder()) return;
    const previous = [
      ...(this.state.orchestration().data?.preferredAgentOrder ?? []),
    ];
    this.orderError.set(null);
    let saved = false;
    await this.feedback.save({
      label: 'preferred agent order',
      scope: SAVE_SCOPE,
      write: async () => {
        const accepted = await this.state.saveSettings(
          { orchestration: { preferredAgentOrder: order } },
          context,
        );
        saved = accepted && this.state.commit().status === 'saved';
        return accepted;
      },
      undo: () =>
        this.state.saveSettings(
          { orchestration: { preferredAgentOrder: previous } },
          context,
        ),
    });
    if (!saved) this.orderError.set(ORDER_NOT_SAVED);
    this.refocus(movedId, direction);
  }

  /**
   * The moved row changed place (re-ordering the list can move its element, which drops focus) and may have reached an
   * end, where the button used is now `disabled`: once re-rendered, focus returns to the button used, or to the row's
   * other one. During the save itself the buttons are only `aria-disabled`, so focus never leaves the popover.
   */
  private refocus(id: string, direction: 'up' | 'down'): void {
    afterNextRender(
      () => {
        const other = direction === 'up' ? 'down' : 'up';
        const host = this.element.nativeElement;
        [direction, other]
          .map((which) =>
            host.querySelector<HTMLButtonElement>(
              `[data-testid="policy-order-${which}-${id}"]`,
            ),
          )
          .find((button) => button && !button.disabled)
          ?.focus();
      },
      { injector: this.injector },
    );
  }
}
