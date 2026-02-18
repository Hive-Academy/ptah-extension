import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
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

@Component({
  selector: 'ptah-docs-chat-dashboard',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsMediaPlaceholderComponent,
    DocsSectionShellComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="chat-dashboard">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-white/90 mb-3"
      >
        Chat &amp; Dashboard
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/50 mb-8 max-w-2xl"
      >
        A native VS Code chat interface with real-time agent visualization and a
        performance dashboard for tracking costs, tokens, and agent efficiency.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- ExecutionNode Tree -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="GitForkIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">
                Recursive ExecutionNode Tree
              </h3>
              <span class="text-xs text-white/40"
                >See your agents think in real-time</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50 mb-4">
            Every agent action renders as a live execution tree. You can see the
            main agent spawning sub-agents (e.g., Software Architect handing off
            to Frontend Developer), every tool call with file paths, thinking
            blocks, and results — all updating in real-time as tokens stream in.
          </p>

          <!-- Visual tree example -->
          <div
            class="rounded-lg bg-slate-900/60 border border-slate-700/40 p-4 font-mono text-xs leading-relaxed"
          >
            <div class="text-white/70">
              <span class="text-amber-400">User:</span> "Create a login page"
            </div>
            <div class="ml-4 mt-1.5 text-white/50">
              <div>
                <span class="text-blue-400">Main Agent</span>
                <span class="text-white/30"> THINKING...</span>
              </div>
              <div class="ml-4 mt-1">
                <span class="text-green-400/70">TOOL:</span> read-file
                <span class="text-white/30">("src/app/routes.ts")</span>
              </div>
              <div class="ml-4 mt-1">
                <span class="text-purple-400/70">AGENT SPAWN:</span>
                frontend-developer
              </div>
              <div class="ml-8 mt-0.5">
                <span class="text-blue-400/70">Thinking:</span>
                <span class="text-white/30"
                  >"I'll create LoginComponent..."</span
                >
              </div>
              <div class="ml-8 mt-0.5">
                <span class="text-green-400/70">TOOL:</span> write-file
                <span class="text-white/30">("src/app/login/...")</span>
              </div>
              <div class="ml-4 mt-1">
                <span class="text-blue-400">Response:</span>
                <span class="text-white/30">"Login page created with..."</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Chat Features -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="MessageSquareIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">Chat Features</h3>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            @for (feature of chatFeatures; track feature.label) {
            <div
              class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-slate-700/20 border border-slate-600/20"
            >
              <lucide-angular
                [img]="feature.icon"
                class="w-4 h-4 text-amber-400/60 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <span class="text-sm text-white/80 font-medium">{{
                  feature.label
                }}</span>
                <p class="text-xs text-white/40 mt-0.5">
                  {{ feature.description }}
                </p>
              </div>
            </div>
            }
          </div>
        </div>

        <!-- Dashboard -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="BarChart3Icon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">
                Performance Dashboard
              </h3>
              <span class="text-xs text-white/40"
                >Track costs, tokens, and agent efficiency</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50 mb-4">
            The dashboard provides real-time and historical analytics for all
            your AI sessions. Filter by time range (24h, 7d, 30d, 90d) and
            export data as CSV or JSON.
          </p>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            @for (metric of dashboardMetrics; track metric.label) {
            <div
              class="text-center px-3 py-3 rounded-lg bg-slate-700/20 border border-slate-600/20"
            >
              <lucide-angular
                [img]="metric.icon"
                class="w-4 h-4 text-amber-400/50 mx-auto mb-1.5"
                aria-hidden="true"
              />
              <span class="text-xs text-white/50 block">{{
                metric.label
              }}</span>
            </div>
            }
          </div>
        </div>
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
