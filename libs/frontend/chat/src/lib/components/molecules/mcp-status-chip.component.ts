/**
 * McpStatusChipComponent — the MCP chip in the chat header (TASK_2026_375 B4.4).
 *
 * The CLI reports every MCP server's status once per session, in the SDK `init`
 * message. Before this task Ptah logged that at debug level and showed nothing,
 * so a Smithery server the CLI itself called `needs-auth` looked installed and
 * simply had no tools (`context.md` F3/F4). This chip is where that verdict
 * finally surfaces.
 *
 * Smart component, deliberately: it reads a session-keyed registry, calls RPC
 * for the recovery read and for the Authorize actions, and navigates. Its only
 * presentational neighbours in `chat-ui` are stateless, so it belongs here.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import {
  PTAH_CONNECTORS,
  ptahConnectorKindHint,
  type McpOAuthConnectedRecord,
  type SessionMcpNotice,
  type SessionMcpServerEntry,
} from '@ptah-extension/shared';

/** One row of the popover. */
export interface McpServerRow {
  /** Server key as the session knows it. */
  readonly key: string;
  /** Friendliest name available: OAuth record, then catalog, then the key. */
  readonly label: string;
  readonly status: string;
  /** Short status wording for the pill. */
  readonly statusLabel: string;
  /** True when the row offers an Authorize button. */
  readonly needsAction: boolean;
  /** One-line explanation of how this server signs in, when we know it. */
  readonly hint: string | null;
}

/**
 * The statuses that mean "listed, but this server will not answer".
 *
 * `failed` is included: the user's next move is the same in both cases — open
 * the surface that owns the connection — and offering nothing on a failed
 * server is what made the original defect invisible.
 */
const ACTIONABLE_STATUSES: readonly string[] = ['needs-auth', 'failed'];

const CHIP_BASE_CLASSES =
  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ' +
  'whitespace-nowrap cursor-pointer transition-colors';

const PILL_BASE_CLASSES = 'rounded px-1.5 py-0.5 whitespace-nowrap';

/**
 * Resolve a catalog entry through the OAuth record's `serverUrl`, never by
 * substring-matching the server key. A key like `oauth-mcp.sentry.dev-mcp`
 * contains `sentry` by coincidence of the host name, and matching on that would
 * attach the wrong label the first time two providers share a word.
 */
function catalogForRecord(
  record: McpOAuthConnectedRecord | undefined,
): (typeof PTAH_CONNECTORS)[number] | undefined {
  if (!record) return undefined;
  const url = normalizeUrl(record.serverUrl);
  return PTAH_CONNECTORS.find(
    (entry) => entry.url && normalizeUrl(entry.url) === url,
  );
}

/** Normalize a server URL for catalog matching (trailing slash, host case). */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

@Component({
  selector: 'ptah-mcp-status-chip',
  standalone: true,
  imports: [NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `display: block` with no padding of its own, so the host collapses to zero
  // height when the `@if` below renders nothing. The chip carries its own
  // spacing INSIDE the guard rather than in a wrapper in `chat-view.html`,
  // which would otherwise leave a padded empty strip on every session that
  // reports no MCP servers.
  styles: [':host { display: block; }'],
  template: `
    @if (rows().length > 0 || notices().length > 0) {
      <div class="bg-base-200/30 px-1 pb-1">
        <ptah-native-popover
          [isOpen]="isOpen()"
          [placement]="'bottom-end'"
          [hasBackdrop]="true"
          [backdropClass]="'transparent'"
          (closed)="isOpen.set(false)"
        >
          <button
            trigger
            type="button"
            [class]="chipClasses()"
            [title]="chipTitle()"
            [attr.aria-expanded]="isOpen()"
            (click)="toggle()"
          >
            <span class="text-[10px] uppercase text-base-content-muted"
              >MCP</span
            >
            <span class="tabular-nums">{{ chipLabel() }}</span>
          </button>

          <div content class="w-80 max-w-[90vw] p-3 text-xs">
            <div class="mb-2 font-semibold">MCP servers</div>

            @for (row of rows(); track row.key) {
              <div
                class="flex items-start gap-2 border-b border-base-content/10 py-1.5 last:border-b-0"
              >
                <div class="min-w-0 flex-1">
                  <div class="truncate font-medium" [title]="row.key">
                    {{ row.label }}
                  </div>
                  @if (row.hint) {
                    <div class="text-base-content-muted">{{ row.hint }}</div>
                  }
                </div>
                <span [class]="pillClasses(row.status)">{{
                  row.statusLabel
                }}</span>
                @if (row.needsAction) {
                  <button
                    type="button"
                    class="rounded border border-warning/40 px-1.5 py-0.5 text-warning transition-colors hover:bg-warning/10"
                    (click)="authorize(row)"
                  >
                    Authorize
                  </button>
                }
              </div>
            } @empty {
              <div class="py-1.5 text-base-content-muted">
                This session reports no MCP servers.
              </div>
            }

            @for (notice of notices(); track notice.code) {
              <div
                class="mt-2 rounded border border-info/25 bg-info/10 p-2"
                [title]="notice.message"
              >
                <div class="mb-1 font-medium text-info">
                  claude.ai connectors are not loaded
                </div>
                <p class="mb-1 text-base-content-muted">
                  Your claude.ai connectors (Gmail, Calendar, Drive…) are
                  disabled because Ptah runs this session on
                  {{ providerLabel() }}. Switch the provider to Claude login to
                  load them.
                </p>
                <button
                  type="button"
                  class="underline transition-colors hover:text-info"
                  (click)="openProviderSettings()"
                >
                  Settings → Providers
                </button>
              </div>
            }
          </div>
        </ptah-native-popover>
      </div>
    }
  `,
})
export class McpStatusChipComponent {
  private readonly registry = inject(SessionMcpStatusRegistry);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);

  /** The SDK session UUID, once the tab knows it. */
  readonly sessionId = input<string | null>(null);
  /**
   * The tab id this surface routes on. The backend pushes under the tabId until
   * the SDK reports the UUID, so both ids are consulted — see
   * `SessionMcpStatusRegistry.statusFor`.
   */
  readonly tabId = input<string | null>(null);

  readonly isOpen = signal(false);

  private readonly oauthRecords = signal<readonly McpOAuthConnectedRecord[]>(
    [],
  );
  private readonly providerName = signal<string | null>(null);
  private destroyed = false;
  /** Session ids whose `session:status` recovery read has already been made. */
  private readonly recovered = new Set<string>();

  private readonly status = computed(() =>
    this.registry.statusFor(this.sessionId(), this.tabId())(),
  );

  readonly notices = computed<readonly SessionMcpNotice[]>(
    () => this.status()?.notices ?? [],
  );

  private readonly servers = computed<readonly SessionMcpServerEntry[]>(
    () => this.status()?.servers ?? [],
  );

  readonly rows = computed<readonly McpServerRow[]>(() => {
    const records = this.oauthRecords();
    return this.servers().map((server) => this.toRow(server, records));
  });

  private readonly attentionCount = computed(
    () => this.rows().filter((row) => row.needsAction).length,
  );

  private readonly connectedCount = computed(
    () => this.rows().filter((row) => row.status === 'connected').length,
  );

  readonly chipLabel = computed(() => {
    const attention = this.attentionCount();
    const connected = this.connectedCount();
    return attention > 0
      ? `${connected}/${this.rows().length}`
      : `${connected}`;
  });

  /**
   * Full class string, base included. Angular forbids a static `class` next to
   * a `[class]` binding on the same element, so the base lives here.
   */
  readonly chipClasses = computed(
    () =>
      `${CHIP_BASE_CLASSES} ${
        this.attentionCount() > 0 || this.notices().length > 0
          ? 'bg-warning/10 border-warning/30 text-warning hover:bg-warning/20'
          : 'bg-base-content/5 border-base-content/10 hover:bg-base-content/10'
      }`,
  );

  readonly chipTitle = computed(() => {
    const attention = this.attentionCount();
    if (attention > 0) {
      return `${attention} MCP server(s) need attention`;
    }
    return `${this.connectedCount()} MCP server(s) connected`;
  });

  /**
   * The provider the session actually runs on, for the notice sentence.
   *
   * Loaded on demand rather than read from `AuthStateService`: that service's
   * `selectedProviderId` defaults to `'openrouter'` until something calls
   * `loadAuthStatus()`, and naming the wrong provider in an explanation is
   * worse than naming none.
   */
  readonly providerLabel = computed(
    () => this.providerName() ?? 'another provider',
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.destroyed = true;
    });

    // Recovery read. A cold-loaded webview (VS Code recreates the webview on
    // panel hide→reshow; HMR reloads it) missed the one `session:mcpStatus`
    // push this session will ever send, so the chip would stay empty for the
    // rest of it. Runs once per session id, and only when nothing is recorded.
    effect(() => {
      const sessionId = this.sessionId();
      if (!sessionId || this.status() || this.recovered.has(sessionId)) return;
      this.recovered.add(sessionId);
      void this.recoverFromSessionStatus(sessionId);
    });
  }

  toggle(): void {
    const next = !this.isOpen();
    this.isOpen.set(next);
    if (next) {
      void this.loadOAuthRecords();
      void this.loadProviderName();
    }
  }

  /**
   * Route the Authorize action by server key.
   *
   * A Connections-API Smithery install appears in the session as ONE server
   * named `smithery` — one namespace endpoint holding several connections in
   * different states — so there is no single connection for this chip to
   * authorize. It opens the Marketplace Smithery surface, which lists the
   * connections with their own per-connection Authorize buttons (B2/B3).
   */
  async authorize(row: McpServerRow): Promise<void> {
    this.isOpen.set(false);
    if (row.key === 'smithery' || row.key.startsWith('smithery')) {
      this.navigateToMarketplace('smithery');
      return;
    }
    if (row.key.startsWith('oauth-')) {
      const record = this.oauthRecords().find((r) => r.serverKey === row.key);
      if (record) {
        await this.rpc.call('mcpDirectory:connectOAuth', {
          serverUrl: record.serverUrl,
          serverKey: record.serverKey,
          name: record.name,
        });
        return;
      }
      // The key claims OAuth but no manifest record backs it. Nothing here can
      // build a connect request, so hand the user the surface that can.
    }
    this.navigateToMarketplace('connectors');
  }

  openProviderSettings(): void {
    this.isOpen.set(false);
    this.appState.setCurrentView('settings');
  }

  pillClasses(status: string): string {
    if (status === 'connected') {
      return `${PILL_BASE_CLASSES} bg-success/15 text-success`;
    }
    if (ACTIONABLE_STATUSES.includes(status)) {
      return `${PILL_BASE_CLASSES} bg-warning/15 text-warning`;
    }
    return `${PILL_BASE_CLASSES} bg-base-content/10 text-base-content-muted`;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private navigateToMarketplace(surface: 'connectors' | 'smithery'): void {
    this.appState.setMarketplaceActiveProvider(surface);
    this.appState.setCurrentView('marketplace');
  }

  private toRow(
    server: SessionMcpServerEntry,
    records: readonly McpOAuthConnectedRecord[],
  ): McpServerRow {
    const isSmithery = server.name === 'smithery';
    const record = records.find((r) => r.serverKey === server.name);
    const catalog = catalogForRecord(record);
    return {
      key: server.name,
      // A blank `name` on the record is absent, not a name — `??` alone would
      // render an empty row label for a manifest entry saved without one.
      label: isSmithery
        ? 'Smithery'
        : record?.name || catalog?.label || server.name,
      status: server.status,
      statusLabel: McpStatusChipComponent.statusLabel(server.status),
      needsAction: ACTIONABLE_STATUSES.includes(server.status),
      hint: isSmithery
        ? ptahConnectorKindHint('smithery')
        : catalog
          ? ptahConnectorKindHint(catalog.kind)
          : null,
    };
  }

  private static statusLabel(status: string): string {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'needs-auth':
        return 'Needs authorization';
      case 'failed':
        return 'Failed';
      case 'pending':
        return 'Connecting';
      case 'disabled':
        return 'Disabled';
      default:
        return status;
    }
  }

  private async recoverFromSessionStatus(sessionId: string): Promise<void> {
    const result = await this.rpc.call('session:status', { sessionId });
    if (this.destroyed || !result.isSuccess()) return;
    const { mcpServers, notices } = result.data;
    // Absent means the backend has nothing recorded, which is different from
    // an empty list. Writing an empty record for it would hide the chip on a
    // session whose init message simply has not arrived yet.
    if (!mcpServers && !notices) return;
    this.registry.record(sessionId, {
      servers: mcpServers ?? [],
      notices: notices ?? [],
    });
  }

  private async loadOAuthRecords(): Promise<void> {
    const result = await this.rpc.call('mcpDirectory:listOAuthConnected', {});
    if (this.destroyed || !result.isSuccess()) return;
    this.oauthRecords.set(result.data.servers);
  }

  private async loadProviderName(): Promise<void> {
    if (this.notices().length === 0 || this.providerName()) return;
    const result = await this.rpc.call('auth:getAuthStatus', {});
    if (this.destroyed || !result.isSuccess()) return;
    const { anthropicProviderId, availableProviders } = result.data;
    const match = availableProviders.find((p) => p.id === anthropicProviderId);
    this.providerName.set(match?.name ?? anthropicProviderId ?? null);
  }
}
