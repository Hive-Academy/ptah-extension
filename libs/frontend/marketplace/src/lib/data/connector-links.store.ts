import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { ClaudeRpcService, WorkspaceScopeService } from '@ptah-extension/core';
import {
  PTAH_CONNECTORS,
  normalizeMcpServerUrl,
  type McpDirectoryConnectOAuthParams,
  type McpOAuthConnectedRecord,
  type McpOAuthConnectionState,
  type PtahConnector,
  type SmitheryConnectionStatus,
  type SmitheryConnectionSummary,
} from '@ptah-extension/shared';
import { encodeServerRef, type ServerRef } from './server-ref';

/**
 * Rendered state of one catalogue connector.
 *
 * Deliberately narrower than the two wire enums it merges. A connector card
 * only has three actions, so it only needs the four states that pick between
 * them: `not-connected` → Connect, `needs-auth` → Authorize, `error` →
 * Authorize plus the reason, `connected` → Disconnect.
 */
export type ConnectorStatus =
  'not-connected' | 'connected' | 'needs-auth' | 'error';

/** What the store knows about one catalogue entry after the status merge. */
export interface ConnectorLink {
  readonly status: ConnectorStatus;
  /** The key every action addresses. Absent when nothing is connected yet. */
  readonly serverKey?: string;
  /** Reason text for `error`. */
  readonly detail?: string;
  /**
   * True for a Smithery connection that exists in the namespace but carries no
   * Ptah install record. Ptah must not remove someone else's connection, so
   * Disconnect is withheld for these.
   */
  readonly managedElsewhere?: boolean;
}

/** Load state of the connection picture. `ensure()` loads only from `idle`. */
export type ConnectorLinksState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Live connection state for one installed server row: the OAuth state of an
 * `oauth` row, or the Smithery status of a `smithery` row. Decoration only —
 * it never adds, drops or fails a row.
 */
export type ConnectionDecoration =
  | { readonly source: 'oauth'; readonly state: McpOAuthConnectionState }
  | { readonly source: 'smithery'; readonly status: SmitheryConnectionStatus };

/** Dates a detail page can show for one server key. */
export interface ConnectionDates {
  /** When the OAuth connection was made (`McpOAuthConnectedRecord`). */
  readonly connectedAt?: string;
  /** When Smithery created the connection (`SmitheryConnectionSummary`). */
  readonly createdAt?: string;
}

/**
 * What an action did, for the caller that needs to react beyond the shared
 * {@link ConnectorLinksStore.actionError} text.
 *
 * - `needs-setup`: an `oauth-app` connector has no client yet. Nothing was
 *   called; the caller opens the custom-server form, pre-filled.
 * - `awaiting-setup`: a Smithery setup page is open and the poll is running.
 * - `skipped`: nothing to do (busy, not Ptah's to touch, or no address).
 */
export type ConnectorActionOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'awaiting-setup' }
  | { readonly kind: 'needs-setup' }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'failed'; readonly error: string };

/** How often the Smithery setup poll asks for a fresh connection status. */
const POLL_INTERVAL_MS = 3_000;
/** How long the Smithery setup poll runs before it gives up. */
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

const TOTAL_LOAD_FAILURE = 'Failed to load connection status';

const DONE: ConnectorActionOutcome = { kind: 'done' };
const SKIPPED: ConnectorActionOutcome = { kind: 'skipped' };

/** One successful OAuth half: the records plus one state per record. */
interface OAuthRead {
  readonly records: readonly McpOAuthConnectedRecord[];
  readonly states: ReadonlyMap<string, McpOAuthConnectionState>;
}

/** One successful Smithery half. `error` set = no key / revoked key. */
interface SmitheryRead {
  readonly connections: readonly SmitheryConnectionSummary[];
  readonly namespace: string | null;
  readonly error?: string;
}

/**
 * Who an OAuth round trip is for. `actionId` is the key of the busy and
 * polling sets: the catalogue connector id when the server is in the
 * catalogue, so a card and an installed row for the same server share one
 * in-flight guard.
 */
interface OAuthTarget {
  readonly actionId: string;
  readonly label: string;
  readonly serverUrl: string;
  readonly scope?: string;
}

/** Who a Smithery setup is for. Same `actionId` rule as {@link OAuthTarget}. */
interface SmitheryTarget {
  readonly actionId: string;
  readonly label: string;
}

/**
 * ConnectorLinksStore — connection state of the catalogue connectors and of
 * the OAuth / Smithery servers, plus the connect lifecycle (plan C4).
 *
 * Lifted from `ConnectorsSurfaceComponent`. It merges three reads:
 *
 *  - `PTAH_CONNECTORS` — the curated catalogue in `libs/shared`.
 *  - `mcpDirectory:listOAuthConnected` + `mcpDirectory:oauthStatus` — every
 *    directly-connected OAuth server, matched to a catalogue entry by its
 *    `serverUrl` (compared through the shared `normalizeMcpServerUrl`).
 *  - `mcpDirectory:listSmitheryConnections` — every connection in the active
 *    Smithery namespace, matched by its `server` (the registry qualified name).
 *
 * Connect routes by `kind`:
 *  - `oauth-dcr` → `mcpDirectory:connectOAuth`, one long-running await.
 *  - `oauth-app` → nothing is called. There is no client to authorize with
 *    yet, so {@link connect} answers `needs-setup` and the page pre-fills the
 *    custom-server form, where the client id and secret go.
 *  - `smithery` → `installSmithery`, then `openSmitherySetup` when Smithery
 *    reports a setup step, then a 3-second poll (5-minute deadline) until the
 *    connection reports `connected` or `error`.
 *
 * ## Loading
 *
 * Nothing is read until a page calls {@link ensure}; badges and the status
 * bar read what is already here and never load. OAuth and Smithery fail
 * independently: only a total failure is an `error` state. A Smithery `error`
 * FIELD without a thrown error means "no API key" — {@link smitheryUnavailable}
 * carries it, and it is a state, not a failure.
 *
 * ## Workspace switches without navigation
 *
 * TASK_2026_540 keeps configuration surfaces on screen across a workspace
 * switch, so nothing re-creates this store. It follows
 * `WorkspaceScopeService.generation` itself and re-reads once it has loaded.
 * The rows are NOT discarded first: OAuth records and the Smithery namespace
 * live in the user's home directory, not the workspace, so the previous answer
 * is the best one available until the re-read lands.
 *
 * No `providedIn`: one instance per Marketplace visit, listed in the shell's
 * `providers`. Its `DestroyRef` clears every poll timer, so no poll outlives
 * the shell (plan D4 rejects a root store for exactly that reason).
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- shell-scoped, provided by MarketplaceShellComponent; see the class note.
@Injectable()
export class ConnectorLinksStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly scope = inject(WorkspaceScopeService);

  private readonly connectors: readonly PtahConnector[] = PTAH_CONNECTORS;

  private readonly _state = signal<ConnectorLinksState>('idle');
  private readonly _loadError = signal<string | null>(null);
  private readonly _oauthRecords = signal<readonly McpOAuthConnectedRecord[]>(
    [],
  );
  private readonly _oauthStates = signal<
    ReadonlyMap<string, McpOAuthConnectionState>
  >(new Map());
  private readonly _smitheryConnections = signal<
    readonly SmitheryConnectionSummary[]
  >([]);
  private readonly _smitheryNamespace = signal<string | null>(null);
  private readonly _smitheryUnavailable = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());
  private readonly _pollingIds = signal<ReadonlySet<string>>(new Set());

  /** Pending poll timers, by action id. Cleared on destroy. */
  private readonly pollTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /** Bumped per load; a load whose number is no longer current publishes nothing. */
  private loadGeneration = 0;
  private destroyed = false;
  private seenWorkspaceGeneration = this.scope.generation();

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.stopAllPolling();
    });
  }

  /** `idle` until a page calls {@link ensure}. */
  public readonly state: Signal<ConnectorLinksState> = this._state.asReadonly();
  public readonly loading: Signal<boolean> = computed(
    () => this._state() === 'loading',
  );
  /** Set only when BOTH halves failed. */
  public readonly loadError: Signal<string | null> =
    this._loadError.asReadonly();
  public readonly oauthRecords: Signal<readonly McpOAuthConnectedRecord[]> =
    this._oauthRecords.asReadonly();
  public readonly smitheryConnections: Signal<
    readonly SmitheryConnectionSummary[]
  > = this._smitheryConnections.asReadonly();
  /** The Smithery namespace the connections came from, or null. */
  public readonly smitheryNamespace: Signal<string | null> =
    this._smitheryNamespace.asReadonly();
  /**
   * Why Smithery answered without connections (no API key, revoked key), or
   * null. A state the page renders as "Add a Smithery key", never a failure.
   */
  public readonly smitheryUnavailable: Signal<string | null> =
    this._smitheryUnavailable.asReadonly();
  /** The last action's failure text, cleared when the next action starts. */
  public readonly actionError: Signal<string | null> =
    this._actionError.asReadonly();
  /** Action ids (connector ids, or server refs) with an action in flight. */
  public readonly busyIds: Signal<ReadonlySet<string>> =
    this._busyIds.asReadonly();
  /** Action ids waiting on a Smithery setup poll. */
  public readonly pollingIds: Signal<ReadonlySet<string>> =
    this._pollingIds.asReadonly();

  private readonly oauthByKey = computed(() => {
    const byKey = new Map<string, McpOAuthConnectedRecord>();
    for (const record of this._oauthRecords())
      byKey.set(record.serverKey, record);
    return byKey;
  });

  private readonly smitheryByKey = computed(() => {
    const byKey = new Map<string, SmitheryConnectionSummary>();
    for (const connection of this._smitheryConnections()) {
      if (connection.serverKey) byKey.set(connection.serverKey, connection);
    }
    return byKey;
  });

  /**
   * The status merge: catalogue entry → what the two reads say about it.
   *
   * A `disconnected`/`expired` OAuth record and a Smithery connection in any
   * state other than `connected` mean the same thing to the user — the app is
   * listed but will not answer — so both resolve to `needs-auth`. Only an
   * explicit Smithery `error` gets its own branch, because it carries a reason.
   */
  public readonly links: Signal<ReadonlyMap<string, ConnectorLink>> = computed(
    () => {
      const oauthByUrl = new Map<string, McpOAuthConnectedRecord>();
      for (const record of this._oauthRecords()) {
        oauthByUrl.set(normalizeMcpServerUrl(record.serverUrl), record);
      }
      const smitheryByServer = new Map<string, SmitheryConnectionSummary>();
      for (const connection of this._smitheryConnections()) {
        if (connection.server) {
          smitheryByServer.set(connection.server, connection);
        }
      }
      const states = this._oauthStates();
      const merged = new Map<string, ConnectorLink>();

      for (const connector of this.connectors) {
        if (connector.kind === 'smithery') {
          const connection = smitheryByServer.get(
            connector.smitheryQualifiedName ?? '',
          );
          merged.set(connector.id, smitheryLinkOf(connection));
          continue;
        }
        const record = oauthByUrl.get(
          normalizeMcpServerUrl(connector.url ?? ''),
        );
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
    },
  );

  /**
   * Re-read what a page already loaded when the active workspace changes. The
   * first run sees the generation captured at construction and does nothing,
   * so creating the store stays RPC-free, and an idle store stays idle.
   */
  private readonly workspaceEffect = effect(() => {
    const generation = this.scope.generation();
    if (generation === this.seenWorkspaceGeneration) return;
    this.seenWorkspaceGeneration = generation;
    untracked(() => {
      if (this._state() !== 'idle') void this.load();
    });
  });

  // ── Reads ──────────────────────────────────────────────────────────────────

  public linkOf(connector: PtahConnector): ConnectorLink {
    return this.links().get(connector.id) ?? { status: 'not-connected' };
  }

  /** True while an action or a setup poll is running for this connector. */
  public isBusy(connector: PtahConnector): boolean {
    return this.isActionBusy(connector.id);
  }

  public isPolling(connector: PtahConnector): boolean {
    return this._pollingIds().has(connector.id);
  }

  /** True when Disconnect must be withheld: the connection is not Ptah's. */
  public isManagedElsewhere(connector: PtahConnector): boolean {
    return this.linkOf(connector).managedElsewhere === true;
  }

  /** {@link isBusy} for an installed server row ({@link reconnect}'s target). */
  public isServerBusy(server: ServerRef): boolean {
    return this.isActionBusy(this.serverActionId(server));
  }

  /**
   * Live state for an installed row: OAuth state for an `oauth` row, Smithery
   * status for a `smithery` row, `null` for every other origin or when this
   * store has no answer for the key. Never loads.
   */
  public statusFor(server: ServerRef): ConnectionDecoration | null {
    if (server.origin === 'oauth') {
      const state = this._oauthStates().get(server.serverKey);
      return state === undefined ? null : { source: 'oauth', state };
    }
    if (server.origin === 'smithery') {
      const connection = this.smitheryByKey().get(server.serverKey);
      return connection === undefined
        ? null
        : { source: 'smithery', status: connection.status };
    }
    return null;
  }

  /** OAuth `connectedAt` and Smithery `createdAt` for one key, where known. */
  public datesFor(serverKey: string): ConnectionDates {
    const connectedAt = this.oauthByKey().get(serverKey)?.connectedAt;
    const createdAt = this.smitheryByKey().get(serverKey)?.createdAt;
    return {
      ...(connectedAt === undefined ? {} : { connectedAt }),
      ...(createdAt === undefined ? {} : { createdAt }),
    };
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  /** Load for the first time. A no-op unless the store is `idle`. */
  public ensure(): Promise<void> {
    if (this._state() !== 'idle') return Promise.resolve();
    return this.load();
  }

  /** Re-read now, superseding any read in flight. */
  public reload(): Promise<void> {
    return this.load();
  }

  public dismissActionError(): void {
    this._actionError.set(null);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Primary action for a connector that is not connected yet, routed by
   * `kind`. An `oauth-app` connector answers `needs-setup` without a call.
   */
  public async connect(
    connector: PtahConnector,
  ): Promise<ConnectorActionOutcome> {
    if (this.isBusy(connector)) return SKIPPED;
    if (connector.kind === 'oauth-app') return { kind: 'needs-setup' };
    if (connector.kind === 'smithery') return this.installSmithery(connector);
    const target = oauthTargetOf(connector);
    return target === null ? SKIPPED : this.runOAuthConnect(target, undefined);
  }

  /**
   * Re-run authorization for a connector that is listed but not usable. For
   * OAuth that is the same browser round trip against the existing serverKey;
   * for Smithery it is a fresh setup URL plus the poll that waits for it.
   */
  public async authorize(
    connector: PtahConnector,
  ): Promise<ConnectorActionOutcome> {
    if (this.isBusy(connector)) return SKIPPED;
    const link = this.linkOf(connector);
    if (connector.kind === 'smithery') {
      if (!link.serverKey) {
        return this.fail(
          `${connector.label} is connected outside Ptah. Authorize it from Smithery.`,
        );
      }
      return this.openSmitherySetup(
        { actionId: connector.id, label: connector.label },
        link.serverKey,
      );
    }
    const target = oauthTargetOf(connector);
    return target === null
      ? SKIPPED
      : this.runOAuthConnect(target, link.serverKey);
  }

  /**
   * Reconnect for an installed `oauth` or `smithery` row (the server detail's
   * Reconnect). Addresses the row's own serverKey, and shares the busy guard
   * with the catalogue connector for the same server when there is one.
   */
  public async reconnect(server: ServerRef): Promise<ConnectorActionOutcome> {
    const actionId = this.serverActionId(server);
    if (this.isActionBusy(actionId)) return SKIPPED;

    if (server.origin === 'oauth') {
      const record = this.oauthByKey().get(server.serverKey);
      if (!record) {
        return this.fail(
          `No OAuth connection is recorded for ${server.serverKey}. Reload and try again.`,
        );
      }
      const connector = this.catalogueOAuthConnector(record.serverUrl);
      const scope = connector?.scopes?.join(' ');
      return this.runOAuthConnect(
        {
          actionId,
          label: connector?.label ?? record.name,
          serverUrl: record.serverUrl,
          ...(scope ? { scope } : {}),
        },
        server.serverKey,
      );
    }

    if (server.origin === 'smithery') {
      const connection = this.smitheryByKey().get(server.serverKey);
      const connector = this.catalogueSmitheryConnector(connection?.server);
      return this.openSmitherySetup(
        {
          actionId,
          label: connector?.label ?? connection?.name ?? server.serverKey,
        },
        server.serverKey,
      );
    }

    return SKIPPED;
  }

  /** Remove a connection Ptah owns. Never touches someone else's. */
  public async disconnect(
    connector: PtahConnector,
  ): Promise<ConnectorActionOutcome> {
    const link = this.linkOf(connector);
    if (this.isBusy(connector) || !link.serverKey || link.managedElsewhere) {
      return SKIPPED;
    }
    const serverKey = link.serverKey;
    const fallback = `Failed to disconnect ${connector.label}`;
    this.addTo(this._busyIds, connector.id);
    this._actionError.set(null);
    try {
      const result =
        connector.kind === 'smithery'
          ? await this.rpc.call('mcpDirectory:uninstallSmithery', { serverKey })
          : await this.rpc.call('mcpDirectory:disconnectOAuth', { serverKey });
      if (this.destroyed) return SKIPPED;
      if (result.isSuccess() && result.data.success) {
        await this.load();
        return DONE;
      }
      return this.fail(
        (result.isSuccess() ? result.data.error : result.error) ?? fallback,
      );
    } catch (error: unknown) {
      return this.failThrown('disconnect', error, fallback);
    } finally {
      this.removeFrom(this._busyIds, connector.id);
    }
  }

  /** The shared `connectOAuth` path for Connect, Authorize and Reconnect. */
  private async runOAuthConnect(
    target: OAuthTarget,
    serverKey: string | undefined,
  ): Promise<ConnectorActionOutcome> {
    const fallback = `Failed to connect ${target.label}`;
    this.addTo(this._busyIds, target.actionId);
    this._actionError.set(null);
    try {
      const params: McpDirectoryConnectOAuthParams = {
        serverUrl: target.serverUrl,
        name: target.label,
      };
      if (serverKey !== undefined) params.serverKey = serverKey;
      if (target.scope) params.scope = target.scope;
      const result = await this.rpc.call('mcpDirectory:connectOAuth', params);
      if (this.destroyed) return SKIPPED;
      if (result.isSuccess() && result.data.success) {
        await this.load();
        return DONE;
      }
      return this.fail(
        (result.isSuccess() ? result.data.error : result.error) ?? fallback,
      );
    } catch (error: unknown) {
      return this.failThrown('connectOAuth', error, fallback);
    } finally {
      this.removeFrom(this._busyIds, target.actionId);
    }
  }

  /**
   * Install a Smithery-managed server, then hand off to the setup step when
   * Smithery says the upstream still needs authorization.
   *
   * `installSmithery` already returns a `setupUrl`, but the browser is opened
   * through `openSmitherySetup` instead: a setup URL is single use, and that
   * handler re-creates the connection to obtain a fresh one.
   */
  private async installSmithery(
    connector: PtahConnector,
  ): Promise<ConnectorActionOutcome> {
    const qualifiedName = connector.smitheryQualifiedName;
    if (!qualifiedName) return SKIPPED;
    const fallback = `Failed to install ${connector.label}`;
    this.addTo(this._busyIds, connector.id);
    this._actionError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:installSmithery', {
        qualifiedName,
        config: {},
      });
      if (this.destroyed) return SKIPPED;
      if (!result.isSuccess() || !result.data.success) {
        return this.fail(
          (result.isSuccess() ? result.data.error : result.error) ?? fallback,
        );
      }
      const serverKey = result.data.serverKey;
      const needsSetup =
        result.data.setupUrl !== undefined ||
        result.data.status === 'auth_required' ||
        result.data.status === 'input_required';
      await this.load();
      if (this.destroyed) return SKIPPED;
      if (!needsSetup || !serverKey) return DONE;
      return await this.openSmitherySetup(
        { actionId: connector.id, label: connector.label },
        serverKey,
      );
    } catch (error: unknown) {
      return this.failThrown('installSmithery', error, fallback);
    } finally {
      this.removeFrom(this._busyIds, connector.id);
    }
  }

  /** Open the Smithery setup page and start waiting for it to complete. */
  private async openSmitherySetup(
    target: SmitheryTarget,
    serverKey: string,
  ): Promise<ConnectorActionOutcome> {
    const fallback = `Could not open the setup page for ${target.label}`;
    this.addTo(this._busyIds, target.actionId);
    this._actionError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:openSmitherySetup', {
        serverKey,
      });
      if (this.destroyed) return SKIPPED;
      if (result.isSuccess() && result.data.opened) {
        this.startSetupPoll(target.actionId, serverKey);
        return { kind: 'awaiting-setup' };
      }
      const outcome = this.fail(
        (result.isSuccess() ? result.data.error : result.error) ?? fallback,
      );
      await this.load();
      return outcome;
    } catch (error: unknown) {
      return this.failThrown('openSmitherySetup', error, fallback);
    } finally {
      this.removeFrom(this._busyIds, target.actionId);
    }
  }

  // ── Setup poll ─────────────────────────────────────────────────────────────

  /**
   * Ask Smithery for this connection's status every {@link POLL_INTERVAL_MS}
   * until it reports `connected` or `error`, or {@link POLL_TIMEOUT_MS} passes.
   * The user finishes the flow in the browser, so there is no callback to
   * await — a poll is the only signal. A failed status call is NOT a verdict:
   * the poll keeps its slot and retries on the next tick until the deadline.
   */
  private startSetupPoll(actionId: string, serverKey: string): void {
    this.stopPolling(actionId);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    this.addTo(this._pollingIds, actionId);

    const tick = async (): Promise<void> => {
      this.pollTimers.delete(actionId);
      if (this.destroyed) return;
      const status = await this.readSetupStatus(serverKey);
      if (this.destroyed) return;
      const settled = status === 'connected' || status === 'error';
      if (settled || Date.now() >= deadline) {
        this.stopPolling(actionId);
        await this.load();
        return;
      }
      this.schedulePollTick(actionId, tick);
    };

    this.schedulePollTick(actionId, tick);
  }

  /** One poll read. `null` = this tick has no answer; the poll tries again. */
  private async readSetupStatus(
    serverKey: string,
  ): Promise<SmitheryConnectionStatus | null> {
    try {
      const result = await this.rpc.call(
        'mcpDirectory:smitheryConnectionStatus',
        { serverKey },
      );
      return result.isSuccess() ? result.data.status : null;
    } catch {
      // degradation-audit: reported — a failed tick is retried until the
      // deadline, and the poll's final reload renders the true state.
      return null;
    }
  }

  private schedulePollTick(actionId: string, tick: () => Promise<void>): void {
    this.pollTimers.set(
      actionId,
      setTimeout(() => void tick(), POLL_INTERVAL_MS),
    );
  }

  private stopPolling(actionId: string): void {
    const timer = this.pollTimers.get(actionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pollTimers.delete(actionId);
    }
    this.removeFrom(this._pollingIds, actionId);
  }

  private stopAllPolling(): void {
    for (const timer of this.pollTimers.values()) clearTimeout(timer);
    this.pollTimers.clear();
    this._pollingIds.set(new Set());
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  /**
   * Read both halves. They are independent — a missing Smithery key must not
   * blank the OAuth badges, and vice versa — so a failed half keeps its last
   * answer, and only a total failure is the `error` state.
   */
  private async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    const workspace = this.scope.generation();
    this._state.set('loading');
    this._loadError.set(null);

    const [oauth, smithery] = await Promise.all([
      this.readOAuth(),
      this.readSmithery(),
    ]);

    if (
      this.destroyed ||
      generation !== this.loadGeneration ||
      workspace !== this.scope.generation()
    ) {
      return;
    }
    if (oauth !== null) {
      this._oauthRecords.set(oauth.records);
      this._oauthStates.set(oauth.states);
    }
    if (smithery !== null) {
      this._smitheryConnections.set(smithery.connections);
      this._smitheryNamespace.set(smithery.namespace);
      this._smitheryUnavailable.set(smithery.error ?? null);
    }
    // A Smithery `error` field is not a load failure on its own, but it is no
    // answer either: with OAuth also failed, nothing was read.
    const smitheryAnswered = smithery !== null && smithery.error === undefined;
    if (oauth === null && !smitheryAnswered) {
      this._loadError.set(TOTAL_LOAD_FAILURE);
      this._state.set('error');
      return;
    }
    this._state.set('ready');
  }

  private async readOAuth(): Promise<OAuthRead | null> {
    try {
      const result = await this.rpc.call('mcpDirectory:listOAuthConnected', {});
      if (!result.isSuccess()) return null;
      const records = result.data.servers;
      const entries = await Promise.all(
        records.map(async (record) => {
          const state = await this.readOAuthState(record.serverKey);
          return [record.serverKey, state] as const;
        }),
      );
      return { records, states: new Map(entries) };
    } catch {
      // degradation-audit: reported — a failed half keeps its last answer, and
      // both halves failing becomes the store's `error` state.
      return null;
    }
  }

  /** One record's state. An unreadable state is shown as `disconnected`. */
  private async readOAuthState(
    serverKey: string,
  ): Promise<McpOAuthConnectionState> {
    try {
      const status = await this.rpc.call('mcpDirectory:oauthStatus', {
        serverKey,
      });
      return status.isSuccess() ? status.data.state : 'disconnected';
    } catch {
      // degradation-audit: reported — the row renders `needs-auth` with an
      // Authorize action, which is what an unreadable state amounts to.
      return 'disconnected';
    }
  }

  private async readSmithery(): Promise<SmitheryRead | null> {
    try {
      const result = await this.rpc.call(
        'mcpDirectory:listSmitheryConnections',
        {},
      );
      if (!result.isSuccess()) return null;
      return {
        connections: result.data.connections,
        namespace: result.data.namespace,
        ...(result.data.error === undefined
          ? {}
          : { error: result.data.error }),
      };
    } catch {
      // degradation-audit: reported — a failed half keeps its last answer, and
      // both halves failing becomes the store's `error` state.
      return null;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private isActionBusy(actionId: string): boolean {
    return this._busyIds().has(actionId) || this._pollingIds().has(actionId);
  }

  /**
   * The busy/polling key for an installed row: the catalogue connector's id
   * when the row is a catalogue server, so the card and the row cannot run
   * two round trips for one server; otherwise the row's server ref.
   */
  private serverActionId(server: ServerRef): string {
    if (server.origin === 'oauth') {
      const record = this.oauthByKey().get(server.serverKey);
      const connector = record
        ? this.catalogueOAuthConnector(record.serverUrl)
        : undefined;
      if (connector) return connector.id;
    } else if (server.origin === 'smithery') {
      const connection = this.smitheryByKey().get(server.serverKey);
      const connector = this.catalogueSmitheryConnector(connection?.server);
      if (connector) return connector.id;
    }
    return encodeServerRef(server);
  }

  private catalogueOAuthConnector(
    serverUrl: string,
  ): PtahConnector | undefined {
    const wanted = normalizeMcpServerUrl(serverUrl);
    return this.connectors.find(
      (c) =>
        c.kind !== 'smithery' &&
        c.url !== undefined &&
        normalizeMcpServerUrl(c.url) === wanted,
    );
  }

  private catalogueSmitheryConnector(
    qualifiedName: string | undefined,
  ): PtahConnector | undefined {
    if (!qualifiedName) return undefined;
    return this.connectors.find(
      (c) => c.kind === 'smithery' && c.smitheryQualifiedName === qualifiedName,
    );
  }

  private fail(error: string): ConnectorActionOutcome {
    if (!this.destroyed) this._actionError.set(error);
    return { kind: 'failed', error };
  }

  /**
   * A thrown RPC/transport exception. Its text can carry a custom server URL
   * with embedded credentials, so it goes to the console only; the UI gets
   * the action's fixed user-facing string, as the old surface did.
   */
  private failThrown(
    action: string,
    error: unknown,
    fallback: string,
  ): ConnectorActionOutcome {
    console.warn(`[ConnectorLinksStore] ${action} threw:`, error);
    return this.fail(fallback);
  }

  private addTo(sig: WritableSignal<ReadonlySet<string>>, value: string): void {
    sig.update((set) => new Set([...set, value]));
  }

  private removeFrom(
    sig: WritableSignal<ReadonlySet<string>>,
    value: string,
  ): void {
    sig.update((set) => {
      if (!set.has(value)) return set;
      const next = new Set(set);
      next.delete(value);
      return next;
    });
  }
}

/** The merge for one Smithery catalogue entry. */
function smitheryLinkOf(
  connection: SmitheryConnectionSummary | undefined,
): ConnectorLink {
  if (!connection) return { status: 'not-connected' };
  const managedElsewhere = !connection.managedByPtah;
  const serverKey = connection.serverKey;
  if (connection.status === 'connected') {
    return { status: 'connected', serverKey, managedElsewhere };
  }
  if (connection.status === 'error') {
    return {
      status: 'error',
      serverKey,
      managedElsewhere,
      detail: 'Smithery reported an error for this connection.',
    };
  }
  return { status: 'needs-auth', serverKey, managedElsewhere };
}

/** A catalogue OAuth connector as a round-trip target, or null without a URL. */
function oauthTargetOf(connector: PtahConnector): OAuthTarget | null {
  if (!connector.url) return null;
  const scope = connector.scopes?.join(' ');
  return {
    actionId: connector.id,
    label: connector.label,
    serverUrl: connector.url,
    ...(scope ? { scope } : {}),
  };
}
