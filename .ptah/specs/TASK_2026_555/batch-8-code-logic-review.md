# Code Logic Review — `TASK_2026_555` Batch 8 (551 UI read-back, 552 staged tiers, D15)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 4                                    |

Scope reviewed (whole files, plus `git diff` against HEAD for the three batch files):

- `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` (service, full read of the commit pipeline `:1042-1173`)
- `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts` (full diff)
- `.ptah/specs/TASK_2026_551/fix-report.md` section 3 (full diff)
- `git show HEAD:` comparison of every former `dependsOnPrevious` site
- All 13 non-spec UI call sites of the six public save commands

Verification run by the reviewer:

- `npx nx test @ptah-extension/core --testPathPatterns="providers-settings-state.service.spec.ts"`: **77/77 pass** (2.5 s). Bare `npx jest <path>` from the worktree root cannot resolve configs in this Nx monorepo (`Can't find a root directory while resolving a config file path`), so the project target is the working equivalent.
- `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat`: green. The `Promise<void>` → `Promise<boolean>` signature change breaks no consumer.

## Five logic questions

### 1. How does this fail silently?

- A save refused because another save is in flight resolves `false` and writes nothing (`providers-settings-state.service.ts:1055`), and `commit()` keeps describing the in-flight save. No caller reads the boolean, so the user gets no "refused" message — the second click appears to do nothing. The in-flight save's own feedback is the only signal on screen. This shape existed at HEAD (silent `return`), so it is not a regression, but the batch's own doc contract ("the caller must tell the user the request was refused (D3)", `:1046-1047`) is unimplemented on the caller side. See Failure mode 1 and Moderate issue 1.
- `settle()` deliberately swallows the RPC error object for every thrown write and read-back (`:1147-1150`, `:1161-1163`). This is correct here: RPC errors may carry credentials and must not enter UI state; the `unconfirmed`/`unsaved` status plus `refreshFailed` is the intended signal, and the new specs assert no error text reaches `commit()` (spec `:1386-1390`). Not a defect.

### 2. What user action produces unexpected behaviour?

Two saves fired from different controls in quick succession. The second is refused; if the first completes successfully between the refusal and the caller's `commit().status` check, the refused caller can observe `'saved'` belonging to the other request and act on it — clearing a draft (spec-untouched UI code, see Moderate issue 1) or emitting `assignmentSaved` for a write that never ran (`provider-consumer-assignments.component.ts:743-745`). The window is one microtask queue drain; it is narrow, and the shape predates the batch.

### 3. What input data produces a wrong answer?

- A whitespace-only Cursor key (`'   '`) is a deliberate clear, not a save (`:378`, `stored = !!apiKey.trim()`). The spec proves a host that ignores the write reads back as `failed`/`unsaved` (spec `:1374-1379`).
- With `CURSOR_API_KEY` set, a successful clear now reads back against `cursorApiKeyStored` instead of `cursorApiKeyConfigured` (`:380-382`). Under the old comparison the clear read back as a failure while the env var was set; the new `it.each([true, false])` spec (spec `:1369-1373`) covers both. Correct.
- An acknowledged write whose read-back mismatches is `unsaved`, never `saved` (spec `:930-940`). Correct per D15.

### 4. What happens when a dependency fails?

- Write throws → `unconfirmed`, read-back skipped (spec `:891-908`; the host may have persisted — the spec asserts the post-commit refresh still shows the host value).
- Write returns `success:false` → `unsaved`, read-back skipped, and the spec proves the only `agent:getConfig` call left is the post-commit refresh (spec `:909-927`).
- Read-back unreachable (keychain outage) → `unconfirmed`, `refreshFailed: true`, and the orchestration section shows its own read error with Retry — never a stale value and never `saved` (spec `:1380-1390`). This matches the Batch 5 debt note in `batches.md:516-518`.
- Stuck-`'saving'` check: `refreshScopes()` and every section refresh go through `read()` (`:577-583`, `:1193-1217`), which catches internally and never rejects, so `runCommit` cannot be left at `'saving'` by an RPC failure.

### 5. What is missing that the requirements never mentioned?

- The plan and the risk table require the report to list every deliberately changed TASK_2026_534 assertion **by file:line** (`implementation-plan.md:357-358`, `:152`). The three changes are marked in the spec comments but not enumerated in the report (Moderate issue 2).
- Per-request feedback keying: `commit()` is one global signal shared by all commands; the boolean this batch added is the only way a caller can know *which* request the status describes. Batch 17's feedback service must carry that keying, or the refusal contract stays unwired.

## Failure modes

### 1. Refused save attributed to another request's terminal status

- Trigger: command B starts while command A is `'saving'`; A's final microtask chain (ending in `commitState.set('saved')`) is queued when B's continuation runs.
- Symptom: B's caller sees `commit().status === 'saved'`, clears its draft or emits `assignmentSaved`, though B wrote nothing.
- Evidence: `providers-settings-state.service.ts:1055` (refusal, commit untouched); `provider-consumer-assignments.component.ts:741-746` (emits `assignmentSaved` on shared status); `ptah-cli-config.component.ts:188,193,214` (clears edit/key on shared status).
- Current handling: refusal resolves `false` (nothing written, `commit()` still describes A) — the service side is correct; the caller side ignores the boolean.
- Recommendation: in Batch 17, key save feedback to the request (or have callers gate on the returned boolean: `if (await this.state.saveSettings(...) )` before checking `commit()`). Interim guard in the assignments component is the highest-value single fix because of the `assignmentSaved` emit.

### 2. Stage-marker deviation from the plan default

- Trigger: any `SaveOperation` built without `stage`.
- Symptom: none — the operation is independent.
- Evidence: `providers-settings-state.service.ts:155-160` (type comment: "An operation without a stage is independent"), `:1075-1078` (skip logic).
- Current handling: judged **correct**. At HEAD `dependsOnPrevious` existed only inside `connectProvider` (HEAD `:472`, `:475`, `:495`, `:517`); every other `runCommit` caller — `saveCursorCredential`, `saveSettings` via `operations()`, `clearWorkspaceOverride`, `clearScopeOverride`, `activateConnection` — built independent operations. A literal default `'setup'` would have chained unrelated writes inside one `saveSettings` patch (multi-entry `cli` updates, combined `memory`+`judging` patches), changing TASK_2026_534 behaviour the batch was required to keep green unchanged. The deviation preserves HEAD semantics for every existing caller; the staging is applied exactly where 552 needed it.
- Recommendation: record the deviation and this justification in the batch report so the team-leader can accept it against the written plan (`implementation-plan.md:342`).

### 3. Partial failure inside a staged commit

- Trigger: setup write rejected (`auth:setApiKey` → `success:false`).
- Symptom: dependent endpoint, all tiers and activation are skipped and named `unsaved`; status `failed`; nothing else attempted.
- Evidence: `:1075-1078` + `:1090-1093`; spec `:480-503` asserts the three follow-up RPCs are never called.
- Current handling: correct per the plan's skip matrix (`:343-346`).

### 4. Tier conflict inside a staged commit (the 552 fix itself)

- Trigger: first edited tier compare-and-set returns `'conflict'`.
- Symptom: that tier is named in the conflict message and in `unsaved`; the second tier still saves; activation is skipped (`anyFailed`); status `partial` with both tiers visible (`saved` + `unsaved`).
- Evidence: `:1083`, `:1090-1091`; spec `:460-478` asserts the message names the sonnet tier and not the saved opus tier.
- Current handling: correct; this is the 552 acceptance behaviour.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **Moderate — refusal boolean unused; shared `commit()` status can be mis-attributed.** Every UI caller discards the new `Promise<boolean>` and gates on the global `commit().status === 'saved'` (`ptah-cli-config.component.ts:187-256`, `providers-settings.component.ts:468-564`, `provider-consumer-assignments.component.ts:741,780`). In the interleaving of Failure mode 1 the assignments component emits a false `assignmentSaved`. Pre-existing shape; the D3 caller half is Batch 17. Fix: request-scoped feedback in Batch 17, or gate callers on the boolean now.
2. **Moderate — the three deliberately changed 534 assertions are not listed by file:line in the report.** The plan requires the list in the S2a report (`implementation-plan.md:357-358`, risk `:152`). The marks exist only as spec comments at `providers-settings-state.service.spec.ts:874`, `:896`, `:1354`. Fix: enumerate the three sites (old → new expectation) in the batch report / fix-report §3 before the batch is committed. The reviewer's own diff audit: exactly three existing-assertion changes exist, all three are marked, and no other assertion changed — the audit the plan asked for is clean.
3. **Minor — empty-operations commit reports `status: 'saved'` with an empty `saved` list** (`:1115-1121`; `runCommit([])` falls through to `'saved'`). Pre-existing; no current caller sends an empty patch. No action needed; noted so the Batch 10 collaborator spec does not codify it as intended.
4. **Minor — spec title rename `uncertain` → `rejected`** (spec `:1338`) accompanies deliberate change 3 and matches the new semantics; list it with the other three in the report for a complete audit trail.

## Data flow

1. UI command → public method (`saveSettings` `:737`, `connectProvider` `:461`, `activateConnection` `:551`, `saveCursorCredential` `:377`, `clearWorkspaceOverride` `:760`, `clearScopeOverride` `:773`) — OK, all six return `Promise<boolean>`, complete coverage of the `runCommit` callers (verified against HEAD).
2. In-flight check `:1055` (and the pre-validation copies at `:464`, `:554` that protect `commit()` from a blocked overwrite) — OK, nothing written, `commit()` untouched.
3. `commitState 'saving'` → `refreshScopes` → context/allowed gate `:1058-1067` — OK, `blocked` names every field.
4. Per-op skip matrix `:1075-1078` — OK, matches plan `:343-346` (setup chains setup; tier depends on setup only; activation depends on anything).
5. `settle` `:1143-1165` — OK: throw → `unconfirmed`; `'conflict'` → conflict + unsaved; `false` → `unsaved`; acknowledged + context change → `unconfirmed`; read-back mismatch → `unsaved`; read-back throw → `unconfirmed`. Read-back is unreachable for any non-acknowledged write, so `saved` can never be promoted after a failure — D15 holds.
6. Post-loop refresh `:1096` and saved→unconfirmed demotion on context change `:1097-1100` — OK.
7. Status selection `:1115-1121` and message `:1128-1133` — OK: `unconfirmed` outranks everything; conflict fields never enter `saved`.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------------------------ | ---- |
| D15: `false`/`'conflict'` → `unsaved`, read-back skipped | COMPLETE | Spec `:909-927`, `:1351-1359` |
| D15: throw → `unconfirmed`, read-back skipped | COMPLETE | Spec `:874-881`, `:891-908` |
| D15: only acknowledged same-context writes read back; mismatch → `unsaved`; read-back error / workspace change → `unconfirmed` | COMPLETE | `:1143-1165`; spec `:930-940`, `:1380-1390` |
| Never "Saved" after a failed write | COMPLETE | No `saved` push exists on a failed path (data-flow step 5); post-refresh demotion `:1097-1100` |
| 552: setup failure skips later setup + tiers + activation | COMPLETE | Spec `:480-503` |
| 552: tier conflict does not cancel other tiers; activation still skipped | COMPLETE | Spec `:460-478`; message names each tier |
| 552: commit message names each conflicted tier | COMPLETE | `:1130`; spec asserts sonnet named, opus not |
| In-flight refusal: all public save methods return `boolean`, write nothing, `commit()` keeps describing the in-flight save | COMPLETE (service side) | Spec `:1173-1199` covers all seven commands; caller side deferred to Batch 17 (Moderate 1) |
| Three deliberately changed assertions marked and justified | COMPLETE in code, PARTIAL in report | Marks at spec `:874`, `:896`, `:1354`; file:line list missing from the report (Moderate 2) |
| 551: read-back on `cursorApiKeyStored`; clear with and without `CURSOR_API_KEY` | COMPLETE | `:377-383`; spec `:1363-1395` |
| Stage default deviation correct for every existing caller | COMPLETE | Verified against HEAD: no other caller ever chained (Failure mode 2) |

Implicit requirements not addressed: caller-side refusal feedback (D3) — explicitly Batch 17 per `batches.md` Batch 17; the deviation record in the report.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Save refused while saving | YES | `:1055`, `:464`, `:554`; spec `:1173-1199` | Caller feedback deferred (Moderate 1) |
| Whitespace-only Cursor key | YES | `:378`; spec `:1374-1379` | None |
| Clear with `CURSOR_API_KEY` set | YES | `:380-382`; spec `:1369-1373` | None |
| Read-back unreachable | YES | `unconfirmed` + section Retry; spec `:1380-1390` | None |
| Workspace changes mid-commit | YES | Per-op check `:1080`, post-write `:1155`, post-read-back `:1159`, post-refresh demotion `:1097-1100` | None |
| One tier conflicts, another saves | YES | Stage `'tier'` skips only on `setupFailed` | None |
| RPC failure wedges `commit()` at `'saving'` | YES | `read()` never rejects (`:1193-1217`) | None |
| Empty operations array | YES (pre-existing) | Status falls through to `'saved'` with empty lists | Minor 3; unreachable from current callers |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: every caller keys on the shared `commit()` status instead of the new refusal boolean, so a refused save can be attributed another save's `'saved'` — the `assignmentSaved` emit in `provider-consumer-assignments.component.ts:743-745` is the concrete case; the window is one microtask queue drain.
- What a robust implementation would add:
  1. Gate the 13 UI call sites on the returned boolean (or land request-scoped feedback in Batch 17 and verify it there).
  2. Enumerate the three deliberately changed assertions by file:line in the batch report before commit.
  3. Record the stage-default deviation (`independent`, not plan's `'setup'`) and its HEAD-equivalence justification in the batch report.
  4. In the Batch 10 `ProvidersCommitService` spec, pin the full stage/skip matrix now proven by spec `:460-503` so the split cannot silently revert to chaining.