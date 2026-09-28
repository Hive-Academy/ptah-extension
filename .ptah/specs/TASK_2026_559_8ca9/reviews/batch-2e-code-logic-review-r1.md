# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 3 |
| Failure modes found | 5 |

Batch 2e, independent behavioural review. Recommendation: **REVISE**. The ordinary paths work and all six requested Nx targets pass, but the final token bound and preservation of log failures are demonstrably false. This separates 5/10 from 7–8: these are central contracts, not test-only gaps. Working routing, refusal, spool recovery and packaging separate it from 3–4.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. Abbreviations:

- **B** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
- **T** = `libs/backend/tool-output-reducers/src/lib/token-measure.ts`
- **R** = `libs/backend/tool-output-reducers/src/lib/reduce-output.ts`
- **L** = `libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.ts`

## Five logic questions

### 1. How does this fail silently?

The under-budget branch returns an exact 2,001-token input unchanged while reporting 2,000 (T:52–60, B:195–204; S1). The final reduced log can contain only startup information despite the reducer retaining the failure (B:224, B:290; S2). The latter does carry a partial-output trailer, so this is not an undisclosed truncation; it still fails Decision 7's content-selection intent.

### 2. What user action produces unexpected behaviour?

Requesting a verbose failed command whose first 40 lines consume the budget removes the later error and summary (L:167–185, B:285–295; S2). Using a sufficiently long workspace path can make the trailer itself exceed the token budget (B:252–270; M1).

### 3. What input data produces a wrong answer?

Boundary-sensitive token sequences invalidate the claimed conservative piecewise count (T:42–47, T:57; S1). A dependency Error with a custom name containing a path is copied into the result even though its message is suppressed (B:430, B:472–474; M3).

### 4. What happens when a dependency fails?

Ordinary filesystem errors become short failure trailers, and EEXIST retries preserve existing files (B:364–383). A budget failure followed by an output-channel exception rejects the entire call instead of reaching the fallback (B:180–185; M2). A custom Error name can expose arbitrary text (M3). Async reduction is awaited (R:107); ordinary reducer throws return raw input (R:113–119).

### 5. What is missing that the requirements never mentioned?

A priority rule when errors, head and tail cannot all fit; a representable spool locator when the absolute path alone exceeds the budget; and a nonthrowing logging boundary. These are required to reconcile the existing promises (B:252–270, B:285–295, B:180–185). The per-directory prune timestamp map also has no eviction (B:169, B:397); session cost grows with distinct workspace roots, although this is a minor follow-up rather than a separate failure finding.

## Failure modes

### S1 — Piecewise counting is not an upper bound (Serious)

- Trigger: tokenizer context changes across a 1,024-character piece boundary.
- Symptom: a result exceeding the declared token limit is accepted unchanged and its token count is understated.
- Evidence: T:52–60, T:112–122; R:88–90; B:195–204.
- Current handling: every acceptance check uses the same piecewise estimator. The final result is counted but never independently validated (B:233–240).
- Reproduction: `' '.repeat(1018) + '59X!GWee0_g-'` measures **18 piecewise / 19 exact** with the installed tokenizer. A default-budget case was reproduced as follows, using the actual source loaded through TypeScript transpilation:

```js
let seed = 42;
const alphabet = 'abcefGWiX012345679_!-??';
let raw;
for (let i = 0; i <= 222; i++) {
  let s = '';
  for (let j = 0; j < 3500; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    s += alphabet[seed % alphabet.length];
  }
  if (i === 222) raw = s.slice(0, 2734);
}
// countTokensPiecewise(raw) === 2000
// countTokens(raw) === 2001
// applyToolResultBudget({text: raw, toolName: 'ptah_get_diagnostics',
//   requestId: 7, spoolRoot: absoluteRoot})
// returns raw unchanged, returnedTokens: 2000
```

- Recommendation: retain bounded estimation for multi-megabyte input, but establish an exact or proven conservative acceptance check for the bounded final candidate, including identity and fallback paths. Validate body plus actual trailer together. Use an independent whole-text oracle in budget specs; the current `trailerOf` helper validates with the same potentially inaccurate `fitsBudget`.

### S2 — Prefix fitting defeats error-preserving log reduction (Serious)

- Trigger: the required log head is larger than the available body window, with a later failure.
- Symptom: neither the error block nor the final test summary reaches the model.
- Evidence: L:167–185 keeps head, tail and errors; B:224 and B:285–295 then retain only a prefix. R:158–167 additionally makes errors beyond the 2 MiB prefix invisible to reduction.
- Current handling: the full raw log is spooled, and a generic partial trailer is shown.
- Reproduction: 1,000 distinct lines `[2026-09-26T10:00:00] INFO step ${i} ` followed by `'normal detail '.repeat(40)`; insert `ERROR: UNIQUE_FAILURE` and `    at fail (x.ts:1:2)` at index 700, then append `Tests: 1 failed, 999 passed`. The real helper returns `reducer: 'log-reduced'`, `truncated: true`, with both failure marker and summary absent. Filesystem calls were stubbed for this content-selection probe.
- Recommendation: fit logs by semantic priority—failure blocks/context and summary before routine head lines—with omission markers. If the mandatory set itself cannot fit, explicitly report omitted failure blocks and provide the spool locator. Preserve access to tail/error regions when capping reducer input.
- Scope judgment: the Batch 2e notes explicitly require cutting oversized reducer results, so the implementation follows that narrow recipe. Nevertheless, calling the loss “out of scope” conflicts with Decision 7 and the preserved-content guards planned in batches.md:263 and Task 21.1. Spooling makes the failure recoverable; it does not satisfy “keep errors with context.”

### M1 — Trailer can exceed the entire budget (Moderate)

- Trigger: a successful spool has a long, token-dense absolute path.
- Symptom: even an empty body cannot make the final result fit.
- Evidence: B:252–270 clamps remaining tokens/chars to at least one; B:321–322 emits the full path; B:233–240 returns without enforcing the combined limit.
- Current handling: estimates a sample trailer, reserves space, then assumes the actual trailer fits. Repeated `x` is also a char-length placeholder, not a general token-cost upper bound.
- Reproduction: mock mkdir/writeFile/readdir successfully; use a root built from the Windows drive root plus 35 components of `'qz'.repeat(100)`. For `'word '.repeat(4000)`, final text was **7,168 chars / 7,084 exact tokens**, against 2,000 tokens. This isolates the successful-write branch; an actual OS rejection instead follows the short failure-trailer path. Increasing the component count also defeats the character ceiling.
- Recommendation: bound the locator representation, preferably using a workspace-relative locator with an explicit root convention, or select a shorter spool location. Enforce both limits on the actual final string, with a defined trailer-only fallback.

### M2 — Logging failure escapes the “never throws” wrapper (Moderate)

- Trigger: reduction/budgeting fails, and the optional output channel throws while recording it.
- Symptom: `applyToolResultBudget` rejects and no capped tool result is returned.
- Evidence: B:180–185; R:113–119 has the same unguarded logging dependency.
- Current handling: the catch block calls `appendLine` before invoking `plainCut`.
- Reproduction: inject a rejecting `reduceOutput` and an output channel whose `appendLine` throws `Error('sink down')`; the real wrapper rejects with `sink down`.
- Recommendation: isolate diagnostic logging in a best-effort nonthrowing helper, then execute fallback independently. Test both failures together.

### M3 — Error.name is treated as sanitized data (Moderate)

- Trigger: a dependency throws an Error with a custom name containing content or a path.
- Symptom: that content is copied into the model-visible failure trailer or log.
- Evidence: B:382, B:430, B:472–474; R:115 and R:203–205.
- Current handling: slices `error.name` to a maximum length; only error codes have character validation.
- Reproduction: a budget dependency rejects `Object.assign(new Error('message'), {name:'/private/SECRET'})`. The returned trailer ends in `full output could not be saved: /private/SECRET]`.
- Recommendation: map exceptions to a fixed allowlist of safe classifications, otherwise `Error`/`unknown`; keep the existing validated errno mapping. Avoid arbitrary property access/string operations defeating the fallback for malformed Error objects.

## Blocking issues

None established in the reviewed batch.

## Serious issues

### S1 — False token-budget acceptance

- File: T:57; B:195.
- Scenario: valid text straddles tokenizer boundaries.
- Impact: callers receive more tokens than declared and inaccurate telemetry.
- Fix: independent exact/proven-safe final acceptance and boundary regression fixtures.

### S2 — Relevant failure output is dropped

- File: B:290; R:163.
- Scenario: verbose startup or an error after the reducer input cap.
- Impact: the model must reread the raw spool to discover why a command failed, defeating the agreed reduction intent.
- Fix: priority-aware log fitting and cap handling that considers required tail/error regions.

## Moderate and minor issues

- **M1:** B:268–270, B:321 — unbounded trailer locator; bound the locator and validate the final string.
- **M2:** B:181 — output-channel failure escapes recovery; make logging best effort.
- **M3:** B:473, R:204 — custom Error names disclose arbitrary text; use fixed classifications.
- Minor follow-up: B:169, B:397 retain every distinct spool directory indefinitely; bound or expire the prune bookkeeping.
- Minor contract precision: T:126–139 assumes token count is monotonic for binary search. It is not generally monotonic under BPE, so “longest prefix” is not proved. The ordinary fit path rechecks its candidate (B:294); this is not counted as an additional demonstrated budget overflow.

## Data flow

1. **GAP S1:** raw input → identity precheck (B:194–205). Uses an estimator as the acceptance oracle.
2. **OK with limits:** raw → complete-line reducer prefix (R:158–167). LF/CRLF boundary is excluded cleanly; a single oversized line refuses. The cap is 2,097,152 UTF-16 units, not UTF-8 bytes, as the exported constant documents.
3. **OK for this batch:** detect → hint → awaited reducer (R:101–119). Refusals, blank output and no token improvement return raw with reducer `none` (R:121–132). Known Markdown/HTML defects from earlier accepted batches remain; no new approval of those implementations is implied.
4. **GAP S2:** reduced result → prefix-only fitting (B:224, B:285–295).
5. **OK for ordinary filesystem failures:** raw → sanitized filename → exclusive write → retry or error trailer (B:341–383). Existing collision files are not overwritten. Non-EEXIST failures attempt partial-file removal. Cleanup is best effort, not guaranteed on permission failure.
6. **OK within naming convention:** prune only regular files matching the module's filename pattern and older than 24 hours (B:400–408); foreign names and directories are skipped. Ownership is inferred from the reserved directory/name convention, not independently authenticated. No adversarial symlink/race test was run.
7. **GAP S1/M1:** body + actual trailer → returned text without final enforcement (B:233–240). Saved path → agent's Read tool is the intended recovery path; this batch writes no settings/config.
8. **GAP M2/M3:** exceptional flow → logging/classification → plain cut (B:180–185, B:430).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Identity under budget | PARTIAL | S1: exact over-budget text can take identity |
| Hint routing, async code reducer, refusal → none | COMPLETE | R:101–132; source/specs examined |
| Complete-line 2 MiB reducer cap | COMPLETE | R:158–167; semantic tail preservation remains S2 |
| Final token and character caps including trailer | PARTIAL | S1, M1 |
| Preserve errors with context | PARTIAL | S2 |
| Non-empty result for non-empty input | COMPLETE | Raw refusal or non-empty trailer on ordinary paths; M2 can reject |
| Spool raw, sanitize id, exclusive-create/retry | COMPLETE | B:341–383; supplied tests pass |
| Expire own spool names, recover write failures | COMPLETE | B:390–415; best effort |
| Never throw / no error content leakage | PARTIAL | M2, M3 |
| Ship marked in consumer runtimes | COMPLETE for inspected generation path | See packaging verification below |
| Dispatcher integration | MISSING in this batch by design | Batch 2f owns integration; not a defect here |

Implicit requirements not addressed: trailer representability, failure-priority policy and logging isolation.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty input | YES | Identity (B:194) | None |
| Non-empty whitespace/refusing reducer | YES | Raw refusal (R:121) | No invented content |
| Huge single line | YES | No reducer prefix; cut/spool (R:164) | S1 still applies |
| Surrogate pair at piece/cut boundary | YES | safeEnd (T:144–151), fallback adjustment (B:441–443) | Valid pairs inspected; not arbitrary malformed Unicode fidelity |
| CRLF at cap/cut | YES | Remove CR with LF boundary (R:167, B:291) | None established |
| Concurrent identical ids/names | YES | wx and 8 EEXIST attempts (B:366–378) | Exhaustion reports failure |
| Write failure after partial create | YES, best effort | rm attempt (B:374) | OS may also deny deletion |
| Long successful spool path | NO | M1 | Trailer exceeds caps |
| Failure beyond retained log prefix | NO | S2 | Error/summary absent |
| Throwing logger/custom Error.name | NO | M2/M3 | Rejection or content leak |

## Verification and scope limits

- Ran exactly the requested scoped command: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools --skip-nx-cache`. **All six targets passed**, Nx duration 1m 2s. Output was tailed; no failed-suite rerun.
- Scoped `ptah_get_diagnostics` returned **Unavailable: TypeScript check still running after 45s**. No diagnostic pass is claimed; the explicit Nx typechecks passed.
- Read the named implementation/config files and specs, the changed log/Markdown consumers, Batch 2e, both notes sections, and Decisions 2/7. The folder contains no task-description.md, implementation-plan.md or code-style-review.md; batches.md explicitly identifies this as plan-free.
- `ptah_search_files` returned no AGENTS.md. Native reads were used because no direct file-read tool was listed. No raw session logs were read.
- No git operations or production edits were performed under the reviewer role's prohibition. Review scope therefore uses the user's explicit file list and current contents, not a verified git diff.
- No Batch 2e executor report with numbered deviations 1–5 exists among the task Markdown documents examined. Those unnamed deviations cannot be individually accepted. The explicitly documented Batch 2d dependency deferral is implemented in `libs/backend/vscode-lm-tools/package.json:19`; lint passes. The requested log-tail “out-of-scope” position is assessed under S2.
- **Electron packaging:** `apps/ptah-electron/project.json:31–32` uses thirdParty:false / generatePackageJson:true; source dependency is `apps/ptah-electron/package.json:42`. The installed Nx executor calls copyPackageJson (installed `@nx/esbuild/dist/src/executors/esbuild/esbuild.impl.js:42–71`), whose update function calls createPackageJson in production mode (`@nx/js/dist/src/utils/package-json/update-package-json.js:19`). Invoked that same createPackageJson with the current cached graph/file map, target build-main and this worktree root, **in memory**: generated `ptah-desktop` dependencies include `marked: ^18.0.13`. Nx preserves app source dependencies (`nx/dist/src/plugins/js/package-json/create-package-json.js:36–56`). No dist manifest exists in this worktree; no Electron build/install smoke test was run. CLI source dependency is `apps/ptah-cli/package.json:78`.
- Independent probes transpiled the actual local source in memory; fault injection replaced module exports/filesystem calls only in the probe process. No probe source files or spool files were written. Known prior Markdown/HTML issues remain recorded in batches.md, not recounted as new Batch 2e findings.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for the reproduced failures; runtime package-install validation remains unperformed.
- Top risk: the central helper can accept an over-budget result and discard the failure information it was introduced to preserve.
- What a robust implementation would add: exact/proven-safe final-budget validation; failure-priority log fitting; bounded spool locators; isolated logging; safe exception classifications; regression tests using independent token and preserved-content oracles.

