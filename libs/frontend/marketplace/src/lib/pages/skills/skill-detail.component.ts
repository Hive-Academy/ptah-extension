import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CircleCheck,
  LucideAngularModule,
  Package,
  RefreshCw,
  TriangleAlert,
} from 'lucide-angular';
import type { PluginInfo } from '@ptah-extension/shared';
import {
  MarketplaceInventoryStore,
  type InventoryRemovalOutcome,
} from '../../data/marketplace-inventory.store';
import { decodeSkillRef } from '../../data/skill-ref';
import {
  harnessTargetLabel,
  harnessTargetNeedsAttention,
} from '../../harness/harness-health.model';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import { marketplaceRouteLink } from '../../shell/marketplace-route-url';
import { TargetMarksComponent } from '../../ui/target-marks.component';
import {
  SKILL_KIND_ICONS,
  SKILL_KIND_LABELS,
  SKILL_KIND_SLICE,
  findInstalledSkill,
  plural,
  type InstalledSkillMatch,
  type InstalledSkillSlices,
} from './installed-skill-rows';

/** What the detail body shows. */
type SkillDetailView = 'loading' | 'error' | 'not-found' | 'found';

/** One labelled fact in the detail's definition list. */
interface SkillFact {
  readonly label: string;
  readonly value: string;
  /** Render as `<code>` (paths, ids). */
  readonly code?: boolean;
}

/** One detected CLI in the harness summary. */
interface HarnessTargetView {
  readonly target: string;
  readonly label: string;
  readonly inSync: boolean;
}

/** `'core-tools'` → `'Core tools'`. */
function categoryLabel(category: PluginInfo['category']): string {
  const words = category.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The facts of one installed item, in display order. Only known facts. */
export function skillFacts(match: InstalledSkillMatch): readonly SkillFact[] {
  const facts: SkillFact[] = [
    { label: 'Kind', value: SKILL_KIND_LABELS[match.kind] },
    { label: 'Source', value: match.row.source },
  ];
  switch (match.kind) {
    case 'ptah-plugin':
      facts.push(
        { label: 'Category', value: categoryLabel(match.plugin.category) },
        {
          label: 'Contents',
          value: `${plural(match.plugin.skillCount, 'skill', 'skills')} · ${plural(
            match.plugin.commandCount,
            'command',
            'commands',
          )}`,
        },
        { label: 'Plugin id', value: match.plugin.id, code: true },
      );
      break;
    case 'community-skill':
      facts.push({ label: 'Path', value: match.skill.path, code: true });
      break;
    case 'marketplace-plugin': {
      const { installedVersion, version } = match.listing;
      if (installedVersion) {
        facts.push({ label: 'Installed version', value: installedVersion });
      }
      if (version && version !== installedVersion) {
        facts.push({ label: 'Latest version', value: version });
      }
      if (!installedVersion && !version) {
        facts.push({ label: 'Version', value: 'Not declared' });
      }
      facts.push(
        { label: 'Path in repository', value: match.listing.path, code: true },
        { label: 'Plugin id', value: match.listing.id, code: true },
      );
      break;
    }
  }
  return facts;
}

/**
 * SkillDetailComponent — the `:skillRef` child of `/marketplace/skills` (plan
 * C9 `SkillDetail`).
 *
 * Frame-agnostic: the installed page puts it in a drawer or a docked inspector
 * and titles the frame; this renders the body. It decodes the route
 * parameter with `skill-ref.ts` and resolves it against the shell-scoped
 * inventory, never with a read of its own beyond `ensure()` of the one slice
 * its kind lives in (a no-op when the page already loaded it).
 *
 * ## States
 *
 * - `loading`: the slice has not answered yet.
 * - `error`: the slice failed; Retry re-reads only that slice.
 * - `not-found`: a malformed ref, or a ref the loaded slice does not hold —
 *   including one that vanished when the inventory reloaded after a workspace
 *   switch (TASK_2026_540 item 6c) or a removal. A link leads back to the list.
 * - `found`: description, facts, the harness targets summary and actions.
 *
 * A match already on screen stays while its slice reloads, so a reload never
 * flashes the skeleton over a detail that is still valid.
 */
@Component({
  selector: 'ptah-skill-detail',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, TargetMarksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'skill-detail' },
  template: `
    @switch (view()) {
      @case ('loading') {
        <div class="space-y-3" aria-busy="true" data-testid="skill-detail-loading">
          <span class="sr-only">Loading…</span>
          <div class="skeleton h-4 w-3/5" aria-hidden="true"></div>
          <div class="skeleton h-3 w-full" aria-hidden="true"></div>
          <div class="skeleton h-3 w-4/5" aria-hidden="true"></div>
        </div>
      }
      @case ('error') {
        <div class="space-y-3" data-testid="skill-detail-error">
          <p class="text-sm text-error" role="alert">
            {{ sliceError() }}
          </p>
          <button
            type="button"
            class="btn btn-ghost btn-sm gap-1"
            data-testid="skill-detail-retry"
            (click)="retry()"
          >
            <lucide-angular [img]="RefreshIcon" class="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      }
      @case ('not-found') {
        <div class="space-y-3" data-testid="skill-detail-not-found">
          <h3 class="text-sm font-semibold text-base-content">Not found</h3>
          <p class="text-sm text-base-content-muted">
            This skill is not installed in this workspace, or the link is out
            of date.
          </p>
          <a class="btn btn-ghost btn-sm" [routerLink]="skillsLink"
            >Back to installed skills</a
          >
        </div>
      }
      @case ('found') {
        @if (match(); as item) {
          <div class="space-y-5">
            <div class="flex items-start gap-3">
              <span
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-base-300 bg-base-200"
                aria-hidden="true"
              >
                <lucide-angular [img]="kindIcon()" class="h-5 w-5 text-base-content-muted" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-xs text-base-content-muted">
                  {{ kindLabel() }} · {{ item.row.source }}
                </p>
                <p
                  class="mt-1 text-sm leading-relaxed text-base-content"
                  data-testid="skill-detail-description"
                >
                  {{ item.row.description ?? 'No description provided.' }}
                </p>
              </div>
            </div>

            @if (brokenIssues().length > 0) {
              <div
                class="rounded-lg border border-warning/40 bg-warning/10 p-3"
                role="status"
                data-testid="skill-detail-broken"
              >
                <p class="flex items-center gap-1.5 text-xs font-medium text-warning">
                  <lucide-angular [img]="WarningIcon" class="h-3.5 w-3.5" aria-hidden="true" />
                  Ptah could not read part of this plugin.
                </p>
                <ul class="mt-2 space-y-1 text-xs text-base-content-muted">
                  @for (issue of brokenIssues(); track issue.path) {
                    <li>
                      <code class="break-all">{{ issue.path }}</code> —
                      {{ issue.message }}
                    </li>
                  }
                </ul>
              </div>
            }

            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid="skill-detail-facts">
              @for (fact of facts(); track fact.label) {
                <dt class="text-base-content-muted">{{ fact.label }}</dt>
                <dd class="min-w-0 text-base-content" [attr.data-fact]="fact.label">
                  @if (fact.code) {
                    <code class="break-all text-xs">{{ fact.value }}</code>
                  } @else {
                    {{ fact.value }}
                  }
                </dd>
              }
            </dl>

            <section aria-labelledby="skill-detail-harness-heading" data-testid="skill-detail-harness">
              <h3
                id="skill-detail-harness-heading"
                class="text-xs font-semibold uppercase tracking-wider text-base-content-muted"
              >
                Harness targets
              </h3>
              <p class="mt-1 text-xs text-base-content-muted">
                The harness copies enabled skills to every CLI it detects in
                this workspace.
              </p>
              @if (!harnessChecked()) {
                <p class="mt-2 text-sm text-base-content-muted" data-testid="skill-detail-harness-unknown">
                  No harness pass has run for this workspace yet.
                </p>
              } @else if (harnessTargets().length === 0) {
                <p class="mt-2 text-sm text-base-content-muted" data-testid="skill-detail-harness-none">
                  No CLI tools detected in this workspace.
                </p>
              } @else {
                <div class="mt-2 flex flex-wrap items-center gap-3">
                  <ptah-target-marks [targets]="harnessTargets()" [maxVisible]="8" />
                  <p class="text-sm text-base-content" data-testid="skill-detail-harness-summary">
                    In sync on {{ inSyncCount() }} of {{ harnessTargets().length }} detected CLIs
                  </p>
                </div>
                @if (attentionTargets().length > 0) {
                  <p class="mt-2 flex items-center gap-1.5 text-xs text-warning" data-testid="skill-detail-harness-attention">
                    <lucide-angular [img]="WarningIcon" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Needs attention: {{ attentionTargets().join(', ') }}
                  </p>
                } @else {
                  <p class="mt-2 flex items-center gap-1.5 text-xs text-success">
                    <lucide-angular [img]="CheckIcon" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Every detected CLI is in sync.
                  </p>
                }
              }
            </section>

            @if (removalError(); as message) {
              <p class="text-xs text-error" role="alert" data-testid="skill-detail-removal-error">
                {{ message }}
              </p>
            }

            <div class="flex flex-wrap gap-2 border-t border-base-300 pt-4">
              @if (item.row.action === 'manage') {
                <a
                  class="btn btn-primary btn-sm"
                  data-testid="skill-detail-manage"
                  [routerLink]="pluginsLink"
                  >Manage in Ptah Plugins</a
                >
              } @else {
                <button
                  type="button"
                  class="btn btn-outline btn-error btn-sm"
                  data-testid="skill-detail-uninstall"
                  [disabled]="pending()"
                  (click)="uninstall()"
                >
                  {{ pending() ? 'Removing…' : 'Uninstall' }}
                </button>
              }
            </div>
          </div>
        }
      }
    }
  `,
})
export class SkillDetailComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly harness = inject(HarnessHealthStore);
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap, {
    requireSync: true,
  });

  protected readonly RefreshIcon = RefreshCw;
  protected readonly WarningIcon = TriangleAlert;
  protected readonly CheckIcon = CircleCheck;

  protected readonly skillsLink = marketplaceRouteLink({ page: 'skills' });
  protected readonly pluginsLink = marketplaceRouteLink({
    page: 'skills',
    source: 'ptah-plugins',
  });

  /** The decoded `:skillRef`, or `null` when it is malformed. */
  protected readonly ref = computed(() =>
    decodeSkillRef(this.params().get('skillRef')),
  );

  private readonly slices = computed<InstalledSkillSlices>(() => ({
    plugins: this.inventory.plugins(),
    community: this.inventory.community(),
    marketplaces: this.inventory.marketplaces(),
  }));

  /** The slice the ref's kind lives in. */
  private readonly slice = computed(() => {
    const ref = this.ref();
    return ref === null ? null : this.slices()[SKILL_KIND_SLICE[ref.kind]];
  });

  protected readonly match = computed(() => {
    const ref = this.ref();
    return ref === null ? null : findInstalledSkill(ref, this.slices());
  });

  protected readonly view = computed<SkillDetailView>(() => {
    const slice = this.slice();
    if (slice === null) return 'not-found';
    if (this.match() !== null) return 'found';
    switch (slice.state) {
      case 'idle':
      case 'loading':
        return 'loading';
      case 'error':
        return 'error';
      case 'ready':
        return 'not-found';
    }
  });

  protected readonly sliceError = computed(
    () => this.slice()?.error ?? 'Could not read this list.',
  );

  protected readonly kindLabel = computed(() => {
    const ref = this.ref();
    return ref === null ? '' : SKILL_KIND_LABELS[ref.kind];
  });

  protected readonly kindIcon = computed(() => {
    const ref = this.ref();
    return ref === null ? Package : SKILL_KIND_ICONS[ref.kind];
  });

  protected readonly facts = computed(() => {
    const match = this.match();
    return match === null ? [] : skillFacts(match);
  });

  protected readonly brokenIssues = computed(() => {
    const match = this.match();
    if (match?.kind !== 'ptah-plugin' || match.plugin.status !== 'broken') {
      return [];
    }
    return match.plugin.issues ?? [];
  });

  /** True once any harness report exists for this workspace. */
  protected readonly harnessChecked = computed(
    () => this.harness.health() !== null,
  );

  /** Detected CLIs only: an uninstalled CLI is not a gap. */
  protected readonly harnessTargets = computed<readonly HarnessTargetView[]>(
    () =>
      this.harness
        .targets()
        .filter((target) => target.detected)
        .map((target) => ({
          target: target.target,
          label: harnessTargetLabel(target.target),
          inSync: !harnessTargetNeedsAttention(target),
        })),
  );

  protected readonly inSyncCount = computed(
    () => this.harnessTargets().filter((target) => target.inSync).length,
  );

  protected readonly attentionTargets = computed(() =>
    this.harnessTargets()
      .filter((target) => !target.inSync)
      .map((target) => target.label),
  );

  /** The open item's removal is in flight (store-wide pending set). */
  protected readonly pending = computed(() => {
    const match = this.match();
    return match !== null && this.inventory.pendingIds().has(match.row.ref);
  });

  /** The last removal failure of the item on screen. */
  protected readonly removalError = signal<string | null>(null);

  private destroyed = false;

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });

    // Load the one slice this kind lives in. A no-op when it is not idle,
    // which it never is under the installed page.
    effect(() => {
      const ref = this.ref();
      if (ref === null) return;
      untracked(() => void this.inventory.ensure(SKILL_KIND_SLICE[ref.kind]));
    });

    // A different item on screen starts without the previous one's error.
    effect(() => {
      this.ref();
      untracked(() => this.removalError.set(null));
    });
  }

  protected retry(): void {
    const ref = this.ref();
    if (ref !== null) void this.inventory.retry(SKILL_KIND_SLICE[ref.kind]);
  }

  protected uninstall(): void {
    const match = this.match();
    if (match !== null) void this.runUninstall(match);
  }

  private async runUninstall(match: InstalledSkillMatch): Promise<void> {
    this.removalError.set(null);
    let outcome: InventoryRemovalOutcome;
    switch (match.kind) {
      case 'community-skill':
        outcome = await this.inventory.removeCommunitySkill(match.skill.name);
        break;
      case 'marketplace-plugin':
        outcome = await this.inventory.removeMarketplacePlugin(match.listing);
        break;
      case 'ptah-plugin':
        // Plugins are enabled and disabled on their source page, not removed.
        return;
    }
    if (this.destroyed) return;
    if (outcome.status === 'removed') {
      await this.router.navigate(this.skillsLink);
      return;
    }
    if (outcome.status === 'failed') {
      this.removalError.set(outcome.message);
    }
    // `refused: in-progress` — the button is already disabled; nothing to say.
  }
}
