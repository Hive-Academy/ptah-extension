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
import type { SdkAdapterEvents } from './sdk-adapter-events.service';

/**
 * SubagentStopHookHandler — wires the SDK `SubagentStop` hook into the
 * `SdkAdapterEvents` bus as `subagentEnded`. Producer-side empty-payload
 * guard skips emit on missing sessionId/cwd. The existing
 * `SubagentStopCallbackRegistry` path remains preserved via
 * `SubagentHookHandler` (additive — AC5); this handler only fans the
 * payload onto the bus.
 */
@injectable()
export class SubagentStopHookHandler {
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
