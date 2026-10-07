/**
 * Copies one Codex `auth.json` into the bench host's isolated home before the
 * engine boots, and points this process at that copy.
 *
 * The source path arrives only through the launch environment
 * ({@link CODEX_AUTH_SOURCE_ENV}). It is never written to a plan, cassette,
 * fixture, log line, or completion record. `CODEX_HOME` is set here, in the
 * child, because the launcher spreads the parent environment
 * (`host-launcher.ts`) and `CodexHomeResolver` prefers `CODEX_HOME` over
 * `homedir()` (`codex-home-resolver.ts`).
 *
 * A copied access token must still be valid for the recording deadline plus
 * ten minutes plus the Codex expiry skew (`CODEX_TOKEN_EXPIRY_SKEW_MS`).
 * The expiry is the JWT `exp` claim on `tokens.access_token`
 * (`codex-provider.types.ts`). Token text is never logged.
 */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { CODEX_TOKEN_EXPIRY_SKEW_MS } from '@ptah-extension/shared';

import { isPathInside } from '../../bench-data';
import { OAUTH_TOKEN_ENDPOINT_SETTING } from '../runner/runner-plan';

/** Launch-env key. Not an isolation key, so `launchBenchHost` accepts it. */
export const CODEX_AUTH_SOURCE_ENV = 'PTAH_BENCH_CODEX_AUTH_SOURCE';
/**
 * How long the recording may run, in milliseconds. The parent sends the host
 * completion timeout. Together with {@link RECORDING_EXPIRY_SLACK_MS} it is
 * the minimum remaining lifetime of the copied access token.
 */
export const RECORDING_DEADLINE_ENV = 'PTAH_BENCH_RECORDING_DEADLINE_MS';
/** Extra lifetime required beyond the recording deadline. */
export const RECORDING_EXPIRY_SLACK_MS = 10 * 60 * 1000;

/**
 * Unreachable loopback URL written to `ptah.provider.openai-codex.oauthTokenEndpoint`
 * in record mode. Port 9 is discarded, so a token refresh fails before it can
 * reach `https://auth.openai.com/oauth/token` (`getOAuthTokenEndpoint`).
 */
export const UNREACHABLE_OAUTH_TOKEN_ENDPOINT =
  'http://127.0.0.1:9/oauth/token';

/**
 * CLI product config the engine reads at boot (`cli-workspace-provider.ts`
 * `loadConfigSync`: `{userDataPath}/config.json`, section object `ptah`).
 * `oauthTokenEndpoint` is not a file-based settings key, so it is not
 * `settings.json`.
 */
export const ISOLATED_PRODUCT_CONFIG_FILE = 'config.json';

/**
 * Write the unreachable Codex token URL into the isolated config before
 * `withEngine` starts. Merges into an existing `config.json` so other keys
 * survive. The post-boot `setConfiguration` read-back still checks it.
 */
export function seedRecordModeOAuthEndpoint(userDataPath: string): void {
  mkdirSync(userDataPath, { recursive: true });
  const path = join(userDataPath, ISOLATED_PRODUCT_CONFIG_FILE);
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        config = parsed as Record<string, unknown>;
      }
    } catch (error: unknown) {
      throw new RecordingBootstrapError(
        'isolated product config.json is not JSON',
        { cause: error },
      );
    }
  }
  const current = config['ptah'];
  const section: Record<string, unknown> =
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  section[OAUTH_TOKEN_ENDPOINT_SETTING] = UNREACHABLE_OAUTH_TOKEN_ENDPOINT;
  config['ptah'] = section;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export class RecordingBootstrapError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RecordingBootstrapError';
  }
}

export interface IsolatedCodexAuth {
  /** `<isolation.home>/.codex`, also assigned to `process.env.CODEX_HOME`. */
  readonly codexHome: string;
  /** `<codexHome>/auth.json`. */
  readonly authFile: string;
  /** sha256 of the copied file, taken after the path checks. */
  readonly sha256: string;
}

export interface BootstrapCodexAuthInput {
  /** `isolation.home` from `beforeEngineBoot`. */
  readonly isolationHome: string;
  /** Absolute path of a regular `auth.json`. Never logged. */
  readonly sourcePath: string;
  /** Recording deadline in milliseconds. Must be a positive integer. */
  readonly deadlineMs: number;
  /** Clock for the expiry check. Default `Date.now`. */
  readonly nowMs?: number;
  /**
   * Environment to publish `CODEX_HOME` on. The host passes `process.env`.
   * `process.env` is always updated as well, because `CodexHomeResolver`
   * reads it.
   */
  readonly env?: NodeJS.ProcessEnv;
}

/** sha256 of a file's bytes. Throws when the file cannot be read. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Copy `sourcePath` to `<isolationHome>/.codex/auth.json`, restrict it, and
 * set `CODEX_HOME`. Throws {@link RecordingBootstrapError} before the engine
 * starts when the source is a link, not a regular file, escapes the isolated
 * directory, or expires too soon.
 */
export function bootstrapIsolatedCodexAuth(
  input: BootstrapCodexAuthInput,
): IsolatedCodexAuth {
  if (!Number.isInteger(input.deadlineMs) || input.deadlineMs <= 0) {
    throw new RecordingBootstrapError(
      'recording deadline is missing or not a positive integer',
    );
  }
  if (!isAbsolute(input.sourcePath)) {
    throw new RecordingBootstrapError(
      'codex auth source must be an absolute path',
    );
  }

  let sourceStat;
  try {
    sourceStat = lstatSync(input.sourcePath);
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') {
      throw new RecordingBootstrapError('codex auth source is missing', {
        cause: error,
      });
    }
    throw new RecordingBootstrapError('codex auth source cannot be read', {
      cause: error,
    });
  }
  if (sourceStat.isSymbolicLink()) {
    throw new RecordingBootstrapError('codex auth source is a symbolic link');
  }
  if (!sourceStat.isFile()) {
    throw new RecordingBootstrapError(
      'codex auth source is not a regular file',
    );
  }

  const codexHome = join(input.isolationHome, '.codex');
  const authFile = join(codexHome, 'auth.json');
  try {
    if (lstatSync(codexHome).isSymbolicLink()) {
      throw new RecordingBootstrapError(
        'isolated codex home is a symbolic link',
      );
    }
  } catch (error: unknown) {
    if (error instanceof RecordingBootstrapError) throw error;
    if (errorCode(error) !== 'ENOENT') {
      throw new RecordingBootstrapError('isolated codex home cannot be read', {
        cause: error,
      });
    }
  }

  mkdirSync(codexHome, { recursive: true });
  copyFileSync(input.sourcePath, authFile);
  try {
    chmodSync(authFile, 0o600);
  } catch (error: unknown) {
    if (process.platform !== 'win32') {
      throw new RecordingBootstrapError(
        'cannot restrict permissions on the isolated auth.json',
        { cause: error },
      );
    }
  }

  try {
    assertContained(
      codexHome,
      input.isolationHome,
      'resolved Codex home escapes the isolated home',
    );
    assertContained(
      authFile,
      codexHome,
      'resolved Codex auth file escapes the isolated codex home',
    );
  } catch (error: unknown) {
    try {
      unlinkSync(authFile);
    } catch {
      // The copy is already unreadable; the rejection still stands.
    }
    throw error;
  }

  const sha256 = sha256File(authFile);
  assertAccessTokenCoversRecording(
    authFile,
    input.deadlineMs,
    input.nowMs ?? Date.now(),
  );

  const env = input.env ?? process.env;
  env['CODEX_HOME'] = codexHome;
  if (env !== process.env) {
    process.env['CODEX_HOME'] = codexHome;
  }
  return { codexHome, authFile, sha256 };
}

/** `code` without `instanceof Error`: Jest's vm does not share Node's realm. */
function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return '';
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function assertContained(child: string, parent: string, message: string): void {
  const resolvedChild = realpathSync(child);
  const resolvedParent = realpathSync(parent);
  if (!isPathInside(resolvedChild, resolvedParent)) {
    throw new RecordingBootstrapError(message);
  }
}

/**
 * Read `tokens.access_token` and require its JWT `exp` to exceed
 * `now + deadline + 10 minutes +` {@link CODEX_TOKEN_EXPIRY_SKEW_MS}.
 * `isCodexAccessTokenStale` treats a JWT as stale inside that skew, which
 * would call refresh during the run. Does not verify the signature. Never
 * includes the token in an error.
 */
function assertAccessTokenCoversRecording(
  authFile: string,
  deadlineMs: number,
  nowMs: number,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(authFile, 'utf8'));
  } catch (error: unknown) {
    throw new RecordingBootstrapError('copied auth.json is not JSON', {
      cause: error,
    });
  }
  const accessToken = accessTokenOf(parsed);
  if (accessToken === null) {
    throw new RecordingBootstrapError(
      'copied auth.json has no tokens.access_token',
    );
  }
  const expMs = jwtExpMs(accessToken);
  if (expMs === null) {
    throw new RecordingBootstrapError(
      'copied auth.json access token has no JWT exp',
    );
  }
  const earliest =
    nowMs + deadlineMs + RECORDING_EXPIRY_SLACK_MS + CODEX_TOKEN_EXPIRY_SKEW_MS;
  if (expMs <= earliest) {
    throw new RecordingBootstrapError(
      'copied auth.json access token expires before the recording deadline plus 10 minutes and the Codex expiry skew',
    );
  }
}

function accessTokenOf(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  const tokens = (parsed as { tokens?: unknown }).tokens;
  if (tokens === null || typeof tokens !== 'object') return null;
  const accessToken = (tokens as { access_token?: unknown }).access_token;
  return typeof accessToken === 'string' && accessToken.length > 0
    ? accessToken
    : null;
}

/** `exp` in milliseconds, or null when the token is not a JWT with a numeric exp. */
function jwtExpMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2 || parts[1].length === 0) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
}
