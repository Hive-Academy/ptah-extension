# P1-16a-2 — review RPC surface

## Files and implementation

- Amended `libs/backend/persistence-sqlite/src/lib/migrations/0065_ptah_review.ts` additively: `review_operator_settings(id INTEGER PRIMARY KEY CHECK (id = 1), settings_json TEXT NOT NULL, updated_at INTEGER NOT NULL)`, required `review_findings.payload_json TEXT NOT NULL`, and persisted attempt `result_status`. Static SQL only. Updated `0065_ptah_review.spec.ts` for the table, required payload, JSON check, and singleton rule. No other migration ratchet spec was edited.
- Added `review-core/src/lib/persistence/review-query.repository.ts` and spec: paged/filterable run reads, run detail with stage and checkpoint coverage, accepted finding payloads parsed with `ReviewFindingSchema`, and safe stage errors. Added `review-settings.store.ts` and spec: validated operator JSON in the singleton row and repository settings in `review_repositories`. Added `review-artifact.reader.ts` and spec: configured attempt `out/` root, real path, size, SHA-256, and redacted export content. Added `review-secret-presence.port.ts` with `hasToken(): Promise<boolean>`; no token value enters core. Exported and registered the SQLite implementations through review-core `src/index.ts` and `src/di/{tokens,registration}.ts`.
- Updated `review-core/src/lib/stages/publication-finding.persistence.ts` and `publication-stage.runner.ts` so verified findings persist full validated `payload_json` and accepted events. Added `publication-artifact.persistence.ts` to register the export's SHA-256 and size. Extended `publication-stage.runner.spec.ts`; the SQLite repository persists terminal result status.
- Added separate `ReviewSettingsReadSchema` (`{settings,hasToken}`) and strict `ReviewSettingsUpdateSchema` in review-contracts, with contract spec coverage. Changed `ReviewRunSchema` config hash and deadline to nullable for queued rows with no persisted values. Updated review-runs-ui store/spec to consume the read wrapper.
- Added `libs/shared/src/lib/types/rpc-review.types.ts` inferred directly from the review Zod schemas; included its ten P1 methods in `rpc.types.ts`. Added `review-rpc.handlers.ts` and spec, exports in both handler barrels, singleton registration in `register-shared-rpc-handlers.ts`, and review ownership in host-profile `capabilities.ts`/`manifest.ts`. Host capability remains off until P1-16a-3.

## RPC method table

| Method | Params | Result | DI dependency |
| --- | --- | --- | --- |
| `review:listRuns` | repo?, state?, cursor?, limit? | runs, nextCursor | QUERY_REPOSITORY |
| `review:getRun` | attemptId | run or null | QUERY_REPOSITORY |
| `review:listFindings` | attemptId | findings | QUERY_REPOSITORY |
| `review:listRepositories` | empty | repository settings[] | SETTINGS_STORE |
| `review:getSettings` | empty | settings, hasToken | SETTINGS_STORE, SECRET_PRESENCE |
| `review:updateSettings` | settings | settings | SETTINGS_STORE |
| `review:setPublicationPause` | paused, repo? | ok | SETTINGS_STORE |
| `review:retryHead` | repo, prNumber | ok | GITHUB, QUEUE_SERVICE |
| `review:refresh` | repo | ok | ORCHESTRATOR |
| `review:exportRun` | attemptId | redacted content, fileName | QUERY_REPOSITORY, ARTIFACT_READER |

## Boundary decision

`shared` and `review-contracts` both carry `scope:shared,type:util`; the new shared RPC map imports review-contracts types only. No structural duplicate or parity shim is needed. Handler parameters and results parse the same authoritative Zod schemas.

## AC → spec

| Acceptance criterion | Spec evidence |
| --- | --- |
| 0065 singleton and required finding payload | `0065_ptah_review.spec.ts` |
| Paged and filtered runs; queued unknown fields; stage coverage | `review-query.repository.spec.ts` |
| Validated operator/repository settings and pause | `review-settings.store.spec.ts` |
| Verified finding persistence and export metadata hash | `publication-stage.runner.spec.ts` |
| Attempt-root confinement, hash check, redaction | `review-artifact.reader.spec.ts` |
| Invalid params for every RPC, token absent from results/logs, update rejects token, unknown attempt safe | `review-rpc.handlers.spec.ts` |
| Settings read wrapper and strict update | `review-contracts.spec.ts`, `review-runs.store.spec.ts` |

## Decisions

- **D37 migration:** amend unshipped 0065. Options were additive 0065 or 0066; D37 explicitly selects 0065. Reversible until 0065 ships.
- **Queued run fields:** return `null` for absent config hash/deadline and `[]` for no recorded coverage. Options were fabricated values or schema nullability; nullable fields match the database. Reversible with a future non-null persistence guarantee.
- **Settings bootstrap:** return a safe unavailable error until operator settings exist. An automatic default would invent maintainer authorization. Reversible through a host setup flow.
- **Token handling:** the core exposes presence only; the handler never reads the token value and settings updates reject unknown keys. P1-16a-3 binds the port to secret storage.
- **Export:** metadata is saved after publication writes the file; reads require exact attempt out root and a matching SHA-256 before redaction. Reversible while 0065 is unshipped.

## P1-16a-3 handoff

- Bind `REVIEW_CORE_TOKENS.SECRET_PRESENCE` to a narrow secret-storage adapter using the `ptah.review.githubToken` key; never pass the value through RPC. Bind GITHUB, ENVIRONMENT, ARTIFACT_FILES, lane gateway/context files/command runner, and the existing queue/orchestrator/repository/reader registrations in the Electron composition phases.
- Enable the new `review` host capability only where these tokens resolve. Wire the repo-scoped discovery/poll worker and cron handler. The manifest and shared RPC method names already claim the ten P1 methods.
- Update the four host guards: `container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`. Include ReviewRpcHandlers and the resolved review-core tokens; keep the P2 bot token methods out of P1 surface.
- D26: no Nx/npm verify/build/serve/Electron command was run. Scoped Ptah diagnostics returned clean for the query/spec in the child pass, while subsequent changed-file requests timed out after 45 seconds and remained unchecked. The orchestrator must run the scoped project verification and relay failures.

