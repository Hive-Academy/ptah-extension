import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isSubagentStopHook } from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { resolveHookCwd, resolveHookSessionId } from './hook-session-resolver';
import type { SdkAdapterEvents } from './sdk-adapter-events.service';
import type { SessionTurnStateRegistry } from './session-turn-state.registry';

/**
 * SubagentStopHookHandler — wires the SDK `SubagentStop` hook into the
 * `SdkAdapterEvents` bus as `subagentEnded` and applies the remaining
 * background-task list to `SessionTurnStateRegistry` (TASK_2026_360).
 * Producer-side empty-payload guard skips both on missing sessionId/cwd. The
 * existing `SubagentStopCallbackRegistry` path remains preserved via
 * `SubagentHookHandler` (additive — AC5).
 */
@injectable()
export class SubagentStopHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private readonly sdkAdapterEvents?: SdkAdapterEvents,
    @inject(SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY)
    private readonly turnState?: SessionTurnStateRegistry,
  ) {}

  createHooks(
    sessionId: string | undefined,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const sdkAdapterEvents = this.sdkAdapterEvents;
    const turnState = this.turnState;
    return {
      SubagentStop: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              try {
                if (!isSubagentStopHook(input)) {
                  return { continue: true };
                }
                if (!sdkAdapterEvents && !turnState) {
                  return { continue: true };
                }
                const resolvedSessionId = resolveHookSessionId(
                  input.session_id,
                  sessionId,
                );
                const resolvedCwd = resolveHookCwd(input.cwd, cwd);

                if (!resolvedSessionId || !resolvedCwd) {
                  this.logger.warn(
                    '[SubagentStopHookHandler] SubagentStop missing sessionId or cwd, skipping bus emit',
                    {
                      hasSessionId: Boolean(resolvedSessionId),
                      hasCwd: Boolean(resolvedCwd),
                      agentId: input.agent_id,
                      agentType: input.agent_type,
                    },
                  );
                  return { continue: true };
                }

                // Keeps the registry current for `session:status`; the
                // in-stream `task_notification` path emits the event
                // (TASK_2026_360 §2.2). Never touches 'generating'.
                turnState?.applySnapshot(
                  resolvedSessionId,
                  input.background_tasks ?? [],
                );

                if (!sdkAdapterEvents) {
                  return { continue: true };
                }

                sdkAdapterEvents.emitSubagentEnded({
                  sessionId: resolvedSessionId,
                  cwd: resolvedCwd,
                  agentId: input.agent_id,
                  agentType: input.agent_type,
                  lastAssistantMessage: input.last_assistant_message ?? null,
                  backgroundTasks: input.background_tasks ?? [],
                  timestamp: Date.now(),
                });
              } catch (error: unknown) {
                this.logger.warn(
                  '[SubagentStopHookHandler] hook fan-out threw, swallowing',
                  {
                    error:
                      error instanceof Error ? error.message : String(error),
                    sessionId,
                  },
                );
              }
              return { continue: true };
            },
          ],
        },
      ],
    };
  }
}
