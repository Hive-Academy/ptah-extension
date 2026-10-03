import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { CliDetectionService } from '@ptah-extension/cli-agent-runtime';
import type { IModelDiscovery } from '@ptah-extension/platform-core';
import {
  AUTH_PROVIDERS_TOKENS,
  type CodexAuthService,
} from '@ptah-extension/auth-providers';
import type {
  AgentListCliModelsResult,
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
  ) {}

  async listAll(): Promise<AgentListCliModelsResult> {
    const modelMap = await this.cliDetection.listModelsForAll();

    // The Codex adapter only knows a curated list baked into the build.
    // `~/.codex/auth.json` is the same account the CLI uses, so the
    // account's live model menu is authoritative when it resolves.
    let codex = await this.getCodexModelsFromAuth();
    if (codex.length === 0) {
      codex = (modelMap['codex'] ?? []) as CliModelOption[];
    }
    // Hosts with a Language Model API (VS Code) report the models the
    // user actually has; everywhere else this is empty and the curated
    // per-CLI list stands in.
    let copilot = await this.getCopilotModelsFromHost();
    if (copilot.length === 0) {
      copilot = (modelMap['copilot'] ?? []) as CliModelOption[];
    }
    const cursor = (modelMap['cursor'] ?? []) as CliModelOption[];
    const antigravity = (modelMap['antigravity'] ?? []) as CliModelOption[];
    const opencode = (modelMap['opencode'] ?? []) as CliModelOption[];
    const pi = (modelMap['pi'] ?? []) as CliModelOption[];

    const result: AgentListCliModelsResult = {
      codex,
      copilot,
      cursor,
      antigravity,
      opencode,
      pi,
    };

    return result;
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
