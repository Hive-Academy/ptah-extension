/**
 * Unit tests for `StderrOAuthUrlOpener`.
 *
 * Asserts:
 *   - URL line is written to the injected stderr stream
 *   - device code line is written when `userCode` is provided
 *   - device code line is omitted when `userCode` is absent
 *   - returns { opened: false } so the caller knows manual action is required
 *
 * TASK_2026_104 Batch 8c.
 */

import { StderrOAuthUrlOpener } from './stderr-oauth-url-opener.js';

interface FakeStderr {
  write: jest.Mock;
  buffer: string;
}

function makeFakeStderr(): FakeStderr {
  const fake: FakeStderr = {
    buffer: '',
    write: jest.fn((chunk: string | Uint8Array) => {
      fake.buffer +=
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }),
  };
  return fake;
}

describe('StderrOAuthUrlOpener', () => {
  it('writes the verification URL to stderr and returns { opened: false }', async () => {
    const stderr = makeFakeStderr();
    const opener = new StderrOAuthUrlOpener(stderr);
    const result = await opener.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
      userCode: 'ABCD-1234',
    });
    expect(stderr.buffer).toContain(
      'Open this URL: https://github.com/login/device',
    );
    expect(stderr.buffer).toContain('Device code: ABCD-1234');
    expect(result).toEqual({ opened: false });
  });

  it('omits the device code line when userCode is undefined', async () => {
    const stderr = makeFakeStderr();
    const opener = new StderrOAuthUrlOpener(stderr);
    await opener.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
    });
    expect(stderr.buffer).toContain(
      'Open this URL: https://github.com/login/device',
    );
    expect(stderr.buffer).not.toContain('Device code:');
  });

  it('defaults to process.stderr when no stream is supplied', () => {
    // Just exercise the no-arg constructor path so the default param branch is covered.
    const opener = new StderrOAuthUrlOpener();
    expect(opener).toBeInstanceOf(StderrOAuthUrlOpener);
  });
});
