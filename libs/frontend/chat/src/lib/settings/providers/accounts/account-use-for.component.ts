import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { ProviderAccountChoice } from '@ptah-extension/core';
import type { ProviderAccountScope } from '@ptah-extension/shared';
import { UNAVAILABLE_ACCOUNT_MESSAGE, type UseForScopeModel } from './account-presentation';

/** `id` of the "Use for" heading; the Accounts tab labels its region with it. */
export const USE_FOR_HEADING_ID = 'account-use-for-heading';

/** One scope's write request; the parent performs the write. */
export interface UseForSelection {
  readonly scope: ProviderAccountScope;
  readonly choice: ProviderAccountChoice;
}

export type UseForModel = Readonly<Record<ProviderAccountScope, UseForScopeModel>>;
export type UseForScopeText = Readonly<Record<ProviderAccountScope, string | null>>;

const NO_TEXT: UseForScopeText = { main: null, lane: null };
const NO_PENDING: ReadonlySet<ProviderAccountScope> = new Set<ProviderAccountScope>();

const SCOPES: readonly {
  readonly scope: ProviderAccountScope;
  readonly label: string;
  readonly hint: string;
}[] = [
  { scope: 'main', label: 'New chats', hint: 'The account your next main chat uses.' },
  { scope: 'lane', label: 'Claude lanes', hint: 'The account the next Claude lane uses.' },
];

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/** `named:<id>` / `ambient` -> the choice the state service writes. `unavailable` is never written. */
function choiceOf(value: string): ProviderAccountChoice | null {
  if (value === 'ambient') return { kind: 'ambient' };
  if (value.startsWith('named:') && value.length > 'named:'.length) {
    return { kind: 'named', profileId: value.slice('named:'.length) };
  }
  return null;
}

/**
 * "Use for" block (design §3.1, §3.7; plan §10): one native select per scope. The shown value is always the
 * host's stored selection (`model`, from `useForModel`), never a pending or attempted value (R2, B-1); a change
 * only emits `selectionRequested` and the parent writes.
 *
 * Busy rule §3.7 (a) and binding rule B-2: before a scope's write disables its select, focus moves to that
 * scope's status line (`tabindex=-1`, polite). When the write ends (saved, refused or unconfirmed), the DOM value
 * is re-asserted from the model and focus returns to the select only if it is still on that status line and the
 * view is still attached; otherwise focus stays where the user put it and the status line announces the outcome.
 */
@Component({
  selector: 'ptah-account-use-for',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3 text-base-content" data-testid="account-use-for">
      <div class="space-y-1">
        <h3 [id]="headingId" class="text-sm font-bold">Use for</h3>
        <p class="text-xs text-base-content-muted">
          Pick which account each kind of session uses. Changes apply to new sessions only. Credentials stay on
          this computer.
        </p>
        <p class="text-xs text-base-content-muted">
          This applies only while Claude sign-in is your main route. If you chose another provider as the main
          route, that provider stays in effect.
        </p>
      </div>
      @for (entry of scopes; track entry.scope) {
        <div class="space-y-1" [attr.data-testid]="'use-for-' + entry.scope">
          <label [for]="'account-use-for-' + entry.scope" class="block text-xs font-semibold">{{ entry.label }}</label>
          <select
            [id]="'account-use-for-' + entry.scope"
            [attr.data-scope-select]="entry.scope"
            [class]="'select select-bordered select-sm min-h-[30px] w-full text-xs text-base-content ' + focusRing"
            [disabled]="isPending(entry.scope)"
            [attr.aria-busy]="isPending(entry.scope)"
            [attr.aria-describedby]="describedBy(entry.scope)"
            (change)="onChange(entry.scope, $event)"
            [attr.data-testid]="'use-for-select-' + entry.scope"
          >
            @for (option of model()[entry.scope].options; track option.value) {
              <option
                [value]="option.value"
                [disabled]="option.disabled"
                [selected]="option.value === model()[entry.scope].value"
              >{{ option.label }}</option>
            }
          </select>
          <p [id]="'account-use-for-' + entry.scope + '-hint'" class="text-xs text-base-content-muted">
            {{ entry.hint }}
          </p>
          @if (model()[entry.scope].value === 'unavailable') {
            <p
              [id]="'account-use-for-' + entry.scope + '-unavailable'"
              class="text-xs"
              [attr.data-testid]="'use-for-unavailable-' + entry.scope"
            >{{ unavailableMessage }}</p>
          }
          <p
            [id]="'account-use-for-' + entry.scope + '-status'"
            [attr.data-scope-status]="entry.scope"
            class="min-h-4 text-xs outline-none"
            role="status"
            aria-live="polite"
            tabindex="-1"
            [attr.data-testid]="'use-for-status-' + entry.scope"
          >{{ statusText()[entry.scope] }}</p>
          @if (!isPending(entry.scope) && alerts()[entry.scope]; as alert) {
            <p
              [id]="'account-use-for-' + entry.scope + '-alert'"
              class="rounded-box border border-base-300 border-l-4 border-l-state-err p-2 text-xs"
              role="alert"
              [attr.data-testid]="'use-for-alert-' + entry.scope"
            >{{ alert }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class AccountUseForComponent {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Per-scope model from `useForModel(snapshot, ambient)`: the stored selection only. */
  readonly model = input.required<UseForModel>();
  /** Scopes whose selection write is in flight; only those selects are disabled. */
  readonly pendingScopes = input<ReadonlySet<ProviderAccountScope>>(NO_PENDING);
  /** Polite per-scope outcome line (for example the unconfirmed-write warning). */
  readonly messages = input<UseForScopeText>(NO_TEXT);
  /** Safe refusal sentence per scope, shown as an alert. */
  readonly alerts = input<UseForScopeText>(NO_TEXT);

  readonly selectionRequested = output<UseForSelection>();

  protected readonly scopes = SCOPES;
  protected readonly headingId = USE_FOR_HEADING_ID;
  protected readonly focusRing = FOCUS;
  protected readonly unavailableMessage = UNAVAILABLE_ACCOUNT_MESSAGE;

  /** Scopes whose status line received focus for a write (B-2 waiting targets). */
  private readonly waiting = signal<ReadonlySet<ProviderAccountScope>>(NO_PENDING);

  protected readonly statusText = computed<Readonly<Record<ProviderAccountScope, string>>>(() => {
    const messages = this.messages();
    const text = (scope: ProviderAccountScope) =>
      this.pendingScopes().has(scope) ? 'Saving…' : (messages[scope] ?? '');
    return { main: text('main'), lane: text('lane') };
  });

  constructor() {
    // After render, so a select is already enabled when focus returns to it.
    afterRenderEffect(() => {
      const model = this.model();
      const pending = this.pendingScopes();
      const waiting = this.waiting();
      const active = this.document.activeElement;
      let stillWaiting = waiting;
      for (const { scope } of SCOPES) {
        const select = this.selectOf(scope);
        const status = this.statusOf(scope);
        if (!select || !status) continue;
        // The DOM value always shows the stored selection; a refused or unconfirmed choice never stays shown.
        if (select.value !== model[scope].value) select.value = model[scope].value;
        if (pending.has(scope)) {
          // A write started elsewhere while this select held focus.
          if (active === select) {
            status.focus();
            stillWaiting = new Set([...stillWaiting, scope]);
          }
          continue;
        }
        if (!stillWaiting.has(scope)) continue;
        stillWaiting = new Set([...stillWaiting].filter((s) => s !== scope));
        if (active === status && status.isConnected) select.focus();
      }
      if (stillWaiting !== waiting) this.waiting.set(stillWaiting);
    });
  }

  protected isPending(scope: ProviderAccountScope): boolean {
    return this.pendingScopes().has(scope);
  }

  protected describedBy(scope: ProviderAccountScope): string {
    const base = `account-use-for-${scope}`;
    const ids = [`${base}-hint`];
    if (this.model()[scope].value === 'unavailable') ids.push(`${base}-unavailable`);
    ids.push(`${base}-status`);
    if (!this.isPending(scope) && this.alerts()[scope]) ids.push(`${base}-alert`);
    return ids.join(' ');
  }

  protected onChange(scope: ProviderAccountScope, event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || this.isPending(scope)) return;
    const current = this.model()[scope];
    const value = select.value;
    const option = current.options.find((candidate) => candidate.value === value);
    const choice = choiceOf(value);
    if (value === current.value || !option || option.disabled || choice === null) {
      select.value = current.value;
      return;
    }
    // Focus leaves the select before the parent's write disables it (busy rule §3.7 c).
    if (this.document.activeElement === select) {
      this.statusOf(scope)?.focus();
      this.waiting.set(new Set([...this.waiting(), scope]));
    }
    this.selectionRequested.emit({ scope, choice });
  }

  private selectOf(scope: ProviderAccountScope): HTMLSelectElement | null {
    return this.host.nativeElement.querySelector<HTMLSelectElement>(`[data-scope-select="${scope}"]`);
  }

  private statusOf(scope: ProviderAccountScope): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`[data-scope-status="${scope}"]`);
  }
}
