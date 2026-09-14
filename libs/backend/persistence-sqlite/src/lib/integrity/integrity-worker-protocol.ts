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
 * a token, or `electron`. Node builtins are allowed and `node:path` is used
 * below — the worker entry already imports `node:worker_threads`, so a builtin
 * costs the isolated bundle nothing.
 *
 * IT ALSO CARRIES THE WORKER'S TESTABLE HALF. The worker entry cannot be
 * imported in Jest (it subscribes to a parent port at module scope and throws
 * when there is none), so anything that needs a unit test has to live here.
 * That is why the backup path guard and the artifact filesystem helpers are in
 * this file rather than in `integrity-worker.ts`: they take a `BackupArtifactFs`
 * port instead of importing `node:fs` directly, which makes the POSIX
 * permission lockdown assertable.
 *
 * VALIDATION DIVERGES FROM THE REPOSITORY'S ZOD RULE, DELIBERATELY. IPC is an
 * external boundary and the repo rule is "Zod at every external boundary", but
 * this module is on the one import path that must bundle in isolation with a
 * single external. Pulling Zod in would put a second dependency inside
 * `integrity-worker.mjs` for two object shapes. The narrowings here are
 * hand-written to match `isIntegrityCheckRequest`'s existing style, and every
 * one of them is unit-tested in `integrity-worker-protocol.spec.ts`.
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

import * as path from 'node:path';

/** Ask the worker to run `quick_check` + `foreign_key_check` on a database. */
export interface IntegrityCheckRequest {
  readonly id: number;
  readonly type: 'check';
  /** Absolute path to the database file. Opened read-only, never written. */
  readonly dbPath: string;
}

/**
 * Ask the worker to copy a database into `stagingPath` via the better-sqlite3
 * Online Backup API, lock and validate it, then publish it at `destPath`.
 *
 * `destPath` IS COMPUTED ON THE HOST. Deriving it needs the backup kind, the
 * per-kind directory and prefix rules and the rotation table
 * (`backup.service.ts`), none of which may enter this file: the worker has to
 * stay a leaf that imports only this module. The host names final and staging;
 * the worker validates both and enforces their same-directory suffix relation.
 *
 * A-1 (TASK_2026_383 Batch 6, measured on better-sqlite3 12.10.0): a
 * connection opened `{ readonly: true, fileMustExist: true }` CAN call
 * `backup()`, and the destination passes `quick_check` — including while a
 * second connection in another process is writing to the WAL source. The
 * source therefore stays read-only, exactly as the check command opens it, and
 * the worker never issues a write statement against the live database.
 */
export interface BackupRequest {
  readonly id: number;
  readonly type: 'backup';
  /** Absolute path to the source database. Opened read-only, never written. */
  readonly dbPath: string;
  /**
   * Absolute final publication path. It is never passed to `backup()` and is
   * never unlinked by a failed attempt; `linkSync` publishes without overwrite.
   */
  readonly destPath: string;
  /**
   * Same-directory, host-randomized work file. The worker creates it with
   * exclusive semantics, validates it, then publishes it to `destPath` with an
   * atomic no-overwrite hard link.
   */
  readonly stagingPath: string;
}

export type IntegrityWorkerInbound = IntegrityCheckRequest | BackupRequest;

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

/**
 * Result of a `backup` command. REUSES `IntegrityVerdict` rather than minting a
 * second three-valued type: `'ok'` the copy landed and validated, `'corrupt'`
 * the copy's own `quick_check` answered something other than `ok`,
 * `'unavailable'` the question could not be asked (open refused, native module
 * missing, `backup()` threw, the destination was rejected). This retires
 * `backup.service.ts`'s `BackupIntegrity`, which said the same three things in
 * the same order — one verdict vocabulary in this lib, not two.
 *
 * `type: 'backup'` is a DISCRIMINANT, not decoration. Both success responses
 * carry `ok: true`, so without it the union can only be narrowed by probing for
 * a field. `IntegrityCheckResponse` deliberately keeps its existing shape (it
 * is the absence of `type`), because adding a discriminant there would ripple
 * through the shipped check path for no gain.
 *
 * `bytesWritten` is non-zero only after a validated staging copy is published
 * at `destPath`. Corrupt, unavailable and collision outcomes remove staging and
 * report zero; no failed outcome unlinks the final destination.
 */
export interface BackupResponse {
  readonly id: number;
  readonly type: 'backup';
  readonly ok: true;
  readonly verdict: IntegrityVerdict;
  /** Size of the published final; `0` when no final was published. */
  readonly bytesWritten: number;
  /** Wall-clock cost of copy + lockdown + validation, in ms. */
  readonly durationMs: number;
  /** Raw `PRAGMA quick_check` text from the COPY; `''` when it never ran. */
  readonly quickCheck: string;
  /** Why the verdict is not `'ok'`; `null` on a clean backup. */
  readonly detail: string | null;
}

/** Stable detail returned when the worker refuses an existing destination. */
export const BACKUP_DESTINATION_EXISTS = 'backup destination already exists';

/** Stable detail returned when exclusive staging creation loses a collision. */
export const BACKUP_STAGING_EXISTS = 'backup staging path already exists';

/**
 * Everything a `check` command can answer with — narrower than
 * `IntegrityWorkerOutbound` on purpose. `SqliteIntegrityService` only ever
 * SENDS `type: 'check'`, so typing its reply against the full union would force
 * it to narrow away a backup response it can never receive.
 */
export type IntegrityCheckOutbound =
  | IntegrityCheckResponse
  | IntegrityErrorResponse;

/** Every message the worker can post, across both commands. */
export type IntegrityWorkerOutbound = IntegrityCheckOutbound | BackupResponse;

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

/** Narrow an unknown inbound payload to the `check` request. */
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

/**
 * Narrow an unknown inbound payload to the `backup` request. Shaped exactly
 * like `isIntegrityCheckRequest` — SHAPE only. Whether the two paths are
 * *acceptable* is `validateBackupDestination`'s question, kept separate so a
 * rejected-but-well-formed request still has an `id` to answer on.
 */
export function isBackupRequest(msg: unknown): msg is BackupRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const candidate = msg as Partial<BackupRequest>;
  return (
    candidate.type === 'backup' &&
    typeof candidate.id === 'number' &&
    typeof candidate.dbPath === 'string' &&
    candidate.dbPath.length > 0 &&
    typeof candidate.destPath === 'string' &&
    candidate.destPath.length > 0 &&
    typeof candidate.stagingPath === 'string' &&
    candidate.stagingPath.length > 0
  );
}

/**
 * Decide whether a worker path is contained within the database tree. PURE, and unit
 * tested as such. Returns `null` when the destination is acceptable, otherwise
 * the reason, which the caller reports verbatim as the response `detail`.
 *
 * The worker receives final and staging paths over IPC, so both are external
 * boundaries in the fullest sense. Four rules, each closing a distinct hole:
 *
 *   1. both paths absolute — a relative path would resolve against whatever
 *      cwd the host happened to fork the worker with;
 *   2. `destPath` is not `dbPath` — `backup()` onto its own source would
 *      destroy the live database this whole subsystem exists to protect;
 *   3. `destPath` resolves strictly inside `dirname(dbPath)` — the real
 *      destinations are
 *      `<dbDir>/<name>.pre-migration-<YYYYMMDDTHHMMSSmmmZ>-<hex>.sqlite`,
 *      `<dbDir>/<name>.reset-<YYYYMMDDTHHMMSSmmmZ>-<hex>.sqlite`, and
 *      `<dbDir>/backups/<name>-<YYYY-MM-DD>.sqlite`, so one containment rule
 *      covers every kind while `..` traversal and an unrelated absolute path
 *      are refused;
 *   4. `destPath` is not the database directory itself.
 *
 * `path.relative` returns an ABSOLUTE path when the two arguments are on
 * different Windows drives (and for a UNC share against a drive-letter path),
 * which is why rule 3 checks `isAbsolute` on the relative result as well as the
 * `..` prefix. Both are covered by Windows-guarded spec cases.
 *
 * THIS CHECK IS STRING-LEVEL AND DOES NOT FOLLOW SYMLINKS. That is deliberate —
 * it stays pure so it can be exhaustively unit tested — and it is NOT the whole
 * containment story: `resolveRealBackupDestination` below re-runs the same
 * containment rule against `realpathSync`-resolved ancestors, and
 * `performBackup` calls both, in that order. Calling only this one leaves a
 * symlinked `backups/` directory able to redirect the write out of the tree.
 */
export function validateBackupDestination(
  dbPath: string,
  destPath: string,
): string | null {
  if (!path.isAbsolute(dbPath)) {
    return `dbPath is not absolute: ${dbPath}`;
  }
  if (!path.isAbsolute(destPath)) {
    return `destPath is not absolute: ${destPath}`;
  }

  const resolvedDb = path.resolve(dbPath);
  const resolvedDest = path.resolve(destPath);
  if (path.relative(resolvedDb, resolvedDest) === '') {
    return `destPath is the source database itself: ${destPath}`;
  }

  const dbDir = path.dirname(resolvedDb);
  const relative = path.relative(dbDir, resolvedDest);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return `destPath is outside the database directory tree: ${destPath}`;
  }

  return null;
}

/** Owner-only directory mode for the backup directory on POSIX. */
export const BACKUP_DIR_MODE = 0o700;

/** Owner-only file mode for a finished backup on POSIX. */
export const BACKUP_FILE_MODE = 0o600;

/**
 * The slice of `node:fs` the backup artifact helpers use. Injected rather than
 * imported so the helpers are testable — with the real `node:fs` in a temp
 * directory for the permission specs, and with a throwing double for the
 * cleanup-never-throws spec.
 */
export interface BackupArtifactFs {
  existsSync(target: string): boolean;
  mkdirSync(target: string, options: { recursive: true }): void;
  chmodSync(target: string, mode: number): void;
  openSync(target: string, flags: string): number;
  closeSync(fd: number): void;
  linkSync(existingPath: string, newPath: string): void;
  unlinkSync(target: string): void;
  rmdirSync(target: string): void;
  realpathSync(target: string): string;
  statSync(target: string): { size: number };
}

/**
 * Re-run the containment rule against symlink-RESOLVED paths.
 *
 * `validateBackupDestination` compares strings, which a symlink defeats: if
 * `<dbDir>/backups` is a link to somewhere else entirely, the string
 * `<dbDir>/backups/x.sqlite` is structurally inside the tree while the write
 * lands outside it. This module declares itself to be defending an external
 * boundary "in the fullest sense", so the string check alone would not honour
 * that claim.
 *
 * `destPath` does not exist yet — that is the point of the operation — so the
 * nearest EXISTING ancestor is what gets resolved, and the not-yet-created tail
 * is re-attached to it. A tail cannot introduce a link that is not there yet,
 * and `ensureBackupDirectory` only ever creates plain directories.
 *
 * Returns `null` when the destination is acceptable, otherwise the reason. A
 * `realpathSync` that throws is itself a rejection: an ancestor we cannot
 * resolve is an ancestor we cannot vouch for.
 */
export function resolveRealBackupDestination(
  fs: BackupArtifactFs,
  dbPath: string,
  destPath: string,
): string | null {
  let realDbDir: string;
  try {
    realDbDir = fs.realpathSync(path.dirname(path.resolve(dbPath)));
  } catch {
    return `database directory could not be resolved: ${path.dirname(dbPath)}`;
  }

  // Walk up to the nearest existing ancestor, remembering the tail.
  const resolvedDest = path.resolve(destPath);
  let ancestor = path.dirname(resolvedDest);
  const tail: string[] = [path.basename(resolvedDest)];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      return `destPath has no existing ancestor: ${destPath}`;
    }
    tail.unshift(path.basename(ancestor));
    ancestor = parent;
  }

  let realAncestor: string;
  try {
    realAncestor = fs.realpathSync(ancestor);
  } catch {
    return `destPath ancestor could not be resolved: ${ancestor}`;
  }

  const realDest = path.join(realAncestor, ...tail);
  const relative = path.relative(realDbDir, realDest);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return `destPath resolves outside the database directory tree: ${destPath}`;
  }

  return null;
}

/**
 * Create the destination's parent directory if it is missing and lock it to
 * owner-only. MAY THROW — the caller maps any throw to `'unavailable'`.
 *
 * The chmod is deliberately NOT platform-guarded, carrying
 * `backup.service.ts`'s original behaviour unchanged: on Windows Node's
 * `chmodSync` only touches the read-only bit and 0o700 leaves it writable, so
 * the call is a no-op rather than a wrong answer. ACL-level lockdown on Windows
 * is inherited from the user profile tree. The MODE is what matters and it is
 * pinned by a POSIX-guarded spec.
 *
 * Only chmods a directory this call created. Chmodding a pre-existing directory
 * would silently re-permission whatever the host pointed at.
 *
 * IF THE CHMOD THROWS, THE DIRECTORY THIS CALL CREATED IS REMOVED before the
 * throw propagates. Otherwise a created-but-unlocked directory survives a
 * failed backup, which contradicts `backup.service.ts`'s "a failed backup
 * leaves NO artifact behind" — and, worse, leaves a world-readable directory
 * that the NEXT backup would find pre-existing and therefore never lock down.
 * The removal is best-effort and never masks the original error.
 */
export function ensureBackupDirectory(
  fs: BackupArtifactFs,
  destPath: string,
): void {
  const dir = path.dirname(destPath);
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, BACKUP_DIR_MODE);
  } catch (error: unknown) {
    try {
      fs.rmdirSync(dir);
    } catch {
      // Best effort. The caller is about to fail on the original error, which
      // is the one worth reporting; a failed rollback must not replace it.
    }
    throw error;
  }
}

/**
 * Lock a finished backup file to owner-only and report its size. MAY THROW —
 * a backup that could not be locked down is not fit to keep, and the caller
 * removes it. The database holds workspace content, so a world-readable copy
 * of it beside the original is a local information-disclosure hole.
 */
export function restrictBackupFile(
  fs: BackupArtifactFs,
  destPath: string,
): number {
  fs.chmodSync(destPath, BACKUP_FILE_MODE);
  return fs.statSync(destPath).size;
}

/**
 * The WAL sidecars SQLite may create beside the read-write validation handle.
 * They are removed before hard-link publication and on every staging cleanup;
 * rotation's strict `.sqlite` filter never counts them as retained backups.
 */
const WAL_SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

/**
 * Best-effort removal of an attempt-owned staging artifact and its WAL sidecars.
 * NEVER THROWS: it runs on failure paths where cleanup must not replace the
 * original result. Callers never pass a final destination to this helper.
 */
export function removeBackupArtifact(
  fs: BackupArtifactFs,
  destPath: string,
): void {
  for (const target of [
    destPath,
    ...WAL_SIDECAR_SUFFIXES.map((suffix) => `${destPath}${suffix}`),
  ]) {
    try {
      if (!fs.existsSync(target)) continue;
      fs.unlinkSync(target);
    } catch {
      // Nothing to do and nobody to tell: the caller is already returning a
      // failure verdict, and a cleanup that could not run must not replace it.
      // A sidecar that resists removal must not stop the main file being tried.
    }
  }
}

/** The slice of a source connection `performBackup` uses. */
export interface BackupSourceDatabase {
  backup?(destination: string): Promise<unknown>;
  close(): void;
}

/** The slice of a validation connection `performBackup` uses. */
export interface BackupValidationDatabase {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  close(): void;
}

/**
 * Everything `performBackup` touches that is not pure. Injected as one object
 * so the whole command can be driven from a spec — with the REAL
 * `better-sqlite3` and the REAL `node:fs` for the integration spec that pins
 * assumption A-1, and with a targeted double for the failure paths a real
 * filesystem will not reproduce on demand.
 */
export interface BackupEnvironment {
  readonly fs: BackupArtifactFs;
  /** Open the SOURCE. Read-only: this connection must never write. */
  openSource(dbPath: string): BackupSourceDatabase;
  /**
   * Open the finished STAGING COPY. Read-WRITE — a read-only open cannot
   * checkpoint on
   * close and leaves `-wal`/`-shm` sidecars that take rotation slots. See
   * `integrity-worker.ts`'s `openForValidation`.
   */
  openCopy(destPath: string): BackupValidationDatabase;
  now(): number;
  /**
   * Final destinations with a backup in flight. This avoids duplicate work
   * inside one worker; atomic hard-link publication is the cross-process guard.
   */
  readonly inFlight: Set<string>;
}

/** Build a zero-byte `'unavailable'` response for an attempt that wrote none. */
function backupUnavailable(
  id: number,
  startedAt: number,
  now: number,
  detail: string,
): BackupResponse {
  return {
    id,
    type: 'backup',
    ok: true,
    verdict: 'unavailable',
    bytesWritten: 0,
    durationMs: now - startedAt,
    quickCheck: '',
    detail,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}

function removeBackupSidecars(fs: BackupArtifactFs, target: string): void {
  for (const suffix of WAL_SIDECAR_SUFFIXES) {
    const sidecar = `${target}${suffix}`;
    try {
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    } catch {
      // The caller verifies that both sidecars are gone before publishing.
    }
  }
}

/**
 * Reopen a finished backup and classify its `quick_check`. This is
 * TASK_2026_380 follow-up item 16 absorbed: validating the copy here means the
 * main process never opens the artifact at all.
 *
 * `detail` is `null` unless the verdict is `'unavailable'`, so the field never
 * carries an explanation for a state it does not describe.
 */
function validateCopy(
  env: BackupEnvironment,
  destPath: string,
): { verdict: IntegrityVerdict; quickCheck: string; detail: string | null } {
  let copy: BackupValidationDatabase | null = null;
  try {
    copy = env.openCopy(destPath);
    const raw = copy.pragma('quick_check', { simple: true });
    const verdict = classifyQuickCheck(raw);
    return {
      verdict,
      quickCheck: typeof raw === 'string' ? raw : '',
      detail:
        verdict === 'unavailable'
          ? 'quick_check returned a non-string result'
          : null,
    };
  } catch (error: unknown) {
    return {
      verdict: 'unavailable',
      quickCheck: '',
      detail: describeError(error),
    };
  } finally {
    try {
      copy?.close();
    } catch {
      // A close failure changes nothing about the verdict already computed.
    }
  }
}

/**
 * THE `backup` COMMAND. Copy into an exclusively-created staging file, lock and
 * validate it, then atomically publish it to `destPath` without overwriting.
 *
 * This lives in the protocol module rather than in `integrity-worker.ts`
 * because the worker ENTRY cannot be imported in Jest — it subscribes to a
 * parent port at module scope and throws when there is none — so any logic left
 * there is, by construction, unassertable. Assumption A-1 (a `{ readonly: true }`
 * connection can `backup()` against a live writer) is the premise the whole
 * feature rests on; keeping the orchestration here is what lets
 * `integrity-worker-backup.integration.spec.ts` call this function directly
 * against the real `better-sqlite3` and fail loudly when a dependency bump
 * breaks that premise, instead of degrading to a permanent `'unavailable'`
 * nobody notices.
 *
 * NEVER REJECTS: every escape lands on `'unavailable'` with a `detail`, because
 * a copy that could not be made or checked is not evidence about the data.
 * `'corrupt'` is reserved for `quick_check` having run ON THE COPY and answered
 * something other than `ok`.
 *
 * Ordering is load-bearing. Both paths pass string and realpath containment
 * checks before anything is created. The staging file is then reserved with
 * `openSync(..., 'wx')`; only that attempt-owned path and its sidecars are ever
 * removed. A validated copy is published with `linkSync(staging, dest)`, whose
 * EEXIST behavior makes the final-name race atomic across host processes.
 */
export async function performBackup(
  env: BackupEnvironment,
  request: BackupRequest,
): Promise<BackupResponse> {
  const startedAt = env.now();
  const fail = (detail: string): BackupResponse =>
    backupUnavailable(request.id, startedAt, env.now(), detail);

  const rejection = validateBackupDestination(request.dbPath, request.destPath);
  if (rejection !== null) return fail(rejection);

  const realRejection = resolveRealBackupDestination(
    env.fs,
    request.dbPath,
    request.destPath,
  );
  if (realRejection !== null) return fail(realRejection);

  const stagingRejection = validateBackupDestination(
    request.dbPath,
    request.stagingPath,
  );
  if (stagingRejection !== null) return fail(stagingRejection);

  const realStagingRejection = resolveRealBackupDestination(
    env.fs,
    request.dbPath,
    request.stagingPath,
  );
  if (realStagingRejection !== null) return fail(realStagingRejection);

  const stagingSuffix = request.stagingPath.slice(request.destPath.length);
  if (
    path.dirname(path.resolve(request.stagingPath)) !==
      path.dirname(path.resolve(request.destPath)) ||
    !/^\.[0-9a-f]{8}\.tmp$/.test(stagingSuffix)
  ) {
    return fail('stagingPath must be <destPath>.<8 lowercase hex>.tmp');
  }

  const key = path.resolve(request.destPath);
  if (env.inFlight.has(key)) {
    return fail(`a backup to this destination is already in flight: ${key}`);
  }
  env.inFlight.add(key);

  let stagingCreatedByAttempt = false;
  let source: BackupSourceDatabase | null = null;
  try {
    ensureBackupDirectory(env.fs, request.stagingPath);
    let stagingFd: number;
    try {
      stagingFd = env.fs.openSync(request.stagingPath, 'wx');
    } catch (error: unknown) {
      if (isAlreadyExistsError(error)) {
        return fail(BACKUP_STAGING_EXISTS);
      }
      throw error;
    }
    stagingCreatedByAttempt = true;
    env.fs.closeSync(stagingFd);

    source = env.openSource(request.dbPath);
    if (typeof source.backup !== 'function') {
      removeBackupArtifact(env.fs, request.stagingPath);
      return fail('db.backup() is unavailable on this database instance');
    }

    await source.backup(request.stagingPath);
    const bytesWritten = restrictBackupFile(env.fs, request.stagingPath);

    const validation = validateCopy(env, request.stagingPath);
    if (validation.verdict === 'corrupt') {
      removeBackupArtifact(env.fs, request.stagingPath);
      return {
        id: request.id,
        type: 'backup',
        ok: true,
        verdict: 'corrupt',
        bytesWritten: 0,
        durationMs: env.now() - startedAt,
        quickCheck: validation.quickCheck,
        detail: validation.quickCheck,
      };
    }

    if (validation.verdict === 'unavailable') {
      removeBackupArtifact(env.fs, request.stagingPath);
      return fail(validation.detail ?? 'the staging copy could not be validated');
    }

    removeBackupSidecars(env.fs, request.stagingPath);
    if (
      WAL_SIDECAR_SUFFIXES.some((suffix) =>
        env.fs.existsSync(`${request.stagingPath}${suffix}`),
      )
    ) {
      removeBackupArtifact(env.fs, request.stagingPath);
      return fail('atomic publish blocked: staging sidecar cleanup failed');
    }

    try {
      env.fs.linkSync(request.stagingPath, request.destPath);
    } catch (error: unknown) {
      removeBackupArtifact(env.fs, request.stagingPath);
      if (isAlreadyExistsError(error)) {
        return fail(BACKUP_DESTINATION_EXISTS);
      }
      return fail(`atomic publish failed: ${describeError(error)}`);
    }

    try {
      env.fs.unlinkSync(request.stagingPath);
    } catch {
      removeBackupArtifact(env.fs, request.stagingPath);
    }

    return {
      id: request.id,
      type: 'backup',
      ok: true,
      verdict: 'ok',
      bytesWritten,
      durationMs: env.now() - startedAt,
      quickCheck: validation.quickCheck,
      detail: null,
    };
  } catch (error: unknown) {
    if (stagingCreatedByAttempt) {
      removeBackupArtifact(env.fs, request.stagingPath);
    }
    return fail(describeError(error));
  } finally {
    env.inFlight.delete(key);
    try {
      source?.close();
    } catch {
      // A close failure says nothing about the copy and there is nothing left
      // to do about it.
    }
  }
}
