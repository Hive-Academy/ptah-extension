import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { HarnessConfigPreviewComponent } from '../harness-config-preview.component';
import type { HarnessBuilderMode } from '../../services/harness-builder-records.service';
import { HarnessProposalHydrationService } from '../../services/harness-proposal-hydration.service';
import { builderPreviewSummary } from './builder-sidebar-helpers';

@Component({
  selector: 'ptah-builder-preview-section',
  standalone: true,
  imports: [HarnessConfigPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      aria-labelledby="builder-preview-title"
      class="p-4 border-b border-surface-border"
    >
      <h3
        id="builder-preview-title"
        class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
      >
        Preview
      </h3>
      <p class="text-[11px] text-base-content-muted">{{ summary() }}</p>
      <div class="mt-2">
        <ptah-harness-config-preview
          [config]="preview()"
          [document]="document()"
          [mode]="mode() === 'new-project' ? 'new-project' : 'configure'"
          [status]="previewStatus()"
          (retry)="hydration.retry()"
          (proposeAgain)="proposeAgain()"
        />
      </div>
    </section>
  `,
})
export class BuilderPreviewSectionComponent {
  readonly tabId = input.required<string>();
  readonly mode = input<HarnessBuilderMode>('configure-harness');
  readonly document = input<string | null>(null);
  protected readonly hydration = inject(HarnessProposalHydrationService);
  private readonly appState = inject(AppStateManager);
  protected readonly preview = computed(() => this.hydration.config());
  protected readonly summary = computed(() =>
    builderPreviewSummary(this.preview()),
  );
  protected readonly previewStatus = computed(() =>
    this.hydration.status() === 'loading'
      ? 'hydrating'
      : this.hydration.status() === 'error'
        ? 'failed'
        : this.hydration.status() === 'unavailable'
          ? 'unavailable'
          : 'ready',
  );
  protected proposeAgain(): void {
    this.appState.requestComposerPrefill(
      'Please propose the harness configuration again for this session.',
      this.tabId(),
    );
  }
}
