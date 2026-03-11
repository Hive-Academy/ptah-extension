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
import { DocsCollapsibleCardComponent } from '../components/docs-collapsible-card.component';
import { DocsMediaPlaceholderComponent } from '../components/docs-media-placeholder.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';

@Component({
  selector: 'ptah-docs-orchestration',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsCodeBlockComponent,
    DocsCollapsibleCardComponent,
    DocsMediaPlaceholderComponent,
    DocsSectionShellComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="orchestration">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-base-content mb-3"
      >
        Orchestration Workflow
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content mb-8 max-w-2xl"
      >
        The
        <code
          class="px-1.5 py-0.5 rounded bg-base-300 border border-secondary/10 text-sm font-mono text-secondary/80"
          >/orchestrate</code
        >
        command delegates complex tasks across specialized AI agents with user
        checkpoints at every stage.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- Usage example -->
        <div>
          <h3 class="text-base font-semibold text-base-content/80 mb-3">
            Quick Start
          </h3>
          <ptah-docs-code-block [code]="orchestrateExample" label="Ptah Chat" />
        </div>

        <!-- Workflow types -->
        <ptah-docs-collapsible-card
          [icon]="WorkflowIcon"
          title="Workflow Types"
          [expanded]="true"
        >
          <div class="flex flex-wrap gap-2">
            @for (type of workflowTypes; track type) {
            <span
              class="px-3 py-1.5 rounded-lg bg-secondary/10 border border-secondary/20 text-sm text-secondary/80 font-medium"
            >
              {{ type }}
            </span>
            }
          </div>
        </ptah-docs-collapsible-card>

        <!-- Agent delegation flow -->
        <ptah-docs-collapsible-card
          [icon]="WorkflowIcon"
          title="Agent Delegation Flow"
        >
          <div class="flex flex-col items-center gap-2">
            @for (agent of agentFlow; track agent.name; let last = $last) {
            <div class="flex items-center gap-3 w-full max-w-xs">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border"
                [ngClass]="
                  agent.highlight
                    ? 'bg-secondary/20 border-secondary/30'
                    : 'bg-base-300/50 border-secondary/10'
                "
              >
                <span
                  class="text-xs font-bold"
                  [ngClass]="
                    agent.highlight ? 'text-secondary' : 'text-neutral-content'
                  "
                >
                  {{ agent.abbr }}
                </span>
              </div>
              <div class="flex-1">
                <span class="text-sm font-medium text-base-content/80">{{
                  agent.name
                }}</span>
                <span class="text-xs text-neutral-content/60 ml-2">{{
                  agent.role
                }}</span>
              </div>
            </div>
            @if (!last) {
            <lucide-angular
              [img]="ArrowDownIcon"
              class="w-4 h-4 text-neutral-content/20"
              aria-hidden="true"
            />
            } }
          </div>
        </ptah-docs-collapsible-card>

        <!-- User checkpoints -->
        <div
          class="flex items-start gap-3 p-4 rounded-xl bg-secondary/5 border border-secondary/20"
        >
          <lucide-angular
            [img]="CheckCircle2Icon"
            class="w-5 h-5 text-success shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p class="text-sm text-neutral-content">
            <strong class="text-base-content/80">User checkpoints:</strong> You
            approve each stage before the workflow proceeds — plans,
            architecture decisions, implementation strategies, and final code
            review. Nothing ships without your sign-off.
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
