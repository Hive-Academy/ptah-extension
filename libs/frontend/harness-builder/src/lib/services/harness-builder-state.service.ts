import { computed, inject, Injectable, signal } from '@angular/core';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import { SurfaceId } from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
import type {
  AvailableAgent,
  FlatStreamEventUnion,
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

/**
 * Façade exposed to {@link HarnessStreamingService} so it can route flat
 * events through the canonical streaming pipeline without holding a
 * reference to the entire {@link HarnessBuilderStateService}.
 *
 * TASK_2026_107 Phase 4: replaces the deleted hand-rolled flat-event
 * accumulator switch.
 *
 * - `registerOperationSurface` — idempotent lazy mint of a SurfaceId for
 *   an operationId
 * - `routeOperationEvent` — forwards a flat event to
 *   `StreamRouter.routeStreamEventForSurface` (lazy-mints the surface
 *   if not already registered). If a second `operationId` arrives while
 *   another is in flight, emits a `harness.surface.concurrent-operation`
 *   structured warning and overwrites (single-operation assumption per
 *   spec §6 R3 — concurrent-build support is explicitly out of scope).
 * - `unregisterOperationSurface` — closes the routing binding for a
 *   single operation (called on `harness:flat-stream-complete`).
 * - `unregisterAllOperationSurfaces` — closes every active routing
 *   binding but KEEPS the accumulated `_streamingState` visible so the
 *   execution tree continues to render after the build completes.
 * - `resetOperationSurfaces` — full teardown: closes routing AND clears
 *   the accumulated streaming state (called on
 *   `HarnessBuilderStateService.reset()` and
 *   `resetStreamingState()`).
 */
export interface HarnessSurfaceFacade {
  registerOperationSurface(operationId: string): SurfaceId;
  unregisterOperationSurface(operationId: string): void;
  surfaceForOperation(operationId: string): SurfaceId | null;
  routeOperationEvent(operationId: string, event: FlatStreamEventUnion): void;
  unregisterAllOperationSurfaces(): void;
  resetOperationSurfaces(): void;
}

@Injectable({ providedIn: 'root' })
export class HarnessBuilderStateService implements HarnessSurfaceFacade {
  // TASK_2026_107 Phase 4: surface routing dependencies. Harness registers
  // a SurfaceId per operationId so its stream events flow through the
  // canonical pipeline (dedup, batching, BackgroundAgentStore, AgentMonitor,
  // session binding).
  private readonly streamRouter = inject(StreamRouter);
  private readonly surfaceRegistry = inject(StreamingSurfaceRegistry);

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

  // ─── Streaming state for execution visualization ───────

  private readonly _streamingState = signal<StreamingState>(
    createEmptyStreamingState(),
  );
  private readonly _isStreaming = signal(false);
  private readonly _currentOperationId = signal<string | null>(null);

  // TASK_2026_107 Phase 4: surface registration state.
  //
  // Surfaces are minted lazily on the first stream event for a given
  // operationId (the harness backend embeds operationId in the stream
  // payload). The Map below holds the SurfaceId for each active
  // operationId.
  //
  // Single-operation assumption (spec §6 R3): today `_streamingState` is
  // a single signal, not a per-operation Map. The surface adapter for
  // every active operation reads/writes the same `_streamingState`. If a
  // second `operationId` arrives mid-build, `routeOperationEvent` emits
  // a `harness.surface.concurrent-operation` structured warning and
  // overwrites — concurrent-build support is explicitly out of scope.
  private readonly _operationSurfaces = new Map<string, SurfaceId>();

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
  public readonly streamingState = this._streamingState.asReadonly();
  public readonly isConversing = this._isStreaming.asReadonly();
  public readonly currentOperationId = this._currentOperationId.asReadonly();

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

  // ─── Streaming methods ──────────────────────────────────

  // ===========================================================================
  // TASK_2026_107 Phase 4 — Surface routing (replaces hand-rolled
  // flat-event accumulator switch).
  //
  // Harness operations participate in the canonical chat streaming pipeline by
  // registering a `SurfaceId` per `operationId`. The SurfaceId is bound to a
  // fresh ConversationId via StreamRouter, and the accumulator-core mutates
  // the `_streamingState` signal exposed via the surface adapter's
  // `getState`/`setState`. Single-operation assumption (spec §6 R3) — see the
  // `_operationSurfaces` JSDoc above.
  // ===========================================================================

  /**
   * Mint (or return existing) SurfaceId for an operation. Idempotent —
   * repeat calls for the same `operationId` return the same SurfaceId.
   * Synchronously binds via `StreamRouter.onSurfaceCreated` and registers
   * the surface adapter with `StreamingSurfaceRegistry` BEFORE this method
   * returns, so the very next `routeStreamEventForSurface` call has a live
   * adapter to resolve (Phase 2 discovery #3 — registration must precede
   * the first event).
   *
   * The adapter's `getState()` returns the current `_streamingState()`
   * signal value; `setState(next)` writes via `_streamingState.set(next)`
   * (only fires on `compaction_complete`, where the accumulator hands back
   * a brand-new state object reference).
   */
  public registerOperationSurface(operationId: string): SurfaceId {
    const existing = this._operationSurfaces.get(operationId);
    if (existing) return existing;

    const surfaceId = SurfaceId.create();
    this._operationSurfaces.set(operationId, surfaceId);

    this.streamRouter.onSurfaceCreated(surfaceId);
    this.surfaceRegistry.register(
      surfaceId,
      () => this._streamingState(),
      (next) => {
        // setState fires when the accumulator-core hands back a
        // `replacementState` (currently only on compaction_complete).
        this._streamingState.set(next);
      },
    );

    return surfaceId;
  }

  /**
   * Tear down a single operation surface. Calls `StreamRouter.onSurfaceClosed`
   * (which handles unregistering the adapter from `StreamingSurfaceRegistry`
   * — see Phase 2 discovery #1: do NOT call surfaceRegistry.unregister here)
   * and removes the operation Map entry.
   *
   * The accumulated `_streamingState` is intentionally retained so the
   * execution tree keeps rendering after the build completes — only the
   * routing/registry state is torn down.
   */
  public unregisterOperationSurface(operationId: string): void {
    const surfaceId = this._operationSurfaces.get(operationId);
    if (!surfaceId) return;

    // Phase 2 discovery #1: onSurfaceClosed handles surfaceRegistry.unregister
    // internally; calling it ourselves first would race residual events into
    // the void.
    this.streamRouter.onSurfaceClosed(surfaceId);
    this._operationSurfaces.delete(operationId);
  }

  /** Lookup helper. Returns the SurfaceId for `operationId` or null. */
  public surfaceForOperation(operationId: string): SurfaceId | null {
    return this._operationSurfaces.get(operationId) ?? null;
  }

  /**
   * Route a flat event for an operation through the canonical streaming
   * pipeline. Lazy-mints the surface if `operationId` hasn't been seen yet
   * (covers the stream-arrives-before-explicit-startStreaming ordering —
   * the harness backend doesn't emit a discrete "operation start" message,
   * just begins streaming).
   *
   * Single-operation assumption (spec §6 R3): if a second `operationId`
   * arrives while another surface is in flight, emit the
   * `harness.surface.concurrent-operation` structured warning and
   * proceed (overwrite). Concurrent-build support is out of scope today.
   */
  public routeOperationEvent(
    operationId: string,
    event: FlatStreamEventUnion,
  ): void {
    // Single-operation guard: detect a second operationId arriving while a
    // different one is already registered. Warn, do not block.
    const existingKeys = Array.from(this._operationSurfaces.keys());
    const otherInFlight = existingKeys.find((key) => key !== operationId);
    if (otherInFlight && !this._operationSurfaces.has(operationId)) {
      console.warn(
        '[HarnessBuilderStateService] harness.surface.concurrent-operation',
        {
          incomingOperationId: operationId,
          inFlightOperationId: otherInFlight,
          message:
            'Concurrent harness operations are not supported. The new ' +
            'operation will overwrite the in-flight streaming state. ' +
            '(spec §6 R3 — single-operation assumption)',
        },
      );
    }

    const surfaceId = this.registerOperationSurface(operationId);
    this.streamRouter.routeStreamEventForSurface(event, surfaceId);
  }

  /**
   * Close routing for every active operation surface but PRESERVE the
   * accumulated `_streamingState` so the execution tree continues to
   * render after the build completes.
   */
  public unregisterAllOperationSurfaces(): void {
    const operationIds = Array.from(this._operationSurfaces.keys());
    for (const operationId of operationIds) {
      this.unregisterOperationSurface(operationId);
    }
  }

  /**
   * Full teardown: close routing for every operation AND clear the
   * accumulated streaming state. Called on `resetStreamingState()` and
   * `reset()`.
   */
  public resetOperationSurfaces(): void {
    this.unregisterAllOperationSurfaces();
    this._streamingState.set(createEmptyStreamingState());
  }

  public startStreaming(operationId: string): void {
    this._isStreaming.set(true);
    this._currentOperationId.set(operationId);
  }

  public stopStreaming(): void {
    this._isStreaming.set(false);
    this._currentOperationId.set(null);
  }

  public resetStreamingState(): void {
    // TASK_2026_107 Phase 4: tear down every surface registration AND wipe
    // accumulated state. resetOperationSurfaces() handles both
    // (router cleanup + _streamingState clear).
    this.resetOperationSurfaces();
    this._isStreaming.set(false);
    this._currentOperationId.set(null);
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
    // TASK_2026_107 Phase 4: tear down every surface registration AND wipe
    // accumulated streaming state. resetOperationSurfaces() handles both.
    this.resetOperationSurfaces();
    this._isStreaming.set(false);
    this._currentOperationId.set(null);
  }
}
