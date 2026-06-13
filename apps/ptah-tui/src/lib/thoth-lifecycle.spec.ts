import type { DependencyContainer } from 'tsyringe';
import type { ThothRefs } from '@ptah-extension/cli-engine';
import {
  ThothLifecycle,
  type ThothActivationSnapshot,
} from './thoth-lifecycle.js';

function makeContainer(): DependencyContainer {
  return {
    resolve: () => ({ warn: () => undefined, info: () => undefined }),
  } as unknown as DependencyContainer;
}

function makeRefs(overrides: Partial<ThothRefs> = {}): ThothRefs {
  return {
    sqliteConnection: null,
    memoryCurator: null,
    memoryTrigger: null,
    skillSynthesis: null,
    skillTrigger: null,
    cronScheduler: null,
    gateway: null,
    chatBridge: null,
    embedderClient: null,
    pushDisposables: [],
    ...overrides,
  } as ThothRefs;
}

describe('ThothLifecycle', () => {
  it('starts idle', () => {
    const lifecycle = new ThothLifecycle({
      activate: async () => makeRefs(),
      dispose: async () => undefined,
    });
    expect(lifecycle.snapshot().status).toBe('idle');
  });

  it('transitions idle → activating → active and derives subsystem readiness', async () => {
    const transitions: ThothActivationSnapshot['status'][] = [];
    const lifecycle = new ThothLifecycle({
      activate: async () => makeRefs({ memoryCurator: {} as never }),
      dispose: async () => undefined,
    });
    lifecycle.on('change', (s: ThothActivationSnapshot) =>
      transitions.push(s.status),
    );

    await lifecycle.activate(makeContainer());

    expect(transitions).toEqual(['activating', 'active']);
    const snap = lifecycle.snapshot();
    expect(snap.status).toBe('active');
    expect(snap.subsystems.memory.ready).toBe(true);
    expect(snap.subsystems.gateway.ready).toBe(false);
  });

  it('transitions to failed and records the error without throwing', async () => {
    const lifecycle = new ThothLifecycle({
      activate: async () => {
        throw new Error('boom');
      },
      dispose: async () => undefined,
    });

    await lifecycle.activate(makeContainer());

    const snap = lifecycle.snapshot();
    expect(snap.status).toBe('failed');
    expect(snap.error).toBe('boom');
    expect(snap.subsystems.memory.ready).toBe(false);
    expect(snap.subsystems.memory.reason).toBe('boom');
  });

  it('is idempotent — a second activate while active is a no-op', async () => {
    let calls = 0;
    const lifecycle = new ThothLifecycle({
      activate: async () => {
        calls += 1;
        return makeRefs();
      },
      dispose: async () => undefined,
    });

    await lifecycle.activate(makeContainer());
    await lifecycle.activate(makeContainer());

    expect(calls).toBe(1);
  });

  it('dispose calls disposeThoth with the activated refs', async () => {
    const refs = makeRefs({ cronScheduler: {} as never });
    let disposedWith: ThothRefs | undefined;
    const lifecycle = new ThothLifecycle({
      activate: async () => refs,
      dispose: async (r) => {
        disposedWith = r;
      },
    });

    await lifecycle.activate(makeContainer());
    await lifecycle.dispose(makeContainer());

    expect(disposedWith).toBe(refs);
    expect(lifecycle.snapshot().status).toBe('idle');
    expect(lifecycle.getRefs()).toBeUndefined();
  });

  it('dispose is a no-op when never activated', async () => {
    let called = false;
    const lifecycle = new ThothLifecycle({
      activate: async () => makeRefs(),
      dispose: async () => {
        called = true;
      },
    });

    await lifecycle.dispose(makeContainer());

    expect(called).toBe(false);
  });
});
