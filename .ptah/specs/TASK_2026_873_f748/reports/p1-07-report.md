# P1-07 — Lane admission and parsing

## Files

- `libs/backend/review-core/src/lib/lanes/review-lane-selector.ts` — confirmed-room selection, family diversity preference, hard cross-family verifier gate, six-kind selection cap.
- `libs/backend/review-core/src/lib/lanes/review-lane-admission.service.ts` — singleton three-slot review semaphore, operator reserve, six launches per attempt, immediate partial result.
- `libs/backend/review-core/src/lib/lanes/review-lane.runner.ts` — gateway/files ports, attempt-root cwd, stage deadlines, source checksums, sanitized failures.
- `libs/backend/review-core/src/lib/lanes/review-output.parser.ts` — size-bounded JSON and strict contract validation, SHA/lens/family checks.
- Adjacent specs: `review-lane-selector.spec.ts`, `review-lane-admission.service.spec.ts`, `review-lane.runner.spec.ts`, `review-output.parser.spec.ts`.

## Public API and required integration

Export from `libs/backend/review-core/src/index.ts` (integration owner):

```ts
export * from './lib/lanes/review-lane-selector';
export * from './lib/lanes/review-lane-admission.service';
export * from './lib/lanes/review-lane.runner';
export * from './lib/lanes/review-output.parser';
```

DI registrations needed in the review-core composition owner: register `REVIEW_LANE_TOKENS.CLOCK` with `IReviewLaneClock`, `FILES` with the exact-SHA attempt-root filesystem adapter, `GATEWAY` with the host agent adapter, and singleton `ADMISSION` with `ReviewLaneAdmissionService`; register `ReviewLaneRunner` and shared `TOKENS.LOGGER`. The files adapter must materialize `src/` read-only at the pinned SHA and create writable `out/` and `meta/`; its `sourceChecksum` must cover all source paths, bytes, and file types. The gateway adapter must preserve manager admission, pass the abort signal to process termination, return bounded output, and report provider room as confirmed/unknown/at-limit. The stage coordinator must use one runner per selected kind and persist partial coverage, family, scope and outcome.

## AC → spec evidence

| Acceptance | Evidence |
| --- | --- |
| AC-6.1–6.3 | `review-lane-selector.spec.ts` checks six-kind cap, unavailable lenses and confirmed room; run artifact recording and risk triage remain P1-08/P1-09. |
| AC-6.4–6.5 | Boundary parses outside-diff capable `CandidateFinding` schema; prompt fencing belongs to P1-08. |
| AC-7.1–7.6 | `review-output.parser.spec.ts` checks strict malformed/identity rejection; `review-lane.runner.spec.ts` checks cross-family verifier gate. Disproof, normalization, publication suppression and run counts belong to P1-09/P1-10. |
| AC-14.1–14.7 | `review-lane-admission.service.spec.ts` checks cap, semaphore, reserve and deadline; `review-lane.runner.spec.ts` checks unknown room, expiry and source mutation. Run/status UI and artifact recording belong to P1-09/P1-15. |

## Decisions

- No room produces immediate `partial` (D12 and explicit P1-07 scope); the implementation does not queue for capacity. Reversible: yes.
- Same-family verifier is unavailable under the explicit P1-07 family gate; FR-7's weaker same-family fallback requires a later policy decision if desired. Evidence: P1-07 acceptance specifically requires different-family verifier. Reversible: yes.
- Admission count is keyed by PR plus attempt ID so manual retries receive a fresh six-lane budget. Evidence: per-PR run cap and independent attempts in the queue contract. Reversible: yes.
- Exact-SHA materialization and manager spawn admission live behind ports for P1-16 host integration. Evidence: P1-07 scope forbids host-specific edits. Reversible: yes.

## Verification and open issues

- Scoped `ptah_get_diagnostics` on all eight changed TypeScript files: zero errors and warnings. Nx and Jest were not run under D26; orchestrator owns `npm run verify -- -p review-core`.
- The adapter and coordinator are not yet connected. In particular, directory permissions, persisted coverage, process-tree termination on abort, and final manager-capacity rejection require P1-16/P1-09 integration.
