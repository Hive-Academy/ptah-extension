import { injectable } from 'tsyringe';
import {
  OperatorSettingsSchema,
  RepoReviewConfigV1Schema,
  type RepoReviewConfigV1,
  type RepoIdentity,
} from '@ptah-extension/review-contracts';

export type EligibilityReason =
  | 'eligible' | 'untrusted-repository' | 'invalid-settings' | 'empty-allowlist'
  | 'repository-disabled' | 'invalid-config' | 'closed-or-merged'
  | 'draft' | 'fork' | 'untrusted-author';

export interface EligibilityInput {
  owner: string;
  name: string;
  authorLogin: string;
  state: 'open' | 'closed';
  draft: boolean;
  headIsFork: boolean;
  headRepoId: number | null;
  baseRepoId: number;
  settings: unknown;
  /** Null means the trusted base has no config file, so defaults apply. */
  baseConfig: unknown | null;
}

export interface EligibilityDecision { eligible: boolean; reason: EligibilityReason }
export type PublicationReason = 'allowed' | 'invalid-settings' | 'invalid-config' | 'global-pause' | 'repository-pause' | 'dry-run' | 'repository-disabled';
export interface PublicationDecision { allowed: boolean; reason: PublicationReason }
export interface EffectiveReviewSettings {
  laneCapPerPr: number;
  confidenceFloor: number;
  maxNewInline: number;
  minimumSeverity: RepoReviewConfigV1['minimumSeverity'];
}

@injectable()
export class ReviewPolicyService {
  eligibility(input: EligibilityInput): EligibilityDecision {
    const reject = (reason: EligibilityReason): EligibilityDecision => ({ eligible: false, reason });
    const settings = OperatorSettingsSchema.safeParse(input.settings);
    if (!settings.success) {
      if (this.isEmptyAllowlist(input.settings)) return reject('empty-allowlist');
      return reject('invalid-settings');
    }
    if (settings.data.maintainerLogins.length === 0) return reject('empty-allowlist');
    if (!settings.data.repositories.some((repo) => repo.enabled && repo.owner.toLowerCase() === input.owner.toLowerCase() && repo.name.toLowerCase() === input.name.toLowerCase())) return reject('repository-disabled');
    if (input.baseConfig !== null && !RepoReviewConfigV1Schema.safeParse(input.baseConfig).success) return reject('invalid-config');
    if (input.state !== 'open') return reject('closed-or-merged');
    if (input.draft) return reject('draft');
    if (input.headIsFork || input.headRepoId === null || input.headRepoId !== input.baseRepoId) return reject('fork');
    if (!settings.data.maintainerLogins.some((login) => login.toLowerCase() === input.authorLogin.toLowerCase())) return reject('untrusted-author');
    return { eligible: true, reason: 'eligible' };
  }

  publication(settingsInput: unknown, baseConfig: unknown | null, target: RepoIdentity): PublicationDecision {
    const settings = OperatorSettingsSchema.safeParse(settingsInput);
    if (!settings.success) return { allowed: false, reason: 'invalid-settings' };
    if (baseConfig !== null && !RepoReviewConfigV1Schema.safeParse(baseConfig).success) return { allowed: false, reason: 'invalid-config' };
    if (settings.data.globalPublicationPaused) return { allowed: false, reason: 'global-pause' };
    const repo = settings.data.repositories.find((entry) => entry.owner.toLowerCase() === target.owner.toLowerCase() && entry.name.toLowerCase() === target.name.toLowerCase());
    if (!repo?.enabled) return { allowed: false, reason: 'repository-disabled' };
    if (repo.publicationPaused) return { allowed: false, reason: 'repository-pause' };
    if (repo.dryRun) return { allowed: false, reason: 'dry-run' };
    return { allowed: true, reason: 'allowed' };
  }

  effectiveSettings(settingsInput: unknown, baseConfig: unknown | null): EffectiveReviewSettings | null {
    const settings = OperatorSettingsSchema.safeParse(settingsInput);
    const config = RepoReviewConfigV1Schema.safeParse(baseConfig ?? { version: 1 });
    if (!settings.success || !config.success) return null;
    return {
      laneCapPerPr: settings.data.laneCapPerPr,
      confidenceFloor: settings.data.confidenceFloor,
      maxNewInline: settings.data.maxNewInline,
      minimumSeverity: config.data.minimumSeverity,
    };
  }

  private isEmptyAllowlist(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || !('maintainerLogins' in value)) return false;
    return Array.isArray(value.maintainerLogins) && value.maintainerLogins.length === 0;
  }
}
