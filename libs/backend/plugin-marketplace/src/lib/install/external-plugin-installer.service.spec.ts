/**
 * The consent gate, end to end, against a real temp filesystem and a fake
 * GitHub.
 *
 * Five properties are load-bearing and each has a test that fails loudly if the
 * behaviour regresses:
 *
 * 1. Planning writes nothing.
 * 2. Installing without a valid token is impossible.
 * 3. A token stops validating when the upstream version changes — this is how
 *    consent is re-required on upgrade, and it is not a separate mechanism.
 * 4. Traversing paths from the marketplace never produce a write outside the
 *    plugin directory.
 * 5. Binary payloads are skipped and reported, never written and never
 *    transcoded.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  FetchedBlob,
  GitTreeEntry,
} from '../github/github-content.client';
import {
  GitHubContentClient,
  decodeUtf8Strict,
} from '../github/github-content.client';
import { PluginMarketplaceError } from '../errors';
import { MarketplaceRegistryService } from '../registry/marketplace-registry.service';
import { ExternalPluginStateStore } from './external-plugin-state.store';
import { ExternalPluginInstallerService } from './external-plugin-installer.service';

const SOURCE = 'dotnet/skills';
const PLUGIN = 'dotnet-test';
const PLUGIN_ID = 'external:dotnet/skills/dotnet-test';
const SUBTREE = 'plugins/dotnet-test';

/** Files the fake repo serves, keyed by repo-relative path. */
type RepoFiles = Record<string, Buffer | string>;

const BASE_MANIFEST = {
  name: 'dotnet-agent-skills',
  owner: 'dotnet',
  plugins: [
    {
      name: PLUGIN,
      source: `./${SUBTREE}`,
      description: 'Run and debug .NET tests',
      mcpServers: {
        binlog: {
          command: 'dotnet',
          args: ['dnx', 'Microsoft.AITools.BinlogMcp', '--yes', '--prerelease'],
        },
      },
    },
  ],
};

/** A GitHub that serves exactly what a test says it serves. */
class FakeGitHub extends GitHubContentClient {
  manifest: unknown = BASE_MANIFEST;
  files: RepoFiles = {};
  /** Extra tree entries a real repo would never produce. */
  extraTreeEntries: GitTreeEntry[] = [];

  override async fetchMarketplaceManifest(): Promise<string> {
    return JSON.stringify(this.manifest);
  }

  override async fetchRepoTree(): Promise<GitTreeEntry[]> {
    return [
      ...Object.entries(this.files).map(([repoPath, content]) => ({
        path: repoPath,
        type: 'blob',
        size: toBuffer(content).length,
      })),
      ...this.extraTreeEntries,
    ];
  }

  override async fetchRepoFile(
    _owner: string,
    _repo: string,
    repoPath: string,
  ): Promise<FetchedBlob> {
    const content = this.files[repoPath];
    if (content === undefined) throw new Error(`missing fixture: ${repoPath}`);
    const bytes = toBuffer(content);
    return { bytes, text: decodeUtf8Strict(bytes) };
  }
}

function toBuffer(content: Buffer | string): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
}

function fakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** The subtree a healthy dotnet-test plugin would serve. */
function healthyRepoFiles(version = '1.2.0'): RepoFiles {
  return {
    [`${SUBTREE}/version.json`]: JSON.stringify({ version }),
    [`${SUBTREE}/.claude-plugin/plugin.json`]: JSON.stringify({
      name: 'Dotnet Test',
      version,
    }),
    [`${SUBTREE}/skills/run-tests/SKILL.md`]: '---\nname: run-tests\n---\nbody',
    [`${SUBTREE}/skills/debug-tests/SKILL.md`]:
      '---\nname: debug-tests\n---\nbody',
    [`${SUBTREE}/skills/run-tests/scripts/run.ps1`]: 'Write-Host "hi"',
    // A README that is not under scripts/ — must NOT be reported as a script.
    [`${SUBTREE}/README.md`]: '# dotnet-test',
  };
}

describe('ExternalPluginInstallerService', () => {
  let tmpDir: string;
  let pluginsBasePath: string;
  let github: FakeGitHub;
  let store: ExternalPluginStateStore;
  let registry: MarketplaceRegistryService;
  let installer: ExternalPluginInstallerService;

  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ptah-mkt-'));
    pluginsBasePath = path.join(tmpDir, 'plugins');
    await fsPromises.mkdir(pluginsBasePath, { recursive: true });

    github = new FakeGitHub();
    github.files = healthyRepoFiles();

    store = new ExternalPluginStateStore();
    store.initialize(pluginsBasePath);

    registry = new MarketplaceRegistryService(fakeLogger(), github, store);
    installer = new ExternalPluginInstallerService(
      fakeLogger(),
      github,
      registry,
      store,
    );
    installer.initialize(pluginsBasePath);

    await registry.addMarketplace(SOURCE);
  });

  afterEach(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  /** Absolute directory the plugin installs into. */
  const targetDir = (): string =>
    path.join(pluginsBasePath, 'external', 'dotnet', 'skills', PLUGIN);

  describe('planInstall', () => {
    it('writes nothing to disk', async () => {
      await installer.planInstall(SOURCE, PLUGIN);

      expect(fs.existsSync(targetDir())).toBe(false);
    });

    it('leaves no consent record, so the id stays unresolvable', async () => {
      await installer.planInstall(SOURCE, PLUGIN);

      expect(store.isInstalled(PLUGIN_ID)).toBe(false);
    });

    it('reports the version, display name, skills and file count', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);

      expect(plan.pluginId).toBe(PLUGIN_ID);
      expect(plan.version).toBe('1.2.0');
      expect(plan.displayName).toBe('Dotnet Test');
      expect(plan.skills).toEqual(['debug-tests', 'run-tests']);
      expect(plan.fileCount).toBe(6);
      expect(plan.totalBytes).toBeGreaterThan(0);
    });

    it('reports only files under a scripts/ directory as scripts', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);

      expect(plan.scriptFiles).toEqual(['skills/run-tests/scripts/run.ps1']);
    });

    it('renders the declared MCP command line verbatim and registers nothing', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);

      expect(plan.mcpServers).toEqual([
        {
          name: 'binlog',
          command: 'dotnet',
          args: ['dnx', 'Microsoft.AITools.BinlogMcp', '--yes', '--prerelease'],
          env: undefined,
          commandLine:
            'dotnet dnx Microsoft.AITools.BinlogMcp --yes --prerelease',
        },
      ]);
    });

    it('refuses a plugin the marketplace does not advertise', async () => {
      await expect(
        installer.planInstall(SOURCE, 'not-a-plugin'),
      ).rejects.toThrow(/does not advertise/);
    });

    it('refuses a marketplace that was never registered', async () => {
      await registry.removeMarketplace(SOURCE);

      await expect(installer.planInstall(SOURCE, PLUGIN)).rejects.toThrow(
        /not a registered marketplace/,
      );
    });
  });

  describe('consent is required before anything is written', () => {
    it('rejects a token that was never minted', async () => {
      await expect(installer.confirmInstall('f'.repeat(64))).rejects.toThrow(
        PluginMarketplaceError,
      );
      expect(fs.existsSync(targetDir())).toBe(false);
      expect(store.isInstalled(PLUGIN_ID)).toBe(false);
    });

    it('reports an unapproved install with the consent-required code', async () => {
      await expect(
        installer.confirmInstall('deadbeef'.repeat(8)),
      ).rejects.toMatchObject({ code: 'consent-required' });
    });

    it('installs when the plan token is echoed back', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);
      const result = await installer.confirmInstall(plan.consentToken);

      expect(result.pluginId).toBe(PLUGIN_ID);
      expect(result.installedVersion).toBe('1.2.0');
      expect(result.filesWritten).toBe(6);
      expect(
        fs.readFileSync(
          path.join(targetDir(), 'skills', 'run-tests', 'SKILL.md'),
          'utf-8',
        ),
      ).toContain('name: run-tests');
    });

    it('records the install, which is what makes the id resolvable', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);
      await installer.confirmInstall(plan.consentToken);

      expect(store.isInstalled(PLUGIN_ID)).toBe(true);
      expect(store.findInstalled(PLUGIN_ID)).toMatchObject({
        version: '1.2.0',
        source: SOURCE,
        plugin: PLUGIN,
      });
    });

    it('cannot replay one approval twice', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);
      await installer.confirmInstall(plan.consentToken);

      await expect(
        installer.confirmInstall(plan.consentToken),
      ).rejects.toMatchObject({ code: 'consent-required' });
    });
  });

  describe('consent is re-required when the installed version changes', () => {
    it('installs the version the user approved, never one published since', async () => {
      const firstPlan = await installer.planInstall(SOURCE, PLUGIN);
      expect(firstPlan.version).toBe('1.2.0');

      // Upstream publishes 2.0.0 between the dialog opening and the user
      // clicking confirm. Because the plan holds the bytes it described, the
      // confirm cannot swap in the newer payload — the classic
      // time-of-check/time-of-use swap is structurally impossible here.
      github.files = healthyRepoFiles('2.0.0');

      const result = await installer.confirmInstall(firstPlan.consentToken);

      expect(result.installedVersion).toBe('1.2.0');
      expect(
        JSON.parse(
          fs.readFileSync(path.join(targetDir(), 'version.json'), 'utf-8'),
        ),
      ).toEqual({ version: '1.2.0' });
    });

    it('will not install the newer version without a fresh approval', async () => {
      const firstPlan = await installer.planInstall(SOURCE, PLUGIN);
      await installer.confirmInstall(firstPlan.consentToken);

      github.files = healthyRepoFiles('2.0.0');
      registry.invalidate(SOURCE);

      // The recorded approval for 1.2.0 authorizes nothing further: replaying
      // it fails, so upgrading forces a new plan and a new dialog.
      await expect(
        installer.confirmInstall(firstPlan.consentToken),
      ).rejects.toMatchObject({ code: 'consent-required' });
      expect(store.findInstalled(PLUGIN_ID)?.version).toBe('1.2.0');
    });

    it('mints a different token for a different version', async () => {
      const v1 = await installer.planInstall(SOURCE, PLUGIN);
      github.files = healthyRepoFiles('2.0.0');
      const v2 = await installer.planInstall(SOURCE, PLUGIN);

      expect(v2.consentToken).not.toBe(v1.consentToken);
      expect(v2.version).toBe('2.0.0');
    });

    it('surfaces the installed version on the upgrade plan', async () => {
      const v1 = await installer.planInstall(SOURCE, PLUGIN);
      await installer.confirmInstall(v1.consentToken);

      github.files = healthyRepoFiles('2.0.0');
      registry.invalidate(SOURCE);
      const upgrade = await installer.planInstall(SOURCE, PLUGIN);

      expect(upgrade.installedVersion).toBe('1.2.0');
      expect(upgrade.version).toBe('2.0.0');
    });

    it('mints a different token when only the CONTENT changes', async () => {
      const before = await installer.planInstall(SOURCE, PLUGIN);

      const tampered = healthyRepoFiles();
      tampered[`${SUBTREE}/skills/run-tests/SKILL.md`] =
        '---\nname: run-tests\n---\nrm -rf /';
      github.files = tampered;

      const after = await installer.planInstall(SOURCE, PLUGIN);

      expect(after.version).toBe(before.version);
      expect(after.consentToken).not.toBe(before.consentToken);
    });

    it('removes files from the previous version on upgrade', async () => {
      const v1 = await installer.planInstall(SOURCE, PLUGIN);
      await installer.confirmInstall(v1.consentToken);
      expect(fs.existsSync(path.join(targetDir(), 'README.md'))).toBe(true);

      const trimmed = healthyRepoFiles('2.0.0');
      delete trimmed[`${SUBTREE}/README.md`];
      github.files = trimmed;
      registry.invalidate(SOURCE);

      const v2 = await installer.planInstall(SOURCE, PLUGIN);
      await installer.confirmInstall(v2.consentToken);

      expect(fs.existsSync(path.join(targetDir(), 'README.md'))).toBe(false);
      expect(
        fs.existsSync(
          path.join(targetDir(), 'skills', 'run-tests', 'SKILL.md'),
        ),
      ).toBe(true);
    });
  });

  describe('path traversal', () => {
    it.each([
      ['parent traversal', `${SUBTREE}/../../../evil.md`],
      ['nested traversal', `${SUBTREE}/skills/../../../../evil.md`],
      ['dot-dot segment', `${SUBTREE}/../evil.md`],
    ])('refuses a tree entry with %s', async (_label, hostilePath) => {
      github.extraTreeEntries = [{ path: hostilePath, type: 'blob', size: 10 }];

      await expect(installer.planInstall(SOURCE, PLUGIN)).rejects.toMatchObject(
        {
          code: 'path-traversal',
        },
      );
    });

    it('does not write outside the plugin directory when refusing', async () => {
      github.extraTreeEntries = [
        { path: `${SUBTREE}/../../../evil.md`, type: 'blob', size: 10 },
      ];

      await expect(installer.planInstall(SOURCE, PLUGIN)).rejects.toThrow();
      expect(fs.existsSync(path.join(tmpDir, 'evil.md'))).toBe(false);
      expect(fs.existsSync(path.join(pluginsBasePath, 'evil.md'))).toBe(false);
    });
  });

  describe('binary payloads are refused, not corrupted', () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]);

    beforeEach(() => {
      github.files = {
        ...healthyRepoFiles(),
        [`${SUBTREE}/assets/logo.png`]: binary,
      };
    });

    it('names the skipped file in the plan', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);

      expect(plan.skippedBinaryFiles).toEqual(['assets/logo.png']);
      expect(plan.fileCount).toBe(6);
    });

    it('never writes the skipped file', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);
      const result = await installer.confirmInstall(plan.consentToken);

      expect(result.skippedBinaryFiles).toEqual(['assets/logo.png']);
      expect(fs.existsSync(path.join(targetDir(), 'assets', 'logo.png'))).toBe(
        false,
      );
    });

    it('writes accepted text files byte-for-byte', async () => {
      // Non-ASCII UTF-8 must survive unchanged — "refuse binary" must not
      // become "refuse anything that is not ASCII".
      const unicode = '# Résumé — 日本語 ✅\n';
      github.files = {
        ...healthyRepoFiles(),
        [`${SUBTREE}/README.md`]: unicode,
      };

      const plan = await installer.planInstall(SOURCE, PLUGIN);
      await installer.confirmInstall(plan.consentToken);

      const written = fs.readFileSync(path.join(targetDir(), 'README.md'));
      expect(written.equals(Buffer.from(unicode, 'utf8'))).toBe(true);
      expect(plan.skippedBinaryFiles).toEqual([]);
    });
  });

  describe('uninstall', () => {
    it('removes the directory and the consent record together', async () => {
      const plan = await installer.planInstall(SOURCE, PLUGIN);
      await installer.confirmInstall(plan.consentToken);

      await expect(installer.uninstall(PLUGIN_ID)).resolves.toBe(true);

      expect(fs.existsSync(targetDir())).toBe(false);
      expect(store.isInstalled(PLUGIN_ID)).toBe(false);
    });

    it('is a no-op for an id that was never installed', async () => {
      await expect(installer.uninstall(PLUGIN_ID)).resolves.toBe(false);
    });

    it('refuses a malformed id rather than deleting anything', async () => {
      await expect(
        installer.uninstall('external:dotnet/skills/..'),
      ).resolves.toBe(false);
      expect(fs.existsSync(pluginsBasePath)).toBe(true);
    });
  });

  describe('a write that fails partway leaves nothing behind', () => {
    it('removes the partial tree and rethrows', async () => {
      // A repo whose file list is self-contradictory: `conflict` is a file, and
      // `conflict/nested.md` needs it to be a directory. The first write
      // succeeds, the second cannot, which is a real failure a hostile or
      // simply broken marketplace can produce — no mocking required.
      github.files = {
        ...healthyRepoFiles(),
        [`${SUBTREE}/conflict`]: 'i am a file',
        [`${SUBTREE}/conflict/nested.md`]: 'i need conflict to be a directory',
      };
      registry.invalidate(SOURCE);

      const plan = await installer.planInstall(SOURCE, PLUGIN);

      // Without the rollback the half-written tree would be invisible forever:
      // no consent record, so `listInstalled` never shows it,
      // `PluginLoaderService` never resolves it, and `pruneStaleFiles` treats
      // `external/` as a reserved root it must not touch.
      await expect(
        installer.confirmInstall(plan.consentToken),
      ).rejects.toThrow();

      expect(fs.existsSync(targetDir())).toBe(false);
      expect(store.isInstalled(PLUGIN_ID)).toBe(false);
    });
  });
});
