import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import type {
  ClaudeAccountNamedRoute,
  ClaudeCertifiedLaunchContext,
  ClaudeLaunchBoundary,
} from '@ptah-extension/auth-providers-tokens';

/**
 * Environment names a certified named Claude child may inherit. Matched
 * case-insensitively. Every auth selector, every `CLAUDE*` / `ANTHROPIC*`
 * name and every cloud-provider name is absent by construction.
 */
export const CLAUDE_CERTIFIED_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'TZ',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const;

/** Subscription words that classify a Claude login as personal (class P). */
export const CLAUDE_PERSONAL_SUBSCRIPTIONS = ['pro', 'max'] as const;

/**
 * Run-policy keys the SDK final options may add. They carry no auth, their
 * only allowed value is `'1'`, and they are excluded from the env digest.
 */
const CLAUDE_RUN_POLICY_KEYS = [
  'CLAUDE_CODE_DISABLE_WORKFLOWS',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
] as const;

export type ClaudeRunPolicyKey = (typeof CLAUDE_RUN_POLICY_KEYS)[number];

const CERTIFIED_KEY_SET: ReadonlySet<string> = new Set(
  CLAUDE_CERTIFIED_ENV_KEYS,
);
const RUN_POLICY_KEY_SET: ReadonlySet<string> = new Set(CLAUDE_RUN_POLICY_KEYS);
const LOCAL_NO_PROXY = '127.0.0.1,localhost';
const CONFIG_DIR_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
] as const;

/** Settings keys that select or supply credentials outside the named login. */
const AUTH_OVERRIDE_SETTINGS = [
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'gcpAuthRefresh',
  'forceLoginOrgUUID',
] as const;

export type ClaudeCertifiedLaunchRefusalCode =
  'identity-unproved' | 'route-changed';

/**
 * Fixed, path-free refusal. The message never carries an env value, a path
 * or CLI text, so it is safe to log and to map to an RPC error code.
 */
export class ClaudeCertifiedLaunchRefusal extends Error {
  constructor(readonly code: ClaudeCertifiedLaunchRefusalCode) {
    super(`Certified Claude launch refused: ${code}.`);
    this.name = 'ClaudeCertifiedLaunchRefusal';
  }
}

/** The launch values an SDK child is about to start with. */
export interface ClaudeActualLaunch {
  /** SDK `pathToClaudeCodeExecutable`. */
  readonly executablePath: string | undefined;
  /** SDK `env`. Entries whose value is `undefined` are not passed to the child. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string | undefined;
  readonly settingSources: readonly string[] | undefined;
  /** SDK `settings` (the flag settings tier), a JSON string. */
  readonly flagSettings?: string;
  /** SDK `managedSettings`. Any value, `{}` included, refuses. */
  readonly managedSettings?: unknown;
  /** SDK `extraArgs`. A `managed-settings` key refuses. */
  readonly extraArgs?: Readonly<Record<string, string | null>>;
}

/** True when `name` is on the certified allowlist, compared case-insensitively. */
export function isCertifiedClaudeEnvKey(name: string): boolean {
  return CERTIFIED_KEY_SET.has(name.toUpperCase());
}

function isRunPolicyKey(name: string): boolean {
  return RUN_POLICY_KEY_SET.has(name.toUpperCase());
}

/**
 * Build the complete child env for a named route from an allowlist. Keys keep
 * their original casing. Every copied `NO_PROXY` (any casing) gets the local
 * hosts appended; when none was copied, `NO_PROXY` is set to them. Both Claude
 * directory keys are set to `canonicalConfigDir`. Nothing else is present.
 */
export function buildCertifiedClaudeEnv(
  sourceEnv: Readonly<Record<string, string | undefined>>,
  canonicalConfigDir: string,
): Readonly<Record<string, string>> {
  if (!canonicalConfigDir.trim()) {
    throw new ClaudeCertifiedLaunchRefusal('identity-unproved');
  }
  const env: Record<string, string> = {};
  let noProxyCopied = false;
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined || !isCertifiedClaudeEnvKey(key)) continue;
    if (key.toUpperCase() === 'NO_PROXY') {
      noProxyCopied = true;
      env[key] = value === '' ? LOCAL_NO_PROXY : `${value},${LOCAL_NO_PROXY}`;
    } else {
      env[key] = value;
    }
  }
  if (!noProxyCopied) env['NO_PROXY'] = LOCAL_NO_PROXY;
  for (const key of CONFIG_DIR_KEYS) env[key] = canonicalConfigDir;
  return Object.freeze(env);
}

/**
 * SHA-256 hex of the sorted `key=value` lines of `env`. Run-policy keys and
 * `undefined` values are excluded; every other key is part of the digest.
 */
export function certifiedEnvDigest(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || isRunPolicyKey(key)) continue;
    lines.push(`${key}=${value}`);
  }
  lines.sort();
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

/**
 * The env a named child starts with: a fresh copy of the certified env plus
 * the requested run-policy keys set to `'1'`. Refuses when the launch is
 * absent, when either Claude directory differs from the route, or when the
 * env no longer matches its digest.
 */
export function certifiedNamedEnv(
  route: ClaudeAccountNamedRoute,
  launch: ClaudeCertifiedLaunchContext | undefined,
  runPolicy: readonly ClaudeRunPolicyKey[] = [],
): Record<string, string> {
  if (!launch) throw new ClaudeCertifiedLaunchRefusal('identity-unproved');
  for (const key of CONFIG_DIR_KEYS) {
    if (launch.env[key] !== route.canonicalConfigDir) {
      throw new ClaudeCertifiedLaunchRefusal('route-changed');
    }
  }
  if (certifiedEnvDigest(launch.env) !== launch.envDigest) {
    throw new ClaudeCertifiedLaunchRefusal('route-changed');
  }
  const env: Record<string, string> = { ...launch.env };
  for (const key of runPolicy) env[key] = '1';
  return env;
}

function sameSources(
  actual: readonly string[] | undefined,
  expected: readonly string[],
): boolean {
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    actual.every((source, index) => source === expected[index])
  );
}

function runPolicyValuesAllowed(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return Object.entries(env).every(
    ([key, value]) =>
      !isRunPolicyKey(key) || value === undefined || value === '1',
  );
}

function parsedFlagSettings(flagSettings: string): unknown {
  try {
    return JSON.parse(flagSettings) as unknown;
  } catch {
    // Unparseable flag settings cannot be proved free of an override; the
    // caller refuses on `malformed`, so nothing is silently accepted.
    return undefined;
  }
}

/**
 * Re-check a certified launch right before one SDK child starts. Throws
 * `ClaudeCertifiedLaunchRefusal`; returns only when the child may start.
 *
 * Both modes: equal executable path and env digest, run-policy keys only with
 * value `'1'`, no parent-managed settings channel (`managedSettings` or an
 * `extraArgs` `managed-settings` key).
 * `bootstrap`: `settingSources` is `[]` and `cwd` is the OS temp directory.
 * `final`: `cwd` and `settingSources` equal the launch, and the flag settings
 * tier (when present) carries no auth override.
 */
export function assertCertifiedLaunch(
  launch: ClaudeCertifiedLaunchContext,
  actual: ClaudeActualLaunch,
  mode: ClaudeLaunchBoundary,
): void {
  if (
    actual.managedSettings !== undefined ||
    (actual.extraArgs !== undefined &&
      Object.prototype.hasOwnProperty.call(
        actual.extraArgs,
        'managed-settings',
      ))
  ) {
    throw new ClaudeCertifiedLaunchRefusal('identity-unproved');
  }
  if (actual.executablePath !== launch.executable.sdkExecutablePath) {
    throw new ClaudeCertifiedLaunchRefusal('route-changed');
  }
  if (certifiedEnvDigest(actual.env) !== launch.envDigest) {
    throw new ClaudeCertifiedLaunchRefusal('route-changed');
  }
  if (!runPolicyValuesAllowed(actual.env)) {
    throw new ClaudeCertifiedLaunchRefusal('route-changed');
  }
  const expectedCwd = mode === 'bootstrap' ? tmpdir() : launch.cwd;
  const expectedSources = mode === 'bootstrap' ? [] : launch.settingSources;
  if (
    actual.cwd !== expectedCwd ||
    !sameSources(actual.settingSources, expectedSources)
  ) {
    throw new ClaudeCertifiedLaunchRefusal('route-changed');
  }
  if (
    mode === 'final' &&
    actual.flagSettings !== undefined &&
    claudeSettingsOverride(parsedFlagSettings(actual.flagSettings)) !== 'none'
  ) {
    throw new ClaudeCertifiedLaunchRefusal('identity-unproved');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return (
    value !== undefined && value !== null && value !== false && value !== ''
  );
}

/**
 * Classify one parsed Claude settings object. `override` when it supplies or
 * selects credentials outside the named login (a credential helper, a
 * `forceLoginMethod` other than `claudeai`, any `forceLoginOrgUUID`, an `env`
 * key off the certified allowlist) or enables plugins; `malformed` when the
 * value or its `env` is not an object; otherwise `none`.
 */
export function claudeSettingsOverride(
  value: unknown,
): 'none' | 'override' | 'malformed' {
  if (!isPlainObject(value)) return 'malformed';
  if (AUTH_OVERRIDE_SETTINGS.some((key) => hasKey(value, key))) {
    return 'override';
  }
  if (
    hasKey(value, 'forceLoginMethod') &&
    value['forceLoginMethod'] !== 'claudeai'
  ) {
    return 'override';
  }
  if (hasKey(value, 'env')) {
    const env = value['env'];
    if (!isPlainObject(env)) return 'malformed';
    if (Object.keys(env).some((key) => !isCertifiedClaudeEnvKey(key))) {
      return 'override';
    }
  }
  if (hasKey(value, 'enabledPlugins') && nonEmpty(value['enabledPlugins'])) {
    return 'override';
  }
  return 'none';
}
