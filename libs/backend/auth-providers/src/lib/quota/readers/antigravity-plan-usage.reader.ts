/**
 * Conservative reader for the provisional local Antigravity LS endpoint.
 *
 * - One deadline ({@link ANTIGRAVITY_USAGE_TIMEOUT_MS}) covers process
 *   discovery and the local request together, and the caller's signal ends
 *   either step at once.
 * - The server is the process whose executable (first argv element) is an
 *   Antigravity language server. Several different (port, token) pairs are
 *   ambiguous and answer `service-unavailable` rather than pick one.
 * - The payload does not say a window's period, so each model's window is
 *   labelled by position (`windowKindFromDuration` with no duration), never
 *   asserted to be weekly.
 */
import { execFile } from 'node:child_process';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, Agent } from 'node:https';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  windowKindFromDuration,
  type PlanLimitWindow,
} from '@ptah-extension/shared';
import {
  ANTIGRAVITY_CSRF_ARGUMENT,
  ANTIGRAVITY_CSRF_HEADER,
  ANTIGRAVITY_PORT_ARGUMENT,
  ANTIGRAVITY_POSIX_PROCESS_ARGS,
  ANTIGRAVITY_PROCESS_MARKER,
  ANTIGRAVITY_PRODUCT_MARKER,
  ANTIGRAVITY_STATUS_PATH,
  ANTIGRAVITY_WINDOWS_PROCESS_ARGS,
} from './antigravity-ls.provisional';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

/** Deadline for discovery plus the local request, together. */
export const ANTIGRAVITY_USAGE_TIMEOUT_MS = 3_000;
/** Upper bound on the local status body. */
export const ANTIGRAVITY_MAX_BODY_BYTES = 1_048_576;
/** Upper bound on a remote-supplied model name in a window key and label. */
export const ANTIGRAVITY_MAX_MODEL_LENGTH = 64;

const StatusSchema = z.object({
  models: z.record(
    z.string(),
    z.object({
      remainingFraction: z.number().min(0).max(1),
      resetTime: z.string().nullable().optional(),
    }),
  ),
});
type StatusRequest = (
  port: number,
  csrfToken: string,
  signal: AbortSignal,
) => Promise<unknown>;

/** Local command seam: no agent-sdk barrel dependency is needed here. */
type ProbeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<string>;

interface ServerCandidate {
  readonly port: number;
  readonly csrfToken: string;
}

export function createAntigravityPlanUsageReader(
  logger: Logger,
  now: () => number = Date.now,
  run: ProbeCommandRunner = defaultRun,
  requestStatus: StatusRequest = defaultRequest,
): PlanUsageReader {
  return async ({ signal }) => {
    if (signal?.aborted) return unavailable();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, ANTIGRAVITY_USAGE_TIMEOUT_MS);
    try {
      const command = process.platform === 'win32' ? 'powershell.exe' : 'ps';
      const args =
        process.platform === 'win32'
          ? ANTIGRAVITY_WINDOWS_PROCESS_ARGS
          : ANTIGRAVITY_POSIX_PROCESS_ARGS;
      const candidate = findServer(
        await untilAborted(
          run(command, args, controller.signal),
          controller.signal,
        ),
      );
      if (!candidate) return unavailable();
      const parsed = StatusSchema.safeParse(
        await untilAborted(
          requestStatus(candidate.port, candidate.csrfToken, controller.signal),
          controller.signal,
        ),
      );
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        logger.warn('[PlanUsage] provisional usage response rejected', {
          providerId: 'antigravity',
          fieldPath: issue?.path.map(String).join('.') ?? '',
          reason: issue?.code ?? 'invalid',
        });
        return unavailable();
      }
      const observedAt = now();
      const windows = Object.entries(parsed.data.models).map(
        ([model, value], index) =>
          toWindow(model, value, observedAt, index + 1),
      );
      return windows.length
        ? {
            status: 'available',
            fetchedAt: observedAt,
            windowSetEstablished: true,
            windows,
          }
        : unavailable();
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}

/** `work`, or a rejection as soon as `signal` aborts, whichever comes first. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * The one Antigravity language server in the process list. Each line is
 * `<pid> <command line>`; only the executable token is matched against the
 * markers, so a process that merely mentions them in its arguments is never
 * taken. Several different (port, token) pairs answer `null` (ambiguous).
 */
function findServer(stdout: string): ServerCandidate | null {
  const found = new Map<string, ServerCandidate>();
  for (const line of stdout.split(/\r?\n/)) {
    const { executable, rest } = splitExecutable(
      line.replace(/^\s*\d+\s+/, ''),
    );
    if (!isAntigravityServer(executable)) continue;
    const candidate = serverArguments(rest);
    if (candidate) {
      found.set(`${candidate.port}\0${candidate.csrfToken}`, candidate);
    }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

/** The first argv element (quoted or not) and the arguments after it. */
function splitExecutable(commandLine: string): {
  executable: string;
  rest: string;
} {
  const trimmed = commandLine.trimStart();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end < 0
      ? { executable: trimmed.slice(1), rest: '' }
      : { executable: trimmed.slice(1, end), rest: trimmed.slice(end + 1) };
  }
  const end = trimmed.search(/\s/);
  return end < 0
    ? { executable: trimmed, rest: '' }
    : { executable: trimmed.slice(0, end), rest: trimmed.slice(end) };
}

function isAntigravityServer(executable: string): boolean {
  const path = executable.toLowerCase();
  const basename = path.split(/[\\/]/).pop() ?? '';
  return (
    basename.includes(ANTIGRAVITY_PROCESS_MARKER) &&
    path.includes(ANTIGRAVITY_PRODUCT_MARKER)
  );
}

function serverArguments(args: string): ServerCandidate | null {
  const token = new RegExp(
    `(?:^|\\s)${ANTIGRAVITY_CSRF_ARGUMENT}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`,
  ).exec(args);
  const csrfToken = token?.[1] ?? token?.[2] ?? token?.[3];
  const port = Number(
    new RegExp(
      `(?:^|\\s)${ANTIGRAVITY_PORT_ARGUMENT}(?:=|\\s+)["']?(\\d+)["']?(?=\\s|$)`,
    ).exec(args)?.[1],
  );
  return csrfToken && Number.isInteger(port) && port > 0 && port < 65536
    ? { port, csrfToken }
    : null;
}

function toWindow(
  model: string,
  value: { remainingFraction: number; resetTime?: string | null },
  observedAt: number,
  position: number,
): PlanLimitWindow {
  const name = model.slice(0, ANTIGRAVITY_MAX_MODEL_LENGTH);
  // The payload states no period: a positional, neutral descriptor.
  const descriptor = windowKindFromDuration(undefined, position);
  const reset = value.resetTime ? Date.parse(value.resetTime) : Number.NaN;
  return {
    key: `other:model-${name}`,
    kind: descriptor.kind,
    label: `${descriptor.label} · ${name}`,
    modelScope: name,
    used: {
      kind: 'percent',
      percent: Math.round((1 - value.remainingFraction) * 1000) / 10,
    },
    usedSource: 'provider-unofficial',
    usedObservedAt: observedAt,
    ...(Number.isFinite(reset) && {
      resetsAt: reset,
      resetSource: 'provider-unofficial',
    }),
    observedAt,
  };
}

function unavailable(): PlanUsageReading {
  return {
    status: 'service-unavailable',
    windowSetEstablished: false,
    windows: [],
  };
}

const execFileAsync = promisify(execFile);
const LOOPBACK_AGENT = new Agent({
  keepAlive: false,
  rejectUnauthorized: false,
});
function defaultRun(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  return execFileAsync(command, [...args], {
    signal,
    windowsHide: true,
  }).then(({ stdout }) => stdout);
}

function defaultRequest(
  port: number,
  csrfToken: string,
  signal: AbortSignal,
): Promise<unknown> {
  return readJsonResponse((onResponse) =>
    httpsRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: ANTIGRAVITY_STATUS_PATH,
        method: 'POST',
        headers: { [ANTIGRAVITY_CSRF_HEADER]: csrfToken },
        agent: LOOPBACK_AGENT,
        signal,
      },
      onResponse,
    ),
  );
}

/**
 * Send the request `open` creates and parse a 2xx JSON body of at most
 * `maxBytes`. Settles exactly once: on the body's end, or on any error, a
 * non-2xx status, an oversized body, or the request or response closing
 * first (a mid-body stall ended by an abort lands here). Exported for the
 * loopback spec; the transport is the caller's.
 */
export function readJsonResponse(
  open: (onResponse: (response: IncomingMessage) => void) => ClientRequest,
  maxBytes: number = ANTIGRAVITY_MAX_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responded = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      // Called only from listeners, after `request` is assigned.
      request.destroy();
      reject(error);
    };
    const request = open((response) => {
      responded = true;
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        fail(new Error(`status ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          fail(new Error('response body too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error: unknown) {
          reject(error);
        }
      });
      response.on('error', fail);
      response.on('close', () => fail(new Error('response closed early')));
    });
    request.on('error', fail);
    request.on('close', () => {
      if (!responded) fail(new Error('request closed early'));
    });
    request.end();
  });
}
