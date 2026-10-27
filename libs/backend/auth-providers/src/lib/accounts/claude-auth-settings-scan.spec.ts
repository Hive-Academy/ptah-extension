import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { PassThrough } from 'node:stream';
import { killProcessTree, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { ClaudeAccountCommand } from './claude-account-command';
import {
  CLAUDE_POLICY_COVERAGE,
  CLAUDE_REMOTE_SETTINGS_FILES,
  claudePolicyCoverage,
  claudeRemoteSignalsAbsent,
  scanClaudeAuthPolicy,
  type ClaudeAuthPolicyScanRequest,
  type ClaudePolicyDirEntry,
  type ClaudePolicyScanFs,
  type ClaudeRegistryQueryResult,
} from './claude-auth-settings-scan';

// The command's tree kill must never reach a real process from a spec.
jest.mock('@ptah-extension/platform-core', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/platform-core')>('@ptah-extension/platform-core'),
  killProcessTree: jest.fn().mockResolvedValue(undefined),
}));

const CWD = 'C:\\Users\\dev\\work\\proj';
const CANONICAL_DIR = 'C:\\Users\\dev\\.ptah\\claude-accounts\\acct-1';
const MANAGED_DIR = 'C:\\Program Files\\ClaudeCode';
const DROP_IN_DIR = win32.join(MANAGED_DIR, 'managed-settings.d');
const CANARY = 'CANARY-7f3e';

interface FakeFsOptions {
  readonly files?: Record<string, string>;
  /** Paths that exist for `lstat` without content. */
  readonly present?: readonly string[];
  readonly dirs?: Record<string, readonly ClaudePolicyDirEntry[]>;
  /** Path -> Node error code thrown by any operation on that path. */
  readonly errors?: Record<string, string>;
}

function fsError(code: string): Error {
  return Object.assign(new Error(`fake ${code}`), { code });
}

function fakeFs(options: FakeFsOptions = {}): { fs: ClaudePolicyScanFs; calls: string[] } {
  const calls: string[] = [];
  const files = options.files ?? {};
  const failWith = (path: string): void => {
    const code = options.errors?.[path];
    if (code) throw fsError(code);
  };
  const fs: ClaudePolicyScanFs = {
    readFile: async (path) => {
      calls.push(`readFile ${path}`);
      failWith(path);
      if (path in files) return files[path];
      throw fsError('ENOENT');
    },
    lstat: async (path) => {
      calls.push(`lstat ${path}`);
      failWith(path);
      if (path in files || options.present?.includes(path)) return { size: 1 };
      throw fsError('ENOENT');
    },
    readdir: async (path) => {
      calls.push(`readdir ${path}`);
      failWith(path);
      const listing = options.dirs?.[path];
      if (listing) return listing;
      throw fsError('ENOENT');
    },
  };
  return { fs, calls };
}

function entry(name: string, kind: 'file' | 'symlink' | 'dir' = 'file'): ClaudePolicyDirEntry {
  return { name, isFile: () => kind === 'file', isSymbolicLink: () => kind === 'symlink' };
}

function done(stdout: string, exitCode: number | null = 0): ClaudeRegistryQueryResult {
  return { exitCode, stdout, terminated: true, timedOut: false, overflow: false };
}

const HKLM_POLICIES_LISTING = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google',
  '',
].join('\r\n');
const HKCU_POLICIES_LISTING = ['', 'HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Microsoft', ''].join('\r\n');

type RegistryReply = ClaudeRegistryQueryResult | 'throw';

function fakeRegistry(replies: Record<string, RegistryReply> = {}) {
  const defaults: Record<string, RegistryReply> = {
    'HKLM\\SOFTWARE\\Policies': done(HKLM_POLICIES_LISTING),
    'HKCU\\SOFTWARE\\Policies': done(HKCU_POLICIES_LISTING),
  };
  const calls: string[] = [];
  const queryRegistry = jest.fn(async (path: string, _signal: AbortSignal) => {
    calls.push(path);
    const reply = replies[path] ?? defaults[path];
    if (!reply || reply === 'throw') throw new Error('fake spawn failure');
    return reply;
  });
  return { queryRegistry, calls };
}

function request(overrides: Partial<ClaudeAuthPolicyScanRequest> = {}): ClaudeAuthPolicyScanRequest {
  return {
    cwd: CWD,
    canonicalDir: CANONICAL_DIR,
    platform: 'win32',
    coverage: claudePolicyCoverage('win32'),
    fs: fakeFs().fs,
    queryRegistry: fakeRegistry().queryRegistry,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const REFUSED = { ok: false, code: 'unsupported-source', terminated: true };

describe('CLAUDE_POLICY_COVERAGE', () => {
  it('has exactly one entry: win32@2.1.310 with every source S1-S12', () => {
    expect(CLAUDE_POLICY_COVERAGE.map((item) => item.id)).toEqual(['win32@2.1.310']);
    const win = claudePolicyCoverage('win32');
    expect(win?.versions).toEqual(['2.1.310']);
    expect(win?.managedSettingsDir).toBe(MANAGED_DIR);
    expect(win?.sources).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12']);
    expect(Object.isFrozen(CLAUDE_POLICY_COVERAGE)).toBe(true);
    expect(Object.isFrozen(win)).toBe(true);
  });

  it.each(['darwin', 'linux'] as const)('has no entry for %s', (platform) => {
    expect(claudePolicyCoverage(platform)).toBeNull();
  });
});

describe('scanClaudeAuthPolicy', () => {
  it('passes a clean win32 context and records the evidence', async () => {
    const { fs } = fakeFs();
    const registry = fakeRegistry();
    await expect(scanClaudeAuthPolicy(request({ fs, queryRegistry: registry.queryRegistry }))).resolves.toEqual({
      ok: true,
      terminated: true,
      policy: {
        coverage: 'win32@2.1.310',
        managedFile: 'absent',
        managedDropIn: 'absent',
        registry: 'absent',
        remoteSignals: 'absent',
      },
    });
    expect(registry.calls).toEqual(['HKLM\\SOFTWARE\\Policies', 'HKCU\\SOFTWARE\\Policies']);
  });

  describe('coverage', () => {
    it.each(['darwin', 'linux'] as const)('refuses %s with no fs or registry call', async (platform) => {
      const { fs, calls } = fakeFs();
      const registry = fakeRegistry();
      const result = await scanClaudeAuthPolicy(
        request({ platform, coverage: claudePolicyCoverage(platform), fs, queryRegistry: registry.queryRegistry }),
      );
      expect(result).toEqual(REFUSED);
      expect(calls).toEqual([]);
      expect(registry.queryRegistry).not.toHaveBeenCalled();
    });

    it('refuses an entry whose platform differs from the context', async () => {
      const { fs, calls } = fakeFs();
      const result = await scanClaudeAuthPolicy(request({ platform: 'linux', fs }));
      expect(result).toEqual(REFUSED);
      expect(calls).toEqual([]);
    });

    it('refuses a known uncovered version before any fs or registry call', async () => {
      const { fs, calls } = fakeFs();
      const registry = fakeRegistry();
      const result = await scanClaudeAuthPolicy(
        request({ knownVersion: '2.1.311', fs, queryRegistry: registry.queryRegistry }),
      );
      expect(result).toEqual(REFUSED);
      expect(calls).toEqual([]);
      expect(registry.queryRegistry).not.toHaveBeenCalled();
    });

    it('scans when the known version is covered', async () => {
      await expect(scanClaudeAuthPolicy(request({ knownVersion: '2.1.310' }))).resolves.toMatchObject({ ok: true });
    });
  });

  describe('registry', () => {
    it('absent: Policies lists without ClaudeCode in mixed-case long root names', async () => {
      const registry = fakeRegistry({
        'HKLM\\SOFTWARE\\Policies': done(
          [
            '',
            'hkey_local_machine\\software\\policies\\Microsoft',
            'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\ClaudeCodeHelper',
          ].join('\r\n'),
        ),
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toMatchObject({
        ok: true,
        policy: { registry: 'absent' },
      });
    });

    it('ignores the queried-path header and value lines of a key with values', async () => {
      const registry = fakeRegistry({
        'HKCU\\SOFTWARE\\Policies': done(
          [
            '',
            'HKEY_CURRENT_USER\\SOFTWARE\\Policies',
            `    Secret    REG_SZ    ${CANARY}`,
            '',
            'HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Microsoft',
          ].join('\n'),
        ),
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toMatchObject({
        ok: true,
      });
    });

    it('absent-parent: Policies exits 1 and SOFTWARE lists without Policies', async () => {
      const registry = fakeRegistry({
        'HKCU\\SOFTWARE\\Policies': done('', 1),
        'HKCU\\SOFTWARE': done(
          ['', 'HKEY_CURRENT_USER\\SOFTWARE\\Classes', 'HKEY_CURRENT_USER\\Software\\Microsoft'].join('\r\n'),
        ),
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toMatchObject({
        ok: true,
        policy: { registry: 'absent' },
      });
      expect(registry.calls).toEqual(['HKLM\\SOFTWARE\\Policies', 'HKCU\\SOFTWARE\\Policies', 'HKCU\\SOFTWARE']);
    });

    it.each(['HKLM', 'HKCU'] as const)('present: a ClaudeCode subkey under %s refuses', async (hive) => {
      const longName = hive === 'HKLM' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER';
      const registry = fakeRegistry({
        [`${hive}\\SOFTWARE\\Policies`]: done(`\r\n${longName}\\SOFTWARE\\Policies\\claudecode\r\n`),
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual(REFUSED);
    });

    it('access-denied: Policies exits 1 and the parent listing includes Policies', async () => {
      const registry = fakeRegistry({
        'HKLM\\SOFTWARE\\Policies': done('ERROR: Access is denied.', 1),
        'HKLM\\SOFTWARE': done(['', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies'].join('\r\n')),
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual(REFUSED);
    });

    it.each<[string, RegistryReply]>([
      ['parent exit 2', done('', 2)],
      ['parent spawn error', 'throw'],
    ])('generic failure: %s refuses', async (_label, parentReply) => {
      const registry = fakeRegistry({ 'HKLM\\SOFTWARE\\Policies': done('', 2), 'HKLM\\SOFTWARE': parentReply });
      const result = await scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }));
      expect(result).toMatchObject({ ok: false, code: 'unsupported-source' });
    });

    it('spawn error on the first query refuses and leaves termination unproved', async () => {
      const registry = fakeRegistry({ 'HKLM\\SOFTWARE\\Policies': 'throw' });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual({
        ok: false,
        code: 'unsupported-source',
        terminated: false,
      });
    });

    it('timeout: timedOut with terminated false refuses as unproved', async () => {
      const registry = fakeRegistry({
        'HKLM\\SOFTWARE\\Policies': { exitCode: null, stdout: '', terminated: false, timedOut: true, overflow: false },
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual({
        ok: false,
        code: 'unsupported-source',
        terminated: false,
      });
      expect(registry.calls).toEqual(['HKLM\\SOFTWARE\\Policies']);
    });

    it('an exit-0 result whose close was not observed refuses as unproved', async () => {
      const registry = fakeRegistry({
        'HKCU\\SOFTWARE\\Policies': { ...done(HKCU_POLICIES_LISTING), terminated: false },
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual({
        ok: false,
        code: 'unsupported-source',
        terminated: false,
      });
    });

    it.each<[string, ClaudeRegistryQueryResult]>([
      ['an unrecognized line', done(`\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\r\n${CANARY} something\r\n`)],
      ['a line under another key', done('\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Other\\Microsoft\r\n')],
      ['a nested path line', done('\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\A\\ClaudeCode\r\n')],
      ['overflow', { ...done(HKLM_POLICIES_LISTING), overflow: true }],
    ])('malformed: %s refuses', async (_label, reply) => {
      const registry = fakeRegistry({ 'HKLM\\SOFTWARE\\Policies': reply });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual(REFUSED);
    });

    it('a malformed parent listing refuses', async () => {
      const registry = fakeRegistry({
        'HKCU\\SOFTWARE\\Policies': done('', 1),
        'HKCU\\SOFTWARE': done(`\r\n${CANARY}\r\n`),
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual(REFUSED);
    });

    const STRUCTURELESS: ReadonlyArray<[string, string]> = [
      ['empty', ''],
      ['whitespace-only', '\r\n   \r\n\t\r\n'],
      ['value-only (no header)', `\r\n    Secret    REG_SZ    ${CANARY}\r\n    Other    REG_DWORD    0x1\r\n`],
    ];

    it.each(STRUCTURELESS)('malformed: %s exit-0 Policies listing refuses', async (_label, stdout) => {
      const registry = fakeRegistry({ 'HKLM\\SOFTWARE\\Policies': done(stdout) });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual(REFUSED);
      expect(registry.calls).toEqual(['HKLM\\SOFTWARE\\Policies']);
    });

    it.each(STRUCTURELESS)('malformed: %s exit-0 parent fallback listing refuses', async (_label, stdout) => {
      const registry = fakeRegistry({
        'HKCU\\SOFTWARE\\Policies': done('', 1),
        'HKCU\\SOFTWARE': done(stdout),
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toEqual(REFUSED);
      expect(registry.calls).toEqual(['HKLM\\SOFTWARE\\Policies', 'HKCU\\SOFTWARE\\Policies', 'HKCU\\SOFTWARE']);
    });

    it('a header-only listing (key with values, no subkeys) is well formed', async () => {
      const registry = fakeRegistry({
        'HKCU\\SOFTWARE\\Policies': done(
          ['', 'HKEY_CURRENT_USER\\SOFTWARE\\Policies', `    Secret    REG_SZ    ${CANARY}`, ''].join('\r\n'),
        ),
      });
      await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry }))).resolves.toMatchObject({
        ok: true,
        policy: { registry: 'absent' },
      });
    });

    it('passes the scan signal to every query', async () => {
      const controller = new AbortController();
      const registry = fakeRegistry();
      await scanClaudeAuthPolicy(request({ signal: controller.signal, queryRegistry: registry.queryRegistry }));
      for (const call of registry.queryRegistry.mock.calls) expect(call[1]).toBe(controller.signal);
    });
  });

  describe('settings files (S1, S2, S3, S5)', () => {
    const paths = {
      user: win32.join(CANONICAL_DIR, 'settings.json'),
      project: win32.join(CWD, '.claude', 'settings.json'),
      local: win32.join(CWD, '.claude', 'settings.local.json'),
      managed: win32.join(MANAGED_DIR, 'managed-settings.json'),
    };

    it('scans benign files and records the managed file as scanned', async () => {
      const { fs } = fakeFs({
        files: {
          [paths.user]: JSON.stringify({ model: 'opus' }),
          [paths.project]: JSON.stringify({ permissions: { allow: ['Read'] } }),
          [paths.local]: '{}',
          [paths.managed]: JSON.stringify({ cleanupPeriodDays: 30 }),
        },
      });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toMatchObject({
        ok: true,
        policy: { managedFile: 'scanned' },
      });
    });

    it.each(Object.entries(paths))('refuses an apiKeyHelper in the %s file', async (_label, path) => {
      const { fs } = fakeFs({ files: { [path]: JSON.stringify({ apiKeyHelper: `${CANARY}.cmd` }) } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('scans a settings-safe env key in <cwd>/.claude/settings.local.json (D63)', async () => {
      const { fs } = fakeFs({ files: { [paths.local]: JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'true' } }) } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toMatchObject({ ok: true });
    });

    it.each([
      ['ANTHROPIC_BASE_URL', { ANTHROPIC_BASE_URL: CANARY }],
      ['ANTHROPIC_API_KEY', { ANTHROPIC_API_KEY: CANARY }],
      ['CLAUDE_CODE_USE_BEDROCK', { CLAUDE_CODE_USE_BEDROCK: '1' }],
      ['CLAUDE_CONFIG_DIR', { CLAUDE_CONFIG_DIR: CANARY }],
      ['an unknown key', { SOME_UNKNOWN_KEY: '1' }],
      ['a safe key mixed with an unsafe key', { ENABLE_TOOL_SEARCH: 'true', ANTHROPIC_BASE_URL: CANARY }],
    ])('refuses %s in the local settings env', async (_label, env) => {
      const { fs } = fakeFs({ files: { [paths.local]: JSON.stringify({ env }) } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('refuses enabledPlugins in <cwd>/.claude/settings.json', async () => {
      const { fs } = fakeFs({ files: { [paths.project]: JSON.stringify({ enabledPlugins: { x: true } }) } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('refuses an unparseable file, a non-object value and an oversized file', async () => {
      for (const content of ['{ broken', '[]', JSON.stringify({ pad: 'x'.repeat(256 * 1024) })]) {
        const { fs } = fakeFs({ files: { [paths.user]: content } });
        await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
      }
    });

    it('refuses a read error other than ENOENT', async () => {
      const { fs } = fakeFs({ errors: { [paths.managed]: 'EACCES' } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });
  });

  describe('managed drop-in directory (S6)', () => {
    it('refuses a .json file holding apiKeyHelper', async () => {
      const { fs } = fakeFs({
        dirs: { [DROP_IN_DIR]: [entry('10-auth.json')] },
        files: { [win32.join(DROP_IN_DIR, '10-auth.json')]: JSON.stringify({ apiKeyHelper: CANARY }) },
      });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('is absent with only .hidden.json and README.txt', async () => {
      const { fs, calls } = fakeFs({ dirs: { [DROP_IN_DIR]: [entry('.hidden.json'), entry('README.txt')] } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toMatchObject({
        ok: true,
        policy: { managedDropIn: 'absent' },
      });
      expect(calls.filter((call) => call.startsWith(`readFile ${DROP_IN_DIR}`))).toEqual([]);
    });

    it('records a benign drop-in as scanned', async () => {
      const { fs } = fakeFs({
        dirs: { [DROP_IN_DIR]: [entry('20-ui.json'), entry('sub.json', 'dir')] },
        files: { [win32.join(DROP_IN_DIR, '20-ui.json')]: JSON.stringify({ theme: 'dark' }) },
      });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toMatchObject({
        ok: true,
        policy: { managedDropIn: 'scanned' },
      });
    });

    it('refuses readdir EACCES', async () => {
      const { fs } = fakeFs({ errors: { [DROP_IN_DIR]: 'EACCES' } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('refuses a symlink entry', async () => {
      const { fs } = fakeFs({ dirs: { [DROP_IN_DIR]: [entry('link.json', 'symlink')] } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('refuses 33 entries', async () => {
      const listing = Array.from({ length: 33 }, (_, index) => entry(`note-${index}.txt`));
      const { fs } = fakeFs({ dirs: { [DROP_IN_DIR]: listing } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('refuses a listed file that cannot be read', async () => {
      const { fs } = fakeFs({ dirs: { [DROP_IN_DIR]: [entry('gone.json')] } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });
  });

  describe('remote signals (S9)', () => {
    it.each(CLAUDE_REMOTE_SETTINGS_FILES)('refuses when %s is present', async (name) => {
      const { fs } = fakeFs({ present: [win32.join(CANONICAL_DIR, name)] });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('refuses lstat EPERM', async () => {
      const { fs } = fakeFs({ errors: { [win32.join(CANONICAL_DIR, 'remote-settings.json')]: 'EPERM' } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('records all ENOENT as remoteSignals absent (recorded, not proof)', async () => {
      const { fs, calls } = fakeFs();
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toMatchObject({
        ok: true,
        policy: { remoteSignals: 'absent' },
      });
      for (const name of CLAUDE_REMOTE_SETTINGS_FILES) {
        expect(calls).toContain(`lstat ${win32.join(CANONICAL_DIR, name)}`);
      }
    });

    it('claudeRemoteSignalsAbsent reports each signal on its own', async () => {
      await expect(claudeRemoteSignalsAbsent(CANONICAL_DIR, 'win32', fakeFs().fs)).resolves.toBe(true);
      const present = fakeFs({ present: [win32.join(CANONICAL_DIR, 'remote-settings-helper-consent')] });
      await expect(claudeRemoteSignalsAbsent(CANONICAL_DIR, 'win32', present.fs)).resolves.toBe(false);
    });
  });

  describe('ancestor context (S4)', () => {
    const ancestor = 'C:\\Users\\dev\\work';

    it('refuses an ancestor holding .git and .claude/settings.local.json', async () => {
      const { fs } = fakeFs({
        present: [win32.join(ancestor, '.git'), win32.join(ancestor, '.claude', 'settings.local.json')],
      });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('passes an ancestor with .git only', async () => {
      const { fs } = fakeFs({ present: [win32.join(ancestor, '.git')] });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toMatchObject({ ok: true });
    });

    it('passes the home pattern: .claude/settings.json and no .git', async () => {
      const home = 'C:\\Users\\dev';
      const { fs } = fakeFs({
        files: { [win32.join(home, '.claude', 'settings.json')]: JSON.stringify({ model: 'sonnet' }) },
      });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toMatchObject({ ok: true });
    });

    it('refuses lstat .git EACCES', async () => {
      const { fs } = fakeFs({ errors: { [win32.join('C:\\Users', '.git')]: 'EACCES' } });
      await expect(scanClaudeAuthPolicy(request({ fs }))).resolves.toEqual(REFUSED);
    });

    it('refuses 65 ancestors and accepts 64', async () => {
      const deep = (count: number) =>
        `C:\\${Array.from({ length: count }, (_, index) => `d${index}`).join('\\')}`;
      // `C:\d0\...\d64` has 64 directory ancestors plus the drive root.
      await expect(scanClaudeAuthPolicy(request({ cwd: deep(65) }))).resolves.toEqual(REFUSED);
      await expect(scanClaudeAuthPolicy(request({ cwd: deep(64) }))).resolves.toMatchObject({ ok: true });
    });
  });

  it('returns cancelled when the signal is already aborted, without I/O', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fs, calls } = fakeFs();
    const registry = fakeRegistry();
    await expect(
      scanClaudeAuthPolicy(request({ signal: controller.signal, fs, queryRegistry: registry.queryRegistry })),
    ).resolves.toEqual({ ok: false, code: 'cancelled', terminated: true });
    expect(calls).toEqual([]);
    expect(registry.queryRegistry).not.toHaveBeenCalled();
  });

  it('canary: no fixture output, value line or path reaches any result', async () => {
    const results = await Promise.all([
      scanClaudeAuthPolicy(
        request({
          queryRegistry: fakeRegistry({
            'HKLM\\SOFTWARE\\Policies': done(
              `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\r\n    V    REG_SZ    ${CANARY}\r\n${CANARY}\r\n`,
            ),
          }).queryRegistry,
        }),
      ),
      scanClaudeAuthPolicy(
        request({
          fs: fakeFs({
            files: { [win32.join(CANONICAL_DIR, 'settings.json')]: JSON.stringify({ apiKeyHelper: CANARY }) },
          }).fs,
        }),
      ),
      scanClaudeAuthPolicy(request()),
    ]);
    for (const result of results) {
      const serialized = JSON.stringify(result);
      for (const leak of [CANARY, 'Users', 'Program Files', 'HKEY', 'ClaudeCode', 'settings']) {
        expect(serialized).not.toContain(leak);
      }
    }
  });
});

describe('scanClaudeAuthPolicy with a reg.exe child that outlives its limit (close receipts)', () => {
  /** Fake `reg.exe` child: never a real process. */
  class RegChild extends EventEmitter implements SpawnedProcessHandle {
    readonly stdin = new PassThrough();
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly pid = 4321;
    readonly killed = false;
    readonly exitCode = null;
    readonly whenSpawned = Promise.resolve(4321);
    kill(): boolean { return true; }
  }

  const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  let children: RegChild[];
  let command: ClaudeAccountCommand;

  beforeEach(() => {
    jest.useFakeTimers();
    children = [];
    const host = {
      platform: 'win32' as const, env: () => ({ SYSTEMROOT: 'C:\\Windows' }), tempDir: () => tmpdir(),
      stat: jest.fn().mockResolvedValue({ size: 1, mtimeMs: 1 }),
    };
    command = new ClaudeAccountCommand({ findExecutable: jest.fn() }, { spawnProcess: () => {
      const child = new RegChild(); children.push(child); return child;
    } }, host);
  });
  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.clearAllMocks(); jest.useRealTimers();
  });

  /** Runs the scan until the first query's limit (5 s) and kill grace (2 s) have passed. */
  async function stalledScan() {
    const pending = scanClaudeAuthPolicy(request({
      queryRegistry: (path, signal) => command.queryRegistry(path, signal),
    }));
    // The scan reads every file source before its first registry query.
    for (let i = 0; i < 1_000 && children.length === 0; i++) await Promise.resolve();
    expect(children).toHaveLength(1);
    await flush(); await jest.advanceTimersByTimeAsync(5_000); await flush();
    expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
    await jest.advanceTimersByTimeAsync(2_000); await flush();
    return pending;
  }

  it('hands the unproved child receipt to the caller, and a late close proves termination', async () => {
    const result = await stalledScan();
    expect(result).toEqual({ ok: false, code: 'unsupported-source', terminated: false, closeReceipts: [expect.anything()] });
    if (result.ok) throw new Error('expected a refusal');
    const [receipt] = result.closeReceipts ?? [];
    expect(children).toHaveLength(1);
    expect(receipt.closed).toBe(false);
    expect(children[0].listenerCount('close')).toBe(1);
    const closed = jest.fn();
    receipt.onClosed(closed);
    children[0].emit('close', 1, null); await flush();
    expect(receipt.closed).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(children[0].listenerCount('close')).toBe(0);
  });

  it('control: a child that never closes stays unproved, and disposing the receipt removes its listeners', async () => {
    const result = await stalledScan();
    if (result.ok) throw new Error('expected a refusal');
    const [receipt] = result.closeReceipts ?? [];
    await jest.advanceTimersByTimeAsync(600_000);
    expect(receipt.closed).toBe(false);
    expect(children[0].listenerCount('close')).toBe(1);
    receipt.dispose();
    expect(children[0].listenerCount('close')).toBe(0);
    expect(children[0].listenerCount('error')).toBe(0);
    children[0].emit('close', 1, null); await flush();
    expect(receipt.closed).toBe(false);
  });

  it('returns no receipt when an unproved child left none, so the refusal stays unobservable', async () => {
    const registry = fakeRegistry({
      'HKLM\\SOFTWARE\\Policies': { exitCode: null, stdout: '', terminated: false, timedOut: true, overflow: false },
    });
    await expect(scanClaudeAuthPolicy(request({ queryRegistry: registry.queryRegistry })))
      .resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: false });
  });
});
