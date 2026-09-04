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
  isStopFailureHook,
  narrowTerminalReason,
} from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { resolveHookCwd, resolveHookSessionId } from './hook-session-resolver';
import type { SdkAdapterEvents } from './sdk-adapter-events.service';
import type { SessionTurnStateRegistry } from './session-turn-state.registry';

/**
 * StopFailureHookHandler — wires the SDK `StopFailure` hook into the
 * SdkAdapterEvents bus as `turnFailed` and records the failure snapshot on
 * `SessionTurnStateRegistry` (TASK_2026_360). Producer-side empty-payload
 * guard skips both when resolved sessionId or cwd is empty.
 */
@injectable()
export class StopFailureHookHandler {
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
      StopFailure: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              try {
                if (!isStopFailureHook(input)) {
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
                const terminalReason = narrowTerminalReason(input);

                if (!resolvedSessionId || !resolvedCwd) {
                  this.logger.warn(
                    '[StopFailureHookHandler] StopFailure missing sessionId or cwd, skipping bus emit',
                    {
                      hasSessionId: Boolean(resolvedSessionId),
                      hasCwd: Boolean(resolvedCwd),
                      errorCode: input.error ?? 'unknown',
                    },
                  );
                  return { continue: true };
                }

                // Snapshot only — the phase flips to 'failed' at the stream's
                // `result` (TASK_2026_360 §2.1).
                turnState?.recordFailure(resolvedSessionId, {
                  error: input.error,
                  terminalReason,
                });

                if (!sdkAdapterEvents) {
                  return { continue: true };
                }

                sdkAdapterEvents.emitTurnFailed({
                  sessionId: resolvedSessionId,
                  cwd: resolvedCwd,
                  lastAssistantMessage: input.last_assistant_message ?? null,
                  error: input.error,
                  errorDetails: input.error_details ?? null,
                  terminalReason,
                  timestamp: Date.now(),
                });
              } catch (error: unknown) {
                this.logger.warn(
                  '[StopFailureHookHandler] hook fan-out threw, swallowing',
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
