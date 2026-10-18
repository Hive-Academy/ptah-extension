import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { ChatSessionSummary } from '@ptah-extension/shared';
import { relativeTime } from './command-relative-time';

@Component({
  selector: 'ptah-command-center-start',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto w-full max-w-3xl p-4 text-base-content"
      aria-labelledby="start-heading"
    >
      <h2 id="start-heading" class="mb-2 text-2xl font-semibold">
        Start Command Center
      </h2>
      <p class="mb-6 text-sm text-base-content-muted">
        Choose a session or start a new one.
      </p>
      <div class="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-primary min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          [disabled]="choosing()"
          (click)="newSession.emit()"
        >
          New session
        </button>
        <button
          type="button"
          class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          [disabled]="choosing()"
          (click)="allSessions.emit()"
        >
          {{ expanded() ? 'Recent sessions' : 'All sessions' }}
        </button>
      </div>
      @if (status() === 'loading') {
        <p role="status">Loading sessions…</p>
      } @else if (status() === 'error') {
        <div
          role="alert"
          class="rounded-xl border border-error bg-base-200 p-4"
        >
          <p class="mb-3">Could not load sessions.</p>
          <button
            type="button"
            class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            (click)="retry.emit()"
          >
            Retry
          </button>
        </div>
      } @else {
        @if (currentTabId()) {
          <button
            type="button"
            class="mb-3 flex w-full items-center gap-3 rounded-xl border border-primary bg-base-200 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            [disabled]="choosing()"
            (click)="current.emit()"
          >
            <span class="badge badge-primary">Current</span>
            <span class="min-w-0 flex-1 truncate font-semibold">{{
              currentSession()?.name || 'Command Center'
            }}</span>
            @if (
              currentSessionId() && currentSessionId() === recordedSessionId()
            ) {
              <span class="badge badge-outline">Command Center</span>
            }
            @if (currentSession(); as session) {
              <span class="text-sm text-base-content-muted">{{
                relativeTime(session.lastActivityAt)
              }}</span>
            }
          </button>
        }
        @if (visibleSessions().length === 0 && !currentTabId()) {
          <p class="rounded-xl border border-base-300 bg-base-200 p-6">
            No previous sessions
          </p>
        }
        <div class="grid gap-3 sm:grid-cols-2">
          @for (session of visibleSessions(); track session.id) {
            <button
              type="button"
              class="flex min-h-24 w-full items-center gap-3 rounded-xl border border-base-300 bg-base-200 p-4 text-left hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              [disabled]="choosing()"
              (click)="selected.emit(session.id)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">{{
                  session.name || 'Untitled session'
                }}</span>
                <span class="block text-sm text-base-content-muted">{{
                  relativeTime(session.lastActivityAt)
                }}</span>
              </span>
              @if (session.id === recordedSessionId()) {
                <span class="badge badge-outline">Command Center</span>
              }
            </button>
          }
        </div>
      }
    </section>
  `,
})
export class CommandCenterStartComponent {
  public readonly sessions = input.required<readonly ChatSessionSummary[]>();
  public readonly status = input.required<'loading' | 'ready' | 'error'>();
  public readonly expanded = input(false);
  public readonly choosing = input(false);
  public readonly currentTabId = input<string | null>(null);
  public readonly currentSessionId = input<string | null>(null);
  public readonly now = input.required<number>();
  public readonly recordedSessionId = input<string | null>(null);
  public readonly selected = output<string>();
  public readonly current = output<void>();
  public readonly newSession = output<void>();
  public readonly allSessions = output<void>();
  public readonly retry = output<void>();
  public readonly currentSession = computed(() =>
    this.sessions().find((session) => session.id === this.currentSessionId()),
  );
  public readonly visibleSessions = computed(() => {
    const others = this.sessions().filter(
      (session) => session.id !== this.currentSessionId(),
    );
    return this.expanded()
      ? others
      : others.slice(0, this.currentTabId() ? 4 : 5);
  });

  public relativeTime(timestamp: number): string {
    return relativeTime(timestamp, this.now()) ?? 'Unknown';
  }
}
