import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import type {
  OrchestratorCardModel,
  OrchestratorState,
} from '../../../services/session-inspector';
import { InspectorRequestLinesComponent } from './inspector-request-panel.component';

let nextCardId = 0;

function stateText(state: OrchestratorState): string {
  switch (state.kind) {
    case 'working':
      return 'working';
    case 'waiting':
      return `waiting on ${state.agents} ${state.agents === 1 ? 'agent' : 'agents'}`;
    case 'needs-you':
      return 'needs you';
    case 'idle':
      return 'idle';
  }
}

/** Dot ink per state; a live state adds the 3 px 22% ring (design 4.1). */
const DOT_CLASS: Readonly<Record<OrchestratorState['kind'], string>> = {
  working:
    'bg-state-run shadow-[0_0_0_3px_color-mix(in_srgb,var(--state-ink-run)_22%,transparent)]',
  waiting:
    'bg-state-need shadow-[0_0_0_3px_color-mix(in_srgb,var(--state-ink-need)_22%,transparent)]',
  'needs-you':
    'bg-state-need shadow-[0_0_0_3px_color-mix(in_srgb,var(--state-ink-need)_22%,transparent)]',
  idle: 'bg-state-idle',
};

/**
 * The Orchestrator card after the Delta 3 move (design D3.2): status dot,
 * `Orchestrator`, the state line (no model), and the Orchestrator-owned
 * request lines. Context, stats and limits live in the SESSION, PLAN LIMITS
 * and LANES sections; the card model's model / context / token / cost / turn
 * fields are not read here.
 */
@Component({
  selector: 'ptah-inspector-orchestrator-card',
  standalone: true,
  imports: [InspectorRequestLinesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-4" [attr.aria-labelledby]="headingId">
      <div class="flex items-center gap-[9px]">
        <span [class]="dotClass()" aria-hidden="true"></span>
        <h3 #heading [id]="headingId" tabindex="-1" class="text-sm font-semibold focus:outline-none">
          Orchestrator
        </h3>
      </div>
      <p class="mb-0 ml-[17px] mt-0.5 text-xs text-base-content-muted">
        {{ stateLine() }}
      </p>
      @if (card().requests.length > 0) {
        <ptah-inspector-request-lines
          class="ml-[17px] mt-2"
          [requests]="card().requests"
          ownerName="Orchestrator"
          [tabId]="tabId()"
          [hasLaneSurface]="false"
          (answerRequested)="answerRequested.emit($event)"
          (announced)="announced.emit($event)"
          (focusReleased)="focusHeading()"
        />
      }
    </section>
  `,
})
export class InspectorOrchestratorCardComponent {
  readonly card = input.required<OrchestratorCardModel>();
  readonly tabId = input.required<string>();

  readonly answerRequested = output<string>();
  readonly announced = output<string>();

  protected readonly headingId = `ptah-orch-h-${++nextCardId}`;
  private readonly heading =
    viewChild.required<ElementRef<HTMLElement>>('heading');

  protected readonly stateLine = computed(() => stateText(this.card().state));
  protected readonly dotClass = computed(
    () => `size-2 shrink-0 rounded-full ${DOT_CLASS[this.card().state.kind]}`,
  );

  protected focusHeading(): void {
    this.heading().nativeElement.focus();
  }
}
