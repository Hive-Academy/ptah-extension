import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type { HarnessConfig } from '@ptah-extension/shared';
import {
  LucideAngularModule,
  User,
  Bot,
  Sparkles,
  FileText,
  Server,
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
      @if (status() === 'hydrating') {
        <div role="status" aria-busy="true" class="space-y-2 py-3">
          <span class="sr-only">Restoring configuration</span>
          <div class="skeleton h-3 w-full"></div>
          <div class="skeleton h-3 w-3/4"></div>
          <div class="skeleton h-3 w-1/2"></div>
          <p class="text-xs text-base-content-muted">
            Restoring the configuration from your last session...
          </p>
        </div>
      } @else if (status() === 'unavailable') {
        <div
          role="status"
          class="rounded-lg border border-surface-border surface-2 p-3 text-xs"
        >
          <p class="font-medium">Saved configuration unavailable</p>
          <p class="mt-1 text-base-content-muted">
            The configuration saved for this session has expired or was cleared,
            so the preview is empty. Your conversation is intact.
          </p>
          <button
            type="button"
            class="btn btn-outline btn-xs mt-2"
            (click)="proposeAgain.emit()"
          >
            Ask the agent to propose it again
          </button>
        </div>
      } @else if (status() === 'failed') {
        <div
          role="alert"
          class="rounded-lg border border-surface-border surface-2 p-3 text-xs"
        >
          <p class="font-medium">Could not restore the configuration</p>
          <p class="mt-1 text-base-content-muted">
            Something went wrong while loading it. Your conversation is not
            affected.
          </p>
          <button
            type="button"
            class="btn btn-outline btn-xs mt-2"
            (click)="retry.emit()"
          >
            Retry
          </button>
        </div>
      } @else {
        @if (restored()) {
          <p role="status" class="text-xs text-base-content-muted">
            Restored after reload
          </p>
        }
        <!-- Persona -->
        @if (persona(); as p) {
          <div class="collapse collapse-arrow surface-2 rounded-lg">
            <input type="checkbox" checked aria-label="Persona" />
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
                <p class="text-xs text-base-content-muted mt-1 line-clamp-3">
                  {{ p.description }}
                </p>
              }
              @if (p.goals && p.goals.length > 0) {
                <ul
                  class="mt-1.5 space-y-1 text-xs text-base-content-muted list-disc list-inside"
                >
                  @for (goal of p.goals.slice(0, 3); track goal) {
                    <li class="leading-tight">{{ goal }}</li>
                  }
                  @if (p.goals.length > 3) {
                    <li class="text-base-content-muted">
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
          <div class="collapse collapse-arrow surface-2 rounded-lg">
            <input type="checkbox" aria-label="Agents" />
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
          <div class="collapse collapse-arrow surface-2 rounded-lg">
            <input type="checkbox" aria-label="Skills" />
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
          <div class="collapse collapse-arrow surface-2 rounded-lg">
            <input type="checkbox" aria-label="System Prompt" />
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
                class="text-xs text-base-content-muted whitespace-pre-wrap line-clamp-6"
              >
                {{ promptPreview() }}
              </p>
            </div>
          </div>
        }

        <!-- MCP Servers -->
        @if (mcpCount() > 0) {
          <div class="collapse collapse-arrow surface-2 rounded-lg">
            <input type="checkbox" aria-label="MCP Servers" />
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

        @if (documentContent()) {
          <div class="collapse collapse-arrow surface-2 rounded-lg">
            <input type="checkbox" aria-label="Generated document" />
            <div
              class="collapse-title flex items-center gap-2 text-sm font-medium py-2 min-h-0"
            >
              <lucide-angular
                [img]="FileTextIcon"
                class="w-3.5 h-3.5 text-info"
                aria-hidden="true"
              />
              Generated document
            </div>
            <div class="collapse-content px-4 pb-3">
              <div
                tabindex="0"
                role="region"
                aria-label="Generated document"
                class="max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-base-content-muted"
                [textContent]="documentContent()"
              ></div>
              <button
                type="button"
                class="btn btn-outline btn-xs mt-2"
                (click)="copyDocument()"
              >
                {{ copiedDocument() === documentContent() ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>
        }

        <!-- Empty state -->
        @if (!hasAnyConfig()) {
          <div class="text-center py-6 text-base-content-muted text-xs">
            @if (mode() === 'new-project') {
              No configuration yet. Answer the agent in the chat; the plan will
              appear here as the agent proposes it.
            } @else {
              No configuration yet. Start by telling the agent what you are
              building in the chat: who the team is for and which tools you use.
              The agents, skills, prompt and MCP servers will appear here as the
              agent proposes them.
            }
          </div>
        }
      }
    </div>
  `,
})
export class HarnessConfigPreviewComponent {
  private readonly state = inject(HarnessBuilderStateService);

  readonly config = input<Partial<HarnessConfig> | null>(null);
  readonly document = input<string | null>(null);
  readonly mode = input<'configure' | 'new-project'>('configure');
  readonly status = input<'ready' | 'hydrating' | 'unavailable' | 'failed'>(
    'ready',
  );
  readonly restored = input(false);
  readonly retry = output<void>();
  readonly proposeAgain = output<void>();
  protected readonly copiedDocument = signal<string | null>(null);
  protected readonly previewConfig = computed(
    () => this.config() ?? this.state.config(),
  );
  protected readonly documentContent = computed(
    () =>
      this.document() ??
      (this.config() === null ? this.state.generatedDocument() : ''),
  );

  protected readonly UserIcon = User;
  protected readonly BotIcon = Bot;
  protected readonly SparklesIcon = Sparkles;
  protected readonly FileTextIcon = FileText;
  protected readonly ServerIcon = Server;
  protected readonly persona = computed(() => this.previewConfig().persona);

  protected readonly agentCount = computed(() => {
    const agents = this.previewConfig().agents;
    if (!agents?.enabledAgents) return 0;
    return Object.values(agents.enabledAgents).filter((a) => a.enabled).length;
  });

  protected readonly subagentCount = computed(
    () => this.previewConfig().agents?.harnessSubagents?.length ?? 0,
  );

  protected readonly enabledAgentNames = computed(() => {
    const agents = this.previewConfig().agents;
    if (!agents?.enabledAgents) return [];
    return Object.entries(agents.enabledAgents)
      .filter(([, a]) => a.enabled)
      .map(([name]) => name);
  });

  protected readonly skillCount = computed(() => {
    const skills = this.previewConfig().skills;
    return (
      (skills?.selectedSkills?.length ?? 0) +
      (skills?.createdSkills?.length ?? 0)
    );
  });

  protected readonly createdSkillCount = computed(
    () => this.previewConfig().skills?.createdSkills?.length ?? 0,
  );

  protected readonly skillNames = computed(() => {
    const skills = this.previewConfig().skills;
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
    () => !!this.previewConfig().prompt?.systemPrompt,
  );

  protected readonly promptPreview = computed(() => {
    const prompt = this.previewConfig().prompt?.systemPrompt ?? '';
    return prompt.length > 500 ? prompt.substring(0, 500) + '...' : prompt;
  });

  protected readonly mcpCount = computed(() => {
    const mcp = this.previewConfig().mcp;
    return mcp?.servers?.filter((s) => s.enabled).length ?? 0;
  });

  protected readonly mcpNames = computed(() => {
    const mcp = this.previewConfig().mcp;
    return mcp?.servers?.filter((s) => s.enabled).map((s) => s.name) ?? [];
  });

  protected readonly hasAnyConfig = computed(() => {
    const cfg = this.previewConfig();
    return !!(
      cfg.persona ||
      cfg.agents ||
      cfg.skills ||
      cfg.prompt ||
      cfg.mcp ||
      this.documentContent()
    );
  });

  protected async copyDocument(): Promise<void> {
    const content = this.documentContent();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      this.copiedDocument.set(content);
    } catch {
      this.copiedDocument.set(null);
    }
  }
}
