import type { RepoIdentity } from './review-run.schema';

export interface GitHubPull {
  number: number;
  title?: string;
  bodyExcerpt?: string | null;
  headSha: string;
  baseSha: string;
  state: 'open' | 'closed';
  draft: boolean;
  authorLogin: string;
  headRepoId: number | null;
  baseRepoId: number;
  headIsFork: boolean;
}
export interface GitHubPage<T> {
  items: T[];
  nextPage: number | null;
  etag: string | null;
  notModified: boolean;
}
export interface GitHubIssueComment {
  id: number;
  body: string;
  authorLogin: string;
  createdAt: string;
}
export interface GitHubReviewThread {
  id: string;
  path: string;
  line: number | null;
  body: string;
  resolved: boolean;
}
export interface GitHubReview {
  id: number;
  body: string;
  submittedAt: string;
  threads: GitHubReviewThread[];
}
export interface GitHubDiff {
  headSha: string;
  baseSha: string;
  patch: string;
  truncated: boolean;
}
export interface GitHubInlineComment {
  path: string;
  line: number;
  body: string;
}
export interface IGitHubReviewPort {
  listOpenPulls(
    repo: RepoIdentity,
    etag?: string,
    page?: number,
  ): Promise<GitHubPage<GitHubPull>>;
  getPull(repo: RepoIdentity, number: number): Promise<GitHubPull>;
  getDiff(repo: RepoIdentity, number: number, sha: string): Promise<GitHubDiff>;
  listOwnIssueComments(
    repo: RepoIdentity,
    number: number,
    page?: number,
  ): Promise<GitHubPage<GitHubIssueComment>>;
  listOwnReviewsAndThreads(
    repo: RepoIdentity,
    number: number,
    page?: number,
  ): Promise<GitHubPage<GitHubReview>>;
  upsertWalkthrough(
    repo: RepoIdentity,
    number: number,
    body: string,
    existingCommentId?: number,
  ): Promise<GitHubIssueComment>;
  createCommentReview(
    repo: RepoIdentity,
    number: number,
    headSha: string,
    body: string,
    comments: GitHubInlineComment[],
  ): Promise<GitHubReview>;
  replyToFinding(
    repo: RepoIdentity,
    number: number,
    threadId: string,
    body: string,
  ): Promise<GitHubIssueComment>;
}
