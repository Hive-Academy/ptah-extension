import {
  buildCodexExecutionProfile,
  CodexPreTurnConfigRejectedError,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexExecutionProfileInput,
  type CodexRuntimeEvent,
  type CodexThreadIdentity,
  type CodexTurnReceipt,
} from '@ptah-extension/codex-runtime';
import type { CliDetectionResult, CliOutputSegment } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  type AgentMessagingCapabilities,
  type CliAdapter,
  type CliCommandOptions,
  type CliModelInfo,
  type ContinuationOutcome,
  type SdkHandle,
} from '../cli-adapter.interface';
import { bestMessagingCapability } from '../cli-adapter.interface';
import {
  buildTaskPrompt,
  createBufferedEmitter,
  fullPromptPreambles,
  PTAH_LANE_POLICY,
  renderRoleBlock,
  stripAnsiCodes,
} from '../cli-adapter.utils';
import {
  buildCodexLaneProfileSettings,
  type CodexLaneProfileInput,
} from './codex-lane-profile';
import { CODEX_RESUME_RESENDS_ROLE } from './codex-lane-config.builder';
import { CodexLaneEvents } from './codex-lane-events';
import { readCodexUserMcpServerNames } from './codex-user-mcp-servers';
import { withCodexLaneStartupTimeout } from './codex-app-server-lane-startup';
import { readCodexLaneCatalog } from './codex-app-server-lane-catalog';
import { handledRequirements, identitySchema } from './codex-app-server-lane-profile';
import {
  configRejectedNotice,
  essentialLaneSession,
  terminalModelAdvice,
  validatedEffort,
} from './codex-app-server-lane-rejection';
import {
  NativeCodexLaneBinaryProbe,
  type CodexLaneBinaryProbe,
} from './codex-app-server-lane-binary';
import {
  FileCodexLaneCredentialProbe,
  type CodexLaneCredentialProbe,
} from './codex-app-server-lane-auth';
import {
  CODEX_LANE_DEFAULT_MODEL,
  CODEX_LANE_FALLBACK_MODELS,
  codexLaneModels,
  markCodexLaneDefault,
} from './codex-app-server-lane-models';

export class CodexLaneResumeIdentityError extends Error {
  constructor() {
    super('Codex lane resume requires a matching full thread identity.');
    this.name = 'CodexLaneResumeIdentityError';
  }
}

/** Host composition owns the approval scope and pinned App Server runtime. */
export interface CodexLaneRuntimeProvider {
  open(
    profile: CodexExecutionProfile,
    resume: CodexThreadIdentity | undefined,
    approvals: ApprovalSink,
    binaryPath: string,
  ): Promise<CodexContext>;
  /** A separate lane context for catalog reads; its owner closes it after listing. */
  openCatalog(binaryPath: string, home?: string): Promise<CodexContext>;
}

/** Host resolves account, paths, budgets and trusted user MCP names. */
export interface CodexLaneProfileResolver {
  resolve(
    options: CliCommandOptions,
    variant: 'first-turn' | 'resume',
  ): Promise<{
    readonly lane: CodexLaneProfileInput;
    readonly paths: CodexExecutionProfileInput['paths'];
  }>;
}

/** Lookup is by CLI thread id; persistence precedes the named prompt. */
export interface CodexLaneIdentityStore {
  readByThreadId(threadId: string): Promise<CodexThreadIdentity | undefined>;
  persist(identity: CodexThreadIdentity): Promise<void>;
}

interface ActiveTurn {
  readonly receipt: CodexTurnReceipt;
  readonly mapper: CodexLaneEvents;
  readonly resolve: (exitCode: number) => void;
  readonly reject: (error: Error) => void;
}

/** Native lane consumer. The legacy SDK adapter remains a separate selectable adapter. */
export class CodexAppServerLaneAdapter implements CliAdapter {
  readonly name = 'codex' as const;
  readonly displayName = 'Codex CLI';
  readonly roleChannel = 'developer-instructions' as const;
  readonly supportsMcp = true;

  constructor(
    private readonly runtime: CodexLaneRuntimeProvider,
    private readonly profiles: CodexLaneProfileResolver,
    private readonly identities: CodexLaneIdentityStore,
    private readonly logger: Logger,
    private readonly binary: CodexLaneBinaryProbe = new NativeCodexLaneBinaryProbe(),
    private readonly credentials: CodexLaneCredentialProbe = new FileCodexLaneCredentialProbe(),
    private readonly home: () => Promise<string | undefined> = async () => undefined,
  ) {}

  private catalogProbe: {
    readonly binaryPath: string;
    readonly at: number;
    readonly output: Promise<CliModelInfo[]>;
  } | undefined;

  capabilities(): AgentMessagingCapabilities { return { steer: false, interrupt: false, continuation: true }; }

  async detect(): Promise<CliDetectionResult> {
    const messagingMode = bestMessagingCapability(this.capabilities());
    try {
      const binary = await this.binary.resolve();
      if (!binary) return { cli: 'codex', installed: false, messagingMode };
      await this.ensureTokensFresh();
      return { cli: 'codex', installed: true, path: binary.path,
        version: binary.version, messagingMode };
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Codex home is empty') {
        this.logger.warn('[CodexAppServerLaneAdapter] Codex home is empty');
        return { cli: 'codex', installed: false, messagingMode };
      }
      this.logger.warn('[CodexAppServerLaneAdapter] Codex detection failed', {
        errorClass: error instanceof Error ? error.constructor.name : typeof error,
      });
      return { cli: 'codex', installed: false, messagingMode };
    }
  }

  async ensureTokensFresh(): Promise<boolean> {
    const status = await this.credentials.check(await this.home());
    if (status === 'stale' || status === 'unreadable')
      this.logger.warn('[CodexAppServerLaneAdapter] Codex credentials are not usable', { status });
    return status === 'fresh';
  }

  async listModels(): Promise<CliModelInfo[]> {
    let probe = this.catalogProbe;
    try {
      if (!probe || Date.now() - probe.at >= 30_000) {
        const binary = await this.binary.resolve();
        if (!binary) throw new Error('Pinned Codex executable is unavailable');
        const output = (async (): Promise<CliModelInfo[]> => {
          const home = await this.home();
          const models = codexLaneModels(await readCodexLaneCatalog(
            () => this.runtime.openCatalog(binary.path, home), this.logger,
          ));
          if (models.length === 0) throw new Error('Codex model catalog is empty');
          return models;
        })();
        probe = { binaryPath: binary.path, at: Date.now(), output };
        this.catalogProbe = probe;
      }
      return await probe.output;
    } catch (error: unknown) {
      if (probe && this.catalogProbe === probe) this.catalogProbe = undefined;
      this.logger.warn('[CodexAppServerLaneAdapter] Codex model catalog failed; using curated fallback', {
        errorClass: error instanceof Error ? error.constructor.name : typeof error,
      });
      return CODEX_LANE_FALLBACK_MODELS.map(markCodexLaneDefault);
    }
  }

  parseOutput(raw: string): string { return stripAnsiCodes(raw).replace(/\r(?!\n)/g, ''); }

  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const binary = await this.binary.resolve(options.binaryPath);
    if (!binary) throw new Error('Pinned Codex executable is unavailable');
    const resolved = await this.profiles.resolve(
      options,
      options.resumeSessionId ? 'resume' : 'first-turn',
    );
    const userServers = await readCodexUserMcpServerNames(resolved.lane.config.workingDirectory, {
      codexHome: resolved.lane.identity.normalizedHome,
    });
    if (userServers.warnings.length > 0) this.logger.warn(
      '[CodexAppServerLaneAdapter] Some user MCP servers could not be classified',
      { warningCount: userServers.warnings.length },
    );
    const requestedEffort = options.reasoningEffort ?? resolved.lane.config.reasoningEffort;
    const reasoningEffort = validatedEffort(requestedEffort);
    const defaultModelApplied = !options.model && !resolved.lane.identity.model;
    const selectedModel = options.model || resolved.lane.identity.model || CODEX_LANE_DEFAULT_MODEL;
    const projected = buildCodexLaneProfileSettings({
      ...resolved.lane,
      identity: {
        ...resolved.lane.identity,
        model: selectedModel,
      },
      config: {
        ...resolved.lane.config,
        userMcpServerNames: [...resolved.lane.config.userMcpServerNames, ...userServers.names],
        reasoningEffort,
          workingDirectory: resolved.lane.config.workingDirectory,
        mcpPort: options.mcpPort,
        agentId: options.agentId,
        developerInstructions: [
          options.role ? renderRoleBlock(options.role, this.name) : undefined,
          PTAH_LANE_POLICY,
        ].filter((part): part is string => part !== undefined).join('\n\n'),
      },
    });
    projected.assertAllRequirementsHandled(handledRequirements);
    let profile = buildCodexExecutionProfile({
      session: projected.settings,
      paths: resolved.paths,
    });
    if (profile.consumer !== 'lane')
      throw new Error('Codex lane profile selected another consumer');
    const resume = await this.resumeIdentity(options.resumeSessionId, profile);
    const output = createBufferedEmitter<string>();
    const segments = createBufferedEmitter<CliOutputSegment>();
    const abort = new AbortController();
    let eventAbort = new AbortController();
    let context: CodexContext | undefined;
    const closePromises = new WeakMap<CodexContext, Promise<void>>();
    let active: ActiveTurn | undefined;
    // True from runTurn until startTurn settles, so a second turn cannot race the first.
    let starting = false;
    let closed = false;
    let sessionId = resume?.threadId;
    let roleDelivery: 'developer-instructions' | 'task-prompt' = 'developer-instructions';
    const pending: CodexRuntimeEvent[] = [];
    const emit = (segment: CliOutputSegment): void => {
      segments.emit(segment);
      if (segment.content) output.emit(this.parseOutput(segment.content));
    };
    const approvals: ApprovalSink = {
      request: async (request) => {
        const name = request.toolName && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(request.toolName)
          ? ` ${request.toolName}` : '';
        emit({ type: 'info', content: `Codex approval declined: ${request.kind}${name}\n` });
        return 'decline';
      },
    };
    for (const warning of projected.warnings) {
      this.logger.warn('[CodexAppServerLaneAdapter] Lane config warning', { warning });
      emit({ type: 'info', content: warning });
    }
    if (requestedEffort !== undefined && reasoningEffort === undefined) {
      const warning = 'Ignored invalid Codex reasoning effort; expected low, medium, high or xhigh.';
      this.logger.warn('[CodexAppServerLaneAdapter] Lane config warning', { warning });
      emit({ type: 'info', content: warning });
    }
    const configRejection = createBufferedEmitter<void>();
    const closeContext = (opened: CodexContext): Promise<void> => {
      let closing = closePromises.get(opened);
      if (!closing) {
        closing = Promise.resolve().then(() => opened.close());
        closePromises.set(opened, closing);
      }
      return closing;
    };
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      abort.abort();
      eventAbort.abort();
      active?.resolve(1);
      active = undefined;
      if (context) {
        try {
          await closeContext(context);
        } catch {
          this.logger.error('[CodexAppServerLaneAdapter] Context close failed',
            new Error('Codex lane context close failed'));
          emit({ type: 'error', content: 'Codex lane context close failed.' });
        }
      }
    };
    abort.signal.addEventListener('abort', () => { void close(); }, { once: true });
    const openContext = async (identity: CodexThreadIdentity | undefined): Promise<CodexContext> => {
      const opening = this.runtime.open(profile, identity, approvals, binary.path);
      void opening.then((late): void => {
        if (abort.signal.aborted) {
          void closeContext(late).catch(() => {
            this.logger.error('[CodexAppServerLaneAdapter] Late context close failed',
              new Error('Codex lane late context close failed'));
          });
        }
      }, () => undefined);
      context = await withCodexLaneStartupTimeout(opening, abort);
      if (abort.signal.aborted) {
        await closeContext(context);
        throw new Error('Codex lane aborted during startup');
      }
      const openedIdentity = identitySchema.safeParse(context.identity);
      if (!openedIdentity.success ||
        openedIdentity.data.contextId !== profile.contextId ||
        openedIdentity.data.normalizedHome !== profile.normalizedHome ||
        openedIdentity.data.workspaceId !== profile.workspaceId ||
        openedIdentity.data.providerId !== profile.providerId ||
        openedIdentity.data.profileFingerprint !== profile.profileFingerprint ||
        (identity && openedIdentity.data.threadId !== identity.threadId))
        throw new CodexLaneResumeIdentityError();
      sessionId = context.identity.threadId;
      await this.identities.persist(context.identity);
      if (options.accountBinding !== undefined || options.accountBindingId !== undefined) {
        if (!options.accountBinding || !options.accountBindingId || !options.onAccountBinding)
          throw new Error('Codex lane account binding is incomplete');
        await options.onAccountBinding({
          accountBinding: options.accountBinding,
          accountBindingId: options.accountBindingId,
        }, sessionId);
      }
      return context;
    };
    const retryConfig = async (error: CodexPreTurnConfigRejectedError): Promise<CodexContext> => {
      const notice = configRejectedNotice(projected.settings, error.rejectedKey);
      emit({ type: 'info', content: notice });
      configRejection.emit(undefined);
      this.logger.warn('[CodexAppServerLaneAdapter] Codex rejected lane config; retrying essential settings', {
        method: error.method,
      });
      const previous = context;
      context = undefined;
      eventAbort.abort();
      if (previous) await closeContext(previous);
      eventAbort = new AbortController();
      pending.length = 0;
      profile = buildCodexExecutionProfile({
        session: essentialLaneSession(projected.settings, error.rejectedKey),
        paths: resolved.paths,
      });
      return openContext(previous?.identity ?? resume);
    };
    try {
      await openContext(resume);
    } catch (error: unknown) {
      if (error instanceof CodexPreTurnConfigRejectedError) {
        try {
          await retryConfig(error);
        } catch (retryError: unknown) {
          emit({ type: 'error', content: 'Codex rejected the essential lane configuration.' });
          await close();
          throw new Error('Codex rejected the essential lane configuration.', { cause: retryError });
        }
      } else {
        await close();
        throw error;
      }
    }
    if (!context) throw new Error('Codex lane context did not open');
    const opened: CodexContext = context;
    const processEvent = (event: CodexRuntimeEvent): void => {
      if (event.type === 'approvalRequested' || event.type === 'approvalSettled') return;
      if (!active) { pending.push(event); return; }
      const modelMessage = event.type === 'terminal' && event.status === 'failed' && event.error
        ? terminalModelAdvice(`${event.error.code}: ${event.error.message}`, {
          ...options, model: selectedModel,
          modelSource: defaultModelApplied ? 'ptah-default' : options.modelSource,
        })
        : undefined;
      const modelError = modelMessage ? new Error(modelMessage) : undefined;
      if (modelError) {
        emit({ type: 'error', content: modelError.message });
        const turn = active;
        active = undefined;
        turn.reject(modelError);
        void close();
        return;
      }
      const mapped = active.mapper.map(event);
      for (const segment of mapped.segments) emit(segment);
      if (mapped.terminal) {
        const turn = active;
        active = undefined;
        turn.resolve(mapped.terminal === 'completed' ? 0 : 1);
        if (mapped.terminal !== 'completed') void close();
      }
    };
    const pump = async (source: CodexContext, signal: AbortSignal): Promise<void> => {
      try {
        for await (const event of source.events(signal)) {
          if (closed || source !== context) return;
          processEvent(event);
        }
        if (!closed && source === context) throw new Error('Codex lane event stream ended');
      } catch (error: unknown) {
        // degradation-audit: optional-capability - a closed or replaced context's stream error is moot; the live context reports its own
        if (closed || source !== context) return;
        emit({ type: 'error', content: 'Codex lane event stream failed.' });
        active?.reject(error instanceof Error ? error : new Error('Codex event stream failed'));
        active = undefined;
        await close();
      }
    };
    void pump(opened, eventAbort.signal);
    const runTurn = (text: string, onStarted?: () => void): Promise<number> => {
      if (closed) return Promise.reject(new Error('Codex lane is closed'));
      if (active || starting) return Promise.reject(new Error('Codex lane turn is already active'));
      starting = true;
      return new Promise<number>((resolve, reject) => {
        const start = async (): Promise<void> => {
          try {
            const receipt = await withCodexLaneStartupTimeout(
              opened.startTurn({ text, signal: abort.signal }), abort,
            );
            // Cleared in the same synchronous step that registers the turn.
            starting = false;
            if (closed) { resolve(1); return; }
            active = {
              receipt,
              mapper: new CodexLaneEvents({
                contextId: opened.identity.contextId,
                processGeneration: opened.identity.processGeneration,
                threadId: receipt.threadId,
                turnId: receipt.turnId,
              }),
              resolve,
              reject,
            };
            onStarted?.();
            for (const event of pending.splice(0)) processEvent(event);
          } catch (error: unknown) {
            starting = false;
            emit({ type: 'error', content: 'Codex lane turn failed to start.' });
            await close();
            reject(error instanceof Error ? error : new Error('Codex lane turn failed'));
          }
        };
        void start();
      });
    };
    const prompt = buildTaskPrompt({
      ...options,
      role: undefined,
      lanePolicyDelivery: 'developer-instructions',
      resumeRestoresContext: true,
    }, this.name);
    const done = runTurn(prompt);
    const delivered = fullPromptPreambles({ ...options, lanePolicyDelivery: 'developer-instructions' });
    return {
      abort,
      done,
      providerId: profile.providerId,
      ...(options.accountBinding ? { accountBinding: options.accountBinding } : {}),
      ...(options.accountBindingId ? { accountBindingId: options.accountBindingId } : {}),
      getSessionId: () => sessionId,
      getLanePolicyDelivery: () => 'developer-instructions',
      getRoleDelivery: () => roleDelivery,
      onOutput: output.subscribe,
      onSegment: segments.subscribe,
      onLaneConfigRejected: configRejection.subscribe,
      supportsContinuation: () => !closed,
      continue: (message: string): Promise<ContinuationOutcome> => {
        if (closed) return Promise.reject(new Error('Codex lane is closed'));
        if (active || starting) return Promise.reject(new Error('Codex lane turn is already active'));
        const role = CODEX_RESUME_RESENDS_ROLE && options.role
          ? `${renderRoleBlock(options.role, this.name)}\n\n` : '';
        const nextPrompt = buildTaskPrompt({
          ...options,
          task: message,
          files: undefined,
          role: undefined,
          resumeSessionId: sessionId,
          lanePolicyDelivery: 'developer-instructions',
          resumeRestoresContext: true,
          resumeDeliveredPreambles: delivered,
        }, this.name);
        return Promise.resolve({
          done: runTurn(role + nextPrompt, () => {
            if (role) roleDelivery = 'task-prompt';
          }),
        });
      },
    };
  }

  private async resumeIdentity(
    threadId: string | undefined,
    profile: CodexExecutionProfile,
  ): Promise<CodexThreadIdentity | undefined> {
    if (!threadId) return undefined;
    const parsed = identitySchema.safeParse(await this.identities.readByThreadId(threadId));
    if (!parsed.success) throw new CodexLaneResumeIdentityError();
    const identity = parsed.data;
    if (identity.threadId !== threadId || identity.contextId !== profile.contextId ||
      identity.normalizedHome !== profile.normalizedHome ||
      identity.workspaceId !== profile.workspaceId ||
      identity.providerId !== profile.providerId ||
      identity.profileFingerprint !== profile.profileFingerprint)
      throw new CodexLaneResumeIdentityError();
    return identity;
  }

}
