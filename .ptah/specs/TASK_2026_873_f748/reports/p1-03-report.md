# P1-03 — GitHub read adapter

## Files

- `libs/backend/review-github/src/di/tokens.ts` — port/fetch tokens and token key.
- `libs/backend/review-github/src/di/registration.ts` — tsyringe registration.
- `libs/backend/review-github/src/lib/github-review.adapter.ts` — REST reads and P1 publication guards.
- `libs/backend/review-github/src/lib/github-review.error.ts` — typed errors.
- `libs/backend/review-github/src/lib/github-review.adapter.spec.ts` — fake-fetch coverage.
- `libs/backend/review-github/src/index.ts` — public exports.

## Public API

`GithubReviewAdapter` implements `IGitHubReviewPort`. `registerReviewGithubServices` binds `REVIEW_GITHUB_TOKENS.REVIEW_PORT`. `GitHubReviewError` exposes a code and optional `retryAt`. Fetch is injected via `REVIEW_GITHUB_TOKENS.FETCH`; bot token comes from `ISecretStorage` using `REVIEW_GITHUB_TOKEN_KEY` before every request.

## Behavior matrix

| Case | Handling | Spec name |
| --- | --- | --- |
| PR pagination, fork/draft/author | Link next page and map metadata | `paginates and maps fork, draft, author, and token headers` |
| ETag 304 | Return matching in-memory snapshot | `returns a prior matching snapshot on ETag 304` |
| 401/403 | Typed auth/permission errors | `types authentication and scope errors for HTTP %i` |
| 429 | Typed deferral with retry date | `defers on rate limit with Retry-After` |
| Malformed JSON | Typed malformed response | `rejects malformed JSON instead of returning empty results` |
| Own issue comments | Filter by authenticated login | `reads only bot-authored issue comments` |
| Diff/files metadata | Validate head and mark omitted patches truncated | `reads diff and file metadata and marks omitted patches truncated` |
| 5xx | Bounded backoff and jitter | `retries transient 5xx GET responses` |
| Timeout/secrets | Abort after 15 seconds; sanitized error | `times out and keeps the token out of errors and logs` |
| Mutation | Typed P1 publication error | `disables P1 publication with a typed error` |

## Deviations

- REST review comments lack thread resolution state; returned `resolved` is `false`. Accurate resolution needs GraphQL.
- 304 requires a matching in-memory snapshot. The port has no persisted snapshot argument, so restart requires one unconditional fetch.
- Focused Jest could not run (`spawn EPERM`). Plain `npx tsc --noEmit -p libs/backend/review-github/tsconfig.lib.json` passed; scoped Ptah diagnostics showed zero errors after final edits.

## Decisions

- **Mutations:** implement the full port with `publication-unavailable` errors; omission breaks the interface. Reversible in P2.
- **Token key:** use exported `ptah.review.githubToken`; no existing review bot key was found. Host wiring must use the constant. Reversible before wiring.
- **Own identity:** read `/user` then filter response pages, since the port passes no bot login. Reversible if contract changes.
- **Thread resolution:** preserve REST comment bodies/anchors and mark unresolved; REST has no resolved field. Reversible through GraphQL.

## Open issues

- Confirm host settings use the exported token key.
- Add GraphQL resolution read if downstream uses `resolved`.
- Run `npm run verify -- -p review-github` outside this sandbox.
