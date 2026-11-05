import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperatorSettingsSchema, type OperatorSettings, type RepositorySettings } from '@ptah-extension/review-contracts';
import { type IReviewSettingsStore, type ReviewRoots, type ReviewStageEnvironment } from '@ptah-extension/review-core';
import { resolveReviewRootsForPath } from './resolve-review-roots-for-path';

const base = join(tmpdir(), 'ptah-review-roots-spec');
const repo = { owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false } satisfies RepositorySettings;

function rootsFor(owner = repo.owner, name = repo.name): ReviewRoots {
  return {
    repoRoot: join(base, 'checkout', owner, name),
    attemptsRoot: join(base, 'attempts', owner, name),
  };
}

function settingsFor(repositories: RepositorySettings[]): OperatorSettings {
  return OperatorSettingsSchema.parse({
    repositories,
    maintainerLogins: [],
    pollMinutes: 10,
    globalPublicationPaused: false,
    fallbackFamilies: [],
  });
}

function fakeEnvironment(roots: ReviewRoots): ReviewStageEnvironment {
  return {
    resolve: jest.fn(async () => roots),
    settings: jest.fn(async () => null),
    baseConfig: jest.fn(async () => null),
  };
}

function fakeSettingsStore(settings: OperatorSettings | null): IReviewSettingsStore {
  return {
    getSettings: jest.fn(async () => settings),
    updateSettings: jest.fn(async (value: OperatorSettings) => value),
    listRepositories: jest.fn(async () => settings?.repositories ?? []),
    setPublicationPause: jest.fn(async () => undefined),
    getLiveGate: jest.fn(async () => null),
    setLiveGate: jest.fn(async () => undefined),
  };
}

describe('resolveReviewRootsForPath', () => {
  it('resolves the enabled repository named in the attempt path with only its identity', async () => {
    const roots = rootsFor();
    const environment = fakeEnvironment(roots);
    const settingsStore = fakeSettingsStore(settingsFor([repo]));

    await expect(resolveReviewRootsForPath(join(roots.attemptsRoot, 'attempt-1'), environment, settingsStore))
      .resolves.toBe(roots);
    expect(environment.resolve).toHaveBeenCalledTimes(1);
    expect(environment.resolve).toHaveBeenCalledWith({ owner: repo.owner, name: repo.name });
  });

  it('does not resolve enabled repositories absent from the path', async () => {
    const other = { ...repo, owner: 'Other-Org', name: 'OtherRepo' };
    const roots = rootsFor();
    const environment = fakeEnvironment(roots);
    const settingsStore = fakeSettingsStore(settingsFor([other, repo]));

    await expect(resolveReviewRootsForPath(join(roots.attemptsRoot, 'attempt-2'), environment, settingsStore))
      .resolves.toBe(roots);
    expect(environment.resolve).toHaveBeenCalledTimes(1);
    expect(environment.resolve).toHaveBeenCalledWith({ owner: repo.owner, name: repo.name });
  });

  it('matches owner and name without regard to case', async () => {
    const roots = rootsFor('hive-academy', 'ptahcode');
    const environment = fakeEnvironment(roots);
    const settingsStore = fakeSettingsStore(settingsFor([repo]));

    await expect(resolveReviewRootsForPath(join(roots.attemptsRoot, 'attempt-3'), environment, settingsStore))
      .resolves.toBe(roots);
    expect(environment.resolve).toHaveBeenCalledTimes(1);
    expect(environment.resolve).toHaveBeenCalledWith({ owner: repo.owner, name: repo.name });
  });

  it('never resolves a disabled repository', async () => {
    const roots = rootsFor();
    const environment = fakeEnvironment(roots);
    const settingsStore = fakeSettingsStore(settingsFor([{ ...repo, enabled: false }]));

    await expect(resolveReviewRootsForPath(join(roots.attemptsRoot, 'attempt-4'), environment, settingsStore))
      .rejects.toThrow('Review attempt is outside configured repository roots');
    expect(environment.resolve).not.toHaveBeenCalled();
  });

  it.each(['ReviewGitTimeoutError', 'Error'])('propagates the exact %s from resolve', async (name) => {
    const error = new Error('Repository probe failed');
    error.name = name;
    const roots = rootsFor();
    const environment = fakeEnvironment(roots);
    jest.mocked(environment.resolve).mockRejectedValue(error);
    const settingsStore = fakeSettingsStore(settingsFor([repo]));

    await expect(resolveReviewRootsForPath(join(roots.attemptsRoot, 'attempt-5'), environment, settingsStore))
      .rejects.toBe(error);
    expect(environment.resolve).toHaveBeenCalledTimes(1);
  });

  it('rejects a named repository path outside its attempts root', async () => {
    const roots = rootsFor();
    const environment = fakeEnvironment(roots);
    const settingsStore = fakeSettingsStore(settingsFor([repo]));
    const outside = join(base, 'elsewhere', repo.owner, repo.name, 'attempt-6');

    await expect(resolveReviewRootsForPath(outside, environment, settingsStore))
      .rejects.toThrow('Review attempt is outside configured repository roots');
    expect(environment.resolve).toHaveBeenCalledTimes(1);
  });

  it('rejects when settings are missing', async () => {
    const roots = rootsFor();
    const environment = fakeEnvironment(roots);
    const settingsStore = fakeSettingsStore(null);

    await expect(resolveReviewRootsForPath(join(roots.attemptsRoot, 'attempt-7'), environment, settingsStore))
      .rejects.toThrow('Review attempt is outside configured repository roots');
    expect(environment.resolve).not.toHaveBeenCalled();
  });
});
