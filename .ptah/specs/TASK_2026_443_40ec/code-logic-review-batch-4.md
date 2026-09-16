# Code Logic Review — `TASK_2026_443_40ec` — Batch 4

## Summary

| Metric              | Value   |
| ------------------- | ------- |
| Overall score       | 8/10    |
| Assessment          | APPROVED |
| Blocking issues     | 0       |
| Serious issues      | 0       |
| Moderate issues     | 1       |
| Minor issues        | 3       |
| Failure modes found | 4       |

Scope reviewed: `memory-prompt-injector.ts` / `.spec.ts` (agent-sdk), `ptah-api-builder.service.ts` / `.spec.ts`,
`memory-namespace.builder.ts` / `.spec.ts` (vscode-lm-tools), `batch-4-report.md`, against
`implementation-plan.md` AC3 (:146-155) and Component 3 (:352-431), `batches.md` Tasks 4.1/4.2 (:452-476), and the
Batch 2 port `memory-contracts/src/lib/memory-usage-recorder.port.ts`. Whole files read, not only diff lines.
Out-of-scope Batch 1 persistence-sqlite files were not reviewed.

## Confirmation of the requested checks

1. **Prompt injection records exactly the injected ids — CONFIRMED.** `memory-prompt-injector.ts:115` filters by
   `MIN_SCORE`, `:116` returns early on zero hits, and `:117-118` records `hits.map((hit) => hit.memoryId)` — the
   same `hits` array `:127-138` renders into the block. `MAX_HITS = 5` is the `limit` handed to
   `reader.search` (`:110-114`), so the recorded set is the injected set. Short query returns at `:108` before any
   search. `buildSessionStartBlock` (`:173-257`) and `buildCorpusBlock` (`:274-348`) contain no `recordUse` call.
   The spec pins the `MIN_SCORE` boundary both ways: `memory-prompt-injector.spec.ts:151-153` uses 0.9 (kept),
   0.04 (dropped) and 0.05 (kept — the exact boundary), and asserts `recordUse` received
   `['kept-1', 'kept-2']` (`:167-168`), so a regression that recorded the pre-filter candidate list would fail.
2. **MCP search records exactly the returned hit ids, only after success — CONFIRMED.**
   `memory-namespace.builder.ts:228` awaits `reader.search`; `:229-232` records `result.hits.map(...)`; both
   return paths (`:237-239` `no_workspace` fallback, `:240` plain) return the same `result.hits`. The
   `reader` missing branch (`:211-218`) and the outer error branch (`:241-248`) precede/skip the recording, so
   the "no reader" and failed-search envelopes never record. `list` (`:251-278`) has no recorder call.
3. **Optional injection — CONFIRMED.** Both sites use tsyringe `@inject(token, { isOptional: true })` — the exact
   pattern of the adjacent optional params (`memory-prompt-injector.ts:99` corpus;
   `ptah-api-builder.service.ts:392` memorySearch), so an unregistered token resolves to
   `undefined`/`null` on hosts without memory and the optional chaining (`this.usage?.`, `getMemoryUsageRecorder?.()`)
   no-ops. No `MEMORY_USAGE_RECORDER` DI registration exists anywhere yet (repo grep: only the token definition at
   `memory-contracts/src/lib/tokens.ts:4` and these two consumers) — so today every host resolves the optional
   injection and runs; see Minor 4. Positional `new` calls: repo-wide grep found exactly two —
   `memory-prompt-injector.spec.ts:104` and `ptah-api-builder.service.spec.ts:325`, both updated. The
   `makeInjector` helper kept `corpus` as its 4th parameter and added `usage` as the 5th
   (`memory-prompt-injector.spec.ts:96-112`), so every existing spec call site that passes a corpus positionally is
   unaffected; the constructor order (logger, reader, lister, workspace, usage, corpus) matches
   `memory-prompt-injector.ts:87-101`. `buildMemoryNamespace` has one production construction site
   (`ptah-api-builder.service.ts:764`) and the new dep is optional in `MemoryNamespaceDependencies`
   (`memory-namespace.builder.ts:27`), so all other spec construction sites compile and run without it.
4. **Throwing recorder isolated; search errors not swallowed — CONFIRMED.** In the injector, the inner
   `try/catch` at `:117-126` wraps only `this.usage?.recordUse(...)` (the `.map` is inside it) and logs a warn;
   `reader.search` failures still reach the outer catch (`:147-158`) and return `''`. In the MCP builder, the
   inner catch at `:229-236` wraps only `getMemoryUsageRecorder?.()?.recordUse(...)`; a `reader.search` throw
   reaches `:241-248` and produces the error envelope, and the spec at
   `memory-namespace.builder.spec.ts:128-142` pins that a throwing recorder leaves `result.hits` intact with no
   `error` key. See Moderate 1 for the one asymmetry found here.
5. **No double recording assumed — CONFIRMED.** Neither consumer calls or references `recordHit`; both record
   independently through the port, so Batch 3's removal of the hidden `this.store.recordHit(memory.id)`
   (`memory-curator/src/lib/memory-search.service.ts:360`) changes nothing for them. Note the inverse interim
   fact in Minor 4.
6. **Hexagonal rule — CONFIRMED.** `memory-prompt-injector.ts:23-28` and `ptah-api-builder.service.ts:29-36`
   import only `@ptah-extension/memory-contracts` (plus vscode-core/platform-core); `memory-namespace.builder.ts:16-22`
   imports memory-contracts and platform-core. No import of `memory-curator` anywhere in the diff. The `code`
   namespace fallback and skill-digest paths were not given the recorder
   (`ptah-api-builder.service.ts:778-785` passes `getMemorySearch` only) — correct per D3.
7. **Specs pin the exclusions — CONFIRMED, one gap.** Injector: short query + zero qualifying hits
   (`memory-prompt-injector.spec.ts:171-189`), session-start roster (`:207-222`), throwing recorder
   (`:191-204`). MCP: exact returned ids (`:109-125`), throwing recorder (`:128-142`), `list` exclusion
   (`:317-331`). The candidate-vs-injected distinction is real only on the prompt path and is pinned there
   (score 0.04 vs 0.05). The gaps are in Minor 3. No TODO/PLACEHOLDER/STUB markers, no empty bodies, no mock data
   standing in for logic in any of the six files.

Verification evidence: `batch-4-report.md:47-109` records the correct 2-project `run-many` headers for test,
typecheck and lint with 0 errors; the report's account of a discarded first timed-out attempt and a corrected
fixture is consistent with the diff. I did not re-run the suites; the finding below about a missing
"failed search records nothing" spec is a coverage gap the green run cannot close.

## Five logic questions

### 1. How does this fail silently?

A recorder implementation that throws (a Batch 3 contract violation, but the whole reason the catch exists) is
logged at warn on the prompt path (`memory-prompt-injector.ts:122-125`) and swallowed with **no log at all** on
the MCP path (`memory-namespace.builder.ts:233-236`). On the MCP surface a faulty recorder permanently stops
use-recording with zero diagnostic signal; retention (Batch 5+) then ages out memories agents actively read,
and nothing in any log explains why. See Moderate 1.

### 2. What user action produces unexpected behaviour?

None found on these paths. A user triggering a session-start roster, corpus priming, `ptah.memory.list`, the
code-namespace fallback or a skill-digest probe generates no recording — verified at
`memory-prompt-injector.ts:173-257, :274-348`, `memory-namespace.builder.ts:251-278`,
`ptah-api-builder.service.ts:778-785`.

### 3. What input data produces a wrong answer rather than an error?

A malformed hit from a contract-violating reader — e.g. `chunkText` not a string — on the prompt path:
`recordUse` has already fired at `memory-prompt-injector.ts:117-118`, then `raw.length` at `:131` throws, the
outer catch (`:147-158`) returns `''`, and the memory is marked used although nothing was injected — the exact
opposite of AC3/D3's "hits actually injected". The MCP path has no equivalent window (the return paths after
recording cannot throw). Low likelihood under the repo's internal-trust rule; Minor 2.

### 4. What happens when a dependency fails?

- `reader.search` throws → injector returns `''` with a warn (`memory-prompt-injector.ts:147-158`); MCP returns
  the error envelope (`memory-namespace.builder.ts:241-248`). Neither records. Correct.
- Recorder throws → both results survive (see Q1 for the observability asymmetry).
- Recorder not registered (every host today, VS Code permanently) → optional injection resolves
  `undefined`/`null`, optional chaining no-ops. Correct.

### 5. What is missing that the requirements never mentioned?

A "failed search records nothing" spec on either surface, and a corpus-priming exclusion spec. The plan's
verification seam (`implementation-plan.md:416-418`) lists only the covered cases, so this is a gap in the plan
carried into the specs — Minor 3. Also nothing records until Batch 3 registers the token — an expected
sequencing consequence worth stating plainly — Minor 4.

## Failure modes

### F1 — Faulty recorder silently swallowed on the MCP surface

- Trigger: any `recordUse` implementation that throws despite the port contract.
- Symptom: MCP search uses stop being recorded; no error, no log line, search results look normal.
- Evidence: `memory-namespace.builder.ts:233-236` (bare `catch {` with an explanatory comment but no logging),
  against the injector's logged equivalent `memory-prompt-injector.ts:122-125`.
- Current handling: result preserved (correct); failure invisible (not).
- Recommendation: bind the error and log at warn — through a `getLogger?` dep or by moving the recording into a
  logged wrapper — matching the injector, and satisfying the repo's `catch (error: unknown)` standard.

### F2 — Recorded as used but never injected (record-before-build window)

- Trigger: prompt-path hit whose `chunkText`/`subject` shape makes the line rendering at
  `memory-prompt-injector.ts:127-138` throw after the recording at `:117-126` already ran.
- Symptom: `last_used_at`/tier change on a memory whose content never reached the model.
- Evidence: `memory-prompt-injector.ts:117-126` records; `:131` (`raw.length`) is the first post-recording
  fallible access; outer catch `:147-158` returns `''`.
- Current handling: outer catch degrades the prompt correctly; the recording is not rolled back.
- Recommendation: build the block string first, then record just before the `return` — the recording then
  covers exactly the delivered block. Low priority under the internal-trust rule.

### F3 — Failed-search non-recording is unpinned (regression window)

- Trigger: a future edit hoists `recordUse` above the `reader.search` try or into a `finally`.
- Symptom: failed searches start counting as uses; every spec still passes.
- Evidence: `memory-namespace.builder.spec.ts` has no "reader throws → `recordUse` not called" case;
  `memory-prompt-injector.spec.ts` has none for the reader-throw path either. `buildCorpusBlock` exclusion
  (code-verified at `memory-prompt-injector.ts:274-348`) is likewise unpinned.
- Current handling: none — coverage gap only.
- Recommendation: add two negative specs (MCP reader throws; injector reader throws) and one corpus-priming
  exclusion spec.

### F4 — Recording inert until Batch 3; hidden `recordHit` still active meanwhile

- Trigger: shipping Batch 4 alone (current tree state).
- Symptom: none visible — both new recording sites resolve `null`/`undefined` on every host (no DI registration
  exists yet), while `memory-search.service.ts:360` still bumps `hits`/`last_used_at` inside every
  fresh (uncached) search for both the prompt and MCP paths.
- Evidence: repo grep — `MEMORY_USAGE_RECORDER` consumed only at
  `memory-prompt-injector.ts:95` and `ptah-api-builder.service.ts:395`, registered nowhere;
  `memory-curator/src/lib/memory-search.service.ts:360` (`this.store.recordHit(memory.id)`).
- Current handling: by design — Wave 2 runs Batches 3 and 4 in parallel and Batch 3 registers the token and
  removes `recordHit` in the same commit (`batches.md:394-405`).
- Recommendation: none for Batch 4; the consumers correctly do not depend on `recordHit` staying or going.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **Moderate — F1**: silent swallow of a throwing recorder on the MCP path,
   `memory-namespace.builder.ts:233-236`; inconsistent with the injector's logged handling and invisible in
   production logs. A faulty Batch 3 recorder would silently stop all MCP use-recording.
2. **Minor — F2**: recording precedes block construction on the prompt path,
   `memory-prompt-injector.ts:117-138`, so a rendering throw after recording marks a memory used without
   injecting it.
3. **Minor — F3**: no negative spec for the failed-search paths (either surface) and no corpus-priming
   exclusion spec; the D3 exclusions that ARE covered (roster, list, short query, zero hits, score filter) are
   well pinned.
4. **Minor — F4**: until Batch 3 registers `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER`, both recording sites
   are no-ops on every host and the legacy hidden `recordHit` remains the only use signal. Expected sequencing,
   stated so nobody mistakes Batch 4 alone for a behaviour change.

## Data flow

Prompt path: `buildBlock(query)` → short-query guard (`:108`) → `reader.search(query, 5, root)` (`:110-114`) →
`MIN_SCORE` filter (`:115`) → zero-hit early return (`:116`) → **record exact hit ids, isolated**
(`:117-126`) → block lines (`:127-138`) → return block (`:139-146`) → outer catch returns `''`
(`:147-158`). OK, with the F2 window between record and return.

MCP path: `search()` → no-reader envelope, no recording (`:211-218`) → scope resolution (`:220-225`) →
`reader.search` (`:228`) → **record exact returned ids, isolated** (`:229-236`) → scope-decorated return
(`:237-240`) → outer catch envelope, no recording (`:241-248`). OK.

Wiring: `PtahAPIBuilder` optional inject (`:395-398`) → `getMemoryUsageRecorder` in the memory namespace bag
(`:766`) → optional dep in `MemoryNamespaceDependencies` (`:27`) → optional-chained call (`:230`).
VS Code / unregistered hosts: `undefined` end to end, no-ops. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| 4.1: recorder injected optionally, after workspace, before corpus | COMPLETE | — |
| 4.1: `buildBlock` records exactly post-`MIN_SCORE` ids, non-empty only | COMPLETE | Minor 2 window |
| 4.1: short query / zero hits record nothing | COMPLETE | — |
| 4.1: throwing recorder does not change the block | COMPLETE | — |
| 4.1: `buildSessionStartBlock` never records | COMPLETE | — |
| 4.1: `null` recorder works; spec `new` site updated | COMPLETE | — |
| 4.2: recorder injected beside `memorySearch`, passed via getter | COMPLETE | — |
| 4.2: successful search records exactly returned ids | COMPLETE | — |
| 4.2: `list` does not record | COMPLETE | — |
| 4.2: missing recorder (VS Code) is a no-op | COMPLETE | — |
| 4.2: throwing recorder does not fail the search | COMPLETE | Moderate 1 observability |
| D3: code namespace / skill digest unchanged | COMPLETE | — |
| Hexagonal: memory-contracts only, no memory-curator | COMPLETE | — |
| Plan verification seam specs (`implementation-plan.md:416-418`) | COMPLETE | Minor 3 additions |

Implicit requirements not addressed: none beyond Minor 3.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Short query (`< 8` chars) | YES | `:108` early return, pre-search | — |
| Zero qualifying hits | YES | `:116` early return, pre-recording | — |
| Score exactly at `MIN_SCORE` (0.05) | YES | `>=` filter; spec-pinned (`spec.ts:153`) | — |
| Reader throws (both surfaces) | YES | outer catch → `''` / error envelope | not spec-pinned (F3) |
| Recorder throws | YES | inner catch, result preserved | MCP path silent (F1) |
| Recorder unregistered (VS Code) | YES | tsyringe `isOptional` + optional chaining | — |
| Empty hit list from a successful search | YES | `recordUse([])` called; port contract makes it a no-op | — |
| Duplicate `memoryId`s in one hit list | YES | passed through; Batch 3 dedupes per port contract | — |
| `no_workspace` fallback branch | YES | recording precedes both return branches | — |
| Malformed hit shape on prompt path | PARTIAL | outer catch degrades the block | memory already recorded (F2) |
| Other `buildMemoryNamespace` consumers | YES | dep is optional in the interface | — |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a faulty Batch 3 recorder implementation will fail invisibly on the MCP surface, because the catch
  at `memory-namespace.builder.ts:233-236` logs nothing.
- What a robust implementation would add: a logged catch on the MCP recording path (parity with the injector);
  the record call moved after block construction on the prompt path; negative specs for the failed-search and
  corpus-priming paths.