/**
 * Agent Card Component
 *
 * Displays a single monitored agent in the agent monitor sidebar.
 * Shows: CLI badge, status badge, elapsed time, task description,
 * and collapsible output panel with markdown rendering.
 */

import {
  Component,
  input,
  output,
  computed,
  effect,
  inject,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, ChevronDown, ChevronRight } from 'lucide-angular';
import { MarkdownModule } from 'ngx-markdown';
import { AgentMonitorStore } from '../../services/agent-monitor.store';
import type { MonitoredAgent } from '../../services/agent-monitor.store';

@Component({
  selector: 'ptah-agent-card',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="border border-base-content/10 rounded-lg overflow-hidden bg-base-100 flex flex-col h-full"
    >
      <!-- Header -->
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
          class="badge badge-sm badge-outline font-mono text-xs flex-shrink-0"
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

        <!-- Elapsed time -->
        <span class="text-xs text-base-content/40 ml-auto flex-shrink-0">
          {{ elapsedDisplay() }}
        </span>
      </button>

      @if (agent().expanded) {
      <!-- Task description -->
      <div class="px-3 py-1.5 border-t border-base-content/5 flex-shrink-0">
        <p class="text-xs text-base-content/60 line-clamp-2">
          {{ agent().task }}
        </p>
      </div>

      <!-- Output -->
      @if (agent().stdout || agent().stderr) {
      <div
        #outputContainer
        class="border-t border-base-content/5 flex-1 min-h-0 overflow-y-auto"
      >
        <div class="p-2">
          @if (agent().stdout) {
          <markdown
            [data]="agent().stdout"
            class="prose prose-sm prose-invert max-w-none [&_*]:text-xs [&_pre]:my-1 [&_p]:my-1 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0"
          />
          } @if (agent().stderr) {
          <pre
            class="text-xs font-mono whitespace-pre-wrap break-all m-0 text-error mt-1"
            >{{ agent().stderr }}</pre
          >
          }
        </div>
      </div>
      } }
    </div>
  `,
})
export class AgentCardComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly toggleExpanded = output<void>();

  private readonly store = inject(AgentMonitorStore);

  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;

  // Auto-scroll output
  private readonly outputContainer =
    viewChild<ElementRef<HTMLDivElement>>('outputContainer');

  /**
   * Elapsed time display derived from the store's shared tick signal.
   * No per-card setInterval — the store drives a single 1s timer.
   */
  readonly elapsedDisplay = computed(() => {
    const a = this.agent();
    // Read tick to re-evaluate every second while agents are running
    this.store.tick();
    return formatElapsed(Date.now() - a.startedAt);
  });

  constructor() {
    // Auto-scroll output to bottom
    effect(() => {
      const a = this.agent();
      // Read stdout/stderr to track changes
      const _ = a.stdout + a.stderr;
      const el = this.outputContainer()?.nativeElement;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  } else {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
}
