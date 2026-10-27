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

/**
 * Claude Code feature and tuning names a Claude settings file (user, project,
 * local, managed or flag tier) may set in its `env` block on a named-account
 * run (D63). Exact names, matched case-insensitively; no prefix or pattern.
 * None selects an account, a credential, an API endpoint, a provider or a
 * config directory. This list judges settings files only: the CLI applies
 * these values inside the child, so the process env passed to the child
 * (`CLAUDE_CERTIFIED_ENV_KEYS`, digest and launch re-check) does not widen.
 */
export const CLAUDE_SETTINGS_SAFE_ENV_KEYS = [
  'ENABLE_TOOL_SEARCH',
  'MAX_THINKING_TOKENS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'MCP_TIMEOUT',
  'MCP_TOOL_TIMEOUT',
  'MAX_MCP_OUTPUT_TOKENS',
  'DISABLE_TELEMETRY',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_AUTOUPDATER',
  'DISABLE_COST_WARNINGS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
  'CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
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
const SETTINGS_SAFE_KEY_SET: ReadonlySet<string> = new Set(
  CLAUDE_SETTINGS_SAFE_ENV_KEYS,
);
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
  /**
   * SDK `extraArgs`. A key naming `managed-settings`, `settings` or
   * `setting-sources` (after leading dashes and any `=value`) refuses.
   */
  readonly extraArgs?: Readonly<Record<string, string | null>>;
}

/** True when `name` is on the certified allowlist, compared case-insensitively. */
export function isCertifiedClaudeEnvKey(name: string): boolean {
  return CERTIFIED_KEY_SET.has(name.toUpperCase());
}

/**
 * True when a Claude settings file may set `name` in its `env` block: a
 * certified process name or a settings-safe feature name. Never used for the
 * process env passed to the child.
 */
export function isClaudeSettingsEnvKeyAllowed(name: string): boolean {
  return (
    isCertifiedClaudeEnvKey(name) ||
    SETTINGS_SAFE_KEY_SET.has(name.toUpperCase())
  );
}

function isRunPolicyKey(name: string): boolean {
  return RUN_POLICY_KEY_SET.has(name.toUpperCase());
}

function isConfigDirKey(name: string): boolean {
  return (CONFIG_DIR_KEYS as readonly string[]).includes(name);
}

/**
 * True when one `key=value` digest line cannot be confused with another
 * split: no line break in the key or the value and no `=` in the key.
 */
function isDigestEncodable(key: string, value: string): boolean {
  return !key.includes('=') && !key.includes('\n') && !value.includes('\n');
}

/**
 * True when every entry of a certified env is an allowlisted key or one of the
 * two Claude directory keys, and every entry is digest-encodable. A launch env
 * that fails this can carry a credential selector or a parent-managed key.
 */
function launchEnvCertified(env: Readonly<Record<string, string>>): boolean {
  return Object.entries(env).every(
    ([key, value]) =>
      typeof value === 'string' &&
      (isCertifiedClaudeEnvKey(key) || isConfigDirKey(key)) &&
      isDigestEncodable(key, value),
  );
}

/**
 * True when the actual env carries exactly the certified entries: the same
 * key set and the same values, ignoring run-policy keys and `undefined`
 * values. This compares entries directly, so it does not depend on the digest
 * encoding.
 */
function sameCertifiedEntries(
  actual: Readonly<Record<string, string | undefined>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const actualKeys = Object.keys(actual).filter(
    (key) => actual[key] !== undefined && !isRunPolicyKey(key),
  );
  const expectedKeys = Object.keys(expected).filter(
    (key) => !isRunPolicyKey(key),
  );
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(expected, key) &&
        expected[key] === actual[key],
    )
  );
}

/**
 * Build the complete child env for a named route from an allowlist. Keys keep
 * their original casing. Every copied `NO_PROXY` (any casing) gets the local
 * hosts appended; when none was copied, `NO_PROXY` is set to them. Both Claude
 * directory keys are set to `canonicalConfigDir`. An allowlisted value with a
 * line break is not copied. Nothing else is present.
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
    // A value with a line break would make the digest lines ambiguous; such
    // a value is never a valid path, proxy or locale, so it is not copied.
    if (!isDigestEncodable(key, value)) continue;
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
 * The line form is unambiguous only for digest-encodable entries, so both
 * boundaries also check the env entries directly and refuse an entry with a
 * line break (or a key with `=`).
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
 * absent, when either Claude directory differs from the route, when the env
 * carries a key off the allowlist or an entry that is not digest-encodable,
 * or when the env no longer matches its digest.
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
  if (
    !launchEnvCertified(launch.env) ||
    certifiedEnvDigest(launch.env) !== launch.envDigest
  ) {
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
 * CLI flags an `extraArgs` entry must not carry: each one would replace a
 * certified input (the parent-managed tier, the flag settings tier or the
 * setting sources) with a value this check never saw.
 */
const CERTIFIED_INPUT_FLAGS: ReadonlySet<string> = new Set([
  'managed-settings',
  'settings',
  'setting-sources',
]);

/**
 * The CLI flag name an `extraArgs` key turns into. The SDK emits `--<key>`,
 * so leading dashes and an inline `=value` still name the same flag; the CLI
 * flag parser is case-sensitive, but casing is folded so no variant slips by.
 */
function extraArgFlagName(key: string): string {
  return key.replace(/^-+/, '').split('=')[0].toLowerCase();
}

function replacesCertifiedInput(
  extraArgs: Readonly<Record<string, string | null>> | undefined,
): boolean {
  if (extraArgs === undefined) return false;
  return Object.keys(extraArgs).some((key) =>
    CERTIFIED_INPUT_FLAGS.has(extraArgFlagName(key)),
  );
}

/**
 * Re-check a certified launch right before one SDK child starts. Throws
 * `ClaudeCertifiedLaunchRefusal`; returns only when the child may start.
 *
 * Both modes: equal executable path; an env whose non-run-policy entries equal
 * the launch env exactly (key set and values) and match its digest; run-policy
 * keys only with value `'1'`; no parent-managed settings channel
 * (`managedSettings`); no `extraArgs` key that replaces a certified input
 * (`managed-settings`, `settings`, `setting-sources`); and a flag settings
 * tier (when present) that parses and carries no auth override.
 * `bootstrap`: `settingSources` is `[]` and `cwd` is the OS temp directory.
 * `final`: `cwd` and `settingSources` equal the launch.
 */
export function assertCertifiedLaunch(
  launch: ClaudeCertifiedLaunchContext,
  actual: ClaudeActualLaunch,
  mode: ClaudeLaunchBoundary,
): void {
  if (
    actual.managedSettings !== undefined ||
    replacesCertifiedInput(actual.extraArgs)
  ) {
    throw new ClaudeCertifiedLaunchRefusal('identity-unproved');
  }
  if (
    actual.flagSettings !== undefined &&
    claudeSettingsOverride(parsedFlagSettings(actual.flagSettings)) !== 'none'
  ) {
    throw new ClaudeCertifiedLaunchRefusal('identity-unproved');
  }
  if (actual.executablePath !== launch.executable.sdkExecutablePath) {
    throw new ClaudeCertifiedLaunchRefusal('route-changed');
  }
  if (
    !launchEnvCertified(launch.env) ||
    !sameCertifiedEntries(actual.env, launch.env) ||
    certifiedEnvDigest(actual.env) !== launch.envDigest
  ) {
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
 * key that is neither certified nor in `CLAUDE_SETTINGS_SAFE_ENV_KEYS`) or
 * enables plugins; `malformed` when the
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
    if (Object.keys(env).some((key) => !isClaudeSettingsEnvKeyAllowed(key))) {
      return 'override';
    }
  }
  if (hasKey(value, 'enabledPlugins') && nonEmpty(value['enabledPlugins'])) {
    return 'override';
  }
  return 'none';
}
