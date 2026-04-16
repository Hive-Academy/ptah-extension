/**
 * HarnessRpcService
 *
 * Thin facade for harness-builder-specific RPC calls.
 * Delegates to ClaudeRpcService for actual RPC communication with the extension host.
 *
 * Pattern: Facade pattern - provides harness-specific API over unified RPC.
 * Mirrors WizardRpcService from setup-wizard library.
 *
 * Supported RPC methods:
 * - harness:initialize       — Start a harness builder session
 * - harness:suggest-config   — AI-generate config from persona description
 * - harness:search-skills    — Search available skills
 * - harness:create-skill     — Create a new skill from wizard
 * - harness:discover-mcp     — Discover available MCP servers
 * - harness:generate-prompt  — AI-generate system prompt
 * - harness:generate-claude-md — Generate CLAUDE.md preview
 * - harness:apply            — Apply the full harness config to workspace
 * - harness:save-preset      — Save config as reusable preset
 * - harness:load-presets     — List saved presets
 * - harness:chat             — Step-contextual AI chat message
 * - harness:design-agents    — AI designs a custom subagent fleet
 * - harness:generate-skills  — AI generates specialized skill specs
 * - harness:generate-document — Generate comprehensive PRD document
 * - harness:analyze-intent   — AI architects complete harness from freeform input
 */

import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  HarnessInitializeResponse,
  HarnessSuggestConfigParams,
  HarnessSuggestConfigResponse,
  HarnessSearchSkillsResponse,
  HarnessCreateSkillParams,
  HarnessCreateSkillResponse,
  HarnessDiscoverMcpResponse,
  HarnessGeneratePromptParams,
  HarnessGeneratePromptResponse,
  HarnessGenerateClaudeMdParams,
  HarnessGenerateClaudeMdResponse,
  HarnessApplyParams,
  HarnessApplyResponse,
  HarnessSavePresetParams,
  HarnessSavePresetResponse,
  HarnessLoadPresetsResponse,
  HarnessChatParams,
  HarnessChatResponse,
  HarnessDesignAgentsParams,
  HarnessDesignAgentsResponse,
  HarnessGenerateSkillsParams,
  HarnessGenerateSkillsResponse,
  HarnessGenerateDocumentParams,
  HarnessGenerateDocumentResponse,
  HarnessAnalyzeIntentParams,
  HarnessAnalyzeIntentResponse,
} from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class HarnessRpcService {
  private readonly rpcService = inject(ClaudeRpcService);

  /**
   * Start a harness builder session.
   * Returns workspace context, available agents, skills, and presets.
   */
  public async initialize(): Promise<HarnessInitializeResponse> {
    const result = await this.rpcService.call('harness:initialize', {});
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to initialize harness builder');
  }

  /**
   * AI-generate configuration suggestions from persona description and goals.
   * Uses a 2-minute timeout since this involves LLM processing.
   */
  public async suggestConfig(
    params: HarnessSuggestConfigParams,
  ): Promise<HarnessSuggestConfigResponse> {
    const result = await this.rpcService.call(
      'harness:suggest-config',
      params,
      { timeout: 120_000 },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to get AI config suggestions');
  }

  /**
   * Search available skills by query string.
   */
  public async searchSkills(
    query: string,
  ): Promise<HarnessSearchSkillsResponse> {
    const result = await this.rpcService.call('harness:search-skills', {
      query,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to search skills');
  }

  /**
   * Create a new skill definition from the wizard flow.
   */
  public async createSkill(
    params: HarnessCreateSkillParams,
  ): Promise<HarnessCreateSkillResponse> {
    const result = await this.rpcService.call('harness:create-skill', params);
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to create skill');
  }

  /**
   * Discover available MCP servers in the workspace.
   */
  public async discoverMcp(): Promise<HarnessDiscoverMcpResponse> {
    const result = await this.rpcService.call('harness:discover-mcp', {});
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to discover MCP servers');
  }

  /**
   * AI-generate system prompt based on persona and selected agents/skills.
   * Uses a 2-minute timeout since this involves LLM processing.
   */
  public async generatePrompt(
    params: HarnessGeneratePromptParams,
  ): Promise<HarnessGeneratePromptResponse> {
    const result = await this.rpcService.call(
      'harness:generate-prompt',
      params,
      { timeout: 120_000 },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to generate system prompt');
  }

  /**
   * Generate CLAUDE.md preview from the current configuration.
   * Uses a 2-minute timeout since this involves LLM processing.
   */
  public async generateClaudeMd(
    params: HarnessGenerateClaudeMdParams,
  ): Promise<HarnessGenerateClaudeMdResponse> {
    const result = await this.rpcService.call(
      'harness:generate-claude-md',
      params,
      { timeout: 120_000 },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to generate CLAUDE.md');
  }

  /**
   * Apply the full harness configuration to the workspace.
   * Uses a 1-minute timeout for file writes.
   */
  public async apply(
    params: HarnessApplyParams,
  ): Promise<HarnessApplyResponse> {
    const result = await this.rpcService.call('harness:apply', params, {
      timeout: 60_000,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to apply harness configuration');
  }

  /**
   * Save the current configuration as a reusable preset.
   */
  public async savePreset(
    params: HarnessSavePresetParams,
  ): Promise<HarnessSavePresetResponse> {
    const result = await this.rpcService.call('harness:save-preset', params);
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to save preset');
  }

  /**
   * List all saved harness presets.
   */
  public async loadPresets(): Promise<HarnessLoadPresetsResponse> {
    const result = await this.rpcService.call('harness:load-presets', {});
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to load presets');
  }

  /**
   * Send a step-contextual AI chat message.
   * Uses a 1-minute timeout for LLM response.
   */
  public async chat(params: HarnessChatParams): Promise<HarnessChatResponse> {
    const result = await this.rpcService.call('harness:chat', params, {
      timeout: 60_000,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to get chat response');
  }

  /**
   * AI-design a custom subagent fleet based on persona and goals.
   * Uses a 2-minute timeout since this involves LLM processing.
   */
  public async designAgents(
    params: HarnessDesignAgentsParams,
  ): Promise<HarnessDesignAgentsResponse> {
    const result = await this.rpcService.call('harness:design-agents', params, {
      timeout: 120_000,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to design agent fleet');
  }

  /**
   * AI-generate specialized skill specs for the persona.
   * Uses a 2-minute timeout since this involves LLM processing.
   */
  public async generateSkills(
    params: HarnessGenerateSkillsParams,
  ): Promise<HarnessGenerateSkillsResponse> {
    const result = await this.rpcService.call(
      'harness:generate-skills',
      params,
      { timeout: 120_000 },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to generate skills');
  }

  /**
   * Generate a comprehensive PRD/requirements document from config.
   * Uses a 2-minute timeout since this involves LLM processing.
   */
  public async generateDocument(
    params: HarnessGenerateDocumentParams,
  ): Promise<HarnessGenerateDocumentResponse> {
    const result = await this.rpcService.call(
      'harness:generate-document',
      params,
      { timeout: 120_000 },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to generate requirements document');
  }

  /**
   * AI-architect a complete harness from freeform input.
   * Accepts any text: PRD, simple instruction, or description.
   * Uses a 3-minute timeout since this is the most comprehensive LLM call.
   */
  public async analyzeIntent(
    params: HarnessAnalyzeIntentParams,
  ): Promise<HarnessAnalyzeIntentResponse> {
    const result = await this.rpcService.call(
      'harness:analyze-intent',
      params,
      { timeout: 180_000 },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to analyze intent');
  }
}
