import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { LucideAngularModule, Send } from 'lucide-angular';
import type { CommandSessionStatus } from '../model/command-center.store';

@Component({
  selector: 'ptah-command-session-controls',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="session-controls text-base-content" aria-label="Command Center session">
      <div class="session-actions flex items-center gap-2">
        <button type="button" class="btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          (click)="requestStatus.emit()">Status</button>
        <button type="button" class="session-new btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          (click)="newSession.emit()">Start new</button>
      </div>
      <div class="command-entry min-w-0">
        <form class="flex min-w-[15rem] flex-[1_1_15rem] items-center rounded-lg border border-base-content bg-base-100 focus-within:border-warning"
          (submit)="send($event)">
          <label class="sr-only" for="command-text">Text command or compact reply</label>
          <input id="command-text"
            class="min-h-11 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-sm text-base-content placeholder:text-base-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            type="text" [value]="draft()" (input)="onInput($event)"
            placeholder="Or type a command for Ptah..." />
          <button type="submit" class="btn btn-ghost min-h-11 min-w-11 disabled:border-base-300 disabled:text-base-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [disabled]="!draft().trim()" aria-label="Send command" title="Send command">
            <lucide-angular [img]="Send" class="h-5 w-5" aria-hidden="true" />
          </button>
        </form>
      </div>
      <div class="session-support flex min-w-0 items-center gap-3 text-xs text-base-content-muted">
        <p class="shrink-0" aria-live="polite">Command Center · {{ sessionStatus() }}</p>
        <p class="min-w-0 truncate" title="To start a Tribunal, say an explicit move word: Council, Forge, Race, Relay, or Crucible. Ambiguous speech goes to Ptah chat.">
          To start a Tribunal, say an explicit move word: Council, Forge, Race,
          Relay, or Crucible. Ambiguous speech goes to Ptah chat.
        </p>
      </div>
    </section>
  `,
})
export class CommandSessionControlsComponent {
  public readonly Send = Send;
  public readonly sessionStatus = input.required<CommandSessionStatus>();
  public readonly draft = signal('');
  public readonly commandSubmit = output<string>();
  public readonly newSession = output<void>();
  public readonly requestStatus = output<void>();

  public onInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) this.draft.set(target.value);
  }

  public send(event: Event): void {
    event.preventDefault();
    const value = this.draft().trim();
    if (!value) return;
    this.commandSubmit.emit(value);
  }

  public clearDraft(sent: string): void {
    if (this.draft().trim() === sent) this.draft.set('');
  }
}
