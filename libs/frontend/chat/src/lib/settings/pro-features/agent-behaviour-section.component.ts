import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  LucideAngularModule,
  Sparkles,
} from 'lucide-angular';
import { ClaudeRpcService, EffortStateService, WorkspaceScopeService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import type {
  EffortLevel,
  EnhancedPromptsGetStatusResponse,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { UltracodeStateService } from '../../services/ultracode-state.service';
import { SystemPromptDrawerComponent } from './system-prompt-drawer.component';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';

interface EffortChoice {
  /** `''` is the SDK default (no stored effort). */
  readonly value: EffortLevel | '';
  readonly label: string;
}

const EFFORT_CHOICES: readonly EffortChoice[] = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
  { value: 'max', label: 'Max' },
];

type WriteResult = { ok: true } | { ok: false; message: string };

const PROMPT_STATUS_LOAD_FAILED = 'Could not load the system prompt status.';
const PROMPT_MODE_SAVE_FAILED = 'Could not save the system prompt mode.';
const WORKFLOWS_LOAD_FAILED = 'Could not load the dynamic workflows setting.';
const WORKFLOWS_SAVE_FAILED = 'Could not save the dynamic workflows setting.';
const EFFORT_SAVE_FAILED = 'Could not save the chat reasoning effort.';
const EFFORT_PINNED = 'Turn Ultracode off to change the chat reasoning effort.';
const ULTRACODE_ON_FAILED =
  'Could not turn on Ultracode: the reasoning effort was not saved.';
const ULTRACODE_OFF_FAILED =
  'Could not turn off Ultracode: your previous reasoning effort was not restored.';

/** M1: every row description is one clamped line; the full text is its `title` and stays in the DOM for readers. */
const PROMPT_NOTE_ON = "Ptah's project-specific prompt, used for all sessions when on.";
const PROMPT_NOTE_WIZARD =
  'Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project.';
const PROMPT_NOTE_UNKNOWN = 'The system prompt status is not loaded yet.';
const WORKFLOWS_NOTE =
  'Let the agent plan and run a multi-step workflow per task instead of a single-shot reply.';
const ULTRACODE_NOTE =
  'X-High effort and a planned workflow for each message. The ultracode keyword only takes effect on ' +
  'messages you type yourself. Turning Ultracode off restores your previous reasoning effort.';

interface LoadError {
  readonly message: string;
  readonly retry: () => Promise<unknown>;
}


/**
 * "Agent behaviour" card on the Advanced tab (pattern map rows A10, A11, A26, A27, A29).
 *
 * One P4 `table-xs` matrix, one row per behaviour: System prompt mode, Chat reasoning
 * effort (G9: the same value as Providers > Main Agent effort), Dynamic workflows and
 * Ultracode. Every write is S-sel through {@link SettingsSaveFeedbackService.saveGeneric}:
 * "Saved" appears only after the write's own result, a failed write leaves the control
 * on the saved value and raises an alert toast (D15), and Undo is a real write of the
 * previous value.
 *
 * `EffortStateService.setEffort` resolves whether its write landed (it rolls its signal back on
 * failure); the effort write is decided from that result (map §9 item 11, Batch 55b m-3).
 * Ultracode decides the same way inside `UltracodeStateService`.
 */
@Component({
  selector: 'ptah-agent-behaviour-section',
  standalone: true,
  imports: [SettingsBusyDisabledDirective, LucideAngularModule, NativePopoverComponent, SystemPromptDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="card bg-base-200 border border-base-300 p-3"
      aria-labelledby="agent-behaviour-heading"
      data-testid="agent-behaviour-card"
    >
      <div class="flex items-center gap-1.5 mb-2">
        <lucide-angular [img]="BotIcon" class="w-4 h-4 text-secondary" aria-hidden="true" />
        <h2 id="agent-behaviour-heading" class="text-xs font-bold uppercase tracking-wider text-base-content">
          Agent behaviour
        </h2>
      </div>

      @for (failure of loadErrors(); track failure.message) {
        <div role="alert" class="mb-2 flex items-center gap-1.5 rounded border border-error/40 p-2 text-xs text-base-content"
          data-testid="agent-behaviour-load-error">
          <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5 text-error shrink-0" aria-hidden="true" />
          <span class="flex-1">{{ failure.message }}</span>
          <button type="button" class="btn btn-ghost btn-xs text-base-content" (click)="failure.retry()"
            data-testid="agent-behaviour-load-retry">
            Retry
          </button>
        </div>
      }

      <div class="overflow-x-auto">
        <table class="table table-xs w-full">
          <thead>
            <tr>
              <th class="w-10" scope="col">On</th>
              <th scope="col">Setting</th>
              <th scope="col">Value / status</th>
              <th class="text-right" scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            <!-- A10/A11: System prompt mode -->
            <tr data-testid="agent-behaviour-row-prompt">
              <td class="align-top">
                <input type="checkbox" class="checkbox checkbox-xs checkbox-primary"
                  [checked]="promptEnabled()" [ptahBusyDisabled]="promptToggleDisabled() || saving()"
                  (change)="onPromptModeChange($event)"
                  aria-label="Toggle Enhanced System Prompt" aria-describedby="agent-behaviour-prompt-note" />
              </td>
              <td class="align-top max-w-0 w-full">
                <div class="font-bold text-base-content">System prompt mode</div>
                <p id="agent-behaviour-prompt-note" class="text-xs text-base-content-muted truncate" [title]="promptNote()">
                  {{ promptNote() }}
                </p>
              </td>
              <td class="align-top" data-testid="agent-behaviour-prompt-status">
                <div>
                  <span class="badge badge-outline badge-sm gap-1 whitespace-nowrap text-base-content">
                    @if (promptEnabled()) {
                      <lucide-angular [img]="SparklesIcon" class="w-3 h-3 text-secondary" aria-hidden="true" />
                      Ptah Enhanced
                    } @else {
                      Default
                    }
                  </span>
                </div>
                <div class="text-xs text-base-content-muted whitespace-nowrap">
                  {{ promptEnabled() ? 'Active for all sessions' : 'Standard system prompt' }}
                </div>
              </td>
              <td class="align-top text-right">
                <button type="button" class="btn btn-ghost btn-xs btn-square" (click)="drawerOpen.set(true)"
                  aria-label="System prompt details"
                  data-testid="agent-behaviour-prompt-details">
                  <lucide-angular [img]="ChevronRightIcon" class="w-3.5 h-3.5 text-base-content" aria-hidden="true" />
                </button>
              </td>
            </tr>

            <!-- A26 / G9: Chat reasoning effort (P5 popover, save on selection) -->
            <tr data-testid="agent-behaviour-row-effort">
              <td class="align-top"></td>
              <td class="align-top max-w-0 w-full">
                <div class="font-bold text-base-content">Chat reasoning effort</div>
                <p id="agent-behaviour-effort-note" class="text-xs text-base-content-muted truncate" [title]="effortNote()">
                  {{ effortNote() }}
                </p>
              </td>
              <td class="align-top">
                <ptah-native-popover [isOpen]="effortPopoverOpen()" placement="bottom-start"
                  backdropClass="transparent" (closed)="effortPopoverOpen.set(false)">
                  <button type="button" trigger class="btn btn-ghost btn-xs gap-1 px-1.5 font-normal text-base-content"
                    [disabled]="saving() || ultracode.enabled()" (click)="effortPopoverOpen.set(true)"
                    [attr.aria-label]="'Chat reasoning effort: ' + effortLabel() + '. Change effort'"
                    aria-describedby="agent-behaviour-effort-note"
                    aria-haspopup="dialog" [attr.aria-expanded]="effortPopoverOpen()"
                    data-testid="agent-behaviour-effort-value">
                    <span class="font-mono">{{ effortLabel() }}</span>
                    <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3 text-base-content-muted" aria-hidden="true" />
                  </button>
                  <div content class="w-56 p-3 space-y-1.5" role="dialog" aria-label="Chat reasoning effort">
                    <p class="text-xs font-semibold text-base-content-muted">Reasoning effort</p>
                    <div class="grid grid-cols-3 gap-1">
                      @for (choice of effortChoices; track choice.value) {
                        <button type="button" class="btn btn-xs text-[10px] popover-effort-btn"
                          [class.btn-primary]="currentEffort() === choice.value"
                          [class.btn-outline]="currentEffort() !== choice.value"
                          [attr.aria-pressed]="currentEffort() === choice.value"
                          [ptahBusyDisabled]="saving()" (click)="selectEffort(choice.value)"
                          [attr.data-testid]="'agent-behaviour-effort-choice-' + (choice.value || 'default')">
                          {{ choice.label }}
                        </button>
                      }
                    </div>
                  </div>
                </ptah-native-popover>
              </td>
              <td class="align-top"></td>
            </tr>

            <!-- A27: Dynamic workflows (PR-2: the "paid plan" sentence is removed) -->
            <tr data-testid="agent-behaviour-row-workflows">
              <td class="align-top">
                <input type="checkbox" class="checkbox checkbox-xs checkbox-primary"
                  [checked]="workflowsEnabled()" [ptahBusyDisabled]="!workflowsLoaded() || saving()"
                  (change)="onWorkflowsChange($event)" aria-label="Toggle dynamic workflows"
                  aria-describedby="agent-behaviour-workflows-note" />
              </td>
              <td class="align-top max-w-0 w-full">
                <div class="font-bold text-base-content">Dynamic workflows</div>
                <p id="agent-behaviour-workflows-note" class="text-xs text-base-content-muted truncate" [title]="workflowsNote">
                  {{ workflowsNote }}
                </p>
              </td>
              <td class="align-top text-xs text-base-content whitespace-nowrap" data-testid="agent-behaviour-workflows-status">
                @if (workflowsLoaded()) {
                  {{ workflowsEnabled() ? 'On' : 'Off' }}
                } @else {
                  <span class="text-base-content-muted" aria-hidden="true">—</span>
                  <span class="sr-only">Not loaded</span>
                }
              </td>
              <td class="align-top"></td>
            </tr>

            <!-- A29: Ultracode (restores the previous effort when turned off) -->
            <tr data-testid="agent-behaviour-row-ultracode">
              <td class="align-top">
                <input type="checkbox" class="checkbox checkbox-xs checkbox-primary"
                  [checked]="ultracode.enabled()" [ptahBusyDisabled]="saving()"
                  (change)="onUltracodeChange($event)" aria-label="Toggle Ultracode mode"
                  aria-describedby="agent-behaviour-ultracode-note" />
              </td>
              <td class="align-top max-w-0 w-full">
                <div class="font-bold text-base-content">Ultracode</div>
                <p id="agent-behaviour-ultracode-note" class="text-xs text-base-content-muted truncate" [title]="ultracodeNote">
                  {{ ultracodeNote }}
                </p>
              </td>
              <td class="align-top text-xs text-base-content whitespace-nowrap" data-testid="agent-behaviour-ultracode-status">
                {{ ultracode.enabled() ? 'On' : 'Off' }}
                <span class="ml-1 text-xs text-base-content-muted">Pins X-High while on</span>
              </td>
              <td class="align-top"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    @defer (when drawerOpen()) {
      <ptah-system-prompt-drawer
        [isOpen]="drawerOpen()"
        (closed)="drawerOpen.set(false)"
        (changed)="loadPromptStatus()"
      />
    }
  `,
})
export class AgentBehaviourSectionComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly workspaceScope = inject(WorkspaceScopeService);
  private readonly effortState = inject(EffortStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  readonly ultracode = inject(UltracodeStateService);

  readonly BotIcon = Bot;
  readonly SparklesIcon = Sparkles;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly AlertCircleIcon = AlertCircle;
  readonly effortChoices = EFFORT_CHOICES;
  readonly workflowsNote = WORKFLOWS_NOTE;
  readonly ultracodeNote = ULTRACODE_NOTE;

  readonly drawerOpen = signal(false);

  /** Save triggers are disabled while any settings write is in flight (D3). */
  readonly saving = this.feedback.saving;

  private readonly promptStatus = signal<EnhancedPromptsGetStatusResponse | null>(null);
  private readonly promptLoadError = signal<string | null>(null);
  readonly promptEnabled = computed(() => this.promptStatus()?.enabled ?? false);
  /** The mode can only be turned on once a prompt has been generated (A10). */
  readonly promptToggleDisabled = computed(
    () => !(this.promptStatus()?.hasGeneratedPrompt ?? false) && !this.promptEnabled(),
  );

  /** `workflows.disabled`; `null` until `agent:getConfig` answers. */
  private readonly workflowsDisabled = signal<boolean | null>(null);
  private readonly workflowsLoadError = signal<string | null>(null);
  readonly workflowsLoaded = computed(() => this.workflowsDisabled() !== null);
  readonly workflowsEnabled = computed(() => this.workflowsDisabled() === false);

  /** A failed status read never claims there is no prompt: until one read succeeds the note says it is not loaded. */
  readonly promptNote = computed(() => {
    if (this.promptStatus() === null) return PROMPT_NOTE_UNKNOWN;
    return this.promptToggleDisabled() ? PROMPT_NOTE_WIZARD : PROMPT_NOTE_ON;
  });

  readonly effortNote = computed(
    () => `Same value as Providers > Main Agent effort${this.ultracode.enabled() ? ' · Pinned to X-High by Ultracode' : ''}`,
  );

  readonly loadErrors = computed<readonly LoadError[]>(() => {
    const errors: LoadError[] = [];
    const prompt = this.promptLoadError();
    const workflows = this.workflowsLoadError();
    if (prompt !== null) errors.push({ message: prompt, retry: () => this.loadPromptStatus() });
    if (workflows !== null) errors.push({ message: workflows, retry: () => this.loadWorkflows() });
    return errors;
  });

  readonly currentEffort = computed<EffortLevel | ''>(() => this.effortState.currentEffort() ?? '');
  readonly effortLabel = computed(
    () => EFFORT_CHOICES.find((choice) => choice.value === this.currentEffort())?.label ?? 'Default',
  );
  readonly effortPopoverOpen = signal(false);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadPromptStatus(), this.loadWorkflows()]);
  }

  /** A10, S-sel. Undo writes the previous mode back. */
  async onPromptModeChange(event: Event): Promise<void> {
    const checkbox = event.target as HTMLInputElement;
    const previous = this.promptEnabled();
    await this.feedback.saveGeneric({
      label: 'system prompt mode',
      write: () => this.writePromptMode(!previous),
      undo: () => this.writePromptMode(previous),
    });
    // OnPush keeps the binding when the saved value did not change: put the DOM back on it.
    checkbox.checked = this.promptEnabled();
  }

  /** A26, S-sel from the popover. Undo writes the previous effort back. */
  async selectEffort(value: EffortLevel | ''): Promise<void> {
    this.effortPopoverOpen.set(false);
    if (value === this.currentEffort()) return;
    const previous = this.effortState.currentEffort();
    const next = value === '' ? undefined : value;
    await this.feedback.saveGeneric({
      label: 'chat reasoning effort',
      write: () => this.writeEffort(next),
      undo: () => this.writeEffort(previous),
    });
  }

  /** A27, S-sel. Undo writes the inverse back. */
  async onWorkflowsChange(event: Event): Promise<void> {
    const checkbox = event.target as HTMLInputElement;
    const nextDisabled = !checkbox.checked;
    await this.feedback.saveGeneric({
      label: 'dynamic workflows',
      write: () => this.writeWorkflowsDisabled(nextDisabled),
      undo: () => this.writeWorkflowsDisabled(!nextDisabled),
    });
    checkbox.checked = this.workflowsEnabled();
  }

  /** A29, S-sel. Turning it off restores the effort Ultracode replaced; Undo switches back. */
  async onUltracodeChange(event: Event): Promise<void> {
    const checkbox = event.target as HTMLInputElement;
    const next = checkbox.checked;
    await this.feedback.saveGeneric({
      label: 'Ultracode',
      write: () => this.writeUltracode(next),
      undo: () => this.writeUltracode(!next),
    });
    checkbox.checked = this.ultracode.enabled();
  }

  /**
   * The host answers a failed status check inside a successful RPC with a zeroed status plus `error`
   * (`enhanced-prompts-rpc.handlers.ts:185-192`); that is a load failure, not "no prompt" (lane Serious 1).
   */
  protected async loadPromptStatus(): Promise<boolean> {
    try {
      const result = await this.rpcService.call('enhancedPrompts:getStatus', { workspacePath: this.workspaceScope.activeWorkspacePath() ?? '.' });
      if (result.isSuccess() && !result.data.error) {
        this.promptStatus.set(result.data);
        this.promptLoadError.set(null);
        return true;
      }
    } catch {
      // Falls through to the fixed load error below.
    }
    this.promptLoadError.set(PROMPT_STATUS_LOAD_FAILED);
    return false;
  }

  private async loadWorkflows(): Promise<void> {
    try {
      const result = await this.rpcService.call('agent:getConfig', undefined);
      if (result.isSuccess()) {
        this.workflowsDisabled.set(result.data.workflowsDisabled ?? false);
        this.workflowsLoadError.set(null);
      } else {
        this.workflowsLoadError.set(WORKFLOWS_LOAD_FAILED);
      }
    } catch {
      this.workflowsLoadError.set(WORKFLOWS_LOAD_FAILED);
    }
  }

  /**
   * Writes the mode, then re-reads the status the badge and checkbox show. When that re-read fails the write
   * still stands: the checkbox and badge show the written value and the load error says the status was not
   * re-read, so "Saved" never sits next to a stale checkbox (Moderate 8, lane FM-3).
   */
  private async writePromptMode(enabled: boolean): Promise<WriteResult> {
    try {
      const result = await this.rpcService.call('enhancedPrompts:setEnabled', { workspacePath: this.workspaceScope.activeWorkspacePath() ?? '.', enabled });
      if (!result.isSuccess() || !result.data.success) {
        return { ok: false, message: PROMPT_MODE_SAVE_FAILED };
      }
    } catch {
      return { ok: false, message: PROMPT_MODE_SAVE_FAILED };
    }
    if (!(await this.loadPromptStatus())) {
      this.promptStatus.update((status) => (status === null ? status : { ...status, enabled }));
    }
    return { ok: true };
  }

  /** Map §9 item 11: decided from the write's own result, never from a read-back of the shared signal. */
  private async writeEffort(effort: EffortLevel | undefined): Promise<WriteResult> {
    if (this.ultracode.enabled()) return { ok: false, message: EFFORT_PINNED };
    return (await this.effortState.setEffort(effort)) ? { ok: true } : { ok: false, message: EFFORT_SAVE_FAILED };
  }

  private async writeWorkflowsDisabled(disabled: boolean): Promise<WriteResult> {
    try {
      const result = await this.rpcService.call('agent:setConfig', { workflowsDisabled: disabled });
      if (!result.isSuccess() || !result.data.success) {
        return { ok: false, message: WORKFLOWS_SAVE_FAILED };
      }
    } catch {
      return { ok: false, message: WORKFLOWS_SAVE_FAILED };
    }
    this.workflowsDisabled.set(disabled);
    return { ok: true };
  }

  /** `UltracodeStateService` reads the effort back and keeps the mode on its saved side. */
  private async writeUltracode(enabled: boolean): Promise<WriteResult> {
    if (await this.ultracode.toggle(enabled)) return { ok: true };
    return { ok: false, message: enabled ? ULTRACODE_ON_FAILED : ULTRACODE_OFF_FAILED };
  }
}
