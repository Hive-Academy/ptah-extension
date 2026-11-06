import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Settings -> Providers connection card for the Claude subscription, drawn
 * from provider-connection-card.component.ts: the two-letter initials
 * avatar (connectionInitials, primary tone), the name and its provenance
 * line (authModalityLabel "CLI subscription"), the status dot and label
 * (connectionStateLabel "Active for main agent", bg-success) and the outline
 * modality badge (authModalityBadge "CLI"). The active state carries the
 * card's primary spine. It stands for the subline: the named account is
 * checked live before the main agent uses it. Decorative.
 */
@Component({
  selector: 'ptah-providers-connection-card',
  standalone: true,
  template: `
    <div class="conn app-card" aria-hidden="true">
      <span class="app-avatar">CL</span>
      <span class="conn-name">
        <span class="conn-title">Claude</span>
        <span class="conn-sub app-muted">CLI subscription</span>
      </span>
      <span class="conn-status">
        <span class="app-dot is-ok"></span>
        <span>Active for main agent</span>
      </span>
      <span class="app-badge is-outline">CLI</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .conn.app-card {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5em 0.75em;
      padding: 0.75em 0.9em;
      border-color: rgb(228 185 74 / 35%);
      border-left: 3px solid var(--app-primary);
      border-radius: 0.75em;
      background: var(--app-b2);
      box-shadow: 0 1.25rem 3rem rgb(0 0 0 / 60%);
    }

    .conn-name {
      display: flex;
      min-width: 7em;
      flex: 1;
      flex-direction: column;
    }

    .conn-title {
      font-size: 0.875em;
      font-weight: 600;
      line-height: 1.35;
    }

    .conn-sub {
      font-size: 0.75em;
      line-height: 1.35;
    }

    .conn-status {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      font-size: 0.75em;
      font-weight: 500;
      white-space: nowrap;
    }
  `,
  styleUrls: ['../shared/app-mock.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersConnectionCardComponent {}
