/**
 * `ptah wizard` command — low-level Setup Wizard escape hatch.
 *
 * Backed by `WizardGenerationRpcHandlers` (registered globally via
 * `registerAllRpcHandlers()`):
 *
 *   submit-selection --file <path>   RPC `wizard:submit-selection`
 *                                    fire-and-forget; broadcasts via
 *                                    `setup-wizard:generation-{progress,
 *                                    stream,complete}`. The CLI listens on
 *                                    `ctx.pushAdapter` for the completion
 *                                    event to terminate the command. The
 *                                    event-pipe (B9a) independently forwards
 *                                    progress + stream + completion frames to
 *                                    stdout — there is no double-emit because
 *                                    this command does NOT re-forward them.
 *
 *   cancel <session-id>              RPC `wizard:cancel { saveProgress: true }`
 *                                    Idempotent — handler returns
 *                                    `{ cancelled: false }` if no active
 *                                    session, surfaced as `changed: false` in
 *                                    the `wizard.cancelled` notification.
 *                                    Always exits 0.
 *
 *   retry-item <item-id>             RPC `wizard:retry-item { itemId }`
 *                                    Synchronous (verified at handler
 *                                    `wizard-generation-rpc.handlers.ts:902`
 *                                    — `await orchestrator.generateAgents`).
 *                                    Exits 1 with `ptah_code: generation_
 *                                    failed` on `success: false`.
 *
 *   status                           Reads `setup.lastCompletedPhase` from
 *                                    `WORKSPACE_STATE_STORAGE`. Always exits
 *                                    0; emits `wizard.status` with
 *                                    `last_completed_phase: <name> | null`
 *                                    and the namespace key. The B9d setup
 *                                    orchestrator WILL write this key after
 *                                    each successful phase; today the read
 *                                    returns null when no setup has run.
 *
 * The 10-minute submit-selection timeout matches the backend cap at
 * `wizard-generation-rpc.handlers.ts:583` (`GENERATION_TIMEOUT_MS`).
 */

import { promises as fs } from 'node:fs';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';
import type {
  WizardSubmitSelectionParams,
  WizardSubmitSelectionResponse,
  WizardCancelResponse,
  WizardRetryItemResponse,
  GenerationCompletePayload,
  ProjectAnalysisResult,
} from '@ptah-extension/shared';
import {
  PLATFORM_TOKENS,
  type IStateStorage,
} from '@ptah-extension/platform-core';

/**
 * Storage key — read by `status`, written by the B9d setup orchestrator
 * after each completed phase. Centralized here so both producers and
 * consumers share the same string literal.
 */
export const WIZARD_LAST_COMPLETED_PHASE_KEY = 'setup.lastCompletedPhase';

/** 10-minute cap matching `wizard-generation-rpc.handlers.ts:583`. */
export const SUBMIT_SELECTION_TIMEOUT_MS = 10 * 60 * 1000;

export type WizardSubcommand =
  | 'submit-selection'
  | 'cancel'
  | 'retry-item'
  | 'status';

export interface WizardOptions {
  subcommand: WizardSubcommand;
  /** For `submit-selection` — JSON file with the selection payload. */
  file?: string;
  /** For `cancel` — advisory session id (not currently used by the backend). */
  sessionId?: string;
  /** For `retry-item` — generation item id. */
  itemId?: string;
}

export interface WizardStderrLike {
  write(chunk: string): boolean;
}

export interface WizardExecuteHooks {
  stderr?: WizardStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override hook for tests — defaults to `node:fs/promises.readFile`. */
  readFile?: (path: string) => Promise<string>;
}

interface SubmitSelectionFile {
  selectedAgentIds: string[];
  threshold?: number;
  variableOverrides?: Record<string, string>;
  analysisData?: ProjectAnalysisResult;
  analysisDir?: string;
  model?: string;
}

export async function execute(
  opts: WizardOptions,
  globals: GlobalOptions,
  hooks: WizardExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: WizardStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;
  const readFile = hooks.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  try {
    switch (opts.subcommand) {
      case 'submit-selection':
        return await runSubmitSelection(
          opts,
          globals,
          formatter,
          stderr,
          engine,
          readFile,
        );
      case 'cancel':
        return await runCancel(opts, globals, formatter, stderr, engine);
      case 'retry-item':
        return await runRetryItem(opts, globals, formatter, stderr, engine);
      case 'status':
        return await runStatus(globals, formatter, engine);
      default:
        stderr.write(
          `ptah wizard: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

// ---------------------------------------------------------------------------
// submit-selection — RPC `wizard:submit-selection` (fire-and-forget)
// ---------------------------------------------------------------------------

async function runSubmitSelection(
  opts: WizardOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WizardStderrLike,
  engine: typeof withEngine,
  readFile: (path: string) => Promise<string>,
): Promise<number> {
  if (!opts.file || opts.file.trim().length === 0) {
    stderr.write('ptah wizard submit-selection: --file <path> is required\n');
    return ExitCode.UsageError;
  }

  let raw: string;
  try {
    raw = await readFile(opts.file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(
      `ptah wizard submit-selection: failed to read ${opts.file}: ${message}\n`,
    );
    return ExitCode.UsageError;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(
      `ptah wizard submit-selection: invalid JSON in ${opts.file}: ${message}\n`,
    );
    return ExitCode.UsageError;
  }

  const validated = validateSubmitSelectionFile(parsed);
  if ('error' in validated) {
    stderr.write(`ptah wizard submit-selection: ${validated.error}\n`);
    return ExitCode.UsageError;
  }
  const payload = validated.payload;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    // Build the RPC params — only forward optional fields that were present
    // in the file so the backend gets exactly the user's intent.
    const params: WizardSubmitSelectionParams = {
      selectedAgentIds: payload.selectedAgentIds,
    };
    if (payload.threshold !== undefined) params.threshold = payload.threshold;
    if (payload.variableOverrides !== undefined) {
      params.variableOverrides = payload.variableOverrides;
    }
    if (payload.analysisData !== undefined) {
      params.analysisData = payload.analysisData;
    }
    if (payload.analysisDir !== undefined) {
      params.analysisDir = payload.analysisDir;
    }
    if (payload.model !== undefined) params.model = payload.model;

    // Register the completion listener BEFORE the synchronous RPC accept so
    // we never miss a fast broadcast. The event-pipe (B9a) independently
    // forwards `setup-wizard:generation-*` events to stdout as
    // `wizard.generation.*` notifications — this command does NOT re-emit
    // them; it only consumes the completion event to terminate.
    const completionPromise = waitForCompletion(ctx.pushAdapter);

    const ack = await callRpc<WizardSubmitSelectionResponse>(
      ctx.transport,
      'wizard:submit-selection',
      params,
    );
    if (!ack?.success) {
      // The synchronous accept itself failed (e.g. concurrent generation
      // guard). No completion event will fire — surface immediately.
      await formatter.writeNotification('task.error', {
        ptah_code: 'generation_failed',
        message: ack?.error ?? 'wizard:submit-selection rejected the request',
      });
      return ExitCode.GeneralError;
    }

    // Race the completion event against the 10-minute backend cap.
    const completionPayload = await Promise.race<
      GenerationCompletePayload | { __timeout: true }
    >([
      completionPromise,
      new Promise<{ __timeout: true }>((resolve) =>
        setTimeout(
          () => resolve({ __timeout: true }),
          SUBMIT_SELECTION_TIMEOUT_MS,
        ),
      ),
    ]);

    if ('__timeout' in completionPayload) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'generation_failed',
        message: `wizard:submit-selection did not complete within ${SUBMIT_SELECTION_TIMEOUT_MS / 60_000} minutes`,
      });
      return ExitCode.GeneralError;
    }

    if (!completionPayload.success) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'generation_failed',
        message:
          completionPayload.errors?.[0] ??
          'wizard:submit-selection generation failed',
      });
      return ExitCode.GeneralError;
    }

    return ExitCode.Success;
  });
}

/**
 * Register a one-shot listener for `setup-wizard:generation-complete` and
 * resolve with its payload. Always detaches on settle.
 */
function waitForCompletion(
  adapter: CliWebviewManagerAdapter,
): Promise<GenerationCompletePayload> {
  return new Promise<GenerationCompletePayload>((resolve) => {
    const listener = (payload: unknown): void => {
      adapter.off('setup-wizard:generation-complete', listener);
      resolve(payload as GenerationCompletePayload);
    };
    adapter.once('setup-wizard:generation-complete', listener);
  });
}

// ---------------------------------------------------------------------------
// cancel <session-id> — RPC `wizard:cancel { saveProgress: true }`
// ---------------------------------------------------------------------------

async function runCancel(
  opts: WizardOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WizardStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.sessionId || opts.sessionId.trim().length === 0) {
    stderr.write('ptah wizard cancel: <session-id> is required\n');
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<WizardCancelResponse>(
      ctx.transport,
      'wizard:cancel',
      { saveProgress: true },
    );
    // Idempotent: handler returns `{ cancelled: false }` when there is no
    // active session — surface as `changed: false`. Always exits 0.
    await formatter.writeNotification('wizard.cancelled', {
      sessionId: opts.sessionId,
      changed: result?.cancelled === true,
      backendSessionId: result?.sessionId,
      progressSaved: result?.progressSaved ?? false,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// retry-item <item-id> — RPC `wizard:retry-item` (synchronous)
// ---------------------------------------------------------------------------

async function runRetryItem(
  opts: WizardOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WizardStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.itemId || opts.itemId.trim().length === 0) {
    stderr.write('ptah wizard retry-item: <item-id> is required\n');
    return ExitCode.UsageError;
  }
  const itemId = opts.itemId;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    await formatter.writeNotification('wizard.retry.start', { itemId });

    const result = await callRpc<WizardRetryItemResponse>(
      ctx.transport,
      'wizard:retry-item',
      { itemId },
    );

    if (!result?.success) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'generation_failed',
        message: result?.error ?? `wizard:retry-item failed for ${itemId}`,
      });
      return ExitCode.GeneralError;
    }

    await formatter.writeNotification('wizard.retry.complete', {
      itemId,
      success: true,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// status — read setup.lastCompletedPhase from WORKSPACE_STATE_STORAGE
// ---------------------------------------------------------------------------

async function runStatus(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const lastCompletedPhase =
      storage.get<string>(WIZARD_LAST_COMPLETED_PHASE_KEY) ?? null;
    await formatter.writeNotification('wizard.status', {
      last_completed_phase: lastCompletedPhase,
      namespace_key: WIZARD_LAST_COMPLETED_PHASE_KEY,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

interface ValidatedSubmitSelection {
  payload: SubmitSelectionFile;
}

interface SelectionError {
  error: string;
}

function validateSubmitSelectionFile(
  value: unknown,
): ValidatedSubmitSelection | SelectionError {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'selection file must contain a JSON object' };
  }
  const obj = value as Record<string, unknown>;

  const selectedAgentIdsRaw = obj['selectedAgentIds'];
  if (!Array.isArray(selectedAgentIdsRaw)) {
    return { error: 'selection.selectedAgentIds must be a non-empty string[]' };
  }
  if (
    !selectedAgentIdsRaw.every(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim().length > 0,
    )
  ) {
    return {
      error:
        'selection.selectedAgentIds must contain only non-empty string entries',
    };
  }
  if (selectedAgentIdsRaw.length === 0) {
    return { error: 'selection.selectedAgentIds must not be empty' };
  }

  const payload: SubmitSelectionFile = {
    selectedAgentIds: selectedAgentIdsRaw,
  };

  const threshold = obj['threshold'];
  if (threshold !== undefined) {
    if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
      return {
        error: 'selection.threshold must be a finite number if present',
      };
    }
    payload.threshold = threshold;
  }

  const variableOverrides = obj['variableOverrides'];
  if (variableOverrides !== undefined) {
    if (
      typeof variableOverrides !== 'object' ||
      variableOverrides === null ||
      Array.isArray(variableOverrides)
    ) {
      return {
        error: 'selection.variableOverrides must be a string-keyed object',
      };
    }
    const entries = Object.entries(
      variableOverrides as Record<string, unknown>,
    );
    if (!entries.every(([, v]) => typeof v === 'string')) {
      return {
        error: 'selection.variableOverrides values must all be strings',
      };
    }
    payload.variableOverrides = variableOverrides as Record<string, string>;
  }

  const analysisData = obj['analysisData'];
  if (analysisData !== undefined) {
    if (
      typeof analysisData !== 'object' ||
      analysisData === null ||
      Array.isArray(analysisData)
    ) {
      return { error: 'selection.analysisData must be an object if present' };
    }
    payload.analysisData = analysisData as ProjectAnalysisResult;
  }

  const analysisDir = obj['analysisDir'];
  if (analysisDir !== undefined) {
    if (typeof analysisDir !== 'string' || analysisDir.trim().length === 0) {
      return {
        error: 'selection.analysisDir must be a non-empty string if present',
      };
    }
    payload.analysisDir = analysisDir;
  }

  const model = obj['model'];
  if (model !== undefined) {
    if (typeof model !== 'string' || model.trim().length === 0) {
      return { error: 'selection.model must be a non-empty string if present' };
    }
    payload.model = model;
  }

  return { payload };
}

async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      (err as unknown as { code: string }).code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T) ?? (null as unknown as T);
}
