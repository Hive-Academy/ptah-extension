import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeAmbientStatusService,
  ProvidersSettingsStateService,
  VSCodeService,
  type ClaudeAmbientStatusView,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { CliDetectionResult } from '@ptah-extension/shared';
import {
  ClaudeReadinessStore,
  deriveClaudeReadiness,
  type ClaudeReadinessInputs,
} from './claude-readiness.store';

type Detection = ProvidersSettingsSection<readonly CliDetectionResult[]>;

const claudeRow = (installed: boolean): CliDetectionResult => ({
  cli: 'claude',
  installed,
  path: installed ? '/usr/local/bin/claude' : undefined,
  version: installed ? '2.1.0' : undefined,
  messagingMode: 'none',
});

const detected = (rows: readonly CliDetectionResult[]): Detection => ({
  status: 'ready',
  data: rows,
  error: null,
});
const detectError: Detection = {
  status: 'error',
  data: null,
  error: 'Could not load this section. Retry.',
};

const ambient = (
  result: ClaudeAmbientStatusView['result'],
  extra: Partial<ClaudeAmbientStatusView> = {},
): ClaudeAmbientStatusView => ({
  status: 'ready',
  result,
  localFailure: false,
  ...extra,
});
const connected = ambient({ state: 'connected', checkedAt: null });
const signedOut = ambient({ state: 'signed-out', checkedAt: null });
const unknown = (reason?: 'cli-missing' | 'timeout' | 'unreadable') =>
  ambient(
    reason
      ? { state: 'unknown', checkedAt: null, reason }
      : { state: 'unknown', checkedAt: null },
  );

function derive(detection: Detection, amb: ClaudeAmbientStatusView) {
  const input: ClaudeReadinessInputs = { detection, ambient: amb };
  return deriveClaudeReadiness(input);
}

describe('deriveClaudeReadiness', () => {
  it.each<[string, Detection, ClaudeAmbientStatusView]>([
    [
      'detection unloaded',
      { status: 'unloaded', data: null, error: null },
      connected,
    ],
    [
      'detection loading',
      { status: 'loading', data: null, error: null },
      connected,
    ],
    [
      'ambient checking',
      detected([claudeRow(true)]),
      ambient(null, { status: 'checking' }),
    ],
    [
      'ambient idle',
      detected([claudeRow(true)]),
      ambient(null, { status: 'idle' }),
    ],
    [
      'ambient inert',
      detected([claudeRow(true)]),
      ambient(null, { status: 'inert' }),
    ],
  ])('is checking when %s', (_n, detection, amb) => {
    expect(derive(detection, amb)).toEqual({
      state: 'checking',
      errorCause: null,
      path: null,
      version: null,
    });
  });

  it('is missing when the claude row is not installed', () => {
    expect(derive(detected([claudeRow(false)]), connected)).toEqual({
      state: 'missing',
      errorCause: null,
      path: null,
      version: null,
    });
  });

  it('is missing when an installed row meets ambient cli-missing', () => {
    expect(
      derive(detected([claudeRow(true)]), unknown('cli-missing')).state,
    ).toBe('missing');
  });

  it('missing beats error (detect failed, ambient cli-missing)', () => {
    expect(derive(detectError, unknown('cli-missing')).state).toBe('missing');
  });

  it('is error with cause local when detection failed, even if connected', () => {
    expect(derive(detectError, connected)).toMatchObject({
      state: 'error',
      errorCause: 'local',
    });
  });

  it('is error with cause local when no claude row is present', () => {
    expect(derive(detected([]), connected)).toMatchObject({
      state: 'error',
      errorCause: 'local',
    });
  });

  it('is error with cause local on an ambient local failure', () => {
    expect(
      derive(
        detected([claudeRow(true)]),
        ambient(null, { localFailure: true }),
      ),
    ).toMatchObject({ state: 'error', errorCause: 'local' });
  });

  it.each([
    ['timeout', 'timeout'],
    ['unreadable', 'unreadable'],
    [undefined, 'local'],
  ] as const)('maps unknown with reason %s to cause %s', (reason, cause) => {
    expect(derive(detected([claudeRow(true)]), unknown(reason))).toEqual({
      state: 'error',
      errorCause: cause,
      path: '/usr/local/bin/claude',
      version: '2.1.0',
    });
  });

  it('is signed-out for an installed row and ambient signed-out', () => {
    expect(derive(detected([claudeRow(true)]), signedOut)).toEqual({
      state: 'signed-out',
      errorCause: null,
      path: '/usr/local/bin/claude',
      version: '2.1.0',
    });
  });

  it('is ready for an installed row and ambient connected', () => {
    expect(derive(detected([claudeRow(true)]), connected)).toEqual({
      state: 'ready',
      errorCause: null,
      path: '/usr/local/bin/claude',
      version: '2.1.0',
    });
  });
});

describe('ClaudeReadinessStore', () => {
  let redetectClis: jest.Mock<Promise<boolean>, []>;
  let read: jest.Mock<Promise<void>, [boolean]>;

  function createStore(isElectron = true): ClaudeReadinessStore {
    redetectClis = jest.fn().mockResolvedValue(true);
    read = jest.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: VSCodeService, useValue: { isElectron } },
        {
          provide: ProvidersSettingsStateService,
          useValue: {
            cliDetection: signal(detected([claudeRow(true)])),
            redetectClis,
          },
        },
        {
          provide: ClaudeAmbientStatusService,
          useValue: { view: signal(connected), read },
        },
      ],
    });
    return TestBed.inject(ClaudeReadinessStore);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('derives its view from the two root signals', () => {
    expect(createStore().view().state).toBe('ready');
  });

  it('refresh(true) re-detects and reads fresh, resolving the settled state', async () => {
    const store = createStore();
    await expect(store.refresh(true)).resolves.toBe('ready');
    expect(redetectClis).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(true);
  });

  it('refresh(false) re-detects and reads from the host cache', async () => {
    const store = createStore();
    await store.refresh(false);
    expect(redetectClis).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(false);
  });

  it('makes no call outside Electron', async () => {
    const store = createStore(false);
    expect(store.available).toBe(false);
    await store.refresh(true);
    expect(redetectClis).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('rechecking is true only while a Re-check runs', async () => {
    const store = createStore();
    let finish!: () => void;
    read.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));

    expect(store.rechecking()).toBe(false);
    const pending = store.refresh(true);
    expect(store.rechecking()).toBe(true);
    finish();
    await pending;
    expect(store.rechecking()).toBe(false);
  });

  it('a mount read does not mark rechecking', () => {
    const store = createStore();
    read.mockReturnValue(new Promise<void>(() => undefined));
    void store.refresh(false);
    expect(store.rechecking()).toBe(false);
  });
});
