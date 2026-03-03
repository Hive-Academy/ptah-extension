/**
 * Agent Card Header Component
 *
 * Displays the expand/collapse toggle, CLI badge, status badge,
 * stop/resume buttons, elapsed time, and session ID badge.
 */

import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  ChevronDown,
  ChevronRight,
  Square,
  Play,
} from 'lucide-angular';
import { SlicePipe } from '@angular/common';
import type { MonitoredAgent } from '../../../services/agent-monitor.store';

@Component({
  selector: 'ptah-agent-card-header',
  standalone: true,
  imports: [LucideAngularModule, SlicePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-base-200/50 transition-colors flex-shrink-0"
      (click)="toggleExpanded.emit()"
    >
      <!-- Expand/collapse icon -->
      <lucide-angular
        [img]="agent().expanded ? ChevronDownIcon : ChevronRightIcon"
        class="w-3 h-3 text-base-content/50 flex-shrink-0"
      />

      <!-- CLI badge -->
      <span
        class="badge badge-sm badge-outline font-mono text-[10px] flex-shrink-0"
      >
        {{ agent().cli }}
      </span>

      <!-- Status badge -->
      <span
        class="badge badge-sm flex-shrink-0"
        [class.badge-info]="agent().status === 'running'"
        [class.badge-success]="agent().status === 'completed'"
        [class.badge-error]="
          agent().status === 'failed' || agent().status === 'timeout'
        "
        [class.badge-warning]="agent().status === 'stopped'"
      >
        {{ agent().status }}
      </span>

      <!-- Stop button (running agents only) -->
      @if (agent().status === 'running') {
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square ml-auto flex-shrink-0"
        [disabled]="isStopping()"
        title="Stop agent"
        (click)="stopAgent.emit($event)"
        aria-label="Stop agent"
      >
        @if (isStopping()) {
        <span class="loading loading-spinner loading-xs"></span>
        } @else {
        <lucide-angular [img]="SquareIcon" class="w-3 h-3 text-error" />
        }
      </button>
      }

      <!-- Resume button (non-running agents with cliSessionId) -->
      @if (agent().status !== 'running' && agent().cliSessionId) {
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square ml-auto flex-shrink-0"
        [disabled]="isResuming()"
        title="Resume session"
        (click)="resumeAgent.emit($event)"
        aria-label="Resume agent session"
      >
        @if (isResuming()) {
        <span class="loading loading-spinner loading-xs"></span>
        } @else {
        <lucide-angular [img]="PlayIcon" class="w-3 h-3 text-success" />
        }
      </button>
      }

      <!-- Elapsed time -->
      <span
        class="text-[10px] text-base-content/40 flex-shrink-0"
        [class.ml-auto]="agent().status !== 'running' && !agent().cliSessionId"
      >
        {{ elapsedDisplay() }}
      </span>

      <!-- CLI Session ID badge (resume capability) -->
      @if (agent().cliSessionId) {
      <span
        class="badge badge-xs badge-ghost font-mono text-[9px] text-base-content/30 ml-1 flex-shrink-0"
        [title]="'CLI Session: ' + agent().cliSessionId"
      >
        {{ agent().cliSessionId! | slice : 0 : 8 }}...
      </span>
      }
    </button>
  `,
})
export class AgentCardHeaderComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly elapsedDisplay = input.required<string>();
  readonly isStopping = input.required<boolean>();
  readonly isResuming = input.required<boolean>();

  readonly toggleExpanded = output<void>();
  readonly stopAgent = output<Event>();
  readonly resumeAgent = output<Event>();

  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly SquareIcon = Square;
  readonly PlayIcon = Play;
}
