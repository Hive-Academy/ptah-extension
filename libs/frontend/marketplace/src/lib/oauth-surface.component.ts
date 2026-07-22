import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  input,
  output,
  OnInit,
  DestroyRef,
} from '@angular/core';
import {
  LucideAngularModule,
  KeyRound,
  Plug,
  Check,
  RefreshCw,
  Trash2,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  McpOAuthConnectedRecord,
  McpOAuthConnectionState,
} from '@ptah-extension/shared';

/**
 * A well-known OAuth-secured MCP server, offered as a quick-connect chip that
 * pre-fills the connect form. Purely a convenience — the URL field is the
 * source of truth.
 */
interface OAuthSuggestion {
  readonly label: string;
  readonly url: string;
}

/** Curated quick-connect chips for well-known OAuth MCP servers. */
const OAUTH_SUGGESTIONS: readonly OAuthSuggestion[] = [
  { label: 'Sentry', url: 'https://mcp.sentry.dev/mcp' },
  { label: 'Notion', url: 'https://mcp.notion.com/mcp' },
  { label: 'Linear', url: 'https://mcp.linear.app/mcp' },
] as const;

/**
 * OAuthSurfaceComponent — the "Connected Apps" provider surface mounted by the
 * Marketplace hub for the `oauth-mcp` descriptor.
 *
 * Connects OAuth 2.0 + PKCE-gated remote MCP servers. The connect call is
 * long-running: `mcpDirectory:connectOAuth` opens the system browser and only
 * resolves AFTER the full authorization round-trip completes (or fails), so the
 * flow is a single `await` behind a pending spinner — no polling.
 *
 * Lifecycle:
 *  - On mount it loads the connected list via `mcpDirectory:listOAuthConnected`
 *    and resolves each server's live state via `mcpDirectory:oauthStatus`,
 *    rendering a per-row status pill (connected / expired / disconnected).
 *  - `refreshTrigger` (>0) reloads the list — parity with the other surfaces so
 *    the hub can force a refresh via NgComponentOutlet inputs.
 *  - Connect / reconnect route through `connectOAuth`; disconnect through
 *    `disconnectOAuth`. Every post-await continuation is guarded by the
 *    `destroyed` flag, and errors are surfaced as sanitized strings only.
 *
 * Complexity Level: 2 — RPC list + per-row status resolution + connect form +
 * per-key inflight tracking. Patterns: signal state, refresh effect, DaisyUI
 * cards, per-key inflight Sets.
 */
@Component({
  selector: 'ptah-oauth-surface',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <!-- Connect form -->
      <div
        class="rounded-lg border border-base-300 bg-base-200/40 p-4 space-y-3"
      >
        <div class="flex items-center gap-2">
          <div
            class="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0"
          >
            <lucide-angular
              [img]="KeyRoundIcon"
              class="w-4 h-4 text-primary"
              aria-hidden="true"
            />
          </div>
          <div>
            <h3 class="text-sm font-semibold text-base-content">
              Connect an OAuth MCP server
            </h3>
            <p class="text-[11px] text-base-content/50">
              Authorize a remote MCP server that uses OAuth to sign in.
            </p>
          </div>
        </div>

        @if (connectError()) {
          <div class="alert alert-error alert-sm py-1 px-2">
            <span class="text-xs">{{ connectError() }}</span>
            <button
              class="btn btn-ghost btn-xs"
              (click)="connectError.set(null)"
              type="button"
            >
              Dismiss
            </button>
          </div>
        }

        <form class="space-y-2" (submit)="connect($event)">
          <input
            type="url"
            autocomplete="off"
            class="input input-bordered input-sm w-full text-xs font-mono"
            placeholder="https://mcp.notion.com/mcp"
            [value]="urlInput()"
            (input)="onUrlInput($event)"
            aria-label="MCP server URL"
          />
          <input
            type="text"
            autocomplete="off"
            class="input input-bordered input-sm w-full text-xs"
            placeholder="Friendly name (optional)"
            [value]="nameInput()"
            (input)="onNameInput($event)"
            aria-label="Friendly name"
          />

          <!-- Advanced: pre-registered client credentials (collapsed by default) -->
          <details class="rounded-lg border border-base-300 bg-base-100/40">
            <summary
              class="cursor-pointer select-none px-2 py-1.5 text-[11px] font-medium text-base-content/60"
            >
              Advanced
            </summary>
            <div class="px-2 pb-2 pt-1 space-y-2">
              <input
                type="text"
                autocomplete="off"
                class="input input-bordered input-sm w-full text-xs font-mono"
                placeholder="Client ID (optional)"
                [value]="clientIdInput()"
                (input)="onClientIdInput($event)"
                aria-label="Client ID"
              />
              <input
                type="password"
                autocomplete="off"
                class="input input-bordered input-sm w-full text-xs font-mono"
                placeholder="Client Secret (optional)"
                [value]="clientSecretInput()"
                (input)="onClientSecretInput($event)"
                aria-label="Client Secret"
              />
              <p class="text-[10px] text-base-content/40">
                Only needed for servers that don't support automatic app
                registration.
              </p>
            </div>
          </details>

          <!-- Quick-connect suggestion chips -->
          <div class="flex gap-1 flex-wrap">
            @for (s of suggestions; track s.url) {
              <button
                type="button"
                class="btn btn-ghost btn-xs rounded-full normal-case font-medium border-base-300"
                (click)="fillSuggestion(s)"
              >
                {{ s.label }}
              </button>
            }
          </div>

          <button
            type="submit"
            class="btn btn-primary btn-sm w-full"
            [disabled]="isConnecting() || urlInput().trim().length === 0"
          >
            @if (isConnecting()) {
              <span class="loading loading-spinner loading-xs"></span>
              Connecting…
            } @else {
              <lucide-angular
                [img]="PlugIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
              Connect
            }
          </button>
        </form>
        <p class="text-[10px] text-base-content/30 text-center">
          Opens your browser to authorize. Your tokens are stored encrypted by
          Ptah and never leave your machine.
        </p>
      </div>

      <!-- Connected servers -->
      <div>
        <div
          class="text-[11px] text-base-content/50 uppercase tracking-wide mb-1.5 font-medium"
        >
          Connected apps
        </div>

        @if (isLoading()) {
          @for (i of [1, 2, 3]; track i) {
            <div class="skeleton h-14 w-full rounded-lg mb-1.5"></div>
          }
        } @else if (loadError()) {
          <div class="alert alert-error alert-sm py-1 px-2">
            <span class="text-xs">{{ loadError() }}</span>
            <button
              class="btn btn-ghost btn-xs"
              (click)="reload()"
              type="button"
            >
              Retry
            </button>
          </div>
        } @else if (servers().length === 0) {
          <div
            class="text-xs text-base-content/50 text-center py-6 rounded-lg border border-dashed border-base-300"
          >
            No apps connected yet. Paste a server URL above and click Connect to
            authorize your first OAuth MCP server.
          </div>
        } @else {
          <div class="space-y-1.5">
            @for (server of servers(); track server.serverKey) {
              <div
                class="rounded-lg border border-base-300 bg-base-200/30 hover:bg-base-200/60 transition-colors"
              >
                <div class="flex items-start gap-2 p-2">
                  <div
                    class="w-8 h-8 rounded-lg bg-base-300 border border-base-300 flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    <lucide-angular
                      [img]="PlugIcon"
                      class="w-4 h-4 text-base-content/60"
                    />
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span
                        class="text-xs font-medium text-base-content truncate"
                        >{{ server.name }}</span
                      >
                      @switch (statusOf(server.serverKey)) {
                        @case ('connected') {
                          <span
                            class="badge badge-xs badge-success text-[10px] gap-0.5"
                          >
                            <lucide-angular
                              [img]="CheckIcon"
                              class="w-2 h-2"
                              aria-hidden="true"
                            />
                            Connected
                          </span>
                        }
                        @case ('expired') {
                          <span
                            class="badge badge-xs badge-warning text-[10px]"
                          >
                            Expired
                          </span>
                        }
                        @default {
                          <span class="badge badge-xs badge-ghost text-[10px]">
                            Disconnected
                          </span>
                        }
                      }
                    </div>
                    <div
                      class="text-[10px] text-base-content/40 font-mono mt-0.5 truncate"
                    >
                      {{ server.serverUrl }}
                    </div>
                  </div>

                  <div class="shrink-0 flex items-center gap-1">
                    @if (statusOf(server.serverKey) !== 'connected') {
                      <button
                        class="btn btn-ghost btn-xs"
                        [disabled]="reconnectingKeys().has(server.serverKey)"
                        (click)="reconnect(server)"
                        type="button"
                        [attr.aria-label]="'Reconnect ' + server.name"
                      >
                        @if (reconnectingKeys().has(server.serverKey)) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else {
                          <lucide-angular
                            [img]="RefreshCwIcon"
                            class="w-3 h-3"
                            aria-hidden="true"
                          />
                          Reconnect
                        }
                      </button>
                    }
                    <button
                      class="btn btn-ghost btn-xs text-error"
                      [disabled]="disconnectingKeys().has(server.serverKey)"
                      (click)="disconnect(server)"
                      type="button"
                      [attr.aria-label]="'Disconnect ' + server.name"
                    >
                      @if (disconnectingKeys().has(server.serverKey)) {
                        <span class="loading loading-spinner loading-xs"></span>
                      } @else {
                        <lucide-angular
                          [img]="Trash2Icon"
                          class="w-3 h-3"
                          aria-hidden="true"
                        />
                        Disconnect
                      }
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class OAuthSurfaceComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  /** Increment to trigger a reload of the connected list (parity with other surfaces). */
  public readonly refreshTrigger = input(0);

  /** Emitted with the serverKey after a server is successfully connected. */
  public readonly serverConnected = output<string>();
  /** Emitted with the serverKey after a server is successfully disconnected. */
  public readonly serverDisconnected = output<string>();

  protected readonly KeyRoundIcon = KeyRound;
  protected readonly PlugIcon = Plug;
  protected readonly CheckIcon = Check;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly Trash2Icon = Trash2;

  /** Quick-connect chips exposed to the template. */
  protected readonly suggestions = OAUTH_SUGGESTIONS;

  /** Connect form fields. */
  public readonly urlInput = signal('');
  public readonly nameInput = signal('');
  public readonly isConnecting = signal(false);
  public readonly connectError = signal<string | null>(null);

  /**
   * Advanced connect fields — pre-registered client credentials for auth servers
   * that don't support dynamic client registration. Collapsed by default so the
   * common (DCR) path is visually unchanged.
   */
  public readonly clientIdInput = signal('');
  public readonly clientSecretInput = signal('');

  /** Connected servers (non-secret metadata only). */
  public readonly servers = signal<McpOAuthConnectedRecord[]>([]);
  /** Per-serverKey live connection state, driving the status pill. */
  public readonly statuses = signal<Map<string, McpOAuthConnectionState>>(
    new Map(),
  );

  public readonly isLoading = signal(false);
  public readonly loadError = signal<string | null>(null);

  /** Per-key inflight tracking for disconnect / reconnect actions. */
  public readonly disconnectingKeys = signal<Set<string>>(new Set());
  public readonly reconnectingKeys = signal<Set<string>>(new Set());

  /** Back-compat accessor: the rendered connected list. */
  public readonly displayServers = computed(() => this.servers());

  /** Reload the connected list when refreshTrigger changes (skips initial 0). */
  private readonly refreshEffect = effect(() => {
    const trigger = this.refreshTrigger();
    if (trigger > 0) {
      void this.loadConnected();
    }
  });

  public async ngOnInit(): Promise<void> {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
    await this.loadConnected();
  }

  // ── Connect form ─────────────────────────────────────────────────────────────

  public onUrlInput(event: Event): void {
    this.urlInput.set((event.target as HTMLInputElement).value);
  }

  public onNameInput(event: Event): void {
    this.nameInput.set((event.target as HTMLInputElement).value);
  }

  public onClientIdInput(event: Event): void {
    this.clientIdInput.set((event.target as HTMLInputElement).value);
  }

  public onClientSecretInput(event: Event): void {
    this.clientSecretInput.set((event.target as HTMLInputElement).value);
  }

  public fillSuggestion(suggestion: OAuthSuggestion): void {
    this.urlInput.set(suggestion.url);
    if (!this.nameInput().trim()) {
      this.nameInput.set(suggestion.label);
    }
  }

  /**
   * Connect a new OAuth MCP server. `connectOAuth` is long-running (opens the
   * browser and resolves only after the full round-trip) so this is a single
   * awaited call behind a pending spinner — no polling.
   */
  public async connect(event?: Event): Promise<void> {
    event?.preventDefault();
    const serverUrl = this.urlInput().trim();
    if (serverUrl.length === 0 || this.isConnecting()) {
      return;
    }
    const name = this.nameInput().trim();
    const clientId = this.clientIdInput().trim();
    const clientSecret = this.clientSecretInput().trim();
    this.isConnecting.set(true);
    this.connectError.set(null);
    try {
      const params: {
        serverUrl: string;
        name?: string;
        clientId?: string;
        clientSecret?: string;
      } = { serverUrl };
      if (name.length > 0) params.name = name;
      if (clientId.length > 0) params.clientId = clientId;
      if (clientSecret.length > 0) params.clientSecret = clientSecret;
      const result = await this.rpc.call('mcpDirectory:connectOAuth', params);
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        const serverKey = result.data.serverKey;
        this.urlInput.set('');
        this.nameInput.set('');
        this.clientIdInput.set('');
        this.clientSecretInput.set('');
        await this.loadConnected();
        if (this.destroyed) return;
        if (serverKey) this.serverConnected.emit(serverKey);
      } else {
        this.connectError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            'Failed to connect server',
        );
      }
    } catch {
      if (this.destroyed) return;
      this.connectError.set('Failed to connect server');
    } finally {
      if (!this.destroyed) this.isConnecting.set(false);
    }
  }

  /**
   * Reconnect an expired / disconnected server by re-running the OAuth flow
   * against its existing serverKey (reuses the same override-map slot).
   */
  public async reconnect(record: McpOAuthConnectedRecord): Promise<void> {
    if (this.reconnectingKeys().has(record.serverKey)) {
      return;
    }
    this.addToSet(this.reconnectingKeys, record.serverKey);
    this.connectError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:connectOAuth', {
        serverUrl: record.serverUrl,
        serverKey: record.serverKey,
        name: record.name,
      });
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        await this.loadConnected();
        if (this.destroyed) return;
        this.serverConnected.emit(record.serverKey);
      } else {
        this.connectError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            'Failed to reconnect server',
        );
      }
    } catch {
      if (this.destroyed) return;
      this.connectError.set('Failed to reconnect server');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.reconnectingKeys, record.serverKey);
    }
  }

  /** Disconnect a server — deletes its tokens + manifest record, then reloads. */
  public async disconnect(record: McpOAuthConnectedRecord): Promise<void> {
    if (this.disconnectingKeys().has(record.serverKey)) {
      return;
    }
    this.addToSet(this.disconnectingKeys, record.serverKey);
    this.connectError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:disconnectOAuth', {
        serverKey: record.serverKey,
      });
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        this.serverDisconnected.emit(record.serverKey);
        await this.loadConnected();
      } else {
        this.connectError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            'Failed to disconnect server',
        );
      }
    } catch {
      if (this.destroyed) return;
      this.connectError.set('Failed to disconnect server');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.disconnectingKeys, record.serverKey);
    }
  }

  // ── List / status ────────────────────────────────────────────────────────────

  /** Live state for a serverKey, defaulting to 'disconnected' when unresolved. */
  public statusOf(serverKey: string): McpOAuthConnectionState {
    return this.statuses().get(serverKey) ?? 'disconnected';
  }

  /** Public re-entry for the Retry button. */
  public reload(): void {
    void this.loadConnected();
  }

  private async loadConnected(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:listOAuthConnected', {});
      if (this.destroyed) return;
      if (result.isSuccess()) {
        this.servers.set(result.data.servers);
        await this.resolveStatuses(result.data.servers);
      } else {
        this.loadError.set(result.error ?? 'Failed to load connected servers');
        this.servers.set([]);
        this.statuses.set(new Map());
      }
    } catch {
      if (this.destroyed) return;
      this.loadError.set('Failed to load connected servers');
      this.servers.set([]);
      this.statuses.set(new Map());
    } finally {
      if (!this.destroyed) this.isLoading.set(false);
    }
  }

  /**
   * Resolve every connected server's live OAuth state in parallel. A failed
   * status probe degrades that row to 'disconnected' rather than failing the
   * whole load.
   */
  private async resolveStatuses(
    servers: McpOAuthConnectedRecord[],
  ): Promise<void> {
    const entries = await Promise.all(
      servers.map(async (server) => {
        try {
          const result = await this.rpc.call('mcpDirectory:oauthStatus', {
            serverKey: server.serverKey,
          });
          if (result.isSuccess()) {
            return [server.serverKey, result.data.state] as const;
          }
        } catch {
          // Fall through to the disconnected default.
        }
        return [
          server.serverKey,
          'disconnected' as McpOAuthConnectionState,
        ] as const;
      }),
    );
    if (this.destroyed) return;
    this.statuses.set(new Map(entries));
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private addToSet(
    sig: ReturnType<typeof signal<Set<string>>>,
    value: string,
  ): void {
    sig.update((s) => new Set([...s, value]));
  }

  private removeFromSet(
    sig: ReturnType<typeof signal<Set<string>>>,
    value: string,
  ): void {
    sig.update((s) => {
      const next = new Set(s);
      next.delete(value);
      return next;
    });
  }
}
