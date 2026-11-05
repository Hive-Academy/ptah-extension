import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import {
  CODEX_SANDBOX_MODES,
  DEFAULT_CODEX_SANDBOX_MODE,
} from '@ptah-extension/shared';
import type { CodexSandboxMode } from '@ptah-extension/shared';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import {
  SettingsSaveFeedbackService,
  settingNotConfirmedMessage,
  settingNotSavedMessage,
} from '../feedback/settings-save-feedback.service';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const RPC_TIMEOUT_MS = 5_000;
const FULL_ACCESS: CodexSandboxMode = 'danger-full-access';
/** The toast's field name ("Saved Codex sandbox mode."). */
const TOAST_LABEL = 'Codex sandbox mode';
const NOT_SAVED = `${settingNotSavedMessage(TOAST_LABEL)} The saved setting is unchanged.`;
const NOT_CONFIRMED = settingNotConfirmedMessage(TOAST_LABEL);

/** The full access warning (TASK_2026_885 implementation plan, "Full access"). */
export const CODEX_FULL_ACCESS_WARNING =
  'Full access lets Codex read and change files outside this workspace and use the network without sandbox protection. Commands may affect your computer. Choose this only for runs you trust.';

interface SandboxChoice {
  readonly value: CodexSandboxMode;
  readonly label: string;
  readonly help: string;
}

/** Plain labels; a `Record` so a new mode in the shared enum fails the type check until it is described here. */
const CHOICE_TEXT: Readonly<
  Record<CodexSandboxMode, Omit<SandboxChoice, 'value'>>
> = {
  'read-only': {
    label: 'Read only',
    help: 'Codex can read files but cannot change them or use the network.',
  },
  'workspace-write-no-network': {
    label: 'Workspace write, no network',
    help: 'Codex can change files in this workspace. Network access is disabled where supported; on Windows, network blocking is incomplete and Codex may still connect.',
  },
  'workspace-write-network': {
    label: 'Workspace write with network',
    help: 'Codex can change files in this workspace and use the network.',
  },
  'danger-full-access': {
    label: 'Full access',
    help: CODEX_FULL_ACCESS_WARNING,
  },
};

/** The plain label, with "(default)" on the shared default mode only. */
function choiceLabel(mode: CodexSandboxMode): string {
  const label = CHOICE_TEXT[mode].label;
  return mode === DEFAULT_CODEX_SANDBOX_MODE ? `${label} (default)` : label;
}

/** Shown once, under the last workspace-write choice. */
export const CODEX_WINDOWS_WORKSPACE_WRITE_NOTE =
  'On Windows, workspace-write modes block child processes, so tools such as npm run verify or nx cannot run. Network blocking on Windows is not complete.';
const LAST_WORKSPACE_WRITE: CodexSandboxMode = 'workspace-write-network';

const CHOICES: readonly SandboxChoice[] = CODEX_SANDBOX_MODES.map((value) => ({
  value,
  label: choiceLabel(value),
  help: CHOICE_TEXT[value].help,
}));

type SetAnswer = 'acknowledged' | 'refused' | 'unknown';
type WriteResult = { ok: true } | { ok: false; message: string };

function isSandboxMode(value: unknown): value is CodexSandboxMode {
  return (
    typeof value === 'string' &&
    (CODEX_SANDBOX_MODES as readonly string[]).includes(value)
  );
}

/**
 * Codex sandbox mode (`agentOrchestration.codexSandboxMode`, TASK_2026_885 Component 1). One choice for every new
 * Codex chat turn and Codex CLI lane.
 *
 * Reads the effective mode from `agent:getConfig` and writes through `agent:setConfig`, with the outcome (and Undo)
 * in the page toast (`SettingsSaveFeedbackService.saveGeneric`). Every write that was not refused re-reads
 * `agent:getConfig`, so the radios and "In effect" only show a mode the host reported; a save failure keeps the last
 * confirmed mode. Host error text is never rendered, only fixed messages.
 *
 * Full access is the default (`DEFAULT_CODEX_SANDBOX_MODE`), so its warning is always shown next to that option.
 * Switching to it from another mode is never written on a single pick: it opens an inline confirm first. Undo never
 * restores full access, because that would skip the confirm.
 */
@Component({
  selector: 'ptah-codex-sandbox-setting',
  standalone: true,
  imports: [SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      data-glass-surface="content"
      class="flex flex-col gap-3 text-sm text-base-content"
      aria-labelledby="codex-sandbox-heading"
      data-testid="codex-sandbox-setting"
    >
      <div class="border-b border-base-content/10 pb-2">
        <h3
          id="codex-sandbox-heading"
          class="text-base font-semibold text-base-content"
        >
          Codex sandbox
        </h3>
        <p
          id="codex-sandbox-scope"
          class="mt-0.5 text-xs text-base-content-muted"
          data-testid="codex-sandbox-scope"
        >
          Applies to all new Codex chat turns and Codex CLI lanes.
        </p>
      </div>

      @switch (load()) {
        @case ('loading') {
          <p
            class="text-xs text-base-content-muted"
            role="status"
            aria-live="polite"
            data-testid="codex-sandbox-loading"
          >
            Loading Codex sandbox…
          </p>
        }
        @case ('error') {
          <div role="alert" class="space-y-1.5">
            <p data-testid="codex-sandbox-load-error">
              The Codex sandbox setting could not be read. Your saved setting
              has not changed.
            </p>
            <button
              type="button"
              [class]="
                'btn btn-outline btn-sm border-base-content-muted text-base-content ' +
                focusRing
              "
              (click)="reload()"
              data-testid="codex-sandbox-retry"
            >
              Retry Codex sandbox
            </button>
          </div>
        }
        @default {
          <fieldset
            class="flex max-w-xl flex-col gap-1"
            aria-describedby="codex-sandbox-scope codex-sandbox-precedence"
            data-testid="codex-sandbox-choices"
          >
            <legend class="sr-only">Codex sandbox mode</legend>
            @for (choice of choices; track choice.value) {
              <label
                class="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-base-content transition-colors hover:bg-base-200/50"
              >
                <input
                  #modeRadio
                  type="radio"
                  name="codex-sandbox-mode"
                  [class]="'radio radio-xs mt-0.5 ' + focusRing"
                  [value]="choice.value"
                  [checked]="selected() === choice.value"
                  [attr.aria-describedby]="'codex-sandbox-' + choice.value + '-help'"
                  [ptahBusyDisabled]="busy()"
                  (change)="select(choice.value)"
                  [attr.data-testid]="'codex-sandbox-' + choice.value"
                />
                <span class="flex-1">
                  <span class="block text-xs font-medium text-base-content">{{
                    choice.label
                  }}</span>
                  @if (choice.value === fullAccess) {
                    <!-- Full access is the default, so its warning is always visible next to it. -->
                    <span
                      [id]="'codex-sandbox-' + choice.value + '-help'"
                      class="mt-1 block rounded border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-base-content"
                      data-testid="codex-sandbox-warning"
                      >{{ choice.help }}</span
                    >
                  } @else {
                    <span
                      [id]="'codex-sandbox-' + choice.value + '-help'"
                      class="block text-xs text-base-content-muted"
                      >{{ choice.help }}</span
                    >
                  }
                </span>
              </label>
              @if (choice.value === lastWorkspaceWrite) {
                <p
                  class="ml-6 px-1.5 text-xs text-base-content-muted"
                  data-testid="codex-sandbox-windows-note"
                >
                  {{ windowsNote }}
                </p>
              }
            }
          </fieldset>

          @if (confirming()) {
            <div
              role="group"
              aria-labelledby="codex-sandbox-confirm-title"
              aria-describedby="codex-sandbox-danger-full-access-help"
              class="flex max-w-xl flex-col gap-2 rounded border border-warning/40 bg-warning/10 p-2.5"
              data-testid="codex-sandbox-confirm"
              (keydown.escape)="cancelFullAccess($event)"
            >
              <!-- The warning itself sits next to the Full access option; the group is described by it. -->
              <p
                id="codex-sandbox-confirm-title"
                class="text-xs font-semibold text-base-content"
              >
                Switch Codex to full access? Read the warning above first.
              </p>
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  [class]="
                    'btn btn-outline btn-sm border-error text-base-content ' +
                    focusRing
                  "
                  [ptahBusyDisabled]="busy()"
                  (click)="confirmFullAccess()"
                  data-testid="codex-sandbox-confirm-button"
                >
                  Use full access
                </button>
                <button
                  #confirmCancel
                  type="button"
                  [class]="'btn btn-ghost btn-sm text-base-content ' + focusRing"
                  [ptahBusyDisabled]="busy()"
                  (click)="cancelFullAccess()"
                  data-testid="codex-sandbox-cancel-button"
                >
                  Cancel
                </button>
              </div>
            </div>
          }

          <p
            class="text-xs text-base-content"
            aria-live="polite"
            data-testid="codex-sandbox-effective"
          >
            @if (saved() === null) {
              Effective policy unknown.
            } @else {
              In effect: {{ effectiveLabel() }}
            }
          </p>
          @if (saved() === null) {
            <button type="button" [class]="'btn btn-outline btn-sm ' + focusRing"
              [ptahBusyDisabled]="busy()" (click)="reload()"
              data-testid="codex-sandbox-reload">Reload effective policy</button>
          }
          <p
            id="codex-sandbox-precedence"
            class="text-xs text-base-content-muted"
            data-testid="codex-sandbox-precedence"
          >
            For runs Ptah starts, this choice takes precedence over
            ~/.codex/config.toml. A change applies from the next turn; a turn
            that is already running keeps its sandbox.
          </p>
          <p
            class="text-xs text-base-content-muted"
            data-testid="codex-sandbox-approval"
          >
            Approval prompts in Codex chat still follow your permission level.
            Codex CLI lanes run without approval prompts.
          </p>
        }
      }
    </section>
  `,
  styles: `
    :host-context([data-glass='on']) [data-glass-surface='content'] {
      padding: 1.25rem;
    }
  `,
})
export class CodexSandboxSettingComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  private readonly injector = inject(Injector);
  protected readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly confirmCancel =
    viewChild<ElementRef<HTMLButtonElement>>('confirmCancel');
  private readonly modeRadios =
    viewChildren<ElementRef<HTMLInputElement>>('modeRadio');

  protected readonly focusRing = FOCUS;
  protected readonly choices = CHOICES;
  protected readonly fullAccess = FULL_ACCESS;
  protected readonly lastWorkspaceWrite = LAST_WORKSPACE_WRITE;
  protected readonly windowsNote = CODEX_WINDOWS_WORKSPACE_WRITE_NOTE;

  protected readonly load = signal<'loading' | 'error' | 'ready'>('loading');
  /** The effective mode the host last reported; the last confirmed value. */
  protected readonly saved = signal<CodexSandboxMode | null>(null);
  /** A pick awaiting the full access confirm or its write; the radios show it meanwhile. */
  private readonly pending = signal<CodexSandboxMode | null>(null);
  protected readonly confirming = signal(false);
  /** True while this row's write runs. */
  private readonly saving = signal(false);

  protected readonly selected = computed(() => this.pending() ?? this.saved());
  protected readonly busy = computed(
    () => this.saving() || this.feedback.saving(),
  );
  protected readonly effectiveLabel = computed(() => {
    const mode = this.saved();
    return mode === null ? '' : choiceLabel(mode);
  });

  constructor() {
    // The opened confirm takes focus on Cancel, so Esc reaches it and Enter does not confirm by accident.
    effect(() => this.confirmCancel()?.nativeElement.focus());
  }

  ngOnInit(): void {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.load.set('loading');
    const mode = await this.readEffective();
    if (mode === null) {
      this.load.set('error');
      return;
    }
    this.saved.set(mode);
    this.pending.set(null);
    this.confirming.set(false);
    this.load.set('ready');
  }

  /** A radio pick: full access opens the confirm; any other mode saves at once. */
  protected select(mode: CodexSandboxMode): void {
    if (this.busy()) return;
    if (mode === FULL_ACCESS) {
      if (this.saved() === FULL_ACCESS) return;
      this.pending.set(mode);
      this.confirming.set(true);
      return;
    }
    this.confirming.set(false);
    if (mode === this.saved()) {
      this.pending.set(null);
      return;
    }
    void this.save(mode);
  }

  protected confirmFullAccess(): void {
    if (!this.confirming() || this.busy()) return;
    this.confirming.set(false);
    void this.save(FULL_ACCESS);
  }

  /** Cancel and Esc close the confirm, show the saved mode again and return focus to its radio. */
  protected cancelFullAccess(event?: Event): void {
    if (!this.confirming()) return;
    event?.stopPropagation();
    this.confirming.set(false);
    this.pending.set(null);
    afterNextRender(
      () => {
        const saved = this.saved();
        this.modeRadios()
          .find((radio) => radio.nativeElement.value === saved)
          ?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  /** One save through the page toast. Undo writes the previous mode back, except full access (it needs the confirm). */
  private async save(mode: CodexSandboxMode): Promise<void> {
    const previous = this.saved();
    this.pending.set(mode);
    this.saving.set(true);
    try {
      await this.feedback.saveGeneric({
        label: TOAST_LABEL,
        write: () => this.write(mode),
        undo:
          previous === null || previous === FULL_ACCESS
            ? null
            : () => this.write(previous),
      });
    } finally {
      this.saving.set(false);
      this.pending.set(null);
    }
  }

  /**
   * One `agent:setConfig` write, then an `agent:getConfig` re-read unless the host refused it. Only a read-back equal
   * to `mode` is a save; any other outcome keeps (or shows) the mode the host reported.
   */
  private async write(mode: CodexSandboxMode): Promise<WriteResult> {
    const answer = await this.set(mode);
    if (answer === 'refused') return { ok: false, message: NOT_SAVED };
    const effective = await this.readEffective();
    if (effective === null) {
      this.saved.set(null);
      return { ok: false, message: NOT_CONFIRMED };
    }
    this.saved.set(effective);
    if (effective === mode) return { ok: true };
    return {
      ok: false,
      message:
        answer === 'acknowledged'
          ? `${settingNotSavedMessage(TOAST_LABEL)} In effect: ${choiceLabel(effective)}.`
          : NOT_SAVED,
    };
  }

  /**
   * The `agent:setConfig` answer: `acknowledged` only for a literal `success: true`, `refused` for any other answer
   * (including a field error, whose text is not shown), `unknown` when the call threw (for example a timeout).
   */
  private async set(mode: CodexSandboxMode): Promise<SetAnswer> {
    try {
      const result = await this.rpc.call(
        'agent:setConfig',
        { codexSandboxMode: mode },
        { timeout: RPC_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data.success === true) {
        return 'acknowledged';
      }
      this.logger.warn('CodexSandboxSetting', 'agent:setConfig refused');
      return 'refused';
    } catch (error: unknown) {
      // degradation-audit: reported - the setting stays unconfirmed and the transport failure is logged by type.
      this.logger.warn('CodexSandboxSetting', 'agent:setConfig failed', {
        errorType: errorTypeOf(error),
      });
      return 'unknown';
    }
  }

  /** The effective mode from `agent:getConfig`; `null` when the read failed or reported an unknown mode. */
  private async readEffective(): Promise<CodexSandboxMode | null> {
    try {
      const result = await this.rpc.call('agent:getConfig', undefined, {
        timeout: RPC_TIMEOUT_MS,
      });
      if (!result.isSuccess()) return null;
      const mode: unknown = result.data.codexSandboxMode;
      if (isSandboxMode(mode)) return mode;
      this.logger.warn(
        'CodexSandboxSetting',
        'agent:getConfig reported no known sandbox mode',
      );
      return null;
    } catch (error: unknown) {
      // degradation-audit: reported - a failed effective-setting read is logged and shown as unknown.
      this.logger.warn('CodexSandboxSetting', 'agent:getConfig failed', {
        errorType: errorTypeOf(error),
      });
      return null;
    }
  }
}

/** A safe log classification: the constructor name, never the error's message, stack or fields. */
function errorTypeOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}
