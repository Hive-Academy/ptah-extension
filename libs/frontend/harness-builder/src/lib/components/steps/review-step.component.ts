/**
 * ReviewStepComponent
 *
 * Step 6: Review & Apply. Summary cards for each configuration section,
 * comprehensive PRD document generation, CLAUDE.md preview panel,
 * "Apply to Workspace" button, and "Save as Preset" button.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  CheckCircle,
  User,
  Bot,
  Wrench,
  FileText,
  Server,
  Download,
  Save,
  Sparkles,
  ScrollText,
} from 'lucide-angular';
import type { HarnessConfig } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { HarnessStreamingService } from '../../services/harness-streaming.service';

@Component({
  selector: 'ptah-review-step',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold flex items-center gap-2">
          <lucide-angular
            [img]="CheckCircleIcon"
            class="w-5 h-5 text-success"
            aria-hidden="true"
          />
          Review Configuration
        </h2>
        <p class="text-sm text-base-content/60 mt-1">
          Review your harness configuration, generate documents, and apply.
        </p>
      </div>

      <!-- Summary cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <!-- Persona -->
        <div class="card bg-base-200 p-3">
          <div class="flex items-center gap-2 mb-2">
            <lucide-angular
              [img]="UserIcon"
              class="w-4 h-4 text-primary"
              aria-hidden="true"
            />
            <span class="font-medium text-sm">Persona</span>
          </div>
          <p class="text-xs text-base-content/70">
            {{ config().persona?.label || 'Not configured' }}
          </p>
          @if (config().persona?.goals?.length) {
            <div class="flex flex-wrap gap-1 mt-1">
              @for (goal of config().persona!.goals; track $index) {
                <span class="badge badge-xs badge-outline">{{ goal }}</span>
              }
            </div>
          }
        </div>

        <!-- Agents -->
        <div class="card bg-base-200 p-3">
          <div class="flex items-center gap-2 mb-2">
            <lucide-angular
              [img]="BotIcon"
              class="w-4 h-4 text-primary"
              aria-hidden="true"
            />
            <span class="font-medium text-sm">Agents</span>
          </div>
          <p class="text-xs text-base-content/70">
            {{ enabledAgentCount() }} CLI agent(s) +
            {{ harnessSubagentCount() }} harness subagent(s)
          </p>
          <div class="flex flex-wrap gap-1 mt-1">
            @for (name of enabledAgentNames(); track name) {
              <span class="badge badge-xs badge-primary badge-outline">{{
                name
              }}</span>
            }
            @for (name of harnessSubagentNames(); track name) {
              <span class="badge badge-xs badge-secondary badge-outline">{{
                name
              }}</span>
            }
          </div>
        </div>

        <!-- Skills -->
        <div class="card bg-base-200 p-3">
          <div class="flex items-center gap-2 mb-2">
            <lucide-angular
              [img]="WrenchIcon"
              class="w-4 h-4 text-primary"
              aria-hidden="true"
            />
            <span class="font-medium text-sm">Skills</span>
          </div>
          <p class="text-xs text-base-content/70">
            {{ config().skills?.selectedSkills?.length ?? 0 }} skill(s)
            selected, {{ config().skills?.createdSkills?.length ?? 0 }} created
          </p>
        </div>

        <!-- Prompt -->
        <div class="card bg-base-200 p-3">
          <div class="flex items-center gap-2 mb-2">
            <lucide-angular
              [img]="FileTextIcon"
              class="w-4 h-4 text-primary"
              aria-hidden="true"
            />
            <span class="font-medium text-sm">System Prompt</span>
          </div>
          <p class="text-xs text-base-content/70">
            @if (config().prompt?.systemPrompt) {
              {{ config().prompt!.systemPrompt.length }} characters
            } @else {
              Not configured
            }
          </p>
        </div>

        <!-- MCP -->
        <div class="card bg-base-200 p-3 md:col-span-2">
          <div class="flex items-center gap-2 mb-2">
            <lucide-angular
              [img]="ServerIcon"
              class="w-4 h-4 text-primary"
              aria-hidden="true"
            />
            <span class="font-medium text-sm">MCP Servers</span>
          </div>
          <p class="text-xs text-base-content/70">
            {{ enabledServerCount() }} server(s) enabled
          </p>
        </div>
      </div>

      <!-- Generate PRD Document -->
      <div class="space-y-3">
        <div class="divider text-xs text-base-content/40">
          Requirements Document
        </div>

        <button
          class="btn btn-secondary w-full gap-2"
          (click)="generateDocument()"
          [disabled]="isGeneratingDoc()"
        >
          @if (isGeneratingDoc()) {
            <span class="loading loading-spinner loading-sm"></span>
            Generating Document...
          } @else {
            <lucide-angular
              [img]="ScrollTextIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Generate Requirements Document
          }
        </button>

        @if (generatedDocument()) {
          <div
            class="bg-base-200 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap overflow-y-auto max-h-96 border border-secondary/20"
            role="region"
            aria-label="Generated requirements document"
          >
            {{ generatedDocument() }}
          </div>
        }
      </div>

      <!-- CLAUDE.md Preview -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-sm">CLAUDE.md Preview</h3>
          <button
            class="btn btn-ghost btn-xs gap-1"
            (click)="generateClaudeMdPreview()"
            [disabled]="isGeneratingPreview()"
          >
            @if (isGeneratingPreview()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular
                [img]="SparklesIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
            }
            Generate Preview
          </button>
        </div>
        <div
          class="bg-base-200 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap overflow-y-auto max-h-64"
          role="region"
          aria-label="CLAUDE.md preview"
        >
          {{
            claudeMdPreview() ||
              'Click "Generate Preview" to see the CLAUDE.md content.'
          }}
        </div>
      </div>

      <!-- Actions -->
      <div class="flex flex-col gap-3">
        <!-- Apply -->
        <button
          class="btn btn-primary w-full gap-2"
          (click)="applyConfig()"
          [disabled]="isApplying()"
        >
          @if (isApplying()) {
            <span class="loading loading-spinner loading-sm"></span>
            Applying...
          } @else {
            <lucide-angular
              [img]="DownloadIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Apply to Workspace
          }
        </button>

        @if (applyResult()) {
          <div class="alert alert-success text-xs">
            <span>
              Configuration applied successfully!
              {{ applyResult()!.appliedPaths.length }} file(s) written.
            </span>
          </div>
          @if (applyResult()!.warnings.length > 0) {
            <div class="mt-3 space-y-2">
              @for (warning of applyResult()!.warnings; track warning) {
                <div class="alert alert-warning text-sm">
                  <span>{{ warning }}</span>
                </div>
              }
            </div>
          }
        }

        @if (applyError()) {
          <div class="alert alert-error text-xs">
            <span>{{ applyError() }}</span>
          </div>
        }

        <!-- Save as Preset -->
        <div class="divider text-xs text-base-content/40">
          Or Save for Later
        </div>
        <div class="flex gap-2">
          <label class="sr-only" for="preset-name">Preset name</label>
          <input
            id="preset-name"
            type="text"
            class="input input-bordered input-sm flex-1"
            placeholder="Preset name"
            [ngModel]="presetName()"
            (ngModelChange)="presetName.set($event)"
          />
          <button
            class="btn btn-outline btn-sm gap-1"
            (click)="savePreset()"
            [disabled]="isSaving() || !presetName().trim()"
          >
            @if (isSaving()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular
                [img]="SaveIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            }
            Save Preset
          </button>
        </div>

        @if (saveSuccess()) {
          <div class="alert alert-success text-xs">
            <span>Preset saved successfully!</span>
          </div>
        }

        @if (saveError()) {
          <div class="alert alert-error text-xs">
            <span>{{ saveError() }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class ReviewStepComponent {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly streaming = inject(HarnessStreamingService);

  // Icons
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly UserIcon = User;
  protected readonly BotIcon = Bot;
  protected readonly WrenchIcon = Wrench;
  protected readonly FileTextIcon = FileText;
  protected readonly ServerIcon = Server;
  protected readonly DownloadIcon = Download;
  protected readonly SaveIcon = Save;
  protected readonly SparklesIcon = Sparkles;
  protected readonly ScrollTextIcon = ScrollText;

  // Local state
  public readonly isApplying = signal(false);
  public readonly applyError = signal<string | null>(null);
  public readonly applyResult = signal<{
    appliedPaths: string[];
    warnings: string[];
  } | null>(null);
  public readonly isSaving = signal(false);
  public readonly saveError = signal<string | null>(null);
  public readonly saveSuccess = signal(false);
  public readonly isGeneratingPreview = signal(false);
  public readonly claudeMdPreview = signal('');
  public readonly presetName = signal('');
  public readonly isGeneratingDoc = signal(false);

  public readonly config = computed(() => this.state.config());

  public readonly generatedDocument = computed(() =>
    this.state.generatedDocument(),
  );

  public readonly enabledAgentCount = computed(() => {
    const agents = this.config().agents?.enabledAgents ?? {};
    return Object.values(agents).filter((a) => a.enabled).length;
  });

  public readonly enabledAgentNames = computed(() => {
    const agents = this.config().agents?.enabledAgents ?? {};
    return Object.entries(agents)
      .filter(([, v]) => v.enabled)
      .map(([k]) => k);
  });

  public readonly harnessSubagentCount = computed(() => {
    return (this.config().agents?.harnessSubagents ?? []).length;
  });

  public readonly harnessSubagentNames = computed(() => {
    return (this.config().agents?.harnessSubagents ?? []).map((s) => s.name);
  });

  public readonly enabledServerCount = computed(() => {
    return (this.config().mcp?.servers ?? []).filter((s) => s.enabled).length;
  });

  /** Build a complete HarnessConfig from the partial state, filling defaults. */
  private buildFullConfig(name: string): HarnessConfig {
    const cfg = this.config();
    const now = new Date().toISOString();
    return {
      name,
      persona: cfg.persona ?? { label: '', description: '', goals: [] },
      agents: cfg.agents ?? { enabledAgents: {} },
      skills: cfg.skills ?? { selectedSkills: [], createdSkills: [] },
      prompt: cfg.prompt ?? { systemPrompt: '', enhancedSections: {} },
      mcp: cfg.mcp ?? { servers: [], enabledTools: {} },
      claudeMd: cfg.claudeMd ?? {
        generateProjectClaudeMd: true,
        customSections: {},
        previewContent: this.claudeMdPreview(),
      },
      createdAt: cfg.createdAt ?? now,
      updatedAt: now,
    };
  }

  public async generateDocument(): Promise<void> {
    if (this.isGeneratingDoc()) return;

    this.isGeneratingDoc.set(true);
    this.streaming.reset();

    try {
      const fullConfig = this.buildFullConfig(
        this.config().name ?? this.config().persona?.label ?? 'harness',
      );

      const response = await this.rpc.generateDocument({
        config: fullConfig,
        workspaceContext: this.state.workspaceContext() ?? undefined,
      });

      this.state.setGeneratedDocument(response.document);
    } catch (err) {
      this.state.setGeneratedDocument(
        `Error generating document: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      this.isGeneratingDoc.set(false);
    }
  }

  public async generateClaudeMdPreview(): Promise<void> {
    if (this.isGeneratingPreview()) return;

    this.isGeneratingPreview.set(true);
    try {
      const cfg = this.config();
      const response = await this.rpc.generateClaudeMd({
        config: {
          name: cfg.name ?? cfg.persona?.label ?? 'harness',
          persona: cfg.persona ?? { label: '', description: '', goals: [] },
          agents: cfg.agents ?? { enabledAgents: {} },
          skills: cfg.skills ?? { selectedSkills: [], createdSkills: [] },
          prompt: cfg.prompt ?? { systemPrompt: '', enhancedSections: {} },
          mcp: cfg.mcp ?? { servers: [], enabledTools: {} },
        },
      });
      this.claudeMdPreview.set(response.content);
    } catch (err) {
      this.claudeMdPreview.set(
        `Error generating preview: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      this.isGeneratingPreview.set(false);
    }
  }

  public async applyConfig(): Promise<void> {
    if (this.isApplying()) return;

    this.isApplying.set(true);
    this.applyError.set(null);
    this.applyResult.set(null);

    try {
      const fullConfig = this.buildFullConfig(
        this.config().name ?? this.config().persona?.label ?? 'harness',
      );

      const response = await this.rpc.apply({ config: fullConfig });
      this.applyResult.set(response);
    } catch (err) {
      this.applyError.set(
        err instanceof Error ? err.message : 'Failed to apply configuration',
      );
    } finally {
      this.isApplying.set(false);
    }
  }

  public async savePreset(): Promise<void> {
    const name = this.presetName().trim();
    if (this.isSaving() || !name) return;

    this.isSaving.set(true);
    this.saveError.set(null);
    this.saveSuccess.set(false);

    try {
      const fullConfig = this.buildFullConfig(name);

      await this.rpc.savePreset({
        name,
        description: `Preset created from harness builder`,
        config: fullConfig,
      });

      this.saveSuccess.set(true);
      this.presetName.set('');
    } catch (err) {
      this.saveError.set(
        err instanceof Error ? err.message : 'Failed to save preset',
      );
    } finally {
      this.isSaving.set(false);
    }
  }
}
