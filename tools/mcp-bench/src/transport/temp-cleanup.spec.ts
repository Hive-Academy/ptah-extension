import { removeTempDir } from './temp-cleanup';

const busy = (): Error =>
  Object.assign(new Error("EBUSY: resource busy or locked, rmdir 'x'"), {
    code: 'EBUSY',
  });

describe('removeTempDir', () => {
  it('retries EBUSY twice and then succeeds, reporting nothing left', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const left = await removeTempDir('/tmp/home', {
      remove: async () => {
        calls += 1;
        if (calls <= 2) throw busy();
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      delayMs: 500,
    });
    expect(left).toBeNull();
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 500]);
  });

  it('EBUSY forever is reported as a left folder after every attempt, never thrown', async () => {
    let calls = 0;
    const left = await removeTempDir('/tmp/home', {
      remove: async () => {
        calls += 1;
        throw busy();
      },
      sleep: async () => undefined,
      attempts: 5,
    });
    expect(calls).toBe(5);
    expect(left).toContain('temp folder left: /tmp/home');
    expect(left).toContain('EBUSY');
  });
});
