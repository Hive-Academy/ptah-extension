import {
  Component,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  LucideAngularModule,
  Cpu,
  Loader2,
  Check,
  XCircle,
} from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { BackgroundAgentStore } from '../../services/background-agent.store';
import { TabManagerService } from '../../services/tab-manager.service';

/**
 * BackgroundAgentBadgeComponent - Header badge with popover for monitoring background agents
 *
 * Shows a CPU icon in the header with a count badge when background agents exist.
 * Clicking opens a popover with the agent list, status, and duration.
 *
 * Follows the NotificationBellComponent pattern.
 */
@Component({
  selector: 'ptah-background-agent-badge',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-popover
      [isOpen]="isOpen()"
      [placement]="'bottom-end'"
      [hasBackdrop]="true"
      [backdropClass]="'transparent'"
      (closed)="close()"
    >
      <!-- Trigger: CPU icon button with count badge -->
      <button
        trigger
        type="button"
        class="btn btn-square btn-ghost btn-sm relative"
        aria-label="Background agents"
        title="Background agents"
        (click)="toggle()"
      >
        <lucide-angular [img]="CpuIcon" class="w-4 h-4" aria-hidden="true" />

        @if (sessionAgentCount() > 0) {
        <span
          class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full text-[10px] font-bold flex items-center justify-center px-0.5"
          [ngClass]="{
            'bg-info text-info-content': sessionHasRunning(),
            'bg-base-content/20 text-base-content': !sessionHasRunning()
          }"
        >
          {{ sessionAgentCount() }}
        </span>
        } @if (sessionHasRunning()) {
        <span
          class="absolute top-0 right-0 w-2 h-2 bg-info rounded-full animate-pulse"
        ></span>
        }
      </button>

      <!-- Popover content -->
      <div content class="w-80 max-h-96 overflow-y-auto">
        <!-- Header -->
        <div
          class="px-3 py-2 border-b border-base-content/10 flex items-center justify-between"
        >
          <span
            class="text-xs font-semibold text-base-content/70 uppercase tracking-wider"
          >
            Background Agents
          </span>
          @if (sessionCompletedCount() > 0) {
          <button
            type="button"
            class="btn btn-ghost btn-xs text-[10px]"
            (click)="store.clearCompleted()"
          >
            Clear
          </button>
          }
        </div>

        <!-- Agent list -->
        <div class="py-1">
          @for (agent of sessionAgents(); track agent.toolCallId) {
          <div
            class="px-3 py-2 flex items-start gap-2.5 border-b border-base-content/5 last:border-b-0"
          >
            <!-- Status icon -->
            <div class="flex-shrink-0 mt-0.5">
              @if (agent.status === 'running') {
              <lucide-angular
                [img]="LoaderIcon"
                class="w-4 h-4 text-info animate-spin"
              />
              } @else if (agent.status === 'completed') {
              <lucide-angular [img]="CheckIcon" class="w-4 h-4 text-success" />
              } @else {
              <lucide-angular [img]="XCircleIcon" class="w-4 h-4 text-error" />
              }
            </div>

            <!-- Agent info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-medium text-base-content truncate">
                  {{ agent.agentType }}
                </span>
                <span
                  class="badge badge-xs"
                  [ngClass]="{
                    'badge-info': agent.status === 'running',
                    'badge-success': agent.status === 'completed',
                    'badge-error':
                      agent.status === 'error' || agent.status === 'stopped'
                  }"
                >
                  {{ agent.status }}
                </span>
              </div>
              @if (agent.agentDescription) {
              <p
                class="text-[10px] text-base-content/50 truncate mt-0.5"
                [title]="agent.agentDescription"
              >
                {{ agent.agentDescription }}
              </p>
              } @if (agent.status === 'running') {
              <p class="text-[10px] text-base-content/40 mt-0.5">
                {{ formatElapsed(agent.startedAt) }}
              </p>
              } @else if (agent.duration) {
              <p class="text-[10px] text-base-content/40 mt-0.5">
                {{ formatDuration(agent.duration) }}
                @if (agent.cost) {
                <span class="ml-1">
                  {{ '$' + agent.cost.toFixed(4) }}
                </span>
                }
              </p>
              }
            </div>
          </div>
          } @empty {
          <div class="px-3 py-6 text-center">
            <lucide-angular
              [img]="CpuIcon"
              class="w-6 h-6 text-base-content/20 mx-auto mb-2"
              aria-hidden="true"
            />
            <p class="text-xs text-base-content/40">No background agents</p>
          </div>
          }
        </div>
      </div>
    </ptah-native-popover>
  `,
})
export class BackgroundAgentBadgeComponent {
  readonly store = inject(BackgroundAgentStore);
  private readonly tabManager = inject(TabManagerService);

  // Session-scoped computed signals
  readonly sessionAgents = computed(() => {
    const sessionId = this.tabManager.activeTab()?.claudeSessionId;
    if (!sessionId) return this.store.agents();
    return this.store.agentsForSession(sessionId);
  });

  readonly sessionAgentCount = computed(() => this.sessionAgents().length);

  readonly sessionHasRunning = computed(() =>
    this.sessionAgents().some((a) => a.status === 'running')
  );

  readonly sessionCompletedCount = computed(
    () => this.sessionAgents().filter((a) => a.status !== 'running').length
  );

  // Popover state
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  // Icons
  protected readonly CpuIcon = Cpu;
  protected readonly LoaderIcon = Loader2;
  protected readonly CheckIcon = Check;
  protected readonly XCircleIcon = XCircle;

  toggle(): void {
    this._isOpen.update((v) => !v);
  }

  close(): void {
    this._isOpen.set(false);
  }

  /** Format elapsed time from startedAt to now */
  formatElapsed(startedAt: number): string {
    // Read tick signal to trigger reactivity
    this.store.tick();
    const elapsed = Date.now() - startedAt;
    return this.formatDuration(elapsed);
  }

  /** Format duration in ms to human-readable string */
  formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
}
