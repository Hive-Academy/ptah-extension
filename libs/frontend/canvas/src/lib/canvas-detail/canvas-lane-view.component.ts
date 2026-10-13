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
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import { NgTemplateOutlet } from '@angular/common';
import {
  BackgroundAgentStripComponent,
  SubagentTranscriptViewerComponent,
} from '@ptah-extension/chat-ui';
import type { SubagentTranscriptMessage } from '@ptah-extension/shared';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';
import { ownedBySession } from './lane-owner';

@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  imports: [
    AgentCardComponent,
    SubagentUsageSummaryComponent,
    SubagentTranscriptViewerComponent,
    BackgroundAgentStripComponent,
    CanvasDetailTranscriptComponent,
    NgTemplateOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0 overflow-auto' },
  template: `
    <div
      [id]="panelId()"
      role="tabpanel"
      [attr.aria-labelledby]="panelId() + '-tab-' + laneKey()"
      class="h-full min-h-0"
    >
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
      <ng-template #subagentLane>
        @if (selectedSubagent(); as sub) {
          <div class="p-2 space-y-2">
            <ptah-subagent-usage-summary [record]="sub" />
            @for (request of selectedPermissions(); track request.id) {
              <div
                class="rounded-box border border-warning/40 bg-warning/10 p-2 text-xs"
                role="group"
                aria-label="Permission request"
              >
                <div>Permission: {{ request.toolName }}</div>
                <div class="flex gap-2 mt-1">
                  <button
                    type="button"
                    class="btn btn-xs btn-success"
                    (click)="respondSession(request, 'allow')"
                  >
                    Allow
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-error btn-outline"
                    (click)="respondSession(request, 'deny')"
                  >
                    Deny
                  </button>
                </div>
              </div>
            }
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
                [agentName]="sub.teammateName || sub.description || 'Sub-agent'"
                [messages]="messages()"
                [loading]="loading()"
                [error]="error()"
                (refresh)="loadTranscript(sub.agentId, sub.parentSessionId!)"
              />
            } @else {
              <p class="text-sm text-base-content-muted">
                Transcript is not available yet
              </p>
            }
          </div>
        }
      </ng-template>
    </div>
  `,
})
export class CanvasLaneViewComponent {
  readonly monitor = inject(AgentMonitorStore);
  private readonly background = inject(BackgroundAgentStore);
  private readonly responder = inject(AgentPermissionResponder);
  private readonly permissions = inject(PermissionHandlerService);
  readonly tabId = input.required<string>();
  readonly panelId = input('canvas-lane-panel');
  readonly sessionId = input<string | null>(null);
  readonly laneKey = input('orchestrator');
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
    ).find(
      (a) =>
        a.parentToolUseId === parsed.id &&
        (parsed.kind === 'background'
          ? a.status === 'background'
          : a.status !== 'background'),
    );
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
  readonly selectedPermissions = computed(() => {
    const sub = this.selectedSubagent();
    return sub && this.sessionId()
      ? this.permissions
          .permissionRequests()
          .filter(
            (request) =>
              (request.tabId === this.tabId() ||
                request.sessionId === this.sessionId()) &&
              request.agentToolCallId === sub.parentToolUseId &&
              !request.surfaceMode,
          )
      : [];
  });
  readonly transcriptAgentId = computed(
    () => this.selectedSubagent()?.agentId ?? null,
  );
  readonly transcriptSessionId = computed(
    () => this.selectedSubagent()?.parentSessionId ?? null,
  );
  private requestVersion = 0;

  constructor() {
    effect(() => {
      const agent = this.selectedCli();
      if (agent && !agent.expanded)
        this.monitor.toggleAgentExpanded(agent.agentId);
    });
    effect((onCleanup) => {
      const id = this.transcriptAgentId();
      const sessionId = this.transcriptSessionId();
      if (!id || !sessionId) return;
      const version = ++this.requestVersion;
      onCleanup(() => {
        this.requestVersion++;
      });
      this.loading.set(true);
      this.error.set(null);
      this.messages.set([]);
      void this.monitor
        .getSubagentTranscript(sessionId, id)
        .then((messages) => {
          if (version === this.requestVersion) this.messages.set(messages);
        })
        .catch((error: unknown) => {
          if (version === this.requestVersion)
            this.error.set(
              error instanceof Error
                ? error.message
                : 'Failed to load transcript',
            );
        })
        .finally(() => {
          if (version === this.requestVersion) this.loading.set(false);
        });
    });
  }

  loadTranscript(agentId: string, sessionId: string): void {
    if (
      this.transcriptAgentId() !== agentId ||
      this.transcriptSessionId() !== sessionId
    )
      return;
    const version = ++this.requestVersion;
    this.loading.set(true);
    this.error.set(null);
    void this.monitor
      .getSubagentTranscript(sessionId, agentId)
      .then((messages) => {
        if (
          version === this.requestVersion &&
          this.transcriptAgentId() === agentId &&
          this.transcriptSessionId() === sessionId
        )
          this.messages.set(messages);
      })
      .catch(
        (error: unknown) =>
          version === this.requestVersion &&
          this.error.set(
            error instanceof Error
              ? error.message
              : 'Failed to load transcript',
          ),
      )
      .finally(() => {
        if (version === this.requestVersion) this.loading.set(false);
      });
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
    this.responder.respondLane(agentId, requestId, decision);
  }

  respondSession(
    request: import('@ptah-extension/shared').PermissionRequest,
    decision: 'allow' | 'deny',
  ): void {
    this.responder.respondSession(request, decision, this.tabId());
  }
}
