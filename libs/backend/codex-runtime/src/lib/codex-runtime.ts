import { redactCodexDiagnostics } from './codex-stderr-tail';
import {
  CodexHomeMismatchError,
  CodexProcessFailureError,
  CodexRequestRejectedError,
} from './codex-app-server-process';
import { buildCodexThreadConfig } from './codex-mcp-config';
import { CodexResumeProfileChangedError } from './codex-resume-profile-error';
import { CodexPermissionRuleStore } from './codex-permission-rule-store';
import { CodexProtocolError } from './codex-protocol-validator';
import { RuntimeContext, type CodexRuntimeOptions } from './codex-context';
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

/** Host-owned instance; contexts share only the scoped, in-memory permission rules. */
export class CodexRuntime implements RuntimePort {
  private readonly contexts = new Map<string, RuntimeContext>();
  private readonly generations = new Map<string, number>();
  private readonly rules = new CodexPermissionRuleStore();
  private closed = false;

  constructor(private readonly options: CodexRuntimeOptions) {}

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
    const context = new RuntimeContext(
      this.options,
      this.rules,
      profile,
      generation,
      mcpConfig,
      () => {
        if (this.contexts.get(profile.contextId) === context)
          this.contexts.delete(profile.contextId);
      },
    );
    this.contexts.set(profile.contextId, context);
    try {
      await context.open(resume);
      return context;
    } catch (error) {
      await context.close();
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
