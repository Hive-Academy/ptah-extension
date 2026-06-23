import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  Type,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import {
  LucideAngularModule,
  LucideIconData,
  Store,
  ArrowLeft,
  Lock,
  Sparkles,
} from 'lucide-angular';
import {
  WebviewNavigationService,
  ClaudeRpcService,
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

/**
 * Marketplace hub — the `'marketplace'` top-level view.
 *
 * Renders the provider registry as a selectable list and mounts the selected
 * provider's content surface lazily (only the active surface mounts, so a
 * coming-soon / unselected provider fires ZERO RPC). Open/Closed: the provider
 * list + generic surface mount are driven entirely by {@link MARKETPLACE_PROVIDERS},
 * so adding a descriptor requires no edits here.
 *
 * Pro-gated: the whole hub checks `license:getStatus` on mount and renders an
 * upgrade affordance for non-premium users WITHOUT firing any marketplace RPC.
 */
@Component({
  selector: 'ptah-marketplace-hub',
  standalone: true,
  imports: [
    LucideAngularModule,
    NgComponentOutlet,
    McpDirectoryBrowserComponent,
    SkillShBrowserComponent,
    ComingSoonPlaceholderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './marketplace-hub.component.html',
})
export class MarketplaceHubComponent implements OnInit {
  private readonly navigation = inject(WebviewNavigationService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);
  private readonly state = inject(MarketplaceStateService);

  protected readonly providers = MARKETPLACE_PROVIDERS;
  protected readonly StoreIcon = Store;
  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly LockIcon = Lock;
  protected readonly SparklesIcon = Sparkles;

  /** Surface refs used to bind install side-effects on the two live surfaces. */
  protected readonly McpSurface = McpDirectoryBrowserComponent;
  protected readonly SkillsSurface = SkillShBrowserComponent;

  /** null = license not yet resolved → render nothing license-sensitive, no RPC. */
  private readonly _isPremium = signal<boolean | null>(null);
  public readonly isPremium = computed(() => this._isPremium() === true);
  public readonly isLicenseResolved = computed(
    () => this._isPremium() !== null,
  );

  public readonly selectedProvider = this.state.selectedProvider;
  public readonly selectedProviderId = this.state.selectedProviderId;
  public readonly refreshTrigger = this.state.refreshTrigger;

  public async ngOnInit(): Promise<void> {
    // Authoritative pro-gate: resolve license BEFORE any provider surface is
    // allowed to mount. Non-premium users never reach a surface, so no
    // marketplace RPC is fired for them. license:getStatus is itself
    // license-exempt so it always resolves.
    try {
      const result = await this.rpc.call('license:getStatus', {});
      this._isPremium.set(
        result.isSuccess() ? (result.data?.isPremium ?? false) : false,
      );
    } catch {
      this._isPremium.set(false);
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
      !!surface && surface !== this.McpSurface && surface !== this.SkillsSurface
    );
  }
}
