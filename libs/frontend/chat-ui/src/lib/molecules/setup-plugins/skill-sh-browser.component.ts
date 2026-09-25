import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  input,
  OnInit,
  OnDestroy,
  DestroyRef,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule, Search } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  CatalogCardComponent,
  CatalogCardSkeletonComponent,
  CatalogGridComponent,
  MonogramTileComponent,
  type CatalogCardBadge,
} from '@ptah-extension/ui';
import type {
  SkillShEntry,
  InstalledSkill,
  SkillDetectionResult,
} from '@ptah-extension/shared';

/** SkillShEntry enriched with its card meta line for template use */
interface DisplaySkillEntry extends SkillShEntry {
  /** Card meta: the source repo, then the install count when there is one. */
  meta: readonly string[];
  /**
   * `@for` track key. skills.sh identifies a skill by BOTH halves of
   * `owner/repo@skill-id` — the same slug (`threejs`, `remotion`) ships from
   * many owner repos, so `skillId` alone collides and Angular raises NG0955.
   */
  key: string;
}

/** The identity skills.sh actually keys a skill by. */
function skillKey(skill: SkillShEntry): string {
  return `${skill.source}@${skill.skillId}`;
}

function formatInstallCount(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
  return count.toString();
}

/** Card meta for one entry; the install count only when skills.sh has one. */
function skillMeta(skill: SkillShEntry): readonly string[] {
  return skill.installs > 0
    ? [skill.source, `${formatInstallCount(skill.installs)} installs`]
    : [skill.source];
}

const INSTALLED_BADGE: CatalogCardBadge = {
  label: 'Installed',
  tone: 'success',
};

/** Loading tiles per grid: fills one row at every column count but the widest. */
const SKELETON_SLOTS = [1, 2, 3] as const;

/**
 * SkillShBrowserComponent - Browse, search and install skills from skills.sh
 *
 * Discovery only: browse, search and install. The user's installed skills are
 * listed by the marketplace's Installed page; this view reads
 * `skillsSh:listInstalled` only to badge results as Installed and offer Remove.
 *
 * Results render as storefront catalog cards (`ptah-catalog-grid`), each with
 * an artwork-free monogram tile — skills.sh entries have no vendor brand.
 *
 * Patterns: Signal-based state, debounced search
 */
@Component({
  selector: 'ptah-skill-sh-browser',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    LucideAngularModule,
    CatalogCardComponent,
    CatalogCardSkeletonComponent,
    CatalogGridComponent,
    MonogramTileComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <!-- Search Input -->
      <div class="relative">
        <span
          class="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 text-base-content-muted"
          aria-hidden="true"
        >
          <lucide-angular [img]="SearchIcon" class="w-3.5 h-3.5" />
        </span>
        <input
          type="search"
          class="input input-bordered input-sm w-full pl-8 text-xs"
          placeholder="Search skills..."
          [value]="searchQuery()"
          (input)="onSearchInput($event)"
          aria-label="Search skills"
        />
        @if (isSearching()) {
          <span
            class="loading loading-spinner loading-xs absolute right-2.5 top-1/2 -translate-y-1/2"
          ></span>
        }
      </div>

      <!-- Error -->
      @if (error()) {
        <div class="alert alert-error alert-sm py-1 px-2" role="alert">
          <span class="text-xs">{{ error() }}</span>
          <button
            class="btn btn-ghost btn-xs"
            (click)="error.set(null)"
            type="button"
          >
            Dismiss
          </button>
        </div>
      }

      <!-- Recommendations -->
      @if (!searchQuery()) {
        @if (isLoadingRecommendations()) {
          <section aria-busy="true">
            <h2 [class]="sectionHeadingClass">Recommended for your project</h2>
            <ptah-catalog-grid ariaLabel="Recommended skills loading">
              @for (slot of skeletonSlots; track slot) {
                <ptah-catalog-card-skeleton role="listitem" />
              }
            </ptah-catalog-grid>
          </section>
        } @else if (recommendedDisplaySkills().length) {
          <section>
            <h2 [class]="sectionHeadingClass">Recommended for your project</h2>
            <ptah-catalog-grid ariaLabel="Recommended skills">
              @for (skill of recommendedDisplaySkills(); track skill.key) {
                <ng-container
                  [ngTemplateOutlet]="skillCard"
                  [ngTemplateOutletContext]="{ $implicit: skill }"
                />
              }
            </ptah-catalog-grid>
          </section>
        }
      }

      <!-- Popular / Search Results -->
      @if (isLoadingPopular() && !searchQuery()) {
        <section aria-busy="true">
          <ptah-catalog-grid ariaLabel="Popular skills loading">
            @for (slot of skeletonSlots; track slot) {
              <ptah-catalog-card-skeleton role="listitem" />
            }
          </ptah-catalog-grid>
        </section>
      } @else {
        <section>
          <h2 [class]="sectionHeadingClass">
            {{ resultsHeading() }}
          </h2>
          @if (displaySkills().length === 0) {
            <div class="text-xs text-base-content-muted text-center py-4">
              {{
                searchQuery()
                  ? 'No skills found for "' + searchQuery() + '"'
                  : 'No skills available'
              }}
            </div>
          } @else {
            <ptah-catalog-grid [ariaLabel]="resultsHeading()">
              @for (skill of displaySkills(); track skill.key) {
                <ng-container
                  [ngTemplateOutlet]="skillCard"
                  [ngTemplateOutletContext]="{ $implicit: skill }"
                />
              }
            </ptah-catalog-grid>
          }
        </section>
      }

      <!-- skills.sh attribution -->
      <div class="text-[10px] text-base-content-muted text-center pt-1">
        Powered by
        <a
          href="https://skills.sh"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-hover"
          >skills.sh</a
        >
        &#8212; the open agent skills ecosystem
      </div>
    </div>

    <!-- One result card; shared by the recommended and the results grids. -->
    <ng-template #skillCard let-skill>
      <ptah-catalog-card
        role="listitem"
        [heading]="skill.name"
        [description]="skill.description"
        [meta]="skill.meta"
        [badge]="isSkillInstalled(skill) ? installedBadge : null"
      >
        <ptah-monogram-tile card-mark [label]="skill.name" />
        <div card-actions>
          @if (isSkillInstalled(skill)) {
            <button
              class="btn btn-ghost btn-sm text-error"
              [disabled]="uninstallingSkillIds().has(skill.key)"
              (click)="uninstallSkill(skill)"
              type="button"
              [attr.aria-label]="'Remove ' + skill.name"
            >
              @if (uninstallingSkillIds().has(skill.key)) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                Remove
              }
            </button>
          } @else {
            <button
              class="btn btn-primary btn-sm"
              [disabled]="installingSkillIds().has(skill.key)"
              (click)="installSkill(skill)"
              type="button"
              [attr.aria-label]="'Install ' + skill.name"
            >
              @if (installingSkillIds().has(skill.key)) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                Install
              }
            </button>
          }
        </div>
      </ptah-catalog-card>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class SkillShBrowserComponent implements OnInit, OnDestroy {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  /**
   * Increment this input to re-read the installed skills list, so the
   * Installed badges follow plugin configuration changes (skills added or
   * removed via the harness reconciler) without a full page reload.
   */
  readonly refreshTrigger = input(0);

  /** Emitted when a skill is successfully installed */
  readonly skillInstalled = output<SkillShEntry>();
  /** Emitted when a skill is successfully uninstalled */
  readonly skillUninstalled = output<string>();

  /** Lucide icon references */
  protected readonly SearchIcon = Search;
  protected readonly installedBadge = INSTALLED_BADGE;
  protected readonly skeletonSlots = SKELETON_SLOTS;
  protected readonly sectionHeadingClass =
    'text-[11px] text-base-content-muted uppercase tracking-wide mb-1.5 font-medium';

  readonly searchQuery = signal('');
  readonly searchResults = signal<DisplaySkillEntry[]>([]);
  readonly installedSkills = signal<InstalledSkill[]>([]);
  readonly popularSkills = signal<DisplaySkillEntry[]>([]);
  readonly recommendations = signal<SkillDetectionResult | null>(null);
  readonly isSearching = signal(false);
  readonly isLoadingPopular = signal(false);
  readonly isLoadingRecommendations = signal(false);
  readonly installingSkillIds = signal<Set<string>>(new Set());
  readonly uninstallingSkillIds = signal<Set<string>>(new Set());
  readonly error = signal<string | null>(null);

  readonly displaySkills = computed(() =>
    this.searchQuery() ? this.searchResults() : this.popularSkills(),
  );

  protected readonly resultsHeading = computed(() =>
    this.searchQuery() ? 'Search Results' : 'Popular Skills',
  );

  /** Recommended skills, de-duplicated and pre-enriched with card meta */
  readonly recommendedDisplaySkills = computed<DisplaySkillEntry[]>(() => {
    const recs = this.recommendations()?.recommendedSkills;
    if (!recs) return [];
    const seen = new Set<string>();
    const entries: DisplaySkillEntry[] = [];
    for (const s of recs) {
      const key = skillKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ ...s, key, meta: skillMeta(s) });
    }
    return entries;
  });

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Re-load installed skills when refreshTrigger changes (skips initial value of 0) */
  private readonly refreshEffect = effect(() => {
    const trigger = this.refreshTrigger();
    if (trigger > 0) {
      this.loadInstalled();
    }
  });

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
    this.loadInstalled();
    this.loadPopular();
    this.loadRecommendations();
  }

  ngOnDestroy(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
  }

  onSearchInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.searchQuery.set(query);

    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    if (!query.trim()) {
      this.searchResults.set([]);
      this.isSearching.set(false);
      return;
    }

    this.isSearching.set(true);
    this.searchTimeout = setTimeout(() => this.performSearch(query), 300);
  }

  async installSkill(skill: SkillShEntry): Promise<void> {
    // Keyed by `owner/repo@skill-id`, matching the template's `skill.key`. On
    // `skillId` alone, installing one `threejs` row lit the spinner and
    // disabled the button on every other repo's `threejs` too.
    const pendingKey = skillKey(skill);
    if (this.installingSkillIds().has(pendingKey)) return;

    this.addToSet(this.installingSkillIds, pendingKey);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('skillsSh:install', {
        source: skill.source,
        skillId: skill.skillId,
      });

      if (this.destroyed) return;

      if (result.isSuccess() && result.data.success) {
        await this.loadInstalled();
        this.refreshInstalledStatus();
        this.skillInstalled.emit(skill);
      } else if (result.isSuccess() && !result.data.success) {
        this.error.set(result.data.error || 'Install failed');
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Install failed — is npx available?');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.installingSkillIds, pendingKey);
    }
  }

  async uninstallSkill(skill: SkillShEntry): Promise<void> {
    const pendingKey = skillKey(skill);
    if (this.uninstallingSkillIds().has(pendingKey)) return;

    this.addToSet(this.uninstallingSkillIds, pendingKey);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('skillsSh:uninstall', {
        name: skill.skillId,
      });

      if (this.destroyed) return;

      if (result.isSuccess() && result.data.success) {
        await this.loadInstalled();
        this.refreshInstalledStatus();
        this.skillUninstalled.emit(skill.skillId);
      } else if (result.isSuccess() && !result.data.success) {
        this.error.set(result.data.error || 'Uninstall failed');
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Uninstall failed');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.uninstallingSkillIds, pendingKey);
    }
  }

  isSkillInstalled(skill: SkillShEntry): boolean {
    return this.installedSkills().some(
      (installed) =>
        installed.name === skill.skillId || installed.name === skill.name,
    );
  }

  /**
   * Stamp display fields onto raw entries and drop exact repeats.
   *
   * The dedupe is not belt-and-braces: search and popular both come back from
   * an upstream API that can list the same `owner/repo@skill-id` twice, and a
   * repeated track key is an NG0955 whichever half produced it.
   */
  private withDisplayFields(skills: SkillShEntry[]): DisplaySkillEntry[] {
    const installed = this.installedSkills();
    const seen = new Set<string>();
    const entries: DisplaySkillEntry[] = [];
    for (const s of skills) {
      const key = skillKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        ...s,
        key,
        isInstalled: installed.some(
          (i) => i.name === s.skillId || i.name === s.name,
        ),
        meta: skillMeta(s),
      });
    }
    return entries;
  }

  private async performSearch(query: string): Promise<void> {
    this.error.set(null);

    try {
      const result = await this.rpcService.call('skillsSh:search', { query });

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.searchResults.set(this.withDisplayFields(result.data.skills));
      } else {
        this.error.set('Search failed');
        this.searchResults.set([]);
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Search failed');
      this.searchResults.set([]);
    } finally {
      if (!this.destroyed) this.isSearching.set(false);
    }
  }

  /** Feeds the Installed badges only; a failed read leaves the last list. */
  private async loadInstalled(): Promise<void> {
    try {
      const result = await this.rpcService.call('skillsSh:listInstalled', {});

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.installedSkills.set(result.data.skills);
      }
    } catch {
      // Badges keep their previous state; browse and install still work.
    }
  }

  private async loadPopular(): Promise<void> {
    this.isLoadingPopular.set(true);

    try {
      const result = await this.rpcService.call('skillsSh:getPopular', {});

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.popularSkills.set(this.withDisplayFields(result.data.skills));
      }
    } catch {
      if (this.destroyed) return;
    } finally {
      if (!this.destroyed) this.isLoadingPopular.set(false);
    }
  }

  private async loadRecommendations(): Promise<void> {
    this.isLoadingRecommendations.set(true);

    try {
      const result = await this.rpcService.call(
        'skillsSh:detectRecommended',
        {},
      );

      if (this.destroyed) return;

      if (result.isSuccess() && result.data) {
        this.recommendations.set(result.data);
      }
    } catch {
      if (this.destroyed) return;
    } finally {
      if (!this.destroyed) this.isLoadingRecommendations.set(false);
    }
  }

  private refreshInstalledStatus(): void {
    this.popularSkills.set(this.withDisplayFields(this.popularSkills()));

    if (this.searchQuery()) {
      this.searchResults.set(this.withDisplayFields(this.searchResults()));
    }
  }

  private addToSet(
    sig: ReturnType<typeof signal<Set<string>>>,
    value: string,
  ): void {
    sig.update((s) => new Set([...s, value]));
  }

  private removeFromSet(
    sig: ReturnType<typeof signal<Set<string>>>,
    value: string,
  ): void {
    sig.update((s) => {
      const next = new Set(s);
      next.delete(value);
      return next;
    });
  }
}
