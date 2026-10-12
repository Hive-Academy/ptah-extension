import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';

/** Session accounting from the tab snapshot; missing sources remain unavailable. */
@Component({
  selector: 'ptah-canvas-session-details',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto bg-base-100' },
  template: `
    <aside class="p-4 space-y-4" aria-label="Session details">
      <h3 class="text-sm font-semibold">Session details</h3>
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span>Context</span>
          <span>{{
            contextPercent() === null ? '—' : contextPercent() + '%'
          }}</span>
        </div>
        <progress
          class="progress progress-primary w-full"
          [value]="contextPercent() ?? 0"
          max="100"
          [attr.aria-label]="'Context usage'"
          [attr.aria-valuetext]="
            contextPercent() === null ? 'Unavailable' : contextPercent() + '%'
          "
        ></progress>
      </div>
      <dl class="space-y-3 text-sm">
        <div class="flex justify-between gap-3">
          <dt>Tokens</dt>
          <dd>{{ tokens() === null ? '—' : (tokens() | number) }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Cost</dt>
          <dd>
            {{ cost() === null ? '—' : '$' + (cost() | number: '1.2-4') }}
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Turns</dt>
          <dd>{{ turns() === null ? '—' : turns() }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Todos</dt>
          <dd>—</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Git</dt>
          <dd class="truncate max-w-36" [title]="branch() ?? ''">
            {{ branch() ?? '—' }}
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Changes</dt>
          <dd>—</dd>
        </div>
      </dl>
    </aside>
  `,
  imports: [DecimalPipe],
})
export class CanvasSessionDetailsComponent {
  private readonly tabs = inject(TabManagerService);
  readonly tabId = input.required<string>();
  readonly tab = computed(
    () => this.tabs.tabs().find((tab) => tab.id === this.tabId()) ?? null,
  );
  readonly contextPercent = computed(() => {
    const stats = this.tab()?.liveModelStats;
    return stats?.contextKnown && Number.isFinite(stats.contextPercent)
      ? Math.max(0, Math.min(100, Math.round(stats.contextPercent)))
      : null;
  });
  readonly tokens = computed(
    () => this.tab()?.sessionStats?.tokenCount ?? null,
  );
  readonly cost = computed(() => this.tab()?.sessionStats?.totalCost ?? null);
  readonly turns = computed(
    () => this.tab()?.sessionStats?.messageCount ?? null,
  );
  readonly branch = computed(() => this.tab()?.agentOrigin?.branch ?? null);
}
