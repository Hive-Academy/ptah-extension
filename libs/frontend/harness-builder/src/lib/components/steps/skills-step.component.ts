/**
 * SkillsStepComponent
 *
 * Step 3: Skill browser. Search bar at top, grid of skill cards with toggle
 * switches, and a "Create New Skill" inline form. Shows skill descriptions
 * on expand.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Wrench, Search, Plus, X } from 'lucide-angular';
import type { SkillSummary } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { ConfigCardComponent } from '../atoms/config-card.component';

@Component({
  selector: 'ptah-skills-step',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, ConfigCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold flex items-center gap-2">
          <lucide-angular
            [img]="WrenchIcon"
            class="w-5 h-5 text-primary"
            aria-hidden="true"
          />
          Browse Skills
        </h2>
        <p class="text-sm text-base-content/60 mt-1">
          Select skills to include or create new ones. Skills are optional.
        </p>
      </div>

      <!-- Search bar -->
      <div class="form-control">
        <div class="flex gap-2">
          <input
            type="text"
            class="input input-bordered flex-1"
            placeholder="Search skills..."
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            (keydown.enter)="searchSkills()"
            aria-label="Search skills"
          />
          <button
            class="btn btn-primary"
            (click)="searchSkills()"
            [disabled]="isSearching()"
            aria-label="Search"
          >
            @if (isSearching()) {
              <span class="loading loading-spinner loading-sm"></span>
            } @else {
              <lucide-angular
                [img]="SearchIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            }
          </button>
        </div>
      </div>

      <!-- Skills grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        @for (skill of displayedSkills(); track skill.id) {
          <ptah-config-card
            [title]="skill.name"
            [description]="skill.description"
            [enabled]="isSkillSelected(skill.id)"
            [badge]="skill.source"
            (toggled)="toggleSkill(skill.id, $event)"
          />
        }
      </div>

      @if (displayedSkills().length === 0) {
        <div class="text-center text-sm text-base-content/50 py-8">
          No skills found. Try a different search or create a new skill.
        </div>
      }

      <!-- Create New Skill -->
      <div class="divider text-xs text-base-content/40">Or Create New</div>

      @if (!showCreateForm()) {
        <button
          class="btn btn-outline btn-sm w-full gap-2"
          (click)="showCreateForm.set(true)"
        >
          <lucide-angular [img]="PlusIcon" class="w-4 h-4" aria-hidden="true" />
          Create New Skill
        </button>
      } @else {
        <div class="card bg-base-200 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-medium text-sm">New Skill</h3>
            <button
              class="btn btn-ghost btn-xs btn-circle"
              (click)="showCreateForm.set(false)"
              aria-label="Close create form"
            >
              <lucide-angular
                [img]="XIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </button>
          </div>

          <div class="form-control">
            <label class="label py-0" for="new-skill-name">
              <span class="label-text text-xs">Name</span>
            </label>
            <input
              id="new-skill-name"
              type="text"
              class="input input-bordered input-sm"
              placeholder="my-skill"
              [ngModel]="newSkillName()"
              (ngModelChange)="newSkillName.set($event)"
            />
          </div>

          <div class="form-control">
            <label class="label py-0" for="new-skill-desc">
              <span class="label-text text-xs">Description</span>
            </label>
            <input
              id="new-skill-desc"
              type="text"
              class="input input-bordered input-sm"
              placeholder="What does this skill do?"
              [ngModel]="newSkillDescription()"
              (ngModelChange)="newSkillDescription.set($event)"
            />
          </div>

          <div class="form-control">
            <label class="label py-0" for="new-skill-content">
              <span class="label-text text-xs">Content (Markdown)</span>
            </label>
            <textarea
              id="new-skill-content"
              class="textarea textarea-bordered textarea-sm h-24"
              placeholder="# Skill instructions..."
              [ngModel]="newSkillContent()"
              (ngModelChange)="newSkillContent.set($event)"
            ></textarea>
          </div>

          <button
            class="btn btn-primary btn-sm w-full"
            (click)="createSkill()"
            [disabled]="
              isCreating() ||
              !newSkillName().trim() ||
              !newSkillContent().trim()
            "
          >
            @if (isCreating()) {
              <span class="loading loading-spinner loading-sm"></span>
              Creating...
            } @else {
              Create Skill
            }
          </button>

          @if (createError()) {
            <div class="alert alert-error text-xs">
              <span>{{ createError() }}</span>
            </div>
          }
        </div>
      }

      <!-- Summary -->
      <div class="text-xs text-base-content/50 text-right">
        {{ selectedCount() }} skill(s) selected
      </div>
    </div>
  `,
})
export class SkillsStepComponent {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);

  // Icons
  protected readonly WrenchIcon = Wrench;
  protected readonly SearchIcon = Search;
  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;

  // Search state
  public readonly searchQuery = signal('');
  public readonly isSearching = signal(false);
  public readonly searchResults = signal<SkillSummary[] | null>(null);

  // Create form state
  public readonly showCreateForm = signal(false);
  public readonly isCreating = signal(false);
  public readonly createError = signal<string | null>(null);
  public readonly newSkillName = signal('');
  public readonly newSkillDescription = signal('');
  public readonly newSkillContent = signal('');

  public readonly selectedSkills = computed(
    () => this.state.config().skills?.selectedSkills ?? [],
  );

  public readonly selectedCount = computed(() => this.selectedSkills().length);

  /** Show search results if available, otherwise show all available skills */
  public readonly displayedSkills = computed(() => {
    return this.searchResults() ?? this.state.availableSkills();
  });

  public isSkillSelected(skillId: string): boolean {
    return this.selectedSkills().includes(skillId);
  }

  public toggleSkill(skillId: string, enabled: boolean): void {
    const current = [...this.selectedSkills()];
    if (enabled && !current.includes(skillId)) {
      current.push(skillId);
    } else if (!enabled) {
      const idx = current.indexOf(skillId);
      if (idx >= 0) current.splice(idx, 1);
    }
    this.state.updateSkills({
      selectedSkills: current,
      createdSkills: this.state.config().skills?.createdSkills ?? [],
    });
  }

  public async searchSkills(): Promise<void> {
    const query = this.searchQuery().trim();
    if (!query) {
      this.searchResults.set(null);
      return;
    }

    this.isSearching.set(true);
    try {
      const response = await this.rpc.searchSkills(query);
      this.searchResults.set(response.results);
    } catch {
      this.searchResults.set(null);
    } finally {
      this.isSearching.set(false);
    }
  }

  public async createSkill(): Promise<void> {
    if (this.isCreating()) return;

    this.isCreating.set(true);
    this.createError.set(null);

    try {
      const response = await this.rpc.createSkill({
        name: this.newSkillName().trim(),
        description: this.newSkillDescription().trim(),
        content: this.newSkillContent().trim(),
      });

      // Add to selected skills (using response.skillId) and created skills
      const currentSkills = this.state.config().skills;
      this.state.updateSkills({
        selectedSkills: [
          ...(currentSkills?.selectedSkills ?? []),
          response.skillId,
        ],
        createdSkills: [
          ...(currentSkills?.createdSkills ?? []),
          {
            name: this.newSkillName().trim(),
            description: this.newSkillDescription().trim(),
            content: this.newSkillContent().trim(),
          },
        ],
      });

      // Reset form
      this.newSkillName.set('');
      this.newSkillDescription.set('');
      this.newSkillContent.set('');
      this.showCreateForm.set(false);
    } catch (err) {
      this.createError.set(
        err instanceof Error ? err.message : 'Failed to create skill',
      );
    } finally {
      this.isCreating.set(false);
    }
  }
}
