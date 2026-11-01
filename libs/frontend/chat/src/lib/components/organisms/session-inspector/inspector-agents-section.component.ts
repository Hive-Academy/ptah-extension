import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  AgentSteerInputComponent,
  agentRunDurationMs,
} from '@ptah-extension/chat-ui';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { ModelStateService, injectWallClock } from '@ptah-extension/core';
import { resolveModelDisplayName } from '@ptah-extension/shared';
import { parseLaneKey } from '../../molecules/compact-session/compact-lane-rows';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import { SessionAgentRosterService } from '../../../services/session-agents/session-agent-roster.service';
import type {
  InspectorAgentRow,
  InspectorAgentsData,
  OrchestratorCardModel,
  SectionState,
} from '../../../services/session-inspector';
import {
  InspectorAgentActionsMenuComponent,
  trayEntryHasAction,
  type AgentTrayAction,
} from './inspector-agent-actions-menu.component';
import {
  agentKindLine,
  agentListRow,
  normalizeAgentKey,
  orderAgentList,
  type AgentListRow,
} from './inspector-agent-list';
import {
  AGENT_ROW_COLUMNS,
  InspectorAgentRowComponent,
} from './inspector-agent-row.component';
import { laneUsage } from './inspector-agent-usage';
import { InspectorRequestLinesComponent } from './inspector-request-panel.component';

/** Rows shown before "Show N more". */
export const AGENTS_VISIBLE_LIMIT = 6;

/** Session input / output token split, for the Orchestrator tokens tooltip. */
export interface SessionTokenSplit {
  readonly input: number;
  readonly output: number;
}

let nextSectionId = 0;

/**
 * AGENTS: one list of every agent of the session (the Orchestrator
 * included) with model, tokens, cost and status. A click (Enter / Space)
 * selects a row and opens its thread; a left border marks the selected row.
 * Requests and steering stay on their row whatever its status.
 *
 * Selection: the host's `selectedAgentKey` (the canvas lane) wins; without
 * one the section keeps its own. `agentSelected` reports a pick (and a
 * normalized key when the host's key left the roster); opening a thread emits
 * `laneRequested` with a lane surface, else focuses the owning tab.
 * Running durations use the shared wall clock only while an agent runs.
 */
@Component({
  selector: 'ptah-inspector-agents-section',
  standalone: true,
  imports: [
    AgentSteerInputComponent,
    InspectorAgentActionsMenuComponent,
    InspectorAgentRowComponent,
    InspectorRequestLinesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let state = agents();
    <section
      class="pb-1.5 pt-3"
      [attr.aria-labelledby]="headingId"
      [attr.aria-busy]="state.status === 'loading' ? 'true' : null"
    >
      <div class="flex items-center justify-between gap-2 px-3">
        <h3
          [id]="headingId"
          class="sec-label text-[10.5px] font-semibold uppercase"
        >
          AGENTS
        </h3>
        @if (state.status !== 'loading') {
          <span
            class="text-[10.5px] tabular-nums text-base-content-muted"
            data-testid="agents-count"
            >{{ runningCount() }} running · {{ list().length }}</span
          >
        }
      </div>
      @if (state.status === 'loading') {
        <ul class="mt-2" aria-hidden="true">
          @for (n of skeletonRows; track n) {
            <li class="flex items-center gap-2 px-3 py-2">
              <span
                class="size-7 shrink-0 rounded-full bg-surface-2 animate-pulse motion-reduce:animate-none"
              ></span>
              <span class="grid flex-1 gap-1.5">
                <span
                  class="h-3 w-24 rounded bg-surface-2 animate-pulse motion-reduce:animate-none"
                ></span>
                <span
                  class="h-2.5 w-16 rounded bg-surface-2 animate-pulse motion-reduce:animate-none"
                ></span>
              </span>
            </li>
          }
        </ul>
      } @else if (list().length === 0) {
        <p class="px-3 py-2 text-xs text-base-content-muted">No agents yet</p>
      } @else {
        <div
          class="mt-2 grid {{
            columns
          }} pb-1 pl-3 pr-8 text-[10.5px] text-base-content-muted"
          aria-hidden="true"
        >
          <span class="pl-8">Agent</span>
          <span class="text-right">Tokens</span>
          <span class="text-right">Cost</span>
          <span class="text-right">Status</span>
        </div>
        <ul [attr.aria-labelledby]="headingId">
          @for (row of visibleRows(); track row.key; let i = $index) {
            @let selected = selectedKey() === row.key;
            <li
              class="st-r relative transition-colors duration-[120ms]"
              [style.--i]="staggerStart() + 1 + i"
              [class.bg-surface-2]="selected"
              [attr.aria-current]="selected ? 'true' : null"
            >
              @if (selected) {
                <span
                  class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-secondary"
                  aria-hidden="true"
                ></span>
              }
              <div class="flex items-center">
                <ptah-inspector-agent-row
                  class="min-w-0 flex-1"
                  [row]="row"
                  (selected)="select(row)"
                />
                <span class="flex w-8 shrink-0 justify-center pr-1">
                  @if (row.tray && row.hasActions) {
                    <ptah-inspector-agent-actions-menu
                      [name]="row.name"
                      [ctx]="row.tray"
                      [open]="menuOpenKey() === row.key"
                      (openChange)="setMenuOpen(row.key, $event)"
                      (action)="onAction(row.key, $event)"
                    />
                  }
                </span>
              </div>
              @if (row.requests.length > 0) {
                <ptah-inspector-request-lines
                  class="mb-2 ml-[52px] mr-3 block"
                  [requests]="row.requests"
                  [ownerName]="row.name"
                  [ownerKindLabel]="kindLabel(row)"
                  [tabId]="tabId()"
                  [hasLaneSurface]="hasLaneSurface()"
                  (answerRequested)="answerRequested.emit($event)"
                  (laneRequested)="laneRequested.emit($event)"
                  (announced)="announced.emit($event)"
                  (focusReleased)="focusRow(row.key)"
                />
              }
              @if (steerOpenKey() === row.key && row.tray) {
                <ptah-agent-steer-input
                  class="mb-2 ml-[52px] mr-3 block"
                  [steerable]="row.tray.entry.steerable"
                  [pending]="pendingSteerId() === row.key"
                  [clearOnSubmit]="false"
                  [placeholder]="'Steer ' + row.name + '...'"
                  (steer)="onSteer(row.key, $event)"
                />
                @if (steerErrorKey() === row.key) {
                  <p
                    role="alert"
                    class="mb-2 ml-[52px] mr-3 text-xs text-state-err"
                  >
                    Could not send your message. Try again.
                  </p>
                }
              }
            </li>
          }
        </ul>
        @if (showAll() || hiddenCount() > 0) {
          <button
            type="button"
            class="mx-3 mt-1 rounded text-xs text-base-content-muted hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            data-testid="agents-show-more"
            [attr.aria-expanded]="showAll()"
            (click)="showAll.set(!showAll())"
          >
            {{ showAll() ? 'Show fewer' : 'Show ' + hiddenCount() + ' more' }}
          </button>
        }
      }
    </section>
  `,
})
export class InspectorAgentsSectionComponent {
  private readonly tray = inject(SessionAgentTrayService);
  private readonly monitor = inject(AgentMonitorStore);
  private readonly roster = inject(SessionAgentRosterService);
  private readonly modelState = inject(ModelStateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tabId = input.required<string>();
  /** Lane key selected by the host (canvas), including finished agents. */
  readonly selectedAgentKey = input<string | null>();
  /** Owning session of the shown tab; scopes the tray contexts. */
  readonly sessionId = input<string | null>(null);
  readonly agents = input.required<SectionState<InspectorAgentsData>>();
  readonly orchestrator = input<OrchestratorCardModel | null>(null);
  /** Session input / output tokens, shown in the Orchestrator tokens tooltip. */
  readonly sessionTokens = input<SessionTokenSplit | null>(null);
  /** A lane surface exists in the host (Rail board), so rows open lanes. */
  readonly hasLaneSurface = input<boolean>(false);
  /** Stagger index of the section; rows continue from it. */
  readonly staggerStart = input<number>(0);

  /** "Open thread" (or a request line) asks the host for an agent's lane. */
  readonly laneRequested = output<string>();
  /** The user picked a row, or the host's key was normalized to the roster. */
  readonly agentSelected = output<string>();
  readonly answerRequested = output<string>();
  readonly announced = output<string>();

  protected readonly limit = AGENTS_VISIBLE_LIMIT;
  protected readonly columns = AGENT_ROW_COLUMNS;
  protected readonly skeletonRows = [0, 1, 2];
  private readonly sectionId = ++nextSectionId;
  protected readonly headingId = `ptah-agents-h-${this.sectionId}`;

  private readonly localSelectedKey = signal<string | null>('orchestrator');
  protected readonly showAll = signal(false);
  protected readonly menuOpenKey = signal<string | null>(null);
  protected readonly steerOpenKey = signal<string | null>(null);
  protected readonly pendingSteerId = signal<string | null>(null);
  protected readonly steerErrorKey = signal<string | null>(null);

  private readonly rows = computed(() => this.agents().data?.rows ?? []);
  private readonly orchestratorAgent = computed(
    () =>
      this.roster
        .roster(this.tabId())
        .find((agent) => agent.kind === 'orchestrator') ?? null,
  );
  private readonly extras = computed(() =>
    this.tray.extrasFor(
      this.sessionId(),
      this.rows().map((row) => row.agent),
    ),
  );
  private readonly hasRunning = computed(
    () =>
      this.orchestratorAgent()?.status === 'running' ||
      this.rows().some((row) => row.agent.status === 'running'),
  );
  private readonly now = injectWallClock('second', () => this.hasRunning());

  protected readonly list = computed((): readonly AgentListRow[] => {
    const now = this.hasRunning() ? this.now() : Date.now();
    return orderAgentList(
      this.orchestratorRow(),
      this.rows().map((row) => this.laneRow(row, now)),
    );
  });

  protected readonly runningCount = computed(
    () => this.list().filter((row) => row.agent.status === 'running').length,
  );

  protected readonly selectedKey = computed(() => {
    const host = this.selectedAgentKey();
    const key = host === undefined ? this.localSelectedKey() : host;
    return key === null
      ? null
      : normalizeAgentKey(
          key,
          this.list().map((row) => row.key),
        );
  });

  /** First rows, plus the selected one when it sits below the fold. */
  protected readonly visibleRows = computed(() => {
    const rows = this.list();
    if (this.showAll() || rows.length <= AGENTS_VISIBLE_LIMIT) return rows;
    const head = rows.slice(0, AGENTS_VISIBLE_LIMIT);
    const selected = rows.find((row) => row.key === this.selectedKey());
    return selected && !head.includes(selected) ? [...head, selected] : head;
  });

  protected readonly hiddenCount = computed(
    () => this.list().length - this.visibleRows().length,
  );

  constructor() {
    // A host key that left the roster (lane gone, sub-agent moved to the
    // background) is reported back in its roster form.
    effect(() => {
      const host = this.selectedAgentKey();
      if (typeof host !== 'string' || this.agents().status !== 'ready') return;
      const normalized = this.selectedKey();
      if (normalized !== null && normalized !== host) {
        untracked(() => this.agentSelected.emit(normalized));
      }
    });
  }

  private canOpen(row: AgentListRow): boolean {
    if (this.hasLaneSurface()) return true;
    return row.agent.kind !== 'orchestrator' && row.tray !== null;
  }

  protected kindLabel(row: AgentListRow): string {
    return agentKindLine(row.agent);
  }

  /** Select the row and open its thread when it has one. */
  protected select(row: AgentListRow): void {
    if (this.selectedKey() !== row.key) {
      this.localSelectedKey.set(row.key);
      this.agentSelected.emit(row.key);
    }
    if (this.canOpen(row)) this.openThread(row);
  }

  private openThread(row: AgentListRow): void {
    if (this.hasLaneSurface()) {
      this.laneRequested.emit(row.key);
      return;
    }
    const ctx = this.contextOf(row.key);
    if (ctx) this.tray.focus(ctx);
  }

  protected setMenuOpen(key: string, open: boolean): void {
    if (open) this.menuOpenKey.set(key);
    else if (this.menuOpenKey() === key) this.menuOpenKey.set(null);
  }

  protected onAction(key: string, action: AgentTrayAction): void {
    const ctx = this.contextOf(key);
    if (!ctx) return;
    switch (action) {
      case 'steer':
        this.steerErrorKey.set(null);
        this.steerOpenKey.set(key);
        break;
      case 'background':
        this.tray.sendToBackground(ctx);
        break;
      case 'stop':
        this.tray.stop(ctx);
        break;
    }
  }

  protected async onSteer(key: string, text: string): Promise<void> {
    const ctx = this.contextOf(key);
    if (!ctx) return;
    this.steerErrorKey.set(null);
    this.pendingSteerId.set(key);
    try {
      const sent = await this.tray.steer(ctx, text);
      if (this.steerOpenKey() !== key) return;
      if (sent) this.steerOpenKey.set(null);
      else this.steerErrorKey.set(key);
    } finally {
      this.pendingSteerId.set(null);
    }
  }

  /** Return focus to a row's button (a closed request panel left none). */
  protected focusRow(key: string): void {
    const buttons =
      this.host.nativeElement.querySelectorAll<HTMLElement>('[data-agent-key]');
    for (const button of Array.from(buttons)) {
      if (button.dataset['agentKey'] === key) {
        button.focus();
        return;
      }
    }
  }

  /** The CURRENT tray context of a row; `null` once the agent vanished. */
  private contextOf(key: string): TrayAgentContext | null {
    return this.extras().get(key)?.tray ?? null;
  }

  private orchestratorRow(): AgentListRow | null {
    const agent = this.orchestratorAgent();
    if (!agent) return null;
    const card = this.orchestrator();
    const split = this.sessionTokens();
    const modelRaw = card?.model ?? null;
    return agentListRow({
      agent,
      secondary: modelRaw
        ? resolveModelDisplayName(modelRaw, this.modelState.availableModels())
        : agentKindLine(agent),
      secondaryTitle: modelRaw,
      usage: {
        tokens: card?.tokens ?? null,
        tokensPartial: false,
        cost: card?.cost ?? null,
        costPartial: false,
        costEstimated: false,
        input: split?.input ?? null,
        output: split?.output ?? null,
      },
      durationMs: null,
      requests: [],
      tray: null,
      hasActions: false,
    });
  }

  private laneRow(row: InspectorAgentRow, now: number): AgentListRow {
    const agent = row.agent;
    const lane = parseLaneKey(agent.key);
    const extra = this.extras().get(agent.key);
    const tray = extra?.tray ?? null;
    const { usage, modelRaw } = laneUsage(
      agent,
      {
        // A sub-agent sent to the background keeps its monitor record.
        subagent:
          lane?.kind === 'subagent' || lane?.kind === 'background'
            ? (this.monitor.subagents().get(lane.id) ?? null)
            : null,
        cli:
          lane?.kind === 'cli'
            ? (this.monitor.agents().find((item) => item.agentId === lane.id) ??
              null)
            : null,
        trayTokens: extra?.tokens ?? null,
        trayModel: extra?.model ?? null,
      },
      now,
    );
    return agentListRow({
      agent,
      secondary: modelRaw
        ? resolveModelDisplayName(modelRaw, this.modelState.availableModels())
        : agentKindLine(agent),
      secondaryTitle: modelRaw ? `${agentKindLine(agent)} · ${modelRaw}` : null,
      usage,
      durationMs: agentRunDurationMs(
        {
          running: agent.status === 'running',
          startedAt: agent.startedAt,
          endedAt: agent.endedAt,
          reportedMs: tray?.entry.durationMs,
        },
        now,
      ),
      requests: row.requests,
      tray,
      hasActions: tray !== null && trayEntryHasAction(tray.entry),
    });
  }
}
