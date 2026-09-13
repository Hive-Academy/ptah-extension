import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, untracked } from '@angular/core';
import { ProviderAccountStateService } from '../../services/provider-account-state.service';

@Component({
  selector: 'ptah-provider-account-card',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state.isCodex()) {
      <section class="rounded-lg border border-base-content/10 bg-base-100/40 p-3" aria-label="Codex account usage">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h4 class="font-medium text-sm">Codex account</h4>
            <p class="text-[10px] text-base-content-muted">Subscription quota and account activity</p>
          </div>
          <button class="btn btn-ghost btn-xs" [disabled]="state.loading()" (click)="refresh()">Refresh</button>
        </div>
        @if (state.result(); as result) {
          @if (result.status === 'available' || result.status === 'stale') {
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div aria-label="Account quota">
                <p class="text-xs font-medium">Quota</p>
                <p class="text-xs">Primary used: {{ result.quota?.primary?.usedPercent ?? 'Unavailable' }}{{ result.quota?.primary ? '%' : '' }}</p>
                @if (result.quota?.secondary; as secondary) { <p class="text-xs">Secondary used: {{ secondary.usedPercent }}%</p> }
              </div>
              <div aria-label="Account activity">
                <p class="text-xs font-medium">Activity</p>
                <p class="text-xs">Lifetime tokens: {{ result.activity?.lifetimeTokens ?? 'Unavailable' }}</p>
                <p class="text-[10px] text-base-content-muted">Activity is not remaining messages, credits, or billing.</p>
              </div>
            </div>
            @if (result.status === 'stale') { <p class="text-warning text-[10px] mt-2">Showing cached account data; refresh failed at {{ result.staleSince | date:'medium' }}.</p> }
          } @else {
            <p class="text-xs text-base-content-muted mt-3">Account usage unavailable: {{ result.status }}</p>
          }
        } @else if (state.loading()) {
          <span class="loading loading-spinner loading-xs mt-3" aria-label="Loading account usage"></span>
        }
      </section>
    }
  `,
})
export class ProviderAccountCardComponent {
  readonly state = inject(ProviderAccountStateService);
  private readonly providerWatcher = effect(() => {
    const providerId = this.state.providerId();
    untracked(() => this.state.activateProvider(providerId));
  });
  refresh(): void { void this.state.load(true); }
}
