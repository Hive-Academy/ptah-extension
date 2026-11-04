# P1-16a Shared host integration — backend

## Status

Partial. Contract gaps and the RPC prefix were addressed. Electron integration, review RPC handler, worker lifecycle, and DI guards remain unimplemented. P1-16a acceptance is not met.

## Files changed

- `libs/backend/review-contracts/src/lib/review-run.schema.ts`: `interrupted` state and optional PR title/body excerpt, publication counts, lane availability, last poll, and health fields.
- `libs/backend/review-contracts/src/lib/review-finding.schema.ts`: optional verification on candidates; final `ReviewFindingSchema` requires `cross-family` or `same-family-weaker`.
- `libs/backend/review-contracts/src/lib/review-rpc.schema.ts`: `review:listFindings` schema.
- `libs/backend/review-contracts/src/lib/github-review.port.ts`, `libs/backend/review-github/src/lib/github-review.adapter.ts`: bounded optional PR title/body excerpt in read responses.
- `libs/backend/review-contracts/src/lib/review-contracts.spec.ts`: schema cases for interrupted filtering, verification labels, and list-findings params.
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts`, `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`: `review:` prefix and assertion.

## RPC methods

Existing `ReviewRpcSchemas` declares list/get runs, list repositories, settings read/update, pause, retry, refresh, bot verification/token changes, and export. This change adds:

| Name | Params schema | Result schema | Runtime |
| --- | --- | --- | --- |
| `review:listFindings` | strict `{ attemptId: string(1..64) }` | strict `{ findings: ReviewFindingSchema[0..100] }` | Handler not implemented |

No shared RPC registry entry or handler was added. None of these methods is callable through host RPC yet.

## DI registrations and guards

None changed. `registerReviewCore` needs host bindings for lane gateway/files, context command/files, GitHub port, environment, and artifact files. It registers the repository against the existing SQLite connection token, but Electron does not invoke the registration. The four Electron DI guards and CLI smoke were not updated or run.

## Adapter design and boundary checks

- `GithubReviewAdapter` already reads `REVIEW_GITHUB_TOKEN_KEY` through the secret-storage port per request. Its P1 publication methods throw; no GitHub mutation was added.
- PR text is parsed from the GitHub response; title is bounded to 256 characters and body excerpt to 1000 characters. New run fields are optional because current persistence and mocks cannot populate them.
- Final findings require a verification label; pre-verification candidates may omit it.
- Initial scoped `ptah_get_diagnostics` found zero errors in the first five changed contract/GitHub files. Later calls covering all edits timed out after 45 seconds, including a narrower retry; those later edits remain unchecked. D26 prohibited Nx verification. No build, test, or Electron run occurred.
- No skill-loading tool is exposed in this lane; no skill was loaded.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Make run summary fields optional pending read-model work | Require immediately / add compatibly | Existing SQLite attempts and UI mocks lack these fields. | Yes |
| Require verification on final findings only | Require on candidates / require after verification | Candidates originate before the verifier runs; P1-09 needs a final stronger/weaker label. | Yes |
| Keep PR text optional in the GitHub port | Require it / allow older fixtures | Existing port fixtures lack title/body; the adapter reads them when present. | Yes |

## Open issues for P1-16b and P2

- P1-16a still needs platform adapters, Electron DI and guard updates, named cron discovery, detached worker startup/shutdown, RPC types and handlers with Zod boundaries, and CLI smoke. P1-16b should not assume the review methods are callable yet.
- The read model must map SQLite attempts/stages to `ReviewRunSchema`, persist or derive the new summary fields, and expose findings. The repository currently provides `getAttempt`/`getStages`, with no list/findings API.
- P2 must keep token write-only and GitHub publication disabled until its publication gate is implemented and verified.
