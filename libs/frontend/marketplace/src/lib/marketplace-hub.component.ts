import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, Store, ArrowLeft } from 'lucide-angular';
import {
  AppStateManager,
  CommandDiscoveryFacade,
  ClaudeRpcService,
  type MarketplaceSection,
  type MarketplaceSourceId,
} from '@ptah-extension/core';
import { NativeTabGroupComponent, type NativeTab } from '@ptah-extension/ui';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import type { InstalledMcpServer } from '@ptah-extension/shared';
import { toConnectorRows } from './mcp-connector-rows';
import { MARKETPLACE_SECTIONS } from './sections.registry';
import { MarketplaceStateService } from './marketplace-state.service';
import { ConnectedSurfaceComponent } from './connected-surface.component';
import { AppsSectionComponent } from './apps-section.component';
import { SkillsSectionComponent } from './skills-section.component';

/**
 * Marketplace hub — the `'marketplace'` top-level view.
 *
 * Header, the three-section tab strip, and the `SessionMcpStatusRegistry`
 * wiring. Exactly one section composer mounts at a time, and each composer
 * mounts exactly one surface, so an unselected section AND an unselected chip
 * fire zero RPC — the hub's standing rule, now applied at two levels.
 */
@Component({
  selector: 'ptah-marketplace-hub',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativeTabGroupComponent,
    ConnectedSurfaceComponent,
    AppsSectionComponent,
    SkillsSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './marketplace-hub.component.html',
})
export class MarketplaceHubComponent {
  private readonly appState = inject(AppStateManager);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);
  private readonly state = inject(MarketplaceStateService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly mcpStatus = inject(SessionMcpStatusRegistry);

  protected readonly StoreIcon = Store;
  protected readonly ArrowLeftIcon = ArrowLeft;

  /** The section strip, in registry order. */
  protected readonly sectionTabs: readonly NativeTab[] =
    MARKETPLACE_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
    }));

  public readonly activeSection = this.state.activeSection;
  public readonly activeSource = this.state.activeSource;
  public readonly refreshTrigger = this.state.refreshTrigger;

  /**
   * `serverKey`s the MCP Registry surface already reaches on its own, used only
   * to keep a disk-configured server from also appearing as a connector row.
   *
   * Read here as well as inside the surface because the surface keeps its list
   * private and the de-duplication has to happen BEFORE the rows are handed
   * over: `groupInstalledServers` groups by origin AND key, so an undeduplicated
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
   * turn right now. With no session ever recorded this is `[]`.
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
   * Load the installed keys only while the MCP Registry chip is the selected
   * one. That chip's surface is the only consumer of `connectorServers` from
   * this host; the Connected surface does its own `listInstalled` read and
   * re-filters against it, so it needs nothing from here.
   *
   * Gated on the selection rather than run on construction, and re-run on
   * `refreshTrigger` so an install or removal cannot leave a stale key set
   * behind and resurrect a duplicate row.
   */
  private readonly installedKeysEffect = effect(() => {
    const section = this.activeSection();
    const source = this.activeSource();
    this.refreshTrigger();
    if (section !== 'apps' || source !== 'mcp-registry') {
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

  /** Tab strip selection. Unknown ids cannot reach here — the strip owns them. */
  public onSection(id: string): void {
    const section = MARKETPLACE_SECTIONS.find((s) => s.id === id);
    if (!section) return;
    this.state.select(section.id);
  }

  /** Chip selection inside the active section. */
  public onSource(source: MarketplaceSourceId): void {
    this.state.selectSource(source);
  }

  /** A Connected-view "Manage" or empty-state button asked for a section. */
  public onNavigateRequested(target: {
    section: MarketplaceSection;
    source: MarketplaceSourceId;
  }): void {
    this.state.select(target.section, target.source);
  }

  public goBack(): void {
    this.appState.setCurrentView('chat');
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
}
