/**
 * Records every MCP tool call the bench makes and classifies its result.
 *
 * Classification follows research-report.md B6: a call is an error when the
 * transport failed, the server answered a JSON-RPC error, the tool flagged its
 * own result as an error, or the tool answered `building`, `unavailable` or an
 * `unknown` coverage. None of those is ever scored as a pass. A result that
 * carries the output-budget trailer (`[reduced: … — full output: …]`, see
 * `tool-output-reducers/.../apply-output-budget.ts`) is truncated, whether the
 * budget cut it or the full text was spooled to a file; the spool path is then
 * checked against the workspace root the call was made for.
 *
 * Retries: a `building` answer is retried after the tool's own `retryAfterMs`
 * hint, capped by the caller's policy. Every attempt is recorded and counted
 * as a call, so calls-per-answer includes the retries.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { CallOutcome } from '../metrics/cost-metrics';
import type { McpToolCaller, ToolCallOutcome } from './mcp-client';

/** Why a call does not count as an answer. */
export type CallErrorClass =
  | 'transport'
  | 'rpc-error'
  | 'tool-error'
  | 'building'
  | 'unavailable'
  | 'unknown-coverage';

/** The output-budget trailer of a truncated or spooled result. */
export interface TruncationInfo {
  /** The trailer says the shown text was cut (`— partial, …`). */
  readonly cut: boolean;
  /** Absolute path of the spool file, when the trailer names one that resolves. */
  readonly spoolPath: string | null;
  /** The locator as the trailer printed it, or the save-failure reason. */
  readonly spoolLocator: string | null;
  /**
   * Whether the spool file lies under the workspace root the call was made
   * for. `null` when nothing was spooled.
   */
  readonly spoolUnderWorkspace: boolean | null;
}

/** The classification of one tool result text. */
export interface ResultClassification {
  readonly errorClass: CallErrorClass | null;
  /** The tool's retry hint, present on `building` answers that carry one. */
  readonly retryAfterMs: number | null;
  readonly truncation: TruncationInfo | null;
}

/** One recorded attempt. Satisfies the metrics' {@link CallOutcome}. */
export interface RecordedCall extends CallOutcome {
  /** 1-based order across the recorder's life. */
  readonly seq: number;
  readonly tool: string;
  /** 1-based attempt within its answer; >1 means a retry. */
  readonly attempt: number;
  readonly startedAt: string;
  readonly wallMs: number;
  readonly errorClass: CallErrorClass | null;
  /** The tool's `retryAfterMs` hint on a `building` answer. */
  readonly retryAfterMs: number | null;
  readonly truncation: TruncationInfo | null;
  /** Result text, or the transport/RPC error detail. */
  readonly text: string;
}

/** All attempts made for one question, ending in the scored one. */
export interface RecordedAnswer {
  readonly tool: string;
  readonly attempts: readonly RecordedCall[];
  readonly final: RecordedCall;
}

export interface RetryPolicy {
  /** Retries after the first attempt (the claim's budget). */
  readonly maxRetries: number;
  /** Cap on one wait, whatever the tool's hint says. */
  readonly maxDelayMs: number;
  /** Wait when a `building` answer carries no hint. */
  readonly defaultDelayMs: number;
}

export const NO_RETRY: RetryPolicy = {
  maxRetries: 0,
  maxDelayMs: 0,
  defaultDelayMs: 0,
};

export interface CallRecorderOptions {
  /** The workspace root the calls are attributed to (spool-path check). */
  readonly workspaceRoot: string;
  /** Injected for tests. Defaults to a timer. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface CallSummary {
  readonly calls: number;
  readonly answers: number;
  readonly errored: number;
  readonly truncated: number;
  readonly errorsByClass: Readonly<Record<CallErrorClass, number>>;
}

const TRAILER = /\[reduced: ([^\]\n]*)\]\s*$/;
const FULL_OUTPUT = / — full output(?: could not be saved)?: (.*)$/;
const RELATIVE_LOCATOR =
  /^(.+?) under the (workspace root|system temp directory)$/;
const BUILDING = /"status"\s*:\s*"building"/;
const RETRY_AFTER = /"retryAfterMs"\s*:\s*(\d+)/;
const UNAVAILABLE = /"status"\s*:\s*"unavailable"|\bindex unavailable\b/i;
const UNKNOWN_CENSUS = /"census"\s*:\s*"unknown"/;
const UNKNOWN_REASON = /"reasons"\s*:\s*\[[^\]]*\?"/;
const REASONS_START = /"reasons"\s*:\s*\[/g;
/** A whole reasons array: only JSON strings and commas up to its `]`. */
const REASONS_ARRAY =
  /"reasons"\s*:\s*\[(\s*(?:"(?:\\.|[^"\\\n])*"\s*(?:,\s*"(?:\\.|[^"\\\n])*"\s*)*)?)\]/g;
const JSON_STRING = /"(?:\\.|[^"\\\n])*"/g;

/**
 * Classify one tool result. Regex over the text rather than `JSON.parse`,
 * because a budget-cut body is no longer valid JSON while its leading status
 * fields (which the dispatcher writes first for that reason) survive. Unknown
 * coverage means an unknown census or a `?` reason other than `unrecognised?`:
 * the code index cannot find symbols in files with unrecognised extensions.
 * If a cut body starts a reasons array that cannot be isolated,
 * classification stays conservatively unknown.
 */
export function classifyToolResult(
  text: string,
  isError: boolean,
  workspaceRoot: string,
): ResultClassification {
  const truncation = readTruncation(text, workspaceRoot);
  const retryHint = RETRY_AFTER.exec(text);
  const errorClass: CallErrorClass | null = isError
    ? 'tool-error'
    : BUILDING.test(text)
      ? 'building'
      : UNAVAILABLE.test(text)
        ? 'unavailable'
        : UNKNOWN_CENSUS.test(text) || hasUnknownReason(text)
          ? 'unknown-coverage'
          : null;
  return {
    errorClass,
    retryAfterMs:
      errorClass === 'building' && retryHint ? Number(retryHint[1]) : null,
    truncation,
  };
}

function hasUnknownReason(text: string): boolean {
  const starts = [...text.matchAll(REASONS_START)];
  if (starts.length === 0) return UNKNOWN_REASON.test(text);
  const arrays = [...text.matchAll(REASONS_ARRAY)];
  // A budget-cut or malformed array must remain unknown, even if a previous
  // complete array was clean.
  if (arrays.length !== starts.length) return true;
  return arrays.some((array) => {
    const values = [...array[1].matchAll(JSON_STRING)];
    const reasons = values.map((value) => {
      try {
        return JSON.parse(value[0]);
      } catch {
        return null;
      }
    });
    return (
      reasons.some(
        (reason) =>
          typeof reason !== 'string' ||
          (reason.endsWith('?') && reason !== 'unrecognised?'),
      ) ||
      (reasons.length >= 3 && reasons.includes('unrecognised?'))
    );
  });
}

function readTruncation(
  text: string,
  workspaceRoot: string,
): TruncationInfo | null {
  const trailer = TRAILER.exec(text);
  if (!trailer) return null;
  const body = trailer[1];
  const cut = body.includes('— partial');
  const output = FULL_OUTPUT.exec(body);
  if (!output) {
    return {
      cut,
      spoolPath: null,
      spoolLocator: null,
      spoolUnderWorkspace: null,
    };
  }
  const locator = output[1].trim();
  if (body.includes('full output could not be saved')) {
    return {
      cut,
      spoolPath: null,
      spoolLocator: locator,
      spoolUnderWorkspace: null,
    };
  }
  const spoolPath = resolveSpoolPath(locator, workspaceRoot);
  return {
    cut,
    spoolPath,
    spoolLocator: locator,
    spoolUnderWorkspace:
      spoolPath === null ? false : isWithin(spoolPath, workspaceRoot),
  };
}

/**
 * The absolute spool path. An absolute locator is taken as printed. A relative
 * one under "the workspace root" names no root, so it resolves only when the
 * file exists under OUR root; otherwise the server spooled elsewhere and the
 * answer is `null`. One under "the system temp directory" is never ours.
 */
function resolveSpoolPath(
  locator: string,
  workspaceRoot: string,
): string | null {
  if (isAbsolute(locator)) return resolve(locator);
  const relativeLocator = RELATIVE_LOCATOR.exec(locator);
  if (!relativeLocator || relativeLocator[2] !== 'workspace root') return null;
  const candidate = join(workspaceRoot, relativeLocator[1]);
  return existsSync(candidate) ? candidate : null;
}

function isWithin(path: string, root: string): boolean {
  const fold = (value: string): string =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  const rel = relative(fold(resolve(root)), fold(resolve(path)));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export class CallRecorder {
  private readonly recorded: RecordedCall[] = [];
  private answerCount = 0;
  private readonly workspaceRoot: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly caller: McpToolCaller,
    options: CallRecorderOptions,
  ) {
    this.workspaceRoot = options.workspaceRoot;
    this.sleep =
      options.sleep ??
      ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  }

  /** Every attempt so far, in call order. */
  get calls(): readonly RecordedCall[] {
    return this.recorded;
  }

  /**
   * Ask one question: call `tool`, retrying `building` answers under
   * `policy`. The final attempt is the scored one; a final `building` is an
   * error like any other.
   */
  async answer(
    tool: string,
    args: Record<string, unknown>,
    policy: RetryPolicy = NO_RETRY,
  ): Promise<RecordedAnswer> {
    this.answerCount++;
    const attempts: RecordedCall[] = [];
    for (let attempt = 1; ; attempt++) {
      const call = await this.attempt(tool, args, attempt);
      attempts.push(call);
      const retriesLeft = attempt - 1 < policy.maxRetries;
      if (call.errorClass !== 'building' || !retriesLeft) {
        return { tool, attempts, final: call };
      }
      await this.sleep(
        Math.min(call.retryAfterMs ?? policy.defaultDelayMs, policy.maxDelayMs),
      );
    }
  }

  summary(): CallSummary {
    const errorsByClass: Record<CallErrorClass, number> = {
      transport: 0,
      'rpc-error': 0,
      'tool-error': 0,
      building: 0,
      unavailable: 0,
      'unknown-coverage': 0,
    };
    for (const call of this.recorded) {
      if (call.errorClass !== null) errorsByClass[call.errorClass]++;
    }
    return {
      calls: this.recorded.length,
      answers: this.answerCount,
      errored: this.recorded.filter((call) => call.errored).length,
      truncated: this.recorded.filter((call) => call.truncated).length,
      errorsByClass,
    };
  }

  private async attempt(
    tool: string,
    args: Record<string, unknown>,
    attempt: number,
  ): Promise<RecordedCall> {
    const startedAt = new Date().toISOString();
    const outcome = await this.caller.callTool(tool, args);
    const call = this.toRecord(tool, attempt, startedAt, outcome);
    this.recorded.push(call);
    return call;
  }

  private toRecord(
    tool: string,
    attempt: number,
    startedAt: string,
    outcome: ToolCallOutcome,
  ): RecordedCall {
    const base = { seq: this.recorded.length + 1, tool, attempt, startedAt };
    if (outcome.kind === 'transport-error' || outcome.kind === 'rpc-error') {
      return {
        ...base,
        wallMs: outcome.wallMs,
        errorClass:
          outcome.kind === 'transport-error' ? 'transport' : 'rpc-error',
        retryAfterMs: null,
        errored: true,
        truncated: false,
        truncation: null,
        text:
          outcome.kind === 'transport-error'
            ? `${outcome.code}: ${outcome.detail}`
            : `${outcome.code}: ${outcome.message}`,
      };
    }
    const classified = classifyToolResult(
      outcome.text,
      outcome.isError,
      this.workspaceRoot,
    );
    return {
      ...base,
      wallMs: outcome.wallMs,
      errorClass: classified.errorClass,
      retryAfterMs: classified.retryAfterMs,
      errored: classified.errorClass !== null,
      truncated: classified.truncation !== null,
      truncation: classified.truncation,
      text: outcome.text,
    };
  }
}
