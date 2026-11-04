# P1-06 — exact SHA context and deterministic checks

## Files

- `libs/backend/review-core/src/lib/context/review-context.ports.ts`: narrow argv runner and filesystem ports, tokens, boundary schemas.
- `libs/backend/review-core/src/lib/context/review-worktree.service.ts`: detached SHA worktree, `src/out/meta`, source snapshot, checksum and cleanup.
- `libs/backend/review-core/src/lib/context/review-context.service.ts`: full-tree changed-symbol caller search, path and lockfile provenance.
- `libs/backend/review-core/src/lib/context/review-dependencies.service.ts`: changed-lockfile policy gate and script-disabled, locked `npm ci`.
- `libs/backend/review-core/src/lib/context/review-checks.service.ts`: locked checks with available/unavailable/failed records.
- `libs/backend/review-core/src/lib/context/review-context.spec.ts`: fake runner/filesystem regression specs.

## Public API

`ReviewWorktreeService.create(repoRoot, attemptsRoot, attemptId, headSha)`, `snapshot(src, expectedSha)`, `assertIntegrity(src, snapshot)`, `cleanup(repoRoot, paths)`; `ReviewContextService.build(src, changedPaths, changedSymbols)`; `ReviewDependenciesService.prepare(src, changedLockfiles, allowChangedLockfileInstall)`; `ReviewChecksService.run(src, definitions, dependenciesReady)`. All execution is via `IReviewCommandRunner.run(command, argv, cwd, timeoutMs)`; filesystem via `IReviewContextFiles`.

## Required exports and DI registrations

Add exports for the five context files above to `libs/backend/review-core/src/index.ts`. Add `REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER` and `.FILES` adapters in the host composition root, plus registrations for `ReviewWorktreeService`, `ReviewContextService`, `ReviewDependenciesService`, and `ReviewChecksService`. Bind `TOKENS.LOGGER` already used by review-core. P1-16 must provide the host adapter; no host-specific import was added here. The stage coordinator should pass trusted check definitions and the policy-derived `allowChangedLockfileInstall` flag, copy validated artifacts before cleanup, and call `assertIntegrity` after lanes and before cleanup/publication.

## AC to spec

| Acceptance | Spec evidence |
| --- | --- |
| AC-5.2 | Unchanged caller outside diff appears in context. |
| AC-5.3, AC-5.4 | Check runner argv includes verify lock; timeout and dependency block are unavailable. |
| AC-5.6, AC-5.7, AC-15.6 | Changed lockfile is flagged and blocked without policy; allowed install uses `npm ci --ignore-scripts` through verify wrapper and captures lockfile hash. |
| AC-15.3, AC-15.5 | Wrong SHA rejected; checksum drift detected. |
| AC-5.1, AC-5.5, AC-15.4 | Audit command and evidence persistence, default check selection and artifact redaction belong to stage/adapters; this service blocks build/serve/dev/e2e check names/targets. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Define narrow command and file ports in context | Platform-core port vs local port | Task explicitly permits narrow ports when no matching host port; P1-16 owns adapters | Yes |
| Gate changed-lockfile install on explicit boolean policy | Always install vs block | FR-5/15 requires provenance and policy before changed lockfile install | Yes |
| Hash tracked file bytes plus clean git status | HEAD only vs byte checksum | AC-15.5 and plan require post-lane source integrity | Yes |

## Verification and open issues

Scoped `ptah_get_diagnostics` reported zero errors after the final edits; no Nx command was run under D26. Skill discovery/loading was unavailable in this CLI; no skill instructions were inferred. The orchestrator must run the scoped verify target and relay any failures. P1-16 still needs concrete runner/filesystem adapters, and P1-09 must wire snapshot, check selection, policy, artifact copying, and cleanup into the stage lifecycle.

