import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { SkillTriggersDto } from '@ptah-extension/shared';

import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';
import {
  SkillTriggerChange,
  SkillTriggerToggleComponent,
} from './skill-trigger-toggle.component';

/** Idle trigger delay applied when the idle toggle is switched on. */
const IDLE_ON_DEFAULT_MS = 600_000;
/** Hourly analyze cap applied when the cap toggle is switched on. */
const MAX_ANALYZES_ON_DEFAULT = 60;

/**
 * A numeric trigger's next value: the typed number, or for the checkbox the
 * default when switched on and 0 (disabled) when switched off.
 */
function numericOrSwitched(value: boolean | number, onDefault: number): number {
  if (typeof value === 'number') return value;
  return value ? onDefault : 0;
}

/**
 * Skills Settings card for the synthesis triggers.
 *
 * Unlike the batched settings form beside it, every control saves on its own,
 * immediately, through `skillSynthesis:setTriggers`
 * ({@link SkillDiagnosticsStateService.setTriggers}). Until the first
 * diagnostics snapshot resolves the controls show the state service's default
 * triggers. This card neither starts the diagnostics poll nor touches the
 * settings form.
 */
@Component({
  selector: 'ptah-skill-triggers-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkillTriggerToggleComponent],
  template: `
    <section
      class="max-w-2xl overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
      aria-label="Triggers"
      data-test="panel-triggers"
    >
      <h2 class="text-sm font-semibold">Triggers</h2>
      <p class="mt-1 text-xs text-base-content-muted">
        Changes here save immediately.
      </p>
      <div class="mt-2 flex flex-col gap-2">
        <ptah-skill-trigger-toggle
          key="sessionEnd"
          label="Session end"
          [enabled]="triggers().sessionEnd"
          (triggerChange)="onTriggerChange($event)"
        />
        <ptah-skill-trigger-toggle
          key="idleMs"
          label="Idle (ms)"
          [enabled]="triggers().idleMs > 0"
          [numericValue]="triggers().idleMs"
          (triggerChange)="onTriggerChange($event)"
        />
        <ptah-skill-trigger-toggle
          key="bootScan"
          label="Boot scan"
          [enabled]="triggers().bootScan"
          (triggerChange)="onTriggerChange($event)"
        />
        <ptah-skill-trigger-toggle
          key="subagentStop"
          label="Subagent stop"
          [enabled]="triggers().subagentStop?.enabled ?? false"
          (triggerChange)="onTriggerChange($event)"
        />
        <ptah-skill-trigger-toggle
          key="turnComplete"
          label="Turn complete"
          [enabled]="triggers().turnComplete?.enabled ?? false"
          (triggerChange)="onTriggerChange($event)"
        />
        <ptah-skill-trigger-toggle
          key="postToolUse"
          label="PostToolUse (edit+test)"
          [enabled]="triggers().postToolUse?.enabled ?? false"
          (triggerChange)="onTriggerChange($event)"
        />
        <ptah-skill-trigger-toggle
          key="postToolUseMinEditCount"
          label="Min edit count"
          [enabled]="triggers().postToolUse?.enabled ?? false"
          [numericValue]="triggers().postToolUse?.minEditCount ?? 0"
          [min]="1"
          [max]="20"
          (triggerChange)="onTriggerChange($event)"
        />
        <ptah-skill-trigger-toggle
          key="maxAnalyzesPerHour"
          label="Max analyzes per hour"
          [enabled]="(triggers().maxAnalyzesPerHour ?? 0) > 0"
          [numericValue]="triggers().maxAnalyzesPerHour ?? 0"
          [min]="0"
          [max]="1000"
          (triggerChange)="onTriggerChange($event)"
        />
      </div>
      @if (error(); as err) {
        <p
          class="mt-2 break-words text-xs text-error"
          role="alert"
          data-test="triggers-error"
        >
          {{ err }}
        </p>
      }
    </section>
  `,
})
export class SkillTriggersSettingsComponent {
  private readonly state = inject(SkillDiagnosticsStateService);

  protected readonly triggers = this.state.triggers;
  protected readonly error = this.state.error;

  protected onTriggerChange(change: SkillTriggerChange): void {
    const partial = this.toPartial(change);
    if (partial !== null) void this.state.setTriggers(partial);
  }

  /** Maps one control change to the `setTriggers` payload it persists. */
  private toPartial(
    change: SkillTriggerChange,
  ): Partial<SkillTriggersDto> | null {
    const { key, value } = change;
    switch (key) {
      case 'sessionEnd':
        return typeof value === 'boolean' ? { sessionEnd: value } : null;
      case 'idleMs':
        return { idleMs: numericOrSwitched(value, IDLE_ON_DEFAULT_MS) };
      case 'bootScan':
        return typeof value === 'boolean' ? { bootScan: value } : null;
      case 'subagentStop':
        return typeof value === 'boolean'
          ? { subagentStop: { enabled: value } }
          : null;
      case 'turnComplete':
        return typeof value === 'boolean'
          ? { turnComplete: { enabled: value } }
          : null;
      case 'postToolUse':
        return typeof value === 'boolean'
          ? {
              postToolUse: {
                enabled: value,
                minEditCount: this.triggers().postToolUse?.minEditCount ?? 1,
              },
            }
          : null;
      case 'postToolUseMinEditCount':
        return typeof value === 'number'
          ? {
              postToolUse: {
                enabled: this.triggers().postToolUse?.enabled ?? false,
                minEditCount: value,
              },
            }
          : null;
      case 'maxAnalyzesPerHour':
        return {
          maxAnalyzesPerHour: numericOrSwitched(value, MAX_ANALYZES_ON_DEFAULT),
        };
    }
  }
}
