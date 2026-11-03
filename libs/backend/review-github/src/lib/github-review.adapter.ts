import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type {
  GitHubDiff, GitHubInlineComment, GitHubIssueComment, GitHubPage,
  GitHubPull, GitHubReview, GitHubReviewThread, IGitHubReviewPort, RepoIdentity,
} from '@ptah-extension/review-contracts';
import { RepoIdentitySchema, ShaSchema } from '@ptah-extension/review-contracts';
import { PLATFORM_TOKENS, type ISecretStorage } from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { REVIEW_GITHUB_TOKEN_KEY, REVIEW_GITHUB_TOKENS } from '../di/tokens';
import { GitHubReviewError } from './github-review.error';

const identity = z.object({ id: z.number().int().positive() });
const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(256).optional(),
  body: z.string().nullable().optional(),
  head: z.object({ sha: ShaSchema, repo: identity.nullable() }),
  base: z.object({ sha: ShaSchema, repo: identity }),
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  user: z.object({ login: z.string().min(1) }),
});
const issueCommentSchema = z.object({
  id: z.number().int().positive(), body: z.string(),
  user: z.object({ login: z.string().min(1) }), created_at: z.string().datetime(),
});
const reviewSchema = z.object({
  id: z.number().int().positive(), body: z.string().nullable(),
  submitted_at: z.string().datetime().nullable(),
  user: z.object({ login: z.string().min(1) }),
});
const reviewCommentSchema = z.object({
  id: z.number().int().positive(), pull_request_review_id: z.number().int().positive().nullable(),
  path: z.string(), line: z.number().int().positive().nullable(),
  original_line: z.number().int().positive().nullable(), body: z.string(),
  user: z.object({ login: z.string().min(1) }),
});
const filesSchema = z.array(z.object({
  filename: z.string(), patch: z.string().optional(),
  status: z.string(), additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(), changes: z.number().int().nonnegative(),
}));
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 100;
const API = 'https://api.github.com';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new GitHubReviewError('malformed-response', 'GitHub returned an invalid response');
  return result.data;
}

function nextPage(link: string | null): number | null {
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  if (!match) return null;
  try {
    const page = Number(new URL(match[1]).searchParams.get('page'));
    if (Number.isInteger(page) && page > 0 && page <= MAX_PAGES) return page;
  } catch { // Invalid Link is rejected below.
  }
  throw new GitHubReviewError('malformed-response', 'GitHub returned an invalid pagination link');
}

function mapPull(raw: z.infer<typeof pullSchema>): GitHubPull {
  return {
    number: raw.number, headSha: raw.head.sha, baseSha: raw.base.sha,
    title: raw.title, bodyExcerpt: raw.body?.slice(0, 1000) ?? null,
    state: raw.state, draft: raw.draft, authorLogin: raw.user.login,
    headRepoId: raw.head.repo?.id ?? null, baseRepoId: raw.base.repo.id,
    headIsFork: raw.head.repo === null || raw.head.repo.id !== raw.base.repo.id,
  };
}

@injectable()
export class GithubReviewAdapter implements IGitHubReviewPort {
  constructor(
    @inject(PLATFORM_TOKENS.SECRET_STORAGE) private readonly secrets: ISecretStorage,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(REVIEW_GITHUB_TOKENS.FETCH) private readonly fetcher: typeof fetch,
  ) {}

  private path(repo: RepoIdentity, suffix: string): string {
    const valid = RepoIdentitySchema.parse(repo);
    return `/repos/${valid.owner}/${valid.name}${suffix}`;
  }

  private number(number: number): number {
    return parse(z.number().int().positive(), number);
  }

  private async request(path: string, accept = 'application/vnd.github+json', etag?: string): Promise<Response> {
    const token = await this.secrets.get(REVIEW_GITHUB_TOKEN_KEY);
    if (!token) throw new GitHubReviewError('missing-token', 'GitHub bot token is unavailable');
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        const received = await this.fetcher(`${API}${path}`, {
          method: 'GET', signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`, Accept: accept,
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'PtahReview/1.0',
            ...(etag ? { 'If-None-Match': etag } : {}),
          },
        });
        // Consume the body while the same 15-second deadline is active.
        const body = [204, 205, 304].includes(received.status) ? null : await received.text();
        if (body !== null && body.length > MAX_BYTES) throw new GitHubReviewError('malformed-response', 'GitHub response is too large');
        response = new Response(body, { status: received.status, headers: received.headers });
      } catch (error: unknown) {
        if (controller.signal.aborted) throw new GitHubReviewError('timeout', 'GitHub request timed out');
        if (error instanceof GitHubReviewError) throw error;
        throw new GitHubReviewError('http', 'GitHub request failed');
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 401) throw new GitHubReviewError('authentication', 'GitHub bot authentication failed');
      const remaining = response.headers.get('x-ratelimit-remaining');
      const retryAfter = response.headers.get('retry-after');
      if (response.status === 429 || (response.status === 403 && (remaining === '0' || retryAfter))) {
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const at = Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000
          : Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 60_000;
        throw new GitHubReviewError('rate-limit', 'GitHub requests are deferred', new Date(at));
      }
      if (response.status === 403) throw new GitHubReviewError('permission', 'GitHub bot lacks permission');
      if (response.status >= 500 && attempt < 2) {
        this.logger.warn('[review-github] retrying GitHub GET');
        await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt) + Math.random() * 100));
        continue;
      }
      if (response.status !== 304 && !response.ok) throw new GitHubReviewError('http', `GitHub returned HTTP ${response.status}`);
      return response;
    }
    throw new GitHubReviewError('http', 'GitHub request failed');
  }

  private async json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES) throw new GitHubReviewError('malformed-response', 'GitHub response is too large');
    let body: string;
    try { body = await response.text(); }
    catch { throw new GitHubReviewError('malformed-response', 'GitHub response could not be read'); }
    if (body.length > MAX_BYTES) throw new GitHubReviewError('malformed-response', 'GitHub response is too large');
    try { return parse(schema, JSON.parse(body)); }
    catch (error: unknown) {
      if (error instanceof GitHubReviewError) throw error;
      throw new GitHubReviewError('malformed-response', 'GitHub returned invalid JSON');
    }
  }

  async listOpenPulls(repo: RepoIdentity, etag?: string, page = 1): Promise<GitHubPage<GitHubPull>> {
    const path = this.path(repo, `/pulls?state=open&per_page=100&page=${this.number(page)}`);
    const response = await this.request(path, undefined, etag);
    if (response.status === 304) {
      const previous = this.snapshots.get(path);
      if (!previous || previous.etag !== etag) throw new GitHubReviewError('malformed-response', 'GitHub returned 304 without a matching snapshot');
      return { ...previous, notModified: true };
    }
    const items = (await this.json(response, z.array(pullSchema))).map(mapPull);
    const result = { items, nextPage: nextPage(response.headers.get('link')),
      etag: response.headers.get('etag'), notModified: false };
    this.snapshots.set(path, result);
    return result;
  }
  private readonly snapshots = new Map<string, GitHubPage<GitHubPull>>();

  async getPull(repo: RepoIdentity, number: number): Promise<GitHubPull> {
    const response = await this.request(this.path(repo, `/pulls/${this.number(number)}`));
    return mapPull(await this.json(response, pullSchema));
  }

  async getDiff(repo: RepoIdentity, number: number, sha: string): Promise<GitHubDiff> {
    const pr = await this.getPull(repo, number);
    if (pr.headSha !== ShaSchema.parse(sha)) throw new GitHubReviewError('malformed-response', 'Pull request head changed');
    const base = this.path(repo, `/pulls/${this.number(number)}`);
    const response = await this.request(base, 'application/vnd.github.v3.diff');
    const patch = parse(z.string().min(1).max(MAX_BYTES), await response.text());
    const filesResponse = await this.request(`${base}/files?per_page=100&page=1`);
    const files = await this.json(filesResponse, filesSchema);
    return { headSha: pr.headSha, baseSha: pr.baseSha, patch,
      truncated: nextPage(filesResponse.headers.get('link')) !== null || files.some(file => file.patch === undefined) };
  }

  async listOwnIssueComments(repo: RepoIdentity, number: number, page = 1): Promise<GitHubPage<GitHubIssueComment>> {
    const response = await this.request(this.path(repo, `/issues/${this.number(number)}/comments?per_page=100&page=${this.number(page)}`));
    const raw = await this.json(response, z.array(issueCommentSchema));
    const login = await this.ownLogin();
    return { items: raw.filter(x => x.user.login === login).map(x => ({ id: x.id, body: x.body,
      authorLogin: x.user.login, createdAt: x.created_at })),
      nextPage: nextPage(response.headers.get('link')), etag: response.headers.get('etag'), notModified: false };
  }

  private async ownLogin(): Promise<string> {
    const response = await this.request('/user');
    return (await this.json(response, z.object({ login: z.string().min(1) }))).login;
  }

  async listOwnReviewsAndThreads(repo: RepoIdentity, number: number, page = 1): Promise<GitHubPage<GitHubReview>> {
    const base = this.path(repo, `/pulls/${this.number(number)}`);
    const [reviewsResponse, login] = await Promise.all([
      this.request(`${base}/reviews?per_page=100&page=${this.number(page)}`),
      this.ownLogin(),
    ]);
    const reviews = await this.json(reviewsResponse, z.array(reviewSchema));
    const comments: z.infer<typeof reviewCommentSchema>[] = [];
    let commentPage: number | null = 1;
    const seen = new Set<number>();
    while (commentPage !== null) {
      if (seen.has(commentPage)) throw new GitHubReviewError('malformed-response', 'GitHub pagination cycle');
      seen.add(commentPage);
      const response = await this.request(`${base}/comments?per_page=100&page=${commentPage}`);
      comments.push(...await this.json(response, z.array(reviewCommentSchema)));
      commentPage = nextPage(response.headers.get('link'));
    }
    const own = reviews.filter(x => x.user.login === login).map(x => ({
      id: x.id, body: x.body ?? '', submittedAt: x.submitted_at ?? '',
      threads: comments.filter(c => c.user.login === login && c.pull_request_review_id === x.id).map(c => ({
        id: String(c.id), path: c.path, line: c.line ?? c.original_line, body: c.body, resolved: false,
      } satisfies GitHubReviewThread)),
    }));
    return { items: own, nextPage: nextPage(reviewsResponse.headers.get('link')),
      etag: reviewsResponse.headers.get('etag'), notModified: false };
  }

  async upsertWalkthrough(_repo: RepoIdentity, _number: number, _body: string, _existingCommentId?: number): Promise<GitHubIssueComment> {
    throw new GitHubReviewError('publication-unavailable', 'GitHub publication is unavailable in P1');
  }
  async createCommentReview(_repo: RepoIdentity, _number: number, _headSha: string, _body: string, _comments: GitHubInlineComment[]): Promise<GitHubReview> {
    throw new GitHubReviewError('publication-unavailable', 'GitHub publication is unavailable in P1');
  }
  async replyToFinding(_repo: RepoIdentity, _number: number, _threadId: string, _body: string): Promise<GitHubIssueComment> {
    throw new GitHubReviewError('publication-unavailable', 'GitHub publication is unavailable in P1');
  }
}
