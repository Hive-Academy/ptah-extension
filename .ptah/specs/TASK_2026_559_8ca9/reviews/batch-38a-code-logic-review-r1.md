# Code Logic Review — TASK_2026_559_8ca9 — Batch 38a r1

## Summary

| Metric                    | Value                                       |
| ------------------------- | ------------------------------------------- |
| Verdict                   | **REVISE**                                  |
| Assessment                | NEEDS_REVISION                              |
| Score                     | **7/10**                                    |
| Blocking / Serious        | 0 / 0                                       |
| Moderate / Minor findings | 1 / 0                                       |
| Failure modes             | 1 (shared teardown failure-handling defect) |
| Lane K closing finding 5  | **CLOSED**                                  |

The production attribution fix addresses the original `_test` defect and the requested edge cases. The slow-empty test now synchronizes with the real build instead of racing filesystem completion against a fixed turn count. One bounded correction remains: both new teardown hooks skip spy restoration and directory removal if setup left an incomplete container or a stream-close wait rejects. Normal test-body assertion failures do reach afterEach; this finding concerns failures encountered within cleanup itself.

This is the single independent review requested under User Decision 24. No additional review round is requested. Score 7 reflects sound production behavior and passing targeted checks, with a reproducible test-infrastructure failure path preventing full acceptance of item (c).

Reviewed the named uncommitted working files on `fix/task-559-mcp-tool-contract`; HEAD read from the worktree ref was `e933f8c06a4510bf01b367271702d1c55dcee0f4`. Read the executor report, task context, relevant Decision 16 implementation/test paths and prior Lane K finding. The context.md decision-record change was not reviewed as implementation. No git commands, source/test edits, formatters or batch/status mutations were used. Named changed paths define this review's scope; this is not a review of unrelated AST work.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.

## Verification

Ran each specific spec once, in separate Jest processes with its project config and `--runInBand`:

| Spec                                                                                           | Result                 |
| ---------------------------------------------------------------------------------------------- | ---------------------- |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`     | **298 passed**, exit 0 |
| `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-checker.spec.ts` | **59 passed**, exit 0  |
| `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts`                               | **5 passed**, exit 0   |
| `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts`                       | **6 passed**, exit 0   |

Logs are in `C:/Users/abdal/AppData/Local/Temp/b38a-{dispatcher,go,electron,cli}.log`; all four processes were joined once after completion. No failed suite was rerun. Dispatcher emitted Jest's “did not exit one second after” asynchronous-operation warning, then exited 0. It was not localized to this change and is not promoted to an unanchored finding. Scoped Ptah diagnostics on go-vet-output.ts and go-vet-checker.ts returned **0 errors / 0 warnings**. The executor's broader Nx/repeat-run evidence was read but not represented as independently rerun here.

Independent probes use actual current TypeScript implementations loaded through transpileModule, real temporary module/file layouts and synthetic vet JSON. Go is absent, so these establish mapping/reporting behavior, not real `go vet` execution. No workspace-wide checks were run.

## Item (a): slow empty build and Decision 16

**Accepted for the stated flaky-test correction.**

At `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:6647`, the spy calls the real per-test graph service and resolves the deferred with its returned promise. Promise adoption means `await buildsDone[0].promise` at `:6661` waits for actual build completion, including filesystem work; it is not merely notification that the build began. Rediscovery is likewise joined at `:6685`.

The 200-turn realpath hold (`:6635`) uses setImmediate, explicitly excluded from fake timers (`:5747`). It is a scheduling pin, not an elapsed-time sleep. Assertions do not depend on beating its duration: the bounded RPC timer is fake, and completion is joined. The remaining `flush()` at `:6663` drains the dispatcher's promise bookkeeping after the real build has resolved. That bookkeeping records the empty result and clears the job in promise continuations (`protocol-dispatcher.ts:2723`, `:2751`), not additional filesystem work. The realpath spy restores in finally (`protocol-dispatcher.spec.ts:6688`).

The test still requires all of the important outcomes:

- First call returns `building` (`:6658`).
- Successful empty graph is published (`:6664`).
- Next call returns a non-error empty answer, no status, total 0, and **no rediscovery** (`:6673`–`:6676`).
- Third call rediscovers, returns building and increments discovery exactly once (`:6681`–`:6682`).
- Both real builds finish and exactly two builds started (`:6685`, `:6687`).

**Supersession qualification:** this individual test does not perform a supersession, so it does not alone prove every clause of Decision 16. The generation condition remains explicit in production (`protocol-dispatcher.ts:2566`) and old-generation jobs cannot publish a returned discovery (`:2780`, generation check inside buildDependencyGraph). Existing neighboring tests cover eviction and explicit-build supersession (`protocol-dispatcher.spec.ts:6444`, `:6470`) and replacement of an empty graph (`:6585`). All passed. A direct “finished, unconsumed empty result, then generation changes before retry” regression would sharpen coverage; no weakened assertion or behavioral regression attributable to this patch was found. Do not describe the focused test alone as proving that case.

## Item (b): Lane K finding 5 CLOSED

`libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-output.ts:216` now returns all plausible directories. Bracketed external test identity is resolved exactly at `:231`; other bracketed identities retain their own import path. Bare `_test` and `.test` IDs enumerate candidates (`:194`). Candidate paths are constrained to the module (`:174`).

The checker inserts every returned directory into the disqualification set (`libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-checker.ts:738`). Both candidates and actual vetted directories use `pathKey`, including Windows case folding (`:420`, `:741`, `:750`). A null mapping disqualifies all vetted files; an unmapped finding always keeps `outcome: findings` and a reason (`:760`), even when there are no mapped diagnostic entries.

Independent probe results, with one unmapped finding in every case:

| Case                                                                                             | Result                                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Original bare `example.com/m/foo_test`, both directories requested                               | `foo_test` and `foo` disqualified; unrelated `other` remains checked             |
| Real `foo_test`, **no `foo` directory exists**                                                   | Only `foo_test` disqualified; unrelated `other` remains checked                  |
| Real `foo_test [foo_test.test]`                                                                  | Exactly `foo_test` disqualified; `foo` remains checked                           |
| External `foo_test [foo.test]`                                                                   | Exactly `foo` disqualified; real `foo_test` remains checked                      |
| Nested physical module, import path `example.com/m/v2`, external `deep/foo_test [deep/foo.test]` | Correct nested module's `deep/foo` disqualified; `deep/foo_test` remains checked |
| External test of module root `example.com/m_test [example.com/m.test]`                           | Module-root file disqualified; unrelated subpackage remains checked              |
| Real module itself named `example.com/m_test`                                                    | Module-root file disqualified; outside-module stripped candidate dropped         |
| Windows uppercase requested paths and package-directory spelling                                 | Both real candidate directories matched and disqualified; no checked files       |

Every case returned `outcome: findings`, `reason: unmapped-findings`, `unmappedFindings: 1` and a nonempty notChecked group. There was no bare clean answer. `status: checked` describes successful vet output processing; it does not override per-file exclusions or claim the affected files were checked.

The nonexistent sibling candidate is harmless: no requested vetted file can match it, so there is no extra disqualification. The original real `_test` file is now withheld instead of incorrectly credited. **Lane K closing review finding 5 is CLOSED.**

Probe: `C:/Users/abdal/AppData/Local/Temp/b38a-review-probe.cjs`; fixture `C:/Users/abdal/AppData/Local/Temp/b38a-review-8SA5aP`. The no-sibling probe actually omitted the sibling directory, whereas the author's corresponding test omits it only from requested files. Both behave correctly.

## Numbered finding

### R38A-01 — Moderate — cleanup failures bypass restoration and removal in both wiring specs

- **Disposition:** fix-now in the bounded correction for this review.
- **Anchors:** `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts:134`, `:138`, `:143`; `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts:151`, `:155`, `:160`.
- **Concrete scenario 1:** host construction fails after the container is pushed (`Electron :80`, `CLI :88`) but before OUTPUT_CHANNEL is registered. afterEach resolves the missing token and throws. It never restores createWriteStream or removes the temporary directory.
- **Concrete scenario 2:** a log stream's asynchronous open/write fails while teardown awaits `once(stream, 'close')`. Node's `events.once` rejects on error. `Promise.all` rejects and skips the following mockRestore/rmSync lines. This is particularly relevant to the asynchronous file-open boundary this patch is intended to fix.
- **Evidence:** extracted the actual afterEach callback from each current spec using the TypeScript AST and executed that callback with controlled dependencies. A failing output-channel resolution left `restored:false` and `dirRemains:true` in both. A second probe used a **real fs.WriteStream** opening an absent parent path under OS temp; dispose called end(), the wait rejected with ENOENT, and both callbacks again left `restored:false` and `dirRemains:true`. No production/test source was modified. The normal callback control disposed, restored and removed successfully.
- **Impact:** test failures on these boundaries leave temp artifacts and a global filesystem spy installed, potentially contaminating subsequent tests. This does not affect shipping application behavior and is not Blocking or Serious.
- **Current handling:** afterEach is sufficient for an ordinary assertion failure in the test body, but the cleanup sequence itself has no finally or independent cleanup attempts. Its own stream-count assertion (`Electron :137`, `CLI :154`) can also short-circuit later cleanup.
- **Fix:** preserve the original test/cleanup failure while ensuring spy restoration in finally. Dispose tracked channels safely even after partial setup, finish/destroy and settle tracked streams without one rejection preventing handling of the others, and attempt directory removal after handles are closed. Put the stream-count assertion after essential cleanup or ensure it cannot prevent cleanup. Do not swallow errors into a passing test.
- **Regression:** exercise partial host setup and an asynchronous stream error; verify channels/streams are settled, spy restored and temp directory removed while the test still reports the original failure.

Real-stream probe: `C:/Users/abdal/AppData/Local/Temp/b38a-real-stream-probe.cjs`; fixtures `C:/Users/abdal/AppData/Local/Temp/b38a-review-jbVV6I`. It transpiles and executes the source callback itself rather than a hand-written duplicate of the teardown.

## Five logic questions

1. **How can it fail silently?** No silent clean attribution survives the requested mapping cases (`go-vet-checker.ts:738`, `:760`). Cleanup failure visibly fails the test but silently skips restoration/removal afterward (R38A-01).
2. **What user action produces unexpected behavior?** Running these tests after partial registration failure or an asynchronous log-file failure can leave state affecting later tests. Ordinary failed expectations in a test body still invoke afterEach.
3. **What input data gives a wrong answer?** Bare `_test` ambiguity now conservatively excludes both candidates (`go-vet-output.ts:194`); exact bracketed IDs avoid collateral exclusion (`:231`). No new wrong mapping was demonstrated in the requested edge cases.
4. **What happens when a dependency fails?** The build-promise wait joins actual completion; normal failures remain failures. In teardown, rejected close promises currently abort remaining cleanup (`Electron :138`, `CLI :155`), the one reported defect.
5. **What is missing from the stated requirements?** The focused empty-build test is not itself a supersession test; broader source/neighboring coverage supplies that evidence. No new runtime requirement is inferred. Cleanup needs to tolerate its own error paths as well as failed assertions in the test body.

## Data flow and requirements fulfilment

| Requirement                                                                                         | Status                              | Evidence / gap                                                   |
| --------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| Await the slow real graph build, no timer/I/O race                                                  | COMPLETE                            | Actual promise adopted and awaited; focused spec passed          |
| Retain empty result once, then rediscover                                                           | COMPLETE                            | Strong unchanged output/discovery assertions                     |
| Supersession invalidates stale generation                                                           | COMPLETE in reviewed implementation | Generation gate remains; focused test alone does not exercise it |
| Correct real `_test`, external variants, root/nested/case paths                                     | COMPLETE                            | Independent table above; Lane K finding 5 CLOSED                 |
| No clean claim for disqualified files                                                               | COMPLETE                            | Findings outcome and notChecked retained                         |
| Dispose channel, close stream, remove directory after normal test completion/body assertion failure | COMPLETE normal hook path           | Disposal precedes close wait and removal                         |
| Cleanup still completes if setup/cleanup dependency fails                                           | PARTIAL                             | R38A-01                                                          |

## Edge cases and limits

The mapping change is intentionally conservative for ambiguous bare IDs; it does not require filesystem existence probes. Unknown/outside-module IDs still produce null and global disqualification. The passing Jest file includes malformed/outside/module-null mapping cases (`go-vet-checker.spec.ts:908`). No real Go executable was available, and no actual Go execution is claimed. Dispatcher open-handle warning remains unlocalized and is not attributed to this patch. No unrelated Lane K consent findings were reopened by this Batch 38a review.

## Verdict

**REVISE, 7/10.** Confidence **HIGH** in closing Lane K finding 5 and in R38A-01's reproduced cleanup failure; the flake correction passed the full affected spec and its synchronization is sound. Make the single bounded cleanup correction under User Decision 24. No Blocking findings remain in this batch review; no additional review round is requested.
