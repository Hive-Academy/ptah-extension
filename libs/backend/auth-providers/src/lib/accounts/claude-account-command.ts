import { stat as statFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { buildCertifiedClaudeEnv, type ClaudeCliDetector } from '@ptah-extension/agent-sdk';
import type { ClaudeCertifiedExecutable, ClaudeCertifiedExecutableFingerprint } from '@ptah-extension/auth-providers-tokens';
import {
  killProcessTree, type IProcessSpawner, type SpawnedProcessHandle, type SpawnLaunchGuard,
} from '@ptah-extension/platform-core';
import type { ProviderAccountActionResult, ProviderAccountResultCode } from '@ptah-extension/shared';
import { parseClaudeAccountStatus, type ClaudeAccountStatus } from './claude-account-status';
import type { ClaudeRegistryQueryResult } from './claude-auth-settings-scan';
import type {
  ClaudeAuthContext,
  ClaudeCliProbe,
  ClaudeExecutableProbeResult,
  ClaudeLogoutProbeResult,
  ClaudeStatusProbeResult,
} from './claude-route-certifier';
import { revalidateProviderAccountRoute, type CanonicalProviderAccountRoute } from './provider-account-route';

const COPY: Record<ProviderAccountResultCode, string> = {
  ok: 'The account operation completed.',
  'missing-profile': 'This account is no longer available.',
  'wrong-provider': 'This action requires a Claude account.',
  'unsupported-store': 'This account store cannot be verified.',
  'unsupported-source': 'The account authentication source cannot be verified.',
  'identity-mismatch': 'The account identity has changed.',
  'identity-unproved': 'The account identity could not be verified.',
  'route-changed': 'The account directory has changed.',
  busy: 'The account is in use or has an unresolved operation.',
  'unavailable-storage': 'Account storage is unavailable.',
  conflict: 'The account changed. Refresh and try again.',
  cancelled: 'Sign in was cancelled. Check status before trying again.',
  timeout: 'The account operation timed out. Check status before trying again.',
  'release-held': 'Named accounts are not available on this host.',
  'invalid-bound': 'The account binding is invalid.',
};

/** Never use an exception message or child text as display copy. */
export function accountActionResult(code: ProviderAccountResultCode): ProviderAccountActionResult {
  return { code, summary: COPY[code] };
}

/** Limits of every account child (implementation-plan.md Component 3). */
export const CLAUDE_ACCOUNT_CHILD_LIMITS = Object.freeze({
  versionMs: 10_000,
  statusMs: 10_000,
  logoutMs: 10_000,
  registryMs: 5_000,
  killGraceMs: 2_000,
  versionOutputBytes: 1_024,
  statusOutputBytes: 16_384,
  registryOutputBytes: 65_536,
});

/** Oldest CLI build whose account store layout is supported. */
const MIN_VERSION = [2, 1, 301] as const;
const VERSION_OUTPUT = /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$/;
/** Hive-relative key paths the policy scan asks for; anything else never reaches `reg.exe`. */
const REGISTRY_PATH = /^(?:HKLM|HKCU)\\[A-Za-z0-9_][A-Za-z0-9 _.\\-]{0,254}$/;

/**
 * Host facts the command reads. Injected so specs never touch the real
 * filesystem, environment or platform; production uses {@link NODE_COMMAND_HOST}.
 */
export interface ClaudeAccountCommandHost {
  readonly platform: NodeJS.Platform;
  /** Source environment for `buildCertifiedClaudeEnv`; read, never mutated. */
  env(): Readonly<Record<string, string | undefined>>;
  tempDir(): string;
  /** Follows links, like `fs.stat`. */
  stat(path: string): Promise<ClaudeCertifiedExecutableFingerprint>;
}

export const NODE_COMMAND_HOST: ClaudeAccountCommandHost = Object.freeze({
  platform: process.platform,
  env: () => process.env,
  tempDir: () => tmpdir(),
  stat: async (path: string) => {
    const facts = await statFile(path);
    return { size: facts.size, mtimeMs: facts.mtimeMs };
  },
});

/**
 * True only while the reserved route still resolves to the same physical
 * directory (path, volume/file id and fingerprint). A missing route never holds.
 * Directory strings alone are never identity proof.
 */
export function claudeAccountRouteHolds(route: CanonicalProviderAccountRoute | undefined): route is CanonicalProviderAccountRoute {
  if (!route) return false;
  try {
    revalidateProviderAccountRoute(route);
    return true;
  } catch {
    // degradation-audit: reported - revalidation throws only route-changed; the caller refuses route-changed.
    return false;
  }
}

/**
 * File-identity guard the spawner re-checks at the instant of creation, on the
 * thread that creates the child (the off-thread worker included).
 */
export function claudeAccountRouteGuard(route: CanonicalProviderAccountRoute): SpawnLaunchGuard {
  return Object.freeze({
    fileIdentities: Object.freeze([Object.freeze({
      path: route.requestedPath,
      realpath: route.canonicalPath,
      devIno: `${route.filesystemIdentity.volumeId}:${route.filesystemIdentity.fileId}`,
    })]),
  });
}

/**
 * Operation-owned proof of one probe child's close. A probe hands it out only
 * when the child outlived its limit and kill grace (`terminated: false`). The
 * child's listeners stay attached until `close` is seen or the owner disposes
 * the receipt; elapsed time or a PID never stands in for the close.
 */
export interface ClaudeChildCloseReceipt {
  /** True once `close` was seen (or the child turned out never to exist). */
  readonly closed: boolean;
  /** Calls `listener` once when the close is seen, at once when it already was. Returns an unsubscribe. */
  onClosed(listener: () => void): () => void;
  /** Removes the child's listeners; a later close is no longer observed. */
  dispose(): void;
}

/** `closeReceipt` is present only when `terminated` is false and a process exists. */
export interface ClaudeStatusProbeOutcome extends ClaudeStatusProbeResult {
  readonly closeReceipt?: ClaudeChildCloseReceipt;
}

/** One ambient status probe: no route, so no launch guard. */
export interface ClaudeAmbientStatusProbeRequest {
  readonly executable: ClaudeCertifiedExecutable;
  /** The complete child env; the caller builds it from an allowlist. */
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

/**
 * Parsed ambient status only; the child's output never leaves the command.
 * `closeReceipt` is present only when `terminated` is false and a process exists.
 */
export interface ClaudeAmbientStatusProbeOutcome {
  /** Null when the child was stopped, did not close on its own, or its output proved no state. */
  readonly status: ClaudeAccountStatus | null;
  readonly terminated: boolean;
  /** True when the status limit stopped the child. */
  readonly timedOut: boolean;
  readonly closeReceipt?: ClaudeChildCloseReceipt;
}

/** `closeReceipt` is present only when `terminated` is false and a process exists. */
export interface ClaudeLogoutProbeOutcome extends ClaudeLogoutProbeResult {
  readonly closeReceipt?: ClaudeChildCloseReceipt;
}

/** `closeReceipt` is present only when `terminated` is false and a process exists. */
export interface ClaudeRegistryProbeOutcome extends ClaudeRegistryQueryResult {
  readonly closeReceipt?: ClaudeChildCloseReceipt;
}

class ChildCloseReceipt implements ClaudeChildCloseReceipt {
  private seen = false;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly detach: () => void) {}

  get closed(): boolean { return this.seen; }

  onClosed(listener: () => void): () => void {
    if (this.seen) { listener(); return () => undefined; }
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    if (this.seen || this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.detach();
  }

  markClosed(): void {
    if (this.seen || this.disposed) return;
    this.seen = true;
    this.detach();
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) listener();
  }
}

interface ChildRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly limitMs: number;
  /** Bytes of stdout kept; 0 drains and discards it. Exceeding it stops the child. */
  readonly outputBytes: number;
  readonly signal: AbortSignal;
  readonly launchGuard?: SpawnLaunchGuard;
}

type ChildStop = 'timeout' | 'cancelled' | 'overflow' | 'error';

interface ChildOutcome {
  /** Null when the child was stopped or never reported an exit code. */
  readonly exitCode: number | null;
  /** Empty unless the child closed on its own within every limit. */
  readonly stdout: string;
  /** True only when `close` was observed or no process was ever created. */
  readonly terminated: boolean;
  readonly stopped?: ChildStop;
  /** Present when `terminated` is false: reports the close when it is finally seen. */
  readonly closeReceipt?: ClaudeChildCloseReceipt;
}

interface CachedExecutable {
  readonly key: string;
  readonly executable: ClaudeCertifiedExecutable;
}

function sameFingerprint(a: ClaudeCertifiedExecutableFingerprint, b: ClaudeCertifiedExecutableFingerprint): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

function belowMinimum(version: readonly number[]): boolean {
  for (let index = 0; index < MIN_VERSION.length; index += 1) {
    if (version[index] !== MIN_VERSION[index]) return version[index] < MIN_VERSION[index];
  }
  return false;
}

function envValue(env: Readonly<Record<string, string>>, name: string): string | undefined {
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function closeReceiptOf(run: ChildOutcome): { readonly closeReceipt?: ClaudeChildCloseReceipt } {
  return run.closeReceipt ? { closeReceipt: run.closeReceipt } : {};
}

const NO_REGISTRY: ClaudeRegistryQueryResult = Object.freeze({
  exitCode: null, stdout: '', terminated: true, timedOut: false, overflow: false,
});

/**
 * The only owner of Claude account child processes (`--version`, `auth status`,
 * `auth logout`) and of the `reg.exe` policy probes. Close is the only
 * termination proof; child output never leaves this class except as parsed
 * facts (status) or as registry text handed to the policy scan.
 */
export class ClaudeAccountCommand implements ClaudeCliProbe {
  private cached: CachedExecutable | null = null;

  constructor(
    private readonly detector: Pick<ClaudeCliDetector, 'findExecutable'>,
    private readonly spawner: IProcessSpawner,
    private readonly host: ClaudeAccountCommandHost = NODE_COMMAND_HOST,
  ) {}

  async certifyExecutable(signal: AbortSignal): Promise<ClaudeExecutableProbeResult> {
    const expiresAt = Date.now() + CLAUDE_ACCOUNT_CHILD_LIMITS.versionMs;
    let installation: Awaited<ReturnType<ClaudeCliDetector['findExecutable']>>;
    try {
      installation = await this.installation(signal, expiresAt);
    } catch (error: unknown) {
      // degradation-audit: reported - discovery stops only by abort, deadline or a detector failure; each is a refusal code.
      const code = error instanceof DiscoveryStop ? error.code : 'unsupported-store';
      return { ok: false, code, terminated: true };
    }
    if (!installation || installation.isWSL || (installation.useDirectExecution && !installation.cliJsPath)) {
      this.cached = null;
      return { ok: false, code: 'unsupported-store', terminated: true };
    }
    const direct = installation.useDirectExecution === true && installation.cliJsPath !== undefined;
    const command = direct ? process.execPath : installation.path;
    const prefixArgs = direct && installation.cliJsPath ? [installation.cliJsPath] : [];
    const sdkExecutablePath = direct && installation.cliJsPath ? installation.cliJsPath : installation.path;
    const key = JSON.stringify([command, ...prefixArgs, sdkExecutablePath]);

    const before = await this.fingerprint(sdkExecutablePath);
    if (!before) {
      this.cached = null;
      return { ok: false, code: 'unsupported-store', terminated: true };
    }
    const cached = this.cached;
    if (cached && cached.key === key && sameFingerprint(cached.executable.fingerprint, before)) {
      return { ok: true, executable: cached.executable, terminated: true };
    }
    this.cached = null;

    let env: Readonly<Record<string, string>>;
    try {
      env = buildCertifiedClaudeEnv(this.host.env(), this.host.tempDir());
    } catch {
      // degradation-audit: reported - the builder throws only for an empty directory; the build cannot be proved.
      return { ok: false, code: 'identity-unproved', terminated: true };
    }
    const run = await this.run({
      command, args: [...prefixArgs, '--version'], env, cwd: this.host.tempDir(),
      limitMs: Math.max(0, expiresAt - Date.now()), outputBytes: CLAUDE_ACCOUNT_CHILD_LIMITS.versionOutputBytes, signal,
    });
    // An unproved child's receipt goes to the caller, which owns it (tracks or disposes it).
    const receipt = closeReceiptOf(run);
    if (run.stopped === 'cancelled') return { ok: false, code: 'cancelled', terminated: run.terminated, ...receipt };
    if (run.stopped === 'timeout') return { ok: false, code: 'timeout', terminated: run.terminated, ...receipt };
    if (!run.terminated || run.exitCode !== 0) {
      return { ok: false, code: 'identity-unproved', terminated: run.terminated, ...receipt };
    }
    const match = VERSION_OUTPUT.exec(run.stdout.trim());
    if (!match) return { ok: false, code: 'identity-unproved', terminated: true };
    const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (belowMinimum(parts)) return { ok: false, code: 'unsupported-store', terminated: true };

    // The fingerprint belongs to the probed build only if it did not change during the probe.
    const after = await this.fingerprint(sdkExecutablePath);
    if (!after) return { ok: false, code: 'unsupported-store', terminated: true };
    if (!sameFingerprint(before, after)) return { ok: false, code: 'identity-unproved', terminated: true };
    const executable: ClaudeCertifiedExecutable = Object.freeze({
      command,
      prefixArgs: Object.freeze([...prefixArgs]),
      sdkExecutablePath,
      version: parts.join('.'),
      fingerprint: Object.freeze({ size: after.size, mtimeMs: after.mtimeMs }),
    });
    this.cached = { key, executable };
    return { ok: true, executable, terminated: true };
  }

  /**
   * `auth status --json` against the reserved route: revalidated before spawn,
   * guarded at creation, and revalidated after close before any status is
   * returned. A changed route yields `routeChanged` and no status.
   */
  async status(context: ClaudeAuthContext, signal: AbortSignal): Promise<ClaudeStatusProbeOutcome> {
    const route = context.route;
    if (!claudeAccountRouteHolds(route)) return { status: null, terminated: true, routeChanged: true };
    const run = await this.run({
      command: context.executable.command, args: [...context.executable.prefixArgs, 'auth', 'status', '--json'],
      env: context.env, cwd: context.cwd, limitMs: CLAUDE_ACCOUNT_CHILD_LIMITS.statusMs,
      outputBytes: CLAUDE_ACCOUNT_CHILD_LIMITS.statusOutputBytes, signal, launchGuard: claudeAccountRouteGuard(route),
    });
    const receipt = closeReceiptOf(run);
    if (!claudeAccountRouteHolds(route)) return { status: null, terminated: run.terminated, routeChanged: true, ...receipt };
    // Exit 0 (signed in) and 1 (signed out) both reach the parser; it checks the pairing.
    const status = run.stopped || !run.terminated
      ? null
      : parseClaudeAccountStatus(run.stdout, run.exitCode, context.canonicalDir, this.host.platform);
    return { status, terminated: run.terminated, ...receipt };
  }

  /**
   * `auth status --json` for the ambient (unnamed) login: the env the caller
   * built, the temp directory as cwd and the status limits. There is no route,
   * so there is no launch guard; {@link status} keeps its route guard. Only the
   * parsed status leaves this method, never the child's output.
   */
  async ambientStatus(request: ClaudeAmbientStatusProbeRequest): Promise<ClaudeAmbientStatusProbeOutcome> {
    const run = await this.run({
      command: request.executable.command, args: [...request.executable.prefixArgs, 'auth', 'status', '--json'],
      env: request.env, cwd: this.host.tempDir(), limitMs: CLAUDE_ACCOUNT_CHILD_LIMITS.statusMs,
      outputBytes: CLAUDE_ACCOUNT_CHILD_LIMITS.statusOutputBytes, signal: request.signal,
    });
    const receipt = closeReceiptOf(run);
    // Same rule as `status`: only a child that closed on its own within every limit is parsed.
    const status = run.stopped || !run.terminated
      ? null
      : parseClaudeAccountStatus(run.stdout, run.exitCode, envValue(request.env, 'CLAUDE_CONFIG_DIR') ?? '', this.host.platform);
    return { status, terminated: run.terminated, timedOut: run.stopped === 'timeout', ...receipt };
  }

  /** `auth logout` with the same route checks as {@link status}. */
  async logout(context: ClaudeAuthContext, signal: AbortSignal): Promise<ClaudeLogoutProbeOutcome> {
    const route = context.route;
    if (!claudeAccountRouteHolds(route)) return { exitCode: null, terminated: true, routeChanged: true };
    const run = await this.run({
      command: context.executable.command, args: [...context.executable.prefixArgs, 'auth', 'logout'],
      env: context.env, cwd: context.cwd, limitMs: CLAUDE_ACCOUNT_CHILD_LIMITS.logoutMs, outputBytes: 0, signal,
      launchGuard: claudeAccountRouteGuard(route),
    });
    const receipt = closeReceiptOf(run);
    if (!claudeAccountRouteHolds(route)) return { exitCode: null, terminated: run.terminated, routeChanged: true, ...receipt };
    return { exitCode: run.stopped ? null : run.exitCode, terminated: run.terminated, ...receipt };
  }

  /** `<SYSTEMROOT>\System32\reg.exe query <path> /reg:64`; win32 only, no other argv. */
  async queryRegistry(path: string, signal: AbortSignal): Promise<ClaudeRegistryProbeOutcome> {
    if (this.host.platform !== 'win32' || !REGISTRY_PATH.test(path) || signal.aborted) return NO_REGISTRY;
    let env: Readonly<Record<string, string>>;
    try {
      env = buildCertifiedClaudeEnv(this.host.env(), this.host.tempDir());
    } catch {
      // degradation-audit: reported - no certified env means no probe; a null exit code is refused by the scan.
      return NO_REGISTRY;
    }
    const systemRoot = envValue(env, 'SYSTEMROOT');
    if (!systemRoot || !win32.isAbsolute(systemRoot)) return NO_REGISTRY;
    const run = await this.run({
      command: win32.join(systemRoot, 'System32', 'reg.exe'), args: ['query', path, '/reg:64'], env,
      cwd: this.host.tempDir(), limitMs: CLAUDE_ACCOUNT_CHILD_LIMITS.registryMs,
      outputBytes: CLAUDE_ACCOUNT_CHILD_LIMITS.registryOutputBytes, signal,
    });
    return {
      exitCode: run.stopped ? null : run.exitCode,
      stdout: run.stdout,
      terminated: run.terminated,
      timedOut: run.stopped === 'timeout',
      overflow: run.stopped === 'overflow',
      ...closeReceiptOf(run),
    };
  }

  private async fingerprint(path: string): Promise<ClaudeCertifiedExecutableFingerprint | null> {
    try {
      const facts = await this.host.stat(path);
      return Number.isFinite(facts.size) && Number.isFinite(facts.mtimeMs) ? facts : null;
    } catch {
      // degradation-audit: reported - a missing or unreadable executable cannot be certified; the caller refuses unsupported-store.
      return null;
    }
  }

  private installation(signal: AbortSignal, expiresAt: number): ReturnType<ClaudeCliDetector['findExecutable']> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
      const cancel = (): void => { cleanup(); reject(new DiscoveryStop('cancelled')); };
      const timer = setTimeout(() => { cleanup(); reject(new DiscoveryStop('timeout')); },
        Math.max(0, expiresAt - Date.now()));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { cancel(); return; }
      // Late discovery may fill the detector cache, but cannot launch an account child.
      Promise.resolve().then(() => this.detector.findExecutable()).then(
        installation => { cleanup(); resolve(installation); },
        () => { cleanup(); reject(new DiscoveryStop('unsupported-store')); },
      );
    });
  }

  /**
   * Spawns one child and waits for its close, or for the kill grace after a stop.
   * A child still open after the grace resolves `terminated: false` with a close
   * receipt; its listeners stay until the close is seen or the receipt is disposed.
   */
  private run(request: ChildRequest): Promise<ChildOutcome> {
    let child: SpawnedProcessHandle;
    try {
      child = this.spawner.spawnProcess({
        command: request.command, args: request.args, env: request.env, cwd: request.cwd, detached: true,
        ...(request.launchGuard ? { launchGuard: request.launchGuard } : {}),
      });
    } catch {
      // degradation-audit: reported - a refused spawn creates no process; reported as a stopped child.
      return Promise.resolve({ exitCode: null, stdout: '', terminated: true, stopped: 'error' });
    }
    return new Promise(resolve => {
      let output = '';
      let bytes = 0;
      let stopped: ChildStop | undefined;
      let settled = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      // Set only when the child outlived the grace; it then owns the listeners below.
      let receipt: ChildCloseReceipt | undefined;
      // A late PID must never be killed after close, so close stays observed until the PID is known,
      // even when receipt disposal detaches the listeners below.
      let exited = false;
      let pidKnown = false;
      const exitSeen = (): void => { exited = true; };
      const detach = (): void => {
        child.stdout?.off('data', data);
        child.stderr?.off('data', discard);
        child.off('close', close);
        child.off('error', failed);
        if (!pidKnown && !exited) child.once('close', exitSeen);
      };
      const pidSettled = (): void => {
        pidKnown = true;
        child.off('close', exitSeen);
      };
      // degradation-audit: optional-capability — a rejected PID only ends the wait for it; stop() reports the kill path.
      void child.whenSpawned.then(pidSettled, pidSettled);
      const finish = (outcome: ChildOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (grace) clearTimeout(grace);
        request.signal.removeEventListener('abort', cancel);
        if (!outcome.closeReceipt) detach();
        output = '';
        resolve(outcome);
      };
      const stop = (reason: ChildStop): void => {
        if (settled || stopped) return;
        stopped = reason;
        output = '';
        grace = setTimeout(() => {
          // Close is still unseen: keep observing, and let the receipt report the close when it comes.
          receipt = new ChildCloseReceipt(detach);
          finish({ exitCode: null, stdout: '', terminated: false, stopped: reason, closeReceipt: receipt });
        }, CLAUDE_ACCOUNT_CHILD_LIMITS.killGraceMs);
        void child.whenSpawned.then(pid => {
          if (pid === null) {
            // Never spawned: no process exists, so termination is established now.
            if (settled) receipt?.markClosed();
            else finish({ exitCode: null, stdout: '', terminated: true, stopped: reason });
            return undefined;
          }
          // A closed child is never killed: its PID may already belong to another process. Settled
          // with an open child means the grace ran out before the PID came: the kill is still owed.
          if (exited || (settled && !receipt)) return undefined;
          // Tree kill is best effort. Only close proves termination.
          return killProcessTree(pid, 'SIGKILL');
        }).catch(() => {
          // degradation-audit: optional-capability — a failed tree kill leaves termination unproved until close
        });
      };
      const cancel = (): void => stop('cancelled');
      const discard = (): void => { /* Drain stderr without retaining or reading it. */ };
      const data = (chunk: unknown): void => {
        if (stopped) return;
        if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) { stop('overflow'); return; }
        const size = Buffer.byteLength(chunk);
        if (bytes + size > request.outputBytes) {
          if (request.outputBytes === 0) return;
          stop('overflow');
          return;
        }
        bytes += size;
        output += chunk.toString();
      };
      const failed = (): void => stop('error');
      const close = (code: number | null): void => {
        exited = true;
        // A close after the grace is the late termination proof the receipt carries.
        if (settled) { receipt?.markClosed(); return; }
        if (stopped) { finish({ exitCode: null, stdout: '', terminated: true, stopped }); return; }
        finish({ exitCode: code, stdout: output, terminated: true });
      };
      const deadline = setTimeout(() => stop('timeout'), request.limitMs);
      child.on('close', close);
      child.on('error', failed);
      child.stdout?.on('data', data);
      child.stderr?.on('data', discard);
      request.signal.addEventListener('abort', cancel, { once: true });
      child.stdin?.end();
      if (request.signal.aborted) cancel();
    });
  }
}

class DiscoveryStop extends Error {
  constructor(readonly code: 'cancelled' | 'timeout' | 'unsupported-store') {
    super(code);
    this.name = 'DiscoveryStop';
  }
}
