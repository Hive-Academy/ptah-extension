/**
 * HarnessBuilderStateService
 *
 * Signal-based state management for the 6-step Harness Setup Builder wizard.
 * Manages wizard step progression, configuration accumulation, AI chat history,
 * and computed readiness signals for each step.
 *
 * Pattern: Facade over Angular signals — mirrors SetupWizardStateService approach.
 */

import { computed, Injectable, signal } from '@angular/core';
import type {
  AvailableAgent,
  HarnessConfig,
  HarnessInitializeResponse,
  HarnessMcpConfig,
  HarnessPromptConfig,
  HarnessSkillConfig,
  HarnessWizardStep,
  HarnessClaudeMdConfig,
  HarnessAgentConfig,
  PersonaDefinition,
  HarnessPreset,
  SkillSummary,
  McpServerSuggestion,
  CustomSubagentDefinition,
  GeneratedSkillSpec,
  HarnessAnalyzeIntentResponse,
} from '@ptah-extension/shared';

/** Chat message stored in the wizard AI chat history */
export interface HarnessChatMessage {
  role: 'user' | 'assistant';
  content: string;
  step: HarnessWizardStep;
}

/** Ordered wizard steps for index-based navigation */
const STEP_ORDER: HarnessWizardStep[] = [
  'persona',
  'agents',
  'skills',
  'prompts',
  'mcp',
  'review',
];

/** Human-readable labels for each step */
export const STEP_LABELS: Record<HarnessWizardStep, string> = {
  persona: 'Describe',
  agents: 'Agents',
  skills: 'Skills',
  prompts: 'Prompts',
  mcp: 'MCP',
  review: 'Review',
};

@Injectable({ providedIn: 'root' })
export class HarnessBuilderStateService {
  // ─── Core wizard state (private, mutated only within service) ──

  private readonly _currentStep = signal<HarnessWizardStep>('persona');
  private readonly _config = signal<Partial<HarnessConfig>>({});
  private readonly _availableAgents = signal<AvailableAgent[]>([]);
  private readonly _availableSkills = signal<SkillSummary[]>([]);
  private readonly _existingPresets = signal<HarnessPreset[]>([]);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _chatMessages = signal<HarnessChatMessage[]>([]);
  private readonly _completedSteps = signal<Set<HarnessWizardStep>>(new Set());
  private readonly _suggestedMcpServers = signal<McpServerSuggestion[]>([]);
  private readonly _generatedSkillSpecs = signal<GeneratedSkillSpec[]>([]);
  private readonly _generatedDocument = signal<string>('');
  private readonly _intentAnalyzed = signal<boolean>(false);
  private readonly _intentSummary = signal<string>('');
  private readonly _intentInput = signal<string>('');

  // ─── Workspace context (from initialize) ─────────────────

  private readonly _workspaceContext = signal<{
    projectName: string;
    projectType: string;
    frameworks: string[];
    languages: string[];
  } | null>(null);

  // ─── Public readonly accessors ───────────────────────────

  public readonly currentStep = this._currentStep.asReadonly();
  public readonly config = this._config.asReadonly();
  public readonly availableAgents = this._availableAgents.asReadonly();
  public readonly availableSkills = this._availableSkills.asReadonly();
  public readonly existingPresets = this._existingPresets.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly chatMessages = this._chatMessages.asReadonly();
  public readonly completedSteps = this._completedSteps.asReadonly();
  public readonly suggestedMcpServers = this._suggestedMcpServers.asReadonly();
  public readonly workspaceContext = this._workspaceContext.asReadonly();
  public readonly generatedSkillSpecs = this._generatedSkillSpecs.asReadonly();
  public readonly generatedDocument = this._generatedDocument.asReadonly();
  public readonly intentAnalyzed = this._intentAnalyzed.asReadonly();
  public readonly intentSummary = this._intentSummary.asReadonly();
  public readonly intentInput = this._intentInput.asReadonly();

  // ─── Computed signals ────────────────────────────────────

  /** Numeric index of the current step (0-based) */
  public readonly currentStepIndex = computed(() =>
    STEP_ORDER.indexOf(this._currentStep()),
  );

  /** Chat messages filtered to the current step */
  public readonly stepChatMessages = computed(() => {
    const step = this._currentStep();
    return this._chatMessages().filter((m) => m.step === step);
  });

  /** Whether the user can proceed from the current step */
  public readonly canProceed = computed(() => {
    const cfg = this._config();
    switch (this._currentStep()) {
      case 'persona':
        return (
          (this._intentAnalyzed() && !!cfg.persona?.label) ||
          !!(
            cfg.persona?.description &&
            cfg.persona.description.trim().length > 0
          )
        );
      case 'agents':
        return !!(
          cfg.agents?.enabledAgents &&
          Object.keys(cfg.agents.enabledAgents).length > 0
        );
      case 'skills':
        return true;
      case 'prompts':
        return !!(
          cfg.prompt?.systemPrompt && cfg.prompt.systemPrompt.trim().length > 0
        );
      case 'mcp':
        return true;
      case 'review':
        return true;
      default:
        return false;
    }
  });

  /** Summary text for the review step */
  public readonly configSummary = computed(() => {
    const cfg = this._config();
    const parts: string[] = [];

    if (cfg.persona?.label) {
      parts.push(`Persona: ${cfg.persona.label}`);
    }
    if (cfg.agents?.enabledAgents) {
      const count = Object.values(cfg.agents.enabledAgents).filter(
        (a) => a.enabled,
      ).length;
      parts.push(`${count} agent(s) enabled`);
    }
    if (cfg.skills?.selectedSkills) {
      parts.push(`${cfg.skills.selectedSkills.length} skill(s) selected`);
    }
    if (cfg.prompt?.systemPrompt) {
      parts.push('System prompt configured');
    }
    if (cfg.mcp?.servers) {
      const enabled = cfg.mcp.servers.filter((s) => s.enabled).length;
      parts.push(`${enabled} MCP server(s)`);
    }

    return parts.join(' | ') || 'No configuration yet';
  });

  /** Whether the wizard is on the first step */
  public readonly isFirstStep = computed(() => this.currentStepIndex() === 0);

  /** Whether the wizard is on the last step */
  public readonly isLastStep = computed(
    () => this.currentStepIndex() === STEP_ORDER.length - 1,
  );

  // ─── Navigation methods ──────────────────────────────────

  public goToStep(step: HarnessWizardStep): void {
    this._currentStep.set(step);
    this._error.set(null);
  }

  public nextStep(): void {
    const idx = this.currentStepIndex();
    if (idx < STEP_ORDER.length - 1) {
      this._completedSteps.update((steps) => {
        const next = new Set(steps);
        next.add(this._currentStep());
        return next;
      });
      this._currentStep.set(STEP_ORDER[idx + 1]);
      this._error.set(null);
    }
  }

  public previousStep(): void {
    const idx = this.currentStepIndex();
    if (idx > 0) {
      this._currentStep.set(STEP_ORDER[idx - 1]);
      this._error.set(null);
    }
  }

  // ─── Config update methods ───────────────────────────────

  public updatePersona(persona: PersonaDefinition): void {
    this._config.update((cfg) => ({ ...cfg, persona }));
  }

  public updateAgents(agents: HarnessAgentConfig): void {
    this._config.update((cfg) => ({ ...cfg, agents }));
  }

  public updateSkills(skills: HarnessSkillConfig): void {
    this._config.update((cfg) => ({ ...cfg, skills }));
  }

  public updatePrompt(prompt: HarnessPromptConfig): void {
    this._config.update((cfg) => ({ ...cfg, prompt }));
  }

  public updateMcp(mcp: HarnessMcpConfig): void {
    this._config.update((cfg) => ({ ...cfg, mcp }));
  }

  public updateClaudeMd(claudeMd: HarnessClaudeMdConfig): void {
    this._config.update((cfg) => ({ ...cfg, claudeMd }));
  }

  public setSuggestedMcpServers(servers: McpServerSuggestion[]): void {
    this._suggestedMcpServers.set(servers);
  }

  public setGeneratedSkillSpecs(specs: GeneratedSkillSpec[]): void {
    this._generatedSkillSpecs.set(specs);
  }

  public setGeneratedDocument(document: string): void {
    this._generatedDocument.set(document);
  }

  public addCustomSubagent(subagent: CustomSubagentDefinition): void {
    this._config.update((cfg) => ({
      ...cfg,
      agents: {
        enabledAgents: cfg.agents?.enabledAgents ?? {},
        customSubagents: [...(cfg.agents?.customSubagents ?? []), subagent],
      },
    }));
  }

  public removeCustomSubagent(subagentId: string): void {
    this._config.update((cfg) => ({
      ...cfg,
      agents: {
        enabledAgents: cfg.agents?.enabledAgents ?? {},
        customSubagents: (cfg.agents?.customSubagents ?? []).filter(
          (s) => s.id !== subagentId,
        ),
      },
    }));
  }

  public setCustomSubagents(subagents: CustomSubagentDefinition[]): void {
    this._config.update((cfg) => ({
      ...cfg,
      agents: {
        enabledAgents: cfg.agents?.enabledAgents ?? {},
        customSubagents: subagents,
      },
    }));
  }

  // ─── Intent Analysis ─────────────────────────────────────

  /** Persist the freeform intent input text across step navigation */
  public setIntentInput(text: string): void {
    this._intentInput.set(text);
  }

  /** Bulk-populate all steps from the AI's intent analysis */
  public applyIntentAnalysis(response: HarnessAnalyzeIntentResponse): void {
    this._completedSteps.set(new Set());

    // Persona
    this.updatePersona(response.persona);

    // Agents — merge suggested agents + custom subagents
    this.updateAgents({
      enabledAgents: response.suggestedAgents,
      customSubagents: response.suggestedSubagents,
    });

    // Skills
    this.updateSkills({
      selectedSkills: response.suggestedSkills,
      createdSkills: response.suggestedSkillSpecs.map((spec) => ({
        name: spec.name,
        description: spec.description,
        content: spec.content,
        allowedTools: spec.requiredTools,
      })),
    });

    // Generated skill specs (for the skills step to display)
    this.setGeneratedSkillSpecs(response.suggestedSkillSpecs);

    // Prompt
    this.updatePrompt({
      systemPrompt: response.suggestedPrompt,
      enhancedSections: {},
    });

    // MCP server suggestions
    this.setSuggestedMcpServers(response.suggestedMcpServers);

    // Mark intent as analyzed
    this._intentAnalyzed.set(true);
    this._intentSummary.set(response.summary);
  }

  // ─── Chat methods ────────────────────────────────────────

  public addChatMessage(message: HarnessChatMessage): void {
    this._chatMessages.update((msgs) => [...msgs, message]);
  }

  // ─── Initialization ──────────────────────────────────────

  /** Populate state from the backend initialization response */
  public initialize(response: HarnessInitializeResponse): void {
    this._availableAgents.set(response.availableAgents);
    this._availableSkills.set(response.availableSkills);
    this._existingPresets.set(response.existingPresets);
    this._workspaceContext.set(response.workspaceContext);
    this._error.set(null);
  }

  /** Reset wizard to initial state */
  public reset(): void {
    this._currentStep.set('persona');
    this._config.set({});
    this._availableAgents.set([]);
    this._availableSkills.set([]);
    this._existingPresets.set([]);
    this._isLoading.set(false);
    this._error.set(null);
    this._chatMessages.set([]);
    this._completedSteps.set(new Set());
    this._suggestedMcpServers.set([]);
    this._workspaceContext.set(null);
    this._generatedSkillSpecs.set([]);
    this._generatedDocument.set('');
    this._intentAnalyzed.set(false);
    this._intentSummary.set('');
    this._intentInput.set('');
  }
}
