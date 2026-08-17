import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Puzzle } from 'lucide-angular';
import { CommandDiscoveryFacade } from '@ptah-extension/core';
import {
  PluginStatusWidgetComponent,
  PluginBrowserModalComponent,
} from '@ptah-extension/chat-ui';
import { ExternalMarketplacesComponent } from './external-marketplaces.component';

/**
 * PluginsSurfaceComponent — the `plugins` provider surface of the Marketplace
 * hub, and a thin composer only.
 *
 * It stacks two independent concerns and owns neither:
 *  - BUNDLED plugins (top): {@link PluginStatusWidgetComponent} +
 *    {@link PluginBrowserModalComponent}. These ship with Ptah; the user only
 *    enables or disables them.
 *  - EXTERNAL marketplaces (below): {@link ExternalMarketplacesComponent},
 *    which registers GitHub-hosted marketplaces and installs their plugins
 *    behind the two-call consent protocol.
 *
 * Complexity Level: 1 — composition and one modal-open flag.
 */
@Component({
  selector: 'ptah-plugins-surface',
  standalone: true,
  imports: [
    LucideAngularModule,
    PluginStatusWidgetComponent,
    PluginBrowserModalComponent,
    ExternalMarketplacesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <div class="flex items-start gap-3">
        <div
          class="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0"
        >
          <lucide-angular
            [img]="PuzzleIcon"
            class="w-4 h-4 text-primary"
            aria-hidden="true"
          />
        </div>
        <div>
          <h2 class="text-sm font-semibold text-base-content">Ptah Skills</h2>
          <p class="text-xs text-base-content-muted mt-1 leading-relaxed">
            Enhance your sessions with specialized skills for orchestration,
            frontend patterns, backend architecture, and more.
          </p>
        </div>
      </div>

      <ptah-plugin-status-widget (configureClicked)="openBrowser()" />

      <div class="divider my-1"></div>

      <ptah-external-marketplaces [refreshTrigger]="refreshTrigger()" />
    </div>

    <ptah-plugin-browser-modal
      [isOpen]="browserOpen()"
      (closed)="closeBrowser()"
      (saved)="onSaved()"
    />
  `,
})
export class PluginsSurfaceComponent {
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);

  public readonly refreshTrigger = input(0);

  protected readonly PuzzleIcon = Puzzle;
  protected readonly browserOpen = signal(false);

  private readonly statusWidget = viewChild(PluginStatusWidgetComponent);

  protected openBrowser(): void {
    this.browserOpen.set(true);
  }

  protected closeBrowser(): void {
    this.browserOpen.set(false);
  }

  protected onSaved(): void {
    this.browserOpen.set(false);
    this.commandDiscovery.clearCache();
    this.statusWidget()?.fetchPluginStatus();
  }
}
