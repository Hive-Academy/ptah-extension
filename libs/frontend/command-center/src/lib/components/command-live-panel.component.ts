import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  SessionEmbedComponent,
  type SessionCardActions,
  type SessionStartGuard,
  type SessionStopHandler,
} from '@ptah-extension/chat';
import { LucideAngularModule } from 'lucide-angular';
import type { CommandWorkState } from '../model/command-center.store';
import { stateColor, stateIcon } from './command-state-icon';

/** Where the Live tab streams from; `null` tab means the agent has no live transcript. */
export interface CommandLiveTarget {
  readonly tabId: string | null;
  readonly state: CommandWorkState | null;
  readonly summary: string | null;
}

export const LIVE_START_BLOCK_REASON =
  'Send commands from the Command Center dock or by voice.';

/**
 * Read-only live transcript of the selected agent's session, reusing the
 * Canvas pattern (`canvas-detail-transcript.component.ts`). The embed stays
 * mounted while another tab is open (`contentVisible=false`) so its scroll
 * position survives. Nothing here is a live region: the status line is visual
 * only, so the stage caption announcer stays the page's single live region.
 */
@Component({
  selector: 'ptah-command-live-panel',
  standalone: true,
  imports: [SessionEmbedComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col' },
  styles: `
    .live-dot { animation: live-pulse 1.2s ease-in-out infinite; }
    .live-dot.reduced { animation: none; }
    .live-embed { animation: live-swap 120ms ease-out; }
    .live-embed.reduced { animation: none; }
    @media (prefers-reduced-motion: reduce) {
      .live-dot, .live-embed { animation: none; }
    }
    @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    @keyframes live-swap { from { opacity: 0; } to { opacity: 1; } }
  `,
  template: `
    <p
      class="flex shrink-0 items-center gap-2 px-1 text-xs text-base-content-muted"
      [class.pb-2]="!!statusLabel()"
      data-testid="live-status"
    >
      @if (statusLabel(); as label) {
        <lucide-angular
          [img]="icon()"
          class="size-3.5 {{ color() }}"
          [class.live-dot]="streaming()"
          [class.reduced]="reducedMotion()"
          aria-hidden="true"
        />
        {{ label }}
      }
    </p>
    @if (target().tabId; as tabId) {
      @for (id of [tabId]; track id) {
        <div
          class="live-embed relative min-h-0 flex-1"
          [class.reduced]="reducedMotion()"
        >
          <ptah-session-embed
            class="block h-full min-h-0"
            chrome="bare"
            [tabId]="id"
            [contentVisible]="visible()"
            [focused]="focused()"
            [readOnly]="true"
            [startGuard]="startGuard"
            [stopHandler]="stopHandler"
            [cardActions]="cardActions"
            [retainRailTranscript]="true"
          />
        </div>
      }
    } @else if (hasSession() && (finished() || target().state !== null)) {
      <div
        class="rounded-xl border border-base-300 bg-base-200 p-3 text-center text-xs text-base-content-muted"
        data-glass-surface="tile"
        data-testid="live-missing"
      >
        <p>
          No session data for this agent.
          @if (finished()) {
            It finished in an earlier session.
          }
        </p>
        @if (target().summary; as summary) {
          <p class="mt-2 whitespace-pre-wrap text-base-content">{{ summary }}</p>
        }
      </div>
    } @else {
      <p
        class="rounded-xl border border-base-300 bg-base-200 p-3 text-center text-xs text-base-content-muted"
        data-glass-surface="tile"
        data-testid="live-empty"
      >
        Start a command to see live agent output.
      </p>
    }
  `,
})
export class CommandLivePanelComponent {
  public readonly target = input.required<CommandLiveTarget>();
  /** False while another rail tab covers the panel. */
  public readonly visible = input(true);
  public readonly focused = input(true);
  /** False before the Command Center has a session at all. */
  public readonly hasSession = input(false);
  public readonly reducedMotion = input(false);
  public readonly openLane = output<string>();
  public readonly openSession = output<void>();

  protected readonly streaming = computed(
    () =>
      this.target().state === 'running' || this.target().state === 'starting',
  );
  /** A persisted child: it ended, or it left a summary behind. */
  protected readonly finished = computed(() => {
    const { state, summary } = this.target();
    return state === 'completed' || state === 'failed' || !!summary;
  });
  protected readonly statusLabel = computed(() => {
    const state = this.target().state;
    if (!this.target().tabId) return null;
    if (state === 'running' || state === 'starting') return 'Streaming';
    if (state === 'awaiting input') return 'Waiting for input';
    return state === null ? null : 'Idle';
  });
  protected readonly icon = computed(() =>
    stateIcon(this.target().state ?? 'idle'),
  );
  protected readonly color = computed(() =>
    stateColor(this.target().state ?? 'idle'),
  );

  /** The voice loop and the dock own input; the embed only reads. */
  protected readonly startGuard: SessionStartGuard = () =>
    LIVE_START_BLOCK_REASON;
  /** Claim every stop so a watch-only embed can never stop the agent it shows. */
  protected readonly stopHandler: SessionStopHandler = () => 'handled';
  protected readonly cardActions: SessionCardActions = {
    openLane: (key: string) => this.openLane.emit(key),
    openSession: () => this.openSession.emit(),
  };
}
