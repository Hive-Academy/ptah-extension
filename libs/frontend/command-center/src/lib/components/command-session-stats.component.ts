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
import { Bot, Clock3, Coins, Hash, LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'ptah-command-session-stats',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="grid grid-cols-2 gap-3 text-xs text-base-content lg:grid-cols-4"
      aria-label="Session statistics"
    >
      @if (hasCost()) {
      <span class="flex items-center gap-2"><lucide-angular [img]="coinsIcon" class="size-4" aria-hidden="true" /> Cost
        <strong class="font-mono">
          @if (snapshot()?.provisional) {
            <span class="sr-only">estimated </span>
          }
          {{ cost() }}</strong
        ></span>
      }
      @if (hasTokens()) {
      <span class="flex items-center gap-2"><lucide-angular [img]="hashIcon" class="size-4" aria-hidden="true" /> Tokens
        <strong class="font-mono">
          @if (snapshot()?.provisional) {
            <span class="sr-only">estimated </span>
          }
          {{ tokens() }}</strong
        ></span>
      }
      @if (hasAgents()) {
      <span class="flex items-center gap-2"><lucide-angular [img]="botIcon" class="size-4" aria-hidden="true" /> Agents <strong class="font-mono">{{ agents() }}</strong></span>
      }
      @if (hasDuration()) {
      <span class="flex items-center gap-2"><lucide-angular [img]="clockIcon" class="size-4" aria-hidden="true" /> Duration <strong class="font-mono">{{ duration() }}</strong></span>
      }
    </div>
  `,
})
export class CommandSessionStatsComponent {
  public readonly coinsIcon = Coins;
  public readonly hashIcon = Hash;
  public readonly botIcon = Bot;
  public readonly clockIcon = Clock3;
  public readonly snapshot = input<SessionStatsEntry | null>(null);
  public readonly hasCost = computed(() => {
    const s = this.snapshot();
    return (typeof s?.totalCost === 'number' && Number.isFinite(s.totalCost)) || knownSubtotalOf(s) !== null;
  });
  public readonly hasTokens = computed(() => {
    const value = this.snapshot()?.tokenCount;
    return typeof value === 'number' && Number.isFinite(value);
  });
  public readonly hasAgents = computed(() => agentCountOf(this.snapshot()) !== null);
  public readonly hasDuration = computed(() => durationMsOf(this.snapshot()) !== null);
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
