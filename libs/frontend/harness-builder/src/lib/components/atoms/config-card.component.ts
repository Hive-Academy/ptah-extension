/**
 * ConfigCardComponent
 *
 * Reusable card component for displaying agent, skill, or MCP server entries
 * with a toggle switch for enable/disable and an optional badge.
 *
 * Level 1 component: simple presentational card with input/output contract.
 */

import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'ptah-config-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="card card-compact bg-base-100 shadow-sm border border-base-300 transition-all hover:shadow-md"
      [class.border-primary]="enabled()"
      [class.opacity-60]="!enabled()"
    >
      <div class="card-body flex-row items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="card-title text-sm font-medium truncate">
              {{ title() }}
            </h3>
            @if (badge()) {
              <span class="badge badge-primary badge-xs">{{ badge() }}</span>
            }
          </div>
          @if (description()) {
            <p class="text-xs text-base-content/60 mt-0.5 line-clamp-2">
              {{ description() }}
            </p>
          }
        </div>
        <input
          type="checkbox"
          class="toggle toggle-sm toggle-primary"
          [checked]="enabled()"
          (change)="toggled.emit(!enabled())"
          [attr.aria-label]="'Toggle ' + title()"
        />
      </div>
    </div>
  `,
})
export class ConfigCardComponent {
  public readonly title = input.required<string>();
  public readonly description = input<string>('');
  public readonly enabled = input<boolean>(false);
  public readonly badge = input<string>('');

  public readonly toggled = output<boolean>();
}
