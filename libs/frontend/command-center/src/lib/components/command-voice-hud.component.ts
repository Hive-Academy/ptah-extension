import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  CommandProviderReadiness,
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
      <p class="text-sm font-semibold">Voice · {{ statusText() }}</p>
      @if (errorKind() === 'mic-denied') {
        <p class="mt-1 text-sm" role="status">
          Microphone permission was denied.
        </p>
        <button
          type="button"
          class="btn btn-link min-h-11 px-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-warning"
          (click)="openVoiceSettings.emit()"
        >
          Open Voice settings
        </button>
      } @else if (!provider().transcription || !provider().synthesis) {
        <p class="mt-1 text-sm" role="status">A voice provider is missing.</p>
        <button
          type="button"
          class="btn btn-link min-h-11 px-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-warning"
          (click)="openVoiceSettings.emit()"
        >
          Open Voice settings
        </button>
      } @else if (errorKind() === 'transcription') {
        <p class="mt-1 text-sm" role="status">
          Transcription failed. Try again or use text.
        </p>
      } @else if (errorKind() === 'playback') {
        <p class="mt-1 text-sm" role="status">
          Audio playback failed. Try again or use text.
        </p>
      } @else if (errorKind() === 'chat') {
        <p class="mt-1 text-sm" role="status">
          The chat turn failed. Try again or use text.
        </p>
      }
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-warning min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          [disabled]="!canStart()"
          (click)="start.emit()"
        >
          Start voice
        </button>
        <button
          type="button"
          class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          [disabled]="!canStop()"
          (click)="stop.emit()"
        >
          Stop
        </button>
        <button
          type="button"
          class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          [disabled]="!canStop()"
          (click)="toggleMute.emit()"
        >
          {{ muted() ? 'Unmute' : 'Mute' }}
        </button>
        <button
          type="button"
          class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          [disabled]="voiceState() !== 'speaking'"
          (click)="interrupt.emit()"
        >
          Interrupt speech
        </button>
      </div>
    </section>
  `,
})
export class CommandVoiceHudComponent {
  public readonly voiceState = input.required<CommandVoiceState>();
  public readonly provider = input.required<CommandProviderReadiness>();
  public readonly muted = input(false);
  public readonly turnAbortable = input(false);
  public readonly errorKind = input<
    'mic-denied' | 'transcription' | 'playback' | 'chat' | null
  >(null);
  public readonly start = output<void>();
  public readonly stop = output<void>();
  public readonly toggleMute = output<void>();
  public readonly interrupt = output<void>();
  public readonly openVoiceSettings = output<void>();
  public readonly canStop = computed(
    () =>
      this.turnAbortable() ||
      ['listening', 'thinking', 'speaking', 'muted'].includes(
        this.voiceState(),
      ),
  );
  public readonly canStart = computed(
    () =>
      !this.canStop() &&
      this.provider().transcription &&
      this.provider().synthesis &&
      this.errorKind() !== 'mic-denied',
  );
  public readonly statusText = computed(() =>
    this.muted()
      ? 'Muted'
      : this.voiceState() === 'speaking'
        ? 'Speaking'
        : this.voiceState() === 'thinking'
          ? 'Thinking'
          : this.voiceState() === 'listening'
            ? 'Listening'
            : this.voiceState() === 'error'
              ? 'Error'
              : this.voiceState() === 'stopped'
                ? 'Stopped'
                : 'Idle',
  );
}
