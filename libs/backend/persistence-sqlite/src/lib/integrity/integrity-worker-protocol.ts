/**
 * Typed message protocol shared by the integrity worker entry
 * (`integrity-worker.ts`) and its main-side driver
 * (`SqliteIntegrityService`). Importing the same types on both sides
 * guarantees compile-level contract parity — the embedder worker's rule
 * (`memory-curator/src/lib/embedder/embedder-worker-protocol.ts`), restated.
 *
 * This module is the ONLY thing `integrity-worker.ts` imports from the
 * monorepo, which is what keeps the worker bundleable in isolation with
 * `better-sqlite3` as its single external. Nothing here may import a service,
 * a token, or `electron`.
 *
 * THE VERDICT IS THREE-VALUED, and the third value is the point.
 * `backup.service.ts:44-53` already carries this vocabulary for the same
 * reason: `'corrupt'` is a DEFINITE answer — `quick_check` ran and reported
 * something other than `ok`. Anything that stops us asking the question at all
 * (native module missing, ABI mismatch, file locked, open refused, pragma
 * threw) is `'unavailable'`, never `'corrupt'`. Reporting corruption on an
 * inconclusive check is a worse failure than the fault it would be reporting,
 * and the service writes NO record for `'unavailable'` so the next window
 * simply retries.
 */

/** The one request the worker answers. */
export interface IntegrityCheckRequest {
  readonly id: number;
  readonly type: 'check';
  /** Absolute path to the database file. Opened read-only, never written. */
  readonly dbPath: string;
}

export type IntegrityWorkerInbound = IntegrityCheckRequest;

/**
 * `'ok'`          — `quick_check` returned exactly `ok`.
 * `'corrupt'`     — `quick_check` ran and returned something else.
 * `'unavailable'` — the question could not be asked. Never recorded.
 */
export type IntegrityVerdict = 'ok' | 'corrupt' | 'unavailable';

export interface IntegrityCheckResponse {
  readonly id: number;
  readonly ok: true;
  readonly verdict: IntegrityVerdict;
  /** Raw `PRAGMA quick_check` text; `''` when the pragma never ran. */
  readonly quickCheck: string;
  /** Row count from `PRAGMA foreign_key_check`; `0` when it never ran. */
  readonly foreignKeyViolations: number;
  /** Wall-clock cost of the pair of pragmas, in ms. */
  readonly durationMs: number;
  /** `PRAGMA page_count`; `0` when the file could not be opened. */
  readonly pageCount: number;
  /** Why the verdict is not `'ok'`; `null` on a clean check. */
  readonly detail: string | null;
}

export interface IntegrityErrorResponse {
  readonly id: number;
  readonly ok: false;
  readonly error: string;
}

export type IntegrityWorkerOutbound =
  | IntegrityCheckResponse
  | IntegrityErrorResponse;

/**
 * Classify a completed `quick_check` result. PURE, and unit-tested as such.
 *
 * Only `ok` — the literal string `better-sqlite3` returns for a healthy file,
 * compared after trimming — is `'ok'`. Every other STRING is `'corrupt'`,
 * because the pragma answered. A non-string (the pragma returned nothing at
 * all, or a driver returned a shape we do not recognise) is `'unavailable'`:
 * we did not get an answer, so we have not got one.
 */
export function classifyQuickCheck(result: unknown): IntegrityVerdict {
  if (typeof result !== 'string') return 'unavailable';
  return result.trim() === 'ok' ? 'ok' : 'corrupt';
}

/** Narrow an unknown inbound payload to the one request the worker serves. */
export function isIntegrityCheckRequest(
  msg: unknown,
): msg is IntegrityCheckRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const candidate = msg as Partial<IntegrityCheckRequest>;
  return (
    candidate.type === 'check' &&
    typeof candidate.id === 'number' &&
    typeof candidate.dbPath === 'string' &&
    candidate.dbPath.length > 0
  );
}
