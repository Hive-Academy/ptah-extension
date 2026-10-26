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
import {
  ClaudeAmbientStatusService,
  ProviderAccountsStateService,
  type ProviderAccountActionKind,
  type ProviderAccountActionOutcome,
} from '@ptah-extension/core';
import {
  PROVIDER_ACCOUNT_RESERVED_LABEL,
  isSafeProviderAccountSummary,
  type ProviderAccountActionResult,
  type ProviderAccountScope,
  type ProviderAccountState,
  type ProviderAccountsSnapshot,
} from '@ptah-extension/shared';
import {
  AMBIENT_ROW_KEY,
  ATTENTION_STATES,
  STATE_LABEL,
  accountInitial,
  assignmentChips,
  orderedAccounts,
  useForModel,
} from './account-presentation';
import { AmbientAccountRowComponent } from './ambient-account-row.component';
import { AddAccountFormComponent } from './add-account-form.component';
import {
  AccountUseForComponent,
  USE_FOR_HEADING_ID,
  type UseForScopeText,
  type UseForSelection,
} from './account-use-for.component';
import {
  ACCOUNT_NAME_SAVED,
  ACCOUNT_STATUS_UNAVAILABLE,
  ACCOUNT_UNCONFIRMED_WARNING,
  AccountDetailViewComponent,
  type AccountDetailTab,
  type AccountRenameRequest,
} from './account-detail-view.component';

const PROVIDER = 'claude' as const;

/** Design §3.5 / §3.7 copy. */
export const ACCOUNT_ADDED_TOAST = 'Account added. It is not selected for any new chat or lane.';
export const SELECTION_REFUSED_FALLBACK =
  'Could not change this setting. That account is not available for Claude lanes right now.';
const ACTION_FALLBACK = 'This action did not complete. Refresh and try again.';
/** The open account left the host snapshot while focus was elsewhere. */
const ACCOUNT_GONE_TOAST = 'That account is no longer in the list.';
/** B-2 completion sentences for the live status; fixed text, never a name, email or path. */
export const SIGN_IN_STARTED_FEEDBACK = 'Sign-in started.';
export const SIGN_IN_CANCELLED_FEEDBACK = 'Sign-in cancelled.';
export const SIGNED_OUT_FEEDBACK = 'Signed out.';
export const STATUS_CHECKED_FEEDBACK = 'Status checked.';
/** The detail's live status: the B-2 waiting target of every detail action (account-detail-view). */
const DETAIL_WAITING_TARGET = '[data-testid="account-detail-live"]';
const SCOPE_NAME: Readonly<Record<ProviderAccountScope, string>> = {
  main: 'New chats',
  lane: 'Claude lanes',
};
const NO_TEXT: UseForScopeText = { main: null, lane: null };

/** Row "Sign in" is offered for these states (design §3.3). */
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

type TabView =
  | { readonly kind: 'list' }
  | { readonly kind: 'detail'; readonly profileId: string; readonly initialTab: AccountDetailTab };

/** The last finished detail action of one account: a refusal for the alert slot or a live-status sentence. */
interface DetailOutcome {
  readonly profileId: string;
  readonly refusal: ProviderAccountActionResult | null;
  readonly feedback: string | null;
}

/** B-2: the exact element that held focus when an operation started, and the view it belonged to. */
interface FocusWait {
  readonly target: Element;
  readonly view: TabView;
}

/**
 * The connection drawer's Accounts tab (plan §12, design §3). Owns the load, the list/detail switch, every write
 * and its feedback; the children are presentational. Rows, selects and chips come from the last authoritative
 * host snapshot only: a write never changes them locally, and removing an account never assigns a selection
 * (binding rule B-1). Busy state is set in the same handler that receives the intent, before anything async, so a
 * child moves focus before its control is disabled. After an async result, focus returns only if it is still on
 * the waiting target and that view is still shown; otherwise it stays and the polite region announces (B-2).
 * Leaving the tab or closing the drawer never cancels a sign-in: the state service owns operations.
 */
@Component({
  selector: 'ptah-accounts-tab',
  standalone: true,
  imports: [
    AccountUseForComponent,
    AmbientAccountRowComponent,
    AddAccountFormComponent,
    AccountDetailViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view().status !== 'inert') {
      <div
        role="region"
        class="space-y-4 text-xs text-base-content"
        data-testid="accounts-tab"
        [attr.aria-labelledby]="useForShown() ? useForHeadingId : null"
        [attr.aria-label]="useForShown() ? null : 'Claude accounts'"
        [attr.aria-busy]="regionBusy()"
      >
        @if (view().status === 'error' && !snapshot()) {
          <div
            role="alert"
            class="flex flex-wrap items-center gap-2 rounded-box border border-error bg-base-200 px-3 py-2"
            data-testid="accounts-tab-error"
          >
            <span class="min-w-0 flex-1 break-words">Accounts could not be loaded.</span>
            <button type="button" [class]="'btn btn-outline btn-xs min-h-[30px] ' + focusRing" (click)="retry()">
              Try again
            </button>
          </div>
        } @else if (!snapshot()) {
          <p class="text-base-content-muted" data-testid="accounts-tab-loading">
            {{ view().status === 'idle' ? 'Accounts load when a workspace is open.' : 'Loading accounts…' }}
          </p>
        }

        @if (snapshot() && view().stale) {
          <div
            role="status"
            class="flex flex-wrap items-center gap-2 rounded-box border border-warning bg-base-200 px-3 py-2"
            data-testid="accounts-tab-stale"
          >
            <span class="min-w-0 flex-1 break-words">Showing the last loaded accounts. The latest refresh failed.</span>
            <button
              type="button"
              [class]="'btn btn-outline btn-xs min-h-[30px] ' + focusRing"
              [disabled]="view().status === 'loading'"
              (click)="retry()"
            >
              Try again
            </button>
          </div>
        }

        <!-- Design §3.1 / §3.6: the detail view replaces the tab body, so "Use for" is not rendered while it is open. -->
        @if (useForShown() && model(); as useFor) {
          <ptah-account-use-for
            [model]="useFor"
            [pendingScopes]="pendingScopes()"
            [messages]="scopeMessages()"
            [alerts]="scopeAlerts()"
            (selectionRequested)="select($event)"
          />
        }

        <p
          #toastEl
          role="status"
          aria-live="polite"
          tabindex="-1"
          class="min-h-4 break-words outline-none"
          data-testid="accounts-tab-toast"
        >{{ toast() }}</p>
        @if (alert(); as message) {
          <p role="alert" class="break-words text-error" data-testid="accounts-tab-alert">{{ message }}</p>
        }

        @if (snapshot(); as current) {
          @if (detailAccount(); as account) {
            <div #detailArea data-testid="accounts-tab-detail">
              <ptah-account-detail-view
                [account]="account"
                [accounts]="current.accounts"
                [operation]="operations()[account.profileId] ?? null"
                [fallback]="fallbacks()[account.profileId] ?? null"
                [busy]="busy().get(account.profileId) ?? null"
                [refusal]="detailRefusal()"
                [feedback]="detailFeedback()"
                [initialTab]="detailInitialTab()"
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
            <h3
              #accountsHeading
              tabindex="-1"
              class="text-sm font-semibold outline-none"
              data-testid="accounts-tab-heading"
            >Accounts</h3>
            <ul role="list" aria-label="Claude accounts" class="space-y-2" data-testid="accounts-tab-list">
              <li>
                <ptah-ambient-account-row
                  [ambient]="ambientView()"
                  [chips]="chips().get(ambientKey) ?? []"
                  (checkRequested)="checkAmbient()"
                />
              </li>
              @for (row of rows(); track row.account.profileId) {
                <li
                  [class]="'flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-100 p-2 ' +
                    (row.attention ? 'border-l-4 border-l-state-err' : '')"
                  data-testid="accounts-tab-row"
                >
                  <div
                    role="button"
                    tabindex="0"
                    [class]="'flex min-h-[34px] min-w-0 flex-1 basis-40 cursor-pointer items-center gap-2 rounded ' + focusRing"
                    [attr.aria-label]="'Account details for ' + row.account.label"
                    (click)="openDetail(row.account.profileId)"
                    (keydown)="rowKey($event, row.account.profileId)"
                    data-testid="accounts-tab-row-body"
                  >
                    <span
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-300 font-bold"
                      aria-hidden="true"
                    >{{ row.initial }}</span>
                    <span class="min-w-0 flex-1 space-y-0.5">
                      <span
                        class="block break-words font-semibold"
                        [title]="row.account.label"
                        data-testid="accounts-tab-row-name"
                      >{{ row.account.label }}</span>
                      <span class="flex min-w-0 items-center text-base-content-muted">
                        <span [class]="'mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full ' + row.dot" aria-hidden="true"></span>
                        <span data-testid="accounts-tab-row-state">{{ row.status }}</span>
                      </span>
                      @if (row.runs) {
                        <span class="block text-base-content-muted">{{ row.runs }}</span>
                      }
                      @if (row.chips.length > 0) {
                        <span class="flex min-w-0 flex-wrap gap-1" data-testid="accounts-tab-row-chips">
                          @for (chip of row.chips; track chip) {
                            <span
                              class="badge badge-ghost badge-sm h-auto max-w-full whitespace-normal break-words text-left"
                              data-testid="accounts-tab-row-chip"
                            >{{ chip }}</span>
                          }
                        </span>
                      }
                    </span>
                  </div>
                  <div class="ml-auto flex shrink-0 items-center gap-1" data-testid="accounts-tab-row-actions">
                    @if (row.canSignIn) {
                      <button
                        type="button"
                        [class]="'btn btn-primary btn-xs min-h-[30px] ' + focusRing"
                        [attr.aria-disabled]="row.busy"
                        (click)="rowSignIn(row.account.profileId)"
                        data-testid="accounts-tab-row-sign-in"
                      >Sign in</button>
                    }
                    <button
                      #manage
                      type="button"
                      [class]="'btn btn-ghost btn-xs min-h-[30px] ' + focusRing"
                      [attr.aria-label]="'Manage ' + row.account.label"
                      (click)="openDetail(row.account.profileId)"
                      data-testid="accounts-tab-row-manage"
                    >Manage</button>
                  </div>
                </li>
              }
            </ul>

            <div #addArea>
              @if (addOpen()) {
                <ptah-add-account-form
                  [accounts]="current.accounts"
                  [pending]="addPending()"
                  [refusal]="addRefusal()"
                  (submitted)="add($event)"
                  (cancelled)="cancelAdd()"
                />
              } @else {
                <button
                  #addButton
                  type="button"
                  [class]="'btn btn-outline btn-sm min-h-[30px] ' + focusRing"
                  (click)="openAdd()"
                  data-testid="accounts-tab-add"
                >Add another account</button>
              }
            </div>
          }
        } @else {
          <button
            type="button"
            [class]="'btn btn-outline btn-sm min-h-[30px] ' + focusRing"
            disabled
            data-testid="accounts-tab-add"
          >Add another account</button>
        }
      </div>
    }
  `,
})
export class AccountsTabComponent implements OnInit {
  private readonly accounts = inject(ProviderAccountsStateService);
  private readonly ambient = inject(ClaudeAmbientStatusService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private destroyed = false;

  protected readonly focusRing = FOCUS;
  protected readonly useForHeadingId = USE_FOR_HEADING_ID;
  protected readonly ambientKey = AMBIENT_ROW_KEY;

  protected readonly view = this.accounts.state(PROVIDER);
  protected readonly ambientView = this.ambient.view;
  protected readonly operations = this.accounts.operations(PROVIDER);
  protected readonly fallbacks = this.accounts.fallbacks(PROVIDER);

  protected readonly tabView = signal<TabView>({ kind: 'list' });
  /** Busy rule (a): one entry per scope whose write is in flight. */
  protected readonly pendingScopes = signal<ReadonlySet<ProviderAccountScope>>(new Set());
  protected readonly scopeMessages = signal<UseForScopeText>(NO_TEXT);
  protected readonly scopeAlerts = signal<UseForScopeText>(NO_TEXT);
  /** Busy rule (b): the running action per account. */
  protected readonly busy = signal<ReadonlyMap<string, ProviderAccountActionKind>>(new Map());
  private readonly detailOutcome = signal<DetailOutcome | null>(null);
  protected readonly addOpen = signal(false);
  protected readonly addPending = signal(false);
  protected readonly addRefusal = signal<string | null>(null);
  protected readonly toast = signal<string | null>(null);
  protected readonly alert = signal<string | null>(null);

  protected readonly snapshot = computed(() => this.view().snapshot);
  protected readonly model = computed(() => {
    const snapshot = this.snapshot();
    return snapshot ? useForModel(snapshot, this.ambientView()) : null;
  });
  protected readonly chips = computed(() => {
    const snapshot = this.snapshot();
    return snapshot ? assignmentChips(snapshot) : new Map<string, readonly string[]>();
  });
  protected readonly regionBusy = computed(
    () => this.view().status === 'loading' || this.ambientView().status === 'checking',
  );
  protected readonly rows = computed(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return [];
    const chips = this.chips();
    const busy = this.busy();
    return orderedAccounts(snapshot).map((account) => {
      const runs = account.activeRunCount;
      return {
        account,
        initial: accountInitial(account.label),
        status: STATE_LABEL[account.state],
        dot: ROW_DOT[account.state],
        attention: ATTENTION_STATES.has(account.state),
        canSignIn: SIGN_IN_STATES.has(account.state),
        busy: busy.has(account.profileId),
        runs: runs > 0 ? `Run binding · ${runs} active ${runs === 1 ? 'run' : 'runs'}` : null,
        chips: chips.get(account.profileId) ?? [],
      };
    });
  });
  protected readonly detailAccount = computed(() => {
    const current = this.tabView();
    if (current.kind !== 'detail') return null;
    return this.snapshot()?.accounts.find((account) => account.profileId === current.profileId) ?? null;
  });
  /** "Use for" renders only in the list view; the snapshot and its subscription stay live either way. */
  protected readonly useForShown = computed(() => this.model() !== null && this.detailAccount() === null);
  protected readonly detailInitialTab = computed(() => {
    const current = this.tabView();
    return current.kind === 'detail' ? current.initialTab : null;
  });
  private readonly shownOutcome = computed(() => {
    const outcome = this.detailOutcome();
    const current = this.tabView();
    return outcome && current.kind === 'detail' && outcome.profileId === current.profileId ? outcome : null;
  });
  protected readonly detailRefusal = computed(() => this.shownOutcome()?.refusal ?? null);
  protected readonly detailFeedback = computed(() => this.shownOutcome()?.feedback ?? null);

  private readonly toastEl = viewChild.required<ElementRef<HTMLElement>>('toastEl');
  private readonly accountsHeading = viewChild<ElementRef<HTMLElement>>('accountsHeading');
  private readonly detailArea = viewChild<ElementRef<HTMLElement>>('detailArea');
  private readonly addArea = viewChild<ElementRef<HTMLElement>>('addArea');
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');
  private readonly manageButtons = viewChildren<ElementRef<HTMLButtonElement>>('manage');

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // The open account left the authoritative snapshot (removal or a push): back to the list. Focus moves to the
    // "Accounts" heading only if it was inside the detail that is going away (B-2, P5-D11).
    effect(() => {
      const current = this.tabView();
      const snapshot = this.snapshot();
      if (current.kind !== 'detail' || !snapshot) return;
      if (snapshot.accounts.some((account) => account.profileId === current.profileId)) return;
      untracked(() => {
        const live = this.detailArea()?.nativeElement.querySelector(DETAIL_WAITING_TARGET) ?? null;
        const wait: FocusWait | null = live ? { target: live, view: current } : null;
        const focusOnTarget = this.stillWaiting(wait);
        const list: TabView = { kind: 'list' };
        this.tabView.set(list);
        if (focusOnTarget && wait) {
          this.focusAfterRender(() => this.accountsHeading()?.nativeElement, { target: wait.target, view: list });
        } else if (this.toast() === null) {
          this.toast.set(ACCOUNT_GONE_TOAST);
        }
      });
    });
  }

  ngOnInit(): void {
    // Design §2: both reads start when the tab opens, in parallel.
    void this.accounts.open(PROVIDER);
    void this.ambient.read(true);
  }

  protected retry(): void {
    void this.accounts.refresh(PROVIDER);
  }

  protected checkAmbient(): void {
    void this.ambient.read(true);
  }

  // --- list / detail ----------------------------------------------------------

  protected openDetail(profileId: string): void {
    const account = this.snapshot()?.accounts.find((entry) => entry.profileId === profileId);
    if (!account) return;
    this.tabView.set({
      kind: 'detail',
      profileId,
      initialTab: account.state === 'signed-in' ? 'overview' : 'access',
    });
  }

  protected rowKey(event: KeyboardEvent, profileId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openDetail(profileId);
  }

  /** "All accounts": back to the list, focus on that account's Manage button. */
  protected backToList(profileId: string): void {
    this.tabView.set({ kind: 'list' });
    this.focusAfterRender(() => {
      const index = this.rows().findIndex((row) => row.account.profileId === profileId);
      return index < 0 ? this.accountsHeading()?.nativeElement : this.manageButtons()[index]?.nativeElement;
    });
  }

  // --- add ----------------------------------------------------------------------

  protected openAdd(): void {
    this.addRefusal.set(null);
    this.addOpen.set(true);
  }

  protected cancelAdd(): void {
    if (this.addPending()) return;
    this.addOpen.set(false);
    this.addRefusal.set(null);
    this.focusAfterRender(() => this.addButton()?.nativeElement);
  }

  protected async add(label: string): Promise<void> {
    if (this.addPending()) return;
    // Busy in the receiving handler, before the first await.
    this.addPending.set(true);
    this.addRefusal.set(null);
    this.clearListFeedback();
    // The form moved focus to its own status before emitting: that element is the waiting target.
    const wait = this.captureWait(this.addArea()?.nativeElement);
    const known = new Set(this.snapshot()?.accounts.map((account) => account.profileId) ?? []);
    const outcome = await this.accounts.addAccount(PROVIDER, label);
    this.addPending.set(false);
    if (outcome.status === 'failed') {
      this.addRefusal.set(this.safe(outcome.result, ACTION_FALLBACK));
      return;
    }
    if (outcome.status === 'unavailable') {
      this.addRefusal.set(ACTION_FALLBACK);
      return;
    }
    const focusOnTarget = this.stillWaiting(wait);
    this.addOpen.set(false);
    if (outcome.status === 'unconfirmed') {
      this.toast.set(ACCOUNT_UNCONFIRMED_WARNING);
      if (focusOnTarget && wait) this.focusAfterRender(() => this.addButton()?.nativeElement, wait);
      return;
    }
    this.toast.set(ACCOUNT_ADDED_TOAST);
    const added = this.addedAccount(outcome.snapshot, known, label);
    if (added && focusOnTarget) {
      // The detail focuses its heading on open (design §3.5).
      this.tabView.set({ kind: 'detail', profileId: added, initialTab: 'access' });
    } else if (focusOnTarget && wait) {
      this.focusAfterRender(() => this.addButton()?.nativeElement, wait);
    }
  }

  // --- selections -----------------------------------------------------------------

  /** Writes one scope only. The select keeps showing the stored value until a host snapshot changes it. */
  protected async select(request: UseForSelection): Promise<void> {
    const { scope, choice } = request;
    if (this.pendingScopes().has(scope)) return;
    // Busy rule (a), in the receiving handler before the first await.
    this.pendingScopes.update((pending) => new Set([...pending, scope]));
    this.setScopeText(scope, null, null);
    this.clearListFeedback();
    const outcome = await this.accounts.setSelection(PROVIDER, scope, choice);
    this.pendingScopes.update((pending) => new Set([...pending].filter((entry) => entry !== scope)));
    switch (outcome.status) {
      case 'saved':
        this.toast.set(`${SCOPE_NAME[scope]} will use ${this.selectedName(outcome.snapshot, scope)} for new sessions.`);
        return;
      case 'failed':
        this.setScopeText(scope, null, this.safe(outcome.result, SELECTION_REFUSED_FALLBACK));
        return;
      case 'unconfirmed':
        this.setScopeText(scope, ACCOUNT_UNCONFIRMED_WARNING, null);
        return;
      case 'unavailable':
        this.setScopeText(scope, null, SELECTION_REFUSED_FALLBACK);
        return;
    }
  }

  // --- account actions --------------------------------------------------------------

  /** Row "Sign in": stays focusable (`aria-disabled`) while the account is busy, so focus is never stranded. */
  protected rowSignIn(profileId: string): void {
    if (this.busy().has(profileId)) return;
    void this.signIn(profileId);
  }

  protected signIn(profileId: string): Promise<void> {
    return this.run('sign-in', profileId, () => this.accounts.startSignIn(PROVIDER, profileId), {
      feedback: SIGN_IN_STARTED_FEEDBACK,
    });
  }

  protected cancelSignIn(profileId: string): Promise<void> {
    return this.run('cancel-sign-in', profileId, () => this.accounts.cancelSignIn(PROVIDER, profileId), {
      feedback: SIGN_IN_CANCELLED_FEEDBACK,
    });
  }

  protected signOut(profileId: string): Promise<void> {
    return this.run('sign-out', profileId, () => this.accounts.signOut(PROVIDER, profileId), {
      feedback: SIGNED_OUT_FEEDBACK,
    });
  }

  protected rename(request: AccountRenameRequest): Promise<void> {
    return this.run(
      'rename',
      request.profileId,
      () => this.accounts.renameAccount(PROVIDER, request.profileId, request.label),
      { feedback: ACCOUNT_NAME_SAVED },
    );
  }

  /** B-1: only the host's committed snapshot changes a selection that named this account. */
  protected remove(profileId: string): Promise<void> {
    const label = this.snapshot()?.accounts.find((account) => account.profileId === profileId)?.label;
    return this.run('remove', profileId, () => this.accounts.removeAccount(PROVIDER, profileId), {
      toast: label ? `${label} was removed.` : 'The account was removed.',
    });
  }

  /**
   * A status re-read. It holds the account's busy state like a write (busy rule b) and announces its result;
   * the rows still change only through host snapshots.
   */
  protected async checkStatus(profileId: string): Promise<void> {
    if (this.busy().has(profileId)) return;
    this.startBusy(profileId, 'check-status');
    let outcome: Awaited<ReturnType<ProviderAccountsStateService['refreshAccountStatus']>>;
    try {
      outcome = await this.accounts.refreshAccountStatus(PROVIDER, profileId);
    } finally {
      this.endBusy(profileId);
    }
    const inDetail = this.detailAccount()?.profileId === profileId;
    switch (outcome.status) {
      case 'read':
        this.detailOutcome.set({ profileId, refusal: null, feedback: STATUS_CHECKED_FEEDBACK });
        if (!inDetail) this.toast.set(STATUS_CHECKED_FEEDBACK);
        return;
      case 'failed':
        this.detailOutcome.set({ profileId, refusal: outcome.result, feedback: null });
        if (!inDetail) this.alert.set(this.safe(outcome.result, ACCOUNT_STATUS_UNAVAILABLE));
        return;
      case 'unavailable':
        this.detailOutcome.set({ profileId, refusal: null, feedback: ACCOUNT_STATUS_UNAVAILABLE });
        if (!inDetail) this.alert.set(ACCOUNT_STATUS_UNAVAILABLE);
        return;
    }
  }

  private async run(
    kind: ProviderAccountActionKind,
    profileId: string,
    write: () => Promise<ProviderAccountActionOutcome>,
    saved: { readonly feedback?: string; readonly toast?: string } = {},
  ): Promise<void> {
    if (this.busy().has(profileId)) return;
    this.startBusy(profileId, kind);
    let outcome: ProviderAccountActionOutcome;
    try {
      outcome = await write();
    } finally {
      this.endBusy(profileId);
    }
    const inDetail = this.detailAccount()?.profileId === profileId;
    switch (outcome.status) {
      case 'saved':
        this.detailOutcome.set({ profileId, refusal: null, feedback: saved.feedback ?? null });
        // B-2: outside the detail the tab's polite status announces the completion instead.
        if (saved.toast) this.toast.set(saved.toast);
        else if (!inDetail && saved.feedback) this.toast.set(saved.feedback);
        return;
      case 'failed':
        this.detailOutcome.set({ profileId, refusal: outcome.result, feedback: null });
        if (!inDetail) this.alert.set(this.safe(outcome.result, ACTION_FALLBACK));
        return;
      case 'unconfirmed':
        this.detailOutcome.set({ profileId, refusal: null, feedback: ACCOUNT_UNCONFIRMED_WARNING });
        if (!inDetail) this.toast.set(ACCOUNT_UNCONFIRMED_WARNING);
        return;
      case 'unavailable':
        this.detailOutcome.set({ profileId, refusal: null, feedback: ACTION_FALLBACK });
        if (!inDetail) this.alert.set(ACTION_FALLBACK);
        return;
    }
  }

  /** Busy rule (b), set in the receiving handler before the first await. */
  private startBusy(profileId: string, kind: ProviderAccountActionKind): void {
    this.busy.update((all) => new Map(all).set(profileId, kind));
    this.detailOutcome.update((outcome) => (outcome?.profileId === profileId ? null : outcome));
    this.clearListFeedback();
  }

  private endBusy(profileId: string): void {
    this.busy.update((all) => {
      const next = new Map(all);
      next.delete(profileId);
      return next;
    });
  }

  // ------------------------------------------------------------------------------------

  private setScopeText(scope: ProviderAccountScope, message: string | null, alert: string | null): void {
    this.scopeMessages.update((all) => ({ ...all, [scope]: message }));
    this.scopeAlerts.update((all) => ({ ...all, [scope]: alert }));
  }

  private clearListFeedback(): void {
    this.toast.set(null);
    this.alert.set(null);
  }

  private selectedName(snapshot: ProviderAccountsSnapshot, scope: ProviderAccountScope): string {
    const selection = snapshot.selections[scope].selection;
    if (selection.kind !== 'named') return PROVIDER_ACCOUNT_RESERVED_LABEL;
    return (
      snapshot.accounts.find((account) => account.profileId === selection.profileId)?.label ??
      PROVIDER_ACCOUNT_RESERVED_LABEL
    );
  }

  /** The account the Add created: the one id the earlier snapshot did not hold, else the one with that name. */
  private addedAccount(snapshot: ProviderAccountsSnapshot, known: ReadonlySet<string>, label: string): string | null {
    const fresh = snapshot.accounts.filter((account) => !known.has(account.profileId));
    if (fresh.length === 1) return fresh[0].profileId;
    return snapshot.accounts.find((account) => account.label === label)?.profileId ?? null;
  }

  private safe(result: ProviderAccountActionResult, fallback: string): string {
    return isSafeProviderAccountSummary(result.summary) ? result.summary : fallback;
  }

  /** B-2: the focused element when an operation starts, if it lies inside `area`; never the document body. */
  private captureWait(area: HTMLElement | undefined): FocusWait | null {
    const active = this.document.activeElement;
    if (!active || active === this.document.body || !area?.contains(active)) return null;
    return { target: active, view: this.tabView() };
  }

  /** B-2: focus is still exactly on the waiting target and the view it was captured in is still shown. */
  private stillWaiting(wait: FocusWait | null): boolean {
    return (
      wait !== null &&
      !this.destroyed &&
      this.tabView() === wait.view &&
      wait.target.isConnected &&
      this.document.activeElement === wait.target
    );
  }

  /**
   * Moves focus after the next render. With `wait`, only if `wait.view` is still shown and focus has not moved
   * since: it is still on the waiting target, or that target was removed by this render and focus fell to the body.
   */
  private focusAfterRender(target: () => HTMLElement | undefined, wait?: FocusWait): void {
    if (this.destroyed) return;
    afterNextRender(
      () => {
        if (this.destroyed) return;
        if (wait && !this.untouchedSince(wait)) return;
        (target() ?? this.toastEl().nativeElement).focus();
      },
      { injector: this.injector },
    );
  }

  private untouchedSince(wait: FocusWait): boolean {
    if (this.tabView() !== wait.view) return false;
    const active = this.document.activeElement;
    if (active === wait.target) return true;
    return !wait.target.isConnected && (active === null || active === this.document.body);
  }
}
