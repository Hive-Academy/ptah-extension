import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const NOT_SAVED = 'Could not save Copilot auto-approve. The saved setting is unchanged.';
const NOT_CONFIRMED = 'Could not confirm whether Copilot auto-approve was saved. Check the saved setting again before changing it.';

/**
 * Copilot auto-approve, moved from `agent-orchestration-config.component.ts:466-581` (plan :739-741) into Copilot's
 * permission popover in the CLI matrix. Copilot only: `AgentSpawnEnvironment.resolveAutoApprove` reads
 * `copilotAutoApprove` and ignores Codex. The write applies live to the permission bridge
 * (`agent-rpc.handlers.ts:339-351`) and at the next spawn (plan §3 row 896).
 *
 * The uncertain-write logic is kept; the write now goes through `state.saveSettings({orchestration:{copilotAutoApprove}})`
 * and `SettingsSaveFeedbackService` (toast + Undo) instead of a private `agent:setConfig` call, and the commit's
 * read-back replaces the private `agent:getConfig` read:
 * - `saved`: the re-read value is shown.
 * - nothing written (`failed`, `partial`, `blocked`): the re-read value is shown with "… The saved setting is unchanged."
 *   when it is not the requested one.
 * - outcome unknown (`unconfirmed`), or no readable value after the write: the toggle shows no value (indeterminate) and
 *   takes no writes until "Check saved setting again" (`state.refreshOrchestration()`) reads it.
 * The checkbox never shows a value that was not read back (D15).
 */
@Component({
  selector: 'ptah-copilot-auto-approve-toggle',
  standalone: true,
  imports: [SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-1.5 border-t border-base-300 pt-2" data-testid="copilot-auto-approve-section">
      <label class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-base-content">Auto-approve Copilot tool calls</span>
        <input type="checkbox" [class]="'toggle toggle-xs toggle-success ' + focusRing"
          [checked]="saved() ?? false" [indeterminate]="needsRecheck()"
          [ptahBusyDisabled]="saving() || needsRecheck() || feedback.saving()"
          (change)="toggle($event)" aria-label="Auto-approve Copilot tool calls" data-testid="copilot-auto-approve" />
      </label>
      @if (error(); as message) {
        <p class="text-xs text-base-content" role="alert" data-testid="copilot-auto-approve-error">{{ message }}</p>
      } @else if (saved() === null) {
        <p class="text-xs text-base-content-muted" role="status" data-testid="copilot-auto-approve-unloaded">The saved setting could not be read.</p>
      }
      @if (needsRecheck()) {
        <button type="button" [class]="'btn btn-outline btn-xs min-h-7 border-base-content-muted text-base-content ' + focusRing"
          [ptahBusyDisabled]="saving()" (click)="recheck()" data-testid="copilot-auto-approve-recheck">Check saved setting again</button>
      }
    </div>
  `,
})
export class CopilotAutoApproveToggleComponent {
  protected readonly focusRing = FOCUS;
  private readonly state = inject(ProvidersSettingsStateService);
  protected readonly feedback = inject(SettingsSaveFeedbackService);

  /** The saved value as last read, or `null` when the orchestration read has no data. */
  protected readonly saved = computed(() => {
    const value = this.state.orchestration().data?.copilotAutoApprove;
    return typeof value === 'boolean' ? value : null;
  });
  /** True while this toggle's write or re-read runs; the toggle is disabled meanwhile. */
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** A write's outcome is unknown: no value is shown and no write is taken until a re-read succeeds. */
  protected readonly unconfirmed = signal(false);
  protected readonly needsRecheck = computed(() => this.unconfirmed() || this.saved() === null);

  async toggle(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const saved = this.saved();
    // The checkbox keeps showing the saved value; the read-back after the write moves it.
    input.checked = saved ?? false;
    const context = this.state.reviewContext();
    if (saved === null || this.saving() || this.unconfirmed() || !context) return;
    const next = !saved;
    this.saving.set(true);
    this.error.set(null);
    try {
      // The state method's own answer: `refused` (another save in flight, nothing written), `started` (the commit
      // describes this write), `threw` (the command broke: its outcome is unknown), `skipped` (never called).
      const result: { attempt: 'skipped' | 'threw' | 'refused' | 'started' } = { attempt: 'skipped' };
      await this.feedback.save({
        label: 'Copilot auto-approve', scope: 'global',
        write: async () => {
          result.attempt = 'threw';
          const started = await this.state.saveSettings({ orchestration: { copilotAutoApprove: next } }, context);
          result.attempt = started ? 'started' : 'refused';
          return started;
        },
        undo: () => this.state.saveSettings({ orchestration: { copilotAutoApprove: saved } }, context),
      });
      if (result.attempt === 'started') this.settle(next);
      else if (result.attempt === 'threw') this.markUnconfirmed();
    } finally {
      this.saving.set(false);
    }
  }

  /** Re-reads the saved value after an unconfirmed write; accepts writes again once it reads one. */
  async recheck(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.state.refreshOrchestration();
      if (this.state.orchestration().status === 'ready' && this.saved() !== null) {
        this.unconfirmed.set(false);
        this.error.set(null);
      } else {
        this.markUnconfirmed();
      }
    } finally {
      this.saving.set(false);
    }
  }

  private settle(requested: boolean): void {
    const commit = this.state.commit();
    if (commit.status === 'unconfirmed' || this.saved() === null) {
      this.markUnconfirmed();
      return;
    }
    if (this.saved() !== requested) this.error.set(NOT_SAVED);
  }

  private markUnconfirmed(): void {
    this.unconfirmed.set(true);
    this.error.set(NOT_CONFIRMED);
  }
}
