import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import type { CommandSessionStatus } from '../model/command-center.store';

@Component({
  selector: 'ptah-command-session-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-xl border border-base-300 bg-base-200 p-3 text-base-content"
      aria-label="Command Center session"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="mr-auto text-sm font-semibold"
          >Command Center · {{ sessionStatus() }}</span
        >
        @if (canResume()) {
          <button
            type="button"
            class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
            (click)="resumeSession.emit()"
          >
            Resume latest session
          </button>
        }
        <button
          type="button"
          class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          (click)="newSession.emit()"
        >
          New Command Center
        </button>
        <button
          type="button"
          class="btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          (click)="requestStatus.emit()"
        >
          Status
        </button>
      </div>
      <form class="mt-3 flex gap-2" (submit)="send($event)">
        <label class="sr-only" for="command-text"
          >Text command or compact reply</label
        >
        <input
          id="command-text"
          class="input input-bordered min-h-11 min-w-0 flex-1"
          type="text"
          [value]="draft()"
          (input)="onInput($event)"
          placeholder="Command or reply to Ptah"
        />
        <button
          type="submit"
          class="btn btn-warning min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          [disabled]="!draft().trim()"
        >
          Send
        </button>
      </form>
      <p class="mt-2 text-xs text-base-content-muted">
        To start a Tribunal, say an explicit move word: Council, Forge, Race,
        Relay, or Crucible. Ambiguous speech goes to Ptah chat.
      </p>
    </section>
  `,
})
export class CommandSessionControlsComponent {
  public readonly sessionStatus = input.required<CommandSessionStatus>();
  public readonly canResume = input(false);
  public readonly draft = signal('');
  public readonly commandSubmit = output<string>();
  public readonly resumeSession = output<void>();
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
    this.draft.set('');
  }
}
