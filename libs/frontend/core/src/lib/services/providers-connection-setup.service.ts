import { Injectable, inject } from '@angular/core';
import {
  CustomProviderEntryInputSchema,
  getAnthropicProvider,
  type AuthCancelDraftVerificationParams,
  type AuthCancelDraftVerificationResult,
  type AuthSaveSettingsParams,
  type AuthVerifyDraftConnectionParams,
  type AuthVerifyDraftConnectionResult,
  type RpcMethodName,
  type RpcMethodParams,
  type RpcMethodResult,
  type SettingScope,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { ProvidersCommitService, type ProvidersCommitHooks } from './providers-commit.service';
import {
  createSectionStore,
  readSection,
  requireRpcData,
  sectionView,
  SECTION_LOAD_ERROR,
  type SectionStore,
} from './providers-settings-sections';
import type {
  ProvidersConnection,
  ProvidersConnectionDraft,
  ProvidersEditContext,
  ProvidersExternalAuth,
  ProvidersExternalAuthAction,
  ProvidersSettingsSection,
  SaveOperation,
} from './providers-settings.types';
import { WorkspaceScopeService } from './workspace-scope.service';

/**
 * Native Anthropic auth (Claude API key, Claude subscription CLI). Activation sends no
 * `anthropicProviderId` ('anthropic' is virtual and fails AuthSettingsSchema; the pre-#575 UI
 * never sent one for either) and writes no main-agent tiers (those pin ANTHROPIC_DEFAULT_*_MODEL).
 */
const NATIVE_ANTHROPIC_IDS: ReadonlySet<string> = new Set(['anthropic', 'claude-cli']);

/** What connection setup needs from the page state that owns the other sections. */
export interface ProvidersConnectionSetupHooks {
  /** Loaded connection catalogue; setup and activation require it `ready`. */
  connections(): ProvidersSettingsSection<readonly ProvidersConnection[]>;
  /** Host-supported write targets for a setting key. */
  writeScopes(key: string): readonly SettingScope[];
  /** Section hooks the commit pipeline runs with. */
  readonly commit: ProvidersCommitHooks;
  /** Re-read after an external sign-in, in parallel. */
  refreshConnections(): Promise<void>;
  refreshRoute(): Promise<void>;
}

/**
 * Connection setup for the Providers page: the draft probe (one generation counter for verify,
 * cancel and abort), external sign-in, and the staged connect/activate operations handed to
 * `ProvidersCommitService`. A caller-owned credential is never copied into a signal.
 */
@Injectable({ providedIn: 'root' })
export class ProvidersConnectionSetupService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly commits = inject(ProvidersCommitService);
  private readonly workspace = inject(WorkspaceScopeService);
  private readonly probeStore = createSectionStore<AuthVerifyDraftConnectionResult>();
  private readonly externalAuthStore = createSectionStore<ProvidersExternalAuth>();
  private externalAuthGeneration = 0;
  private probeGeneration = 0;
  private probeId: string | null = null;
  private verifiedProviderId: string | null = null;

  readonly verification = sectionView(this.probeStore, this.workspace);
  readonly externalAuth = sectionView(this.externalAuthStore, this.workspace);

  /** Only supported host login operations run; launch acknowledgements are not authentication. */
  async performExternalAuth(
    providerId: string | null,
    action: ProvidersExternalAuthAction,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<void> {
    const generation = ++this.externalAuthGeneration;
    const empty: ProvidersExternalAuth = { providerId, signInState: 'idle', accountLabel: null, cliInstalled: null, message: null };
    if (action === 'sign-in-cancel' || !providerId ||
      !['github-copilot', 'openai-codex', 'claude-cli'].includes(providerId) ||
      (providerId === 'claude-cli' && action !== 'cli-check')) {
      ++this.externalAuthStore.generation;
      this.externalAuthStore.scopeKey = this.workspace.scopeKey();
      this.externalAuthStore.value.set({ status: 'ready', error: null, data: {
        ...empty, message: action === 'sign-in-cancel'
          ? 'This host cannot cancel external sign-in. Close the external sign-in window to stop it.'
          : !providerId ? 'Choose the named sign-in action on the Providers page. The setup dialog does not identify the requested account.'
          : providerId === 'claude-cli' ? 'Run claude login in your terminal, then choose Check again. If missing, install with npm install -g @anthropic-ai/claude-code.' : 'Complete login outside Ptah, then check again.',
      } });
      return;
    }
    this.externalAuthStore.scopeKey = this.workspace.scopeKey();
    this.externalAuthStore.value.set({ status: 'loading', error: null, data: { ...empty, signInState: 'in-flight' } });
    await this.read(this.externalAuthStore, async (): Promise<ProvidersExternalAuth> => {
      if (action !== 'cli-check') {
        const result = providerId === 'github-copilot'
          ? await this.require('auth:copilotLogin', {}, 310000)
          : await this.require('auth:codexLogin', {}, 310000);
        if (!result.success) throw new Error('Sign-in unavailable');
      }
      const result = await this.require('auth:getAuthStatus', { providerId });
      if (generation !== this.externalAuthGeneration) throw new Error('Superseded sign-in');
      const signedIn = providerId === 'github-copilot' ? result.copilotAuthenticated === true
        : providerId === 'openai-codex' ? result.codexAuthenticated === true && !result.codexTokenStale : false;
      return { ...empty, signInState: signedIn ? 'signed-in' : 'idle',
        cliInstalled: providerId === 'claude-cli' ? result.claudeCliInstalled ?? null : null,
        message: signedIn ? 'Sign-in detected. Verify the connection before using it.'
          : 'Login has not been confirmed. Complete external login, then check again.',
      };
    });
    await Promise.all([hooks.refreshConnections(), hooks.refreshRoute()]);
  }

  /**
   * Store setup without selecting it, then optionally activate only after all earlier writes succeed.
   * Resolves `false` when refused because another save is in flight (see `ProvidersCommitService.run`).
   */
  async connectProvider(
    draft: ProvidersConnectionDraft,
    context: ProvidersEditContext,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<boolean> {
    // A blocked result below would overwrite the in-flight save's feedback.
    if (this.commits.commit().status === 'saving') return false;
    const probe = this.verification();
    const invalid = (draft.providerId === 'anthropic' && draft.activation === 'connect-only') || draft.saveTo !== 'global' || hooks.connections().status !== 'ready' ||
      probe.status !== 'ready' || probe.data?.outcome !== 'verified' || probe.data.probeId !== draft.verified?.probeId ||
      this.verifiedProviderId !== draft.providerId;
    if (invalid) {
      this.commits.block(['Connection'], 'Verify this draft and review Global setup storage before saving.');
      return true;
    }
    const operations: SaveOperation[] = [];
    const custom = draft.authMode === 'custom';
    const mappings = { sonnet: draft.tiers.everyday, opus: draft.tiers.complex, haiku: draft.tiers.fast };
    if (custom) {
      const parsed = CustomProviderEntryInputSchema.safeParse({
        id: draft.providerId, name: draft.customName, baseUrl: draft.baseUrl, lane: draft.customProtocol,
        defaultTiers: mappings,
      });
      if (!parsed.success) {
        this.commits.block(['Custom connection'], 'Use a lower-case connection ID with dashes, an HTTP(S) endpoint and explicit models for all three tiers.');
        return true;
      }
      const exists = hooks.connections().data?.some((entry) => entry.id === draft.providerId && entry.custom);
      operations.push({ fields: ['Custom connection'], stage: 'setup', write: async () => {
        if (exists) await this.require('provider:updateCustomEntry', { id: draft.providerId, changes: parsed.data });
        else await this.require('provider:addCustomEntry', { entry: parsed.data });
        return true;
      } });
    }
    if (draft.providerId !== 'anthropic' && draft.credential?.value.trim()) {
      // llm:setApiKey ALSO selects the main route. auth:setApiKey only stores the provider key.
      operations.push({ fields: ['Connection credential'], stage: 'setup',
        write: async () => (await this.require('auth:setApiKey', { provider: draft.providerId, apiKey: draft.credential?.value ?? '' })).success });
    }
    if (!custom && draft.baseUrl) operations.push({ fields: ['Connection endpoint'], stage: 'setup',
      write: async () => (await this.require('llm:setProviderBaseUrl', { provider: draft.providerId, baseUrl: draft.baseUrl ?? '' })).success });
    // Native Anthropic auth keeps the SDK's own model defaults: no tiers are collected, validated or written.
    const nativeAnthropic = NATIVE_ANTHROPIC_IDS.has(draft.providerId) || draft.authMode === 'cli';
    const tiers = Object.entries(mappings) as [RpcMethodParams<'provider:setModelTier'>['tier'], string][];
    const defaults = getAnthropicProvider(draft.providerId)?.defaultTiers;
    if (!nativeAnthropic && !custom && tiers.some(([tier, model]) => !model && !defaults?.[tier])) {
      this.commits.block(['Connection models'], 'Choose explicit models where no provider default is available.');
      return true;
    }
    // Main-agent tiers, for Connect only as well as activation: provider:setModelTier persists
    // provider.<id>.mainAgent.modelTier.<tier> and changes the running env only when <id> is the active
    // provider (ProviderModelsService.setModelTier). Only tiers the user EDITED in the wizard are sent;
    // unchanged tiers are left to the host's fill-if-unset auto-map. No `cliAgent` writes: those are
    // read by PtahCliRegistry.resolveEffectiveTiers for every CLI agent on this provider.
    if (!nativeAnthropic && !custom) {
      const wizardKey = { sonnet: 'everyday', opus: 'complex', haiku: 'fast' } as const;
      for (const [tier, model] of tiers) {
        const key = wizardKey[tier];
        if (!draft.editedTiers.includes(key)) continue;
        // Tiers depend on the setup writes, not on each other: one conflict reports that tier only (552).
        operations.push({ fields: [`Main agent ${tier} model`], stage: 'tier',
          write: async () => {
            // Compare-and-set: the edit was made against the snapshot the wizard loaded. If another
            // window changed the stored value since, report a conflict instead of overwriting it.
            const stored = await this.require('provider:getModelTiers', { providerId: draft.providerId, scope: 'mainAgent' });
            if ((stored[tier] ?? null) !== (draft.tierSnapshot[key] ?? null)) return 'conflict';
            if (!model) return (await this.require('provider:clearModelTier', { providerId: draft.providerId, tier, scope: 'mainAgent' })).success;
            return (await this.require('provider:setModelTier', { providerId: draft.providerId, tier, modelId: model, scope: 'mainAgent' })).success;
          },
          readBack: async () => {
            const stored = await this.require('provider:getModelTiers', { providerId: draft.providerId, scope: 'mainAgent' });
            return (stored[tier] ?? '') === model;
          } });
      }
    }
    // Activate LAST. auth:saveSettings auto-maps UNSET tiers, so running it first would fill a tier the
    // wizard snapshot saw as empty and turn the user's own edit into a false conflict. Writing the edits
    // first is safe (an inactive provider's tiers never touch the running env), and a failed or
    // conflicting tier write stops activation through the activation stage.
    if (draft.activation === 'use-main-agent') {
      operations.push(...this.commits.operations({ auth: this.activationAuth(draft.providerId, draft.authMode, draft.saveTo,
        draft.providerId === 'anthropic' ? draft.credential?.value : undefined) })
        .map((operation): SaveOperation => ({ ...operation, stage: 'activation' })));
    }
    return this.commits.run(operations, context, hooks.commit, () => draft.activation !== 'use-main-agent' ||
      this.authWritable(hooks, draft.saveTo, !nativeAnthropic));
  }

  /**
   * Select an existing connection for the main agent. Tier mapping is left to `auth:saveSettings`,
   * whose autoMapProviderTiers fills only UNSET main-agent tiers; the user's existing tiers stay.
   */
  async activateConnection(
    providerId: string,
    applyTo: SettingScope,
    context: ProvidersEditContext,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<boolean> {
    if (this.commits.commit().status === 'saving') return false;
    const connection = hooks.connections().data?.find((entry) => entry.id === providerId);
    if (!connection || hooks.connections().status !== 'ready') {
      this.commits.block(['Main agent connection'], 'Refresh this connection before activating it.');
      return true;
    }
    const auth = this.activationAuth(providerId, connection.authMode, applyTo);
    return this.commits.run(this.commits.operations({ auth }), context, hooks.commit,
      () => this.authWritable(hooks, applyTo, auth.anthropicProviderId !== undefined));
  }

  private activationAuth(providerId: string, authMode: ProvidersConnection['authMode'], applyTo: SettingScope,
    anthropicApiKey?: string): AuthSaveSettingsParams {
    if (providerId === 'anthropic') return { authMethod: 'apiKey', ...(anthropicApiKey !== undefined ? { anthropicApiKey } : {}), applyTo };
    if (authMode === 'cli' || NATIVE_ANTHROPIC_IDS.has(providerId)) return { authMethod: 'claudeCli', applyTo };
    return { authMethod: 'thirdParty', anthropicProviderId: providerId, applyTo };
  }

  private authWritable(hooks: ProvidersConnectionSetupHooks, target: SettingScope, withProvider: boolean): boolean {
    return hooks.writeScopes('authMethod').includes(target) &&
      (!withProvider || hooks.writeScopes('anthropicProviderId').includes(target));
  }

  /** Probe is non-mutating. A caller-owned credential is never copied into a signal. */
  async verifyDraft(params: AuthVerifyDraftConnectionParams): Promise<void> {
    const generation = ++this.probeGeneration;
    const previous = this.probeId;
    this.probeId = params.probeId;
    this.verifiedProviderId = null;
    // A failed best-effort abort cannot publish an old result: both generations are checked below.
    if (previous) void this.abortProbe(previous);
    this.probeStore.value.set({ status: 'unloaded', data: null, error: null });
    await this.read(this.probeStore, async () => {
      const result = await this.require(
        'auth:verifyDraftConnection',
        params,
        Math.max(30000, params.timeoutMs ?? 30000) + 5000,
      );
      if (
        generation !== this.probeGeneration ||
        result.probeId !== params.probeId
      )
        throw new Error('Superseded check');
      return result;
    });
    if (generation === this.probeGeneration) {
      this.probeId = null;
      if (this.verification().data?.outcome === 'verified') this.verifiedProviderId = params.providerId;
    }
  }
  async cancelVerification(params?: AuthCancelDraftVerificationParams): Promise<AuthCancelDraftVerificationResult> {
    const id = params?.probeId ?? this.probeId;
    if (params && id !== this.probeId) return this.require('auth:cancelDraftVerification', params);
    const generation = ++this.probeGeneration;
    ++this.probeStore.generation;
    this.probeId = null;
    this.verifiedProviderId = null;
    this.probeStore.scopeKey = this.workspace.scopeKey();
    this.probeStore.value.set({ status: 'unloaded', data: null, error: null });
    try {
      return id ? await this.require('auth:cancelDraftVerification', { probeId: id }) : { cancelled: false };
    } catch {
      // Deliberately unbound: RPC error text can carry a credential, so only the fixed message
      // below leaves this service (no `cause`).
      if (generation === this.probeGeneration) {
        this.probeStore.value.set({ status: 'error', data: null, error: SECTION_LOAD_ERROR });
      }
      throw new Error('Could not cancel this check.');
    }
  }

  private read<T>(store: SectionStore<T>, request: () => Promise<T>): Promise<void> {
    return readSection(store, this.workspace, request);
  }
  private require<T extends RpcMethodName>(
    method: T,
    params: RpcMethodParams<T>,
    timeout?: number,
  ): Promise<RpcMethodResult<T>> {
    return requireRpcData(this.rpc, method, params, timeout);
  }
  /** Best-effort abort. A failure cannot publish a stale result: generations are re-checked. */
  private async abortProbe(probeId: string): Promise<void> {
    try {
      await this.require('auth:cancelDraftVerification', { probeId });
    } catch (error: unknown) {
      // `require()` throws a fixed message, so no credential is logged.
      console.warn(
        '[ProvidersConnectionSetupService] Draft verification abort failed:',
        error,
      );
    }
  }
}
