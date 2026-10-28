import { CLAUDE_PERSONAL_SUBSCRIPTIONS, claudeIdentityReference } from '@ptah-extension/agent-sdk';

/**
 * Account class (decisions.md D13). `P`: a personal Pro/Max claude.ai login
 * with no policy or foreign key source. `O`: every other signed-in result.
 * Class O is never certified for a named run.
 */
export type ClaudeAccountClass = 'P' | 'O';

/**
 * Parsed `claude auth status --json`. Carries no raw status value: the identity
 * is an opaque reference and the class is a closed literal.
 */
export type ClaudeAccountStatus =
  | { readonly loggedIn: false }
  | {
      readonly loggedIn: true;
      readonly accountClass: ClaudeAccountClass;
      /** `null` when the status names no email (always class O). */
      readonly identityReference: string | null;
      /** Status `configDirectory` equals the canonical directory after normalization. */
      readonly configDirectoryMatches: boolean;
    };

/** Every key the 2.1.310 status builder can emit. Any other key makes the result class O. */
const KNOWN_STATUS_KEYS: ReadonlySet<string> = new Set([
  'loggedIn',
  'authMethod',
  'apiProvider',
  'analyticsDisabled',
  'projectsDirectory',
  'configDirectory',
  'forcedLoginMethod',
  'allowedProviders',
  'apiKeySource',
  'email',
  'orgId',
  'orgName',
  'subscriptionType',
]);

const PERSONAL_SUBSCRIPTIONS: ReadonlySet<string> = new Set(CLAUDE_PERSONAL_SUBSCRIPTIONS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function optionalOfType(value: Record<string, unknown>, key: string, type: 'string' | 'boolean'): boolean {
  return !has(value, key) || typeof value[key] === type;
}

/** `\` becomes `/`, trailing `/` removed, case folded on win32. */
function normalizeDirectory(directory: string, platform: NodeJS.Platform): string {
  const forward = directory.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? forward.toLowerCase() : forward;
}

function isPersonalClass(status: Record<string, unknown>): boolean {
  if (status['authMethod'] !== 'claude.ai' || status['apiProvider'] !== 'firstParty') return false;
  const subscription = status['subscriptionType'];
  if (typeof subscription !== 'string' || !PERSONAL_SUBSCRIPTIONS.has(subscription)) return false;
  if (has(status, 'forcedLoginMethod') || has(status, 'allowedProviders')) return false;
  if (has(status, 'apiKeySource') && status['apiKeySource'] !== 'none') return false;
  if (Object.keys(status).some((key) => !KNOWN_STATUS_KEYS.has(key))) return false;
  if (typeof status['email'] !== 'string' || status['email'].trim() === '') return false;
  // orgId / orgName are filled for every claude.ai login (A-C2): typed, never a class signal.
  if (!isStringOrNull(status['orgId']) || !isStringOrNull(status['orgName'])) return false;
  return optionalOfType(status, 'analyticsDisabled', 'boolean') && optionalOfType(status, 'projectsDirectory', 'string');
}

/**
 * Parse `claude auth status --json` output. Returns `null` when the output does
 * not prove a state: not a JSON object, a required key missing or mistyped, a
 * signed-out result whose `authMethod` is not `none`, or an exit code that
 * disagrees with `loggedIn` (0 signed in, 1 signed out).
 *
 * A signed-in result always yields its class, so a caller refuses class O
 * before any identity comparison (D14 note 2).
 */
export function parseClaudeAccountStatus(
  text: string,
  exitCode: number | null,
  canonicalDir: string,
  platform: NodeJS.Platform,
): ClaudeAccountStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    // degradation-audit: reported - unparseable status proves no state; null is refused as unproved by the caller.
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const loggedIn = parsed['loggedIn'];
  if (
    typeof loggedIn !== 'boolean' ||
    typeof parsed['authMethod'] !== 'string' ||
    typeof parsed['apiProvider'] !== 'string' ||
    typeof parsed['configDirectory'] !== 'string'
  ) {
    return null;
  }
  if (exitCode !== (loggedIn ? 0 : 1)) return null;
  if (!loggedIn) return parsed['authMethod'] === 'none' ? { loggedIn: false } : null;

  const email = typeof parsed['email'] === 'string' ? parsed['email'] : null;
  const orgName = typeof parsed['orgName'] === 'string' ? parsed['orgName'] : null;
  return {
    loggedIn: true,
    accountClass: isPersonalClass(parsed) ? 'P' : 'O',
    identityReference: claudeIdentityReference(email, orgName),
    configDirectoryMatches:
      normalizeDirectory(parsed['configDirectory'], platform) === normalizeDirectory(canonicalDir, platform),
  };
}
