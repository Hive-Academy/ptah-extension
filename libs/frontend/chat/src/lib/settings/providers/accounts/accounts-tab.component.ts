import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { ChevronRight, LucideAngularModule, TriangleAlert } from 'lucide-angular';
import {
  ClaudeAmbientStatusService,
  ProviderAccountsStateService,
  type ProviderAccountActionKind,
  type ProviderAccountActionOutcome,
} from '@ptah-extension/core';
import {
  isSafeProviderAccountSummary,
  type ProviderAccountActionResult,
  type ProviderAccountState,
  type ProviderAccountsSnapshot,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';
import { SettingsBusyDisabledDirective } from '../../feedback/busy-disabled.directive';
import {
  ACCOUNT_COPY,
  AMBIENT_ROW_KEY,
  ATTENTION_STATES,
  STATE_LABEL,
  accountInitial,
  orderedAccounts,
  usedByChips,
  type UsedByChip,
} from './account-presentation';
import { AmbientAccountRowComponent } from './ambient-account-row.component';
import { AddAccountFormComponent } from './add-account-form.component';
import { AccountDetailViewComponent, type AccountRenameRequest } from './account-detail-view.component';

const PROVIDER = 'claude' as const;

/** Row "Sign in" is offered for these states (design-spec-p6 Surface 3 list). */
const SIGN_IN_STATES: ReadonlySet<ProviderAccountState> = new Set<ProviderAccountState>([
  'not-signed-in',
  'failed',
  'cancelled',
]);
const ROW_DOT: Readonly<Record<ProviderAccountState, string>> = {
  'not-signed-in': 'bg-state-idle',
  pending: 'bg-state-run',
  cancelled: 'bg-state-idle',
  failed: 'bg-state-err',
  disconnected: 'bg-state-err',
  'signed-in': 'bg-state-done',
  'signed-out': 'bg-state-idle',
};
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const SPINNER =
  'inline-block h-3 w-3 shrink-0 loading loading-spinner text-base-content-muted motion-reduce:animate-none';
/** The detail's heading (component 7 contract): the B-2 fallback target of detail actions and of a newly added account. */
const DETAIL_HEADING = '[data-testid="account-detail-heading"]';

type TabView = { readonly kind: 'list' } | { readonly kind: 'detail'; readonly profileId: string };

/** B-2: the exact element that held focus when an operation started, and the view it belonged to. */
interface FocusWait {
  readonly target: Element;
  readonly view: TabView;
}

/** Where focus goes when the waiting target vanished and focus fell to the body (B-2, plan component 6). */
type FocusFallback = 'detail-heading' | 'accounts-heading';

/**
 * The connection drawer's Accounts tab (TASK_2026_719 P6, plan component 6). Owns the load, the list/detail switch,
 * every write and its announcement; the children are presentational. Rows and chips come from the last authoritative
 * host snapshot only: a write never changes them locally, and removing an account never assigns a selection (B-1).
 * Every outcome is announced through the page's persistent toast regions (`SettingsSaveFeedbackService.announce`);
 * the tab has no inline feedback line. Busy state is set in the handler that receives the intent, before anything
 * async. After an async result, focus moves only if the user has not moved it since the intent (B-2).
 * Leaving the tab or closing the drawer never cancels a sign-in: the state service owns operations.
 */
@Component({
  selector: 'ptah-accounts-tab',
  standalone: true,
  imports: [
    LucideAngularModule,
    SettingsBusyDisabledDirective,
    AmbientAccountRowComponent,
    AddAccountFormComponent,
    AccountDetailViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view().status !== 'inert') {
      <div
        #region
        role="region"
        aria-label="Claude accounts"
        class="space-y-6 text-sm text-base-content"
        data-testid="accounts-tab"
        [attr.aria-busy]="regionBusy()"
      >
        @if (detailAccount(); as account) {
          <div #detailArea data-testid="accounts-tab-detail">
            <ptah-account-detail-view
              [account]="account"
              [accounts]="snapshot()?.accounts ?? []"
              [operation]="operations()[account.profileId] ?? null"
              [fallback]="fallbacks()[account.profileId] ?? null"
              [busy]="busy().get(account.profileId) ?? null"
              (back)="backToList(account.profileId)"
              (signIn)="signIn($event)"
              (cancelSignIn)="cancelSignIn($event)"
              (signOut)="signOut($event)"
              (checkStatus)="checkStatus($event)"
              (rename)="rename($event)"
              (remove)="remove($event)"
            />
          </div>
        } @else {
          <div class="flex flex-wrap items-center justify-between gap-2" data-testid="accounts-tab-header">
            <h3
              #accountsHeading
              tabindex="-1"
              class="text-[15px] font-semibold outline-none"
              data-testid="accounts-tab-heading"
            >Accounts</h3>
            <span class="flex flex-wrap items-center gap-2">
              @if (snapshot() && view().stale) {
                <span
                  role="status"
                  class="badge badge-warning badge-sm h-auto gap-1"
                  data-testid="accounts-tab-stale"
                >
                  <lucide-angular [img]="WarningIcon" class="h-3 w-3" aria-hidden="true" />
                  Out of date
                </span>
                <button
                  type="button"
                  [class]="'btn btn-ghost btn-sm min-h-8 ' + focusRing"
                  [ptahBusyDisabled]="view().status === 'loading'"
                  (click)="retry()"
                  data-testid="accounts-tab-stale-retry"
                >Try again</button>
              }
              @if (!addOpen()) {
                <button
                  #addButton
                  type="button"
                  [class]="'btn btn-outline btn-sm min-h-8 ' + focusRing"
                  [attr.aria-disabled]="addUnavailable() ? 'true' : null"
                  [attr.title]="held() ? copy.notAvailableOnHost : null"
                  (click)="openAdd()"
                  data-testid="accounts-tab-add"
                >Add account</button>
              }
            </span>
          </div>

          @if (snapshot(); as current) {
            @if (addOpen()) {
              <div #addArea data-testid="accounts-tab-add-area">
                <ptah-add-account-form
                  [accounts]="current.accounts"
                  [pending]="addPending()"
                  (submitted)="add($event)"
                  (cancelled)="cancelAdd()"
                />
              </div>
            } @else {
              <ul role="list" aria-label="Claude accounts" class="space-y-3" data-testid="accounts-tab-list">
                <li>
                  <ptah-ambient-account-row
                    [ambient]="ambientView()"
                    [chips]="chips().get(ambientKey) ?? noChips"
                    (checkRequested)="checkAmbient()"
                  />
                </li>
                @for (row of rows(); track row.account.profileId) {
                  <li
                    [class]="'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box border border-base-content/15 bg-base-100 px-4 py-3 ' +
                      (row.attention ? 'border-l-4 border-l-state-err' : '')"
                    data-testid="accounts-tab-row"
                  >
                    <span
                      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 font-bold"
                      aria-hidden="true"
                    >{{ row.initial }}</span>
                    <span class="min-w-0 flex-1 basis-36 space-y-1">
                      <span
                        class="block truncate font-semibold"
                        [title]="row.account.label"
                        data-testid="accounts-tab-row-name"
                      >{{ row.account.label }}</span>
                      <span class="flex min-w-0 items-center gap-1.5 text-base-content-muted">
                        @if (row.pending) {
                          <span [class]="spinner" aria-hidden="true" data-testid="accounts-tab-row-spinner"></span>
                        } @else {
                          <span [class]="'inline-block h-2 w-2 shrink-0 rounded-full ' + row.dot" aria-hidden="true"></span>
                        }
                        <span data-testid="accounts-tab-row-state">{{ row.status }}</span>
                      </span>
                      @if (row.chips.length > 0) {
                        <span class="flex min-w-0 flex-wrap items-center gap-1" data-testid="accounts-tab-row-used-by">
                          <span class="text-base-content-muted">Used by</span>
                          @for (chip of row.chips; track chip) {
                            <span class="inline-flex h-5 items-center rounded-full border border-base-content/25 px-2 text-xs leading-none text-base-content" data-testid="accounts-tab-row-chip">{{ chip }}</span>
                          }
                        </span>
                      }
                    </span>
                    <span class="ml-auto flex shrink-0 items-center justify-end gap-2" data-testid="accounts-tab-row-actions">
                      @if (row.canSignIn) {
                        <button
                          type="button"
                          [class]="'btn btn-primary btn-sm min-h-8 ' + focusRing"
                          [ptahBusyDisabled]="row.busy"
                          (click)="rowSignIn(row.account.profileId)"
                          data-testid="accounts-tab-row-sign-in"
                        >Sign in</button>
                      }
                      <button
                        #manage
                        type="button"
                        [class]="'btn btn-ghost btn-sm btn-square h-8 min-h-8 w-8 ' + focusRing"
                        [attr.aria-label]="'Manage ' + row.account.label"
                        title="Manage"
                        (click)="openDetail(row.account.profileId)"
                        data-testid="accounts-tab-row-manage"
                      >
                        <lucide-angular [img]="ManageIcon" class="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                }
              </ul>
            }
          } @else if (view().status === 'error') {
            <div
              role="alert"
              class="flex flex-wrap items-center gap-2 rounded-box border border-error bg-base-100 px-4 py-3"
              data-testid="accounts-tab-error"
            >
              <span class="min-w-0 flex-1 break-words">Could not load accounts</span>
              <button type="button" [class]="'btn btn-outline btn-sm min-h-8 ' + focusRing" (click)="retry()">
                Try again
              </button>
            </div>
          } @else {
            <ul role="list" aria-label="Claude accounts" aria-busy="true" class="space-y-3" data-testid="accounts-tab-list">
              <li
                class="flex items-center gap-2 rounded-box border border-base-content/15 bg-base-100 px-4 py-3 text-base-content-muted"
                data-testid="accounts-tab-loading"
              >
                @if (view().status === 'idle') {
                  Open a workspace
                } @else {
                  <span [class]="spinner" aria-hidden="true"></span>
                  Loading…
                }
              </li>
            </ul>
          }
        }
      </div>
    }
  `,
})
export class AccountsTabComponent implements OnInit {
  private readonly accounts = inject(ProviderAccountsStateService);
  private readonly ambient = inject(ClaudeAmbientStatusService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private destroyed = false;

  protected readonly focusRing = FOCUS;
  protected readonly spinner = SPINNER;
  protected readonly copy = ACCOUNT_COPY;
  protected readonly ambientKey = AMBIENT_ROW_KEY;
  protected readonly noChips: readonly UsedByChip[] = [];
  protected readonly ManageIcon = ChevronRight;
  protected readonly WarningIcon = TriangleAlert;

  protected readonly view = this.accounts.state(PROVIDER);
  protected readonly ambientView = this.ambient.view;
  protected readonly operations = this.accounts.operations(PROVIDER);
  protected readonly fallbacks = this.accounts.fallbacks(PROVIDER);

  protected readonly tabView = signal<TabView>({ kind: 'list' });
  /** Busy rule (b): the running action per account. */
  protected readonly busy = signal<ReadonlyMap<string, ProviderAccountActionKind>>(new Map());
  protected readonly addOpen = signal(false);
  protected readonly addPending = signal(false);
  /** P6-A8: a write of this tab instance was refused with `release-held`; holds the host's safe sentence, if any. */
  protected readonly heldMessage = signal<string | null>(null);
  protected readonly held = computed(() => this.heldMessage() !== null);
  /** Accounts this tab removed itself; their disappearance from the snapshot is announced by Remove, not as "gone". */
  private readonly ownRemovals = new Set<string>();
  /** The last authoritative state per account, as seen while no write of that account was in flight. */
  private readonly lastStates = new Map<string, ProviderAccountState>();
  /** Pending sign-ins whose end an explicit Cancel response already announced; their terminal push stays silent. */
  private readonly settledByWrite = new Set<string>();

  protected readonly snapshot = computed(() => this.view().snapshot);
  protected readonly addUnavailable = computed(() => this.snapshot() === null || this.held());
  protected readonly chips = computed(() => {
    const snapshot = this.snapshot();
    return snapshot ? usedByChips(snapshot) : new Map<string, readonly UsedByChip[]>();
  });
  protected readonly regionBusy = computed(
    () => this.view().status === 'loading' || this.ambientView().status === 'checking',
  );
  protected readonly rows = computed(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return [];
    const chips = this.chips();
    const busy = this.busy();
    return orderedAccounts(snapshot).map((account) => ({
      account,
      initial: accountInitial(account.label),
      status: STATE_LABEL[account.state],
      dot: ROW_DOT[account.state],
      pending: account.state === 'pending',
      attention: ATTENTION_STATES.has(account.state),
      canSignIn: SIGN_IN_STATES.has(account.state),
      busy: busy.has(account.profileId),
      chips: chips.get(account.profileId) ?? this.noChips,
    }));
  });
  protected readonly detailAccount = computed(() => {
    const current = this.tabView();
    if (current.kind !== 'detail') return null;
    return this.snapshot()?.accounts.find((account) => account.profileId === current.profileId) ?? null;
  });

  private readonly region = viewChild<ElementRef<HTMLElement>>('region');
  private readonly accountsHeading = viewChild<ElementRef<HTMLElement>>('accountsHeading');
  private readonly detailArea = viewChild<ElementRef<HTMLElement>>('detailArea');
  private readonly addArea = viewChild<ElementRef<HTMLElement>>('addArea');
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');
  private readonly manageButtons = viewChildren<ElementRef<HTMLButtonElement>>('manage');

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // The open account left the authoritative snapshot: back to the list. Our own Remove completes its own focus
    // and toast; a push announces the loss, and the heading takes focus only if focus was inside that detail (B-2).
    effect(() => {
      const current = this.tabView();
      const snapshot = this.snapshot();
      if (current.kind !== 'detail' || !snapshot) return;
      if (snapshot.accounts.some((account) => account.profileId === current.profileId)) return;
      untracked(() => {
        const ownRemoval = this.ownRemovals.has(current.profileId);
        const area = this.detailArea()?.nativeElement;
        const active = this.document.activeElement;
        const focusInside = !!area && !!active && area.contains(active);
        const list: TabView = { kind: 'list' };
        this.tabView.set(list);
        if (ownRemoval) return;
        this.feedback.announce(ACCOUNT_COPY.accountGone, 'status');
        if (focusInside) this.focusAfterRender(() => this.accountsHeading()?.nativeElement);
      });
    });
    // A pending sign-in that a later push ends (finished or failed in the Claude window) is announced once. While a
    // write of the account is in flight its response owns the announcement, so that account is re-read after it.
    effect(() => {
      const snapshot = this.snapshot();
      const busy = this.busy();
      if (snapshot) untracked(() => this.observeSignIns(snapshot, busy));
    });
  }

  ngOnInit(): void {
    // Both reads start when the tab opens, in parallel.
    void this.accounts.open(PROVIDER);
    void this.ambient.read(true);
  }

  protected retry(): void {
    void this.accounts.refresh(PROVIDER);
  }

  protected async checkAmbient(): Promise<void> {
    await this.ambient.read(true);
    const view = this.ambientView();
    if (view.localFailure) this.feedback.announce(ACCOUNT_COPY.actionFailed, 'alert');
    else if (view.status === 'ready') this.feedback.announce(ACCOUNT_COPY.statusChecked, 'status');
  }

  // --- list / detail ----------------------------------------------------------

  protected openDetail(profileId: string): void {
    if (!this.snapshot()?.accounts.some((entry) => entry.profileId === profileId)) return;
    this.tabView.set({ kind: 'detail', profileId });
    // The Manage chevron leaves with the list; the detail heading takes focus.
    this.focusAfterRender(() => this.detailHeading());
  }

  /** "← Accounts": back to the list, focus on that account's Manage chevron. */
  protected backToList(profileId: string): void {
    this.tabView.set({ kind: 'list' });
    this.focusAfterRender(() => {
      const index = this.rows().findIndex((row) => row.account.profileId === profileId);
      return index < 0 ? this.accountsHeading()?.nativeElement : this.manageButtons()[index]?.nativeElement;
    });
  }

  // --- add ----------------------------------------------------------------------

  protected openAdd(): void {
    const held = this.heldMessage();
    if (held !== null) {
      // P6-A8: Add stays focusable (`aria-disabled`); activating it says why.
      this.feedback.announce(held, 'alert');
      return;
    }
    if (!this.snapshot()) return;
    this.addOpen.set(true);
  }

  protected cancelAdd(): void {
    if (this.addPending()) return;
    this.addOpen.set(false);
    this.focusAfterRender(() => this.addButton()?.nativeElement);
  }

  protected async add(label: string): Promise<void> {
    if (this.addPending()) return;
    // Busy in the receiving handler, before the first await.
    this.addPending.set(true);
    const viewAtIntent = this.tabView();
    const known = new Set(this.snapshot()?.accounts.map((account) => account.profileId) ?? []);
    const outcome = await this.accounts.addAccount(PROVIDER, label);
    this.addPending.set(false);
    if (outcome.status === 'failed' || outcome.status === 'unavailable') {
      // The form stays open and keeps focus in its input; nothing moves.
      this.announceRefusal(outcome);
      return;
    }
    // P6-9: focus is still inside the Add form and the view is unchanged.
    const focusInForm = this.focusInside(this.addArea()?.nativeElement) && this.tabView() === viewAtIntent;
    this.addOpen.set(false);
    if (outcome.status === 'unconfirmed') {
      this.feedback.announce(ACCOUNT_COPY.unconfirmed, 'alert');
      if (focusInForm) this.focusAfterRender(() => this.addButton()?.nativeElement);
      return;
    }
    this.feedback.announce(ACCOUNT_COPY.accountAdded, 'status');
    if (!focusInForm) return;
    const added = this.addedAccount(outcome.snapshot, known, label);
    if (added) {
      this.tabView.set({ kind: 'detail', profileId: added });
      this.focusAfterRender(() => this.detailHeading());
    } else {
      this.focusAfterRender(() => this.addButton()?.nativeElement);
    }
  }

  // --- account actions --------------------------------------------------------------

  /** Row "Sign in": stays focusable (`aria-disabled`) while the account is busy, so focus is never stranded. */
  protected rowSignIn(profileId: string): void {
    if (this.busy().has(profileId)) return;
    void this.signIn(profileId, 'accounts-heading');
  }

  /**
   * A started sign-in announces the account's state word ("Signing in…"/"Signed in"). The state service keeps only
   * the newest snapshot, so its current one wins over a late response: pushes that ended the sign-in while the start
   * was in flight are announced here (the observer skipped them while busy and never saw `pending`).
   */
  protected signIn(profileId: string, fallback: FocusFallback = 'detail-heading'): Promise<void> {
    return this.run('sign-in', profileId, () => this.accounts.startSignIn(PROVIDER, profileId), fallback, (snapshot) => {
      const current = this.snapshot() ?? snapshot;
      const state = current.accounts.find((account) => account.profileId === profileId)?.state;
      if (state === 'signed-in') return ACCOUNT_COPY.signedIn;
      if (state === 'failed') {
        this.feedback.announce(ACCOUNT_COPY.actionFailed, 'alert');
        return null;
      }
      return state === 'pending' ? STATE_LABEL.pending : null;
    });
  }

  protected cancelSignIn(profileId: string): Promise<void> {
    return this.run('cancel-sign-in', profileId, () => this.accounts.cancelSignIn(PROVIDER, profileId),
      'detail-heading', () => {
        // The Cancel toast is this sign-in's result; the push that ends it must not announce again.
        this.settledByWrite.add(profileId);
        return ACCOUNT_COPY.signInCancelled;
      });
  }

  protected signOut(profileId: string): Promise<void> {
    return this.run('sign-out', profileId, () => this.accounts.signOut(PROVIDER, profileId),
      'detail-heading', () => ACCOUNT_COPY.signedOut);
  }

  protected rename(request: AccountRenameRequest): Promise<void> {
    return this.run('rename', request.profileId,
      () => this.accounts.renameAccount(PROVIDER, request.profileId, request.label),
      'detail-heading', () => ACCOUNT_COPY.nameSaved);
  }

  /** B-1: only the host's committed snapshot changes a selection that named this account. */
  protected async remove(profileId: string): Promise<void> {
    if (this.busy().has(profileId)) return;
    // The response snapshot drops the account before this call resumes: the "gone" effect must stay silent for it.
    this.ownRemovals.add(profileId);
    try {
      await this.run('remove', profileId, () => this.accounts.removeAccount(PROVIDER, profileId),
        'detail-heading', () => ACCOUNT_COPY.accountRemoved);
    } finally {
      if (this.snapshot()?.accounts.some((account) => account.profileId === profileId)) {
        this.ownRemovals.delete(profileId);
      }
    }
  }

  /** A status re-read: holds the account's busy state like a write and announces its result. */
  protected async checkStatus(profileId: string): Promise<void> {
    if (this.busy().has(profileId)) return;
    this.startBusy(profileId, 'check-status');
    const wait = this.captureWait();
    let outcome: Awaited<ReturnType<ProviderAccountsStateService['refreshAccountStatus']>>;
    try {
      outcome = await this.accounts.refreshAccountStatus(PROVIDER, profileId);
    } finally {
      this.endBusy(profileId);
    }
    if (outcome.status === 'read') this.feedback.announce(ACCOUNT_COPY.statusChecked, 'status');
    else this.announceRefusal(outcome);
    this.restoreFocus(wait, 'detail-heading', false);
  }

  private async run(
    kind: ProviderAccountActionKind,
    profileId: string,
    write: () => Promise<ProviderAccountActionOutcome>,
    fallback: FocusFallback,
    savedMessage: (snapshot: ProviderAccountsSnapshot) => string | null,
  ): Promise<void> {
    if (this.busy().has(profileId)) return;
    this.startBusy(profileId, kind);
    const wait = this.captureWait();
    let outcome: ProviderAccountActionOutcome;
    try {
      outcome = await write();
    } finally {
      this.endBusy(profileId);
    }
    switch (outcome.status) {
      case 'saved': {
        const message = savedMessage(outcome.snapshot);
        if (message) this.feedback.announce(message, 'status');
        break;
      }
      case 'unconfirmed':
        this.feedback.announce(ACCOUNT_COPY.unconfirmed, 'alert');
        break;
      default:
        this.announceRefusal(outcome);
    }
    if (kind === 'remove' && outcome.status === 'saved') {
      // The detail leaves with the account: its origin vanished, so the `Accounts` heading is the fallback.
      this.restoreFocus(wait, 'accounts-heading', true);
    } else {
      this.restoreFocus(wait, fallback, false);
    }
  }

  /** Busy rule (b), set in the receiving handler before the first await. */
  private startBusy(profileId: string, kind: ProviderAccountActionKind): void {
    this.busy.update((all) => new Map(all).set(profileId, kind));
  }

  private endBusy(profileId: string): void {
    this.busy.update((all) => {
      const next = new Map(all);
      next.delete(profileId);
      return next;
    });
  }

  // ------------------------------------------------------------------------------------

  /** A refused or unreachable write: the host's safe sentence or the fixed alert. `release-held` also holds Add. */
  private announceRefusal(
    outcome: { readonly status: 'failed'; readonly result: ProviderAccountActionResult } | { readonly status: 'unavailable' },
  ): void {
    if (outcome.status === 'unavailable') {
      this.feedback.announce(ACCOUNT_COPY.actionFailed, 'alert');
      return;
    }
    const safe = isSafeProviderAccountSummary(outcome.result.summary) ? outcome.result.summary : null;
    if (outcome.result.code === 'release-held') {
      const message = safe ?? ACCOUNT_COPY.hostUnsupported;
      this.heldMessage.set(message);
      this.feedback.announce(message, 'alert');
      return;
    }
    this.feedback.announce(safe ?? ACCOUNT_COPY.actionFailed, 'alert');
  }

  /**
   * Announces a pending → terminal transition exactly once: "Signed in" as a status, a failure as an alert. A push
   * repeating a state changes nothing; an account with a write in flight keeps its earlier state until the write
   * resolves (its response announces), so a start that returns "Signed in" directly is not announced twice. The
   * snapshot carries no per-account host sentence, so a failure uses the fixed alert.
   */
  private observeSignIns(snapshot: ProviderAccountsSnapshot, busy: ReadonlyMap<string, ProviderAccountActionKind>): void {
    const present = new Set<string>();
    for (const { profileId, state } of snapshot.accounts) {
      present.add(profileId);
      if (busy.has(profileId)) continue;
      const before = this.lastStates.get(profileId);
      this.lastStates.set(profileId, state);
      if (before === state) continue;
      if (state === 'pending') {
        this.settledByWrite.delete(profileId);
        continue;
      }
      if (before !== 'pending' || this.settledByWrite.delete(profileId)) continue;
      if (state === 'signed-in') this.feedback.announce(ACCOUNT_COPY.signedIn, 'status');
      else if (state === 'failed') this.feedback.announce(ACCOUNT_COPY.actionFailed, 'alert');
    }
    for (const profileId of [...this.lastStates.keys()]) {
      if (present.has(profileId)) continue;
      this.lastStates.delete(profileId);
      this.settledByWrite.delete(profileId);
    }
  }

  /** The account the Add created: the one id the earlier snapshot did not hold, else the one with that name. */
  private addedAccount(snapshot: ProviderAccountsSnapshot, known: ReadonlySet<string>, label: string): string | null {
    const fresh = snapshot.accounts.filter((account) => !known.has(account.profileId));
    if (fresh.length === 1) return fresh[0].profileId;
    return snapshot.accounts.find((account) => account.label === label)?.profileId ?? null;
  }

  private detailHeading(): HTMLElement | undefined {
    return this.detailArea()?.nativeElement.querySelector<HTMLElement>(DETAIL_HEADING) ?? undefined;
  }

  private focusInside(area: HTMLElement | undefined): boolean {
    const active = this.document.activeElement;
    return !this.destroyed && !!area && !!active && active !== this.document.body && area.contains(active);
  }

  /** B-2: the focused element at intent, if it lies inside this tab; never the document body. */
  private captureWait(): FocusWait | null {
    const active = this.document.activeElement;
    if (!active || !this.focusInside(this.region()?.nativeElement)) return null;
    return { target: active, view: this.tabView() };
  }

  /**
   * B-2 completion. If focus is still on the waiting target, it stays there. If that target vanished and focus fell
   * to the body, the fallback heading takes it after the next render. Anything else (focus moved, view replaced,
   * tab destroyed) gets no programmatic focus. Remove's fallback is the `Accounts` heading: the detail view leaves.
   */
  private restoreFocus(wait: FocusWait | null, fallback: FocusFallback, anyView: boolean): void {
    if (!wait || this.destroyed) return;
    if (!anyView && this.tabView() !== wait.view) return;
    const target = fallback === 'accounts-heading' ? () => this.accountsHeading()?.nativeElement : () => this.detailHeading();
    this.focusAfterRender(target, wait, anyView);
  }

  /**
   * Moves focus after the next render. With `wait`, only while focus has not moved since the intent: it is still on
   * the waiting target (then it stays), or that target was removed and focus fell to the body.
   */
  private focusAfterRender(target: () => HTMLElement | undefined, wait?: FocusWait, anyView = false): void {
    if (this.destroyed) return;
    afterNextRender(
      () => {
        if (this.destroyed) return;
        if (wait) {
          if (!anyView && this.tabView() !== wait.view) return;
          const active = this.document.activeElement;
          if (active === wait.target && wait.target.isConnected) return;
          const fell = !wait.target.isConnected && (active === null || active === this.document.body);
          if (!fell) return;
        }
        target()?.focus();
      },
      { injector: this.injector },
    );
  }
}
