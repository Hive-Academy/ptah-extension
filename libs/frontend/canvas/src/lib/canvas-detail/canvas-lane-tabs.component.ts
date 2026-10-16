import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
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
}

/**
 * Main-view agent dock. Same selector and tablist keyboard model as the lane
 * strip it replaced: one pill for the selected agent, avatar chips for the
 * rest, and an overflow menu for whoever does not fit.
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
  host: { '(document:keydown.escape)': 'onDocumentEscape($event)' },
  template: `
    @let view = layout();
    <!-- Keep the dock at z-10 below the header menu (z-20); its card and dropdown share this stacking context. -->
    <div
      #dock
      role="tablist"
      aria-label="Lanes"
      class="relative z-10 flex min-w-0 items-center gap-0.5 overflow-x-clip border-b border-surface-border bg-surface-1 px-2 pb-1 shadow-[0_6px_8px_-6px_rgb(0_0_0/0.45)]"
    >
      @for (group of view.groups; track group.kind; let first = $first) {
        @if (!first) {
          <span
            class="mx-1 h-5 w-px shrink-0 self-center bg-[var(--surface-border-strong)]"
            aria-hidden="true"
            data-testid="dock-divider"
          ></span>
        }
        @for (chip of group.chips; track chip.key) {
          @if (chip.selected) {
            <button
              type="button"
              role="tab"
              [id]="chip.tabDomId"
              class="inline-flex h-[38px] max-w-[180px] shrink-0 items-center gap-1.5 rounded-full border border-secondary px-1.5 text-xs text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
              [attr.aria-selected]="true"
              [attr.aria-controls]="panelId()"
              [attr.aria-label]="chip.label"
              [attr.aria-describedby]="cardKey() === chip.key ? view.cardId : null"
              [tabIndex]="0"
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
                [size]="28"
                [cliId]="chip.agent.cliId"
                [agentType]="chip.agent.agentType"
              />
              <span class="min-w-0 truncate">{{ chip.agent.name }}</span>
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
              class="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
              [attr.aria-selected]="false"
              [attr.aria-controls]="panelId()"
              [attr.aria-label]="chip.label"
              [attr.aria-describedby]="cardKey() === chip.key ? view.cardId : null"
              [tabIndex]="-1"
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
                [size]="28"
                [cliId]="chip.agent.cliId"
                [agentType]="chip.agent.agentType"
              />
            </button>
          }
        }
      }
      <ptah-agent-dock-menu
        [agents]="agents()"
        [hidden]="view.hidden"
        [selectedKey]="selectedKey()"
        [compact]="view.compact"
        [now]="now()"
        (agentSelect)="onMenuSelect($event)"
      />
      @if (cardAgent(); as agent) {
        <ptah-agent-dock-card
          [agent]="agent"
          [durationText]="cardDuration()"
          [cardId]="view.cardId"
          (hovered)="onCardHovered($event)"
        />
      }
    </div>
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

  /** Measured dock width. `Infinity` until a ResizeObserver reports one. */
  private readonly width = signal(Number.POSITIVE_INFINITY);
  protected readonly now = signal(Date.now());
  /** Agent whose hover / focus card is open, if any. */
  protected readonly cardKey = signal<string | null>(null);
  private cardTimer: ReturnType<typeof setTimeout> | null = null;
  private cardHovered = false;
  private tabHoveredKey: string | null = null;

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

  protected readonly layout = computed((): DockLayout => {
    const now = this.now();
    const selected = this.selectedKey();
    const panelId = this.panelId();
    const width = this.width();
    const { visible, hidden } = planDockOverflow(
      this.agents(),
      selected,
      dockCapacity(width),
    );
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
        tabDomId: `${panelId}-tab-${agent.key}`,
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
      cardId: `${panelId}-agent-card`,
    };
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
    this.laneSelected.emit(key);
  }

  protected onMenuSelect(key: string): void {
    this.laneSelected.emit(key);
    this.focusTab(key);
  }

  protected onKeydown(event: KeyboardEvent, key: string): void {
    const keys = this.layout().groups.flatMap((group) =>
      group.chips.map((chip) => chip.key),
    );
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
    this.laneSelected.emit(nextKey);
    this.focusTab(nextKey);
  }

  protected onPointerEnter(event: PointerEvent, key: string): void {
    if (event.pointerType === 'touch') return;
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
    this.queueCardClose(key);
  }

  protected onTabFocus(event: FocusEvent, key: string): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
    this.clearCardTimer();
    this.openCard(key);
  }

  protected onTabBlur(key: string): void {
    this.queueCardClose(key);
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
      },
      { injector: this.injector },
    );
  }

  private tabDomId(key: string): string {
    return `${this.panelId()}-tab-${key}`;
  }

  private openCard(key: string): void {
    this.cardKey.set(key);
    afterNextRender(
      () => {
        const tab = document.getElementById(this.tabDomId(key));
        const card = document.getElementById(`${this.panelId()}-agent-card`);
        if (!tab || !card) return;
        const boundary = this.dock().nativeElement.closest<HTMLElement>('[data-pane-side]');
        void this.floatingUI.position(tab, card, {
          placement: 'bottom-start',
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
    if (tab?.matches(':focus')) return;
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
