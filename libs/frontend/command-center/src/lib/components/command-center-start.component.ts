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
import { History, Plus, Play, LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'ptah-command-center-start',
  standalone: true,
  imports: [MonogramTileComponent, ProviderMarkComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto w-full max-w-6xl px-4 py-8 text-base-content sm:px-6 lg:px-8"
      data-glass-surface="content"
      aria-labelledby="start-heading"
    >
      <p class="mb-2 font-mono text-xs uppercase tracking-widest text-secondary-focus">Ptah / Engineering</p>
      <h2 id="start-heading" class="mb-2 font-serif text-[28px] font-semibold">
        Start Command Center
      </h2>
      <p class="mb-6 text-sm text-base-content-muted">
        Choose a session or start a new one.
      </p>
      <div class="mb-8 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-primary min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          [disabled]="choosing()"
          (click)="newSession.emit()"
        >
          <lucide-angular [img]="plusIcon" class="mr-1 size-4" aria-hidden="true" />
          New session
        </button>
        <button
          type="button"
          class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          [disabled]="choosing()"
          (click)="allSessions.emit()"
        >
          <lucide-angular [img]="historyIcon" class="mr-1 size-4" aria-hidden="true" />
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
        <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
        <h3 class="mb-3 font-mono text-xs uppercase tracking-widest text-base-content-muted">Current session</h3>
        @if (currentTabId()) {
          <button
            type="button"
            class="mb-3 flex w-full flex-wrap items-center gap-3 rounded-xl border border-primary bg-base-200 p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            [disabled]="choosing()"
            (click)="current.emit()"
          >
            <span class="badge badge-primary">Current</span>
            <lucide-angular [img]="playIcon" class="size-4" aria-hidden="true" />
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
              @if (currentStats()?.messageCount; as messages) {
                <span class="mt-1 block text-xs text-base-content-muted">{{ messages }} messages</span>
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
        </div>
        <div>
        <h3 class="mb-3 font-mono text-xs uppercase tracking-widest text-base-content-muted">Recent sessions</h3>
        @if (visibleSessions().length === 0) {
          <p class="rounded-xl border border-base-300 bg-base-200 p-6">
            No previous sessions
          </p>
        }
        <div class="grid gap-3 min-[600px]:grid-cols-2" data-testid="recent-grid">
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
        </div>
        </div>
      }
    </section>
  `,
})
export class CommandCenterStartComponent {
  public readonly plusIcon = Plus;
  public readonly historyIcon = History;
  public readonly playIcon = Play;
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
