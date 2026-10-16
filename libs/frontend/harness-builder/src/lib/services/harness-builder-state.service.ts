import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { AppStateManager, LoggingService } from '@ptah-extension/core';
import { mergeHarnessConfigUpdates } from '@ptah-extension/shared';
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
} from '@ptah-extension/shared';
import { HarnessRpcService } from './harness-rpc.service';

@Injectable({ providedIn: 'root' })
export class HarnessBuilderStateService {
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  // Re-runs initialization after an idle workspace switch.
  private readonly rpc = inject(HarnessRpcService);

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

  private readonly _isConfigComplete = signal<boolean>(false);

  private readonly _workspaceContext = signal<{
    projectName: string;
    projectType: string;
    frameworks: string[];
    languages: string[];
  } | null>(null);

  /**
   * Workspace root captured from `harness:initialize` and PINNED for the
   * lifetime of the build session. `harness:apply` writes into this root even
   * if the active workspace changes mid-build. `null` = no workspace pinned
   * yet (or reset), in which case apply falls back to the active workspace.
   */
  private readonly _pinnedWorkspaceRoot = signal<string | null>(null);

  /**
   * The route tab owns the current build. This bit also retains the legacy
   * idle-switch behavior for callers that initialize without a bound tab.
   */
  private readonly _buildInProgress = signal(false);

  /**
   * True when the active workspace was switched WHILE a build was in progress.
   * The builder keeps operating on the pinned workspace; the view surfaces a
   * non-blocking badge so the user knows apply still targets the original.
   */
  private readonly _workspaceSwitchedDuringBuild = signal(false);

  /**
   * Root the workspace-switch effect last observed. Captured SYNCHRONOUSLY at
   * construction (see constructor) rather than lazily on first flush, so a
   * workspace switch that lands in the window between construction and the
   * effect's first flush is treated as a genuine switch instead of being
   * silently recorded as the baseline (review Issue 7).
   */
  private lastObservedWorkspaceRoot: string | null;

  /**
   * True once `initialize()` has run for this session (page opened). Gates the
   * idle-switch re-initialize: if the builder was never initialized there is
   * nothing to follow, so a switch is a no-op. Kept `true` across idle-switch
   * resets (so rapid switches keep following the active workspace) and only
   * cleared by the hard `reset()` teardown (page close).
   *
   * Exposed as {@link hasInitialized} so the view can skip a redundant
   * `harness:initialize` when it re-mounts on top of a live workflow — that
   * call would re-pin the workspace root and clear the mid-build switch badge.
   */
  private readonly _hasInitialized = signal(false);

  /**
   * Monotonic stamp for idle-switch re-initializes. On rapid A→B→C switches
   * every switch bumps the stamp; a resolving `harness:initialize` only applies
   * if its stamp is still the latest, so only the newest workspace wins.
   */
  private reinitSeq = 0;
  private boundTabKey: string | null = null;

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
  public readonly isConfigComplete = this._isConfigComplete.asReadonly();
  public readonly pinnedWorkspaceRoot = this._pinnedWorkspaceRoot.asReadonly();
  public readonly hasInitialized = this._hasInitialized.asReadonly();
  public readonly workspaceSwitchedDuringBuild =
    this._workspaceSwitchedDuringBuild.asReadonly();

  public constructor() {
    // Capture the baseline workspace root SYNCHRONOUSLY so a switch that lands
    // before the effect's first flush counts as a real switch (review Issue 7).
    this.lastObservedWorkspaceRoot = untracked(
      () => this.appState.workspaceInfo()?.path ?? null,
    );
    // React to Electron active-workspace switches: act only on genuine changes
    // relative to the synchronously-captured baseline above.
    effect(() => {
      const root = this.appState.workspaceInfo()?.path ?? null;
      const prev = this.lastObservedWorkspaceRoot;
      this.lastObservedWorkspaceRoot = root;
      if (prev === root) return;
      untracked(() => this.onWorkspaceSwitched());
    });
  }

  /**
   * Handle an active-workspace switch:
   * - Build in progress → keep the pinned root so `harness:apply` still targets
   *   the original workspace; flag the switch so the view can badge it.
   * - Idle + previously initialized → the builder follows the active workspace:
   *   wipe the old workspace's state and re-initialize for the new one so
   *   agents/skills/presets/pin reflect it (review Issue 1). Guarded by a
   *   monotonic stamp so only the latest of several rapid switches wins.
   * - Idle + never initialized → no-op (page never opened, nothing to follow).
   */
  private onWorkspaceSwitched(): void {
    if (this.boundTabKey) {
      this._workspaceSwitchedDuringBuild.set(true);
      return;
    }
    if (this._buildInProgress()) {
      this._workspaceSwitchedDuringBuild.set(true);
      return;
    }
    if (!this._hasInitialized()) return;
    this.resetSessionState();
    void this.reinitialize();
  }

  /**
   * Re-run `harness:initialize` for the now-active workspace after an idle
   * switch. Stamped so a slower response from an earlier switch can never
   * overwrite a newer one (rapid A→B→C → only C applies). On failure sets the
   * error state so the view surfaces its retry affordance (review Issue 1).
   */
  private async reinitialize(): Promise<void> {
    const seq = ++this.reinitSeq;
    this._isLoading.set(true);
    this._error.set(null);
    try {
      const response = await this.rpc.initialize();
      if (seq !== this.reinitSeq) return;
      this.initialize(response);
    } catch (err: unknown) {
      if (seq !== this.reinitSeq) return;
      this.logger.error(
        'HarnessBuilderStateService',
        'Could not reinitialize workspace',
        err instanceof Error ? err : new Error(String(err)),
      );
      this._error.set(
        err instanceof Error
          ? err.message
          : 'Failed to re-initialize AI Team Builder',
      );
    } finally {
      if (seq === this.reinitSeq) this._isLoading.set(false);
    }
  }

  /** Local config state belongs to one route tab; durable choices live in records. */
  public bindTab(workspaceRoot: string, tabId: string): void {
    const key = `${workspaceRoot}:${tabId}`;
    if (this.boundTabKey === key) return;
    this.resetSessionState();
    this.boundTabKey = key;
    this._pinnedWorkspaceRoot.set(workspaceRoot);
    this._buildInProgress.set(true);
  }

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

  public setConfigComplete(complete: boolean): void {
    this._isConfigComplete.set(complete);
  }

  /** Merge one partial proposal into the draft using the shared merge rules. */
  public applyConfigUpdates(updates: Partial<HarnessConfig>): void {
    this._config.update((cfg) => mergeHarnessConfigUpdates(cfg, updates));
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

  public setLoading(loading: boolean): void {
    this._isLoading.set(loading);
  }

  public setError(error: string | null): void {
    this._error.set(error);
  }

  public initialize(response: HarnessInitializeResponse): void {
    this._availableAgents.set(response.availableAgents);
    this._availableSkills.set(response.availableSkills);
    this._existingPresets.set(response.existingPresets);
    this._workspaceContext.set(response.workspaceContext);
    // PIN the workspace root the backend resolved. Everything applied later in
    // this session targets this root, decoupled from the active workspace.
    this._pinnedWorkspaceRoot.set(response.workspaceRoot);
    this._workspaceSwitchedDuringBuild.set(false);
    // Keep the switch effect's baseline aligned with the workspace we just
    // pinned so a redundant "switch" isn't detected right after initialize.
    this.lastObservedWorkspaceRoot =
      this.appState.workspaceInfo()?.path ?? null;
    this._error.set(null);
    // Latch that the builder is live and following the active workspace so an
    // idle switch re-initializes rather than leaving a silently-empty view.
    this._hasInitialized.set(true);
  }

  /**
   * Wipe all per-workspace session state (config, agents/skills/presets, pin,
   * streaming, conversation). Does NOT clear the `hasInitialized` follow latch,
   * so an idle-switch reset keeps the builder tracking the active workspace
   * (and re-initializing for it). Used by both the idle-switch handler and the
   * hard `reset()` teardown.
   */
  private resetSessionState(): void {
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
    this._isConfigComplete.set(false);
    this._pinnedWorkspaceRoot.set(null);
    this._buildInProgress.set(false);
    this._workspaceSwitchedDuringBuild.set(false);
  }

  /**
   * Hard teardown (page close). Wipes session state AND clears the follow
   * latch so a later workspace switch does NOT fire a stray re-initialize for
   * a builder that is no longer mounted. Also supersedes any in-flight
   * re-initialize by bumping the stamp.
   */
  public reset(): void {
    this.resetSessionState();
    this.boundTabKey = null;
    this._hasInitialized.set(false);
    this.reinitSeq++;
  }
}
