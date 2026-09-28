import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { PluginCatalogService } from '@ptah-extension/core';
import { HarnessHealthBadgeComponent } from '../../harness/harness-health-badge.component';

/**
 * SkillsSectionHeaderComponent — the Skills section's status strip (plan C9;
 * replaces the header of `skills-section.component.ts`): how many Ptah plugins
 * are enabled out of the catalogue, and the harness health badge.
 *
 * The badge is the only surface that says whether an enabled plugin actually
 * REACHED the CLI tools that read it (TASK_2026_278), so it sits beside the
 * plugin list rather than in the shell header. It stays on the installed
 * skills page on purpose: the Overview's harness "Review" link targets
 * `/marketplace/skills` (`needs-attention.component.ts`, Batch 10).
 *
 * This strip reads the root `PluginCatalogService` and never loads it: the
 * page that mounts it already ensured the catalogue (the installed page's
 * `plugins` slice, or the plugin panel on the Ptah Plugins source). Until a
 * read for the current workspace has landed, the count is left out rather
 * than shown as `0/0`. The badge makes its own cached `harness:health` read on
 * mount (`HarnessHealthBadgeComponent.ngOnInit`).
 */
@Component({
  selector: 'ptah-skills-section-header',
  standalone: true,
  imports: [HarnessHealthBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 flex-wrap items-center gap-3' },
  template: `
    @if (catalog.isLoaded()) {
      <p class="text-xs tabular-nums text-base-content-muted">
        <span aria-hidden="true" data-testid="skills-enabled-count"
          >{{ catalog.enabledCount() }}/{{ catalog.pluginTotal() }} enabled</span
        >
        <span class="sr-only">{{ enabledLabel() }}</span>
      </p>
    }
    <ptah-harness-health-badge />
  `,
})
export class SkillsSectionHeaderComponent {
  protected readonly catalog = inject(PluginCatalogService);

  /** "3 of 9 Ptah plugins enabled" — the slash reads badly in a screen reader. */
  protected readonly enabledLabel = computed(
    () =>
      `${this.catalog.enabledCount()} of ${this.catalog.pluginTotal()} Ptah plugins enabled`,
  );
}
