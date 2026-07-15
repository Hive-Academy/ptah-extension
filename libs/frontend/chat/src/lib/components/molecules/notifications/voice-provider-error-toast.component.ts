import {
  Component,
  inject,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  AlertTriangle,
  RotateCcw,
  X,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { VoiceProviderErrorService } from '../../../services/voice-provider-error.service';

/**
 * Switch-to-local toast for cloud voice-provider failures (FR-7.2, FR-7.4).
 * Reads the latest `VoiceProviderError` from `VoiceProviderErrorService` and
 * renders a categorized notice with a single **Switch to local** action.
 *
 * The action calls `voice:setProviderConfig { [direction]Provider: 'local' }`,
 * then (on success) dismisses the toast and re-reads `voice:getProviderConfig`
 * so any open settings surface reflects the change. It NEVER auto-applies the
 * switch (FR-7.3) — the user must click. Self-contained: injects the root error
 * service directly, so it only needs to be placed once in the notifications area.
 */
@Component({
  selector: 'ptah-voice-provider-error-toast',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as err) {
      <div class="px-2 py-1">
        <div
          class="relative bg-base-300/30 rounded border border-error/40"
          role="alert"
          aria-label="Voice provider error"
          data-testid="voice-provider-error-toast"
        >
          <div class="py-1.5 px-2 flex items-center gap-1.5 text-[11px]">
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="w-3 h-3 text-error flex-shrink-0"
              aria-hidden="true"
            />
            <span class="font-semibold text-base-content/80">
              {{ directionLabel() }} failed
            </span>
            <span class="badge badge-xs badge-error badge-outline px-1.5">
              {{ categoryLabel() }}
            </span>
            <span class="flex-1"></span>
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square h-5 w-5 min-h-0"
              [disabled]="isSwitching()"
              (click)="dismiss()"
              title="Dismiss"
              aria-label="Dismiss voice provider error"
            >
              <lucide-angular [img]="XIcon" class="w-3 h-3 opacity-50" />
            </button>
          </div>

          <div
            class="px-2 pb-2 flex items-center gap-2 border-t border-base-300/30 pt-1.5"
          >
            <span
              class="text-[10px] text-base-content/70 flex-1"
              data-testid="voice-provider-error-message"
            >
              {{ err.message }}
            </span>
            <button
              type="button"
              class="btn btn-xs btn-primary gap-0.5 px-2"
              [disabled]="isSwitching()"
              (click)="switchToLocal()"
              data-testid="voice-provider-switch-local"
            >
              <lucide-angular
                [img]="RotateCcwIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              {{ isSwitching() ? 'Switching…' : 'Switch to local' }}
            </button>
          </div>

          @if (switchError(); as message) {
            <div
              class="px-2 pb-2 text-[10px] text-error"
              data-testid="voice-provider-switch-error"
            >
              {{ message }}
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class VoiceProviderErrorToastComponent {
  private readonly errorService = inject(VoiceProviderErrorService);
  private readonly rpc = inject(ClaudeRpcService);

  readonly AlertTriangleIcon = AlertTriangle;
  readonly RotateCcwIcon = RotateCcw;
  readonly XIcon = X;

  readonly error = this.errorService.latestError;
  readonly isSwitching = signal(false);
  readonly switchError = signal<string | null>(null);

  readonly directionLabel = computed(() =>
    this.error()?.direction === 'stt' ? 'Speech-to-text' : 'Text-to-speech',
  );

  readonly categoryLabel = computed(() => {
    switch (this.error()?.category) {
      case 'auth':
        return 'Authentication';
      case 'quota':
        return 'Quota';
      case 'network':
        return 'Network';
      default:
        return 'Provider error';
    }
  });

  dismiss(): void {
    this.switchError.set(null);
    this.errorService.dismiss();
  }

  async switchToLocal(): Promise<void> {
    const current = this.error();
    if (!current || this.isSwitching()) return;
    this.switchError.set(null);
    this.isSwitching.set(true);
    try {
      const result = await this.rpc.call(
        'voice:setProviderConfig',
        current.direction === 'stt'
          ? { sttProvider: 'local' }
          : { ttsProvider: 'local' },
      );
      if (result.isSuccess() && result.data.ok) {
        // Re-read so any open settings surface reflects the switch (FR-7.4).
        await this.rpc.call(
          'voice:getProviderConfig',
          {} as Record<string, never>,
        );
        this.errorService.dismiss();
      } else {
        this.switchError.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to switch to local provider'),
        );
      }
    } catch (error: unknown) {
      this.switchError.set(
        error instanceof Error
          ? error.message
          : 'Failed to switch to local provider',
      );
    } finally {
      this.isSwitching.set(false);
    }
  }
}
