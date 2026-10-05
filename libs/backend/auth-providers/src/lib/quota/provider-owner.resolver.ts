/**
 * Provider owner resolver (TASK_2026_596, Decision 3; Gate 2 G3).
 *
 * The single place that turns identity material into a quota owner. Every
 * caller that needs an owner — the ledger, the plan-usage readers, the proxy
 * 429 hook, session routes, lanes and discovery — goes through the functions
 * or the class below. No other file hashes an identity or parses a credential.
 *
 * - The owner key is `<providerId>#<identityKind>:<fp>`, where `fp` is the
 *   first 16 lowercase hex characters of SHA-256 over
 *   `"ptah-quota-owner\0" + material`. That exact shape is what
 *   `parseQuotaOwnerRef` (agent-sdk) accepts on restore.
 * - Material (an email, an API key, a path) never leaves this module: it is
 *   not logged, not returned and not stored. Only the opaque key and a generic
 *   label ("Claude account") do.
 *
 * The key functions are module-level because the proxy base is not DI-built;
 * the `ProviderOwnerResolver` class wraps them for DI callers.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { OLLAMA_CLOUD_DIRECT_BASE_URL } from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS, type SessionQuotaProbe } from '@ptah-extension/agent-sdk';
import type {
  QuotaOwnerIdentityKind,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { CodexHomeResolver } from '../providers/codex/codex-home-resolver';
import {
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  type ICodexOwnerKeySource,
} from '../providers/codex/codex-provider.types';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../providers/copilot/copilot-provider.types';
import { CUSTOM_PROXY_TOKEN_PLACEHOLDER } from '../providers/custom/custom-provider.types';
import {
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  OLLAMA_AUTH_TOKEN_PLACEHOLDER,
} from '../providers/local/local-provider.types';
import { OPENCODE_PROXY_TOKEN_PLACEHOLDER } from '../providers/opencode/opencode-provider.types';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from '../providers/openrouter/openrouter-provider.types';
import { SAKANA_PROXY_TOKEN_PLACEHOLDER } from '../providers/sakana/sakana-provider.types';

const FINGERPRINT_DOMAIN = 'ptah-quota-owner\0';
const FINGERPRINT_LENGTH = 16;
const MAX_PROVIDER_ID_LENGTH = 64;

const CLAUDE_PROVIDER_ID = 'anthropic';
const CODEX_PROVIDER_ID = 'openai-codex';
/** Used when a session has no route at all, so no provider can be named. */
const UNROUTED_PROVIDER_ID = 'unknown';
/**
 * Secret-store slot prefix of a Ptah CLI agent's key. Mirrors
 * `PTAH_CLI_KEY_PREFIX` in cli-agent-runtime, which auth-providers cannot import.
 */
const PTAH_CLI_KEY_PREFIX = 'ptahCli';
const OLLAMA_CLOUD_DIRECT_HOST = new URL(OLLAMA_CLOUD_DIRECT_BASE_URL).hostname;

/**
 * Values Ptah hands to the SDK in place of a real key while a local proxy or
 * daemon owns authentication. They identify nobody, so they give `unknown`.
 */
const PLACEHOLDER_CREDENTIALS: ReadonlySet<string> = new Set([
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  CUSTOM_PROXY_TOKEN_PLACEHOLDER,
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  OLLAMA_AUTH_TOKEN_PLACEHOLDER,
  OPENCODE_PROXY_TOKEN_PLACEHOLDER,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
  SAKANA_PROXY_TOKEN_PLACEHOLDER,
]);

/** Generic, non-secret display names. Unlisted providers read "Provider". */
const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [CLAUDE_PROVIDER_ID]: 'Claude',
  [CODEX_PROVIDER_ID]: 'Codex',
  'ollama-cloud': 'Ollama Cloud',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode',
  'opencode-zen': 'OpenCode',
  antigravity: 'Antigravity',
};

const KIND_LABEL_SUFFIX: Readonly<Record<QuotaOwnerIdentityKind, string>> = {
  account: 'account',
  credential: 'API key',
  'cli-store': 'CLI login',
  unknown: '(owner unknown)',
};

/** HTTP request headers as Node delivers them (`IncomingHttpHeaders`-like). */
export type OwnerRequestHeaders = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

/** The `accountInfo()` answer the probe returns, or `null` when it had none. */
export type ClaudeAccountInfo = Awaited<
  ReturnType<SessionQuotaProbe['readAccount']>
>;

/** CLIs whose quota owner is the CLI's own credential store. */
export type CliStoreOwner = 'opencode' | 'antigravity';

const GeminiAccountsSchema = z.object({ active: z.string() });

type FileReader = (path: string, encoding: BufferEncoding) => string;
type FileStat = (path: string) => { mtimeMs: number; size: number };

const GEMINI_ACCOUNT_CACHE_TTL_MS = 5_000;
const geminiAccountCache = new Map<
  string,
  {
    checkedAt: number;
    mtimeMs: number | null;
    size: number | null;
    active: string | null;
  }
>();
let observedAntigravityAccount: { root: string; key: string } | undefined;

/**
 * The active Gemini account email, lowercased (Google treats addresses
 * case-insensitively), if the local account file is usable.
 */
export function readActiveGeminiAccount(
  root: string,
  read: FileReader = readFileSync,
  stat: FileStat = statSync,
  now: () => number = Date.now,
): string | null {
  const path = join(root, 'google_accounts.json');
  const checkedAt = now();
  const cached = geminiAccountCache.get(path);
  if (cached && checkedAt - cached.checkedAt < GEMINI_ACCOUNT_CACHE_TTL_MS) {
    return cached.active;
  }
  try {
    const metadata = stat(path);
    if (
      cached &&
      cached.mtimeMs === metadata.mtimeMs &&
      cached.size === metadata.size
    ) {
      cached.checkedAt = checkedAt;
      return cached.active;
    }
    const parsed = GeminiAccountsSchema.safeParse(
      JSON.parse(read(path, 'utf8')),
    );
    const active = parsed.success
      ? parsed.data.active.trim().toLowerCase()
      : '';
    const account = active || null;
    geminiAccountCache.set(path, {
      checkedAt,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      active: account,
    });
    return account;
  } catch {
    // degradation-audit: optional-capability - no readable active-account
    // file means the CLI credential store remains the owner.
    geminiAccountCache.set(path, {
      checkedAt,
      mtimeMs: null,
      size: null,
      active: null,
    });
    return null;
  }
}

/**
 * Observe the account reported by Antigravity's language server. The email is
 * immediately converted to an opaque owner key and never leaves this module.
 */
export function observeAntigravityAccount(email: string | null): string {
  const root = cliStorePath('antigravity');
  const active = email?.trim().toLowerCase() ?? '';
  observedAntigravityAccount = active
    ? { root, key: accountOwnerKey('antigravity', `${root}\0${active}`) }
    : undefined;
  return antigravityOwnerRef().key;
}

/** Test seam for module-local account observation and account-file cache. */
export function resetAntigravityOwnerStateForTests(): void {
  observedAntigravityAccount = undefined;
  geminiAccountCache.clear();
}

/**
 * `fp`: the first 16 lowercase hex characters of SHA-256 over the domain tag
 * plus the material. The only fingerprint implementation in the codebase.
 */
export function ownerFingerprint(material: string): string {
  return createHash('sha256')
    .update(FINGERPRINT_DOMAIN + material, 'utf8')
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
}

/**
 * The raw credential a request carries, or `null`.
 *
 * - Header names match case-insensitively; a repeated header uses its first value.
 * - A non-empty `x-api-key` wins and is taken as is (trimmed).
 * - Otherwise `authorization` loses exactly one `Bearer` or `Basic` scheme
 *   (case-insensitive, followed by whitespace). `Bearer Bearer K` gives
 *   `Bearer K`. A value without a recognised scheme is used raw.
 * - An empty result is `null`.
 */
export function credentialFromHeaders(
  headers: OwnerRequestHeaders,
): string | null {
  const apiKey = headerValue(headers, 'x-api-key');
  if (apiKey) return isPlaceholderCredential(apiKey) ? null : apiKey;
  const authorization = headerValue(headers, 'authorization');
  if (!authorization) return null;
  const credential = authorization
    .replace(/^(?:bearer|basic)(?:\s+|$)/i, '')
    .trim();
  return credential.length > 0 && !isPlaceholderCredential(credential)
    ? credential
    : null;
}

/** `<providerId>#credential:<fp>` over the trimmed raw credential. */
export function credentialOwnerKey(
  providerId: string,
  rawCredential: string,
): string {
  return ownerKey(providerId, 'credential', rawCredential.trim());
}

/** `<providerId>#account:<fp>` over a provider-verified account identity. */
export function accountOwnerKey(
  providerId: string,
  accountMaterial: string,
): string {
  return ownerKey(providerId, 'account', accountMaterial);
}

/**
 * `<providerId>#cli-store:<fp>` over the resolved store path, lower-cased on
 * Windows so drive-letter and folder case differences stay one owner.
 */
export function cliStoreOwnerKey(providerId: string, path: string): string {
  return ownerKey(providerId, 'cli-store', canonicalPath(path));
}

/**
 * `<providerId>#unknown:<fp>` over route material (a proxy instance id, a
 * `CODEX_HOME` path, a session or run id). Never treated as shared.
 */
export function unknownOwnerKey(
  providerId: string,
  routeMaterial: string,
): string {
  return ownerKey(providerId, 'unknown', routeMaterial);
}

/**
 * Lowercase slug accepted by `parseQuotaOwnerRef`
 * (`/^[a-z0-9][a-z0-9._-]{0,63}$/`). Anything outside it becomes `-`; an id
 * with nothing usable left becomes `unknown`.
 */
export function normaliseOwnerProviderId(providerId: string): string {
  const slug = providerId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, MAX_PROVIDER_ID_LENGTH);
  return slug.length > 0 ? slug : UNROUTED_PROVIDER_ID;
}

/**
 * The full owner reference for a key built by the functions above. The
 * identity kind is read back from the key, so a key and its ref never disagree.
 */
export function quotaOwnerRefFromKey(key: string): QuotaOwnerRef {
  const match = /^([^#]+)#(account|credential|cli-store|unknown):/.exec(key);
  if (!match) {
    throw new Error('Not a canonical quota owner key');
  }
  const providerId = match[1];
  const identityKind = match[2] as QuotaOwnerIdentityKind;
  return {
    providerId,
    identityKind,
    key,
    label: ownerLabel(providerId, identityKind),
  };
}

function ownerKey(
  providerId: string,
  kind: QuotaOwnerIdentityKind,
  material: string,
): string {
  return `${normaliseOwnerProviderId(providerId)}#${kind}:${ownerFingerprint(material)}`;
}

function ownerLabel(providerId: string, kind: QuotaOwnerIdentityKind): string {
  const name = PROVIDER_DISPLAY_NAMES[providerId] ?? 'Provider';
  return `${name} ${KIND_LABEL_SUFFIX[kind]}`;
}

function headerValue(
  headers: OwnerRequestHeaders,
  name: string,
): string | null {
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== name) continue;
    const first = typeof value === 'string' ? value : value?.[0];
    const trimmed = typeof first === 'string' ? first.trim() : '';
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * True for a value Ptah stores or sends in place of a real key while a local
 * proxy or daemon owns authentication. It identifies nobody.
 */
export function isPlaceholderCredential(value: string): boolean {
  return PLACEHOLDER_CREDENTIALS.has(value.trim());
}

function antigravityOwnerRef(): QuotaOwnerRef {
  const root = cliStorePath('antigravity');
  if (observedAntigravityAccount?.root === root) {
    return quotaOwnerRefFromKey(observedAntigravityAccount.key);
  }
  const active = readActiveGeminiAccount(root);
  return active
    ? quotaOwnerRefFromKey(accountOwnerKey('antigravity', `${root}\0${active}`))
    : quotaOwnerRefFromKey(cliStoreOwnerKey('antigravity', root));
}

/** Secret-store slot of a Ptah CLI agent's own key (`ptahCli.<id>`). */
export function ptahCliKeySlot(ptahCliId: string): string {
  return `${PTAH_CLI_KEY_PREFIX}.${ptahCliId}`;
}

/** A stored key that identifies someone, or `null` for absent / placeholder. */
function realCredential(raw: string | undefined): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0 || isPlaceholderCredential(trimmed)) return null;
  return trimmed;
}

/**
 * DI face of the owner functions. Every method returns a complete
 * {@link QuotaOwnerRef}; none throws, and none returns or logs material.
 */
@injectable()
export class ProviderOwnerResolver {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_SESSION_QUOTA_PROBE)
    private readonly probe: SessionQuotaProbe,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE)
    private readonly codexAccountUsage: ICodexOwnerKeySource,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER)
    private readonly codexHome: CodexHomeResolver,
  ) {}

  /**
   * The owner of the key stored for a provider. A main session routed through
   * a proxy carries only a placeholder, so its owner is this stored key — the
   * same one the proxy sends upstream.
   */
  async ownerForProviderKey(providerId: string): Promise<QuotaOwnerRef> {
    const credential = await this.readSecret(providerId, providerId);
    return quotaOwnerRefFromKey(
      credential
        ? credentialOwnerKey(providerId, credential)
        : unknownOwnerKey(providerId, `provider-key:${providerId}`),
    );
  }

  /** The owner of a Ptah CLI agent's own key (`ptahCli.<id>` slot). */
  async ownerForPtahCli(
    ptahCliId: string,
    providerId: string,
  ): Promise<QuotaOwnerRef> {
    const credential = await this.readSecret(
      ptahCliKeySlot(ptahCliId),
      providerId,
    );
    return quotaOwnerRefFromKey(
      credential
        ? credentialOwnerKey(providerId, credential)
        : unknownOwnerKey(providerId, `ptah-cli:${ptahCliId}`),
    );
  }

  /**
   * A Claude subscription owner from `accountInfo()`: email plus organization.
   * Without an email the owner is unknown, keyed by `routeMaterial` (the
   * session or run the account was read for).
   */
  ownerForClaudeAccount(
    account: ClaudeAccountInfo,
    routeMaterial: string,
  ): QuotaOwnerRef {
    const email = account?.email?.trim();
    if (!email) {
      return quotaOwnerRefFromKey(
        unknownOwnerKey(CLAUDE_PROVIDER_ID, routeMaterial),
      );
    }
    const organization = account?.organization?.trim() ?? '';
    return quotaOwnerRefFromKey(
      accountOwnerKey(CLAUDE_PROVIDER_ID, `${email}\0${organization}`),
    );
  }

  /**
   * The Codex account last read from the resolved `CODEX_HOME`. Unknown —
   * keyed by that home — before the first read and after the auth file changes.
   */
  ownerForCodexHome(): QuotaOwnerRef {
    const key = this.codexAccountUsage.currentOwnerKey();
    return quotaOwnerRefFromKey(
      key ?? unknownOwnerKey(CODEX_PROVIDER_ID, this.codexHome.path),
    );
  }

  /** A CLI whose quota follows its own on-disk credential store. */
  ownerForCliStore(cli: CliStoreOwner): QuotaOwnerRef {
    return quotaOwnerRefFromKey(cliStoreOwnerKey(cli, cliStorePath(cli)));
  }

  /**
   * The Antigravity account billed by its language server when observed; then
   * the active Gemini account file; then its credential-store owner. The
   * language-server reply shape remains provisional.
   */
  ownerForAntigravity(): QuotaOwnerRef {
    return antigravityOwnerRef();
  }

  /**
   * The owner of a main session, from the route its record was created with:
   *
   * - `native` — the Claude account of that session's own `Query`.
   * - `direct-key` — the stored key of the route's provider.
   * - `proxy` — Codex resolves through its account home; any other provider
   *   through its stored key (the key the proxy sends).
   * - no record, no route, or a proxy without a provider id — unknown, keyed
   *   by the session.
   */
  async ownerForSession(sessionId: string): Promise<QuotaOwnerRef> {
    const route = this.probe.sessionRoute(sessionId);
    const sessionMaterial = `session:${sessionId}`;
    if (
      route?.routeKind === 'proxy' &&
      !route.providerId &&
      route.baseUrlHost === OLLAMA_CLOUD_DIRECT_HOST
    ) {
      return this.ownerForProviderKey('ollama-cloud');
    }
    // The 127.0.0.1:11434 daemon route is shared by local Ollama and Ollama
    // Cloud fallback. Its route has no selected provider/auth-method evidence,
    // so it deliberately remains an unknown owner rather than being guessed.
    if (!route || route.routeKind === 'unknown' || !route.providerId) {
      return quotaOwnerRefFromKey(
        unknownOwnerKey(
          route?.providerId ?? UNROUTED_PROVIDER_ID,
          sessionMaterial,
        ),
      );
    }
    switch (route.routeKind) {
      case 'native':
        return this.ownerForClaudeAccount(
          await this.probe.readAccount(sessionId),
          sessionMaterial,
        );
      case 'direct-key':
        return this.ownerForProviderKey(route.providerId);
      case 'proxy':
        return normaliseOwnerProviderId(route.providerId) === CODEX_PROVIDER_ID
          ? this.ownerForCodexHome()
          : this.ownerForProviderKey(route.providerId);
    }
  }

  /** The secret in `slot`, or `null`. A failed read is logged without detail. */
  private async readSecret(
    slot: string,
    providerId: string,
  ): Promise<string | null> {
    try {
      return realCredential(await this.authSecrets.getProviderKey(slot));
    } catch {
      // degradation-audit: reported - logged at warn with the provider id only;
      // the owner falls back to unknown.
      // The secret store's error text may quote the slot's contents; only the
      // provider id is kept, and the owner falls back to unknown.
      this.logger.warn('[ProviderOwnerResolver] provider key read failed', {
        providerId: normaliseOwnerProviderId(providerId),
      });
      return null;
    }
  }
}

function cliStorePath(cli: CliStoreOwner): string {
  if (cli === 'opencode') {
    const dataHome =
      process.env['XDG_DATA_HOME']?.trim() ||
      join(homedir(), '.local', 'share');
    return join(dataHome, 'opencode');
  }
  return join(homedir(), '.gemini');
}
