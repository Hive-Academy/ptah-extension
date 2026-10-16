# Code Style Re-review - P2 fix round (Batch 36, commit 8cd5cc212)

Reviewer family: Anthropic (code-style-reviewer). Implementer family: OpenAI (CLI lane codex).
Scope: `git diff 8cd5cc212^..8cd5cc212 -- libs/backend/lane-outcomes` (18 files), read as whole files for
the production files. Read-only; no Nx, Jest or build run. LT-P2-1..LT-P2-14 and every P2-m Minor were not re-opened.
All paths below are relative to `libs/backend/lane-outcomes/src/lib/` unless they start with `index.ts`.

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 7.5/10   |
| Verdict         | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 0        |
| Moderate issues | 3 (new code, small cost; carry to P2c, no second fix round) |
| Minor issues    | 7        |
| Files reviewed  | 12 production + 6 spec/support (diff read in full) |

Score separation: not 9-10 because the new code repeats three small shapes (admission error mapping, a
hand-typed ledger shape beside its Zod schema, `validItems`) that the same batch otherwise removes elsewhere.
Not below 7 because both scoped findings (P2-F2, P2-F7) are met with evidence, no reject-list pattern appears,
there is no boundary, type-safety or wiring regression, and the Zod/logger/audit-marker style follows the
nearest siblings.

## Scope checks (pass/fail)

### P2-F2 - one append rule, named constants, `isSubagentRunId`: MET

- Single rule: `appendEntries` at `write/key-value-outcome-journal.ts:47-65` (capacity test against
  `OUTCOME_JOURNAL_LIMIT`, seq numbering, `droppedAtCapacity` count, per-op `accepted` flags). Callers:
  journal `append` `:156`, pipeline `accept` `write/outcome-write-pipeline.ts:335`, `drain` `:397`,
  `dispose` `:637`. `grep` over `src` finds no other `>= 5000`, `nextSeq + 1` or `droppedAtCapacity + 1`
  outside `appendEntries`.
- Constants `write/outcome-write-pipeline.ts:90-94`: `QUEUE_LIMIT = 1000`, `DRAIN_BATCH = 25`,
  `JOURNAL_RETRY_MS = 250`, `REJECTED_LIMIT = 200`, `DISPOSE_DEADLINE_MS = 2000`. Compared with the parent
  commit (`1000` at old `:154,292`, `25` at `:361`, `250` at `:412`, `200` at `:624-625`, `2000` at `:645`):
  values unchanged. All five are used at their former sites (`:207`, `:355`, `:416`, `:467`, `:609-610`, `:630`).
- `isSubagentRunId` is defined at `subagent-join.ts:12-14` (built on `SUBAGENT_LANE_ID`, the same source as
  `subagentRunId`, so the prefix cannot drift) and used at `outcome-write-pipeline.ts:272`, `:306`, `:564`
  (replacing the three `startsWith('subagent:')` copies). It is not in `index.ts`: the barrel exports only
  `applySubagentJoin, subagentRunId` from that module (`index.ts:58`).

### P2-F7 - documentation present and accurate: MET, with small wording gaps (Minor 1-4)

- Pipeline header `write/outcome-write-pipeline.ts:1-10`; store port JSDoc `store/lane-outcome.store.ts:67-121`
  (every method of the port has one); `di/register.ts:21,24`; `di/start.ts:13`; `di/tokens.ts:2-12`;
  barrel groups `index.ts:1,24,42`. Verified against the code:
  - Header: 24 hours is the hold expiry set in `lane-outcome-recorder.service.ts:175,195`; 500 is `HOLD_LIMIT`
    (`:88`); retry "250 ms to 60 s" is `DELAYS` (`:87`); "lane reports are never held" is the
    `isSubagentRunId` gate (`:272`, `:564`); "validation and constraint failures enter the rejected ledger" is
    `isPermanent` (`:135`) + `reject` (`:581`). `submit` never rejecting for admission matches `accept`
    (`:326-359`), which catches journal failures.
  - `register.ts` JSDoc lists exactly what the function registers (logger, store, pipeline, recorder, reader).
  - Tokens: `SKILL_TELEMETRY_SEAM` / `FAILURE_CLASSIFIER` are optional host-supplied (`register.ts:80,94` use
    `isRegistered`); `LOGGER` is `registerInstance`d by `register.ts:~28`. Accurate.
  - Export names in `index.ts` unchanged: the diff adds three comment lines and nothing else.
- No plan ids, decision numbers, batch or task ids in any added comment (diff `grep` for `TASK_`, `P2-`, `TL-`,
  `Batch`, `decision` on added lines: no hits). No `TODO`/`PLACEHOLDER`/`STUB`/`FIXME`, no `as any`,
  `@ts-ignore`, `@ts-expect-error` or `eslint-disable` on added lines. No empty method bodies; no mock data;
  no logging that replaces behaviour (every new `warn` accompanies a real fallback).

## Five style questions

### 1. What breaks in six months?

`RejectedValueSchema` (`write/outcome-write-pipeline.ts:69-85`) repeats the `kind` union of `OutcomeWriteOp`
as a literal `z.enum` and is declared separately from `interface RejectedValue/RejectedEntry` (`:58-68`). Add a
sixth op kind: `RejectedEntry` still compiles, the first `reject()` writes the new kind, and the next
`readRejected()` (`:190-203`) fails the schema and resets the whole ledger with only a warning. Nothing at
compile time ties the two together (see Moderate 1).

### 2. What would a new team member misread?

- `tokens.ts:12` "Host logger registered by this library" reads as if the library creates the logger; it
  registers the instance the host passes in.
- `start.ts:13` "Registers missing services" suggests per-service gap filling; the code registers everything or
  nothing, keyed on `RECORDER` alone (`start.ts:~19`).
- The pipeline header says an operation "leaves the journal only after the store applies it", but permanent
  rejections also leave it (`outcome-write-pipeline.ts:426-429` increments `processed` after `reject`, and the
  acknowledged entries are then removed at `:442-453`).

### 3. What does this cost to maintain?

Small: three repeated shapes, listed under Moderate. No new abstraction without a second user: `appendEntries`
has four callers; `isSubagentRunId` has three.

### 4. Where is this inconsistent with the repository?

- `key-value-lane-outcome.store.ts:25-30` declares a module-level `SnapshotEnvelopeSchema` and types the parsed
  value with `z.infer` (`:47`). The journal constructor in the same batch builds its envelope schema inline on
  every construction and hand-writes the matching type (`key-value-outcome-journal.ts:86-100`), while its own
  `HeldRunSchema`/`EntrySchema` are module-level (`:26-34`).
- `validItems` is declared twice, with the same signature and body (`store/key-value-lane-outcome.store.ts:34-43`,
  `write/key-value-outcome-journal.ts:36-45`), differing only in the audit-marker text.
- The degradation-audit marker format `// degradation-audit: reported - <reason>` and the logger-injection style
  (`logger` as a required constructor argument, `register.ts:37,41`) match `outcome-write-pipeline.ts:106` and
  the reader service. Consistent.

### 5. What would I have done differently?

Declare `RejectedValueSchema` first and derive `type RejectedValue = z.infer<typeof RejectedValueSchema>` (or at
least `satisfies z.ZodType<RejectedValue>`), reuse one `validItems` from a small lib-internal module, hoist the
journal envelope schema to module level with `z.infer`, and give `submit` one `admissionError(admission)` helper
for the two identical ternaries. Each change removes a place where a later edit can drift without a compile
error. None needs a behaviour change.

## Moderate issues (new code, real but small cost; not a second fix round)

Vocabulary follows the P2 triage: below Serious (no failure today, no data lost today), above a taste item.
Recommended disposition: add to the P2c carry-over list, do not reopen Batch 36.

### Moderate 1 - Rejected-ledger schema duplicates its interface and the op-kind union

- File: `write/outcome-write-pipeline.ts:58-85`
- Problem: hand-written `RejectedEntry`/`RejectedValue` and a separate `RejectedValueSchema` with a literal
  five-value `kind` enum; no `z.infer` or `satisfies` link. The task asked for the schema "next to
  `RejectedValue`", and the placement is right; the missing link is the gap.
- Tradeoff: deriving the type from the schema costs one line and makes a new `OutcomeWriteOp['kind']` fail the
  compile instead of silently resetting the ledger at runtime.
- Recommendation: `satisfies z.ZodType<RejectedValue>` on the schema, or derive the type and key the enum from a
  shared `as const` kind list.

### Moderate 2 - Admission error mapping written twice in `submit`

- File: `write/outcome-write-pipeline.ts:253-261` and `:313-321`
- Problem: identical `admission !== 'accepted'` branches with the same two fixed strings
  (`'outcome journal at capacity'`, `'outcome journal write failed'`). The batch removes this exact kind of
  copy for the append rule, then adds one here.
- Tradeoff: one 6-line helper keeps the two strings, which callers and specs match on, in a single place.
- Recommendation: extract `admissionFailure(admission): OutcomeWriteResult`.

### Moderate 3 - `validItems` copied; journal envelope schema inline and hand-typed

- File: `store/key-value-lane-outcome.store.ts:34-43`, `write/key-value-outcome-journal.ts:36-45`, `:86-100`
- Problem: a second copy of the same helper (two copies only, so the repo's "third use" rule does not yet force
  extraction; recorded because the journal copy already differs in its marker text) and, in the journal, an
  inline schema plus a hand-written `envelope` type that the sibling store avoids with `z.infer`.
- Recommendation: hoist the envelope schema to module level with `z.infer`; extract `validItems` when a third
  caller appears (SQLite `decodeMany` has the same count-and-skip shape).

## Minor issues

1. `index.ts:24` group "Stores and their persistence keys" also holds `KeyValueOutcomeJournal` and the journal
   value types; `index.ts:42` group "Wiring and services used by hosts" also holds `applySubagentJoin`,
   `subagentRunId` and `computeAgentSignals`, which are pure helpers. Names of exports are unchanged, so this is
   labeling only.
2. `store/lane-outcome.store.ts:107` (`holdReport`): "false means a report with that ID is already held" omits
   the `budget-stop` kind, which returns false in all three stores (`in-memory…store.ts:176`,
   `sqlite…store.ts:345`). Likewise `listHeldReports` (`:101`) and `countHeldReports` (`:107`) exclude
   `budget-stop` holds without saying so.
3. `store/lane-outcome.store.ts:115` (`isPersistent`): "True identifies durable storage" - the SQLite store
   returns `connection.isOpen` (`sqlite…store.ts:413`), so true also means open now.
4. `di/start.ts:13` and the pipeline header wording noted in question 2 ("missing services", "leaves the journal
   only after the store applies it").
5. `write/outcome-write-pipeline.ts:87`: `[250, 1000, 5_000, 30000, 60000]` - the one `5000` was rewritten as
   `5_000` (to satisfy the grep) and the neighbours were left bare; and `:366` keeps a bare `100` warn step.
   Use one numeric style, or name the step.
6. `write/pipeline.test-support.ts:~36` `GatedMemoryState` compares against the literal
   `'ptah.laneOutcomes.journal.v1'` instead of the exported `OUTCOME_JOURNAL_KEY`.
7. The pipeline header is attached before the first `import` (`:1-10`), so editors show it as the JSDoc of the
   `IStateStorage` import rather than of `OutcomeWritePipeline`. Moving it onto the class would surface it in
   hover and docs.

## File-by-file

- `write/outcome-write-pipeline.ts` - 7/10, 0 B, 0 S, 2 M(oderate), 3 minor. Constants and `isSubagentRunId`
  correct; header accurate except one clause; duplicated `submit` mapping and ledger schema/type split.
- `write/key-value-outcome-journal.ts` - 7.5/10, 0 B, 0 S, 1 M(oderate). `appendEntries` is pure, small and
  tested (`key-value-outcome-journal.spec.ts` capacity case); Zod validation at the read boundary with a
  marker on each catch; inline envelope schema is the inconsistency.
- `subagent-join.ts` - 9/10. `isSubagentRunId` mirrors `subagentRunId` from one constant; not exported from the
  barrel; spec covers prefix and near-miss (`subagent-join.spec.ts`).
- `store/lane-outcome.store.ts` - 8/10, 2 minor. Port fully documented; a few doc sentences are narrower than
  the code. The `applyOutcomeEffect` deliverables rule is logic, left to the logic review.
- `store/key-value-lane-outcome.store.ts` - 8/10. Module-level schemas, `z.infer`, required logger, counts and
  code only in the warn, marker present; duplicate `validItems` is the only note.
- `store/sqlite-lane-outcome.store.ts` - 8.5/10. Logger required, `decodeMany` strict single-row `decode`
  preserved, one warn per query with a code, marker present; `update` runs inside a synchronous transaction.
- `di/register.ts`, `di/start.ts`, `di/tokens.ts`, `index.ts` - 8.5/10. Comment-only apart from passing `logger`
  to both stores (`register.ts:37,41`); no new token, no registration drift, export names unchanged.
- Specs and `pipeline.test-support.ts` - 8/10. Regression specs sit beside the code they pin; the gating helper
  is test-support only.

## Pattern compliance

| Rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| One append rule used by append/accept/drain/dispose | PASS | `key-value-outcome-journal.ts:47`; callers `:156`, `pipeline:335,397,637` |
| Named constants, values unchanged | PASS | `pipeline:90-94` vs parent `:154,292,361,412,624,645` |
| `isSubagentRunId` in `subagent-join.ts`, not in barrel | PASS | `subagent-join.ts:12`; `index.ts:58` |
| Docs present and accurate, no plan/batch/task ids | PASS (4 wording nits) | see P2-F7 section |
| Export names in `index.ts` unchanged | PASS | diff adds 3 comment lines only |
| Zod schemas at module level, types from `z.infer` | PARTIAL | KV store yes; journal envelope and rejected ledger no |
| Logger injected, no raw logging of row content | PASS | `register.ts:37,41`; warns carry counts/codes |
| `degradation-audit: reported - <reason>` on each new fallback | PASS | `kv-store:35,60`, `journal:41,102`, `pipeline:197,340`, `sqlite:90` |
| No `any`, `@ts-*`, `eslint-disable`, TODO/STUB in added lines | PASS | diff grep clean |
| Module boundaries (no new cross-lib import) | PASS | new imports are intra-lib only; `register.ts` imports unchanged |
| Filename and symbol naming | PASS | kebab-case + role suffix retained; no new files except none in `src` |

## Maintenance debt

- Introduced: three repeated shapes (Moderate 1-3) and seven wording or labeling nits.
- Retired: three copies of the append rule with literal `5000`, three `'subagent:'` literals, bare queue,
  batch, retry, ledger and deadline numbers, undocumented port and DI surface, unvalidated persisted JSON.
- Net: strongly down.

## Verdict

- Recommendation: APPROVED
- Confidence: HIGH on P2-F2 and P2-F7 (checked against old and new source line by line); MEDIUM-HIGH on the
  new-code style (diff read in full, specs skimmed for style only).
- Key concern: the rejected-ledger schema is not tied to the op-kind union (`outcome-write-pipeline.ts:69-85`).
- What a 10/10 version would do differently: derive `RejectedValue` from its schema; one shared `validItems`;
  module-level journal envelope schema; one `admissionFailure` helper; exact doc wording for `holdReport`,
  `listHeldReports`, `isPersistent`, `startLaneOutcomes` and the header clause on rejection; consistent numeric
  literal style in `DELAYS`; the header on the class.

## Decisions

- Moderate items are reported, not escalated to Serious: none loses data or breaks a boundary today, each has a
  one-line mitigation, and the batch plan allows no second fix round. Options: treat as Serious and return
  REVISE; carry to P2c. Evidence: the carry-over rule (TL-35) for findings of this class. Reversible: yes.
