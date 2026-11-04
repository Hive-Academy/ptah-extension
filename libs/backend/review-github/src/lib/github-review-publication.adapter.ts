import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { GitHubInlineComment, GitHubIssueComment, GitHubReview, IGitHubReviewPort, RepoIdentity } from '@ptah-extension/review-contracts';
import { RepoIdentitySchema, ShaSchema } from '@ptah-extension/review-contracts';
import { PLATFORM_TOKENS, type ISecretStorage } from '@ptah-extension/platform-core';
import { REVIEW_GITHUB_TOKEN_KEY, REVIEW_GITHUB_TOKENS } from '../di/tokens';
import { GitHubReviewError } from './github-review.error';

const API = 'https://api.github.com';
const MAX_BYTES = 10 * 1024 * 1024;
const walkthroughMarker = '<!-- ptah-review:walkthrough -->';
const reviewMarker = (sha: string) => `<!-- ptah-review:head:${sha} -->`;
const findingMarker = (id: string) => `<!-- ptah-review:finding:${id} -->`;
const positiveId = z.number().int().positive();
const issueResponse = z.object({
  id: positiveId, body: z.string(), user: z.object({ login: z.string().min(1) }),
  created_at: z.string().datetime(),
});
const reviewResponse = z.object({
  id: positiveId, body: z.string().nullable(), submitted_at: z.string().datetime().nullable(),
});
const targetSchema = z.object({ repo: RepoIdentitySchema, number: positiveId, headSha: ShaSchema });

/** The composition root supplies live policy; false blocks every write. */
export interface ReviewPublicationGuard {
  mayPublish(target: PublicationTarget): Promise<boolean>;
}
export type PublicationTarget = z.infer<typeof targetSchema>;
export interface PublicationInlineComment {
  findingId: string;
  path: string;
  line: number;
  body: string;
}
export interface PublicationResult {
  walkthrough: GitHubIssueComment;
  review: GitHubReview | null;
  deferred: PublicationInlineComment[];
}
export interface IGitHubReviewPublicationPort {
  publish(target: PublicationTarget, walkthrough: string, overview: string,
    candidates: PublicationInlineComment[], validRightAnchors: ReadonlySet<string>): Promise<PublicationResult>;
}

/** Stable key supplied by the diff validator for a RIGHT-side changed line. */
export function rightAnchorKey(path: string, line: number): string {
  return JSON.stringify([path, line]);
}

@injectable()
export class GithubReviewPublicationAdapter implements IGitHubReviewPublicationPort {
  constructor(
    @inject(PLATFORM_TOKENS.SECRET_STORAGE) private readonly secrets: ISecretStorage,
    @inject(REVIEW_GITHUB_TOKENS.FETCH) private readonly fetcher: typeof fetch,
    @inject(REVIEW_GITHUB_TOKENS.REVIEW_PORT) private readonly reader: IGitHubReviewPort,
    @inject(REVIEW_GITHUB_TOKENS.PUBLICATION_GUARD) private readonly guard: ReviewPublicationGuard,
  ) {}

  private async check(target: PublicationTarget): Promise<void> {
    if (!await this.guard.mayPublish(target)) {
      throw new GitHubReviewError('publication-unavailable', 'Review publication is paused');
    }
    const pull = await this.reader.getPull(target.repo, target.number);
    if (pull.state !== 'open' || pull.headSha !== target.headSha) {
      throw new GitHubReviewError('publication-unavailable', 'Pull request head is no longer current');
    }
    if (!await this.guard.mayPublish(target)) {
      throw new GitHubReviewError('publication-unavailable', 'Review publication is paused');
    }
  }

  private async request(target: PublicationTarget, method: 'POST' | 'PATCH', suffix: string, payload: object): Promise<Response> {
    const token = await this.secrets.get(REVIEW_GITHUB_TOKEN_KEY);
    if (!token) throw new GitHubReviewError('missing-token', 'GitHub bot token is unavailable');
    await this.check(target);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      const received = await this.fetcher(`${API}/repos/${target.repo.owner}/${target.repo.name}${suffix}`, {
        method, signal: controller.signal, body: JSON.stringify(payload),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'PtahReview/1.0' },
      });
      const body = await received.text();
      if (body.length > MAX_BYTES) throw new GitHubReviewError('malformed-response', 'GitHub response is too large');
      response = new Response(body, { status: received.status, headers: received.headers });
    } catch (error: unknown) {
      if (controller.signal.aborted) throw new GitHubReviewError('timeout', 'GitHub mutation timed out');
      if (error instanceof GitHubReviewError) throw error;
      throw new GitHubReviewError('http', 'GitHub mutation failed');
    } finally { clearTimeout(timer); }
    if (response.status === 401) throw new GitHubReviewError('authentication', 'GitHub bot authentication failed');
    const remaining = response.headers.get('x-ratelimit-remaining');
    const retryAfter = response.headers.get('retry-after');
    if (response.status === 429 || (response.status === 403 && (remaining === '0' || retryAfter !== null))) {
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const at = Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000
        : Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 60_000;
      throw new GitHubReviewError('rate-limit', 'GitHub requests are deferred', new Date(at));
    }
    if (response.status === 403) throw new GitHubReviewError('permission', 'GitHub bot lacks permission');
    return response;
  }

  private async json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    const body = await response.text();
    try {
      const parsed = schema.safeParse(JSON.parse(body));
      if (parsed.success) return parsed.data;
    } catch { // Invalid JSON becomes a typed malformed-response error below.
    }
    throw new GitHubReviewError('malformed-response', 'GitHub returned an invalid mutation response');
  }

  private async ownWalkthrough(target: PublicationTarget): Promise<GitHubIssueComment | undefined> {
    let page: number | null = 1;
    const seen = new Set<number>();
    while (page !== null) {
      if (seen.has(page) || seen.size >= 100) throw new GitHubReviewError('malformed-response', 'GitHub pagination cycle');
      seen.add(page);
      const result = await this.reader.listOwnIssueComments(target.repo, target.number, page);
      const found = result.items.find(comment => comment.body.includes(walkthroughMarker));
      if (found) return found;
      page = result.nextPage;
    }
    return undefined;
  }

  private async ownReviews(target: PublicationTarget): Promise<GitHubReview[]> {
    const reviews: GitHubReview[] = [];
    let page: number | null = 1;
    const seen = new Set<number>();
    while (page !== null) {
      if (seen.has(page) || seen.size >= 100) throw new GitHubReviewError('malformed-response', 'GitHub pagination cycle');
      seen.add(page);
      const result = await this.reader.listOwnReviewsAndThreads(target.repo, target.number, page);
      reviews.push(...result.items);
      page = result.nextPage;
    }
    return reviews;
  }

  async publish(targetInput: PublicationTarget, walkthrough: string, overview: string,
    candidates: PublicationInlineComment[], validRightAnchors: ReadonlySet<string>): Promise<PublicationResult> {
    const target = targetSchema.parse(targetInput);
    const token = await this.secrets.get(REVIEW_GITHUB_TOKEN_KEY);
    if (!token) throw new GitHubReviewError('missing-token', 'GitHub bot token is unavailable');
    const content = [walkthrough, overview, ...candidates.map(x => x.body)].join('\n');
    if (content.includes(token)) throw new GitHubReviewError('publication-unavailable', 'Publication contains a secret');
    const existing = await this.ownWalkthrough(target);
    const walkthroughBody = `${walkthrough}\n\n${walkthroughMarker}`;
    let publishedWalkthrough: GitHubIssueComment;
    if (existing?.body === walkthroughBody) {
      publishedWalkthrough = existing;
    } else {
      const response = await this.request(target, existing ? 'PATCH' : 'POST',
        existing ? `/issues/comments/${existing.id}` : `/issues/${target.number}/comments`, { body: walkthroughBody });
      if (!response.ok) throw new GitHubReviewError('http', `GitHub returned HTTP ${response.status}`);
      const raw = await this.json(response, issueResponse);
      publishedWalkthrough = { id: raw.id, body: raw.body, authorLogin: raw.user.login, createdAt: raw.created_at };
    }
    const reviews = await this.ownReviews(target);
    const marker = reviewMarker(target.headSha);
    const prior = reviews.find(review => review.body.includes(marker));
    const alreadyPosted = new Set(reviews.flatMap(review =>
      [review.body, ...review.threads.map(thread => thread.body)].flatMap(body =>
        [...body.matchAll(/<!-- ptah-review:finding:([^>]+) -->/g)].map(match => match[1]))));
    const unique = new Set<string>();
    const fresh = candidates.filter(candidate => {
      if (!candidate.findingId || unique.has(candidate.findingId) || alreadyPosted.has(candidate.findingId)) return false;
      unique.add(candidate.findingId);
      return true;
    });
    const inline = fresh.filter(candidate => Number.isInteger(candidate.line) && candidate.line > 0
      && validRightAnchors.has(rightAnchorKey(candidate.path, candidate.line))).slice(0, 10);
    const selected = new Set(inline.map(x => x.findingId));
    const deferred = fresh.filter(x => !selected.has(x.findingId));
    const followUpMarkers = [...overview.matchAll(/<!-- ptah-review:(?:addressed|reopened):([^>]+) -->/g)]
      .map(match => match[0]);
    const complete = reviews.find(review => review.body.includes(marker) &&
      followUpMarkers.every(followUp => review.body.includes(followUp)));
    if (fresh.length === 0 && complete) return { walkthrough: publishedWalkthrough, review: complete, deferred };
    const fallback = deferred.map(x => `- ${x.body}`).join('\n');
    const body = `${overview}${fallback ? `\n\nAdditional verified findings (${deferred.length}):\n${fallback}` : ''}\n\n${fresh.map(x => findingMarker(x.findingId)).join('\n')}\n${marker}`;
    const comments: (GitHubInlineComment & { side: 'RIGHT' })[] = inline.map(x => ({
      path: x.path, line: x.line, side: 'RIGHT', body: `${x.body}\n\n${findingMarker(x.findingId)}`,
    }));
    const suffix = `/pulls/${target.number}/reviews`;
    let response = await this.request(target, 'POST', suffix,
      { commit_id: target.headSha, event: 'COMMENT', body, comments });
    if (response.status === 422 && comments.length) {
      // GitHub rejected an anchor. Recheck head and policy before the body-only fallback.
      const moved = inline.map(x => `- ${x.body}`).join('\n');
      response = await this.request(target, 'POST', suffix, { commit_id: target.headSha,
        event: 'COMMENT', body: `${body}\n\nInline anchors rejected by GitHub:\n${moved}`, comments: [] });
    }
    if (!response.ok) throw new GitHubReviewError('http', `GitHub returned HTTP ${response.status}`);
    const raw = await this.json(response, reviewResponse);
    return { walkthrough: publishedWalkthrough,
      review: { id: raw.id, body: raw.body ?? '', submittedAt: raw.submitted_at ?? '', threads: [] }, deferred };
  }
}
