import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { Eye, EyeOff, LucideAngularModule, X } from 'lucide-angular';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import {
  runDrawerWrite,
  type DrawerWriteOutcome,
} from '../providers/connection-drawer/drawer-write';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
/** Busy or not ready: `aria-disabled`, never native `disabled`, so the focused control keeps focus and Esc still closes the
 * popover (Gate V 36 re-check 2, N3); the handlers refuse the click. The disabled look is the shared Settings rule in the
 * app styles (Batch 51). */
const ACTION = `btn btn-outline btn-xs min-h-7 border-base-content-muted text-base-content ${FOCUS}`;

/**
 * The Cursor row's Credentials popover (plan :744-749, #64, TASK_2026_551). Cursor runs through the bundled SDK and is
 * detected once a key resolves (`cursor-cli.adapter.ts:208-223`), so this is reachable from the Uninstalled row too.
 * - "Set" badge from `cursorApiKeyStored` (the secrets store only; `cursorApiKeyConfigured` also counts the env var).
 * - With `cursorApiKeyEnvSet`: the 551 note that `CURSOR_API_KEY` takes precedence over the stored key.
 * - Masked key with show/hide (#49); Save → `state.saveCursorCredential(key)`; "Remove stored key" (two-step) →
 *   `saveCursorCredential('')`. Both read back `cursorApiKeyStored`, so a write is reported saved only when the store
 *   says so (D15); the outcome is this popover's own (`runDrawerWrite`), never an earlier save's.
 * - The key lives only in this component's signal, cleared after a save and on destroy (as in the Ptah CLI
 *   instance manager retired in Batch 34).
 * The secret is per machine (secrets store), so there is no Save-to target and no Undo.
 * Gate V 36: a saved key reads "Key stored, not verified." (M4; Ptah has no Cursor check yet, an accepted deviation),
 * and every outcome is also announced through the page toast (M3): a saved key moves the Cursor row between the
 * Uninstalled and installed groups, which re-creates this popover and would drop its inline line.
 * Re-check 2 (N3): while a write runs the key field is read-only and the buttons are `aria-disabled`, never natively
 * disabled, so focus never drops to `body` and Esc still closes the popover; after a write focus lands on the key field.
 */
@Component({
  selector: 'ptah-cursor-credential-popover',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="dialog"
      aria-labelledby="cursor-credential-title"
      class="surface-3 w-[19rem] max-w-[calc(100vw-2rem)] space-y-2.5 rounded-xl p-3 text-left text-xs"
      data-testid="cursor-credential-popover"
    >
      <div
        class="flex items-center justify-between gap-2 border-b border-base-300 pb-1.5"
      >
        <h3
          id="cursor-credential-title"
          class="text-xs font-bold text-base-content"
        >
          Cursor credentials
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

      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-base-content">Stored API key</span>
        @if (stored() === null) {
          <span
            class="text-base-content-muted"
            data-testid="cursor-credential-status"
            >Not loaded</span
          >
        } @else {
          <span
            [class]="
              'badge badge-outline badge-xs h-auto py-0.5 font-medium text-base-content ' +
              (stored()
                ? 'border-success/40 bg-success/10'
                : 'border-base-content-muted/40 bg-base-300')
            "
            data-testid="cursor-credential-status"
            >{{ stored() ? 'Set' : 'Not set' }}</span
          >
        }
      </div>

      @if (envSet()) {
        <p
          class="rounded border border-info/40 bg-info/10 px-2 py-1.5 text-base-content"
          data-testid="cursor-credential-env-note"
        >
          CURSOR_API_KEY is set in the environment and takes precedence over the
          stored key.
        </p>
      }

      <p class="text-base-content-muted" data-testid="cursor-credential-help">
        Create a key at cursor.com → Dashboard → Integrations. Ptah keeps it in
        this machine's secrets store and never shows it again.
      </p>

      <div class="space-y-1">
        <label
          for="cursor-credential-key"
          class="block font-semibold text-base-content"
          >{{ stored() ? 'Replace API key' : 'API key' }}</label
        >
        <div class="relative">
          <input
            id="cursor-credential-key"
            [type]="keyVisible() ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
            [class]="
              'input input-bordered input-sm w-full pr-9 font-mono text-xs ' +
              focusRing
            "
            [value]="key()"
            (input)="onKeyInput($event)"
            [readonly]="busy()"
            [attr.aria-busy]="busy() ? 'true' : null"
            placeholder="crsr_…"
            data-testid="cursor-credential-key"
          />
          <button
            type="button"
            [class]="'btn btn-ghost btn-xs absolute right-1 top-1 ' + focusRing"
            (click)="keyVisible.set(!keyVisible())"
            [attr.aria-label]="keyVisible() ? 'Hide API key' : 'Show API key'"
            [attr.aria-pressed]="keyVisible()"
            data-testid="cursor-credential-toggle-visibility"
          >
            <lucide-angular
              [img]="keyVisible() ? EyeOffIcon : EyeIcon"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          [class]="'btn btn-primary btn-xs min-h-7 ' + focusRing"
          [attr.aria-disabled]="busy() || !key().trim() ? 'true' : null"
          (click)="save()"
          data-testid="cursor-credential-save"
        >
          {{
            outcome()?.status === 'saving' && action() === 'save'
              ? 'Saving…'
              : 'Save key'
          }}
        </button>
        @if (stored() && !confirmRemove()) {
          <button
            type="button"
            [class]="ACTION"
            [attr.aria-disabled]="busy() ? 'true' : null"
            (click)="askRemove()"
            data-testid="cursor-credential-remove"
          >
            Remove stored key
          </button>
        }
      </div>
      @if (confirmRemove()) {
        <div
          role="group"
          aria-label="Confirm removing the stored Cursor key"
          class="surface-2 space-y-1.5 rounded-lg p-2"
          data-testid="cursor-credential-remove-confirm"
        >
          <p class="text-base-content">
            Remove the stored Cursor key?
            {{
              envSet()
                ? 'Cursor keeps using CURSOR_API_KEY from the environment.'
                : 'Cursor stops working until a key is set again.'
            }}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              [class]="ACTION"
              [attr.aria-disabled]="busy() ? 'true' : null"
              (click)="remove()"
              data-testid="cursor-credential-remove-confirm-button"
            >
              Remove key
            </button>
            <button
              type="button"
              [class]="ACTION"
              [attr.aria-disabled]="busy() ? 'true' : null"
              (click)="cancelRemove()"
              data-testid="cursor-credential-remove-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      }
      @if (outcomeText(); as text) {
        <p
          [attr.role]="text.alert ? 'alert' : 'status'"
          class="text-base-content"
          data-testid="cursor-credential-outcome"
        >
          {{ text.text }}
        </p>
      }
    </div>
  `,
})
export class CursorCredentialPopoverComponent implements OnDestroy {
  protected readonly CloseIcon = X;
  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly focusRing = FOCUS;
  protected readonly ACTION = ACTION;
  private readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly closed = output<void>();

  /** The typed key: held only here, never in service state. */
  protected readonly key = signal('');
  protected readonly keyVisible = signal(false);
  protected readonly confirmRemove = signal(false);
  protected readonly action = signal<'save' | 'remove' | null>(null);
  protected readonly outcome = signal<DrawerWriteOutcome | null>(null);

  /** `null` while the orchestration read has no data (never guessed from an earlier value). */
  protected readonly stored = computed(
    () => this.state.orchestration().data?.cursorApiKeyStored ?? null,
  );
  protected readonly envSet = computed(
    () => this.state.orchestration().data?.cursorApiKeyEnvSet === true,
  );
  /** Triggers wait while any save runs (D3). */
  protected readonly busy = computed(
    () =>
      this.state.commit().status === 'saving' ||
      this.outcome()?.status === 'saving',
  );

  protected readonly outcomeText = computed(() => {
    const outcome = this.outcome(),
      action = this.action();
    if (!outcome || outcome.status === 'saving' || outcome.status === 'idle')
      return null;
    if (outcome.status === 'saved')
      return {
        text:
          action === 'remove'
            ? 'Stored key removed.'
            : 'Key stored, not verified.',
        alert: false,
      };
    const lead =
      outcome.status === 'unconfirmed'
        ? 'Could not confirm the change. Check the "Set" status before retrying.'
        : action === 'remove'
          ? 'The stored key was not removed.'
          : 'The key was not saved.';
    return {
      text: [lead, outcome.message].filter(Boolean).join(' '),
      alert: true,
    };
  });

  ngOnDestroy(): void {
    this.key.set('');
  }

  protected onKeyInput(event: Event): void {
    this.key.set((event.target as HTMLInputElement).value);
  }

  protected async save(): Promise<void> {
    const key = this.key();
    if (!key.trim() || this.busy()) return;
    this.action.set('save');
    await runDrawerWrite(
      this.state,
      (context) => this.state.saveCursorCredential(key, context),
      (outcome) => this.outcome.set(outcome),
    );
    this.announce();
    // D15: the typed key is dropped only once the store confirms it; a failed save keeps it for a retry.
    if (this.outcome()?.status === 'saved') {
      this.key.set('');
      this.keyVisible.set(false);
    }
    // N3: focus stays in the popover on the key field (a retry after a failure; a new key after a save).
    this.focusAfterRender('cursor-credential-key');
  }

  /** The confirm replaces "Remove stored key", so focus moves to its Cancel. */
  protected askRemove(): void {
    if (this.busy()) return;
    this.confirmRemove.set(true);
    this.focusAfterRender('cursor-credential-remove-cancel');
  }

  protected cancelRemove(): void {
    if (this.busy()) return;
    this.confirmRemove.set(false);
    this.focusAfterRender('cursor-credential-remove');
  }

  private focusAfterRender(testid: string): void {
    afterNextRender(
      () =>
        this.element.nativeElement
          .querySelector<HTMLElement>(`[data-testid="${testid}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  /** M3: the outcome also goes to the page toast, which outlives this popover (it may be re-created meanwhile). */
  private announce(): void {
    const text = this.outcomeText();
    if (text)
      this.feedback.announce(text.text, text.alert ? 'alert' : 'status');
  }

  protected async remove(): Promise<void> {
    if (this.busy()) return;
    this.action.set('remove');
    await runDrawerWrite(
      this.state,
      (context) => this.state.saveCursorCredential('', context),
      (outcome) => this.outcome.set(outcome),
    );
    this.announce();
    // A failed removal keeps the confirm, with focus on its "Remove key" (only aria-disabled during the write); a
    // removed key closes the confirm, so focus moves to the key field.
    if (this.outcome()?.status === 'saved') {
      this.confirmRemove.set(false);
      this.focusAfterRender('cursor-credential-key');
    }
  }
}
