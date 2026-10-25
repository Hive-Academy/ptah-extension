import { buildCertifiedClaudeEnv, certifiedEnvDigest } from '@ptah-extension/agent-sdk';
import type {
  ClaudeCertifiedExecutable,
  ClaudeCertifiedLaunchContext,
  ClaudeCertifiedLaunchPolicy,
  ClaudeCertifiedSettingSource,
  ClaudeLaunchBoundaryOutcome,
} from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountResultCode } from '@ptah-extension/shared';
import type { ClaudeChildCloseReceipt } from './claude-account-command';
import type { ClaudeAccountStatus } from './claude-account-status';
import {
  claudePolicyCoverage,
  claudeRemoteSignalsAbsent,
  scanClaudeAuthPolicy,
  type ClaudePolicyCoverageEntry,
  type ClaudePolicyScanFs,
  type ClaudeRegistryQueryResult,
} from './claude-auth-settings-scan';
import { revalidateProviderAccountRoute, type CanonicalProviderAccountRoute } from './provider-account-route';

/** Oldest CLI build whose account store layout is supported. */
const MIN_SUPPORTED_VERSION = [2, 1, 301] as const;

/**
 * Settings-free context for one account directory. Auth operations (sign-in,
 * status, sign-out) run with `cwd = canonicalDir`; a run certification runs its
 * status child with the run `cwd`. Backend-only: never logged or sent over RPC.
 */
export interface ClaudeAuthContext {
  readonly canonicalDir: string;
  readonly cwd: string;
  readonly executable: ClaudeCertifiedExecutable;
  readonly env: Readonly<Record<string, string>>;
  readonly envDigest: string;
  readonly policy: ClaudeCertifiedLaunchPolicy;
  /**
   * The route the store reserved. Every account child revalidates it before
   * spawn, guards its creation with its file identity and revalidates it after
   * close; an absent route never launches (refused as route-changed).
   */
  readonly route?: CanonicalProviderAccountRoute;
}

export type ClaudeExecutableProbeResult =
  | { readonly ok: true; readonly executable: ClaudeCertifiedExecutable; readonly terminated: boolean }
  | {
      readonly ok: false;
      readonly code: 'unsupported-store' | 'unsupported-source' | 'identity-unproved' | 'cancelled' | 'timeout';
      readonly terminated: boolean;
    };

/** `status` is `null` when the child output proves no state (spawn error, timeout, unparseable). */
export interface ClaudeStatusProbeResult {
  readonly status: ClaudeAccountStatus | null;
  readonly terminated: boolean;
  /** The reserved route did not hold before spawn or after close; `status` is then null. */
  readonly routeChanged?: true;
}

export interface ClaudeLogoutProbeResult {
  readonly exitCode: number | null;
  readonly terminated: boolean;
  /** The reserved route did not hold before spawn or after close; `exitCode` is then null. */
  readonly routeChanged?: true;
}

/**
 * Owner of every account child process (implemented structurally by
 * `ClaudeAccountCommand`). `terminated` is false when a child's close was not
 * observed; the caller then retains its lease.
 */
export interface ClaudeCliProbe {
  /** `--version` in `os.tmpdir()` with the certified env; cached by path and stat fingerprint. */
  certifyExecutable(signal: AbortSignal): Promise<ClaudeExecutableProbeResult>;
  /** `auth status --json` with `context.env` and `context.cwd`. */
  status(context: ClaudeAuthContext, signal: AbortSignal): Promise<ClaudeStatusProbeResult>;
  /** `auth logout` with `context.env` and `context.cwd`. */
  logout(context: ClaudeAuthContext, signal: AbortSignal): Promise<ClaudeLogoutProbeResult>;
  /** `reg.exe query <path> /reg:64` (win32). Output reaches the policy scan only. */
  queryRegistry(path: string, signal: AbortSignal): Promise<ClaudeRegistryQueryResult>;
}

/** Read-only filesystem access of the certifier. `stat` follows links. */
export interface ClaudeRouteCertifierFs extends ClaudePolicyScanFs {
  stat(path: string): Promise<{ readonly size: number; readonly mtimeMs: number }>;
}

export type ClaudeCertificationRefusalCode = Extract<
  ProviderAccountResultCode,
  'unsupported-source' | 'unsupported-store' | 'identity-mismatch' | 'identity-unproved' | 'route-changed' | 'cancelled' | 'timeout'
>;

export interface ClaudeCertificationRefusal {
  readonly ok: false;
  readonly code: ClaudeCertificationRefusalCode;
  /** False when any owned child's close (registry probes included) was not observed. */
  readonly terminated: boolean;
}

/**
 * A refusal of an auth-operation step. `closeReceipts` is present only when
 * `terminated` is false and every unproved `reg.exe` child of the policy scan
 * handed out a close receipt; the caller then owns (and must track or dispose)
 * each one. Without it, an unterminated refusal has an unobservable child.
 */
export interface ClaudeProbeRefusal extends ClaudeCertificationRefusal {
  readonly closeReceipts?: readonly ClaudeChildCloseReceipt[];
}

export type ClaudeAuthContextOutcome = { readonly ok: true; readonly context: ClaudeAuthContext } | ClaudeProbeRefusal;

export type ClaudeCoverageOutcome = { readonly ok: true } | ClaudeProbeRefusal;

export type ClaudeRouteCertification =
  | { readonly ok: true; readonly launch: ClaudeCertifiedLaunchContext }
  | ClaudeCertificationRefusal;

export interface ClaudeAuthContextRequest {
  readonly route: CanonicalProviderAccountRoute;
  readonly signal: AbortSignal;
}

export interface ClaudeRouteCertifyRequest extends ClaudeAuthContextRequest {
  /** Stored profile identity. `identityRef` is null until a status recorded it. */
  readonly profile: { readonly identityRef: string | null };
  readonly cwd: string;
  readonly settingSources: readonly ClaudeCertifiedSettingSource[];
}

function parseVersion(version: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function belowMinimum(version: readonly [number, number, number]): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] !== MIN_SUPPORTED_VERSION[index]) return version[index] < MIN_SUPPORTED_VERSION[index];
  }
  return false;
}

function refuse(code: ClaudeCertificationRefusalCode, terminated: boolean): ClaudeCertificationRefusal {
  return { ok: false, code, terminated };
}

/**
 * For callers that cannot follow a late close (run certification, run
 * boundary): disposes the receipts, which removes the children's listeners,
 * and keeps `terminated` false so the caller still retains its lease.
 */
function withoutReceipts(refusal: ClaudeProbeRefusal): ClaudeCertificationRefusal {
  for (const receipt of refusal.closeReceipts ?? []) receipt.dispose();
  return refuse(refusal.code, refusal.terminated);
}

/**
 * Certifies a named Claude route (implementation-plan.md Component 4a). Every
 * settings-reading child is preceded by the coverage entry and the policy scan
 * for its context. Results carry codes only: no path, value or CLI text.
 */
export class ClaudeRouteCertifier {
  constructor(
    private readonly probe: ClaudeCliProbe,
    private readonly platform: NodeJS.Platform,
    private readonly fs: ClaudeRouteCertifierFs,
  ) {}

  /** Steps 1-5 with `cwd = canonicalDir`, for sign-in, status and sign-out. */
  async authContext(request: ClaudeAuthContextRequest): Promise<ClaudeAuthContextOutcome> {
    return this.prepare(request.route.canonicalPath, request.route, request.signal);
  }

  /** Re-runs steps 1-2 (S9 signals included) before a settings-reading auth child. */
  async checkCoverage(context: ClaudeAuthContext, signal: AbortSignal): Promise<ClaudeCoverageOutcome> {
    const entry = claudePolicyCoverage(this.platform);
    if (!entry || entry.id !== context.policy.coverage) return refuse('unsupported-source', true);
    const scan = await this.scan(context.cwd, context.canonicalDir, entry, signal, context.executable.version);
    return scan.ok ? { ok: true } : scan;
  }

  /** Steps 1-8 for a named run. */
  async certify(request: ClaudeRouteCertifyRequest): Promise<ClaudeRouteCertification> {
    const { route, profile, signal } = request;
    const canonicalDir = route.canonicalPath;
    const prepared = await this.prepare(request.cwd, route, signal);
    if (!prepared.ok) return withoutReceipts(prepared);
    const context = prepared.context;
    let terminated = true;

    // Step 6: the only settings-reading child of certification, and the class read (D13).
    if (signal.aborted) return refuse('cancelled', terminated);
    const probed = await this.probe.status(context, signal);
    terminated = terminated && probed.terminated;
    if (probed.routeChanged) return refuse('route-changed', terminated);
    if (!probed.terminated) return refuse('identity-unproved', false);
    const status = probed.status;
    if (!status || !status.loggedIn) return refuse('identity-unproved', terminated);
    // Step 6b: class O refuses before any identity comparison (D14 note 2).
    if (status.accountClass !== 'P') return refuse('unsupported-source', terminated);
    if (profile.identityRef === null) return refuse('identity-unproved', terminated);
    if (!status.configDirectoryMatches || status.identityReference !== profile.identityRef) {
      return refuse('identity-mismatch', terminated);
    }

    // Step 7: a refusal signal only; absence proves nothing.
    if (!(await claudeRemoteSignalsAbsent(canonicalDir, this.platform, this.fs))) {
      return refuse('unsupported-source', terminated);
    }

    // Step 8.
    try {
      revalidateProviderAccountRoute(route);
    } catch {
      // degradation-audit: reported - revalidation throws only route-changed; it becomes the refusal code.
      return refuse('route-changed', terminated);
    }

    return {
      ok: true,
      launch: Object.freeze({
        executable: context.executable,
        env: context.env,
        envDigest: context.envDigest,
        cwd: context.cwd,
        settingSources: Object.freeze([...request.settingSources]),
        policy: context.policy,
        accountClass: 'personal',
        identityReference: profile.identityRef,
      }),
    };
  }

  /**
   * Run-boundary check before one SDK child starts. Starts no Claude child (its
   * only children are `reg.exe` probes) and never re-runs `--version`.
   */
  async checkLaunch(launch: ClaudeCertifiedLaunchContext, signal: AbortSignal): Promise<ClaudeLaunchBoundaryOutcome> {
    if (launch.accountClass !== 'personal') return { ok: false, code: 'unsupported-source', terminated: true };
    const entry = claudePolicyCoverage(this.platform);
    if (!entry || entry.id !== launch.policy.coverage) return { ok: false, code: 'unsupported-source', terminated: true };
    const canonicalDir = launch.env['CLAUDE_CONFIG_DIR'];
    if (!canonicalDir) return { ok: false, code: 'identity-unproved', terminated: true };

    const scan = await this.scan(launch.cwd, canonicalDir, entry, signal, launch.executable.version);
    if (!scan.ok) {
      withoutReceipts(scan);
      return { ok: false, code: scan.code === 'cancelled' ? 'identity-unproved' : 'unsupported-source', terminated: scan.terminated };
    }

    const expected = launch.executable.fingerprint;
    try {
      const current = await this.fs.stat(launch.executable.sdkExecutablePath);
      if (current.size !== expected.size || current.mtimeMs !== expected.mtimeMs) {
        return { ok: false, code: 'identity-unproved', terminated: true };
      }
    } catch {
      // degradation-audit: reported - an unreadable executable cannot prove the certified build; refused as identity-unproved.
      return { ok: false, code: 'identity-unproved', terminated: true };
    }
    return { ok: true };
  }

  /** Steps 1-5: coverage, scan, executable, env. */
  private async prepare(cwd: string, route: CanonicalProviderAccountRoute, signal: AbortSignal): Promise<ClaudeAuthContextOutcome> {
    const canonicalDir = route.canonicalPath;
    const entry = claudePolicyCoverage(this.platform);
    if (!entry) return refuse('unsupported-source', true);

    const scan = await this.scan(cwd, canonicalDir, entry, signal);
    if (!scan.ok) return scan;

    if (signal.aborted) return refuse('cancelled', true);
    const probed = await this.probe.certifyExecutable(signal);
    if (!probed.ok) return refuse(probed.code, probed.terminated);
    if (!probed.terminated) return refuse('identity-unproved', false);
    const version = parseVersion(probed.executable.version);
    if (!version) return refuse('identity-unproved', true);
    if (belowMinimum(version)) return refuse('unsupported-store', true);
    if (!entry.versions.includes(probed.executable.version)) return refuse('unsupported-source', true);

    let env: Readonly<Record<string, string>>;
    try {
      env = buildCertifiedClaudeEnv(process.env, canonicalDir);
    } catch {
      // degradation-audit: reported - the builder throws only ClaudeCertifiedLaunchRefusal('identity-unproved') for an empty directory.
      return refuse('identity-unproved', true);
    }
    return {
      ok: true,
      context: Object.freeze({
        canonicalDir,
        cwd,
        executable: probed.executable,
        env,
        envDigest: certifiedEnvDigest(env),
        policy: scan.policy,
        route,
      }),
    };
  }

  private async scan(
    cwd: string,
    canonicalDir: string,
    coverage: ClaudePolicyCoverageEntry,
    signal: AbortSignal,
    knownVersion?: string,
  ): Promise<{ readonly ok: true; readonly policy: ClaudeCertifiedLaunchPolicy } | ClaudeProbeRefusal> {
    const result = await scanClaudeAuthPolicy({
      cwd,
      canonicalDir,
      platform: this.platform,
      coverage,
      ...(knownVersion === undefined ? {} : { knownVersion }),
      fs: this.fs,
      queryRegistry: (path, querySignal) => this.probe.queryRegistry(path, querySignal),
      signal,
    });
    if (result.ok) return { ok: true, policy: result.policy };
    const refusal = refuse(result.code, result.terminated);
    return result.closeReceipts ? { ...refusal, closeReceipts: result.closeReceipts } : refusal;
  }
}
