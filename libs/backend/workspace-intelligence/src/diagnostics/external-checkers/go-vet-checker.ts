/**
 * GoVetChecker — `go vet` for requested Go files, only with the workspace's
 * stored, current consent (TASK_2026_559 Batch 37a; O2 §3-§6, User
 * Decisions 19 and 25).
 *
 * **Fixed invocation.** `<canonical go> vet -json <pkg> [<pkg> …]` as an
 * argument array through the host spawner, no shell. `cwd` is the nearest
 * `go.mod` directory above the requested files inside the root; each `<pkg>`
 * is `.` or `./<rel dir>` of a requested file, validated (stays under `cwd`,
 * never starts with `-`, never contains `...`), at most
 * {@link GO_VET_MAX_PACKAGES}. There is no caller-supplied flag of any kind.
 *
 * **Environment** (built from scratch, never spread): the sanitised PATH,
 * a few inherited locations (home, temp, cache, locale) and the fixed Go
 * variables in {@link GO_VET_FIXED_ENV} — readonly modules, no proxy, no
 * checksum database, no workspace file, no toolchain switch, no cgo, no VCS
 * stamping, no user go env file, no external cache program. `GOFLAGS` is
 * replaced, so a user's `-toolexec`/`-vettool`/`-overlay` never applies.
 *
 * **Order per run** (O2 §3 "Queued work and revoke"): scope → module and
 * packages → binary resolution → ONE consent read (no caching) → spawner →
 * spawn. A revoke therefore stops the next run; a run already spawned is
 * bounded by {@link GO_VET_TIMEOUT_MS}.
 *
 * **Honest answers.** Only a clean exit with parseable output is `checked`.
 * No consent, stale consent, no binary, no `go.mod` or an unscoped call is
 * `unchecked`; a timeout, an overflow, a cancellation, a toolchain mismatch,
 * missing modules, a compile failure or unreadable output is `failed`.
 * Neither ever carries Go diagnostics, so neither can read as "No issues".
 * Review r1: a clean package run credits only requested files Go is known
 * to select (`go-file-membership.ts`: no build constraint, no ignored name,
 * no cgo, readable header) — the rest are skipped with a reason; every path
 * is resolved through its links first and one whose real path leaves the
 * real root is `outside-root`, so the run's cwd is always inside the folder
 * the consent binds; a finding vet places outside the workspace is counted
 * (`unmappedFindings`), never erased, and its package's files are skipped.
 * A `checked` answer is a vet-level claim, never a type-check claim: its
 * coverage fragment is {@link GO_VET_COVERAGE} (`checks: 'syntax-only'`,
 * `go:syntax-only`, per the Batch 25a floor-rule amendment).
 *
 * **Audit.** One fixed-text `info` line per run; the root appears only as
 * `sha256(path.resolve(root)).slice(0, 16)`; no path, output or error text.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  MAX_NOT_CHECKED_FILES_LISTED,
  isPathWithinRoots,
} from '@ptah-extension/platform-core';
import type {
  Approximation,
  CoverageChecks,
  FileDiagnostics,
  IProcessSpawner,
  NotCheckedFiles,
} from '@ptah-extension/platform-core';
import {
  CHECKER_MAX_OUTPUT_BYTES,
  pickInheritedEnv,
  runChecker,
  type CheckerRunRequest,
  type CheckerRunResult,
} from './checker-runner';
import {
  resolveGoBinary,
  type ResolveGoBinaryOptions,
  type ResolvedGoBinary,
} from './go-binary-resolver';
import type {
  GoVetConsentStaleReason,
  GoVetConsentStore,
} from './go-vet-consent-store';
import { goFileMembership } from './go-file-membership';
import {
  classifyFailure,
  packageDirForId,
  parseVetDiagnostics,
  type PositionMapper,
} from './go-vet-output';

export {
  GO_VET_MAX_DIAGNOSTICS,
  packageDirForId,
  splitVetOutput,
} from './go-vet-output';

/** Longest one vet run may take; inside the 45 s diagnostics budget. */
export const GO_VET_TIMEOUT_MS = 30_000;

/** Most packages one run vets; later ones are `omitted-by-cap`. */
export const GO_VET_MAX_PACKAGES = 20;

/** Bytes read from `<GOROOT>/VERSION` or the head of `go.mod`. */
const HEAD_BYTES = 64 * 1024;

/** The Go variables every run gets, whatever the parent environment says. */
export const GO_VET_FIXED_ENV: Readonly<Record<string, string>> = {
  GOFLAGS: '-mod=readonly -buildvcs=false',
  GOENV: 'off',
  GOTOOLCHAIN: 'local',
  GOPROXY: 'off',
  GOSUMDB: 'off',
  GONOPROXY: '',
  GONOSUMDB: '',
  GOPRIVATE: '',
  GOINSECURE: '',
  GOCACHEPROG: '',
  GOWORK: 'off',
  GO111MODULE: 'on',
  CGO_ENABLED: '0',
};

/** Parent variables copied as they are: home, temp, caches, locale. */
const INHERITED_ENV = [
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'TEMP',
  'TMP',
  'XDG_CACHE_HOME',
  'LANG',
];

/** How a vetted Go file must be described in `coverage` (never type-check). */
export const GO_VET_COVERAGE: {
  readonly checks: CoverageChecks;
  readonly approximations: readonly Approximation[];
} = { checks: 'syntax-only', approximations: ['go:syntax-only'] };

/** The audit outcome (O2 §6). */
export type GoVetOutcome =
  'ok' | 'findings' | 'timeout' | 'failed' | 'too-large' | 'not-run';

/** Why a run, or one file, was not checked. Fixed codes only. */
export type GoVetReason =
  | 'no-consent'
  | 'consent-stale'
  | 'no-go-binary'
  | 'no-go-mod'
  | 'no-go-files'
  | 'unscoped'
  | 'no-spawner'
  | 'spawn-failed'
  | 'timeout'
  | 'too-large'
  | 'cancelled'
  | 'toolchain-mismatch'
  | 'missing-modules'
  | 'build-errors'
  | 'analyzer-error'
  | 'unparseable'
  | 'cgo'
  | 'other-module'
  | 'omitted-by-cap'
  | 'invalid-package-path'
  | 'not-found'
  | 'root-unresolvable'
  | 'outside-root'
  | 'build-constraints'
  | 'ignored-name'
  | 'unverifiable'
  | 'not-go-source'
  | 'documentation-package'
  | 'unmapped-findings';

export interface GoVetCheckRequest {
  readonly workspaceRoot: string;
  /** Requested files; only `.go` files inside the root are considered. */
  readonly files?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface GoVetSkippedFile {
  readonly file: string;
  readonly reason: GoVetReason;
}

export interface GoVetCheckResult {
  /** `checked` only after a clean vet exit with parseable output. */
  readonly status: 'checked' | 'unchecked' | 'failed';
  readonly outcome: GoVetOutcome;
  /**
   * Run-level reason. On `checked` it is present only as
   * `unmapped-findings`: vet reported findings this answer cannot place in
   * the workspace, so their packages' files are not claimed.
   */
  readonly reason?: GoVetReason;
  /** Present with `reason: 'consent-stale'`. */
  readonly staleReason?: GoVetConsentStaleReason;
  /** Vet findings; empty unless `status` is `checked`. */
  readonly diagnostics: readonly FileDiagnostics[];
  readonly diagnosticsTruncated: boolean;
  /** Requested Go files vet covered; empty unless `checked`. */
  readonly checkedFiles: readonly string[];
  /** Requested Go files not covered, each with its reason. */
  readonly skippedFiles: readonly GoVetSkippedFile[];
  /** `skippedFiles` grouped for the provider's `notChecked`. */
  readonly notChecked: readonly NotCheckedFiles[];
  /**
   * Findings vet reported at a position outside the workspace (a `//line`
   * directive, generated code). Never dropped silently: counted here, the
   * outcome is `findings`, and the files of their packages are skipped with
   * `unmapped-findings`.
   */
  readonly unmappedFindings: number;
}

/** The `info` sink the audit line goes to. */
export interface GoVetAuditLogger {
  info(message: string, ...args: unknown[]): void;
}

export interface GoVetCheckerDependencies {
  readonly consentStore: Pick<GoVetConsentStore, 'read'>;
  /**
   * The host spawner, resolved at first use: it is registered after this
   * lib in both hosts. A throw here is `failed/no-spawner`.
   */
  readonly getSpawner: () => IProcessSpawner;
  /** The host user-data directory; never searched for a binary. */
  readonly userDataPath: string;
  readonly logger: GoVetAuditLogger;
  /** The parent environment, read once per run. */
  readonly env?: () => Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly resolveGo?: (
    options: ResolveGoBinaryOptions,
  ) => ResolvedGoBinary | null;
  readonly run?: (request: CheckerRunRequest) => Promise<CheckerRunResult>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

const REASON_TEXT: Readonly<Record<GoVetReason, string>> = {
  'no-consent':
    'Syntax-checked only: go vet is off for this workspace. Enable it in Settings → Tools (desktop app) or run `ptah config go-vet on` in this workspace.',
  'consent-stale':
    'Syntax-checked only: go vet consent for this workspace is out of date. Re-enable it in Settings → Tools (desktop app) or run `ptah config go-vet on` in this workspace.',
  'no-go-binary':
    'go vet did not run: no Go toolchain on PATH outside this workspace.',
  'no-go-mod':
    'go vet did not run: no go.mod above it inside the workspace (GOPATH mode is not checked).',
  'no-go-files': 'go vet did not run: no requested package it can build.',
  unscoped: 'go vet runs only on requested files: pass `files` to check them.',
  'no-spawner': 'go vet did not run: this host cannot start it yet.',
  'spawn-failed': 'go vet could not be started, so no result is claimed.',
  // "A stop was requested", never "stopped": the answer is returned before
  // the process tree is confirmed gone (checker-runner.ts, Batch 37b1a).
  timeout: `go vet ran out of time (${GO_VET_TIMEOUT_MS / 1000} s); a stop was requested and no result is claimed.`,
  'too-large': `go vet wrote more than ${CHECKER_MAX_OUTPUT_BYTES / (1024 * 1024)} MiB; a stop was requested and no result is claimed.`,
  cancelled: 'The check was cancelled; no go vet result is claimed.',
  'toolchain-mismatch':
    'go vet did not check it: the module needs a newer Go than the installed toolchain (no toolchain is downloaded).',
  'missing-modules':
    'go vet did not check it: module dependencies are missing and nothing is downloaded.',
  'build-errors':
    'go vet did not check it: the package does not build (compile errors or no buildable files).',
  'analyzer-error': 'go vet did not check it: an analyzer failed.',
  unparseable: 'go vet output could not be read, so no result is claimed.',
  cgo: 'go vet does not build cgo files here (CGO_ENABLED=0).',
  'other-module':
    'go vet checks one Go module per call: request these files in another call.',
  'omitted-by-cap': `go vet checks at most ${GO_VET_MAX_PACKAGES} packages per call: request these in another call.`,
  'invalid-package-path':
    'go vet did not run for it: its directory cannot be passed as a package safely.',
  'not-found': 'go vet did not check it: the file does not exist.',
  'root-unresolvable':
    'go vet did not run: the workspace folder could not be resolved.',
  'outside-root':
    'go vet did not run for it: its real path (through a link) is outside this workspace, which is the only folder go vet consent covers.',
  'build-constraints':
    'go vet may not have analysed it: a build constraint (a //go:build line or an OS/architecture file-name suffix) can exclude it, so it is not claimed.',
  'ignored-name':
    'go vet does not analyse it: the go command ignores file names starting with "_" or ".".',
  unverifiable:
    'go vet may not have analysed it: its header could not be read with certainty (too large, unreadable, or unusual import syntax), so it is not claimed.',
  'not-go-source':
    'go vet does not analyse it: the go command reads only files ending in lower-case ".go".',
  'documentation-package':
    'go vet does not analyse it: the go command ignores files in "package documentation".',
  'unmapped-findings':
    'go vet reported findings in its package at positions outside the workspace (for example a //line directive); they cannot be shown, so the file is not claimed clean.',
};

/** Language key of every group this checker reports. */
const GO_LANGUAGE = 'go';

export function goVetReasonText(reason: GoVetReason): string {
  return REASON_TEXT[reason];
}

/** Group skipped files by reason, listing at most the contract's bound. */
function groupSkipped(
  skipped: readonly GoVetSkippedFile[],
  staleReason?: GoVetConsentStaleReason,
): NotCheckedFiles[] {
  const groups = new Map<GoVetReason, { count: number; files: string[] }>();
  for (const entry of skipped) {
    let group = groups.get(entry.reason);
    if (group === undefined) {
      group = { count: 0, files: [] };
      groups.set(entry.reason, group);
    }
    group.count += 1;
    if (group.files.length < MAX_NOT_CHECKED_FILES_LISTED) {
      group.files.push(entry.file);
    }
  }
  return [...groups.entries()].map(([reason, group]) => ({
    language: GO_LANGUAGE,
    count: group.count,
    files: group.files,
    reason:
      reason === 'consent-stale' && staleReason !== undefined
        ? `${REASON_TEXT[reason]} (${staleReason})`
        : REASON_TEXT[reason],
  }));
}

function workspaceHash(root: string): string {
  return createHash('sha256')
    .update(path.resolve(root))
    .digest('hex')
    .slice(0, 16);
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch (error: unknown) {
    // degradation-audit: optional-capability - an absent go.mod is the
    // expected answer on every directory but one; the walk continues.
    void error;
    return false;
  }
}

/** The nearest directory holding `go.mod`, from `dir` up to the root. */
function findModuleDir(
  dir: string,
  root: string,
  platform: NodeJS.Platform,
): string | null {
  let current = dir;
  while (isPathWithinRoots(current, [root], platform)) {
    if (isFile(path.join(current, 'go.mod'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function readHead(file: string): string {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(descriptor, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch (error: unknown) {
    // degradation-audit: optional-capability - an unreadable VERSION file
    // or go.mod head leaves the version (or module path) unknown; a module
    // path that is unknown makes every unmapped finding cover all files.
    void error;
    return '';
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

/** `.` or `./a/b` for a directory under `moduleDir`, or `null` if unsafe. */
export function packagePattern(moduleDir: string, dir: string): string | null {
  const relative = path.relative(moduleDir, dir);
  if (relative === '') return '.';
  if (path.isAbsolute(relative)) return null;
  const segments = relative.split(/[\\/]/);
  if (segments.some((segment) => segment === '..' || segment === '')) {
    return null;
  }
  const pattern = `./${segments.join('/')}`;
  if (pattern.startsWith('-') || pattern.includes('...')) return null;
  return pattern;
}

/** The Go environment of one run; nothing else from the parent is kept. */
export function buildGoVetEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
  pathDirs: readonly string[],
  platform: NodeJS.Platform,
): Record<string, string> {
  const inherited =
    platform === 'win32' ? [...INHERITED_ENV, 'LOCALAPPDATA'] : INHERITED_ENV;
  return {
    ...pickInheritedEnv(parentEnv, inherited, platform),
    PATH: pathDirs.join(platform === 'win32' ? ';' : ':'),
    ...GO_VET_FIXED_ENV,
  };
}

/** `go1.22.3` from `<GOROOT>/VERSION`, beside the binary's `bin` dir. */
function readGoVersion(binaryPath: string): string | undefined {
  const versionFile = path.join(
    path.dirname(path.dirname(binaryPath)),
    'VERSION',
  );
  const firstLine = readHead(versionFile).split(/\r?\n/, 1)[0]?.trim() ?? '';
  return /^go\d+\.\d+(?:\.\d+)?(?:[a-z]+\d*)?$/.test(firstLine)
    ? firstLine
    : undefined;
}

/** Case key for comparing canonical paths the way the platform does. */
function pathKey(file: string, platform: NodeJS.Platform): string {
  const resolved = path.resolve(file);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** The `module` path declared in `<moduleDir>/go.mod`, or `null`. */
function readModulePath(moduleDir: string): string | null {
  const match = /^\s*module\s+"?([^\s"]+)"?\s*(?:\/\/.*)?$/m.exec(
    readHead(path.join(moduleDir, 'go.mod')),
  );
  return match === null ? null : match[1];
}

/** A requested file credited to a package if that package vets cleanly. */
interface VettedFile {
  /** As the caller named it. */
  readonly requested: string;
  /** Canonical file and package directory (all links resolved). */
  readonly realFile: string;
  readonly realDir: string;
}

/** Requested Go files sorted into packages of one module. */
interface VetPlan {
  /** Canonical module directory: the run's `cwd`. */
  readonly moduleDir: string | null;
  readonly packages: readonly string[];
  readonly vetted: readonly VettedFile[];
  readonly skipped: readonly GoVetSkippedFile[];
}

function realpathOrNull(target: string): string | null {
  try {
    return fs.realpathSync.native(target);
  } catch (error: unknown) {
    // degradation-audit: optional-capability - a path that does not resolve
    // is reported (`not-found` / `root-unresolvable`); vet never runs on it.
    void error;
    return null;
  }
}

/**
 * Plan in CANONICAL space (review r1 finding 2): every file is resolved
 * through its links first, and one whose real path leaves the real root is
 * refused, so a junction can never carry the run into another physical
 * folder. The module, the packages and the `cwd` are all real paths inside
 * the real root. A file is credited only when Go is known to select it
 * (review r1 finding 1, `goFileMembership`).
 */
function planPackages(
  rootReal: string,
  goFiles: readonly string[],
  platform: NodeJS.Platform,
): VetPlan {
  const skipped: GoVetSkippedFile[] = [];
  let moduleDir: string | null = null;
  const packages = new Set<string>();
  const vetted: VettedFile[] = [];
  for (const file of goFiles) {
    const realFile = realpathOrNull(file);
    if (realFile === null || !isFile(realFile)) {
      skipped.push({ file, reason: 'not-found' });
      continue;
    }
    if (!isPathWithinRoots(realFile, [rootReal], platform)) {
      skipped.push({ file, reason: 'outside-root' });
      continue;
    }
    const realDir = path.dirname(realFile);
    const fileModule = findModuleDir(realDir, rootReal, platform);
    if (fileModule === null) {
      skipped.push({ file, reason: 'no-go-mod' });
      continue;
    }
    if (moduleDir === null) moduleDir = fileModule;
    if (pathKey(fileModule, platform) !== pathKey(moduleDir, platform)) {
      skipped.push({ file, reason: 'other-module' });
      continue;
    }
    const membership = goFileMembership(realFile);
    if (membership !== 'member') {
      skipped.push({ file, reason: membership });
      continue;
    }
    const pattern = packagePattern(moduleDir, realDir);
    if (pattern === null) {
      skipped.push({ file, reason: 'invalid-package-path' });
      continue;
    }
    if (!packages.has(pattern)) {
      if (packages.size >= GO_VET_MAX_PACKAGES) {
        skipped.push({ file, reason: 'omitted-by-cap' });
        continue;
      }
      packages.add(pattern);
    }
    vetted.push({ requested: file, realFile, realDir });
  }
  return { moduleDir, packages: [...packages], vetted, skipped };
}

export class GoVetChecker {
  private readonly platform: NodeJS.Platform;

  constructor(private readonly deps: GoVetCheckerDependencies) {
    this.platform = deps.platform ?? process.platform;
  }

  async check(request: GoVetCheckRequest): Promise<GoVetCheckResult> {
    const startedAt = Date.now();
    const root = path.resolve(request.workspaceRoot);
    const audit = (
      outcome: GoVetOutcome,
      packages: number,
      reason?: GoVetReason,
      goVersion?: string,
    ): void => {
      this.deps.logger.info('[Diagnostics] go vet run', {
        workspaceHash: workspaceHash(root),
        packages,
        durationMs: Date.now() - startedAt,
        outcome,
        ...(reason !== undefined ? { reason } : {}),
        ...(goVersion !== undefined ? { goVersion } : {}),
      });
    };

    const requested = request.files ?? [];
    if (requested.length === 0) {
      audit('not-run', 0, 'unscoped');
      return notRun('unscoped', []);
    }
    const goFiles = [
      ...new Set(
        requested
          .map((file) => path.resolve(root, file))
          .filter(
            (file) =>
              path.extname(file).toLowerCase() === '.go' &&
              isPathWithinRoots(file, [root], this.platform),
          ),
      ),
    ];
    if (goFiles.length === 0) {
      audit('not-run', 0, 'no-go-files');
      return notRun('no-go-files', []);
    }
    const rootReal = realpathOrNull(root);
    if (rootReal === null) {
      audit('not-run', 0, 'root-unresolvable');
      return notRun(
        'root-unresolvable',
        goFiles.map((file) => ({ file, reason: 'root-unresolvable' })),
      );
    }
    const plan = planPackages(rootReal, goFiles, this.platform);
    if (plan.moduleDir === null || plan.packages.length === 0) {
      const reason: GoVetReason = plan.skipped.some(
        (entry) => entry.reason === 'no-go-mod',
      )
        ? 'no-go-mod'
        : 'no-go-files';
      audit('not-run', 0, reason);
      return notRun(reason, plan.skipped);
    }
    const moduleDir = plan.moduleDir;
    const packages = plan.packages.length;
    const withVetted = (reason: GoVetReason): GoVetSkippedFile[] => [
      ...plan.vetted.map((entry) => ({ file: entry.requested, reason })),
      ...plan.skipped,
    ];

    const parentEnv = (this.deps.env ?? (() => process.env))();
    const binary = (this.deps.resolveGo ?? resolveGoBinary)({
      workspaceRoot: root,
      env: parentEnv,
      userDataPath: this.deps.userDataPath,
      platform: this.platform,
    });
    if (binary === null) {
      audit('not-run', packages, 'no-go-binary');
      return notRun('no-go-binary', withVetted('no-go-binary'));
    }

    // The one consent read of this run: after binary resolution, right
    // before the spawn, never cached, so a revoke stops the next run. The
    // run's cwd is inside the real root this consent binds (planPackages).
    const consent = this.deps.consentStore.read(root, binary);
    if (consent.state !== 'on') {
      const reason: GoVetReason =
        consent.state === 'off' ? 'no-consent' : 'consent-stale';
      audit('not-run', packages, reason);
      const staleReason =
        consent.state === 'stale' ? consent.reason : undefined;
      return notRun(reason, withVetted(reason), staleReason);
    }

    let spawner: IProcessSpawner;
    try {
      spawner = this.deps.getSpawner();
    } catch (error: unknown) {
      void error;
      audit('failed', packages, 'no-spawner');
      return failed('failed', 'no-spawner', withVetted('no-spawner'));
    }

    const goVersion = readGoVersion(binary.path);
    const run =
      this.deps.run ??
      ((req) =>
        runChecker(req, {
          // A failed tree kill is recorded as a fixed-text line; the error
          // text itself may hold paths and is never logged.
          onKillError: (error: unknown) => {
            void error;
            this.deps.logger.info('[Diagnostics] go vet stop failed', {
              workspaceHash: workspaceHash(root),
            });
          },
        }));
    const result = await run({
      spawner,
      command: binary.path,
      args: ['vet', '-json', ...plan.packages],
      cwd: moduleDir,
      env: buildGoVetEnv(parentEnv, binary.pathDirs, this.platform),
      timeoutMs: this.deps.timeoutMs ?? GO_VET_TIMEOUT_MS,
      maxOutputBytes: this.deps.maxOutputBytes ?? CHECKER_MAX_OUTPUT_BYTES,
      signal: request.signal,
    });

    if (result.kind !== 'exited') {
      const outcome: GoVetOutcome =
        result.kind === 'timeout' || result.kind === 'too-large'
          ? result.kind
          : 'failed';
      audit(outcome, packages, result.kind, goVersion);
      return failed(outcome, result.kind, withVetted(result.kind));
    }

    const output = `${result.stdout}\n${result.stderr}`;
    if (result.code !== 0) {
      const reason = classifyFailure(output);
      audit('failed', packages, reason, goVersion);
      return failed('failed', reason, withVetted(reason));
    }
    const parsed = parseVetDiagnostics(
      output,
      moduleDir,
      this.positionMapper(root, rootReal, plan.vetted),
    );
    if (parsed === null || parsed.analyzerError) {
      const reason: GoVetReason =
        parsed === null ? 'unparseable' : 'analyzer-error';
      audit('failed', packages, reason, goVersion);
      return failed('failed', reason, withVetted(reason));
    }

    // Findings vet placed outside the workspace are never erased: their
    // packages' files are not claimed, and the answer says why.
    const unmappedFindings = sum(parsed.unmapped.values());
    const unmappedDirs = new Set<string>();
    let unmappedEverywhere = false;
    if (unmappedFindings > 0) {
      const modulePath = readModulePath(moduleDir);
      for (const packageId of parsed.unmapped.keys()) {
        const dir = packageDirForId(packageId, modulePath, moduleDir);
        if (dir === null) unmappedEverywhere = true;
        else unmappedDirs.add(pathKey(dir, this.platform));
      }
    }
    const checkedFiles: string[] = [];
    const skippedFiles: GoVetSkippedFile[] = [...plan.skipped];
    for (const entry of plan.vetted) {
      const affected =
        unmappedFindings > 0 &&
        (unmappedEverywhere ||
          unmappedDirs.has(pathKey(entry.realDir, this.platform)));
      if (affected) {
        skippedFiles.push({
          file: entry.requested,
          reason: 'unmapped-findings',
        });
      } else {
        checkedFiles.push(entry.requested);
      }
    }
    const outcome: GoVetOutcome =
      parsed.diagnostics.length > 0 || unmappedFindings > 0 ? 'findings' : 'ok';
    const reason: GoVetReason | undefined =
      unmappedFindings > 0 ? 'unmapped-findings' : undefined;
    audit(outcome, packages, reason, goVersion);
    return {
      status: 'checked',
      outcome,
      ...(reason !== undefined ? { reason } : {}),
      diagnostics: parsed.diagnostics,
      diagnosticsTruncated: parsed.truncated,
      checkedFiles,
      skippedFiles,
      notChecked: groupSkipped(skippedFiles),
      unmappedFindings,
    };
  }

  /**
   * A reported position → the workspace path to report. Positions are real
   * paths (the cwd is real); a requested file is reported under the name the
   * caller used, any other file inside the real root under the root as the
   * caller spelled it. Anything else is `null`: outside the workspace.
   */
  private positionMapper(
    root: string,
    rootReal: string,
    vetted: readonly VettedFile[],
  ): PositionMapper {
    const requestedByReal = new Map<string, string>();
    for (const entry of vetted) {
      requestedByReal.set(
        pathKey(entry.realFile, this.platform),
        entry.requested,
      );
    }
    return (file) => {
      let real: string;
      if (isPathWithinRoots(file, [rootReal], this.platform)) {
        real = file;
      } else if (isPathWithinRoots(file, [root], this.platform)) {
        real = path.join(rootReal, path.relative(root, file));
      } else {
        return null;
      }
      return (
        requestedByReal.get(pathKey(real, this.platform)) ??
        path.join(root, path.relative(rootReal, real))
      );
    };
  }
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function notRun(
  reason: GoVetReason,
  skipped: readonly GoVetSkippedFile[],
  staleReason?: GoVetConsentStaleReason,
): GoVetCheckResult {
  return {
    status: 'unchecked',
    outcome: 'not-run',
    reason,
    ...(staleReason !== undefined ? { staleReason } : {}),
    diagnostics: [],
    diagnosticsTruncated: false,
    checkedFiles: [],
    skippedFiles: skipped,
    notChecked: groupSkipped(skipped, staleReason),
    unmappedFindings: 0,
  };
}

function failed(
  outcome: GoVetOutcome,
  reason: GoVetReason,
  skipped: readonly GoVetSkippedFile[],
): GoVetCheckResult {
  return {
    status: 'failed',
    outcome,
    reason,
    diagnostics: [],
    diagnosticsTruncated: false,
    checkedFiles: [],
    skippedFiles: skipped,
    notChecked: groupSkipped(skipped),
    unmappedFindings: 0,
  };
}
