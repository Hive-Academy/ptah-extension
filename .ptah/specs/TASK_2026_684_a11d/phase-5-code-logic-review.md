# Phase 5 code logic review

- Commit: `f346b6eb1` (reviewed files are unchanged at the current worktree HEAD)
- Reviewer family: codex
- Implementer family: claude
- Scope: Batch 18–20 persistence spec, live fixtures/spec, and live eval workflow. The phase-4 visual review in the commit was excluded.

## Per-requirement assessment

| Requirement | Result and evidence |
| --- | --- |
| 18: whole selection survives disk and fresh reader; no `.baseUrl` leaf | Met. Both literal selections are parameterized in `libs/backend/platform-core/src/file-settings-manager.spec.ts:265-272`; the test checks disk JSON, a fresh reader, and absent leaf keys at `:277-290`. |
| 19: gate and fixtures | Met. The suite requires both env values at `libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts:33-36`. Ten fixtures with explicit expected labels are defined in `system-one.live.fixtures.ts:35-153`; each body is parsed and its expected label checked at `:155-188`. |
| 19: catalog and model forms | Partly met. The catalog membership and both ID forms are checked at `system-one.live.spec.ts:88-120`. The default selection can silently switch away from clef; defect 1. |
| 19: probe, repeated correctness, answer checks, latency | Met for the stated checks. Ready/auth probes are at `system-one.live.spec.ts:122-144`; all ten fixtures run three times and compare choices, confidence, and probability sum at `:146-204`. One latency line contains cold, warm p50/p95, and probe duration at `:192-200`. The client default is 30 seconds at `:40-41,72-80`. |
| 19: error mapping | Met. Bad key, unknown model with `notFound`, and 1 ms timeout are asserted at `system-one.live.spec.ts:206-234`. The client maps HTTP 401/403 and 404/405 and classifies an aborted signal at `system-one.client.ts:166-176,214-229`. |
| 20: trigger, permissions, concurrency, and missing key | Met. Only schedule `41 5 * * 1` and manual dispatch appear at `.github/workflows/decision-model-live-eval.yml:3-9`; permissions and uncancelled concurrency are at `:10-19`. The gate prints a notice naming `OLLAMA_API_KEY` and later steps require a keyed result at `:32-76`. |
| 20: live spec invocation and secret handling | Met by static inspection. `PTAH_LIVE_PROBES` is set at `.github/workflows/decision-model-live-eval.yml:21-26`, the key reaches the probe step through `env` at `:71-78`, and the Nx command selects `system-one.live` with no-tests failure at `:78`. The issue step requires a keyed probe failure at `:80-84`; redaction guards an empty key before `grep -qF` at `:100-106`. No secret expression is interpolated into a `run` body at `:32-42,71-78,80-137`. The spec prints only ID acceptance and latency at `system-one.live.spec.ts:118,200`; its logger is silent at `:46-51`. |
| 20: keep one issue | Gap. The matching-issue lookup can fail without making the step fail; defect 2 at `.github/workflows/decision-model-live-eval.yml:110-123`. |

## Defects

1. **SERIOUS — The eval can pass after clef disappears.** At `libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts:95-99`, absence of `clef:27b-cloud` selects the first catalog entry. The membership assertion at `:102-105` and all subsequent calls use that replacement. A different decision-capable model can therefore satisfy every assertion while the intended clef route is unavailable, producing a green weekly eval for the wrong model. Fix: keep the default pinned to clef and fail if it is absent; permit a different model only when `PTAH_LIVE_DECISION_MODEL` is explicitly set. The implementation plan at `implementation-plan.md:566-569` specified the fallback, but the requirement at `task-description.md:176,186-190` is to prove clef.
2. **MODERATE — Failed issue lookup can create duplicates.** At `.github/workflows/decision-model-live-eval.yml:110-123`, `gh issue list` runs in a process substitution consumed by `mapfile`. A list API failure is not reflected in `mapfile`'s exit status, so `matching_issues` appears empty and the script proceeds to `gh issue create`. If listing fails transiently while creation works, an existing issue is missed and the workflow opens another, violating the one-issue contract. Fix: capture the list command separately, check its exit status, and only then parse and create or edit.

## Five logic questions

1. **Silent failure:** Missing clef can yield a green eval against another model (`system-one.live.spec.ts:95-105`; defect 1).
2. **Unexpected user action:** A maintainer manually dispatching the workflow while the issue-list API has a transient failure can get a duplicate issue (`decision-model-live-eval.yml:8,110-123`; defect 2).
3. **Wrong input data:** A catalog containing other decision models but no clef changes the tested model without an error (`system-one.live.spec.ts:93-105`; defect 1).
4. **Dependency failure or malformed response:** Client HTTP/transport failures map to explicit outcomes (`system-one.client.ts:162-196,214-229`), and a failed fixture call is recorded rather than accepted (`system-one.live.spec.ts:158-161`). The issue-list failure is mishandled (`decision-model-live-eval.yml:110-123`; defect 2).
5. **Missing requirement:** The plan allows a fallback model (`implementation-plan.md:566-569`), while the task asks for evidence about clef (`task-description.md:176,186-190`). An explicit assertion that the default evaluated model is clef is needed (`system-one.live.spec.ts:95-105`; defect 1).

## Verification and score

I read the four reviewed files in full and traced the client, response schema, catalog, Jest project configuration, and reference workflow. `ptah_get_diagnostics` reported zero TypeScript errors for the changed TypeScript files. The orchestrator supplied prior verification: 331 platform-core specs passed; the live suite skips without env; typecheck and lint passed; `ci.yml` has no live-spec reference. I ran no tests, builds, or network calls, and cannot verify actual keyed provider behavior from this review.

**Score: 6/10.** The primary eval can pass for the wrong model and issue deduplication fails on a realistic API boundary. The remaining checks are implemented with direct assertions, keeping this above a foundationally wrong review band; the false-green eval keeps it below a sound 7–8.

Verdict: REVISE
