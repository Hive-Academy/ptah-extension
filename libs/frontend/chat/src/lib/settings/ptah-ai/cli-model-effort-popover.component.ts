import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import {
  ProvidersSettingsStateService,
  type ProvidersEditContext,
  type ProvidersSettingsPatch,
} from '@ptah-extension/core';
import {
  ProviderModelPickerComponent,
  ProviderModelSearchFieldComponent,
  type ProviderModelSearchOption,
} from '@ptah-extension/ui';
import {
  CLI_REASONING_EFFORT_VALUES,
  PI_REASONING_EFFORT_VALUES,
} from '@ptah-extension/shared';
import {
  SettingsSaveFeedbackService,
  type SettingsSaveResult,
} from '../feedback/settings-save-feedback.service';
import {
  cliModelDisplay,
  type CliEffortSettingKey,
  type CliMatrixRow,
  type CliModelSettingKey,
  type SystemCliMatrixRow,
} from './cli-matrix-rows';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';

export type CliMatrixCellField = 'model' | 'effort';

interface EffortOption {
  readonly value: string;
  readonly label: string;
}

/** Moved from the Ptah CLI instance manager (deleted in Batch 34; last at `45fbd7146`). */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  '': 'Provider default',
  inherit: 'Inherit chat effort',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};
const effortOptions = (values: readonly string[]): readonly EffortOption[] =>
  values.map((value) => ({ value, label: EFFORT_LABELS[value] ?? value }));
/** Codex/Copilot: the host allowlist (`agent:setConfig`); `inherit` resolves in `lane-spawn-policy.ts` `resolveLaneEffort`. */
const CLI_EFFORT_OPTIONS = effortOptions(CLI_REASONING_EFFORT_VALUES);
/** Pi: passed raw to `pi --thinking`, which takes off..max; the host rejects anything else. */
const PI_EFFORT_OPTIONS = effortOptions(PI_REASONING_EFFORT_VALUES);

/** #67: opencode and Pi take a `provider/model` id (`rpc-agents.types.ts` `opencodeModel`, `piModel`). */
const MODEL_FORMAT_EXAMPLE: Partial<Record<SystemCliMatrixRow['cli'], string>> =
  {
    opencode: 'anthropic/claude-sonnet-4-5',
    pi: 'openai/gpt-4o',
  };

/** Every write of this popover; the settings are global (`agent:setConfig`, `ptahCli:update`). */
const SAVE_SCOPE = 'global';
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * The CLI matrix's Model or Effort cell popover (plan :728-734, prototype `#popoverMatrixModel` /
 * `#popoverMatrixEffort`, interactions/orchestration-2/-3). A choice saves at once through
 * `SettingsSaveFeedbackService` with Undo, and the popover closes once it saved.
 * - System CLI model: the compact searchable field over `agent:listCliModels` for that CLI, opened empty with ids in
 *   mono and the current one checked (Visual round 1). A saved id the list lacks stays listed ("saved, not in the
 *   current list"), so opening the popover never changes it. opencode and Pi show the
 *   `provider/model` hint (#67).
 * - System CLI effort: the CLI's allowlist (Pi: off..max). An unsupported saved value is never offered and is
 *   named in an alert (the guard from the Ptah CLI instance manager deleted in Batch 34).
 * - Ptah instance model: `ProviderModelPickerComponent`, searchable, fixed to the instance's provider, with the
 *   instance's model count (#45).
 * Every `write`/`undo` is one `state.saveSettings` call (Batch 17 constraint). The edit context is taken when the
 * popover opens (the matrix creates this component only while it is open).
 */
@Component({
  selector: 'ptah-cli-model-effort-popover',
  standalone: true,
  imports: [
    SettingsBusyDisabledDirective,
    LucideAngularModule,
    ProviderModelSearchFieldComponent,
    ProviderModelPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="dialog"
      [attr.aria-labelledby]="titleId()"
      class="w-[17rem] max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal p-3 text-left text-xs"
      data-testid="cli-matrix-popover"
      [attr.data-field]="field()"
      [attr.data-row]="row().id"
    >
      <div
        class="flex items-center justify-between gap-2 border-b border-base-300 pb-1.5"
      >
        <h3 [id]="titleId()" class="text-xs font-bold text-base-content">
          {{ title() }}
        </h3>
        <button
          type="button"
          [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing"
          aria-label="Close"
          (click)="closed.emit()"
        >
          <lucide-angular
            [img]="CloseIcon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
        </button>
      </div>

      @if (!context) {
        <p
          role="status"
          class="text-base-content-muted"
          data-testid="cli-matrix-popover-loading"
        >
          Settings are still loading. Close and try again.
        </p>
      }

      @if (systemModel(); as cell) {
        @if (catalogueStatus() === 'error') {
          <p
            role="alert"
            class="flex flex-wrap items-center gap-1.5 text-base-content"
            data-testid="cli-matrix-models-error"
          >
            The model list could not be loaded.
            <button
              type="button"
              [class]="
                'btn btn-link btn-xs h-auto min-h-6 px-0 text-base-content ' +
                focusRing
              "
              (click)="state.refreshDelegatedModelOptions()"
            >
              Retry
            </button>
          </p>
        }
        <!-- The notes sit above the search: its list opens below it, over the page, and never covers them. -->
        <p class="text-base-content-muted">
          Provider default uses {{ cell.name }}'s own default. Saved globally;
          new agents use it.
        </p>
        @if (formatExample(); as example) {
          <p
            class="text-base-content-muted"
            data-testid="cli-matrix-model-format"
          >
            Model id uses <code class="font-mono">provider/model</code> format
            (e.g. <code class="font-mono">{{ example }}</code
            >).
          </p>
        }
        <ptah-provider-model-search-field
          [inputId]="titleId() + '-model'"
          [ariaLabel]="cell.name + ' model'"
          [options]="modelOptions()"
          [selectedId]="savedModelId(cell)"
          [includeDefault]="true"
          [compact]="true"
          placeholder="Search models"
          [defaultLabel]="
            catalogueStatus() === 'loading'
              ? 'Loading models…'
              : 'Provider default'
          "
          [disabled]="busy() || !context || catalogueStatus() === 'loading'"
          (modelSelected)="saveSystemModel(cell, $event)"
        />
      }

      @if (systemEffort(); as cell) {
        <div
          class="grid grid-cols-2 gap-1"
          role="group"
          [attr.aria-label]="cell.name + ' reasoning effort'"
          data-testid="cli-matrix-effort-options"
        >
          @for (option of effortChoices(); track option.value) {
            <button
              type="button"
              [class]="effortClass(option.value)"
              [attr.aria-pressed]="option.value === cell.effort?.value"
              [ptahBusyDisabled]="busy() || !context"
              [attr.data-effort]="option.value || 'default'"
              (click)="saveEffort(cell, option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
        @if (unsupportedEffort(); as saved) {
          <p
            role="alert"
            class="text-base-content"
            data-testid="cli-matrix-invalid-effort"
          >
            The saved value "{{ saved }}" is not supported. Choose a supported
            value, or Provider default to reset it.
          </p>
        }
      }

      @if (instanceModel(); as cell) {
        <ptah-provider-model-picker
          [fixedProvider]="cell.providerId"
          [searchable]="true"
          [model]="cell.selectedModel ?? ''"
          [label]="cell.name + ' model'"
          [disabled]="busy() || !context"
          (selectionChange)="saveInstanceModel(cell, $event.model)"
        />
        <p class="text-base-content-muted">
          Provider default uses the instance's tier mappings. Saved globally for
          this instance.
        </p>
        @if (instanceModelCount() !== null) {
          <p
            class="text-base-content-muted"
            data-testid="cli-matrix-model-count"
          >
            {{ instanceModelCount() }}
            {{ instanceModelCount() === 1 ? 'model' : 'models' }} available from
            {{ cell.provider }}.
          </p>
        }
      }
    </div>
  `,
})
export class CliModelEffortPopoverComponent implements OnInit {
  protected readonly CloseIcon = X;
  protected readonly focusRing = FOCUS;
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private searchFocused = false;

  readonly row = input.required<CliMatrixRow>();
  readonly field = input.required<CliMatrixCellField>();
  readonly closed = output<void>();

  /** Taken when the popover opens; a write the host blocked (workspace changed) takes a fresh one. */
  protected context: ProvidersEditContext | null = this.state.reviewContext();

  protected readonly titleId = computed(
    () => `cli-matrix-${this.field()}-${this.row().id}`,
  );
  protected readonly title = computed(
    () =>
      `${this.field() === 'model' ? 'Model' : 'Reasoning effort'} for ${this.row().name}`,
  );
  protected readonly busy = this.feedback.saving;

  protected readonly systemModel = computed(() => {
    const row = this.row();
    return row.kind === 'system' && this.field() === 'model' ? row : null;
  });
  protected readonly systemEffort = computed(() => {
    const row = this.row();
    return row.kind === 'system' && this.field() === 'effort' && row.effort
      ? row
      : null;
  });
  protected readonly instanceModel = computed(() => {
    const row = this.row();
    return row.kind === 'instance' && this.field() === 'model' ? row : null;
  });

  /** #45 (moved from the retired instance cards, Batch 34): the instance's model count, once the list has loaded. */
  protected readonly instanceModelCount = computed(() => {
    const row = this.instanceModel();
    return row
      ? (this.state.cliAgents().data?.find((agent) => agent.id === row.id)
          ?.modelCount ?? null)
      : null;
  });

  protected readonly catalogueStatus = computed(
    () => this.state.delegatedModelOptions().status,
  );
  /** The CLI's catalogue; a saved id it lacks stays listed so opening the popover never changes it. */
  protected readonly modelOptions = computed<
    readonly ProviderModelSearchOption[]
  >(() => {
    const row = this.systemModel();
    if (!row) return [];
    const options = (
      this.state.delegatedModelOptions().data?.[row.cli] ?? []
    ).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      supportsToolUse: null,
    }));
    const saved = this.savedModelId(row);
    return !saved || options.some((option) => option.id === saved)
      ? options
      : [
          {
            id: saved,
            name: 'saved, not in the current list',
            supportsToolUse: null,
          },
          ...options,
        ];
  });
  protected readonly formatExample = computed(() => {
    const row = this.systemModel();
    return row ? (MODEL_FORMAT_EXAMPLE[row.cli] ?? null) : null;
  });
  protected readonly effortChoices = computed(() =>
    this.systemEffort()?.effort?.key === 'piReasoningEffort'
      ? PI_EFFORT_OPTIONS
      : CLI_EFFORT_OPTIONS,
  );
  /** A saved effort outside the allowlist (e.g. from the old free-text field): shown, never offered. */
  protected readonly unsupportedEffort = computed(() => {
    const saved = this.systemEffort()?.effort?.value ?? '';
    return this.effortChoices().some((option) => option.value === saved)
      ? null
      : saved;
  });

  constructor() {
    // The model search takes focus (which opens its list, interactions/orchestration-2) once it is enabled: at once when
    // the catalogue is cached, else when it finishes loading. Only while focus is still on the panel, so a late load never
    // takes focus from a control the user moved to; then never again for this open.
    afterRenderEffect(() => {
      if (
        this.searchFocused ||
        this.catalogueStatus() !== 'ready' ||
        !this.systemModel()
      )
        return;
      const root = this.host.nativeElement;
      const search = root.querySelector<HTMLInputElement>(
        'input[role="combobox"]:not([disabled])',
      );
      const active = root.ownerDocument.activeElement;
      if (
        !search ||
        (active &&
          active !== root.ownerDocument.body &&
          !active.contains(root) &&
          !root.contains(active))
      )
        return;
      this.searchFocused = true;
      // Since Batch 54.1 a loading field is only aria-disabled, so the panel may already have focused it while it was
      // loading (no list opened then). A fresh focus now opens the list.
      if (active === search) search.blur();
      search.focus();
    });
  }

  ngOnInit(): void {
    // The delegated catalogues load on demand (the host may fetch remote lists); one read serves every CLI.
    const status = this.state.delegatedModelOptions().status;
    if (
      this.field() === 'model' &&
      this.row().kind === 'system' &&
      (status === 'unloaded' || status === 'error')
    ) {
      void this.state.refreshDelegatedModelOptions();
    }
  }

  protected effortClass(value: string): string {
    const selected = this.systemEffort()?.effort?.value === value;
    return `btn btn-xs min-h-7 font-medium ${selected ? 'btn-primary' : 'btn-outline border-base-content-muted text-base-content'} ${FOCUS}`;
  }

  /**
   * The saved model as a catalogue id (Batch 52.7): a value saved by the earlier `agy models` parse is "id<TAB>name",
   * the same shape the matrix cell shows as its id (`cliModelDisplay`). Read that way, it is the selected catalogue
   * model, not "saved, not in the current list". Undo still writes back the stored value as it was.
   */
  protected savedModelId(row: SystemCliMatrixRow): string {
    return cliModelDisplay(row.model.value).label;
  }

  protected saveSystemModel(
    row: SystemCliMatrixRow,
    model: string,
  ): Promise<void> {
    return this.saveSetting(
      row,
      row.model.key,
      model,
      row.model.value,
      `${row.name} model`,
    );
  }

  protected saveEffort(row: SystemCliMatrixRow, effort: string): Promise<void> {
    if (!row.effort) return Promise.resolve();
    return this.saveSetting(
      row,
      row.effort.key,
      effort,
      row.effort.value,
      `${row.name} reasoning effort`,
    );
  }

  protected async saveInstanceModel(
    row: Extract<CliMatrixRow, { kind: 'instance' }>,
    model: string,
  ): Promise<void> {
    const previous = row.selectedModel ?? '',
      context = this.context;
    if (model === previous || !context) return;
    const write = (selectedModel: string) => () =>
      this.state.saveSettings(
        { cli: [{ action: 'update', params: { id: row.id, selectedModel } }] },
        context,
      );
    this.afterSave(
      await this.feedback.save({
        label: `${row.name} model`,
        scope: SAVE_SCOPE,
        write: write(model),
        undo: write(previous),
      }),
    );
  }

  private async saveSetting(
    row: SystemCliMatrixRow,
    key: CliModelSettingKey | CliEffortSettingKey,
    value: string,
    previous: string,
    label: string,
  ): Promise<void> {
    const context = this.context;
    if (value === previous || !context || !row.interactive) return;
    const write = (next: string) => () =>
      this.state.saveSettings(orchestrationPatch(key, next), context);
    this.afterSave(
      await this.feedback.save({
        label,
        scope: SAVE_SCOPE,
        write: write(value),
        undo: write(previous),
      }),
    );
  }

  /** M2: closes on this save's own result; `failed` means this save ran, so `commit()` is its own. */
  private afterSave(result: SettingsSaveResult): void {
    if (result === 'saved') this.closed.emit();
    else if (result === 'failed' && this.state.commit().status === 'blocked')
      this.context = this.state.reviewContext();
  }
}

/** `{ orchestration: { [key]: value } }` for one delegated model or effort field. */
function orchestrationPatch(
  key: CliModelSettingKey | CliEffortSettingKey,
  value: string,
): ProvidersSettingsPatch {
  const orchestration: Partial<
    Record<CliModelSettingKey | CliEffortSettingKey, string>
  > = {};
  orchestration[key] = value;
  return { orchestration };
}
