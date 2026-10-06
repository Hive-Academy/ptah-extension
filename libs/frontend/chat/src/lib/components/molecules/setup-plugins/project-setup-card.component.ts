import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { LucideAngularModule, ScanSearch, AlertTriangle } from 'lucide-angular';
import { SetupStatusWidgetComponent } from '@ptah-extension/chat-ui';
import { AppStateManager, PluginCatalogService } from '@ptah-extension/core';

/**
 * ProjectSetupCardComponent - The "Skills Not Configured" warning and the
 * Intelligent Project Setup card.
 *
 * Shown only on the "no session open" screens: the Orchestra Canvas with no
 * tiles, and the single-chat view before its first tab exists. An empty
 * session tile does not show it — it shows prompt suggestions only.
 *
 * `chat` must not import `@ptah-extension/marketplace`, so the warning's
 * button addresses the Marketplace page through `AppStateManager.openMarketplace`.
 */
@Component({
  selector: 'ptah-project-setup-card',
  imports: [SetupStatusWidgetComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-5">
      <!-- Warning if skills not configured -->
      @if (!hasConfiguredSkills()) {
        <div
          class="border border-base-300 rounded-md bg-base-200/50 p-3 flex items-start gap-2 text-left"
        >
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="w-4 h-4 text-warning shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div class="flex-1">
            <h4 class="text-xs font-semibold text-warning mb-1">
              Skills Not Configured
            </h4>
            <p class="text-xs text-base-content-muted leading-relaxed mb-2">
              The Intelligent Project Setup uses your configured skills to
              provide better recommendations. It's recommended to configure your
              Ptah Skills first for optimal results.
            </p>
            <button
              class="btn btn-xs btn-primary btn-outline"
              (click)="openMarketplaceSkills()"
              type="button"
            >
              Open Marketplace Skills
            </button>
          </div>
        </div>
      }

      <!-- Smart Setup CTA Card - Glass Panel -->
      <div
        class="glass-panel glass-panel-divine rounded-xl overflow-hidden transition-all duration-300 hover:shadow-lg text-left"
      >
        <div class="p-4">
          <!-- Header with Scanner Icon -->
          <div class="flex items-start gap-3 mb-3">
            <div
              class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary shrink-0 agent-working"
            >
              <lucide-angular
                [img]="ScanSearchIcon"
                class="w-5 h-5 md:w-6 md:h-6"
                aria-hidden="true"
              />
            </div>
            <div class="flex-1">
              <h3
                class="text-sm md:text-base font-semibold text-primary mb-0.5"
              >
                Intelligent Project Setup
              </h3>
              <p class="text-xs text-base-content-muted leading-relaxed">
                MCP-powered scanning analyzes your workspace, detects
                frameworks, and configures optimal AI agents automatically.
              </p>
            </div>
          </div>

          <!-- Feature Badges using DaisyUI -->
          <div class="flex flex-wrap gap-1.5 mb-3">
            <span class="badge badge-sm badge-ghost gap-1">
              <span class="text-[10px]">⚡</span> Auto-detect
            </span>
            <span class="badge badge-sm badge-ghost gap-1">
              <span class="text-[10px]">🔗</span> VS Code AI
            </span>
            <span class="badge badge-sm badge-ghost gap-1">
              <span class="text-[10px]">🛠️</span> MCP Server
            </span>
          </div>

          <!-- Setup Status Widget Integration -->
          <ptah-setup-status-widget />
        </div>
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
export class ProjectSetupCardComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  /** The same shared catalog the setup widget reads (TASK_2026_345). */
  private readonly catalog = inject(PluginCatalogService);

  /** Lucide icon references for template binding */
  protected readonly ScanSearchIcon = ScanSearch;
  protected readonly AlertTriangleIcon = AlertTriangle;

  /**
   * Whether skills are configured (used for the "not configured" warning).
   *
   * The warning is deliberately SUPPRESSED until the catalog has been read:
   * `hasEnabledPlugins` is false on an empty store, and flashing "you have no
   * skills" at a user who has plenty is worse than showing nothing for one
   * round trip.
   */
  protected readonly hasConfiguredSkills = computed(
    () => !this.catalog.isLoaded() || this.catalog.hasEnabledPlugins(),
  );

  /**
   * Read the catalog once so the warning above can evaluate. It is a no-op
   * when another consumer of the shared catalog already loaded it.
   */
  ngOnInit(): void {
    void this.catalog.ensureLoaded();
  }

  /** Open the Marketplace on the Ptah plugins skill source. */
  protected openMarketplaceSkills(): void {
    this.appState.openMarketplace({ page: 'skills', source: 'ptah-plugins' });
  }
}
