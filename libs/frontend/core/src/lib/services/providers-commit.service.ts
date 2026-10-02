import { Injectable, inject, signal } from '@angular/core';
import type {
  ConfigGetScopesResult,
  RpcMethodName,
  RpcMethodParams,
  RpcMethodResult,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { requireRpcData } from './providers-settings-sections';
import type {
  ProvidersEditContext,
  ProvidersSettingsCommit,
  ProvidersSettingsPatch,
  ProvidersSettingsSection,
  SaveOperation,
  SaveOutcome,
} from './providers-settings.types';
import { WorkspaceScopeService } from './workspace-scope.service';

const MODEL_TIERS = ['sonnet', 'opus', 'haiku'] as const;
export type ProvidersModelTier = (typeof MODEL_TIERS)[number];

/** Read-back equality: arrays match element by element, in order; everything else strictly. */
function sameSetting(stored: unknown, requested: unknown): boolean {
  if (Array.isArray(requested))
    return Array.isArray(stored) && stored.length === requested.length &&
      requested.every((value, index) => stored[index] === value);
  return stored === requested;
}

const EMPTY_COMMIT: ProvidersSettingsCommit = {
  status: 'idle',
  saved: [],
  unsaved: [],
  unconfirmed: [],
  refreshFailed: false,
  message: null,
};

/**
 * What a commit needs from the page state that owns the sections. Called in this order:
 * `refreshScopes` before any write, `scopes` whenever the edit context is checked, `refresh`
 * after the writes, then `sectionsReady` to report a failed post-save refresh.
 */
export interface ProvidersCommitHooks {
  refreshScopes(): Promise<void>;
  refresh(): Promise<void>;
  scopes(): ProvidersSettingsSection<ConfigGetScopesResult>;
  /** Every section the page renders read back `ready` after the post-save refresh. */
  sectionsReady(): boolean;
}

/**
 * Owns the Providers settings commit pipeline and its feedback (`commit()`): one save at a time,
 * staged writes (552), read-back that can never promote a failed write (D15), and refusal of a
 * save while another is in flight (D3). Commands never retain credentials; only field names
 * enter the feedback.
 */
@Injectable({ providedIn: 'root' })
export class ProvidersCommitService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly workspace = inject(WorkspaceScopeService);
  private readonly commitState = signal<ProvidersSettingsCommit>(EMPTY_COMMIT);
  readonly commit = this.commitState.asReadonly();

  /** Reports a save refused before any write, naming the fields that were not saved. */
  block(unsaved: readonly string[], message: string): void {
    this.commitState.set({ ...EMPTY_COMMIT, status: 'blocked', unsaved, message });
  }

  /** One save operation per field of the patch, in a fixed order. The patch is copied, never retained beyond its writes. */
  operations(patch: ProvidersSettingsPatch): SaveOperation[] {
    const operations: SaveOperation[] = [];
    if (patch.auth) {
      const params = { ...patch.auth };
      operations.push({
        fields: Object.entries(params)
          .filter(([key, value]) => key !== 'applyTo' && value !== undefined)
          .map(([key]) => key),
        write: async () =>
          (await this.require('auth:saveSettings', params)).success,
      });
    }
    if (patch.model) {
      const params = { ...patch.model };
      operations.push({
        fields: ['Main agent model'],
        write: async () => {
          await this.require('config:model-switch', params);
          return true;
        },
        readBack: async () =>
          (await this.require('config:model-get', {})).model === params.model,
      });
    }
    if (patch.effort) {
      const params = { ...patch.effort };
      operations.push({
        fields: ['Main agent reasoning effort'],
        write: async () => {
          await this.require('config:effort-set', params);
          return true;
        },
        readBack: async () =>
          (await this.require('config:effort-get', {})).effort ===
          params.effort,
      });
    }
    for (const field of ['curatorProvider', 'curatorModel'] as const) {
      const value = patch.memory?.[field];
      if (value !== undefined)
        operations.push({
          fields: [`memory.${field}`],
          write: async () => {
            await this.require('memory:setTriggers', {
              triggers: { [field]: value },
            });
            return true;
          },
          readBack: async () =>
            (await this.require('memory:getTriggers', {})).triggers[field] ===
            value,
        });
    }
    for (const lane of [
      'archaeologist',
      'synthesis',
      'judge',
      'replay',
    ] as const) {
      for (const field of ['provider', 'model'] as const) {
        const value = patch.lanes?.[lane]?.[field];
        if (value !== undefined)
          operations.push({
            fields: [`skillSynthesis.${lane}.${field}`],
            write: async () => {
              await this.require('skillSynthesis:setLanes', {
                lanes: { [lane]: { [field]: value } },
              });
              return true;
            },
            readBack: async () =>
              (await this.require('skillSynthesis:getLanes', {})).lanes[lane][
                field
              ] === value,
          });
      }
    }
    for (const field of [
      'judgeProvider',
      'judgeModel',
      'enhanceTimeoutMs',
    ] as const) {
      const requested = patch.judging?.[field];
      if (requested === undefined) continue;
      // model-resolver.ts:171 recognizes only 'inherit', not the picker's ''.
      const value =
        field === 'judgeModel' && typeof requested === 'string'
          ? requested.trim() || 'inherit'
          : requested;
      operations.push({
        fields: [`skillSynthesis.${field}`],
        write: async () => {
          const settings = { [field]: value };
          return (
            await this.require('skillSynthesis:updateSettings', { settings })
          ).updated;
        },
        readBack: async () => {
          const settings = (
            await this.require('skillSynthesis:getSettings', {})
          ).settings;
          return (
            (field === 'enhanceTimeoutMs'
              ? settings.enhanceTimeoutMs.value
              : settings[field]) === value
          );
        },
      });
    }
    for (const field of [
      'codexModel',
      'copilotModel',
      'cursorModel',
      'antigravityModel',
      'opencodeModel',
      'piModel',
      'codexReasoningEffort',
      'copilotReasoningEffort',
      'piReasoningEffort',
      'disabledClis',
      'preferredAgentOrder',
      'maxConcurrentAgents',
      'copilotAutoApprove',
    ] as const) {
      const value = patch.orchestration?.[field];
      if (value !== undefined)
        operations.push({
          fields: [`agentOrchestration.${field}`],
          write: async () =>
            (await this.require('agent:setConfig', { [field]: value })).success,
          readBack: async () =>
            sameSetting((await this.require('agent:getConfig', undefined))[field], value),
        });
    }
    for (const tier of patch.tiers ?? []) {
      const params = { ...tier };
      operations.push({
        fields: [
          `provider.${params.providerId ?? 'active'}.modelTier.${params.tier}`,
        ],
        write: async () =>
          (await this.require('provider:setModelTier', params)).success,
        readBack: async () =>
          (
            await this.require('provider:getModelTiers', {
              providerId: params.providerId,
              scope: params.scope,
            })
          )[params.tier] === params.modelId,
      });
    }
    for (const command of patch.cli ?? []) {
      const key = `ptahCliAgents.${'id' in command.params ? command.params.id : 'new'}`;
      const fields =
        command.action === 'delete'
          ? [key]
          : Object.entries(command.params)
              .filter(([field, value]) => field !== 'id' && value !== undefined)
              .map(([field]) => `${key}.${field}`);
      operations.push({
        fields,
        write: async () => {
          switch (command.action) {
            case 'create':
              // The host contract for Copilot-backed instances: OAuth instances carry this non-secret marker.
              return (await this.require('ptahCli:create', { ...command.params,
                apiKey: command.params.providerId === 'github-copilot' ? 'copilot-oauth' : command.params.apiKey,
              })).success;
            case 'update':
              return (await this.require('ptahCli:update', command.params))
                .success;
            case 'delete':
              return (await this.require('ptahCli:delete', command.params))
                .success;
          }
        },
      });
    }
    return operations;
  }

  /** Main-agent tier of one provider; an empty model clears the stored tier (provider default). */
  mainAgentTierOperation(providerId: string, tier: ProvidersModelTier, modelId: string): SaveOperation {
    const scope = 'mainAgent';
    return {
      fields: [`Main agent ${tier} model`],
      write: async () => modelId
        ? (await this.require('provider:setModelTier', { providerId, tier, modelId, scope })).success
        : (await this.require('provider:clearModelTier', { providerId, tier, scope })).success,
      readBack: async () =>
        ((await this.require('provider:getModelTiers', { providerId, scope }))[tier] ?? '') === modelId,
    };
  }

  /**
   * A Ptah CLI instance's own tier mapping (D5). `ptahCli:update` replaces the whole object, so
   * it always carries every set tier; a blank tier is omitted and falls back to the provider tier.
   */
  cliInstanceTiersOperation(id: string, tiers: Partial<Record<ProvidersModelTier, string>>): SaveOperation {
    const tierMappings: Partial<Record<ProvidersModelTier, string>> = {};
    for (const tier of MODEL_TIERS) {
      const model = tiers[tier]?.trim();
      if (model) tierMappings[tier] = model;
    }
    return {
      fields: [`ptahCliAgents.${id}.tierMappings`],
      write: async () => (await this.require('ptahCli:update', { id, tierMappings })).success,
      readBack: async () => {
        const stored = await this.require('settings:get', { key: 'ptahCliAgents' });
        if (!stored.success || !Array.isArray(stored.value)) throw new Error('CLI tiers unavailable');
        const agent: unknown = stored.value.find((item: unknown) =>
          !!item && typeof item === 'object' && 'id' in item && item.id === id);
        // A missing instance (deleted meanwhile, or a wrong id) is not saved, even for a clear-all.
        if (!agent || typeof agent !== 'object') return false;
        const saved: unknown = 'tierMappings' in agent ? agent.tierMappings : undefined;
        return MODEL_TIERS.every((tier) => {
          const value: unknown = saved && typeof saved === 'object' ? (saved as Record<string, unknown>)[tier] : undefined;
          return (value ?? undefined) === tierMappings[tier];
        });
      },
    };
  }

  /**
   * Resolves `false` without touching `commit()` when another save is in flight: the caller must
   * tell the user the request was refused (D3). Otherwise resolves `true` once `commit()` describes
   * this request. `saved` only ever holds acknowledged writes whose read-back, if any, matched (D15).
   */
  async run(
    operations: readonly SaveOperation[],
    context: ProvidersEditContext,
    hooks: ProvidersCommitHooks,
    allowed = () => true,
  ): Promise<boolean> {
    if (this.commit().status === 'saving') return false;
    this.commitState.set({ ...EMPTY_COMMIT, status: 'saving' });
    await hooks.refreshScopes();
    if (!this.contextMatches(context, hooks) || !allowed()) {
      this.commitState.set({
        ...EMPTY_COMMIT,
        status: 'blocked',
        unsaved: operations.flatMap((operation) => operation.fields),
        message:
          'Review the current workspace and supported save target before saving.',
      });
      return true;
    }
    const saved: string[] = [],
      unsaved: string[] = [],
      unconfirmed: string[] = [],
      conflicted: string[] = [];
    let setupFailed = false,
      anyFailed = false;
    for (const operation of operations) {
      const skipped =
        operation.stage === 'activation'
          ? anyFailed
          : operation.stage !== undefined && setupFailed;
      const outcome: SaveOutcome =
        skipped || !this.contextMatches(context, hooks)
          ? 'unsaved'
          : await this.settle(operation, context, hooks);
      if (outcome === 'conflict') conflicted.push(...operation.fields);
      (outcome === 'saved'
        ? saved
        : outcome === 'unconfirmed'
          ? unconfirmed
          : unsaved
      ).push(...operation.fields);
      if (outcome !== 'saved') {
        anyFailed = true;
        if (operation.stage === 'setup') setupFailed = true;
      }
    }
    // Always refresh, even after rejection: host handlers can fail after a partial write.
    await hooks.refresh();
    if (!this.contextMatches(context, hooks)) {
      unconfirmed.push(...saved);
      saved.length = 0;
    }
    const refreshFailed = !hooks.sectionsReady();
    const status = unconfirmed.length
      ? 'unconfirmed'
      : unsaved.length
        ? saved.length
          ? 'partial'
          : 'failed'
        : 'saved';
    this.commitState.set({
      status,
      saved,
      unsaved,
      unconfirmed,
      refreshFailed,
      message: [
        conflicted.length
          ? `Changed elsewhere since setup opened, not overwritten: ${conflicted.join(', ')}. Reopen setup to review the current value.`
          : '',
        refreshFailed ? 'Some settings could not be refreshed. Retry those sections.' : '',
      ].filter(Boolean).join(' ') || null,
    });
    return true;
  }

  /**
   * D15: a rejected write (`false`, `'conflict'`) is not saved and a thrown one is unconfirmed (it
   * may have written; never claim a rollback). Neither runs read-back, so read-back can never
   * promote a failed write to saved. Only an acknowledged write in the same context is read back.
   */
  private async settle(
    operation: SaveOperation,
    context: ProvidersEditContext,
    hooks: ProvidersCommitHooks,
  ): Promise<SaveOutcome> {
    let written: boolean | 'conflict';
    try {
      written = await operation.write();
    } catch (error: unknown) {
      // RPC errors may contain credentials. Neither their message nor object enters UI state.
      void error;
      return 'unconfirmed';
    }
    // 'conflict': nothing was written; surface it instead of overwriting a newer value.
    if (written === 'conflict') return 'conflict';
    if (!written) return 'unsaved';
    if (!this.contextMatches(context, hooks)) return 'unconfirmed';
    if (!operation.readBack) return 'saved';
    try {
      const matches = await operation.readBack();
      if (!this.contextMatches(context, hooks)) return 'unconfirmed';
      return matches ? 'saved' : 'unsaved';
    } catch (error: unknown) {
      void error;
      return 'unconfirmed';
    }
  }

  /** The draft was reviewed in this workspace and the scope read it was reviewed against is current. */
  private contextMatches(context: ProvidersEditContext, hooks: ProvidersCommitHooks): boolean {
    const scopes = hooks.scopes();
    return (
      this.workspace.scopeKey() === context.scopeKey &&
      scopes.status === 'ready' &&
      scopes.data?.activePath === context.activePath
    );
  }

  private require<T extends RpcMethodName>(
    method: T,
    params: RpcMethodParams<T>,
  ): Promise<RpcMethodResult<T>> {
    return requireRpcData(this.rpc, method, params);
  }
}
