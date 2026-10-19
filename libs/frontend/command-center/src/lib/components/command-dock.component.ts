import { ChangeDetectionStrategy, Component, input, output, ViewEncapsulation, viewChild } from '@angular/core';
import type { CommandProviderReadiness, CommandSessionStatus, CommandVoiceError, CommandVoiceState } from '../model/command-center.store';
import { CommandSessionControlsComponent } from './command-session-controls.component';
import { CommandVoiceHudComponent } from './command-voice-hud.component';

export const commandDockStyles = `
    .command-dock {
      display: grid;
      grid-template-columns: minmax(170px, 1fr) auto minmax(180px, 1.5fr) auto auto;
      gap: 8px 12px;
      align-items: center;
      min-width: 0;
    }
    .command-dock > ptah-command-voice-hud,
    .command-dock > ptah-command-session-controls,
    .command-dock .voice-hud,
    .command-dock .session-controls,
    .command-dock .session-actions { display: contents; }
    .command-dock .voice-identity { grid-row: 1; grid-column: 1; min-width: 0; }
    .command-dock .voice-actions { grid-row: 1; grid-column: 2; min-width: 0; }
    .command-dock .session-actions > button:first-child { grid-row: 1; grid-column: 4; }
    .command-dock .session-new { grid-row: 1; grid-column: 5; white-space: nowrap; }
    .command-dock .command-entry { grid-row: 1; grid-column: 3; min-width: 0; }
    .command-dock .command-entry form { width: 100%; min-width: 0; }
    .command-dock .session-support { grid-column: 1 / -1; grid-row: 2; min-width: 0; }
    .command-dock .voice-recovery { grid-column: 1 / -1; grid-row: 3; }
    @container (max-width: 1100px) {
      .command-dock { grid-template-columns: minmax(0, 1fr) auto auto; }
      .command-dock .voice-identity { grid-row: 1; grid-column: 1 / -1; }
      .command-dock .voice-actions { grid-row: 2; grid-column: 1; }
      .command-dock .session-actions > button:first-child { grid-row: 2; grid-column: 2; }
      .command-dock .session-new { grid-row: 2; grid-column: 3; }
      .command-dock .command-entry { grid-row: 3; grid-column: 1 / -1; }
      .command-dock .session-support { grid-row: 4; }
      .command-dock .voice-recovery { grid-row: 5; }
    }
    @container (max-width: 720px) {
      .command-dock { grid-template-columns: minmax(0, 1fr) auto; }
      .command-dock .voice-actions { grid-column: 1; }
      .command-dock .session-actions > button:first-child { grid-column: 2; }
      .command-dock .command-entry { grid-row: 3; }
      .command-dock .session-new { grid-row: 4; grid-column: 1 / -1; width: 100%; }
      .command-dock .session-support { grid-row: 5; }
      .command-dock .voice-recovery { grid-row: 6; }
    }
    @media (prefers-reduced-motion: reduce) {
      .command-dock button { transition: none; }
    }
  `;

/** Responsive presentation of page-owned voice and session controls. */
@Component({
  selector: 'ptah-command-dock',
  standalone: true,
  imports: [CommandVoiceHudComponent, CommandSessionControlsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="command-dock rounded-xl border border-base-300 bg-base-200 p-3 text-base-content" role="group" aria-label="Command dock" data-dock-layout="responsive">
      <ptah-command-voice-hud
        [voiceState]="voiceState()" [provider]="provider()" [muted]="muted()"
        [voiceError]="voiceError()" [inputLevel]="inputLevel()" [outputLevel]="outputLevel()"
        [turnAbortable]="turnAbortable()"
        (start)="start.emit()" (stop)="stop.emit()" (toggleMute)="toggleMute.emit()"
        (interrupt)="interrupt.emit()" (openVoiceSettings)="openVoiceSettings.emit()" />
      <ptah-command-session-controls
        [sessionStatus]="sessionStatus()"
        (newSession)="newSession.emit()" (requestStatus)="requestStatus.emit()"
        (commandSubmit)="commandSubmit.emit($event)" />
    </div>
  `,
  styles: [commandDockStyles],
})
export class CommandDockComponent {
  public readonly voiceState = input.required<CommandVoiceState>();
  public readonly provider = input.required<CommandProviderReadiness>();
  public readonly muted = input(false);
  public readonly turnAbortable = input(false);
  public readonly voiceError = input<CommandVoiceError | null>(null);
  public readonly inputLevel = input(0);
  public readonly outputLevel = input(0);
  public readonly sessionStatus = input.required<CommandSessionStatus>();
  public readonly start = output<void>();
  public readonly stop = output<void>();
  public readonly toggleMute = output<void>();
  public readonly interrupt = output<void>();
  public readonly openVoiceSettings = output<void>();
  public readonly commandSubmit = output<string>();
  public readonly newSession = output<void>();
  public readonly requestStatus = output<void>();
  private readonly controls = viewChild.required(CommandSessionControlsComponent);

  public clearDraft(sent: string): void {
    this.controls().clearDraft(sent);
  }
}
