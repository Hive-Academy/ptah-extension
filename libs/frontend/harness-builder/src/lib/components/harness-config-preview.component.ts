import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
} from '@angular/core';
import {
  LucideAngularModule,
  User,
  Bot,
  Sparkles,
  FileText,
  Server,
  ChevronDown,
  ChevronRight,
} from 'lucide-angular';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';

@Component({
  selector: 'ptah-harness-config-preview',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  template: `
    <div class="space-y-2">
      <!-- Persona -->
      @if (persona(); as p) {
        <div class="collapse collapse-arrow bg-base-200/50 rounded-lg">
          <input type="checkbox" checked />
          <div
            class="collapse-title flex items-center gap-2 text-sm font-medium py-2 min-h-0"
          >
            <lucide-angular
              [img]="UserIcon"
              class="w-3.5 h-3.5 text-primary"
              aria-hidden="true"
            />
            Persona
          </div>
          <div class="collapse-content px-4 pb-3">
            <p class="text-xs font-semibold text-base-content">
              {{ p.label }}
            </p>
            @if (p.description) {
              <p class="text-xs text-base-content/60 mt-1 line-clamp-3">
                {{ p.description }}
              </p>
            }
            @if (p.goals && p.goals.length > 0) {
              <ul
                class="mt-1.5 space-y-1 text-xs text-base-content/60 list-disc list-inside"
              >
                @for (goal of p.goals.slice(0, 3); track goal) {
                  <li class="leading-tight">{{ goal }}</li>
                }
                @if (p.goals.length > 3) {
                  <li class="text-base-content/40">
                    +{{ p.goals.length - 3 }} more
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      }

      <!-- Agents -->
      @if (agentCount() > 0) {
        <div class="collapse collapse-arrow bg-base-200/50 rounded-lg">
          <input type="checkbox" />
          <div
            class="collapse-title flex items-center gap-2 text-sm font-medium py-2 min-h-0"
          >
            <lucide-angular
              [img]="BotIcon"
              class="w-3.5 h-3.5 text-secondary"
              aria-hidden="true"
            />
            {{ agentCount() }} Agent(s)
            @if (subagentCount() > 0) {
              <span class="badge badge-xs badge-secondary">
                +{{ subagentCount() }} custom
              </span>
            }
          </div>
          <div class="collapse-content px-4 pb-3">
            <div class="flex flex-wrap gap-1">
              @for (name of enabledAgentNames(); track name) {
                <span class="badge badge-xs badge-outline">{{ name }}</span>
              }
            </div>
          </div>
        </div>
      }

      <!-- Skills -->
      @if (skillCount() > 0) {
        <div class="collapse collapse-arrow bg-base-200/50 rounded-lg">
          <input type="checkbox" />
          <div
            class="collapse-title flex items-center gap-2 text-sm font-medium py-2 min-h-0"
          >
            <lucide-angular
              [img]="SparklesIcon"
              class="w-3.5 h-3.5 text-accent"
              aria-hidden="true"
            />
            {{ skillCount() }} Skill(s)
            @if (createdSkillCount() > 0) {
              <span class="badge badge-xs badge-accent">
                {{ createdSkillCount() }} custom
              </span>
            }
          </div>
          <div class="collapse-content px-4 pb-3">
            <div class="flex flex-wrap gap-1">
              @for (name of skillNames(); track name) {
                <span class="badge badge-xs badge-outline">{{ name }}</span>
              }
            </div>
          </div>
        </div>
      }

      <!-- Prompt -->
      @if (hasPrompt()) {
        <div class="collapse collapse-arrow bg-base-200/50 rounded-lg">
          <input type="checkbox" />
          <div
            class="collapse-title flex items-center gap-2 text-sm font-medium py-2 min-h-0"
          >
            <lucide-angular
              [img]="FileTextIcon"
              class="w-3.5 h-3.5 text-warning"
              aria-hidden="true"
            />
            System Prompt
          </div>
          <div class="collapse-content px-4 pb-3">
            <p
              class="text-xs text-base-content/70 whitespace-pre-wrap line-clamp-6"
            >
              {{ promptPreview() }}
            </p>
          </div>
        </div>
      }

      <!-- MCP Servers -->
      @if (mcpCount() > 0) {
        <div class="collapse collapse-arrow bg-base-200/50 rounded-lg">
          <input type="checkbox" />
          <div
            class="collapse-title flex items-center gap-2 text-sm font-medium py-2 min-h-0"
          >
            <lucide-angular
              [img]="ServerIcon"
              class="w-3.5 h-3.5 text-info"
              aria-hidden="true"
            />
            {{ mcpCount() }} MCP Server(s)
          </div>
          <div class="collapse-content px-4 pb-3">
            <div class="flex flex-wrap gap-1">
              @for (name of mcpNames(); track name) {
                <span class="badge badge-xs badge-outline">{{ name }}</span>
              }
            </div>
          </div>
        </div>
      }

      <!-- Empty state -->
      @if (!hasAnyConfig()) {
        <div class="text-center py-6 text-base-content/40 text-xs">
          No configuration yet. Start chatting to build your harness.
        </div>
      }
    </div>
  `,
})
export class HarnessConfigPreviewComponent {
  private readonly state = inject(HarnessBuilderStateService);

  protected readonly UserIcon = User;
  protected readonly BotIcon = Bot;
  protected readonly SparklesIcon = Sparkles;
  protected readonly FileTextIcon = FileText;
  protected readonly ServerIcon = Server;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;

  protected readonly persona = computed(() => this.state.config().persona);

  protected readonly agentCount = computed(() => {
    const agents = this.state.config().agents;
    if (!agents?.enabledAgents) return 0;
    return Object.values(agents.enabledAgents).filter((a) => a.enabled).length;
  });

  protected readonly subagentCount = computed(
    () => this.state.config().agents?.harnessSubagents?.length ?? 0,
  );

  protected readonly enabledAgentNames = computed(() => {
    const agents = this.state.config().agents;
    if (!agents?.enabledAgents) return [];
    return Object.entries(agents.enabledAgents)
      .filter(([, a]) => a.enabled)
      .map(([name]) => name);
  });

  protected readonly skillCount = computed(() => {
    const skills = this.state.config().skills;
    return (
      (skills?.selectedSkills?.length ?? 0) +
      (skills?.createdSkills?.length ?? 0)
    );
  });

  protected readonly createdSkillCount = computed(
    () => this.state.config().skills?.createdSkills?.length ?? 0,
  );

  protected readonly skillNames = computed(() => {
    const skills = this.state.config().skills;
    const names: string[] = [];
    if (skills?.selectedSkills) {
      names.push(...skills.selectedSkills);
    }
    if (skills?.createdSkills) {
      names.push(...skills.createdSkills.map((s) => s.name));
    }
    return names;
  });

  protected readonly hasPrompt = computed(
    () => !!this.state.config().prompt?.systemPrompt,
  );

  protected readonly promptPreview = computed(() => {
    const prompt = this.state.config().prompt?.systemPrompt ?? '';
    return prompt.length > 500 ? prompt.substring(0, 500) + '...' : prompt;
  });

  protected readonly mcpCount = computed(() => {
    const mcp = this.state.config().mcp;
    return mcp?.servers?.filter((s) => s.enabled).length ?? 0;
  });

  protected readonly mcpNames = computed(() => {
    const mcp = this.state.config().mcp;
    return mcp?.servers?.filter((s) => s.enabled).map((s) => s.name) ?? [];
  });

  protected readonly hasAnyConfig = computed(() => {
    const cfg = this.state.config();
    return !!(cfg.persona || cfg.agents || cfg.skills || cfg.prompt || cfg.mcp);
  });
}
