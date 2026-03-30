import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Bot,
  ArrowRight,
  Terminal,
  Zap,
  Clock,
  Settings2,
  Globe,
} from 'lucide-angular';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';
import { DocsCollapsibleCardComponent } from '../components/docs-collapsible-card.component';
import { DocsVideoPlayerComponent } from '../components/docs-video-player.component';

interface AgentIntegration {
  name: string;
  description: string;
  badge: 'SDK' | 'CLI';
  invocation: string;
}

interface AgentTool {
  name: string;
  purpose: string;
}

interface PtahCliProvider {
  name: string;
  models: string;
}

interface WorkflowStep {
  label: string;
  detail: string;
}

interface ConfigSetting {
  key: string;
  description: string;
}

@Component({
  selector: 'ptah-docs-agent-orchestration',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsSectionShellComponent,
    DocsCollapsibleCardComponent,
    DocsVideoPlayerComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="agent-orchestration">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-base-content mb-3"
      >
        Agent Orchestration
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content mb-8 max-w-2xl"
      >
        Spawn
        <strong class="text-base-content/70">Gemini CLI</strong>,
        <strong class="text-base-content/70">Codex</strong>, and
        <strong class="text-base-content/70">GitHub Copilot</strong> as headless
        background workers, or connect your own providers via
        <strong class="text-base-content/70">Ptah CLI Agents</strong>. Your
        primary agent delegates independent subtasks and checks back for results
        — a <strong class="text-base-content/70">fire-and-check</strong> pattern
        that turns Ptah into a true multi-agent system.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- Built-in Agent Integrations -->
        <ptah-docs-collapsible-card
          [icon]="TerminalIcon"
          title="Built-in Agents"
          subtitle="Auto-detected"
          [expanded]="true"
        >
          <p class="text-sm text-neutral-content mb-4">
            Ptah auto-detects installed CLIs and SDK integrations at startup.
            Built-in agents use their own authentication — no extra API keys
            needed.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            @for (agent of builtinAgents; track agent.name) {
              <div
                class="rounded-lg bg-base-300/50 border border-secondary/10 p-4"
              >
                <div class="flex items-center gap-2 mb-1">
                  <h4 class="text-sm font-semibold text-base-content/80">
                    {{ agent.name }}
                  </h4>
                  <span
                    class="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
                    [ngClass]="
                      agent.badge === 'SDK'
                        ? 'bg-secondary/15 text-secondary/80'
                        : 'bg-base-300 text-neutral-content/50'
                    "
                  >
                    {{ agent.badge }}
                  </span>
                </div>
                <p class="text-xs text-neutral-content/60 mb-2">
                  {{ agent.description }}
                </p>
                <code
                  class="px-1.5 py-0.5 rounded bg-base-300 border border-secondary/10 text-xs font-mono text-secondary/70"
                  >{{ agent.invocation }}</code
                >
              </div>
            }
          </div>
        </ptah-docs-collapsible-card>

        <!-- Ptah CLI Agents -->
        <ptah-docs-collapsible-card
          [icon]="GlobeIcon"
          title="Ptah CLI Agents"
          subtitle="User-configurable"
        >
          <p class="text-sm text-neutral-content mb-4">
            Connect any
            <strong class="text-base-content/70"
              >Anthropic-compatible provider</strong
            >
            as a background agent. Each Ptah CLI agent gets its own API key,
            model selection, and tier mappings — configured directly in
            Settings.
          </p>
          <div class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              @for (provider of ptahCliProviders; track provider.name) {
                <div
                  class="flex items-center gap-2 px-3 py-2 rounded-lg bg-base-300/30 border border-secondary/10"
                >
                  <span class="text-sm font-medium text-base-content/70">{{
                    provider.name
                  }}</span>
                  <span class="text-xs text-neutral-content/40">{{
                    provider.models
                  }}</span>
                </div>
              }
            </div>
            <p class="text-xs text-neutral-content/50">
              Configure via
              <strong class="text-neutral-content/70"
                >Settings &rarr; Agent Orchestration &rarr; Add Ptah CLI
                Agent</strong
              >. Each agent supports connection testing, per-agent API keys
              stored securely in VS Code's Secret Storage, and automatic model
              discovery.
            </p>
          </div>
        </ptah-docs-collapsible-card>

        <!-- MCP Tools -->
        <ptah-docs-collapsible-card [icon]="ZapIcon" title="Agent MCP Tools">
          <p class="text-sm text-neutral-content mb-4">
            Six MCP tools give your primary agent full lifecycle control over
            background agents.
          </p>
          <div class="space-y-2">
            @for (tool of agentTools; track tool.name) {
              <div
                class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-base-300/30 border border-secondary/10"
              >
                <code
                  class="text-xs font-mono text-secondary/80 shrink-0 min-w-[160px]"
                  >{{ tool.name }}</code
                >
                <lucide-angular
                  [img]="ArrowRightIcon"
                  class="w-3 h-3 text-neutral-content/20 shrink-0"
                  aria-hidden="true"
                />
                <span class="text-sm text-neutral-content">{{
                  tool.purpose
                }}</span>
              </div>
            }
          </div>
        </ptah-docs-collapsible-card>

        <!-- Fire-and-Check Workflow -->
        <ptah-docs-collapsible-card
          [icon]="BotIcon"
          title="Fire-and-Check Workflow"
        >
          <div class="space-y-3">
            @for (step of workflowSteps; track step.label; let i = $index) {
              <div
                class="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-base-300/30 border border-secondary/10"
              >
                <div
                  class="w-6 h-6 rounded-full bg-secondary/10 flex items-center justify-center shrink-0 mt-0.5"
                >
                  <span class="text-xs font-bold text-secondary">{{
                    i + 1
                  }}</span>
                </div>
                <div>
                  <span class="text-sm font-medium text-base-content/80">{{
                    step.label
                  }}</span>
                  <p class="text-xs text-neutral-content/60 mt-0.5">
                    {{ step.detail }}
                  </p>
                </div>
              </div>
            }
          </div>
        </ptah-docs-collapsible-card>

        <!-- Use Cases -->
        <ptah-docs-collapsible-card [icon]="ClockIcon" title="When to Delegate">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            @for (useCase of useCases; track useCase) {
              <div
                class="flex items-center gap-2 px-3 py-2 rounded-lg bg-base-300/50 border border-secondary/10"
              >
                <lucide-angular
                  [img]="ArrowRightIcon"
                  class="w-3 h-3 text-secondary/60 shrink-0"
                  aria-hidden="true"
                />
                <span class="text-sm text-base-content/70">{{ useCase }}</span>
              </div>
            }
          </div>
        </ptah-docs-collapsible-card>

        <!-- Configuration -->
        <ptah-docs-collapsible-card
          [icon]="Settings2Icon"
          title="Configuration"
        >
          <div class="space-y-2">
            @for (setting of settings; track setting.key) {
              <div
                class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2.5 rounded-lg bg-base-300/30 border border-secondary/10"
              >
                <code
                  class="text-xs font-mono text-secondary/80 shrink-0 min-w-[280px]"
                  >{{ setting.key }}</code
                >
                <span class="text-sm text-neutral-content">{{
                  setting.description
                }}</span>
              </div>
            }
          </div>
        </ptah-docs-collapsible-card>
      </div>

      <ng-container media>
        <ptah-docs-video-player
          src="assets/videos/cli-agent-orchestration.mp4"
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
export class AgentOrchestrationSectionComponent {
  public readonly BotIcon = Bot;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly TerminalIcon = Terminal;
  public readonly ZapIcon = Zap;
  public readonly ClockIcon = Clock;
  public readonly Settings2Icon = Settings2;
  public readonly GlobeIcon = Globe;

  public readonly builtinAgents: AgentIntegration[] = [
    {
      name: 'Gemini CLI',
      description:
        'Google Gemini models via the CLI. Supports non-interactive prompt mode.',
      badge: 'CLI',
      invocation: 'gemini -p "task"',
    },
    {
      name: 'Codex',
      description:
        'OpenAI models via the Codex SDK. Runs in quiet non-interactive mode.',
      badge: 'SDK',
      invocation: 'Codex SDK adapter',
    },
    {
      name: 'GitHub Copilot',
      description:
        'Native SDK integration with full permission bridge and session management.',
      badge: 'SDK',
      invocation: 'Copilot SDK adapter',
    },
  ];

  public readonly ptahCliProviders: PtahCliProvider[] = [
    { name: 'OpenRouter', models: '200+ models' },
    { name: 'Moonshot (Kimi)', models: 'kimi-k2 series' },
    { name: 'Z.AI (GLM)', models: 'GLM-4 series' },
  ];

  public readonly agentTools: AgentTool[] = [
    {
      name: 'ptah_agent_spawn',
      purpose: 'Launch a CLI or SDK agent with a task in the background',
    },
    {
      name: 'ptah_agent_status',
      purpose: 'Check progress of one or all running agents',
    },
    {
      name: 'ptah_agent_read',
      purpose: 'Read stdout/stderr output from an agent',
    },
    {
      name: 'ptah_agent_steer',
      purpose:
        'Send steering instructions to a running agent (Gemini CLI only)',
    },
    {
      name: 'ptah_agent_stop',
      purpose: 'Gracefully stop a running agent process',
    },
    {
      name: 'ptah_agent_list',
      purpose: 'List all available agents and their current status',
    },
  ];

  public readonly workflowSteps: WorkflowStep[] = [
    {
      label: 'Spawn',
      detail:
        'Your primary agent launches a background agent with a task description and optional file focus list.',
    },
    {
      label: 'Continue',
      detail:
        'The primary agent continues its own work while the background agent runs independently.',
    },
    {
      label: 'Check',
      detail:
        'The primary agent periodically checks agent status — running, completed, or failed.',
    },
    {
      label: 'Read',
      detail:
        'Once complete, the primary agent reads the output and incorporates the results.',
    },
  ];

  public readonly useCases = [
    'Code reviews while implementing features',
    'Test generation while writing code',
    'Documentation while building',
    'Linting and formatting tasks',
    'Dependency audits in the background',
    'Boilerplate generation for new modules',
    'Multi-provider parallel task execution',
    'Cross-validation with different AI models',
  ];

  public readonly settings: ConfigSetting[] = [
    {
      key: 'ptah.agentOrchestration.preferredAgentOrder',
      description: 'Preferred agent spawn order (reorderable list)',
    },
    {
      key: 'ptah.agentOrchestration.maxConcurrentAgents',
      description: 'Max parallel agents (default: 3)',
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
