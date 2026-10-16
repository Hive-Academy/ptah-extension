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
        <form
          class="flex min-w-0 flex-1 items-center rounded-lg border border-base-content bg-base-100 focus-within:border-warning"
          (submit)="send($event)"
        >
          <label class="sr-only" for="command-text"
            >Text command or compact reply</label
          >
          <input
            id="command-text"
            class="min-h-11 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-sm text-base-content placeholder:text-base-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
            type="text"
            [value]="draft()"
            (input)="onInput($event)"
            placeholder="Or type a command for Ptah..."
          />
          <button
            type="submit"
            class="btn btn-ghost min-h-11 min-w-11 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
            [disabled]="!draft().trim()"
            aria-label="Send command"
            title="Send command"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              class="h-5 w-5 fill-none stroke-current stroke-2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m3 11 18-8-8 18-2-8-8-2Zm8 2 10-10" />
            </svg>
          </button>
        </form>
        <button
          type="button"
          class="btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          (click)="newSession.emit()"
        >
          Start new
        </button>
        <button
          type="button"
          class="btn btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          (click)="requestStatus.emit()"
        >
          Status
        </button>
      </div>
      <p class="mt-2 text-xs text-base-content-muted" aria-live="polite">
        Command Center · {{ sessionStatus() }}
      </p>
      <p class="mt-1 text-xs text-base-content-muted">
        To start a Tribunal, say an explicit move word: Council, Forge, Race,
        Relay, or Crucible. Ambiguous speech goes to Ptah chat.
      </p>
    </section>
  `,
})
export class CommandSessionControlsComponent {
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
    this.draft.set('');
  }
}
