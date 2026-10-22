import { randomUUID } from 'node:crypto';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  EffectiveCapabilitySet,
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import type { ProviderAccountAdmissionPort } from '@ptah-extension/auth-providers-tokens';
import type {
  Options,
  SdkModuleLoader,
  SdkModelService,
  SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import { buildClaudeSdkLaneOptions } from '../../claude/claude-sdk-lane-options';
import type {
  ClaudeSdkLaneRunner,
  ClaudeSdkLaneRunContext,
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
      this.logger.debug('[ClaudeCliAdapter] Native model catalog unavailable');
      return [];
    }
  }

  async runSdk(input: ClaudeCliCommandOptions): Promise<SdkHandle> {
    // Admission alone cannot release a prompt: Batches 17/20 must also wire
    // the durable binding and own-query identity gate. Do not acquire a lease
    // until those operations can complete and release it on every exit path.
    if (input.accountAdmission) {
      const admission = this.deps.admission();
      throw new Error(
        admission
          ? 'Claude account admission prompt gate is not available'
          : 'Claude account admission is not available',
      );
    }
    const executable = await this.deps.loader.getCliJsPath();
    if (!executable) throw new Error('Claude executable is unavailable');
    const queryFn = await this.deps.loader.getQueryFunction();
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
    const abortController = new AbortController();
    const agentIdHolder = { value: input.agentId };
    const options = buildClaudeSdkLaneOptions({
      assembly,
      authEnv: {},
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
    const mailbox = createPromptMailbox(input.task);
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
      mailbox.close();
      disposeCallbacks();
      lanePlanLimits.end();
      throw error;
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
