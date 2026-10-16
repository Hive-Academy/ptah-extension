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
  signal,
} from '@angular/core';
import {
  AgentCardComponent,
  AgentPermissionResponder,
  ChatStore,
  ExecutionNodeComponent,
  SubagentUsageSummaryComponent,
  TabManagerService,
  ownedBySession,
  parseLaneKey,
} from '@ptah-extension/chat';
import {
  BackgroundAgentStore,
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { NgTemplateOutlet } from '@angular/common';
import {
  BackgroundAgentStripComponent,
  SubagentTranscriptViewerComponent,
} from '@ptah-extension/chat-ui';
import type { ExecutionNode, SubagentTranscriptMessage } from '@ptah-extension/shared';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';
import { CanvasDetailService } from './canvas-detail.service';

@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  imports: [
    AgentCardComponent,
    ExecutionNodeComponent,
    SubagentUsageSummaryComponent,
    SubagentTranscriptViewerComponent,
    BackgroundAgentStripComponent,
    CanvasDetailTranscriptComponent,
    NgTemplateOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0 overflow-auto', '(keydown.escape)': 'onEscape($event)' },
  styles: [`
    @keyframes rail-lane-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: no-preference) {
      .rail-lane-enter { animation: rail-lane-enter 180ms ease-out; }
      .rail-focus-fade { transition: opacity 180ms ease-out, transform 180ms ease-out; }
      .rail-fade-start { opacity: 0; transform: translateY(4px); }
    }
  `],
  template: `
    <div
      [id]="panelId()"
      role="tabpanel"
      tabindex="-1"
      [attr.aria-labelledby]="panelId() + '-tab-' + laneKey()"
      class="rail-focus-fade h-full min-h-0"
      [class.rail-fade-start]="fade()"
    >
      <div [class.hidden]="selectedKind() !== 'orchestrator'" class="h-full">
        <ptah-canvas-detail-transcript [tabId]="tabId()" [visible]="selectedKind() === 'orchestrator'" [paneFocused]="paneFocused()" [splitDisplayed]="splitDisplayed()" />
      </div>
      @for (key of [tabId() + ':' + laneKey()]; track key) {
        <div class="rail-lane-enter">
        @switch (selectedKind()) {
          @case ('cli') {
            @if (selectedCli(); as agent) {
              <div class="h-full flex flex-col gap-2 px-3 pt-2">
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
                  presentation="flat"
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
          @default {}
        }
        </div>
      }
      <ng-template #subagentLane>
        @if (selectedSubagent(); as sub) {
          <div class="space-y-2 px-3 pt-2">
            <ptah-subagent-usage-summary [record]="sub" />
            @if (agentNode(); as node) {
              <ptah-execution-node
                [node]="node"
                [agentTileMode]="false"
                [getPermissionForTool]="getPermissionForTool"
                (permissionResponded)="chatStore.handlePermissionResponse($event)"
              />
            } @else if (sub.agentId) {
              <p class="text-xs text-base-content-muted">Live agent unavailable. Showing saved transcript.</p>
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
  readonly chatStore = inject(ChatStore);
  private readonly tabs = inject(TabManagerService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
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
  readonly fade = signal(false);
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
        a.parentToolUseId === parsed.id,
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
  readonly transcriptAgentId = computed(
    () => this.selectedSubagent()?.agentId ?? null,
  );
  readonly transcriptSessionId = computed(
    () => this.selectedSubagent()?.parentSessionId ?? null,
  );
  readonly agentNode = computed((): ExecutionNode | null => {
    const toolCallId = this.selectedSubagent()?.parentToolUseId;
    if (!toolCallId) return null;
    const tab = this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.tab;
    if (!tab) return null;
    const trees = tab.messages.map((message) => message.streamingState).filter((node): node is ExecutionNode => !!node);
    if (tab.streamingState) trees.push(...this.treeBuilder.buildTree(tab.streamingState, `tab-${this.tabId()}`));
    for (let index = trees.length - 1; index >= 0; index--) {
      const found = findAgentNode(trees[index], toolCallId);
      if (found) return found;
    }
    return null;
  });
  readonly getPermissionForTool = (id: string) => this.chatStore.getPermissionForTool(id);
  private requestVersion = 0;

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
        if (focused instanceof HTMLElement && this.host.nativeElement.contains(focused)) {
          this.opener = focused;
          afterNextRender(() => {
            if (this.tabId() === tabId && this.selectedKind() !== 'orchestrator') {
              this.host.nativeElement.querySelector<HTMLElement>('[role="tabpanel"]')?.focus();
            }
          }, { injector: this.injector });
        }
      }
      previousKind = kind;
    });
    effect((onCleanup) => {
      this.tabId();
      this.fade.set(true);
      const frame = globalThis.requestAnimationFrame?.(() => this.fade.set(false));
      if (frame !== undefined) onCleanup(() => globalThis.cancelAnimationFrame(frame));
      else this.fade.set(false);
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
    effect((onCleanup) => {
      const id = this.transcriptAgentId();
      const sessionId = this.transcriptSessionId();
      if (!id || !sessionId || this.agentNode()) return;
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
      this.agentNode() ||
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

  respond(
    agentId: string,
    requestId: string,
    decision: 'allow' | 'deny',
  ): void {
    this.responder.respondLane(agentId, requestId, decision);
  }

  back(): void {
    this.detail.selectLaneFor(this.tabId(), 'orchestrator');
    afterNextRender(() => {
      const target = this.opener?.isConnected ? this.opener :
        (this.host.nativeElement.querySelector('ptah-canvas-detail-transcript textarea, ptah-canvas-detail-transcript [contenteditable="true"]') as HTMLElement | null)
        ?? (this.host.nativeElement.querySelector('ptah-canvas-detail-transcript') as HTMLElement | null);
      target?.focus();
      this.opener = null;
    }, { injector: this.injector });
  }

  onEscape(event: Event): void {
    if (event.defaultPrevented || this.selectedKind() === 'orchestrator') return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    this.back();
  }
}

function findAgentNode(node: ExecutionNode | null | undefined, id: string): ExecutionNode | null {
  if (!node) return null;
  if (node.type === 'agent' && node.toolCallId === id) return node;
  for (const child of node.children) {
    const found = findAgentNode(child, id);
    if (found) return found;
  }
  return null;
}
