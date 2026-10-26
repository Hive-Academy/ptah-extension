import type {
  ClaudeAmbientStatusView,
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
  ATTENTION_STATES,
  STATE_LABEL,
  UNAVAILABLE_ACCOUNT_OPTION,
  UNSAFE_ACCOUNT_NAME_MESSAGE,
  accountInitial,
  ambientAge,
  ambientRowModel,
  assignmentChips,
  connectedAccountCount,
  orderedAccounts,
  useForModel,
  validateAccountName,
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

  describe('useForModel', () => {
    it('shows omitted and explicit ambient selections as the existing login (R1)', () => {
      const model = useForModel(snapshot([WORK], { kind: 'omitted' }, { kind: 'ambient' }), CONNECTED);
      expect(model.main.value).toBe('ambient');
      expect(model.lane.value).toBe('ambient');
      expect(model.main.options[0]).toEqual({ value: 'ambient', label: 'Existing Claude login', disabled: false });
    });

    it('lists signed-in accounts enabled, then the others disabled with "(sign in first)"', () => {
      const model = useForModel(snapshot([TEAM, WORK]), IDLE);
      expect(model.main.options).toEqual([
        { value: 'ambient', label: 'Existing Claude login', disabled: false },
        { value: 'named:p-work-0001', label: 'Work', disabled: false },
        { value: 'named:p-team-0002', label: 'Team plan (sign in first)', disabled: true },
      ]);
    });

    it('suffixes the ambient option only from a ready host answer', () => {
      const label = (view: ClaudeAmbientStatusView) => useForModel(snapshot([]), view).main.options[0].label;
      expect(label(SIGNED_OUT)).toBe('Existing Claude login (not signed in)');
      expect(label(UNKNOWN)).toBe('Existing Claude login (status unknown)');
      expect(label(CONNECTED)).toBe('Existing Claude login');
      expect(label({ ...SIGNED_OUT, status: 'checking' })).toBe('Existing Claude login');
      expect(label(LOCAL_FAILURE)).toBe('Existing Claude login');
      expect(useForModel(snapshot([]), SIGNED_OUT).main.options[0].disabled).toBe(false);
    });

    it('selects a present named account by its id', () => {
      const model = useForModel(snapshot([WORK], { kind: 'named', profileId: WORK.profileId }), CONNECTED);
      expect(model.main.value).toBe('named:p-work-0001');
      expect(model.main.options.some((o) => o.value === 'unavailable')).toBe(false);
    });

    it('shows the disabled unavailable placeholder for any named id absent from the accounts (B-1)', () => {
      const model = useForModel(
        snapshot([WORK], { kind: 'named', profileId: 'p-gone-9999' }, { kind: 'omitted' }),
        CONNECTED,
      );
      expect(model.main.value).toBe('unavailable');
      expect(model.main.options[0]).toEqual({ value: 'unavailable', label: UNAVAILABLE_ACCOUNT_OPTION, disabled: true });
      expect(model.lane.value).toBe('ambient');
      expect(model.lane.options.some((o) => o.value === 'unavailable')).toBe(false);
    });

    it('after removal follows the host snapshot: omitted shows the existing login, a kept id shows unavailable', () => {
      const before = snapshot([WORK, SIDE], { kind: 'named', profileId: WORK.profileId });
      expect(useForModel(before, CONNECTED).main.value).toBe('named:p-work-0001');
      const hostOmitted = snapshot([SIDE], { kind: 'omitted' });
      expect(useForModel(hostOmitted, CONNECTED).main.value).toBe('ambient');
      const hostKeptId = snapshot([SIDE], { kind: 'named', profileId: WORK.profileId });
      expect(useForModel(hostKeptId, CONNECTED).main.value).toBe('unavailable');
    });
  });

  describe('assignmentChips', () => {
    it('puts omitted and ambient chips on the ambient row', () => {
      const chips = assignmentChips(snapshot([WORK], { kind: 'omitted' }, { kind: 'ambient' }));
      expect(chips.get('ambient')).toEqual(['Used for: New chats', 'Used for: Claude lanes']);
      expect(chips.get(WORK.profileId)).toBeUndefined();
    });

    it('puts named chips on that account', () => {
      const chips = assignmentChips(snapshot([WORK, SIDE], { kind: 'named', profileId: WORK.profileId }, { kind: 'named', profileId: SIDE.profileId }));
      expect(chips.get(WORK.profileId)).toEqual(['Used for: New chats']);
      expect(chips.get(SIDE.profileId)).toEqual(['Used for: Claude lanes']);
      expect(chips.get('ambient')).toBeUndefined();
    });

    it('stays unchanged while the snapshot is unchanged (an unconfirmed write applies nothing, R2)', () => {
      const held = snapshot([WORK, SIDE], { kind: 'named', profileId: WORK.profileId });
      const first = assignmentChips(held);
      // The attempted value never reaches the snapshot, so the same snapshot yields the same chips.
      expect(assignmentChips(held)).toEqual(first);
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

  describe('ambientRowModel', () => {
    it('shows Connected with its age', () => {
      expect(ambientRowModel(CONNECTED, NOW)).toEqual({
        tone: 'done',
        statusText: 'Connected',
        checking: false,
        extraText: null,
        ageText: 'Last checked 2 minutes ago',
      });
    });

    it('shows Not signed in with the CLI help', () => {
      const model = ambientRowModel(SIGNED_OUT, NOW);
      expect(model.tone).toBe('need');
      expect(model.statusText).toBe('Not signed in');
      expect(model.extraText).toBe('Sign in with the Claude CLI in a terminal. Ptah does not manage this login.');
    });

    it('shows Could not check with "Last check failed" for host unknown', () => {
      const model = ambientRowModel(UNKNOWN, NOW);
      expect(model.tone).toBe('idle');
      expect(model.statusText).toBe('Could not check');
      expect(model.extraText).toContain('This does not mean you are signed out.');
      expect(model.ageText).toBe('Last check failed 2 minutes ago');
    });

    it('never shows Connected or an age while checking, even with a stale connected result', () => {
      const model = ambientRowModel(CHECKING_STALE_CONNECTED, NOW);
      expect(model).toEqual({ tone: 'run', statusText: 'Checking…', checking: true, extraText: null, ageText: null });
    });

    it('shows Could not check with no age line for a local failure', () => {
      const model = ambientRowModel(LOCAL_FAILURE, NOW);
      expect(model.statusText).toBe('Could not check');
      expect(model.ageText).toBeNull();
    });

    it('shows no age line for a host answer with checkedAt null', () => {
      expect(ambientRowModel(ready({ state: 'connected', checkedAt: null }), NOW).ageText).toBeNull();
      expect(ambientRowModel(ready({ state: 'unknown', checkedAt: null, reason: 'cli-missing' }), NOW).ageText).toBeNull();
    });

    it('claims no result before the first read', () => {
      expect(ambientRowModel(IDLE, NOW).statusText).toBe('Not checked yet');
      expect(ambientRowModel(INERT, NOW).statusText).toBe('Not checked yet');
    });

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
