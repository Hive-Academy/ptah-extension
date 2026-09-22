import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Puzzle } from 'lucide-angular';
import {
  PluginCatalogPanelComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import {
  CommandDiscoveryFacade,
  PluginCatalogService,
  type MarketplaceSourceId,
} from '@ptah-extension/core';
import { ExternalMarketplacesComponent } from './external-marketplaces.component';
import { HarnessHealthBadgeComponent } from './harness/harness-health-badge.component';
import { HarnessHealthStore } from './harness/harness-health.store';
import { marketplaceSourcesOf } from './sections.registry';

/**
 * SkillsSectionComponent — the chip strip and single mounted surface of the
 * `skills` section.
 *
 * The header carries {@link HarnessHealthBadgeComponent} and the
 * `{enabled}/{total} enabled` line that `PluginsSurfaceComponent` used to own.
 * The badge is the only surface that says whether an enabled plugin actually
 * REACHED the CLI tools that have to read it (TASK_2026_278), so it belongs
 * beside the plugin catalogue rather than in the hub header.
 *
 * Exactly one surface is mounted at a time, behind an `@if`, so an unselected
 * chip fires zero RPC.
 */
@Component({
  selector: 'ptah-skills-section',
  standalone: true,
  imports: [
    LucideAngularModule,
    PluginCatalogPanelComponent,
    SkillShBrowserComponent,
    ExternalMarketplacesComponent,
    HarnessHealthBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
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
          <h2 class="text-sm font-semibold text-base-content">Skills</h2>
          <p
            class="text-xs text-base-content-muted mt-1"
            data-testid="skills-enabled-count"
          >
            {{ catalog.enabledCount() }}/{{ catalog.pluginTotal() }} enabled
          </p>
        </div>
        <div class="ml-auto shrink-0">
          <ptah-harness-health-badge />
        </div>
      </div>

      <div
        class="join"
        role="group"
        aria-label="Skill sources"
        data-testid="skills-chips"
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

      @if (activeSource() === 'ptah-plugins') {
        <ptah-plugin-catalog-panel (saved)="onSaved()" />
      } @else if (activeSource() === 'community') {
        <ptah-skill-sh-browser
          [refreshTrigger]="refreshTrigger()"
          (skillInstalled)="contentChanged.emit()"
          (skillUninstalled)="contentChanged.emit()"
        />
      } @else if (activeSource() === 'marketplaces') {
        <ptah-external-marketplaces [refreshTrigger]="refreshTrigger()" />
      }
    </div>
  `,
})
export class SkillsSectionComponent {
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);
  private readonly harnessHealth = inject(HarnessHealthStore);

  protected readonly catalog = inject(PluginCatalogService);

  public readonly activeSource = input.required<MarketplaceSourceId>();
  public readonly refreshTrigger = input(0);

  public readonly sourceSelected = output<MarketplaceSourceId>();
  public readonly contentChanged = output<void>();

  protected readonly PuzzleIcon = Puzzle;
  protected readonly sources = marketplaceSourcesOf('skills');

  /**
   * Saving the plugin configuration changes the DESIRED harness, so the badge's
   * report is stale the moment this returns. `plugins:save-config` triggers a
   * reconcile backend-side; the re-read asks for a FRESH pass rather than the
   * cached report so the badge cannot win a race against it and redisplay the
   * pre-save answer.
   *
   * The enabled count is not poked here: the panel re-reads
   * `PluginCatalogService` before it emits `saved` (TASK_2026_345), and the
   * header renders straight off that signal.
   */
  protected onSaved(): void {
    this.commandDiscovery.clearCache();
    void this.harnessHealth.refresh({ refresh: true });
  }
}
