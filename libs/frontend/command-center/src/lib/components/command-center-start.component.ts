import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  formatCost,
  formatTokens,
  knownSubtotalOf,
} from '@ptah-extension/chat-ui';
import type {
  ChatSessionSummary,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import {
  MonogramTileComponent,
  ProviderMarkComponent,
  PROVIDER_BRAND_SLUGS,
  PROVIDER_MARKS,
} from '@ptah-extension/ui';
import { relativeTime } from './command-relative-time';

@Component({
  selector: 'ptah-command-center-start',
  standalone: true,
  imports: [MonogramTileComponent, ProviderMarkComponent],
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
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">{{
                currentSession()?.name || 'Command Center'
              }}</span>
              @if (hasCurrentFigures()) {
                <span
                  class="mt-1 block text-xs text-base-content-muted"
                  data-testid="current-figures"
                >
                  Cost <strong>{{ currentCost() }}</strong> · Tokens
                  <strong>{{ currentTokens() }}</strong>
                </span>
              }
            </span>
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
              [attr.aria-label]="cardName(session)"
              [disabled]="choosing()"
              (click)="selected.emit(session.id)"
            >
              @if (knownProvider(session.providerId); as providerId) {
                <ptah-provider-mark
                  [providerId]="providerId"
                  size="sm"
                  aria-hidden="true"
                />
              } @else {
                <ptah-monogram-tile
                  [label]="
                    session.providerId || session.name || 'Untitled session'
                  "
                  size="sm"
                />
              }
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">{{
                  session.name || 'Untitled session'
                }}</span>
                <span
                  class="mt-1 flex items-center gap-2 text-sm text-base-content-muted"
                >
                  @if (activityBars(session.lastActivityAt); as activeBars) {
                    <span
                      class="flex h-5 items-center gap-0.5"
                      aria-hidden="true"
                      data-testid="activity-bars"
                    >
                      @for (bar of meterBars; track bar) {
                        <span
                          class="w-1 rounded-full"
                          [class.h-2]="bar > activeBars"
                          [class.h-4]="bar <= activeBars"
                          [class.bg-base-content]="bar <= activeBars"
                          [class.bg-base-300]="bar > activeBars"
                          [attr.data-active]="bar <= activeBars"
                        ></span>
                      }
                    </span>
                  }
                  @let age = relativeTime(session.lastActivityAt);
                  <span>{{
                    age === 'Unknown' ? 'No recent activity' : 'Updated ' + age
                  }}</span>
                </span>
                @let figures = cardFigures(session);
                @if (figures.length > 0) {
                  <span class="mt-1 block text-xs text-base-content-muted">
                    {{ figures.join(' · ') }}
                  </span>
                }
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
  public readonly meterBars = [1, 2, 3, 4, 5, 6] as const;
  public readonly sessions = input.required<readonly ChatSessionSummary[]>();
  public readonly status = input.required<'loading' | 'ready' | 'error'>();
  public readonly expanded = input(false);
  public readonly choosing = input(false);
  public readonly currentTabId = input<string | null>(null);
  public readonly currentStats = input<SessionStatsEntry | null>(null);
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
  public readonly hasCurrentFigures = computed(() => {
    const snapshot = this.currentStats();
    return (
      (typeof snapshot?.totalCost === 'number' &&
        Number.isFinite(snapshot.totalCost)) ||
      knownSubtotalOf(snapshot) !== null ||
      (typeof snapshot?.tokenCount === 'number' &&
        Number.isFinite(snapshot.tokenCount))
    );
  });
  public readonly currentCost = computed(() => {
    const snapshot = this.currentStats();
    const subtotal = knownSubtotalOf(snapshot);
    const value = snapshot?.totalCost ?? subtotal?.value ?? null;
    return `${snapshot?.provisional && value !== null ? '~' : ''}${formatCost(value)}${subtotal ? ' known subtotal' : ''}`;
  });
  public readonly currentTokens = computed(() => {
    const snapshot = this.currentStats();
    const value = snapshot?.tokenCount;
    return typeof value === 'number' && Number.isFinite(value)
      ? `${snapshot?.provisional ? '~' : ''}${formatTokens(value)}`
      : '—';
  });
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

  public knownProvider(id: string | undefined): string | null {
    return id &&
      (Object.hasOwn(PROVIDER_BRAND_SLUGS, id) ||
        Object.hasOwn(PROVIDER_MARKS, id))
      ? id
      : null;
  }

  /** Six fixed age bands; the shared clock is the only source of time. */
  public activityBars(timestamp: number): number | null {
    if (!Number.isFinite(timestamp) || !Number.isFinite(this.now()))
      return null;
    const ageMinutes = Math.max(0, this.now() - timestamp) / 60_000;
    if (ageMinutes < 1) return 6;
    if (ageMinutes < 5) return 5;
    if (ageMinutes < 30) return 4;
    if (ageMinutes < 120) return 3;
    if (ageMinutes < 1440) return 2;
    return 1;
  }

  public tokenCount(session: ChatSessionSummary): number | null {
    const usage = session.tokenUsage;
    if (!usage) return null;
    const fields = [
      usage.input,
      usage.output,
      usage.cacheRead ?? 0,
      usage.cacheCreation ?? 0,
    ];
    return fields.every((value) => Number.isFinite(value) && value >= 0)
      ? fields.reduce((sum, value) => sum + value, 0)
      : null;
  }

  public phaseLabel(
    phase: NonNullable<ChatSessionSummary['livePhase']>,
  ): string {
    return phase.replace(/-/g, ' ');
  }

  /** `session:list` reports 0 messages until the count is warmed, so 0 is hidden. */
  public cardFigures(session: ChatSessionSummary): string[] {
    const parts: string[] = [];
    if (session.messageCount > 0)
      parts.push(`${session.messageCount} messages`);
    const tokens = this.tokenCount(session);
    if (tokens !== null) parts.push(`${tokens} tokens`);
    if (session.isActive) parts.push('Active');
    if (session.livePhase) parts.push(this.phaseLabel(session.livePhase));
    if (session.hasTranscript === false) parts.push('History unavailable');
    return parts;
  }

  public cardName(session: ChatSessionSummary): string {
    const parts = [
      session.name || 'Untitled session',
      this.relativeTime(session.lastActivityAt) === 'Unknown'
        ? 'No recent activity'
        : `Updated ${this.relativeTime(session.lastActivityAt)}`,
      ...this.cardFigures(session),
    ];
    if (session.id === this.recordedSessionId()) parts.push('Command Center');
    return parts.join(', ');
  }
}
