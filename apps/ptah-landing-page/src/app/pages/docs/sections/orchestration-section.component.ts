import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Workflow,
  ArrowDown,
  CheckCircle2,
} from 'lucide-angular';
import { DocsCodeBlockComponent } from '../components/docs-code-block.component';
import { DocsMediaPlaceholderComponent } from '../components/docs-media-placeholder.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';

@Component({
  selector: 'ptah-docs-orchestration',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsCodeBlockComponent,
    DocsMediaPlaceholderComponent,
    DocsSectionShellComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="orchestration">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-white/90 mb-3"
      >
        Orchestration Workflow
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/50 mb-8 max-w-2xl"
      >
        The
        <code
          class="px-1.5 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-sm font-mono text-amber-400/80"
          >/orchestrate</code
        >
        command delegates complex tasks across specialized AI agents with user
        checkpoints at every stage.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- Usage example -->
        <div>
          <h3 class="text-base font-semibold text-white/80 mb-3">
            Quick Start
          </h3>
          <ptah-docs-code-block [code]="orchestrateExample" label="Ptah Chat" />
        </div>

        <!-- Workflow types -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <h3 class="text-base font-semibold text-white/80 mb-4">
            Workflow Types
          </h3>
          <div class="flex flex-wrap gap-2">
            @for (type of workflowTypes; track type) {
            <span
              class="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400/80 font-medium"
            >
              {{ type }}
            </span>
            }
          </div>
        </div>

        <!-- Agent delegation flow -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <h3 class="text-base font-semibold text-white/80 mb-5">
            Agent Delegation Flow
          </h3>
          <div class="flex flex-col items-center gap-2">
            @for (agent of agentFlow; track agent.name; let last = $last) {
            <div class="flex items-center gap-3 w-full max-w-xs">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border"
                [ngClass]="
                  agent.highlight
                    ? 'bg-amber-500/20 border-amber-500/30'
                    : 'bg-slate-700/40 border-slate-600/30'
                "
              >
                <span
                  class="text-xs font-bold"
                  [ngClass]="
                    agent.highlight ? 'text-amber-400' : 'text-white/50'
                  "
                >
                  {{ agent.abbr }}
                </span>
              </div>
              <div class="flex-1">
                <span class="text-sm font-medium text-white/80">{{
                  agent.name
                }}</span>
                <span class="text-xs text-white/40 ml-2">{{ agent.role }}</span>
              </div>
            </div>
            @if (!last) {
            <lucide-angular
              [img]="ArrowDownIcon"
              class="w-4 h-4 text-white/20"
              aria-hidden="true"
            />
            } }
          </div>
        </div>

        <!-- User checkpoints -->
        <div
          class="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/15"
        >
          <lucide-angular
            [img]="CheckCircle2Icon"
            class="w-5 h-5 text-green-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p class="text-sm text-white/60">
            <strong class="text-white/80">User checkpoints:</strong> You approve
            each stage before the workflow proceeds — plans, architecture
            decisions, implementation strategies, and final code review. Nothing
            ships without your sign-off.
          </p>
        </div>
      </div>

      <ng-container media>
        <ptah-docs-media-placeholder
          title="Orchestration Workflow"
          aspectRatio="16/9"
          mediaType="gif"
        />
      </ng-container>
    </ptah-docs-section-shell>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrchestrationSectionComponent {
  public readonly WorkflowIcon = Workflow;
  public readonly ArrowDownIcon = ArrowDown;
  public readonly CheckCircle2Icon = CheckCircle2;

  public readonly orchestrateExample = `/orchestrate Add user authentication with OAuth support

# Or specify a workflow type:
/orchestrate FEATURE Add dark mode toggle to settings`;

  public readonly workflowTypes = [
    'FEATURE',
    'BUGFIX',
    'REFACTORING',
    'DOCUMENTATION',
    'RESEARCH',
    'DEVOPS',
    'CREATIVE',
  ];

  public readonly agentFlow = [
    { name: 'Project Manager', abbr: 'PM', role: 'scoping', highlight: true },
    { name: 'Software Architect', abbr: 'SA', role: 'design', highlight: true },
    {
      name: 'Team Leader',
      abbr: 'TL',
      role: 'decomposition',
      highlight: false,
    },
    {
      name: 'Developers',
      abbr: 'DEV',
      role: 'implementation',
      highlight: false,
    },
    {
      name: 'QA / Reviewer',
      abbr: 'QA',
      role: 'verification',
      highlight: true,
    },
  ];

  public readonly headingConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.2,
  };

  public readonly introConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
  };

  public readonly contentConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.15,
    threshold: 0.1,
  };
}
