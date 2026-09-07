import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  signal,
  Type,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import {
  LucideAngularModule,
  LucideIconData,
  Store,
  ArrowLeft,
} from 'lucide-angular';
import {
  WebviewNavigationService,
  CommandDiscoveryFacade,
  ClaudeRpcService,
} from '@ptah-extension/core';
import {
  McpDirectoryBrowserComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import type { InstalledMcpServer } from '@ptah-extension/shared';
import { toConnectorRows } from './mcp-connector-rows';
import { MARKETPLACE_PROVIDERS } from './providers.registry';
import { MarketplaceProviderSpec } from './provider-spec';
import { MarketplaceStateService } from './marketplace-state.service';
import { ComingSoonPlaceholderComponent } from './coming-soon-placeholder.component';
import { OAuthSurfaceComponent } from './oauth-surface.component';

/**
 * Registry id of the MCP Registry provider — the one surface that renders the
 * Installed tab, and therefore the only selection that justifies the extra
 * `mcpDirectory:listInstalled` read this host makes.
 */
const MCP_REGISTRY_PROVIDER_ID = 'official-mcp';

/**
 * Marketplace hub — the `'marketplace'` top-level view.
 *
 * Renders the provider registry as a selectable list and mounts the selected
 * provider's content surface lazily (only the active surface mounts, so a
 * coming-soon / unselected provider fires ZERO RPC). Open/Closed: the provider
 * list + generic surface mount are driven entirely by {@link MARKETPLACE_PROVIDERS},
 * so adding a descriptor requires no edits here.
 */
@Component({
  selector: 'ptah-marketplace-hub',
  standalone: true,
  imports: [
    LucideAngularModule,
    NgComponentOutlet,
    McpDirectoryBrowserComponent,
    SkillShBrowserComponent,
    OAuthSurfaceComponent,
    ComingSoonPlaceholderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './marketplace-hub.component.html',
})
export class MarketplaceHubComponent {
  private readonly navigation = inject(WebviewNavigationService);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);
  private readonly state = inject(MarketplaceStateService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly mcpStatus = inject(SessionMcpStatusRegistry);

  protected readonly providers = MARKETPLACE_PROVIDERS;
  protected readonly StoreIcon = Store;
  protected readonly ArrowLeftIcon = ArrowLeft;

  /** Surface refs used to bind install side-effects on the live surfaces. */
  protected readonly McpSurface = McpDirectoryBrowserComponent;
  protected readonly SkillsSurface = SkillShBrowserComponent;
  protected readonly OAuthSurface = OAuthSurfaceComponent;

  public readonly selectedProvider = this.state.selectedProvider;
  public readonly selectedProviderId = this.state.selectedProviderId;
  public readonly refreshTrigger = this.state.refreshTrigger;

  /**
   * `serverKey`s the MCP surface already reaches on its own, used only to keep
   * a disk-configured server from also appearing as a connector row.
   *
   * Read here as well as inside the surface because the surface keeps its list
   * private and the de-duplication has to happen BEFORE the rows are handed
   * over: `installedGroups` groups by origin AND key, so an undeduplicated
   * `ptah` would render twice, once per origin.
   */
  private readonly installedServerKeys = signal<readonly string[]>([]);

  /**
   * claude.ai account connectors, mapped into read-only Installed-tab rows.
   *
   * ## Which session
   *
   * The Marketplace owns no session, so it reads the MOST RECENTLY RECORDED one
   * — `SessionMcpStatusRegistry.record` re-inserts a session on every write, so
   * the last key is the newest report. That is the session whose connector
   * picture is most likely to match what the user would get if they started a
   * turn right now. With no session ever recorded this is `[]`, and the tab
   * behaves exactly as it does today.
   */
  public readonly connectorServers = computed<InstalledMcpServer[]>(() => {
    const sessions = this.mcpStatus.sessions();
    const newest = sessions[sessions.length - 1];
    if (!newest) return [];
    const status = this.mcpStatus.peek(newest);
    if (!status) return [];
    return toConnectorRows(status.servers, this.installedServerKeys());
  });

  /**
   * Load the installed keys only while the MCP surface is the selected one.
   *
   * The hub's standing rule is that an unselected provider fires ZERO RPC, so
   * this read is gated on the selection rather than run on construction. It
   * re-runs on `refreshTrigger` so an install or removal cannot leave a stale
   * key set behind and resurrect a duplicate row.
   */
  private readonly installedKeysEffect = effect(() => {
    const providerId = this.selectedProviderId();
    this.refreshTrigger();
    if (providerId !== MCP_REGISTRY_PROVIDER_ID) {
      return;
    }
    void this.loadInstalledServerKeys();
  });

  private async loadInstalledServerKeys(): Promise<void> {
    try {
      const result = await this.rpcService.call(
        'mcpDirectory:listInstalled',
        {},
      );
      if (!result.isSuccess()) {
        // A failed read is not worth a banner here — the surface makes the same
        // call and reports its own failure. Keeping the previous key set is the
        // safer degradation: an empty one would resurrect duplicate rows.
        return;
      }
      this.installedServerKeys.set(result.data.servers.map((s) => s.serverKey));
    } catch {
      // Same reasoning as the non-success branch: keep the last known keys.
    }
  }

  /** Narrow the descriptor's `unknown` icon ref to the lucide template type. */
  public iconOf(icon: unknown): LucideIconData {
    return icon as LucideIconData;
  }

  public selectProvider(provider: MarketplaceProviderSpec): void {
    this.state.select(provider.id);
  }

  public backToOverview(): void {
    this.state.clearSelection();
  }

  public goBack(): void {
    this.navigation.navigateToView('chat');
  }

  /**
   * Side effect ported from the old Settings host: after an install/uninstall
   * the command-discovery autocomplete cache must be cleared so newly installed
   * skills/servers surface in `/command` + `@agent` autocomplete, and the
   * active surface reloads its installed list.
   */
  public onContentChanged(): void {
    this.commandDiscovery.clearCache();
    this.state.notifyContentChanged();
  }

  /** Whether the selected provider has a generic (non-special-cased) surface. */
  public isGenericSurface(surface: Type<unknown> | undefined): boolean {
    return (
      !!surface &&
      surface !== this.McpSurface &&
      surface !== this.SkillsSurface &&
      surface !== this.OAuthSurface
    );
  }
}
