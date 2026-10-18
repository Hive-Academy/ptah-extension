import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  agentCountOf,
  durationMsOf,
  formatCost,
  formatDuration,
  formatTokens,
  knownSubtotalOf,
} from '@ptah-extension/chat-ui';
import type { SessionStatsEntry } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-command-session-stats',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content"
      aria-label="Session statistics"
    >
      <span
        >Cost
        <strong>
          @if (snapshot()?.provisional) {
            <span class="sr-only">estimated </span>
          }
          {{ cost() }}</strong
        ></span
      >
      <span
        >Tokens
        <strong>
          @if (snapshot()?.provisional) {
            <span class="sr-only">estimated </span>
          }
          {{ tokens() }}</strong
        ></span
      >
      <span
        >Agents <strong>{{ agents() }}</strong></span
      >
      <span
        >Duration <strong>{{ duration() }}</strong></span
      >
    </div>
  `,
})
export class CommandSessionStatsComponent {
  public readonly snapshot = input<SessionStatsEntry | null>(null);
  public readonly cost = computed(() => {
    const s = this.snapshot();
    const subtotal = knownSubtotalOf(s);
    const value = s?.totalCost ?? subtotal?.value ?? null;
    return `${s?.provisional && value !== null ? '~' : ''}${formatCost(value)}${subtotal ? ' known subtotal' : ''}`;
  });
  public readonly tokens = computed(() => {
    const s = this.snapshot();
    const value = s?.tokenCount;
    return typeof value === 'number' && Number.isFinite(value)
      ? `${s?.provisional ? '~' : ''}${formatTokens(value)}`
      : '—';
  });
  public readonly agents = computed(() => {
    const value = agentCountOf(this.snapshot());
    return value === null ? '—' : value.toString();
  });
  public readonly duration = computed(() => {
    const value = durationMsOf(this.snapshot());
    return value === null ? '—' : formatDuration(value);
  });
}
