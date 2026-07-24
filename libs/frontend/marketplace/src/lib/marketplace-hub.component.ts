import {
  Component,
  ChangeDetectionStrategy,
  inject,
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
} from '@ptah-extension/core';
import {
  McpDirectoryBrowserComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import { MARKETPLACE_PROVIDERS } from './providers.registry';
import { MarketplaceProviderSpec } from './provider-spec';
import { MarketplaceStateService } from './marketplace-state.service';
import { ComingSoonPlaceholderComponent } from './coming-soon-placeholder.component';
import { OAuthSurfaceComponent } from './oauth-surface.component';

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
