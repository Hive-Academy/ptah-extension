import type { ClaudeCliDetector } from '@ptah-extension/agent-sdk';
import { killProcessTree, type IProcessSpawner, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import type { ProviderAccountActionResult, ProviderAccountResultCode } from '@ptah-extension/shared';
import { ProviderAccountStoreError, revalidateProviderAccountRoute, type CanonicalProviderAccountRoute } from './provider-account-route';

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
  'release-held': 'Named account commands are awaiting release authorization.',
  'invalid-bound': 'The account binding is invalid.',
};

/** Never use an exception message or child text as display copy. */
export function accountActionResult(code: ProviderAccountResultCode): ProviderAccountActionResult {
  return { code, summary: COPY[code] };
}

export const CLAUDE_ACCOUNT_SELECTOR_KEYS = [
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH', 'AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_REGION',
  'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT',
  'CLOUD_ML_REGION', 'ANTHROPIC_VERTEX_PROJECT_ID', 'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_FOUNDRY_API_KEY', 'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_SECRET',
] as const;
const BASELINE = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'LANG', 'LC_ALL']);
const SELECTORS = new Set<string>(CLAUDE_ACCOUNT_SELECTOR_KEYS);

/** Complete effective settings must be supplied by a version-certified resolver.
 * No deployed resolver is certified yet; the live command refuses below.
 * Unknown settings refuse, rather than guessing source precedence or running helpers.
 */
export function certifyClaudeAccountEnvironment(
  env: Readonly<NodeJS.ProcessEnv>, effectiveSettings: readonly unknown[] | null,
  route: CanonicalProviderAccountRoute,
): Readonly<NodeJS.ProcessEnv> {
  if (!effectiveSettings || effectiveSettings.length === 0 || effectiveSettings.some(settings =>
    typeof settings !== 'object' || settings === null || Array.isArray(settings) || Object.keys(settings).length !== 0)) {
    throw new ProviderAccountStoreError('unsupported-source');
  }
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase();
    if (SELECTORS.has(upper)) {
      if (value && (upper !== 'CLAUDE_CONFIG_DIR' || value !== route.canonicalPath)) {
        throw new ProviderAccountStoreError('unsupported-source');
      }
      continue;
    }
    // An unrecognised selector must not be silently inherited or silently certified.
    if (/^(CLAUDE|ANTHROPIC|AWS_|GOOGLE_|AZURE_|CLOUD_|BEDROCK|VERTEX)/.test(upper) && value) {
      throw new ProviderAccountStoreError('unsupported-source');
    }
    if (BASELINE.has(upper)) result[key] = value;
  }
  result['CLAUDE_CONFIG_DIR'] = route.canonicalPath;
  return Object.freeze(result);
}

export type ClaudeAccountCommandKind = 'status' | 'login' | 'logout';
export interface ClaudeAccountCommandOutcome {
  readonly code: ProviderAccountResultCode;
  readonly terminated: boolean;
  readonly authMethod?: 'claude.ai' | 'none';
}

export function parseClaudeAccountStatus(text: string, directory: string): 'claude.ai' | 'none' {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || !('configDir' in value) || value.configDir !== directory ||
      !('authMethod' in value) || (value.authMethod !== 'claude.ai' && value.authMethod !== 'none') ||
      Object.keys(value).some(key => !['configDir', 'authMethod', 'email', 'organization'].includes(key))) {
      throw new ProviderAccountStoreError('unsupported-source');
    }
    // Deliberately discard all identity fields, including email and organization.
    return value.authMethod;
  } catch (error: unknown) {
    if (error instanceof ProviderAccountStoreError) throw error;
    throw new ProviderAccountStoreError('unsupported-source');
  }
}

export class ClaudeAccountCommand {
  constructor(
    private readonly detector: Pick<ClaudeCliDetector, 'findExecutable'>,
    private readonly spawner: IProcessSpawner,
  ) {}

  /** No env, setting, constructor flag or user input can lift the release hold. */
  authorization(): ProviderAccountResultCode { return 'release-held'; }

  /** Unknown deployed CLI version / managed-source precedence fails closed.
   * Tests replace this method, never launch a real provider binary.
   */
  environment(_route: CanonicalProviderAccountRoute): Readonly<NodeJS.ProcessEnv> {
    throw new ProviderAccountStoreError('unsupported-source');
  }

  async execute(kind: ClaudeAccountCommandKind, route: CanonicalProviderAccountRoute,
    signal: AbortSignal): Promise<ClaudeAccountCommandOutcome> {
    const authorization = this.authorization();
    if (authorization !== 'ok') return { code: authorization, terminated: true };
    let spawned = false;
    const expiresAt = Date.now() + (kind === 'login' ? 300_000 : 10_000);
    try {
      const env = this.environment(route);
      const installation = await this.installation(signal, expiresAt);
      if (signal.aborted) return { code: 'cancelled', terminated: true };
      if (!installation || installation.isWSL || (installation.useDirectExecution && !installation.cliJsPath)) {
        return { code: 'unsupported-store', terminated: true };
      }
      revalidateProviderAccountRoute(route);
      const args = ['auth', kind];
      if (installation.useDirectExecution && installation.cliJsPath) args.unshift(installation.cliJsPath);
      const child = this.spawner.spawnProcess({
        command: installation.useDirectExecution ? process.execPath : installation.path, args, env,
        cwd: route.canonicalPath, detached: true,
        launchGuard: { fileIdentities: [{ path: route.requestedPath, realpath: route.canonicalPath,
          devIno: `${route.filesystemIdentity.volumeId}:${route.filesystemIdentity.fileId}` }] },
      });
      spawned = true;
      return await this.observe(child, kind, route, signal, expiresAt);
    } catch (error: unknown) {
      return { code: error instanceof ProviderAccountStoreError ? error.code : 'unsupported-store', terminated: !spawned };
    }
  }

  private installation(signal: AbortSignal, expiresAt: number): ReturnType<ClaudeCliDetector['findExecutable']> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
      const cancel = (): void => { cleanup(); reject(new ProviderAccountStoreError('cancelled')); };
      const timer = setTimeout(() => { cleanup(); reject(new ProviderAccountStoreError('timeout')); },
        Math.max(0, expiresAt - Date.now()));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { cancel(); return; }
      // Late discovery may fill the detector cache, but cannot launch an account command.
      Promise.resolve().then(() => this.detector.findExecutable()).then(
        installation => { cleanup(); resolve(installation); },
        (error: unknown) => { cleanup(); reject(new ProviderAccountStoreError('unsupported-store')); },
      );
    });
  }

  private observe(child: SpawnedProcessHandle, kind: ClaudeAccountCommandKind,
    route: CanonicalProviderAccountRoute, signal: AbortSignal, expiresAt: number): Promise<ClaudeAccountCommandOutcome> {
    return new Promise(resolve => {
      let output = '';
      let stopped: ProviderAccountResultCode | undefined;
      let settled = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const finish = (outcome: ClaudeAccountCommandOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (grace) clearTimeout(grace);
        signal.removeEventListener('abort', cancel);
        child.stdout?.off('data', data);
        child.stderr?.off('data', discard);
        child.off('close', close);
        child.off('error', failed);
        output = '';
        resolve(outcome);
      };
      const stop = (code: ProviderAccountResultCode): void => {
        if (settled || stopped) return;
        stopped = code;
        output = '';
        grace = setTimeout(() => finish({ code, terminated: false }), 2_000);
        void child.whenSpawned.then(pid => {
          if (settled || pid === null) return;
          // Tree kill is best effort. Only close proves termination for this lease.
          return killProcessTree(pid, 'SIGKILL');
        }).catch((error: unknown) => {
          // degradation-audit: optional-capability — failed tree kill cannot release the reservation without close
        });
      };
      const cancel = (): void => stop('cancelled');
      const discard = (): void => { /* Drain stderr without retaining or logging it. */ };
      const data = (chunk: unknown): void => {
        if (stopped || kind !== 'status') return;
        if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) { stop('unsupported-source'); return; }
        const part = chunk.toString();
        if (Buffer.byteLength(output) + Buffer.byteLength(part) > 16_384) { stop('unsupported-source'); return; }
        output += part;
      };
      const failed = (): void => stop('unsupported-store');
      const close = (code: number | null): void => {
        if (stopped) { finish({ code: stopped, terminated: true }); return; }
        if (code !== 0) { finish({ code: 'unsupported-source', terminated: true }); return; }
        try {
          revalidateProviderAccountRoute(route);
          const authMethod = kind === 'status' ? parseClaudeAccountStatus(output, route.canonicalPath) : undefined;
          finish({ code: 'ok', terminated: true, authMethod });
        } catch (error: unknown) {
          finish({ code: error instanceof ProviderAccountStoreError ? error.code : 'unsupported-source', terminated: true });
        }
      };
      const deadline = setTimeout(() => stop('timeout'), Math.max(0, expiresAt - Date.now()));
      child.on('close', close);
      child.on('error', failed);
      child.stdout?.on('data', data);
      child.stderr?.on('data', discard);
      signal.addEventListener('abort', cancel, { once: true });
      child.stdin?.end();
      if (signal.aborted) cancel();
    });
  }
}
