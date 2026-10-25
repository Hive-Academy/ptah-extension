import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
  InspectorLimitsLanesComponent,
  InspectorSessionStatsComponent,
  type SessionStatsInputs,
} from '@ptah-extension/chat-ui';
import { LucideAngularModule, X } from 'lucide-angular';
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
export type SessionInspectorPresentation = 'docked' | 'sheet' | 'embedded';

/**
 * `ptah-session-inspector`: the "This session" body (design 4, D45). One
 * component serves the chat-view (docked or sheet) and the Rail board aside;
 * hosts load it only inside `@defer`, so its sections stay a lazy chunk.
 *
 * Section order (D45): Orchestrator, the projected `[inspectorSection]` add-on
 * slot (no wrapper, so an empty slot leaves no box), SESSION (when `stats`),
 * AGENTS, PLAN LIMITS + LANES (when `stats.limits`), TASK, TODOS, GIT. Rows
 * carry `st-r` + `--i` for the entry stagger; the CSS caps the index at 6.
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
})
export class SessionInspectorComponent {
  private readonly store = inject(SessionInspectorStore);
  /** Provided by the chat-view host only; the Rail board has no sheet. */
  private readonly shell = inject(InspectorShellController, { optional: true });

  readonly tabId = input.required<string>();
  readonly presentation = input<SessionInspectorPresentation>('docked');
  /** The host has a lane surface (Rail board): agent rows open lanes. */
  readonly hasLaneSurface = input<boolean>(false);
  /** Session stats of the shown view; `null` hides SESSION / PLAN LIMITS / LANES. */
  readonly stats = input<SessionStatsInputs | null>(null);

  readonly closeRequested = output<void>();
  readonly laneRequested = output<string>();
  readonly answerRequested = output<string>();

  protected readonly XIcon = X;

  /** Polite live region text: request outcomes only (design 4.5). */
  protected readonly announcement = signal('');

  private readonly closeButton =
    viewChild<ElementRef<HTMLElement>>('closeButton');
  private readonly limitsLanes = viewChild(InspectorLimitsLanesComponent);

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

  protected announce(text: string): void {
    this.announcement.set(text);
  }

  protected onLimitsLinkActivated(source: 'session' | 'lane'): void {
    this.limitsLanes()?.focusHeading(source);
  }
}
