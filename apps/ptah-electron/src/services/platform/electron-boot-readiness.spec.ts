import type {
  BootProgressPayload,
  BootReadinessChangedPayload,
} from '@ptah-extension/shared';

import { ElectronBootReadinessProvider } from './electron-boot-readiness';

const READINESS: BootReadinessChangedPayload = {
  readiness: 'warming',
  phase: 'harness',
  detail: 'Reconciling',
  startedAt: 1_000,
};

const VERIFY_DONE: BootProgressPayload = {
  stepId: 'verify',
  index: 0,
  total: 3,
  state: 'done',
  elapsedMs: 120,
  startedAt: 1_000,
};

describe('ElectronBootReadinessProvider', () => {
  it('answers the coordinator snapshot plus the boot progress snapshots', () => {
    const provider = new ElectronBootReadinessProvider(
      { snapshot: () => READINESS },
      { snapshots: () => [VERIFY_DONE] },
    );

    expect(provider.getReadiness()).toEqual({
      ...READINESS,
      steps: [VERIFY_DONE],
    });
  });

  it('reads both sources on every call, never a cached copy', () => {
    let steps: readonly BootProgressPayload[] = [];
    let readiness = READINESS;
    const provider = new ElectronBootReadinessProvider(
      { snapshot: () => readiness },
      { snapshots: () => steps },
    );
    expect(provider.getReadiness().steps).toEqual([]);

    steps = [VERIFY_DONE];
    readiness = { readiness: 'ready', phase: 'settled', startedAt: 1_000 };

    expect(provider.getReadiness()).toEqual({
      readiness: 'ready',
      phase: 'settled',
      startedAt: 1_000,
      steps: [VERIFY_DONE],
    });
  });
});
