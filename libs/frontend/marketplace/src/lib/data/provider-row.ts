/**
 * `ProviderRow` — the one view model every installed-server surface renders
 * (implementation plan C5 `provider-row`).
 *
 * This file is where an `InstalledServerGroup` (an RPC shape carrying the raw
 * config, secrets included — R3) becomes a UI shape. Two rules hold here and
 * nowhere else:
 *
 * 1. MASKING. The row carries no path back to a config value. `ConfigSummary`
 *    holds env and header KEYS only, and its `env`/`headers` fields are typed
 *    `never`, so a raw config cannot be assigned to it. URL userinfo and query
 *    values, and the values of secret-looking command arguments, are replaced
 *    by {@link MASKED_VALUE}. The group itself is NOT kept on the row: a page
 *    that removes a server looks its group up in the store by {@link ProviderRow.ref}.
 *    Argument masking is heuristic, and two limits are accepted: a URL PATH
 *    is kept (a secret embedded in it is not caught), and a secret argument
 *    is caught only by a secret-looking flag or assignment name, or by its
 *    own shape (a well-known vendor prefix, or a long mixed-case/hex token).
 *    A short or free-form secret after a neutral flag (`--config hunter2`)
 *    and a UUID are shown as written.
 * 2. STATUS HONESTY. `status` comes from the newest session's report, else the
 *    live OAuth state, else the Smithery connection status, else `configured`.
 *    Nothing here answers `connected` without one of those live sources, and
 *    a session's report for a name is given to at most ONE row: the one
 *    Claude Code loads under that name (see {@link sessionOwners}).
 *
 * Pure and total: every input shape produces a row, never a throw.
 */

import {
  PTAH_CONNECTORS,
  normalizeMcpServerUrl,
  normalizeServerKey,
  type McpInstallTarget,
  type McpServerConfig,
  type McpServerOrigin,
  type SessionMcpServerEntry,
} from '@ptah-extension/shared';
import {
  mcpTargetLabel,
  type InstalledServerGroup,
} from '@ptah-extension/chat-ui';
import { resolveInstalledBrandSlug } from '@ptah-extension/ui';
import type {
  ConnectionDates,
  ConnectionDecoration,
} from './connector-links.store';
import { removalLockOf } from './marketplace-inventory.store';
import { encodeServerRef, type ServerRef } from './server-ref';

// ── Public model ──────────────────────────────────────────────────────────────

/** What replaces every masked value in a row. */
export const MASKED_VALUE = '••••';

/**
 * How a server reaches a CLI.
 *
 * - `config`: declared in a config file (the harness targets or the Claude
 *   CLI's own `~/.claude.json`).
 * - `connection`: a hosted connection Ptah holds (Smithery, OAuth), injected
 *   into Ptah's sessions at query time.
 * - `account-connector`: a claude.ai account connector a session reported.
 */
export type ProviderRowKind = 'config' | 'connection' | 'account-connector';

/**
 * Displayed state of one server.
 *
 * `configured` is the only value a row gets without a live source. `unknown`
 * carries the raw value in {@link ProviderRow.statusText}.
 */
export type ProviderStatus =
  | 'connected'
  | 'failed'
  | 'needs-auth'
  | 'needs-input'
  | 'pending'
  | 'disabled'
  | 'expired'
  | 'disconnected'
  | 'configured'
  | 'unknown';

/** Which source {@link ProviderRow.status} was read from. */
export type ProviderStatusSource = 'session' | 'oauth' | 'smithery' | 'config';

/** One CLI a server reaches, and how. */
export interface ProviderTarget {
  readonly target: McpInstallTarget;
  readonly label: string;
  /**
   * `configured`: Ptah (or the user) wrote it into that target's config file.
   * `declared-by-cli`: the CLI's own config declares it (`claude-user` rows).
   */
  readonly via: 'configured' | 'declared-by-cli';
}

/**
 * What the row's removal control does.
 *
 * - `uninstall`: a Ptah-managed config entry.
 * - `confirm-direct`: a config entry Ptah did not write; removal needs an
 *   explicit confirmation naming `configPaths`.
 * - `disconnect`: a Smithery or OAuth connection.
 * - `blocked`: no local removal path; `fixCommand` is the copyable command,
 *   present only when the backend could build a safe one.
 * - `manage-link`: a claude.ai account connector, managed in the account.
 */
export type ProviderRemoval =
  | { readonly kind: 'uninstall' }
  | { readonly kind: 'disconnect' }
  | {
      readonly kind: 'confirm-direct';
      readonly configPaths: readonly string[];
    }
  | {
      readonly kind: 'blocked';
      readonly reason: string;
      readonly fixCommand?: string;
    }
  | { readonly kind: 'manage-link'; readonly reason: string };

/** A stdio server: command, masked arguments and env KEYS. */
export interface StdioConfigSummary {
  readonly transport: 'stdio';
  readonly command: string;
  /** Arguments with secret-looking values replaced by {@link MASKED_VALUE}. */
  readonly args: readonly string[];
  readonly envKeys: readonly string[];
  /** Never present: a value field would let a secret through. */
  readonly env?: never;
  readonly headers?: never;
}

/** A remote server: masked URL and env/header KEYS. */
export interface RemoteConfigSummary {
  readonly transport: 'http' | 'sse';
  /**
   * The endpoint with userinfo removed and every query value masked, or `null`
   * when the row has no URL (claude.ai connectors never send one).
   */
  readonly url: string | null;
  readonly envKeys: readonly string[];
  readonly headerKeys: readonly string[];
  /** Never present: a value field would let a secret through. */
  readonly env?: never;
  readonly headers?: never;
}

/** A server's config with every value that could be a secret removed. */
export type ConfigSummary = StdioConfigSummary | RemoteConfigSummary;

/** One installed server, ready to render. */
export interface ProviderRow {
  /** `encodeServerRef` — the detail route segment and the store's removal id. */
  readonly ref: string;
  readonly serverKey: string;
  readonly kind: ProviderRowKind;
  readonly title: string;
  /** A vendored brand slug, or `null` for a monogram. */
  readonly brand: string | null;
  readonly origin: McpServerOrigin;
  readonly originLabel: string;
  /** In {@link MCP_TARGET_ORDER}. Empty for connections and connectors. */
  readonly targets: readonly ProviderTarget[];
  readonly status: ProviderStatus;
  readonly statusSource: ProviderStatusSource;
  /** The raw status text, present only when `status === 'unknown'`. */
  readonly statusText?: string;
  /**
   * The live OAuth / Smithery state for `connection` rows, whatever
   * {@link status} shows. `null` when the links store has no answer.
   */
  readonly connection: ConnectionDecoration | null;
  readonly removal: ProviderRemoval;
  readonly configSummary: ConfigSummary;
  readonly configPaths: readonly string[];
  /** The catalogue description, present only when the server matches an entry. */
  readonly description?: string;
  /** Connection dates, present only when the links store knows one. */
  readonly dates?: ConnectionDates;
}

/** The live inputs a row's status and dates are read from. */
export interface ProviderRowSources {
  /** The newest session's reported servers; empty when no session reported. */
  readonly sessionServers: readonly SessionMcpServerEntry[];
  /** `ConnectorLinksStore.statusFor`. */
  readonly statusFor: (server: ServerRef) => ConnectionDecoration | null;
  /** `ConnectorLinksStore.datesFor`. */
  readonly datesFor: (serverKey: string) => ConnectionDates;
}

// ── Target order ──────────────────────────────────────────────────────────────

/**
 * Rank of each target. The order is chat-ui's `TARGET_LABELS`
 * (`installed-mcp-groups.ts:37-50`), which that lib does not export; a
 * `Record` over the union makes a new target without a rank a compile error.
 */
const TARGET_RANK: Readonly<Record<McpInstallTarget, number>> = {
  vscode: 0,
  claude: 1,
  cursor: 2,
  copilot: 3,
  codex: 4,
  antigravity: 5,
  opencode: 6,
};

/** Every install target, in display order. */
export const MCP_TARGET_ORDER: readonly McpInstallTarget[] = (
  Object.keys(TARGET_RANK) as McpInstallTarget[]
).sort((a, b) => TARGET_RANK[a] - TARGET_RANK[b]);

/** Whether a string is an install target (harness target ids are checked here). */
export function isMcpInstallTarget(value: string): value is McpInstallTarget {
  return Object.prototype.hasOwnProperty.call(TARGET_RANK, value);
}

/** Sort comparator for targets in display order. */
export function compareTargets(
  a: McpInstallTarget,
  b: McpInstallTarget,
): number {
  return TARGET_RANK[a] - TARGET_RANK[b];
}

// ── Mapping ───────────────────────────────────────────────────────────────────

const BLOCKED_FALLBACK_REASON = 'Ptah cannot remove this server from here.';

/** Map every group, reading each live source once. */
export function toProviderRows(
  groups: readonly InstalledServerGroup[],
  sources: ProviderRowSources,
): ProviderRow[] {
  const sessionByKey = new Map<string, SessionMcpServerEntry>();
  for (const entry of sources.sessionServers) {
    const key = normalizeServerKey(entry.name);
    if (key && !sessionByKey.has(key)) sessionByKey.set(key, entry);
  }
  const owners = sessionOwners(groups);
  return groups.map((group, index) =>
    toProviderRow(
      group,
      owners.has(index)
        ? sessionByKey.get(normalizeServerKey(group.serverKey))
        : undefined,
      sources,
    ),
  );
}

function toProviderRow(
  group: InstalledServerGroup,
  session: SessionMcpServerEntry | undefined,
  sources: ProviderRowSources,
): ProviderRow {
  const serverRef: ServerRef = {
    origin: group.origin,
    serverKey: group.serverKey,
  };
  const config = group.servers[0]?.config;
  const serverUrl = remoteUrlOf(config);
  const connection = sources.statusFor(serverRef);
  const status = statusOf(session, connection);
  const description = catalogueDescription(group.serverKey, serverUrl);
  const kind = kindOf(group.origin);
  const dates = kind === 'connection' ? sources.datesFor(group.serverKey) : {};

  return {
    ref: encodeServerRef(serverRef),
    serverKey: group.serverKey,
    kind,
    title: group.serverKey,
    brand: resolveInstalledBrandSlug({ serverKey: group.serverKey, serverUrl }),
    origin: group.origin,
    originLabel: group.originLabel,
    targets: targetsOf(group),
    ...status,
    connection,
    removal: removalOf(group),
    configSummary: summarizeConfig(config),
    configPaths: [...group.configPaths],
    ...(description === undefined ? {} : { description }),
    ...(Object.keys(dates).length === 0 ? {} : { dates }),
  };
}

function kindOf(origin: McpServerOrigin): ProviderRowKind {
  switch (origin) {
    case 'harness-config':
    case 'claude-user':
      return 'config';
    case 'smithery':
    case 'oauth':
      return 'connection';
    case 'claude-connector':
      return 'account-connector';
  }
}

// ── Session ownership ─────────────────────────────────────────────────────────

/**
 * Claude Code's MCP scopes, lowest precedence first. A session loads ONE
 * server per name, so its report for a name describes the definition from
 * the highest scope that declares it.
 *
 * - `local > project > user`: the CLI's own rule for `~/.claude.json`
 *   (`claude-user-mcp.reader.ts:88-89`) and the SDK's documented ladder
 *   `user < project < local < flag < policy` (claude-agent-sdk
 *   `sdk.d.ts:6964`).
 * - `dynamic` on top: Ptah hands OAuth and Smithery servers to the SDK's
 *   `mcpServers` option (`sdk-query-options-builder.ts:967`), which is the
 *   `--mcp-config` flag layer (`sdk.d.ts:6544`), above `local` in that ladder.
 * - `claudeai` at the bottom: a connector row exists only for a name no other
 *   row has (`mcp-connector-rows.ts:57-60`), so its rank never decides a tie.
 */
const SCOPE_RANK = {
  claudeai: 0,
  user: 1,
  project: 2,
  local: 3,
  dynamic: 4,
} as const;

/** The scope a row's definition has, as a range when the wire cannot say. */
interface ScopeRange {
  readonly low: number;
  readonly high: number;
}

const exactly = (scope: keyof typeof SCOPE_RANK): ScopeRange => ({
  low: SCOPE_RANK[scope],
  high: SCOPE_RANK[scope],
});

/**
 * The scope through which a Ptah session loads this row, or `null` when it
 * cannot load it at all.
 *
 * - `harness-config`: only through the `claude` target, `.mcp.json`, read via
 *   the always-present `project` setting source
 *   (`sdk-query-options-builder.ts:988-992`). A VS Code- or Codex-only entry
 *   is a different configuration that happens to share the name.
 * - `claude-user`: `~/.claude.json` holds a `local` map
 *   (`projects[<workspace>].mcpServers`) and a `user` map, and the backend
 *   folds which one a row came from into prose only
 *   (`mcp-install.service.ts:303-329`), so the row spans both.
 */
function sessionScopeOf(group: InstalledServerGroup): ScopeRange | null {
  switch (group.origin) {
    case 'harness-config':
      return group.targets.includes('claude') ? exactly('project') : null;
    case 'claude-user':
      return { low: SCOPE_RANK.user, high: SCOPE_RANK.local };
    case 'smithery':
    case 'oauth':
      return exactly('dynamic');
    case 'claude-connector':
      return exactly('claudeai');
  }
}

/**
 * Indexes of the groups that own the session's report for their name.
 *
 * A group owns it when the session can load it and it outranks every other
 * loadable group of the same normalized name under EVERY scope its range
 * allows. When that is undecidable — a `claude-user` row (local or user)
 * beside a `.mcp.json` row (project), or two rows of one scope — no group
 * owns it, and each falls back to its own OAuth / Smithery / `configured`
 * status: a status the row may not have earned is worse than none.
 */
function sessionOwners(
  groups: readonly InstalledServerGroup[],
): ReadonlySet<number> {
  const byKey = new Map<string, { index: number; scope: ScopeRange }[]>();
  groups.forEach((group, index) => {
    const scope = sessionScopeOf(group);
    const key = normalizeServerKey(group.serverKey);
    if (scope === null || key === '') return;
    const candidates = byKey.get(key) ?? [];
    candidates.push({ index, scope });
    byKey.set(key, candidates);
  });
  const owners = new Set<number>();
  for (const candidates of byKey.values()) {
    const owner = candidates.find((candidate) =>
      candidates.every(
        (other) =>
          other === candidate || candidate.scope.low > other.scope.high,
      ),
    );
    if (owner !== undefined) owners.add(owner.index);
  }
  return owners;
}

type StatusFields = Pick<ProviderRow, 'status' | 'statusSource' | 'statusText'>;

const SESSION_STATUSES: Readonly<Record<string, ProviderStatus>> = {
  connected: 'connected',
  failed: 'failed',
  'needs-auth': 'needs-auth',
  pending: 'pending',
  disabled: 'disabled',
};

const SMITHERY_STATUSES: Readonly<Record<string, ProviderStatus>> = {
  connected: 'connected',
  disconnected: 'disconnected',
  auth_required: 'needs-auth',
  input_required: 'needs-input',
  error: 'failed',
};

/** Session → OAuth → Smithery → `configured`. */
function statusOf(
  session: SessionMcpServerEntry | undefined,
  connection: ConnectionDecoration | null,
): StatusFields {
  if (session !== undefined) {
    return known(SESSION_STATUSES, session.status, 'session');
  }
  if (connection?.source === 'oauth') {
    return { status: connection.state, statusSource: 'oauth' };
  }
  if (connection?.source === 'smithery') {
    return known(SMITHERY_STATUSES, connection.status, 'smithery');
  }
  return { status: 'configured', statusSource: 'config' };
}

function known(
  table: Readonly<Record<string, ProviderStatus>>,
  raw: string,
  statusSource: ProviderStatusSource,
): StatusFields {
  return Object.prototype.hasOwnProperty.call(table, raw)
    ? { status: table[raw], statusSource }
    : { status: 'unknown', statusSource, statusText: raw };
}

function targetsOf(group: InstalledServerGroup): ProviderTarget[] {
  const configured = new Set(group.targets);
  const targets: ProviderTarget[] = [...configured].map((target) => ({
    target,
    label: mcpTargetLabel(target),
    via: 'configured' as const,
  }));
  // `~/.claude.json` belongs to the `claude` CLI: the row has no harness
  // target, but Claude Code is exactly the CLI that loads it.
  if (group.origin === 'claude-user' && !configured.has('claude')) {
    targets.push({
      target: 'claude',
      label: mcpTargetLabel('claude'),
      via: 'declared-by-cli',
    });
  }
  return targets.sort((a, b) => compareTargets(a.target, b.target));
}

/**
 * The removal control. `removalFixCommand` is read only through
 * {@link removalLockOf}, i.e. only for blocked rows: a removable row that
 * happens to carry one never shows a command beside a working Remove button.
 */
function removalOf(group: InstalledServerGroup): ProviderRemoval {
  switch (group.removal) {
    case 'ptah-managed':
      return { kind: 'uninstall' };
    case 'direct':
      return { kind: 'confirm-direct', configPaths: [...group.configPaths] };
    case 'smithery':
    case 'oauth':
      return { kind: 'disconnect' };
    case 'none': {
      if (group.origin === 'claude-connector') {
        return {
          kind: 'manage-link',
          reason: group.removalBlockedReason ?? BLOCKED_FALLBACK_REASON,
        };
      }
      const lock = removalLockOf(group) ?? { reason: BLOCKED_FALLBACK_REASON };
      return { kind: 'blocked', ...lock };
    }
  }
}

// ── Config masking ────────────────────────────────────────────────────────────

/** Argument and assignment names whose values are treated as secrets. */
const SECRET_NAME = /key|token|secret|passw|pwd|auth|credential|bearer|cookie/i;

/** `NAME=value` or `NAME: value` inside one argument. */
const ASSIGNMENT = /^([^=:\s]+)(\s*[=:]\s*)(.+)$/;

/**
 * Values that are secrets by shape alone, whatever flag precedes them. Each
 * vendor rule needs its prefix AND a token-length tail, so a package or word
 * that merely starts the same way (`sk-mcp`, `skill-creator`) is kept.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /^sk-[A-Za-z0-9_-]{16,}$/, // OpenAI, Anthropic (`sk-ant-…`)
  /^[rs]k_(?:live|test)_[A-Za-z0-9]{10,}$/, // Stripe secret / restricted
  /^gh[opsur]_[A-Za-z0-9]{20,}$/, // GitHub token
  /^github_pat_[A-Za-z0-9_]{20,}$/, // GitHub fine-grained token
  /^glpat-[A-Za-z0-9_-]{20,}$/, // GitLab token
  /^xox[abeoprs]-[A-Za-z0-9-]{10,}$/, // Slack token
  /^(?:AKIA|ASIA)[A-Z0-9]{16}$/, // AWS access key id
  /^AIza[A-Za-z0-9_-]{35}$/, // Google API key
  /^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/, // JWT
  // A long unbroken token mixing upper, lower and digits. No `/`, `\`, `.`,
  // `@`, `:` or inner `=`, so paths, scoped packages, URLs and flag
  // assignments never match; a long CamelCase word with a digit can, and is
  // masked — the safe direction for a display value.
  /^(?=[^0-9]*[0-9])(?=[^a-z]*[a-z])(?=[^A-Z]*[A-Z])[A-Za-z0-9][A-Za-z0-9_+-]{31,}={0,2}$/,
  // A long hex token (32+ digits, letters and numbers mixed).
  /^(?=[^0-9]*[0-9])(?=[^a-f]*[a-f])[0-9a-f]{32,}$/,
  /^(?=[^0-9]*[0-9])(?=[^A-F]*[A-F])[0-9A-F]{32,}$/,
];

function looksLikeSecret(value: string): boolean {
  return SECRET_SHAPES.some((shape) => shape.test(value));
}

function summarizeConfig(config: McpServerConfig | undefined): ConfigSummary {
  if (config === undefined) {
    return { transport: 'http', url: null, envKeys: [], headerKeys: [] };
  }
  const envKeys = keysOf(config.env);
  if (config.type === 'stdio') {
    return {
      transport: 'stdio',
      command: config.command,
      args: maskArgs(config.args ?? []),
      envKeys,
    };
  }
  return {
    transport: config.type,
    url: config.url.trim() === '' ? null : maskUrl(config.url),
    envKeys,
    headerKeys: keysOf(config.headers),
  };
}

function keysOf(
  record: Readonly<Record<string, string>> | undefined,
): string[] {
  return record === undefined ? [] : Object.keys(record).sort();
}

function remoteUrlOf(config: McpServerConfig | undefined): string | null {
  if (config === undefined || config.type === 'stdio') return null;
  return config.url.trim() === '' ? null : config.url;
}

/**
 * Userinfo removed, every query value masked (any name can carry a token),
 * fragment dropped. The path is kept: it is what identifies the server.
 */
function maskUrl(raw: string): string {
  const withoutFragment = raw.trim().split('#')[0];
  const queryAt = withoutFragment.indexOf('?');
  const base = (
    queryAt === -1 ? withoutFragment : withoutFragment.slice(0, queryAt)
  ).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
  if (queryAt === -1) return base;
  const names = withoutFragment
    .slice(queryAt + 1)
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => pair.split('=')[0]);
  return names.length === 0
    ? base
    : `${base}?${names.map((name) => `${name}=${MASKED_VALUE}`).join('&')}`;
}

/**
 * Mask what an argument list can leak: the value after a secret-looking flag
 * (`--api-key sk-…`), a secret-looking assignment (`--token=…`,
 * `Authorization: Bearer …`), any argument or assignment value shaped like a
 * secret ({@link SECRET_SHAPES}, so `--config sk-…` too), and the
 * userinfo/query of a URL argument. Limits: see the file header.
 */
function maskArgs(args: readonly string[]): string[] {
  const masked: string[] = [];
  let maskNext = false;
  for (const arg of args) {
    if (maskNext || looksLikeSecret(arg)) {
      masked.push(MASKED_VALUE);
      maskNext = false;
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) {
      masked.push(maskUrl(arg));
      continue;
    }
    const assignment = ASSIGNMENT.exec(arg);
    if (
      assignment !== null &&
      (SECRET_NAME.test(assignment[1]) || looksLikeSecret(assignment[3]))
    ) {
      masked.push(`${assignment[1]}${assignment[2]}${MASKED_VALUE}`);
      continue;
    }
    maskNext = arg.startsWith('-') && SECRET_NAME.test(arg);
    masked.push(arg);
  }
  return masked;
}

// ── Catalogue description ─────────────────────────────────────────────────────

/**
 * The catalogue description for a server that matches an entry by URL, then by
 * id — the same trust the installed-row brand resolver extends. `undefined`
 * when nothing matches: descriptions are never invented.
 */
function catalogueDescription(
  serverKey: string,
  serverUrl: string | null,
): string | undefined {
  const url = serverUrl === null ? null : normalizeMcpServerUrl(serverUrl);
  const key = normalizeServerKey(serverKey);
  const match =
    (url === null
      ? undefined
      : PTAH_CONNECTORS.find(
          (connector) =>
            connector.url !== undefined &&
            normalizeMcpServerUrl(connector.url) === url,
        )) ??
    PTAH_CONNECTORS.find(
      (connector) => key !== '' && normalizeServerKey(connector.id) === key,
    );
  return match?.description;
}
