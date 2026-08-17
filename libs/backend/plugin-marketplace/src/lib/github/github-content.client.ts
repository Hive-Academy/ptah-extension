/**
 * The only place this lib talks to GitHub.
 *
 * `gh` is not available at runtime, so everything here is plain HTTPS against
 * two hosts with very different budgets:
 *
 * - `raw.githubusercontent.com` — a CDN. Used for the marketplace manifest and
 *   for every plugin file. Effectively unmetered, so file downloads are cheap.
 * - `api.github.com` — 60 requests/hour unauthenticated, per IP. Used for
 *   exactly ONE call per install: the recursive trees endpoint, which returns
 *   the whole repository listing in a single response. Enumerating a subtree
 *   any other way (contents API, per-directory) would burn the budget in a
 *   single install, which is why the recursive form is not optional here.
 *
 * Rate-limit responses are turned into a typed {@link PluginMarketplaceError}
 * carrying the reset time so the UI can say when to try again, rather than
 * being reported as a generic network failure.
 */

import * as https from 'https';
import type { IncomingHttpHeaders } from 'http';
import { injectable } from 'tsyringe';
import { z } from 'zod';
import { PluginMarketplaceError } from '../errors';

/** Per-request timeout. Matches `ContentDownloadService`. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Redirect budget, matching `ContentDownloadService`. */
const MAX_REDIRECTS = 5;

/**
 * Hard ceiling on any single response body.
 *
 * Remote data governs how many bytes we read, so the read loop must be able to
 * stop. Without this a hostile repo could stream indefinitely into memory.
 */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * GitHub requires a User-Agent on API requests and returns 403 without one.
 */
const USER_AGENT = 'Ptah-Plugin-Marketplace';

/**
 * Hosts a redirect is allowed to land on.
 *
 * The redirect-following here was modelled on `ContentDownloadService`, where
 * following blindly is harmless because the target is one hardcoded URL owned
 * by us. Here the URL is built from a user-typed `owner/repo`, so the trust
 * boundary is different: an open redirect, a compromised CDN edge, or DNS
 * trickery could otherwise point the request at an internal host and hand it
 * whatever came back. GitHub only ever redirects within its own domains, so
 * pinning costs nothing legitimate.
 */
const ALLOWED_REDIRECT_HOSTS: ReadonlySet<string> = new Set([
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
]);

/**
 * True when a redirect target is somewhere plugin content may legitimately come
 * from. Exported so the rule can be tested without standing up a redirecting
 * server — the guard is one comparison, and the thing worth pinning is the
 * decision, not the socket.
 */
export function isAllowedRedirectTarget(target: URL): boolean {
  return (
    target.protocol === 'https:' && ALLOWED_REDIRECT_HOSTS.has(target.hostname)
  );
}

/** One entry of the recursive trees response we actually care about. */
export interface GitTreeEntry {
  /** Repo-relative path with forward slashes. */
  path: string;
  /** `blob` for files, `tree` for directories. */
  type: string;
  /** Byte size for blobs. Absent for trees. */
  size?: number;
}

const GitTreeResponseSchema = z.object({
  tree: z.array(
    z
      .object({
        path: z.string(),
        type: z.string(),
        size: z.number().optional(),
      })
      .passthrough(),
  ),
  /**
   * GitHub sets this when the repository has more than 100k entries and the
   * listing was cut short. Installing from a truncated listing would silently
   * drop files, so callers must check it.
   */
  truncated: z.boolean().optional(),
});

const RepoMetadataSchema = z
  .object({ default_branch: z.string().min(1) })
  .passthrough();

/** Result of a raw fetch: the bytes plus whether they are valid UTF-8 text. */
export interface FetchedBlob {
  bytes: Buffer;
  /** Decoded text, present only when `bytes` round-trips as UTF-8. */
  text: string | null;
}

@injectable()
export class GitHubContentClient {
  /**
   * Fetch `.claude-plugin/marketplace.json` for a repo, as text.
   *
   * Uses `HEAD` as the ref so the marketplace tracks the repo's default branch
   * without an extra API call to discover its name.
   */
  async fetchMarketplaceManifest(owner: string, repo: string): Promise<string> {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.claude-plugin/marketplace.json`;
    const blob = await this.fetchBlob(url);
    if (blob.text === null) {
      throw new PluginMarketplaceError(
        'manifest-invalid',
        `${owner}/${repo}: .claude-plugin/marketplace.json is not valid UTF-8 text.`,
      );
    }
    return blob.text;
  }

  /**
   * Raw file bytes from the default branch of a repo.
   *
   * `repoPath` is trusted to be already validated — the schema layer refuses
   * traversing or absolute paths before anything reaches here.
   */
  fetchRepoFile(
    owner: string,
    repo: string,
    repoPath: string,
  ): Promise<FetchedBlob> {
    const encoded = repoPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return this.fetchBlob(
      `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encoded}`,
    );
  }

  /**
   * The whole repository file listing in one API call.
   *
   * Tries the `HEAD` ref first. Some repositories reject it, so on a 404 we
   * spend one extra call resolving `default_branch` and retry — a fallback,
   * never the default, because of the 60/hour budget.
   */
  async fetchRepoTree(owner: string, repo: string): Promise<GitTreeEntry[]> {
    try {
      return await this.fetchTreeAtRef(owner, repo, 'HEAD');
    } catch (error: unknown) {
      if (
        !(error instanceof PluginMarketplaceError) ||
        error.code !== 'manifest-not-found'
      ) {
        throw error;
      }
    }

    const metaRaw = await this.fetchApiJson(
      `https://api.github.com/repos/${owner}/${repo}`,
    );
    const meta = RepoMetadataSchema.safeParse(metaRaw);
    if (!meta.success) {
      throw new PluginMarketplaceError(
        'network',
        `${owner}/${repo}: could not resolve the repository's default branch.`,
      );
    }

    return this.fetchTreeAtRef(owner, repo, meta.data.default_branch);
  }

  private async fetchTreeAtRef(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<GitTreeEntry[]> {
    const raw = await this.fetchApiJson(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );

    const parsed = GitTreeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PluginMarketplaceError(
        'network',
        `${owner}/${repo}: unexpected response from the GitHub trees API.`,
      );
    }

    if (parsed.data.truncated === true) {
      throw new PluginMarketplaceError(
        'too-large',
        `${owner}/${repo} is too large for GitHub to list in one response, so Ptah cannot verify the full file set. Install from a smaller repository.`,
      );
    }

    return parsed.data.tree.map((entry) => ({
      path: entry.path,
      type: entry.type,
      size: entry.size,
    }));
  }

  private async fetchApiJson(url: string): Promise<unknown> {
    const blob = await this.fetchBlob(url, {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });

    if (blob.text === null) {
      throw new PluginMarketplaceError(
        'network',
        'GitHub returned a non-text response where JSON was expected.',
      );
    }

    try {
      return JSON.parse(blob.text) as unknown;
    } catch {
      throw new PluginMarketplaceError(
        'network',
        'GitHub returned malformed JSON.',
      );
    }
  }

  /**
   * Fetch a URL and return its bytes, plus a UTF-8 decoding when the bytes are
   * genuinely UTF-8 text.
   *
   * Bytes are collected as `Buffer` rather than through `setEncoding('utf8')`
   * precisely so the caller can distinguish text from binary. Decoding first
   * and asking questions later is how you silently corrupt a file.
   */
  fetchBlob(
    url: string,
    headers: Record<string, string> = {},
    redirectsLeft = MAX_REDIRECTS,
  ): Promise<FetchedBlob> {
    return new Promise<FetchedBlob>((resolve, reject) => {
      if (redirectsLeft <= 0) {
        reject(
          new PluginMarketplaceError(
            'network',
            `Too many redirects for ${url}`,
          ),
        );
        return;
      }

      const request = https.get(
        url,
        { headers: { 'User-Agent': USER_AGENT, ...headers } },
        (response) => {
          const status = response.statusCode ?? 0;

          if (status >= 300 && status < 400 && response.headers.location) {
            const next = new URL(response.headers.location, url);
            response.resume();
            if (!isAllowedRedirectTarget(next)) {
              reject(
                new PluginMarketplaceError(
                  'network',
                  `Refused a redirect to ${next.protocol}//${next.hostname} — plugin content is only fetched from GitHub`,
                ),
              );
              return;
            }
            this.fetchBlob(next.toString(), headers, redirectsLeft - 1).then(
              resolve,
              reject,
            );
            return;
          }

          if (status === 404) {
            response.resume();
            reject(
              new PluginMarketplaceError(
                'manifest-not-found',
                `Not found: ${url}`,
              ),
            );
            return;
          }

          if (status === 403 || status === 429) {
            response.resume();
            reject(this.rateLimitError(response.headers, status, url));
            return;
          }

          if (status !== 200) {
            response.resume();
            reject(
              new PluginMarketplaceError(
                'network',
                `HTTP ${status} for ${url}`,
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;

          response.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_RESPONSE_BYTES) {
              response.destroy();
              reject(
                new PluginMarketplaceError(
                  'too-large',
                  `Response from ${url} exceeded ${MAX_RESPONSE_BYTES} bytes.`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });

          response.on('end', () => {
            const bytes = Buffer.concat(chunks);
            resolve({ bytes, text: decodeUtf8Strict(bytes) });
          });

          response.on('error', (error: Error) =>
            reject(new PluginMarketplaceError('network', error.message)),
          );
        },
      );

      request.on('error', (error: Error) =>
        reject(new PluginMarketplaceError('network', error.message)),
      );

      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.destroy(
          new PluginMarketplaceError('network', `Request timeout for ${url}`),
        );
      });
    });
  }

  /**
   * Turn a 403/429 into a rate-limit error when the headers say so.
   *
   * GitHub signals exhaustion with `x-ratelimit-remaining: 0` on a 403; a 403
   * without that header is an ordinary refusal and stays a network error, so
   * the UI does not tell the user to "wait an hour" for a permissions problem.
   */
  private rateLimitError(
    headers: IncomingHttpHeaders,
    status: number,
    url: string,
  ): PluginMarketplaceError {
    const remaining = headerValue(headers, 'x-ratelimit-remaining');
    const retryAfter = headerValue(headers, 'retry-after');
    const reset = headerValue(headers, 'x-ratelimit-reset');

    const isRateLimited =
      status === 429 || remaining === '0' || retryAfter !== undefined;

    if (!isRateLimited) {
      return new PluginMarketplaceError('network', `HTTP ${status} for ${url}`);
    }

    let retryAt: number | undefined;
    if (retryAfter !== undefined && /^\d+$/.test(retryAfter)) {
      retryAt = Date.now() + Number(retryAfter) * 1000;
    } else if (reset !== undefined && /^\d+$/.test(reset)) {
      retryAt = Number(reset) * 1000;
    }

    const when =
      retryAt === undefined
        ? 'shortly'
        : `after ${new Date(retryAt).toLocaleTimeString()}`;

    return new PluginMarketplaceError(
      'rate-limited',
      `GitHub rate limit reached. Ptah uses the public GitHub API without a token (60 requests per hour). Try again ${when}.`,
      retryAt,
    );
  }
}

/** First value of a header, normalized to a single string. */
function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const raw = headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Decode `bytes` as UTF-8, or return null when they are not UTF-8 text.
 *
 * Two rejections, both deliberate:
 * - a NUL byte, which no text file has and every binary format does;
 * - a lossy decode, detected by re-encoding and comparing bytes. Node's UTF-8
 *   decoder never fails — it substitutes U+FFFD — so equality against the
 *   original buffer is the only reliable signal that nothing was mangled.
 */
export function decodeUtf8Strict(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
}
