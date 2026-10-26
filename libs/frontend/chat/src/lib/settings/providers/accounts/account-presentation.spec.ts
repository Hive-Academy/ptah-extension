import type {
  ClaudeAmbientStatusView,
  ProviderAccountActionOutcome,
  ProviderAccountsView,
} from '@ptah-extension/core';
import {
  PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY,
  type ProviderAccountSelection,
  type ProviderAccountState,
  type ProviderAccountSummary,
  type ProviderAccountsSnapshot,
  type ProviderAmbientClaudeStatus,
} from '@ptah-extension/shared';
import {
  ACCOUNT_COPY,
  ATTENTION_STATES,
  STATE_LABEL,
  UNSAFE_ACCOUNT_NAME_MESSAGE,
  accountChoiceOf,
  accountInitial,
  accountSelectorModel,
  ambientAge,
  ambientStatusModel,
  connectedAccountCount,
  orderedAccounts,
  selectionFeedback,
  toastName,
  usedByChips,
  validateAccountName,
  type AccountFeedback,
  type AccountSelectorModel,
} from './account-presentation';

const account = (
  profileId: string,
  label: string,
  state: ProviderAccountState = 'signed-in',
): ProviderAccountSummary => ({
  profileId,
  label,
  provider: 'claude',
  state,
  owner: 'unknown',
  revision: 1,
  activeRunCount: 0,
});

const snapshot = (
  accounts: readonly ProviderAccountSummary[],
  main: ProviderAccountSelection = { kind: 'omitted' },
  lane: ProviderAccountSelection = { kind: 'omitted' },
): ProviderAccountsSnapshot => ({
  provider: 'claude',
  workspaceRoot: 'workspace',
  revision: 3,
  accounts,
  selections: {
    main: { scope: 'main', selection: main, revision: 1 },
    lane: { scope: 'lane', selection: lane, revision: 1 },
  },
});

const ready = (result: ProviderAmbientClaudeStatus): ClaudeAmbientStatusView => ({
  status: 'ready',
  result,
  localFailure: false,
});
const CHECKED_AT = '2026-10-26T10:00:00.000Z';
const NOW = Date.parse(CHECKED_AT) + 2 * 60_000;
const CONNECTED = ready({ state: 'connected', checkedAt: CHECKED_AT });
const SIGNED_OUT = ready({ state: 'signed-out', checkedAt: CHECKED_AT });
const UNKNOWN = ready({ state: 'unknown', checkedAt: CHECKED_AT, reason: 'timeout' });
const IDLE: ClaudeAmbientStatusView = { status: 'idle', result: null, localFailure: false };
const INERT: ClaudeAmbientStatusView = { status: 'inert', result: null, localFailure: false };
const LOCAL_FAILURE: ClaudeAmbientStatusView = { status: 'ready', result: null, localFailure: true };
/** A check in flight still carries the earlier result (F1 contract). */
const CHECKING_STALE_CONNECTED: ClaudeAmbientStatusView = { ...CONNECTED, status: 'checking' };

const WORK = account('p-work-0001', 'Work');
const TEAM = account('p-team-0002', 'Team plan', 'not-signed-in');
const SIDE = account('p-side-0003', 'Side', 'signed-in');

describe('account presentation', () => {
  describe('labels', () => {
    it('maps every host state and marks only failed and disconnected for attention', () => {
      expect(STATE_LABEL['signed-in']).toBe('Signed in');
      expect(STATE_LABEL['not-signed-in']).toBe('Not signed in');
      expect([...ATTENTION_STATES].sort()).toEqual(['disconnected', 'failed']);
    });

    it('takes the first visible letter as the initial', () => {
      expect(accountInitial('  work')).toBe('W');
      expect(accountInitial('   ')).toBe('?');
    });
  });

  it('orders signed-in accounts first, host order within each group', () => {
    const other = account('p-other-0004', 'Other', 'failed');
    expect(orderedAccounts(snapshot([TEAM, WORK, other, SIDE])).map((a) => a.label)).toEqual([
      'Work',
      'Side',
      'Team plan',
      'Other',
    ]);
  });

  describe('validateAccountName', () => {
    it('trims and accepts a new safe name', () => {
      expect(validateAccountName('  Personal  ', [WORK])).toEqual({ ok: true, label: 'Personal' });
    });

    it('gives no message for an empty name', () => {
      expect(validateAccountName('   ', [WORK])).toEqual({ ok: false, message: null });
    });

    it('refuses an unsafe name with the P5-D7 copy', () => {
      expect(validateAccountName('x'.repeat(65), [])).toEqual({ ok: false, message: UNSAFE_ACCOUNT_NAME_MESSAGE });
      expect(validateAccountName('a\nb', [])).toEqual({ ok: false, message: UNSAFE_ACCOUNT_NAME_MESSAGE });
      expect(validateAccountName('a/b: c & d', [])).toEqual({ ok: true, label: 'a/b: c & d' });
    });

    it('refuses duplicates case-insensitively and the reserved name', () => {
      const duplicate = { ok: false, message: PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY };
      expect(validateAccountName(' work ', [WORK])).toEqual(duplicate);
      expect(validateAccountName('existing claude LOGIN', [])).toEqual(duplicate);
    });

    it('lets a rename keep its own name with a case change', () => {
      expect(validateAccountName('WORK', [WORK], WORK.profileId)).toEqual({ ok: true, label: 'WORK' });
      expect(validateAccountName('side', [WORK, SIDE], WORK.profileId)).toEqual({
        ok: false,
        message: PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY,
      });
    });
  });

  describe('ambientAge', () => {
    it('bands the age like checkedAgo', () => {
      const at = Date.parse(CHECKED_AT);
      expect(ambientAge(CHECKED_AT, at + 10_000)).toBe('just now');
      expect(ambientAge(CHECKED_AT, at + 60_000)).toBe('1 minute ago');
      expect(ambientAge(CHECKED_AT, at + 3 * 3_600_000)).toBe('3 hours ago');
      expect(ambientAge(CHECKED_AT, at + 48 * 3_600_000)).toMatch(/^on /);
      expect(ambientAge('not a time', at)).toBeNull();
    });
  });

  describe('connectedAccountCount', () => {
    const accountsReady = (accounts: readonly ProviderAccountSummary[]): ProviderAccountsView => ({
      status: 'ready',
      snapshot: snapshot(accounts),
      stale: false,
      error: null,
    });
    const twoSignedIn = accountsReady([WORK, SIDE, TEAM]);

    it.each<[string, ClaudeAmbientStatusView, number | null]>([
      ['idle', IDLE, null],
      ['inert', INERT, null],
      ['checking', CHECKING_STALE_CONNECTED, null],
      ['local transport failure', LOCAL_FAILURE, null],
      ['host unknown', UNKNOWN, null],
      ['signed-out', SIGNED_OUT, 2],
      ['connected', CONNECTED, 3],
    ])('with two signed-in named accounts and ambient %s -> %p', (_name, ambient, expected) => {
      expect(connectedAccountCount(twoSignedIn, ambient)).toBe(expected);
    });

    it('is null while the accounts are loading, failed or stale', () => {
      const loading: ProviderAccountsView = { status: 'loading', snapshot: null, stale: false, error: null };
      const failed: ProviderAccountsView = { ...twoSignedIn, status: 'error', snapshot: null };
      const stale: ProviderAccountsView = { ...twoSignedIn, stale: true };
      expect(connectedAccountCount(loading, CONNECTED)).toBeNull();
      expect(connectedAccountCount(failed, CONNECTED)).toBeNull();
      expect(connectedAccountCount(stale, CONNECTED)).toBeNull();
    });

    it('is 0 (hidden) with no signed-in account and ambient signed-out', () => {
      expect(connectedAccountCount(accountsReady([TEAM]), SIGNED_OUT)).toBe(0);
    });

    it('recovers after an ambient failure and follows a pushed snapshot', () => {
      expect(connectedAccountCount(twoSignedIn, LOCAL_FAILURE)).toBeNull();
      expect(connectedAccountCount(twoSignedIn, CONNECTED)).toBe(3);
      const pushed = accountsReady([WORK, { ...SIDE, state: 'signed-out' }, TEAM]);
      expect(connectedAccountCount(pushed, CONNECTED)).toBe(2);
    });
  });
});

describe('account presentation (P6)', () => {
  const view = (
    snap: ProviderAccountsSnapshot | null,
    overrides: Partial<ProviderAccountsView> = {},
  ): ProviderAccountsView => ({ status: 'ready', snapshot: snap, stale: false, error: null, ...overrides });
  const model = (
    snap: ProviderAccountsSnapshot,
    scope: 'main' | 'lane' = 'main',
    ambient: ClaudeAmbientStatusView = CONNECTED,
  ): AccountSelectorModel => {
    const result = accountSelectorModel(view(snap), ambient, scope);
    if (!result) throw new Error('expected a selector model');
    return result;
  };

  describe('accountSelectorModel', () => {
    it.each<[string, ProviderAccountsView]>([
      ['inert host', view(snapshot([WORK]), { status: 'inert' })],
      ['idle', view(null, { status: 'idle' })],
      ['first load', view(null, { status: 'loading' })],
      ['first read failed', view(null, { status: 'error' })],
    ])('is null while not ready (%s)', (_name, accountsView) => {
      expect(accountSelectorModel(accountsView, CONNECTED, 'main')).toBeNull();
    });

    it('keeps the control on a stale snapshot', () => {
      const stale = view(snapshot([WORK]), { stale: true, status: 'error' });
      expect(accountSelectorModel(stale, CONNECTED, 'main')?.value).toBe('ambient');
    });

    it('hides the control when nothing is signed in and the stored selection is the existing login', () => {
      const result = model(snapshot([TEAM]));
      expect(result.visible).toBe(false);
      expect(result.stored).toEqual({ kind: 'ambient' });
      expect(result.options).toEqual([
        { value: 'ambient', label: 'Existing Claude login', disabled: false },
        { value: 'named:p-team-0002', label: 'Team plan (sign in first)', disabled: true },
      ]);
    });

    it('orders ambient, signed-in accounts, then disabled accounts that need sign-in', () => {
      const result = model(snapshot([WORK, TEAM, SIDE]));
      expect(result.visible).toBe(true);
      expect(result.value).toBe('ambient');
      expect(result.selectedText).toBe('Existing Claude login');
      expect(result.options.map((option) => [option.value, option.label, option.disabled])).toEqual([
        ['ambient', 'Existing Claude login', false],
        ['named:p-work-0001', 'Work', false],
        ['named:p-side-0003', 'Side', false],
        ['named:p-team-0002', 'Team plan (sign in first)', true],
      ]);
    });

    it('reads an explicit ambient selection like an omitted one', () => {
      const result = model(snapshot([WORK], { kind: 'ambient' }));
      expect(result.stored).toEqual({ kind: 'ambient' });
      expect(result.value).toBe('ambient');
    });

    it.each<[string, ClaudeAmbientStatusView, string]>([
      ['connected', CONNECTED, 'Existing Claude login'],
      ['signed-out', SIGNED_OUT, 'Existing Claude login (not signed in)'],
      ['unknown', UNKNOWN, 'Existing Claude login (status unknown)'],
      ['checking', CHECKING_STALE_CONNECTED, 'Existing Claude login'],
      ['idle', IDLE, 'Existing Claude login'],
      ['inert', INERT, 'Existing Claude login'],
      ['local failure', LOCAL_FAILURE, 'Existing Claude login'],
    ])('takes the ambient suffix only from a ready host answer (%s)', (_name, ambient, label) => {
      expect(model(snapshot([WORK]), 'main', ambient).options[0].label).toBe(label);
    });

    it('selects a signed-in stored account per scope', () => {
      const snap = snapshot([WORK, SIDE], { kind: 'named', profileId: WORK.profileId });
      const main = model(snap, 'main');
      expect(main.stored).toEqual({ kind: 'named', profileId: WORK.profileId, label: 'Work' });
      expect(main.value).toBe('named:p-work-0001');
      expect(main.selectedText).toBe('Work');
      expect(model(snap, 'lane').value).toBe('ambient');
    });

    it('shows a signed-out stored account as the selected disabled first option, once', () => {
      const snap = snapshot([TEAM], { kind: 'omitted' }, { kind: 'named', profileId: TEAM.profileId });
      const result = model(snap, 'lane');
      expect(result.visible).toBe(true);
      expect(result.stored).toEqual({ kind: 'signed-out', profileId: TEAM.profileId, label: 'Team plan' });
      expect(result.value).toBe('stored');
      expect(result.selectedText).toBe('Team plan (not signed in)');
      expect(result.options).toEqual([
        { value: 'stored', label: 'Team plan (not signed in)', disabled: true },
        { value: 'ambient', label: 'Existing Claude login', disabled: false },
      ]);
    });

    it('shows a removed stored account without reassigning it (B-1)', () => {
      const result = model(snapshot([TEAM], { kind: 'named', profileId: 'p-gone-0009' }));
      expect(result.visible).toBe(true);
      expect(result.stored).toEqual({ kind: 'removed', profileId: 'p-gone-0009' });
      expect(result.value).toBe('stored');
      expect(result.selectedText).toBe('⚠ Removed account');
      expect(result.options.map((option) => option.value)).toEqual(['stored', 'ambient', 'named:p-team-0002']);
      expect(result.options[0].disabled).toBe(true);
    });
  });

  describe('accountChoiceOf', () => {
    it('maps selector values to the written choice; the stored placeholder writes nothing', () => {
      expect(accountChoiceOf('ambient')).toEqual({ kind: 'ambient' });
      expect(accountChoiceOf('named:p-work-0001')).toEqual({ kind: 'named', profileId: 'p-work-0001' });
      expect(accountChoiceOf('named:a:b')).toEqual({ kind: 'named', profileId: 'a:b' });
      expect(accountChoiceOf('stored')).toBeNull();
    });
  });

  describe('toastName', () => {
    it('keeps 40 characters and truncates longer names with an ellipsis', () => {
      const forty = 'a'.repeat(40);
      expect(toastName('Work')).toBe('Work');
      expect(toastName(forty)).toBe(forty);
      expect(toastName(`${forty}b`)).toBe(`${forty}…`);
    });

    it('counts code points, so a surrogate pair is never split', () => {
      const name = `${'a'.repeat(39)}\u{1F600}\u{1F600}`;
      expect(toastName(name)).toBe(`${'a'.repeat(39)}\u{1F600}…`);
    });
  });

  describe('selectionFeedback', () => {
    const saved = (snap: ProviderAccountsSnapshot): ProviderAccountActionOutcome => ({
      status: 'saved',
      snapshot: snap,
    });
    const failed = (summary: string): ProviderAccountActionOutcome => ({
      status: 'failed',
      result: { code: 'conflict', summary },
    });
    const LONG = account('p-long-0004', 'L'.repeat(45));
    const SAFE = 'Someone changed this. Try again.';
    const status = (message: string): AccountFeedback => ({ message, tone: 'status' });
    const alert = (message: string): AccountFeedback => ({ message, tone: 'alert' });

    it.each<[string, ProviderAccountActionOutcome, 'main' | 'lane', boolean, AccountFeedback | null]>([
      ['saved named, main', saved(snapshot([WORK], { kind: 'named', profileId: WORK.profileId })), 'main', true, status('Chat uses Work')],
      [
        'saved named, lane',
        saved(snapshot([WORK], { kind: 'omitted' }, { kind: 'named', profileId: WORK.profileId })),
        'lane',
        false,
        status('Lanes use Work'),
      ],
      ['saved ambient', saved(snapshot([WORK], { kind: 'ambient' })), 'main', false, status('Chat uses Existing Claude login')],
      ['saved long name', saved(snapshot([LONG], { kind: 'named', profileId: LONG.profileId })), 'main', false, status(`Chat uses ${'L'.repeat(40)}…`)],
      ['saved, named profile not listed', saved(snapshot([], { kind: 'named', profileId: 'p-gone-0009' })), 'main', false, null],
      ['failed after a provider save', failed(SAFE), 'main', true, alert('Provider saved. Account not saved.')],
      ['failed with a safe host sentence', failed(SAFE), 'lane', false, alert(SAFE)],
      ['failed with an unsafe host sentence', failed('/home/user/.claude leaked'), 'lane', false, alert('Could not save the account. Try again.')],
      ['unavailable after a provider save', { status: 'unavailable' }, 'main', true, alert('Provider saved. Account not saved.')],
      ['unavailable', { status: 'unavailable' }, 'lane', false, alert('Could not save the account. Try again.')],
      ['unconfirmed after a provider save', { status: 'unconfirmed' }, 'main', true, alert('May not have saved. Accounts reloaded.')],
      ['unconfirmed', { status: 'unconfirmed' }, 'lane', false, alert('May not have saved. Accounts reloaded.')],
    ])('%s', (_name, outcome, scope, providerSaved, expected) => {
      expect(selectionFeedback(outcome, scope, { providerSaved })).toEqual(expected);
    });

    it('never reports an unconfirmed write as not saved', () => {
      for (const providerSaved of [true, false]) {
        const feedback = selectionFeedback({ status: 'unconfirmed' }, 'main', { providerSaved });
        expect(feedback?.message).not.toMatch(/not saved/i);
      }
    });
  });

  describe('usedByChips', () => {
    it('keys chips by row, Chat before Lanes, from the snapshot selections only', () => {
      expect(usedByChips(snapshot([WORK])).get('ambient')).toEqual(['Chat', 'Lanes']);
      const named = { kind: 'named', profileId: WORK.profileId } as const;
      const split = usedByChips(snapshot([WORK, SIDE], named, { kind: 'ambient' }));
      expect(split.get(WORK.profileId)).toEqual(['Chat']);
      expect(split.get('ambient')).toEqual(['Lanes']);
      expect(split.get(SIDE.profileId)).toBeUndefined();
      const both = usedByChips(snapshot([WORK], named, named));
      expect(both.get(WORK.profileId)).toEqual(['Chat', 'Lanes']);
      expect(both.has('ambient')).toBe(false);
    });
  });

  describe('ambientStatusModel', () => {
    const SIGNED_OUT_CUE = 'Sign in with the Claude CLI in a terminal.';
    const UNKNOWN_CUE = 'The status could not be read. This does not mean you are signed out.';

    it.each<[string, ClaudeAmbientStatusView, ReturnType<typeof ambientStatusModel>]>([
      ['idle', IDLE, { tone: 'idle', word: 'Not checked yet', checking: false, hint: null }],
      ['inert', INERT, { tone: 'idle', word: 'Not checked yet', checking: false, hint: null }],
      ['checking, never Signed in', CHECKING_STALE_CONNECTED, { tone: 'run', word: 'Checking…', checking: true, hint: null }],
      ['connected', CONNECTED, { tone: 'done', word: 'Signed in', checking: false, hint: 'Last checked 2 minutes ago.' }],
      ['signed-out', SIGNED_OUT, { tone: 'need', word: 'Not signed in', checking: false, hint: `${SIGNED_OUT_CUE} Last checked 2 minutes ago.` }],
      ['host unknown', UNKNOWN, { tone: 'idle', word: 'Status unknown', checking: false, hint: `${UNKNOWN_CUE} Last check failed 2 minutes ago.` }],
      ['local failure, no age', LOCAL_FAILURE, { tone: 'idle', word: 'Status unknown', checking: false, hint: UNKNOWN_CUE }],
    ])('%s', (_name, ambient, expected) => {
      expect(ambientStatusModel(ambient, NOW)).toEqual(expected);
    });

    it('gives no age without a host checkedAt', () => {
      expect(ambientStatusModel(ready({ state: 'connected', checkedAt: null }), NOW).hint).toBeNull();
      expect(ambientStatusModel(ready({ state: 'signed-out', checkedAt: null }), NOW).hint).toBe(SIGNED_OUT_CUE);
    });
  });

  describe('ACCOUNT_COPY', () => {
    it('carries the design copy verbatim', () => {
      expect(ACCOUNT_COPY.accountGone).toBe('That account is no longer in the list');
      expect(ACCOUNT_COPY.hostUnsupported).toBe('Named accounts are not available on this host.');
      expect(ACCOUNT_COPY.removedAccount).toBe('The saved account no longer exists. Choose another account.');
      expect(ACCOUNT_COPY.signInLocked).toBe('Locked while sign-in is in progress.');
      expect(ACCOUNT_COPY.resumeUnavailable).toBe('Runs bound to this account cannot resume until it is signed in again.');
      expect(ACCOUNT_COPY.notAvailableOnHost).toBe('Not available on this host');
      expect(ACCOUNT_COPY.nameTaken).toBe('That name is already used.');
    });
  });
});
