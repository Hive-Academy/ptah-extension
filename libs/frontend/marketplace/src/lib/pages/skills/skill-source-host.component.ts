import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  GraduationCap,
  LucideAngularModule,
  Package,
  Puzzle,
  type LucideIconData,
} from 'lucide-angular';
import {
  PluginCatalogPanelComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import type { MarketplaceSkillSource } from '@ptah-extension/core';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { ExternalMarketplacesComponent } from '../../external-marketplaces.component';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import { MarketplaceLayout } from '../../layout/marketplace-layout';
import { SourceBandComponent } from '../../ui/source-band.component';
import { SkillsSectionHeaderComponent } from './skills-section-header.component';

/** The band copy of one skill source. */
interface SkillSourceBand {
  readonly heading: string;
  readonly description: string;
  readonly icon: LucideIconData;
}

/** Band copy per source; a `Record` so a new source without copy fails to compile. */
export const SKILL_SOURCE_BANDS: Readonly<
  Record<MarketplaceSkillSource, SkillSourceBand>
> = {
  'ptah-plugins': {
    heading: 'Ptah Plugins',
    description:
      'Curated plugins that add skills, commands and agents to every CLI in your harness.',
    icon: Puzzle,
  },
  community: {
    heading: 'Community skills',
    description:
      'Skills published on skills.sh, installed once and copied to each CLI by the harness.',
    icon: GraduationCap,
  },
  marketplaces: {
    heading: 'Marketplaces',
    description:
      'Plugin marketplaces hosted on GitHub. Review what a plugin writes before you install it.',
    icon: Package,
  },
};

/**
 * SkillSourceHostComponent — one skill source page (`/marketplace/skills/
 * ptah-plugins | community | marketplaces`, plan C9 `SkillSourceHost`).
 *
 * A {@link SourceBandComponent} (the page's only `<h1>`) above EXACTLY ONE
 * reused surface, chosen by the `source` input that the route's `data` binds
 * (Batch 17, `withComponentInputBinding`). Only the selected surface exists,
 * so a source page fires its own surface's reads and nothing else.
 *
 * ## After a change
 *
 * - Ptah plugins `saved`: the harness's desired state changed, so the badge
 *   re-reads a FRESH report (`skills-section.component.ts:140-143`), and the
 *   inventory is told (`notifyContentChanged` clears the `/command` cache and
 *   reloads only slices a page already loaded).
 * - skills.sh install / uninstall: `notifyContentChanged`.
 * - Marketplaces plugin install / uninstall: `notifyContentChanged`, at the
 *   moment the backend confirms the change.
 *
 * The enabled count and the harness badge render on the Ptah Plugins source
 * only: that is where the plugin configuration changes, and the other two
 * sources would otherwise fire a catalogue-independent `harness:health` read
 * of their own.
 */
@Component({
  selector: 'ptah-skill-source-host',
  standalone: true,
  imports: [
    LucideAngularModule,
    SourceBandComponent,
    SkillsSectionHeaderComponent,
    PluginCatalogPanelComponent,
    SkillShBrowserComponent,
    ExternalMarketplacesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-w-0 p-4',
    'data-testid': 'skill-source-host',
    '[attr.data-source]': 'source()',
  },
  template: `
    <div class="space-y-4">
      <ptah-source-band
        [layout]="bandLayout()"
        eyebrow="Skills & plugins"
        [heading]="band().heading"
        [description]="band().description"
      >
        <span
          band-mark
          class="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10"
          aria-hidden="true"
        >
          <lucide-angular [img]="band().icon" class="h-5 w-5 text-primary" />
        </span>
        @if (source() === 'ptah-plugins') {
          <ptah-skills-section-header band-actions />
        }
      </ptah-source-band>

      @switch (source()) {
        @case ('ptah-plugins') {
          <ptah-plugin-catalog-panel (saved)="onPluginsSaved()" />
        }
        @case ('community') {
          <ptah-skill-sh-browser
            (skillInstalled)="onContentChanged()"
            (skillUninstalled)="onContentChanged()"
          />
        }
        @case ('marketplaces') {
          <ptah-external-marketplaces
            (pluginInstalled)="onContentChanged()"
            (pluginUninstalled)="onContentChanged()"
          />
        }
      }
    </div>
  `,
})
export class SkillSourceHostComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly harness = inject(HarnessHealthStore);
  private readonly layout = inject(MarketplaceLayout);

  /** Which source this page shows. Bound from route `data.source`. */
  public readonly source = input.required<MarketplaceSkillSource>();

  protected readonly band = computed(() => SKILL_SOURCE_BANDS[this.source()]);

  /** The storefront band at wide, one tight row otherwise. */
  protected readonly bandLayout = computed(() =>
    this.layout.tier() === 'wide' ? 'storefront' : 'compact',
  );

  /**
   * Saving the plugin configuration changes the DESIRED harness, so the
   * badge's report is stale the moment this returns; the re-read asks for a
   * fresh pass so it cannot race the backend reconcile and redisplay the
   * pre-save answer. The enabled count needs no poke: the panel re-reads
   * `PluginCatalogService` before it emits `saved`.
   */
  protected onPluginsSaved(): void {
    this.inventory.notifyContentChanged();
    void this.harness.refresh({ refresh: true });
  }

  protected onContentChanged(): void {
    this.inventory.notifyContentChanged();
  }
}
