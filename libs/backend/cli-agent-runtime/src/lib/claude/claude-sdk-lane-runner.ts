import type { Logger } from '@ptah-extension/vscode-core';
import type {
  Options,
  SdkModuleLoader,
  SdkMessageTransformer,
} from '@ptah-extension/agent-sdk';
import type { SdkHandle } from '../cli-agents/cli-adapters';
import {
  PtahCliStreamLoop,
  type PtahCliStreamLoopConfig,
} from '../ptah-cli/helpers/ptah-cli-stream-loop.service';
import {
  isPlanBilledLaneProvider,
  type PtahCliLanePlanLimits,
} from '../ptah-cli/helpers/ptah-cli-lane-plan-limits';
import type { PromptMailbox } from '../ptah-cli/helpers/ptah-cli-prompt-mailbox';

type LaneQueryFunction = Awaited<
  ReturnType<SdkModuleLoader['getQueryFunction']>
>;
export interface ClaudeSdkLaneRunContext {
  queryFn: LaneQueryFunction;
  options: Options & { abortController: AbortController };
  mailbox: PromptMailbox;
  providerId: string;
  agentName: string;
  agentIdHolder: { value?: string };
  lanePlanLimits: Pick<
    PtahCliLanePlanLimits,
    'attach' | 'onSystemInit' | 'onSignal' | 'end' | 'settled'
  >;
  outputCallbacks: Array<(data: string) => void>;
  onSegment: NonNullable<SdkHandle['onSegment']>;
  onStreamEvent: NonNullable<SdkHandle['onStreamEvent']>;
  emitOutput: PtahCliStreamLoopConfig['emitOutput'];
  emitSegment: PtahCliStreamLoopConfig['emitSegment'];
  emitStreamEvent: PtahCliStreamLoopConfig['emitStreamEvent'];
  disposeCallbacks: () => void;
  stopProxy: () => Promise<void>;
}

/** One native query and stream loop per spawn; no provider/config fabrication. */
export class ClaudeSdkLaneRunner {
  constructor(
    private readonly logger: Logger,
    private readonly messageTransformer: SdkMessageTransformer,
  ) {}

  run(context: ClaudeSdkLaneRunContext): {
    handle: SdkHandle;
    setAgentId: (id: string) => void;
  } {
    const {
      queryFn,
      options,
      mailbox,
      providerId,
      agentName,
      agentIdHolder,
      lanePlanLimits,
      outputCallbacks,
      onSegment,
      onStreamEvent,
      emitOutput,
      emitSegment,
      emitStreamEvent,
      disposeCallbacks,
      stopProxy,
    } = context;
    const abortController = options.abortController;
    const closeMailbox = (): void => mailbox.close();
    abortController.signal.addEventListener('abort', closeMailbox, {
      once: true,
    });
    let sdkQuery: ReturnType<LaneQueryFunction>;
    try {
      sdkQuery = queryFn({ prompt: mailbox.prompt, options });
    } catch (error: unknown) {
      abortController.signal.removeEventListener('abort', closeMailbox);
      mailbox.close();
      disposeCallbacks();
      lanePlanLimits.end();
      throw error;
    }
    let resolvedSessionId: string | null = null;
    const sessionResolvedCallbacks: Array<(sessionId: string) => void> = [];
    const pendingTurns: Array<(exitCode: number) => void> = [];
    const enqueueTurn = (): Promise<number> =>
      new Promise<number>((resolve) => {
        pendingTurns.push(resolve);
      });
    const turn1Done = enqueueTurn();
    const attachAgentId = (agentId: string): void => {
      agentIdHolder.value = agentId;
      lanePlanLimits.attach(agentId);
    };
    const streamLoop = new PtahCliStreamLoop({
      logger: this.logger,
      messageTransformer: this.messageTransformer,
      emitOutput,
      emitSegment,
      emitStreamEvent,
      agentName: agentName,
      onSessionResolved: (sessionId: string) => {
        resolvedSessionId = sessionId;
        // The system init: the lane's own account can be read from here.
        lanePlanLimits.onSystemInit(sdkQuery);
        for (const cb of sessionResolvedCallbacks) {
          cb(sessionId);
        }
      },
      // A turn is released to the manager only once the lane's owner read
      // has settled (bounded at 3 s), so the exit it triggers is classified
      // and persisted with the owner (Batch 11 carry-forward).
      onTurnComplete: (exitCode: number) => {
        const resolve = pendingTurns.shift();
        if (resolve) {
          void lanePlanLimits.settled.then(() => resolve(exitCode));
        }
      },
      onPlanLimitSignal: (signal) => lanePlanLimits.onSignal(signal),
      planBilledSuccess: isPlanBilledLaneProvider(providerId),
    });
    streamLoop
      .run(sdkQuery)
      .catch((error: unknown) => {
        // The loop normally returns 1 on failure. If its error handling itself
        // rejects, pending turns still need that verdict and proxy teardown.
        this.logger.error(
          `[PtahCliRegistry] spawnAgent stream loop error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return 1;
      })
      .then((exitCode) => {
        abortController.signal.removeEventListener('abort', closeMailbox);
        mailbox.close();
        disposeCallbacks();
        void stopProxy();
        sessionResolvedCallbacks.length = 0;
        lanePlanLimits.end();
        void lanePlanLimits.settled.then(() => {
          while (pendingTurns.length > 0) {
            const resolve = pendingTurns.shift();
            resolve?.(exitCode);
          }
        });
      });

    // No `getPid`, deliberately, and it is not an oversight the way it looks.
    // Every other adapter here spawns its own `child_process` and can hand the
    // manager a PID to tree-kill. This path does not spawn anything: `query()`
    // owns the `claude` child, exposes no handle to it anywhere in the SDK's
    // public surface, and reaps it itself when `abortController` fires — which
    // is also what closes the prompt mailbox above and ends the stream loop. So
    // for this handle the abort IS the kill, and `AgentProcessManager.killProcess`
    // waits on `done` rather than tree-killing a PID it cannot be given.
    // Inventing one (e.g. from a process scan) would be guessing at which
    // `claude.exe` on the machine is ours.
    const handle: SdkHandle = {
      providerId: providerId,
      abort: abortController,
      done: turn1Done,
      onOutput: (callback) => {
        outputCallbacks.push(callback);
      },
      onSegment,
      onStreamEvent,
      onSessionResolved: (callback) => {
        sessionResolvedCallbacks.push(callback);
        if (resolvedSessionId) {
          callback(resolvedSessionId);
        }
      },
      supportsContinuation: () => true,
      // Called by the manager as soon as it tracks the run, which is when
      // the lane's owner can be recorded on it.
      setAgentId: attachAgentId,
      continue: (message: string) => {
        const done = enqueueTurn();
        this.logger.info(
          `[PtahCliRegistry] continue() pushing follow-up turn for "${agentName}"`,
          { sessionId: resolvedSessionId, messageLength: message.length },
        );
        mailbox.push(message, resolvedSessionId ?? undefined);
        return Promise.resolve({ done });
      },
    };
    return { handle, setAgentId: attachAgentId };
  }
}
