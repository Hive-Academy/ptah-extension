import { resolve } from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { app } from 'electron';
import { RepoIdentitySchema, type RepoIdentity, type RepositorySettings } from '@ptah-extension/review-contracts';
import { ReviewRepositoryUnavailableError, type IReviewSettingsStore, type ReviewRoots, type ReviewStageEnvironment } from '@ptah-extension/review-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { ReviewCommandRunner } from './review-command-runner';

function originIdentity(url: string): { owner: string; name: string } | null {
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? { owner: match[1], name: match[2] } : null;
}

/** Resolves the configured review repository to the active Electron checkout. */
export class ElectronReviewEnvironment implements ReviewStageEnvironment {
  constructor(
    private readonly settingsStore: Pick<IReviewSettingsStore, 'getSettings'>,
    private readonly workspace: Pick<IWorkspaceProvider, 'getWorkspaceRoot'>,
    private readonly userDataRoot: () => string = () => app.getPath('userData'),
    private readonly inspect: (cwd: string) => Promise<{ topLevel: string; origin: string }> = ReviewCommandRunner.inspectCheckout,
  ) {}

  async resolve(repo: RepoIdentity): Promise<ReviewRoots> {
    const parsed = RepoIdentitySchema.safeParse(repo);
    if (!parsed.success) throw new ReviewRepositoryUnavailableError();
    const identity = parsed.data;
    const settings = await this.settingsStore.getSettings();
    const configured = settings?.repositories.find((entry: RepositorySettings) => entry.enabled &&
      entry.owner === identity.owner && entry.name === identity.name);
    const repoRoot = this.workspace.getWorkspaceRoot();
    if (!configured || !repoRoot) throw new ReviewRepositoryUnavailableError();
    try {
      const checkout = await realpath(repoRoot);
      const { topLevel, origin } = await this.inspect(checkout);
      const remote = originIdentity(origin);
      if (await realpath(topLevel.trim()) !== checkout || !remote ||
          remote.owner.toLowerCase() !== identity.owner.toLowerCase() ||
          remote.name.toLowerCase() !== identity.name.toLowerCase())
        throw new ReviewRepositoryUnavailableError();
      const attemptsRoot = resolve(this.userDataRoot(), 'review', 'attempts', identity.owner, identity.name);
      await mkdir(attemptsRoot, { recursive: true });
      return { repoRoot: checkout, attemptsRoot };
    } catch {
      throw new ReviewRepositoryUnavailableError();
    }
  }

  async settings(): Promise<unknown> { return this.settingsStore.getSettings(); }
  async baseConfig(): Promise<null> { return null; }
}
