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
} from '@angular/core';
import {
  AGENT_KIND_LABEL,
  AgentAvatarComponent,
  AgentSteerInputComponent,
  TokenBadgeComponent,
  agentAccessibleLabel,
  backgroundAgentPopulation,
  formatAgentDuration,
  agentRunDurationMs,
  formatTokenCount,
  type AgentStatusWord,
} from '@ptah-extension/chat-ui';
import { ModelStateService } from '@ptah-extension/core';
import { resolveModelDisplayName } from '@ptah-extension/shared';
import { Bot, LucideAngularModule } from 'lucide-angular';
import {
  formatEstimatedCost,
  usageTotalsFromSegments,
} from '../../molecules/agent-card/stats-bar.utils';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import type {
  InspectorAgentRow,
  InspectorAgentsData,
  InspectorRequest,
  SectionState,
} from '../../../services/session-inspector';
import {
  InspectorAgentActionsMenuComponent,
  trayEntryHasAction,
  type AgentTrayAction,
} from './inspector-agent-actions-menu.component';
import { InspectorRequestLinesComponent } from './inspector-request-panel.component';

const TICK_MS = 1000;

const STATUS_INK: Readonly<Record<AgentStatusWord, string>> = {
  running: 'text-state-run',
  waiting: 'text-state-need',
  queued: 'text-base-content-muted',
  done: 'text-state-done',
  failed: 'text-state-err',
  stopped: 'text-base-content-muted',
};

interface AgentRowView {
  readonly key: string;
  readonly row: InspectorAgentRow;
  readonly name: string;
  readonly kindLabel: string;
  readonly statusInk: string;
  readonly duration: string | null;
  readonly ariaLabel: string;
  readonly modelName: string | null;
  readonly modelRaw: string | null;
  readonly tokens: string | null;
  readonly cliTokens: number | null;
  readonly cliCost: number | null;
  readonly cliUsagePartial: boolean;
  readonly tray: TrayAgentContext | null;
  readonly hasActions: boolean;
  readonly requests: readonly InspectorRequest[];
}

let nextSectionId = 0;

/**
 * The inspector AGENTS section (design 4.2, amended by D3.6): one row per
 * roster agent with avatar, status and duration, the background-agent tray
 * folded in (population line, model, tokens, actions menu, steer), and the
 * row's request lines.
 *
 * Row activation: with a lane surface it requests the lane; else, with a tray
 * context, it focuses the owning tab (today's tray Focus); else it only
 * selects. Every tray action re-reads the context first, so an action on an
 * agent that vanished meanwhile does nothing. Durations tick through ONE
 * section-level interval that runs only while a running row is shown.
 */
@Component({
  selector: 'ptah-inspector-agents-section',
  standalone: true,
  imports: [
    LucideAngularModule,
    AgentAvatarComponent,
    AgentSteerInputComponent,
    TokenBadgeComponent,
    InspectorAgentActionsMenuComponent,
    InspectorRequestLinesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let state = agents();
    <section
      class="pb-1.5 pt-2"
      [attr.aria-labelledby]="headingId"
      [attr.aria-busy]="state.status === 'loading' ? 'true' : null"
    >
      <div class="flex items-center justify-between gap-2 px-4">
        <h3
          [id]="headingId"
          class="sec-label text-[10.5px] font-semibold uppercase"
        >
          AGENTS
        </h3>
        @if (state.status !== 'loading') {
          <span class="text-[11px] tabular-nums text-base-content-muted">{{
            meta()
          }}</span>
        }
      </div>
      @if (population(); as summary) {
        <p class="mt-1 px-4 text-[11px] text-base-content-muted">
          {{ summary }}
        </p>
      }

      @if (state.status === 'loading') {
        <ul class="mt-2" aria-hidden="true">
          @for (n of skeletonRows; track n) {
            <li class="flex items-center gap-[13px] py-[11px] pl-[17px] pr-4">
              <span
                class="size-8 shrink-0 rounded-full bg-surface-2 animate-pulse motion-reduce:animate-none"
              ></span>
              <span class="grid flex-1 gap-1.5">
                <span
                  class="h-3 w-32 rounded bg-surface-2 animate-pulse motion-reduce:animate-none"
                ></span>
                <span
                  class="h-2.5 w-48 rounded bg-surface-2 animate-pulse motion-reduce:animate-none"
                ></span>
              </span>
            </li>
          }
        </ul>
      } @else if (views().length === 0) {
        <div class="flex flex-col items-center px-4 py-[18px] text-center">
          <span
            class="flex size-8 items-center justify-center rounded-lg bg-surface-2"
            aria-hidden="true"
          >
            <lucide-angular
              [img]="BotIcon"
              class="size-4 text-base-content-muted"
            />
          </span>
          <p class="mt-2 text-[13px] font-semibold">No agents yet</p>
          <p class="mt-1 text-xs text-base-content-muted">
            Sub-agents, CLI lanes and background commands appear here while the
            orchestrator delegates.
          </p>
        </div>
      } @else {
        <ul class="mt-1.5 max-h-[260px] overflow-y-auto overscroll-contain">
          @for (view of views(); track view.key; let i = $index) {
            <li
              class="st-r relative transition-colors duration-[120ms]"
              [style.--i]="staggerStart() + 1 + i"
              [class.bg-surface-2]="selectedKey() === view.key"
              [attr.aria-current]="selectedKey() === view.key ? 'true' : null"
            >
              @if (selectedKey() === view.key) {
                <span
                  class="absolute inset-y-2 left-0 w-0.5 rounded-full bg-secondary"
                  aria-hidden="true"
                ></span>
              }
              <div class="flex items-start">
                <button
                  type="button"
                  class="agent__main flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left hover:bg-base-content/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
                  [attr.data-agent-key]="view.key"
                  [attr.aria-label]="view.ariaLabel"
                  [attr.aria-describedby]="
                    view.modelRaw ? modelDescId(i) : null
                  "
                  (click)="activate(view)"
                >
                  <ptah-agent-avatar
                    [kind]="view.row.agent.kind"
                    [status]="view.row.agent.status"
                    [cliId]="view.row.agent.cliId"
                    [agentType]="view.row.agent.agentType"
                    [size]="28"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-baseline gap-2">
                      <span
                        class="min-w-0 truncate text-xs font-semibold"
                        >{{ view.name }}</span
                      >
                      <span
                        class="ml-auto flex shrink-0 items-baseline gap-1 text-[10px]"
                      >
                        @if (view.row.agent.status; as status) {
                          <span [class]="'font-medium ' + view.statusInk">{{
                            status
                          }}</span>
                        }
                        @if (view.duration && view.row.agent.kind !== 'cli') {
                          <span class="tabular-nums text-base-content-muted"
                            >· {{ view.duration }}</span
                          >
                        }
                      </span>
                    </span>
                    <span
                      class="mt-1 flex min-w-0 items-center gap-1 text-[10px] text-base-content-muted"
                    >
                      <span
                        class="h-auto shrink-0 rounded border border-surface-border bg-surface-3 px-[5px] py-[3px] text-[10px] font-medium leading-none text-base-content-muted"
                        >{{ view.kindLabel }}</span
                      >
                      @if (view.modelName) {
                        <span
                          class="shrink-0 font-medium"
                          [attr.title]="view.modelRaw"
                          >{{ view.modelName }}</span
                        >
                      }
                      @if (view.row.agent.activity) {
                        <span class="min-w-0 truncate">{{
                          view.row.agent.activity
                        }}</span>
                      }
                      @if (view.tokens && view.row.agent.kind !== 'cli') {
                        <span class="shrink-0 tabular-nums"
                          >· {{ view.tokens }} tokens</span
                        >
                      }
                    </span>
                    @if (view.row.agent.kind === 'cli') {
                      <span
                        class="mt-1 flex flex-wrap items-center gap-1.5 [&_span]:whitespace-nowrap"
                      >
                        @if (view.cliTokens !== null) {
                          @if (view.cliUsagePartial) {
                            <span
                              class="badge badge-outline badge-sm cursor-help"
                              title="From retained output, may be partial"
                              [attr.aria-label]="
                                'at least ' +
                                formatTokenCount(view.cliTokens) +
                                ' tokens'
                              "
                              >≥
                              {{
                                formatTokenCount(view.cliTokens)
                              }}
                              tokens</span
                            >
                          } @else {
                            <ptah-token-badge [tokens]="view.cliTokens" />
                          }
                        }
                        @if (view.cliCost !== null) {
                          <span
                            class="badge badge-sm badge-ghost text-base-content-muted tabular-nums"
                            [attr.title]="
                              view.cliUsagePartial
                                ? 'From retained output, may be partial'
                                : 'Reported or estimated cost'
                            "
                            [attr.aria-label]="
                              view.cliUsagePartial
                                ? 'at least ' +
                                  formatEstimatedCost(view.cliCost)
                                : null
                            "
                            >{{ view.cliUsagePartial ? '≥ ' : ''
                            }}{{ formatEstimatedCost(view.cliCost) }}</span
                          >
                        }
                        @if (view.duration) {
                          <span
                            class="badge badge-sm badge-ghost text-base-content-muted tabular-nums"
                            title="Elapsed duration"
                            >{{ view.duration }}</span
                          >
                        }
                      </span>
                    }
                  </span>
                </button>
                @if (view.tray && view.hasActions) {
                  <ptah-inspector-agent-actions-menu
                    class="mr-3 mt-[13px]"
                    [name]="view.name"
                    [ctx]="view.tray"
                    [open]="menuOpenKey() === view.key"
                    (openChange)="setMenuOpen(view.key, $event)"
                    (action)="onAction(view.key, $event)"
                  />
                }
              </div>
              @if (view.modelRaw) {
                <span hidden [id]="modelDescId(i)"
                  >Model {{ view.modelName }}, id {{ view.modelRaw }}</span
                >
              }
              @if (view.requests.length > 0) {
                <ptah-inspector-request-lines
                  class="-mt-[5px] mb-2.5 ml-[62px] mr-4"
                  [requests]="view.requests"
                  [ownerName]="view.name"
                  [ownerKindLabel]="view.kindLabel"
                  [tabId]="tabId()"
                  [hasLaneSurface]="hasLaneSurface()"
                  (answerRequested)="answerRequested.emit($event)"
                  (laneRequested)="laneRequested.emit($event)"
                  (announced)="announced.emit($event)"
                  (focusReleased)="focusRow(view.key)"
                />
              }
              @if (steerOpenKey() === view.key && view.tray) {
                <ptah-agent-steer-input
                  class="mb-2 ml-[62px] mr-4 block"
                  [steerable]="view.tray.entry.steerable"
                  [pending]="pendingSteerId() === view.key"
                  [clearOnSubmit]="false"
                  [placeholder]="'Steer ' + view.name + '...'"
                  (steer)="onSteer(view.key, $event)"
                />
                @if (steerErrorKey() === view.key) {
                  <p
                    role="alert"
                    class="mb-2 ml-[62px] mr-4 text-xs text-state-err"
                  >
                    Could not send your message. Try again.
                  </p>
                }
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class InspectorAgentsSectionComponent {
  private readonly tray = inject(SessionAgentTrayService);
  private readonly modelState = inject(ModelStateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tabId = input.required<string>();
  /** Owning session of the shown tab; scopes the tray contexts. */
  readonly sessionId = input<string | null>(null);
  readonly agents = input.required<SectionState<InspectorAgentsData>>();
  /** A lane surface exists in the host (Rail board), so rows open lanes. */
  readonly hasLaneSurface = input<boolean>(false);
  /** Stagger index of the section; rows continue from it. */
  readonly staggerStart = input<number>(0);

  readonly laneRequested = output<string>();
  readonly answerRequested = output<string>();
  readonly announced = output<string>();

  protected readonly BotIcon = Bot;
  protected readonly formatEstimatedCost = formatEstimatedCost;
  protected readonly formatTokenCount = formatTokenCount;
  protected readonly skeletonRows = [0, 1, 2];
  private readonly sectionId = ++nextSectionId;
  protected readonly headingId = `ptah-agents-h-${this.sectionId}`;

  protected readonly selectedKey = signal<string | null>(null);
  protected readonly menuOpenKey = signal<string | null>(null);
  protected readonly steerOpenKey = signal<string | null>(null);
  protected readonly pendingSteerId = signal<string | null>(null);
  protected readonly steerErrorKey = signal<string | null>(null);
  private readonly now = signal(Date.now());

  private readonly rows = computed(() => this.agents().data?.rows ?? []);
  private readonly roster = computed(() => this.rows().map((row) => row.agent));

  private readonly extras = computed(() =>
    this.tray.extrasFor(this.sessionId(), this.roster()),
  );

  protected readonly population = computed(() =>
    backgroundAgentPopulation(
      [...this.tray.contextsFor(this.sessionId()).values()].map(
        (ctx) => ctx.entry,
      ),
    ),
  );

  protected readonly meta = computed(() => {
    const data = this.agents().data;
    if (!data || data.rows.length === 0) return 'none yet';
    return `${data.active} active · ${data.finished} finished`;
  });

  private readonly hasRunning = computed(() =>
    this.rows().some((row) => row.agent.status === 'running'),
  );

  protected readonly views = computed((): readonly AgentRowView[] => {
    const extras = this.extras();
    const models = this.modelState.availableModels();
    const now = this.hasRunning() ? this.now() : Date.now();
    return this.rows().map((row): AgentRowView => {
      const agent = row.agent;
      const extra = extras.get(agent.key);
      const tray = extra?.tray ?? null;
      const durationMs = agentRunDurationMs(
        {
          running: agent.status === 'running',
          startedAt: agent.startedAt,
          endedAt: agent.endedAt,
          reportedMs: tray?.entry.durationMs,
        },
        now,
      );
      const modelRaw = extra?.model ?? null;
      const tokens = extra?.tokens ?? null;
      const fallbackUsage =
        agent.usageTotals == null
          ? usageTotalsFromSegments(agent.segments ?? [])
          : null;
      const usage = agent.usageTotals ?? fallbackUsage;
      const cliTokenTotal =
        typeof usage?.totalTokens === 'number'
          ? usage.totalTokens
          : typeof usage?.inputTokens === 'number' &&
              typeof usage?.outputTokens === 'number'
            ? usage.inputTokens + usage.outputTokens
            : null;
      const duration =
        durationMs === null ? null : formatAgentDuration(durationMs);
      const label = agentAccessibleLabel({
        name: agent.name,
        kind: agent.kind,
        status: agent.status,
        durationMs,
      });
      return {
        key: agent.key,
        row,
        name: agent.name,
        kindLabel: AGENT_KIND_LABEL[agent.kind],
        statusInk: agent.status ? STATUS_INK[agent.status] : '',
        duration,
        ariaLabel: agent.activity ? `${label}. ${agent.activity}` : label,
        modelName: modelRaw ? resolveModelDisplayName(modelRaw, models) : null,
        modelRaw,
        tokens:
          tokens !== null && Number.isFinite(tokens) && tokens > 0
            ? formatTokenCount(tokens)
            : null,
        cliTokens:
          cliTokenTotal !== null &&
          Number.isFinite(cliTokenTotal) &&
          cliTokenTotal > 0
            ? cliTokenTotal
            : null,
        cliCost: usage?.costUsd ?? null,
        cliUsagePartial: fallbackUsage?.partial === true,
        tray,
        hasActions: tray !== null && trayEntryHasAction(tray.entry),
        requests: row.requests,
      };
    });
  });

  constructor() {
    // One section-level tick, alive only while a running row is shown.
    effect((onCleanup) => {
      if (!this.hasRunning()) return;
      const timer = setInterval(() => this.now.set(Date.now()), TICK_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  protected modelDescId(index: number): string {
    return `ptah-agents-${this.sectionId}-model-${index}`;
  }

  protected activate(view: AgentRowView): void {
    this.selectedKey.set(view.key);
    if (this.hasLaneSurface()) {
      this.laneRequested.emit(view.key);
      return;
    }
    const ctx = this.contextOf(view.key);
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

  /** Return focus to a row's main button (a closed request panel left none). */
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
}
