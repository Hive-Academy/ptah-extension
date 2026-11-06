import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { LaneComposerComponent } from '@ptah-extension/chat-ui';

/** The monitor and canvas lane use the same backend-owned message contract. */
@Component({
  selector: 'ptah-agent-continue-input',
  standalone: true,
  imports: [LaneComposerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <ptah-lane-composer
        [agentId]="agent().agentId"
        [laneLabel]="agent().displayName || agent().cli"
        [cli]="agent().cli"
        [variant]="variant() === 'composer' ? 'full' : 'compact'"
        [stopped]="agent().status !== 'running'"
        [resumePath]="resumePath()"
      />
    }
  `,
})
export class AgentContinueInputComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly variant = input<'panel' | 'composer'>('panel');
  protected readonly visible = computed(() =>
    this.agent().status === 'running' || this.agent().supportsContinuation === true || !!this.agent().cliSessionId,
  );
  protected readonly resumePath = computed(() => {
    const agent = this.agent();
    if (agent.status === 'running') return null;
    if (agent.supportsContinuation === true && agent.continuationExpired !== true) return 'Continue warm session';
    if (agent.cliSessionId) return `Resume CLI session ${agent.cliSessionId.slice(0, 8)}`;
    return 'Start fresh handoff';
  });
}
