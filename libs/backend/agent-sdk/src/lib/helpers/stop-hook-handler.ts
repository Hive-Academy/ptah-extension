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
  isStopHook,
  narrowTerminalReason,
} from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { resolveHookCwd, resolveHookSessionId } from './hook-session-resolver';
import { StopCallbackRegistry } from './stop-callback-registry';
import type { SdkAdapterEvents } from './sdk-adapter-events.service';
import type { SessionTurnStateRegistry } from './session-turn-state.registry';

@injectable()
export class StopHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY)
    private readonly callbackRegistry: StopCallbackRegistry,
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
      Stop: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              try {
                if (!isStopHook(input)) {
                  return { continue: true };
                }
                const resolvedSessionId = resolveHookSessionId(
                  input.session_id,
                  sessionId,
                );
                const resolvedCwd = resolveHookCwd(input.cwd, cwd);
                const backgroundTasks = input.background_tasks ?? [];
                const sessionCrons = input.session_crons ?? [];
                const terminalReason = narrowTerminalReason(input);

                // The guard sits ahead of BOTH fan-outs on purpose. It used to
                // gate only the bus emit, so a Stop with no resolvable id still
                // pushed `sessionId: ''` into every StopCallbackRegistry
                // subscriber (TASK_2026_295).
                if (!resolvedSessionId || !resolvedCwd) {
                  this.logger.warn(
                    '[StopHookHandler] Stop missing sessionId or cwd, skipping fan-out',
                    {
                      hasSessionId: Boolean(resolvedSessionId),
                      hasCwd: Boolean(resolvedCwd),
                      terminalReason,
                      backgroundTaskCount: backgroundTasks.length,
                    },
                  );
                  return { continue: true };
                }

                if (this.callbackRegistry.size > 0) {
                  this.callbackRegistry.notifyAll({
                    sessionId: resolvedSessionId,
                    workspaceRoot: cwd,
                    lastAssistantMessage: input.last_assistant_message ?? null,
                    effortLevel: input.effort?.level ?? null,
                    hasBackgroundWork: backgroundTasks.length > 0,
                    timestamp: Date.now(),
                  });
                }

                // Snapshot only — the phase flips at the stream's `result`
                // (TASK_2026_360 §2.1). Same resolved-id guard as above.
                turnState?.recordStop(resolvedSessionId, {
                  backgroundTasks,
                  sessionCrons,
                  terminalReason,
                });

                if (!sdkAdapterEvents) {
                  return { continue: true };
                }

                sdkAdapterEvents.emitTurnEnded({
                  sessionId: resolvedSessionId,
                  cwd: resolvedCwd,
                  lastAssistantMessage: input.last_assistant_message ?? null,
                  backgroundTasks,
                  sessionCrons,
                  terminalReason,
                  timestamp: Date.now(),
                });
              } catch (error: unknown) {
                this.logger.warn(
                  '[StopHookHandler] hook fan-out threw, swallowing',
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
