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
import { laneKey } from '@ptah-extension/chat';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
} from '@ptah-extension/chat-streaming';
import { ownedBySession } from './lane-owner';

interface LaneTab {
  readonly key: string;
  readonly label: string;
  readonly status: string;
}
interface LaneGroup {
  readonly label: string;
  readonly tabs: readonly LaneTab[];
}

@Component({
  selector: 'ptah-canvas-lane-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #strip
      role="tablist"
      aria-label="Lanes"
      class="relative flex items-center gap-0.5 overflow-x-auto px-2 bg-base-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      (scroll)="updateEdges()"
      [style.mask-image]="edgeMask()"
    >
      @for (group of groups(); track group.label) {
        @if (group.label !== 'Orchestrator') {
          <span
            role="presentation"
            class="self-center px-2 text-[10px] font-semibold uppercase tracking-wider text-base-content-muted whitespace-nowrap"
            >{{ group.label }}</span
          >
        }
        @for (tab of group.tabs; track tab.key) {
          <button
            type="button"
            role="tab"
            [id]="tabId(tab.key)"
            class="inline-flex items-center gap-1.5 h-9 px-2.5 border-b-2 whitespace-nowrap text-xs hover:text-base-content"
            [class.border-primary]="selectedKey() === tab.key"
            [class.border-transparent]="selectedKey() !== tab.key"
            [class.text-base-content]="selectedKey() === tab.key"
            [class.text-base-content-muted]="selectedKey() !== tab.key"
            [attr.aria-selected]="selectedKey() === tab.key"
            [attr.aria-controls]="panelId()"
            [tabIndex]="selectedKey() === tab.key ? 0 : -1"
            [attr.title]="tab.status"
            (click)="laneSelected.emit(tab.key)"
            (keydown)="onKeydown($event, tab.key)"
          >
            {{ tab.label
            }}<span
              class="w-1.5 h-1.5 rounded-full bg-current"
              aria-hidden="true"
            ></span>
          </button>
        }
      }
    </div>
  `,
})
export class CanvasLaneTabsComponent {
  private readonly monitor = inject(AgentMonitorStore);
  private readonly background = inject(BackgroundAgentStore);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly strip = viewChild.required<ElementRef<HTMLElement>>('strip');
  private readonly cutLeft = signal(false);
  private readonly cutRight = signal(false);
  readonly edgeMask = computed(
    () =>
      `linear-gradient(to right, ${this.cutLeft() ? 'transparent' : 'black'} 0, black 32px, black calc(100% - 32px), ${this.cutRight() ? 'transparent' : 'black'} 100%)`,
  );
  readonly sessionId = input<string | null>(null);
  readonly panelId = input('canvas-lane-panel');
  readonly laneKey = input('orchestrator');
  readonly laneSelected = output<string>();
  readonly groups = computed<readonly LaneGroup[]>(() => {
    const sessionId = this.sessionId();
    const subagents = ownedBySession(
      [...this.monitor.subagents().values()],
      sessionId,
      (a) => a.parentSessionId,
    );
    const cli = ownedBySession(
      this.monitor.agents(),
      sessionId,
      (a) => a.parentSessionId,
    );
    const background = ownedBySession(
      this.background.agents(),
      sessionId,
      (a) => a.sessionId,
    );
    return [
      {
        label: 'Orchestrator',
        tabs: [
          { key: 'orchestrator', label: 'Orchestrator', status: 'running' },
        ],
      },
      {
        label: 'Sub-agents',
        tabs: subagents
          .filter((a) => a.status !== 'background')
          .map((a) => ({
            key: laneKey('subagent', a.parentToolUseId),
            label:
              a.teammateName || a.agentType || a.description || 'Sub-agent',
            status: a.status,
          })),
      },
      {
        label: 'CLI lanes',
        tabs: cli.map((a) => ({
          key: laneKey('cli', a.agentId),
          label: a.cli,
          status: a.status,
        })),
      },
      {
        label: 'Background',
        tabs: [
          ...subagents
            .filter((a) => a.status === 'background')
            .map((a) => ({
              key: laneKey('background', a.parentToolUseId),
              label: a.teammateName || a.agentType || 'Background agent',
              status: a.status,
            })),
          ...background
            .filter(
              (a) => !subagents.some((s) => s.parentToolUseId === a.toolCallId),
            )
            .map((a) => ({
              key: laneKey('background', a.toolCallId),
              label: a.teammateName || a.agentType || 'Background agent',
              status: a.status,
            })),
        ],
      },
    ].filter((g) => g.tabs.length > 0);
  });
  readonly selectedKey = computed(() => {
    const key = this.laneKey();
    const keys = this.groups().flatMap((group) => group.tabs.map((tab) => tab.key));
    if (keys.includes(key)) return key;
    const backgroundKey = key.startsWith('sub:') ? `bg:${key.slice(4)}` : null;
    return backgroundKey && keys.includes(backgroundKey) ? backgroundKey : 'orchestrator';
  });

  constructor() {
    effect(() => {
      if (this.laneKey() !== this.selectedKey())
        this.laneSelected.emit(this.selectedKey());
    });
    effect(() => {
      this.selectedKey();
      this.groups();
      this.revealSelected();
    });
    afterNextRender(() => {
      this.updateEdges();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        this.updateEdges();
        this.revealSelected();
      });
      observer.observe(this.strip().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  updateEdges(): void {
    const strip = this.strip().nativeElement;
    this.cutLeft.set(strip.scrollLeft > 0);
    this.cutRight.set(
      strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
    );
  }

  private revealSelected(): void {
    afterNextRender(
      () => {
        const selected = this.strip().nativeElement.querySelector<HTMLElement>(
          '[role="tab"][aria-selected="true"]',
        );
        selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        this.updateEdges();
      },
      { injector: this.injector },
    );
  }

  onKeydown(event: KeyboardEvent, key: string): void {
    const keys = this.groups().flatMap((group) =>
      group.tabs.map((tab) => tab.key),
    );
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
    this.laneSelected.emit(keys[next]);
    const tabs = (event.currentTarget as HTMLElement)
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs?.[next]?.focus();
  }

  tabId(key: string): string {
    return `${this.panelId()}-tab-${key}`;
  }
}
