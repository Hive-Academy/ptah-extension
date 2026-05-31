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
import {
  LucideAngularModule,
  Search,
  Check,
  KeyRound,
  X,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  SkillShEntry,
  InstalledSkill,
  SkillDetectionResult,
} from '@ptah-extension/shared';

/** SkillShEntry enriched with pre-formatted install count for template use */
interface DisplaySkillEntry extends SkillShEntry {
  formattedInstalls: string;
}

/**
 * SkillShBrowserComponent - Browse, search, install, and manage skills from skills.sh
 *
 * Patterns: Signal-based state, DaisyUI compact styling, debounced search
 */
@Component({
  selector: 'ptah-skill-sh-browser',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (keyStatus() === 'not-configured' && !bannerDismissed()) {
        <div
          class="rounded-lg border border-base-300 bg-base-200/40 p-2.5 space-y-2"
        >
          @if (!showKeyForm()) {
            <div class="flex items-center gap-2">
              <div
                class="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0"
              >
                <lucide-angular
                  [img]="KeyRoundIcon"
                  class="w-3 h-3 text-primary"
                  aria-hidden="true"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-base-content">
                  Add a skills.sh API key
                </div>
                <p class="text-[10px] text-base-content/50 leading-tight">
                  Get richer descriptions and live popularity rankings. Without
                  a key, results come from the local
                  <code>npx skills</code> CLI.
                </p>
              </div>
              <button
                type="button"
                class="btn btn-primary btn-xs shrink-0"
                (click)="showKeyForm.set(true)"
              >
                Connect
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square shrink-0"
                (click)="bannerDismissed.set(true)"
                aria-label="Dismiss"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              </button>
            </div>
          } @else {
            @if (keyError()) {
              <div class="alert alert-error alert-sm py-1 px-2">
                <span class="text-xs">{{ keyError() }}</span>
              </div>
            }
            <form class="space-y-2" (submit)="saveKey($event)">
              <input
                type="password"
                autocomplete="off"
                class="input input-bordered input-sm w-full text-xs"
                placeholder="skills.sh API key (sk_live_...)"
                [value]="keyInput()"
                (input)="onKeyInput($event)"
                aria-label="skills.sh API key"
              />
              <div class="flex gap-1.5">
                <button
                  type="submit"
                  class="btn btn-primary btn-xs flex-1"
                  [disabled]="isSavingKey() || keyInput().trim().length === 0"
                >
                  @if (isSavingKey()) {
                    <span class="loading loading-spinner loading-xs"></span>
                    Connecting...
                  } @else {
                    Save
                  }
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  (click)="cancelKeyForm()"
                >
                  Cancel
                </button>
              </div>
            </form>
            <p class="text-[10px] text-base-content/40 text-center">
              Stored encrypted in your OS keychain. Request a key at
              <a href="mailto:skills-api@vercel.com" class="link link-hover"
                >skills-api&#64;vercel.com</a
              >.
            </p>
          }
        </div>
      } @else if (keyStatus() === 'configured') {
        <div
          class="flex items-center justify-between px-2 py-1 rounded-md bg-success/10 border border-success/20"
        >
          <div class="flex items-center gap-1.5 text-[11px] text-success">
            <lucide-angular
              [img]="CheckIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            <span>skills.sh API connected</span>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-xs text-[10px]"
            [disabled]="isRemovingKey()"
            (click)="removeKey()"
          >
            @if (isRemovingKey()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              Remove key
            }
          </button>
        </div>
      }

      <!-- View Toggle -->
      <div class="tabs tabs-boxed tabs-xs bg-base-300/50 p-0.5">
        <button
          class="tab tab-xs"
          [class.tab-active]="activeView() === 'browse'"
          (click)="activeView.set('browse')"
          type="button"
        >
          Browse
        </button>
        <button
          class="tab tab-xs"
          [class.tab-active]="activeView() === 'installed'"
          (click)="activeView.set('installed')"
          type="button"
        >
          Installed ({{ installedCount() }})
        </button>
      </div>

      <!-- ===== Browse View ===== -->
      @if (activeView() === 'browse') {
        <!-- Search Input -->
        <div class="relative">
          <lucide-angular
            [img]="SearchIcon"
            class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40"
            aria-hidden="true"
          />
          <input
            type="text"
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
          <div class="alert alert-error alert-sm py-1 px-2">
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
        @if (isLoadingRecommendations() && !searchQuery()) {
          <div>
            <div
              class="text-[11px] text-base-content/50 uppercase tracking-wide mb-1.5 font-medium"
            >
              Recommended for your project
            </div>
            <div class="skeleton h-16 w-full rounded-lg"></div>
          </div>
        } @else if (
          !searchQuery() && recommendations()?.recommendedSkills?.length
        ) {
          <div>
            <div
              class="text-[11px] text-base-content/50 uppercase tracking-wide mb-1.5 font-medium"
            >
              Recommended for your project
            </div>
            <div class="space-y-1.5">
              @for (skill of recommendedDisplaySkills(); track skill.skillId) {
                <div
                  class="flex items-start gap-2 p-2 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-xs font-medium text-base-content">{{
                        skill.name
                      }}</span>
                      @if (skill.installs > 0) {
                        <span class="badge badge-xs badge-ghost text-[10px]">{{
                          skill.formattedInstalls
                        }}</span>
                      }
                      @if (isSkillInstalled(skill)) {
                        <span
                          class="badge badge-xs badge-success text-[10px] gap-0.5"
                        >
                          <lucide-angular
                            [img]="CheckIcon"
                            class="w-2 h-2"
                            aria-hidden="true"
                          />
                          Installed
                        </span>
                      }
                    </div>
                    <p
                      class="text-[11px] text-base-content/60 leading-relaxed line-clamp-2 mt-0.5"
                    >
                      {{ skill.description }}
                    </p>
                    <span class="text-[10px] text-base-content/40 font-mono"
                      >{{ skill.source }}/{{ skill.skillId }}</span
                    >
                  </div>
                  <div class="shrink-0">
                    @if (isSkillInstalled(skill)) {
                      <button
                        class="btn btn-ghost btn-xs text-error"
                        [disabled]="uninstallingSkillIds().has(skill.skillId)"
                        (click)="uninstallSkill(skill)"
                        type="button"
                        [attr.aria-label]="'Remove ' + skill.name"
                      >
                        @if (uninstallingSkillIds().has(skill.skillId)) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else {
                          Remove
                        }
                      </button>
                    } @else {
                      <button
                        class="btn btn-primary btn-xs"
                        [disabled]="installingSkillIds().has(skill.skillId)"
                        (click)="installSkill(skill)"
                        type="button"
                        [attr.aria-label]="'Install ' + skill.name"
                      >
                        @if (installingSkillIds().has(skill.skillId)) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else {
                          Install
                        }
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Popular / Search Results -->
        <div>
          @if (isLoadingPopular() && !searchQuery()) {
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <div class="skeleton h-16 w-full rounded-lg mb-1.5"></div>
            }
          } @else {
            <div
              class="text-[11px] text-base-content/50 uppercase tracking-wide mb-1.5 font-medium"
            >
              {{ searchQuery() ? 'Search Results' : 'Popular Skills' }}
            </div>
            @if (displaySkills().length === 0) {
              <div class="text-xs text-base-content/50 text-center py-4">
                {{
                  searchQuery()
                    ? 'No skills found for "' + searchQuery() + '"'
                    : 'No skills available'
                }}
              </div>
            }
            <div class="space-y-1.5">
              @for (skill of displaySkills(); track skill.skillId) {
                <div
                  class="flex items-start gap-2 p-2 rounded-lg border border-base-300 bg-base-200/30 hover:bg-base-200/60 transition-colors"
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-xs font-medium text-base-content">{{
                        skill.name
                      }}</span>
                      @if (skill.installs > 0) {
                        <span class="badge badge-xs badge-ghost text-[10px]">{{
                          skill.formattedInstalls
                        }}</span>
                      }
                      @if (isSkillInstalled(skill)) {
                        <span
                          class="badge badge-xs badge-success text-[10px] gap-0.5"
                        >
                          <lucide-angular
                            [img]="CheckIcon"
                            class="w-2 h-2"
                            aria-hidden="true"
                          />
                          Installed
                        </span>
                      }
                    </div>
                    <p
                      class="text-[11px] text-base-content/60 leading-relaxed line-clamp-2 mt-0.5"
                    >
                      {{ skill.description }}
                    </p>
                    <span class="text-[10px] text-base-content/40 font-mono"
                      >{{ skill.source }}/{{ skill.skillId }}</span
                    >
                  </div>
                  <div class="shrink-0">
                    @if (isSkillInstalled(skill)) {
                      <button
                        class="btn btn-ghost btn-xs text-error"
                        [disabled]="uninstallingSkillIds().has(skill.skillId)"
                        (click)="uninstallSkill(skill)"
                        type="button"
                        [attr.aria-label]="'Remove ' + skill.name"
                      >
                        @if (uninstallingSkillIds().has(skill.skillId)) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else {
                          Remove
                        }
                      </button>
                    } @else {
                      <button
                        class="btn btn-primary btn-xs"
                        [disabled]="installingSkillIds().has(skill.skillId)"
                        (click)="installSkill(skill)"
                        type="button"
                        [attr.aria-label]="'Install ' + skill.name"
                      >
                        @if (installingSkillIds().has(skill.skillId)) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else {
                          Install
                        }
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ===== Installed View ===== -->
      @if (activeView() === 'installed') {
        @if (isLoadingInstalled()) {
          @for (i of [1, 2, 3]; track i) {
            <div class="skeleton h-14 w-full rounded-lg mb-1.5"></div>
          }
        } @else if (installedSkills().length === 0) {
          <div class="text-xs text-base-content/50 text-center py-6">
            <p class="mb-1">No skills installed yet</p>
            <button
              class="btn btn-ghost btn-xs"
              (click)="activeView.set('browse')"
              type="button"
            >
              Browse skills
            </button>
          </div>
        } @else {
          @if (projectSkills().length > 0) {
            <div
              class="text-[11px] text-base-content/50 uppercase tracking-wide mb-1.5 font-medium"
            >
              Project Skills
            </div>
            <div class="space-y-1.5">
              @for (skill of projectSkills(); track skill.path) {
                <div
                  class="flex items-start gap-2 p-2 rounded-lg border border-base-300 bg-base-200/30"
                >
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium">{{ skill.name }}</div>
                    @if (skill.agents.length) {
                      <div class="flex flex-wrap gap-1 mt-0.5">
                        @for (agent of skill.agents; track agent) {
                          <span
                            class="badge badge-xs badge-outline text-[9px]"
                            >{{ agent }}</span
                          >
                        }
                      </div>
                    }
                    <span class="text-[10px] text-base-content/40 font-mono">{{
                      skill.source
                    }}</span>
                  </div>
                  <button
                    class="btn btn-ghost btn-xs text-error shrink-0"
                    [disabled]="uninstallingSkillIds().has(skill.name)"
                    (click)="removeInstalledSkill(skill)"
                    type="button"
                    [attr.aria-label]="'Remove ' + skill.name"
                  >
                    @if (uninstallingSkillIds().has(skill.name)) {
                      <span class="loading loading-spinner loading-xs"></span>
                    } @else {
                      Remove
                    }
                  </button>
                </div>
              }
            </div>
          }
          @if (globalSkills().length > 0) {
            <div
              class="text-[11px] text-base-content/50 uppercase tracking-wide mb-1.5 font-medium mt-3"
            >
              Global Skills
            </div>
            <div class="space-y-1.5">
              @for (skill of globalSkills(); track skill.path) {
                <div
                  class="flex items-start gap-2 p-2 rounded-lg border border-base-300 bg-base-200/30"
                >
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium">{{ skill.name }}</div>
                    @if (skill.agents.length) {
                      <div class="flex flex-wrap gap-1 mt-0.5">
                        @for (agent of skill.agents; track agent) {
                          <span
                            class="badge badge-xs badge-outline text-[9px]"
                            >{{ agent }}</span
                          >
                        }
                      </div>
                    }
                    <span class="text-[10px] text-base-content/40 font-mono">{{
                      skill.source
                    }}</span>
                  </div>
                  <button
                    class="btn btn-ghost btn-xs text-error shrink-0"
                    [disabled]="uninstallingSkillIds().has(skill.name)"
                    (click)="removeInstalledSkill(skill)"
                    type="button"
                    [attr.aria-label]="'Remove ' + skill.name"
                  >
                    @if (uninstallingSkillIds().has(skill.name)) {
                      <span class="loading loading-spinner loading-xs"></span>
                    } @else {
                      Remove
                    }
                  </button>
                </div>
              }
            </div>
          }
        }
      }

      <!-- skills.sh attribution -->
      <div class="text-[10px] text-base-content/30 text-center pt-1">
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
   * Increment this input to trigger a reload of the installed skills list.
   * Used by the parent settings component when plugin configuration changes
   * (skills are added/removed via SkillJunctionService) so the Installed tab
   * reflects the current state without requiring a full page reload.
   */
  readonly refreshTrigger = input(0);

  /** Emitted when a skill is successfully installed */
  readonly skillInstalled = output<SkillShEntry>();
  /** Emitted when a skill is successfully uninstalled */
  readonly skillUninstalled = output<string>();

  /** Lucide icon references */
  protected readonly SearchIcon = Search;
  protected readonly CheckIcon = Check;
  protected readonly KeyRoundIcon = KeyRound;
  protected readonly XIcon = X;

  readonly searchQuery = signal('');
  readonly searchResults = signal<DisplaySkillEntry[]>([]);
  readonly installedSkills = signal<InstalledSkill[]>([]);
  readonly popularSkills = signal<DisplaySkillEntry[]>([]);
  readonly recommendations = signal<SkillDetectionResult | null>(null);
  readonly isSearching = signal(false);
  readonly isLoadingInstalled = signal(false);
  readonly isLoadingPopular = signal(false);
  readonly isLoadingRecommendations = signal(false);
  readonly installingSkillIds = signal<Set<string>>(new Set());
  readonly uninstallingSkillIds = signal<Set<string>>(new Set());
  readonly error = signal<string | null>(null);
  readonly activeView = signal<'browse' | 'installed'>('browse');

  readonly keyStatus = signal<'unknown' | 'configured' | 'not-configured'>(
    'unknown',
  );
  readonly showKeyForm = signal(false);
  readonly bannerDismissed = signal(false);
  readonly keyInput = signal('');
  readonly isSavingKey = signal(false);
  readonly isRemovingKey = signal(false);
  readonly keyError = signal<string | null>(null);

  readonly installedCount = computed(() => this.installedSkills().length);

  readonly displaySkills = computed(() =>
    this.searchQuery() ? this.searchResults() : this.popularSkills(),
  );

  /** Recommended skills pre-enriched with formatted installs */
  readonly recommendedDisplaySkills = computed<DisplaySkillEntry[]>(() => {
    const recs = this.recommendations()?.recommendedSkills;
    if (!recs) return [];
    return recs.map((s) => ({
      ...s,
      formattedInstalls: this.formatInstallCount(s.installs),
    }));
  });

  readonly projectSkills = computed(() =>
    this.installedSkills().filter((s) => s.scope === 'project'),
  );

  readonly globalSkills = computed(() =>
    this.installedSkills().filter((s) => s.scope === 'global'),
  );

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
    this.checkKeyStatus();
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
    if (this.installingSkillIds().has(skill.skillId)) return;

    this.addToSet(this.installingSkillIds, skill.skillId);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('skillsSh:install', {
        source: skill.source,
        skillId: skill.skillId,
        scope: 'project',
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
        this.removeFromSet(this.installingSkillIds, skill.skillId);
    }
  }

  async uninstallSkill(skill: SkillShEntry): Promise<void> {
    if (this.uninstallingSkillIds().has(skill.skillId)) return;

    this.addToSet(this.uninstallingSkillIds, skill.skillId);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('skillsSh:uninstall', {
        name: skill.skillId,
        scope: 'project',
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
        this.removeFromSet(this.uninstallingSkillIds, skill.skillId);
    }
  }

  async removeInstalledSkill(skill: InstalledSkill): Promise<void> {
    if (this.uninstallingSkillIds().has(skill.name)) return;

    this.addToSet(this.uninstallingSkillIds, skill.name);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('skillsSh:uninstall', {
        name: skill.name,
        scope: skill.scope,
      });

      if (this.destroyed) return;

      if (result.isSuccess() && result.data.success) {
        await this.loadInstalled();
        this.skillUninstalled.emit(skill.name);
      } else if (result.isSuccess() && !result.data.success) {
        this.error.set(result.data.error || 'Remove failed');
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Remove failed');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.uninstallingSkillIds, skill.name);
    }
  }

  onKeyInput(event: Event): void {
    this.keyInput.set((event.target as HTMLInputElement).value);
  }

  cancelKeyForm(): void {
    this.showKeyForm.set(false);
    this.keyInput.set('');
    this.keyError.set(null);
  }

  async saveKey(event: Event): Promise<void> {
    event.preventDefault();
    const apiKey = this.keyInput().trim();
    if (apiKey.length === 0 || this.isSavingKey()) return;

    this.isSavingKey.set(true);
    this.keyError.set(null);
    try {
      const result = await this.rpcService.call('skillsSh:setApiKey', {
        apiKey,
      });
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        this.keyInput.set('');
        this.showKeyForm.set(false);
        this.keyStatus.set('configured');
        this.loadPopular();
        this.loadRecommendations();
      } else {
        this.keyError.set(
          (result.isSuccess() ? '' : result.error) || 'Failed to save API key',
        );
      }
    } catch {
      if (this.destroyed) return;
      this.keyError.set('Failed to save API key');
    } finally {
      if (!this.destroyed) this.isSavingKey.set(false);
    }
  }

  async removeKey(): Promise<void> {
    if (this.isRemovingKey()) return;
    this.isRemovingKey.set(true);
    try {
      const result = await this.rpcService.call('skillsSh:deleteApiKey', {});
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        this.keyStatus.set('not-configured');
        this.bannerDismissed.set(false);
        this.loadPopular();
        this.loadRecommendations();
      }
    } catch {
      if (this.destroyed) return;
    } finally {
      if (!this.destroyed) this.isRemovingKey.set(false);
    }
  }

  private async checkKeyStatus(): Promise<void> {
    try {
      const result = await this.rpcService.call('skillsSh:getApiKeyStatus', {});
      if (this.destroyed) return;
      const configured = result.isSuccess() && result.data.configured === true;
      this.keyStatus.set(configured ? 'configured' : 'not-configured');
    } catch {
      if (this.destroyed) return;
      this.keyStatus.set('not-configured');
    }
  }

  isSkillInstalled(skill: SkillShEntry): boolean {
    return this.installedSkills().some(
      (installed) =>
        installed.name === skill.skillId || installed.name === skill.name,
    );
  }

  private formatInstallCount(count: number): string {
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
    return count.toString();
  }

  private enrichWithFormattedInstalls(
    skills: SkillShEntry[],
  ): DisplaySkillEntry[] {
    const installed = this.installedSkills();
    return skills.map((s) => ({
      ...s,
      isInstalled: installed.some(
        (i) => i.name === s.skillId || i.name === s.name,
      ),
      formattedInstalls: this.formatInstallCount(s.installs),
    }));
  }

  private async performSearch(query: string): Promise<void> {
    this.error.set(null);

    try {
      const result = await this.rpcService.call('skillsSh:search', { query });

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.searchResults.set(
          this.enrichWithFormattedInstalls(result.data.skills),
        );
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

  private async loadInstalled(): Promise<void> {
    this.isLoadingInstalled.set(true);

    try {
      const result = await this.rpcService.call('skillsSh:listInstalled', {});

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.installedSkills.set(result.data.skills);
      }
    } catch {
      if (this.destroyed) return;
    } finally {
      if (!this.destroyed) this.isLoadingInstalled.set(false);
    }
  }

  private async loadPopular(): Promise<void> {
    this.isLoadingPopular.set(true);

    try {
      const result = await this.rpcService.call('skillsSh:getPopular', {});

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.popularSkills.set(
          this.enrichWithFormattedInstalls(result.data.skills),
        );
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
    this.popularSkills.set(
      this.enrichWithFormattedInstalls(this.popularSkills()),
    );

    if (this.searchQuery()) {
      this.searchResults.set(
        this.enrichWithFormattedInstalls(this.searchResults()),
      );
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
