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
} from 'lucide-angular';
import { DocsMediaPlaceholderComponent } from '../components/docs-media-placeholder.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';

interface AgentTool {
  name: string;
  purpose: string;
}

interface CliAgent {
  name: string;
  description: string;
  invocation: string;
}

@Component({
  selector: 'ptah-docs-agent-orchestration',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsMediaPlaceholderComponent,
    DocsSectionShellComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="agent-orchestration">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-white/90 mb-3"
      >
        Agent Orchestration
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/50 mb-8 max-w-2xl"
      >
        Spawn
        <strong class="text-white/70">Gemini CLI</strong> and
        <strong class="text-white/70">Codex CLI</strong> as headless background
        workers. Claude delegates independent subtasks to these agents and
        checks back for results — a
        <strong class="text-white/70">fire-and-check</strong> pattern that turns
        Ptah into a true multi-agent system.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- Supported CLI Agents -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="TerminalIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">
              Supported CLI Agents
            </h3>
          </div>
          <p class="text-sm text-white/50 mb-4">
            Ptah auto-detects installed CLIs at startup. No API keys needed —
            agents use their own authentication.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            @for (agent of cliAgents; track agent.name) {
            <div
              class="rounded-lg bg-slate-700/30 border border-slate-600/30 p-4"
            >
              <h4 class="text-sm font-semibold text-white/80 mb-1">
                {{ agent.name }}
              </h4>
              <p class="text-xs text-white/40 mb-2">{{ agent.description }}</p>
              <code
                class="px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-600/40 text-xs font-mono text-amber-400/70"
                >{{ agent.invocation }}</code
              >
            </div>
            }
          </div>
        </div>

        <!-- MCP Tools -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="ZapIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">Agent MCP Tools</h3>
          </div>
          <p class="text-sm text-white/50 mb-4">
            Five MCP tools give Claude full lifecycle control over background
            agents.
          </p>
          <div class="space-y-2">
            @for (tool of agentTools; track tool.name) {
            <div
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-700/20 border border-slate-600/20"
            >
              <code
                class="text-xs font-mono text-amber-400/80 shrink-0 min-w-[160px]"
                >{{ tool.name }}</code
              >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-white/20 shrink-0"
                aria-hidden="true"
              />
              <span class="text-sm text-white/50">{{ tool.purpose }}</span>
            </div>
            }
          </div>
        </div>

        <!-- Fire-and-Check Workflow -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="BotIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">
              Fire-and-Check Workflow
            </h3>
          </div>
          <div class="space-y-3">
            @for (step of workflowSteps; track step.label; let i = $index) {
            <div
              class="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-slate-700/20 border border-slate-600/20"
            >
              <div
                class="w-6 h-6 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5"
              >
                <span class="text-xs font-bold text-amber-400">{{
                  i + 1
                }}</span>
              </div>
              <div>
                <span class="text-sm font-medium text-white/80">{{
                  step.label
                }}</span>
                <p class="text-xs text-white/40 mt-0.5">{{ step.detail }}</p>
              </div>
            </div>
            }
          </div>
        </div>

        <!-- Use Cases -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="ClockIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">
              When to Delegate
            </h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            @for (useCase of useCases; track useCase) {
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/30"
            >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-amber-400/60 shrink-0"
                aria-hidden="true"
              />
              <span class="text-sm text-white/70">{{ useCase }}</span>
            </div>
            }
          </div>
        </div>

        <!-- Configuration -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="Settings2Icon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">Configuration</h3>
          </div>
          <div class="space-y-2">
            @for (setting of settings; track setting.key) {
            <div
              class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2.5 rounded-lg bg-slate-700/20 border border-slate-600/20"
            >
              <code
                class="text-xs font-mono text-amber-400/80 shrink-0 min-w-[280px]"
                >{{ setting.key }}</code
              >
              <span class="text-sm text-white/50">{{
                setting.description
              }}</span>
            </div>
            }
          </div>
        </div>
      </div>

      <ng-container media>
        <ptah-docs-media-placeholder
          title="Agent Orchestration"
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
export class AgentOrchestrationSectionComponent {
  public readonly BotIcon = Bot;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly TerminalIcon = Terminal;
  public readonly ZapIcon = Zap;
  public readonly ClockIcon = Clock;
  public readonly Settings2Icon = Settings2;

  public readonly cliAgents: CliAgent[] = [
    {
      name: 'Gemini CLI',
      description:
        'Google Gemini models via the free-tier CLI. Supports non-interactive prompt mode.',
      invocation: 'gemini -p "task"',
    },
    {
      name: 'Codex CLI',
      description:
        'OpenAI models via the free-tier CLI. Runs in quiet non-interactive mode.',
      invocation: 'codex --quiet "task"',
    },
  ];

  public readonly agentTools: AgentTool[] = [
    {
      name: 'ptah_agent_spawn',
      purpose: 'Launch a CLI agent with a task in the background',
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
      purpose: 'Send steering instructions to a running agent',
    },
    {
      name: 'ptah_agent_stop',
      purpose: 'Gracefully stop a running agent process',
    },
  ];

  public readonly workflowSteps = [
    {
      label: 'Spawn',
      detail:
        'Claude launches a CLI agent with a task description and optional file focus list.',
    },
    {
      label: 'Continue',
      detail:
        'Claude continues its own work while the agent runs in the background.',
    },
    {
      label: 'Check',
      detail:
        'Claude periodically checks agent status — running, completed, or failed.',
    },
    {
      label: 'Read',
      detail:
        'Once complete, Claude reads the agent output and incorporates the results.',
    },
  ];

  public readonly useCases = [
    'Code reviews while implementing features',
    'Test generation while writing code',
    'Documentation while building',
    'Linting and formatting tasks',
    'Dependency audits in the background',
    'Boilerplate generation for new modules',
  ];

  public readonly settings = [
    {
      key: 'ptah.agentOrchestration.defaultCli',
      description: 'Preferred CLI agent (gemini or codex)',
    },
    {
      key: 'ptah.agentOrchestration.maxConcurrentAgents',
      description: 'Max parallel agents (default: 3)',
    },
    {
      key: 'ptah.agentOrchestration.defaultTimeout',
      description: 'Agent timeout in ms (default: 10 min, max: 30 min)',
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
