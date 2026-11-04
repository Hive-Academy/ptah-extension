import { resolve } from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { RepoIdentitySchema, RepoReviewConfigV1Schema, type RepoIdentity, type RepositorySettings } from '@ptah-extension/review-contracts';
import { ReviewRepositoryUnavailableError, type IReviewSettingsStore, type ReviewRoots, type ReviewStageEnvironment } from '@ptah-extension/review-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import { REVIEW_GITHUB_TOKEN_KEY } from '@ptah-extension/review-github';
import { ReviewCommandRunner } from './review-command-runner';

const execFileAsync = promisify(execFile);

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
    private readonly readConfig: (cwd: string, baseSha: string) => Promise<string | null> = ElectronReviewEnvironment.readBaseConfig,
    private readonly secretStorage?: Pick<ISecretStorage, 'get'>,
  ) {}

  async redactionSecrets(): Promise<string[]> {
    const token = await this.secretStorage?.get(REVIEW_GITHUB_TOKEN_KEY);
    return token ? [token] : [];
  }

  private static async readBaseConfig(cwd: string, baseSha: string): Promise<string | null> {
    const { stdout: names } = await execFileAsync('git', ['ls-tree', '--name-only', baseSha, '--', '.ptah-review.yaml'],
      { cwd, timeout: 10_000, maxBuffer: 131_072, windowsHide: true, shell: false });
    if (names.trim() !== '.ptah-review.yaml') return null;
    const { stdout } = await execFileAsync('git', ['show', `${baseSha}:.ptah-review.yaml`],
      { cwd, timeout: 10_000, maxBuffer: 131_072, windowsHide: true, shell: false });
    return stdout;
  }

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
  async baseConfig(repo: RepoIdentity, baseSha?: string): Promise<unknown | null> {
    if (baseSha === undefined) return null;
    const sha = z.string().regex(/^[a-f0-9]{40}$/i).parse(baseSha);
    const roots = await this.resolve(repo);
    const content = await this.readConfig(roots.repoRoot, sha);
    if (content === null) return null;
    if (content.length > 131_072) throw new Error('Review base config exceeds size limit');
    const document = parseDocument(content, { uniqueKeys: true });
    if (document.errors.length) throw new Error('Review base config YAML is invalid');
    const value: unknown = document.toJS();
    const parsed = RepoReviewConfigV1Schema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const location = issue?.path.join('.') || 'root';
      const keys = issue?.code === 'unrecognized_keys' ? `: ${issue.keys.join(', ')}` : '';
      throw new Error(`Review base config invalid at ${location}${keys}`);
    }
    return parsed.data;
  }
}
