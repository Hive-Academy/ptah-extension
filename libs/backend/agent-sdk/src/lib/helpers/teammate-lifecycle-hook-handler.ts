import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import {
  isTaskCreatedHook,
  isTaskCompletedHook,
  isTeammateIdleHook,
} from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import type { SdkAdapterEvents } from './sdk-adapter-events.service';

/**
 * TeammateLifecycleHookHandler — wires the three in-SDK teammate lifecycle
 * hooks (`TaskCreated`, `TaskCompleted`, `TeammateIdle`) that ship in
 * `@anthropic-ai/claude-agent-sdk` 0.3.150 but were previously unwired in Ptah.
 *
 * A "teammate" in this SDK is simply a NAMED Task-tool spawn (`AgentInput.name`)
 * that becomes addressable via `SendMessage({ to: name })` while running. These
 * hooks fire around that lifecycle.
 *
 * Scope (foundation): structured logging of every payload so we can VERIFY at
 * runtime that the hooks actually fire (the SDK types confirm the shapes exist,
 * not that Ptah's runtime delivers them). `TeammateIdle` additionally fans out a
 * typed event on {@link SdkAdapterEvents} so a future UI can surface
 * "agent idle, awaiting steering".
 *
 * IMPORTANT: everything is keyed on `task_id` / `teammate_name`. The SDK's
 * `team_name` field is being deprecated toward a single implicit team, so it is
 * logged only for diagnostics and never used as a key.
 *
 * Follows the same shape as {@link SubagentStopHookHandler}: hooks NEVER throw
 * (that would break the SDK) and always return `{ continue: true }`.
 */
@injectable()
export class TeammateLifecycleHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private readonly sdkAdapterEvents?: SdkAdapterEvents,
  ) {}

  createHooks(
    sessionId: string,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      TaskCreated: [{ hooks: [this.buildTaskCreatedHook(sessionId)] }],
      TaskCompleted: [{ hooks: [this.buildTaskCompletedHook(sessionId)] }],
      TeammateIdle: [{ hooks: [this.buildTeammateIdleHook(sessionId, cwd)] }],
    };
  }

  private buildTaskCreatedHook(sessionId: string) {
    return async (
      input: HookInput,
      _toolUseId: string | undefined,
      _options: { signal: AbortSignal },
    ): Promise<HookJSONOutput> => {
      try {
        if (isTaskCreatedHook(input)) {
          this.logger.info(
            '[TeammateLifecycleHookHandler] >>> TaskCreated HOOK INVOKED <<<',
            {
              sessionId,
              taskId: input.task_id,
              taskSubject: input.task_subject,
              teammateName: input.teammate_name,
              // team_name is deprecated — logged for diagnostics only.
              teamName: input.team_name,
            },
          );
        }
      } catch (error: unknown) {
        this.logger.warn(
          '[TeammateLifecycleHookHandler] TaskCreated hook threw, swallowing',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      return { continue: true };
    };
  }

  private buildTaskCompletedHook(sessionId: string) {
    return async (
      input: HookInput,
      _toolUseId: string | undefined,
      _options: { signal: AbortSignal },
    ): Promise<HookJSONOutput> => {
      try {
        if (isTaskCompletedHook(input)) {
          this.logger.info(
            '[TeammateLifecycleHookHandler] >>> TaskCompleted HOOK INVOKED <<<',
            {
              sessionId,
              taskId: input.task_id,
              taskSubject: input.task_subject,
              teammateName: input.teammate_name,
              teamName: input.team_name,
            },
          );
        }
      } catch (error: unknown) {
        this.logger.warn(
          '[TeammateLifecycleHookHandler] TaskCompleted hook threw, swallowing',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      return { continue: true };
    };
  }

  private buildTeammateIdleHook(sessionId: string, cwd: string) {
    const sdkAdapterEvents = this.sdkAdapterEvents;
    return async (
      input: HookInput,
      _toolUseId: string | undefined,
      _options: { signal: AbortSignal },
    ): Promise<HookJSONOutput> => {
      try {
        if (isTeammateIdleHook(input)) {
          this.logger.info(
            '[TeammateLifecycleHookHandler] >>> TeammateIdle HOOK INVOKED <<<',
            {
              sessionId,
              teammateName: input.teammate_name,
              teamName: input.team_name,
            },
          );

          const resolvedSessionId =
            typeof input.session_id === 'string' && input.session_id.length > 0
              ? input.session_id
              : sessionId;

          if (sdkAdapterEvents && resolvedSessionId && cwd) {
            sdkAdapterEvents.emitTeammateIdle({
              sessionId: resolvedSessionId,
              cwd,
              teammateName: input.teammate_name,
              timestamp: Date.now(),
            });
          }
        }
      } catch (error: unknown) {
        this.logger.warn(
          '[TeammateLifecycleHookHandler] TeammateIdle hook threw, swallowing',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      return { continue: true };
    };
  }
}
