import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'ptah-agent-next-steps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-lg border border-base-300 bg-base-200 p-4"
      aria-labelledby="agent-next-title"
    >
      <h2 id="agent-next-title" class="font-semibold">Next steps</h2>
      @if (pending()) {
        <p>Project guidance starts in {{ remainingSeconds() }} seconds.</p>
        <p class="text-xs text-base-content-muted">
          Will use: {{ previewProvider() || 'current workspace provider' }} ·
          {{ previewModel() || 'default model' }}
        </p>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="startNow.emit()"
        >
          Start now
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          (click)="skip.emit()"
        >
          Skip guidance
        </button>
      } @else if (started()) {
        <p role="status">Project guidance started.</p>
      } @else {
        <p>
          {{
            skipped()
              ? 'Project guidance skipped. You can start it later.'
              : 'Generate project guidance when you are ready.'
          }}
        </p>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          (click)="continue.emit()"
        >
          Continue to project guidance
        </button>
        @if (manualRecovery() && !skipped()) {
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            (click)="skip.emit()"
          >
            Skip guidance
          </button>
        }
      }
      <details class="mt-3 text-sm">
        <summary class="cursor-pointer">Quick Start examples</summary>
        <ol class="list-decimal pl-5 space-y-2 pt-2">
          <li>
            Start a development workflow:
            <code>/orchestrate Add user authentication</code>
          </li>
          <li>
            Available workflow types: FEATURE, BUGFIX, REFACTORING, DOCS,
            RESEARCH, DEVOPS.
          </li>
          <li>
            Fix a bug: <code>/orchestrate Fix login form validation</code>
          </li>
          <li>
            Refactor or document:
            <code>/orchestrate Refactor UserService</code> or
            <code>/orchestrate Create API docs</code>
          </li>
          <li>
            Continue an existing task: <code>/orchestrate TASK_2025_XXX</code>
          </li>
        </ol>
        <p>
          Tip: mention <code>@agent-name</code> and keep plans in
          <code>.ptah/specs/</code>.
        </p>
      </details>
    </section>
  `,
})
export class AgentNextStepsComponent {
  readonly started = input(false);
  readonly pending = input(false);
  readonly remainingSeconds = input(0);
  readonly previewModel = input<string | null>(null);
  readonly previewProvider = input<string | null>(null);
  readonly manualRecovery = input(false);
  readonly skipped = input(false);
  readonly startNow = output<void>();
  readonly continue = output<void>();
  readonly skip = output<void>();
}
