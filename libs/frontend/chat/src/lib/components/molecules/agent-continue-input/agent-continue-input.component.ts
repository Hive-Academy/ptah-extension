import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule, Play, Square } from 'lucide-angular';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { LaneComposerComponent } from '@ptah-extension/chat-ui';
import { laneGuardStopText } from '../agent-card/agent-card-header.component';

/** The monitor and canvas lane use the same backend-owned message contract. */
@Component({
  selector: 'ptah-agent-continue-input',
  standalone: true,
  imports: [LaneComposerComponent, LucideAngularModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible() || (variant() === 'composer' && (agent().status === 'running' || terminalStatus()))) {
      <div class="flex flex-col gap-1 pb-2">
        @if (visible()) {
          <ptah-lane-composer
            [agentId]="agent().agentId"
            [laneLabel]="agent().displayName || agent().cli"
            [cli]="agent().cli"
            [variant]="variant() === 'composer' ? 'full' : 'compact'"
            [stopped]="agent().status !== 'running'"
            [resumePath]="resumePath()"
          >
            @if (variant() === 'composer') {
              <ng-container laneControls [ngTemplateOutlet]="controls" />
            }
          </ptah-lane-composer>
        } @else if (variant() === 'composer') {
          <ng-container [ngTemplateOutlet]="controls" />
        }
        @if (variant() === 'composer' && terminalStatus(); as message) {
          <span class="px-1 text-[11px] text-warning">{{ message }}</span>
        }
      </div>
    }
    <ng-template #controls>
      @if (agent().status === 'running') {
        <button type="button" [class]="stopButtonClass" aria-label="Stop generating" title="Stop generating"
          [disabled]="stopPending()" (click)="stopRequested.emit($event)">
          @if (stopPending()) { <span class="loading loading-spinner loading-xs"></span> }
          @else { <lucide-angular [img]="SquareIcon" class="w-3.5 h-3.5" aria-hidden="true" /> }
        </button>
      } @else if (agent().cliSessionId) {
        <button type="button" [class]="stopButtonClass" [attr.aria-label]="'Resume '+agent().cli+' session'"
          title="Resume session" [disabled]="resumePending()" (click)="resumeRequested.emit($event)">
          @if (resumePending()) { <span class="loading loading-spinner loading-xs"></span> }
          @else { <lucide-angular [img]="PlayIcon" class="w-3.5 h-3.5" aria-hidden="true" /> }
        </button>
      }
    </ng-template>
  `,
})
export class AgentContinueInputComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly variant = input<'panel' | 'composer'>('panel');
  readonly stopPending = input(false);
  readonly resumePending = input(false);
  readonly stopRequested = output<Event>();
  readonly resumeRequested = output<Event>();
  protected readonly SquareIcon = Square;
  protected readonly PlayIcon = Play;
  protected readonly stopButtonClass = 'inline-flex items-center justify-center h-7 w-7 flex-shrink-0 rounded-full bg-error/15 text-error hover:bg-error/25 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
  protected readonly terminalStatus = computed(() => {
    const agent = this.agent();
    const status = agent.status === 'failed' ? 'Failed' : agent.status === 'timeout' ? 'Timed out' : agent.status === 'stopped' ? 'Stopped' : '';
    const reason = laneGuardStopText(agent.stopReason);
    return agent.status === 'running' ? '' : [status, reason].filter(Boolean).join(' \u00b7 ');
  });
  protected readonly visible = computed(() => {
    const agent = this.agent();
    const messaging = agent.effectiveCapabilities?.messaging;
    return agent.supportsContinuation === true || !!agent.cliSessionId ||
      (agent.status === 'running' && (
        messaging?.steer.state === 'supported' || messaging?.continuation.state === 'supported'
      ));
  });
  protected readonly resumePath = computed(() => {
    const agent = this.agent();
    if (agent.status === 'running') return null;
    if (agent.supportsContinuation === true && agent.continuationExpired !== true) return 'Continue warm session';
    if (agent.cliSessionId) return `Resume CLI session ${agent.cliSessionId.slice(0, 8)}`;
    return 'Start fresh handoff';
  });
}
