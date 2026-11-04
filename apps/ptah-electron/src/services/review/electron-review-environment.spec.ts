import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperatorSettingsSchema } from '@ptah-extension/review-contracts';
import { ReviewRepositoryUnavailableError } from '@ptah-extension/review-core';
import { ElectronReviewEnvironment } from './electron-review-environment';
import { ReviewCommandRunner } from './review-command-runner';

const repo = { owner: 'Hive-Academy', name: 'PtahCode' } as const;

describe('ElectronReviewEnvironment', () => {
  it('provides only the stored bot token as a redaction secret', async () => {
    const environment = new ElectronReviewEnvironment({ getSettings: async () => null },
      { getWorkspaceRoot: () => '' }, undefined, undefined, undefined,
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
        { getWorkspaceRoot: () => data }, () => data,
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
  it('resolves the configured repository to the active checkout', async () => {
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
        { getSettings: async () => settings }, { getWorkspaceRoot: () => data }, () => data,
      );
      const roots = await environment.resolve(repo);
      expect(probe).toHaveBeenCalledWith(data);
      expect(roots.repoRoot).toBe(data);
      expect(roots.attemptsRoot).toBe(join(data, 'review', 'attempts', repo.owner, repo.name));
      const https = new ElectronReviewEnvironment(
        { getSettings: async () => settings }, { getWorkspaceRoot: () => data }, () => data,
        async () => ({ topLevel: data, origin: 'https://github.com/hIvE-aCaDeMy/pTaHcOdE.git' }),
      );
      await expect(https.resolve(repo)).resolves.toMatchObject({ repoRoot: data });
    } finally { probe.mockRestore(); await rm(data, { recursive: true, force: true }); }
  });

  it('rejects an unconfigured repository before creating an attempt root', async () => {
    const settings = OperatorSettingsSchema.parse({
      repositories: [], maintainerLogins: ['maintainer'], pollMinutes: 10,
      globalPublicationPaused: false, fallbackFamilies: [],
    });
    const inspect = jest.fn(async () => ({ topLevel: '/checkout', origin: 'git@github.com:Hive-Academy/PtahCode.git' }));
    const environment = new ElectronReviewEnvironment(
      { getSettings: async () => settings }, { getWorkspaceRoot: () => '/checkout' },
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
      { getSettings: async () => settings }, { getWorkspaceRoot: () => undefined },
      () => '/not-created-for-review', inspect,
    );
    await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('rejects a checkout without an origin', async () => {
    const data = await mkdtemp(join(tmpdir(), 'ptah-review-no-origin-'));
    try {
      const settings = OperatorSettingsSchema.parse({
        repositories: [{ ...repo, enabled: true, dryRun: true, publicationPaused: false }],
        maintainerLogins: ['maintainer'], pollMinutes: 10,
        globalPublicationPaused: false, fallbackFamilies: [],
      });
      const environment = new ElectronReviewEnvironment(
        { getSettings: async () => settings }, { getWorkspaceRoot: () => data },
        () => data, async () => { throw new Error('No origin'); },
      );
      await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
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
        { getSettings: async () => settings }, { getWorkspaceRoot: () => data }, () => data,
        async () => ({ topLevel: data, origin: 'https://github.com/SomeoneElse/Other.git' }),
      );
      await expect(environment.resolve(repo)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
      await expect(import('node:fs/promises').then(({ access }) => access(join(data, 'review')))).rejects.toThrow();
    } finally { await rm(data, { recursive: true, force: true }); }
  });
});
