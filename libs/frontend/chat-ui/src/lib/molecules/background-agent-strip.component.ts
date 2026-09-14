import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
} from '@angular/core';
import {
  LucideAngularModule,
  Check,
  ChevronDown,
  CircleX,
  Ellipsis,
  MessageSquare,
  Moon,
  ScrollText,
  Square,
} from 'lucide-angular';
import { NativeDropdownComponent } from '@ptah-extension/ui';
import { AgentSteerInputComponent } from './agent-steer-input.component';
import { generateAgentColor } from '../utils/agent-color.utils';

/**
 * Presentational status buckets for a strip row. Mapped from the richer
 * `SubagentRecord` / `BackgroundAgentEntry` lifecycle states by the smart
 * wrapper — the dumb component never sees the source models.
 */
export type BackgroundAgentStripStatus =
  | 'running'
  | 'background'
  | 'completed'
  | 'error'
  | 'stopped';

/**
 * View-model for a single row in the {@link BackgroundAgentStripComponent}.
 *
 * Deliberately minimal: display fields plus capability flags. The mapping from
 * `SubagentRecord` / `BackgroundAgentEntry` (and the id bookkeeping needed to
 * dispatch actions) lives in the smart wrapper, keeping this component free of
 * store or backend coupling.
 */
export interface BackgroundAgentStripEntry {
  /** Stable identity — the subagent/background `toolCallId`. Also the `@for` key
   * and the value echoed back through every output. */
  readonly id: string;
  /** Primary label — the agent type when known, e.g. `software-architect`. */
  readonly name: string;
  /** Secondary label shown muted after the name (e.g. the teammate name) when
   * it adds information beyond {@link name}. */
  readonly hint?: string;
  /** Colour identity key for the agent dot. Falls back to {@link name}. */
  readonly agentType?: string;
  /** One-line tidy summary of current or final work. Truncated in the template. */
  readonly description?: string;
  /** Elapsed/total run time in milliseconds, when reported. */
  readonly durationMs?: number;
  /** Cumulative token usage, when reported. */
  readonly totalTokens?: number;
  /** Presentational lifecycle bucket driving the status indicator. */
  readonly status: BackgroundAgentStripStatus;
  /** Whether a steer input should be offered (running or background agents). */
  readonly steerable: boolean;
  /** Whether a stop action applies (running or background agents). */
  readonly stoppable: boolean;
  /** Whether the "send to background" action applies — foreground running
   * subagents only. */
  readonly canBackground: boolean;
  /** Whether a "view transcript" action applies — set by the smart wrapper when
   * both the SDK `agentId` and owning session id are known for this agent. */
  readonly canViewTranscript: boolean;
}

/** Payload emitted when a row's inline steer input is submitted. */
export interface BackgroundAgentSteerRequest {
  readonly id: string;
  readonly text: string;
}

/** Most agent dots shown in the collapsed summary row. */
const MAX_PREVIEW_DOTS = 5;

/** Per-instance suffix so `aria-controls` ids never collide across canvas tiles. */
let nextStripInstance = 0;

/** Format a run time: `850ms` → `<1s`, `58s`, `2m 14s`, `1h 03m`. */
export function formatAgentElapsed(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return '<1s';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** Format a token count: `850 tok`, `1.2k tok`, `41k tok`, `1.3M tok`. */
export function formatAgentTokens(tokens: number | undefined): string | null {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0)
    return null;
  if (tokens < 1000) return `${Math.round(tokens)} tok`;
  if (tokens < 10_000) return `${trimZero((tokens / 1000).toFixed(1))}k tok`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k tok`;
  return `${trimZero((tokens / 1_000_000).toFixed(1))}M tok`;
}

function trimZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}

const STATUS_LABEL: Record<BackgroundAgentStripStatus, string> = {
  running: 'Running',
  background: 'In background',
  completed: 'Completed',
  error: 'Failed',
  stopped: 'Stopped',
};

interface StripRow {
  readonly entry: BackgroundAgentStripEntry;
  readonly color: string;
  readonly statusLine: string;
  readonly hasActions: boolean;
}

/**
 * BackgroundAgentStripComponent — compact summary row plus an expandable list of
 * the session's subagents and background agents.
 *
 * Collapsed (default): one thin toggle row with overlapping per-agent colour
 * dots and a status-bucket summary (`4 agents · 3 running · 1 background`).
 * Expanded: a vertical list, capped at four rows before it scrolls, where each
 * row shows a status indicator, the agent name, a tidy status line with elapsed
 * time and tokens, and a single `⋯` actions menu (view transcript / steer /
 * send to background / stop, each gated by the entry's capability flags).
 * Choosing Steer opens the inline {@link AgentSteerInputComponent} below the
 * list; submitting it emits {@link steer}. The smart wrapper owns the RPC and
 * marks the in-flight row via {@link pendingSteerId}.
 *
 * Purely presentational: the only state is local UI state (expanded, open
 * menu, steer target). The strip hides itself when the list is empty and
 * collapses so it re-appears in its compact form.
 */
@Component({
  selector: 'ptah-background-agent-strip',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativeDropdownComponent,
    AgentSteerInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entries().length > 0) {
      <div
        class="flex flex-col min-w-0 border-b border-base-content/10 bg-base-200/60 flex-shrink-0"
      >
        <!-- Summary row: whole row toggles the list -->
        <button
          type="button"
          class="flex items-center gap-2 h-8 w-full min-w-0 px-3 text-left text-xs hover:bg-base-300/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60"
          data-test="agent-strip-toggle"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="listId"
          [title]="summaryText()"
          (click)="toggleExpanded()"
        >
          <span
            class="flex items-center -space-x-1 shrink-0"
            aria-hidden="true"
          >
            @for (row of previewRows(); track row.entry.id) {
              <span
                class="inline-block w-2.5 h-2.5 rounded-full ring-2 ring-base-200"
                [class.motion-safe:animate-pulse]="
                  row.entry.status === 'running'
                "
                [class.opacity-50]="isTerminal(row.entry.status)"
                [class.border-2]="row.entry.status === 'background'"
                [style.background-color]="
                  row.entry.status === 'background' ? 'transparent' : row.color
                "
                [style.border-color]="row.color"
              ></span>
            }
          </span>
          <span
            class="flex-1 min-w-0 truncate text-base-content-muted"
            data-test="agent-strip-summary"
            >{{ summaryText() }}</span
          >
          <lucide-angular
            [img]="ChevronDownIcon"
            class="w-3.5 h-3.5 shrink-0 text-base-content-muted transition-transform motion-reduce:transition-none"
            [class.rotate-180]="expanded()"
            aria-hidden="true"
          />
        </button>

        @if (expanded()) {
          <div
            [id]="listId"
            role="list"
            aria-label="Background agents"
            class="flex flex-col max-h-32 overflow-y-auto border-t border-base-content/10"
            data-test="agent-strip-list"
          >
            @for (row of rows(); track row.entry.id) {
              <div
                role="listitem"
                class="group flex items-center gap-2 h-8 min-h-8 px-3 min-w-0 hover:bg-base-300/40"
                [attr.data-agent-id]="row.entry.id"
              >
                <!-- Status indicator -->
                <span
                  class="inline-flex items-center justify-center w-3 h-3 shrink-0"
                  aria-hidden="true"
                >
                  @switch (row.entry.status) {
                    @case ('completed') {
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-3 h-3 text-success"
                      />
                    }
                    @case ('error') {
                      <lucide-angular
                        [img]="CircleXIcon"
                        class="w-3 h-3 text-error"
                      />
                    }
                    @case ('stopped') {
                      <lucide-angular
                        [img]="CircleXIcon"
                        class="w-3 h-3 text-base-content-muted"
                      />
                    }
                    @case ('background') {
                      <span
                        class="inline-block w-2.5 h-2.5 rounded-full border-2"
                        [style.border-color]="row.color"
                      ></span>
                    }
                    @default {
                      <span
                        class="inline-block w-2.5 h-2.5 rounded-full motion-safe:animate-pulse"
                        [style.background-color]="row.color"
                      ></span>
                    }
                  }
                </span>

                <!-- Focus button: name + status line -->
                <button
                  type="button"
                  class="flex flex-1 items-center gap-2 min-w-0 h-full text-left text-xs rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                  data-test="agent-strip-focus"
                  [attr.aria-label]="
                    'Open agent ' +
                    row.entry.name +
                    ', ' +
                    statusLabel(row.entry.status) +
                    (row.statusLine ? ': ' + row.statusLine : '')
                  "
                  [title]="row.entry.name + ' — ' + row.statusLine"
                  (click)="focusAgent.emit(row.entry.id)"
                >
                  <span
                    class="font-medium truncate max-w-[45%] shrink-0 group-hover:text-primary transition-colors"
                    data-test="agent-strip-name"
                    >{{ row.entry.name }}
                    @if (row.entry.hint) {
                      <span class="font-normal text-base-content-muted">
                        · {{ row.entry.hint }}</span
                      >
                    }
                  </span>
                  <span
                    class="flex-1 min-w-0 truncate text-base-content-muted"
                    data-test="agent-strip-status-line"
                    >{{ row.statusLine }}</span
                  >
                </button>

                <!-- Actions menu -->
                @if (row.hasActions) {
                  <ptah-native-dropdown
                    [isOpen]="openMenuId() === row.entry.id"
                    [placement]="'bottom-end'"
                    [closeOnBackdropClick]="true"
                    (closed)="closeMenu()"
                    (opened)="focusFirstItem(menuPanel)"
                  >
                    <button
                      #menuTrigger
                      trigger
                      type="button"
                      class="btn btn-ghost btn-xs btn-square w-6 h-6 min-h-0 text-base-content-muted hover:text-base-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                      data-test="agent-strip-menu-trigger"
                      aria-haspopup="true"
                      [attr.aria-expanded]="openMenuId() === row.entry.id"
                      [attr.aria-label]="'Actions for agent ' + row.entry.name"
                      title="Agent actions"
                      (click)="toggleMenu(row.entry.id)"
                    >
                      <lucide-angular
                        [img]="EllipsisIcon"
                        class="w-3.5 h-3.5"
                        aria-hidden="true"
                      />
                    </button>
                    <div
                      #menuPanel
                      content
                      class="flex flex-col py-1 min-w-40"
                      (keydown.escape)="closeMenu(menuTrigger)"
                    >
                      @if (row.entry.canViewTranscript) {
                        <button
                          type="button"
                          class="flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-base-300 focus-visible:bg-base-300 focus-visible:outline-none"
                          data-test="agent-menu-transcript"
                          (click)="
                            closeMenu(); viewTranscript.emit(row.entry.id)
                          "
                        >
                          <lucide-angular
                            [img]="ScrollTextIcon"
                            class="w-3.5 h-3.5 text-base-content-muted"
                            aria-hidden="true"
                          />
                          View transcript
                        </button>
                      }
                      @if (row.entry.steerable) {
                        <button
                          type="button"
                          class="flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-base-300 focus-visible:bg-base-300 focus-visible:outline-none"
                          data-test="agent-menu-steer"
                          [attr.aria-pressed]="steerId() === row.entry.id"
                          (click)="chooseSteer(row.entry.id)"
                        >
                          <lucide-angular
                            [img]="SteerIcon"
                            class="w-3.5 h-3.5 text-base-content-muted"
                            aria-hidden="true"
                          />
                          Steer
                        </button>
                      }
                      @if (row.entry.canBackground) {
                        <button
                          type="button"
                          class="flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-base-300 focus-visible:bg-base-300 focus-visible:outline-none"
                          data-test="agent-menu-background"
                          (click)="
                            closeMenu(); sendToBackground.emit(row.entry.id)
                          "
                        >
                          <lucide-angular
                            [img]="BackgroundIcon"
                            class="w-3.5 h-3.5 text-base-content-muted"
                            aria-hidden="true"
                          />
                          Send to background
                        </button>
                      }
                      @if (row.entry.stoppable) {
                        <button
                          type="button"
                          class="flex items-center gap-2 px-3 py-1.5 text-xs text-left text-error hover:bg-base-300 focus-visible:bg-base-300 focus-visible:outline-none"
                          data-test="agent-menu-stop"
                          (click)="closeMenu(); stop.emit(row.entry.id)"
                        >
                          <lucide-angular
                            [img]="StopIcon"
                            class="w-3.5 h-3.5"
                            aria-hidden="true"
                          />
                          Stop
                        </button>
                      }
                    </div>
                  </ptah-native-dropdown>
                } @else {
                  <span class="w-6 shrink-0" aria-hidden="true"></span>
                }
              </div>
            }
          </div>

          <!-- Inline steer input for the chosen row -->
          @if (steerEntry(); as e) {
            <ptah-agent-steer-input
              [steerable]="true"
              [pending]="pendingSteerId() === e.id"
              [placeholder]="'Steer ' + e.name + '…'"
              (steer)="steer.emit({ id: e.id, text: $event })"
            />
          }
        }
      </div>
    }
  `,
})
export class BackgroundAgentStripComponent {
  /** Rows to render. Strip hides when empty. */
  readonly entries = input.required<readonly BackgroundAgentStripEntry[]>();

  /** Id of the row whose steer request is in flight (disables its input). */
  readonly pendingSteerId = input<string | null>(null);

  /** Emits the entry id when its focus (open) area is clicked. */
  readonly focusAgent = output<string>();
  /** Emits the entry id + text when the inline steer input is submitted. */
  readonly steer = output<BackgroundAgentSteerRequest>();
  /** Emits the entry id when Stop is chosen from its menu. */
  readonly stop = output<string>();
  /** Emits the entry id when Send to background is chosen from its menu. */
  readonly sendToBackground = output<string>();
  /** Emits the entry id when View transcript is chosen from its menu. */
  readonly viewTranscript = output<string>();

  protected readonly SteerIcon = MessageSquare;
  protected readonly StopIcon = Square;
  protected readonly BackgroundIcon = Moon;
  protected readonly ScrollTextIcon = ScrollText;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly EllipsisIcon = Ellipsis;
  protected readonly CheckIcon = Check;
  protected readonly CircleXIcon = CircleX;

  protected readonly listId = `ptah-agent-strip-list-${nextStripInstance++}`;

  /** Whether the row list is expanded. Local UI state, collapsed by default. */
  protected readonly expanded = signal(false);
  /** Id of the row whose actions menu is open. */
  protected readonly openMenuId = signal<string | null>(null);
  /** Id of the row whose inline steer input is shown. */
  protected readonly steerId = signal<string | null>(null);

  constructor() {
    // When the list empties the strip hides; reset local state so it comes
    // back compact rather than re-opening a stale list or menu.
    effect(() => {
      if (this.entries().length > 0) return;
      untracked(() => {
        this.expanded.set(false);
        this.openMenuId.set(null);
        this.steerId.set(null);
      });
    });
  }

  protected readonly rows = computed<readonly StripRow[]>(() =>
    this.entries().map((entry) => ({
      entry,
      color: generateAgentColor(entry.agentType || entry.name),
      statusLine: this.buildStatusLine(entry),
      hasActions:
        entry.canViewTranscript ||
        entry.steerable ||
        entry.canBackground ||
        entry.stoppable,
    })),
  );

  protected readonly previewRows = computed(() =>
    this.rows().slice(0, MAX_PREVIEW_DOTS),
  );

  /** `4 agents · 3 running · 1 background` — zero buckets omitted. */
  readonly summaryText = computed(() => {
    const counts: Record<BackgroundAgentStripStatus, number> = {
      running: 0,
      background: 0,
      completed: 0,
      error: 0,
      stopped: 0,
    };
    const list = this.entries();
    for (const e of list) counts[e.status]++;
    const parts = [`${list.length} ${list.length === 1 ? 'agent' : 'agents'}`];
    if (counts.running) parts.push(`${counts.running} running`);
    if (counts.background) parts.push(`${counts.background} background`);
    if (counts.completed) parts.push(`${counts.completed} done`);
    if (counts.error) parts.push(`${counts.error} failed`);
    if (counts.stopped) parts.push(`${counts.stopped} stopped`);
    return parts.join(' · ');
  });

  /**
   * The entry whose steer input is shown, or null. Resolves against the live
   * list so the input auto-collapses when its agent leaves the strip or stops
   * being steerable (e.g. completes).
   */
  protected readonly steerEntry = computed<BackgroundAgentStripEntry | null>(
    () => {
      const id = this.steerId();
      if (!id) return null;
      const entry = this.entries().find((e) => e.id === id);
      return entry?.steerable ? entry : null;
    },
  );

  protected toggleExpanded(): void {
    this.expanded.update((v) => !v);
    this.openMenuId.set(null);
  }

  protected toggleMenu(id: string): void {
    this.openMenuId.update((cur) => (cur === id ? null : id));
  }

  protected closeMenu(returnFocusTo?: HTMLElement): void {
    this.openMenuId.set(null);
    returnFocusTo?.focus();
  }

  /** Choose Steer from a row menu: toggle the inline input for that row. */
  protected chooseSteer(id: string): void {
    this.openMenuId.set(null);
    this.steerId.update((cur) => (cur === id ? null : id));
  }

  /** Move keyboard focus into the menu once it is positioned. */
  protected focusFirstItem(panel: HTMLElement): void {
    panel.querySelector<HTMLButtonElement>('button')?.focus();
  }

  protected isTerminal(status: BackgroundAgentStripStatus): boolean {
    return status === 'completed' || status === 'error' || status === 'stopped';
  }

  protected statusLabel(status: BackgroundAgentStripStatus): string {
    return STATUS_LABEL[status];
  }

  private buildStatusLine(entry: BackgroundAgentStripEntry): string {
    const parts = [
      entry.description?.trim() || STATUS_LABEL[entry.status],
      formatAgentElapsed(entry.durationMs),
      formatAgentTokens(entry.totalTokens),
    ].filter((p): p is string => !!p);
    return parts.join(' · ');
  }
}
