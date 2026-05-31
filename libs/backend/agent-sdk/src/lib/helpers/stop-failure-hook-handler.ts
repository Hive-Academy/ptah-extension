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
import type { SdkAdapterEvents } from './sdk-adapter-events.service';

/**
 * StopFailureHookHandler — wires the SDK `StopFailure` hook into the
 * SdkAdapterEvents bus as `turnFailed`. Producer-side empty-payload guard
 * skips emit when resolved sessionId or cwd is empty.
 */
@injectable()
export class StopFailureHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private readonly sdkAdapterEvents?: SdkAdapterEvents,
  ) {}

  createHooks(
    sessionId: string,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const sdkAdapterEvents = this.sdkAdapterEvents;
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
                if (!sdkAdapterEvents) {
                  return { continue: true };
                }
                const resolvedSessionId =
                  typeof input.session_id === 'string' &&
                  input.session_id.length > 0
                    ? input.session_id
                    : sessionId;
                const resolvedCwd =
                  typeof input.cwd === 'string' && input.cwd.length > 0
                    ? input.cwd
                    : cwd;
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
