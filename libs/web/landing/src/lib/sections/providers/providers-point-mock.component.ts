import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Initials as the connection card computes them (connectionInitials: one
 * word -> its first two letters), with the card's three avatar tones.
 */
const PROVIDER_AVATARS: readonly { readonly initials: string; readonly tone: string }[] = [
  { initials: 'CL', tone: 'is-primary' },
  { initials: 'CO', tone: 'is-secondary' },
  { initials: 'CO', tone: 'is-info' },
  { initials: 'OP', tone: 'is-primary' },
  { initials: 'OL', tone: 'is-secondary' },
];

/**
 * The app fragment under each S8 point:
 * 0 - the providers' connection-card avatars, one per named provider;
 * 1 - two Accounts-tab rows (accounts-tab / ambient-account-row): round
 *     initial, name, status dot "Signed in", and "Used by" chips that differ
 *     per account ("Chat", "Lanes"). The ambient row's name is the app's own
 *     "Existing Claude login"; a named account's label is the user's, so it
 *     is drawn as a bar.
 * Point 2 is the Setup Hub still itself, so it has no fragment.
 */
@Component({
  selector: 'ptah-providers-point-mock',
  standalone: true,
  template: `
    @switch (index()) {
      @case (0) {
        <span class="avatars" aria-hidden="true">
          @for (avatar of avatars; track $index) {
            <span class="app-avatar" [class]="avatar.tone">{{ avatar.initials }}</span>
          }
        </span>
      }
      @case (1) {
        <span class="accounts" aria-hidden="true">
          <span class="account">
            <span class="app-avatar is-round">E</span>
            <span class="account-name">Existing Claude login</span>
            <span class="account-state app-muted"><span class="app-dot is-ok"></span>Signed in</span>
            <span class="account-used app-muted">Used by <span class="app-chip">Chat</span></span>
          </span>
          <span class="account">
            <span class="app-avatar is-round"></span>
            <span class="account-name"><span class="name-bar"></span></span>
            <span class="account-state app-muted"><span class="app-dot is-ok"></span>Signed in</span>
            <span class="account-used app-muted">Used by <span class="app-chip">Lanes</span></span>
          </span>
        </span>
      }
    }
  `,
  styleUrls: ['../shared/app-mock.css', './providers-point-mock.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersPointMockComponent {
  public readonly index = input.required<number>();
  protected readonly avatars = PROVIDER_AVATARS;
}
