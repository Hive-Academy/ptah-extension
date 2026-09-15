# Code Logic Review — `TASK_2026_443_40ec` — Batch 2

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 2        |
| Failure modes found | 0        |

Scope reviewed: `memory-usage-recorder.port.ts` (new), `tokens.ts`, `index.ts`, `memory-contracts/CLAUDE.md`, `file-settings-keys.ts`, `file-settings-keys.spec.ts`, plus `implementation-plan.md:352-359, 564-571, 655-660`, `batches.md` Tasks 2.1/2.2 and Deviation 1, and `batch-2-report.md`. The full `git diff HEAD` for both libs was read; the persistence-sqlite changes in the same tree are out of scope and were excluded.

## Confirmation points

1. **Port signature and contract — CONFIRMED.** `recordUse(memoryIds: readonly string[]): void` at `memory-usage-recorder.port.ts:8` matches `implementation-plan.md:357` verbatim. The doc comment (:1-6) states never-throw, empty/unknown-ids no-op, and archival-use-restores-recall — matching plan :357-358 and :354. The restore clause matches the AC definition of "used" (plan :354).
2. **Token — CONFIRMED.** `MEMORY_USAGE_RECORDER: Symbol.for('PtahMemoryUsageRecorder')` at `tokens.ts:4`. A repo-wide grep for `PtahMemoryUsageRecorder` returns only this line and task-folder prose — no collision with any other `Symbol.for` key anywhere in `libs/` or `apps/`.
3. **Zero-dep, type-only, no null implementation — CONFIRMED.** The port file has no imports; `tokens.ts` has none. The barrel export is `export type { IMemoryUsageRecorder }` (`index.ts:9`). `null-implementations.ts` is untouched by the diff (no `NullMemoryUsageRecorder` added), per the plan's "consumers inject `isOptional`" decision (plan :101, batches.md Task 2.1 quality requirements).
4. **Four keys and defaults — CONFIRMED.** Keys at `file-settings-keys.ts:340-343`, immediately after the `memory.retention.*` block (`:336-339`); defaults at `:603-606`, immediately after the retention defaults (`:599-602`). Values are exactly `true / 30 / 60 / 25000`. All four sit in `FILE_BASED_SETTINGS_KEYS`, so `isFileBasedSettingKey` (:731-732) routes them by the first membership check — no pattern change needed. The spec block at `file-settings-keys.spec.ts:174-190` pins static membership, `isFileBasedSettingKey` routing, and each exact default via `it.each` — all three assertions per key, no skips.
5. **No `libs/shared` edit — CONFIRMED.** `git status --porcelain -- libs/shared` is empty; the batch diff stat is exactly the five permitted files (31 insertions, 2 deletions). Deviation 1 (batches.md:51-55) is honoured.
6. **No test/lint target for memory-contracts — ACCEPTED, hides nothing.** The lib contains only types and token constants; there is no runtime behaviour to test. Typecheck compiles the new export and token (`batch-2-report.md:73-87`, 2-project header observed). The one thing no spec machine-checks is the token literal itself — see Minor finding 1.
7. **Mis-read risks.** None of blocking severity. The signature is synchronous `void`, not `Promise`, so an implementer cannot accidentally declare it async without breaking `MemoryStore implements IMemoryUsageRecorder` at Batch 3 typecheck. See Minor finding 2 for the one documented-semantics gap a consumer could mis-read.

## Five logic questions

### 1. How does this fail silently?

The known silent-failure mode of this file — an unrouted settings key drops the WRITE with no error while the read falls through to the default and looks correct (`file-settings-keys.ts:284-291`, `:356-361` document it) — is closed for these four keys: each is in the static Set and each default is pinned by the spec. For the port itself there is no runtime path to fail yet: it is a type and a symbol. A `Symbol.for` key typo would surface as a DI resolution failure in Batch 3's `register.spec.ts` (batches.md Task 3.2 acceptance), not silently — but only when that batch lands.

### 2. What user action produces unexpected behaviour?

None from this batch. A user who edits `memory.lifecycle.*` in `~/.ptah/settings.json` gets the value persisted on every host (file routing), but nothing reads the keys until Batch 5's `memory-lifecycle-config.ts` exists — expected, per the wave plan.

### 3. What input data produces a wrong answer?

None reachable. The port takes no input at runtime yet; the settings tables are static literals and the spec pins their exact values.

### 4. What happens when a dependency fails?

No dependency exists. The port file and tokens file import nothing, so `memory-contracts` keeps its zero-dep guarantee (CLAUDE.md:42, "Dependencies: none").

### 5. What is missing that the requirements never mentioned?

Nothing material. Deliberate omissions, correctly deferred: duplicate-id dedupe and the 200-id cap are implementation semantics assigned to Task 3.2 (batches.md:172, :340); range clamps belong to the Batch 5 config reader (batches.md Task 5.3). The port doc correctly does not promise them.

## Findings

### Minor 1 — No spec pins the token literal; a typo'd `Symbol.for` key is unguarded until Batch 3

- File: `libs/backend/memory-contracts/src/lib/tokens.ts:4`
- Scenario: the key string `PtahMemoryUsageRecorder` is typed by hand. `wizard-seed-noop.spec.ts:41-42` shows this repo mocks tokens by `Symbol.for` literal, not by import, so a one-character typo in either place would intern a different symbol and DI resolution would fail — but nothing in memory-contracts would notice, because the lib has no tokens spec and the Task 2.1 acceptance ("if the lib has a tokens spec", batches.md:260) was conditional and did not apply.
- Impact: low. The failure is loud (resolution throws) and lands in Batch 3's `register.spec.ts` assertion `isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER)`, which is already planned.
- Recommendation: none required for this batch. Batch 3's planned `register.spec.ts` assertion covers it; if that assertion is ever dropped, add a literal-pinning spec then.

### Minor 2 — Port doc omits duplicate-id and size semantics; a consumer reading only the port could assume unbounded recording

- File: `libs/backend/memory-contracts/src/lib/memory-usage-recorder.port.ts:4-5`
- Scenario: the doc promises empty/unknown ids are a no-op but says nothing about duplicates or large lists. Batch 4's planned call `recordUse(hits.map((h) => h.memoryId))` (batches.md Task 4.1) could pass a list longer than 200; the implementation (Task 3.2) caps at 200. A consumer reading only the port would expect every id recorded.
- Impact: low. The cap is a plan-mandated implementation detail (batches.md:172, :340) and its behaviour is pinned by Task 3.2's spec; the plan itself scopes the port doc to never-throw/no-op/restore (plan :357-358), which this batch matches exactly.
- Recommendation: when Task 3.2 lands, add one doc sentence to the port stating that implementations may dedupe and bound the batch — no source change needed now.

## Data flow

1. `recordUse(ids)` call (future, Batch 3/4) → `IMemoryUsageRecorder` type boundary — OK, sync `void`, never-throw documented.
2. DI resolution via `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` — OK, globally interned `Symbol.for`, no collision (grep-verified).
3. `memory.lifecycle.*` write → `isFileBasedSettingKey` → static Set membership — OK, all four keys present, so no write-direction silent drop.
4. `memory.lifecycle.*` read with no user value → `FILE_BASED_SETTINGS_DEFAULTS` — OK, all four defaults present and spec-pinned.
5. Spec guard: `file-settings-keys.spec.ts:174-190` — OK, fails (never skips) on any missing key, route, or default value.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Task 2.1: port with exact signature and behavioural doc | COMPLETE | none |
| Task 2.1: token `Symbol.for('PtahMemoryUsageRecorder')` | COMPLETE | literal not spec-pinned (Minor 1) |
| Task 2.1: type-only barrel export, zero-dep, no null impl | COMPLETE | none |
| Task 2.1: CLAUDE.md lists port and token | COMPLETE | none |
| Task 2.2: four keys beside `memory.retention.*`, routed | COMPLETE | none |
| Task 2.2: defaults true/30/60/25000 | COMPLETE | none |
| Task 2.2: spec pins membership, routing, defaults | COMPLETE | none |
| Deviation 1: no `libs/shared` edit | COMPLETE | none |

Implicit requirements not addressed: none. No stubs, placeholders, empty bodies, mock data, or skip-instead-of-fail specs were found anywhere in the diff.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Empty id list | YES (documented) | Port doc :4 — no-op | none |
| Unknown id | YES (documented) | Port doc :4 — no-op | none |
| Archival memory used | YES (documented) | Port doc :5 — restores to recall | enforcement is Task 3.2 |
| Duplicate ids / > 200 ids | DEFERRED | Task 3.2 (batches.md:172) | Minor 2 |
| Settings key unrouted (write-direction silent drop) | YES | Keys in the Set; spec pins routing | none |
| Hosts without memory | YES (by design) | Optional injection, no null impl added | per plan :101 |

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: the token literal is hand-typed with no machine guard until Batch 3's `register.spec.ts` lands; the failure mode is loud, not silent.
- What a robust implementation would add: a literal-pinning assertion for the new token once a spec-bearing lib owns it, and a doc sentence on dedupe/cap semantics when Task 3.2 lands.