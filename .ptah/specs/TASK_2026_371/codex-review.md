# Review gate — TASK_2026_371

**Task:** Resumed session drops its terminal `turn_state`, so the UI spinner never
clears; plus the monaco-vim anonymous-define defect.
**Status at gate:** `in_review`.
**Commits carrying the work:** `386fe012b` (D1 + D2), `125f6562f` (round 2),
`5d78602ed` (the rest of round 2, committed under another task's message).
**Independent reviewer:** Codex CLI, read-only, agent `39d027f0`, exit 0.
Every claim below was re-opened at the file and line named before being carried
forward.

---

## Acceptance criteria

Extracted from `task.md` and `context.md` in
`D:\projects\ptah-extension\.ptah\specs\TASK_2026_371\`.

| #   | Criterion                                                                                                              | Verdict                | Evidence                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| AC1 | Backend revision numbering is monotonic per session id across `clear()`                                                | PASS with a named hole | `session-turn-state.registry.ts:361` (`ensure` seeds from floor), `:374-386` (`commit`), `:396-404` (`noteFloor`)    |
| AC2 | Clean-exit teardown clears the record but keeps the floor; its guard still correct                                     | PASS                   | `chat-stream-broadcaster.service.ts:410-415`; `session-turn-state.registry.ts:359-361` (`clear` deletes only record) |
| AC3 | Frontend guard not loosened in a way that reopens the TASK_2026_360 replay window                                      | PARTIAL — see below    | `tab-manager.service.ts:1318` (non-terminal at/below `last` still rejected), `:1324` (terminal heal)                 |
| AC4 | End to end, the resumed terminal `idle` is accepted and clears `status: 'streaming'`                                   | PASS                   | `result-message.transformer.ts` → `registry.settleTurn` → `chat-stream-broadcaster.service.ts:155-166` → `turn-state-applier.service.ts:87-138` → `tab-manager.service.ts:1186-1190` |
| AC5 | D2: monaco-vim no longer takes the anonymous-define branch and the module handle is obtained                           | PASS (historical)      | `386fe012b:libs/frontend/editor/src/lib/services/vim-mode.service.ts` — `suppressAmdDefine()`; code since deleted    |
| AC6 | D2: a load failure is detected, not silently treated as success, and the retry is bounded                              | PASS (historical)      | same commit — `markLoadFailed()` on `onerror`, on sync inject failure, and on `onload` without `window.MonacoVim`    |
| AC7 | Tests exist that fail against the pre-change code, for both defects                                                    | PASS                   | `session-turn-state.registry.spec.ts:505` expects `[1,2,3,4,5]` (old code gave `[1,2,1,2,1]`); `chat-stream-broadcaster.service.spec.ts:823-852` with an explicit non-vacuity assertion at `:836` |
| AC8 | Prior review findings F1/F2/F3 fixed, honestly deferred, or ignored                                                    | PARTIAL                | F1 comment corrected `session-turn-state.registry.ts:96-127`; F3 pinned `session-turn-state.registry.spec.ts:546`, `:583`; F2 filed `.ptah/specs/TASK_2026_374/task.md` — but the review doc still presents all three as open |

**Test runs (mine, this gate):**
`npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/chat-state @ptah-extension/chat-streaming`
→ 86 suites, 1439 passed, exit 0.
`npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/chat`
→ exit 0.

---

## Codex raw verdict

`VERDICT: NEEDS_WORK`, with four blockers:

1. AC1's central promise is still false — floor eviction permits an
   already-issued per-session revision to be reissued.
2. The compensating frontend terminal heal accepts stale/out-of-order terminal
   chunks and can idle a genuinely live streaming tab; acknowledged in a comment
   but with no regression test.
3. The task's review record does not reflect how F1–F3 were resolved or deferred.
4. Commit `125f6562f` claims implementation and verification work absent from
   that commit.

Codex passed AC2, AC4, AC5, AC6, AC7 and marked AC1 partial, AC3 fail, AC8 partial.

---

## My adjudication

**Codex blocker 1 — confirmed as fact, rejected as a blocker.**
The claim is literally true. `noteFloor` evicts the least-recently-written floor
at `session-turn-state.registry.ts:396-404`, and the spec itself pins the
consequence: after `REVISION_FLOOR_MAP_LIMIT + 1` sessions,
`registry.markGenerating('session-0')` returns `1` again
(`session-turn-state.registry.spec.ts:538`). So the invariant is not total.
But this is not hidden. It is the exact residue the prior review raised as F1,
it is now stated accurately and at length in the code
(`session-turn-state.registry.ts:96-127`, including "So eviction is NOT free"),
and the user-visible symptom is closed by the terminal heal. A documented,
tested, mitigated residual with a filed coupling to TASK_2026_374 is not a
reason to hold a bugfix.

**Codex blocker 2 — confirmed as fact, downgraded to a residual.**
The stale-terminal path is real and reachable: two broadcast loops can live under
one session id (the broadcaster's own `recordReplaced` branch exists for that
race, `chat-stream-broadcaster.service.ts:395`). But the implementation names the
cost explicitly and argues the trade, at `tab-manager.service.ts:1269-1276`:
"a genuinely late duplicate terminal event … can idle a streaming tab early; the
live turn's own terminal event then corrects it. A permanently stuck tab that
needs an app restart is strictly worse." Codex is right that no test pins that
negative case; that is a coverage gap on a deliberately accepted behaviour, not a
defect. Worth a follow-up, not a gate.

Codex's AC3 "FAIL" also overstates. The replay window TASK_2026_360 review F1
closed is the **non-terminal** one, and it is still closed —
`tab-manager.service.ts:1318` rejects a `generating` at or below `last`, and the
unordered probe path is gated separately: `SessionLivenessReconcilerService` is
the only production caller passing `{ ordered: false }`
(`session-liveness-reconciler.service.ts:68-72`), and `TurnStateApplier` runs the
strict check before any side effect (`turn-state-applier.service.ts:94-113`). I
also checked Codex's own worry that `applyTurnState`'s internal re-check defaults
`allowTerminalHeal` to `true` and could bypass the applier: it cannot.
`turn-state-applier.service.ts:138` is the only production caller of
`TabManagerService.applyTurnState`, and it is reached only for events the strict
check already accepted.

**Codex blocker 3 — confirmed, and it is the one real blocker.** See below.

**Codex blocker 4 — confirmed, but unactionable.** I verified independently:
`git show --stat 125f6562f` lists exactly three files
(`code-logic-review-claude-cli.md`, `libs/backend/agent-sdk/CLAUDE.md`,
`libs/frontend/chat-state/src/lib/tab-manager.service.ts`), while its message
claims the LRU pins, the `ordered` flag, the reconciler change and the filing of
TASK_2026_374 — all of which actually landed in `5d78602ed`, a commit whose
subject is an unrelated compaction fix. `git log -S allowTerminalHeal` and
`git log -S "coincidence and NOT a justification"` both point at `5d78602ed`.
Bad commit hygiene, already in history, not fixable without a rewrite, and it
does not change what the code does. Recorded, not blocking.

**Blocker Codex missed (mine).** `context.md` records the design decision as
"**Fix the backend, not the guard.** … Loosening `acceptsTurnState` would re-open
the replay window review F1 closed (TASK_2026_360)"
(`.ptah/specs/TASK_2026_371/context.md:66-71`). The shipped work does both: it
fixes the backend **and** adds a heal branch to `acceptsTurnState`
(`tab-manager.service.ts:1319-1324`). That reversal is well argued in the code,
but the task folder still states the superseded decision. Anyone reading the spec
after this task closes is told the opposite of what shipped.

---

## Blockers

### B1 — The task folder's own record contradicts the shipped code and hides the outcome of its review

- `.ptah/specs/TASK_2026_371/context.md:66-71` — "Fix the backend, not the guard
  … Loosening `acceptsTurnState` would re-open the replay window". The shipped
  fix does loosen `acceptsTurnState`, for terminal phases, at
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1319-1324`. The
  decision section was never amended to record why it was reversed.
- `.ptah/specs/TASK_2026_371/code-logic-review-claude-cli.md:9-12` — still reads
  "**Verdict: APPROVE WITH FOLLOW-UP**" and presents F1, F2 and F3 as open, with
  F1 described as "the comment that defends it is false". That comment is no
  longer false: it was rewritten at
  `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:96-127`.
  F3 was pinned at
  `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.spec.ts:546`
  and `:583`. F2 was deferred and filed at
  `.ptah/specs/TASK_2026_374/task.md`. None of that is recorded in the folder.
- `.ptah/specs/TASK_2026_371/` contains no batch report and no closing note for
  round 2, so the folder holds no evidence that round 2 happened at all.

**Why it blocks.** Moving a task to `done` publishes its folder as the account of
what was decided and what was left open. This folder currently misstates the
decision and shows three findings as unresolved when two are fixed and one is
deferred with a filed task. That is cheap to correct — a decision amendment in
`context.md` and a resolution section appended to the review doc — and it is the
only thing standing between this task and an honest `done`.

## Residuals — record, do not block

- **R1.** The per-session revision floor is bounded, so after 256 other sessions
  commit, a quiet session's floor is evicted and its counter restarts
  (`session-turn-state.registry.ts:396-404`, pinned at
  `session-turn-state.registry.spec.ts:527-540`). The stuck-spinner symptom is
  covered by the terminal heal. Coupled to TASK_2026_374 by design.
- **R2.** No regression test pins the acknowledged cost at
  `tab-manager.service.ts:1269-1276`: a late duplicate terminal event arriving
  through the ordinary chunk path behind a newer `generating` will finalize the
  in-flight message and idle the tab early. Deliberate and self-correcting, but
  untested.
- **R3.** D2's implementation and its 276-line spec no longer exist on `main` —
  `05e725865` deleted `libs/frontend/editor` wholesale. D2 is verifiable only
  from `386fe012b`. Not this task's fault; noted so a later reader does not
  conclude D2 was never done.
- **R4.** `125f6562f`'s message describes work that landed in `5d78602ed`.

---

## Final verdict

**NEEDS_WORK — documentation only.**

The code delivers. D1 is fixed at the layer the task chose (a per-session
revision floor that survives `clear`), the residual eviction gap is closed by a
narrowly scoped, ordered-only terminal heal that leaves the non-terminal replay
window shut, D2 was genuinely fixed with a bounded retry and a real failure
signal, the regression tests are non-vacuous, and every suite I ran is green.

What is not done is the record. Fix B1 — amend the decision in `context.md` and
append the F1/F2/F3 outcomes to the review document — and this task is ready for
`done` with R1–R4 carried as notes.
