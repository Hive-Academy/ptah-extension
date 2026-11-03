import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  signal,
  viewChild,
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
import { ChevronDown, CircleDashed, LucideAngularModule, Terminal } from 'lucide-angular';

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
  host: { class: 'block', '[class.h-full]': "variant() === 'pane'" },
  template: `
    @if (variant() === 'pane') {
      <section class="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-base-300 bg-base-200"
        [class.session-log-container]="composer()" data-glass-surface="content" data-testid="details-log">
        <header class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-base-300 px-4 py-2">
          <h2 class="inline-flex items-center gap-2 text-base font-semibold text-base-content">
            <lucide-angular [img]="icons.terminal" class="size-4" aria-hidden="true" />Session log
          </h2>
          <span class="inline-flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-2 py-0.5 text-xs text-base-content">
            <span class="size-2 rounded-full" [class.bg-state-run]="liveState() === 'live'" [class.bg-state-idle]="liveState() !== 'live'" aria-hidden="true"></span>
            {{ liveState() === 'live' ? 'Live' : liveState() === 'idle' ? 'Idle' : liveState() === 'stopped' ? 'Stopped' : liveState() === 'loading' ? 'Loading' : 'Not connected' }}
          </span>
          @if (streamCounts(); as counts) {
            <span class="text-xs font-mono text-base-content-muted" data-testid="details-log-counts">
              {{ counts.total }} {{ counts.total === 1 ? 'event' : 'events' }}: {{ counts.text }} {{ counts.text === 1 ? 'text' : 'texts' }},
              {{ counts.thinking }} thinking, {{ counts.tool }} {{ counts.tool === 1 ? 'tool' : 'tools' }},
              {{ counts.errors }} {{ counts.errors === 1 ? 'error' : 'errors' }}
            </span>
          }
        </header>
        <div #paneRegion class="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[oklch(var(--s))]"
          [class]="composer() ? 'min-h-[160px]' : ''" [class.overflow-hidden]="mode() === 'tab'" [class.overflow-y-auto]="mode() === 'analysis'"
          data-testid="details-log-body" role="log" aria-live="off" aria-label="Session log" tabindex="0" (keydown)="onPaneKeydown($event)">
          @for (key of mountKeys(); track key) {
            @if (key === 'analysis') {
              <ptah-analysis-transcript />
            } @else if (key === 'unavailable') {
              <div class="m-auto px-4 py-3 text-center text-sm text-base-content-muted" data-testid="details-log-unavailable">
                <p>Session is not available.</p><p>No live session is bound to this proposal.</p>
              </div>
            } @else {
              <ptah-builder-session-section [initialized]="sessionInitialized()" [statsSnapshot]="statsSnapshot()" [liveModelStats]="liveModelStats()" />
              <div class="flex min-h-0 flex-1 flex-col">
                <ptah-session-embed class="min-h-0 flex-1" [tabId]="key.slice(4)" chrome="bare" [readOnly]="true" [startGuard]="startGuard()" [stopHandler]="stopHandler()" />
              </div>
            }
          }
        </div>
        @if (footerNote() && (!composer() || footerNote() !== 'Read-only view.')) {
          <div class="flex shrink-0 items-center gap-2 border-t border-base-300 px-4 py-2 text-xs text-base-content-muted">
            <lucide-angular [img]="icons.circleDashed" class="size-3.5" aria-hidden="true" />{{ footerNote() }}
          </div>
        }
        <div class="log-composer-slot" [class.has-composer]="composer()"><ng-content select="[logComposer]" /></div>
      </section>
    } @else {
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
    }
  `,
  styles: [`
    .session-log-container { container: session-log / size; }
    .log-composer-slot.has-composer { display: flex; flex: 0 1 auto; min-height: 0; flex-direction: column; }
    :host-context(.anubis-light) [role='log']:focus-visible { outline-color: var(--ptah-gold-strong); }
  `],
})
export class DetailsLogComponent {
  protected readonly icons = { chevron: ChevronDown, terminal: Terminal, circleDashed: CircleDashed } as const;
  private readonly paneRegion = viewChild<ElementRef<HTMLElement>>('paneRegion');
  readonly variant = input<'disclosure' | 'pane'>('disclosure');
  readonly liveState = input<'live' | 'idle' | 'stopped' | 'loading' | 'unavailable'>('idle');
  readonly footerNote = input('Read-only view.');
  readonly composer = input(false);
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
    if (this.variant() === 'disclosure' && !this.open()) {
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

  focus(): void {
    this.paneRegion()?.nativeElement.focus({ preventScroll: true });
  }

  protected onPaneKeydown(event: KeyboardEvent): void {
    const region = this.paneRegion()?.nativeElement;
    if (!region || event.target !== region) return;
    if (this.isScrollable(region)) return;
    const scroller = this.scrollableDescendant(region);
    if (!scroller) return;
    const page = scroller.clientHeight * 0.9;
    const delta = event.key === 'ArrowDown' ? 40 : event.key === 'ArrowUp' ? -40
      : event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey) ? page
      : event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -page : null;
    if (delta !== null) scroller.scrollTop += delta;
    else if (event.key === 'Home') scroller.scrollTop = 0;
    else if (event.key === 'End') scroller.scrollTop = scroller.scrollHeight;
    else return;
    event.preventDefault();
  }

  private scrollableDescendant(region: HTMLElement): HTMLElement | null {
    return Array.from(region.querySelectorAll<HTMLElement>('*')).find((element) => this.isScrollable(element)) ?? null;
  }

  private isScrollable(element: HTMLElement): boolean {
    const overflow = getComputedStyle(element).overflowY;
    return (overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight;
  }
}
