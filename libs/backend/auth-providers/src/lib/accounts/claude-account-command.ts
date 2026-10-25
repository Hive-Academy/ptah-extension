import { stat as statFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { buildCertifiedClaudeEnv, type ClaudeCliDetector } from '@ptah-extension/agent-sdk';
import type { ClaudeCertifiedExecutable, ClaudeCertifiedExecutableFingerprint } from '@ptah-extension/auth-providers-tokens';
import { killProcessTree, type IProcessSpawner, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import type { ProviderAccountActionResult, ProviderAccountResultCode } from '@ptah-extension/shared';
import { parseClaudeAccountStatus } from './claude-account-status';
import type { ClaudeRegistryQueryResult } from './claude-auth-settings-scan';
import type {
  ClaudeAuthContext,
  ClaudeCliProbe,
  ClaudeExecutableProbeResult,
  ClaudeLogoutProbeResult,
  ClaudeStatusProbeResult,
} from './claude-route-certifier';

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

interface ChildRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly limitMs: number;
  /** Bytes of stdout kept; 0 drains and discards it. Exceeding it stops the child. */
  readonly outputBytes: number;
  readonly signal: AbortSignal;
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
    if (run.stopped === 'cancelled') return { ok: false, code: 'cancelled', terminated: run.terminated };
    if (run.stopped === 'timeout') return { ok: false, code: 'timeout', terminated: run.terminated };
    if (!run.terminated || run.exitCode !== 0) return { ok: false, code: 'identity-unproved', terminated: run.terminated };
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

  async status(context: ClaudeAuthContext, signal: AbortSignal): Promise<ClaudeStatusProbeResult> {
    const run = await this.run({
      command: context.executable.command, args: [...context.executable.prefixArgs, 'auth', 'status', '--json'],
      env: context.env, cwd: context.cwd, limitMs: CLAUDE_ACCOUNT_CHILD_LIMITS.statusMs,
      outputBytes: CLAUDE_ACCOUNT_CHILD_LIMITS.statusOutputBytes, signal,
    });
    // Exit 0 (signed in) and 1 (signed out) both reach the parser; it checks the pairing.
    const status = run.stopped || !run.terminated
      ? null
      : parseClaudeAccountStatus(run.stdout, run.exitCode, context.canonicalDir, this.host.platform);
    return { status, terminated: run.terminated };
  }

  async logout(context: ClaudeAuthContext, signal: AbortSignal): Promise<ClaudeLogoutProbeResult> {
    const run = await this.run({
      command: context.executable.command, args: [...context.executable.prefixArgs, 'auth', 'logout'],
      env: context.env, cwd: context.cwd, limitMs: CLAUDE_ACCOUNT_CHILD_LIMITS.logoutMs, outputBytes: 0, signal,
    });
    return { exitCode: run.stopped ? null : run.exitCode, terminated: run.terminated };
  }

  /** `<SYSTEMROOT>\System32\reg.exe query <path> /reg:64`; win32 only, no other argv. */
  async queryRegistry(path: string, signal: AbortSignal): Promise<ClaudeRegistryQueryResult> {
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

  /** Spawns one child and observes it until close, or until the kill grace after a stop. */
  private run(request: ChildRequest): Promise<ChildOutcome> {
    let child: SpawnedProcessHandle;
    try {
      child = this.spawner.spawnProcess({
        command: request.command, args: request.args, env: request.env, cwd: request.cwd, detached: true,
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
      const finish = (outcome: ChildOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (grace) clearTimeout(grace);
        request.signal.removeEventListener('abort', cancel);
        child.stdout?.off('data', data);
        child.stderr?.off('data', discard);
        child.off('close', close);
        child.off('error', failed);
        output = '';
        resolve(outcome);
      };
      const stop = (reason: ChildStop): void => {
        if (settled || stopped) return;
        stopped = reason;
        output = '';
        grace = setTimeout(() => finish({ exitCode: null, stdout: '', terminated: false, stopped: reason }),
          CLAUDE_ACCOUNT_CHILD_LIMITS.killGraceMs);
        void child.whenSpawned.then(pid => {
          if (settled) return undefined;
          if (pid === null) {
            // Never spawned: no process exists, so termination is established now.
            finish({ exitCode: null, stdout: '', terminated: true, stopped: reason });
            return undefined;
          }
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
