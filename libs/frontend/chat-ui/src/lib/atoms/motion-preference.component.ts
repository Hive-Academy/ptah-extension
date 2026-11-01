import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';

type MotionPreference = 'always' | 'system' | 'reduce';

@Component({
  selector: 'ptah-motion-preference',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="mt-3 border-t border-base-content/20 px-2 pt-3">
      <legend class="text-xs font-semibold">Motion</legend>
      <div class="grid gap-1 pt-2">
        @for (option of options; track option.value) {
          <label class="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 hover:bg-base-300">
            <input type="radio" class="radio radio-xs mt-0.5" [attr.name]="group"
              [checked]="preference() === option.value"
              [disabled]="saving()"
              (change)="setPreference(option.value)" />
            <span class="grid text-xs"><span class="font-semibold">{{ option.label }}</span>
              <span class="opacity-70">{{ option.description }}</span></span>
          </label>
        }
      </div>
      @if (restartNeeded()) {
        <p class="mt-2 text-xs" role="status">Restart Ptah to apply</p>
      }
      @if (error()) {
        <p class="mt-2 text-xs text-error" role="alert">Motion setting is unavailable.</p>
      }
    </fieldset>
  `,
})
export class MotionPreferenceComponent {
  private static sequence = 0;
  private readonly rpc = inject(ClaudeRpcService);
  protected readonly group = `ptah-motion-${++MotionPreferenceComponent.sequence}`;
  protected readonly preference = signal<MotionPreference>('always');
  protected readonly saving = signal(false);
  protected readonly restartNeeded = signal(false);
  protected readonly error = signal(false);
  protected readonly options = [
    { value: 'always', label: 'Always animate', description: 'Show Ptah animations.' },
    { value: 'system', label: 'Follow system', description: 'Use your device setting.' },
    { value: 'reduce', label: 'Reduce motion', description: 'Minimize animations.' },
  ] as const;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const result = await this.rpc.call('settings:getMotion', {});
      if (result.isSuccess() && result.data.success && result.data.preference) {
        this.preference.set(result.data.preference);
      } else {
        this.error.set(true);
      }
    } catch {
      this.error.set(true);
    }
  }

  protected async setPreference(preference: MotionPreference): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(false);
    try {
      const result = await this.rpc.call('settings:setMotion', { preference });
      if (result.isSuccess() && result.data.success) {
        this.preference.set(preference);
        this.restartNeeded.set(true);
      } else {
        this.error.set(true);
      }
    } catch {
      this.error.set(true);
    } finally {
      this.saving.set(false);
    }
  }
}
