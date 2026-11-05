import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { ReviewRunsStore } from '../review-runs.store';

@Component({
  selector: 'ptah-review-bot-identity',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
            <section class="space-y-2">
              <h3 class="font-semibold">GitHub bot identity</h3>
              @if (store.tokenStorage() === 'plaintext') {
                <p role="alert" class="alert alert-warning text-sm">
                  This bot token is stored as plaintext because system
                  encryption is unavailable.
                </p>
              }
              @if (store.botIdentity(); as bot) {
                <p class="text-sm">Connected as {{ bot.login }}</p>
                <p class="text-xs text-base-content-muted">
                  @if (bot.scopes.length) {
                    Reported scopes: {{ bot.scopes.join(', ') }} |
                  }
                  Connected {{ bot.connectedAt }}
                  @if (bot.verifiedAt) {
                    | Verified {{ bot.verifiedAt }}
                  }
                </p>
              } @else {
                <p class="text-sm text-base-content-muted">
                  {{
                    hasToken()
                      ? 'Bot identity unavailable. Verify connection.'
                      : 'No bot connected. Live publication is unavailable.'
                  }}
                </p>
              }
              <label class="block text-sm" for="review-bot-token">{{
                hasToken() ? 'Replace bot token' : 'Connect bot token'
              }}</label>
              <input
                #tokenInput
                id="review-bot-token"
                type="password"
                autocomplete="new-password"
                class="input input-bordered w-full"
              />
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  [disabled]="store.credentialState() === 'saving'"
                  (click)="submitted.emit(tokenInput)"
                >
                  Save token
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  (click)="store.loadBotIdentity()"
                >
                  Verify connection
                </button>
                @if (hasToken()) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    (click)="removeRequested.emit()"
                  >
                    Remove connection
                  </button>
                }
              </div>
              @if (store.botIdentityError(); as identityError) {
                <p role="alert" class="text-sm text-error">{{ identityError }}</p>
              }
              @if (store.credentialState() === 'error') {
                <p role="alert" class="text-sm text-error">
                  Credential update failed. Retry.
                </p>
              }
            </section>
  `,
})
export class ReviewBotIdentityComponent {
  readonly store = inject(ReviewRunsStore);
  readonly hasToken = input(false);
  readonly submitted = output<HTMLInputElement>();
  readonly removeRequested = output<void>();
}
