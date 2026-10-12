import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
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
      role="tablist"
      aria-label="Lanes"
      class="flex items-center gap-0.5 overflow-x-auto px-2 bg-base-200"
    >
      @for (group of groups(); track group.label) {
        @if (group.label !== 'Orchestrator') {
          <span
            role="presentation"
            class="self-center px-2 text-[10px] font-semibold uppercase tracking-wider text-base-content/60 whitespace-nowrap"
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
            [class.text-base-content/60]="selectedKey() !== tab.key"
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
  readonly selectedKey = computed(() =>
    this.groups().some((g) => g.tabs.some((t) => t.key === this.laneKey()))
      ? this.laneKey()
      : 'orchestrator',
  );

  constructor() {
    effect(() => {
      if (this.laneKey() !== this.selectedKey())
        this.laneSelected.emit('orchestrator');
    });
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
