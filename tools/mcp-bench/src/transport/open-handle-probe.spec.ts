import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseWindowsTreeReply,
  processTree,
  runCaptured,
  type ProcessEntry,
  WINDOWS_PROBE_SCRIPT,
} from './open-handle-probe';

const entry = (
  pid: number,
  ppid: number,
  createdMs: number | null,
): ProcessEntry => ({ pid, ppid, name: `process-${pid}`, createdMs });

describe('processTree creation-time guard', () => {
  it('does not adopt an old process whose parent pid was reused by the host tree', () => {
    expect(
      processTree(10, [entry(10, 1, 2_000), entry(20, 10, 1_000)]),
    ).toEqual(new Set([10]));
  });

  it('adopts a child created after its parent', () => {
    expect(
      processTree(10, [entry(10, 1, 1_000), entry(20, 10, 2_000)]),
    ).toEqual(new Set([10, 20]));
  });

  it('falls back to the parent-pid rule when creation times are unavailable', () => {
    expect(
      processTree(10, [entry(10, 1, null), entry(20, 10, null)]),
    ).toEqual(new Set([10, 20]));
  });

  it('preserves Windows creation time and command line while null keeps the ppid fallback', () => {
    const result = parseWindowsTreeReply(
      10,
      JSON.stringify({
        processes: [
          { pid: 10, ppid: 1, name: 'host.exe', createdMs: 1_000, commandLine: 'host --serve' },
          { pid: 20, ppid: 10, name: 'child.exe', createdMs: null, commandLine: 'child --work' },
        ],
        open: [],
        unprobed: [],
      }),
    );

    expect(result.tree).toEqual([
      { pid: 10, ppid: 1, name: 'host.exe', createdMs: 1_000, commandLine: 'host --serve' },
      { pid: 20, ppid: 10, name: 'child.exe', createdMs: null, commandLine: 'child --work' },
    ]);
  });

  it('excludes a process older than the root host', () => {
    expect(
      processTree(10, [
        entry(10, 1, 2_000),
        entry(11, 10, 2_100),
        entry(20, 11, 1_000),
      ]),
    ).toEqual(new Set([10, 11]));
  });
});

describe('captured probe child process', () => {
  it('decodes a multi-byte UTF-8 string split across stdout writes', async () => {
    const expected = 'مُشغّل 😀';
    const childScript = [
      `const payload = Buffer.from(${JSON.stringify(expected)}, 'utf8');`,
      'process.stdout.write(payload.subarray(0, payload.length - 2));',
      'setTimeout(() => process.stdout.write(payload.subarray(payload.length - 2)), 10);',
    ].join('');
    const reply = await runCaptured(process.execPath, ['-e', childScript], '');
    expect(reply.stdout.toString('utf8')).toBe(expected);
    expect(reply.stderr).toBe('');
  });

  it('includes stderr when a child exits non-zero', async () => {
    await expect(
      runCaptured(process.execPath, ['-e', "process.stderr.write('child failed\\n'); process.exit(7);"], ''),
    ).rejects.toThrow('open-handle probe exited 7: child failed');
  });

  it('rejects when a child exceeds its timeout', async () => {
    await expect(
      runCaptured(process.execPath, ['-e', 'setInterval(() => {}, 1_000);'], '', 50),
    ).rejects.toThrow('open-handle probe timed out after 50 ms');
  });
});

describe('Windows open-handle probe reply', () => {
  let diagnosticDirectory: string;

  beforeEach(async () => {
    diagnosticDirectory = await mkdtemp(join(tmpdir(), 'ptah-open-handle-probe-'));
    jest.spyOn(require('node:os'), 'tmpdir').mockReturnValue(diagnosticDirectory);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(diagnosticDirectory, { recursive: true, force: true });
  });

  const validReply = (commandLine = 'host --serve') =>
    JSON.stringify({
      processes: [
        { pid: 10, ppid: 1, name: 'host.exe', createdMs: 1_000, commandLine },
      ],
      open: [],
      unprobed: [],
    });

  it('parses a valid reply as before', () => {
    expect(parseWindowsTreeReply(10, validReply())).toEqual({
      tree: [
        { pid: 10, ppid: 1, name: 'host.exe', createdMs: 1_000, commandLine: 'host --serve' },
      ],
      open: [],
      unprobed: [],
    });
  });

  it('accepts one leading UTF-8 BOM', () => {
    expect(parseWindowsTreeReply(10, `\uFEFF${validReply()}`)).toEqual({
      tree: [
        { pid: 10, ppid: 1, name: 'host.exe', createdMs: 1_000, commandLine: 'host --serve' },
      ],
      open: [],
      unprobed: [],
    });
  });

  it.each([
    ['trailing warning', `${validReply()}WARNING: x`],
    ['leading record', `WARNING: x${validReply()}`],
  ])('saves raw stdout for a %s', async (_name, reply) => {
    const raw = Buffer.from(reply, 'utf8');
    let message = '';
    try {
      parseWindowsTreeReply(10, raw, 'probe stderr');
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    const stdoutPath = message.match(/raw stdout saved: (.*?); stderr saved:/)?.[1];
    const stderrPath = message.match(/stderr saved: (.*?); stdout length:/)?.[1];
    expect(message).toContain('open-handle probe returned no JSON');
    expect(stdoutPath).toBeDefined();
    expect(stderrPath).toBeDefined();
    if (stdoutPath === undefined || stderrPath === undefined) {
      throw new Error(`diagnostic paths absent from: ${message}`);
    }
    expect(await readFile(stdoutPath)).toEqual(raw);
    await expect(readFile(stderrPath, 'utf8')).resolves.toBe('probe stderr');
  });

  it('suppresses host streams and guards UTF-8 console encodings before output', () => {
    const output = WINDOWS_PROBE_SCRIPT.indexOf('[Console]::Out.Write');
    for (const line of [
      "$ProgressPreference = 'SilentlyContinue'",
      "$WarningPreference = 'SilentlyContinue'",
      "$InformationPreference = 'SilentlyContinue'",
    ]) {
      expect(WINDOWS_PROBE_SCRIPT.indexOf(line)).toBeGreaterThan(0);
      expect(WINDOWS_PROBE_SCRIPT.indexOf(line)).toBeLessThan(output);
    }
    const encodingBlock = [
      'try {',
      '  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
      '  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)',
      '} catch { }',
    ].join('\n');
    expect(WINDOWS_PROBE_SCRIPT).toContain(encodingBlock);
    expect(WINDOWS_PROBE_SCRIPT.indexOf(encodingBlock)).toBeLessThan(output);
  });

  it('keeps the encoded PowerShell command line below 30,000 characters', () => {
    const encoded = Buffer.from(WINDOWS_PROBE_SCRIPT, 'utf16le').toString('base64');
    const commandLine = [
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encoded,
    ].join(' ');
    expect(commandLine.length).toBeLessThan(30_000);
  });

  it('keeps the parse failure when saving diagnostics fails', () => {
    const failWrite = () => {
      throw new Error('disk unavailable');
    };
    expect(() => parseWindowsTreeReply(10, 'WARNING: x', '', failWrite)).toThrow(
      /open-handle probe returned no JSON; raw reply not saved: disk unavailable/,
    );
  });
});
