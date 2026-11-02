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
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import {
  CatalogCardComponent,
  CatalogCardSkeletonComponent,
  CatalogGridComponent,
  MonogramTileComponent,
  StorefrontPanelComponent,
  type CatalogCardBadge,
} from '@ptah-extension/ui';
import type {
  SkillShEntry,
  InstalledSkill,
  SkillDetectionResult,
} from '@ptah-extension/shared';
import { MARKETPLACE_RPC_TIMEOUTS } from './marketplace-rpc-timeouts';
import {
  InstallScopeFieldComponent,
  defaultInstallScope,
  effectiveInstallScope,
  installScopeButtonLabel,
  type InstallScopeChoice,
} from './install-scope-field.component';

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

/** The install panel id of one card: grid plus the skills.sh identity. */
function panelId(grid: SkillGrid, skill: SkillShEntry): string {
  return `${grid}:${skillKey(skill)}`;
}

/** Folder name of a workspace path, for a workspace without a display name. */
function lastPathSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
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
 * Which grid a card sits in. The same skill can be both recommended and
 * popular, so an open install panel is keyed by grid and skill.
 */
type SkillGrid = 'recommended' | 'results';

/** Scope badge text of an installed skill (design-spec §2). */
const SCOPE_BADGE_LABELS: Readonly<Record<InstalledSkill['scope'], string>> = {
  workspace: 'This workspace',
  global: 'All workspaces',
};

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
 * Install opens a storefront panel under the card (design-spec §2) holding
 * the shared install-scope field: This workspace by default, All workspaces
 * only as an explicit choice, and nothing selectable but All workspaces with
 * no folder open. The install sends the chosen `scope`. An installed card
 * shows its scope badge; "Make global" lives on the Installed page.
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
    StorefrontPanelComponent,
    InstallScopeFieldComponent,
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
                  [ngTemplateOutletContext]="{
                    $implicit: skill,
                    grid: 'recommended',
                  }"
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
                  [ngTemplateOutletContext]="{
                    $implicit: skill,
                    grid: 'results',
                  }"
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

    <!-- One result card, and its install panel spanning the grid row under
         it when open; shared by the recommended and the results grids. -->
    <ng-template #skillCard let-skill let-grid="grid">
      <ptah-catalog-card
        role="listitem"
        [heading]="skill.name"
        [description]="skill.description"
        [meta]="skill.meta"
        [badge]="isSkillInstalled(skill) ? installedBadge : null"
      >
        <ptah-monogram-tile card-mark [label]="skill.name" />
        <div card-actions>
          @if (installedRecord(skill); as record) {
            <span
              class="badge badge-outline badge-sm"
              [class.border-warning]="record.scope === 'global'"
              data-testid="skill-scope-badge"
              >{{ scopeBadgeLabel(record) }}</span
            >
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
              (click)="toggleInstallPanel(grid, skill)"
              type="button"
              [attr.aria-expanded]="isPanelOpen(grid, skill)"
              [attr.aria-label]="'Install ' + skill.name"
            >
              @if (installingSkillIds().has(skill.key)) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else if (isPanelOpen(grid, skill)) {
                Cancel
              } @else {
                Install
              }
            </button>
          }
        </div>
      </ptah-catalog-card>

      @if (isPanelOpen(grid, skill) && !isSkillInstalled(skill)) {
        <div role="listitem" class="col-span-full">
          <ptah-storefront-panel
            [heading]="'Install ' + skill.name"
            [subtitle]="skill.source"
          >
            <div class="space-y-3">
              <ptah-install-scope-field
                legend="Install to"
                itemKind="skill"
                [workspaceName]="workspaceName()"
                [disabled]="installingSkillIds().has(skill.key)"
                [(scope)]="scopeChoice"
              />
              <button
                class="btn btn-primary btn-sm"
                type="button"
                data-testid="skill-install-confirm"
                [disabled]="
                  installScope() === null || installingSkillIds().has(skill.key)
                "
                (click)="installSkill(skill)"
              >
                @if (installingSkillIds().has(skill.key)) {
                  <span class="loading loading-spinner loading-xs"></span>
                  Installing...
                } @else {
                  {{ primaryLabel() }}
                }
              </button>
            </div>
          </ptah-storefront-panel>
        </div>
      }
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
  private readonly appState = inject(AppStateManager);
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

  /** `{grid}:{skill key}` of the open install panel, or `null`. */
  readonly expandedPanel = signal<string | null>(null);

  /** The scope radios of the open panel; reset to the default per panel. */
  readonly scopeChoice = signal<InstallScopeChoice>(null);

  /** The open folder's name for the scope help, `null` with no folder open. */
  readonly workspaceName = computed<string | null>(() => {
    const info = this.appState.workspaceInfo();
    if (!info) return null;
    return info.name || lastPathSegment(info.path);
  });

  /** The scope an install would send; `null` keeps the install disabled. */
  readonly installScope = computed(() =>
    effectiveInstallScope(this.scopeChoice(), this.workspaceName() !== null),
  );

  /**
   * "Install to this workspace" / "Install to all workspaces". With nothing
   * chosen (no folder open) the disabled button keeps the workspace wording:
   * it names what the user cannot do yet, never a global install.
   */
  protected readonly primaryLabel = computed(() =>
    installScopeButtonLabel(this.installScope() ?? 'workspace'),
  );

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

  /** Open the install panel under this card, or close it when it is open. */
  toggleInstallPanel(grid: SkillGrid, skill: SkillShEntry): void {
    const id = panelId(grid, skill);
    if (this.expandedPanel() === id) {
      this.expandedPanel.set(null);
      return;
    }
    this.expandedPanel.set(id);
    this.scopeChoice.set(defaultInstallScope(this.workspaceName() !== null));
  }

  isPanelOpen(grid: SkillGrid, skill: SkillShEntry): boolean {
    return this.expandedPanel() === panelId(grid, skill);
  }

  /** Install with the panel's chosen scope; nothing is sent without one. */
  async installSkill(skill: SkillShEntry): Promise<void> {
    const scope = this.installScope();
    if (scope === null) return;
    // Keyed by `owner/repo@skill-id`, matching the template's `skill.key`. On
    // `skillId` alone, installing one `threejs` row lit the spinner and
    // disabled the button on every other repo's `threejs` too.
    const pendingKey = skillKey(skill);
    if (this.installingSkillIds().has(pendingKey)) return;

    this.addToSet(this.installingSkillIds, pendingKey);
    this.error.set(null);

    try {
      const result = await this.rpcService.call(
        'skillsSh:install',
        { source: skill.source, skillId: skill.skillId, scope },
        { timeout: MARKETPLACE_RPC_TIMEOUTS.SKILL_INSTALL_MS },
      );

      if (this.destroyed) return;

      if (result.isSuccess() && result.data.success) {
        this.expandedPanel.set(null);
        await this.loadInstalled();
        this.refreshInstalledStatus();
        this.skillInstalled.emit(skill);
      } else if (result.isSuccess()) {
        this.error.set(result.data.error || 'Install failed');
      } else {
        // An RPC-level failure (timeout, transport) used to clear the spinner
        // and say nothing.
        this.error.set(result.error || 'Install failed');
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
    return this.installedRecord(skill) !== undefined;
  }

  /** The installed record behind a result card, for its scope badge. */
  installedRecord(skill: SkillShEntry): InstalledSkill | undefined {
    return this.installedSkills().find(
      (installed) =>
        installed.name === skill.skillId || installed.name === skill.name,
    );
  }

  protected scopeBadgeLabel(record: InstalledSkill): string {
    return SCOPE_BADGE_LABELS[record.scope];
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
      const result = await this.rpcService.call(
        'skillsSh:search',
        { query },
        { timeout: MARKETPLACE_RPC_TIMEOUTS.SKILL_SEARCH_MS },
      );

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
      const result = await this.rpcService.call(
        'skillsSh:getPopular',
        {},
        { timeout: MARKETPLACE_RPC_TIMEOUTS.SKILL_POPULAR_MS },
      );

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
