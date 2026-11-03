import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { claudeIdentityReference } from '@ptah-extension/agent-sdk';
import type { ClaudeCertifiedExecutable, ClaudeCertifiedLaunchContext } from '@ptah-extension/auth-providers-tokens';
import type { ClaudeChildCloseReceipt } from './claude-account-command';
import { parseClaudeAccountStatus } from './claude-account-status';
import { CLAUDE_REMOTE_SETTINGS_FILES, type ClaudePolicyDirEntry, type ClaudeRegistryQueryResult } from './claude-auth-settings-scan';
import { resolveProviderAccountRoute, type CanonicalProviderAccountRoute } from './provider-account-route';
import { CLAUDE_CERTIFICATION_REUSE_MS, type ClaudeCertificationScope } from './claude-certification-cache';
import {
  ClaudeRouteCertifier,
  type ClaudeAuthContext,
  type ClaudeCliProbe,
  type ClaudeExecutableProbeResult,
  type ClaudeLogoutProbeResult,
  type ClaudeRouteCertifierFs,
  type ClaudeRouteCertifyRequest,
  type ClaudeStatusProbeResult,
} from './claude-route-certifier';

const MANAGED_DIR = 'C:\\Program Files\\ClaudeCode';
const DROP_IN_DIR = win32.join(MANAGED_DIR, 'managed-settings.d');
const RUN_CWD = 'C:\\work\\proj';
const SDK_PATH = 'C:\\tools\\claude\\cli.js';
const EMAIL = 'person@example.test';
const FINGERPRINT = { size: 4096, mtimeMs: 1_700_000_000_000 };

type Event = string;

interface FakeFsState {
  files: Map<string, string>;
  present: Set<string>;
  dirs: Map<string, readonly ClaudePolicyDirEntry[]>;
  errors: Map<string, string>;
  stats: Map<string, { size: number; mtimeMs: number }>;
}

function fsError(code: string): Error {
  return Object.assign(new Error(`fake ${code}`), { code });
}

function fileEntry(name: string): ClaudePolicyDirEntry {
  return { name, isFile: () => true, isSymbolicLink: () => false };
}

function fakeFs(events: Event[]): { fs: ClaudeRouteCertifierFs; state: FakeFsState } {
  const state: FakeFsState = {
    files: new Map(),
    present: new Set(),
    dirs: new Map(),
    errors: new Map(),
    stats: new Map([[SDK_PATH, { ...FINGERPRINT }]]),
  };
  const fail = (path: string): void => {
    const code = state.errors.get(path);
    if (code) throw fsError(code);
  };
  const fs: ClaudeRouteCertifierFs = {
    readFile: async (path) => {
      events.push('fs');
      fail(path);
      const content = state.files.get(path);
      if (content === undefined) throw fsError('ENOENT');
      return content;
    },
    lstat: async (path) => {
      events.push(`lstat:${win32.basename(path)}`);
      fail(path);
      if (state.files.has(path) || state.present.has(path) || state.dirs.has(path)) return {};
      throw fsError('ENOENT');
    },
    readdir: async (path) => {
      events.push('fs');
      fail(path);
      const entries = state.dirs.get(path);
      if (!entries) throw fsError('ENOENT');
      return entries;
    },
    stat: async (path) => {
      events.push('stat');
      fail(path);
      const stat = state.stats.get(path);
      if (!stat) throw fsError('ENOENT');
      return { ...stat };
    },
  };
  return { fs, state };
}

function registryOk(path: string, subkeys: readonly string[] = ['Microsoft']): ClaudeRegistryQueryResult {
  const root = path.replace(/^HKLM\\/, 'HKEY_LOCAL_MACHINE\\').replace(/^HKCU\\/, 'HKEY_CURRENT_USER\\');
  return {
    exitCode: 0,
    stdout: ['', root, ...subkeys.map((name) => `${root}\\${name}`), ''].join('\r\n'),
    terminated: true,
    timedOut: false,
    overflow: false,
  };
}

function statusJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    configDirectory: '',
    email: EMAIL,
    orgId: 'org-1',
    orgName: null,
    subscriptionType: 'max',
    ...overrides,
  });
}

interface Harness {
  readonly certifier: ClaudeRouteCertifier;
  readonly probe: jest.Mocked<ClaudeCliProbe>;
  readonly state: FakeFsState;
  readonly events: Event[];
  /** Status JSON per canonical directory; the default is a personal `max` login. */
  readonly statusFor: Map<string, string>;
  registry: (path: string) => ClaudeRegistryQueryResult;
  version: string;
  afterStatus?: () => void;
}

function harness(platform: NodeJS.Platform = 'win32', now: () => number = Date.now,
  logger: { warn: jest.Mock } | null = null): Harness {
  const events: Event[] = [];
  const { fs, state } = fakeFs(events);
  const statusFor = new Map<string, string>();
  const h = {
    events,
    state,
    statusFor,
    registry: (path: string) => registryOk(path),
    version: '2.1.310',
  } as Omit<Harness, 'certifier' | 'probe'> & Partial<Pick<Harness, 'certifier' | 'probe'>>;
  const probe: jest.Mocked<ClaudeCliProbe> = {
    certifyExecutable: jest.fn<Promise<ClaudeExecutableProbeResult>, [AbortSignal]>(async () => {
      events.push('executable');
      const executable: ClaudeCertifiedExecutable = {
        command: 'C:\\tools\\node.exe',
        prefixArgs: [SDK_PATH],
        sdkExecutablePath: SDK_PATH,
        version: h.version,
        fingerprint: { ...FINGERPRINT },
      };
      return { ok: true, executable, terminated: true };
    }),
    status: jest.fn<Promise<ClaudeStatusProbeResult>, [ClaudeAuthContext, AbortSignal]>(async (context) => {
      events.push('status');
      const text = statusFor.get(context.canonicalDir) ?? statusJson({ configDirectory: context.canonicalDir });
      const result = { status: parseClaudeAccountStatus(text, 0, context.canonicalDir, 'win32'), terminated: true };
      h.afterStatus?.();
      return result;
    }),
    logout: jest.fn<Promise<ClaudeLogoutProbeResult>, [ClaudeAuthContext, AbortSignal]>(
      async () => ({ exitCode: 0, terminated: true }),
    ),
    queryRegistry: jest.fn<Promise<ClaudeRegistryQueryResult>, [string, AbortSignal]>(async (path) => {
      events.push('registry');
      return h.registry(path);
    }),
  };
  return Object.assign(h, { probe, certifier: new ClaudeRouteCertifier(probe, platform, fs, logger, now) }) as Harness;
}

const tempDirs: string[] = [];

function newRoute(): CanonicalProviderAccountRoute {
  const dir = mkdtempSync(join(tmpdir(), 'ptah-certifier-'));
  tempDirs.push(dir);
  return resolveProviderAccountRoute(dir);
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const signal = (): AbortSignal => new AbortController().signal;

/** A child that outlived its limit and kill grace; `listeners` stand in for the child's listeners. */
class FakeReceipt implements ClaudeChildCloseReceipt {
  closed = false;
  readonly dispose = jest.fn(() => { this.listeners.clear(); });
  readonly listeners = new Set<() => void>();
  onClosed(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  close(): void {
    this.closed = true;
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}
const personalRef = claudeIdentityReference(EMAIL, null) as string;

function certifyRequest(route: CanonicalProviderAccountRoute, identityRef: string | null = personalRef) {
  return { route, profile: { identityRef }, cwd: RUN_CWD, settingSources: ['user', 'project'] as const, signal: signal() };
}

async function certified(h: Harness, route = newRoute()): Promise<ClaudeCertifiedLaunchContext> {
  const result = await h.certifier.certify(certifyRequest(route));
  if (!result.ok) throw new Error(`expected a launch, got ${result.code}`);
  return result.launch;
}

describe('ClaudeRouteCertifier.certify', () => {
  it('runs coverage, scan, executable, env, status, signal re-check, then revalidates', async () => {
    const h = harness();
    const route = newRoute();
    const result = await h.certifier.certify(certifyRequest(route));

    expect(result.ok).toBe(true);
    const executable = h.events.indexOf('executable');
    const status = h.events.indexOf('status');
    expect(h.events.slice(0, executable)).toEqual(expect.arrayContaining(['fs', 'registry', 'lstat:remote-settings.json']));
    expect(h.events.lastIndexOf('registry')).toBeLessThan(executable);
    expect(executable).toBeLessThan(status);
    expect(h.events.slice(status + 1)).toEqual(CLAUDE_REMOTE_SETTINGS_FILES.map((name) => `lstat:${name}`));
    if (!result.ok) return;
    expect(result.launch.accountClass).toBe('personal');
    expect(result.launch.identityReference).toBe(personalRef);
    expect(result.launch.cwd).toBe(RUN_CWD);
    expect(result.launch.settingSources).toEqual(['user', 'project']);
    expect(result.launch.env['CLAUDE_CONFIG_DIR']).toBe(route.canonicalPath);
    expect(result.launch.env['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(route.canonicalPath);
    expect(result.launch.policy).toEqual({
      coverage: 'win32@2.1.310', managedFile: 'absent', managedDropIn: 'absent', registry: 'absent', remoteSignals: 'absent',
    });
    expect(h.probe.status.mock.calls[0][0].cwd).toBe(RUN_CWD);
    expect(h.probe.logout).not.toHaveBeenCalled();
  });

  it('revalidates the route after the status child: a replaced directory is route-changed', async () => {
    const h = harness();
    const route = newRoute();
    h.afterStatus = () => rmSync(route.canonicalPath, { recursive: true, force: true });
    await expect(h.certifier.certify(certifyRequest(route))).resolves.toEqual({ ok: false, code: 'route-changed', terminated: true });
  });

  it.each(['darwin', 'linux'] as const)('refuses %s before any probe or fs call', async (platform) => {
    const h = harness(platform);
    await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({
      ok: false, code: 'unsupported-source', terminated: true,
    });
    expect(h.probe.certifyExecutable).not.toHaveBeenCalled();
    expect(h.probe.status).not.toHaveBeenCalled();
    expect(h.probe.logout).not.toHaveBeenCalled();
    expect(h.probe.queryRegistry).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
  });

  it.each(['2.1.309', '2.2.0'])('refuses the uncovered win32 version %s after the scan, without a status child', async (version) => {
    const logger = { warn: jest.fn() };
    const h = harness('win32', Date.now, logger);
    h.version = version;
    await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({
      ok: false, code: 'unsupported-source', terminated: true,
    });
    expect(h.events).toContain('registry');
    expect(h.probe.certifyExecutable).toHaveBeenCalledTimes(1);
    expect(h.probe.status).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls).toEqual([
      ['[ClaudeRouteCertifier] Claude CLI version is outside the policy coverage', { version, inspected: '2.1.310' }],
    ]);
  });

  it('certifies a later patch build of the inspected line and warns once per version', async () => {
    const logger = { warn: jest.fn() };
    const h = harness('win32', Date.now, logger);
    h.version = '2.1.312';
    await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toMatchObject({ ok: true });
    await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toMatchObject({ ok: true });
    expect(h.probe.status).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls).toEqual([
      ['[ClaudeRouteCertifier] Claude CLI version was not inspected; using the inspected policy sources',
        { version: '2.1.312', inspected: '2.1.310' }],
    ]);
  });

  it('refuses a build below 2.1.301 as unsupported-store', async () => {
    const h = harness();
    h.version = '2.1.300';
    await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toMatchObject({ ok: false, code: 'unsupported-store' });
    expect(h.probe.status).not.toHaveBeenCalled();
  });

  describe('unresolved managed source with a status that would succeed', () => {
    it('drop-in file with apiKeyHelper', async () => {
      const h = harness();
      h.state.dirs.set(DROP_IN_DIR, [fileEntry('10-auth.json')]);
      h.state.files.set(win32.join(DROP_IN_DIR, '10-auth.json'), JSON.stringify({ apiKeyHelper: 'helper.cmd' }));
      await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
      expect(h.probe.status).not.toHaveBeenCalled();
      expect(h.probe.certifyExecutable).not.toHaveBeenCalled();
    });

    it('HKLM ClaudeCode policy key present', async () => {
      const h = harness();
      h.registry = (path) => registryOk(path, path.startsWith('HKLM') ? ['Microsoft', 'ClaudeCode'] : ['Microsoft']);
      await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
      expect(h.probe.status).not.toHaveBeenCalled();
    });

    it.each(CLAUDE_REMOTE_SETTINGS_FILES)('remote signal %s present', async (name) => {
      const h = harness();
      const route = newRoute();
      h.state.present.add(win32.join(route.canonicalPath, name));
      await expect(h.certifier.certify(certifyRequest(route))).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
      expect(h.probe.status).not.toHaveBeenCalled();
    });

    it('ancestor with .git and .claude/settings.local.json', async () => {
      const h = harness();
      h.state.present.add('C:\\work\\.git');
      h.state.present.add('C:\\work\\.claude\\settings.local.json');
      await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
      expect(h.probe.status).not.toHaveBeenCalled();
    });
  });

  describe('account class (D13, D14 note 2)', () => {
    const classO: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['team', { subscriptionType: 'team' }],
      ['enterprise', { subscriptionType: 'enterprise' }],
      ['missing subscriptionType', { subscriptionType: undefined }],
      ['allowedProviders present', { allowedProviders: ['firstParty'] }],
      ['apiKeySource apiKeyHelper', { apiKeySource: 'apiKeyHelper' }],
      ['non-firstParty provider', { apiProvider: 'bedrock' }],
    ];

    it.each(classO)('%s refuses unsupported-source before the identity comparison', async (_label, overrides) => {
      const h = harness();
      const route = newRoute();
      // A different identity and directory: class O must still win over identity-mismatch.
      h.statusFor.set(route.canonicalPath, statusJson({ ...overrides, email: 'other@example.test', configDirectory: 'C:\\elsewhere' }));
      await expect(h.certifier.certify(certifyRequest(route))).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
      expect(h.probe.status).toHaveBeenCalledTimes(1);
    });

    it('class P with every S9 signal absent certifies as personal', async () => {
      const launch = await certified(harness());
      expect(launch.accountClass).toBe('personal');
    });

    it('class P with a different identity is identity-mismatch', async () => {
      const h = harness();
      const route = newRoute();
      h.statusFor.set(route.canonicalPath, statusJson({ email: 'other@example.test', configDirectory: route.canonicalPath }));
      await expect(h.certifier.certify(certifyRequest(route))).resolves.toEqual({ ok: false, code: 'identity-mismatch', terminated: true });
    });

    it('class P with a different config directory is identity-mismatch', async () => {
      const h = harness();
      const route = newRoute();
      h.statusFor.set(route.canonicalPath, statusJson({ configDirectory: 'C:\\elsewhere' }));
      await expect(h.certifier.certify(certifyRequest(route))).resolves.toEqual({ ok: false, code: 'identity-mismatch', terminated: true });
    });

    it('a profile without a stored identity is identity-unproved', async () => {
      const h = harness();
      await expect(h.certifier.certify(certifyRequest(newRoute(), null))).resolves.toMatchObject({ ok: false, code: 'identity-unproved' });
    });

    it('a signed-out or unparseable status is identity-unproved', async () => {
      const h = harness();
      const route = newRoute();
      h.statusFor.set(route.canonicalPath, 'not json');
      await expect(h.certifier.certify(certifyRequest(route))).resolves.toMatchObject({ ok: false, code: 'identity-unproved' });
    });
  });

  it('refuses when a remote signal appears after the status child closes', async () => {
    const h = harness();
    const route = newRoute();
    h.afterStatus = () => h.state.present.add(win32.join(route.canonicalPath, 'remote-settings.json'));
    await expect(h.certifier.certify(certifyRequest(route))).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
  });

  describe('terminated propagation', () => {
    it('a reg.exe timeout refuses with terminated:false and no Claude child', async () => {
      const h = harness();
      h.registry = () => ({ exitCode: null, stdout: '', terminated: false, timedOut: true, overflow: false });
      await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: false });
      expect(h.probe.certifyExecutable).not.toHaveBeenCalled();
    });

    it('an unobserved status close refuses with terminated:false', async () => {
      const h = harness();
      h.probe.status.mockResolvedValueOnce({ status: null, terminated: false });
      await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({ ok: false, code: 'identity-unproved', terminated: false });
    });

    it('an executable probe refusal keeps its code and terminated flag', async () => {
      const h = harness();
      h.probe.certifyExecutable.mockResolvedValueOnce({ ok: false, code: 'timeout', terminated: false });
      await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({ ok: false, code: 'timeout', terminated: false });
      expect(h.probe.status).not.toHaveBeenCalled();
    });

    it('run certification disposes an unproved --version receipt and keeps terminated:false', async () => {
      const h = harness();
      const receipt = new FakeReceipt();
      receipt.onClosed(() => undefined);
      h.probe.certifyExecutable.mockResolvedValueOnce({ ok: false, code: 'timeout', terminated: false, closeReceipt: receipt });
      await expect(h.certifier.certify(certifyRequest(newRoute()))).resolves.toEqual({ ok: false, code: 'timeout', terminated: false });
      expect(receipt.dispose).toHaveBeenCalledTimes(1);
      expect(receipt.listeners.size).toBe(0);
      expect(h.probe.status).not.toHaveBeenCalled();
    });

    it('an auth context hands the unproved --version receipt to its caller undisposed', async () => {
      const h = harness();
      const receipt = new FakeReceipt();
      h.probe.certifyExecutable.mockResolvedValueOnce({ ok: false, code: 'cancelled', terminated: false, closeReceipt: receipt });
      await expect(h.certifier.authContext({ route: newRoute(), signal: signal() }))
        .resolves.toEqual({ ok: false, code: 'cancelled', terminated: false, closeReceipts: [receipt] });
      expect(receipt.dispose).not.toHaveBeenCalled();
    });

    it.each([
      ['identity-unproved', false],
      ['route-changed', true],
    ] as const)('run certification disposes an unproved status receipt (%s)', async (code, routeChanged) => {
      const h = harness();
      const receipt = new FakeReceipt();
      receipt.onClosed(() => undefined);
      h.probe.status.mockResolvedValueOnce({
        status: null, terminated: false, closeReceipt: receipt, ...(routeChanged ? { routeChanged: true as const } : {}),
      });
      const result = await h.certifier.certify(certifyRequest(newRoute()));
      expect(result).toEqual({ ok: false, code, terminated: false });
      expect(receipt.dispose).toHaveBeenCalledTimes(1);
      expect(receipt.listeners.size).toBe(0);
      receipt.close();
      expect(receipt.dispose).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, code, terminated: false });
    });

    it('an aborted signal starts no child', async () => {
      const h = harness();
      const controller = new AbortController();
      controller.abort();
      const result = await h.certifier.certify({ ...certifyRequest(newRoute()), signal: controller.signal });
      expect(result).toMatchObject({ ok: false, code: 'cancelled' });
      expect(h.probe.certifyExecutable).not.toHaveBeenCalled();
    });
  });

  it('three profiles get distinct directories and digests; a class O third leaves them unaffected', async () => {
    const h = harness();
    const [a, b, c] = [newRoute(), newRoute(), newRoute()];
    const launchA = await certified(h, a);
    const launchB = await certified(h, b);
    const snapshot = JSON.stringify([launchA, launchB]);
    h.statusFor.set(c.canonicalPath, statusJson({ subscriptionType: 'team', configDirectory: c.canonicalPath }));

    await expect(h.certifier.certify(certifyRequest(c))).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
    expect(launchA.env['CLAUDE_CONFIG_DIR']).toBe(a.canonicalPath);
    expect(launchB.env['CLAUDE_CONFIG_DIR']).toBe(b.canonicalPath);
    expect(new Set([a.canonicalPath, b.canonicalPath, c.canonicalPath]).size).toBe(3);
    expect(launchA.envDigest).not.toBe(launchB.envDigest);
    expect(JSON.stringify([launchA, launchB])).toBe(snapshot);
    await expect(h.certifier.checkLaunch(launchA, signal())).resolves.toEqual({ ok: true });
    await expect(h.certifier.checkLaunch(launchB, signal())).resolves.toEqual({ ok: true });
  });
});

describe('ClaudeRouteCertifier.authContext and checkCoverage', () => {
  it('builds the context with cwd = canonical directory and starts no status child', async () => {
    const h = harness();
    const route = newRoute();
    const result = await h.certifier.authContext({ route, signal: signal() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.cwd).toBe(route.canonicalPath);
    expect(result.context.canonicalDir).toBe(route.canonicalPath);
    expect(result.context.env['CLAUDE_CONFIG_DIR']).toBe(route.canonicalPath);
    expect(h.probe.status).not.toHaveBeenCalled();
    expect(h.probe.logout).not.toHaveBeenCalled();

    await expect(h.certifier.checkCoverage(result.context, signal())).resolves.toEqual({ ok: true });
    h.state.present.add(win32.join(route.canonicalPath, 'remote-settings-consent.json'));
    await expect(h.certifier.checkCoverage(result.context, signal())).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
    expect(h.probe.certifyExecutable).toHaveBeenCalledTimes(1);
  });

  it('refuses on linux with no call', async () => {
    const h = harness('linux');
    await expect(h.certifier.authContext({ route: newRoute(), signal: signal() })).resolves.toEqual({
      ok: false, code: 'unsupported-source', terminated: true,
    });
    expect(h.events).toEqual([]);
  });
});

describe('ClaudeRouteCertifier.checkLaunch', () => {
  it('gives ok for unchanged sources and never starts a Claude child', async () => {
    const h = harness();
    const launch = await certified(h);
    h.probe.status.mockClear();
    h.probe.certifyExecutable.mockClear();
    await expect(h.certifier.checkLaunch(launch, signal())).resolves.toEqual({ ok: true });
    expect(h.probe.status).not.toHaveBeenCalled();
    expect(h.probe.certifyExecutable).not.toHaveBeenCalled();
    expect(h.probe.logout).not.toHaveBeenCalled();
    expect(h.events).toContain('stat');
  });

  it('refuses a drop-in file with apiKeyHelper added after certification', async () => {
    const h = harness();
    const launch = await certified(h);
    h.state.dirs.set(DROP_IN_DIR, [fileEntry('20-late.json')]);
    h.state.files.set(win32.join(DROP_IN_DIR, '20-late.json'), JSON.stringify({ apiKeyHelper: 'late.cmd' }));
    await expect(h.certifier.checkLaunch(launch, signal())).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
  });

  it('refuses a remote signal added after certification', async () => {
    const h = harness();
    const launch = await certified(h);
    h.state.present.add(win32.join(launch.env['CLAUDE_CONFIG_DIR'], 'remote-settings-helper-consent'));
    await expect(h.certifier.checkLaunch(launch, signal())).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
  });

  it('a changed mtime is identity-unproved without re-running --version', async () => {
    const h = harness();
    const launch = await certified(h);
    h.state.stats.set(SDK_PATH, { ...FINGERPRINT, mtimeMs: FINGERPRINT.mtimeMs + 1 });
    await expect(h.certifier.checkLaunch(launch, signal())).resolves.toEqual({ ok: false, code: 'identity-unproved', terminated: true });
    expect(h.probe.certifyExecutable).toHaveBeenCalledTimes(1);
  });

  it('a changed size or a stat error is identity-unproved', async () => {
    const h = harness();
    const launch = await certified(h);
    h.state.stats.set(SDK_PATH, { ...FINGERPRINT, size: FINGERPRINT.size + 1 });
    await expect(h.certifier.checkLaunch(launch, signal())).resolves.toMatchObject({ ok: false, code: 'identity-unproved' });
    h.state.errors.set(SDK_PATH, 'EACCES');
    await expect(h.certifier.checkLaunch(launch, signal())).resolves.toMatchObject({ ok: false, code: 'identity-unproved' });
  });

  it('refuses a known version outside the entry with no fs or registry call', async () => {
    const h = harness();
    const launch = await certified(h);
    h.events.length = 0;
    const uncovered = { ...launch, executable: { ...launch.executable, version: '2.2.0' } };
    await expect(h.certifier.checkLaunch(uncovered, signal())).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
    expect(h.events).toEqual([]);
  });

  it('a reg.exe timeout gives terminated:false', async () => {
    const h = harness();
    const launch = await certified(h);
    h.registry = () => ({ exitCode: null, stdout: '', terminated: false, timedOut: true, overflow: false });
    await expect(h.certifier.checkLaunch(launch, signal())).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: false });
    expect(h.probe.status).toHaveBeenCalledTimes(1);
  });

  it('refuses a launch certified under another coverage entry', async () => {
    const h = harness();
    const launch = await certified(h);
    const other = { ...launch, policy: { ...launch.policy, coverage: 'win32@2.1.309' } };
    await expect(h.certifier.checkLaunch(other, signal())).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
  });
});

describe('ClaudeRouteCertifier.certify reuse', () => {
  const scope: ClaudeCertificationScope = { profileId: 'profile-0001', revision: 3, authEpoch: 2, routeRevision: 1 };
  let clock: number;
  let h: Harness;
  let route: CanonicalProviderAccountRoute;
  let logger: { warn: jest.Mock };
  beforeEach(() => {
    clock = 1_000;
    logger = { warn: jest.fn() };
    h = harness('win32', () => clock, logger);
    route = newRoute();
  });
  const reuseRequest = (overrides: Partial<ClaudeRouteCertifyRequest> = {}): ClaudeRouteCertifyRequest =>
    ({ ...certifyRequest(route), reuse: scope, ...overrides });
  async function passes(request: ClaudeRouteCertifyRequest = reuseRequest()): Promise<ClaudeCertifiedLaunchContext> {
    const result = await h.certifier.certify(request);
    if (!result.ok) throw new Error(`expected a launch, got ${result.code}`);
    return result.launch;
  }

  it('reuses a passed certification without the policy scan or the status child', async () => {
    const first = await passes();
    h.events.length = 0;
    const second = await passes();
    expect(second).toBe(first);
    // One shared object for every admission: nothing in it can be changed.
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.env)).toBe(true);
    expect(Object.isFrozen(second.executable.fingerprint)).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(h.probe.status).toHaveBeenCalledTimes(1);
    expect(h.probe.certifyExecutable).toHaveBeenCalledTimes(1);
    // Only the cheap re-checks: the executable stat and the remote-signal files.
    expect(h.events).toEqual(['stat', ...CLAUDE_REMOTE_SETTINGS_FILES.map((name) => `lstat:${name}`)]);
  });

  it('never reuses without a scope', async () => {
    await passes(certifyRequest(route));
    await passes(certifyRequest(route));
    expect(h.probe.status).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['revision (status change, sign-in, sign-out)', { reuse: { ...scope, revision: 4 } }],
    ['auth epoch', { reuse: { ...scope, authEpoch: 3 } }],
    ['route revision', { reuse: { ...scope, routeRevision: 2 } }],
    ['working directory', { cwd: 'C:\\work\\other' }],
    ['setting sources', { settingSources: ['user'] as const }],
  ] as const)('certifies again when the %s differs', async (_label, overrides) => {
    await passes();
    await passes(reuseRequest(overrides));
    expect(h.probe.status).toHaveBeenCalledTimes(2);
  });

  it('certifies again when the stored identity differs', async () => {
    await passes();
    const result = await h.certifier.certify({ ...reuseRequest(), profile: { identityRef: 'other-identity' } });
    expect(result).toMatchObject({ ok: false, code: 'identity-mismatch' });
    expect(h.probe.status).toHaveBeenCalledTimes(2);
  });

  it('expires after the reuse window', async () => {
    await passes();
    clock += CLAUDE_CERTIFICATION_REUSE_MS - 1;
    await passes();
    expect(h.probe.status).toHaveBeenCalledTimes(1);
    clock += 1;
    await passes();
    expect(h.probe.status).toHaveBeenCalledTimes(2);
  });

  it('certifies again when the executable file changed', async () => {
    await passes();
    h.state.stats.set(SDK_PATH, { size: FINGERPRINT.size + 1, mtimeMs: FINGERPRINT.mtimeMs });
    await passes();
    expect(h.probe.status).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls).toEqual([
      ['[ClaudeRouteCertifier] Reused certification failed its re-check; certifying again', { step: 'executable' }],
    ]);
  });

  it('a refusal on the re-check falls back to full certification and drops the entry', async () => {
    await passes();
    const remoteFile = win32.join(route.canonicalPath, CLAUDE_REMOTE_SETTINGS_FILES[0]);
    h.state.present.add(remoteFile);
    await expect(h.certifier.certify(reuseRequest())).resolves.toEqual({ ok: false, code: 'unsupported-source', terminated: true });
    h.state.present.delete(remoteFile);
    const callsBefore = h.probe.status.mock.calls.length;
    await passes();
    expect(h.probe.status.mock.calls.length).toBe(callsBefore + 1);
  });

  it('a refused launch boundary drops the entry that handed the launch out', async () => {
    const launch = await passes();
    h.registry = (path) => registryOk(path, path.startsWith('HKLM') ? ['Microsoft', 'ClaudeCode'] : ['Microsoft']);
    await expect(h.certifier.checkLaunch(launch, signal())).resolves.toMatchObject({ ok: false, code: 'unsupported-source' });
    h.registry = (path) => registryOk(path);
    await passes();
    expect(h.probe.status).toHaveBeenCalledTimes(2);
  });
});
