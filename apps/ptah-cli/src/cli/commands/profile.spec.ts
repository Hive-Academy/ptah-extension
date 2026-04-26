/**
 * Unit tests for the `ptah profile` deprecation shim — TASK_2026_104 B7.
 *
 * The shim is locked: it MUST write the fixed deprecation message to stderr
 * and return `ExitCode.UsageError` (2) for every sub-command, without
 * touching the DI container or `withEngine`.
 */

import {
  execute,
  PROFILE_DEPRECATION_MESSAGE,
  type ProfileOptions,
} from './profile.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: process.cwd(),
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

function makeStderr(): { stderr: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stderr: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

describe('ptah profile (deprecation shim)', () => {
  it('emits the locked deprecation message to stderr and exits 2 for `apply`', async () => {
    const trace = makeStderr();
    const stderr = trace.stderr;
    const opts: ProfileOptions = { subcommand: 'apply', name: 'foo' };

    const code = await execute(opts, baseGlobals, { stderr });

    expect(stderr.write).toHaveBeenCalledTimes(1);
    expect(stderr.write).toHaveBeenCalledWith(PROFILE_DEPRECATION_MESSAGE);
    expect(trace.buffer).toBe(PROFILE_DEPRECATION_MESSAGE);
    expect(code).toBe(ExitCode.UsageError);
    expect(code).toBe(2);
  });

  it('emits the locked deprecation message to stderr and exits 2 for `list`', async () => {
    const trace = makeStderr();
    const stderr = trace.stderr;
    const opts: ProfileOptions = { subcommand: 'list' };

    const code = await execute(opts, baseGlobals, { stderr });

    expect(stderr.write).toHaveBeenCalledTimes(1);
    expect(stderr.write).toHaveBeenCalledWith(PROFILE_DEPRECATION_MESSAGE);
    expect(trace.buffer).toBe(PROFILE_DEPRECATION_MESSAGE);
    expect(code).toBe(ExitCode.UsageError);
  });

  it('mentions `ptah agent install` so users know the replacement', () => {
    expect(PROFILE_DEPRECATION_MESSAGE).toContain('ptah agent install');
    expect(PROFILE_DEPRECATION_MESSAGE.endsWith('\n')).toBe(true);
  });

  it('does NOT import or invoke `withEngine` (no DI bootstrap)', async () => {
    // Static-check the shim source: it must never IMPORT DI plumbing. If a
    // future refactor adds an import of withEngine/container/tsyringe to
    // profile.ts, this test fails before any runtime damage is done. We
    // strip line comments + block comments first so docstrings can mention
    // these names without false positives.
    const { promises: fsPromises } = await import('node:fs');
    const path = await import('node:path');
    const profilePath = path.join(__dirname, 'profile.ts');
    const raw = await fsPromises.readFile(profilePath, 'utf8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/.*$/gm, ''); // line comments

    expect(stripped).not.toMatch(/from ['"][^'"]*with-engine[^'"]*['"]/);
    expect(stripped).not.toMatch(/from ['"]tsyringe['"]/);
    expect(stripped).not.toMatch(/\bwithEngine\s*\(/);
    expect(stripped).not.toMatch(/\bcontainer\.\w+/);
  });

  it('uses real `process.stderr` when no hook is provided', async () => {
    const writeSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      const code = await execute(
        { subcommand: 'apply', name: 'x' },
        baseGlobals,
      );
      expect(writeSpy).toHaveBeenCalledWith(PROFILE_DEPRECATION_MESSAGE);
      expect(code).toBe(ExitCode.UsageError);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
