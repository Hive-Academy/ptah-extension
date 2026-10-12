import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  AgentCardComponent,
  AgentPermissionResponder,
  SubagentUsageSummaryComponent,
  parseLaneKey,
} from '@ptah-extension/chat';
import {
  BackgroundAgentStore,
  AgentMonitorStore,
} from '@ptah-extension/chat-streaming';
import {
  BackgroundAgentStripComponent,
  SubagentTranscriptViewerComponent,
} from '@ptah-extension/chat-ui';
import type { SubagentTranscriptMessage } from '@ptah-extension/shared';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';

@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  imports: [
    AgentCardComponent,
    SubagentUsageSummaryComponent,
    SubagentTranscriptViewerComponent,
    BackgroundAgentStripComponent,
    CanvasDetailTranscriptComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0 overflow-auto' },
  template: `
    <div id="canvas-lane-panel" role="tabpanel" class="h-full min-h-0">
      @for (key of [laneKey()]; track key) {
        @switch (selectedKind()) {
          @case ('cli') {
            @if (selectedCli(); as agent) {
              <div class="p-2 h-full flex flex-col gap-2">
                @for (
                  permission of agent.permissionQueue;
                  track permission.requestId
                ) {
                  <div
                    class="rounded-box border border-warning/40 bg-warning/10 p-2 text-xs"
                  >
                    <div>Permission: {{ permission.toolName }}</div>
                    <div class="flex gap-2 mt-1">
                      <button
                        type="button"
                        class="btn btn-xs btn-success"
                        (click)="
                          respond(agent.agentId, permission.requestId, 'allow')
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
                  (toggleExpanded)="monitor.toggleAgentExpanded(agent.agentId)"
                />
              </div>
            }
          }
          @case ('subagent') {
            @if (selectedSubagent(); as sub) {
              <div class="p-2 space-y-2">
                <ptah-subagent-usage-summary [record]="sub" />
                @if (
                  sub.taskId &&
                  (sub.status === 'running' ||
                    sub.status === 'pending' ||
                    sub.status === 'paused' ||
                    sub.status === 'background')
                ) {
                  <button
                    type="button"
                    class="btn btn-xs btn-error btn-outline"
                    [disabled]="stopping()"
                    (click)="stop(sub.taskId, sub.parentSessionId!)"
                  >
                    Stop
                  </button>
                }
                @if (sub.agentId) {
                  <ptah-subagent-transcript-viewer
                    [agentName]="
                      sub.teammateName || sub.description || 'Sub-agent'
                    "
                    [messages]="messages()"
                    [loading]="loading()"
                    [error]="error()"
                    (refresh)="
                      loadTranscript(sub.agentId, sub.parentSessionId!)
                    "
                  />
                } @else {
                  <p class="text-sm text-base-content/60">
                    Transcript is not available yet
                  </p>
                }
              </div>
            }
          }
          @case ('background') {
            @if (selectedSubagent(); as sub) {
              <div class="p-2 space-y-2">
                <ptah-subagent-usage-summary [record]="sub" />
                @if (sub.taskId && sub.status === 'background') {
                  <button
                    type="button"
                    class="btn btn-xs btn-error btn-outline"
                    [disabled]="stopping()"
                    (click)="stop(sub.taskId, sub.parentSessionId!)"
                  >
                    Stop
                  </button>
                }
                @if (sub.agentId) {
                  <ptah-subagent-transcript-viewer
                    [agentName]="
                      sub.teammateName || sub.description || 'Background agent'
                    "
                    [messages]="messages()"
                    [loading]="loading()"
                    [error]="error()"
                    (refresh)="
                      loadTranscript(sub.agentId, sub.parentSessionId!)
                    "
                  />
                }
              </div>
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
                    canViewTranscript: false,
                  },
                ]"
              />
            }
          }
          @default {
            <ptah-canvas-detail-transcript [tabId]="tabId()" />
          }
        }
      }
    </div>
  `,
})
export class CanvasLaneViewComponent {
  readonly monitor = inject(AgentMonitorStore);
  private readonly background = inject(BackgroundAgentStore);
  private readonly responder = inject(AgentPermissionResponder);
  readonly tabId = input.required<string>();
  readonly sessionId = input<string | null>(null);
  readonly laneKey = input('orchestrator');
  private readonly parsed = computed(() => parseLaneKey(this.laneKey()));
  readonly selectedCli = computed(() =>
    this.parsed()?.kind === 'cli'
      ? this.monitor
          .agents()
          .find(
            (a) =>
              a.parentSessionId === this.sessionId() &&
              a.agentId === this.parsed()?.id,
          )
      : undefined,
  );
  readonly selectedSubagent = computed(() => {
    const parsed = this.parsed();
    if (parsed?.kind !== 'subagent' && parsed?.kind !== 'background')
      return undefined;
    return [...this.monitor.subagents().values()].find(
      (a) =>
        a.parentSessionId === this.sessionId() &&
        a.parentToolUseId === parsed.id &&
        (parsed.kind === 'background'
          ? a.status === 'background'
          : a.status !== 'background'),
    );
  });
  readonly selectedBackground = computed(() =>
    this.parsed()?.kind === 'background'
      ? this.background
          .agents()
          .find(
            (a) =>
              a.sessionId === this.sessionId() &&
              a.toolCallId === this.parsed()?.id,
          )
      : undefined,
  );
  readonly selectedKind = computed(() => {
    const kind = this.parsed()?.kind;
    if (kind === 'cli' && this.selectedCli()) return kind;
    if (kind === 'subagent' && this.selectedSubagent()) return kind;
    if (
      kind === 'background' &&
      (this.selectedSubagent() || this.selectedBackground())
    )
      return kind;
    return 'orchestrator';
  });
  readonly messages = signal<readonly SubagentTranscriptMessage[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly stopping = signal(false);

  constructor() {
    effect(() => {
      const agent = this.selectedCli();
      if (agent && !agent.expanded)
        this.monitor.toggleAgentExpanded(agent.agentId);
    });
    effect((onCleanup) => {
      const sub = this.selectedSubagent();
      const id = sub?.agentId;
      const sessionId = sub?.parentSessionId;
      if (!id || !sessionId) return;
      let active = true;
      onCleanup(() => {
        active = false;
      });
      this.loading.set(true);
      this.error.set(null);
      this.messages.set([]);
      void this.monitor
        .getSubagentTranscript(sessionId, id)
        .then((messages) => {
          if (active) this.messages.set(messages);
        })
        .catch((error: unknown) => {
          if (active)
            this.error.set(
              error instanceof Error
                ? error.message
                : 'Failed to load transcript',
            );
        })
        .finally(() => {
          if (active) this.loading.set(false);
        });
    });
  }

  loadTranscript(agentId: string, sessionId: string): void {
    this.loading.set(true);
    this.error.set(null);
    void this.monitor
      .getSubagentTranscript(sessionId, agentId)
      .then((messages) => this.messages.set(messages))
      .catch((error: unknown) =>
        this.error.set(
          error instanceof Error ? error.message : 'Failed to load transcript',
        ),
      )
      .finally(() => this.loading.set(false));
  }

  async stop(taskId: string, ownerSessionId: string): Promise<void> {
    this.stopping.set(true);
    try {
      await this.monitor.stopAgent(taskId, ownerSessionId);
    } finally {
      this.stopping.set(false);
    }
  }

  respond(
    agentId: string,
    requestId: string,
    decision: 'allow' | 'deny',
  ): void {
    this.responder.respondLane(
      agentId,
      requestId,
      decision,
      decision === 'deny' ? 'User denied' : undefined,
    );
  }
}
