import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  Atom,
  Layers,
  Layout,
  LucideAngularModule,
  LucideIconData,
  Server,
} from 'lucide-angular';
import { PROJECT_TYPES, type NewProjectType } from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * Icon mapping for project types.
 * Maps the icon string from PROJECT_TYPES to lucide-angular icon data.
 */
const ICON_MAP: Record<string, LucideIconData> = {
  Layers: Layers,
  Server: Server,
  Layout: Layout,
  Atom: Atom,
};

/**
 * CSS color classes for project type cards.
 */
const COLOR_MAP: Record<string, string> = {
  'full-saas': 'primary',
  'nestjs-api': 'secondary',
  'angular-app': 'accent',
  'react-app': 'info',
};

/**
 * ProjectTypeSelectionComponent - 2x2 grid for selecting a new project type
 *
 * Purpose:
 * - Display available project types as selectable cards
 * - Show icon, label, description, and tech stack badges for each type
 * - On selection, fetch question groups via RPC and navigate to discovery step
 *
 * Usage:
 * ```html
 * <ptah-project-type-selection />
 * ```
 */
@Component({
  selector: 'ptah-project-type-selection',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fadeIn {
        animation: fadeIn 0.6s ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-fadeIn {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div class="h-full flex flex-col items-center justify-center px-3 py-4">
      <div class="animate-fadeIn text-center w-full max-w-2xl">
        <h1 class="text-base font-semibold mb-2">
          What kind of project are you building?
        </h1>
        <p class="text-xs text-base-content/70 mb-6">
          Choose a project type to get started. We'll ask a few questions to
          generate a tailored project plan with architecture, directory
          structure, and implementation phases.
        </p>

        <!-- Project Type Cards Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 text-left">
          @for (projectType of projectTypes; track projectType.id) {
            <button
              class="border rounded-lg p-4 transition-all text-left w-full
                     hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              [class.border-primary]="selectedType() === projectType.id"
              [class.bg-primary/5]="selectedType() === projectType.id"
              [class.border-base-300]="selectedType() !== projectType.id"
              [class.bg-base-200/50]="selectedType() !== projectType.id"
              [class.hover:border-primary/40]="
                selectedType() !== projectType.id
              "
              [disabled]="isLoading()"
              (click)="onSelectType(projectType.id)"
              [attr.aria-pressed]="selectedType() === projectType.id"
              [attr.aria-label]="'Select ' + projectType.label"
            >
              <div class="flex items-start gap-3">
                <div
                  class="rounded-lg p-2 shrink-0"
                  [class]="'bg-' + getColor(projectType.id) + '/10'"
                >
                  <lucide-angular
                    [img]="getIcon(projectType.icon)"
                    class="w-5 h-5"
                    [class]="'text-' + getColor(projectType.id)"
                    aria-hidden="true"
                  />
                </div>
                <div class="min-w-0">
                  <h3 class="font-medium text-sm mb-1">
                    {{ projectType.label }}
                  </h3>
                  <p class="text-xs text-base-content/60 mb-2">
                    {{ projectType.description }}
                  </p>
                  <div class="flex flex-wrap gap-1">
                    @for (tech of projectType.techStack; track tech) {
                      <span class="badge badge-xs badge-ghost">{{ tech }}</span>
                    }
                  </div>
                </div>
              </div>
            </button>
          }
        </div>

        <!-- Loading indicator -->
        @if (isLoading()) {
          <div class="flex items-center justify-center gap-2 mb-4">
            <span
              class="loading loading-spinner loading-sm text-primary"
            ></span>
            <span class="text-xs text-base-content/60"
              >Loading questions...</span
            >
          </div>
        }

        <!-- Error state -->
        @if (errorMessage()) {
          <div class="alert alert-error text-xs mb-4">
            <span>{{ errorMessage() }}</span>
            <button class="btn btn-ghost btn-xs" (click)="retrySelection()">
              Retry
            </button>
          </div>
        }

        <!-- Back button -->
        <button
          class="btn btn-ghost btn-sm"
          (click)="onBack()"
          [disabled]="isLoading()"
        >
          Back to Welcome
        </button>
      </div>
    </div>
  `,
})
export class ProjectTypeSelectionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  protected readonly projectTypes = PROJECT_TYPES;
  protected readonly selectedType = signal<NewProjectType | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Get lucide icon data for a project type icon string.
   */
  protected getIcon(iconName: string): LucideIconData {
    return ICON_MAP[iconName] ?? Layers;
  }

  /**
   * Get DaisyUI color class for a project type.
   */
  protected getColor(typeId: string): string {
    return COLOR_MAP[typeId] ?? 'primary';
  }

  /**
   * Handle project type card click.
   * Sets the type in state, fetches question groups via RPC, and navigates to discovery.
   */
  protected async onSelectType(typeId: NewProjectType): Promise<void> {
    this.selectedType.set(typeId);
    this.errorMessage.set(null);
    this.isLoading.set(true);

    try {
      this.wizardState.setNewProjectType(typeId);
      const groups = await this.wizardRpc.selectNewProjectType(typeId);
      this.wizardState.setQuestionGroups(groups);
      this.wizardState.setCurrentStep('discovery');
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to load questions',
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Retry selection after an error.
   */
  protected retrySelection(): void {
    const type = this.selectedType();
    if (type) {
      this.onSelectType(type);
    }
  }

  /**
   * Navigate back to the welcome step.
   */
  protected onBack(): void {
    this.wizardState.setWizardPath(null);
    this.wizardState.setCurrentStep('welcome');
  }
}
