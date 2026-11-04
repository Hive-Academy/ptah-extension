import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { InspectorLaneRunDetail } from '@ptah-extension/chat-ui';

@Component({
  selector: 'ptah-inspector-agent-run-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = detail();
    <div class="ml-3 border-l border-surface-border pl-2 pb-2 text-[11px] text-base-content-muted" data-testid="agent-run-detail">
      <p>{{ d.cliLabel }}@if (d.role) { · {{ d.role }} }</p>
      <p>Model: {{ d.row.model ?? 'Unknown' }}</p>
      <p>Tokens: {{ tokens() }} · Cost: {{ cost() }}</p>
      <p>Status: {{ d.row.status.text }}</p>
      <p>Started: {{ d.row.started?.full ?? 'Unknown' }}</p>
      <p>{{ d.ownerText }}</p>
      @for (note of d.notes; track $index) { <p>{{ note }}</p> }
      @for (line of d.evidenceLines; track $index) { <p>{{ line }}</p> }
      @for (window of d.windows; track window.windowKey) {
        <p>{{ window.label }} · {{ window.usedText }} · {{ window.resetFacts.join(' · ') }}</p>
        @for (source of window.sourceChips; track source) { <span class="mr-1">{{ source }}</span> }
      }
    </div>
  `,
})
export class InspectorAgentRunDetailComponent {
  readonly detail = input.required<InspectorLaneRunDetail>();
  readonly tokens = input.required<string>();
  readonly cost = input.required<string>();
}
