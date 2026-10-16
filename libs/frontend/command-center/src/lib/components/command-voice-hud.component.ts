import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  CommandProviderReadiness,
  CommandVoiceError,
  CommandVoiceState,
} from '../model/command-center.store';

/** Controls for the page-owned voice loop; all actions are explicit user intents. */
@Component({
  selector: 'ptah-command-voice-hud',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-xl border border-base-300 bg-base-200 p-3 text-base-content"
      aria-label="Voice controls"
    >
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-warning bg-base-100 text-warning shadow-sm transition-colors hover:bg-warning hover:text-warning-content hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning disabled:opacity-60"
          [attr.aria-label]="listening() ? 'Stop listening' : 'Start voice'"
          [attr.aria-pressed]="listening()"
          [disabled]="!listening() && !canStart()"
          (click)="listening() ? stop.emit() : start.emit()"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            class="h-6 w-6 fill-none stroke-current stroke-2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" />
          </svg>
        </button>
        <div class="min-w-[8rem] flex-1">
          <p class="text-sm font-semibold">{{ title() }}</p>
          <p class="text-xs text-base-content-muted">{{ subtitle() }}</p>
        </div>
        <div
          class="flex h-8 items-center gap-1"
          role="meter"
          aria-label="Microphone level"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="levelPercent()"
        >
          @for (bar of meterBars; track bar) {
            <span
              class="w-1 rounded-full bg-warning"
              [class.h-2]="levelPercent() < bar"
              [class.h-5]="levelPercent() >= bar"
              aria-hidden="true"
            ></span>
          }
        </div>
        <button
          type="button"
          class="btn btn-ghost min-h-11 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          [disabled]="!canStop()"
          (click)="toggleMute.emit()"
        >
          {{ muted() ? 'Unmute' : 'Mute' }}
        </button>
        <button
          type="button"
          class="btn btn-ghost min-h-11 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          [disabled]="!canStop()"
          (click)="stop.emit()"
        >
          Stop
        </button>
        @if (voiceState() === 'speaking') {
          <button
            type="button"
            class="btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
            (click)="interrupt.emit()"
          >
            Interrupt speech
          </button>
        }
      </div>
      @if (voiceError(); as error) {
        <div
          class="mt-2 flex flex-wrap items-center gap-2 text-sm"
          role="status"
        >
          <span>{{ error.message }}</span>
          <button
            type="button"
            class="btn btn-ghost min-h-11 text-base-content underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
            (click)="openVoiceSettings.emit()"
          >
            Open Voice settings
          </button>
        </div>
      } @else if (!provider().transcription || !provider().synthesis) {
        <div
          class="mt-2 flex flex-wrap items-center gap-2 text-sm"
          role="status"
        >
          <span>A voice provider is missing.</span>
          <button
            type="button"
            class="btn btn-ghost min-h-11 text-base-content underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
            (click)="openVoiceSettings.emit()"
          >
            Open Voice settings
          </button>
        </div>
      }
    </section>
  `,
})
export class CommandVoiceHudComponent {
  public readonly voiceState = input.required<CommandVoiceState>();
  public readonly provider = input.required<CommandProviderReadiness>();
  public readonly muted = input(false);
  public readonly turnAbortable = input(false);
  public readonly voiceError = input<CommandVoiceError | null>(null);
  public readonly inputLevel = input(0);
  public readonly start = output<void>();
  public readonly stop = output<void>();
  public readonly toggleMute = output<void>();
  public readonly interrupt = output<void>();
  public readonly openVoiceSettings = output<void>();
  public readonly meterBars = [15, 30, 45, 60, 75, 90] as const;
  public readonly levelPercent = computed(() =>
    Math.round(this.inputLevel() * 100),
  );
  public readonly listening = computed(() => this.voiceState() === 'listening');
  public readonly canStop = computed(
    () =>
      this.turnAbortable() ||
      ['listening', 'thinking', 'speaking', 'muted'].includes(
        this.voiceState(),
      ),
  );
  public readonly canStart = computed(() => !this.canStop());
  public readonly title = computed(() =>
    this.voiceError()
      ? 'Voice needs attention'
      : this.muted()
        ? 'Microphone muted'
        : this.voiceState() === 'listening'
          ? 'Listening to you'
          : this.voiceState() === 'thinking'
            ? 'Ptah is thinking'
            : this.voiceState() === 'speaking'
              ? 'Ptah is speaking'
              : 'Ready for your voice',
  );
  public readonly subtitle = computed(() =>
    this.voiceError()
      ? 'Use text or recover voice'
      : this.muted()
        ? 'Click Unmute to listen'
        : this.voiceState() === 'listening'
          ? 'Mic level is live'
          : this.voiceState() === 'thinking'
            ? 'Preparing a concise update'
            : this.voiceState() === 'speaking'
              ? 'Playing Ptah audio'
              : 'Say a command to Ptah',
  );
}
