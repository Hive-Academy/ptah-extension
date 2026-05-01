/**
 * Unit tests for `emitFatalError` — structured NDJSON stderr channel.
 *
 * Covers the helper from cli-shift.md Phase 2 / HANDOFF-ptah-cli.md P1 Fix 4.
 * Coverage targets: write shape (one NDJSON line per call), code/message
 * preservation, optional details merge, key-collision protection.
 */

import { emitFatalError, FatalErrorCode } from './stderr-json.js';

describe('emitFatalError', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  function lastWrite(): string {
    const calls = stderrSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return String(calls[calls.length - 1]?.[0]);
  }

  it('writes a single NDJSON line ending with a newline', () => {
    emitFatalError('sdk_init_failed', 'auth not configured');
    const line = lastWrite();
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n').filter((s) => s.length > 0)).toHaveLength(1);
  });

  it('emits canonical error+message keys', () => {
    emitFatalError('internal_failure', 'boom');
    const parsed = JSON.parse(lastWrite().trim());
    expect(parsed).toEqual({ error: 'internal_failure', message: 'boom' });
  });

  it('merges optional details into the payload', () => {
    emitFatalError('sdk_init_failed', 'm', {
      command: 'engine.bootstrap',
      bootstrap_mode: 'full',
    });
    const parsed = JSON.parse(lastWrite().trim());
    expect(parsed).toEqual({
      error: 'sdk_init_failed',
      message: 'm',
      command: 'engine.bootstrap',
      bootstrap_mode: 'full',
    });
  });

  it('refuses to allow details to clobber the canonical keys', () => {
    emitFatalError('db_lock', 'real msg', {
      error: 'fake',
      message: 'fake-too',
      ok: 1,
    });
    const parsed = JSON.parse(lastWrite().trim());
    expect(parsed.error).toBe('db_lock');
    expect(parsed.message).toBe('real msg');
    expect(parsed.ok).toBe(1);
  });

  it('exposes a const-object union of fatal codes', () => {
    expect(FatalErrorCode.SdkInitFailed).toBe('sdk_init_failed');
    expect(FatalErrorCode.InternalFailure).toBe('internal_failure');
    expect(FatalErrorCode.DbLock).toBe('db_lock');
    expect(FatalErrorCode.WorkspaceMissing).toBe('workspace_missing');
    expect(FatalErrorCode.AuthRequired).toBe('auth_required');
    expect(FatalErrorCode.LicenseRequired).toBe('license_required');
  });

  it('swallows write failures silently', () => {
    stderrSpy.mockImplementation(() => {
      throw new Error('stderr broken');
    });
    expect(() => emitFatalError('sdk_init_failed', 'm')).not.toThrow();
  });
});
