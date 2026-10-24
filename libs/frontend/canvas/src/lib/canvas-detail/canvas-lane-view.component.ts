import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import {
  AgentCardComponent,
  AgentContinueInputComponent,
  AgentPermissionResponder,
  ChatSessionLayoutComponent,
  ChatStore,
  LANE_COLUMN_CLASS,
  SubagentLaneComponent,
  ownedBySession,
  parseLaneKey,
} from '@ptah-extension/chat';
import {
  BackgroundAgentStore,
  AgentMonitorStore,
} from '@ptah-extension/chat-streaming';
import { NgTemplateOutlet } from '@angular/common';
import { BackgroundAgentStripComponent } from '@ptah-extension/chat-ui';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';
import { CanvasDetailService } from './canvas-detail.service';

/** Resolve the displayed lane, including a stored lane whose agent has gone away. */
export function effectiveCanvasLaneKind(
  laneKey: string,
  sessionId: string | null,
  monitor: AgentMonitorStore,
  background: BackgroundAgentStore,
): 'orchestrator' | 'cli' | 'subagent' | 'background' {
  const parsed = parseLaneKey(laneKey);
  if (!parsed) return 'orchestrator';
  if (parsed.kind === 'cli') {
    return ownedBySession(
      monitor.agents(),
      sessionId,
      (agent) => agent.parentSessionId,
    ).some((agent) => agent.agentId === parsed.id)
      ? 'cli'
      : 'orchestrator';
  }
  const subagentExists = ownedBySession(
    [...monitor.subagents().values()],
    sessionId,
    (agent) => agent.parentSessionId,
  ).some((agent) => agent.parentToolUseId === parsed.id);
  if (parsed.kind === 'subagent')
    return subagentExists ? 'subagent' : 'orchestrator';
  if (parsed.kind === 'background') {
    const backgroundExists = ownedBySession(
      background.agents(),
      sessionId,
      (agent) => agent.sessionId,
    ).some((agent) => agent.toolCallId === parsed.id);
    return subagentExists || backgroundExists ? 'background' : 'orchestrator';
  }
  return 'orchestrator';
}

/**
 * A lane's panel: the main chat view's chrome surface, and the size container
 * that `LANE_COLUMN_CLASS` and the lane transcript measure their column from.
 */
const LANE_PANEL_CLASS =
  'relative flex h-full min-h-0 min-w-0 flex-col pt-2 [container-type:inline-size]';

@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  imports: [
    ChatSessionLayoutComponent,
    AgentCardComponent,
    AgentContinueInputComponent,
    SubagentLaneComponent,
    BackgroundAgentStripComponent,
    CanvasDetailTranscriptComponent,
    NgTemplateOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full min-h-0',
    '[class.overflow-hidden]': "selectedKind() === 'orchestrator'",
    '[class.overflow-auto]': "selectedKind() !== 'orchestrator'",
    '(keydown.escape)': 'onEscape($event)',
  },
  styles: [
    `
      @keyframes rail-lane-enter {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .rail-lane-enter {
          animation: rail-lane-enter 180ms var(--ptah-ease-soft);
        }
      }
    `,
  ],
  template: `
    <div
      [id]="panelId()"
      role="tabpanel"
      tabindex="-1"
      [attr.aria-labelledby]="panelId() + '-tab-' + laneKey()"
      class="h-full min-h-0"
      [class.flex]="selectedKind() === 'orchestrator'"
      [class.flex-col]="selectedKind() === 'orchestrator'"
    >
      <div
        [class.hidden]="selectedKind() !== 'orchestrator'"
        class="min-h-0 flex-1"
      >
        <ptah-canvas-detail-transcript
          [tabId]="tabId()"
          [visible]="selectedKind() === 'orchestrator'"
          [paneFocused]="paneFocused()"
          [splitDisplayed]="splitDisplayed()"
        />
      </div>
      @for (block of laneBlocks(); track block.key) {
        <!-- Hidden for the orchestrator: an empty full-height block would take the transcript's height. -->
        <div
          class="rail-lane-enter h-full min-h-0 flex-col"
          [class.flex]="selectedKind() !== 'orchestrator'"
          [class.hidden]="selectedKind() === 'orchestrator'"
        >
          @switch (selectedKind()) {
            @case ('cli') {
              @if (selectedCli(); as agent) {
                <!-- The main chat shell: the chrome panel, the session layout
                     (column width) and one centered column for every row. -->
                <div [class]="lanePanelClass" data-glass-surface="chrome" data-testid="lane-panel">
                  <ptah-chat-session-layout>
                  @for (
                    permission of agent.permissionQueue;
                    track permission.requestId
                  ) {
                    <div
                      [class]="laneColumnClass + ' mb-2 shrink-0 rounded-box border border-warning/40 bg-warning/10 p-2 text-xs'"
                    >
                      <div>Permission: {{ permission.toolName }}</div>
                      <div class="flex gap-2 mt-1">
                        <button
                          type="button"
                          class="btn btn-xs btn-success"
                          (click)="
                            respond(
                              agent.agentId,
                              permission.requestId,
                              'allow'
                            )
                          "
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          class="btn btn-xs btn-error btn-outline"
                          (click)="
                            respond(agent.agentId, permission.requestId, 'deny')
                          "
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  }
                  <ptah-agent-card
                    class="block flex-1 min-h-0"
                    [agent]="agent"
                    presentation="flat"
                    (toggleExpanded)="
                      monitor.toggleAgentExpanded(agent.agentId)
                    "
                  />
                  <!-- Hides itself when the agent cannot continue; queues
                       while it runs (AgentFollowUpQueueService). -->
                  <ptah-agent-continue-input
                    [class]="laneColumnClass + ' block flex-shrink-0 pt-2'"
                    variant="composer"
                    [agent]="agent"
                  />
                  </ptah-chat-session-layout>
                </div>
              }
            }
            @case ('subagent') {
              <ng-container [ngTemplateOutlet]="subagentLane" />
            }
            @case ('background') {
              @if (selectedSubagent(); as sub) {
                <ng-container [ngTemplateOutlet]="subagentLane" />
              } @else if (selectedBackground(); as agent) {
                <ptah-background-agent-strip
                  [entries]="[
                    {
                      id: agent.toolCallId,
                      name: agent.teammateName || agent.agentType,
                      origin: 'background',
                      description: agent.agentDescription,
                      status: agent.status,
                      steerable: false,
                      stoppable: false,
                      canBackground: false,
                    },
                  ]"
                />
              }
            }
            @default {}
          }
        </div>
      }
      <ng-template #subagentLane>
        @if (selectedSubagent(); as sub) {
          <div [class]="lanePanelClass" data-glass-surface="chrome" data-testid="lane-panel">
            <ptah-chat-session-layout>
            <ptah-subagent-lane
              class="flex-1"
              [record]="sub"
              [sessionId]="sessionId()"
              [getPermissionForTool]="getPermissionForTool"
              (permissionResponded)="chatStore.handlePermissionResponse($event)"
            />
            </ptah-chat-session-layout>
          </div>
        }
      </ng-template>
    </div>
  `,
})
export class CanvasLaneViewComponent {
  protected readonly lanePanelClass = LANE_PANEL_CLASS;
  protected readonly laneColumnClass = LANE_COLUMN_CLASS;
  readonly monitor = inject(AgentMonitorStore);
  readonly chatStore = inject(ChatStore);
  private readonly detail = inject(CanvasDetailService);
  private readonly background = inject(BackgroundAgentStore);
  private readonly responder = inject(AgentPermissionResponder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private opener: HTMLElement | null = null;
  readonly tabId = input.required<string>();
  readonly paneFocused = input(true);
  readonly splitDisplayed = input(false);
  readonly panelId = input('canvas-lane-panel');
  readonly sessionId = input<string | null>(null);
  readonly laneKey = input('orchestrator');
  readonly laneBlocks = computed(() => [
    { key: this.tabId() + ':' + this.laneKey() },
  ]);
  private readonly parsed = computed(() => parseLaneKey(this.laneKey()));
  readonly selectedCli = computed(() =>
    this.parsed()?.kind === 'cli'
      ? ownedBySession(
          this.monitor.agents(),
          this.sessionId(),
          (a) => a.parentSessionId,
        ).find((a) => a.agentId === this.parsed()?.id)
      : undefined,
  );
  readonly selectedSubagent = computed(() => {
    const parsed = this.parsed();
    if (parsed?.kind !== 'subagent' && parsed?.kind !== 'background')
      return undefined;
    return ownedBySession(
      [...this.monitor.subagents().values()],
      this.sessionId(),
      (a) => a.parentSessionId,
    ).find((a) => a.parentToolUseId === parsed.id);
  });
  readonly selectedBackground = computed(() =>
    this.parsed()?.kind === 'background'
      ? ownedBySession(
          this.background.agents(),
          this.sessionId(),
          (a) => a.sessionId,
        ).find((a) => a.toolCallId === this.parsed()?.id)
      : undefined,
  );
  readonly selectedKind = computed(() =>
    effectiveCanvasLaneKind(
      this.laneKey(),
      this.sessionId(),
      this.monitor,
      this.background,
    ),
  );
  readonly getPermissionForTool = (id: string) =>
    this.chatStore.getPermissionForTool(id);

  constructor() {
    let previousTabId: string | undefined;
    let previousKind: string | undefined;
    effect(() => {
      const tabId = this.tabId();
      const kind = this.selectedKind();
      if (previousTabId !== tabId) {
        this.opener = null;
        previousTabId = tabId;
        previousKind = kind;
        return;
      }
      if (previousKind === 'orchestrator' && kind !== 'orchestrator') {
        const focused = this.host.nativeElement.ownerDocument.activeElement;
        if (
          focused instanceof HTMLElement &&
          this.host.nativeElement.contains(focused)
        ) {
          this.opener = focused;
          afterNextRender(
            () => {
              if (
                this.tabId() === tabId &&
                this.selectedKind() !== 'orchestrator'
              ) {
                this.host.nativeElement
                  .querySelector<HTMLElement>('[role="tabpanel"]')
                  ?.focus();
              }
            },
            { injector: this.injector },
          );
        }
      }
      previousKind = kind;
    });
    let previousCliId: string | null = null;
    effect(() => {
      const agent = this.selectedCli();
      const id = agent?.agentId ?? null;
      if (id === previousCliId) return;
      previousCliId = id;
      if (agent && !agent.expanded)
        this.monitor.toggleAgentExpanded(agent.agentId);
    });
  }

  respond(
    agentId: string,
    requestId: string,
    decision: 'allow' | 'deny',
  ): void {
    this.responder.respondLane(agentId, requestId, decision);
  }

  back(): void {
    this.detail.selectLaneFor(this.tabId(), 'orchestrator');
    afterNextRender(
      () => {
        const target = this.opener?.isConnected
          ? this.opener
          : ((this.host.nativeElement.querySelector(
              'ptah-canvas-detail-transcript textarea, ptah-canvas-detail-transcript [contenteditable="true"]',
            ) as HTMLElement | null) ??
            (this.host.nativeElement.querySelector(
              'ptah-canvas-detail-transcript',
            ) as HTMLElement | null));
        target?.focus();
        this.opener = null;
      },
      { injector: this.injector },
    );
  }

  onEscape(event: Event): void {
    if (event.defaultPrevented || this.selectedKind() === 'orchestrator')
      return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    event.preventDefault();
    this.back();
  }
}
