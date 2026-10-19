import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule, Mic } from 'lucide-angular';
import type { CommandProviderReadiness, CommandVoiceError, CommandVoiceState } from '../model/command-center.store';

/** Controls for the page-owned voice loop; all actions are explicit user intents. */
@Component({
  selector: 'ptah-command-voice-hud',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="voice-hud text-base-content" aria-label="Voice controls">
      <div class="voice-identity flex min-w-0 items-center gap-3">
        <button type="button"
          class="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-warning bg-base-100 text-warning shadow-sm transition-colors hover:bg-warning hover:text-warning-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content disabled:border-base-300 disabled:text-base-content-muted"
          [attr.aria-label]="listening() ? 'Stop listening' : 'Start voice'"
          [attr.aria-pressed]="listening()"
          [disabled]="!listening() && !canStart()"
          (click)="listening() ? stop.emit() : start.emit()">
          <lucide-angular [img]="Mic" class="h-6 w-6" aria-hidden="true" />
        </button>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <p class="truncate text-sm font-semibold">{{ title() }}</p>
            @if (voiceState() === 'speaking') {
              <span class="speaking-wave flex h-6 shrink-0 items-center gap-1" data-dock-waveform aria-hidden="true">
                @for (bar of speakerBars; track bar) {
                  <span class="w-1 rounded-full bg-warning" [class.h-2]="outputPercent() < bar" [class.h-5]="outputPercent() >= bar"></span>
                }
              </span>
            }
          </div>
          <p class="text-xs text-base-content-muted">{{ subtitle() }}</p>
        </div>
      </div>
      <div class="voice-actions flex flex-wrap items-center gap-2">
        <div class="flex h-8 items-center gap-1" role="meter" aria-label="Microphone level"
          aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="levelPercent()"
          [attr.aria-valuetext]="'Microphone level ' + levelPercent() + '%'">
          @for (bar of meterBars; track bar) {
            <span class="w-1 rounded-full bg-warning" [class.h-2]="levelPercent() < bar" [class.h-5]="levelPercent() >= bar" aria-hidden="true"></span>
          }
        </div>
        @if (voiceState() === 'speaking') {
          <div class="flex h-8 items-center gap-1" role="meter" aria-label="Speaker"
            aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="outputPercent()"
            [attr.aria-valuetext]="'Speaker level ' + outputPercent() + '%'">
            @for (bar of speakerBars; track bar) {
              <span class="w-1 rounded-full bg-warning" [class.h-2]="outputPercent() < bar" [class.h-5]="outputPercent() >= bar" aria-hidden="true"></span>
            }
          </div>
        }
        <button type="button" class="btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [disabled]="!canMute()" (click)="toggleMute.emit()">{{ muted() ? 'Unmute' : 'Mute' }}</button>
        <button type="button" class="btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [disabled]="!canStopTurn()" (click)="stop.emit()">Stop</button>
        @if (voiceState() === 'speaking') {
          <button type="button" class="btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            (click)="interrupt.emit()">Interrupt speech</button>
        }
      </div>
      @if (voiceError(); as error) {
        <div class="voice-recovery mt-2 flex flex-wrap items-center gap-2 text-sm" role="status">
          <span>{{ error.message }}</span>
          @if (error.kind === 'mic-denied') {
            <button type="button" class="btn btn-ghost min-h-11 text-base-content underline" (click)="openVoiceSettings.emit()">Open Voice settings</button>
          } @else if (error.kind === 'mic-unavailable' || error.kind === 'worklet') {
            <button type="button" class="btn btn-ghost min-h-11 border border-base-content text-base-content underline" (click)="start.emit()">Retry microphone</button>
          }
        </div>
      } @else if (!provider().transcription || !provider().synthesis) {
        <div class="voice-recovery mt-2 flex flex-wrap items-center gap-2 text-sm" role="status">
          <span>A voice provider is missing.</span>
          <button type="button" class="btn btn-ghost min-h-11 text-base-content underline" (click)="openVoiceSettings.emit()">Open Voice settings</button>
        </div>
      }
    </section>
  `,
})
export class CommandVoiceHudComponent {
  public readonly Mic = Mic;
  public readonly voiceState = input.required<CommandVoiceState>();
  public readonly provider = input.required<CommandProviderReadiness>();
  public readonly muted = input(false);
  public readonly turnAbortable = input(false);
  public readonly voiceError = input<CommandVoiceError | null>(null);
  public readonly inputLevel = input(0);
  public readonly outputLevel = input(0);
  public readonly start = output<void>();
  public readonly stop = output<void>();
  public readonly toggleMute = output<void>();
  public readonly interrupt = output<void>();
  public readonly openVoiceSettings = output<void>();
  public readonly meterBars = [15, 30, 45, 60, 75, 90] as const;
  public readonly speakerBars = [20, 40, 60, 80, 100] as const;
  public readonly levelPercent = computed(() => {
    const level = this.inputLevel();
    return Math.round(Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0)) * 100);
  });
  public readonly outputPercent = computed(() => {
    const level = this.outputLevel();
    return Math.round(Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0)) * 100);
  });
  public readonly listening = computed(() => this.voiceState() === 'listening');
  public readonly canMute = computed(() => ['listening', 'thinking', 'speaking', 'muted'].includes(this.voiceState()));
  public readonly canStopTurn = computed(() => this.turnAbortable() || this.canMute());
  public readonly canStart = computed(() => !this.canMute());
  public readonly title = computed(() => this.voiceError() ? 'Voice needs attention' : this.muted() ? 'Microphone muted' : this.voiceState() === 'listening' ? 'Listening to you' : this.voiceState() === 'thinking' ? 'Ptah is thinking' : this.voiceState() === 'speaking' ? 'Ptah is speaking' : 'Ready for your voice');
  public readonly subtitle = computed(() => this.voiceError() ? 'Use text or recover voice' : this.muted() ? 'Click Unmute to listen' : this.voiceState() === 'listening' ? 'Mic level is live' : this.voiceState() === 'thinking' ? 'Preparing a concise update' : this.voiceState() === 'speaking' ? 'Playing Ptah audio' : 'Say a command to Ptah');
}
