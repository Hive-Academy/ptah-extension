import { Injectable, inject, signal } from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { MARKETPLACE_RPC_TIMEOUTS } from '@ptah-extension/chat-ui';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import {
  PTAH_CONNECTORS,
  ptahConnectorKindHint,
  type McpOAuthConnectedRecord,
  type SessionMcpNotice,
  type SessionMcpServerEntry,
} from '@ptah-extension/shared';

export interface McpServerRow {
  readonly key: string;
  readonly label: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly needsAction: boolean;
  readonly hint: string | null;
}

/**
 * A failed server needs the same user action as one awaiting authorization:
 * open the surface that owns its connection.
 */
const ACTIONABLE_STATUSES: readonly string[] = ['needs-auth', 'failed'];
const RENDERED_NOTICE_CODES: readonly SessionMcpNotice['code'][] = [
  'claude-ai-connectors-disabled',
  'capability-policy-unverified',
];

export function mcpPillClasses(status: string): string {
  const base = 'rounded px-1.5 py-0.5 whitespace-nowrap';
  if (status === 'connected') return `${base} bg-success/15 text-success`;
  if (ACTIONABLE_STATUSES.includes(status)) return `${base} bg-warning/15 text-warning`;
  return `${base} bg-base-content/10 text-base-content-muted`;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected': return 'Connected';
    case 'needs-auth': return 'Needs authorization';
    case 'failed': return 'Failed';
    case 'pending': return 'Connecting';
    case 'disabled': return 'Disabled';
    default: return status;
  }
}

@Injectable({ providedIn: 'root' })
export class McpServerStatusService {
  private readonly registry = inject(SessionMcpStatusRegistry);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);
  /** Session ids with a status read in flight; callers only recover a session with no recorded status. */
  private readonly recovering = new Set<string>();
  private readonly _oauthRecords = signal<readonly McpOAuthConnectedRecord[]>([]);
  private readonly _providerName = signal<string | null>(null);
  readonly providerName = this._providerName.asReadonly();

  notices(notices: readonly SessionMcpNotice[] = []): readonly SessionMcpNotice[] {
    return notices.filter((notice) => RENDERED_NOTICE_CODES.includes(notice.code));
  }

  rows(servers: readonly SessionMcpServerEntry[] = []): readonly McpServerRow[] {
    const records = this._oauthRecords();
    return servers.map((server) => {
      const isSmithery = server.name === 'smithery';
      const record = records.find((r) => r.serverKey === server.name);
      // Match the catalog by server URL. Server keys can contain provider names
      // by coincidence and would attach the wrong label if matched by substring.
      const catalog = record
        ? PTAH_CONNECTORS.find((entry) =>
            entry.url && normalizeUrl(entry.url) === normalizeUrl(record.serverUrl))
        : undefined;
      return {
        key: server.name,
        // A blank manifest name is absent, so use the catalog label or key.
        label: isSmithery ? 'Smithery' : record?.name || catalog?.label || server.name,
        status: server.status,
        statusLabel: statusLabel(server.status),
        needsAction: ACTIONABLE_STATUSES.includes(server.status),
        hint: isSmithery
          ? ptahConnectorKindHint('smithery')
          : catalog ? ptahConnectorKindHint(catalog.kind) : null,
      };
    });
  }

  pillClasses(status: string): string {
    return mcpPillClasses(status);
  }

  async recover(sessionId: string): Promise<void> {
    if (this.recovering.has(sessionId)) return;
    this.recovering.add(sessionId);
    try {
      const result = await this.rpc.call('session:status', { sessionId });
      if (!result.isSuccess()) return;
      const { mcpServers, notices } = result.data;
      // Absent means the backend has nothing recorded yet, unlike an empty list.
      // Do not hide the chip or card while the session init push may still arrive.
      if (!mcpServers && !notices) return;
      this.registry.record(sessionId, {
        servers: mcpServers ?? [],
        notices: notices ?? [],
      });
    } finally {
      // The id only deduplicates concurrent mounts; the root service must not
      // keep an entry for every session it has read.
      this.recovering.delete(sessionId);
    }
  }

  async loadOAuthRecords(): Promise<void> {
    const result = await this.rpc.call('mcpDirectory:listOAuthConnected', {});
    if (result.isSuccess()) this._oauthRecords.set(result.data.servers);
  }

  async loadProviderName(notices: readonly SessionMcpNotice[]): Promise<void> {
    // Read on every notice change: the user may switch provider without a restart.
    if (!notices.some((notice) => notice.code === 'claude-ai-connectors-disabled')) return;
    const result = await this.rpc.call('auth:getAuthStatus', {});
    if (!result.isSuccess()) return;
    const { anthropicProviderId, availableProviders } = result.data;
    const match = availableProviders.find((p) => p.id === anthropicProviderId);
    this._providerName.set(match?.name ?? anthropicProviderId ?? null);
  }

  async authorize(row: McpServerRow): Promise<void> {
    if (row.key === 'smithery' || row.key.startsWith('smithery')) {
      this.appState.openMarketplace({ page: 'servers', source: 'smithery' });
      return;
    }
    if (row.key.startsWith('oauth-')) {
      const record = this._oauthRecords().find((r) => r.serverKey === row.key);
      if (record) {
        await this.rpc.call('mcpDirectory:connectOAuth', {
          serverUrl: record.serverUrl,
          serverKey: record.serverKey,
          name: record.name,
        }, { timeout: MARKETPLACE_RPC_TIMEOUTS.OAUTH_CONNECT_MS });
        return;
      }
    }
    this.appState.openMarketplace({ page: 'connectors' });
  }

  openProviderSettings(): void {
    this.appState.setCurrentView('settings');
  }
}
