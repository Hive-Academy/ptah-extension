# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 13, Lane A, **r3**, after revision round 2. Source remained read-only. This verdict covers agent read/status and their supporting contracts, not unrelated tools in the large dispatchers.

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 1        |

Both r2 serious defects are corrected. Narrowed windows are recoverable byte-for-byte through named spool files, and an oversized peer stream no longer unnecessarily clips an otherwise fitting final line. One moderate defect remains: unusually long absolute spool paths can themselves exceed the stdio text budget. Approval follows the requested threshold of no Blocking or Serious findings; it does not mean no defects.

7 rather than 6: both probable diagnostic-loss cases now have working recovery and transport coverage. Below 8: the metadata-only budget edge is reproducible, and storage has age-based cleanup rather than a hard volume limit.

Inputs: task context Decisions 2/4/17, Batch 12/13 requirements and Batch 2f root policy, archived r1/r2 findings, executor report through “Revision round 2 (r2 REVISE 6/10),” and repository instructions. The renderer and its specs were read in full; transport wiring, spool implementation, runtime/type contract, throttle, CLI startup and session-submit paths were traced. Earlier unchanged read/status findings were carried forward and checked against the revised paths. Unrelated dispatcher bodies are outside this verdict. No git operation or historical source restore was performed.

Source references below are worktree-relative, under `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`:

- **VIEW:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-read.view.ts`
- **VIEW-SPEC:** same directory, `agent-read.view.spec.ts`
- **PD:** same directory, `protocol-dispatcher.ts`
- **PD-SPEC:** same directory, `protocol-dispatcher.spec.ts`
- **BUDGET:** same directory, `tool-result-budget.ts`
- **THROTTLE:** same directory, `agent-status-throttle.ts`
- **STDIO:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts`
- **SERVICE:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- **OUTPUT:** `libs/shared/src/lib/types/agent-process.types.ts`
- **SUBMIT:** `apps/ptah-cli/src/services/mcp/session-submit.service.ts`

## r2 findings status

| Finding                                                             | Status | Evidence and impact                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-S1: middle of a partially rendered long line cannot be recovered | FIXED  | `VIEW:114-124` saves each narrowed stream's complete returned window; `VIEW:360` names that file. Both HTTP and stdio, tail and offset 0, recovered MIDDLE_FAILURE from a 40,026-character line through a byte-equal spool. No character paging is required.                  |
| R2-S2: huge stderr clips an otherwise fitting stdout final line     | FIXED  | `VIEW:159-204` separates whole-line and partial-line candidates. With a 1,892-character FINAL_FAILURE line and a 30,008-character peer, the entire short line and the peer's ending survive, in both stream directions and both transports. The long window is saved in full. |

Original r1 cases remain corrected on ordinary roots: `PD:1122` and `STDIO:414` share the renderer; the 5,000 × 200-character fixture displays lines 4963–5000 with FINAL_FAILURE and truthful omission counts. Exactly 200 lines display 163–200 with the marker. `VIEW:208` uses separate stream totals; mixed offset 100/tail 2 displays 101–102 of 300 for each stream. `THROTTLE:60` is still used by both status surfaces; a repeated running status becomes short. R3-M1 below qualifies the previously fixed stdio budget guarantee for very long metadata.

## Five logic questions

### 1. How does this fail silently?

No new silent output-loss case was reproduced. Partial-line notices and full-window locators expose what was omitted (`VIEW:338`, `VIEW:360`). The remaining budget violation is not marked as a budget error: metadata alone can exceed the cap while returning success (`VIEW:120`, `VIEW:205`); see R3-M1.

### 2. What user action produces unexpected behaviour?

Reading two narrowed streams from a server launched in an exceptionally deep directory returns oversized stdio text despite the canonical budget (`STDIO:205`, `STDIO:414`). Repeated ordinary reads also create fresh spool files each time (`BUDGET:516`); the storage policy and its limits are described below.

### 3. What input data produces a wrong answer?

The old long-line and mixed-stream probes now preserve diagnostics or provide exact recovery. Two edge lines that fit separately but not together are both partially shown (`VIEW:181`); neither is silently declared complete. Long spool locators, rather than output content, produce the remaining incorrect size guarantee (`VIEW:363`).

### 4. What happens when a dependency fails?

Real spool failure was injected by using a file as the spool root: ENOTDIR appeared in the read notice and no nonexistent locator was advertised (`BUDGET:544`, `VIEW:360`). Exclusive creation, collision retry and partial-write removal remain in `BUDGET:522-544`. Read/status API errors follow the existing dispatcher error paths; a failed status lookup cannot be suppressed because the lookup precedes the throttle (`PD:1099`). No live agent crash or filesystem hang was injected.

### 5. What is missing that the requirements never mentioned?

A usable locator also needs its own size policy: output fitting alone is insufficient (`VIEW:363`). Repeated spooling needs an explicit operational understanding: the inherited policy is best-effort age cleanup, not deduplication or a byte/file quota (`BUDGET:547-570`). Neither anonymous callers nor high-cardinality identities have a global request-rate cap (`THROTTLE:73-90`); this is repeat-response suppression, not abuse prevention.

## Failure modes

### R3-M1 — Moderate: long spool locators exceed the stdio result budget

- **File:** `VIEW:363`, `VIEW:205`, `VIEW:120`; propagation at `STDIO:414-420`.
- **Trigger:** a valid, deeply nested host spool root and two streams requiring spooling. Each absolute path is inserted without a locator budget.
- **Reproduction:** created a real Windows temporary root 4,334 characters long using 25 legal directory components. Each stream contained a 4,433-character edge line. Both spool writes succeeded and both named files existed. The stdio result contained **9,010 characters / 2,376 measured tokens**, despite the **8,000-character / 2,000-token** text budget, with zero output lines shown.
- **Symptom/impact:** the caller receives an oversized successful read. Full recovery remains available, so this is not silent data loss. The unusually deep root makes this Moderate rather than Serious.
- **Current handling:** `largestFitting` can return zero without establishing that the zero-content rendering fits (`VIEW:371`). `fitView` returns that rendering anyway; once both streams are saved, the outer loop returns it without another budget guarantee. Stdio has no subsequent text-budget pass.
- **Recommendation:** reserve bounded locator metadata before selecting content; use a recoverable relative locator with a clearly stated host-root basis, or another short locator. Validate the final zero-content fallback too. The existing generic budget's relative-locator choice at `BUDGET:386` is a useful precedent. Never fix this by cutting a path into an unusable locator. Add a long-host-root regression asserting both limits and usable recovery references.

## Blocking issues

None found in the reviewed paths.

## Serious issues

None remaining from r2; no new Serious issue established.

## Moderate and minor issues

One Moderate finding: R3-M1 above. No separate style or speculative findings are counted.

## Spool ownership, traversal, volume and recovery

**HTTP ownership passes.** `PD:1127` uses `resolveSpoolRoot` at `PD:3101`, which matches declared identity against host-known workspace folders and otherwise uses the host fallback. A malicious caller root did not receive writes in the probe. This preserves Batch 2f F1.

**Stdio ownership passes the reviewed trust boundary.** `STDIO:205` uses the MCP server process working directory. Tool read arguments cannot choose it; session-submit's `cwd` only selects session workspace data (`SUBMIT:366`). Repository search found no production `process.chdir` path. A launcher choosing its server's cwd is a host configuration decision, unlike an MCP caller supplying a write destination. The injected spool-root callback used by tests is composition-time configuration, not a tool parameter. This review does not assert that process cwd always equals the CLI's `--cwd` workspace override.

**No agentId filename traversal.** `BUDGET:487` derives names from a sanitized, length-limited request ID with timestamp/random suffix, not agentId. Probing `../../AGENT_ID_ESCAPE` and `../../REQUEST_ID_ESCAPE` produced files only inside the host spool directory; the request-id prefix became `______REQUEST_ID_ESCAPE`. Exclusive `wx` prevents overwriting an existing same-name file (`BUDGET:527`).

**Both edges cut is acceptable with recovery.** Two 4,433-character edge lines individually fit but not together. The actual stdio text was 8,000 characters / 1,529 tokens, with the last 3,708 characters of each line, explicit partial-line descriptions and two byte-equal full-window files (`VIEW:181`, `VIEW:338`, `VIEW:360`). There is no room to promise both entire lines inline. Keeping both endings and naming both complete windows satisfies the revised contract; no severity assigned.

**Storage is age-pruned, not hard-volume-bounded.** Three identical dual-stream HTTP reads created six new files, 8,868 bytes per read (`BUDGET:516`). Normal repeated status calls created zero files in this probe. Each renderer invocation saves a given stream at most once (`VIEW:116`). Across calls there is no deduplication, file-count limit or byte quota. `BUDGET:149-153` / `BUDGET:551-570` prune matching files older than 24 hours, at most once per ten minutes per active directory. The 64-entry limit bounds prune bookkeeping, not disk files. An actual old matching spool was removed; an unrelated old file was preserved. An idle directory has no background cleanup, and deletion failures are best effort. This is the pre-existing shared spool policy, not a newly asserted hard bound. High-rate large reads remain an operational risk; deduplication or a quota belongs in an explicit shared-spool policy change.

## Data flow

1. **OK:** native HTTP/stdin read boundaries parse agentId/tail/offset, then call the API (`PD:1110-1121`, `STDIO:392-413`). Invalid paging is rejected rather than silently rewritten.
2. **OK:** runtime returns separate retained-stream totals (`SERVICE:951`, `OUTPUT:222`); the renderer derives independent intervals (`VIEW:208`). No new runtime/shared contract changes were needed in this round.
3. **OK:** fit whole/partial windows while retaining tail endings or forward-page starts (`VIEW:100`, `VIEW:159-204`).
4. **OK:** save each narrowed returned window through the host-owned spool path and incorporate success/failure notices (`VIEW:114`, `PD:1127`, `STDIO:418`). Saved data is the returned window, not a claim to contain all historical output.
5. **PARTIAL:** final text fits ordinary metadata; very long locators violate stdio's bound (R3-M1). HTTP retains its generic outer budget (`PD:1129`, `PD:3068`).
6. **OK:** status resolves current state before repeat suppression; shared weak ownership is by PtahAPI, caller identity and agent ID (`THROTTLE:45-106`). Same owner/identity shares state across transports; different owners intentionally do not.

## Requirements fulfilment

| Requirement                                             | Status                        | Evidence / remaining gap                                                                                                   |
| ------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Default tail does not discard final diagnostics         | COMPLETE                      | Normal 5,000/200-line and asymmetric-stream probes; `VIEW:159`.                                                            |
| Full recovery of a narrowed long line                   | COMPLETE                      | Byte-equal spool in both directions/transports; `VIEW:122`.                                                                |
| Truthful separate ranges                                | COMPLETE                      | Mixed stream probe; `VIEW:208`, `VIEW:338`.                                                                                |
| HTTP host-owned root and safe filenames                 | COMPLETE                      | Root/traversal probes; `PD:3101`, `BUDGET:487`.                                                                            |
| Stdio callers cannot choose spool location via tool cwd | COMPLETE                      | Process-root wiring; `STDIO:205`, `SUBMIT:366`.                                                                            |
| Text budget across both transports                      | PARTIAL                       | Ordinary cases pass; R3-M1. This is a text-result bound, not a JSON-envelope bound.                                        |
| Shared per-caller/per-agent status policy               | COMPLETE                      | `THROTTLE:60`; repeat probe and retained r2 transition coverage.                                                           |
| Terminal/errors/session changes not hidden              | COMPLETE                      | `THROTTLE:94-106`, lookup before throttle; retained r2 probes.                                                             |
| No-identity callers are not mutually throttled          | COMPLETE                      | `THROTTLE:82-90`; intentional identity policy, not a global rate limit.                                                    |
| Stale throttle state pruned                             | COMPLETE                      | Weak owner plus expiration on calls at `THROTTLE:45`, `THROTTLE:73`; no fixed cardinality cap within the 60-second window. |
| Spool cleanup follows existing policy                   | COMPLETE                      | Age-based cleanup probe; no hard storage bound claimed.                                                                    |
| Regression and test hygiene                             | COMPLETE for current revision | Scoped suites pass; temp roots cleaned. Historical fails-before assertions remain author evidence.                         |

Implicit requirement now exposed: budget recovery metadata as well as agent output (R3-M1).

## Edge cases

| Case                                     | Handled                        | Evidence / concern                                                |
| ---------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| Empty/full output                        | YES                            | Full view returns without spooling at `VIEW:153`; renderer specs. |
| Exactly 200 long lines                   | YES                            | Final marker retained; narrowed returned window saved byte-equal. |
| Huge single line, middle error           | YES                            | Both tail and offset 0 name a complete recoverable window.        |
| One short, one huge stream               | YES                            | Entire short final line preserved in both directions.             |
| Both edge lines exceed combined capacity | YES                            | Both endings shown; both whole windows saved and identified.      |
| Save failure                             | YES                            | Actual ENOTDIR is disclosed without a false locator.              |
| Very long host root                      | NO                             | R3-M1: metadata exceeds the budget.                               |
| Repeated reads                           | YES under inherited age policy | Fresh files each time; no dedup/quota.                            |
| Repeated status                          | YES                            | Short repeat; no spool on the tested normal status.               |
| Anonymous identity                       | YES by policy                  | Full answers; does not provide rate limiting.                     |

## Verification

- **PASS:** `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime @ptah-extension/shared --skip-nx-cache` — all nine targets, exit 0. Output tailed; one run, one completion check.
- **PASS:** `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — exit 0, **TOTAL 300**.
- **PASS:** `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` — exit 0.
- **PASS:** scoped Ptah compiler diagnostics for the renderer — zero errors, zero warnings.
- Independent executable probe: `C:/Users/abdal/AppData/Local/Temp/ptah-b13-review-r3.cjs`. Bundled actual renderer, HTTP dispatcher, stdio dispatcher, spool helper and token counter; deterministic API windows and unrelated dependency stubs. All filesystem probes used mkdtemp roots, including actual deep directories, removed in finally. No reviewed source was edited.
- HTTP 5,000-line sample: **7,936 chars / 1,939 tokens**; stdio **7,937 / 1,939**. Exactly-200 sample: HTTP **7,927 / 1,854**, stdio **7,928 / 1,856**. FINAL_FAILURE retained; saved returned windows byte-equal. Random filenames can slightly vary token counts.
- Long-line recovery cases: roughly **2,203–2,210 chars / 2,000 tokens**; all four recovered the middle marker. Asymmetric-stream cases: roughly **3,777–3,779 chars / 2,000 tokens**; short final line intact. Mixed offset case: **278 chars / 89 tokens**, no unnecessary spool.
- Test hygiene: renderer unit spool is in memory (`VIEW-SPEC:30`); HTTP Batch 13 integration roots use mkdtemp and afterEach removal (`PD-SPEC:5880-5884`). Independent probes also tested actual writes, failed writes, traversal, repeated reads and age pruning.
- Limitations: no live agent/provider/socket test, no historical round-1 rerun, no workspace-wide checks. The author's ten fails-before regressions were not independently replayed. No git-based unrelated-file restoration check was performed under the read-only review role's no-git rule.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the reproduced read/status and recovery paths; MEDIUM for untested live runtime failures.
- Top risk: exceptionally long spool paths can exceed stdio's text budget; repeated large reads consume storage according to an age-only retention policy.
- What a robust implementation would add: bounded usable locators and a final metadata-only budget check with a regression; separately, explicit shared-spool deduplication/quota requirements if high-frequency reads must have a hard disk bound.
