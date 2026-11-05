import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperatorSettingsSchema } from '@ptah-extension/review-contracts';
import { ReviewGitTimeoutError, ReviewRepositoryUnavailableError } from '@ptah-extension/review-core';
import { ElectronReviewEnvironment, ReviewGitProbeError } from './electron-review-environment';
import { ReviewCommandRunner } from './review-command-runner';

const repo = { owner: 'Hive-Academy', name: 'PtahCode' } as const;

describe('ElectronReviewEnvironment', () => {
  it('provides only the stored bot token as a redaction secret', async () => {
    const environment = new ElectronReviewEnvironment({ getSettings: async () => null },
      { getWorkspaceFolders: () => []}, undefined, undefined, undefined,
      { get: async () => 'secret-canary' });
    expect(await environment.redactionSecrets()).toEqual(['secret-canary']);
  });
  it('loads only the requested base SHA and validates bounded YAML policy', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-base-config-'));
    try {
      const settings = OperatorSettingsSchema.parse({ repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
        maintainerLogins: ['maintainer'], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [] });
      const readConfig = jest.fn().mockResolvedValue('version: 1\nchecks:\n  eslint: true\n  degradationAudit: false\npathInstructions:\n  - glob: "src/**"\n    instruction: Check callers\n');
      const environment = new ElectronReviewEnvironment({ getSettings: async () => settings },
        { getWorkspaceFolders: () => [data]}, () => data,
        async () => ({ topLevel: data, origin: 'git@github.com:Hive-Academy/PtahCode.git' }), readConfig);
      const baseSha = 'b'.repeat(40);
      expect(await environment.baseConfig(repo, baseSha)).toMatchObject({ checks: { eslint: true, degradationAudit: false },
        pathInstructions: [{ glob: 'src/**', instruction: 'Check callers' }] });
      expect(readConfig).toHaveBeenCalledWith(data, baseSha);
      await expect(environment.baseConfig(repo, 'invalid')).rejects.toThrow();
      expect(readConfig).toHaveBeenCalledTimes(1);
      readConfig.mockResolvedValue('version: 1\nextra: untrusted');
      await expect(environment.baseConfig(repo, baseSha)).rejects.toThrow('extra');
    } finally { await rm(data, { recursive: true, force: true }); }
  });
  it('resolves the configured repository to an open checkout', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-environment-'));
    const probe = jest.spyOn(ReviewCommandRunner, 'inspectCheckout')
      .mockResolvedValue({ topLevel: data, origin: 'git@github.com:Hive-Academy/PtahCode.git' });
    try {
      const settings = OperatorSettingsSchema.parse({
        repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
        maintainerLogins: ['maintainer'], pollMinutes: 10,
        globalPublicationPaused: false, fallbackFamilies: [],
      });
      const environment = new ElectronReviewEnvironment(
        { getSettings: async () => settings }, { getWorkspaceFolders: () => [data]}, () => data,
      );
      const roots = await environment.resolve(repo);
      expect(probe).toHaveBeenCalledWith(data);
      expect(roots.repoRoot).toBe(data);
      expect(roots.attemptsRoot).toBe(join(data, 'review', 'attempts', repo.owner, repo.name));
      const https = new ElectronReviewEnvironment(
        { getSettings: async () => settings }, { getWorkspaceFolders: () => [data]}, () => data,
        async () => ({ topLevel: data, origin: 'https://github.com/hIvE-aCaDeMy/pTaHcOdE.git' }),
      );
      await expect(https.resolve(repo)).resolves.toMatchObject({ repoRoot: data });
    } finally { probe.mockRestore(); await rm(data, { recursive: true, force: true }); }
  });

  it('finds a matching checkout in a nonactive open workspace', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-multiple-'));
    const active = join(data, 'active');
    const target = join(data, 'target');
    await mkdir(active);
    await mkdir(target);
    try {
      const settings = OperatorSettingsSchema.parse({
        repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
        maintainerLogins: [], pollMinutes: 10,
        globalPublicationPaused: false, fallbackFamilies: [],
      });
      const inspect = jest.fn(async (cwd: string) => ({
        topLevel: cwd,
        origin: cwd === target
          ? 'https://github.com/hIvE-aCaDeMy/pTaHcOdE.git'
          : 'https://github.com/Other/Repository.git',
      }));
      const environment = new ElectronReviewEnvironment(
        { getSettings: async () => settings },
        { getWorkspaceFolders: () => [active, target] },
        () => data, inspect,
      );
      await expect(environment.resolve(repo)).resolves.toMatchObject({ repoRoot: target });
      expect(inspect).toHaveBeenCalledWith(active);
      expect(inspect).toHaveBeenCalledWith(target);
    } finally { await rm(data, { recursive: true, force: true }); }
  });

  it('does not accept a nested workspace as a repository root', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-nested-'));
    const nested = join(data, 'nested');
    await mkdir(nested);
    try {
      const settings = OperatorSettingsSchema.parse({
        repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
        maintainerLogins: [], pollMinutes: 10,
        globalPublicationPaused: false, fallbackFamilies: [],
      });
      const environment = new ElectronReviewEnvironment(
        { getSettings: async () => settings },
        { getWorkspaceFolders: () => [nested] },
        () => data,
        async () => ({ topLevel: data, origin: 'https://github.com/Hive-Academy/PtahCode.git' }),
      );
      await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
    } finally { await rm(data, { recursive: true, force: true }); }
  });

  it('rejects an unconfigured repository before creating an attempt root', async () => {
    const settings = OperatorSettingsSchema.parse({
      repositories: [], maintainerLogins: ['maintainer'], pollMinutes: 10,
      globalPublicationPaused: false, fallbackFamilies: [],
    });
    const inspect = jest.fn(async () => ({ topLevel: '/checkout', origin: 'git@github.com:Hive-Academy/PtahCode.git' }));
    const environment = new ElectronReviewEnvironment(
      { getSettings: async () => settings }, { getWorkspaceFolders: () => ['/checkout']},
      () => '/not-created-for-review', inspect,
    );
    await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('rejects a missing workspace before probing Git or creating an attempt root', async () => {
    const settings = OperatorSettingsSchema.parse({
      repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
      maintainerLogins: ['maintainer'], pollMinutes: 10,
      globalPublicationPaused: false, fallbackFamilies: [],
    });
    const inspect = jest.fn(async () => ({ topLevel: '/checkout', origin: 'git@github.com:Hive-Academy/PtahCode.git' }));
    const environment = new ElectronReviewEnvironment(
      { getSettings: async () => settings }, { getWorkspaceFolders: () => []},
      () => '/not-created-for-review', inspect,
    );
    await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('reports a Git probe failure for a checkout without an origin', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-no-origin-'));
    try {
      const settings = OperatorSettingsSchema.parse({
        repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
        maintainerLogins: ['maintainer'], pollMinutes: 10,
        globalPublicationPaused: false, fallbackFamilies: [],
      });
      const environment = new ElectronReviewEnvironment(
        { getSettings: async () => settings }, { getWorkspaceFolders: () => [data]},
        () => data, async () => { throw new Error('No origin'); },
      );
      await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewGitProbeError);
      await expect(import('node:fs/promises').then(({ access }) => access(join(data, 'review')))).rejects.toThrow();
    } finally { await rm(data, { recursive: true, force: true }); }
  });

  it('rejects a workspace with a different origin without creating an attempt root', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-origin-'));
    try {
      const settings = OperatorSettingsSchema.parse({
        repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
        maintainerLogins: ['maintainer'], pollMinutes: 10,
        globalPublicationPaused: false, fallbackFamilies: [],
      });
      const environment = new ElectronReviewEnvironment(
        { getSettings: async () => settings }, { getWorkspaceFolders: () => [data]}, () => data,
        async () => ({ topLevel: data, origin: 'https://github.com/SomeoneElse/Other.git' }),
      );
      await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
      await expect(import('node:fs/promises').then(({ access }) => access(join(data, 'review')))).rejects.toThrow();
    } finally { await rm(data, { recursive: true, force: true }); }
  });
  it('caches verified roots, expires them, and clears them when workspaces change', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-cache-'));
    const settings = OperatorSettingsSchema.parse({
      repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
      maintainerLogins: [], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [],
    });
    let changed: (() => void) | undefined;
    const inspect = jest.fn(async () => ({ topLevel: data, origin: 'https://github.com/Hive-Academy/PtahCode.git' }));
    const workspace = {
      getWorkspaceFolders: () => [data],
      onDidChangeWorkspaceFolders: (listener: () => void) => {
        changed = listener;
        return { dispose: () => undefined };
      },
    };
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const environment = new ElectronReviewEnvironment({ getSettings: async () => settings }, workspace, () => data, inspect);
      await environment.resolve(repo);
      await environment.resolve(repo);
      expect(inspect).toHaveBeenCalledTimes(1);
      now.mockReturnValue(301001);
      await environment.resolve(repo);
      expect(inspect).toHaveBeenCalledTimes(2);
      changed?.();
      await environment.resolve(repo);
      expect(inspect).toHaveBeenCalledTimes(3);
    } finally { now.mockRestore(); await rm(data, { recursive: true, force: true }); }
  });

  it('reports timeouts and mixed probe failures without claiming the checkout is missing', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-failed-probe-'));
    const other = join(data, 'other');
    await mkdir(other);
    const settings = OperatorSettingsSchema.parse({
      repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
      maintainerLogins: [], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [],
    });
    try {
      const timeout = new Error('timed out');
      Object.assign(timeout, { code: 'ETIMEDOUT' });
      const workspace = { getWorkspaceFolders: () => [data, other], getWorkspaceRoot: () => other };
      const inspect = jest.fn(async (cwd: string) => {
        if (cwd === other) throw timeout;
        return { topLevel: cwd, origin: 'https://github.com/Other/Repository.git' };
      });
      const environment = new ElectronReviewEnvironment({ getSettings: async () => settings }, workspace, () => data, inspect);
      await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewGitTimeoutError);
      expect(inspect.mock.calls.map(call => call[0])).toEqual([other, data]);
      inspect.mockImplementation(async (cwd: string) => {
        if (cwd === other) throw new Error('Git failed');
        return { topLevel: cwd, origin: 'https://github.com/Other/Repository.git' };
      });
      await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewGitProbeError);
      inspect.mockImplementation(async (cwd: string) => ({ topLevel: cwd, origin: 'https://github.com/Other/Repository.git' }));
      await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
    } finally { await rm(data, { recursive: true, force: true }); }
  });});
