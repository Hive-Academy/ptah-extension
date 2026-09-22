import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { McpDirectoryBrowserComponent } from '@ptah-extension/chat-ui';
import type { MarketplaceSourceId } from '@ptah-extension/core';
import type { InstalledMcpServer } from '@ptah-extension/shared';
import { ConnectorsSurfaceComponent } from './connectors-surface.component';
import { SmitherySurfaceComponent } from './smithery-surface.component';
import { OAuthSurfaceComponent } from './oauth-surface.component';
import { marketplaceSourcesOf } from './sections.registry';

/**
 * AppsSectionComponent — the chip strip and single mounted surface of the
 * `apps` section.
 *
 * A composer only: it owns no RPC and no error handling of its own. Exactly ONE
 * surface is mounted at a time, behind an `@if`, which is what keeps the hub's
 * standing rule true — an unselected chip fires zero RPC. Swapping the chip
 * destroys the previous surface and mounts the next one, so each surface's own
 * `ngOnInit` load is also its refresh.
 */
@Component({
  selector: 'ptah-apps-section',
  standalone: true,
  imports: [
    LucideAngularModule,
    ConnectorsSurfaceComponent,
    SmitherySurfaceComponent,
    McpDirectoryBrowserComponent,
    OAuthSurfaceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <div
        class="join"
        role="group"
        aria-label="App sources"
        data-testid="apps-chips"
      >
        @for (source of sources; track source.id) {
          <button
            type="button"
            class="btn btn-sm join-item gap-1.5"
            [class.btn-primary]="source.id === activeSource()"
            [class.btn-ghost]="source.id !== activeSource()"
            [attr.aria-pressed]="source.id === activeSource()"
            [attr.data-source-id]="source.id"
            data-testid="marketplace-chip"
            (click)="sourceSelected.emit(source.id)"
          >
            <lucide-angular
              [img]="source.icon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
            {{ source.label }}
          </button>
        }
      </div>

      @if (activeSource() === 'connectors') {
        <ptah-connectors-surface [refreshTrigger]="refreshTrigger()" />
      } @else if (activeSource() === 'smithery') {
        <ptah-smithery-surface
          [refreshTrigger]="refreshTrigger()"
          (serverInstalled)="contentChanged.emit()"
          (serverUninstalled)="contentChanged.emit()"
        />
      } @else if (activeSource() === 'mcp-registry') {
        <ptah-mcp-directory-browser
          [refreshTrigger]="refreshTrigger()"
          [connectorServers]="connectorServers()"
          (serverInstalled)="contentChanged.emit()"
          (serverUninstalled)="contentChanged.emit()"
        />
      } @else if (activeSource() === 'custom-url') {
        <ptah-oauth-surface
          [refreshTrigger]="refreshTrigger()"
          (serverConnected)="contentChanged.emit()"
          (serverDisconnected)="contentChanged.emit()"
        />
      }
    </div>
  `,
})
export class AppsSectionComponent {
  public readonly activeSource = input.required<MarketplaceSourceId>();
  public readonly refreshTrigger = input(0);
  public readonly connectorServers = input<InstalledMcpServer[]>([]);

  public readonly sourceSelected = output<MarketplaceSourceId>();
  public readonly contentChanged = output<void>();

  protected readonly sources = marketplaceSourcesOf('apps');
}
