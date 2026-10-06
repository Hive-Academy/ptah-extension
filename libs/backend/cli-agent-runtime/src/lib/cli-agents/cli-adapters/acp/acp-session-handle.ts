/**
 * createAcpSessionHandle — turns one long-lived ACP agent process into an
 * `SdkHandle`. This is the only stateful unit of the ACP layer; everything
 * vendor-specific comes from the {@link AcpVendorProfile}.
 *
 * Lifecycle:
 * - The process is spawned synchronously and the handle returned at once
 *   (Cursor/Pi convention). `done` is the first turn.
 * - The first turn runs the handshake inside it: `connectAcp` → `initialize`
 *   → `session/resume|load|new` → `session/set_config_option` (advertised ids
 *   only) → `session/prompt`. The handshake has a 30 s timeout.
 * - `continue(message)` is a further `session/prompt` on the same session.
 * - There is no `steer` or `interrupt`: an ACP agent queues a mid-turn prompt
 *   instead of injecting it, so the message router's own queue is used.
 * - Abort = `session/cancel` (when a prompt is in flight), then up to
 *   {@link ACP_CANCEL_GRACE_MS} for the agent to answer the prompt or exit,
 *   then kill. The session is never closed, so it stays resumable by id.
 *
 * `done` and every continuation `done` resolve with 0 or 1 and never reject;
 * failures become one `error` segment.
 */
import type {
  InitializeResponse,
  McpServer,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CliOutputSegment } from '@ptah-extension/shared';
import type {
  CliCommandOptions,
  ContinuationOutcome,
  SdkHandle,
} from '../cli-adapter.interface';
import { buildTaskPrompt, createBufferedEmitter } from '../cli-adapter.utils';
import { classifyCliStderr } from '../cli-stderr-severity';
import { decideAcpPermission } from './acp-permission-policy';
import { spawnAcpProcess } from './acp-process-transport';
import type {
  AcpProcessExit,
  AcpTransportFactory,
} from './acp-process-transport';
import { AcpUnavailableError, connectAcp } from './acp-sdk-loader';
import type { AcpClientHandlers, AcpConnectionApi } from './acp-sdk-loader';
import {
  createAcpSessionUpdateMapper,
  mapStopReason,
} from './acp-session-update-mapper';
import { readAcpErrorDetail } from './acp-vendor-profile';
import type {
  AcpRequestFailure,
  AcpRequestMethod,
  AcpSessionConfigEntry,
  AcpVendorProfile,
} from './acp-vendor-profile';

/** `initialize` plus session setup must finish within this, or the turn fails. */
export const ACP_HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * After `session/cancel`, how long the agent gets to stop its tools and answer
 * the prompt (or exit) before the tree-kill.
 */
export const ACP_CANCEL_GRACE_MS = 1_500;

const ACP_PROTOCOL_VERSION = 1;

/** The client identity sent on `initialize` (the ACP client revision, not the Ptah release). */
const ACP_CLIENT_INFO = { name: 'ptah', title: 'Ptah', version: '1' } as const;

/** Distinct unknown extension methods named in an `info`; later ones stay silent. */
const MAX_REPORTED_EXTENSION_METHODS = 32;

/** Title used when a refused permission request carried none. */
const FALLBACK_REFUSED_TITLE = 'a tool call';

export interface AcpSessionHandleConfig {
  readonly profile: AcpVendorProfile;
  readonly options: CliCommandOptions;
  /** The binary to run: the resolved path from detection, or a bare name. */
  readonly command: string;
  /** Creates the child off-thread when present (TASK_2026_367). */
  readonly spawner?: IProcessSpawner;
  /** Defaults to {@link spawnAcpProcess}; specs pass an in-memory transport. */
  readonly transportFactory?: AcpTransportFactory;
  /** Receives the raw failure detail that user-facing segments summarise. */
  readonly logger?: Logger;
}

/** A turn failure whose message is already user-facing. */
class AcpTurnFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpTurnFailure';
  }
}

interface JsonRpcErrorShape {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

const HANDSHAKE_TIMED_OUT = Symbol('acp-handshake-timed-out');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON-RPC error carried by a rejected request, if it is one (SDK `RequestError`). */
function readJsonRpcError(error: unknown): JsonRpcErrorShape | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code, data } = error as Error & { code?: unknown; data?: unknown };
  if (typeof code !== 'number') return undefined;
  return { code, message: error.message, data };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The session's advertised config options, read defensively (agent responses are not validated). */
function readConfigOptions(
  response: unknown,
): readonly Record<string, unknown>[] {
  if (!isRecord(response) || !Array.isArray(response['configOptions'])) {
    return [];
  }
  return response['configOptions'].filter(isRecord);
}

/** The values a select option offers, flattening grouped options. */
function advertisedValuesOf(option: Record<string, unknown>): string[] {
  const entries = Array.isArray(option['options']) ? option['options'] : [];
  return entries.flatMap((entry: unknown): string[] => {
    if (!isRecord(entry)) return [];
    if (typeof entry['value'] === 'string') return [entry['value']];
    if (Array.isArray(entry['options'])) {
      return entry['options'].flatMap((inner: unknown) =>
        isRecord(inner) && typeof inner['value'] === 'string'
          ? [inner['value']]
          : [],
      );
    }
    return [];
  });
}

/** Whether a `session/update` is history replayed by `session/load`. */
function isReplayedUpdate(notification: SessionNotification): boolean {
  const meta: unknown = notification._meta;
  if (isRecord(meta) && meta['isReplay'] === true) return true;
  const update: unknown = notification.update;
  return (
    isRecord(update) &&
    isRecord(update['_meta']) &&
    update['_meta']['isReplay'] === true
  );
}

function describeExit(exit: AcpProcessExit): string {
  if (exit.code !== null) return `code ${exit.code}`;
  if (exit.signal) return `signal ${exit.signal}`;
  return 'code unknown';
}

/**
 * Spawn the profile's agent and return its `SdkHandle` at once. The handshake
 * and the first prompt run inside `done`.
 */
export function createAcpSessionHandle(
  config: AcpSessionHandleConfig,
): SdkHandle {
  const { profile, options, logger } = config;
  const name = profile.displayName;
  const logContext = { vendor: profile.vendor };

  const abort = new AbortController();
  const output = createBufferedEmitter<string>();
  const segment = createBufferedEmitter<CliOutputSegment>();
  const sessionResolved = createBufferedEmitter<string>();
  const mapper = createAcpSessionUpdateMapper({
    extractExitCode: (rawOutput) => profile.extractExitCode?.(rawOutput),
  });

  let connection: AcpConnectionApi | undefined;
  let sessionId: string | undefined;
  /** The id being resumed or loaded, so its updates pass the session filter. */
  let attachingSessionId: string | undefined;
  /** Session set up and config applied: the handle can take further prompts. */
  let setupComplete = false;
  /** The connection closed or the process exited. */
  let closed = false;
  let processExit: AcpProcessExit | undefined;
  let promptInFlight = false;
  /** Title of the first request the policy refused during the current prompt. */
  let refusedThisTurn: string | undefined;
  /** Settles when the current prompt has its answer; never rejects. */
  let promptSettled: Promise<number> | undefined;
  const reportedExtensionMethods = new Set<string>();

  const emitError = (content: string): void => {
    output.emit(`\n[${name}] ${content}\n`);
    segment.emit({ type: 'error', content });
  };
  const emitInfo = (content: string): void => {
    segment.emit({ type: 'info', content });
  };

  const spawnSpec = profile.buildSpawn(options);
  const transport = (config.transportFactory ?? spawnAcpProcess)({
    command: config.command,
    args: spawnSpec.args,
    env: spawnSpec.env,
    cwd: options.workingDirectory,
    spawner: config.spawner,
    logger,
    onStderrLine: (line) => {
      const cleaned = line.trim();
      if (!cleaned) return;
      output.emit(`[stderr] ${cleaned}\n`);
      segment.emit({ type: classifyCliStderr(cleaned), content: cleaned });
    },
  });

  let killRequested = false;
  /** Kill the child once, unless it already exited (an exited pid may be reused). */
  const stopProcess = (): void => {
    if (processExit || killRequested) return;
    killRequested = true;
    transport.kill();
  };

  /**
   * Give a cancelled agent up to {@link ACP_CANCEL_GRACE_MS} to stop its tools
   * and answer the prompt (or exit), then kill. The kill is the backstop for
   * an agent that ignores the cancel; it is skipped once the child exited.
   */
  const stopAfterCancelGrace = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ACP_CANCEL_GRACE_MS);
    });
    try {
      await Promise.race([
        transport.exited,
        promptSettled ?? Promise.resolve(),
        grace,
      ]);
    } catch (error: unknown) {
      logger?.error(
        '[AcpSessionHandle] waiting for the cancelled turn failed',
        {
          ...logContext,
          error: errorText(error),
        },
      );
    } finally {
      clearTimeout(timer);
    }
    stopProcess();
  };

  const onAbort = (): void => {
    const conn = connection;
    const id = sessionId;
    if (promptInFlight && conn && id && !closed) {
      // `cancel` resolves once written, so the grace starts after the agent
      // can see the notification. A failed cancel kills at once.
      void conn
        .cancel({ sessionId: id })
        .then(stopAfterCancelGrace, (error: unknown) => {
          logger?.warn('[AcpSessionHandle] session/cancel could not be sent', {
            ...logContext,
            error: errorText(error),
          });
          stopProcess();
        });
      return;
    }
    stopProcess();
  };
  abort.signal.addEventListener('abort', onAbort, { once: true });

  void transport.exited.then((exit) => {
    // Exit while idle needs no output: no `done` is pending, and the next
    // message gets `unsupported`, so the caller resumes by session id.
    processExit = exit;
    closed = true;
    abort.signal.removeEventListener('abort', onAbort);
    logger?.info('[AcpSessionHandle] agent process ended', {
      ...logContext,
      code: exit.code,
      signal: exit.signal,
      killedByPtah: killRequested,
    });
  });

  const onConnectionClosed = (): void => {
    closed = true;
    // A child without a connection can do no more work for this lane.
    stopProcess();
  };

  const isOwnSession = (id: unknown): boolean => {
    const expected = sessionId ?? attachingSessionId;
    return expected === undefined || id === expected;
  };

  const handlers: AcpClientHandlers = {
    sessionUpdate: async (notification) => {
      if (!isOwnSession(notification.sessionId)) return;
      if (isReplayedUpdate(notification)) return;
      const mapped = mapper.map(notification.update);
      if (mapped.output) output.emit(mapped.output);
      for (const item of mapped.segments) segment.emit(item);
    },
    requestPermission: async (request) => {
      const decision = decideAcpPermission(request, {
        autoApprove: options.autoApprove,
      });
      if (decision.info) emitInfo(decision.info);
      if (decision.refused && promptInFlight && !refusedThisTurn) {
        refusedThisTurn = decision.toolTitle ?? FALLBACK_REFUSED_TITLE;
      }
      return decision.response;
    },
    extNotification: async (method) => {
      if (profile.isExtensionNotification?.(method)) return;
      logger?.debug('[AcpSessionHandle] unsupported extension notification', {
        ...logContext,
        method,
      });
      if (
        reportedExtensionMethods.has(method) ||
        reportedExtensionMethods.size >= MAX_REPORTED_EXTENSION_METHODS
      ) {
        return;
      }
      reportedExtensionMethods.add(method);
      emitInfo(`${name} sent an unsupported notification: ${method}`);
    },
    // No `extMethod`: the SDK answers an unhandled agent request with -32601,
    // which is the explicit rejection unsupported requests need.
  };

  const describeFailure = (failure: AcpRequestFailure): string => {
    const described = profile.describeError?.(failure);
    if (described) return described;
    const detail = readAcpErrorDetail(failure.data);
    return (
      `${name} ${failure.method} failed: ${failure.message}` +
      (detail ? ` (${detail})` : '') +
      ` [code ${failure.code}]`
    );
  };

  /** Run one request; a JSON-RPC error answer becomes an {@link AcpTurnFailure}. */
  const call = async <T>(
    method: AcpRequestMethod,
    run: () => Promise<T>,
    context: Pick<
      AcpRequestFailure,
      'configId' | 'configValue' | 'advertisedValues'
    > = {},
  ): Promise<T> => {
    try {
      return await run();
    } catch (error: unknown) {
      const rpc = readJsonRpcError(error);
      if (!rpc) throw error;
      logger?.warn('[AcpSessionHandle] ACP request failed', {
        ...logContext,
        method,
        code: rpc.code,
        message: rpc.message,
        detail: readAcpErrorDetail(rpc.data),
        ...context,
      });
      throw new AcpTurnFailure(
        describeFailure({ method, ...rpc, ...context, options }),
      );
    }
  };

  /** Re-attach to `resumeId` per the profile's strategy. */
  const attachExistingSession = async (
    conn: AcpConnectionApi,
    init: InitializeResponse,
    resumeId: string,
    mcpServers: readonly McpServer[],
  ): Promise<
    | { ok: true; configOptions: readonly Record<string, unknown>[] }
    | { ok: false; reason: string }
  > => {
    const capabilities = init.agentCapabilities;
    const canResume = !!capabilities?.sessionCapabilities?.resume;
    const canLoad = capabilities?.loadSession === true;
    const strategy = profile.resumeStrategy;
    const attempts: Array<'resume' | 'load'> = [];
    if (
      (strategy === 'resume' || strategy === 'resume-then-load') &&
      canResume
    ) {
      attempts.push('resume');
    }
    if ((strategy === 'load' || strategy === 'resume-then-load') && canLoad) {
      attempts.push('load');
    }
    if (attempts.length === 0) {
      return {
        ok: false,
        reason:
          strategy === 'none'
            ? `${name} sessions are not resumed by Ptah`
            : `${name} does not support resuming a session`,
      };
    }

    const cwd = options.workingDirectory;
    let reason = '';
    attachingSessionId = resumeId;
    try {
      for (const attempt of attempts) {
        try {
          const response =
            attempt === 'resume'
              ? // mcpServers on resume too, or a resumed lane loses Ptah MCP (R7).
                await conn.resumeSession({
                  sessionId: resumeId,
                  cwd,
                  mcpServers: [...mcpServers],
                })
              : await conn.loadSession({
                  sessionId: resumeId,
                  cwd,
                  mcpServers: [...mcpServers],
                });
          return { ok: true, configOptions: readConfigOptions(response) };
        } catch (error: unknown) {
          if (conn.signal.aborted || abort.signal.aborted) throw error;
          const rpc = readJsonRpcError(error);
          const detail = rpc ? readAcpErrorDetail(rpc.data) : undefined;
          reason = `${errorText(error)}${detail ? ` (${detail})` : ''}`;
          logger?.info('[AcpSessionHandle] session re-attach attempt failed', {
            ...logContext,
            attempt,
            code: rpc?.code,
            reason,
          });
        }
      }
    } finally {
      attachingSessionId = undefined;
    }
    return { ok: false, reason };
  };

  /**
   * Apply the profile's config entries that the session advertises (R6).
   * Only the model is binding: a rejected model fails the turn. Any other
   * entry (e.g. the reasoning effort, whose allowed values vary per model) is
   * a hint, skipped with an info when the value is not advertised or when the
   * agent rejects it.
   */
  const applySessionConfig = async (
    conn: AcpConnectionApi,
    id: string,
    advertised: readonly Record<string, unknown>[],
  ): Promise<void> => {
    const entries: readonly AcpSessionConfigEntry[] =
      profile.sessionConfig?.(options) ?? [];
    let current = advertised;
    for (const entry of entries) {
      const binding = entry.configId === 'model';
      const option = current.find((item) => item['id'] === entry.configId);
      if (!option) {
        emitInfo(
          `${name} does not offer the "${entry.configId}" setting, so ${String(entry.value)} was not applied`,
        );
        continue;
      }
      const values = advertisedValuesOf(option);
      if (
        !binding &&
        typeof entry.value === 'string' &&
        values.length > 0 &&
        !values.includes(entry.value)
      ) {
        emitInfo(
          `${name} does not offer ${entry.value} for "${entry.configId}" (available: ${values.join(', ')}), so it was not applied`,
        );
        continue;
      }
      const params =
        typeof entry.value === 'boolean'
          ? {
              sessionId: id,
              configId: entry.configId,
              type: 'boolean' as const,
              value: entry.value,
            }
          : { sessionId: id, configId: entry.configId, value: entry.value };
      try {
        const response = await call(
          'session/set_config_option',
          () => conn.setSessionConfigOption(params),
          {
            configId: entry.configId,
            configValue: entry.value,
            advertisedValues: values,
          },
        );
        // A model change can narrow the other options (e.g. the effort list),
        // so later entries are validated against the updated set.
        const updated = readConfigOptions(response);
        if (updated.length > 0) current = updated;
      } catch (error: unknown) {
        if (binding || !(error instanceof AcpTurnFailure)) throw error;
        emitInfo(
          `${error.message}; continuing without the "${entry.configId}" setting`,
        );
      }
    }
  };

  /** Handshake and session setup. Returns whether the prior context was restored. */
  const setUpSession = async (): Promise<{ restoredContext: boolean }> => {
    const conn = await connectAcp(transport.stream, handlers);
    connection = conn;
    void conn.closed.then(onConnectionClosed);

    const init = await call('initialize', () =>
      conn.initialize({
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { ...ACP_CLIENT_INFO },
      }),
    );
    const version: unknown = isRecord(init) ? init.protocolVersion : undefined;
    if (version !== ACP_PROTOCOL_VERSION) {
      throw new AcpTurnFailure(
        `${name} speaks unsupported ACP protocol version ${String(version)}`,
      );
    }

    const mcpServers = profile.buildMcpServers(options);
    let restoredContext = false;
    let advertised: readonly Record<string, unknown>[] = [];
    let id: string | undefined;

    const resumeId = options.resumeSessionId;
    if (resumeId) {
      const attached = await attachExistingSession(
        conn,
        init,
        resumeId,
        mcpServers,
      );
      if (attached.ok) {
        id = resumeId;
        restoredContext = true;
        advertised = attached.configOptions;
      } else {
        emitInfo(
          `could not resume ${resumeId}: ${attached.reason}; started a new session`,
        );
      }
    }

    if (!id) {
      const meta = profile.sessionMeta?.(options);
      const created: unknown = await call('session/new', () =>
        conn.newSession({
          cwd: options.workingDirectory,
          mcpServers: [...mcpServers],
          ...(meta ? { _meta: meta } : {}),
        }),
      );
      const createdId = isRecord(created) ? created['sessionId'] : undefined;
      if (typeof createdId !== 'string' || !createdId) {
        throw new AcpTurnFailure(`${name} did not return a session id`);
      }
      id = createdId;
      advertised = readConfigOptions(created);
    }

    sessionId = id;
    // Emitted before the config is applied on purpose: a refused config fails
    // the turn, but the session exists and stays resumable by this id.
    sessionResolved.emit(id);
    await applySessionConfig(conn, id, advertised);
    setupComplete = true;
    return { restoredContext };
  };

  /** Race the handshake against {@link ACP_HANDSHAKE_TIMEOUT_MS}; the timer is always cleared. */
  const withHandshakeTimeout = async <T>(
    work: Promise<T>,
  ): Promise<T | typeof HANDSHAKE_TIMED_OUT> => {
    // After a timeout the abandoned handshake rejects once the kill closes the
    // connection. `Promise.race` subscribes to `work` synchronously below, so
    // that late rejection is already handled and never surfaces as unhandled.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof HANDSHAKE_TIMED_OUT>((resolve) => {
      timer = setTimeout(
        () => resolve(HANDSHAKE_TIMED_OUT),
        ACP_HANDSHAKE_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  /** Emit the one `error` segment a failed turn gets. Always 1. */
  const reportFailure = async (error: unknown): Promise<number> => {
    if (abort.signal.aborted) return 1;
    logger?.warn('[AcpSessionHandle] turn failed', {
      ...logContext,
      error: errorText(error),
      exit: processExit,
    });
    if (
      error instanceof AcpTurnFailure ||
      error instanceof AcpUnavailableError
    ) {
      emitError(error.message);
      return 1;
    }
    if (closed || connection?.signal.aborted) {
      // The child reports 'exit' before its stdout closes, so its exit is
      // normally known here; never wait for it.
      const exit =
        processExit ??
        (await Promise.race([transport.exited, Promise.resolve(undefined)]));
      emitError(
        exit
          ? `${name} exited (${describeExit(exit)}) during the turn`
          : `${name} closed the ACP connection during the turn`,
      );
      return 1;
    }
    emitError(`${name} ACP request failed: ${errorText(error)}`);
    return 1;
  };

  const runPrompt = (text: string): Promise<number> => {
    const pending = runPromptTurn(text);
    promptSettled = pending;
    return pending;
  };

  const runPromptTurn = async (text: string): Promise<number> => {
    const conn = connection;
    const id = sessionId;
    if (!conn || !id) {
      emitError(`${name} has no ACP session to prompt`);
      return 1;
    }
    promptInFlight = true;
    refusedThisTurn = undefined;
    try {
      const response: unknown = await call('session/prompt', () =>
        conn.prompt({ sessionId: id, prompt: [{ type: 'text', text }] }),
      );
      const stopReason =
        isRecord(response) && typeof response['stopReason'] === 'string'
          ? response['stopReason']
          : 'missing';
      const mapped = mapStopReason({
        stopReason,
        aborted: abort.signal.aborted,
        refusedPermissionTitle: refusedThisTurn,
        displayName: name,
      });
      if (mapped.segment?.type === 'error') {
        emitError(mapped.segment.content);
      } else if (mapped.segment) {
        segment.emit(mapped.segment);
      }
      return mapped.exitCode;
    } catch (error: unknown) {
      return await reportFailure(error);
    } finally {
      promptInFlight = false;
      refusedThisTurn = undefined;
    }
  };

  const runFirstTurn = async (): Promise<number> => {
    let restoredContext: boolean;
    try {
      const outcome = await withHandshakeTimeout(setUpSession());
      if (outcome === HANDSHAKE_TIMED_OUT) {
        if (!abort.signal.aborted) {
          emitError(
            `${name} did not complete the ACP handshake in ${ACP_HANDSHAKE_TIMEOUT_MS / 1000} s`,
          );
        }
        stopProcess();
        return 1;
      }
      restoredContext = outcome.restoredContext;
    } catch (error: unknown) {
      // A lane whose setup failed can take no prompt (a refused model must
      // not silently fall back to the default one), so the child goes too.
      const code = await reportFailure(error);
      stopProcess();
      return code;
    }
    if (abort.signal.aborted) return 1;
    return runPrompt(
      buildTaskPrompt(
        { ...options, resumeRestoresContext: restoredContext },
        profile.vendor,
      ),
    );
  };

  const supportsContinuation = (): boolean =>
    setupComplete && !!sessionId && !closed && !abort.signal.aborted;

  /** `done` never rejects: an unexpected throw is logged and becomes exit 1. */
  const onUnexpectedTurnError = (error: unknown): number => {
    logger?.error('[AcpSessionHandle] turn threw unexpectedly', {
      ...logContext,
      error: errorText(error),
    });
    return 1;
  };

  const continueTurn = (message: string): Promise<ContinuationOutcome> => {
    if (closed || abort.signal.aborted) {
      return Promise.reject(
        new Error(`${name} is no longer running; resume the session by id`),
      );
    }
    if (!setupComplete || !sessionId) {
      return Promise.reject(new Error(`${name} has no ACP session yet`));
    }
    if (promptInFlight) {
      return Promise.reject(new Error(`${name} is still running a turn`));
    }
    return Promise.resolve({
      done: runPrompt(message).catch(onUnexpectedTurnError),
    });
  };

  const done = runFirstTurn().catch(onUnexpectedTurnError);

  return {
    abort,
    done,
    onOutput: output.subscribe,
    onSegment: segment.subscribe,
    getSessionId: () => sessionId ?? options.resumeSessionId,
    onSessionResolved: sessionResolved.subscribe,
    supportsContinuation,
    continue: continueTurn,
    getPid: () => transport.getPid(),
  };
}
