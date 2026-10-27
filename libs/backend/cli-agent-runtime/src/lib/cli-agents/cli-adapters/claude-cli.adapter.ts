import { randomUUID } from 'node:crypto';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  EffectiveCapabilitySet,
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import type {
  ProviderAccountAdmissionPort,
  ProviderAccountPortRefusal,
} from '@ptah-extension/auth-providers-tokens';
import type {
  Options,
  SdkModuleLoader,
  SdkModelService,
  SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import {
  buildClaudeLaneBootstrapOptions,
  buildClaudeSdkLaneOptions,
} from '../../claude/claude-sdk-lane-options';
import {
  ClaudeNamedLaneAdmission,
  claudeLaneRefusal,
  claudeLaneRefusalCode,
  type ClaudeLaneAccountPersistence,
  type ClaudeSdkLaneRunner,
  type ClaudeSdkLaneRunContext,
} from '../../claude/claude-sdk-lane-runner';
import type { PtahCliSpawnOptions } from '../../ptah-cli/helpers/ptah-cli-spawn-options.service';
import { createPromptMailbox } from '../../ptah-cli/helpers/ptah-cli-prompt-mailbox';
import type { ISdkProcessSpawner } from '../../spawn/sdk-process-spawner.port';
import { isReviewerOrTester } from '../lane-spawn-policy';
import { stripAnsiCodes } from './cli-adapter.utils';
import type {
  ClaudeCliAdapterContract,
  ClaudeCliCommandOptions,
  SdkHandle,
  LaneAccountBindingPort,
} from './cli-adapter.interface';

export interface ClaudeCliAdapterDependencies {
  readonly loader: Pick<SdkModuleLoader, 'getQueryFunction' | 'getCliJsPath'>;
  readonly assembly: Pick<PtahCliSpawnOptions, 'assembleSpawnOptions'>;
  readonly runner: Pick<ClaudeSdkLaneRunner, 'run'>;
  readonly permissionHandler: Pick<
    SdkPermissionHandler,
    'getPermissionLevel' | 'createCallback'
  >;
  readonly processSpawner: ISdkProcessSpawner;
  readonly models: Pick<SdkModelService, 'getNativeClaudeModels'>;
  readonly policy: (cwd: string) => Promise<EffectiveCapabilitySet>;
  readonly syncHarness: (policy: EffectiveCapabilitySet) => Promise<void>;
  readonly planLimits: () => ClaudeSdkLaneRunContext['lanePlanLimits'];
  readonly admission: () => ProviderAccountAdmissionPort | null;
  /** Full persistence; the only port that may admit or persist a named lane. */
  readonly accountPersistence?: () => ClaudeLaneAccountPersistence | null;
  /**
   * Read-only binding authority used when full persistence is absent, so an
   * ambient continue of a never-bound session still resumes. It can never
   * admit, validate or persist a named binding.
   */
  readonly accountBindings?: () => LaneAccountBindingPort | null;
  readonly defaults: () => {
    model?: string;
    effort?: string;
    chatEffort?: string;
  };
}

/** Native Claude Agent SDK only. Construction and detection never start a query. */
export class ClaudeCliAdapter implements ClaudeCliAdapterContract {
  readonly name = 'claude' as const;
  readonly displayName = 'Claude';
  readonly roleChannel = 'system-prompt' as const;
  readonly supportsMcp = true;

  constructor(
    private readonly logger: Logger,
    private readonly deps: ClaudeCliAdapterDependencies,
  ) {}

  get accountBindings(): LaneAccountBindingPort | undefined {
    return (
      this.deps.accountPersistence?.() ??
      this.deps.accountBindings?.() ??
      undefined
    );
  }

  capabilities() {
    return { continuation: true, steer: false, interrupt: false };
  }

  async detect(): ReturnType<ClaudeCliAdapterContract['detect']> {
    const base = { cli: this.name, messagingMode: 'queue' as const };
    try {
      const path = await this.deps.loader.getCliJsPath();
      if (!path) return { ...base, installed: false };
      await this.deps.loader.getQueryFunction();
      return { ...base, installed: true, path };
    } catch {
      this.logger.debug(
        '[ClaudeCliAdapter] Claude SDK installation unavailable',
      );
      return { ...base, installed: false };
    }
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  async listModels() {
    try {
      return (await this.deps.models.getNativeClaudeModels()).map((model) => ({
        id: model.value,
        name: model.displayName,
      }));
    } catch {
      // degradation-audit: optional-capability - listing never runs inference;
      // an unreadable native catalog is the specified empty model list.
      this.logger.debug('[ClaudeCliAdapter] Native model catalog unavailable');
      return [];
    }
  }

  async runSdk(input: ClaudeCliCommandOptions): Promise<SdkHandle> {
    const abortController = new AbortController();
    const named = await this.prepareNamed(input, abortController);
    try {
      const executable = await this.deps.loader.getCliJsPath();
      if (!executable) throw new Error('Claude executable is unavailable');
      const queryFn = await this.deps.loader.getQueryFunction();
      if (named)
        await named.bootstrap(
          queryFn,
          buildClaudeLaneBootstrapOptions(
            named.route,
            named.certified,
            new AbortController(),
            this.deps.processSpawner,
          ),
        );
      const defaults = this.deps.defaults();
      const model = input.model || defaults.model || '';
      const effort = await this.resolveEffort(input, model, defaults);
      const policy = await this.deps.policy(input.workingDirectory);
      await this.deps.syncHarness(policy);
      const assembly = await this.deps.assembly.assembleSpawnOptions(
        {},
        input.workingDirectory,
        model || undefined,
        {
          parentSessionId: input.parentSessionId,
          ownSessionId: input.resumeSessionId,
        },
        input.agentId,
        input.role,
        policy,
      );
      const agentIdHolder = { value: input.agentId };
      const options = buildClaudeSdkLaneOptions({
        assembly,
        authEnv: {},
        accountRoute: named?.route,
        launch: named?.certified,
        abortController,
        model,
        effort,
        cwd: input.workingDirectory,
        agentName: input.role?.name ?? this.displayName,
        agentId: input.agentId,
        routingId: `claude:${randomUUID()}`,
        resumeSessionId: input.resumeSessionId,
        parentSessionId: input.parentSessionId,
        cliAgentResolver: () => agentIdHolder.value,
        permissionHandler: this.deps.permissionHandler,
        logger: this.logger,
        processSpawner: this.deps.processSpawner,
        executable,
      });
      // An unresolved native model is the SDK default, never a tier alias.
      if (!model) delete options.model;
      if (named) {
        const now = Date.now();
        await named.launch(
          queryFn,
          options,
          {
            name: input.role?.name ?? this.displayName,
            workspaceId: input.workingDirectory,
            workingDirectory: input.workingDirectory,
            createdAt: now,
            lastActiveAt: now,
            totalCost: 0,
            totalTokens: { input: 0, output: 0 },
            isChildSession: true,
          },
          input.onAccountBinding,
        );
        await named.enqueue(input.task, input.resumeSessionId, true);
      }
      // The named query owns its empty gate. The legacy mailbox remains seeded
      // only for ambient runs, including the configured native registry.
      const mailbox = createPromptMailbox(named ? '' : input.task);
      const outputCallbacks: Array<(data: string) => void> = [];
      const segmentCallbacks: Array<(segment: CliOutputSegment) => void> = [];
      const streamCallbacks: Array<(event: FlatStreamEventUnion) => void> = [];
      const segments: CliOutputSegment[] = [];
      const events: FlatStreamEventUnion[] = [];
      const disposeCallbacks = () => {
        outputCallbacks.length =
          segmentCallbacks.length =
          streamCallbacks.length =
            0;
        segments.length = events.length = 0;
      };
      const lanePlanLimits = this.deps.planLimits();
      try {
        return this.deps.runner.run({
          queryFn,
          named,
          options: { ...options, abortController },
          mailbox,
          providerId: 'claude-cli',
          agentName: input.role?.name ?? this.displayName,
          agentIdHolder,
          lanePlanLimits,
          outputCallbacks,
          onSegment: (callback) => {
            segmentCallbacks.push(callback);
            for (const segment of segments.splice(0)) callback(segment);
          },
          onStreamEvent: (callback) => {
            streamCallbacks.push(callback);
            for (const event of events.splice(0)) callback(event);
          },
          emitOutput: (data) => {
            for (const callback of outputCallbacks) callback(data);
          },
          emitSegment: (segment) => {
            if (segmentCallbacks.length) {
              for (const callback of segmentCallbacks) callback(segment);
            } else {
              segments.push(segment);
            }
          },
          emitStreamEvent: (event) => {
            if (streamCallbacks.length) {
              for (const callback of streamCallbacks) callback(event);
            } else {
              if (events.length >= 5000) events.shift();
              events.push(event);
            }
          },
          disposeCallbacks,
          stopProxy: async () => undefined,
        }).handle;
      } catch (error: unknown) {
        abortController.abort();
        throw error;
      }
    } catch (error: unknown) {
      if (named) {
        await named.dispose();
        const code = claudeLaneRefusalCode(error);
        this.logRefusal('launch', code);
        throw claudeLaneRefusal(code);
      }
      throw error;
    }
  }

  /**
   * Fixed-text refusal diagnostic: the code and a fixed stage word only. No
   * path, account value or CLI text is ever logged here.
   */
  private logRefusal(
    stage: 'request' | 'admission' | 'prepare' | 'timeout' | 'launch',
    code: ProviderAccountPortRefusal['code'],
  ): void {
    this.logger.warn('[ClaudeCliAdapter] Named lane refused', { stage, code });
  }

  private async prepareNamed(
    input: ClaudeCliCommandOptions,
    abort: AbortController,
  ): Promise<ClaudeNamedLaneAdmission | undefined> {
    const request = input.accountAdmission;
    // Bound context must never silently downgrade through a direct caller.
    if (!request) {
      if (
        input.accountBinding !== undefined ||
        input.accountBindingId !== undefined
      )
        throw claudeLaneRefusal();
      return undefined;
    }
    const admission = this.deps.admission();
    if (!admission) {
      this.logRefusal('request', 'unavailable-storage');
      throw claudeLaneRefusal(
        'unavailable-storage',
        'Claude account admission is not available',
      );
    }
    const persistence = this.deps.accountPersistence?.();
    if (!persistence?.available) {
      this.logRefusal('request', 'unavailable-storage');
      throw claudeLaneRefusal('unavailable-storage');
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The admission port's own refusal code wins; otherwise the code the
    // failure carries (`identity-unproved` for any foreign error).
    let refusalCode: ProviderAccountPortRefusal['code'] | undefined;
    // The step a refusal came from, for the diagnostic log only.
    let stage: 'request' | 'admission' | 'prepare' | 'timeout' = 'request';
    const pending = (async () => {
      const lookup = input.resumeSessionId
        ? await persistence.lookupBySdkSession({
            provider: 'claude',
            sdkSessionId: input.resumeSessionId,
          })
        : undefined;
      if (input.resumeSessionId && lookup?.status !== 'bound')
        throw claudeLaneRefusal();
      const stored = lookup?.status === 'bound' ? lookup.binding : undefined;
      if (
        stored &&
        (stored.identity.kind !== 'known' ||
          (
            await persistence.validateResume({
              accountBinding: stored,
              accountBindingId: stored.runId,
            })
          ).code !== 'ok')
      )
        throw claudeLaneRefusal();
      // The stored binding is authoritative on resume. An explicit selection
      // must name the same account; omitted keeps the session's own account
      // (D27). Without a stored binding only an explicit named route is
      // admitted here.
      const selected = request.selection;
      if (
        stored &&
        (selected.kind === 'ambient' ||
          (selected.kind === 'named' && selected.profileId !== stored.profileId))
      )
        throw claudeLaneRefusal('conflict');
      if (!stored && selected.kind !== 'named') throw claudeLaneRefusal();
      if (abort.signal.aborted) throw claudeLaneRefusal();
      stage = 'admission';
      const result = await admission.admitClaudeRoute({
        ...request,
        scope: 'lane',
        ...(stored
          ? {
              runId: stored.runId,
              selection: { kind: 'named', profileId: stored.profileId },
            }
          : {}),
      });
      if (result.code !== 'ok') {
        refusalCode = result.code;
        throw claudeLaneRefusal();
      }
      stage = 'prepare';
      if (result.resources.kind !== 'named') {
        await admission.releaseReservation({
          reservationId: result.reservation.reservationId,
          operationId: result.reservation.operationId,
          authEpoch: result.reservation.authEpoch,
          reason: 'startup-failure',
        });
        throw claudeLaneRefusal();
      }
      const named = new ClaudeNamedLaneAdmission(
        result.resources.route,
        result.resources.launch,
        result.reservation,
        admission,
        persistence,
        abort,
        this.logger,
        stored,
      );
      const route = named.route;
      if (
        abort.signal.aborted ||
        (stored &&
          (stored.provider !== route.provider ||
            stored.profileId !== route.profileId ||
            stored.routeFingerprint !== route.routeFingerprint ||
            stored.routeRevision !== route.routeRevision))
      ) {
        await named.dispose();
        throw claudeLaneRefusal();
      }
      return named;
    })();
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            stage = 'timeout';
            abort.abort();
            reject(claudeLaneRefusal());
          }, 15_000);
        }),
      ]);
    } catch (error: unknown) {
      const code = refusalCode ?? claudeLaneRefusalCode(error);
      this.logRefusal(stage, code);
      throw claudeLaneRefusal(code);
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolveEffort(
    input: ClaudeCliCommandOptions,
    model: string,
    defaults: ReturnType<ClaudeCliAdapterDependencies['defaults']>,
  ): Promise<Options['effort']> {
    const candidates = [input.reasoningEffort];
    if (defaults.effort && defaults.effort !== 'inherit')
      candidates.push(defaults.effort);
    if (defaults.effort === 'inherit') candidates.push(defaults.chatEffort);
    if (isReviewerOrTester(input.role?.name)) candidates.push('medium');
    candidates.push(defaults.chatEffort);
    if (!candidates.some(Boolean)) return undefined;
    try {
      const metadata = model
        ? (await this.deps.models.getNativeClaudeModels()).find(
            (entry) => entry.value === model,
          )
        : undefined;
      if (
        model &&
        (!metadata?.supportsEffort || !metadata.supportedEffortLevels?.length)
      )
        return undefined;
      for (const candidate of candidates) {
        // Installed SDK scale, without Codex's max -> xhigh conversion.
        if (
          (candidate === 'low' ||
            candidate === 'medium' ||
            candidate === 'high' ||
            candidate === 'xhigh' ||
            candidate === 'max') &&
          (!model || metadata?.supportedEffortLevels?.includes(candidate))
        )
          return candidate;
        if (candidate)
          this.logger.info(
            '[ClaudeCliAdapter] Not applied — configured precedence remains in effect',
          );
      }
    } catch {
      this.logger.debug(
        '[ClaudeCliAdapter] Effort metadata unavailable; retaining SDK default',
      );
    }
    return undefined;
  }
}
