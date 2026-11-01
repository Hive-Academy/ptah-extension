import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  compactSessionMetrics,
  limitAwareDot,
  summarizeTodos,
  InspectorLimitsLanesComponent,
  InspectorSessionStatsComponent,
  type SessionStatsInputs,
  type SessionLimitSummary,
} from '@ptah-extension/chat-ui';
import { TabManagerService } from '@ptah-extension/chat-state';
import { LucideAngularModule, PanelRightClose } from 'lucide-angular';
import {
  InspectorShellController,
  SessionInspectorStore,
} from '../../../services/session-inspector';
import { InspectorAgentsSectionComponent } from './inspector-agents-section.component';
import { InspectorGitSectionComponent } from './inspector-git-section.component';
import { InspectorRequestLinesComponent } from './inspector-request-panel.component';
import { InspectorTaskSectionComponent } from './inspector-task-section.component';
import { InspectorTodosSectionComponent } from './inspector-todos-section.component';

/** Where the inspector body is shown; `sheet` is the modal overlay band. */
export type SessionInspectorPresentation =
  'docked' | 'sheet' | 'embedded' | 'rail';
type InspectorFocusSection = 'session' | 'agents' | 'todos';

function statsSwitchWindowMs(element: HTMLElement): number {
  const value = typeof getComputedStyle === 'function'
    ? getComputedStyle(element).getPropertyValue('--ptah-motion-switch').trim()
    : '';
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value);
  const durationMs = match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : 380;
  return durationMs + 40;
}

/**
 * `ptah-session-inspector`: the "This session" body (design 4, D45). One
 * component serves the chat-view (docked or sheet) and the Rail board aside;
 * hosts load it only inside `@defer`, so its sections stay a lazy chunk.
 *
 * Section order (D45, rev 3 "B+"): Orchestrator requests, the projected
 * `[inspectorSection]` add-on slot (no wrapper, so an empty slot leaves no
 * box), SESSION totals (when `stats`), AGENTS (every agent, the selected row
 * expanded in place), PLAN LIMITS + LANES (when `stats.limits`), TASK,
 * TODOS, GIT. Rows carry `st-r` + `--i` for the entry stagger; the CSS
 * caps the index at 6.
 */
@Component({
  selector: 'ptah-session-inspector',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    LucideAngularModule,
    InspectorRequestLinesComponent,
    InspectorSessionStatsComponent,
    InspectorAgentsSectionComponent,
    InspectorLimitsLanesComponent,
    InspectorTaskSectionComponent,
    InspectorTodosSectionComponent,
    InspectorGitSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-inspector.component.html',
  // Glass on: docked, the inspector sits in a chrome pane (the Stats dock),
  // so it stays clear and the pane's blur shows. The sheet and the 56 px
  // rail strip (no glass pane behind it) keep their fill.
  styles: `
    :host-context([data-glass='on']) aside[data-inspector-pane] {
      background: transparent;
    }
    .inspector-stats-switch { position: relative; }
    .inspector-stats-leave {
      position: absolute;
      inset: 0;
      pointer-events: none;
      animation: ptahMotionLeave var(--ptah-motion-out) var(--ptah-ease-gentle-in) forwards;
    }
    .inspector-stats-enter {
      animation: ptahMotionEnter var(--ptah-motion-switch) var(--ptah-ease-soft) backwards;
    }
    :host-context([data-glass='on']) .inspector-stats-enter {
      animation-name: ptahMotionEnterGlass;
    }
    :host-context([data-glass='on'][data-motion-style='fade']) .inspector-stats-enter {
      --ptah-motion-enter-y: 18px;
    }
    :host-context([data-glass='on'][data-motion-style='scale']) .inspector-stats-enter {
      --ptah-motion-enter-y: 6px;
    }
    :host-context([data-glass='on']) .inspector-stats-leave {
      animation: none;
      display: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .inspector-stats-leave { display: none; }
      .inspector-stats-enter {
        animation: none;
      }
    }
  `,
})
export class SessionInspectorComponent {
  private readonly store = inject(SessionInspectorStore);
  private readonly tabs = inject(TabManagerService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Provided by the chat-view host only; the Rail board has no sheet. */
  private readonly shell = inject(InspectorShellController, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private statsSwitchTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly leavingStats = signal<SessionStatsInputs | null>(null);
  protected readonly statsSwitching = signal(false);

  readonly tabId = input.required<string>();
  readonly presentation = input<SessionInspectorPresentation>('docked');
  /** The host has a lane surface (Rail board): agent rows open lanes. */
  readonly hasLaneSurface = input<boolean>(false);
  /** Canvas selection; undefined retains standalone selection, null clears it. */
  readonly selectedAgentKey = input<string | null>();
  /** Session stats of the shown view; `null` hides SESSION / PLAN LIMITS / LANES. */
  readonly stats = input<SessionStatsInputs | null>(null);
  readonly limitSummary = input<SessionLimitSummary | null>();
  readonly sessionTitle = input('');
  readonly sessionStatus = input('');
  readonly workflow = input<string | null>(null);
  readonly branch = input<string | null>(null);
  /** Host can retain this across a rail -> dock/sheet remount. */
  readonly focusSection = input<InspectorFocusSection | null>(null);

  readonly closeRequested = output<void>();
  readonly expandRequested = output<InspectorFocusSection | undefined>();
  /** "Open thread" on an agent row: show that agent's lane. */
  readonly laneRequested = output<string>();
  /** An AGENTS row was selected (or the selected key was normalized). */
  readonly agentSelected = output<string>();
  readonly answerRequested = output<string>();

  protected readonly PanelRightCloseIcon = PanelRightClose;

  /** Polite live region text: request outcomes only (design 4.5). */
  protected readonly announcement = signal('');

  private readonly closeButton =
    viewChild<ElementRef<HTMLElement>>('closeButton');
  private readonly expandButton =
    viewChild<ElementRef<HTMLButtonElement>>('expandButton');

  protected readonly railLimitSummary = computed(
    () => this.limitSummary() ?? this.stats()?.limitSummary ?? null,
  );
  protected readonly railLimitDot = computed(() =>
    limitAwareDot(null, false, this.railLimitSummary()),
  );
  protected readonly railLimitDescription = computed(() =>
    this.railLimitDot() ? (this.railLimitSummary()?.fullText ?? '') : '',
  );
  protected readonly expandLabel = computed(() =>
    this.railLimitDescription()
      ? `Expand session details; ${this.railLimitDescription()}`
      : 'Expand session details',
  );
  protected readonly railMetrics = computed(() => {
    const stats = this.stats();
    if (!stats) return [];
    const warning = this.railLimitDescription();
    return compactSessionMetrics(stats).map((metric) =>
      metric.id === 'context' && warning
        ? { ...metric, ariaLabel: `${metric.ariaLabel}; ${warning}` }
        : metric,
    );
  });
  protected readonly railTodos = computed(() => {
    const tab = this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.tab;
    const summary = tab
      ? summarizeTodos(
          tab.messages ?? [],
          tab.streamingState ?? null,
          tab.lastCompactionAt ?? 0,
        )
      : null;
    return summary?.kind === 'known' && summary.total > 0 ? summary : null;
  });
  protected readonly runLabel = computed(() => {
    const model = this.model();
    const count = model.agents.data?.active;
    return `${count == null ? 'Running agents unavailable' : `Running agents: ${count}`}; ${model.needsYouCount} need you`;
  });

  /** Prompt (uncached + cache) and output tokens of the session. */
  protected readonly sessionTokens = computed(() => {
    const tokens = this.stats()?.snapshot?.tokens;
    return tokens
      ? {
          input: tokens.input + tokens.cacheRead + tokens.cacheCreation,
          output: tokens.output,
        }
      : null;
  });

  protected readonly model = computed(() =>
    this.store.modelFor(this.tabId())(),
  );

  /** AGENTS rows continue the stagger after Orchestrator (+ SESSION). */
  protected readonly agentsStaggerStart = computed(() =>
    this.stats() ? 1 : 0,
  );

  protected readonly afterAgentsIndex = computed(
    () =>
      this.agentsStaggerStart() +
      1 +
      (this.model().agents.data?.rows.length ?? 0),
  );

  constructor() {
    let previousSessionId: string | null = null;
    let previousStats: SessionStatsInputs | null = null;
    effect(() => {
      const stats = this.stats();
      if (stats === null) {
        if (this.statsSwitchTimer !== null) clearTimeout(this.statsSwitchTimer);
        this.statsSwitchTimer = null;
        this.leavingStats.set(null);
        this.statsSwitching.set(false);
        // Keep the last session snapshot across one empty interval. A new
        // session can then leave from it; the same session does not replay.
        return;
      }
      const sessionId = stats?.sessionId ?? null;
      const changed = previousSessionId !== null &&
        sessionId !== null && sessionId !== previousSessionId;
      if (changed && stats && previousStats) {
        if (this.statsSwitchTimer !== null) clearTimeout(this.statsSwitchTimer);
        this.leavingStats.set(previousStats);
        this.statsSwitching.set(true);
        this.statsSwitchTimer = setTimeout(() => {
          this.statsSwitchTimer = null;
          this.leavingStats.set(null);
          this.statsSwitching.set(false);
        }, statsSwitchWindowMs(this.element.nativeElement));
      }
      if (sessionId !== null) previousSessionId = sessionId;
      if (stats) previousStats = stats;
    });
    this.destroyRef.onDestroy(() => {
      if (this.statsSwitchTimer !== null) clearTimeout(this.statsSwitchTimer);
    });
    let previous: SessionInspectorPresentation | undefined;
    afterRenderEffect(() => {
      const presentation = this.presentation();
      const section = this.focusSection();
      if (presentation === 'rail' && previous && previous !== 'rail') {
        this.focusExpandControl();
      } else if (presentation !== 'rail' && section) {
        const target = this.element.nativeElement.querySelector<HTMLElement>(
          `[data-inspector-section="${section}"]`,
        );
        (target ?? this.closeButton()?.nativeElement)?.focus();
      }
      previous = presentation;
    });
    // Late mount from the deferred chunk: let the shell focus the close
    // button if the sheet opened before this body rendered.
    effect(() => {
      const button = this.closeButton();
      if (button && this.shell) {
        const shell = this.shell;
        untracked(() => shell.closeReady(button.nativeElement));
      }
    });
  }

  /** For hosts that replace the expanded instance with a newly mounted rail. */
  focusExpandControl(): void {
    this.expandButton()?.nativeElement.focus();
  }

  protected announce(text: string): void {
    this.announcement.set(text);
  }
}
