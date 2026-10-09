import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CustomProviderEntryChangesSchema,
  CustomProviderEntryInputSchema,
  getAnthropicProvider,
  type AuthCancelDraftVerificationParams,
  type AuthCancelDraftVerificationResult,
  type AuthSaveSettingsParams,
  type AuthVerifyDraftConnectionParams,
  type AuthVerifyDraftConnectionResult,
  type CustomProviderPricing,
  type RpcMethodName,
  type RpcMethodParams,
  type RpcMethodResult,
  type SettingScope,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import {
  ProvidersCommitService,
  type ProvidersCommitHooks,
} from './providers-commit.service';
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
  ProvidersConnectionCheck,
  ProvidersCustomEntry,
  ProvidersEffectiveRoute,
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
const NATIVE_ANTHROPIC_IDS: ReadonlySet<string> = new Set([
  'anthropic',
  'claude-cli',
]);
/** The host's stored-key probe allows up to 30 s, plus its queue wait (as `auth:verifyDraftConnection`). */
const CHECK_TIMEOUT_MS = 35000;
/** Removing the main agent's own connection is refused, by the route snapshot or by the host (`CONNECTION_IN_USE`). */
const SWITCH_MAIN_AGENT_FIRST = 'Switch the main agent first.';

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
  /** Effective main-agent route; removing a custom connection checks its driver. */
  route(): ProvidersSettingsSection<ProvidersEffectiveRoute>;
  /** Refreshes the shared auth-state signals after a confirmed main-agent change. */
  refreshAuthStatus(): Promise<void>;
}

type CustomEndpointChanges = Partial<
  Pick<ProvidersCustomEntry, 'baseUrl' | 'modelsEndpoint'>
>;
type CustomMetadataChanges = Partial<
  Pick<ProvidersCustomEntry, 'helpUrl' | 'pricing'>
>;
const ENDPOINT_FIELDS = {
  baseUrl: 'Custom connection base URL',
  modelsEndpoint: 'Custom connection models endpoint',
} as const;
const METADATA_FIELDS = {
  helpUrl: 'Custom connection help URL',
  pricing: 'Custom connection pricing',
} as const;

function samePricing(
  stored: CustomProviderPricing | null | undefined,
  requested: CustomProviderPricing | null | undefined,
): boolean {
  if (!stored || !requested) return (stored ?? null) === (requested ?? null);
  return (
    stored.inputPerMillion === requested.inputPerMillion &&
    stored.outputPerMillion === requested.outputPerMillion
  );
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
  private readonly probeStore =
    createSectionStore<AuthVerifyDraftConnectionResult>();
  private readonly externalAuthStore =
    createSectionStore<ProvidersExternalAuth>();
  private externalAuthGeneration = 0;
  private probeGeneration = 0;
  private probeId: string | null = null;
  private verifiedProviderId: string | null = null;

  readonly verification = sectionView(this.probeStore, this.workspace);
  readonly externalAuth = sectionView(this.externalAuthStore, this.workspace);
  private readonly checkState = signal<
    (ProvidersConnectionCheck & { readonly scopeKey: string }) | null
  >(null);
  private checkGeneration = 0;
  /** The drawer's last "Check connection" in this workspace; null before one ran. */
  readonly connectionCheck = computed<ProvidersConnectionCheck | null>(() => {
    const state = this.checkState();
    return state && state.scopeKey === this.workspace.scopeKey()
      ? { providerId: state.providerId, status: state.status }
      : null;
  });

  /**
   * The drawer's "Check connection". A connection the host can check (`auth:checkConnection`: API-key, custom,
   * CLI and sign-in connections) is checked there, which records the result; the route is then re-read, and its
   * `providers[].lastCheck` carries that record to the Overview. Local servers and key-optional routes (Ollama,
   * LM Studio, Ollama Cloud), which the host refuses, keep the route re-read alone. A failed check RPC publishes
   * `failed` only, never its text. The latest check wins; an earlier one that settles late publishes nothing.
   */
  async checkConnection(
    providerId: string,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<void> {
    if (!this.hostCheckable(providerId, hooks)) {
      await hooks.refreshRoute();
      return;
    }
    const generation = ++this.checkGeneration;
    const scopeKey = this.workspace.scopeKey();
    this.checkState.set({ providerId, status: 'checking', scopeKey });
    let status: ProvidersConnectionCheck['status'] = 'done';
    try {
      await this.require(
        'auth:checkConnection',
        { providerId },
        CHECK_TIMEOUT_MS,
      );
    } catch {
      // `require()` throws a fixed message; the host's error text never enters state.
      status = 'failed';
    }
    // Re-read before publishing, so "Checking…" lasts until the recorded result can be shown.
    await hooks.refreshRoute();
    if (generation === this.checkGeneration)
      this.checkState.set({ providerId, status, scopeKey });
  }

  /** Only supported host login operations run; launch acknowledgements are not authentication. */
  async performExternalAuth(
    providerId: string | null,
    action: ProvidersExternalAuthAction,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<void> {
    const generation = ++this.externalAuthGeneration;
    const empty: ProvidersExternalAuth = {
      providerId,
      signInState: 'idle',
      accountLabel: null,
      cliInstalled: null,
      message: null,
    };
    if (
      action === 'sign-in-cancel' ||
      !providerId ||
      !['github-copilot', 'openai-codex', 'claude-cli'].includes(providerId) ||
      (providerId === 'claude-cli' && action !== 'cli-check')
    ) {
      ++this.externalAuthStore.generation;
      this.externalAuthStore.scopeKey = this.workspace.scopeKey();
      this.externalAuthStore.value.set({
        status: 'ready',
        error: null,
        data: {
          ...empty,
          message:
            action === 'sign-in-cancel'
              ? 'This host cannot cancel external sign-in. Close the external sign-in window to stop it.'
              : !providerId
                ? 'Choose the named sign-in action on the Providers page. The setup dialog does not identify the requested account.'
                : providerId === 'claude-cli'
                  ? 'Run claude login in your terminal, then choose Check again. If missing, install with npm install -g @anthropic-ai/claude-code.'
                  : 'Complete login outside Ptah, then check again.',
        },
      });
      return;
    }
    this.externalAuthStore.scopeKey = this.workspace.scopeKey();
    this.externalAuthStore.value.set({
      status: 'loading',
      error: null,
      data: { ...empty, signInState: 'in-flight' },
    });
    await this.read(
      this.externalAuthStore,
      async (): Promise<ProvidersExternalAuth> => {
        if (action !== 'cli-check') {
          const result =
            providerId === 'github-copilot'
              ? await this.require('auth:copilotLogin', {}, 310000)
              : await this.require('auth:codexLogin', {}, 310000);
          if (!result.success) throw new Error('Sign-in unavailable');
        }
        const result = await this.require('auth:getAuthStatus', { providerId });
        if (generation !== this.externalAuthGeneration)
          throw new Error('Superseded sign-in');
        const signedIn =
          providerId === 'github-copilot'
            ? result.copilotAuthenticated === true
            : providerId === 'openai-codex'
              ? result.codexAuthenticated === true && !result.codexTokenStale
              : false;
        return {
          ...empty,
          signInState: signedIn ? 'signed-in' : 'idle',
          cliInstalled:
            providerId === 'claude-cli'
              ? (result.claudeCliInstalled ?? null)
              : null,
          message: signedIn
            ? 'Sign-in detected. Verify the connection before using it.'
            : 'Login has not been confirmed. Complete external login, then check again.',
        };
      },
    );
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
    const invalid =
      (draft.providerId === 'anthropic' &&
        draft.activation === 'connect-only') ||
      draft.saveTo !== 'global' ||
      hooks.connections().status !== 'ready' ||
      !this.verifiedFor(draft.providerId, draft.verified?.probeId);
    if (invalid) {
      this.commits.block(
        ['Connection'],
        'Verify this draft and review Global setup storage before saving.',
      );
      return true;
    }
    const operations: SaveOperation[] = [];
    const custom = draft.authMode === 'custom';
    const mappings = {
      sonnet: draft.tiers.everyday,
      opus: draft.tiers.complex,
      haiku: draft.tiers.fast,
    };
    if (custom) {
      const parsed = CustomProviderEntryInputSchema.safeParse({
        id: draft.providerId,
        name: draft.customName,
        baseUrl: draft.baseUrl,
        lane: draft.customProtocol,
        defaultTiers: mappings,
      });
      if (!parsed.success) {
        this.commits.block(
          ['Custom connection'],
          'Use a lower-case connection ID with dashes, an HTTP(S) endpoint and explicit models for all three tiers.',
        );
        return true;
      }
      const exists = hooks
        .connections()
        .data?.some((entry) => entry.id === draft.providerId && entry.custom);
      operations.push({
        fields: ['Custom connection'],
        stage: 'setup',
        write: async () => {
          if (exists)
            await this.require('provider:updateCustomEntry', {
              id: draft.providerId,
              changes: parsed.data,
            });
          else
            await this.require('provider:addCustomEntry', {
              entry: parsed.data,
            });
          return true;
        },
      });
    }
    if (draft.providerId !== 'anthropic' && draft.credential?.value.trim()) {
      // llm:setApiKey ALSO selects the main route. auth:setApiKey only stores the provider key.
      operations.push({
        fields: ['Connection credential'],
        stage: 'setup',
        write: async () =>
          (
            await this.require('auth:setApiKey', {
              provider: draft.providerId,
              apiKey: draft.credential?.value ?? '',
            })
          ).success,
      });
    }
    if (!custom && draft.baseUrl)
      operations.push({
        fields: ['Connection endpoint'],
        stage: 'setup',
        write: async () =>
          (
            await this.require('llm:setProviderBaseUrl', {
              provider: draft.providerId,
              baseUrl: draft.baseUrl ?? '',
            })
          ).success,
      });
    // Native Anthropic auth keeps the SDK's own model defaults: no tiers are collected, validated or written.
    const nativeAnthropic =
      NATIVE_ANTHROPIC_IDS.has(draft.providerId) || draft.authMode === 'cli';
    const tiers = Object.entries(mappings) as [
      RpcMethodParams<'provider:setModelTier'>['tier'],
      string,
    ][];
    const defaults = getAnthropicProvider(draft.providerId)?.defaultTiers;
    if (
      !nativeAnthropic &&
      !custom &&
      tiers.some(([tier, model]) => !model && !defaults?.[tier])
    ) {
      this.commits.block(
        ['Connection models'],
        'Choose explicit models where no provider default is available.',
      );
      return true;
    }
    // Main-agent tiers, for Connect only as well as activation: provider:setModelTier persists
    // provider.<id>.mainAgent.modelTier.<tier> and changes the running env only when <id> is the active
    // provider (ProviderModelsService.setModelTier). Only tiers the user EDITED in the wizard are sent;
    // unchanged tiers are left to the host's fill-if-unset auto-map. No `cliAgent` writes: those are
    // read by PtahCliRegistry.resolveEffectiveTiers for every CLI agent on this provider.
    if (!nativeAnthropic && !custom) {
      const wizardKey = {
        sonnet: 'everyday',
        opus: 'complex',
        haiku: 'fast',
      } as const;
      for (const [tier, model] of tiers) {
        const key = wizardKey[tier];
        if (!draft.editedTiers.includes(key)) continue;
        // Tiers depend on the setup writes, not on each other: one conflict reports that tier only (552).
        operations.push({
          fields: [`Main agent ${tier} model`],
          stage: 'tier',
          write: async () => {
            // Compare-and-set: the edit was made against the snapshot the wizard loaded. If another
            // window changed the stored value since, report a conflict instead of overwriting it.
            const stored = await this.require('provider:getModelTiers', {
              providerId: draft.providerId,
              scope: 'mainAgent',
            });
            if ((stored[tier] ?? null) !== (draft.tierSnapshot[key] ?? null))
              return 'conflict';
            if (!model)
              return (
                await this.require('provider:clearModelTier', {
                  providerId: draft.providerId,
                  tier,
                  scope: 'mainAgent',
                })
              ).success;
            return (
              await this.require('provider:setModelTier', {
                providerId: draft.providerId,
                tier,
                modelId: model,
                scope: 'mainAgent',
              })
            ).success;
          },
          readBack: async () => {
            const stored = await this.require('provider:getModelTiers', {
              providerId: draft.providerId,
              scope: 'mainAgent',
            });
            return (stored[tier] ?? '') === model;
          },
        });
      }
    }
    // Activate LAST. auth:saveSettings auto-maps UNSET tiers, so running it first would fill a tier the
    // wizard snapshot saw as empty and turn the user's own edit into a false conflict. Writing the edits
    // first is safe (an inactive provider's tiers never touch the running env), and a failed or
    // conflicting tier write stops activation through the activation stage.
    if (draft.activation === 'use-main-agent') {
      operations.push(
        ...this.commits
          .operations({
            auth: this.activationAuth(
              draft.providerId,
              draft.authMode,
              draft.saveTo,
              draft.providerId === 'anthropic'
                ? draft.credential?.value
                : undefined,
            ),
          })
          .map((operation): SaveOperation => ({
            ...operation,
            stage: 'activation',
          })),
      );
    }
    const committed = await this.commits.run(
      operations,
      context,
      hooks.commit,
      () =>
        draft.activation !== 'use-main-agent' ||
        this.authWritable(hooks, draft.saveTo, !nativeAnthropic),
    );
    if (committed && draft.activation === 'use-main-agent' && this.commits.commit().status === 'saved') {
      await hooks.refreshAuthStatus();
    }
    return committed;
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
    const connection = hooks
      .connections()
      .data?.find((entry) => entry.id === providerId);
    if (!connection || hooks.connections().status !== 'ready') {
      this.commits.block(
        ['Main agent connection'],
        'Refresh this connection before activating it.',
      );
      return true;
    }
    const auth = this.activationAuth(providerId, connection.authMode, applyTo);
    const committed = await this.commits.run(
      this.commits.operations({ auth }),
      context,
      hooks.commit,
      () =>
        this.authWritable(
          hooks,
          applyTo,
          auth.anthropicProviderId !== undefined,
        ),
    );
    if (committed && this.commits.commit().status === 'saved') {
      await hooks.refreshAuthStatus();
    }
    return committed;
  }

  private activationAuth(
    providerId: string,
    authMode: ProvidersConnection['authMode'],
    applyTo: SettingScope,
    anthropicApiKey?: string,
  ): AuthSaveSettingsParams {
    if (providerId === 'anthropic')
      return {
        authMethod: 'apiKey',
        ...(anthropicApiKey !== undefined ? { anthropicApiKey } : {}),
        applyTo,
      };
    if (authMode === 'cli' || NATIVE_ANTHROPIC_IDS.has(providerId))
      return { authMethod: 'claudeCli', applyTo };
    return {
      authMethod: 'thirdParty',
      anthropicProviderId: providerId,
      applyTo,
    };
  }

  private authWritable(
    hooks: ProvidersConnectionSetupHooks,
    target: SettingScope,
    withProvider: boolean,
  ): boolean {
    return (
      hooks.writeScopes('authMethod').includes(target) &&
      (!withProvider ||
        hooks.writeScopes('anthropicProviderId').includes(target))
    );
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
      if (this.verification().data?.outcome === 'verified')
        this.verifiedProviderId = params.providerId;
    }
  }
  async cancelVerification(
    params?: AuthCancelDraftVerificationParams,
  ): Promise<AuthCancelDraftVerificationResult> {
    const id = params?.probeId ?? this.probeId;
    if (params && id !== this.probeId)
      return this.require('auth:cancelDraftVerification', params);
    const generation = ++this.probeGeneration;
    ++this.probeStore.generation;
    this.probeId = null;
    this.verifiedProviderId = null;
    this.probeStore.scopeKey = this.workspace.scopeKey();
    this.probeStore.value.set({ status: 'unloaded', data: null, error: null });
    try {
      return id
        ? await this.require('auth:cancelDraftVerification', { probeId: id })
        : { cancelled: false };
    } catch {
      // Deliberately unbound: RPC error text can carry a credential, so only the fixed message
      // below leaves this service (no `cause`).
      if (generation === this.probeGeneration) {
        this.probeStore.value.set({
          status: 'error',
          data: null,
          error: SECTION_LOAD_ERROR,
        });
      }
      throw new Error('Could not cancel this check.');
    }
  }

  /**
   * D4: deletes one stored key. No auth-method write and no SDK reset. A row the host could not read after the
   * delete (`keyUnreadable`, M-6) is not proof of deletion, so it reads back as not deleted.
   */
  deleteStoredKey(
    providerId: string,
    context: ProvidersEditContext,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<boolean> {
    return this.commits.run(
      [
        {
          fields: ['Stored key'],
          write: async () =>
            (await this.require('auth:deleteStoredKey', { providerId }))
              .success,
          readBack: async () => {
            if (providerId === 'anthropic')
              return (
                (await this.require('auth:getAuthStatus', {})).hasApiKey !==
                true
              );
            const row = (
              await this.require('auth:getApiKeyStatus', {})
            ).providers.find((entry) => entry.provider === providerId);
            return row?.hasApiKey !== true && row?.keyUnreadable !== true;
          },
        },
      ],
      context,
      hooks.commit,
    );
  }

  disconnectCopilot(
    context: ProvidersEditContext,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<boolean> {
    return this.commits.run(
      [
        {
          fields: ['GitHub Copilot sign-in'],
          write: async () =>
            (await this.require('auth:copilotLogout', {})).success,
          readBack: async () =>
            (await this.require('auth:getAuthStatus', {}))
              .copilotAuthenticated !== true,
        },
      ],
      context,
      hooks.commit,
    );
  }

  /**
   * Refused while the connection drives the main agent: that would leave the main agent without a provider. The
   * route snapshot refuses first; the host refuses too (`CONNECTION_IN_USE`, M-5) when the snapshot is stale, and
   * both show the same fixed block. The host's error text never enters state.
   */
  async removeCustomEntry(
    id: string,
    context: ProvidersEditContext,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<boolean> {
    if (this.commits.commit().status === 'saving') return false;
    const route = hooks.route();
    if (route.status !== 'ready' || !route.data) {
      this.commits.block(
        ['Custom connection'],
        'Refresh the main agent route before removing this connection.',
      );
      return true;
    }
    if (route.data.driverProviderId === id) {
      this.commits.block(['Custom connection'], SWITCH_MAIN_AGENT_FIRST);
      return true;
    }
    let inUse = false;
    const started = await this.commits.run(
      [
        {
          fields: ['Custom connection'],
          write: async () => {
            const result = await this.rpc.call('provider:removeCustomEntry', {
              id,
            });
            // Nothing was removed: an unsaved write, then the block below replaces the generic failure.
            if (!result.success && result.errorCode === 'CONNECTION_IN_USE') {
              inUse = true;
              return false;
            }
            if (!result.isSuccess()) throw new Error('Settings request failed');
            return result.data.removed;
          },
          readBack: async () =>
            !(await this.customEntries()).some((entry) => entry.id === id),
        },
      ],
      context,
      hooks.commit,
    );
    if (started && inUse)
      this.commits.block(['Custom connection'], SWITCH_MAIN_AGENT_FIRST);
    return started;
  }

  /** Help URL and pricing are metadata: saved without a connection check. */
  async updateCustomEntryFields(
    id: string,
    changes: CustomMetadataChanges,
    context: ProvidersEditContext,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<boolean> {
    if (this.commits.commit().status === 'saving') return false;
    const parsed = CustomProviderEntryChangesSchema.pick({
      helpUrl: true,
      pricing: true,
    })
      .strict()
      .safeParse(changes);
    const fields = parsed.success
      ? (Object.keys(parsed.data) as (keyof typeof METADATA_FIELDS)[])
      : [];
    if (!parsed.success || !fields.length) {
      this.commits.block(
        [METADATA_FIELDS.helpUrl, METADATA_FIELDS.pricing],
        'Check the help URL and prices; prices cannot be negative.',
      );
      return true;
    }
    const requested = parsed.data;
    return this.commits.run(
      [
        {
          fields: fields.map((field) => METADATA_FIELDS[field]),
          write: async () =>
            !!(
              await this.require('provider:updateCustomEntry', {
                id,
                changes: requested,
              })
            ).entry,
          readBack: async () => {
            const entry = (await this.customEntries()).find(
              (candidate) => candidate.id === id,
            );
            return (
              !!entry &&
              (requested.helpUrl === undefined ||
                entry.helpUrl === requested.helpUrl) &&
              (!('pricing' in requested) ||
                samePricing(entry.pricing, requested.pricing))
            );
          },
        },
      ],
      context,
      hooks.commit,
    );
  }

  /**
   * D7: saved only after a verified probe of this connection (`probeId`). The caller verifies the
   * new base URL, or the current one with the stored credential when only the models endpoint changes.
   */
  async updateCustomEntryEndpoint(
    id: string,
    changes: CustomEndpointChanges,
    probeId: string,
    context: ProvidersEditContext,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<boolean> {
    if (this.commits.commit().status === 'saving') return false;
    const parsed = CustomProviderEntryChangesSchema.pick({
      baseUrl: true,
      modelsEndpoint: true,
    })
      .strict()
      .safeParse(changes);
    const fields = parsed.success
      ? (Object.keys(parsed.data) as (keyof typeof ENDPOINT_FIELDS)[])
      : [];
    const names = fields.length
      ? fields.map((field) => ENDPOINT_FIELDS[field])
      : [ENDPOINT_FIELDS.baseUrl];
    if (!this.verifiedFor(id, probeId)) {
      this.commits.block(
        names,
        'Verify this connection before saving its endpoint.',
      );
      return true;
    }
    if (!parsed.success || !fields.length) {
      this.commits.block(names, 'Use an http:// or https:// base URL.');
      return true;
    }
    const requested = parsed.data;
    return this.commits.run(
      [
        {
          fields: names,
          write: async () =>
            !!(
              await this.require('provider:updateCustomEntry', {
                id,
                changes: requested,
              })
            ).entry,
          readBack: async () => {
            const entry = (await this.customEntries()).find(
              (candidate) => candidate.id === id,
            );
            return (
              !!entry &&
              (requested.baseUrl === undefined ||
                entry.baseUrl === requested.baseUrl) &&
              (!('modelsEndpoint' in requested) ||
                (entry.modelsEndpoint ?? null) ===
                  (requested.modelsEndpoint ?? null))
            );
          },
        },
      ],
      context,
      hooks.commit,
    );
  }

  /** A built-in local server's endpoint; saved only after a verified probe of that URL. */
  async updateLocalBaseUrl(
    providerId: string,
    baseUrl: string,
    probeId: string,
    context: ProvidersEditContext,
    hooks: ProvidersConnectionSetupHooks,
  ): Promise<boolean> {
    if (this.commits.commit().status === 'saving') return false;
    if (!this.verifiedFor(providerId, probeId)) {
      this.commits.block(
        ['Connection endpoint'],
        'Verify this connection before saving its endpoint.',
      );
      return true;
    }
    return this.commits.run(
      [
        {
          fields: ['Connection endpoint'],
          write: async () =>
            (
              await this.require('llm:setProviderBaseUrl', {
                provider: providerId,
                baseUrl,
              })
            ).success,
          readBack: async () =>
            (
              await this.require('llm:getProviderBaseUrl', {
                provider: providerId,
              })
            ).baseUrl === baseUrl,
        },
      ],
      context,
      hooks.commit,
    );
  }

  /**
   * Mirrors the host's `connectionCheckKind` (rpc-handlers `connection-check.ts`): the Claude API key, custom
   * entries, the Claude CLI, GitHub Copilot, OpenAI Codex and key-required remote providers. Local servers and
   * key-optional routes are not checkable there.
   */
  private hostCheckable(
    providerId: string,
    hooks: ProvidersConnectionSetupHooks,
  ): boolean {
    if (
      providerId === 'anthropic' ||
      hooks
        .connections()
        .data?.some((entry) => entry.id === providerId && entry.custom)
    )
      return true;
    const entry = getAnthropicProvider(providerId);
    if (!entry) return false;
    return (
      !!entry.nativeAuth ||
      !!entry.isCustom ||
      providerId === 'github-copilot' ||
      providerId === 'openai-codex' ||
      ((entry.authType ?? 'apiKey') === 'apiKey' && !entry.isLocal)
    );
  }

  /** The last check finished `verified`, for this probe and this provider (#27). */
  private verifiedFor(
    providerId: string,
    probeId: string | undefined,
  ): boolean {
    const probe = this.verification();
    return (
      probe.status === 'ready' &&
      probe.data?.outcome === 'verified' &&
      probe.data.probeId === probeId &&
      this.verifiedProviderId === providerId
    );
  }
  private async customEntries(): Promise<readonly ProvidersCustomEntry[]> {
    return (await this.require('provider:listCustomEntries', {})).entries;
  }
  private read<T>(
    store: SectionStore<T>,
    request: () => Promise<T>,
  ): Promise<void> {
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
