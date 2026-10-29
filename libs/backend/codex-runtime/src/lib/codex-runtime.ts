import { redactCodexDiagnostics } from './codex-stderr-tail';
import {
  CodexHomeMismatchError,
  CodexProcessFailureError,
  CodexRequestRejectedError,
} from './codex-app-server-process';
import { buildCodexMcpConfigOverrides } from './codex-mcp-config';
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
    // Lane budget/tool enforcement is not present at this boundary; MCP
    // servers are applied natively as config overrides on the thread frame.
    if (
      profile.lane?.suppressedTools.length ||
      profile.lane?.maxTurns ||
      profile.lane?.maxBudgetUsd ||
      profile.lane?.explicitFullAccess
    )
      throw new Error(
        'Codex profile requires unsupported runtime configuration',
      );
    // Built before any spawn; an unresolved secret reference refuses the open.
    const mcpConfig = buildCodexMcpConfigOverrides(profile.mcpServers, secrets);
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
