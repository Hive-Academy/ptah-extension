import { z } from 'zod';
import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { redactCodexDiagnostics } from './codex-stderr-tail';
import {
  CodexHomeMismatchError,
  CodexProcessFailureError,
  CodexRequestRejectedError,
} from './codex-app-server-process';
import { buildCodexThreadConfig } from './codex-mcp-config';
import { CodexResumeProfileChangedError } from './codex-resume-profile-error';
import { CodexPermissionRuleStore } from './codex-permission-rule-store';
import { CodexProtocolError, codexNotificationSchemas } from './codex-protocol-validator';
import { RuntimeContext, type CodexRuntimeOptions } from './codex-context';
import type { IProcessSpawner } from './codex-runtime-ports';
import type {
  CodexContext,
  CodexExecutionProfile,
  CodexMcpSecrets,
  CodexRuntime as RuntimePort,
  CodexThreadIdentity,
} from './codex-runtime.types';

/** Safe, pre-model signal that a lane's thread config was refused. */
export class CodexPreTurnConfigRejectedError extends Error {
  readonly code = 'codexPreTurnConfigRejected';
  readonly retryEligible = true;

  constructor(
    readonly method: 'thread/start' | 'thread/resume',
    readonly rejectedKey: string | undefined = undefined,
  ) {
    super('Codex lane configuration was rejected before a turn started');
    this.name = 'CodexPreTurnConfigRejectedError';
  }
}

/** Extract only a safe config key; never attach stderr to the public error. */
function rejectedConfigKey(stderr: string): string | undefined {
  const key = /\bin `([^`\n]+)`/.exec(stderr)?.[1];
  return key && /^[A-Za-z0-9_.-]{1,128}$/.test(key) ? key : undefined;
}

/** Only a config headline, never an RPC code alone, proves a config refusal. */
function isPreTurnConfigRejection(stderr: string): boolean {
  return /error loading config|failed to load (?:bootstrap )?config(?:uration)?|error parsing -c overrides|invalid override|invalid configuration|unknown (?:config(?:uration)? )?(?:key|field)|failed to (?:parse|deserialize)[^\n]*(?:config|toml)/i.test(stderr);
}

export interface CodexRateLimitsUpdate {
  readonly contextId: string;
  readonly home: string;
  readonly observedAt: number;
}

export interface CodexRuntimeUsageNotifications {
  readonly onRateLimitsUpdated?: (
    update: CodexRateLimitsUpdate,
  ) => void | Promise<void>;
  readonly onContextClosed?: (contextId: string) => void;
  readonly onContextOpened?: (contextId: string) => void;
}

type RuntimeOptions = CodexRuntimeOptions & {
  readonly usage?: CodexRuntimeUsageNotifications | null;
};

const limitsUpdatedEnvelope = z.object({
  method: z.literal('account/rateLimits/updated'),
  params: z.unknown(),
});

/** Mirrors only validated quota frames; the primary process keeps protocol ownership. */
class RateLimitsObserver {
  private child?: SpawnedProcessHandle;
  private buffer = '';
  private active = false;
  private disposed = false;

  readonly spawner: IProcessSpawner;

  constructor(
    private readonly options: RuntimeOptions,
    private readonly profile: CodexExecutionProfile,
  ) {
    this.spawner = {
      spawnProcess: (request) => {
        this.removeListener();
        this.buffer = '';
        const child = options.spawner.spawnProcess(request);
        this.child = child;
        child.stdout?.on('data', this.onData);
        return child;
      },
    };
  }

  activate(): void {
    if (!this.disposed) this.active = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.buffer = '';
    this.removeListener();
    try {
      this.options.usage?.onContextClosed?.(this.profile.contextId);
    } catch (error: unknown) {
      this.options.logger.error('Codex usage context cleanup failed', {
        errorClass: error instanceof Error ? error.constructor.name : typeof error,
      });
    }
  }

  private readonly onData = (chunk: unknown): void => {
    if (!this.active || this.disposed) return;
    this.buffer += String(chunk);
    if (Buffer.byteLength(this.buffer) > 1024 * 1024) {
      this.buffer = '';
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const envelope = limitsUpdatedEnvelope.safeParse(JSON.parse(line));
        if (!envelope.success) continue;
        const parsed = codexNotificationSchemas[
          'account/rateLimits/updated'
        ].safeParse(envelope.data.params);
        if (!parsed.success || !this.active || this.disposed) continue;
        const update = {
          contextId: this.profile.contextId,
          home: this.profile.normalizedHome,
          observedAt: this.options.clock.now(),
        };
        const callback = this.options.usage?.onRateLimitsUpdated;
        if (!callback) continue;
        void Promise.resolve()
          .then(() => {
            if (!this.active || this.disposed) return;
            return callback(update);
          })
          .catch((error: unknown) => {
            this.options.logger.error('Codex usage update failed', {
              errorClass:
                error instanceof Error ? error.constructor.name : typeof error,
            });
          });
      } catch {
        // degradation-audit: optional-capability — The primary protocol parser reports malformed JSON; this observer only mirrors valid updates.
      }
    }
  };

  private removeListener(): void {
    this.child?.stdout?.off('data', this.onData);
    this.child = undefined;
  }
}

/** Host-owned instance; contexts share only the scoped, in-memory permission rules. */
export class CodexRuntime implements RuntimePort {
  private readonly contexts = new Map<string, RuntimeContext>();
  private readonly observers = new Map<string, RateLimitsObserver>();
  private readonly generations = new Map<string, number>();
  private readonly rules = new CodexPermissionRuleStore();
  private closed = false;

  constructor(private readonly options: RuntimeOptions) {}

  async open(
    profile: CodexExecutionProfile,
    resume?: CodexThreadIdentity,
    secrets?: CodexMcpSecrets,
  ): Promise<CodexContext> {
    if (this.closed) throw new Error('Codex runtime is closed');
    if (this.contexts.has(profile.contextId))
      throw new Error('Codex context is already open');
    if (!this.options.sink || typeof this.options.sink.request !== 'function')
      throw new Error('Codex approval presentation is required');
    if (
      resume &&
      (
        [
          'contextId',
          'normalizedHome',
          'providerId',
          'workspaceId',
        ] as const
      ).some((key) => resume[key] !== profile[key])
    )
      throw new Error('Codex resume identity mismatch');
    if (resume && resume.profileFingerprint !== profile.profileFingerprint) {
      const error = new CodexResumeProfileChangedError();
      this.options.logger.error(error.message, { code: error.code });
      throw error;
    }
    // Positive turn and money limits have no App Server enforcement mapping.
    if (
      profile.lane?.maxTurns ||
      profile.lane?.maxBudgetUsd ||
      profile.lane?.explicitFullAccess
    )
      throw new Error(
        'Codex profile requires unsupported runtime configuration',
      );
    // Built before any spawn; an unresolved secret reference refuses the open.
    const mcpConfig = buildCodexThreadConfig(profile, secrets);
    const generation =
      Math.max(
        this.generations.get(profile.contextId) ?? 0,
        resume?.processGeneration ?? 0,
      ) + 1;
    this.generations.set(profile.contextId, generation);
    const observer = this.options.usage?.onRateLimitsUpdated
      ? new RateLimitsObserver(this.options, profile)
      : undefined;
    const context = new RuntimeContext(
      observer ? { ...this.options, spawner: observer.spawner } : this.options,
      this.rules,
      profile,
      generation,
      mcpConfig,
      () => {
        if (this.contexts.get(profile.contextId) === context)
          this.contexts.delete(profile.contextId);
        observer?.dispose();
        this.observers.delete(profile.contextId);
      },
    );
    this.contexts.set(profile.contextId, context);
    if (observer) this.observers.set(profile.contextId, observer);
    try {
      await context.open(resume);
      this.options.usage?.onContextOpened?.(profile.contextId);
      observer?.activate();
      return context;
    } catch (error) {
      await context.close();
      observer?.dispose();
      this.observers.delete(profile.contextId);
      const method =
        error instanceof CodexProcessFailureError ||
        error instanceof CodexRequestRejectedError ||
        error instanceof CodexProtocolError
          ? error.method
          : undefined;
      let root: unknown = error;
      const seen = new Set<unknown>();
      while (
        root instanceof Error &&
        root.cause !== undefined &&
        !seen.has(root)
      ) {
        seen.add(root);
        root = root.cause;
      }
      this.options.logger.error('Codex context could not be opened', {
        errorClass:
          error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: diagnosticMessage(error),
        ...(method ? { failedMethod: redactCodexDiagnostics(method) } : {}),
        ...(error instanceof CodexRequestRejectedError
          ? { rpcCode: error.rpcCode }
          : {}),
        ...(root !== error
          ? {
              rootCauseClass:
                root instanceof Error ? root.constructor.name : typeof root,
              rootCauseMessage: diagnosticMessage(root),
            }
          : {}),
        stderrTail: context.stderrTail(2048),
      });
      if (error instanceof CodexHomeMismatchError) throw error;
      if (
        profile.consumer === 'lane' &&
        (error instanceof CodexRequestRejectedError ||
          error instanceof CodexProcessFailureError) &&
        (error.method === 'thread/start' || error.method === 'thread/resume') &&
        isPreTurnConfigRejection(context.stderrTail(2048))
      ) {
        throw new CodexPreTurnConfigRejectedError(
          error.method, rejectedConfigKey(context.stderrTail(2048)),
        );
      }
      throw new Error('Codex context could not be opened', { cause: error });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...this.contexts.values()].map((context) => context.close()),
    );
    for (const observer of this.observers.values()) observer.dispose();
    this.observers.clear();
    this.rules.dispose();
  }
}

// JSON parser errors may quote a raw protocol frame. Never send that text to logs.
function diagnosticMessage(error: unknown): string {
  if (error instanceof SyntaxError) return 'Invalid JSON';
  return error instanceof Error
    ? redactCodexDiagnostics(error.message)
    : 'Non-Error failure';
}
