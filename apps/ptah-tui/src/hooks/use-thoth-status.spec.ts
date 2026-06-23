import { EventEmitter } from 'node:events';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  ThothStatusReducer,
  buildThothStatus,
  type ThothStatusSnapshot,
} from './use-thoth-status.js';
import type { ThothActivationSnapshot } from '../lib/thoth-lifecycle.js';

function snapshot(
  status: ThothActivationSnapshot['status'],
  overrides: Partial<ThothActivationSnapshot['subsystems']> = {},
): ThothActivationSnapshot {
  const pending = { ready: false, reason: 'activating' };
  return {
    status,
    subsystems: {
      memory: pending,
      skills: pending,
      cron: pending,
      gateway: pending,
      sqlite: pending,
      embedder: pending,
      ...overrides,
    },
  };
}

class FakeLifecycle extends EventEmitter {
  private current: ThothActivationSnapshot = snapshot('idle');
  snapshot(): ThothActivationSnapshot {
    return this.current;
  }
  push(next: ThothActivationSnapshot): void {
    this.current = next;
    this.emit('change', next);
  }
}

describe('buildThothStatus', () => {
  it('renders activating dots while activating', () => {
    const result = buildThothStatus(
      snapshot('activating'),
      undefined,
      undefined,
    );
    expect(result.badges.memory.text).toBe('Memory activating');
    expect(result.badges.memory.tone).toBe('info');
    expect(result.badges.memory.dot).toBe('○');
  });

  it('renders ready and offline badges from derived subsystems', () => {
    const active = snapshot('active', {
      memory: { ready: true },
      gateway: { ready: false, reason: 'offline' },
    });
    const result = buildThothStatus(active, undefined, undefined);
    expect(result.badges.memory.tone).toBe('success');
    expect(result.badges.memory.dot).toBe('●');
    expect(result.badges.gateway.tone).toBe('warning');
    expect(result.badges.gateway.reason).toBe('offline');
  });

  it('overlays vec diagnostic onto the database badge', () => {
    const result = buildThothStatus(
      snapshot('active'),
      {
        ok: false,
        diagnostic: { reason: 'binary-missing' },
      } as never,
      undefined,
    );
    expect(result.badges.sqlite.tone).toBe('warning');
    expect(result.badges.sqlite.reason).toBe('binary-missing');
  });

  it('overlays embedder error onto the embedder badge', () => {
    const result = buildThothStatus(snapshot('active'), undefined, {
      ready: false,
      downloading: false,
      error: { message: 'onnx failed' },
    } as never);
    expect(result.badges.embedder.tone).toBe('error');
    expect(result.badges.embedder.reason).toBe('onnx failed');
  });
});

describe('ThothStatusReducer', () => {
  it('reduces activation changes and push events into a single snapshot', () => {
    const lifecycle = new FakeLifecycle();
    const pushAdapter = new EventEmitter();
    const seen: ThothStatusSnapshot[] = [];
    const reducer = new ThothStatusReducer(lifecycle, pushAdapter, (s) =>
      seen.push(s),
    );

    lifecycle.push(snapshot('active', { sqlite: { ready: true } }));
    pushAdapter.emit(MESSAGE_TYPES.VEC_STATUS_CHANGED, {
      ok: false,
      diagnostic: { reason: 'load-failed' },
    });
    pushAdapter.emit(MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, {
      status: { ready: true, downloading: false },
    });

    const last = seen[seen.length - 1];
    expect(last.status).toBe('active');
    expect(last.badges.sqlite.reason).toBe('load-failed');
    expect(last.badges.embedder.tone).toBe('success');

    reducer.dispose();
  });

  it('ignores malformed push payloads', () => {
    const lifecycle = new FakeLifecycle();
    const pushAdapter = new EventEmitter();
    const seen: ThothStatusSnapshot[] = [];
    const reducer = new ThothStatusReducer(lifecycle, pushAdapter, (s) =>
      seen.push(s),
    );

    pushAdapter.emit(MESSAGE_TYPES.VEC_STATUS_CHANGED, { bogus: true });
    pushAdapter.emit(MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, { status: 42 });

    expect(seen).toHaveLength(0);
    reducer.dispose();
  });

  it('detaches listeners on dispose', () => {
    const lifecycle = new FakeLifecycle();
    const pushAdapter = new EventEmitter();
    const seen: ThothStatusSnapshot[] = [];
    const reducer = new ThothStatusReducer(lifecycle, pushAdapter, (s) =>
      seen.push(s),
    );
    reducer.dispose();

    lifecycle.push(snapshot('active'));
    pushAdapter.emit(MESSAGE_TYPES.VEC_STATUS_CHANGED, {
      ok: true,
      diagnostic: { reason: 'ok' },
    });

    expect(seen).toHaveLength(0);
  });
});
