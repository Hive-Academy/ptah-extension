import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { IReviewSecretPresence } from '@ptah-extension/review-core';
import { REVIEW_GITHUB_TOKEN_KEY } from '@ptah-extension/review-github';

/** Exposes credential availability to review settings without exposing its value. */
export class ReviewSecretPresence implements IReviewSecretPresence {
  constructor(private readonly secrets: Pick<ISecretStorage, 'get'>) {}

  async hasToken(): Promise<boolean> {
    const token = await this.secrets.get(REVIEW_GITHUB_TOKEN_KEY);
    return typeof token === 'string' && token.trim().length > 0;
  }
}
