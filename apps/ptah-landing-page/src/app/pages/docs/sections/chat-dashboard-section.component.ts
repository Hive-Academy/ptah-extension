import { Component, ChangeDetectionStrategy } from '@angular/core';

import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  MessageSquare,
  GitFork,
  BarChart3,
  DollarSign,
  Zap,
  AtSign,
  Slash,
} from 'lucide-angular';
import { DocsMediaPlaceholderComponent } from '../components/docs-media-placeholder.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';
import { DocsCollapsibleCardComponent } from '../components/docs-collapsible-card.component';

@Component({
  selector: 'ptah-docs-chat-dashboard',
  imports: [
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsMediaPlaceholderComponent,
    DocsSectionShellComponent,
    DocsCollapsibleCardComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="chat-dashboard">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-base-content mb-3"
      >
        Chat &amp; Dashboard
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content mb-8 max-w-2xl"
      >
        A native VS Code chat interface with real-time agent visualization and a
        performance dashboard for tracking costs, tokens, and agent efficiency.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- ExecutionNode Tree -->
        <ptah-docs-collapsible-card
          [icon]="GitForkIcon"
          title="Recursive ExecutionNode Tree"
          subtitle="See your agents think in real-time"
          [expanded]="true"
        >
          <p class="text-sm text-neutral-content mb-4">
            Every agent action renders as a live execution tree. You can see the
            main agent spawning sub-agents (e.g., Software Architect handing off
            to Frontend Developer), every tool call with file paths, thinking
            blocks, and results — all updating in real-time as tokens stream in.
          </p>

          <!-- Visual tree example -->
          <div
            class="rounded-lg bg-base-300 border border-secondary/10 p-4 font-mono text-xs leading-relaxed"
          >
            <div class="text-base-content/70">
              <span class="text-secondary">User:</span> "Create a login page"
            </div>
            <div class="ml-4 mt-1.5 text-neutral-content">
              <div>
                <span class="text-blue-400">Main Agent</span>
                <span class="text-neutral-content/40"> THINKING...</span>
              </div>
              <div class="ml-4 mt-1">
                <span class="text-green-400/70">TOOL:</span> read-file
                <span class="text-neutral-content/40"
                  >("src/app/routes.ts")</span
                >
              </div>
              <div class="ml-4 mt-1">
                <span class="text-purple-400/70">AGENT SPAWN:</span>
                frontend-developer
              </div>
              <div class="ml-8 mt-0.5">
                <span class="text-blue-400/70">Thinking:</span>
                <span class="text-neutral-content/40"
                  >"I'll create LoginComponent..."</span
                >
              </div>
              <div class="ml-8 mt-0.5">
                <span class="text-green-400/70">TOOL:</span> write-file
                <span class="text-neutral-content/40"
                  >("src/app/login/...")</span
                >
              </div>
              <div class="ml-4 mt-1">
                <span class="text-blue-400">Response:</span>
                <span class="text-neutral-content/40"
                  >"Login page created with..."</span
                >
              </div>
            </div>
          </div>
        </ptah-docs-collapsible-card>

        <!-- Chat Features -->
        <ptah-docs-collapsible-card
          [icon]="MessageSquareIcon"
          title="Chat Features"
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            @for (feature of chatFeatures; track feature.label) {
              <div
                class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-base-300/30 border border-secondary/10"
              >
                <lucide-angular
                  [img]="feature.icon"
                  class="w-4 h-4 text-secondary/60 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <span class="text-sm text-base-content/80 font-medium">{{
                    feature.label
                  }}</span>
                  <p class="text-xs text-neutral-content/60 mt-0.5">
                    {{ feature.description }}
                  </p>
                </div>
              </div>
            }
          </div>
        </ptah-docs-collapsible-card>

        <!-- Dashboard -->
        <ptah-docs-collapsible-card
          [icon]="BarChart3Icon"
          title="Performance Dashboard"
          subtitle="Track costs, tokens, and agent efficiency"
        >
          <p class="text-sm text-neutral-content mb-4">
            The dashboard provides real-time and historical analytics for all
            your AI sessions. Filter by time range (24h, 7d, 30d, 90d) and
            export data as CSV or JSON.
          </p>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            @for (metric of dashboardMetrics; track metric.label) {
              <div
                class="text-center px-3 py-3 rounded-lg bg-base-300/30 border border-secondary/10"
              >
                <lucide-angular
                  [img]="metric.icon"
                  class="w-4 h-4 text-secondary/50 mx-auto mb-1.5"
                  aria-hidden="true"
                />
                <span class="text-xs text-neutral-content block">{{
                  metric.label
                }}</span>
              </div>
            }
          </div>
        </ptah-docs-collapsible-card>
      </div>

      <ng-container media>
        <ptah-docs-media-placeholder
          title="Chat with Agent Tree"
          aspectRatio="4/3"
          mediaType="gif"
        />
        <ptah-docs-media-placeholder
          title="Performance Dashboard"
          aspectRatio="4/3"
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
export class ChatDashboardSectionComponent {
  public readonly MessageSquareIcon = MessageSquare;
  public readonly GitForkIcon = GitFork;
  public readonly BarChart3Icon = BarChart3;
  public readonly DollarSignIcon = DollarSign;
  public readonly ZapIcon = Zap;
  public readonly AtSignIcon = AtSign;
  public readonly SlashIcon = Slash;

  public readonly chatFeatures = [
    {
      label: '@agent autocomplete',
      description:
        'Type @ to discover and select from builtin, project, and user agents',
      icon: AtSign,
    },
    {
      label: '/command autocomplete',
      description:
        'Type / to discover slash commands from builtin and project directories',
      icon: Slash,
    },
    {
      label: 'Streaming text reveal',
      description:
        'Character-by-character response rendering with typing cursor animation',
      icon: Zap,
    },
    {
      label: 'Session management',
      description:
        'Create, switch, and resume sessions with full history preserved',
      icon: MessageSquare,
    },
    {
      label: 'Real-time cost tracking',
      description:
        'Token usage and cost displayed per session with input/output breakdown',
      icon: DollarSign,
    },
    {
      label: 'File attachments',
      description:
        'Fuzzy file search to attach workspace files as context to your messages',
      icon: AtSign,
    },
  ];

  public readonly dashboardMetrics = [
    { label: 'Total Cost', icon: DollarSign },
    { label: 'Token Usage', icon: BarChart3 },
    { label: 'Session Count', icon: MessageSquare },
    { label: 'Agent Performance', icon: Zap },
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
