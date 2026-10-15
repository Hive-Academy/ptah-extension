import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  BackgroundAgentStripComponent,
  type BackgroundAgentStripEntry,
  type BackgroundAgentSteerRequest,
} from '@ptah-extension/chat-ui';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
} from '@ptah-extension/chat-streaming';
import {
  buildTrayContexts,
  type TrayAgentContext,
} from '../../services/session-agents/session-agent-tray';
import { SessionAgentTrayService } from '../../services/session-agents/session-agent-tray.service';

/**
 * BackgroundAgentTrayComponent — thin smart wrapper around the presentational
 * {@link BackgroundAgentStripComponent}.
 *
 * The entry list is `buildTrayContexts` (all running subagents plus all
 * background agents, deduped by `toolCallId`, background records winning) and
 * every chip action goes through {@link SessionAgentTrayService}, the same code
 * the inspector AGENTS section uses. Each action resolves the agent's OWNING
 * session from its context, never the focused tab.
 */
@Component({
  selector: 'ptah-background-agent-tray',
  standalone: true,
  imports: [BackgroundAgentStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-background-agent-strip
      [entries]="entries()"
      [pendingSteerId]="pendingSteerId()"
      (focusAgent)="onFocus($event)"
      (steer)="onSteer($event)"
      (stop)="onStop($event)"
      (sendToBackground)="onSendToBackground($event)"
      (viewTranscript)="onViewTranscript($event)"
    />
  `,
})
export class BackgroundAgentTrayComponent {
  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly backgroundStore = inject(BackgroundAgentStore);
  private readonly tray = inject(SessionAgentTrayService);

  /**
   * Owning-session filter. When set (canvas-tile mode), only agents visible
   * from that session are shown so each tile's tray is scoped to its own
   * subagents. When null (main panel), every agent is shown across all
   * sessions. An empty string is a tile whose session has not resolved yet:
   * still a scope, so it shows only agents with no owner — never everyone's.
   */
  readonly sessionId = input<string | null>(null);

  /** Id of the chip whose steer RPC is in flight (disables its inline input). */
  protected readonly pendingSteerId = signal<string | null>(null);

  /** Per-entry action context, keyed by `toolCallId`. */
  private readonly context = computed<ReadonlyMap<string, TrayAgentContext>>(
    () =>
      buildTrayContexts(
        this.agentMonitor.subagents(),
        this.backgroundStore.agents(),
        this.sessionId(),
      ),
  );

  /** Chip view-models handed to the dumb strip. */
  readonly entries = computed<readonly BackgroundAgentStripEntry[]>(() =>
    Array.from(this.context().values(), (ctx) => ctx.entry),
  );

  protected onFocus(id: string): void {
    const ctx = this.context().get(id);
    if (ctx) this.tray.focus(ctx);
  }

  protected async onSteer(request: BackgroundAgentSteerRequest): Promise<void> {
    const ctx = this.context().get(request.id);
    if (!ctx) return;
    this.pendingSteerId.set(request.id);
    try {
      await this.tray.steer(ctx, request.text);
    } finally {
      this.pendingSteerId.set(null);
    }
  }

  protected onStop(id: string): void {
    const ctx = this.context().get(id);
    if (ctx) this.tray.stop(ctx);
  }

  protected onSendToBackground(id: string): void {
    const ctx = this.context().get(id);
    if (ctx) this.tray.sendToBackground(ctx);
  }

  protected onViewTranscript(id: string): void {
    const ctx = this.context().get(id);
    if (ctx) this.tray.viewTranscript(ctx);
  }
}
