import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { LiveModelStats } from '@ptah-extension/chat-ui';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import type { HarnessBuilderMode } from '../services/harness-builder-records.service';
import { HarnessProposalHydrationService } from '../services/harness-proposal-hydration.service';
import { BuilderApplySectionComponent } from './sidebar/builder-apply-section.component';
import { BuilderStackProfileSectionComponent } from './sidebar/builder-stack-profile-section.component';
import { BuilderPreviewSectionComponent } from './sidebar/builder-preview-section.component';
import { BuilderAiHelpersSectionComponent } from './sidebar/builder-ai-helpers-section.component';
import { BuilderPresetsSectionComponent } from './sidebar/builder-presets-section.component';
import { BuilderSessionSectionComponent } from './sidebar/builder-session-section.component';

@Component({
  selector: 'ptah-harness-builder-sidebar',
  standalone: true,
  imports: [
    BuilderApplySectionComponent,
    BuilderStackProfileSectionComponent,
    BuilderPreviewSectionComponent,
    BuilderAiHelpersSectionComponent,
    BuilderPresetsSectionComponent,
    BuilderSessionSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-h-0 h-full' },
  template: `
    <aside
      id="builder-sidebar"
      aria-label="Configuration"
      [class]="
        sheet()
          ? 'flex flex-col w-full shrink-0 min-h-0 h-full bg-surface-1'
          : 'flex flex-col w-[336px] shrink-0 min-h-0 h-full bg-surface-1'
      "
    >
      <div
        data-testid="sidebar-strip"
        class="shrink-0 px-4 py-2.5 min-h-12 border-b border-surface-border flex items-center justify-between"
      >
        <h2 class="text-xs font-semibold">Configuration</h2>
        <span class="text-[11px] text-base-content-muted">{{ summary() }}</span>
      </div>
      <div
        data-testid="sidebar-scroll-body"
        class="flex-1 min-h-0 overflow-y-auto"
      >
        @if (!initialized()) {
          <section
            aria-labelledby="builder-setup-title"
            class="p-4 border-b border-surface-border"
          >
            <h3
              id="builder-setup-title"
              class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
            >
              Builder setup
            </h3>
            @if (initError()) {
              <div
                role="alert"
                class="mt-2 rounded-lg border border-state-err/55 bg-error/10 px-3 py-2.5 text-[13px]"
              >
                <p class="font-semibold">Could not load workspace details</p>
                <p>
                  Apply and the AI helpers need them. You can keep chatting
                  meanwhile.
                </p>
                <button
                  type="button"
                  class="btn btn-outline btn-sm mt-2 border-base-content/50"
                  (click)="retrySetup.emit()"
                >
                  Retry
                </button>
              </div>
            } @else {
              <div role="status" aria-busy="true" class="mt-2 space-y-2">
                <div class="skeleton h-3 w-full"></div>
                <div class="skeleton h-3 w-3/4"></div>
                <p class="text-xs text-base-content-muted">
                  Initializing AI Team Builder...
                </p>
              </div>
            }
          </section>
        }
        <ptah-builder-apply-section
          [workspaceRoot]="workspaceRoot()"
          [initialized]="initialized()"
          [agentBusy]="agentBusy()"
          [document]="document()"
          (openDashboard)="openDashboard.emit()"
        />
        <ptah-builder-stack-profile-section
          [tabId]="tabId()"
          [workspaceRoot]="workspaceRoot()"
          [initialized]="initialized()"
          [mode]="mode()"
        />
        <ptah-builder-preview-section
          [tabId]="tabId()"
          [mode]="mode()"
          [document]="document()"
        />
        <ptah-builder-ai-helpers-section
          [initialized]="initialized()"
          [tabId]="tabId()"
          [workspaceRoot]="workspaceRoot()"
          [document]="document()"
          (documentAdded)="document.set($event)"
        />
        <ptah-builder-presets-section
          [initialized]="initialized()"
          [tabId]="tabId()"
          [workspaceRoot]="workspaceRoot()"
          [document]="document()"
        />
        <ptah-builder-session-section
          [initialized]="initialized()"
          [statsSnapshot]="statsSnapshot()"
          [liveModelStats]="liveModelStats()"
        />
      </div>
    </aside>
  `,
})
export class HarnessBuilderSidebarComponent {
  readonly tabId = input.required<string>();
  readonly sheet = input(false);
  readonly workspaceRoot = input('');
  readonly mode = input<HarnessBuilderMode>('configure-harness');
  readonly initialized = input(false);
  readonly initError = input(false);
  readonly agentBusy = input(false);
  readonly statsSnapshot = input<SessionStatsEntry | null>(null);
  readonly liveModelStats = input<LiveModelStats | null>(null);
  readonly retrySetup = output<void>();
  readonly openDashboard = output<void>();
  protected readonly hydration = inject(HarnessProposalHydrationService);
  protected readonly document = signal<string | null>(null);
  protected readonly preview = computed(() => this.hydration.config());
  protected readonly summary = computed(
    () =>
      Object.keys(this.preview().agents?.enabledAgents ?? {}).length +
      ' agents, ' +
      (this.preview().skills?.selectedSkills.length ?? 0) +
      ' skills',
  );
}
