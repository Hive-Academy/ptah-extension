import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
} from '@angular/core';
import { LucideAngularModule, Puzzle } from 'lucide-angular';
import { CommandDiscoveryFacade } from '@ptah-extension/core';
import {
  PluginStatusWidgetComponent,
  PluginBrowserModalComponent,
} from '@ptah-extension/chat-ui';
import { ExternalMarketplacesComponent } from './external-marketplaces.component';
import { HarnessHealthBadgeComponent } from './harness/harness-health-badge.component';
import { HarnessHealthStore } from './harness/harness-health.store';

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
 * The header carries {@link HarnessHealthBadgeComponent}, which closes the loop
 * on both: enabling a plugin writes it to the Ptah user layer, and the badge is
 * the only surface that says whether it then REACHED the CLI tools that have to
 * read it (TASK_2026_278). It lives here rather than in the hub header so the
 * hub stays driven purely by its provider registry.
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
    HarnessHealthBadgeComponent,
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
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-base-content">Ptah Skills</h2>
          <p class="text-xs text-base-content-muted mt-1 leading-relaxed">
            Enhance your sessions with specialized skills for orchestration,
            frontend patterns, backend architecture, and more.
          </p>
        </div>
        <div class="ml-auto shrink-0">
          <ptah-harness-health-badge />
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
  private readonly harnessHealth = inject(HarnessHealthStore);

  public readonly refreshTrigger = input(0);

  protected readonly PuzzleIcon = Puzzle;
  protected readonly browserOpen = signal(false);

  protected openBrowser(): void {
    this.browserOpen.set(true);
  }

  protected closeBrowser(): void {
    this.browserOpen.set(false);
  }

  /**
   * Saving the plugin configuration changes the DESIRED harness, so the badge's
   * report is stale the moment this returns. `plugins:save-config` triggers a
   * reconcile backend-side; the re-read asks for a fresh pass rather than the
   * cached report so the badge cannot win a race against it and redisplay the
   * pre-save answer.
   *
   * The status widget is NOT poked here any more (TASK_2026_345): it renders
   * from `PluginCatalogService`, which the modal re-read before it emitted
   * `saved`. The `viewChild` handle that existed only for that poke is gone
   * with it.
   */
  protected onSaved(): void {
    this.browserOpen.set(false);
    this.commandDiscovery.clearCache();
    void this.harnessHealth.refresh({ refresh: true });
  }
}
