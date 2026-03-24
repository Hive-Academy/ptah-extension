import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Wand2,
  ScanSearch,
  BrainCircuit,
  Users,
  FileCode2,
  CheckCircle2,
} from 'lucide-angular';
import { DocsStepCardComponent } from '../components/docs-step-card.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';
import { DocsCollapsibleCardComponent } from '../components/docs-collapsible-card.component';
import { DocsVideoPlayerComponent } from '../components/docs-video-player.component';

@Component({
  selector: 'ptah-docs-setup-wizard',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsStepCardComponent,
    DocsSectionShellComponent,
    DocsCollapsibleCardComponent,
    DocsVideoPlayerComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="setup-wizard">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-base-content mb-3"
      >
        Setup Wizard
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content mb-8 max-w-2xl"
      >
        The setup wizard scans your workspace and configures Ptah's AI agents
        for your project automatically.
      </p>

      <!-- Wizard Steps -->
      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <ptah-docs-collapsible-card
          [icon]="Wand2Icon"
          title="6-Step Setup Wizard"
          [expanded]="true"
        >
          <!-- Step flow visualization -->
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            @for (step of wizardSteps; track step.label; let i = $index) {
            <div
              class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-base-300/50 border border-secondary/10"
            >
              <div
                class="w-6 h-6 rounded-full bg-secondary/10 flex items-center justify-center shrink-0"
              >
                <span class="text-xs font-bold text-secondary">{{
                  i + 1
                }}</span>
              </div>
              <span class="text-sm text-base-content/70">{{ step.label }}</span>
            </div>
            }
          </div>

          <div class="space-y-4">
            <ptah-docs-step-card [stepNumber]="1" title="Open the Setup Wizard">
              <p>
                Click the
                <strong class="text-base-content/80">Setup Wizard</strong>
                button in the Ptah sidebar, or run the
                <strong class="text-base-content/80"
                  >Ptah: Run Setup Wizard</strong
                >
                command from the Command Palette (<kbd
                  class="px-1.5 py-0.5 rounded bg-base-300 border border-secondary/10 text-xs font-mono text-secondary/80"
                  >Ctrl+Shift+P</kbd
                >).
              </p>
            </ptah-docs-step-card>

            <ptah-docs-step-card
              [stepNumber]="2"
              title="Let it scan your workspace"
            >
              <p>
                The wizard detects your project type, frameworks, dependencies,
                and existing configurations. It supports 13+ project types
                including React, Angular, Node.js, Python, and more.
              </p>
            </ptah-docs-step-card>

            <ptah-docs-step-card [stepNumber]="3" title="Review and generate">
              <p>
                Review the detected agents, adjust selections if needed, and
                generate your project-specific CLAUDE.md rules and agent
                configurations.
              </p>
            </ptah-docs-step-card>
          </div>
        </ptah-docs-collapsible-card>
      </div>

      <ng-container media>
        <!-- Analysis Phase -->
        <div class="space-y-3">
          <p
            class="text-xs font-medium text-neutral-content/60 uppercase tracking-wide"
          >
            Workspace Analysis
          </p>
          <ptah-docs-video-player
            src="assets/videos/setup-wizard-analysis.mp4"
          />
        </div>

        <!-- Agent Generation Phase -->
        <div class="space-y-3 mt-6">
          <p
            class="text-xs font-medium text-neutral-content/60 uppercase tracking-wide"
          >
            Agent Generation
          </p>
          <ptah-docs-video-player
            src="assets/videos/setup-wizard-agent-generation.mp4"
          />
        </div>
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
export class SetupWizardSectionComponent {
  public readonly Wand2Icon = Wand2;
  public readonly ScanSearchIcon = ScanSearch;
  public readonly BrainCircuitIcon = BrainCircuit;
  public readonly UsersIcon = Users;
  public readonly FileCode2Icon = FileCode2;
  public readonly CheckCircle2Icon = CheckCircle2;

  public readonly wizardSteps = [
    { label: 'Scan' },
    { label: 'Analyze' },
    { label: 'Detect' },
    { label: 'Select Agents' },
    { label: 'Generate Rules' },
    { label: 'Complete' },
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
