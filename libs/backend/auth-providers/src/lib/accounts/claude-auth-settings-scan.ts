import { posix, win32 } from 'node:path';
import { claudeSettingsOverride } from '@ptah-extension/agent-sdk';
import type { ClaudeCertifiedLaunchPolicy } from '@ptah-extension/auth-providers-tokens';
import type { ClaudeChildCloseReceipt } from './claude-account-command';

/**
 * Policy sources of one inspected Claude CLI build (implementation-plan.md
 * Component 4, rows S1-S12). Every source in an entry must resolve; the first
 * unresolved source refuses.
 */
export type ClaudePolicySourceId =
  | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S11' | 'S12';

/** One inspected CLI build: exact versions and the closed set of its policy sources. */
export interface ClaudePolicyCoverageEntry {
  readonly id: string;
  readonly platform: NodeJS.Platform;
  /** Exact `x.y.z` versions; any other version refuses. */
  readonly versions: readonly string[];
  /** Directory of the machine-managed settings file and its drop-in directory. */
  readonly managedSettingsDir: string;
  readonly sources: readonly ClaudePolicySourceId[];
}

/**
 * Closed, data-only coverage table. Adding a row needs the same read-only
 * inspection of the CLI build, recorded in research-report.md. darwin and
 * linux have no entry and refuse (Decision D-P).
 */
export const CLAUDE_POLICY_COVERAGE: readonly ClaudePolicyCoverageEntry[] = Object.freeze([
  Object.freeze({
    id: 'win32@2.1.310',
    platform: 'win32',
    versions: Object.freeze(['2.1.310']),
    managedSettingsDir: 'C:\\Program Files\\ClaudeCode',
    sources: Object.freeze([
      'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12',
    ] as const),
  }),
]);

/** The coverage entry for `platform`, or `null` when the platform has none. */
export function claudePolicyCoverage(platform: NodeJS.Platform): ClaudePolicyCoverageEntry | null {
  return CLAUDE_POLICY_COVERAGE.find((entry) => entry.platform === platform) ?? null;
}

/** Server-managed settings cache and consent files under the Claude config home (S9). */
export const CLAUDE_REMOTE_SETTINGS_FILES = Object.freeze([
  'remote-settings.json',
  'remote-settings-consent.json',
  'remote-settings-helper-consent',
] as const);

export interface ClaudePolicyDirEntry {
  readonly name: string;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** Read-only filesystem access. Errors carry a Node `code` (`ENOENT` means absent). */
export interface ClaudePolicyScanFs {
  /** UTF-8 file content. */
  readFile(path: string): Promise<string>;
  /** Resolves when the path itself exists (links are not followed). */
  lstat(path: string): Promise<unknown>;
  readdir(path: string): Promise<readonly ClaudePolicyDirEntry[]>;
}

/** One `reg.exe query <path> /reg:64` run (Component 3). `exitCode` is null when none was seen. */
export interface ClaudeRegistryQueryResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly terminated: boolean;
  readonly timedOut: boolean;
  readonly overflow: boolean;
  /** Present only when `terminated` is false and a process exists: reports its late close. */
  readonly closeReceipt?: ClaudeChildCloseReceipt;
}

export type ClaudeRegistryQuery = (path: string, signal: AbortSignal) => Promise<ClaudeRegistryQueryResult>;

export interface ClaudeAuthPolicyScanRequest {
  readonly cwd: string;
  readonly canonicalDir: string;
  readonly platform: NodeJS.Platform;
  readonly coverage: ClaudePolicyCoverageEntry | null;
  /** Set when the caller already knows the CLI version; an uncovered version refuses before any I/O. */
  readonly knownVersion?: string;
  readonly fs: ClaudePolicyScanFs;
  readonly queryRegistry: ClaudeRegistryQuery;
  readonly signal: AbortSignal;
}

/**
 * Scan outcome. It carries no path, file content or registry output.
 * `terminated` is false when the close of a `reg.exe` child was not observed
 * (lease settlement retains in that case).
 *
 * `closeReceipts` is present only on an unterminated refusal whose every
 * unproved `reg.exe` child handed out a close receipt. The caller owns them:
 * each reports its child's late close, and disposing it removes the child's
 * listeners. When any unproved child cannot be observed (the query threw or
 * returned no receipt), no receipt is returned and the scan has disposed them.
 */
export type ClaudeAuthPolicyScanResult =
  | { readonly ok: true; readonly policy: ClaudeCertifiedLaunchPolicy; readonly terminated: true }
  | {
      readonly ok: false;
      readonly code: 'unsupported-source' | 'cancelled';
      readonly terminated: boolean;
      readonly closeReceipts?: readonly ClaudeChildCloseReceipt[];
    };

const MAX_SETTINGS_BYTES = 256 * 1024;
const MAX_ANCESTORS = 64;
const MAX_DROP_IN_ENTRIES = 32;
const REGISTRY_HIVES = ['HKLM', 'HKCU'] as const;

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly enoent: boolean };
type FileOutcome = 'absent' | 'scanned' | 'refused';

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function settle<T>(operation: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    // degradation-audit: reported - the error becomes a settled outcome; every caller refuses unless it is ENOENT.
    return { ok: false, enoent: isEnoent(error) };
  }
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // degradation-audit: reported - unparseable settings become a malformed outcome that refuses the scan.
    return { ok: false };
  }
}

/** `HKLM\` / `HKCU\` become the long root names `reg.exe` prints. */
function normalizeRegistryPath(path: string): string {
  return path.replace(/^HKLM\\/i, 'HKEY_LOCAL_MACHINE\\').replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\');
}

/**
 * Lower-cased subkey names of a successful listing, or `null` when the output is
 * malformed. Blank lines are ignored. `reg.exe` prints the queried-path header
 * only when the key has values, followed by four-space value lines; a key
 * without values prints its subkey lines alone (implementation-plan.md
 * Component 4, verified output). So a well-formed listing names the queried key
 * structurally: it has the header or at least one subkey line. Empty,
 * whitespace-only and value-only output (a value line before any header) is
 * malformed, so a missing subkey is never read from an unrecognised listing.
 * Value lines are never kept.
 */
function registrySubkeys(queriedPath: string, result: ClaudeRegistryQueryResult): ReadonlySet<string> | null {
  if (result.overflow) return null;
  const queried = normalizeRegistryPath(queriedPath).toLowerCase();
  const names = new Set<string>();
  let headerSeen = false;
  for (const raw of result.stdout.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    if (raw.startsWith('    ')) {
      if (!headerSeen) return null;
      continue;
    }
    const line = normalizeRegistryPath(raw.trimEnd()).toLowerCase();
    if (line === queried) {
      headerSeen = true;
      continue;
    }
    if (!line.startsWith(`${queried}\\`)) return null;
    const name = line.slice(queried.length + 1);
    if (name === '' || name.includes('\\')) return null;
    names.add(name);
  }
  return headerSeen || names.size > 0 ? names : null;
}

function pathsFor(platform: NodeJS.Platform): typeof win32 {
  return platform === 'win32' ? win32 : posix;
}

/**
 * True when none of the three S9 files exists under `canonicalDir`. A present
 * file or any `lstat` error other than ENOENT is a refusal signal. Absence
 * proves nothing about remote policy; it is recorded only.
 */
export async function claudeRemoteSignalsAbsent(
  canonicalDir: string,
  platform: NodeJS.Platform,
  fs: Pick<ClaudePolicyScanFs, 'lstat'>,
): Promise<boolean> {
  const paths = pathsFor(platform);
  for (const name of CLAUDE_REMOTE_SETTINGS_FILES) {
    const probe = await settle(() => fs.lstat(paths.join(canonicalDir, name)));
    if (probe.ok || !probe.enoent) return false;
  }
  return true;
}

class PolicyScanRun {
  private readonly paths: typeof win32;
  terminated = true;
  /** Close receipts of unproved `reg.exe` children. */
  private readonly receipts: ClaudeChildCloseReceipt[] = [];
  /** True when an unproved child left no receipt (the query threw or returned none). */
  private unobservable = false;
  managedFile: ClaudeCertifiedLaunchPolicy['managedFile'] = 'absent';
  managedDropIn: ClaudeCertifiedLaunchPolicy['managedDropIn'] = 'absent';
  registry: ClaudeCertifiedLaunchPolicy['registry'] = 'not-applicable';

  constructor(
    private readonly request: ClaudeAuthPolicyScanRequest,
    private readonly entry: ClaudePolicyCoverageEntry,
  ) {
    this.paths = pathsFor(entry.platform);
  }

  /** True when the source is scanned or positively absent. */
  async resolve(source: ClaudePolicySourceId): Promise<boolean> {
    const { cwd, canonicalDir } = this.request;
    switch (source) {
      case 'S1':
        return (await this.scanFile(this.paths.join(canonicalDir, 'settings.json'))) !== 'refused';
      case 'S2':
        return (await this.scanFile(this.paths.join(cwd, '.claude', 'settings.json'))) !== 'refused';
      case 'S3':
        return (await this.scanFile(this.paths.join(cwd, '.claude', 'settings.local.json'))) !== 'refused';
      case 'S4':
        return this.ancestorsClear();
      case 'S5':
        return this.scanManagedFile();
      case 'S6':
        return this.scanDropIn();
      case 'S7':
        return this.registryAbsent();
      case 'S9':
        return claudeRemoteSignalsAbsent(canonicalDir, this.entry.platform, this.request.fs);
      // S8: native execution only (WSL execution is refused at launch).
      // S10: the child env is allowlist-built and digest-checked at each boundary.
      // S11 / S12: `assertCertifiedLaunch` checks flag settings and refuses any
      // managed-settings channel; `enabledPlugins` refuses in every scanned file.
      case 'S8':
      case 'S10':
      case 'S11':
      case 'S12':
        return true;
    }
  }

  private async scanFile(path: string): Promise<FileOutcome> {
    const read = await settle(() => this.request.fs.readFile(path));
    if (!read.ok) return read.enoent ? 'absent' : 'refused';
    if (Buffer.byteLength(read.value, 'utf8') > MAX_SETTINGS_BYTES) return 'refused';
    const parsed = parseJson(read.value);
    if (!parsed.ok) return 'refused';
    return claudeSettingsOverride(parsed.value) === 'none' ? 'scanned' : 'refused';
  }

  private async scanManagedFile(): Promise<boolean> {
    const outcome = await this.scanFile(this.paths.join(this.entry.managedSettingsDir, 'managed-settings.json'));
    if (outcome === 'refused') return false;
    this.managedFile = outcome;
    return true;
  }

  private async scanDropIn(): Promise<boolean> {
    const directory = this.paths.join(this.entry.managedSettingsDir, 'managed-settings.d');
    const listed = await settle(() => this.request.fs.readdir(directory));
    if (!listed.ok) return listed.enoent;
    if (listed.value.length > MAX_DROP_IN_ENTRIES) return false;
    const loadable = [...listed.value]
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .filter((entry) => !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.json'))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (listed.value.some((entry) => entry.isSymbolicLink())) return false;
    for (const entry of loadable) {
      // A file that vanished between readdir and read is not proven absent.
      if ((await this.scanFile(this.paths.join(directory, entry.name))) !== 'scanned') return false;
    }
    this.managedDropIn = loadable.length > 0 ? 'scanned' : 'absent';
    return true;
  }

  private async ancestorsClear(): Promise<boolean> {
    const ancestors: string[] = [];
    let current = this.paths.normalize(this.request.cwd);
    for (let parent = this.paths.dirname(current); parent !== current; parent = this.paths.dirname(current)) {
      ancestors.push(parent);
      if (ancestors.length > MAX_ANCESTORS) return false;
      current = parent;
    }
    for (const ancestor of ancestors) {
      const git = await settle(() => this.request.fs.lstat(this.paths.join(ancestor, '.git')));
      if (!git.ok && git.enoent) continue;
      if (!git.ok) return false;
      const local = await settle(() =>
        this.request.fs.lstat(this.paths.join(ancestor, '.claude', 'settings.local.json')),
      );
      if (local.ok || !local.enoent) return false;
    }
    return true;
  }

  private async registryAbsent(): Promise<boolean> {
    for (const hive of REGISTRY_HIVES) {
      if (!(await this.hiveAbsent(hive))) return false;
    }
    this.registry = 'absent';
    return true;
  }

  private async hiveAbsent(hive: (typeof REGISTRY_HIVES)[number]): Promise<boolean> {
    const policiesPath = `${hive}\\SOFTWARE\\Policies`;
    const policies = await this.query(policiesPath);
    if (!policies) return false;
    if (policies.exitCode === 0) {
      const subkeys = registrySubkeys(policiesPath, policies);
      return subkeys !== null && !subkeys.has('claudecode');
    }
    // A non-zero exit cannot tell absent from unreadable; stderr is never read.
    // The parent must list and must not contain `Policies`.
    const parentPath = `${hive}\\SOFTWARE`;
    const parent = await this.query(parentPath);
    if (!parent || parent.exitCode !== 0) return false;
    const subkeys = registrySubkeys(parentPath, parent);
    return subkeys !== null && !subkeys.has('policies');
  }

  /**
   * The refusal for this run: unterminated runs hand their receipts to the
   * caller only when every unproved child has one; otherwise they are disposed.
   */
  refusal(code: 'unsupported-source' | 'cancelled'): ClaudeAuthPolicyScanResult {
    if (this.terminated) return { ok: false, code, terminated: true };
    if (this.unobservable || this.receipts.length === 0) {
      for (const receipt of this.receipts) receipt.dispose();
      return { ok: false, code, terminated: false };
    }
    return { ok: false, code, terminated: false, closeReceipts: Object.freeze([...this.receipts]) };
  }

  /** A completed query, or `null` when it threw, timed out or its close was not observed. */
  private async query(path: string): Promise<ClaudeRegistryQueryResult | null> {
    const run = await settle(() => this.request.queryRegistry(path, this.request.signal));
    if (!run.ok) {
      // The probe could not report a close, so no termination is proven.
      this.terminated = false;
      this.unobservable = true;
      return null;
    }
    const { closeReceipt } = run.value;
    if (!run.value.terminated) {
      this.terminated = false;
      if (closeReceipt) this.receipts.push(closeReceipt);
      else this.unobservable = true;
    } else {
      // A closed child needs no receipt; dropping it removes nothing that is still needed.
      closeReceipt?.dispose();
    }
    return run.value.timedOut || !run.value.terminated ? null : run.value;
  }
}

/**
 * Resolve every policy source of the coverage entry for one context. Starts no
 * Claude child; its only children are `reg.exe` queries. A missing or
 * mismatched entry, or a `knownVersion` outside the entry, refuses before any
 * filesystem or registry access.
 */
export async function scanClaudeAuthPolicy(request: ClaudeAuthPolicyScanRequest): Promise<ClaudeAuthPolicyScanResult> {
  const entry = request.coverage;
  if (!entry || entry.platform !== request.platform) {
    return { ok: false, code: 'unsupported-source', terminated: true };
  }
  if (request.knownVersion !== undefined && !entry.versions.includes(request.knownVersion)) {
    return { ok: false, code: 'unsupported-source', terminated: true };
  }
  const run = new PolicyScanRun(request, entry);
  for (const source of entry.sources) {
    if (request.signal.aborted) return run.refusal('cancelled');
    if (!(await run.resolve(source))) return run.refusal('unsupported-source');
  }
  if (!run.terminated) return run.refusal('unsupported-source');
  return {
    ok: true,
    terminated: true,
    policy: {
      coverage: entry.id,
      managedFile: run.managedFile,
      managedDropIn: run.managedDropIn,
      registry: run.registry,
      remoteSignals: 'absent',
    },
  };
}
