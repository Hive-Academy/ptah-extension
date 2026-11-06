import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Header of the loop window, drawn as the app's open "Background Model Roles"
 * accordion summary (agents-routing-settings.component.ts): info chevron, the
 * title, the info-tinted "3 roles" badge and the muted role list. Its bottom
 * hairline fills with the loop progress (`--loop-progress` from the window).
 * Decorative: every word is the app's own label.
 */
@Component({
  selector: 'ptah-decision-loop-roles-bar',
  standalone: true,
  template: `
    <div class="roles-bar" aria-hidden="true">
      <svg class="roles-chevron" viewBox="0 0 16 16" fill="none">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="roles-title">Background Model Roles</span>
      <span class="app-badge is-info">3 roles</span>
      <span class="roles-list app-muted">Memory curator, enhancement, decision</span>
    </div>
    <span class="roles-progress" aria-hidden="true"><span class="roles-progress-fill"></span></span>
  `,
  styleUrls: ['../shared/app-mock.css', './decision-loop-roles-bar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionLoopRolesBarComponent {}
