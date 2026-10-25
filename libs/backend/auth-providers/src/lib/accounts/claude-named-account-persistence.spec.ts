import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionMetadata } from '@ptah-extension/agent-sdk';
import type { ClaudeAccountNamedRoute, ClaudeAccountRunReservation, ClaudeCertifiedLaunchContext,
  ClaudeLaunchBoundaryOutcome } from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding } from '@ptah-extension/shared';
import { ClaudeNamedAccountPersistence } from './claude-named-account-persistence';
import type { ProviderAccountStateChange } from './provider-account-actions.service';
import type { AccountBindingLookup, StoredProviderAccount } from './provider-account.store';
import { ProviderAccountStoreError, resolveProviderAccountRoute } from './provider-account-route';

const PROFILE_ID = 'account_12345678';
const RUN_ID = 'run_12345678';
const OWNER_KEY = 'b'.repeat(64);

let dir: string;
let canonicalPath: string;
let fingerprint: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ptah-named-persistence-'));
  const resolved = resolveProviderAccountRoute(dir);
  canonicalPath = resolved.canonicalPath;
  fingerprint = resolved.fingerprint;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function namedRoute(overrides: Partial<ClaudeAccountNamedRoute> = {}): ClaudeAccountNamedRoute {
  return { kind: 'named', provider: 'claude', profileId: PROFILE_ID, canonicalConfigDir: canonicalPath,
    routeFingerprint: fingerprint, routeRevision: 2, authEpoch: 3, runId: RUN_ID, ...overrides } as ClaudeAccountNamedRoute;
}

function storedProfile(overrides: Partial<StoredProviderAccount> = {}): StoredProviderAccount {
  return { profile_id: PROFILE_ID, provider: 'claude', label: 'Work', canonical_route: canonicalPath,
    route_fingerprint: fingerprint, physical_identity: '{}', revision: 1, route_revision: 2, auth_epoch: 3,
    state: 'signed-in', removed_at: null, identity_ref: 'ref-1', ...overrides };
}

function binding(overrides: Partial<ProviderAccountBinding> = {}): ProviderAccountBinding {
  return { version: 1, provider: 'claude', profileId: PROFILE_ID, routeRevision: 2, routeFingerprint: fingerprint,
    authEpoch: 3, runId: RUN_ID, identity: { kind: 'known', ownerKey: OWNER_KEY }, ...overrides };
}

function launchFor(cwd: string): ClaudeCertifiedLaunchContext {
  return { cwd } as unknown as ClaudeCertifiedLaunchContext;
}

function setup(profile: () => StoredProviderAccount = () => storedProfile()) {
  let stateListener: ((change: ProviderAccountStateChange) => void) | undefined;
  const unsubscribe = jest.fn();
  const accounts = {
    commitRunBinding: jest.fn(async () => binding()),
    attachSdkSession: jest.fn(async () => ({ status: 'attached' as const })),
    lookupBySdkSession: jest.fn(async (): Promise<AccountBindingLookup> => ({ status: 'bound', binding: binding() })),
    lookupRunBinding: jest.fn(async (): Promise<AccountBindingLookup> => ({ status: 'bound', binding: binding() })),
  };
  const store = { get: jest.fn(profile) };
  const metadata = {
    saveAccountBound: jest.fn(async () => undefined),
    resolveAccountBinding: jest.fn(async (id: string, lookup: (sdkSessionId: string) => Promise<AccountBindingLookup>) => {
      const found = await lookup(id);
      return found.status === 'bound' ? found.binding : null;
    }),
  };
  const actions = {
    onStateChanged: jest.fn((listener: (change: ProviderAccountStateChange) => void) => {
      stateListener = listener;
      return unsubscribe;
    }),
  };
  const certifier = {
    checkLaunch: jest.fn(async (_launch: ClaudeCertifiedLaunchContext, _signal: AbortSignal):
      Promise<ClaudeLaunchBoundaryOutcome> => ({ ok: true })),
  };
  const persistence = new ClaudeNamedAccountPersistence(accounts, store, metadata, actions, certifier);
  return { persistence, accounts, store, metadata, actions, certifier, unsubscribe,
    emit: (change: ProviderAccountStateChange) => stateListener?.(change) };
}

describe('ClaudeNamedAccountPersistence.checkLaunchBoundary', () => {
  it('returns ok after revalidation and the certifier launch check', async () => {
    const { persistence, certifier } = setup();
    const launch = launchFor(canonicalPath);
    const signal = new AbortController().signal;

    await expect(persistence.checkLaunchBoundary(namedRoute(), launch, 'bootstrap', signal)).resolves.toEqual({ ok: true });
    expect(certifier.checkLaunch).toHaveBeenCalledTimes(1);
    expect(certifier.checkLaunch).toHaveBeenCalledWith(launch, signal);
  });

  it.each([
    { ok: false, code: 'unsupported-source', terminated: true },
    { ok: false, code: 'unsupported-source', terminated: false },
    { ok: false, code: 'identity-unproved', terminated: false },
  ] as const)('passes a certifier refusal through unchanged (%o)', async (refusal) => {
    const { persistence, certifier } = setup();
    certifier.checkLaunch.mockResolvedValueOnce(refusal);

    const outcome = await persistence.checkLaunchBoundary(namedRoute(), launchFor(canonicalPath), 'final',
      new AbortController().signal);
    expect(outcome).toBe(refusal);
  });

  it.each([
    // Table rows are built before `beforeAll`, so the route is a factory.
    ['the stored epoch advanced', () => storedProfile({ auth_epoch: 4 }), () => namedRoute()],
    ['the stored route revision changed', () => storedProfile({ route_revision: 5 }), () => namedRoute()],
    ['the directory has another physical identity', () => storedProfile({ route_fingerprint: 'f'.repeat(64) }),
      () => namedRoute({ routeFingerprint: 'f'.repeat(64) })],
    ['the directory is gone', () => storedProfile(),
      () => namedRoute({ canonicalConfigDir: join(canonicalPath, 'missing') })],
    ['the profile was removed', () => { throw new ProviderAccountStoreError('missing-profile'); }, () => namedRoute()],
  ])('refuses route-changed without calling the certifier when %s', async (_name, profile, route) => {
    const { persistence, certifier } = setup(profile);

    await expect(persistence.checkLaunchBoundary(route(), launchFor(canonicalPath), 'bootstrap',
      new AbortController().signal)).resolves.toEqual({ ok: false, code: 'route-changed', terminated: true });
    expect(certifier.checkLaunch).not.toHaveBeenCalled();
  });

  it('refuses identity-unproved and retains when the certifier throws', async () => {
    const { persistence, certifier } = setup();
    certifier.checkLaunch.mockRejectedValueOnce(new Error('probe failed'));

    await expect(persistence.checkLaunchBoundary(namedRoute(), launchFor(canonicalPath), 'final',
      new AbortController().signal)).resolves.toEqual({ ok: false, code: 'identity-unproved', terminated: false });
  });

  it('checks each concurrent run against its own launch only', async () => {
    const { persistence, certifier } = setup();
    const first = launchFor(join(canonicalPath, 'a'));
    const second = launchFor(join(canonicalPath, 'b'));
    certifier.checkLaunch.mockImplementation(async (launch): Promise<ClaudeLaunchBoundaryOutcome> =>
      launch === first ? { ok: true } : { ok: false, code: 'unsupported-source', terminated: true });

    const [a, b] = await Promise.all([
      persistence.checkLaunchBoundary(namedRoute(), first, 'bootstrap', new AbortController().signal),
      persistence.checkLaunchBoundary(namedRoute({ runId: 'run_87654321' }), second, 'bootstrap',
        new AbortController().signal),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: false, code: 'unsupported-source', terminated: true });
  });
});

describe('ClaudeNamedAccountPersistence route and registry delegation', () => {
  it('assertRouteCurrent resolves for an unchanged route and rejects route-changed on an epoch change', async () => {
    await expect(setup().persistence.assertRouteCurrent(namedRoute())).resolves.toBeUndefined();
    await expect(setup(() => storedProfile({ auth_epoch: 9 })).persistence.assertRouteCurrent(namedRoute()))
      .rejects.toMatchObject({ code: 'route-changed' });
  });

  it('assertRouteCurrent keeps a storage refusal code', async () => {
    const { persistence } = setup(() => { throw new ProviderAccountStoreError('busy'); });
    await expect(persistence.assertRouteCurrent(namedRoute())).rejects.toMatchObject({ code: 'busy' });
  });

  it('commits the run binding with the lease keys of the same route', async () => {
    const { persistence, accounts } = setup();
    const reservation = { reservationId: 'res-1', operationId: 'op-1', phase: 'reserved', provider: 'claude',
      routeKind: 'named', routeFingerprint: fingerprint, routeRevision: 2, authEpoch: 3, kind: 'run', runId: RUN_ID,
    } satisfies ClaudeAccountRunReservation;
    const identity = { kind: 'known', ownerKey: OWNER_KEY } as const;

    await expect(persistence.commitRunBinding(namedRoute(), reservation, identity)).resolves.toEqual(binding());
    expect(accounts.commitRunBinding).toHaveBeenCalledWith({ reservationId: 'res-1', operationId: 'op-1', authEpoch: 3,
      runId: RUN_ID, identity });

    await expect(persistence.commitRunBinding(namedRoute(), { ...reservation, runId: 'run_87654321' }, identity))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(accounts.commitRunBinding).toHaveBeenCalledTimes(1);
  });

  it('resolves the session binding with the registry lookup as the authority', async () => {
    const { persistence, accounts, metadata } = setup();

    await expect(persistence.resolveAccountBinding('sdk-1')).resolves.toEqual(binding());
    expect(metadata.resolveAccountBinding).toHaveBeenCalledWith('sdk-1', expect.any(Function));
    expect(accounts.lookupBySdkSession).toHaveBeenCalledWith({ provider: 'claude', sdkSessionId: 'sdk-1' });
  });

  it('maps a failing registry lookup to unavailable-storage', async () => {
    const { persistence, accounts } = setup();
    accounts.lookupBySdkSession.mockRejectedValueOnce(new ProviderAccountStoreError('busy'));

    await expect(persistence.lookupBySdkSession({ provider: 'claude', sdkSessionId: 'sdk-1' }))
      .resolves.toEqual({ status: 'unavailable-storage' });
  });

  it('delegates SDK attachment and metadata saves', async () => {
    const { persistence, accounts, metadata } = setup();
    const request = { provider: 'claude', sdkSessionId: 'sdk-1', runId: RUN_ID, attachedAt: 10 };
    const meta = { sessionId: 'sdk-1' } as SessionMetadata;

    await expect(persistence.attachSdkSession(request)).resolves.toEqual({ status: 'attached' });
    await persistence.saveAccountBound(meta, binding());
    expect(accounts.attachSdkSession).toHaveBeenCalledWith(request);
    expect(metadata.saveAccountBound).toHaveBeenCalledWith(meta, binding());
  });

  it('announces the stored route on a state change and returns the unsubscribe', () => {
    const { persistence, unsubscribe, emit } = setup(() => storedProfile({ auth_epoch: 4 }));
    const listener = jest.fn();

    expect(persistence.onAuthEpochChanged(listener)).toBe(unsubscribe);
    emit({ profileId: PROFILE_ID, state: 'signed-in', revision: 2 });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude', profileId: PROFILE_ID,
      routeFingerprint: fingerprint, routeRevision: 2, authEpoch: 4 }));
  });
});

describe('ClaudeNamedAccountPersistence lane members', () => {
  const reference = () => ({ accountBinding: binding(), accountBindingId: RUN_ID });

  it('is available', () => {
    expect(setup().persistence.available).toBe(true);
  });

  it('validateResume accepts an unchanged route and a newer epoch', async () => {
    await expect(setup().persistence.validateResume(reference())).resolves.toEqual({ code: 'ok' });
    await expect(setup(() => storedProfile({ auth_epoch: 7 })).persistence.validateResume(reference()))
      .resolves.toEqual({ code: 'ok' });
  });

  it('validateResume refuses a changed route, a missing registry binding and a mismatched binding', async () => {
    await expect(setup(() => storedProfile({ route_revision: 9 })).persistence.validateResume(reference()))
      .resolves.toEqual({ code: 'route-changed' });

    const absent = setup();
    absent.accounts.lookupRunBinding.mockResolvedValueOnce({ status: 'absent' });
    await expect(absent.persistence.validateResume(reference())).resolves.toEqual({ code: 'invalid-bound' });

    const other = setup();
    other.accounts.lookupRunBinding.mockResolvedValueOnce({ status: 'bound', binding: binding({ authEpoch: 1 }) });
    await expect(other.persistence.validateResume(reference())).resolves.toEqual({ code: 'invalid-bound' });
  });

  it('persistReference requires both the registry link and matching metadata', async () => {
    await expect(setup().persistence.persistReference(reference(), 'sdk-1')).resolves.toBeUndefined();

    const unlinked = setup();
    unlinked.accounts.lookupBySdkSession.mockResolvedValueOnce({ status: 'absent' });
    await expect(unlinked.persistence.persistReference(reference(), 'sdk-1')).rejects.toMatchObject({ code: 'invalid-bound' });

    const noMetadata = setup();
    noMetadata.metadata.resolveAccountBinding.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'linkage-incomplete' }));
    await expect(noMetadata.persistence.persistReference(reference(), 'sdk-1')).rejects.toMatchObject({ code: 'invalid-bound' });
  });
});
