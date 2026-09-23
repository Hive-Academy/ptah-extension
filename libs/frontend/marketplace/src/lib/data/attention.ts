/**
 * "Needs attention" items (implementation plan C5 `attention`).
 *
 * Derived ONLY from four sources, each a fact some read already reported:
 *
 * 1. harness health — `summary.level ∈ {degraded, error}` and the targets
 *    `harnessTargetNeedsAttention` flags;
 * 2. connections — OAuth rows whose live state is `expired`/`disconnected`,
 *    and Smithery connections whose status is not `connected`;
 * 3. the newest session's `failed`/`needs-auth` servers;
 * 4. blocked removals (rows whose removal is `blocked`).
 *
 * Nothing is forecast: there is no token-expiry date on the wire
 * (`McpOAuthConnectionState` is a state only), so no "expires in N days" item
 * can be built honestly. Pure and total.
 */

import {
  normalizeServerKey,
  type HarnessHealthSummary,
  type HarnessTargetHealth,
  type SessionMcpServerEntry,
  type SmitheryConnectionSummary,
} from '@ptah-extension/shared';
import {
  harnessTargetLabel,
  harnessTargetNeedsAttention,
} from '../harness/harness-health.model';
import type { ProviderRow } from './provider-row';
import { encodeServerRef } from './server-ref';

export type NeedsAttentionSource =
  'harness' | 'connection' | 'session' | 'blocked-removal';

export type NeedsAttentionSeverity = 'error' | 'warning';

/** Where the item's "Review" link goes. */
export type NeedsAttentionTarget =
  | { readonly kind: 'server'; readonly ref: string }
  | { readonly kind: 'servers' }
  | { readonly kind: 'harness' }
  | { readonly kind: 'smithery' };

export interface NeedsAttentionItem {
  /** Stable across re-derivations; use it to track the item in a list. */
  readonly id: string;
  readonly source: NeedsAttentionSource;
  readonly severity: NeedsAttentionSeverity;
  readonly title: string;
  readonly detail: string;
  readonly target: NeedsAttentionTarget;
}

export interface NeedsAttentionInputs {
  readonly rows: readonly ProviderRow[];
  /** `HarnessHealthStore.summary()` and `.targets()`; `null` when not read. */
  readonly harness: {
    readonly summary: HarnessHealthSummary;
    readonly targets: readonly HarnessTargetHealth[];
  } | null;
  /** `ConnectorLinksStore.smitheryConnections()`. */
  readonly smitheryConnections: readonly SmitheryConnectionSummary[];
  /** The newest session's reported servers. */
  readonly sessionServers: readonly SessionMcpServerEntry[];
}

const SMITHERY_PROBLEMS: Readonly<
  Record<string, { severity: NeedsAttentionSeverity; detail: string }>
> = {
  disconnected: { severity: 'warning', detail: 'Disconnected on Smithery.' },
  auth_required: {
    severity: 'warning',
    detail: 'Smithery needs you to authorize this connection.',
  },
  input_required: {
    severity: 'warning',
    detail: 'Smithery needs more configuration for this connection.',
  },
  error: { severity: 'error', detail: 'Smithery reports an error.' },
  unknown: {
    severity: 'warning',
    detail: 'Smithery reported a status Ptah does not recognise.',
  },
};

/**
 * Every item, errors first, then in source order (harness, connections,
 * session, blocked removals). A session item for a server that already has a
 * connection item is dropped: the connection item names the same server and
 * carries the action that fixes it.
 */
export function needsAttention(
  inputs: NeedsAttentionInputs,
): NeedsAttentionItem[] {
  const connectionItems = [
    ...oauthItems(inputs.rows),
    ...smitheryItems(inputs.smitheryConnections, inputs.rows),
  ];
  const covered = new Set(
    connectionItems.flatMap((item) =>
      item.target.kind === 'server' ? [item.target.ref] : [],
    ),
  );
  const items = [
    ...harnessItems(inputs.harness),
    ...connectionItems,
    ...sessionItems(inputs.sessionServers, inputs.rows).filter(
      (item) => item.target.kind !== 'server' || !covered.has(item.target.ref),
    ),
    ...blockedItems(inputs.rows),
  ];
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        severityRank(a.item.severity) - severityRank(b.item.severity) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

function severityRank(severity: NeedsAttentionSeverity): number {
  return severity === 'error' ? 0 : 1;
}

// ── 1. Harness ────────────────────────────────────────────────────────────────

/**
 * One item per flagged target. When the summary is degraded or failed but no
 * target is flagged (sources still downloading or missing), one summary item
 * says so instead, so the badge's verdict is never silently dropped.
 */
function harnessItems(
  harness: NeedsAttentionInputs['harness'],
): NeedsAttentionItem[] {
  if (harness === null) return [];
  const items = harness.targets
    .filter(harnessTargetNeedsAttention)
    .map((target): NeedsAttentionItem => ({
      id: `harness:${target.target}`,
      source: 'harness',
      severity: target.writeFailed.length > 0 ? 'error' : 'warning',
      title: `${harnessTargetLabel(target.target)} is out of sync`,
      detail: harnessTargetDetail(target),
      target: { kind: 'harness' },
    }));
  const { level, label } = harness.summary;
  if (items.length === 0 && (level === 'degraded' || level === 'error')) {
    items.push({
      id: 'harness:summary',
      source: 'harness',
      severity: level === 'error' ? 'error' : 'warning',
      title: 'Harness sync needs attention',
      detail: label,
      target: { kind: 'harness' },
    });
  }
  return items;
}

function harnessTargetDetail(target: HarnessTargetHealth): string {
  const parts = [
    counted(target.writeFailed.length, 'could not be written'),
    counted(target.missing.length, 'missing'),
    counted(target.overwrittenLocalEdit.length, 'local edits replaced'),
  ].filter((part) => part !== null);
  return parts.join(' · ');
}

function counted(count: number, text: string): string | null {
  return count === 0 ? null : `${count} ${text}`;
}

// ── 2. Connections ────────────────────────────────────────────────────────────

function oauthItems(rows: readonly ProviderRow[]): NeedsAttentionItem[] {
  return rows.flatMap((row): NeedsAttentionItem[] => {
    const connection = row.connection;
    if (row.origin !== 'oauth' || connection?.source !== 'oauth') return [];
    if (connection.state === 'connected') return [];
    return [
      {
        id: `oauth:${row.ref}`,
        source: 'connection',
        severity: 'warning',
        title: `${row.title} needs to reconnect`,
        detail:
          connection.state === 'expired'
            ? 'The sign-in expired.'
            : 'The OAuth connection is disconnected.',
        target: { kind: 'server', ref: row.ref },
      },
    ];
  });
}

/**
 * Every non-connected connection in the namespace, Ptah's or not: all of them
 * share the namespace override a Ptah session receives. A Ptah-managed one
 * links to its row; any other links to the Smithery source page.
 */
function smitheryItems(
  connections: readonly SmitheryConnectionSummary[],
  rows: readonly ProviderRow[],
): NeedsAttentionItem[] {
  const refs = new Set(rows.map((row) => row.ref));
  return connections.flatMap((connection): NeedsAttentionItem[] => {
    const problem = Object.prototype.hasOwnProperty.call(
      SMITHERY_PROBLEMS,
      connection.status,
    )
      ? SMITHERY_PROBLEMS[connection.status]
      : null;
    if (problem === null) return [];
    const ref =
      connection.managedByPtah && connection.serverKey
        ? encodeServerRef({
            origin: 'smithery',
            serverKey: connection.serverKey,
          })
        : null;
    return [
      {
        id: `smithery:${connection.connectionId}`,
        source: 'connection',
        severity: problem.severity,
        title: connection.name,
        detail: problem.detail,
        target:
          ref !== null && refs.has(ref)
            ? { kind: 'server', ref }
            : { kind: 'smithery' },
      },
    ];
  });
}

// ── 3. Session ────────────────────────────────────────────────────────────────

function sessionItems(
  entries: readonly SessionMcpServerEntry[],
  rows: readonly ProviderRow[],
): NeedsAttentionItem[] {
  const seen = new Set<string>();
  return entries.flatMap((entry): NeedsAttentionItem[] => {
    if (entry.status !== 'failed' && entry.status !== 'needs-auth') return [];
    const key = normalizeServerKey(entry.name);
    if (seen.has(key)) return [];
    seen.add(key);
    const row = rowForSessionKey(rows, key);
    return [
      {
        id: `session:${key}`,
        source: 'session',
        severity: entry.status === 'failed' ? 'error' : 'warning',
        title:
          entry.status === 'failed'
            ? `${entry.name} failed to start`
            : `${entry.name} needs sign-in`,
        detail: 'Reported by the most recent session.',
        target:
          row === undefined
            ? { kind: 'servers' }
            : {
                kind: 'server',
                ref: row.ref,
              },
      },
    ];
  });
}

/**
 * The row the session status was applied to (at most one per name, see
 * `provider-row.ts` `sessionOwners`), else the only row with the key. When
 * several rows share the key and none owns the report, no row is picked:
 * the item links to the server list rather than to a guess.
 */
function rowForSessionKey(
  rows: readonly ProviderRow[],
  key: string,
): ProviderRow | undefined {
  const matches = rows.filter(
    (row) => normalizeServerKey(row.serverKey) === key,
  );
  return (
    matches.find((row) => row.statusSource === 'session') ??
    (matches.length === 1 ? matches[0] : undefined)
  );
}

// ── 4. Blocked removals ───────────────────────────────────────────────────────

function blockedItems(rows: readonly ProviderRow[]): NeedsAttentionItem[] {
  return rows.flatMap((row): NeedsAttentionItem[] =>
    row.removal.kind === 'blocked'
      ? [
          {
            id: `blocked:${row.ref}`,
            source: 'blocked-removal',
            severity: 'warning',
            title: `${row.title} can't be removed from Ptah`,
            detail: row.removal.reason,
            target: { kind: 'server', ref: row.ref },
          },
        ]
      : [],
  );
}
