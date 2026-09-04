import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  input,
  viewChild,
  OnInit,
  DestroyRef,
} from '@angular/core';
import {
  LucideAngularModule,
  Search,
  Check,
  Plug,
  KeyRound,
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  PTAH_CONNECTORS,
  PTAH_CONNECTOR_CATEGORIES,
  ptahConnectorCategoryLabel,
  ptahConnectorKindHint,
} from '@ptah-extension/shared';
import type {
  PtahConnector,
  PtahConnectorCategory,
  McpOAuthConnectedRecord,
  McpOAuthConnectionState,
  SmitheryConnectionSummary,
} from '@ptah-extension/shared';
import { OAuthSurfaceComponent } from './oauth-surface.component';

/**
 * Rendered state of one catalog card.
 *
 * Deliberately narrower than the two wire enums it merges. The card only has
 * three actions, so it only needs the four states that pick between them:
 * `not-connected` → Connect, `needs-auth` → Authorize, `error` → Authorize plus
 * the reason, `connected` → Disconnect.
 */
export type ConnectorStatus =
  | 'not-connected'
  | 'connected'
  | 'needs-auth'
  | 'error';

/** What the surface knows about one catalog entry after the status merge. */
export interface ConnectorLink {
  readonly status: ConnectorStatus;
  /** The key every action addresses. Absent when nothing is connected yet. */
  readonly serverKey?: string;
  /** Reason text for `error`, shown on the card. */
  readonly detail?: string;
  /**
   * True for a Smithery connection that exists in the namespace but carries no
   * Ptah install record. Ptah must not remove someone else's connection, so
   * Disconnect is withheld for these.
   */
  readonly managedElsewhere?: boolean;
}

/** How often the Smithery setup poll asks for a fresh connection status. */
const POLL_INTERVAL_MS = 3_000;
/** How long the Smithery setup poll runs before it gives up. */
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

/** Copy used when the host cannot supply an interactive OAuth redirect URL. */
const REDIRECT_URL_FALLBACK = 'the redirect URL shown above';

/**
 * Compare two MCP server URLs the way the manifest and the catalog disagree
 * about them: a trailing slash and host case are not a difference.
 */
function normalizeServerUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

/**
 * ConnectorsSurfaceComponent — the `connectors` Marketplace descriptor, and the
 * first thing the Marketplace shows.
 *
 * It answers the question the other surfaces do not: "which apps can I connect,
 * and which ones already are?" It merges three sources into one grid:
 *
 *  - `PTAH_CONNECTORS` — the curated, probe-verified catalog in `libs/shared`.
 *  - `mcpDirectory:listOAuthConnected` + `mcpDirectory:oauthStatus` — the state
 *    of every directly-connected OAuth server, matched to a catalog entry by
 *    its `serverUrl`.
 *  - `mcpDirectory:listSmitheryConnections` — the state of every connection in
 *    the active Smithery namespace, matched by its `server` (the registry
 *    qualified name).
 *
 * Connect routes by `kind`:
 *  - `oauth-dcr` → `mcpDirectory:connectOAuth`, one long-running await.
 *  - `oauth-app` → there is no app to authorize yet, so it opens the embedded
 *    custom-server form pre-filled with Advanced expanded, which is where the
 *    client id and secret go.
 *  - `smithery` → `installSmithery`, then `openSmitherySetup` when Smithery
 *    reports a setup step, then a 3-second poll until the connection reports
 *    `connected`.
 *
 * The custom-server form is the real {@link OAuthSurfaceComponent}, embedded
 * rather than reimplemented. It stays mounted inside a collapsed `<details>` so
 * an `oauth-app` Connect can fill it in without waiting for a mount.
 *
 * Complexity Level: 3 — catalog filter + two-source status merge + per-kind
 * connect routing + a bounded background poll. Patterns: signal state, computed
 * merge, per-id inflight Sets, timer chain cancelled on destroy.
 */
@Component({
  selector: 'ptah-connectors-surface',
  standalone: true,
  imports: [LucideAngularModule, OAuthSurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './connectors-surface.component.html',
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ConnectorsSurfaceComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  /** Increment to reload the merged status (parity with the other surfaces). */
  public readonly refreshTrigger = input(0);

  protected readonly SearchIcon = Search;
  protected readonly CheckIcon = Check;
  protected readonly PlugIcon = Plug;
  protected readonly KeyRoundIcon = KeyRound;
  protected readonly SparklesIcon = Sparkles;
  protected readonly TriangleAlertIcon = TriangleAlert;

  /** The embedded custom-server form, filled in for the `oauth-app` kind. */
  private readonly customForm = viewChild(OAuthSurfaceComponent);

  public readonly connectors = PTAH_CONNECTORS;

  public readonly searchQuery = signal('');
  /** Active category chip. `null` is the All chip. */
  public readonly activeCategory = signal<PtahConnectorCategory | null>(null);

  /** Whether the "Connect a custom server" disclosure is expanded. */
  public readonly customFormOpen = signal(false);

  /** The app-required connector whose provider setup is currently displayed. */
  public readonly setupConnector = signal<PtahConnector | null>(null);

  /**
   * Provider steps with the embedded form's host-specific redirect URL filled
   * in. The form already loads that value once, so this surface reuses it
   * rather than issuing a second RPC call.
   */
  public readonly setupSteps = computed<readonly string[]>(() => {
    const connector = this.setupConnector();
    if (connector?.kind !== 'oauth-app') return [];
    const redirectUrl = this.customForm()?.redirectUri();
    const replacement = redirectUrl ?? REDIRECT_URL_FALLBACK;
    return (connector.setupSteps ?? []).map((step) =>
      step.replaceAll('{redirectUrl}', replacement),
    );
  });

  public readonly oauthRecords = signal<McpOAuthConnectedRecord[]>([]);
  /** Per-serverKey OAuth state, from `mcpDirectory:oauthStatus`. */
  public readonly oauthStates = signal<
    ReadonlyMap<string, McpOAuthConnectionState>
  >(new Map());
  public readonly smitheryConnections = signal<SmitheryConnectionSummary[]>([]);
  /** The Smithery namespace the connections came from, or null. */
  public readonly smitheryNamespace = signal<string | null>(null);

  public readonly isLoading = signal(false);
  public readonly loadError = signal<string | null>(null);
  public readonly actionError = signal<string | null>(null);

  /** Connector ids with an action in flight. */
  public readonly busyIds = signal<ReadonlySet<string>>(new Set());
  /** Connector ids waiting on a Smithery setup poll. */
  public readonly pollingIds = signal<ReadonlySet<string>>(new Set());

  /** Pending poll timers, by connector id. Cleared on destroy. */
  private readonly pollTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /** Category chips, limited to the categories the catalog actually uses. */
  public readonly categories = computed<readonly PtahConnectorCategory[]>(
    () => {
      const used = new Set(this.connectors.map((c) => c.category));
      return PTAH_CONNECTOR_CATEGORIES.filter((c) => used.has(c));
    },
  );

  /** The catalog after the search box and the category chip. */
  public readonly visibleConnectors = computed<readonly PtahConnector[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const category = this.activeCategory();
    return this.connectors.filter((connector) => {
      if (category !== null && connector.category !== category) return false;
      if (query.length === 0) return true;
      return (
        connector.label.toLowerCase().includes(query) ||
        connector.description.toLowerCase().includes(query) ||
        connector.id.includes(query)
      );
    });
  });

  /**
   * The status merge: catalog entry → what the two manifests say about it.
   *
   * A `disconnected` OAuth record and a Smithery connection in any state other
   * than `connected` both mean the same thing to the user — the app is listed
   * but will not answer — so both resolve to `needs-auth` and an Authorize
   * button. Only an explicit Smithery `error` state gets its own branch,
   * because it carries a reason worth showing.
   */
  public readonly links = computed<ReadonlyMap<string, ConnectorLink>>(() => {
    const oauthByUrl = new Map<string, McpOAuthConnectedRecord>();
    for (const record of this.oauthRecords()) {
      oauthByUrl.set(normalizeServerUrl(record.serverUrl), record);
    }
    const smitheryByServer = new Map<string, SmitheryConnectionSummary>();
    for (const connection of this.smitheryConnections()) {
      if (connection.server)
        smitheryByServer.set(connection.server, connection);
    }

    const states = this.oauthStates();
    const merged = new Map<string, ConnectorLink>();

    for (const connector of this.connectors) {
      if (connector.kind === 'smithery') {
        const connection = smitheryByServer.get(
          connector.smitheryQualifiedName ?? '',
        );
        if (!connection) {
          merged.set(connector.id, { status: 'not-connected' });
          continue;
        }
        const managedElsewhere = !connection.managedByPtah;
        const serverKey = connection.serverKey;
        if (connection.status === 'connected') {
          merged.set(connector.id, {
            status: 'connected',
            serverKey,
            managedElsewhere,
          });
        } else if (connection.status === 'error') {
          merged.set(connector.id, {
            status: 'error',
            serverKey,
            managedElsewhere,
            detail: 'Smithery reported an error for this connection.',
          });
        } else {
          merged.set(connector.id, {
            status: 'needs-auth',
            serverKey,
            managedElsewhere,
          });
        }
        continue;
      }

      const record = oauthByUrl.get(normalizeServerUrl(connector.url ?? ''));
      if (!record) {
        merged.set(connector.id, { status: 'not-connected' });
        continue;
      }
      const state = states.get(record.serverKey) ?? 'disconnected';
      merged.set(connector.id, {
        status: state === 'connected' ? 'connected' : 'needs-auth',
        serverKey: record.serverKey,
      });
    }
    return merged;
  });

  /** Reload the merged status when `refreshTrigger` changes (skips initial 0). */
  private readonly refreshEffect = effect(() => {
    if (this.refreshTrigger() > 0) {
      void this.load();
    }
  });

  public async ngOnInit(): Promise<void> {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.stopAllPolling();
    });
    await this.load();
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  public linkOf(connector: PtahConnector): ConnectorLink {
    return this.links().get(connector.id) ?? { status: 'not-connected' };
  }

  public statusOf(connector: PtahConnector): ConnectorStatus {
    return this.linkOf(connector).status;
  }

  public kindHint(connector: PtahConnector): string {
    const hint = ptahConnectorKindHint(connector.kind);
    const stepCount = connector.setupSteps?.length ?? 0;
    if (connector.kind !== 'oauth-app' || stepCount === 0) return hint;
    return `${hint} · ${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`;
  }

  public categoryLabel(category: PtahConnectorCategory): string {
    return ptahConnectorCategoryLabel(category);
  }

  public isBusy(connector: PtahConnector): boolean {
    return (
      this.busyIds().has(connector.id) || this.pollingIds().has(connector.id)
    );
  }

  public isPolling(connector: PtahConnector): boolean {
    return this.pollingIds().has(connector.id);
  }

  /** True when Disconnect must be withheld: the connection is not Ptah's. */
  public isManagedElsewhere(connector: PtahConnector): boolean {
    return this.linkOf(connector).managedElsewhere === true;
  }

  public onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  public selectCategory(category: PtahConnectorCategory | null): void {
    this.activeCategory.set(category);
  }

  public isCategoryActive(category: PtahConnectorCategory | null): boolean {
    return this.activeCategory() === category;
  }

  /** Keep `customFormOpen` in step with a user-driven expand / collapse. */
  public onCustomFormToggle(event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.customFormOpen.set(open);
    if (!open) this.setupConnector.set(null);
  }

  /** The embedded form connected or disconnected something — re-merge. */
  public onCustomFormChanged(): void {
    void this.load();
  }

  public reload(): void {
    void this.load();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Primary action for a card that is not connected yet. Routes by `kind`; see
   * the class comment for why `oauth-app` opens the form instead of connecting.
   */
  public async connect(connector: PtahConnector): Promise<void> {
    if (this.isBusy(connector)) return;
    this.setupConnector.set(connector.kind === 'oauth-app' ? connector : null);
    if (connector.kind === 'oauth-app') {
      this.prefillCustomForm(connector);
      return;
    }
    if (connector.kind === 'smithery') {
      await this.installSmithery(connector);
      return;
    }
    await this.runOAuthConnect(connector, undefined);
  }

  /**
   * Re-run authorization for a card that is listed but not usable. For OAuth
   * that is the same browser round trip against the existing serverKey; for
   * Smithery it is a fresh setup URL plus the poll that waits for it.
   */
  public async authorize(connector: PtahConnector): Promise<void> {
    if (this.isBusy(connector)) return;
    const link = this.linkOf(connector);
    if (connector.kind === 'smithery') {
      if (!link.serverKey) {
        this.actionError.set(
          `${connector.label} is connected outside Ptah. Authorize it from Smithery.`,
        );
        return;
      }
      await this.openSmitherySetup(connector, link.serverKey);
      return;
    }
    await this.runOAuthConnect(connector, link.serverKey);
  }

  /** Remove a connection Ptah owns. */
  public async disconnect(connector: PtahConnector): Promise<void> {
    const link = this.linkOf(connector);
    if (this.isBusy(connector) || !link.serverKey || link.managedElsewhere) {
      return;
    }
    const serverKey = link.serverKey;
    this.addToSet(this.busyIds, connector.id);
    this.actionError.set(null);
    try {
      const result =
        connector.kind === 'smithery'
          ? await this.rpc.call('mcpDirectory:uninstallSmithery', { serverKey })
          : await this.rpc.call('mcpDirectory:disconnectOAuth', { serverKey });
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        await this.load();
      } else {
        this.actionError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            `Failed to disconnect ${connector.label}`,
        );
      }
    } catch {
      if (this.destroyed) return;
      this.actionError.set(`Failed to disconnect ${connector.label}`);
    } finally {
      if (!this.destroyed) this.removeFromSet(this.busyIds, connector.id);
    }
  }

  /**
   * Fill the embedded custom-server form with this connector and reveal it.
   * `oauth-app` providers need a client id and secret the user creates on the
   * provider side, and Advanced is where those two fields live.
   */
  private prefillCustomForm(connector: PtahConnector): void {
    this.customFormOpen.set(true);
    const form = this.customForm();
    if (!form) return;
    form.urlInput.set(connector.url ?? '');
    form.nameInput.set(connector.label);
    form.advancedOpen.set(true);
  }

  /** The shared `connectOAuth` path for both Connect and Authorize. */
  private async runOAuthConnect(
    connector: PtahConnector,
    serverKey: string | undefined,
  ): Promise<void> {
    const serverUrl = connector.url;
    if (!serverUrl) return;
    this.addToSet(this.busyIds, connector.id);
    this.actionError.set(null);
    try {
      const params: {
        serverUrl: string;
        name: string;
        serverKey?: string;
        scope?: string;
      } = {
        serverUrl,
        name: connector.label,
      };
      if (serverKey !== undefined) params.serverKey = serverKey;
      const scope = connector.scopes?.join(' ');
      if (scope) params.scope = scope;
      const result = await this.rpc.call('mcpDirectory:connectOAuth', params);
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        await this.load();
      } else {
        this.actionError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            `Failed to connect ${connector.label}`,
        );
      }
    } catch {
      if (this.destroyed) return;
      this.actionError.set(`Failed to connect ${connector.label}`);
    } finally {
      if (!this.destroyed) this.removeFromSet(this.busyIds, connector.id);
    }
  }

  /**
   * Install a Smithery-managed server, then hand off to the setup step when
   * Smithery says the upstream still needs authorization.
   *
   * `installSmithery` already returns a `setupUrl`, but Ptah opens the browser
   * through `openSmitherySetup` instead: a setup URL is single use, and the
   * handler re-creates the connection to obtain a fresh one at the moment the
   * user actually clicks.
   */
  private async installSmithery(connector: PtahConnector): Promise<void> {
    const qualifiedName = connector.smitheryQualifiedName;
    if (!qualifiedName) return;
    this.addToSet(this.busyIds, connector.id);
    this.actionError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:installSmithery', {
        qualifiedName,
        config: {},
      });
      if (this.destroyed) return;
      if (!result.isSuccess() || !result.data.success) {
        this.actionError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            `Failed to install ${connector.label}`,
        );
        return;
      }
      const serverKey = result.data.serverKey;
      const needsSetup =
        result.data.setupUrl !== undefined ||
        result.data.status === 'auth_required' ||
        result.data.status === 'input_required';
      await this.load();
      if (this.destroyed) return;
      if (needsSetup && serverKey) {
        await this.openSmitherySetup(connector, serverKey);
      }
    } catch {
      if (this.destroyed) return;
      this.actionError.set(`Failed to install ${connector.label}`);
    } finally {
      if (!this.destroyed) this.removeFromSet(this.busyIds, connector.id);
    }
  }

  /** Open the Smithery setup page and start waiting for it to complete. */
  private async openSmitherySetup(
    connector: PtahConnector,
    serverKey: string,
  ): Promise<void> {
    this.addToSet(this.busyIds, connector.id);
    this.actionError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:openSmitherySetup', {
        serverKey,
      });
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.opened) {
        this.startSetupPoll(connector.id, serverKey);
      } else {
        this.actionError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            `Could not open the setup page for ${connector.label}`,
        );
        await this.load();
      }
    } catch {
      if (this.destroyed) return;
      this.actionError.set(
        `Could not open the setup page for ${connector.label}`,
      );
    } finally {
      if (!this.destroyed) this.removeFromSet(this.busyIds, connector.id);
    }
  }

  // ── Setup poll ─────────────────────────────────────────────────────────────

  /**
   * Ask Smithery for this connection's status every {@link POLL_INTERVAL_MS}
   * until it reports `connected`, reports `error`, or
   * {@link POLL_TIMEOUT_MS} passes. The browser is where the user finishes the
   * flow, so there is no callback to await — a poll is the only signal.
   *
   * A failed status call is NOT a verdict: the poll keeps its slot and retries
   * on the next tick until the deadline.
   */
  private startSetupPoll(connectorId: string, serverKey: string): void {
    this.stopPolling(connectorId);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    this.addToSet(this.pollingIds, connectorId);

    const tick = async (): Promise<void> => {
      this.pollTimers.delete(connectorId);
      if (this.destroyed) return;
      let settled = false;
      try {
        const result = await this.rpc.call(
          'mcpDirectory:smitheryConnectionStatus',
          { serverKey },
        );
        if (result.isSuccess()) {
          settled =
            result.data.status === 'connected' ||
            result.data.status === 'error';
        }
      } catch {
        // Transient: keep the slot and try again on the next tick.
      }
      if (this.destroyed) return;
      if (settled || Date.now() >= deadline) {
        this.stopPolling(connectorId);
        await this.load();
        return;
      }
      this.schedulePollTick(connectorId, tick);
    };

    this.schedulePollTick(connectorId, tick);
  }

  private schedulePollTick(
    connectorId: string,
    tick: () => Promise<void>,
  ): void {
    this.pollTimers.set(
      connectorId,
      setTimeout(() => void tick(), POLL_INTERVAL_MS),
    );
  }

  private stopPolling(connectorId: string): void {
    const timer = this.pollTimers.get(connectorId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pollTimers.delete(connectorId);
    }
    this.removeFromSet(this.pollingIds, connectorId);
  }

  private stopAllPolling(): void {
    for (const timer of this.pollTimers.values()) {
      clearTimeout(timer);
    }
    this.pollTimers.clear();
    this.pollingIds.set(new Set());
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  /**
   * Read both status sources. They are independent: a missing Smithery API key
   * must not blank the OAuth badges, and vice versa, so each half handles its
   * own failure and only a total failure sets `loadError`.
   */
  private async load(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(null);
    const [oauthOk, smitheryOk] = await Promise.all([
      this.loadOAuth(),
      this.loadSmithery(),
    ]);
    if (this.destroyed) return;
    if (!oauthOk && !smitheryOk) {
      this.loadError.set('Failed to load connection status');
    }
    this.isLoading.set(false);
  }

  private async loadOAuth(): Promise<boolean> {
    try {
      const result = await this.rpc.call('mcpDirectory:listOAuthConnected', {});
      if (this.destroyed || !result.isSuccess()) return false;
      const records = result.data.servers;
      this.oauthRecords.set(records);
      const entries = await Promise.all(
        records.map(async (record) => {
          try {
            const status = await this.rpc.call('mcpDirectory:oauthStatus', {
              serverKey: record.serverKey,
            });
            if (status.isSuccess()) {
              return [record.serverKey, status.data.state] as const;
            }
          } catch {
            // Fall through to the disconnected default.
          }
          return [
            record.serverKey,
            'disconnected' as McpOAuthConnectionState,
          ] as const;
        }),
      );
      if (this.destroyed) return false;
      this.oauthStates.set(new Map(entries));
      return true;
    } catch {
      return false;
    }
  }

  private async loadSmithery(): Promise<boolean> {
    try {
      const result = await this.rpc.call(
        'mcpDirectory:listSmitheryConnections',
        {},
      );
      if (this.destroyed || !result.isSuccess()) return false;
      this.smitheryConnections.set(result.data.connections);
      this.smitheryNamespace.set(result.data.namespace);
      // A reported `error` (no API key, revoked key) is a state the grid
      // renders as "not connected", not a load failure.
      return result.data.error === undefined;
    } catch {
      return false;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private addToSet(
    sig: ReturnType<typeof signal<ReadonlySet<string>>>,
    value: string,
  ): void {
    sig.update((s) => new Set([...s, value]));
  }

  private removeFromSet(
    sig: ReturnType<typeof signal<ReadonlySet<string>>>,
    value: string,
  ): void {
    sig.update((s) => {
      const next = new Set(s);
      next.delete(value);
      return next;
    });
  }
}
