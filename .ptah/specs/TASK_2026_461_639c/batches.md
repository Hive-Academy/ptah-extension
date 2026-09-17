# Batches - TASK_2026_461_639c

Total tasks: 24 | Batches: 9 | Complete: 9/9

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock` (branch
`feat/task-439-phase3-skills-unblock`, base `97239e814`). Below, `W` means that absolute path and `T` means
`W\.ptah\specs\TASK_2026_461_639c`; every lane prompt must expand both to full absolute paths. `$root` means the
main checkout `D:\projects\ptah-extension` (W has no `node_modules`; HANDOFF rule 3).

Requirements source: `../TASK_2026_439_1310/tribunal/verdict.md` section B + `context.md` (no
task-description.md). Plan: `implementation-plan.md` (Gate 2 APPROVED 2026-09-16: D1a D2a D3a D4a D5a D6a, item
4d accepted). Working rules: `../TASK_2026_439_1310/HANDOFF.md` (all 8, binding).

## Execution order and parallelism

```
Wave 1:  Batch 1 (skill-synthesis: manual promote, fake invocation, evidence prefilter, D2 lib side, D3)
         ||  Batch 2 (persistence-sqlite: migration 0045 + ratchets)
Wave 2:  Batch 3 (D2 outside skill-synthesis: platform-core, rpc-handlers, shared, skill-synthesis-ui, e2e)   needs 1
         ||  Batch 4 (skill-synthesis: cleanup store/service/types/integration + 4d gate skip)                 needs 1, 2
Wave 3:  Batch 5 (cleanup DI + cron job in both hosts + namer deletion + CLAUDE.md)                            needs 4
Wave 4:  Batch 6 (REACHABILITY PROOF: real container, real SQLite, fake lane, mutations M1-M5)                 needs 1, 5 (and 3 committed)
Wave 5:  Batch 7 (full verification + prefilter corpus measurement + cleanup byte-copy measurement)            needs all
Wave 6:  Batch 8 (user decisions on the Batch 7 findings: non-MCP tool evidence, keep root-unknown candidates,
         re-verify + re-measure)                                                                               needs 7
Wave 7:  Batch 9 (user decision 3: root-unknown candidates look up <sessionId>.jsonl by id across the
         transcript folders; re-verify + re-measure)                                                           needs 8
```

- Max lanes in flight: 2 (waves 1 and 2), under the cap of 3.
- No batch edits a `project.json`. Do NOT run `npx nx reset` in this worktree at all.
- Commit per batch after an accepting review, with only that batch's files. Never skip hooks. Never push, merge or
  commit to main.
- Parallel batches share one worktree (R-TL5): after both lanes of a wave return, team-leader re-runs each batch's
  commands before either commit.

## Defaults chosen by team-leader (orchestrator: roster binding, judgment elsewhere)

- Implementation executor: codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`; Batch 3 uses
  `role: 'frontend-developer'`, see its rationale). Fallback: the matching subagent. A lane that fails twice is
  dropped and its batch moves to the subagent (context.md).
- Reviewer for every code batch: Ollama Cloud ptah-cli lane
  (`{ ptahCliId: 'pc-85830910-3d81-4248-84c1-4fa52752dd19', modelTier: 'opus', role: 'code-logic-reviewer' }`),
  deliverable `T\code-logic-review-batch-N.md`. Fallback: code-logic-reviewer subagent. Never the codex family.
  Revise cap: 2 rounds.
- Every executor writes `T\batch-N-report.md` (per task: absolute files changed; every command with its
  `Running target <t> for N projects` header line and pass/fail totals; both-binding outputs for SQLite specs;
  fail output + restore output for every named mutation; `degradation-audit:lint` result for skill-synthesis,
  thoth-runtime, cli-engine, persistence-sqlite; how each listed risk was handled). As its LAST step it writes the
  marker `T\batch-N.done` (one line: ISO timestamp + `DONE` or `BLOCKED: <reason>`). Executors never edit
  `batches.md` and never commit.
- Batch 7 measurement (Task 7.3): senior-tester subagent, not a codex lane. It reads outside the worktree
  (`~/.claude/projects`, `~/.ptah/state`, OS temp) under hard safety rules (HANDOFF rule 5); phase 2 made the same
  call (`../TASK_2026_443_40ec/batches.md:40-47`). Updated at the Batch 6 commit: the WHOLE of Batch 7 (Tasks 7.4,
  7.1, 7.2, 7.3) runs on one senior-tester subagent (orchestrator decision; the Ollama lane is out of quota).
- Mutations are NEVER committed: each is applied, run, reverted, and `git diff --stat` after restore is pasted.

## Deviations from the architect's 6-batch grouping (with evidence)

1. **Migration `0045` is split out of the plan's Batch 3 into its own Batch 2, run in Wave 1.** It touches only
   `libs/backend/persistence-sqlite` and depends on nothing in Batch 1. This lets the cleanup batch start as soon as
   Batch 1 lands and keeps each batch one sitting.
2. **Plan Batch 4 (DI + job + namer) is Batch 5; the plan's Batch 3 cleanup work (4b-4d) is Batch 4 and adds NO
   DI token.** `di/register.spec.ts:26-35` fails for any declared-but-unregistered token, so the token, its
   registration and both host registrations land together in Batch 5. Batch 4's specs construct the store and
   service by hand.
3. **Batch 1 carries eleven extra skill-synthesis spec fixtures for D2.** Grep (this worktree) finds
   `eligibilityMinTurns` / `prefilterMinChars` in settings fixtures the plan does not list:
   `gates/cluster-holdout-end-to-end.spec.ts`, `gates/judge-panel.service.spec.ts`,
   `skill-cluster-dedup.service.spec.ts`, `skill-clustering.service.spec.ts`, `skill-curator.service.spec.ts`,
   `skill-enhancer.service.spec.ts`, `skill-invocation-tracker.spec.ts`, `skill-judge.service.spec.ts`,
   `skill-promotion.repropagation.spec.ts` (plus the listed `skill-promotion.service.spec.ts`,
   `skill-synthesis.service.spec.ts`, `prefilter-corpus-measurement.spec.ts`). Several are typed
   `SkillSynthesisSettings` (e.g. `judge-panel.service.spec.ts:207-208`), so removing the fields from `types.ts`
   without them breaks the suite in the Batch 1 commit.
4. **Batch 3 also edits `rpc-handlers/.../skills-synthesis-rpc.handlers.spec.ts:2960,2965`** (fixture not in the
   plan's file list).
5. **Nine ratchet specs, not eight.** `0044_memory_lifecycle.spec.ts:65-67` also asserts the highest version (44,
   multi-line form `toBe(\n 44,\n)`); the plan's `toBe(44)` grep missed it.

## Plan validation

Status: PASSED WITH RISKS

Verification points the plan said to "open and confirm before coding" (team-leader, on disk at `97239e814`):

- **V1 `SqliteConnectionService` temp path — CONFIRMED.** Path is the constructor token
  `PERSISTENCE_TOKENS.SQLITE_DB_PATH` (`sqlite-connection.service.ts:139-141`), not an option. `configure({ factory,
  vecPathResolver, vecPathPlatformResolver, vecPathFallbackResolver })` (`:154-170`) swaps the binding and can null
  the vec resolvers. `openAndMigrate()` (`:194-247`) applies every `MIGRATIONS` entry; with no backup service the
  runner skips the pre-migration backup (`migration-runner.ts:88`). So the proof can bind `SQLITE_DB_PATH` to a temp
  file, register the real service, `configure({ factory: <resolveOpener binding> , vec resolvers: null })`, and let
  `SkillSynthesisService.start()` call `openAndMigrate` (`skill-synthesis.service.ts:321-323`). No hand-applied
  migrations needed. The factory must return a `SqliteDatabase`-compatible handle for both bindings (A1).
- **V2 `DRAIN_TIER_STAGES` contains `prefilter` for `frequent` — CONFIRMED.** `skill-drain.service.ts:400-406`
  `FREQUENT_STAGES` starts with `'prefilter'`; `:426-437`. `archaeology` is nightly (`:409-412`), `judge-panel` /
  `trigger-eval` weekly (`:414-418`), so a frequent drain never claims the chained rows: the proof's "zero
  archaeology / judge-panel / trigger-eval rows for `s-chat`" must be asserted on row EXISTENCE in
  `skill_synthesis_queue`, not on their status.
- **V3 `updateStatus` UPDATE columns — CONFIRMED.** `skill-candidate.store.ts:525-544`: `status`, and for `rejected`
  exactly `rejected_at = ?` (default `Date.now()`) and `rejected_reason = ?`; nothing else (no file, embedding or
  event side effect). `LEGAL_TRANSITIONS.candidate` includes `rejected` (`:163-167`). The cleanup batch UPDATE must
  write the same three columns with `AND status = 'candidate'`.
- **V4 degradation-audit baseline format — CONFIRMED: a per-directory CEILING ratchet**, not an exact count.
  `tools/degradation-audit/check-degradation.ts:58-60` ("may only go down (via --update-baseline) or stay flat; any
  increase over its baseline fails"). Baselines: `libs/backend/skill-synthesis` 6, `cli-engine` 12,
  `persistence-sqlite` 5, `skill-synthesis-ui` 5 (`baseline.json:17,24,32,46`); `thoth-runtime` has no entry (= 0).
  Consequence: deleting the namer's annotated catch (`candidate-namer.service.ts:145`) needs NO baseline edit; do not
  run `--update-baseline` (it rewrites other libs' counts too). Any NEW fail-open catch must carry a marker in its
  leading-comment zone.
- **V5 host token set for the proof container — PARTIALLY CONFIRMED; the plan's list is a minimum, not the set.**
  Non-lib tokens injected across skill-synthesis (grep of `@inject(`): required `TOKENS.LOGGER`,
  `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `VEC_STATUS`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`,
  `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`, `SDK_TOKENS.SDK_JSONL_READER`, `SDK_CURATOR_RATE_LIMIT`,
  `SESSION_END_CALLBACK_REGISTRY`, `USER_LAYER_MIRROR_SERVICE_TOKEN`, and six `SDK_TOKENS.*_REGISTRY` tokens used
  only by `triggers/skill-trigger.service.ts`; optional `INTERNAL_QUERY_SERVICE_TOKEN`, `PERSISTENCE_TOKENS.EMBEDDER`,
  `MEMORY_READER`, `MCP_SERVER_STATUS`, `PROVIDER_AUTH_RESOLVER_TOKEN`, `SKILL_REPROPAGATION_TOKEN`,
  `SPEC_FINDINGS_TOKEN`, `TOKENS.WEBVIEW_MANAGER`, `SESSION_ACTIVITY_REGISTRY_TOKEN`. tsyringe resolves lazily, so
  only classes reachable from `SkillSynthesisService`, `SkillDrainService` and `SkillPromotionService` matter, and an
  OPTIONAL token that IS registered by `registerSkillSynthesisServices` still resolves its whole subgraph. Task 6.1
  therefore resolves the three services first, binds a fake for every token the resolution error names, and records
  the final bound set with one line of justification each. Not a blocker: every missing token is host-supplied and
  fakeable without touching production code.

Other checks:

- Highest migration 44 (`migrations/0044_memory_lifecycle.ts`); `0045` is free.
- Project names from each `project.json`: `@ptah-extension/skill-synthesis`, `persistence-sqlite`, `thoth-runtime`,
  `cli-engine`, `rpc-handlers`, `platform-core`, `shared`, `skill-synthesis-ui`, `webview-e2e-harness` (targets
  `lint,typecheck,e2e` only - no `test`), app `ptah-electron-e2e` (`lint,typecheck`, no `test`).
- `skill-synthesis/tsconfig.lib.json:19-23` already excludes `src/**/*.test-support.ts`, so the optional
  `skill-synthesis.reachability.test-support.ts` needs no tsconfig edit.
- Reach-spec anchors: `thoth-runtime/src/lib/start-thoth-cron.spec.ts:792` `describe('memory retention job')`;
  `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:467` `describe('memory retention job (TASK_2026_440
  reachability)')`. Registration functions: `start-thoth-cron.ts:266` (call `:473`), `cli-engine thoth-runtime.ts:528`
  (call `:330`). Guard shape `container.isRegistered(...)` `start-thoth-cron.ts:273`.
- `gateTarget` at `stage-handlers.service.ts:479-483`; callers `:519`, `:594`, `:720` (three gate handlers). The
  `replay` handler also uses it (no producer), so 4d covers it for free.
- Namer footprint outside the lib: none (grep `CandidateNamer|CANDIDATE_NAM` -> only `src/index.ts`, `di/*`,
  `naming/*`).
- File sizes today: `skill-synthesis.service.ts` 1432, `skill-candidate.store.ts` 1626, `stage-handlers.service.ts`
  879, `skill-promotion.service.ts` 722. Every change here must shrink or hold them; the new cleanup files must stay
  well under 700.

Assumptions:

- A1 — the `resolveOpener()` handle (`queue/queue-db.test-support.ts:98-120`) satisfies `SqliteConnectionService`'s
  `SqliteDatabaseFactory` contract (pragmas, `exec`, `prepare`) under both bindings. Unverified; Task 6.1 checks it
  first and, if `node:sqlite` lacks a member the service uses (e.g. `pragma()`), wraps it in a test-support adapter
  (never a production change) and records why.
- A2 — "schema check" in the verdict = the judge-verdict store gate + SKILL.md frontmatter rendering (plan :138-140).
  Accepted at Gate 2; no Zod check is added.
- A3 — no writer other than `skill-synthesis.service.ts:917-925` sets `skill_invocations.context_id`
  (`skill-invocation-tracker.ts:59-65` omits it). Checked by grep in Task 4.1 and again in Task 7.1 after Batch 1
  deletes the writer (expect zero `contextId` producers).
- A4 — a Zod settings read ignores leftover `eligibilityMinTurns` / `prefilterMinChars` in a user `settings.json`
  (plan :492-494). Task 3.1 adds a schema spec case proving an object with both stale keys parses (stripped), not
  rejected.
- A5 — the newest `ptah.pre-migration-*.sqlite` under `~/.ptah/state` is a static file suitable for a byte copy.
  Task 7.3 records size + mtime before and after.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1 Rejection is terminal; a wrong cleanup predicate loses candidates | HIGH | D4 (a) conservative; Task 4.3 integration pins every branch; Task 7.3 byte-copy measurement before merge; searchable `rejected_reason` |
| R2 Tool evidence is broad (MCP lookups pass) | MEDIUM | Accepted by verdict; Task 7.2 reports tool-only passes |
| R3 Automatic promotion stays impossible (UI text implies otherwise) | LOW | Proof group 4 pins it; note for phase 4/5 in Task 7.1 report |
| R4 Generalization shortcut unreachable after B | LOW | Not touched; Task 7.1 records it for phase 5 context |
| R5 `SkillInvocationTracker` registered, unused | LOW | Not touched (phase 5) |
| R6 Finished one-shot job stays in cron list | LOW | Accepted; Task 5.2 spec pins `skipped: complete` is one state read |
| R7 Transcript read cost on the main thread | MEDIUM | Per-tick caps (200 / 60 s), gates, extractor yield (Task 4.2); Task 7.3 records worst read |
| R8 Merge overlap with phase 4 in `skill-synthesis-tab.component.ts` | LOW | Different hunks; rebase whichever merges second |
| R9 Load flakes (HANDOFF rule 8) | LOW | Re-run with `--parallel=1`; record both runs |
| R-TL1 D2 fixtures outside the plan list break Batch 1 / Batch 3 suites | HIGH | Deviations 3 and 4 |
| R-TL2 Ninth ratchet (`0044` spec) missed | MEDIUM | Deviation 5; Task 2.1 grep for `MIGRATIONS.map` shows every hit reads 45 |
| R-TL3 Proof container token set larger than the plan's list (V5) | MEDIUM | Task 6.1 resolves first, fakes host tokens only, records the set; production DI untouched |
| R-TL4 SQL named params unbound pass under `node:sqlite`, fail on CI `better-sqlite3` | HIGH | XB1: every SQLite spec run under both bindings, outputs pasted |
| R-TL5 Parallel batches share one worktree; mid-edit files fail the other lane's run | LOW | Team-leader re-runs both batches' commands after a wave returns |
| R-TL6 Batch cleanup UPDATE races a user promote/reject between page read and write | MEDIUM | `AND status = 'candidate'` guard; Task 4.1 spec changes a row between read and write |
| R-TL7 `SkillSynthesisService.promote` return type change breaks rpc-handlers typing | LOW | Task 1.1 keeps the `PromotionDecision` shape; Batch 1 typechecks rpc-handlers |
| R-TL8 D3 `write-failed` is a new reason string on the wire | LOW | Wire carries `reason: string` (`skills-synthesis-rpc.handlers.ts:456-460`); Task 1.1 adds it to the `PromotionDecision.reason` union only |
| R-TL9 Measurement touches live DB / snapshot with SQLite, or skips production pragmas | HIGH | Task 7.3 procedure (copy only, non-`ptah` temp name, six pragmas read back, size/mtime proof, temp dir deleted) |

Cross-batch rules:

- **XB1 (both bindings).** Every spec that opens real SQLite passes under `node:sqlite` (the normal `nx`/jest run in
  this checkout) AND under `better-sqlite3` via Electron-as-Node, from `W` in PowerShell:
  ```powershell
  $root = 'D:\projects\ptah-extension'
  $env:ELECTRON_RUN_AS_NODE = '1'
  & "$root\node_modules\.bin\electron.cmd" "$root\node_modules\jest\bin\jest.js" `
    --config <lib>/jest.config.ts --testPathPatterns '"<pattern>"' --runInBand
  ```
  Bind every named and positional parameter on every path. Report both `Tests:` lines. A spec may `it.skip` only when
  NEITHER binding loads.
- **XB2 (degradation audit).** Every new catch that fails open, swallows or returns a sentinel carries
  `// degradation-audit: optional-capability - <reason>` or `// degradation-audit: reported - <reason>` inside its
  leading-comment zone. `npx nx run degradation-audit:lint` exits 0 with every lib at or under its baseline (V4).
  Never run `--update-baseline`.
- **XB3 (run-many).** Always `npx nx run-many -t <target> -p a b c`; paste the `for N projects` header and confirm N.
  Quote any `|` in `--testPathPatterns` as `'"a|b"'`.
- **XB4 (no phase 5).** No change to the tracker, `skill_invocation_events` promotion, the extractor's field names,
  the generalization shortcut, or cross-session clustering.

Edge cases:

- Manual promote on an already `rejected` / `promoted` candidate -> `already-rejected` / status guard, no judge call — Task 1.1
- Manual promote with judge `unscored` -> row stays `candidate` — Task 1.1
- SKILL.md write throws -> `write-failed`, row stays `candidate`, no repropagation, on BOTH paths — Task 1.1
- `promoteBulk` with a mix of ids -> each via `promoteManually` — Task 1.1
- Conversation-only session of any length -> `noWork`, `prefilterRejected` +1, no chained rows — Tasks 1.3, 6.2
- Session below `MIN_ROLE_TURNS_FLOOR` still `tooThin` — Task 1.3
- Threshold edges: `editCount = prefilterMinEdits - 1 / = prefilterMinEdits`; `toolUseCount` likewise — Task 1.3
- Candidate created after the cleanup cutoff never examined — Task 4.3
- Candidate with a degraded verdict kept (`kept_degraded_verdict`) — Tasks 4.2, 4.3
- Candidate with NULL `workspace_root` recovers the root from the `prefilter` queue row — Tasks 4.2, 4.3
- Multiple `sourceSessionIds`: any session with a verdict or evidence keeps it — Task 4.2
- No transcript readable -> reject `backlog-cleanup: transcript unreadable and no verdict` — Tasks 4.2, 4.3
- Row promoted/rejected by the user between page read and batch write -> untouched — Task 4.1
- Crash after a batch commit, before cursor advance -> repeat is a no-op — Tasks 4.1, 4.2
- Wall budget / 200 cap / abort mid-page -> `partial`, next run resumes from cursor — Task 4.2
- Tracker-style invocation (`context_id NULL`) survives the delete — Tasks 4.1, 4.3
- Second run after completion -> `skipped: complete`, no writes — Tasks 4.3, 5.2
- Gate stage row whose candidate is `rejected` -> `skipped` `gate-candidate-rejected`; `promoted` still graded — Task 4.4
- Host without `SKILL_BACKLOG_CLEANUP_SERVICE` registered -> no job, no handler — Task 5.2

---

## Batch 1: skill-synthesis — manual promote path, fake invocation removal, evidence-only prefilter, D2 lib side, D3 — COMPLETE (fdff9b105)

- Commit: `fdff9b105` feat(skill-synthesis): batch 1 - manual promote path, evidence-only prefilter, drop creation invocation (17 files, all under `libs/backend/skill-synthesis`)
- Review: `code-logic-review-batch-1.md` CHANGES_REQUESTED 7/10 (1 major, 2 minor). Revise round 1 (`batch-1-report.md`
  `## Revise round 1`): (1) MAJOR residency-cap demotion committed before the SKILL.md write - weakest resident now
  selected before the write, `setResidency(..., 'dormant')` + `evictedSkillId`/`demotedSlug` + log only after a
  successful write (`skill-promotion.service.ts:334-347`); `write-failed` returns before any residency mutation; specs
  for both modes at the cap; mutation proof 2 fail / restore pass. (2) minor: manual cluster-dedup path pinned by spec.
  (3) minor: non-finite / negative `prefilterMinEdits` / `prefilterMinToolUses` fall back to defaults, spec added.
  Orchestrator read the revised region line by line and accepted without a second lane review.
- Team-leader confirmation before commit: `session-work-evidence|skill-promotion.service.spec|skill-synthesis.service.spec`
  3 suites 108/108 passed; `run-many -t typecheck` skill-synthesis + persistence-sqlite + rpc-handlers "for 3 projects"
  green. Note: `skill-promotion.service.ts` is 768 lines (was 722); growth is the manual pipeline + the revise-round
  deferred-demotion block, accepted.

- Recommended executor: codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (three tasks share `skill-synthesis.service.ts` and its spec)
- Parallel with: Batch 2 (file-disjoint: Batch 2 edits only `libs/backend/persistence-sqlite`)
- Rationale: tightly coupled edits in one service + its spec; one lane keeps them consistent.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `T\code-logic-review-batch-1.md`
- Suggested commit: `feat(skill-synthesis): batch 1 - manual promote path, evidence-only prefilter, drop creation invocation`
- Tasks: 3 | Depends on: none
- Report: `T\batch-1-report.md` | Marker: `T\batch-1.done`

### Task 1.1: Manual promote path + D3 write-failed (Component 1) — COMPLETE

- Files (all under `W\libs\backend\skill-synthesis\src\lib\`):
  - MODIFY `skill-promotion.service.ts` — one private gate pipeline taking `mode: 'automatic' | 'manual'`; mode
    controls ONLY the threshold step (`:211-218`). Public `evaluate(candidateId, settings, nowFn?, origin?)` unchanged
    (mode automatic). New public `promoteManually(candidateId, settings, origin, nowFn?)` (mode manual, `origin`
    required). D3 (a): the SKILL.md write catch (`:293-301`) returns `{promoted:false, reason:'write-failed'}`, row
    stays `candidate`, no status write, no repropagation, with `// degradation-audit: reported - promotion refused;
    decision reason write-failed` in its leading-comment zone. Add `'write-failed'` to the `PromotionDecision` reason
    union (`:82-130`).
  - MODIFY `skill-synthesis.service.ts` — `promote` (`:1213-1223`) and `promoteBulk` (`:1268`) call
    `promotion.promoteManually`; `promote` return type `Promise<PromotionDecision>`; both doc comments say "manual
    path: frequency threshold not applied".
  - MODIFY `skill-promotion.service.spec.ts`, `skill-synthesis.service.spec.ts`
- Plan reference: implementation-plan.md:115-166, 639-643 (D3)
- Pattern to follow: existing gate order in `skill-promotion.service.ts:185-313`; `QueryOrigin` import `:16`
- Quality requirements: no copied gate code (one private pipeline); no boolean flag on public `evaluate`; no new
  injection; file must not grow past its current 722 lines by more than the new method's signature + doc.
- Acceptance:
  - AC1: manual path promotes a `success_count = 0` candidate when judge scores >= `minJudgeScore`.
  - AC2: manual path still returns `duplicate` (active dup), `below-judge-score`, `judge-unscored` (row stays
    `candidate`), `below-replay-confidence`, `already-rejected`; residency cap still runs; `write-failed` on a
    throwing writer (both `evaluate` and `promoteManually`), row stays `candidate`, repropagation not called.
  - AC3: automatic `evaluate` on the same zero-count candidate returns `below-threshold` with zero judge calls.
  - `skill-synthesis.service.spec.ts`: `promote` and `promoteBulk` call `promoteManually`, never `evaluate`.
- Mutations (paste fail + restore): **AC2-mut** force the judge gate to pass inside the manual pipeline ->
  `below-judge-score` case fails; **AC3-mut** delete the threshold step -> `below-threshold` case fails.

### Task 1.2: Delete the creation-time fake invocation (Component 2) — COMPLETE

- Files: MODIFY `skill-synthesis.service.ts` — delete the `recordInvocation` block (`:917-925`) and the `contextId`
  hash (`:892-898`, its only use); keep `workspaceRoot: workspaceRoot || null` (`:915`); rewrite the comment
  `:908-914`. MODIFY `skill-synthesis.service.spec.ts` — delete the now-unused `recordInvocation` mock (`:114-125`);
  assert a new registration makes zero `store.recordInvocation` calls.
- Plan reference: implementation-plan.md:168-194
- Acceptance: AC4 (unit half). Proof half is Task 6.2 (M3).
- Validation notes: A3 — after the edit, `grep -rn "contextId" libs/backend/skill-synthesis/src --include=*.ts`
  shows no production producer passing `contextId` to `recordInvocation`; paste it.

### Task 1.3: Evidence-only prefilter + D2 lib side (Component 3) — COMPLETE

- Files (under `W\libs\backend\skill-synthesis\src\lib\`):
  - CREATE `eligibility\session-work-evidence.ts` — exported pure `hasSessionWorkEvidence(trajectory, thresholds)`,
    `thresholds: Pick<SkillSynthesisSettings, 'prefilterMinEdits' | 'prefilterMinToolUses'>`; doc comment defines
    edit / tool / test evidence and states `bashTestPassed` means a test command RAN. Must NOT name the tail-regex
    success field (`archaeology/regex-demotion.spec.ts` scans production text).
  - CREATE `eligibility\session-work-evidence.spec.ts` — table: each signal alone true, all false, threshold edges.
  - MODIFY `skill-synthesis.service.ts` — `passesPrefilter` (`:1182-1199`) keeps the `MIN_ROLE_TURNS_FLOOR` check
    and calls the predicate; delete `depthOk`; rewrite doc block `:1144-1181`; fix comments `:530-533`, `:687-688`;
    D2: delete `eligibilityMinTurns` / `prefilterMinChars` from `SETTINGS_DEFAULTS` (`:134,139`) and `readSettings`
    (`:1352-1355,1372-1375`).
  - MODIFY `types.ts` — delete the two fields (`:419,429`).
  - MODIFY `skill-synthesis.service.spec.ts` — rewrite `:535-577`: "rejects a long corrective conversation with no
    edits and no tools" (8 turns, 900 chars -> `null`, `prefilterRejected` +1); keep "still rejects a session with
    nothing in it"; delete "rejects a long conversation that is all one-word turns"; keep `:520-533`; add edit-only
    and test-command-only acceptances.
  - MODIFY `prefilter-corpus-measurement.spec.ts` — "old" predicate = phase-2 predicate with depth (inline copy),
    "new" = real `passesPrefilter`; header updated; still opt-in (`PTAH_PREFILTER_CORPUS=1`).
  - MODIFY (Deviation 3, delete the two fixture fields only): `gates\cluster-holdout-end-to-end.spec.ts`,
    `gates\judge-panel.service.spec.ts`, `skill-cluster-dedup.service.spec.ts`, `skill-clustering.service.spec.ts`,
    `skill-curator.service.spec.ts`, `skill-enhancer.service.spec.ts`, `skill-invocation-tracker.spec.ts`,
    `skill-judge.service.spec.ts`, `skill-promotion.repropagation.spec.ts`, `skill-promotion.service.spec.ts`.
- Plan reference: implementation-plan.md:196-250, 634-637 (D2)
- Acceptance: AC5 (unit half), AC6. After the batch,
  `grep -rn "eligibilityMinTurns\|prefilterMinChars\|depthOk" W\libs\backend\skill-synthesis` returns only the opt-in
  corpus harness's inline "old" predicate; paste it.
- Mutation (paste fail + restore): **AC6-mut** invert the tool-evidence comparison in the predicate -> the
  tool-only acceptance case fails.
- Note: `platform-core` still registers the two keys until Batch 3. `readSettings` no longer reads them; confirm
  typecheck stays green (the `get` helper is not key-union typed, else report).

### Batch 1 verification (commands from `W`)

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis` — "for 1 project"
- `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers` — "for 2 projects"
- `npx nx run-many -t lint -p @ptah-extension/skill-synthesis` — "for 1 project"
- `npx nx run degradation-audit:lint` — exit 0; `libs/backend/skill-synthesis` <= 6
- No real-SQLite spec is added in this batch; XB1 not required (state that in the report).
- Every listed file exists with real code; mutations AC2-mut, AC3-mut, AC6-mut pasted fail + restore; reviewer
  accepting verdict.

---

## Batch 2: persistence-sqlite — migration 0045 skill backlog cleanup state — COMPLETE (d72d1493e)

- Commit: `d72d1493e` feat(persistence-sqlite): batch 2 - migration 0045 skill backlog cleanup state (12 files, all under
  `libs/backend/persistence-sqlite/src/lib/migrations`). Committed before Batch 1 (independent).
- Review: `code-logic-review-batch-2.md` APPROVED 8/10 (2 minor). Revise round 1 (before the migration froze): spec
  pins exact `notnull` / `dflt_value` for all 16 non-id columns (mutation `started_at` NOT NULL removed -> fail,
  restore -> pass); migration header comment explains why `version`, `cutoff_created_at`, `started_at` are NOT NULL.
  Both bindings 8/8.
- Team-leader confirmation before commit: `0045_skill_backlog_cleanup` spec 8/8 (node:sqlite); typecheck "for 3 projects" green.
- **Carry-forward to Batch 4 (reviewer cross-batch notes, binding):** (a) the state store must UPDATE the singleton row
  in place, or rebind `version`, `cutoff_created_at` and `started_at` on every full-row write - all three are NOT
  NULL with no default, so an `INSERT OR REPLACE` / upsert that omits them fails. (b) the outcome text column is
  `last_reason`; never write `last_error` (plan :325 example is wrong).

- Recommended executor: codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (one task)
- Parallel with: Batch 1 (file-disjoint)
- Rationale: static DDL + ratchet bumps + one real-SQLite spec in one lib; self-contained prompt.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `T\code-logic-review-batch-2.md`
- Suggested commit: `feat(persistence-sqlite): batch 2 - migration 0045 skill backlog cleanup state`
- Tasks: 1 | Depends on: none
- Report: `T\batch-2-report.md` | Marker: `T\batch-2.done`

### Task 2.1: Migration `0045_skill_backlog_cleanup` + spec + registry + nine ratchets — COMPLETE

- Dir: `W\libs\backend\persistence-sqlite\src\lib\migrations\`
  - CREATE `0045_skill_backlog_cleanup.ts` — `CREATE TABLE IF NOT EXISTS skill_backlog_cleanup_state` with
    `id INTEGER PRIMARY KEY CHECK (id = 1)` and columns `version`, `cutoff_created_at`, `cursor_created_at`,
    `cursor_id`, `started_at`, `finished_at`, `last_run_at`, `last_outcome`, `last_reason` (nullable), counters
    `examined`, `kept_evidence`, `kept_verdict`, `kept_degraded_verdict`, `rejected_no_evidence`,
    `rejected_transcript_unreadable`, `invocations_deleted` (`INTEGER NOT NULL DEFAULT 0`). No CHECK on outcome text,
    no INSERT, no index, no backfill.
  - CREATE `0045_skill_backlog_cleanup.spec.ts` — registry entry (version 45 highest, plain `sql`, no `${`); double
    apply idempotent; columns + defaults present; `INSERT ... id = 2` rejected by CHECK. Real-SQLite opener pattern of
    `0043_memory_retention.spec.ts` (fails, never skips, when no binding loads).
  - MODIFY `index.ts` — append `{ version: 45, name: '0045_skill_backlog_cleanup', sql }`.
  - MODIFY ratchets 44 -> 45 (Deviation 5, nine files): `0028_gateway_conversation_workspace_root.spec.ts:79`,
    `0030_skill_event_metrics.spec.ts:34`, `0038_gateway_message_turn_state.spec.ts:87`,
    `0039_reap_orphaned_queue_rows.spec.ts:61`, `0040_skill_candidate_workspace_root.spec.ts:74`,
    `0041_skill_md_migration_state.spec.ts:58`, `0042_db_integrity_check_state.spec.ts:66`,
    `0043_memory_retention.spec.ts:50`, `0044_memory_lifecycle.spec.ts:65-67`; add a provenance comment
    `// 45 since TASK_2026_461 appended 0045_skill_backlog_cleanup.` following each file's convention.
- Plan reference: implementation-plan.md:259-274
- Pattern to follow: `0043_memory_retention.ts:58-78` + its spec
- Quality requirements: never edit `0044` or earlier migration SQL (append-only); spec binds every parameter (XB1).
- Acceptance: part of AC7-AC9 infrastructure; after the edit
  `grep -rn "MIGRATIONS.map" W\libs\backend\persistence-sqlite\src` shows every ratchet at 45; paste it.
- Mutation (paste fail + restore): remove `CHECK (id = 1)` -> the `id = 2` case fails.

### Batch 2 verification (commands from `W`)

- `npx nx run-many -t test -p @ptah-extension/persistence-sqlite` — "for 1 project"
- `npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite` — 1 project
- `npx nx run-many -t lint -p @ptah-extension/persistence-sqlite` — 1 project
- XB1 better-sqlite3: `--config libs/backend/persistence-sqlite/jest.config.ts --testPathPatterns '"0045_skill_backlog_cleanup|0044_memory_lifecycle|0043_memory_retention"'`
- `npx nx run degradation-audit:lint` — exit 0; `persistence-sqlite` <= 5
- Reviewer accepting verdict.

---

## Batch 3: D2 outside skill-synthesis — dead settings keys removed end to end — COMPLETE (a20cfa1b1)

- Commit: `a20cfa1b1` refactor(skill-synthesis-ui,rpc-handlers,shared,platform-core): batch 3 - drop dead depth settings
  (11 files: platform-core, rpc-handlers, shared, skill-synthesis-ui, webview-e2e-harness, ptah-electron-e2e).
- Review: `code-logic-review-batch-3.md` APPROVED 8/10 (3 minor, no code change needed). Reviewer ran focused specs.
  Carried findings:
  1. `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md:30,35` still documents both removed keys ->
     assigned to Task 5.3 (docs).
  2. `libs/backend/skill-synthesis/CLAUDE.md:57` still says `passesPrefilter` applies `eligibilityMinTurns` ->
     Task 5.3 deletes that clause.
  3. A stale key left in a user's `settings.json` cannot be listed or cleared through `ptah config` ->
     OUT-OF-SCOPE follow-up, no batch.
- Team-leader confirmation before commit: `skills-synthesis-rpc.schema` spec 1 suite 208/208 (includes A4 case);
  `run-many -t typecheck` skill-synthesis + rpc-handlers + platform-core + shared + skill-synthesis-ui "for 5 projects"
  green. Diff scope matched the task file list; no cross-batch file.

- Recommended executor: codex CLI lane (`{ cli: 'codex', role: 'frontend-developer' }`)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential (one task; `shared` removal breaks rpc-handlers and the UI until all land together)
- Parallel with: Batch 4 (file-disjoint: Batch 3 touches no `libs/backend/skill-synthesis` or
  `persistence-sqlite` file). R-TL5 applies: rpc-handlers depends on skill-synthesis, so its typecheck can flake while
  Batch 4 edits; team-leader re-runs after both return.
- Rationale: the only non-trivial edits are an Angular reactive form and template (two fields + labels) and their
  specs; the backend edits are key-list deletions. Roster: frontend-developer for UI work.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `T\code-logic-review-batch-3.md`
- Suggested commit: `refactor(skill-synthesis-ui,rpc-handlers,shared,platform-core): batch 3 - remove dead prefilter depth settings`
- Tasks: 1 | Depends on: Batch 1 (committed)
- Report: `T\batch-3-report.md` | Marker: `T\batch-3.done`

### Task 3.1: Delete `skillSynthesis.eligibilityMinTurns` and `skillSynthesis.prefilterMinChars` (Component 7) — COMPLETE

- Files (absolute under `W`):
  - `libs\backend\platform-core\src\file-settings-keys.ts` (`:230,235,509,514`) + `file-settings-keys.spec.ts` /
    `file-settings-manager.spec.ts` if either names them (grep)
  - `libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.ts` (`:36,41`),
    `skills-synthesis-rpc.schema.spec.ts` (`:82,87`), `skills-synthesis-rpc.handlers.spec.ts` (`:2960,2965`,
    Deviation 4)
  - `libs\shared\src\lib\types\rpc.types.ts` (`:2662,2667`)
  - `libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.ts` (`:161,202` form fields
    and labels) + `.spec.ts` (`:74,79`); `skill-synthesis-tab.component.ts` (`:794,799`) + `.spec.ts` (`:696,701`)
  - `libs\frontend\webview-e2e-harness\src\lib\scenarios\thoth\skills-lane-pickers.e2e.spec.ts`,
    `apps\ptah-electron-e2e\src\specs\thoth\skills.spec.ts` (fixtures naming the keys)
- Plan reference: implementation-plan.md:482-498
- Quality requirements: no dead form control, label, i18n string or DTO field left; OnPush/signal patterns unchanged;
  no layout change beyond removing the two rows.
- Acceptance: A4 — schema spec case: an update payload carrying both stale keys parses without error and the output
  lacks them. After the edit `grep -rn "eligibilityMinTurns\|prefilterMinChars" W\libs W\apps --include=*.ts`
  returns only the opt-in corpus harness from Task 1.3; paste it.

### Batch 3 verification (commands from `W`)

- `npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui` — "for 4 projects" (R9: platform-core bench / rpc-handlers skills-sh flake -> re-run `--parallel=1`, record both)
- `npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui @ptah-extension/skill-synthesis @ptah-extension/webview-e2e-harness ptah-electron-e2e` — "for 7 projects"
- `npx nx run-many -t lint -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui` — "for 4 projects"
- `npx nx run degradation-audit:lint` — exit 0
- No real SQLite; XB1 not required.
- Reviewer accepting verdict.

---

## Batch 4: skill-synthesis — backlog cleanup store, service, types, integration; gate stages skip rejected — COMPLETE (e420f1b5d)

- Commit: `e420f1b5d` feat(skill-synthesis): batch 4 - resumable backlog cleanup and gate skip for rejected (8 files:
  six new under `skill-synthesis/src/lib/cleanup/`, `queue/stage-handlers.service.ts`,
  `skill-synthesis.stage-handlers.spec.ts`). No DI, barrel or migration file touched.
- Review: `code-logic-review-batch-4.md` CHANGES_REQUESTED 7/10 (1 major, 6 minor). Revise round 1
  (`batch-4-report.md` `## Revise round 1`): (1) MAJOR per-candidate catch turned any thrown error (e.g. `SQLITE_BUSY`
  in the verdict lookup) into terminal `reject-unreadable` -> now `deferred-error`: no rejection pushed, cursor still
  advances, report-only `deferredOnError` counter incremented, warning with candidate id (migration 0045 untouched);
  mutation proof restoring the old catch fails the new spec, restore passes. (3) delete loop checks abort + wall budget
  per page and returns resumable `partial`. (4) empty/malformed `sourceSessionIds` warns once with candidate id only.
  (5) abort-between-candidates, wall-budget resume, >200 row cap, between-delete-pages stop specs added. (6) `''`
  workspace root falls back to the prefilter queue row. (7) `failed` report carries committed counters. Orchestrator
  read `skill-backlog-cleanup.service.ts:184-239` and accepted without a second lane review.
- **ACCEPTED RISK (finding 2, orchestrator decision under D4a):** `TrajectoryExtractor` does not distinguish a
  transient read error (`EBUSY`) from a missing transcript (`ENOENT`), so a locked transcript with no verdict is
  rejected `backlog-cleanup: transcript unreadable and no verdict`. Not fixed this phase. **Task 7.3 must report** the
  `rejected_transcript_unreadable` count and, where observable, whether any of those transcripts exist on disk.
- Carry to Batch 5: the job handler surfaces `deferredOnError` in its cron summary (Task 5.2).
- Team-leader confirmation before commit: `skill-backlog-cleanup` specs (store + service + integration) 3 suites 20/20
  under node:sqlite; typecheck "for 5 projects" green (shared run with Batch 3). Diff scope matched; no cross-batch file.

- Recommended executor: codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (store -> service -> integration depend in order; 4d is small and in the same lib)
- Parallel with: Batch 3
- Rationale: new SQL + a gated resumable service + a real-SQLite integration in one lib; design choices (tick
  budget, report union) need one mind.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `T\code-logic-review-batch-4.md`
- Suggested commit: `feat(skill-synthesis): batch 4 - resumable backlog cleanup and gate skip for rejected candidates`
- Tasks: 4 | Depends on: Batch 1, Batch 2 (committed)
- Report: `T\batch-4-report.md` | Marker: `T\batch-4.done`
- Constraint: NO new DI token and no `di/register.ts` / `di/tokens.ts` / `src/index.ts` edit in this batch
  (Deviation 2); services are `@injectable()` classes constructed by hand in specs.
- Constraint (from Batch 2 review, binding): the state store UPDATEs the singleton row in place, or rebinds `version`,
  `cutoff_created_at` and `started_at` (NOT NULL, no default) on every full-row write; the reason column is
  `last_reason`, never `last_error`.

### Task 4.1: `SkillBacklogCleanupStore` + real-SQLite spec — COMPLETE

- Files: CREATE `W\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.store.ts`,
  `skill-backlog-cleanup.store.spec.ts`
- Plan reference: implementation-plan.md:276-291
- Pattern to follow: `queue/skill-queue.store.ts` `inImmediateTransaction` (explicit `BEGIN IMMEDIATE` / `COMMIT` /
  `ROLLBACK` via `exec`; NOT `db.transaction`, which `node:sqlite` lacks, `queue-db.test-support.ts:33-41`);
  `queue/queue-db.test-support.ts` `resolveOpener` / `makeTempDbPath`.
- Responsibilities: read/upsert state row; page `status = 'candidate' AND created_at < @cutoff AND (created_at, id) >
  (@cursorCreatedAt, @cursorId) ORDER BY created_at, id LIMIT @n`; batch reject (<= 100 rows, one transaction,
  `UPDATE ... SET status='rejected', rejected_at=@now, rejected_reason=@reason WHERE id=@id AND status='candidate'` —
  same columns as V3); paged fake-invocation delete `DELETE FROM skill_invocations WHERE rowid IN (SELECT rowid FROM
  skill_invocations WHERE context_id IS NOT NULL LIMIT @n)` returning changes.
- Acceptance: AC8 — paging order and cursor across pages; reject guard leaves a row whose status changed between
  read and write (R-TL6); delete removes only `context_id IS NOT NULL` rows, tracker row survives; rollback on a
  thrown statement leaves the batch unchanged.
- Mutation (paste fail + restore): **AC8-mut** drop `context_id IS NOT NULL` -> tracker-row case fails.
- Validation notes: A3 grep (no third `context_id` writer) pasted in the report.

### Task 4.2: `SkillBacklogCleanupService` + types + stub spec — COMPLETE

- Files: CREATE `W\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts`,
  `skill-backlog-cleanup.types.ts`, `skill-backlog-cleanup.service.spec.ts`
- Plan reference: implementation-plan.md:293-329, 645-651 (D4a)
- Pattern to follow: `memory-curator/src/lib/retention/memory-retention.service.ts:235-236` (boot deferral from a
  construction timestamp); `memory-retention.types.ts:55-82` (report union); drain gate keys
  `queue/skill-drain.service.ts:302-314`.
- Responsibilities: `run({ signal, isOnBattery, now? }): Promise<BacklogCleanupReport>`, never rejects. Gates in
  order, each a `skipped` token: `disabled`, `complete`, `boot-deferred`, `on-battery`, `foreground-active`,
  `aborted`. First run writes `version`, `started_at`, `cutoff_created_at = now`. Per candidate (tick cap 200, wall
  budget 60 s, `signal` + budget checked between candidates): any `SessionVerdictStore.findBySession` row keeps it
  (degraded counted separately); else locate transcript (candidate `workspaceRoot`, else `prefilter` queue row via
  `SkillQueueStore.findBySessionStage` `:671`, whose `transcript_path` is passed) and call
  `TrajectoryExtractor.extract(sessionId, workspaceRoot, MIN_ROLE_TURNS_FLOOR, transcriptPath)` (`:145`); any session
  with `hasSessionWorkEvidence` keeps it; else reject with `backlog-cleanup: no code evidence and no verdict` (>= 1
  transcript read) or `backlog-cleanup: transcript unreadable and no verdict`. Cursor advances after each committed
  batch. After pages are exhausted: paged invocation delete (500/page), then `finished_at`, `last_outcome =
  'completed'`, one `logger.info('[skill-synthesis] backlog cleanup complete', counters)`. No LLM, no enqueue, no
  transcript content logged or persisted.
- XB2: the per-candidate catch carries `// degradation-audit: reported - counted in rejected_transcript_unreadable or
  last_reason`; the whole-run catch returning `failed` carries `reported`.
- Acceptance: AC9 — each gate token; D4a branches; wall budget -> `partial` and the next run resumes from the cursor;
  abort -> `partial`; thrown store -> `failed` with a token, never a rejection.
- Mutation (paste fail + restore): **AC9-mut** remove the wall-budget check -> the `partial` case fails.

### Task 4.3: Real-SQLite cleanup integration spec — COMPLETE

- Files: CREATE `W\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.integration.spec.ts`
- Plan reference: implementation-plan.md:372-384
- Harness: real SQLite with migrations applied through 45 (both bindings, XB1); real `TrajectoryExtractor` over
  fixture JSONL through a fake `JsonlReaderService`; real `SkillCandidateStore`, `SessionVerdictStore`,
  `SkillQueueStore`, `SkillBacklogCleanupStore`.
- Seed: candidate with edit transcript; conversation-only transcript; conversation-only + non-degraded verdict;
  conversation-only + degraded verdict; missing transcript; NULL `workspace_root` resolved via prefilter row; one
  created after cutoff; one tracker-style invocation (`context_id NULL`) + fake ones.
- Acceptance: AC7, AC8 — exact status and `rejected_reason` per row; tracker row survives; fakes gone; state-row
  counters exact; second `run` returns `skipped: complete` and writes nothing.
- Mutation (paste fail + restore): **AC7-mut** delete the batch-reject call in the service -> the conversation-only
  candidate stays `candidate` -> spec fails.

### Task 4.4: Gate stages skip rejected candidates (item 4d) — COMPLETE

- Files: MODIFY `W\libs\backend\skill-synthesis\src\lib\queue\stage-handlers.service.ts` (`gateTarget` `:479-483`,
  callers `:519`, `:594`, `:720`); MODIFY `W\libs\backend\skill-synthesis\src\lib\skill-synthesis.stage-handlers.spec.ts`
- Plan reference: implementation-plan.md:331-340
- Responsibilities: a `rejected` candidate maps to `skipped` with reason `gate-candidate-rejected` (distinct from
  the no-candidate reason) in `judge-panel`, `replay`, `trigger-eval`; `promoted` remains gradeable
  (`gates/trigger-eval.service.ts:497`). Keep the handler file's size flat.
- Acceptance: AC11 — one case per gate stage (rejected -> `skipped` `gate-candidate-rejected`, gate service NOT
  called); one case `promoted` still dispatches.
- Mutation (paste fail + restore): **AC11-mut** remove the status check -> the three rejected cases fail.

### Batch 4 verification (commands from `W`)

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis` — "for 1 project"
- `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers` — "for 2 projects"
- `npx nx run-many -t lint -p @ptah-extension/skill-synthesis` — 1 project
- XB1 better-sqlite3: `--config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-backlog-cleanup"'` (store + service + integration)
- `npx nx run degradation-audit:lint` — exit 0; skill-synthesis <= 6
- Mutations AC7-mut, AC8-mut, AC9-mut, AC11-mut pasted; reviewer accepting verdict.

---

## Batch 5: cleanup DI + cron job in Electron and CLI hosts; delete `CandidateNamerService` — COMPLETE (625b3861c)

- Commit: `625b3861c` feat(skill-synthesis,thoth-runtime,cli-engine,docs): batch 5 - backlog cleanup job, drop namer
  (18 files: skill-synthesis DI/barrel/store + namer deletion, thoth-runtime job + `start-thoth-cron`, cli-engine
  `thoth-runtime`, both lib CLAUDE.md files, `apps/ptah-docs/.../skill-synthesis/settings.md`).
- Review: `code-logic-review-batch-5.md` APPROVED 9/10 (3 minor). The review ran read-only after a machine hold; the
  reviewer disclosed what it verified by reading and what it ran before the hold (focused suites 39/23/89 passed).
- Revise round 1 (`batch-5-report.md` `## Revise round 1`): (1) distinct skip tokens
  `backlog-cleanup-service-unavailable` / `backlog-cleanup-power-monitor-unavailable`, one spec per token;
  (2) `register.spec` singleton case resolves both cleanup tokens twice from the real registration and asserts `toBe`,
  mutation `registerSingleton` -> `register` fails it, restore passes; (3) docs count corrected to 78 (46 named + 4
  lanes x 8 fields) with the method recorded. AC10-mut-E re-proven. Orchestrator accepted the round without a second
  review (minor fixes; the batch was already approved by a reviewer of another family).
- **Executor change:** the initial round ran on a codex CLI lane; revise round 1 ran on a backend-developer SUBAGENT
  because the lane host was at its 5-agent limit with other sessions' agents.
- Team-leader confirmation before commit: no jest/nx run process alive (two idle daemons only); thoth-runtime
  `skill-backlog-cleanup-job|start-thoth-cron` 2 suites 40/40; cli-engine `thoth-runtime.spec` 23/23; skill-synthesis
  `register.spec` 9/9; `run-many -t typecheck` skill-synthesis + thoth-runtime + cli-engine + rpc-handlers "for 4
  projects" green; grep `CandidateNamerService|setDisplayName|nameCandidate` over `libs` and `apps` -> no matches. Diff
  scope matched Tasks 5.1-5.3 plus the three revise fixes. Lane scratch `agent-output-root.md` deleted (untracked).

- Recommended executor: codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (`di/register.ts`, `di/tokens.ts`, `src/index.ts` are shared by both tasks)
- Parallel with: none
- Rationale: cross-lib wiring (skill-synthesis DI -> thoth-runtime -> cli-engine) plus a deletion in the same DI
  files; single executor avoids registry conflicts.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `T\code-logic-review-batch-5.md`
- Suggested commit: `feat(skill-synthesis,thoth-runtime,cli-engine): batch 5 - register backlog cleanup job, delete candidate namer`
- Tasks: 3 | Depends on: Batch 4 (committed)
- Report: `T\batch-5-report.md` | Marker: `T\batch-5.done`

### Task 5.1: DI token + registration for the cleanup store and service — COMPLETE

- Files: MODIFY `W\libs\backend\skill-synthesis\src\lib\di\tokens.ts` (`SKILL_BACKLOG_CLEANUP_STORE`,
  `SKILL_BACKLOG_CLEANUP_SERVICE` as `Symbol.for(...)`), `di\register.ts` (singletons), `di\register.spec.ts` (resolve
  both), `src\index.ts` (export service, types, report union)
- Plan reference: implementation-plan.md:342-358, 389
- Acceptance: `register.spec.ts` green; resolving `SKILL_BACKLOG_CLEANUP_SERVICE` from a registered container yields
  the service.

### Task 5.2: `@ptah/skills-backlog-cleanup` job in both hosts (Component 4e) — COMPLETE

- Files:
  - CREATE `W\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.ts` + `.spec.ts` —
    `SKILL_BACKLOG_CLEANUP_JOB` (`jobId: '@ptah/skills-backlog-cleanup'`, `handlerName: 'skills:backlog-cleanup'`,
    `cronExpr: '41 * * * *'`, `timezone: 'UTC'`) and `createSkillBacklogCleanupHandler(container)`: resolve per run;
    `skipped` -> `{outcome:'skipped', reason}`; `failed` -> throw the reason token only; else counters summary
    `examined N, rejected N, kept N, invocations deleted N, deferred on error N` (carried from Batch 4 revise: the
    report's `deferredOnError` MUST appear in the summary; it is report-only and not persisted). Spec pins it.
  - MODIFY `W\libs\backend\thoth-runtime\src\lib\start-thoth-cron.ts` — `registerSkillBacklogCleanupJob` beside
    `registerMemoryRetentionJob` (`:266`, call `:473`), guarded by
    `container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_SERVICE)` and `handlerRegistry.has`; runs no
    SQL at registration.
  - MODIFY `start-thoth-cron.spec.ts` — new describe beside `:792`: job upserted + handler registered when the token
    is registered; absent when not.
  - MODIFY `W\libs\backend\thoth-runtime\src\index.ts` — export as `MEMORY_RETENTION_JOB` is.
  - MODIFY `W\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts` — same registration beside `:528`, called
    beside `:330`; `thoth-runtime.spec.ts` — describe beside `:467` asserting the same for `activateThoth`.
- Plan reference: implementation-plan.md:342-358, 385-388
- Pattern to follow: `thoth-runtime/src/lib/memory-retention-job.ts` (resolve service, power monitor, foreground
  reader inside one guarded block).
- Constraint: `skill-synthesis` never imports `cron-scheduler`.
- Acceptance: AC10.
- Mutations (paste fail + restore): **AC10-mut-E** remove the `registerSkillBacklogCleanupJob` call in
  `start-thoth-cron.ts` -> Electron spec fails; **AC10-mut-C** remove the call in `cli-engine thoth-runtime.ts` -> CLI
  spec fails.

### Task 5.3: Delete `CandidateNamerService` and `setDisplayName` (Component 5) — COMPLETE

- Files: DELETE `W\libs\backend\skill-synthesis\src\lib\naming\candidate-namer.service.ts`,
  `candidate-namer.service.spec.ts`; MODIFY `di\register.ts` (import `:55`, singleton `:99`, binding `:206-208`),
  `di\tokens.ts` (`:133-134`), `src\index.ts` (`:142-148`), `skill-candidate.store.ts` (delete `setDisplayName`
  `:710-722`; keep `displayName` mapping `:1590`), `skill-candidate.store.spec.ts` (delete `:1644-1668`),
  `W\libs\backend\skill-synthesis\CLAUDE.md` (Public API list, Internal Structure namer line, lane-rule bullet naming
  the namer, namer bullet; add the cleanup job, evidence predicate, manual promote path, removed depth branch and
  fake invocation in the matching sections; carried Batch 3 finding 2: delete the `eligibilityMinTurns` clause in the
  guideline at `CLAUDE.md:57` - "which is where `eligibilityMinTurns` is applied" is false after D2),
  `W\apps\ptah-docs\src\content\docs\skill-synthesis\settings.md` (carried Batch 3 finding 1: delete the
  `skillSynthesis.eligibilityMinTurns` row `:30` and the `skillSynthesis.prefilterMinChars` row `:35`; reword the
  `prefilterMinEdits` / `prefilterMinToolUses` rows if they name the depth path; keep table alignment).
- Plan reference: implementation-plan.md:391-428
- Acceptance: AC12 — `grep -rn "CandidateNamer\|CANDIDATE_DISPLAY_NAME_MAX_CHARS\|CANDIDATE_NAMING_JSON_SCHEMA\|CandidateNaming\|setDisplayName" W\libs W\apps --include=*.ts` returns nothing; `display_name` column, `SkillCandidateRow.displayName` and its readers (`skill-gap-curator.service.ts:726,1039`, `trigger-eval.service.ts:236,791`) untouched. Also update the
  `thoth-runtime/CLAUDE.md` job list if it enumerates jobs.

### Batch 5 verification (commands from `W`)

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine` — "for 3 projects"
- `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers` — "for 4 projects"
- `npx nx run-many -t lint -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine` — "for 3 projects"
- XB1 better-sqlite3 for `skill-candidate.store.spec` (its SQL block changed): `--testPathPatterns '"skill-candidate.store"'`
- `npx nx run degradation-audit:lint` — exit 0; skill-synthesis <= 6, cli-engine <= 12, thoth-runtime 0
- Mutations AC10-mut-E, AC10-mut-C pasted; reviewer accepting verdict.

---

## Batch 6: REACHABILITY PROOF — production trigger -> drain -> prefilter -> manual promote — COMPLETE (83002016f)

- Commit: `83002016f` test(skill-synthesis): batch 6 - reachability proof for manual promote and evidence prefilter
  (2 files: `skill-synthesis.reachability.integration.spec.ts` 336 lines, `skill-synthesis.reachability.test-support.ts`
  176 lines). No production file changed.
- Review: `code-logic-review-batch-6.md` APPROVED 8/10 (0 blocking, 0 serious, 1 moderate, 2 minor).
- **Reviewer-family change:** the Ollama Cloud review lane exited 0 with no deliverable (`429 session usage limit`).
  The review ran on a code-logic-reviewer SUBAGENT (Claude family). The implementer was a codex lane, so the review
  stayed cross-family (HANDOFF rule 7). Recorded in `context.md` 2026-09-16.
- Findings disposition (orchestrator):
  1. MODERATE — `adaptNodeDatabase` (`skill-synthesis.reachability.test-support.ts:41-83`) fabricates `.transaction()`
     and hardcodes `inTransaction` to `false`; unreached by the proof today -> **carried to Batch 7 as Task 7.4**.
  2. MINOR — the report narrates M4 as "candidate length 0". Recorded here: group 3's `arrayContaining` row assertion
     (spec `:288-304`) also catches M4, because the drain marks the unhandled `prefilter` row `skipped` with
     `no handler for stage prefilter` (`queue/skill-drain.service.ts:996-1002`), not `done`. No spec change.
  3. MINOR — `curatorEnabled: false` in the proof settings differs from the production default (`true`). Accepted and
     disclosed: `SkillCuratorService.start` no-ops on `false` and only a 24 h timer is suppressed.
- Executor evidence (`batch-6-report.md`): full skill-synthesis suite 75 passed / 6 skipped suites, 1512 passed / 37
  skipped tests; reachability 5/5 under node:sqlite AND better-sqlite3 (0 skipped); M1-M5 fail + restore with empty
  production `git diff --stat`; degradation-audit skill-synthesis 6 (baseline 6); lint 0 errors, 35 old warnings.
  A1 result: node:sqlite needed the test-only adapter; better-sqlite3 passes through. Final host token set = 10 tokens
  (report `## Final host token set`), including `USER_LAYER_MIRROR_SERVICE_TOKEN` (V5 addition).
- Team-leader confirmation before commit: no jest/nx run process alive; `run-many -t test -p
  @ptah-extension/skill-synthesis --testPathPatterns '"skill-synthesis.reachability"' --runInBand` -> 1 suite, 5/5
  passed (node:sqlite); `run-many -t typecheck -p @ptah-extension/skill-synthesis` green. Lane scratch
  `agent-output-root.md` (a pointer to the report only) deleted, untracked.

- Recommended executor: codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`)
- Fallback executor: backend-developer subagent (use it directly if the lane host is still at its agent limit, as in
  Batch 5 revise round 1; the executor prompt is written to work for either)
- Execution mode: sequential (one spec + optional test-support)
- Parallel with: none (needs the final DI graph; mutations edit production files transiently)
- Rationale: the proof is the phase gate (HANDOFF "rule that governs every phase"); it needs undivided attention
  and five mutation runs that must not collide with another lane's edits.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `T\code-logic-review-batch-6.md`
- Suggested commit: `test(skill-synthesis): batch 6 - reachability proof for manual promote and evidence prefilter`
- Tasks: 2 | Depends on: Batches 1, 3, 4, 5 (committed)
- Report: `T\batch-6-report.md` | Marker: `T\batch-6.done`

### Batch 6 re-read against Batches 1-5 as shipped (team-leader, HEAD `625b3861c`)

- **D1a confirmed on disk.** `SkillSynthesisService.promote(candidateId, origin = {})` (`skill-synthesis.service.ts:1155-1164`)
  calls `promotion.promoteManually` (`:1159`); `promoteBulk` (`:1199-1210`) likewise. `SkillPromotionService` has one
  private pipeline with `mode: 'automatic' | 'manual'` (`skill-promotion.service.ts:212`); only `mode === 'automatic'`
  (`:242`) returns `below-threshold` (`:249`). So group 4 pins automatic `evaluate` -> `below-threshold` with zero judge
  calls, and group 5 ends `promoted` through the manual path. The proof does not assert automatic promotion.
- **Line anchors moved.** `registerSkillSynthesisServices` is at `di/register.ts:61` (was `:59`). `resolveOpener` is
  `queue/queue-db.test-support.ts:98`. M4's `this.stageHandlers?.registerStageHandlers(this)` is still
  `skill-synthesis.service.ts:313`, above both early returns of `start()` (`:304-323`).
- **M2 / M3 restore code that no longer exists.** Take the original text from the parent of the Batch 1 commit:
  `git show fdff9b105^:libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` — the `depthOk` branch in
  `passesPrefilter` (then `:1182-1199`, settings then carried `eligibilityMinTurns` / `prefilterMinChars`, so M2 may
  inline literal thresholds 5 / 800 inside the mutation) and the `recordInvocation` block + `contextId` hash (then
  `:892-898`, `:917-925`). Today `passesPrefilter` ends in `hasSessionWorkEvidence(trajectory, settings)`
  (`:1136-1139`).
- **Batch 5 added two registered tokens.** `SKILL_BACKLOG_CLEANUP_STORE` / `SKILL_BACKLOG_CLEANUP_SERVICE` are
  singletons in the production registration. The proof must NOT resolve them (they are not on the promote path);
  tsyringe resolves lazily, so they add no host token. For reference `register.spec.ts:44-70` shows their host-token
  set: `TOKENS.LOGGER`, `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `SDK_TOKENS.SDK_JSONL_READER`,
  `PLATFORM_TOKENS.WORKSPACE_PROVIDER`. `CandidateNamerService` is gone, so no namer token or namer lane call exists.
- **Migrations through 45.** `openAndMigrate()` now applies `0045_skill_backlog_cleanup`; nothing in the proof reads
  that table.
- **Settings the harness must serve** (no `eligibilityMinTurns` / `prefilterMinChars` any more — Batch 3):
  `skillSynthesis.enabled: true` (else `start()` returns at `:315` before opening the DB and registering the
  session-end callback at `:382`), `skillSynthesis.skillsRoot` (`skill-md-generator.ts:34`, temp) and
  `candidatesDir`, `judgeEnabled: true`, `prefilterMinEdits` 1 / `prefilterMinToolUses` 2 (defaults), and drain keys so
  the frequent tick is not gated: `drain.foregroundBackoffMs` passes by default (tracker reports `Infinity` before a
  chat turn), budget not exhausted, `pauseOnBattery` irrelevant with `onBattery: false`. Session-end rows carry
  `source: 'session-end'` (`:385`), so `bootDeferralMs` (boot rows only) does not hold them.
- **Reuse path check (s-beta).** `analyzeSession` returns `{reused: true}` from `store.findByTrajectoryHash` at
  `skill-synthesis.service.ts:749-751` without appending `s-beta` to `source_session_ids`; the prefilter handler maps it
  to `reused existing candidate` (`queue/stage-handlers.service.ts:290`); a null result maps to
  `no candidate from this session` (`:283`). `source_session_ids = ["s-alpha"]` therefore holds only if both
  transcripts normalise to one hash — verify by reading the extractor's normalisation before writing fixtures. If the
  production code cannot produce one hash for two workspace roots, STOP and report (do not change production code).
- **`start()` side effects the proof must account for.** It starts the curator (`:396`, its own timer; a curator pass
  could call the fake lane and pollute group 4's "zero judge calls") and enqueues an `embedding` backfill row
  (`:413`). The session-end callback is fire-and-forget (`void this.enqueueAnalyze(...)`, `:384`), so after firing it
  the spec must wait until the three `prefilter` rows exist (bounded poll) before draining. Count judge calls from the
  fake lane per group (snapshot before group 4), not cumulatively from boot.
- **Teardown.** `SkillSynthesisService.stop()` (`:421-427`) disposes the session-end registration and stops the
  curator; call it in `afterAll`, then close the connection and delete the temp dir.
- **Test-support files present:** `lanes/lane-runner.test-support.ts` (`makeQueryStub` `:150`, `resultMessage` `:253`,
  `assistantText` `:259`), `queue/queue-db.test-support.ts` (`resolveOpener`, `makeTempDbPath`, `noopLogger`),
  `queue/skill-drain.test-support.ts` (`liveSignal`).

### Task 6.1: Real-container harness — COMPLETE

- Files: CREATE `W\libs\backend\skill-synthesis\src\lib\skill-synthesis.reachability.integration.spec.ts`; optional
  `skill-synthesis.reachability.test-support.ts` if the setup passes ~150 lines (already excluded from lib typecheck).
- Plan reference: implementation-plan.md:430-455
- Harness: child tsyringe container; production `registerSkillSynthesisServices(container, logger)` (`di/register.ts:59`);
  no hand-constructed services. Bind ONLY host tokens: `SQLITE_DB_PATH` -> temp file and the real
  `SqliteConnectionService` configured with the `resolveOpener` binding and null vec resolvers (V1, A1);
  `VEC_STATUS {available:false}`; `WORKSPACE_PROVIDER` settings map (skills root + candidates dir in temp,
  `judgeEnabled: true`); `SESSION_END_CALLBACK_REGISTRY` capturing the callback; `SDK_JSONL_READER` fake over fixture
  JSONL; `SDK_CURATOR_RATE_LIMIT`; `INTERNAL_QUERY_SERVICE_TOKEN` = fake lane from `lanes/lane-runner.test-support.ts`
  (synthesis draft; judge five-criteria score 8), plus every further host token the resolution error names (V5).
- Acceptance: report lists the final bound token set, each with one-line justification, and how the fake lane tells
  synthesis from judge requests. Spec `it.skip`s only when neither binding loads.

### Task 6.2: Scenario groups 1-5 + mutations M1-M5 — COMPLETE

- Scenario (one `it` per group, shared `beforeAll`):
  1. `synthesis.start()`; fire the captured session-end callback for `s-alpha` (`<tmp>/ws-a`) and `s-beta`
     (`<tmp>/ws-b`) with the same code-work transcript (one `Edit`, one `Bash npx nx test ...`, workspace roots in text
     so normalisation gives one hash) and `s-chat` (`<tmp>/ws-a`, 8 turns, > 1,000 chars, text blocks only).
  2. `SKILL_DRAIN_SERVICE.drain({ tier: 'frequent', signal, onBattery: false })` until no `prefilter` row is `queued`
     (bounded loop, fail on no progress).
  3. AC4, AC5, AC13: exactly one `skill_candidates` row, `status='candidate'`, `success_count=0`,
     `source_session_ids=["s-alpha"]`; `s-alpha` prefilter `done`; `s-beta` `done` `reused existing candidate`;
     `s-chat` `skipped` `no candidate from this session`; NO `archaeology` / `judge-panel` / `trigger-eval` rows
     exist for `s-chat` (V2); `SELECT COUNT(*) FROM skill_invocations` = 0.
  4. AC3: `SKILL_PROMOTION_SERVICE.evaluate(id, synthesis.readSettings())` -> `below-threshold`; fake lane saw zero
     judge calls; status `candidate`.
  5. AC1: `synthesis.promote(id, { userInitiated: true })` -> `{promoted:true, reason:'promoted'}`; row
     `status='promoted'`, `judge_status='scored'`; `SKILL.md` exists under the temp active root.
- Plan reference: implementation-plan.md:456-480
- Mutations (each: apply, run the spec, paste the failing assertion, revert, re-run green, paste `git diff --stat`
  showing no production change):
  - **M1** `SkillSynthesisService.promote` calls `promotion.evaluate` -> group 5 fails (`below-threshold`)
  - **M2** restore the `depthOk` branch -> group 3 fails (candidate for `s-chat`)
  - **M3** restore the fake `recordInvocation` block -> group 3 fails (invocation count 1)
  - **M4** remove `this.stageHandlers?.registerStageHandlers(this)` (`skill-synthesis.service.ts:313`) -> group 3 fails
    (`no handler for stage prefilter`)
  - **M5** make `promoteManually` apply the threshold -> group 5 fails
- Constraint: does NOT assert automatic promotion (phase 5 changes group 4 on purpose).

### Batch 6 verification (commands from `W`)

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis` — "for 1 project"
- `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis` — 1 project
- `npx nx run-many -t lint -p @ptah-extension/skill-synthesis` — 1 project
- XB1 both bindings: `--config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-synthesis.reachability"'` under node:sqlite (`npx jest ...`) AND better-sqlite3 (Electron); both show 0 skipped
- `npx nx run degradation-audit:lint` — exit 0
- M1-M5 fail + restore outputs pasted; reviewer accepting verdict.

---

## Batch 7: Final verification and measurement — COMPLETE (c4f9c4df8)

- Commits: `c4f9c4df8` test(skill-synthesis): batch 7 - track transaction state in the reachability node:sqlite
  adapter (1 file, Task 7.4); task-folder docs commit `docs(task-specs): record TASK_2026_461 batch 7 and plan batch 8`
  follows it (test-report.md, backlog-cleanup-measurement.md, batch-7.done, context.md, this file).
- Executor: senior-tester subagent (Claude family), all four tasks.
- Review: Task 7.4 is test-support only; the orchestrator accepted it without a separate review lane. Team-leader read
  the diff line by line: `inTransaction` prefers the own-property or prototype `isTransaction` getter, else a flag set
  by `exec` of `BEGIN`, cleared by `COMMIT` / `END` / `ROLLBACK` (not `ROLLBACK TO`); the `.transaction()` wrapper
  sets and clears it on success and on throw; doc comment states the adapter covers only the members the proof reaches
  and `.transaction()` has no nesting / savepoints. No production file. Tasks 7.1-7.3 changed no code.
- Team-leader confirmation before commit: waited for another worktree's `run-many -t typecheck` to finish; then
  `run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns=skill-synthesis.reachability --runInBand
  --skip-nx-cache` -> 1 suite, 5/5 passed (node:sqlite). `git status` held only the Task 7.4 file plus task-folder files.
- Measured figures (`test-report.md`, `backlog-cleanup-measurement.md`):
  - 7.4: `inTransaction` false / true / false / true / false across BEGIN IMMEDIATE, COMMIT, BEGIN, ROLLBACK;
    reachability 5/5 both bindings, 0 skipped.
  - 7.1: test "for 8 projects" green (skill-synthesis 1512 passed / 37 skipped; persistence-sqlite 438 / 80 skipped
    native-probe suites; rpc-handlers 3016 / 33; platform-core 431; thoth-runtime 100; cli-engine 190); typecheck "for
    12 projects" green; lint "for 10 projects" 0 errors; degradation-audit exit 0, every lib at its baseline
    (skill-synthesis 6, cli-engine 12, persistence-sqlite 5, platform-core 7, rpc-handlers 1, shared 3,
    skill-synthesis-ui 5, ptah-electron 4, ptah-cli 29; thoth-runtime 0). XB1 better-sqlite3: skill-synthesis 8 suites
    182/182, persistence-sqlite 10 suites 83/83 (node:sqlite 74 + 9 native-only skips). Greps clean; A3 clean; R3 / R4
    / R5 recorded as phase-5 notes.
  - 7.2: 1,710 sessions scanned, 1,695 extracted; phase-2 eligible 1,641, phase-3 eligible 1,639 (2 removed, 0.12%);
    22.2 s. No tool-only split (harness does not compute it).
  - 7.3: snapshot 1,178,537,984 bytes unchanged; schema 41 -> 45; 2,418 candidates examined in 13 ticks (max tick
    1,007 ms, largest read 226 ms); kept evidence 120 / verdict 174 / degraded 265; rejected no evidence 0 / transcript
    unreadable 1,859; invocations deleted 2,424; deferred on error 0; state row = summed counters. Of the 1,859
    unreadable rejections, 13 candidates have a transcript file on disk (1,093 distinct sessions checked).
- **Findings put to the user (context.md 2026-09-16)**: tool evidence is too broad (MCP calls count) and the unreadable
  rejection fires when no workspace root resolves, so no read was attempted. User decisions -> Batch 8.

- Recommended executor: senior-tester SUBAGENT for all four tasks (orchestrator decision at the Batch 6 commit:
  Task 7.3 must not run on a lane, and the Ollama lane is out of quota).
- Fallback executor: none for 7.3 (return to orchestrator). 7.4 / 7.1 / 7.2 may move to a backend-developer subagent
  if the senior-tester fails twice.
- Execution mode: sequential, in this order: **7.4 -> 7.1 -> 7.2 -> 7.3** (7.4 changes a test-support file that 7.1's
  suites and XB1 runs must include).
- Parallel with: none. Heavy runs: check for live `jest` / `nx run` processes before every run and wait if one runs
  (other sessions share the machine, HANDOFF "Other sessions share this machine").
- Reviewer: must be a different model family from the implementer (senior-tester = Claude family), and never codex
  reviewing codex-implemented work. Recommended: codex CLI lane, role code-logic-reviewer (codex implemented nothing
  in Batch 7) -> `T\code-logic-review-batch-7.md`; alternative: the Ollama Cloud lane once its quota resets.
  antigravity stays reserved for Gate 3.
- Commits (team-leader, after the review): (1) `test(skill-synthesis): batch 7 - track transaction state in the
  reachability node:sqlite adapter` (Task 7.4 file only); (2) `docs(task-specs): batch 7 - phase 3 verification and
  backlog cleanup measurement` (task folder).
- Tasks: 4 | Depends on: Batches 1-6 (committed)
- Deliverables: `T\test-report.md` (Tasks 7.4, 7.1, 7.2 and the safety proofs of 7.3) and
  `T\backlog-cleanup-measurement.md` (Task 7.3, AC15) | Marker: `T\batch-7.done`. The executor does not commit and does
  not edit `batches.md`.

### Batch 7 re-read against Batches 1-6 as shipped (team-leader, HEAD after the Batch 6 commit)

- **Branch commits** (base `97239e814`): `d72d1493e` B2 migration 0045 · `fdff9b105` B1 manual promote / evidence
  prefilter / no creation invocation · `53224575d` docs · `a20cfa1b1` B3 dead depth settings · `e420f1b5d` B4 cleanup
  store/service + gate skip · `bb887ef40` docs · `625b3861c` B5 cleanup job both hosts + namer deleted · `55dba650c`
  docs · `83002016f` B6 reachability proof · plus the Batch 6 docs commit.
- **Projects the branch touched** (`git diff --name-only 97239e814..HEAD`, 66 files outside `.ptah`):
  skill-synthesis (34), persistence-sqlite (12), thoth-runtime (6), skill-synthesis-ui (4), rpc-handlers (3),
  cli-engine (2), platform-core (1), shared (1), webview-e2e-harness (1), ptah-electron-e2e (1), ptah-docs (1).
  `webview-e2e-harness` and `ptah-electron-e2e` have only `lint` + `typecheck`; `ptah-docs` has no
  test/lint/typecheck target (docs verified by grep). The old lint set (8) missed the two e2e projects; corrected to 10.
- **Real-SQLite specs the branch added or edited** (grep for `resolveOpener` / `better-sqlite3` / `DatabaseSync` in the
  touched specs). The old XB1 list named 3 skill-synthesis and 2 persistence-sqlite patterns; the set is larger:
  - skill-synthesis: `skill-synthesis.reachability`, `skill-backlog-cleanup` (store, service, integration),
    `skill-candidate.store`, `skill-synthesis.stage-handlers` (B4 edit, real SQLite at `:882`),
    `judge-panel.service` and `cluster-holdout-end-to-end` (B1 fixture edits, real SQLite).
  - persistence-sqlite: `0045_skill_backlog_cleanup` plus the nine ratchet specs `0028`, `0030`, `0038`-`0044`.
  - Not real SQLite (mock `openAndMigrate`): `skill-synthesis.service.spec`, cli-engine `thoth-runtime.spec`.
- **Degradation-audit baselines** (`tools/degradation-audit/baseline.json`, ceilings): skill-synthesis 6, cli-engine
  12, persistence-sqlite 5, platform-core 7, rpc-handlers 1, `libs/shared/src` 3, skill-synthesis-ui 5,
  apps/ptah-electron 4, apps/ptah-cli 29; thoth-runtime has no entry (= 0). Batch 6 measured skill-synthesis 6 ok.
  Never `--update-baseline`.
- **Task 7.3 source file, observed by directory listing only (never opened):** the newest
  `ptah.pre-migration-*.sqlite` in `~/.ptah/state` is `ptah.pre-migration-20260909T230600Z.sqlite`, 1,178,537,984
  bytes, mtime 2026-09-10 02:06:09 +0300. The `ptah-dev.*` files are the dev database and are out of scope. The live
  `ptah.sqlite` (1.38 GB) has `-wal` and `-shm` beside it, so a host is or was running: never copy it. The copy needs
  about 1.2 GB free in OS temp plus migration growth; check free space first. The snapshot predates every branch
  commit, so it holds the pre-phase-3 backlog up to 2026-09-09.
- **Cleanup service as shipped** (`cleanup/skill-backlog-cleanup.service.ts`): constructor `(logger, store,
  verdicts, queue, extractor, foreground, workspace)` (`:68-77`); gates read section `ptah` keys
  `skillSynthesis.enabled`, `skillSynthesis.drain.bootDeferralMs`, `skillSynthesis.drain.pauseOnBattery`,
  `skillSynthesis.drain.foregroundBackoffMs` (`:424-450`) and `startedAt = Date.now()` at construction (`:66`), so
  the harness sets `bootDeferralMs` 0 (or `foregroundBackoffMs` 0) and passes `isOnBattery: () => false`. One `run`
  examines at most 200 candidates in 60 s and returns `partial` (`row-budget` / `time-budget`), so the loop runs
  until `{status:'skipped', reason:'complete'}`. Reject reasons are the literal strings
  `backlog-cleanup: no code evidence and no verdict` and `backlog-cleanup: transcript unreadable and no verdict`.
  Run report fields (`skill-backlog-cleanup.types.ts:17-55`): `examined`, `keptEvidence`, `keptVerdict`,
  `keptDegradedVerdict`, `rejectedNoEvidence`, `rejectedTranscriptUnreadable`, `invocationsDeleted`,
  `deferredOnError`, `status`, `reason`, `durationMs`, `error`. `deferredOnError` is per-run and NOT persisted (state
  row has the other seven), so the harness must sum it across ticks. A deferred candidate is not rejected and the
  cursor passes it, so it is never re-examined in this pass: report its count as its own line.
- **Accepted risk from Batch 4 finding 2** (extractor does not tell `EBUSY` from `ENOENT`): the measurement must count
  `rejected_transcript_unreadable`, and for those candidates check READ-ONLY (`fs.statSync` / directory listing, no
  content read) whether a transcript file exists for any source session: the `prefilter` queue row's
  `transcript_path` on the copy, and `~/.claude/projects/*/<sessionId>.jsonl`. Report counts only.
- **Stale text corrected here:** Task 7.1 lint set 8 -> 10; XB1 pattern lists widened; report file `batch-7-report.md`
  -> `test-report.md`; reviewer no longer the Ollama lane by default; Task 7.4 added from the Batch 6 review.

### Task 7.4: Reachability node:sqlite adapter tracks transaction state (carried Batch 6 moderate) — COMPLETE

- File: MODIFY `W\libs\backend\skill-synthesis\src\lib\skill-synthesis.reachability.test-support.ts` (`adaptNodeDatabase`
  `:41-83`). No production file, no change to the five proof groups.
- Change: `inTransaction` reports the real state instead of a hardcoded `false`. Prefer the native getter when the raw
  `node:sqlite` `DatabaseSync` exposes one (Node here is v24.15.0, which has `isTransaction`); otherwise track it:
  `exec` of `BEGIN` (any form) sets true, `COMMIT` / `END` / `ROLLBACK` (not `ROLLBACK TO`) sets false, and the
  `.transaction()` wrapper keeps the flag correct on success and on a throw. Add a doc comment on `adaptNodeDatabase`
  that the adapter covers only the members the reachability proof reaches, and `.transaction()` is not a verified
  equivalent of better-sqlite3's (no nesting / savepoints).
- Acceptance: (a) evidence pasted in `test-report.md` that, under node:sqlite, `inTransaction` reads false before
  `BEGIN IMMEDIATE`, true after it, false after `COMMIT`, and false after a `ROLLBACK` (a scratch check that is deleted
  after, or a short assertion inside the existing `beforeAll`; state which); (b) the reachability spec passes 5/5 with 0
  skipped under BOTH bindings (XB1 commands); (c) `run-many -t typecheck` and `lint` for skill-synthesis green;
  (d) `git status --short` shows only this file changed under `libs/`.

### Task 7.1: Full suite + typecheck + lint + greps — COMPLETE

- Commands (from `W`, `NX_DAEMON=false`, `D:\projects\ptah-extension\node_modules\.bin\nx.cmd`):
  - `run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/skill-synthesis-ui` — "for 8 projects" (R9 / HANDOFF rule 8 flakes: re-run `--parallel=1`, record both)
  - `run-many -t typecheck -p` the same 8 + `@ptah-extension/webview-e2e-harness ptah-electron-e2e ptah-electron ptah-cli` — "for 12 projects"
  - `run-many -t lint -p` the same 8 + `@ptah-extension/webview-e2e-harness ptah-electron-e2e` — "for 10 projects"
  - `run degradation-audit:lint` — exit 0; paste the lines for every lib in the baseline list above
  - XB1 better-sqlite3 (Electron-as-Node, from `W`):
    `--config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-synthesis.reachability|skill-backlog-cleanup|skill-candidate.store|skill-synthesis.stage-handlers|judge-panel.service|cluster-holdout-end-to-end"' --runInBand`
    and `--config libs/backend/persistence-sqlite/jest.config.ts --testPathPatterns '"0028_|0030_|0038_|0039_|0040_|0041_|0042_|0043_|0044_|0045_"' --runInBand`;
    paste both `Tests:` lines and the node:sqlite counts for the same patterns from the full run.
- Greps (paste, from `W`): `CandidateNamer|setDisplayName|nameCandidate|depthOk|eligibilityMinTurns|prefilterMinChars`
  over `libs` and `apps` (`*.ts`, `*.md`) -> only the opt-in corpus harness inline old predicate (and task specs); A3:
  no production `contextId` producer passed to `recordInvocation` in `libs/backend/skill-synthesis/src`;
  `cron-scheduler` imported nowhere in `libs/backend/skill-synthesis/src`.
- Record R3 (automatic promotion still impossible; UI text), R4 (generalization shortcut unreachable), R5
  (`SkillInvocationTracker` registered, unused) as phase-5 notes in `test-report.md`.

### Task 7.2: Prefilter narrowing measurement (opt-in corpus harness) — COMPLETE

- Run `libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts` with `PTAH_PREFILTER_CORPUS=1`
  (command in its header `:17`) over `~/.claude/projects` JSONL. Reads transcripts, never the database; counts only.
  Record phase-2 vs phase-3 eligible counts, depth-only passes, tool-only passes (R2), session total, wall time.
- Plan reference: implementation-plan.md:500-505

### Task 7.3: Cleanup outcome on a byte copy (senior-tester only) — COMPLETE

- Procedure (HANDOFF rule 5, R-TL9, implementation-plan.md:506-518):
  1. Never open `~/.ptah/state/ptah.sqlite`, `ptah.sqlite-wal`, `ptah.sqlite-shm` or any `ptah.pre-migration-*.sqlite`
     with SQLite, and never copy the live `ptah.sqlite`. Record size + mtime of the source
     `ptah.pre-migration-20260909T230600Z.sqlite` (re-list; if a newer `ptah.pre-migration-*` exists, use the newest
     and say so) with `fs.statSync` only.
  2. Create the temp dir with `fs.mkdirSync` WITHOUT `recursive` under `os.tmpdir()`, name not starting with `ptah`
     (e.g. `skill-cleanup-measure-<4 hex>`), so an existing dir throws `EEXIST`.
  3. `fs.copyFileSync(source, <tmp>/backlog-copy.sqlite, fs.constants.COPYFILE_EXCL)`. Open ONLY the copy.
  4. Set and read back the six production pragmas on the copy: `journal_mode=WAL`, `foreign_keys=ON`,
     `synchronous=NORMAL`, `temp_store=MEMORY`, `mmap_size=268435456`, `busy_timeout=5000`; paste the read-back values.
  5. Record the copy's schema version before, then apply migrations through 0045 with the real
     `SqliteConnectionService` pointed at the copy (no backup service, vec resolvers null), and record the version
     after and the migration wall time. Prefer the production binding (better-sqlite3 under Electron-as-Node); record
     which binding ran.
  6. Construct the real stores, real `TrajectoryExtractor` and real `JsonlReaderService` (as the corpus harness does,
     `prefilter-corpus-measurement.spec.ts:113`) wrapped in a timing proxy; settings satisfy the gates. Loop
     `SkillBacklogCleanupService.run` until `skipped: complete`; record every tick's report.
  7. Read-only existence check for `rejected_transcript_unreadable` candidates (see re-read above).
  8. Close the connection, `fs.rmSync(<tmp>, { recursive: true })`, prove `fs.existsSync(<tmp>) === false`; re-stat
     the source and prove size + mtime unchanged.
  9. The harness is a temporary spec file under `libs/backend/skill-synthesis`; delete it after use and prove
     `git status --short -- libs/backend/skill-synthesis` shows only the Task 7.4 file.
- Record in `backlog-cleanup-measurement.md` (counts and timings only; no session ids, paths or transcript content):
  source size + mtime before/after; pragma read-back; schema version before/after + migration time; cutoff; candidates
  at `status='candidate'` before; examined; kept by evidence / verdict / degraded verdict; rejected per reason
  (`rejectedNoEvidence`, `rejectedTranscriptUnreadable`); `deferredOnError` summed across ticks; fake invocations deleted
  and tracker rows (`context_id IS NULL`) remaining; ticks; wall time per tick (min / median / max); largest single
  transcript read time; final state row vs summed run counters (must agree); `rejected_transcript_unreadable`
  candidates with at least one transcript file present on disk (count) and the sessions checked; temp dir deleted.

### Batch 7 verification

- Task 7.4 file changed only as specified; reachability 5/5 under both bindings.
- Every command green with the stated `for N projects` headers (8 / 12 / 10); greps clean; XB1 lists pasted.
- `test-report.md` and `backlog-cleanup-measurement.md` exist with every number above; safety proofs pasted.
- `batch-7.done` written last; reviewer (different family) accepting verdict. (Superseded for Task 7.4 by the
  orchestrator: test-support only, accepted on the team-leader's line-by-line read.)

---

## Batch 8: User decisions on the Batch 7 findings — non-MCP tool evidence, keep root-unknown candidates, re-measure — COMPLETE (087667a92)

- Commits: `087667a92` feat(skill-synthesis,thoth-runtime,cli-engine,docs): batch 8 - non-MCP tool evidence, keep
  root-unknown backlog candidates (23 files, Tasks 8.1 + 8.2 COMBINED); task-folder docs commit `docs(task-specs):
  record TASK_2026_461 batch 8 and plan batch 9` follows it.
- Why one code commit, not two: 8.1 and 8.2 both edit `cleanup/skill-backlog-cleanup.service.spec.ts` (8.1 fixture
  field, 8.2 cases) and `skill-synthesis/CLAUDE.md` (two different bullets). Splitting needs hunk-level staging, and
  lint-staged runs `nx format:write` on staged files with unstaged hunks stashed — a mixed or reformatted commit risk
  for no rollback benefit (8.2's specs need 8.1's field to typecheck).
- Executors: 8.1 and 8.2 codex lanes (backend-developer); 8.3 senior-tester subagent.
- Review: `code-logic-review-batch-8.md` APPROVED 9/10 (code-logic-reviewer subagent, Claude family, implemented
  nothing). No blocking / serious. Minor, recorded not fixed: **M1** Read/Grep-only sessions still count as tool
  evidence — pre-existing, consistent with decision 1 (non-MCP, not "mutating"); candidate for a later task (narrow
  to mutating / test tools). **M2** `keptRootUnknown` has no cross-run trend — accepted, migration 0045 frozen.
- Team-leader confirmation before commit: no live jest / nx run-many process; `run-many -t test -p
  @ptah-extension/skill-synthesis --testPathPatterns='"session-work-evidence|skill-backlog-cleanup"' --runInBand` ->
  4 suites, 33/33 passed (node:sqlite); `run-many -t typecheck -p` skill-synthesis thoth-runtime cli-engine ->
  "for 3 projects" green. Untracked lane-host scratch `agent-output-root.md` (a 3-line pointer to the report) deleted.
- Executor notes: 8.2 did not run the post-restore `git diff --stat` (its contract forbids git); team-leader's
  `git status` at commit held only the 23 listed files, so the mutation is not present. 8.3 once launched a bare
  `electron.cmd` (full GUI, no args) by mistake while starting the corpus run; killed with `taskkill /F /T` before any
  test ran, process list re-verified clean. No measurement affected.
- Measured (`batch-8-report.md` Task 8.3, `backlog-cleanup-measurement.md` "Batch 8 re-measurement"):
  - Verification: test "for 8 projects" green (skill-synthesis 1519 / 37 skipped, persistence-sqlite 438 / 80,
    rpc-handlers 3016 / 33, platform-core 781 + 4 todo, shared 1521, thoth-runtime 100, cli-engine 190); typecheck
    "for 12 projects"; lint "for 10 projects" 0 errors; degradation-audit exit 0 (skill-synthesis 6, cli-engine 12,
    TOTAL 303); XB1 skill-synthesis 184/184 both bindings, persistence-sqlite 83 (9 native-probe skips on node:sqlite).
  - Corpus (live, moved since Batch 7): scanned 1,691; phase-2 eligible 1,622; untightened 1,620; tightened
    **1,609**; `mcpOnlyRejected` **11**; 19.7 s.
  - Byte copy (2,418 examined, 13 ticks): kept evidence 109 (Batch 7: 120), verdict 174, degraded 265, rejected no
    evidence 0, rejected unreadable **317** (1,859), `keptRootUnknown` **1,553**, deferred 0, invocations deleted
    2,424; identity 2,418 - (109+174+265+0+317+1,553+0) = 0. The 13 file-on-disk candidates are all now
    kept-root-unknown; 0 of the 317 have a file on disk; so 1,540 root-unknown candidates have no transcript.
    Tick median 25 ms, max 916 ms; largest read 147 ms.
  - Kept evidence fell 120 -> 109 (-11): consistent with decision 1's MCP tightening; not separately attributed.
- Note: `test-report.md` carries no Batch 8 section; the 8.3 evidence lives in `batch-8-report.md`.

Source: `context.md` "Conversation Summary" 2026-09-16 (binding user decisions 1 and 2). No architect revision: both
decisions are narrow predicate changes inside components the plan already owns (Component 3 prefilter, Component 4
cleanup). The extractor is phase-5 territory in the plan; decision 1 authorises exactly ONE additive field there.

- Recommended executor: 8.1 and 8.2 — codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`); 8.3 —
  senior-tester SUBAGENT, never a lane (reads `~/.claude/projects`, `~/.ptah/state`, OS temp under HANDOFF rule 5).
- Fallback executor: backend-developer subagent for 8.1 / 8.2; none for 8.3 (return to orchestrator).
- Execution mode: **sequential, 8.1 -> 8.2 -> 8.3.**
- Parallelism verdict: 8.1 and 8.2 are disjoint in PRODUCTION files (8.1: `eligibility/`, `trajectory-extractor.ts`;
  8.2: `cleanup/`, the thoth-runtime job) but NOT safely parallel: (1) a required `nonMcpToolUseCount` on
  `ExtractedTrajectory` forces 8.1 to edit the trajectory fixtures in
  `cleanup/skill-backlog-cleanup.service.spec.ts:124-135,222-232`, which 8.2 also edits; (2) both edit
  `libs/backend/skill-synthesis/CLAUDE.md`; (3) 8.1's mutation transiently breaks the predicate that 8.2's cleanup
  specs exercise, in one shared worktree (R-TL5). Both tasks are small, so sequential costs little.
- Reviewer: different family from the implementer. If 8.1 / 8.2 ran on codex -> code-logic-reviewer SUBAGENT (Claude)
  or the Ollama lane; if either fell back to a Claude subagent -> codex lane code-logic-reviewer. One review over
  8.1 + 8.2 together after 8.2 returns -> `T\code-logic-review-batch-8.md`. 8.3 is verification + measurement only.
- Commits (team-leader, after the review): (1) `feat(skill-synthesis): batch 8 - count only non-MCP tools as work
  evidence` (8.1 files); (2) `fix(skill-synthesis,thoth-runtime): batch 8 - keep backlog candidates whose workspace
  root never resolves` (8.2 files); (3) `docs(task-specs): record TASK_2026_461 batch 8` after 8.3.
- Tasks: 3 | Depends on: Batch 7 (committed)
- Report: `T\batch-8-report.md`, one section per task (`## Task 8.1`, `## Task 8.2`, `## Task 8.3`); each executor
  appends ONLY its own section, creating the file if absent. Markers: 8.1 writes `T\batch-8.1.done`, 8.2 writes
  `T\batch-8.2.done`, 8.3 writes `T\batch-8.done` (one line: ISO timestamp + `DONE` or `BLOCKED: <reason>`), each as
  its LAST step. Executors never edit `batches.md` and never commit.

### Batch 8 plan validation

Status: PASSED WITH RISKS

Assumptions:

- A6 — MCP tools are exactly the `tool_use` blocks whose `name` starts with `mcp__` (Claude Code naming
  `mcp__<server>__<tool>`). Checked by 8.3's corpus re-measurement (`mcpOnlyRejected` reported).
- A7 — decision 2 read literally: `reject-unreadable` iff at least one source session had a resolved workspace root
  (candidate `workspaceRoot`, else the prefilter queue row) so `extract` was called, and no call returned a
  trajectory. Consequences, each pinned by a spec in 8.2: (a) session A root unknown + session B root resolved and
  `extract` null -> `reject-unreadable`; (b) empty `sourceSessionIds` -> no read attempted -> kept root-unknown (was
  `reject-unreadable`); (c) root resolved but `extract` returns null because no sessions directory exists -> `extract`
  was called -> `reject-unreadable` (unchanged).
- A8 — the skill-synthesis-ui label for `prefilterMinToolUses` is not changed (frontend, outside the decision); the
  docs row and lib CLAUDE.md carry the non-MCP rule.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-TL10 A required extractor field breaks every spec fixture typed `ExtractedTrajectory` (~15 specs by grep) | MEDIUM | Task 8.1 greps `toolUseCount` under `libs/backend/skill-synthesis/src` and updates every typed fixture; full lib test + typecheck gate |
| R-TL11 Tightened predicate silently drops the reachability proof's code-work session | MEDIUM | Fixture carries `Edit` (edit evidence) + `Bash` test; 8.1 re-runs reachability 5/5 under both bindings |
| R-TL12 Persisted counters no longer sum to `examined` | LOW | Documented in `skill-backlog-cleanup.types.ts`, both CLAUDE.md files; 8.3 checks kept + rejected + summed `keptRootUnknown` + summed `deferredOnError` = examined |
| R-TL13 `keptRootUnknown` is per-run (migration 0045 frozen) | LOW | Same shape as `deferredOnError`; 8.3 sums across ticks |
| R-TL14 Kept root-unknown candidates are passed by the cursor and not re-examined in this cleanup version | LOW | Accepted by the decision (keep, never reject); counted |

Edge cases:

- MCP-only session with many tool calls, no edit, no test command -> no evidence — Task 8.1
- 2 non-MCP tools -> evidence; 1 non-MCP + many MCP -> no evidence; threshold edges on `nonMcpToolUseCount` — Task 8.1
- `tool_use` block with a missing or non-string name counts as non-MCP (it cannot start with `mcp__`) — Task 8.1
- Edit-only and test-command-only sessions unchanged — Task 8.1
- No root for any session, no verdict -> kept root-unknown, counter 1, no rejection, cursor advances — Task 8.2
- Root resolved + `extract` null -> `reject-unreadable` unchanged; A7(a), A7(b) — Task 8.2
- A verdict still keeps the candidate before any root logic runs — Task 8.2 (existing cases stay green)

### Task 8.1: Tool evidence counts only non-MCP tools (decision 1) — COMPLETE

- Files (under `W\libs\backend\skill-synthesis\`):
  - MODIFY `src\lib\trajectory-extractor.ts` — add `nonMcpToolUseCount: number` to `ExtractedTrajectory` right after
    `toolUseCount` (`:91-92`), doc "Count of tool_use blocks whose name does not start with `mcp__`"; count it in
    `collectToolSignals` (`:331-361`), sum it in `extract` (`:183-193`), return it (`:234-246`). Do NOT rename or change
    `toolUseCount`, `editCount` or `bashTestPassed`.
  - MODIFY `src\lib\eligibility\session-work-evidence.ts` — tool evidence is `trajectory.nonMcpToolUseCount >=
    thresholds.prefilterMinToolUses`; doc comment says MCP tools (`mcp__*`) do not count. Threshold key and default
    (2) unchanged. Edit and test evidence unchanged.
  - MODIFY `src\lib\eligibility\session-work-evidence.spec.ts` — MCP-only (`toolUseCount` 12, `nonMcpToolUseCount` 0,
    no edit, no test) -> false; 2 non-MCP -> true; mixed 1 non-MCP + 10 MCP -> false; edges threshold-1 / threshold.
  - MODIFY `src\lib\trajectory-extractor.spec.ts` — transcript with `mcp__ptah__ptah_search_files`,
    `mcp__firecrawl__firecrawl_scrape`, `Read`, `Grep` -> `toolUseCount` 4, `nonMcpToolUseCount` 2.
  - MODIFY `src\lib\prefilter-corpus-measurement.spec.ts` — keep the `PTAH_PREFILTER_CORPUS=1` opt-in; add an inline
    "phase-3 untightened" predicate (the Batch 7 rule, `toolUseCount`) beside the real `passesPrefilter`; report
    `phase3UntightenedEligible`, `phase3Eligible`, `mcpOnlyRejected` (passes untightened, fails real). Counts only.
  - MODIFY every other spec under `src` with a fixture typed `ExtractedTrajectory` (grep `toolUseCount`; includes
    `cleanup\skill-backlog-cleanup.service.spec.ts:131,228`, `skill-synthesis.service.spec.ts`,
    `skill-synthesis.stage-handlers.spec.ts`, `skill-synthesizer.service.spec.ts`, `subagent-metrics-extractor.spec.ts`,
    `skill-synthesis.service.enqueue.spec.ts`, `gates\verdict-fallback.spec.ts`,
    `gates\replay-validator.service.spec.ts`, `gates\cluster-holdout-end-to-end.spec.ts`,
    `archaeology\regex-demotion.spec.ts`) — add `nonMcpToolUseCount`; where a fixture relies on tool evidence to pass,
    set it equal to `toolUseCount`.
  - MODIFY `CLAUDE.md` ("Prefilter eligibility is evidence-only" bullet, `:58`) and
    `W\apps\ptah-docs\src\content\docs\skill-synthesis\settings.md:34` (`prefilterMinToolUses` row: non-MCP tool calls;
    keep table alignment).
- Constraints: `archaeology\regex-demotion.spec.ts` scans production text — new comments must not name the tail-regex
  success field. No change to settings keys, schema, UI, or `skill-synthesizer.service.ts`'s use of `toolUseCount`.
- Acceptance: AC-8.1a the cases above pass; AC-8.1b reachability 5/5, 0 skipped, under BOTH bindings (XB1);
  AC-8.1c `run-many` test / typecheck / lint for skill-synthesis green ("for 1 project"); degradation-audit exit 0,
  skill-synthesis <= 6.
- Mutation (paste fail + restore + `git diff --stat`): **8.1-mut** predicate reads `toolUseCount` again -> the
  MCP-only and mixed cases fail.

### Task 8.2: Keep candidates whose workspace root never resolves (decision 2) — COMPLETE

- Depends on: Task 8.1 (shared spec file and CLAUDE.md)
- Files:
  - MODIFY `W\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts` — `evaluateCandidate`
    (`:262-306`): set `attempted = true` immediately before `extractor.extract` is called; after the loop return
    `readable ? 'reject-no-evidence' : attempted ? 'reject-unreadable' : 'kept-root-unknown'`. Add
    `'kept-root-unknown'` to `CandidateDisposition` (`:51-57`); `RunProgress` (`:59-62`, init `:82`) gains
    `keptRootUnknown`, incremented where `deferredOnError` is (per run, NOT in the persisted counters);
    `runCounters` (`:414-422`) returns it. No rejection pushed; the cursor advances as for any keep. Migration 0045 and
    `SkillBacklogCleanupStore` untouched.
  - MODIFY `...\cleanup\skill-backlog-cleanup.types.ts` — `BacklogCleanupRunCounters` (`:27-31`) gains
    `keptRootUnknown: number` with a doc comment: per run, not persisted; candidates kept because no source session
    resolved a workspace root, so no transcript read was attempted; persisted kept + rejected counters therefore sum
    to `examined` minus the run-summed `keptRootUnknown` and `deferredOnError`.
  - MODIFY `...\cleanup\skill-backlog-cleanup.service.spec.ts` — no root anywhere, no verdict -> report
    `keptRootUnknown` 1, `rejectedTranscriptUnreadable` 0, no rejection row for it; root resolved + `extract` null ->
    `reject-unreadable` unchanged; A7(a) mixed -> `reject-unreadable`; A7(b) empty `sourceSessionIds` -> kept
    root-unknown.
  - MODIFY `...\cleanup\skill-backlog-cleanup.integration.spec.ts` — seed a candidate with NULL `workspace_root`, no
    prefilter queue row, no verdict: stays `status='candidate'`, report `keptRootUnknown` 1; update any existing
    expectation the new rule changes and explain each in the report.
  - MODIFY `W\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.ts` (`summarizeCleanup` `:80-88`) — append
    `, root unknown ${report.keptRootUnknown}`; `kept` stays the persisted three. MODIFY
    `skill-backlog-cleanup-job.spec.ts` (`:45`, `:101-110`) fixture + expected summary.
  - MODIFY `W\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts:151-165` — add `keptRootUnknown: 0` to
    the report fixture if typecheck requires it (report either way).
  - MODIFY `W\libs\backend\skill-synthesis\CLAUDE.md` ("Backlog cleanup is conservative and resumable" bullet) and
    `W\libs\backend\thoth-runtime\CLAUDE.md` (skills backlog cleanup job bullet: counters include root unknown).
- Acceptance: AC-8.2a service spec cases above; AC-8.2b integration spec under BOTH bindings; AC-8.2c `run-many`
  test / typecheck / lint for skill-synthesis, thoth-runtime, cli-engine ("for 3 projects"); degradation-audit exit 0
  (skill-synthesis <= 6, cli-engine <= 12, thoth-runtime 0).
- Mutation (paste fail + restore + `git diff --stat`): **8.2-mut** restore `readable ? 'reject-no-evidence' :
  'reject-unreadable'` -> the no-root service case and the integration case fail.

### Task 8.3: Re-verification and re-measurement (senior-tester only) — COMPLETE

- Depends on: Tasks 8.1 and 8.2 returned and reviewed. Changes no code.
- Before every heavy run: no live `jest` / `nx run-many` process (wait if one runs). `NX_DAEMON=false`, binaries
  from `D:\projects\ptah-extension\node_modules`. Never `nx reset`, never `--update-baseline`.
- Verification (paste headers and totals):
  - `run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine` —
    "for 3 projects"
  - `run-many -t typecheck -p` the same 3 + `@ptah-extension/rpc-handlers ptah-electron ptah-cli` — "for 6 projects"
  - `run-many -t lint -p` the same 3 — "for 3 projects"
  - `run degradation-audit:lint` — exit 0; lines for skill-synthesis (<= 6), cli-engine (<= 12), thoth-runtime (0)
  - XB1 both bindings (PowerShell, `'"a|b"'` quoting): `--config libs/backend/skill-synthesis/jest.config.ts
    --testPathPatterns '"skill-synthesis.reachability|skill-backlog-cleanup|skill-synthesis.stage-handlers|cluster-holdout-end-to-end"'
    --runInBand`; paste both `Tests:` lines
  - greps: `mcp__` in `libs/backend/skill-synthesis/src` production files (extractor only); `keptRootUnknown` over
    `libs`
- Re-measurement 1 (corpus, Task 7.2 procedure): sessions scanned, extracted, phase-2 eligible, phase-3 untightened
  eligible (Batch 7: 1,639), phase-3 tightened eligible, `mcpOnlyRejected`, wall time.
- Re-measurement 2 (byte copy, Task 7.3 procedure verbatim, HANDOFF rule 5 / R-TL9: fresh fail-if-exists temp dir not
  starting with `ptah`, `COPYFILE_EXCL`, six pragmas read back, only the copy opened, temp harness spec deleted, temp
  dir removed and proven gone, source size + mtime unchanged): every Task 7.3 counter plus `keptRootUnknown` summed
  across ticks, as a before/after table against Batch 7 (kept evidence 120, verdict 174, degraded 265, rejected no
  evidence 0, unreadable 1,859, invocations 2,424, deferred 0); the sum check kept + rejected + summed
  `keptRootUnknown` + summed `deferredOnError` = examined; and the new disposition of the 13 candidates Batch 7 found
  unreadable-rejected with a transcript on disk (same read-only existence check; counts per disposition only).
- Report: `T\batch-8-report.md` `## Task 8.3` (counts and timings only; no session ids, paths or transcript content);
  `git status --short` proving no harness remains; marker `T\batch-8.done` LAST.

### Batch 8 verification

- 8.1 / 8.2 files exist with real code; 8.1-mut and 8.2-mut pasted fail + restore; reachability 5/5 both bindings;
  reviewer of a different family accepting verdict.
- 8.3 headers 3 / 6 / 3; degradation audit at baselines; both re-measurements recorded with safety proofs.
- `batch-8.done` written last.

---

## Batch 9: User decision 3 — root-unknown candidates look up `<sessionId>.jsonl` by id; re-verify + re-measure — COMPLETE (b7da25171)

- Commits: `b7da25171` feat(agent-sdk,skill-synthesis,thoth-runtime,cli-engine): batch 9 - look up backlog transcripts
  by session id (15 files, Task 9.1 + revise round 1 COMBINED; the revise edits the same four skill-synthesis files);
  task-folder docs commit `docs(task-specs): record TASK_2026_461 batch 9 and phase 3 completion` follows it.
- Executors: 9.1 and its revise round codex lane (backend-developer); 9.3 senior-tester subagent (ran in parallel with
  the 9.2 review on orchestrator instruction, against the pre-revise code).
- Review: `code-logic-review-batch-9.md` CHANGES_REQUESTED 6/10 (code-logic-reviewer subagent, Claude family,
  implemented nothing). Seam, A9/A10/A12 precedence, counter identity and DI order confirmed. Findings:
  - **SERIOUS** — a successful but EMPTY transcript-root listing (`[]`) ran zero stats and returned `absent`, so every
    root-unknown candidate would be rejected `no transcript found` although nothing was searched.
  - MINOR — lookup stats logged only at debug (not observable in production).
  - MINOR — one `readable` flag shared by the root loop and the lookup loop.
- Revise round 1 (`batch-9-report.md` `## Task 9.1 — revise round 1`): `session-transcript-locator.ts:95`
  `sessionDirectories === null || sessionDirectories.length === 0` -> cached `unavailable` before any stat (locator spec
  listings 1 / stats 0; service spec with a real locator over `[]` -> `keptRootUnknown` 1, no rejection); one `info`
  record per `execute()` with counts only (`directoryListings`, `pathStats`, `cacheHits`; no id or path); separate
  `rootReadable` / `lookupReadable` flags, precedence unchanged. Mutations: **9.1-mutD** (guard reverted to `=== null`)
  -> 2 suites / 2 tests fail, restore green; **9.1-mutA** re-proven. Verification: test and lint "for 4 projects",
  typecheck "for 7 projects", both SQLite bindings 47/47, degradation-audit exit 0 (skill-synthesis 6, cli-engine 12,
  agent-sdk 4, thoth-runtime 0).
- Orchestrator accepted the revise without a second review: the serious fix is a one-line guard proven by mutation,
  and the Claude family already reviewed the batch.
- 9.3 numbers stand after the revise: the byte-copy run listed a non-empty root (41 child folders; 12 listings, 42,750
  path stats), so the empty-listing guard could not trigger; the other two revise items change logging and local flag
  names, not dispositions. Note added to `backlog-cleanup-measurement.md`.
- Team-leader confirmation before commit: no live jest / nx run process; `run-many -t test -p
  @ptah-extension/skill-synthesis --testPathPatterns '"session-transcript-locator|skill-backlog-cleanup"' --runInBand`
  -> 4 suites, 42/42 passed (node:sqlite); `run-many -t typecheck -p` agent-sdk skill-synthesis thoth-runtime
  cli-engine -> "for 4 projects" green; guard confirmed on disk at `session-transcript-locator.ts:95`. Untracked
  lane-host scratch `agent-output-root.md` (a pointer summary of the report) deleted.
- Measured (`batch-9-report.md` Task 9.3, `backlog-cleanup-measurement.md` "Batch 9 re-measurement"):
  - Verification: test "for 9 projects" green (agent-sdk 1968 / 3 skipped, skill-synthesis 1537 / 37, persistence-sqlite
    438 / 80, rpc-handlers 3016 / 33, platform-core 781 + 4 todo, shared 1521, thoth-runtime 100, cli-engine 190);
    typecheck "for 13 projects"; lint "for 11 projects" 0 errors; degradation-audit exit 0 TOTAL 303; XB1
    skill-synthesis 202/202 both bindings, persistence-sqlite 83 (9 native-probe skips on node:sqlite). Greps clean.

    | Metric | Batch 7 | Batch 8 | Batch 9 |
    | --- | --- | --- | --- |
    | Examined / ticks | 2,418 / 13 | 2,418 / 13 | 2,418 / 13 |
    | Kept evidence / verdict / degraded | 120 / 174 / 265 | 109 / 174 / 265 | 122 / 174 / 265 |
    | Kept root unknown (run-summed) | n/a | 1,553 | 0 |
    | Rejected no evidence | 0 | 0 | 0 |
    | Rejected unreadable (persisted) | 1,859 | 317 | 1,857 |
    | ...of which no transcript (run-summed subset) | n/a | n/a | 1,540 |
    | Deferred on error / invocations deleted | 0 / 2,424 | 0 / 2,424 | 0 / 2,424 |
    | Tick wall ms min / median / max | 18 / 29 / 1,007 | 16 / 25 / 916 | 105 / 200 / 992 |

  - Identity: 2,418 - (122+174+265+0+1,857+0+0) = 0. The 13 Batch 8 file-on-disk candidates moved to kept evidence;
    the other 1,540 moved to reject-no-transcript. Independent existence check: 0 of the 1,540 (and 0 of the 317) have
    a transcript file on disk.
  - Lookup cost (R-TL15): per-lookup median <= 1.82 ms, max 7.14 ms; far below the 5,000 ms escalation line. No
    escalation.
- Minor items recorded, not fixed: none open from the 9.2 review (all three addressed in revise round 1). Carried
  observation: `rejectedNoTranscript` and `keptRootUnknown` are per-run only (migration 0045 frozen); rows stay
  separable through `rejected_reason`.

Source: `context.md` "Conversation Summary" 2026-09-17 (binding user decision 3). No architect revision: a narrow
extension of Component 4 (cleanup) plus ONE additive read method on the agent-sdk reader the lib already injects. The
extractor is not touched (phase 5 territory); the lookup reads through `extract`'s existing `transcriptPath` parameter.

- Recommended executor: 9.1 — codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`); 9.2 — reviewer of a
  different family from 9.1's implementer; 9.3 — senior-tester SUBAGENT, never a lane (HANDOFF rule 5).
- Fallback executor: backend-developer subagent for 9.1 (a lane that fails twice is dropped); none for 9.3.
- Execution mode: **sequential, 9.1 -> 9.2 -> 9.3.** One implementation task: agent-sdk method, locator, service,
  types, job summary and their specs are one dependency chain (the service spec needs the locator; the locator needs
  the reader method; the job spec needs the report field).
- Reviewer (9.2): 9.1 on codex -> code-logic-reviewer SUBAGENT (Claude family, implemented nothing). 9.1 fell back to
  a Claude subagent -> codex lane `role: 'code-logic-reviewer'`. Deliverable `T\code-logic-review-batch-9.md`, marker
  `T\review-9.done`. Scope includes the seam (hexagonal) check below, not only logic.
- Commits (team-leader, after the review): (1) `feat(agent-sdk,skill-synthesis,thoth-runtime,cli-engine): batch 9 -
  look up backlog transcripts by session id` (9.1 files); (2) `docs(task-specs): record TASK_2026_461 batch 9` after
  9.3.
- Tasks: 3 | Depends on: Batch 8 (committed `087667a92`)
- Report: `T\batch-9-report.md`, sections `## Task 9.1`, `## Task 9.3` (each executor appends only its own). Markers:
  `T\batch-9.1.done`, `T\batch-9.done` (one line: ISO timestamp + `DONE` or `BLOCKED: <reason>`), each LAST.
  Executors never edit `batches.md` and never commit.

### Batch 9 plan validation

Status: PASSED WITH RISKS

Seam decision (hexagonal constraint), verified against the code at `087667a92`:

- In skill-synthesis's dependency graph the transcript root is known ONLY to agent-sdk's `JsonlReaderService`:
  `findSessionsDirectory` joins `os.homedir()/.claude/projects`
  (`agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:214-216`). It reaches skill-synthesis through
  `SDK_TOKENS.SDK_JSONL_READER` (`agent-sdk/src/lib/di/tokens.ts:63`, registered `agent-sdk/src/lib/di/register.ts:136`),
  injected into `TrajectoryExtractor` (`skill-synthesis/src/lib/trajectory-extractor.ts:4,109-113`).
- No existing by-id or projects-root API: the reader's public surface is `findSessionsDirectory` (`:214`),
  `readJsonlMessages` (`:386`), `readJsonlTail` (`:526`), `projectJsonlLines` (`:605`), `loadAgentSessions` (`:769`).
- By-id lookups exist in OTHER libs, each with its own path literal and not injectable: messaging-gateway
  `session-resumability.ts:35-57`, rpc-handlers `session-rpc.handlers.ts:1280,1322`. Copying one would add another
  literal. skill-synthesis production has NO `.claude/projects` literal today (grep); keep it at zero.
- The file-name convention `<dir>/<sessionId>.jsonl` already lives in skill-synthesis (`trajectory-extractor.ts:166`),
  and `extract` already reads an exact path when `transcriptPath` is given (`:154-155`). `extract(sessionId, '', floor,
  path)` is safe: `compileWorkspacePattern('')` returns `null` (`:392-393`), so no normalization regex is built.
- skill-synthesis already mirrors this reader structurally (`archaeology/transcript-window.reader.ts:98-105`,
  `TranscriptJsonlReader`).
- **Chosen seam:** ONE additive public method on `JsonlReaderService`: `listSessionsDirectories(): Promise<string[] |
  null>` — absolute paths of the IMMEDIATE child directories of the projects root (one `readdir` with file types,
  directories only, no recursion); `null` when the root is absent or cannot be listed. The root join becomes one
  private helper shared with `findSessionsDirectory` (no behaviour change there). No cache in agent-sdk (its CLAUDE.md
  rule: a cache needs a token AND a bound); the per-run cache lives in skill-synthesis. skill-synthesis consumes it
  through a LOCAL structural port with the method OPTIONAL, so a reader without it is detected, not a crash.
- Verdict: not a BLOCKER. The skill-synthesis -> agent-sdk edge already exists; no adapter import, no path literal in
  skill-synthesis, extractor unchanged (not phase 5).

Counter decision (migration 0045 frozen) — **recommended and planned: count in the persisted
`rejected_transcript_unreadable` column, plus a report-only subset counter `rejectedNoTranscript`.** The distinct
reason `backlog-cleanup: no transcript found for any session` is written to `skill_candidates.rejected_reason`
(`skill-backlog-cleanup.store.ts:141-150`), so rows stay separable by query. Why not report-only alone: the ~1,540
rejections would be missing from the durable state row after completion, and the persisted identity would need a
third run-summed term. With this choice the identity is unchanged: persisted kept (3) + persisted rejected (2) +
run-summed `keptRootUnknown` + run-summed `deferredOnError` = `examined`; `rejectedNoTranscript` is a per-run SUBSET of
`rejectedTranscriptUnreadable` and is NOT added in the identity. The job summary's `rejected` already sums the
persisted column (`thoth-runtime/src/lib/skill-backlog-cleanup-job.ts:80-88`); it appends `, no transcript N`.

Assumptions:

- A9 — the lookup runs ONLY when, after the Batch 8 root loop, `attempted === false` (no session resolved a root) and
  no verdict exists. Any resolved root keeps the Batch 8 rule unchanged.
- A10 — empty `sourceSessionIds` stays `kept-root-unknown` (no id to look up = the search could not run; "not found for
  any session" is not taken as vacuously true). Pinned by the existing Batch 8 spec, which must stay green.
- A11 — "lookup cannot run" is detected three ways, each yielding `unavailable`, never `absent`: (a) the injected reader
  has no `listSessionsDirectories` function; (b) it returns `null`; (c) for a session, a `stat` fails with a code other
  than `ENOENT` / `ENOTDIR` in some folder and no folder had the file. A session id that is not a plain file-name
  token (contains `/`, `\`, `..`, or is empty) is also `unavailable` (no stat, never a traversal).
- A12 — candidate outcome on the lookup path: any found transcript read with evidence -> `kept-evidence`; else any read
  returned a trajectory -> `reject-no-evidence`; else any found transcript was read and returned `null` ->
  `reject-unreadable`; else any session `unavailable` -> `kept-root-unknown`; else (every session `absent`) ->
  `reject-no-transcript`.
- A13 — the byte copy's candidates are measured against the LIVE `~/.claude/projects` (41 child folders on
  2026-09-17), as in Batches 7 and 8; the corpus moves daily, so "13" and "~1,540" are expectations, not assertions.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-TL15 Lookup cost: worst case distinct session ids x folders stats (~1,540 x 41, about 63k) over 13 ticks on the main thread | MEDIUM | Listing once per run, stop at first hit, per-run session cache, `stopReason` still checked between candidates; 9.3 records listings, stats, cache hits, lookup ms per tick. If median lookup ms per tick > 5,000, team-leader raises a readdir-index alternative to the orchestrator (not in scope now) |
| R-TL16 A transient stat error turns into a rejection | HIGH | A11(c): non-ENOENT/ENOTDIR -> `unavailable` -> kept; spec with a stubbed `EBUSY` |
| R-TL17 A new public method on `JsonlReaderService` breaks a typed fake that is not cast | LOW | 9.1 greps `JsonlReaderService` over `libs` + `apps` and typechecks every project with an uncast typed object |
| R-TL18 Reachability proof's fake reader lacks the method | LOW | A11(a) -> `unavailable` -> no behaviour change; reachability 5/5 both bindings |
| R-TL19 `SkillBacklogCleanupService` constructor reaches 8 injected deps | LOW | At, not past, the ~8 guardrail; the locator is one named collaborator (`SessionTranscriptLocator`), not a fragment |
| R-TL20 Path traversal through a session id | MEDIUM | A11 token check before any `path.join`; spec |

Edge cases:

- Root unknown, file found in a later folder, evidence -> kept-evidence; stats stop at the hit — Task 9.1
- Root unknown, found, no evidence -> reject-no-evidence; found, `extract` null -> reject-unreadable — Task 9.1
- Root unknown, every session absent in every folder -> reject-no-transcript with the exact reason — Task 9.1
- Projects root missing / reader without the method / stat EBUSY -> kept-root-unknown, no rejection — Task 9.1
- `<sessionId>.jsonl` exists as a DIRECTORY -> not a hit (`isFile()` false) — Task 9.1
- Two candidates sharing a session id in one run -> one listing, second locate is a cache hit — Task 9.1
- Any session with a resolved root -> lookup never called; verdict -> lookup never called — Task 9.1
- Empty `sourceSessionIds` -> kept-root-unknown, lookup never called — Task 9.1

### Task 9.1: Look up root-unknown transcripts by session id (decision 3) — COMPLETE

- Files:
  - MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.ts` — private projects-root helper
    used by `findSessionsDirectory` (`:214-216`) and new public `listSessionsDirectories(): Promise<string[] | null>`
    (readdir with file types, directories only, absolute paths, no recursion, no cache; `null` on absent root or any
    listing error, with a `// degradation-audit: optional-capability - ...` marker on the catch).
  - MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.spec.ts` — absent root -> `null`;
    files filtered out, directories returned as absolute paths; readdir throws -> `null`. Follow the file's
    `jest.mock('fs/promises')` / `os` pattern (`:36-52`).
  - MODIFY `W\libs\backend\agent-sdk\CLAUDE.md` (reader cache bullet near `:86`) — the method, uncached by design.
  - CREATE `W\libs\backend\skill-synthesis\src\lib\cleanup\session-transcript-locator.ts` — local structural port
    `SessionsDirectoryLister { listSessionsDirectories?(): Promise<readonly string[] | null> }`; `@injectable()` class
    `SessionTranscriptLocator` with `@inject(SDK_TOKENS.SDK_JSONL_READER)`; `createRunLookup()` returns a per-run
    object: `locate(sessionId): Promise<{ kind: 'found'; path: string } | { kind: 'absent' } | { kind: 'unavailable' }>`
    and `stats(): { directoryListings; pathStats; cacheHits }`. Listing taken lazily once per lookup object (`null`
    memoised too); per folder in listing order `fs.promises.stat(path.join(dir, sessionId + '.jsonl'))`: `isFile()`
    -> found (stop); `ENOENT` / `ENOTDIR` -> next folder; other error -> remember, next folder (marker comment); end ->
    remembered error ? unavailable : absent. Every result (all three kinds) cached by session id; a repeat increments
    `cacheHits`. A11 token check first. No file content is opened.
  - CREATE `...\cleanup\session-transcript-locator.spec.ts` — REAL temp dirs (fail-if-exists `fs.mkdtempSync` under
    `os.tmpdir()`, prefix not starting with `ptah`, removed in `afterEach`) and a fake lister: found in folder 2 of 3
    (pathStats 2); absent everywhere (pathStats 3); lister returns `null` -> unavailable, 0 stats; lister without the
    method -> unavailable; `<id>.jsonl` directory -> absent; stubbed `stat` rejecting `EBUSY` -> unavailable; `../x`,
    `a/b`, `''` -> unavailable, 0 stats; same id twice -> cacheHits 1, directoryListings 1, pathStats unchanged.
  - MODIFY `...\cleanup\skill-backlog-cleanup.service.ts` — inject `SessionTranscriptLocator`; `execute` creates ONE
    lookup per run and passes it to `evaluateCandidate`; after the Batch 8 root loop, when `!attempted` and
    `sourceSessionIds.length > 0`, run the A12 lookup path, reading found files with `extractor.extract(sessionId, '',
    MIN_ROLE_TURNS_FLOOR, found.path)`; new disposition `'reject-no-transcript'`, constant `REJECT_NO_TRANSCRIPT =
    'backlog-cleanup: no transcript found for any session'`, pushed as a rejection; `countDisposition` adds it to
    `rejectedTranscriptUnreadable`; `RunProgress.rejectedNoTranscript` incremented; `runCounters` returns it; log the
    run's lookup `stats()` once at debug when the run ends. Verdict early-return and the Batch 8 rule unchanged.
  - MODIFY `...\cleanup\skill-backlog-cleanup.types.ts` — `BacklogCleanupRunCounters.rejectedNoTranscript: number`
    with doc: per run, not persisted, a subset of `rejectedTranscriptUnreadable`, not added in the identity; restate
    the identity.
  - MODIFY `...\cleanup\skill-backlog-cleanup.service.spec.ts` — found-by-lookup with evidence -> kept-evidence (assert
    `extract` args); found without evidence -> reject-no-evidence; found + `extract` null -> reject-unreadable; all
    absent -> reject-no-transcript (reason exact, `rejectedTranscriptUnreadable` +1, `rejectedNoTranscript` 1,
    `keptRootUnknown` 0); absent + unavailable -> kept-root-unknown; lookup unavailable -> kept-root-unknown, `extract`
    not called; resolved root -> locator not called; verdict -> not called; empty ids -> not called; two candidates
    sharing a session id in one run -> one listing and one cache hit. Existing Batch 8 root-unknown cases: give them
    an unavailable lookup so their assertions hold, and say so in the report.
  - MODIFY `...\cleanup\skill-backlog-cleanup.integration.spec.ts` — real SQLite, locator over a fake lister pointing
    at temp dirs: NULL root + transcript with edit evidence -> stays `candidate`; NULL root + no file anywhere ->
    `status='rejected'`, `rejected_reason` = the new reason, persisted counter +1, report `rejectedNoTranscript` 1;
    NULL root + lister `null` -> stays `candidate`, `keptRootUnknown` 1. Explain every changed expectation.
  - MODIFY `W\libs\backend\skill-synthesis\src\lib\di\register.ts` (`:66-68`) —
    `registerSingleton(SessionTranscriptLocator)`; `di\register.spec.ts` still resolves the cleanup service (`:58-63`).
  - MODIFY `W\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.ts` (`summarizeCleanup` `:80-88`) — append
    `, no transcript ${report.rejectedNoTranscript}`; `rejected` unchanged. MODIFY `skill-backlog-cleanup-job.spec.ts`
    fixture + expected summary. MODIFY `W\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts` fixture
    (`rejectedNoTranscript: 0`).
  - MODIFY `W\libs\backend\skill-synthesis\CLAUDE.md` (backlog cleanup bullet) and `W\libs\backend\thoth-runtime\CLAUDE.md`
    (job bullet). Grep `backlog` in `W\apps\ptah-docs\src\content\docs\skill-synthesis`; update only if it describes
    cleanup dispositions (no trademarked product names).
- Constraints: no `.claude` / `projects` path literal in skill-synthesis production; no change to
  `trajectory-extractor.ts`, migration 0045, `SkillBacklogCleanupStore`, settings keys or UI. Every new catch carries a
  `// degradation-audit:` marker; `catch (error: unknown)`.
- Acceptance: AC-9.1a locator, service and agent-sdk cases above pass; AC-9.1b integration spec AND reachability 5/5,
  0 skipped, under BOTH bindings (node:sqlite via `run-many`; better-sqlite3 via Electron-as-Node jest); AC-9.1c
  `run-many -t test` and `-t lint` for agent-sdk, skill-synthesis, thoth-runtime, cli-engine ("for 4 projects");
  `run-many -t typecheck` for those 4 + rpc-handlers, ptah-electron, ptah-cli + every project the R-TL17 grep adds
  (paste grep + header count); degradation-audit exit 0 at baselines (skill-synthesis <= 6, cli-engine <= 12,
  thoth-runtime 0, agent-sdk unchanged), never `--update-baseline`.
- Mutations (paste fail output + restore output + `git diff --stat`, or the file list if git is forbidden):
  **9.1-mutA** the all-absent branch returns `'kept-root-unknown'` -> service all-absent case and integration no-file
  case fail. **9.1-mutB** the per-run cache never hits -> cache-hit cases fail. **9.1-mutC** a non-ENOENT stat error
  treated as absent -> EBUSY case fails.

### Task 9.2: Review of 9.1 (different family) — COMPLETE

- Depends on: Task 9.1 returned, `batch-9.1.done` DONE, team-leader verified files on disk.
- Scope: logic (A9-A12, R-TL15 to R-TL20, counters on every report path, cursor still advances past every
  disposition) AND the seam: no path literal in skill-synthesis, agent-sdk method uncached and one level only,
  extractor untouched, optional-member detection in the local port. Deliverable `T\code-logic-review-batch-9.md`
  (verdict, score, file:line), marker `T\review-9.done`. Revise cap 2 rounds.

### Task 9.3: Re-verification and byte-copy re-measurement (senior-tester only) — COMPLETE

- Depends on: 9.2 APPROVED. Changes no code.
- Before every heavy run: no live `jest` / `nx run-many` process (wait). `NX_DAEMON=false`, binaries from
  `D:\projects\ptah-extension\node_modules`. Never `nx reset`, never `--update-baseline`. Never launch `electron.cmd`
  without the jest script argument (Batch 8 slip).
- Verification: the Task 8.3 sets PLUS `@ptah-extension/agent-sdk`: test "for 9 projects", typecheck "for 13
  projects", lint "for 11 projects"; degradation-audit lines; XB1 both bindings with the 8.3 skill-synthesis pattern
  plus `session-transcript-locator`, and the 8.3 persistence-sqlite pattern. Greps: `.claude` over skill-synthesis
  production (0 new), `listSessionsDirectories` over `libs` (reader, its spec, locator and its specs only),
  `rejectedNoTranscript` over `libs`. Corpus re-measurement NOT required (prefilter predicate unchanged since Batch 8).
- Byte-copy re-measurement: HANDOFF rule 5 / Task 8.3 procedure verbatim (fresh fail-if-exists temp dir not starting
  with `ptah`, `COPYFILE_EXCL`, six pragmas read back, only the copy opened, real service stack built by hand now
  including a real `SessionTranscriptLocator` over the real `JsonlReaderService`, temp harness spec deleted after one
  run, temp dir removed and proven gone, source size + mtime unchanged). Report:
  - Batch 7 / 8 / 9 table: examined, ticks, kept evidence / verdict / degraded, rejected no evidence, rejected
    unreadable (persisted), `rejectedNoTranscript` (run-summed AND the count of rows with the new reason in the copy),
    `keptRootUnknown` (run-summed), deferred, invocations deleted; identity check.
  - Where the Batch 8 "13 with a file on disk" land (count per disposition) and where the ~1,540 land (expected
    `reject-no-transcript`); any `keptRootUnknown` left, with its A11 cause counted (no ids).
  - Lookup cost per tick via a proxy around `createRunLookup`: directory listings, path stats, cache hits, lookup ms
    (min / median / max) and tick wall time; flag R-TL15 if median lookup ms per tick > 5,000.
- Report `T\batch-9-report.md` `## Task 9.3` (counts and timings only; no session ids, paths or transcript content);
  `git status --short` proving no harness remains; marker `T\batch-9.done` LAST.

### Batch 9 verification

- 9.1 files exist with real code; mutA/B/C pasted fail + restore; integration + reachability both bindings; header
  counts 4 / 4 / N.
- 9.2 accepting verdict from a different family.
- 9.3 headers 9 / 13 / 11; degradation audit at baselines; Batch 7 / 8 / 9 comparison with safety proofs.
- `batch-9.done` written last.

---

## Completion (Mode 3, team-leader, 2026-09-17)

Status: ALL 9 BATCHES COMPLETE, 24/24 tasks COMPLETE. Every batch SHA is an ancestor of HEAD (`git merge-base
--is-ancestor`). Base `97239e814` = `git merge-base origin/main HEAD`. Branch diff: 118 files (80 outside `.ptah`);
every path outside `.ptah` exists on disk except the two intended Batch 5 deletions
(`naming/candidate-namer.service.ts` and its spec).

### Commits on the branch since origin/main (oldest first)

| Batch | Commit | Subject |
| --- | --- | --- |
| 2 | `d72d1493e` | feat(persistence-sqlite): batch 2 - migration 0045 skill backlog cleanup state |
| 1 | `fdff9b105` | feat(skill-synthesis): batch 1 - manual promote path, evidence-only prefilter, drop creation invocation |
| docs | `53224575d` | docs(task-specs): file TASK_2026_461 phase 3 spec and record batches 1-2 |
| 3 | `a20cfa1b1` | refactor(skill-synthesis-ui,rpc-handlers,shared,platform-core): batch 3 - drop dead depth settings |
| 4 | `e420f1b5d` | feat(skill-synthesis): batch 4 - resumable backlog cleanup and gate skip for rejected |
| docs | `bb887ef40` | docs(task-specs): record TASK_2026_461 batches 3-4 and carry review items to batch 5 |
| 5 | `625b3861c` | feat(skill-synthesis,thoth-runtime,cli-engine,docs): batch 5 - backlog cleanup job, drop namer |
| docs | `55dba650c` | docs(task-specs): record TASK_2026_461 batch 5 and refresh batch 6 against shipped code |
| 6 | `83002016f` | test(skill-synthesis): batch 6 - reachability proof for manual promote and evidence prefilter |
| docs | `c4ee77453` | docs(task-specs): record TASK_2026_461 batch 6 and refresh batch 7 against shipped code |
| 7 | `c4f9c4df8` | test(skill-synthesis): batch 7 - track transaction state in the reachability node:sqlite adapter |
| docs | `4b8e4de87` | docs(task-specs): record TASK_2026_461 batch 7 and plan batch 8 |
| 8 | `087667a92` | feat(skill-synthesis,thoth-runtime,cli-engine,docs): batch 8 - non-MCP tool evidence, keep root-unknown backlog candidates |
| docs | `ca857afaf` | docs(task-specs): record TASK_2026_461 batch 8 and plan batch 9 |
| 9 | `b7da25171` | feat(agent-sdk,skill-synthesis,thoth-runtime,cli-engine): batch 9 - look up backlog transcripts by session id |
| docs | (this record) | docs(task-specs): record TASK_2026_461 batch 9 and phase 3 completion |

### Reviews per batch

| Batch | Reviewer family | Verdict |
| --- | --- | --- |
| 1 | Ollama Cloud lane | CHANGES_REQUESTED 7/10 -> revise 1 accepted |
| 2 | Ollama Cloud lane | APPROVED 8/10 (+ revise before freeze) |
| 3 | Ollama Cloud lane | APPROVED 8/10 |
| 4 | Ollama Cloud lane | CHANGES_REQUESTED 7/10 -> revise 1 accepted |
| 5 | Ollama Cloud lane | APPROVED 9/10 (+ revise 1 on a Claude subagent) |
| 6 | Claude subagent | APPROVED 8/10 |
| 7 | none (test-support only; team-leader line-by-line read, orchestrator accepted) | accepted |
| 8 | Claude subagent | APPROVED 9/10 |
| 9 | Claude subagent | CHANGES_REQUESTED 6/10 -> revise 1 accepted (mutation-proven) |

### Acceptance criteria (implementation-plan.md:563-577)

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 Manual Promote bypasses only the threshold | MET | `skill-promotion.service.spec.ts`; proof group 5; M1, M5 fail (batch-6-report.md) |
| AC2 Manual path keeps dedup, judge, replay, cap, write gates | MET | `skill-promotion.service.spec.ts`; Batch 1 revise: residency demotion after write, manual cluster-dedup pinned |
| AC3 Automatic `evaluate` keeps `below-threshold` | MET | proof group 4 (zero judge calls); spec |
| AC4 No invocation row at candidate creation | MET | proof group 3 (`skill_invocations` = 0); M3 fails |
| AC5 Conversation-only session produces nothing | MET | proof group 3 (`s-chat` skipped, no chained rows); M2 fails |
| AC6 Edit-only, tool-only, test-only sessions stay eligible | MET (tool evidence narrowed to non-MCP by decision 1) | `session-work-evidence.spec.ts`; 8.1-mut fails |
| AC7 Cleanup rejects no-evidence, no-verdict with visible reason; keeps the rest | MET (extended by decisions 2 and 3) | `skill-backlog-cleanup.integration.spec.ts` both bindings; 8.2-mut, 9.1-mutA/D fail |
| AC8 Cleanup deletes only `context_id IS NOT NULL` invocations | MET | store + integration specs; byte copy 2,424 deleted, tracker rows survive (measurement "Tracker-row survival") |
| AC9 Cleanup resumable, gated, bounded | MET | `skill-backlog-cleanup.service.spec.ts` (partial / abort / wall budget / 200 cap); 13 ticks on the byte copy |
| AC10 Job registered in Electron and CLI hosts | MET | `start-thoth-cron.spec.ts`, cli-engine `thoth-runtime.spec.ts`; AC10-mut-E (batch-5-report.md) |
| AC11 Gate stages skip rejected candidates | MET | `skill-synthesis.stage-handlers.spec.ts` (Task 4.4) |
| AC12 Namer deleted, DI complete | MET | `di/register.spec.ts` (singleton case, mutation killed); grep `CandidateNamerService` over libs/apps = 0 |
| AC13 Registration seam reaches the drain | MET | proof group 3; M4 fails |
| AC14 `degradation-audit:lint` at baseline | MET | Batch 9.3 + revise: exit 0, skill-synthesis 6, cli-engine 12, agent-sdk 4, thoth-runtime 0, TOTAL 303; never `--update-baseline` |
| AC15 Measurement report with Component 8 numbers | MET | `backlog-cleanup-measurement.md` (Batch 7, 8, 9 sections); `test-report.md` (corpus) |

### Reachability proof (Batch 6, AC1/3/4/5/13)

`skill-synthesis.reachability.integration.spec.ts` + `.test-support.ts`: production `registerSkillSynthesisServices`
in a child container, real `SqliteConnectionService` + migrations through 0045, fake host tokens only (10), captured
session-end callback -> frequent drain -> prefilter -> manual promote to `promoted` with SKILL.md on disk. 5/5 under
node:sqlite AND better-sqlite3 at Batches 6, 7, 8 and 9 (0 skipped). Mutations, each failed then restored: M1 promote
calls `evaluate`; M2 `depthOk` restored; M3 creation-time `recordInvocation` restored; M4 stage-handler registration
removed; M5 manual path applies the threshold. Batch 7.4 made the node:sqlite adapter track `inTransaction`.

Other mutation kills on the branch: Batch 1 revise (demotion before write), Batch 2 revise (`started_at` NOT NULL),
Batch 4 revise (catch -> reject), Batch 5 revise (`registerSingleton` -> `register`, AC10-mut-E), 8.1-mut, 8.2-mut,
9.1-mutA/B/C/D.

### User decisions

1. (Batch 7 finding, 2026-09-16) Tool evidence counts only non-MCP tools (`mcp__*` excluded), threshold 2 -> Batch 8.1.
   Corpus: removes 11 of 1,622 eligible sessions.
2. (Batch 7 finding, 2026-09-16) Unresolvable workspace root keeps the candidate (`kept-root-unknown`); reject as
   unreadable only when a read was attempted -> Batch 8.2.
3. (Batch 8 finding, 2026-09-17) Root-unknown candidates look up `<sessionId>.jsonl` by id; not found anywhere ->
   reject `backlog-cleanup: no transcript found for any session` -> Batch 9. Result: 13 kept evidence, 1,540 rejected,
   0 left unknown, 0 false rejections by independent check.

Gate 2 decisions D1a-D6a and item 4d as recorded in `context.md`.

### Risk resolution

| Risk | Resolution |
| --- | --- |
| R1 wrong cleanup predicate loses candidates | Conservative predicate + decisions 2/3; byte copy x3; independent existence check 0 false rejections; searchable reasons |
| R2 tool evidence broad | Narrowed to non-MCP (decision 1); Read/Grep still count (M1 follow-up below) |
| R3 automatic promotion impossible | ACCEPTED, phase-5 note (test-report.md); proof group 4 pins it |
| R4 generalization shortcut unreachable | ACCEPTED, phase-5 note |
| R5 `SkillInvocationTracker` registered, unused | ACCEPTED, phase-5 note |
| R6 finished job stays in cron list | ACCEPTED; `skipped: complete` is one state read (Task 5.2 spec) |
| R7 transcript read cost | Per-tick caps; max tick 992 ms, largest read 226 ms (B7) / 31 ms (B9) |
| R8 merge overlap with phase 4 | Open until merge; rebase whichever merges second |
| R9 load flakes | `--parallel=1` used for the heavy verification runs; every final run green |
| R-TL1/2 fixtures, ninth ratchet | Deviations 3-5; suites green |
| R-TL3 proof token set | 10 host tokens recorded; production DI untouched |
| R-TL4 binding divergence | XB1 every batch; identical counts |
| R-TL5 shared worktree | Team-leader re-runs before each commit |
| R-TL6 race between read and write | `AND status = 'candidate'` + spec |
| R-TL7/8 promote return type, `write-failed` | Typecheck green; union extended |
| R-TL9 live DB safety | Byte copy procedure x3, source size + mtime unchanged every run |
| R-TL10-14 (Batch 8) | Fixtures updated; reachability 5/5; identity documented and held; per-run counters accepted |
| R-TL15 lookup cost | Max lookup 7.14 ms; no escalation |
| R-TL16 transient stat error -> rejection | `unavailable` -> kept; 9.1-mutC |
| R-TL17/18 reader fakes | Seven-project typecheck; optional port member; reachability 5/5 |
| R-TL19 constructor deps | Eight, at the guardrail; one named collaborator |
| R-TL20 path traversal | Id token check before `path.join`; spec |
| Batch 4 finding 2 (extractor EBUSY vs ENOENT) | ACCEPTED; measured 0 of 317 unreadable rejections have a file on disk |
| Batch 9 serious (empty listing -> absent) | FIXED revise 1; 9.1-mutD |

### Carried follow-ups (not in this task)

- Phase 5: R3 automatic promotion still impossible (and UI text implies it), R4 generalization shortcut unreachable,
  R5 `SkillInvocationTracker` registered but unused.
- M1 (Batch 8 review): Read/Grep-only sessions still count as tool evidence; candidate to narrow to mutating / test
  tools.
- Batch 3 review: a stale `eligibilityMinTurns` / `prefilterMinChars` left in a user `settings.json` cannot be listed
  or cleared through `ptah config`.
- `keptRootUnknown`, `rejectedNoTranscript` and `deferredOnError` are per-run, not persisted (migration 0045 frozen);
  no cross-run trend.
- Batch 4 finding 2: extractor does not distinguish EBUSY from ENOENT on the root-resolved path.

### Gate 3 requirement

A whole-branch review (`git diff origin/main...HEAD`) by a model family that implemented and reviewed none of this
task. Families used: codex (all implementation), Ollama Cloud (reviews 1-5), Claude subagents (reviews 6, 8, 9;
senior-tester 7, 8.3, 9.3; Batch 5 revise). Unused: **antigravity** -> Gate 3 reviewer. Phase-2 lesson: the branch
review found 3 defects nine batch reviews missed; focus on cross-batch interactions.

## PR 526 review fixes — COMPLETE (fix commit ac8e07377)

- Source: CodeRabbit C1-C7 on PR #526; executor codex lane (pr-526-fixes-report.md); code-logic review
  NEEDS_REVISION 7/10 (S1 uncaught `removeActive`, F3 no UI min(1), F2 undisclosed restart semantics);
  revise round 1 fixed all three, S1-mut killed; orchestrator accepted without second review.
- C1 atomic promotion (`promoteAtomically`, BEGIN IMMEDIATE) + compensating SKILL.md removal; C2 bounded
  process-local cleanup retry (stop twice, count on third); C3 prefilter thresholds >= 1 (reader, RPC schema,
  settings form); C4 closed stop-reason union; C5-C7 task-doc fixes.
- Team-leader verification: full skill-synthesis suite 1545 passed / 37 skipped; typecheck 3 projects green;
  degradation audit skill-synthesis 6, skill-synthesis-ui 5, rpc-handlers 1, cli-engine 12 (baselines unchanged).
