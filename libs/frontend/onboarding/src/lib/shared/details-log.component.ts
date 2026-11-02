import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  SessionEmbedComponent,
  type SessionStartGuard,
  type SessionStopHandler,
} from '@ptah-extension/chat';
import type { LiveModelStats } from '@ptah-extension/chat-ui';
import { BuilderSessionSectionComponent } from '@ptah-extension/harness-builder';
import { AnalysisTranscriptComponent } from '@ptah-extension/setup-wizard';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';

export type DetailsLogMode = 'analysis' | 'tab';

export interface DetailsLogStreamCounts {
  readonly total: number;
  readonly text: number;
  readonly thinking: number;
  readonly tool: number;
  readonly errors: number;
}

/**
 * Collapsed Details log. Analysis mode shows stream counts and the analysis
 * transcript; tab mode mounts a bare, read-only session embed. The embed and
 * transcript exist only while the disclosure is open.
 */
@Component({
  selector: 'ptah-details-log',
  standalone: true,
  imports: [
    AnalysisTranscriptComponent,
    BuilderSessionSectionComponent,
    SessionEmbedComponent,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <details
      class="rounded-[10px] border border-base-300"
      data-glass-surface="tile"
      data-testid="details-log"
      (toggle)="onToggle($event)"
    >
      <summary
        class="flex min-h-8 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm text-base-content-muted [&::-webkit-details-marker]:hidden"
        data-testid="details-log-summary"
      >
        <span class="inline-flex items-center gap-1 whitespace-nowrap"><lucide-angular [img]="icons.chevron" class="size-4 shrink-0 transition-transform duration-200" [class.rotate-180]="open()" aria-hidden="true" />Details log</span>
        @if (streamCounts(); as counts) {
          <span class="min-w-0 basis-full min-[720px]:basis-auto" data-testid="details-log-counts">
            {{ counts.total }} {{ counts.total === 1 ? 'event' : 'events' }}: {{ counts.text }} {{ counts.text === 1 ? 'text' : 'texts' }},
            {{ counts.thinking }} thinking, {{ counts.tool }} {{ counts.tool === 1 ? 'tool' : 'tools' }},
            {{ counts.errors }} {{ counts.errors === 1 ? 'error' : 'errors' }}
          </span>
        }
      </summary>
      @if (open()) {
        <div class="border-t border-base-300" data-testid="details-log-body">
          @for (key of mountKeys(); track key) {
            @if (key === 'analysis') {
              <ptah-analysis-transcript />
            } @else if (key === 'unavailable') {
              <p
                class="px-4 py-3 text-sm text-base-content-muted"
                data-testid="details-log-unavailable"
              >
                Session is not available.
              </p>
            } @else {
              <ptah-builder-session-section
                [initialized]="sessionInitialized()"
                [statsSnapshot]="statsSnapshot()"
                [liveModelStats]="liveModelStats()"
              />
              <ptah-session-embed
                [tabId]="key.slice(4)"
                chrome="bare"
                [readOnly]="true"
                [startGuard]="startGuard()"
                [stopHandler]="stopHandler()"
              />
            }
          }
        </div>
      }
    </details>
  `,
})
export class DetailsLogComponent {
  protected readonly icons = { chevron: ChevronDown } as const;
  readonly mode = input.required<DetailsLogMode>();
  /** Bound chat tab for tab mode. Ignored in analysis mode. */
  readonly tabId = input<string | null>(null);
  /** Stream counters; omitted when the analysis stream is detached. */
  readonly streamCounts = input<DetailsLogStreamCounts | null>(null);
  readonly sessionInitialized = input(false);
  readonly statsSnapshot = input<SessionStatsEntry | null>(null);
  readonly liveModelStats = input<LiveModelStats | null>(null);
  readonly startGuard = input<SessionStartGuard | null>(null);
  readonly stopHandler = input<SessionStopHandler | null>(null);

  protected readonly open = signal(false);

  /**
   * One tracked key so a mode or tab change while open destroys the previous
   * embed/transcript instead of rebinding it in place.
   */
  protected readonly mountKeys = computed(() => {
    if (!this.open()) {
      return [] as const;
    }
    if (this.mode() === 'analysis') {
      return ['analysis'] as const;
    }
    const tabId = this.tabId();
    return tabId ? ([`tab:${tabId}`] as const) : (['unavailable'] as const);
  });

  protected onToggle(event: Event): void {
    const target = event.currentTarget;
    this.open.set(target instanceof HTMLDetailsElement && target.open);
  }
}
