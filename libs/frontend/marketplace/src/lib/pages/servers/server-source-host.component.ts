import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  Blocks,
  KeyRound,
  LucideAngularModule,
  Server,
  type LucideIconData,
} from 'lucide-angular';
import { McpDirectoryBrowserComponent } from '@ptah-extension/chat-ui';
import type { MarketplaceServerSource } from '@ptah-extension/core';

import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { MarketplaceLayout } from '../../layout/marketplace-layout';
import { OAuthSurfaceComponent } from '../../oauth-surface.component';
import { SmitherySurfaceComponent } from '../../smithery-surface.component';
import { SourceBandComponent } from '../../ui/source-band.component';

/**
 * The reused surfaces this host can mount — one `@case` each in the template.
 * A closed union: a source can only name a surface the template renders.
 */
export type ServerSourceSurface = 'smithery' | 'mcp-directory' | 'oauth';

/** The band copy of one server source, and the surface it mounts. */
interface ServerSourcePage {
  readonly heading: string;
  readonly description: string;
  readonly icon: LucideIconData;
  readonly surface: ServerSourceSurface;
}

/**
 * Band copy and surface per source. A `Record` over `MarketplaceServerSource`,
 * so a new source without copy AND a surface fails to compile, instead of
 * rendering a band above nothing.
 */
export const SERVER_SOURCE_PAGES: Readonly<
  Record<MarketplaceServerSource, ServerSourcePage>
> = {
  smithery: {
    heading: 'Smithery',
    description:
      'Hosted MCP servers, installed and authorized through your Smithery namespace.',
    icon: Blocks,
    surface: 'smithery',
  },
  registry: {
    heading: 'MCP Registry',
    description:
      'The open MCP server registry. Install a server into the config of each CLI you pick.',
    icon: Server,
    surface: 'mcp-directory',
  },
  'custom-url': {
    heading: 'Custom URL',
    description:
      'Connect any remote MCP server by its URL, signing in with OAuth when it asks.',
    icon: KeyRound,
    surface: 'oauth',
  },
};

/**
 * ServerSourceHostComponent — one server source page (`/marketplace/servers/
 * smithery | registry | custom-url`, plan C7 `ServerSourceHost`).
 *
 * A {@link SourceBandComponent} (the page's only `<h1>`; the storefront band
 * at wide, the compact row otherwise) above EXACTLY ONE reused surface,
 * chosen by the `source` input that the route's `data` binds (Batch 17).
 * Only the selected surface exists, so a source page fires its own surface's
 * reads and nothing else (pattern: `apps-section.component.ts`).
 *
 * The registry browser is discovery only (plan C11): it installs but never
 * removes, so it reports installs alone.
 *
 * Every install, uninstall, connect or disconnect a surface reports calls
 * `notifyContentChanged()`, which clears the `/command` autocomplete cache and
 * reloads only the inventory slices some page already loaded.
 */
@Component({
  selector: 'ptah-server-source-host',
  standalone: true,
  imports: [
    LucideAngularModule,
    SourceBandComponent,
    SmitherySurfaceComponent,
    McpDirectoryBrowserComponent,
    OAuthSurfaceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-w-0 p-4',
    'data-testid': 'server-source-host',
    '[attr.data-source]': 'source()',
  },
  template: `
    <div class="space-y-4">
      <ptah-source-band
        [layout]="bandLayout()"
        eyebrow="MCP servers"
        [heading]="band().heading"
        [description]="band().description"
      >
        <span
          band-mark
          class="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <lucide-angular [img]="band().icon" class="h-5 w-5" />
        </span>
      </ptah-source-band>

      @switch (band().surface) {
        @case ('smithery') {
          <ptah-smithery-surface
            (serverInstalled)="onContentChanged()"
            (serverUninstalled)="onContentChanged()"
          />
        }
        @case ('mcp-directory') {
          <ptah-mcp-directory-browser (serverInstalled)="onContentChanged()" />
        }
        @case ('oauth') {
          <ptah-oauth-surface
            (serverConnected)="onContentChanged()"
            (serverDisconnected)="onContentChanged()"
          />
        }
      }
    </div>
  `,
})
export class ServerSourceHostComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly layout = inject(MarketplaceLayout);

  /** Which source this page shows. Bound from route `data.source` (Batch 17). */
  public readonly source = input.required<MarketplaceServerSource>();

  protected readonly band = computed(() => SERVER_SOURCE_PAGES[this.source()]);

  /** The storefront band at wide, one tight row otherwise. */
  protected readonly bandLayout = computed(() =>
    this.layout.tier() === 'wide' ? 'storefront' : 'compact',
  );

  protected onContentChanged(): void {
    this.inventory.notifyContentChanged();
  }
}
