import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { AppStateManager, LoggingService } from '@ptah-extension/core';
import type { HarnessPreset } from '@ptah-extension/shared';
import { HarnessBuilderRecordsService } from '../../services/harness-builder-records.service';
import { HarnessProposalHydrationService } from '../../services/harness-proposal-hydration.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { commitBuilderUpdates, fullConfig } from './builder-sidebar-helpers';

@Component({
  selector: 'ptah-builder-presets-section',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (initialized()) {
      <section
        aria-labelledby="builder-presets-title"
        class="p-4 border-b border-surface-border"
      >
        <h3
          id="builder-presets-title"
          class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
        >
          Presets
        </h3>
        <p class="text-[11px] text-base-content-muted">
          {{ presets().length }} saved
        </p>
        @if (presets().length) {
          <label for="builder-preset" class="block mt-2 text-xs"
            >Start from a preset</label
          >
          <select
            #presetSelect
            id="builder-preset"
            class="select select-sm select-bordered w-full border-base-content/50"
            [value]="selectedPresetId()"
            (change)="selectedPresetId.set(presetSelect.value)"
          >
            <option value="">Choose a preset...</option>
            @for (preset of presets(); track preset.id) {
              <option [value]="preset.id">{{ preset.name }}</option>
            }
          </select>
          <button
            type="button"
            class="btn btn-outline btn-sm mt-2 border-base-content/50"
            [disabled]="!selectedPresetId()"
            (click)="loadPreset()"
          >
            Load
          </button>
          <p class="text-[11px] text-base-content-muted">
            Loads the preset into the preview. Existing preview items are kept
            where they do not conflict.
          </p>
        } @else {
          <p class="mt-2 text-xs">
            No saved presets yet. Apply or save one to reuse it.
          </p>
        }
        @if (presetNotice()) {
          <p role="status" class="mt-2 text-xs">{{ presetNotice() }}</p>
        }
        @if (presetLoadError()) {
          <p role="alert" class="mt-2 text-xs">
            Could not load presets. Try again.
          </p>
          <button
            type="button"
            class="btn btn-outline btn-xs border-base-content/50"
            (click)="loadPresets()"
          >
            Retry
          </button>
        }
        <button
          type="button"
          class="btn btn-ghost btn-sm mt-2"
          [attr.aria-expanded]="saveFormOpen()"
          aria-controls="save-form"
          (click)="saveFormOpen.set(!saveFormOpen())"
        >
          Save as preset
        </button>
        @if (saveFormOpen()) {
          <div id="save-form" class="mt-2 space-y-2">
            <p class="text-xs">
              Saves the current preview as a reusable preset. Nothing is written
              to the workspace until you apply.
            </p>
            <label for="preset-name" class="block text-xs"
              >Name (required)</label
            ><input
              #nameInput
              id="preset-name"
              class="input input-sm input-bordered w-full border-base-content/50"
              [value]="presetName()"
              [attr.aria-invalid]="nameInvalid() ? true : null"
              [attr.aria-describedby]="
                nameInvalid() ? 'preset-name-error' : null
              "
              (input)="presetName.set(nameInput.value)"
            />
            @if (nameInvalid()) {
              <p id="preset-name-error" role="alert" class="text-xs">
                Enter a name for the preset.
              </p>
            }
            <label for="preset-description" class="block text-xs"
              >Description (optional)</label
            ><textarea
              #descriptionInput
              id="preset-description"
              class="textarea textarea-bordered w-full border-base-content/50"
              [value]="presetDescription()"
              (input)="presetDescription.set(descriptionInput.value)"
            ></textarea
            ><button
              type="button"
              class="btn btn-outline btn-sm border-base-content/50"
              [attr.aria-disabled]="
                !hasPreview() || savingPreset() ? true : null
              "
              (click)="savePreset()"
            >
              Save preset
            </button>
          </div>
        }
        @if (presetError()) {
          <p role="alert" class="mt-2 text-xs">
            Could not save the preset. Nothing was saved.
          </p>
        }
      </section>
    }
  `,
})
export class BuilderPresetsSectionComponent {
  readonly initialized = input(false);
  readonly tabId = input.required<string>();
  readonly workspaceRoot = input('');
  readonly document = input<string | null>(null);
  protected readonly hydration = inject(HarnessProposalHydrationService);
  private readonly records = inject(HarnessBuilderRecordsService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  protected readonly presets = signal<HarnessPreset[]>([]);
  protected readonly selectedPresetId = signal('');
  protected readonly presetNotice = signal('');
  protected readonly presetError = signal(false);
  protected readonly presetLoadError = signal(false);
  protected readonly saveFormOpen = signal(false);
  protected readonly presetName = signal('');
  protected readonly presetDescription = signal('');
  protected readonly nameInvalid = signal(false);
  protected readonly savingPreset = signal(false);
  protected readonly preview = computed(() => this.hydration.config());
  protected readonly hasPreview = computed(
    () => Object.keys(this.preview()).length > 0 || !!this.document(),
  );
  private initializedKey = '';
  constructor() {
    effect(() => {
      const root = this.workspaceRoot();
      const tab = this.tabId();
      if (
        !this.initialized() ||
        !root ||
        !tab ||
        root + ':' + tab === this.initializedKey
      )
        return;
      this.initializedKey = root + ':' + tab;
      void this.loadPresets();
    });
  }

  protected async loadPresets(): Promise<void> {
    try {
      this.presets.set((await this.rpc.loadPresets()).presets);
      this.presetLoadError.set(false);
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not load presets',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.presetLoadError.set(true);
    }
  }
  protected loadPreset(): void {
    const preset = this.presets().find(
      (item) => item.id === this.selectedPresetId(),
    );
    if (!preset) return;
    try {
      commitBuilderUpdates(
        this.records,
        this.hydration,
        this.workspaceRoot(),
        this.tabId(),
        this.preview(),
        preset.config,
      );
      this.appState.requestComposerPrefill(
        `I loaded the preset "${preset.name}" into the preview. Please use it as a starting point.`,
        this.tabId(),
      );
      this.presetNotice.set(
        `Loaded "${preset.name}". It is in the preview now. A note was added to your message box.`,
      );
      this.presetLoadError.set(false);
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not load preset',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.presetLoadError.set(true);
    }
  }
  protected async savePreset(): Promise<void> {
    if (!this.hasPreview() || this.savingPreset()) return;
    const name = this.presetName().trim();
    this.nameInvalid.set(!name);
    if (!name) return;
    this.savingPreset.set(true);
    this.presetError.set(false);
    try {
      await this.rpc.savePreset({
        name,
        description: this.presetDescription().trim(),
        config: fullConfig(this.preview(), this.workspaceRoot()),
      });
      await this.loadPresets();
      this.presetNotice.set(
        `Saved "${name}". You can start from it in any workspace.`,
      );
      this.saveFormOpen.set(false);
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not save preset',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.presetError.set(true);
    } finally {
      this.savingPreset.set(false);
    }
  }
}
