import { Injectable, inject, signal } from '@angular/core';
import { LoggingService } from '@ptah-extension/core';
import type {
  HarnessAnalyzeIntentParams,
  HarnessAnalyzeIntentResponse,
  HarnessConfig,
  HarnessDesignAgentsParams,
  HarnessDesignAgentsResponse,
  HarnessDiscoverMcpResponse,
  HarnessGenerateClaudeMdParams,
  HarnessGenerateClaudeMdResponse,
  HarnessGenerateDocumentParams,
  HarnessGenerateDocumentResponse,
  HarnessGeneratePromptParams,
  HarnessGeneratePromptResponse,
  HarnessGenerateSkillsParams,
  HarnessGenerateSkillsResponse,
  HarnessSuggestConfigParams,
  HarnessSuggestConfigResponse,
  HarnessSubagentDefinition,
  McpServerEntry,
  McpServerSuggestion,
  NewSkillDefinition,
} from '@ptah-extension/shared';
import { HarnessRpcService } from './harness-rpc.service';

export type HarnessHelperKind =
  | 'suggest-config'
  | 'design-agents'
  | 'generate-skills'
  | 'generate-document'
  | 'analyze-intent'
  | 'discover-mcp'
  | 'generate-prompt'
  | 'generate-claude-md';

export type HarnessHelperResult =
  | { kind: 'suggest-config'; value: HarnessSuggestConfigResponse }
  | { kind: 'design-agents'; value: HarnessDesignAgentsResponse }
  | { kind: 'generate-skills'; value: HarnessGenerateSkillsResponse }
  | { kind: 'generate-document'; value: HarnessGenerateDocumentResponse }
  | { kind: 'analyze-intent'; value: HarnessAnalyzeIntentResponse }
  | { kind: 'discover-mcp'; value: HarnessDiscoverMcpResponse }
  | { kind: 'generate-prompt'; value: HarnessGeneratePromptResponse }
  | { kind: 'generate-claude-md'; value: HarnessGenerateClaudeMdResponse };

export interface HarnessHelperAddition {
  updates: Partial<HarnessConfig>;
  suggestedMcpServers?: McpServerSuggestion[];
  document?: string;
}

function skillDefinitions(
  specs: HarnessSuggestConfigResponse['suggestedSkillSpecs'],
): NewSkillDefinition[] {
  return (specs ?? []).map((spec) => ({
    name: spec.name,
    description: spec.description,
    content: spec.content,
    allowedTools: spec.requiredTools,
  }));
}

function mergeByKey<T>(
  existing: T[],
  incoming: T[],
  key: (item: T) => string,
): T[] {
  const merged = new Map<string, T>(
    existing.map((item): [string, T] => [key(item), item]),
  );
  incoming.forEach((item) => merged.set(key(item), item));
  return [...merged.values()];
}

@Injectable({ providedIn: 'root' })
export class HarnessHelperService {
  private readonly rpc = inject(HarnessRpcService);
  private readonly logger = inject(LoggingService);
  private readonly _busy = signal<HarnessHelperKind | null>(null);
  private readonly _result = signal<HarnessHelperResult | null>(null);
  private readonly _error = signal<{
    kind: HarnessHelperKind;
    message: string;
  } | null>(null);
  private adding = false;

  readonly busy = this._busy.asReadonly();
  readonly result = this._result.asReadonly();
  readonly error = this._error.asReadonly();

  private async run(
    kind: HarnessHelperKind,
    request: () => Promise<HarnessHelperResult>,
  ): Promise<boolean> {
    if (this._busy() !== null || this.adding) return false;
    this._busy.set(kind);
    this._result.set(null);
    this._error.set(null);
    try {
      this._result.set(await request());
      return true;
    } catch (err) {
      this.logger.error(
        'HarnessHelperService',
        'Could not complete helper request',
        err instanceof Error ? err : new Error(String(err)),
      );
      // RPC errors can contain host details. Keep the sidebar error plain and scoped.
      this._error.set({
        kind,
        message: 'Could not complete this helper. Try again.',
      });
      return false;
    } finally {
      this._busy.set(null);
    }
  }

  suggestConfig(params: HarnessSuggestConfigParams): Promise<boolean> {
    return this.run('suggest-config', async () => ({
      kind: 'suggest-config',
      value: await this.rpc.suggestConfig(params),
    }));
  }

  designAgents(params: HarnessDesignAgentsParams): Promise<boolean> {
    return this.run('design-agents', async () => ({
      kind: 'design-agents',
      value: await this.rpc.designAgents(params),
    }));
  }

  generateSkills(params: HarnessGenerateSkillsParams): Promise<boolean> {
    return this.run('generate-skills', async () => ({
      kind: 'generate-skills',
      value: await this.rpc.generateSkills(params),
    }));
  }

  generateDocument(params: HarnessGenerateDocumentParams): Promise<boolean> {
    return this.run('generate-document', async () => ({
      kind: 'generate-document',
      value: await this.rpc.generateDocument(params),
    }));
  }

  analyzeIntent(params: HarnessAnalyzeIntentParams): Promise<boolean> {
    return this.run('analyze-intent', async () => ({
      kind: 'analyze-intent',
      value: await this.rpc.analyzeIntent(params),
    }));
  }

  discoverMcp(): Promise<boolean> {
    return this.run('discover-mcp', async () => ({
      kind: 'discover-mcp',
      value: await this.rpc.discoverMcp(),
    }));
  }

  generatePrompt(params: HarnessGeneratePromptParams): Promise<boolean> {
    return this.run('generate-prompt', async () => ({
      kind: 'generate-prompt',
      value: await this.rpc.generatePrompt(params),
    }));
  }

  generateClaudeMd(params: HarnessGenerateClaudeMdParams): Promise<boolean> {
    return this.run('generate-claude-md', async () => ({
      kind: 'generate-claude-md',
      value: await this.rpc.generateClaudeMd(params),
    }));
  }

  dismiss(): void {
    this._result.set(null);
    this._error.set(null);
  }

  /** Commit the selected result through the owning preview store. Failed commits stay visible. */
  async addToPreview(
    current: Partial<HarnessConfig>,
    commit: (addition: HarnessHelperAddition) => void | Promise<void>,
  ): Promise<boolean> {
    const result = this._result();
    if (!result || this._busy() || this.adding) return false;
    const addition = this.toAddition(result, current);
    this.adding = true;
    try {
      await commit(addition);
      this._result.set(null);
      this._error.set(null);
      return true;
    } catch (err) {
      this.logger.error(
        'HarnessHelperService',
        'Could not add helper result to preview',
        err instanceof Error ? err : new Error(String(err)),
      );
      this._error.set({
        kind: result.kind,
        message: 'Could not add this result to the preview. Try again.',
      });
      return false;
    } finally {
      this.adding = false;
    }
  }

  private toAddition(
    result: HarnessHelperResult,
    current: Partial<HarnessConfig>,
  ): HarnessHelperAddition {
    switch (result.kind) {
      case 'suggest-config':
        return {
          updates: {
            agents: {
              enabledAgents: {
                ...current.agents?.enabledAgents,
                ...result.value.suggestedAgents,
              },
              harnessSubagents: mergeByKey<HarnessSubagentDefinition>(
                current.agents?.harnessSubagents ?? [],
                result.value.suggestedSubagents ?? [],
                (item) => item.id,
              ),
            },
            skills: {
              selectedSkills: [
                ...new Set([
                  ...(current.skills?.selectedSkills ?? []),
                  ...result.value.suggestedSkills,
                ]),
              ],
              selectedSkillRefs: current.skills?.selectedSkillRefs,
              createdSkills: mergeByKey(
                current.skills?.createdSkills ?? [],
                skillDefinitions(result.value.suggestedSkillSpecs),
                (item) => item.name,
              ),
            },
            prompt: {
              systemPrompt: result.value.suggestedPrompt,
              enhancedSections: current.prompt?.enhancedSections ?? {},
            },
          },
          suggestedMcpServers: result.value.suggestedMcpServers,
        };
      case 'design-agents':
        return {
          updates: {
            agents: {
              enabledAgents: current.agents?.enabledAgents ?? {},
              harnessSubagents: mergeByKey<HarnessSubagentDefinition>(
                current.agents?.harnessSubagents ?? [],
                result.value.subagents,
                (item) => item.id,
              ),
            },
          },
        };
      case 'generate-skills':
        return {
          updates: {
            skills: {
              selectedSkills: current.skills?.selectedSkills ?? [],
              selectedSkillRefs: current.skills?.selectedSkillRefs,
              createdSkills: mergeByKey(
                current.skills?.createdSkills ?? [],
                skillDefinitions(result.value.skills),
                (item) => item.name,
              ),
            },
          },
        };
      case 'generate-document':
        return { updates: {}, document: result.value.document };
      case 'analyze-intent':
        return {
          updates: {
            persona: result.value.persona,
            agents: {
              enabledAgents: {
                ...current.agents?.enabledAgents,
                ...result.value.suggestedAgents,
              },
              harnessSubagents: mergeByKey<HarnessSubagentDefinition>(
                current.agents?.harnessSubagents ?? [],
                result.value.suggestedSubagents,
                (item) => item.id,
              ),
            },
            skills: {
              selectedSkills: [
                ...new Set([
                  ...(current.skills?.selectedSkills ?? []),
                  ...result.value.suggestedSkills,
                ]),
              ],
              selectedSkillRefs: current.skills?.selectedSkillRefs,
              createdSkills: mergeByKey(
                current.skills?.createdSkills ?? [],
                skillDefinitions(result.value.suggestedSkillSpecs),
                (item) => item.name,
              ),
            },
            prompt: {
              systemPrompt: result.value.suggestedPrompt,
              enhancedSections: current.prompt?.enhancedSections ?? {},
            },
          },
          suggestedMcpServers: result.value.suggestedMcpServers,
        };
      case 'discover-mcp':
        return {
          updates: {
            mcp: {
              servers: mergeByKey<McpServerEntry>(
                current.mcp?.servers ?? [],
                result.value.servers,
                (item) => item.serverKey ?? item.name,
              ),
              enabledTools: current.mcp?.enabledTools ?? {},
            },
          },
        };
      case 'generate-prompt':
        return {
          updates: {
            prompt: {
              systemPrompt: result.value.generatedPrompt,
              enhancedSections: result.value.sections,
            },
          },
        };
      case 'generate-claude-md':
        return {
          updates: {
            claudeMd: {
              generateProjectClaudeMd:
                current.claudeMd?.generateProjectClaudeMd ?? true,
              customSections: current.claudeMd?.customSections ?? {},
              previewContent: result.value.content,
            },
          },
        };
    }
  }
}
