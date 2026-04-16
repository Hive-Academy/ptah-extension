import { computed, Injectable, signal } from '@angular/core';
import type {
  AvailableAgent,
  HarnessConfig,
  HarnessInitializeResponse,
  HarnessMcpConfig,
  HarnessPromptConfig,
  HarnessSkillConfig,
  HarnessClaudeMdConfig,
  HarnessAgentConfig,
  PersonaDefinition,
  HarnessPreset,
  SkillSummary,
  McpServerSuggestion,
  HarnessSubagentDefinition,
  GeneratedSkillSpec,
  HarnessAnalyzeIntentResponse,
  HarnessConversationMessage,
} from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class HarnessBuilderStateService {
  // ─── Core state ─────────────────────────────────────────

  private readonly _config = signal<Partial<HarnessConfig>>({});
  private readonly _availableAgents = signal<AvailableAgent[]>([]);
  private readonly _availableSkills = signal<SkillSummary[]>([]);
  private readonly _existingPresets = signal<HarnessPreset[]>([]);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _suggestedMcpServers = signal<McpServerSuggestion[]>([]);
  private readonly _generatedSkillSpecs = signal<GeneratedSkillSpec[]>([]);
  private readonly _generatedDocument = signal<string>('');
  private readonly _intentAnalyzed = signal<boolean>(false);
  private readonly _intentSummary = signal<string>('');
  private readonly _intentInput = signal<string>('');

  // ─── Conversation state ─────────────────────────────────

  private readonly _conversationMessages = signal<HarnessConversationMessage[]>(
    [],
  );
  private readonly _isConfigComplete = signal<boolean>(false);

  // ─── Workspace context (from initialize) ────────────────

  private readonly _workspaceContext = signal<{
    projectName: string;
    projectType: string;
    frameworks: string[];
    languages: string[];
  } | null>(null);

  // ─── Public readonly accessors ──────────────────────────

  public readonly config = this._config.asReadonly();
  public readonly availableAgents = this._availableAgents.asReadonly();
  public readonly availableSkills = this._availableSkills.asReadonly();
  public readonly existingPresets = this._existingPresets.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly suggestedMcpServers = this._suggestedMcpServers.asReadonly();
  public readonly workspaceContext = this._workspaceContext.asReadonly();
  public readonly generatedSkillSpecs = this._generatedSkillSpecs.asReadonly();
  public readonly generatedDocument = this._generatedDocument.asReadonly();
  public readonly intentAnalyzed = this._intentAnalyzed.asReadonly();
  public readonly intentSummary = this._intentSummary.asReadonly();
  public readonly intentInput = this._intentInput.asReadonly();
  public readonly conversationMessages =
    this._conversationMessages.asReadonly();
  public readonly isConfigComplete = this._isConfigComplete.asReadonly();

  // ─── Computed signals ───────────────────────────────────

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

  // ─── Conversation methods ───────────────────────────────

  public addConversationMessage(msg: HarnessConversationMessage): void {
    this._conversationMessages.update((msgs) => [...msgs, msg]);
  }

  public setConfigComplete(complete: boolean): void {
    this._isConfigComplete.set(complete);
  }

  // ─── Config update methods ──────────────────────────────

  public applyConfigUpdates(updates: Partial<HarnessConfig>): void {
    this._config.update((cfg) => {
      const merged = { ...cfg };

      if (updates.persona) {
        merged.persona = {
          ...cfg.persona,
          ...updates.persona,
        } as typeof cfg.persona;
      }
      if (updates.agents) {
        merged.agents = {
          enabledAgents: {
            ...(cfg.agents?.enabledAgents ?? {}),
            ...(updates.agents.enabledAgents ?? {}),
          },
          harnessSubagents:
            updates.agents.harnessSubagents ??
            cfg.agents?.harnessSubagents ??
            [],
        };
      }
      if (updates.skills) {
        merged.skills = {
          selectedSkills:
            updates.skills.selectedSkills ?? cfg.skills?.selectedSkills ?? [],
          createdSkills:
            updates.skills.createdSkills ?? cfg.skills?.createdSkills ?? [],
        };
      }
      if (updates.prompt) {
        merged.prompt = {
          ...cfg.prompt,
          ...updates.prompt,
        } as typeof cfg.prompt;
      }
      if (updates.mcp) {
        merged.mcp = updates.mcp;
      }
      if (updates.claudeMd) {
        merged.claudeMd = {
          ...cfg.claudeMd,
          ...updates.claudeMd,
        } as typeof cfg.claudeMd;
      }

      return merged;
    });
  }

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

  public addHarnessSubagent(subagent: HarnessSubagentDefinition): void {
    this._config.update((cfg) => ({
      ...cfg,
      agents: {
        enabledAgents: cfg.agents?.enabledAgents ?? {},
        harnessSubagents: [...(cfg.agents?.harnessSubagents ?? []), subagent],
      },
    }));
  }

  public removeHarnessSubagent(subagentId: string): void {
    this._config.update((cfg) => ({
      ...cfg,
      agents: {
        enabledAgents: cfg.agents?.enabledAgents ?? {},
        harnessSubagents: (cfg.agents?.harnessSubagents ?? []).filter(
          (s) => s.id !== subagentId,
        ),
      },
    }));
  }

  public setHarnessSubagents(subagents: HarnessSubagentDefinition[]): void {
    this._config.update((cfg) => ({
      ...cfg,
      agents: {
        enabledAgents: cfg.agents?.enabledAgents ?? {},
        harnessSubagents: subagents,
      },
    }));
  }

  // ─── Intent Analysis ────────────────────────────────────

  public setIntentInput(text: string): void {
    this._intentInput.set(text);
  }

  public applyIntentAnalysis(response: HarnessAnalyzeIntentResponse): void {
    this.updatePersona(response.persona);

    this.updateAgents({
      enabledAgents: response.suggestedAgents,
      harnessSubagents: response.suggestedSubagents,
    });

    this.updateSkills({
      selectedSkills: response.suggestedSkills,
      createdSkills: response.suggestedSkillSpecs.map((spec) => ({
        name: spec.name,
        description: spec.description,
        content: spec.content,
        allowedTools: spec.requiredTools,
      })),
    });

    this.setGeneratedSkillSpecs(response.suggestedSkillSpecs);

    this.updatePrompt({
      systemPrompt: response.suggestedPrompt,
      enhancedSections: {},
    });

    this.setSuggestedMcpServers(response.suggestedMcpServers);

    this._intentAnalyzed.set(true);
    this._intentSummary.set(response.summary);
  }

  // ─── Loading state ──────────────────────────────────────

  public setLoading(loading: boolean): void {
    this._isLoading.set(loading);
  }

  public setError(error: string | null): void {
    this._error.set(error);
  }

  // ─── Initialization ─────────────────────────────────────

  public initialize(response: HarnessInitializeResponse): void {
    this._availableAgents.set(response.availableAgents);
    this._availableSkills.set(response.availableSkills);
    this._existingPresets.set(response.existingPresets);
    this._workspaceContext.set(response.workspaceContext);
    this._error.set(null);
  }

  public reset(): void {
    this._config.set({});
    this._availableAgents.set([]);
    this._availableSkills.set([]);
    this._existingPresets.set([]);
    this._isLoading.set(false);
    this._error.set(null);
    this._suggestedMcpServers.set([]);
    this._workspaceContext.set(null);
    this._generatedSkillSpecs.set([]);
    this._generatedDocument.set('');
    this._intentAnalyzed.set(false);
    this._intentSummary.set('');
    this._intentInput.set('');
    this._conversationMessages.set([]);
    this._isConfigComplete.set(false);
  }
}
