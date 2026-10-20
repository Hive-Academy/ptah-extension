import {
  ANTIGRAVITY_CLI_MAX_OUTPUT_BYTES,
  antigravityCliCandidates,
  parseAntigravityCliUsage,
  readAntigravityCliUsage,
  type AntigravityCliExec,
} from './antigravity-cli-usage.adapter';

const SAMPLE = [
  'Gemini Models\tWeekly Limit Remaining\t100%\t2026-10-27T00:08:58Z',
  'Gemini Models\tFive Hour Limit Remaining\t100%\t2026-10-20T05:08:58Z',
  'Claude and GPT models\tWeekly Limit Remaining\t60%\t2026-10-27T00:08:58Z',
  'Claude and GPT models\tFive Hour Limit Remaining\t25.5%\t2026-10-20T05:08:58Z',
  'Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t100%\t2026-10-27T00:08:44Z',
].join('\n');

const errno = (code: string) =>
  Object.assign(new Error(code), { code }) as NodeJS.ErrnoException;

describe('Antigravity CLI usage adapter', () => {
  describe('parseAntigravityCliUsage', () => {
    it('maps remaining percent to used percent with resets', () => {
      const windows = parseAntigravityCliUsage(SAMPLE, 5);
      expect(windows).toHaveLength(5);
      expect(windows?.[0]).toMatchObject({
        key: 'other:cli-gemini-models-weekly',
        kind: 'weekly',
        modelScope: 'Gemini Models',
        used: { kind: 'percent', percent: 0 },
        resetsAt: Date.parse('2026-10-27T00:08:58Z'),
        usedSource: 'provider-unofficial',
      });
      expect(windows?.[1]).toMatchObject({ kind: 'five_hour' });
      expect(windows?.[2]?.used).toEqual({ kind: 'percent', percent: 40 });
      expect(windows?.[3]?.used).toEqual({ kind: 'percent', percent: 74.5 });
      expect(windows?.[4]).toMatchObject({
        kind: 'weekly',
        modelScope: 'Gemini 4 Argon',
      });
    });

    it('tolerates CRLF and blank lines', () => {
      expect(
        parseAntigravityCliUsage(SAMPLE.replace(/\n/g, '\r\n') + '\r\n\r\n', 1),
      ).toHaveLength(5);
    });

    it.each([
      ['empty output', ''],
      ['free text', 'Please sign in first'],
      ['three fields', 'G\tWeekly\t10%'],
      ['five fields', 'G\tWeekly\t10%\t2026-10-27T00:08:58Z\textra'],
      ['percent above 100', 'G\tWeekly\t101%\t2026-10-27T00:08:58Z'],
      ['no percent sign', 'G\tWeekly\t10\t2026-10-27T00:08:58Z'],
      ['negative percent', 'G\tWeekly\t-5%\t2026-10-27T00:08:58Z'],
      ['non-ISO date', 'G\tWeekly\t10%\ttomorrow'],
      ['impossible date', 'G\tWeekly\t10%\t2026-13-45T99:99:99Z'],
      ['empty group', '\tWeekly\t10%\t2026-10-27T00:08:58Z'],
      ['one bad line among good ones', SAMPLE + '\nGarbage line without tabs'],
      [
        'duplicate windows',
        'G\tWeekly Limit\t10%\t2026-10-27T00:08:58Z\nG\tWeekly Limit\t20%\t2026-10-27T00:08:58Z',
      ],
    ])('rejects %s (fail closed)', (_, output) => {
      expect(parseAntigravityCliUsage(output, 1)).toBeUndefined();
    });

    it('rejects oversized output', () => {
      expect(
        parseAntigravityCliUsage(
          'x'.repeat(ANTIGRAVITY_CLI_MAX_OUTPUT_BYTES + 1),
          1,
        ),
      ).toBeUndefined();
    });
  });

  describe('readAntigravityCliUsage', () => {
    it('runs agy with an argument array and parses the result', async () => {
      const exec = jest.fn<
        ReturnType<AntigravityCliExec>,
        Parameters<AntigravityCliExec>
      >(async () => SAMPLE);
      const result = await readAntigravityCliUsage(undefined, {
        exec,
        executables: ['agy'],
      });
      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        'agy',
        ['-p', '/usage'],
        expect.any(AbortSignal),
      );
    });

    it('falls through to the next candidate when the first is missing', async () => {
      const exec: AntigravityCliExec = jest.fn(async (executable: string) => {
        if (executable === 'agy') throw errno('ENOENT');
        return SAMPLE;
      });
      const result = await readAntigravityCliUsage(undefined, {
        exec,
        executables: ['agy', 'C:/agy/bin/agy.exe'],
      });
      expect(result.ok).toBe(true);
    });

    it('tries the install-directory binary after a PATH shim fails to spawn', async () => {
      const exec: AntigravityCliExec = jest.fn(async (executable: string) => {
        if (executable === 'agy') throw errno('EINVAL');
        return SAMPLE;
      });
      const result = await readAntigravityCliUsage(undefined, {
        exec,
        executables: ['agy', 'C:/agy/bin/agy.exe'],
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.windows[0].label).toContain(' \u00B7 ');
    });

    it('reports the first real failure when every candidate fails', async () => {
      const exec: AntigravityCliExec = async (executable: string) => {
        throw errno(executable === 'agy' ? 'EINVAL' : 'ENOENT');
      };
      const result = await readAntigravityCliUsage(undefined, {
        exec,
        executables: ['agy', 'C:/agy/bin/agy.exe'],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).not.toBe('cli-not-found');
    });

    it('reports cli-not-found when no binary exists', async () => {
      const exec: AntigravityCliExec = async () => {
        throw errno('ENOENT');
      };
      await expect(
        readAntigravityCliUsage(undefined, { exec, executables: ['agy'] }),
      ).resolves.toEqual({ ok: false, reason: 'cli-not-found' });
    });

    it.each([
      ['killed by the timeout', { killed: true, code: null }, 'cli-timeout'],
      ['ETIMEDOUT', { code: 'ETIMEDOUT' }, 'cli-timeout'],
      ['an abort', { name: 'AbortError', code: 'ABORT_ERR' }, 'cli-timeout'],
      [
        'a clear sign-in message',
        { code: 1, stderr: 'Error: you are not signed in' },
        'cli-not-signed-in',
      ],
      [
        'a sign-in hint on stdout',
        { code: 1, stdout: 'Please sign in first' },
        'cli-not-signed-in',
      ],
      [
        'not logged into Antigravity',
        { code: 1, stderr: 'Not logged into Antigravity' },
        'cli-not-signed-in',
      ],
      [
        'a bare login instruction',
        { code: 1, stderr: 'Login to continue' },
        'cli-not-signed-in',
      ],
      [
        'an unrelated non-zero exit',
        { code: 2, stderr: 'segfault in plugin' },
        'cli-exit-error',
      ],
      ['a non-process error', {}, 'cli-unavailable'],
    ])('classifies %s as %s', async (_, props, reason) => {
      const exec: AntigravityCliExec = async () => {
        throw Object.assign(new Error('failed'), props);
      };
      await expect(
        readAntigravityCliUsage(undefined, { exec, executables: ['agy'] }),
      ).resolves.toEqual({ ok: false, reason });
    });

    it('never parses a failing run output as usage', async () => {
      const exec: AntigravityCliExec = async () => {
        throw Object.assign(new Error('failed'), {
          code: 1,
          stdout: SAMPLE,
        });
      };
      await expect(
        readAntigravityCliUsage(undefined, { exec, executables: ['agy'] }),
      ).resolves.toEqual({ ok: false, reason: 'cli-exit-error' });
    });

    it('reports cli-parse-failed for unrecognised output', async () => {
      await expect(
        readAntigravityCliUsage(undefined, {
          exec: async () => 'Usage: agy [options]',
          executables: ['agy'],
        }),
      ).resolves.toEqual({ ok: false, reason: 'cli-parse-failed' });
    });

    it('reports cli-parse-failed when output exceeds the buffer', async () => {
      const overflow = Object.assign(new Error('maxBuffer'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      });
      await expect(
        readAntigravityCliUsage(undefined, {
          exec: async () => {
            throw overflow;
          },
          executables: ['agy'],
        }),
      ).resolves.toEqual({ ok: false, reason: 'cli-parse-failed' });
    });

    it('does not run when the caller already aborted', async () => {
      const exec = jest.fn();
      const controller = new AbortController();
      controller.abort();
      await expect(
        readAntigravityCliUsage(controller.signal, {
          exec,
          executables: ['agy'],
        }),
      ).resolves.toEqual({ ok: false, reason: 'cli-unavailable' });
      expect(exec).not.toHaveBeenCalled();
    });

    it('passes a shell metacharacter only as data, never through a shell', async () => {
      const exec = jest.fn(async () => SAMPLE);
      await readAntigravityCliUsage(undefined, {
        exec,
        executables: ['agy; rm -rf /'],
      });
      // The executable is one argv[0] entry; the arguments are fixed.
      expect(exec).toHaveBeenCalledWith(
        'agy; rm -rf /',
        ['-p', '/usage'],
        expect.any(AbortSignal),
      );
    });
  });

  describe('antigravityCliCandidates', () => {
    it('adds the Windows install directory only when the binary exists', () => {
      const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
      expect(antigravityCliCandidates(env, 'win32', () => true)).toEqual([
        'agy',
        expect.stringMatching(/agy[\\/]bin[\\/]agy\.exe$/),
      ]);
      expect(antigravityCliCandidates(env, 'win32', () => false)).toEqual([
        'agy',
      ]);
      expect(antigravityCliCandidates(env, 'linux', () => true)).toEqual([
        'agy',
      ]);
    });
  });
});
