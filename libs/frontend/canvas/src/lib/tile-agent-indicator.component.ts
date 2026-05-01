/**
 * TileAgentIndicatorComponent
 *
 * Compact agent badge rendered in each canvas tile header.
 * Shows a color-coded status dot + agent count. Clicking toggles
 * the expanded mini-panel (managed by parent via viewChild access).
 *
 * Hidden when no agents are associated with the tile's session.
 *
 * TASK_2025_272 Batch 3
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';

@Component({
  selector: 'ptah-tile-agent-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (agentCount() > 0) {
      <button
        class="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
               bg-base-200/60 hover:bg-base-200 transition-colors cursor-pointer"
        [class.text-info]="hasRunning()"
        [class.text-warning]="!hasRunning() && hasPendingPermissions()"
        [class.text-base-content/50]="!hasRunning() && !hasPendingPermissions()"
        (click)="toggleExpanded($event)"
        [attr.aria-label]="agentSummary()"
        [attr.title]="agentSummary()"
      >
        <span
          class="inline-block w-1.5 h-1.5 rounded-full"
          [class.bg-info]="hasRunning()"
          [class.bg-warning]="!hasRunning() && hasPendingPermissions()"
          [class.bg-base-content/40]="!hasRunning() && !hasPendingPermissions()"
          [class.animate-pulse]="hasRunning() || hasPendingPermissions()"
        ></span>
        <span>{{ agentCount() }}</span>
      </button>
    }
  `,
})
export class TileAgentIndicatorComponent {
  // ---- Inputs ----
  readonly tabId = input.required<string>();

  // ---- Dependencies ----
  private readonly tabManager = inject(TabManagerService);
  private readonly agentStore = inject(AgentMonitorStore);

  // ---- State ----
  /** Whether the mini-panel is expanded. Public for parent viewChild access. */
  readonly expanded = signal(false);

  // ---- Computed signals ----

  /** Resolve tabId to the real Claude session ID via TabManagerService. */
  private readonly sessionId = computed(() => {
    const tab = this.tabManager.tabs().find((t) => t.id === this.tabId());
    return tab?.claudeSessionId ?? null;
  });

  /** Agents scoped to this tile's session. Public for parent viewChild access. */
  readonly agents = computed(() => {
    const sid = this.sessionId();
    if (!sid) return [];
    return this.agentStore.agentsForSession(sid);
  });

  readonly agentCount = computed(() => this.agents().length);

  readonly hasRunning = computed(() =>
    this.agents().some((a) => a.status === 'running'),
  );

  readonly hasPendingPermissions = computed(() =>
    this.agents().some((a) => a.permissionQueue.length > 0),
  );

  readonly agentSummary = computed(() => {
    const count = this.agentCount();
    const running = this.agents().filter((a) => a.status === 'running').length;
    const pending = this.agents().filter(
      (a) => a.permissionQueue.length > 0,
    ).length;

    let summary = `${count} agent${count !== 1 ? 's' : ''}`;
    if (running > 0) summary += `, ${running} running`;
    if (pending > 0) summary += `, ${pending} awaiting permission`;
    return summary;
  });

  // ---- Event handlers ----

  toggleExpanded(event: Event): void {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }
}
