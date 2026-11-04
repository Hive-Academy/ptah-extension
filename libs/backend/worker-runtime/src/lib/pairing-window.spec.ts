import {
  PairingWindow,
  PAIRING_REJECTION,
  PairingClock,
} from './pairing-window';
import { WorkspaceRegistry } from './workspace-registry';
import { workerPaths } from './paths';

function fixture() {
  let now = 0;
  let timer: (() => void) | undefined;
  const delays: number[] = [];
  const clock: PairingClock = {
    now: () => now,
    delay: async (ms) => {
      delays.push(ms);
      now += ms;
    },
    setTimer: (callback) => {
      timer = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      timer = undefined;
    },
  };
  const registry = new WorkspaceRegistry(workerPaths('/unused'));
  const window = new PairingWindow(registry, 'machine', clock);
  return {
    registry,
    window,
    delays,
    advance: (ms: number) => {
      now += ms;
    },
    expire: () => timer?.(),
  };
}

describe('PairingWindow', () => {
  it('reports remaining attempts and closes the visible window after success', async () => {
    const events: { windowOpen: boolean; attemptsLeft: number }[] = [];
    const sample = fixture();
    const window = new PairingWindow(
      sample.registry,
      'machine',
      undefined,
      ({ windowOpen, attemptsLeft }) => {
        events.push({ windowOpen, attemptsLeft });
      },
    );
    const code = window.open().code;
    await window.exchange(
      code === '0000-0000' ? 'ZZZZ-ZZZZ' : '0000-0000',
      'a',
    );
    await window.exchange(code, 'a');
    expect(events).toEqual([
      { windowOpen: true, attemptsLeft: 4 },
      { windowOpen: false, attemptsLeft: 0 },
    ]);
  });
  it('uses eight Crockford characters, accepts display and bare forms, and snapshots grants', async () => {
    const sample = fixture();
    const first = sample.window.open();
    expect(first.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(first.expiresAt).toBe(300000);
    sample.registry.list = () => [
      { workspaceId: 'ws_later', name: 'later', path: '/later' },
    ];
    expect(
      await sample.window.exchange(first.code.replace('-', ''), 'a'),
    ).toEqual({ ok: true, grant: { machineId: 'machine', workspaceIds: [] } });
    const second = sample.window.open();
    expect(await sample.window.exchange(second.code, 'a')).toEqual({
      ok: true,
      grant: { machineId: 'machine', workspaceIds: ['ws_later'] },
    });
  });

  it('returns identical delayed rejections for wrong, expired, used and absent windows', async () => {
    const sample = fixture();
    const wrongCode = sample.window.open().code;
    const wrong = await sample.window.exchange(
      '0000-0000' === wrongCode ? 'ZZZZ-ZZZZ' : '0000-0000',
      'a',
    );
    sample.expire();
    const expired = await sample.window.exchange(wrongCode, 'a');
    const valid = sample.window.open().code;
    await sample.window.exchange(valid, 'a');
    const used = await sample.window.exchange(valid, 'a');
    const absent = await sample.window.exchange('0000-0000', 'a');
    for (const result of [wrong, expired, used, absent])
      expect(result).toEqual(PAIRING_REJECTION);
    expect(sample.delays).toEqual([250, 250, 250, 250]);
  });

  it('expires and closes after five failed exchanges', async () => {
    const sample = fixture();
    const code = sample.window.open().code;
    for (let i = 0; i < 5; i += 1)
      await sample.window.exchange(
        code === '0000-0000' ? 'ZZZZ-ZZZZ' : '0000-0000',
        'a',
      );
    expect(await sample.window.exchange(code, 'a')).toEqual(PAIRING_REJECTION);
    const later = sample.window.open().code;
    sample.advance(300000);
    expect(await sample.window.exchange(later, 'a')).toEqual(PAIRING_REJECTION);
  });
});
