import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { CliDetectionService } from '@ptah-extension/cli-agent-runtime';
import type { IModelDiscovery } from '@ptah-extension/platform-core';
import {
  AUTH_PROVIDERS_TOKENS,
  type CodexAuthService,
  type CopilotAuthService,
} from '@ptah-extension/auth-providers';
import type {
  AgentListCliModelsResult,
  AgentModelEntry,
  AgentModelProvider,
  CliModelOption,
} from '@ptah-extension/shared';

/** The CLI model picker list shared by RPC consumers on every host. */
@injectable()
export class CliModelListService {
  constructor(
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(TOKENS.MODEL_DISCOVERY)
    private readonly modelDiscovery: IModelDiscovery,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuthService: CodexAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuthService: CopilotAuthService,
  ) {}

  async listAll(): Promise<AgentListCliModelsResult> {
    return (await this.loadModels()).models;
  }

  /** Only live auth/host queries establish provider-reported model ids. */
  async listForClassification(): Promise<
    Record<AgentModelProvider, AgentModelEntry[]>
  > {
    const { models, codexReported, copilotReported } = await this.loadModels();
    const fallback = (entries: CliModelOption[]): AgentModelEntry[] =>
      entries.map((entry) => ({ ...entry, isFallback: true }));

    return {
      claude: [],
      codex: codexReported ? models.codex : fallback(models.codex),
      copilot: copilotReported ? models.copilot : fallback(models.copilot),
      cursor: fallback(models.cursor),
      opencode: fallback(models.opencode),
    };
  }

  private async loadModels(): Promise<{
    models: AgentListCliModelsResult;
    codexReported: boolean;
    copilotReported: boolean;
  }> {
    const modelMap = await this.cliDetection.listModelsForAll();

    // The lane runs the installed `codex`, so its own catalog (already
    // filtered for that binary's version) comes first. The account's live
    // menu in `~/.codex/auth.json` is next; the adapter's curated list last.
    let codex = await this.getCodexModelsFromCliCatalog();
    if (codex.length === 0) codex = await this.getCodexModelsFromAuth();
    const codexReported = codex.length > 0;
    if (!codexReported) {
      codex = (modelMap['codex'] ?? []) as CliModelOption[];
    }
    // Hosts with a Language Model API (VS Code) report the models the user
    // actually has. Elsewhere the signed-in Copilot account's /models list
    // does; the curated per-CLI list stands in only when neither answers.
    let copilot = await this.getCopilotModelsFromHost();
    if (copilot.length === 0) copilot = await this.getCopilotModelsFromAuth();
    const copilotReported = copilot.length > 0;
    if (!copilotReported) {
      copilot = (modelMap['copilot'] ?? []) as CliModelOption[];
    }
    const cursor = (modelMap['cursor'] ?? []) as CliModelOption[];
    const antigravity = (modelMap['antigravity'] ?? []) as CliModelOption[];
    const opencode = (modelMap['opencode'] ?? []) as CliModelOption[];
    const pi = (modelMap['pi'] ?? []) as CliModelOption[];
    const grok = (modelMap['grok'] ?? []) as CliModelOption[];

    const result: AgentListCliModelsResult = {
      codex,
      copilot,
      cursor,
      antigravity,
      opencode,
      pi,
      grok,
    };

    return { models: result, codexReported, copilotReported };
  }

  /**
   * Copilot models as reported by the host's Language Model API, with
   * human-readable display names. Empty when the host has no such API.
   */
  private async getCopilotModelsFromHost(): Promise<CliModelOption[]> {
    try {
      const models = await this.modelDiscovery.getCopilotModels();
      return models.map((model) => ({
        id: model.id,
        name: this.formatModelDisplayName(model.id),
      }));
    } catch {
      // degradation-audit: optional-capability - the host Language Model API
      // is optional; an empty list leaves the adapter's curated list standing in.
      return [];
    }
  }

  /** The installed Codex CLI's own catalog; empty when it cannot be read. */
  private async getCodexModelsFromCliCatalog(): Promise<CliModelOption[]> {
    const adapter = this.cliDetection.getAdapter('codex') as
      | { listCatalogModels?: () => Promise<readonly CliModelOption[]> }
      | undefined;
    try {
      return [...((await adapter?.listCatalogModels?.()) ?? [])];
    } catch {
      // degradation-audit: optional-capability - no readable CLI catalog
      // means the account list or the curated list stands in.
      return [];
    }
  }

  /**
   * Copilot models for the signed-in Copilot account, from its /models
   * endpoint. Empty when not signed in or offline.
   */
  private async getCopilotModelsFromAuth(): Promise<CliModelOption[]> {
    try {
      const models = await this.copilotAuthService.listModels();
      return models.map((model) => ({
        id: model.id,
        name: model.name || this.formatModelDisplayName(model.id),
      }));
    } catch {
      // degradation-audit: optional-capability - the Copilot /models endpoint
      // needs a signed-in, online account; an empty list leaves the curated
      // per-CLI list standing in.
      return [];
    }
  }

  /**
   * Codex models for the account in `~/.codex/auth.json`, as reported by the
   * provider `/models` endpoint. Empty when unauthenticated or offline, in
   * which case the adapter's curated list stands in.
   */
  private async getCodexModelsFromAuth(): Promise<CliModelOption[]> {
    try {
      const models = await this.codexAuthService.listModels();
      return models.map((model) => ({
        id: model.id,
        name: model.name || this.formatModelDisplayName(model.id),
      }));
    } catch {
      // degradation-audit: optional-capability - the provider /models endpoint
      // needs an authenticated, online account; an empty list leaves the
      // adapter's curated model list standing in.
      return [];
    }
  }

  /**
   * Convert a model family slug to a human-readable name.
   * e.g. "claude-opus-4.6" -> "Claude Opus 4.6"
   *      "gpt-5.3-codex"   -> "GPT 5.3 Codex"
   */
  private formatModelDisplayName(family: string): string {
    return family
      .split('-')
      .map((part) => {
        if (/^\d/.test(part)) return part;
        const upper = part.toUpperCase();
        if (['GPT', 'AI'].includes(upper)) return upper;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  }
}
