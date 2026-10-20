/**
 * Antigravity headless CLI usage adapter.
 *
 * Runs `agy -p /usage` (argument array, no shell: a shell on Windows/MSYS
 * rewrites `/usage` into a path) and maps its tab-separated output to plan
 * windows. Each line is `<group>\t<label>\t<remaining %>\t<ISO-8601 UTC reset>`.
 * The percentage is the REMAINING share, so `usedPercent = 100 - value`.
 *
 * Fails closed: one malformed line rejects the whole output
 * (`cli-parse-failed`); unknown text is never read as 0 % used.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  windowKindFromDuration,
  type PlanLimitStatusReason,
  type PlanLimitWindow,
} from '@ptah-extension/shared';

export const ANTIGRAVITY_CLI_TIMEOUT_MS = 10_000;
export const ANTIGRAVITY_CLI_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_LINES = 64;
const MAX_FIELD_LENGTH = 96;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PERCENT = /^(\d{1,3}(?:\.\d+)?)%$/;

export type AntigravityCliFailureReason = Extract<
  PlanLimitStatusReason,
  | 'cli-unavailable'
  | 'cli-not-found'
  | 'cli-timeout'
  | 'cli-not-signed-in'
  | 'cli-exit-error'
  | 'cli-parse-failed'
>;

export type AntigravityCliResult =
  | { readonly ok: true; readonly windows: readonly PlanLimitWindow[] }
  | {
      readonly ok: false;
      readonly reason: AntigravityCliFailureReason;
    };

/** Runs one executable with an argument array; rejects on any failure. */
export type AntigravityCliExec = (
  executable: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<string>;

export interface AntigravityCliOptions {
  readonly exec?: AntigravityCliExec;
  /** Candidate executables, in order. Defaults to PATH then the install dir. */
  readonly executables?: readonly string[];
  readonly now?: () => number;
}

/** `agy` on PATH first, then `%LOCALAPPDATA%/agy/bin/agy(.exe)` on Windows. */
export function antigravityCliCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): readonly string[] {
  const candidates = ['agy'];
  const localAppData = env['LOCALAPPDATA']?.trim();
  if (platform === 'win32' && localAppData) {
    const installed = join(localAppData, 'agy', 'bin', 'agy.exe');
    if (exists(installed)) candidates.push(installed);
  }
  return candidates;
}

export async function readAntigravityCliUsage(
  signal: AbortSignal | undefined,
  options: AntigravityCliOptions = {},
): Promise<AntigravityCliResult> {
  if (signal?.aborted) return { ok: false, reason: 'cli-unavailable' };
  const exec = options.exec ?? defaultExec;
  const now = options.now ?? Date.now;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, ANTIGRAVITY_CLI_TIMEOUT_MS);
  try {
    let firstFailure: AntigravityCliFailureReason | undefined;
    for (const executable of options.executables ??
      antigravityCliCandidates()) {
      let stdout: string;
      try {
        stdout = await exec(executable, ['-p', '/usage'], controller.signal);
      } catch (error: unknown) {
        const reason = classifyCliFailure(error, signal?.aborted === true);
        // The time budget is shared by all candidates, so a timeout ends the search.
        if (reason === 'cli-timeout') return { ok: false, reason };
        // Any other candidate failure (missing binary, a PATH .cmd shim that execFile
        // cannot run without a shell) is not a verdict: try the next candidate.
        if (reason !== 'cli-not-found') firstFailure ??= reason;
        continue;
      }
      const windows = parseAntigravityCliUsage(stdout, now());
      return windows
        ? { ok: true, windows }
        : { ok: false, reason: 'cli-parse-failed' };
    }
    return { ok: false, reason: firstFailure ?? 'cli-not-found' };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** `undefined` when any line is malformed or no line is present. */
export function parseAntigravityCliUsage(
  stdout: string,
  observedAt: number,
): PlanLimitWindow[] | undefined {
  if (Buffer.byteLength(stdout, 'utf8') > ANTIGRAVITY_CLI_MAX_OUTPUT_BYTES) {
    return undefined;
  }
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0 || lines.length > MAX_LINES) return undefined;
  const windows: PlanLimitWindow[] = [];
  const keys = new Set<string>();
  for (const line of lines) {
    const window = parseLine(line, observedAt);
    if (!window || keys.has(window.key)) return undefined;
    keys.add(window.key);
    windows.push(window);
  }
  return windows;
}

function parseLine(
  line: string,
  observedAt: number,
): PlanLimitWindow | undefined {
  const fields = line.split('\t').map((field) => field.trim());
  if (fields.length !== 4) return undefined;
  const [group, label, remainingText, resetText] = fields;
  if (
    !group ||
    !label ||
    group.length > MAX_FIELD_LENGTH ||
    label.length > MAX_FIELD_LENGTH
  ) {
    return undefined;
  }
  const match = PERCENT.exec(remainingText);
  if (!match || !ISO_UTC.test(resetText)) return undefined;
  const remaining = Number(match[1]);
  const resetsAt = Date.parse(resetText);
  if (!(remaining >= 0 && remaining <= 100) || !Number.isFinite(resetsAt)) {
    return undefined;
  }
  const durationMins = /five\s*hour/i.test(label)
    ? 300
    : /weekly/i.test(label)
      ? 10_080
      : undefined;
  const descriptor = windowKindFromDuration(durationMins, 0);
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const suffix = durationMins ? descriptor.kind : slug(label);
  return {
    key: `other:cli-${slug(group)}-${suffix}`,
    kind: descriptor.kind,
    label: `${durationMins ? descriptor.label : label} · ${group}`,
    modelScope: group,
    ...(durationMins && { durationMins }),
    used: {
      kind: 'percent',
      percent: Math.round((100 - remaining) * 10) / 10,
    },
    usedSource: 'provider-unofficial',
    usedObservedAt: observedAt,
    resetsAt,
    resetSource: 'provider-unofficial',
    observedAt,
  };
}

/** Only an explicit sign-in phrase makes a failed run "not signed in". */
const SIGN_IN_HINT =
  /(?:not\s+(?:signed|logged)\s*(?:in|into\s+Antigravity)|\b(?:sign\s*in|log\s*in|login)\b|not\s+authenticated)/i;

/**
 * Maps a failed gy run to a typed reason. Failure output is only ever
 * searched for the sign-in phrase; it is never parsed as usage.
 */
function classifyCliFailure(
  error: unknown,
  callerAborted: boolean,
): AntigravityCliFailureReason {
  if (!(error instanceof Error)) return 'cli-unavailable';
  const failure = error as NodeJS.ErrnoException & {
    killed?: boolean;
    stdout?: unknown;
    stderr?: unknown;
  };
  if (failure.code === 'ENOENT') return 'cli-not-found';
  if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return 'cli-parse-failed';
  }
  if (callerAborted) return 'cli-unavailable';
  if (
    failure.killed === true ||
    failure.code === 'ETIMEDOUT' ||
    failure.code === 'ABORT_ERR' ||
    failure.name === 'AbortError'
  ) {
    return 'cli-timeout';
  }
  if (typeof failure.code === 'number') {
    const output = [failure.stdout, failure.stderr]
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
      .slice(0, ANTIGRAVITY_CLI_MAX_OUTPUT_BYTES);
    return SIGN_IN_HINT.test(output) ? 'cli-not-signed-in' : 'cli-exit-error';
  }
  return 'cli-unavailable';
}
function defaultExec(
  executable: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        signal,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
        maxBuffer: ANTIGRAVITY_CLI_MAX_OUTPUT_BYTES,
        timeout: ANTIGRAVITY_CLI_TIMEOUT_MS,
      },
      (error, stdout, stderr) =>
        error
          ? reject(Object.assign(error, { stdout, stderr }))
          : resolve(stdout),
    );
  });
}
