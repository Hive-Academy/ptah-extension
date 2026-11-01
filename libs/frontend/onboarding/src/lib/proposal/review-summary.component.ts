import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { HarnessConfig } from '@ptah-extension/shared';
import { ProposalPanelComponent } from './proposal-panel.component';
import type { ChangeTag } from './proposal-flow.store';

@Component({
  selector: 'ptah-review-summary',
  standalone: true,
  imports: [ProposalPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="space-y-3" aria-labelledby="review-summary-title">
    <h2 id="review-summary-title" class="text-lg font-semibold">
      {{
        previousOrdinal() > 0
          ? 'Changes since revision ' + previousOrdinal()
          : 'Initial proposal'
      }}
    </h2>
    <p class="text-sm text-base-content-muted">
      Only the configuration proposal is compared between revisions.
    </p>
    <ptah-proposal-panel
      [config]="config()"
      [tags]="tags()"
      [ordinal]="ordinal()"
      [complete]="complete()"
      [mode]="mode()"
      [tabId]="tabId()"
      [workspaceRoot]="workspaceRoot()"
      [showIntakeFacts]="showIntakeFacts()"
      [document]="document()"
      (copyDocument)="copyDocument.emit($event)"
    />
  </section>`,
})
export class ReviewSummaryComponent {
  readonly config = input<Partial<HarnessConfig>>({});
  readonly tags = input<ReadonlyMap<string, ChangeTag>>(new Map());
  readonly ordinal = input(0);
  readonly previousOrdinal = input(0);
  readonly complete = input(false);
  readonly mode = input<'new-project' | 'configure-harness'>(
    'configure-harness',
  );
  readonly tabId = input('');
  readonly workspaceRoot = input('');
  readonly showIntakeFacts = input(false);
  readonly document = input<string | null>(null);
  readonly copyDocument = output<string>();
}
