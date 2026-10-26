/**
 * PackInstallService — unit specs (TASK_2026_701 B8).
 *
 * Drives the real `AgentPackDownloadService` (network mocked at `https`)
 * against temp-dir workspaces, so every guard decision is checked on real
 * files. Harness collaborators (consent gate, propagation, origin store)
 * are jest doubles registered in a child container.
 *
 * Contracts:
 *   - plan writes nothing; sub-folder default → harness root; single-file
 *     plans are scoped; texts are capped.
 *   - install: create-only without a token; Replace needs a valid token, a
 *     `differs` row and the matching revision (A26); unreadable rows are
 *     forced Keep and a bulk Replace skips them (D13).
 *   - harness-root completion with ≥ 1 non-failed file → consent, origin
 *     forget for written files, one Library pass (A25, D9); opened-folder →
 *     none of it, `not-applicable`; all failed → `success:false`, no pass.
 */

import 'reflect-metadata';

// The agent-generation barrel reaches workspace-intelligence, whose
// tree-sitter loader evaluates `import.meta.url` at load time.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: { Node: 'node', General: 'general', Unknown: 'unknown' },
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
}));

import { EventEmitter } from 'events';

/** URL → response served by the mocked `https.get`. */
const mockResponses = new Map<string, { status: number; body: string }>();
const mockRequested: string[] = [];

interface MockResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string>;
  setEncoding: () => void;
  resume: () => void;
}

interface MockRequest extends EventEmitter {
  setTimeout: () => void;
  destroy: (err?: Error) => void;
}

function mockHttpGet(
  url: string,
  callback: (res: MockResponse) => void,
): MockRequest {
  mockRequested.push(url);
  const emitter = new EventEmitter();
  const req: MockRequest = Object.assign(emitter, {
    setTimeout: () => undefined,
    destroy: (err?: Error) => {
      if (err) emitter.emit('error', err);
    },
  });
  const response = mockResponses.get(url) ?? { status: 404, body: 'none' };
  setImmediate(() => {
    const res: MockResponse = Object.assign(new EventEmitter(), {
      statusCode: response.status,
      headers: {},
      setEncoding: () => undefined,
      resume: () => undefined,
    });
    callback(res);
    setImmediate(() => {
      res.emit('data', response.body);
      res.emit('end');
    });
  });
  return req;
}

jest.mock('https', () => ({
  get: jest.fn((url: string, cb: Parameters<typeof mockHttpGet>[1]) =>
    mockHttpGet(url, cb),
  ),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { container as rootContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  AgentPackDownloadService,
  PLATFORM_TOKENS,
} from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { HARNESS_SYNC_TOKENS } from '@ptah-extension/harness-sync';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  PackFilePlan,
  WizardInstallPackAgentsParams,
  WizardPlanPackInstallResult,
} from '@ptah-extension/shared';
import {
  PACK_INSTALL_PASS_REASON,
  PACK_PLAN_CONTENT_TTL_MS,
  PACK_PLAN_TEXT_CAP_BYTES,
  PackInstallService,
} from './pack-install.service';

const SOURCE =
  'https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/agent-pack-manifest.json';
const BASE_URL = 'https://packs.example.test/frontend';
const PACK_FILES: Record<string, string> = {
  'alpha.md': '# Alpha\n',
  'beta.md': '# Beta\n',
  'gamma.md': '# Gamma\n',
};

function servePack(files: Record<string, string> = PACK_FILES): void {
  mockResponses.set(SOURCE, {
    status: 200,
    body: JSON.stringify({
      name: 'Frontend',
      version: '1.0.0',
      description: 'pack',
      contentHash: 'h',
      baseUrl: BASE_URL,
      agents: Object.keys(PACK_FILES).map((file) => ({
        file,
        name: file,
        description: file,
        category: 'frontend',
      })),
    }),
  });
  for (const [file, body] of Object.entries(files)) {
    mockResponses.set(`${BASE_URL}/${file}`, { status: 200, body });
  }
}

interface Fixture {
  root: string;
  nested: string;
  service: PackInstallService;
  gate: { enable: jest.Mock };
  propagation: { propagateWithReport: jest.Mock };
  originStore: { forget: jest.Mock };
}

let tempDirs: string[] = [];

beforeEach(() => {
  mockResponses.clear();
  mockRequested.length = 0;
  servePack();
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function makeFixture(
  opts: { openFolder?: 'root' | 'nested'; propagation?: boolean } = {},
): Fixture {
  const root = path.resolve(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-pack-install-')),
  );
  tempDirs.push(root);
  // A root marker, so the harness root is this folder and not an ancestor.
  fs.mkdirSync(path.join(root, '.ptah'));
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(nested, { recursive: true });

  const container = rootContainer.createChildContainer();
  container.register(TOKENS.LOGGER, { useValue: createMockLogger() });
  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: createMockWorkspaceProvider({
      folders: [opts.openFolder === 'root' ? root : nested],
    }),
  });
  container.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: container });
  container.register(AgentPackDownloadService, {
    useValue: new AgentPackDownloadService(),
  });
  const originStore = { forget: jest.fn().mockResolvedValue(true) };
  container.register(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE, {
    useValue: originStore,
  });
  const gate = { enable: jest.fn().mockReturnValue(true) };
  container.register(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, { useValue: gate });
  const propagation = {
    propagateWithReport: jest
      .fn()
      .mockResolvedValue({ health: null, userLayer: 'refreshed' }),
  };
  if (opts.propagation !== false) {
    container.register(HARNESS_SYNC_TOKENS.PROPAGATION, {
      useValue: propagation,
    });
  }
  return {
    root,
    nested,
    service: container.resolve(PackInstallService),
    gate,
    propagation,
    originStore,
  };
}

function agentsDir(root: string): string {
  return path.join(root, '.claude', 'agents');
}

function writeLocal(root: string, file: string, text: string): string {
  const dest = path.join(agentsDir(root), file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  return dest;
}

function rowOf(plan: WizardPlanPackInstallResult, file: string): PackFilePlan {
  const row = plan.files.find((candidate) => candidate.file === file);
  if (!row) throw new Error(`no plan row for ${file}`);
  return row;
}

function installParams(
  overrides: Partial<WizardInstallPackAgentsParams> = {},
): WizardInstallPackAgentsParams {
  return { source: SOURCE, agentFiles: ['alpha.md'], ...overrides };
}

describe('PackInstallService.plan', () => {
  it('defaults a sub-folder workspace to the harness root and writes nothing', async () => {
    const f = makeFixture();
    writeLocal(f.root, 'beta.md', PACK_FILES['beta.md']);
    writeLocal(f.root, 'gamma.md', 'my gamma');
    const before = fs.readdirSync(agentsDir(f.root)).sort();

    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['alpha.md', 'beta.md', 'gamma.md'],
    });

    expect(plan.target).toEqual({
      harnessRoot: f.root,
      openedFolder: f.nested,
      chosen: 'harness-root',
      openedIsHarnessRoot: false,
    });
    expect(plan.planToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(plan.files.map((row) => row.state)).toEqual([
      'new',
      'identical',
      'differs',
    ]);
    expect(rowOf(plan, 'alpha.md').incomingText).toBe(PACK_FILES['alpha.md']);
    expect(rowOf(plan, 'beta.md').incomingText).toBeUndefined();
    expect(rowOf(plan, 'gamma.md')).toEqual(
      expect.objectContaining({
        localText: 'my gamma',
        incomingText: PACK_FILES['gamma.md'],
      }),
    );
    expect(new Set(plan.files.map((row) => row.revision)).size).toBe(3);
    expect(fs.readdirSync(agentsDir(f.root)).sort()).toEqual(before);
    expect(fs.existsSync(agentsDir(f.nested))).toBe(false);
    expect(f.gate.enable).not.toHaveBeenCalled();
    expect(f.propagation.propagateWithReport).not.toHaveBeenCalled();
  });

  it('plans only the requested file', async () => {
    const f = makeFixture();

    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['beta.md'],
    });

    expect(plan.files.map((row) => row.file)).toEqual(['beta.md']);
    expect(mockRequested).not.toContain(`${BASE_URL}/alpha.md`);
  });

  it('omits diff texts larger than the cap', async () => {
    const f = makeFixture();
    writeLocal(f.root, 'gamma.md', 'x'.repeat(PACK_PLAN_TEXT_CAP_BYTES + 1));

    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['gamma.md'],
    });

    expect(rowOf(plan, 'gamma.md').state).toBe('differs');
    expect(rowOf(plan, 'gamma.md').localText).toBeUndefined();
    expect(rowOf(plan, 'gamma.md').incomingText).toBe(PACK_FILES['gamma.md']);
  });

  it('rejects an untrusted source', async () => {
    const f = makeFixture();

    await expect(
      f.service.plan({
        source: 'https://evil.example.com/pack.json',
        agentFiles: ['alpha.md'],
      }),
    ).rejects.toThrow(/Untrusted agent pack source/);
  });

  it('fails the plan when a file cannot be downloaded', async () => {
    const f = makeFixture();
    mockResponses.delete(`${BASE_URL}/beta.md`);

    await expect(
      f.service.plan({ source: SOURCE, agentFiles: ['alpha.md', 'beta.md'] }),
    ).rejects.toThrow(/Could not download beta\.md/);
  });
});

describe('PackInstallService.install — guards', () => {
  it('without a token installs create-only: new files written, local files kept', async () => {
    const f = makeFixture();
    const gamma = writeLocal(f.root, 'gamma.md', 'my gamma');

    const result = await f.service.install(
      installParams({ agentFiles: ['alpha.md', 'gamma.md'] }),
    );

    expect(result.files).toEqual([
      { file: 'alpha.md', outcome: 'written' },
      { file: 'gamma.md', outcome: 'kept' },
    ]);
    expect(result.success).toBe(true);
    expect(result.fromCache).toBe(false);
    expect(fs.readFileSync(gamma, 'utf-8')).toBe('my gamma');
    expect(
      fs.readFileSync(path.join(agentsDir(f.root), 'alpha.md'), 'utf-8'),
    ).toBe(PACK_FILES['alpha.md']);
  });

  it('rejects a Replace without a token and writes nothing', async () => {
    const f = makeFixture();
    const gamma = writeLocal(f.root, 'gamma.md', 'my gamma');

    await expect(
      f.service.install(
        installParams({
          agentFiles: ['gamma.md'],
          decisions: { 'gamma.md': { decision: 'replace', revision: 'r' } },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(fs.readFileSync(gamma, 'utf-8')).toBe('my gamma');
    expect(f.propagation.propagateWithReport).not.toHaveBeenCalled();
  });

  it('replaces a differs file with the matching revision, using the plan bytes', async () => {
    const f = makeFixture();
    const gamma = writeLocal(f.root, 'gamma.md', 'my gamma');
    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['gamma.md'],
    });
    mockRequested.length = 0;

    const result = await f.service.install(
      installParams({
        agentFiles: ['gamma.md'],
        planToken: plan.planToken,
        decisions: {
          'gamma.md': {
            decision: 'replace',
            revision: rowOf(plan, 'gamma.md').revision,
          },
        },
      }),
    );

    expect(result.files).toEqual([{ file: 'gamma.md', outcome: 'written' }]);
    expect(result.fromCache).toBe(true);
    expect(mockRequested).not.toContain(`${BASE_URL}/gamma.md`);
    expect(fs.readFileSync(gamma, 'utf-8')).toBe(PACK_FILES['gamma.md']);
    expect(f.originStore.forget).toHaveBeenCalledWith(f.root, 'gamma');
  });

  it('keeps a differs file byte-identical when the decision is Keep', async () => {
    const f = makeFixture();
    const gamma = writeLocal(f.root, 'gamma.md', 'my gamma');
    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['gamma.md'],
    });

    const result = await f.service.install(
      installParams({
        agentFiles: ['gamma.md'],
        planToken: plan.planToken,
        decisions: { 'gamma.md': { decision: 'keep' } },
      }),
    );

    expect(result.files).toEqual([{ file: 'gamma.md', outcome: 'kept' }]);
    expect(fs.readFileSync(gamma, 'utf-8')).toBe('my gamma');
    expect(f.originStore.forget).not.toHaveBeenCalled();
  });

  it('rejects a Replace carrying the revision of an earlier plan (differs A → B)', async () => {
    const f = makeFixture();
    const gamma = writeLocal(f.root, 'gamma.md', 'version A');
    const planA = await f.service.plan({
      source: SOURCE,
      agentFiles: ['gamma.md'],
    });
    fs.writeFileSync(gamma, 'version B');
    const planB = await f.service.plan({
      source: SOURCE,
      agentFiles: ['gamma.md'],
    });
    expect(rowOf(planB, 'gamma.md').revision).not.toBe(
      rowOf(planA, 'gamma.md').revision,
    );

    await expect(
      f.service.install(
        installParams({
          agentFiles: ['gamma.md'],
          planToken: planB.planToken,
          decisions: {
            'gamma.md': {
              decision: 'replace',
              revision: rowOf(planA, 'gamma.md').revision,
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(fs.readFileSync(gamma, 'utf-8')).toBe('version B');
  });

  it('keeps a file edited after the plan (changed-since-preview)', async () => {
    const f = makeFixture();
    const gamma = writeLocal(f.root, 'gamma.md', 'version A');
    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['gamma.md'],
    });
    fs.writeFileSync(gamma, 'version B');

    const result = await f.service.install(
      installParams({
        agentFiles: ['gamma.md'],
        planToken: plan.planToken,
        decisions: {
          'gamma.md': {
            decision: 'replace',
            revision: rowOf(plan, 'gamma.md').revision,
          },
        },
      }),
    );

    expect(result.files).toEqual([
      { file: 'gamma.md', outcome: 'changed-since-preview' },
    ]);
    expect(fs.readFileSync(gamma, 'utf-8')).toBe('version B');
  });

  it('forces Keep for an unreadable file: its Replace is kept, never written (D13)', async () => {
    const f = makeFixture();
    // A directory where the agent file should be: reading it fails.
    fs.mkdirSync(path.join(agentsDir(f.root), 'beta.md'), { recursive: true });
    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['beta.md'],
    });
    expect(rowOf(plan, 'beta.md').state).toBe('unreadable');

    const result = await f.service.install(
      installParams({
        agentFiles: ['beta.md'],
        planToken: plan.planToken,
        decisions: {
          'beta.md': {
            decision: 'replace',
            revision: rowOf(plan, 'beta.md').revision,
          },
        },
      }),
    );

    expect(result.files).toEqual([{ file: 'beta.md', outcome: 'kept' }]);
    expect(
      fs.statSync(path.join(agentsDir(f.root), 'beta.md')).isDirectory(),
    ).toBe(true);
  });

  it('applies a whole-pack Replace to every differs file and skips unreadable ones (D13 bulk)', async () => {
    const f = makeFixture();
    const gamma = writeLocal(f.root, 'gamma.md', 'my gamma');
    fs.mkdirSync(path.join(agentsDir(f.root), 'beta.md'));
    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['alpha.md', 'beta.md', 'gamma.md'],
    });
    const decisions = Object.fromEntries(
      plan.files.map((row) => [
        row.file,
        { decision: 'replace' as const, revision: row.revision },
      ]),
    );

    const result = await f.service.install(
      installParams({
        agentFiles: ['alpha.md', 'beta.md', 'gamma.md'],
        planToken: plan.planToken,
        decisions,
      }),
    );

    expect(result.files).toEqual([
      { file: 'alpha.md', outcome: 'written' },
      { file: 'beta.md', outcome: 'kept' },
      { file: 'gamma.md', outcome: 'written' },
    ]);
    expect(fs.readFileSync(gamma, 'utf-8')).toBe(PACK_FILES['gamma.md']);
  });

  it('rejects a decision for a file that is not being installed', async () => {
    const f = makeFixture();

    await expect(
      f.service.install(
        installParams({
          agentFiles: ['alpha.md'],
          decisions: { 'beta.md': { decision: 'keep' } },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('ignores a token planned for another target, so its Replace is refused', async () => {
    const f = makeFixture();
    writeLocal(f.root, 'gamma.md', 'my gamma');
    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['gamma.md'],
    });

    await expect(
      f.service.install(
        installParams({
          agentFiles: ['gamma.md'],
          target: 'opened-folder',
          planToken: plan.planToken,
          decisions: {
            'gamma.md': {
              decision: 'replace',
              revision: rowOf(plan, 'gamma.md').revision,
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('re-downloads stale plan bytes but keeps the planned guards', async () => {
    const f = makeFixture();
    const gamma = writeLocal(f.root, 'gamma.md', 'my gamma');
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const plan = await f.service.plan({
      source: SOURCE,
      agentFiles: ['gamma.md'],
    });
    mockResponses.set(`${BASE_URL}/gamma.md`, {
      status: 200,
      body: '# Gamma v2\n',
    });
    clock.mockReturnValue(now + PACK_PLAN_CONTENT_TTL_MS + 1);

    const result = await f.service.install(
      installParams({
        agentFiles: ['gamma.md'],
        planToken: plan.planToken,
        decisions: {
          'gamma.md': {
            decision: 'replace',
            revision: rowOf(plan, 'gamma.md').revision,
          },
        },
      }),
    );

    expect(result.files).toEqual([{ file: 'gamma.md', outcome: 'written' }]);
    expect(result.fromCache).toBe(false);
    expect(fs.readFileSync(gamma, 'utf-8')).toBe('# Gamma v2\n');
  });

  it('refuses a workspace path that is not an open folder', async () => {
    const f = makeFixture();

    await expect(
      f.service.install(
        installParams({ workspacePath: path.join(f.root, 'elsewhere') }),
      ),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
  });
});

describe('PackInstallService.install — Library pass', () => {
  it('grants consent, forgets written slugs and runs one pass on a harness-root install', async () => {
    const f = makeFixture();

    const result = await f.service.install(
      installParams({ agentFiles: ['alpha.md', 'beta.md'] }),
    );

    expect(result.libraryPass).toBe('updated');
    expect(f.gate.enable).toHaveBeenCalledWith(f.root);
    expect(f.propagation.propagateWithReport).toHaveBeenCalledTimes(1);
    expect(f.propagation.propagateWithReport).toHaveBeenCalledWith(
      f.root,
      PACK_INSTALL_PASS_REASON,
    );
    expect(f.originStore.forget.mock.calls).toEqual([
      [f.root, 'alpha'],
      [f.root, 'beta'],
    ]);
  });

  it.each([
    [
      'all unchanged',
      (root: string) => {
        writeLocal(root, 'alpha.md', PACK_FILES['alpha.md']);
      },
      'unchanged',
    ],
    [
      'all kept',
      (root: string) => {
        writeLocal(root, 'alpha.md', 'mine');
      },
      'kept',
    ],
  ])(
    'runs the pass for a completion that wrote nothing (%s)',
    async (_label, arrange, outcome) => {
      const f = makeFixture();
      arrange(f.root);

      const result = await f.service.install(installParams());

      expect(result.files).toEqual([{ file: 'alpha.md', outcome }]);
      expect(result.success).toBe(true);
      expect(result.libraryPass).toBe('updated');
      expect(f.gate.enable).toHaveBeenCalledWith(f.root);
      expect(f.propagation.propagateWithReport).toHaveBeenCalledTimes(1);
      expect(f.originStore.forget).not.toHaveBeenCalled();
    },
  );

  it('runs the pass again on a re-install of the same pack', async () => {
    const f = makeFixture();
    await f.service.install(installParams());

    const again = await f.service.install(installParams());

    expect(again.files).toEqual([{ file: 'alpha.md', outcome: 'unchanged' }]);
    expect(again.libraryPass).toBe('updated');
    expect(f.propagation.propagateWithReport).toHaveBeenCalledTimes(2);
  });

  it('reports a failed refresh as libraryPass failed and keeps the outcomes', async () => {
    const f = makeFixture();
    f.propagation.propagateWithReport.mockResolvedValue({
      health: null,
      userLayer: 'failed',
    });

    const result = await f.service.install(installParams());

    expect(result.files).toEqual([{ file: 'alpha.md', outcome: 'written' }]);
    expect(result.success).toBe(true);
    expect(result.libraryPass).toBe('failed');
  });

  it('reports a throwing propagation as libraryPass failed', async () => {
    const f = makeFixture();
    f.propagation.propagateWithReport.mockRejectedValue(new Error('boom'));

    const result = await f.service.install(installParams());

    expect(result.success).toBe(true);
    expect(result.libraryPass).toBe('failed');
  });

  it('reports not-applicable on a host without propagation, after granting consent', async () => {
    const f = makeFixture({ propagation: false });

    const result = await f.service.install(installParams());

    expect(result.libraryPass).toBe('not-applicable');
    expect(f.gate.enable).toHaveBeenCalledWith(f.root);
  });

  it('writes to the opened folder without consent or a pass (not-applicable)', async () => {
    const f = makeFixture();

    const result = await f.service.install(
      installParams({ target: 'opened-folder' }),
    );

    expect(result.files).toEqual([{ file: 'alpha.md', outcome: 'written' }]);
    expect(result.libraryPass).toBe('not-applicable');
    expect(
      fs.existsSync(path.join(agentsDir(f.nested), 'alpha.md')),
    ).toBe(true);
    expect(fs.existsSync(path.join(agentsDir(f.root), 'alpha.md'))).toBe(
      false,
    );
    expect(f.gate.enable).not.toHaveBeenCalled();
    expect(f.propagation.propagateWithReport).not.toHaveBeenCalled();
    expect(f.originStore.forget).not.toHaveBeenCalled();
  });

  it('returns success:false with no consent and no pass when every file failed', async () => {
    const f = makeFixture();
    mockResponses.delete(`${BASE_URL}/alpha.md`);
    mockResponses.delete(`${BASE_URL}/beta.md`);

    const result = await f.service.install(
      installParams({ agentFiles: ['alpha.md', 'beta.md'] }),
    );

    expect(result.success).toBe(false);
    expect(result.files).toEqual([
      { file: 'alpha.md', outcome: 'failed' },
      { file: 'beta.md', outcome: 'failed' },
    ]);
    expect(result.error).toMatch(/2 file\(s\) failed/);
    expect(result.libraryPass).toBe('not-applicable');
    expect(f.gate.enable).not.toHaveBeenCalled();
    expect(f.propagation.propagateWithReport).not.toHaveBeenCalled();
  });

  it('succeeds with a partial failure and still runs the pass', async () => {
    const f = makeFixture();
    mockResponses.delete(`${BASE_URL}/beta.md`);

    const result = await f.service.install(
      installParams({ agentFiles: ['alpha.md', 'beta.md'] }),
    );

    expect(result.success).toBe(true);
    expect(result.agentsDownloaded).toBe(1);
    expect(result.files).toEqual([
      { file: 'alpha.md', outcome: 'written' },
      { file: 'beta.md', outcome: 'failed' },
    ]);
    expect(result.libraryPass).toBe('updated');
  });
});
