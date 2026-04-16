import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import {
  LucideAngularModule,
  Check,
  AlertCircle,
  Loader,
} from 'lucide-angular';
import type { StreamingState } from '../../../services/chat.types';
import type {
  FlatStreamEventUnion,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
} from '@ptah-extension/shared';

/** Compact activity entry for display */
interface ActivityEntry {
  type: 'tool' | 'agent';
  name: string;
  status: 'running' | 'complete' | 'error';
  description?: string;
}

/**
 * CompactSessionActivityComponent - Recent tool/agent activity feed.
 *
 * Reads flat streaming events and extracts the last N tool calls and agent spawns.
 * Shows them as a compact, scrollable list.
 *
 * Complexity Level: 2 (Molecule with event parsing logic)
 * Patterns: Signal inputs, computed signals, OnPush
 */
@Component({
  selector: 'ptah-compact-session-activity',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (activities().length > 0) {
      <div
        class="flex flex-col gap-0.5 px-3 py-1.5 border-b border-base-content/10 max-h-32 overflow-y-auto"
      >
        @for (entry of activities(); track $index) {
          <div class="flex items-center gap-1.5 text-xs min-h-[20px]">
            <!-- Status icon -->
            @if (entry.status === 'running') {
              <span
                class="loading loading-spinner loading-xs text-primary flex-shrink-0"
              ></span>
            } @else if (entry.status === 'error') {
              <lucide-angular
                [img]="AlertCircleIcon"
                class="w-3 h-3 text-error flex-shrink-0"
              />
            } @else {
              <lucide-angular
                [img]="CheckIcon"
                class="w-3 h-3 text-success/60 flex-shrink-0"
              />
            }

            <!-- Type badge -->
            @if (entry.type === 'agent') {
              <span
                class="px-1 py-0 rounded text-[9px] font-semibold uppercase bg-primary/15 text-primary border border-primary/25 flex-shrink-0"
              >
                Agent
              </span>
            }

            <!-- Name -->
            <span class="truncate text-base-content/70" [title]="entry.name">
              {{ entry.name }}
            </span>

            <!-- Description (agents only) -->
            @if (entry.description) {
              <span class="truncate text-base-content/40 text-[10px]">
                {{ entry.description }}
              </span>
            }
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionActivityComponent {
  readonly streamingState = input<StreamingState | null>(null);
  readonly maxEntries = input<number>(5);

  protected readonly CheckIcon = Check;
  protected readonly AlertCircleIcon = AlertCircle;

  readonly activities = computed((): ActivityEntry[] => {
    const state = this.streamingState();
    if (!state) return [];

    const max = this.maxEntries();
    const entries: ActivityEntry[] = [];
    const toolResults = new Map<string, boolean>(); // toolCallId -> isError

    // Collect tool results first for status lookup
    for (const event of state.events.values()) {
      if (event.eventType === 'tool_result') {
        const result = event as ToolResultEvent;
        toolResults.set(result.toolCallId, result.isError);
      }
    }

    // Collect tool starts and agent starts
    for (const event of state.events.values()) {
      if (event.eventType === 'tool_start') {
        const tool = event as ToolStartEvent;
        if (tool.isTaskTool) continue; // Skip Task tool — shown as agent

        const hasResult = toolResults.has(tool.toolCallId);
        const isError = toolResults.get(tool.toolCallId) === true;
        entries.push({
          type: 'tool',
          name: tool.toolName,
          status: hasResult ? (isError ? 'error' : 'complete') : 'running',
        });
      } else if (event.eventType === 'agent_start') {
        const agent = event as AgentStartEvent;
        const hasResult = toolResults.has(agent.toolCallId);
        entries.push({
          type: 'agent',
          name: agent.agentType,
          description: agent.agentDescription,
          status: hasResult ? 'complete' : 'running',
        });
      }
    }

    // Return last N entries
    return entries.slice(-max);
  });
}
