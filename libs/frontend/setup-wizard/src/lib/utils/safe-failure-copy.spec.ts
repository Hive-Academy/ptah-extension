import { failureKind, safeFailureCopy } from './safe-failure-copy';

const FALLBACK = 'Something went wrong.';

describe('safeFailureCopy', () => {
  it.each([
    ['RPC timeout: wizard:install-pack-agents', 'timeout'],
    ['EACCES: permission denied, open /etc/x', 'permission'],
    ['ENOSPC: no space left on device', 'disk-full'],
    ['2 file(s) failed to install', 'partial'],
    ['plan token expired', 'plan-expired'],
    ['getaddrinfo ENOTFOUND registry.example', 'offline'],
    ['ENOENT: no such file', 'not-found'],
    ['', 'unknown'],
  ])('classifies %p as %s', (raw, kind) => {
    expect(failureKind(raw)).toBe(kind);
  });

  it('never returns any part of a secret-bearing message', () => {
    const raw =
      'Bearer sk-live-SECRET123 rejected by https://internal.example/api?key=abc';
    const copy = safeFailureCopy(raw, FALLBACK);
    expect(copy).toBe(FALLBACK);
    for (const leak of ['sk-live', 'internal.example', 'key=abc', 'Bearer']) {
      expect(copy).not.toContain(leak);
    }
  });

  it('never returns markup from an HTML-looking message', () => {
    const copy = safeFailureCopy(
      '<img src=x onerror="alert(1)"><b>boom</b>',
      FALLBACK,
    );
    expect(copy).toBe(FALLBACK);
    expect(copy).not.toMatch(/[<>]/);
  });

  it('keeps the known kind but drops the path of a permission error', () => {
    const copy = safeFailureCopy(
      'EACCES: permission denied, open /home/me/.ssh/id_rsa',
      FALLBACK,
    );
    expect(copy).toContain('permission denied');
    expect(copy).not.toContain('.ssh');
  });

  it('uses the fallback for null and undefined', () => {
    expect(safeFailureCopy(null, FALLBACK)).toBe(FALLBACK);
    expect(safeFailureCopy(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
