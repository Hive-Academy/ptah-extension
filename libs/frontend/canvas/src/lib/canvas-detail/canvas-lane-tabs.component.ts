import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { SessionAgent } from '@ptah-extension/chat';
import { SessionAgentRosterService } from '@ptah-extension/chat';
import {
  AgentAvatarComponent,
  agentAccessibleLabel,
  type AgentKind,
} from '@ptah-extension/chat-ui';
import { FloatingUIService } from '@ptah-extension/ui';
import { AgentDockCardComponent } from './agent-dock-card.component';
import { AgentDockMenuComponent } from './agent-dock-menu.component';
import {
  DOCK_INLINE_MAX,
  agentDurationMs,
  agentDurationText,
  agentStatusInk,
  dockCapacity,
  planDockOverflow,
} from './dock-overflow';

const CARD_OPEN_MS = 220;
const DOCK_KINDS: readonly AgentKind[] = [
  'orchestrator',
  'subagent',
  'cli',
  'background',
];
/** Unselected chip in an inline roster: avatar plus a truncated name. */
const NAMED_CHIP_CLASS = 'h-7 max-w-[140px] gap-1.5 px-1 text-xs text-base-content-muted';
/** Unselected chip beside the overflow menu: a bare avatar circle. */
const CIRCLE_CHIP_CLASS = 'size-7 justify-center';
/** Rail chip in the stats sidebar: the larger avatar circle. */
const RAIL_CHIP_CLASS = 'h-[38px] w-[38px] justify-center';

interface DockChipModel {
  readonly key: string;
  readonly agent: SessionAgent;
  readonly selected: boolean;
  readonly label: string;
  readonly durationText: string | null;
  readonly statusInk: string;
  readonly tabDomId: string;
}

interface DockGroupModel {
  readonly kind: AgentKind;
  readonly chips: readonly DockChipModel[];
}

interface DockLayout {
  readonly groups: readonly DockGroupModel[];
  readonly hidden: readonly SessionAgent[];
  readonly compact: boolean;
  readonly cardId: string;
  /** Every visible chip shows its name in a small roster. */
  readonly named: boolean;
}

/**
 * Main-view agent dock. Same selector and tablist keyboard model as the lane
 * strip it replaced. Small rosters show eligible agents as named chips.
 * Larger rosters show one pill for the selected agent,
 * avatar circles with a hover / focus card for the rest, and an overflow
 * menu for whoever does not fit.
 */
@Component({
  selector: 'ptah-canvas-lane-tabs',
  standalone: true,
  imports: [
    AgentAvatarComponent,
    AgentDockCardComponent,
    AgentDockMenuComponent,
  ],
  providers: [FloatingUIService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onDocumentEscape($event)',
    '[class.flex]': 'rail()',
    '[class.flex-col]': 'rail()',
    '[class.items-center]': 'rail()',
  },
  styles: [
    `
      /* Theme ink at low opacity shades the left edge behind the chips. */
      :host > [role='tablist']:not(.flex-col) {
        background-image: linear-gradient(to right, oklch(var(--bc) / 0.07), transparent 80%);
      }
      /* Glass on (any theme): the dock strip is part of the chat column's one
         glass surface (styles.css "Ptah chat column"): no fill, no rule and no
         drop shadow under it, and 8px of air before the messages. The lane
         view below is flex-1 min-h-0, so the transcript still scrolls and the
         composer stays at the bottom. The strip keeps relative z-10, so its
         card and dropdown still stack above the content. The contrast and
         forced-colours settings keep the strip's fill and rule. */
      :host-context([data-theme][data-glass='on']) > [role='tablist'] {
        margin-bottom: 8px;
      }
      @media (forced-colors: none) and (prefers-contrast: no-preference) and (prefers-reduced-transparency: no-preference) {
        :host-context([data-theme][data-glass='on']) > [role='tablist'] {
          background-color: transparent;
          border-bottom-color: transparent;
          box-shadow: none;
        }
      }
      /* The selected chip: a soft secondary glow (see styles.css section 9
         --glass-glow-*) in place of the solid ring. The focus-visible
         outline is separate and stays. The contrast and forced-colours
         settings keep the solid ring. */
      @media (forced-colors: none) and (prefers-contrast: no-preference) and (prefers-reduced-transparency: no-preference) {
        :host-context([data-theme][data-glass='on']) [role='tab'][aria-selected='true'] {
          border-color: transparent;
          box-shadow:
            0 0 0 1px color-mix(in oklch, oklch(var(--s)) var(--glass-glow-ring, 40%), transparent),
            0 0 var(--glass-glow-blur, 12px) -2px color-mix(in oklch, oklch(var(--s)) var(--glass-glow-halo, 45%), transparent);
        }
      }
    `,
  ],
  template: `
    @let view = layout();
    <!-- Keep the dock at z-10 below the header menu (z-20); its card and dropdown share this stacking context. -->
    <div
      #dock
      role="tablist"
      aria-label="Lanes"
      [class.flex-col]="rail()"
      [class.px-0]="rail()"
      [class.border-0]="rail()"
      [class.pt-1]="!rail()"
      [class.pt-0.5]="rail()"
      (pointerdown)="onDockPointerDown()"
      (click)="onDockClick()"
      (focusin)="onDockFocusIn($event)"
      (focusout)="onDockFocusOut($event)"
      class="relative z-10 flex min-w-0 items-center gap-0.5 flex-wrap border-b border-surface-border bg-surface-1 px-2 pb-0.5 shadow-[0_6px_8px_-6px_rgb(0_0_0/0.45)]"
    >
      @for (group of view.groups; track group.kind; let first = $first) {
        @if (!first && !rail()) {
          <span
            class="mx-1 h-4 w-px shrink-0 self-center bg-[var(--surface-border-strong)]"
            aria-hidden="true"
            data-testid="dock-divider"
          ></span>
        }
        @for (chip of group.chips; track chip.key) {
          @if (!rail() && chip.selected) {
            <button
              type="button"
              role="tab"
              [id]="chip.tabDomId"
              class="inline-flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-full border border-secondary pl-0.5 pr-2 text-xs text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
              [attr.aria-selected]="chip.selected"
              [attr.aria-controls]="panelId()"
              [attr.aria-label]="chip.label"
              [attr.aria-describedby]="cardKey() === chip.key ? view.cardId : null"
              [tabIndex]="chip.selected ? 0 : -1"
              (click)="onTabClick(chip.key)"
              (keydown)="onKeydown($event, chip.key)"
              (pointerenter)="onPointerEnter($event, chip.key)"
              (pointerleave)="onPointerLeave(chip.key)"
              (focus)="onTabFocus($event, chip.key)"
              (blur)="onTabBlur(chip.key)"
            >
              <ptah-agent-avatar
                [kind]="chip.agent.kind"
                [status]="chip.agent.status"
                [size]="rail() ? 28 : 24"
                [cliId]="chip.agent.cliId"
                [agentType]="chip.agent.agentType"
              />
              <span class="min-w-0 truncate" data-testid="dock-chip-name">{{ chip.agent.name }}</span>
              @if (chip.agent.status) {
                <span class="shrink-0 {{ chip.statusInk }}">{{
                  chip.agent.status
                }}</span>
              }
              @if (chip.durationText; as duration) {
                <span class="shrink-0 tabular-nums text-base-content-muted">{{
                  duration
                }}</span>
              }
            </button>
          } @else {
            <button
              type="button"
              role="tab"
              [id]="chip.tabDomId"
              [class]="'inline-flex shrink-0 items-center rounded-full hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))] ' + (rail() ? railChipClass : view.named ? namedChipClass : circleChipClass)"
              [attr.aria-selected]="chip.selected"
              [attr.aria-controls]="panelId()"
              [attr.aria-label]="chip.label"
              [attr.aria-describedby]="cardKey() === chip.key ? view.cardId : null"
              [tabIndex]="(rail() ? railTabStop() === chip.key : chip.selected) ? 0 : -1"
              (click)="onTabClick(chip.key)"
              (keydown)="onKeydown($event, chip.key)"
              (pointerenter)="onPointerEnter($event, chip.key)"
              (pointerleave)="onPointerLeave(chip.key)"
              (focus)="onTabFocus($event, chip.key)"
              (blur)="onTabBlur(chip.key)"
            >
              <ptah-agent-avatar
                [kind]="chip.agent.kind"
                [status]="chip.agent.status"
                [size]="rail() ? 28 : 24"
                [cliId]="chip.agent.cliId"
                [agentType]="chip.agent.agentType"
              />
              @if (view.named) {
                <span class="min-w-0 truncate" data-testid="dock-chip-name">{{ chip.agent.name }}</span>
              }
            </button>
          }
        }
      }
      @if (!rail() && view.hidden.length > 0) {
        <ptah-agent-dock-menu
          [hidden]="view.hidden"
          [selectedKey]="selectedKey()"
          [compact]="view.compact"
          [now]="now()"
          (agentSelect)="onMenuSelect($event)"
          (openChange)="menuOpen.set($event)"
        />
      }
      @if (cardAgent(); as agent) {
        <ptah-agent-dock-card
          [agent]="agent"
          [durationText]="cardDuration()"
          [cardId]="view.cardId"
          (hovered)="onCardHovered($event)"
        />
      }
    </div>
    <!-- Outside the tablist: it expands the sidebar, it is not a tab. -->
    @if (rail() && view.hidden.length > 0) {
      <button type="button" class="btn btn-ghost btn-xs size-7"
        [attr.aria-label]="'Show ' + view.hidden.length + ' more active agents'"
        (click)="expandRequested.emit()">+{{ view.hidden.length }}</button>
    }
  `,
})
export class CanvasLaneTabsComponent {
  private readonly roster = inject(SessionAgentRosterService);
  private readonly floatingUI = inject(FloatingUIService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dock = viewChild.required<ElementRef<HTMLElement>>('dock');

  readonly tabId = input<string | null>(null);
  readonly panelId = input('canvas-lane-panel');
  readonly laneKey = input('orchestrator');
  readonly laneSelected = output<string>();
  /** Rail only: the user picked an agent (click, Enter, Space or the overflow menu). */
  readonly railPicked = output<string>();
  readonly expandRequested = output<void>();
  readonly rail = input(false);

  /** Measured dock width. `Infinity` until a ResizeObserver reports one. */
  private readonly width = signal(Number.POSITIVE_INFINITY);
  /** Keep the same chips while keyboard focus is in the dock. */
  private readonly frozenVisibleKeys = signal<readonly string[] | null>(null);
  private lastInputModality: 'keyboard' | 'pointer' = 'keyboard';
  private readonly focusedChipKey = signal<string | null>(null);
  protected readonly menuOpen = signal(false);
  private pendingTabFocusKey: string | null = null;
  private focusRecoveryPending = false;
  protected readonly now = signal(Date.now());
  /** Agent whose hover / focus card is open, if any. */
  protected readonly cardKey = signal<string | null>(null);
  private cardTimer: ReturnType<typeof setTimeout> | null = null;
  private cardHovered = false;
  private tabHoveredKey: string | null = null;
  protected readonly namedChipClass = NAMED_CHIP_CLASS;
  protected readonly circleChipClass = CIRCLE_CHIP_CLASS;
  protected readonly railChipClass = RAIL_CHIP_CLASS;

  readonly agents = computed(() => this.roster.roster(this.tabId()));

  readonly selectedKey = computed(() => {
    const key = this.laneKey();
    const keys = this.agents().map((agent) => agent.key);
    if (keys.includes(key)) return key;
    const alternateKey = key.startsWith('sub:')
      ? `bg:${key.slice(4)}`
      : key.startsWith('bg:')
        ? `sub:${key.slice(3)}`
        : null;
    return alternateKey && keys.includes(alternateKey) ? alternateKey : 'orchestrator';
  });

  /**
   * Prefix for this dock's tab and card ids. The chat dock and the sidebar
   * rail dock render for the same pane at once, so the rail ids differ. The
   * lane panel's aria-labelledby points at the chat dock's tab.
   */
  private readonly idPrefix = computed(() =>
    this.rail() ? `${this.panelId()}-rail` : this.panelId(),
  );

  /** Small roster: visible chips are named, so none needs the hover / focus card. */
  private readonly namesInline = computed(
    () => !this.rail() && this.agents().length <= DOCK_INLINE_MAX,
  );

  protected readonly layout = computed((): DockLayout => {
    const now = this.now();
    const selected = this.selectedKey();
    const idPrefix = this.idPrefix();
    const width = this.width();
    let { visible, hidden } = planDockOverflow(
      this.agents(),
      selected,
      dockCapacity(width),
    );
    const frozen = this.frozenVisibleKeys();
    if (frozen && !this.rail()) {
      const keep = new Set([...frozen, selected]);
      for (const agent of this.agents()) {
        if (agent.status === 'waiting' || agent.status === 'failed') keep.add(agent.key);
      }
      visible = this.agents().filter((agent) => keep.has(agent.key));
      hidden = this.agents().filter((agent) => !keep.has(agent.key));
    }
    if (this.rail()) {
      const active = this.agents().filter(agent => agent.status === 'running' || agent.status === 'waiting');
      const candidates = active.length ? active : this.agents().filter(agent => agent.kind === 'orchestrator');
      visible = candidates.slice(0, 5);
      hidden = candidates.slice(5);
    }
    const chips = new Map<AgentKind, DockChipModel[]>();
    for (const agent of visible) {
      const durationMs = agentDurationMs(agent, now);
      const chip: DockChipModel = {
        key: agent.key,
        agent,
        selected: agent.key === selected,
        label: agentAccessibleLabel({
          name: agent.name,
          kind: agent.kind,
          status: agent.status,
          durationMs,
        }),
        durationText: agentDurationText(agent, now),
        statusInk: agentStatusInk(agent.status),
        tabDomId: `${idPrefix}-tab-${agent.key}`,
      };
      const group = chips.get(agent.kind);
      if (group) group.push(chip);
      else chips.set(agent.kind, [chip]);
    }
    return {
      groups: DOCK_KINDS.filter((kind) => chips.has(kind)).map((kind) => ({
        kind,
        chips: chips.get(kind) ?? [],
      })),
      hidden,
      compact: Number.isFinite(width) && width < 480,
      cardId: `${idPrefix}-agent-card`,
      named: this.namesInline(),
    };
  });

  /** Rail strip: the agent the arrow keys last moved focus to (roving tab stop). */
  private readonly railFocusKey = signal<string | null>(null);

  /** Rail strip: the one chip in the tab order — the focused one, else the selected, else the first. */
  protected readonly railTabStop = computed(() => {
    if (!this.rail()) return null;
    const keys = this.layout().groups.flatMap((group) => group.chips.map((chip) => chip.key));
    const focused = this.railFocusKey();
    if (focused && keys.includes(focused)) return focused;
    const selected = this.selectedKey();
    return keys.includes(selected) ? selected : (keys[0] ?? null);
  });

  protected readonly cardAgent = computed(() => {
    const key = this.cardKey();
    if (!key) return null;
    return this.agents().find((agent) => agent.key === key) ?? null;
  });

  protected readonly cardDuration = computed(() => {
    const agent = this.cardAgent();
    return agent ? agentDurationText(agent, this.now()) : null;
  });

  constructor() {
    effect(() => {
      const key = this.cardKey();
      if (key !== null && (this.isNamedChip(key) || !this.visibleKeys().includes(key))) {
        this.closeCard();
      }
    });
    effect(() => {
      const focused = this.focusedChipKey();
      if (focused && !this.visibleKeys().includes(focused)) this.restoreDockFocus();
    });
    effect(() => {
      if (!this.menuOpen() || this.layout().hidden.length > 0) return;
      this.menuOpen.set(false);
      this.restoreDockFocus();
    });
    effect(() => {
      if (this.laneKey() !== this.selectedKey()) {
        this.laneSelected.emit(this.selectedKey());
      }
    });
    effect((onCleanup) => {
      const ticking = this.agents().some(
        (agent) =>
          agent.status === 'running' && typeof agent.startedAt === 'number',
      );
      if (!ticking) return;
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(timer));
    });
    this.destroyRef.onDestroy(() => this.clearCardTimer());
    afterNextRender(() => {
      const root = this.dock().nativeElement;
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const measured = entries[0]?.contentRect.width ?? root.clientWidth;
        this.width.set(measured);
      });
      observer.observe(root);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected onTabClick(key: string): void {
    this.pick(key);
  }

  protected onMenuSelect(key: string): void {
    this.pick(key);
    this.focusTab(key);
  }

  /** A user pick; in the rail it is separate from key normalization, which must never expand the sidebar. */
  private pick(key: string): void {
    if (this.rail()) this.railPicked.emit(key);
    else this.laneSelected.emit(key);
  }

  protected onKeydown(event: KeyboardEvent, key: string): void {
    this.onDockKeydown();
    const keys = this.visibleKeys();
    if (keys.length === 0) return;
    const index = keys.indexOf(key);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % keys.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + keys.length) % keys.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? keys.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const nextKey = keys[next];
    this.pendingTabFocusKey = nextKey;
    // The rail only moves focus: selecting there expands the sidebar, which Enter or a click does.
    if (this.rail()) this.railFocusKey.set(nextKey);
    else this.laneSelected.emit(nextKey);
    this.focusTab(nextKey);
  }

  protected onPointerEnter(event: PointerEvent, key: string): void {
    if (this.isNamedChip(key) || event.pointerType === 'touch') return;
    this.tabHoveredKey = key;
    this.clearCardTimer();
    if (this.cardKey() === key) return;
    this.cardTimer = setTimeout(() => {
      this.cardTimer = null;
      this.openCard(key);
    }, CARD_OPEN_MS);
  }

  protected onPointerLeave(key: string): void {
    if (this.tabHoveredKey === key) this.tabHoveredKey = null;
    this.clearCardTimer();
    this.queueCardClose(this.cardKey() ?? key);
  }

  protected onTabFocus(event: FocusEvent, key: string): void {
    this.focusedChipKey.set(key);
    if (this.rail()) this.railFocusKey.set(key);
    if (this.isNamedChip(key)) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
    this.clearCardTimer();
    this.openCard(key);
  }

  protected onTabBlur(key: string): void {
    this.queueCardClose(key);
  }

  protected onDockPointerDown(): void {
    this.lastInputModality = 'pointer';
  }

  protected onDockClick(): void {
    if (this.lastInputModality !== 'pointer') return;
    this.frozenVisibleKeys.set(null);
  }

  @HostListener('document:keydown')
  protected onDockKeydown(): void {
    this.lastInputModality = 'keyboard';
    const target = document.activeElement;
    if (
      this.rail() || this.frozenVisibleKeys() || !(target instanceof HTMLElement) ||
      target.getAttribute('role') !== 'tab' || !this.dock().nativeElement.contains(target)
    ) return;
    this.frozenVisibleKeys.set(this.visibleKeys());
  }

  protected onDockFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'tab') {
      this.focusedChipKey.set(null);
      return;
    }
    if (this.rail() || this.frozenVisibleKeys() || this.lastInputModality === 'pointer') return;
    this.frozenVisibleKeys.set(this.visibleKeys());
  }

  protected onDockFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.dock().nativeElement.contains(next)) return;
    if (this.pendingTabFocusKey !== null) return;
    const focused = this.focusedChipKey();
    if (focused && !this.visibleKeys().includes(focused)) {
      this.restoreDockFocus();
      return;
    }
    this.focusedChipKey.set(null);
    this.frozenVisibleKeys.set(null);
  }

  protected onCardHovered(hovered: boolean): void {
    this.cardHovered = hovered;
    if (hovered) this.clearCardTimer();
    else this.queueCardClose(this.cardKey());
  }

  /** Closes a hover-opened card. Selection and focus stay where they are. */
  protected onDocumentEscape(event: Event): void {
    if (this.cardKey() === null) return;
    event.stopPropagation();
    this.closeCard();
  }

  private focusTab(key: string): void {
    afterNextRender(
      () => {
        document.getElementById(this.tabDomId(key))?.focus();
        if (this.pendingTabFocusKey === key) this.pendingTabFocusKey = null;
      },
      { injector: this.injector },
    );
  }

  private tabDomId(key: string): string {
    return `${this.idPrefix()}-tab-${key}`;
  }

  private readonly visibleKeys = computed(() =>
    this.layout().groups.flatMap((group) => group.chips.map((chip) => chip.key)),
  );

  private restoreDockFocus(): void {
    if (this.focusRecoveryPending) return;
    this.focusRecoveryPending = true;
    afterNextRender(
      () => {
        this.focusRecoveryPending = false;
        const root = this.dock().nativeElement;
        if (root.contains(document.activeElement) || document.activeElement !== document.body) return;
        const keys = this.visibleKeys();
        const key = keys.includes(this.selectedKey()) ? this.selectedKey() : keys[0];
        const target = key
          ? document.getElementById(this.tabDomId(key))
          : root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  /** A chip that already shows its name opens no hover / focus card. */
  private isNamedChip(key: string): boolean {
    return !this.rail() && (this.namesInline() || key === this.selectedKey());
  }

  private openCard(key: string): void {
    if (this.isNamedChip(key) || !this.visibleKeys().includes(key)) return;
    this.cardKey.set(key);
    afterNextRender(
      () => {
        const tab = document.getElementById(this.tabDomId(key));
        const card = document.getElementById(`${this.idPrefix()}-agent-card`);
        if (!tab || !card) return;
        const boundary = this.dock().nativeElement.closest<HTMLElement>('[data-inspector-dock]');
        void this.floatingUI.position(tab, card, {
          placement: this.rail() ? 'left-start' : 'bottom-start',
          offset: 0,
          boundary: boundary ?? undefined,
        });
      },
      { injector: this.injector },
    );
  }

  private queueCardClose(key: string | null): void {
    if (!key || this.cardKey() !== key) return;
    this.clearCardTimer();
    this.cardTimer = setTimeout(() => {
      this.cardTimer = null;
      this.closeCardIfIdle(key);
    }, CARD_OPEN_MS);
  }

  private closeCardIfIdle(key: string): void {
    if (this.cardKey() !== key || this.cardHovered || this.tabHoveredKey === key) return;
    const tab = document.getElementById(this.tabDomId(key));
    if (tab?.matches(':focus-visible')) return;
    this.closeCard();
  }

  private closeCard(): void {
    this.clearCardTimer();
    this.cardHovered = false;
    this.cardKey.set(null);
    this.floatingUI.cleanup();
  }

  private clearCardTimer(): void {
    if (this.cardTimer === null) return;
    clearTimeout(this.cardTimer);
    this.cardTimer = null;
  }
}
