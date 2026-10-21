import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UsageTopSession } from '@ptah-extension/shared';
import type { UsageSessionRow } from './usage-summary.view-model';
import { ProviderMarkComponent } from '@ptah-extension/ui';
import { formatCompactTokens, formatUsd } from './usage-formatting';

@Component({
  selector: 'ptah-usage-top-sessions',
  standalone: true,
  imports: [ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="usage-top-sessions-heading" data-testid="usage-top-sessions">
      <h4 id="usage-top-sessions-heading" class="text-xs font-semibold uppercase tracking-wide text-base-content-muted">Top 5 sessions by cost</h4>
      @if (sessions().length === 0) {
        <p class="mt-2 text-xs text-base-content-muted">No session-linked usage in this range.</p>
      } @else {
        <div class="mt-2 overflow-x-auto">
          <table class="table table-xs">
            <thead><tr><th>Session</th><th>Model</th><th class="text-right">Cost</th><th class="text-right">Tokens</th><th class="text-right">Last active</th></tr></thead>
            <tbody>
              @for (session of sessions(); track session.providerId + ':' + session.sessionId) {
                <tr>
                  <td class="max-w-48 truncate" [attr.title]="session.title">{{ session.title }}</td>
                  <td><span class="flex items-center gap-2"><ptah-provider-mark [providerId]="session.providerId" size="sm" class="h-4 w-4 shrink-0" /><span class="max-w-40 truncate" [attr.title]="session.modelId">{{ session.modelDisplayName }}</span></span></td>
                  <td class="text-right tabular-nums" [attr.title]="session.unpriced ? 'Some usage has no price' : null">{{ costLabel(session) }}</td>
                  <td class="text-right tabular-nums">{{ compact(session.tokens) }}</td>
                  <td class="text-right whitespace-nowrap" [attr.title]="session.lastActive">{{ relative(session.lastActive) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class UsageTopSessionsComponent {
  readonly sessions = input.required<readonly UsageSessionRow[]>();
  readonly generatedAt = input.required<string>();
  protected readonly compact = formatCompactTokens;

  protected costLabel(session: UsageTopSession): string {
    if (session.costUsd === null) return 'Unpriced';
    return session.unpriced ? `≥ ${formatUsd(session.costUsd)}` : formatUsd(session.costUsd);
  }

  protected relative(lastActive: string): string {
    const elapsed = Math.max(0, Date.parse(this.generatedAt()) - Date.parse(lastActive));
    const hours = Math.floor(elapsed / 3_600_000);
    if (hours < 1) return 'Less than 1h ago';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
}
