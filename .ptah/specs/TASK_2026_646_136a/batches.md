# Batches - TASK_2026_646_136a

Total tasks: 36 | Batches: 31 | Complete: 8/31

Source: `implementation-plan.md` (integrated; wins over part A and part B) `## Batches` (lines 717-761),
`## Parallel waves` (763-780), `## Assumptions to check first` (782-805); Gate 2 decisions #43-#52
(`decisions.md`); round 6 review `implementation-plan-review-round6.md` (APPROVED, R6-1 carried as a B4 note).
Final user decisions #12, #13, #18 (as amended by #22) and #19 are final and are not reopened by any batch.

Path shorthands (absolute):

- `W` = `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing` (branch
  `feat/decision-model-routing`, draft PR #731). Every executor works only here and never touches `main`.
- `T` = `W\.ptah\specs\TASK_2026_646_136a`
- `LR` = `W\libs\backend\lane-routing\src\lib`
- `LO` = `W\libs\backend\lane-outcomes\src\lib`
- `VLT` = `W\libs\backend\vscode-lm-tools\src\lib\code-execution`
- `J(lib, specs)` = `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`
  (`ptah-cli` and `cli-engine` use `jest.config.cjs`)

## Rules for every batch (repeat verbatim in every lane and subagent prompt)

1. Work only in `W`. Do not create git commits, branches, stashes or pushes; the team-leader owns git.
2. Do not edit `batches.md` or `task.md`. Report task completion and evidence instead.
3. Verify only the changed project(s): `npx nx test <project> --parallel=1`, `npx nx typecheck <project>`,
   `npx nx lint <project>`, or `J(lib, specs)` on the changed specs. Several projects:
   `npx nx run-many -t test -p A B --parallel=1`, and confirm the header says
   "Running target test for N projects" with N equal to the number requested. Never positional `nx test A B`.
4. Never run workspace-wide checks. Never run `build`, `serve`, `dev`, `e2e` or `package` targets.
5. `--parallel=1` for Nx, `--maxWorkers=2` for Jest. One heavy check at a time across ALL lanes: the
   orchestrator serializes verification; a lane waits for the go-ahead before any Nx/Jest run.
   One foreground run with a long timeout; filter output (`| tail -40`, `grep`) instead of re-running.
6. Real code only: no stubs, placeholders, TODO markers, empty bodies, mock data standing in for logic.
7. Resolve every assumption this batch owns (see the Assumptions table) BEFORE writing code, and record
   the result with `file:line` evidence in the report.
8. DI guard rule (Gate 0.1 instruction): a batch that registers a DI service, an RPC method or an MCP tool
   in a registration function that a host already calls updates the matching phased guard specs
   (`apps/*/src/di/expected-resolvable.ts`, `apps/{ptah-extension-vscode,ptah-electron,ptah-cli}/src/di/container.smoke.spec.ts`,
   `apps/{ptah-extension-vscode,ptah-electron}/src/di/rpc-surface.spec.ts`,
   `apps/{ptah-extension-vscode,ptah-electron}/src/di/surface-composition.spec.ts`,
   `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`, `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`)
   in the same batch, and runs those guard specs with Jest, one at a time, after the lib check. If a guard spec
   fails only because a dependency is registered by a later batch, STOP and report it; do not edit around it.
   The team-leader then moves the registration line to the batch that registers the dependency.
9. New libs carry Nx tags `scope:extension`, `type:feature` and keep the graph acyclic:
   `lane-routing -> { shared, platform-core }` only; `lane-outcomes -> { shared, platform-core,
   persistence-sqlite, agent-sdk }` only; the two libs never import each other (plan lines 24-31, decision I1).
   Neither imports `vscode-core` (SC-9).
10. Return: every created or modified file by absolute path, per-task evidence, each assumption result,
    how each listed risk was handled, and the tail of each verification run.

Lane spawn notes (TASK_2026_663_50d4 defects): every lane spawn passes explicit `deliverables` with an absolute
report path, `T\reports\batch-<N>-report.md`; `workingDirectory` = `W`. Codex resume fails after 600 s idle, so a
codex respawn always gets the full brief (batch section, plan refs, rules above), never a bare resume.

Commit convention (team-leader, Mode 2): foreground `git commit`, Conventional Commits per `.commitlintrc.json`
(subject at most 72 chars, body lines at most 100, wrapped at 72; `security` and `git` are not scopes),
e.g. `feat(lane-routing): batch 1 - lane-routing scaffold`. Multi-scope `feat(shared,rpc-handlers): ...` allowed.
Push in the background after commit (pre-push runs di-lint and Electron `validate-deps`; a failed gate gets a fix
commit on top).

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- Migrations 0054/0055 are free — verified: latest on this branch and on `origin/main` is
  `0053_memory_boot_scan_failure_generation.ts`; branch contains `origin/main` (c57a9a1e7). Re-checked by
  Batch 4 before commit.
- `libs/backend/lane-routing`, `libs/backend/lane-outcomes`, `lane-family.ts`, `lane-outcome.types.ts` do not
  exist yet — verified on disk; all are true CREATEs.
- `tsconfig.base.json` is touched only by A2 (wave 1) and B4a (wave 2) — verified from the plan rows.
- Commitlint `scope-enum` lacks `lane-routing` and `lane-outcomes` — verified (grep of `W\.commitlintrc.json`,
  no match). Batch 1 and Batch 6 add them (RISK R-3).
- `cli-engine` and `ptah-cli` use `jest.config.cjs`, the two app hosts use `jest.config.ts` — verified on disk.
- A11 adds no new RPC method (it rides `agent:getConfig`/`agent:setConfig`, part A D5, part-a:951) — verified.
- `lane-routing` must import only `shared` + `platform-core` so `agent-sdk -> lane-routing` (A13) closes no
  cycle (plan lines 24-31) — unverified until code exists; checked by `nx lint` in Batches 1, 5, 21, 27 and by
  Batch 19 (A13).
- A6b's probe may reuse A6a's System One client — unverified; mitigated by running Batch 11 (A6a) before
  Batch 12 (A6b) on the same lane.
- TASK_2026_658 (`.ptah/specs/TASK_2026_658_advanced_settings`, no `task.md`) may overlap A12's chat settings
  files — unverified; Batch 22 checks first (plan row A12).
- Plan-owned assumptions PA-1..PA-5, PB-1..PB-6, IA-1..IA-5 — each owned by the batch in the table below.

| Assumption | Owning batch (plan id) | Fallback if false |
| --- | --- | --- |
| PA-1 `registerSharedRpcHandlers` runs in all three containers | Batch 14 (A10); re-used by Batch 25 (B7) | Batch 30 (AB14) registers both directly in `cli-engine` `container.ts` |
| PA-2 host-neutral `~/.ptah` home helper | Batch 16 (A4b) | Batch 30 injects the path string per root |
| PA-3 `InternalQueryService` per-call provider/model + `outputFormat` | Batch 19 (A13) | structured output limited to the main provider |
| PA-4 `ptahAPI.agent.listRoles()` returns workspace role names | Batch 26 (A9a) | report; namespace builder lists none |
| PA-5 plugin asset skill copy is the harness sync source | Batch 31 (A15) | also edit the synced copies |
| PB-1 `SubagentStopPayload.agentId` unique per run | Batch 20 (B4c) and Batch 24 (B6) | `subagentSessionId` as `run_id` |
| PB-2 budget monitor can publish the stopped `agentId` | Batch 3 (B3) | report as BLOCKER |
| PB-3 nested subagent Skill events carry a matchable session id | Batch 24 (B6) | `skillsLoaded: null` for subagents |
| PB-4 `AgentProcessInfo.role` holds the slug | Batch 23 (B5); acceptance in Batch 8 (B8) | report |
| PB-5 notifier deliverable check is liftable | Batch 23 (B5, export) | consumed by Batch 28 (B10a) |
| PB-6 `CallbackRegistryBase` isolates a throwing listener | Batch 3 (B3) | wrap listener calls in try/catch |
| IA-1 spawn-args → `SpawnAgentRequest` mapping lives outside `protocol-dispatcher.ts` | Batch 7 (A1b) | that line moves to Batch 29 (AB9) |
| IA-2 ptah-cli `quotaOwner.providerId` equals row `providerId` | Batch 23 (B5) | carry `providerId` on `AgentProcessInfo` at spawn |
| IA-3 `useToken` aliases resolve under `isRegistered(token, true)` | Batch 30 (AB14) | report |
| IA-4 Agent tool result shows `agentId` = SubagentStop `agent_id` (optimisation only) | Batch 28 (B10a), Batch 31 (A15) | skill uses the Ptah run tag (SC-7) |
| IA-5 PostToolUse fires for main-thread `Agent`/`Task` with `tool_use_id` = registry `toolCallId` | Batch 3 (B3) | tag from `tool_response.agentId`; or monitor withdraw-to-user-turn route (`subagent-budget-monitor.ts:49-51`) |

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-1 Plan batch B4 (lane-outcomes: stores, SC-10 pipeline, journal, holds, recorder, reader, DI) is far beyond one lane sitting; a single lane timing out loses the whole lib | HIGH | Split into Batch 6 (B4a), Batch 15 (B4b), Batch 20 (B4c), same lane family, full brief each spawn (decision TL-1) |
| R-2 The split puts the part B chain B4a→B4b→B4c→B5→B10a→AB9 on a second 8-wave critical path | MEDIUM | Those batches take the first slot of each wave (in-flight order per wave below) |
| R-3 Commitlint `scope-enum` has no `lane-routing` / `lane-outcomes`; commits under those scopes fail | MEDIUM | Task 1.1 adds `lane-routing`, Task 6.1 adds `lane-outcomes` to `W\.commitlintrc.json` |
| R-4 R6-1 (decision #52): readable-store hold capacity counts expired rows until the 60 s sweep | MEDIUM | Task 6.1 (store query `expires_at > now`, delete-expired-before-insert API) + Task 15.2 acceptance fixture |
| R-5 Adding `agent:outcomeSignals` to `RPC_METHOD_NAMES` (AB1) changes the host RPC-surface partitions before any handler exists (B7) | MEDIUM | Task 2.2 runs the five RPC guard specs; if one fails only for the missing handler, the method/capability entry moves to Batch 25 (rule 8). **Resolved at Batch 2 verify (2026-10-15):** the entry STAYS in Batch 2 (Batch 8 depends only on Batch 2 and calls `'agent:outcomeSignals'` through the typed registry; plan part B :106 puts the registry entry in AB1). The R-5 guard-spec check moves to Batch 25. Known red until Batch 25 commits, each by exactly the one method `'agent:outcomeSignals'` (422 expected / 421 derived): vscode `rpc-surface.spec.ts` partition test, electron `rpc-surface.spec.ts` "serves every method", cli-engine `rpc-surface.spec.ts` partition test, `rpc-handlers` `rpc-allowlist.spec.ts` "claims every registry method exactly once", and the dev-mode `assertManifestInvariants` call at host RPC registration (`register-rpc-surface.ts:141-143`) — so no host is dev-booted before Batch 25. Batches 14 and 18 treat this one-method gap as known, not theirs |
| R-6 Guard specs go red between a registering batch and AB14 (DI deps registered only in AB14) | MEDIUM | Rule 8 in every registering batch (3, 14, 19, 24, 25, 29, 30): run guard specs; stop-and-report, team-leader moves the line |
| R-7 Pre-push `validate-deps`/di-lint flags a new lib before AB14 wires it | LOW | Fix commit on top; allowlist change owned by Batch 30 (AB14) |
| R-8 New lib cycle (`agent-sdk -> lane-routing`, `lane-outcomes -> agent-sdk`) | MEDIUM | Rule 9; `nx lint` per lib; Batch 19 confirms no reverse edge |
| R-9 Codex resume fails after 600 s idle | LOW | Full-brief respawn for every codex batch (3, 6, 15, 20, 23, 28) |
| R-10 UI batches (B8, A12) need rendered evidence; no prototype exists | MEDIUM | Before screenshots (dark + light) of the Agents tab and orchestration settings from base commit c57a9a1e7 before Batch 8 / Batch 22 land; visual review in phases P4 and P5 |
| R-11 Agents-tab "Success" removal (parity-inventory, decision #13) | LOW | Batch 8 keeps every `keep` row; Mode 3 verifies parity row by row |

Edge cases:

- Backlog unknown-id (fixtures a-e), dead-lettered target, held review across store outage (i-iv), hold cap
  per report (i-v), readable-store expired-row capacity (R6-1) — Task 15.2
- Live 404/405 model-not-found vs route-missing, coalesced re-check (a)-(c) — Task 12.1; forwarding — Task 21.1
- Journal restart, delayed open, >1 000 pre-open ops, ack-crash, shutdown flush — Task 15.1; disposer awaited —
  Task 30.1
- Throwing store and 5 s store write on the notifier signal path — Task 23.1
- Report-before-stop, repeated/concurrent same-run reports, `held`/`queued` results — Task 28.1
- Subagent run tag on sync and async launches and registry miss — Task 3.2
- Recorder dedup by `runId` — Task 24.1

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| TL-1 | Split plan batch B4 into B4a (scaffold, schema, stores), B4b (journal + write pipeline + holds), B4c (recorder, reader, signals, join, DI) in waves 2-4 | one B4 lane (plan row) | plan line 719 "team-leader owns the final decomposition"; B4 row is ~20 production files plus the full SC-10 fixture set; 6-file batch cap; critical path stays 8 waves | yes |
| TL-2 | Batches numbered 1-31 in wave order; the plan id stays in each header | plan ids only | orchestrator matches `Batch [N]` | yes |
| TL-3 | Seven review phases, reviewer family different from every implementer in the phase (table below) | per-wave phases | lean rule: one code-logic review per phase | yes |
| TL-4 | Lane names appear because the spawner listed the live lanes (2026-10-15); the orchestrator re-resolves at spawn time and uses the fallback order when a lane is out | capability only | spawner instruction "spread batches across every spawnable lane" | yes |
| TL-5 | `.commitlintrc.json` scope additions ride in Batch 1 and Batch 6 | commit new libs without scope | `.commitlintrc.json` has every lib as a scope; no `lane-*` entry | yes |
| TL-6 | Guard-spec rule 8 applies per registering batch; executors stop-and-report instead of re-planning | defer all guard specs to AB14 (plan R4b) | spawner instruction (Gate 0.1) overrides R4b for specs the registering batch affects | yes |
| TL-7 | Wave 1 starts with Batches 1, 2, 3 (A2, AB1, B3); Batch 4 (B2) takes the first free slot | all four at once | max 3 executors in flight | yes |
| TL-8 | R6-1 lives in Task 6.1 (store query) and Task 15.2 (pipeline + fixture) | B4b only | the count query is a store method; the capacity decision is in `submit` | yes |
| TL-9 | Batch 9 seed with one profile (`z-ai`/`glm-5`, implement 80, stale) is accepted; no further rows required | (a) also seed rows whose model id appears in some lane list (opencode routes, Copilot, claude-cli entries) | Req 6.2 seeds only evidenced values and says a row "whose model cannot be matched to one family and model id without guessing shall not be seeded"; part-a:194-196 needs the family stated in the row and the exact listed id. Checked on disk: GLM-5 row states Z.ai, `provider-registry.ts:341` lists `glm-5` under `z-ai` (row excludes Ollama Cloud). The Opus/GPT-5.x/Sonnet 4.5 ids exist only in lanes the rows do not name (`opencode-model-routes.ts:49-112` — opencode has no single default per research :78) or not at all in the named lane (Codex fallback list, subagent tiers); Haiku 4.5 / GPT-5 mini appear in several lanes (Copilot, claude-cli, opencode), so no single family; Gemini rows name no lane. Task-description risk row :587 already expects mostly neutral scores | yes — add rows to `SEED_MATRIX_ROWS` when a row names a lane and id |
| TL-10 | `sourceRef` (dataset URL, required on seed values) beside `source: 'seed'\|'user'\|'local'` is accepted as the resolution of a contract conflict, not a deviation to undo | (a) `source` = URL string (Req 6.2 wording, part-a:196); (b) per-source cell union | The plan contradicts itself: part-a:192 types `source` as the enum and Req 6.5/6.6 require `source` = user / local outcomes, while Req 6.2 and part-a:196 put the URL in `source`. Only a split satisfies all; precedence (A4b) and reasons (A7) key on the enum unchanged. Downstream: Batch 16 view and user-file schema must carry `sourceRef` (Req 6.2/6.8 visibility); Batch 13 reasons use `source` for provenance; Batch 21 (A8) exports the types as-is. Notes added to Tasks 13.1 and 16.1 | yes — field rename/merge before Batch 16 |
| TL-11 | Git hooks are not wired in this worktree (`core.hooksPath=.husky/_`, directory absent), so pre-commit format/lint, commit-msg and pre-push gates do not run here. Batch 9 commit message checked by hand with `npx commitlint` (pass); eslint clean. `nx format:check` flags `matrix.schema.ts`, `seed-matrix.spec.ts` (Batch 9) and `contracts/route-decide-{args,result}.schema.ts` (Batch 5) — formatting only, recorded Minor, not a batch rejection | reject Batch 9 for format; TL formats the files itself | Decision #53 checks (jest, typecheck, lint) all pass; formatting is the hook's job and the TL does not edit code. Fix: orchestrator runs `npx husky` in the worktree, then one `style(lane-routing)` format-only commit via `npx nx format:write --files=...` before the wave-3 lane-routing shared check; pre-push gates must run before any push | yes |

## Waves and in-flight order (max 3 executors at once; phase reviews take a slot)

| Wave | Batches (start order) | Shared check after the wave's last batch |
| --- | --- | --- |
| 1 | 1 A2, 2 AB1, 3 B3, then 4 B2 | none |
| 2 | 6 B4a, 5 A3, 7 A1b, then 8 B8 | none |
| 3 | 15 B4b, 9 A4, 11 A6a, then 10 A5a, 12 A6b, 13 A7, 14 A10 | `npx nx test @ptah-extension/lane-routing --parallel=1` + `npx nx lint @ptah-extension/lane-routing` before committing the wave's last lane-routing batch |
| 4 | 20 B4c, 16 A4b, 17 A5b, then 18 A11, 19 A13 | lane-routing as in wave 3; `npx nx typecheck @ptah-extension/rpc-handlers` after Batch 18 |
| 5 | 21 A8, 23 B5, 24 B6, then 25 B7, 22 A12 | `npx nx typecheck @ptah-extension/rpc-handlers` after Batch 25 |
| 6 | 28 B10a, 26 A9a, 27 A16 | none |
| 7 | 29 AB9 | full `npx nx test @ptah-extension/vscode-lm-tools --parallel=1` |
| 8 | 30 AB14, 31 A15 | AB14's four host checks, one at a time |

## Phases and reviews

| Phase | Batches | Implementer families | Phase review | Reviewer (family) |
| --- | --- | --- | --- | --- |
| P1 Foundations | 1, 2, 3, 4, 5, 7 | xAI, Zhipu, OpenAI, Google | code-logic + code-style (new shared contracts, new lib public API) | Claude code-logic-reviewer + code-style-reviewer (Anthropic) |
| P2 Outcome store core | 6, 15, 20 | OpenAI | code-logic + code-style (new lib public API) | Claude subagents (Anthropic) |
| P3 Routing engine | 9, 10, 11, 12, 13, 16, 17, 21, 27 | Google, Zhipu, xAI, Anthropic | code-logic + code-style (lane-routing public API) | codex lane (OpenAI) |
| P4 Decision-model settings | 14, 18, 19, 22 | Zhipu, xAI, Google | code-logic + visual (A12 renders) | codex lane (OpenAI); visual-reviewer subagent |
| P5 Outcome producers + Agents tab | 8, 23, 24, 25, 28 | Google, OpenAI, xAI, Zhipu | code-logic + code-style (new RPC method, new MCP tool module) + visual (B8) | Claude subagents (Anthropic); visual-reviewer subagent |
| P6 MCP + host integration | 26, 29, 30 | Google, Anthropic | code-logic + code-style (two new MCP tools) | codex lane (OpenAI) |
| P7 Skill docs | 31 | opencode | none — docs only; team-leader checks the grep evidence in Mode 2 | n/a |

A phase review is requested when every batch of the phase is COMPLETE; its diff is the phase's commit list
(SHAs recorded on the batch headers; phases interleave, so the range is non-contiguous).

---

## Batch 1 (A2): lane-routing scaffold — COMPLETE (commit 5a6c3faa2)

- Recommended executor: CLI lane grok (xAI) — backend TypeScript, Nx lib scaffold
- Execution mode: sequential
- Fallback order: other family same capability (Glm, antigravity) -> same family other provider/model -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P1 reviewed by Anthropic
- Rationale: one new lib, boilerplate only; on the critical path (A2 → A3 → A4 → A4b → A8 → A9a → AB9 → AB14)
- Tasks: 1 | Depends on: none
- Phase: P1 Foundations | Phase review: code-logic + code-style

### Task 1.1: Scaffold `@ptah-extension/lane-routing` — COMPLETE

- File: `W\libs\backend\lane-routing\` (`project.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.ts`, `eslint.config.mjs`, `README.md`, `src\index.ts`), `LR\di\tokens.ts`, `LR\routing-constants.ts`; MODIFY `W\tsconfig.base.json`, `W\.commitlintrc.json`
- Plan reference: implementation-plan.md:734 (A2 row); implementation-plan-part-a.md:132-180 (§2), :921; SC-3 implementation-plan.md:168-180; SC-9 :375-382
- Pattern to follow: `W\libs\backend\skill-synthesis\project.json:6` (tags) and `:29` (typecheck target)
- Quality requirements: tags `scope:extension`, `type:feature`; `test`, `lint`, `typecheck` targets; tokens include `LANE_OUTCOME_READER`, `FAILURE_CLASSIFIER`, `STRUCTURED_DECISION`, `LANE_MODEL_LISTING`, `CAPABILITY_MATRIX_STORE`, `ROTATION_STORE` (`Symbol.for`); local structural logger interface (SC-9); no `vscode-core` import
- Validation notes: R-3 — add `"lane-routing"` to `scope-enum` in `.commitlintrc.json`; scaffold exceeds 6 files by design (plan A2 note); rule 9 graph
- Implementation details: path alias `@ptah-extension/lane-routing` in `tsconfig.base.json`; `passWithNoTests` until A3 adds specs; tokens spec optional

### Batch 1 verification

- `npx nx test @ptah-extension/lane-routing --parallel=1`, then `npx nx lint @ptah-extension/lane-routing`, then `npx nx typecheck @ptah-extension/lane-routing`
- Only wave-1 batch touching `tsconfig.base.json`; no phase review per batch
- Result (team-leader, 2026-10-15): test passed (no specs yet, `passWithNoTests` until A3); lint "All files pass linting"; typecheck passed. Nx project name `@ptah-extension/lane-routing`. Rule 9: the only module import is `import type { LaneLimitState } from '@ptah-extension/shared'` (no vscode-core, agent-sdk, lane-outcomes, platform-core). `tsconfig.base.json` and `.commitlintrc.json` held only Batch 1 hunks (alias + `lane-routing` scope; R-3 for lane-routing resolved). `register.ts` deferred to Task 21.1 as planned. Implementer xAI (grok); P1 review family Anthropic

## Batch 2 (AB1): Shared contracts — COMPLETE (commit c51b98335)

- Recommended executor: CLI lane Glm (Zhipu, ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`) — TypeScript types
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P1 reviewed by Anthropic
- Rationale: small, file-disjoint, blocks every wave-2 batch
- Tasks: 2 | Depends on: none
- Phase: P1 Foundations | Phase review: code-logic + code-style

### Task 2.1: Lane family and outcome contracts — COMPLETE

- File: CREATE `W\libs\shared\src\lib\utils\lane-family.ts` (+ `lane-family.spec.ts`), `W\libs\shared\src\lib\types\lane-outcome.types.ts`; MODIFY `W\libs\shared\src\lib\types\agent-process.types.ts`, the shared barrel
- Plan reference: implementation-plan.md:733; SC-1 :71-142, SC-2 :143-167, SC-4 :181-215, SC-5 :216-232, SC-6 :233-253
- Pattern to follow: existing `W\libs\shared\src\lib\types\agent-process.types.ts:151` (`AgentProcessInfo.role`)
- Quality requirements: `OUTCOME_TASK_KINDS`, `LaneOutcomeReader {recentOutcomes, isPersistent}`, `LaneOutcomeSummary`, `SUBAGENT_LANE_ID`, `LANE_DEFAULT_MODEL`, `LaneFailureClassifier` port, `laneFamilyOf`; `CliDetectionResult.family?`; optional `taskKind`/`routingSource` on spawn types (SC-6); record carries `deliverablesDeclaredAt`
- Validation notes: decision I2 (part B field set canonical, `family` non-null); no runtime deps beyond shared
- Implementation details: pure types plus one pure function with a table-driven spec

### Task 2.2: Outcome-signals RPC types — COMPLETE

- Depends on: Task 2.1
- File: CREATE `W\libs\shared\src\lib\types\rpc\rpc-lane-outcome.types.ts`; MODIFY `W\libs\shared\src\lib\types\rpc.types.ts` (method + capability map), shared barrel
- Plan reference: implementation-plan.md:733; SC-8 :368-374; part-b:175
- Pattern to follow: `agent:getLanePlanLimits` entry in `rpc.types.ts` and its capability mapping
- Quality requirements: `'agent:outcomeSignals'` params `{ slugs: string[] }`, result `{ signals, windowDays: 30, persistent }`
- Validation notes: R-5 — after the shared check, run (one at a time) `J(apps/ptah-extension-vscode, apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-extension-vscode/src/di/surface-composition.spec.ts)`, the same two in `apps/ptah-electron`, and `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts libs/backend/cli-engine/src/lib/surface-composition.spec.ts --coverage=false --maxWorkers=2`. If served-vs-absent needs a list edit, make it here (rule 8). If a spec fails only because no handler exists yet, stop and report (rule 8)
- Implementation details: host-source guard passes (name matches none of the SC-8 patterns)

### Batch 2 verification

- `npx nx test @ptah-extension/shared --parallel=1` (includes `host-source-registry.contract.spec.ts`), then `npx nx typecheck @ptah-extension/shared`, then the R-5 guard specs one at a time
- Result (team-leader, 2026-10-15): shared test 114 suites / 3604 tests passed; shared typecheck passed; shared lint 0 errors (only pre-existing `max-lines` warning on `rpc.types.ts`). R-5 guard specs: vscode 7/8, electron 5/6, cli-engine 17/18; the single failure in each is the `'agent:outcomeSignals'` handler gap (no `RPC_HANDLER_MANIFEST` entry until Batch 25). `surface-composition.spec.ts` passed in all three. Rule 8 applied: R-5 guard-spec check DEFERRED to Batch 25; entry kept here (see R-5 row)
- Environment: the worktree had no `node_modules`, so `jest.preset.js`'s `marked` mapper could not resolve; a git-ignored junction `W\node_modules -> D:\projects\ptah-extension\node_modules` was added (same as other worktrees)

## Batch 3 (B3): Subagent budget-stop registry; Ptah run tag — COMPLETE (commit e6b75a30a)

- Recommended executor: CLI lane codex (OpenAI) — backend TypeScript, hook semantics
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer (full brief; codex resume unsafe after 600 s idle)
- Subagent reason: N/A
- Review family: different from implementer — P1 reviewed by Anthropic
- Rationale: two coupled agent-sdk changes sharing DI/barrel files; resolves IA-5, PB-2, PB-6; blocks B4a
- Tasks: 2 | Depends on: none
- Phase: P1 Foundations | Phase review: code-logic + code-style

### Task 3.1: Budget-stop callback registry — COMPLETE

- File: CREATE `W\libs\backend\agent-sdk\src\lib\helpers\subagent-budget-stop-callback-registry.ts` (+ spec); MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts` (+ spec), `W\libs\backend\agent-sdk\src\lib\di\register.ts`, the agent-sdk tokens file, `W\libs\backend\agent-sdk\src\index.ts`
- Plan reference: implementation-plan.md:736; implementation-plan-part-b.md:377-407 (§5)
- Pattern to follow: `callback-registry.base.ts`; monitor stop path `subagent-budget-monitor.ts:36`, `:518`
- Quality requirements: publishes the stopped subagent's `agentId`; a throwing listener is isolated (PB-6)
- Validation notes: PB-2, PB-6 first; rule 8 — run `J(apps/ptah-extension-vscode, apps/ptah-extension-vscode/src/di)` after the lib check if a new token is registered in `register.ts`
- Implementation details: registry singleton registered with agent-sdk services; monitor notifies on stop

### Task 3.2: Ptah run tag on main-thread Agent/Task results — COMPLETE

- Depends on: Task 3.1
- File: CREATE `W\libs\backend\agent-sdk\src\lib\helpers\subagent-run-tag.ts` (+ spec); MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.ts` (+ spec)
- Plan reference: part-b:398-407 (integration note); SC-7 implementation-plan.md:254-367; IA-5 row :803
- Pattern to follow: budget notice via PostToolUse `subagent-budget-monitor.ts:46-51`; `subagent-hook-handler.ts:67` token injection
- Quality requirements: tag grammar `ptah-run: runId=subagent:<agentId>`; constructor gains last optional `@inject(TOKENS.SUBAGENT_REGISTRY_SERVICE) subagentRegistry?`; id from registry by `tool_use_id`, else `tool_response.agentId`
- Validation notes: IA-5 — hook spec with a fake registry: sync result, async-launch result, registry miss; record the IA-5 result (dev capture line next to `subagent-hook-handler.ts:420` when available) and which fallback, if any, applied
- Implementation details: pure tag builder; `createHooks` appends to `additionalContext`

### Batch 3 verification

- `J(libs/backend/agent-sdk, <budget-stop registry spec, monitor spec, run-tag spec, post-tool-use-hook-handler spec>)`, then `npx nx typecheck @ptah-extension/agent-sdk`, then rule-8 guard specs if a token was registered
- Result (team-leader, 2026-10-15): the 4 agent-sdk specs passed, 114 tests (ts-jest diagnostics on, so spec types are checked). agent-sdk typecheck passed. ESLint on the 13 changed files: 0 errors; 3 warnings were already there (`max-lines` on the monitor, unused `SetupRpcHandlers` in both smoke specs). Rule 8: electron `container.smoke.spec.ts` 20/20, cli `container.smoke.spec.ts` (`jest.config.cjs`) 10/10. VS Code `container.smoke.spec.ts` and every `expected-resolvable.ts` list no SDK registry tokens (the sibling `SDK_SUBAGENT_STOP_CALLBACK_REGISTRY` is absent too), so they need no change. `TOKENS.SUBAGENT_REGISTRY_SERVICE`, which the hook handler now injects, is registered for every host in `vscode-core/src/di/register-platform-agnostic.ts:77`
- IA-5: the report records the fallback (`tool_response.agentId` on a registry miss) and the open live capture. Batch 31 (A15) owns that capture. No Batch 3 path needs IA-5 proven: the sync, async and miss shapes are covered by specs

## Batch 4 (B2): Migrations 0054, 0055 — COMPLETE (commit 3ada54c23; actual executor: CLI lane Glm, Zhipu)

- Recommended executor: CLI lane antigravity (Google) — SQL migrations
- Actual executor: CLI lane Glm (Zhipu) — antigravity hit its quota (decisions.md #54)
- Execution mode: sequential
- Fallback order: Glm -> grok -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P1 reviewed by Anthropic
- Rationale: small, self-contained; starts when the first wave-1 slot frees
- Tasks: 1 | Depends on: none
- Phase: P1 Foundations | Phase review: code-logic + code-style

### Task 4.1: Lane outcome tables and skill invocation run id — COMPLETE

- File: CREATE `W\libs\backend\persistence-sqlite\src\lib\migrations\0054_lane_outcome_records.ts` (+ spec), `0055_skill_invocation_run_id.ts` (+ spec); MODIFY `W\libs\backend\persistence-sqlite\src\lib\migrations\index.ts`
- Plan reference: implementation-plan.md:735; part-b:191-224 (§2); SC-10 keys :383-650
- Pattern to follow: `W\libs\backend\persistence-sqlite\src\lib\migrations\0053_memory_boot_scan_failure_generation.ts` (+ spec)
- Quality requirements: `lane_outcome_records` with `deliverables_declared_at INTEGER`; `lane_outcome_report_receipts`; `lane_outcome_held_reports` with an index usable for `expires_at` filtering (R6-1 count); `IF NOT EXISTS` idempotence; 0055 adds nullable `run_id` + index on `skill_invocation_events`
- Validation notes: re-check that 0054/0055 are still free on `origin/main` before starting
- Implementation details: forward-only migrations registered in `index.ts` order

### Batch 4 verification

- `npx nx test @ptah-extension/persistence-sqlite --parallel=1`
- Mode 2 round 1 (team-leader, 2026-10-15): NOT ACCEPTED. Report `reports\batch-4-report.md`.
  - On disk: 0054 and 0055 SQL match part-b:195-208 and plan:330-332/:440-441 column for column. All
    three tables, the three record indexes, the receipts `run_id` index, the held `run_id` and
    `expires_at` indexes (R6-1) and `IF NOT EXISTS` are present. The 0055 nullable `run_id` and
    `idx_skill_inv_events_run` are present. index.ts registers v54 then v55 after v53. Each of the
    15 ratchet edits is a single 53 -> 55 line. They are needed: every spec pins
    `Math.max(versions)`.
  - typecheck passed. lint passed with 0 errors; its 22 warnings are in old files, and the 5 new or
    changed files lint clean.
  - test FAILED: 2 suites, 2 tests (601 passed).
    1. `0053_memory_boot_scan_failure_generation.spec.ts:105-106` calls `applyAll(MIGRATIONS)`, so
       it now applies `[53, 54, 55]`, but the assertion expects `[53]`. Fix it the way the 0052 spec
       does at `:101`: `applyAll(MIGRATIONS.filter((m) => m.version <= 53))`. Check every other
       spec that calls `applyAll(MIGRATIONS)` with a fixed `appliedVersions` list the same way.
    2. `0054_lane_outcome_records.spec.ts:194` fails because PRAGMA reports notnull=0 for
       `run_id TEXT PRIMARY KEY`. In a rowid table, SQLite lets a non-INTEGER PRIMARY KEY column
       hold NULL. The same assertion also applies to `report_id` at `:197` and `:200`. Fix:
       declare `NOT NULL` on the three key columns in `0054_lane_outcome_records.ts:36,72,80`
       (`run_id TEXT NOT NULL PRIMARY KEY`, and the same for both `report_id` columns), and add
       one spec case showing that a NULL key insert is rejected. See decision TL-B4-1.
  - Decision TL-B4-1: add `NOT NULL` to the keys. Rejected options: change the spec to expect
    notnull=0, which keeps the plan's literal `TEXT PRIMARY KEY` and the repo's habit of a plain
    `TEXT PRIMARY KEY`.
    - Evidence: SC-10 dedup depends on keys that are never NULL, and a NULL is unique to SQLite, so
      a NULL `run_id` or `report_id` would never dedupe. The executor's own spec expects
      notnull=1.
    - Cost: a column constraint on new tables only, with no data transform.
    - Reversible: yes, until the migration ships.
- Mode 2 round 2 (team-leader, 2026-10-15): ACCEPTED. Report `reports\batch-4-report-r2.md`
  (fix round 1, CLI lane Glm, Zhipu).
  - On disk: `0053_memory_boot_scan_failure_generation.spec.ts:105` uses
    `applyAll(MIGRATIONS.filter((m) => m.version <= 53))`.
    `0054_lane_outcome_records.ts:40,76,84` declare `TEXT NOT NULL PRIMARY KEY` (TL-B4-1), and the
    header comment at :23 records why. `0054_lane_outcome_records.spec.ts:206-230` adds the
    table-driven NULL-key rejection case (3 inserts, each `/NOT NULL/i`).
    `0055_skill_invocation_run_id.spec.ts:117` is bounded to `<= 55` the same way. A grep for
    `applyAll(MIGRATIONS)` under `migrations/` finds no unbounded call left.
  - test: 54 suites passed; 604 passed, 3 skipped, 0 failed. typecheck passed. eslint on the 6
    round-2 and new files was clean.
  - Commit 3ada54c23 contains 20 files, all under `libs/backend/persistence-sqlite/`.
- P1 is now fully committed: Batches 1, 2, 3, 4, 5 and 7. Its phase review is due on the
  combined diff `7ea895538..3ada54c23`, covering code-logic and code-style, with Anthropic
  reviewers.
  - Expected deliverables: `reviews\p1-code-logic-review.md` and `reviews\p1-code-style-review.md`.
  - When the reviews accept, record their paths here.

## Batch 5 (A3): Route contracts and ports — COMPLETE (commit 5e5c9ffca; actual executor: CLI lane codex, OpenAI — decision #55)

- Recommended executor: CLI lane grok (xAI) — TypeScript + Zod schemas
- Execution mode: sequential
- Fallback order: Glm -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P1 reviewed by Anthropic
- Rationale: critical path; bounded to lane-routing contract files
- Tasks: 1 | Depends on: Batch 1, Batch 2
- Phase: P1 Foundations | Phase review: code-logic + code-style

### Task 5.1: Route-decide args/result schemas and ports — COMPLETE

- File: CREATE `LR\contracts\route-decide-args.schema.ts`, `LR\contracts\route-decide-result.schema.ts`, `LR\contracts\contracts.spec.ts`, `LR\route-candidate-source.port.ts`, `LR\lane-model-listing.port.ts`
- Plan reference: implementation-plan.md:737; part-a:922
- Pattern to follow: Zod `.strict()` schemas in `W\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-args.schema.ts`
- Quality requirements: no `lane-outcome-reader.port.ts` (type from shared, SC-2); `ChosenEntry.taskKind` (SC-6); task kinds from `OUTCOME_TASK_KINDS`; Req 2.3 branch rejections and 2.7 fixture shapes
- Validation notes: rule 9 (imports only shared/platform-core)
- Implementation details: export from `src/index.ts` only what A8 later wires (A8 owns the index edits; add exports here only if the plan row lists them)

### Batch 5 verification

- `npx nx test @ptah-extension/lane-routing --parallel=1`, then `npx nx lint @ptah-extension/lane-routing`
- Result (team-leader, decision #53): test 1 suite / 16 tests passed; lint clean; typecheck clean.
  On disk: `.strict()` schemas match part-a:589-718; no `lane-outcome-reader.port.ts` (SC-2);
  `ChosenEntry.taskKind` from `OUTCOME_TASK_KINDS` (SC-6); imports only `@ptah-extension/shared`
  and `zod` (rule 9; `zod` resolves from the root `package.json`, the lib has no `package.json`
  and no `@nx/dependency-checks` rule). `src/index.ts` untouched (A8 owns exports). The
  one-entry-per-phase assertion is deferred to the A8 service spec (part-a:695-696).

## Batch 6 (B4a): lane-outcomes scaffold, schema and stores — COMPLETE (commit 8fc9278e9; actual executor: CLI lane codex, OpenAI; report `reports/batch-6-report.md`; checks: test 4 suites / 7 tests pass, lint clean, typecheck pass)

- Recommended executor: CLI lane codex (OpenAI) — backend TypeScript, SQLite and key-value stores
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer (full brief every spawn)
- Subagent reason: N/A
- Review family: different from implementer — P2 reviewed by Anthropic
- Rationale: first third of plan batch B4 (decision TL-1); same family through B4c for continuity
- Tasks: 1 | Depends on: Batch 2, Batch 3, Batch 4
- Phase: P2 Outcome store core | Phase review: code-logic + code-style

### Task 6.1: Scaffold `@ptah-extension/lane-outcomes`, SC-7 schema, three stores — COMPLETE

- File: CREATE `W\libs\backend\lane-outcomes\` (`project.json`, tsconfigs, `jest.config.ts`, `eslint.config.mjs`, `src\index.ts`), `LO\di\tokens.ts`, `LO\lane-outcome.schema.ts` (SC-7 `OutcomeReportArgsSchema`, the only report-args schema, decision I7), `LO\store\lane-outcome.store.ts`, `LO\store\sqlite-lane-outcome.store.ts`, `LO\store\in-memory-lane-outcome.store.ts`, `LO\store\key-value-lane-outcome.store.ts` (each logic file + spec); MODIFY `W\tsconfig.base.json`, `W\.commitlintrc.json`
- Plan reference: implementation-plan.md:738 (B4 row); part-b:225-329 (§3, files :320-328); SC-7 :254-367; SC-9 :375-382; SC-10 :383-650
- Pattern to follow: `W\libs\backend\skill-synthesis\project.json:6`; persistence via `persistence-sqlite` connection ports
- Quality requirements: tags `scope:extension`, `type:feature`; store interface covers rows, receipts, held reports; **R6-1 (decision #52): the held-report count query counts only rows with `expires_at > now`, and the hold-insert path deletes expired rows before inserting a new hold**; `KeyValueLaneOutcomeStore` works over `PLATFORM_TOKENS.STATE_STORAGE`
- Validation notes: R-3 — add `"lane-outcomes"` to `scope-enum`; rule 9 (no `lane-routing`, no `vscode-core`); store-level spec: 500 rows of which 3 expired → count 497; insert after expired rows → expired rows gone
- Implementation details: in-memory store mirrors SQLite semantics so B4b/B10a fixtures can use it

### Batch 6 verification

- `npx nx test @ptah-extension/lane-outcomes --parallel=1`, then `npx nx lint @ptah-extension/lane-outcomes`, then `npx nx typecheck @ptah-extension/lane-outcomes`
- Only wave-2 batch touching `tsconfig.base.json`
- TL verification (Mode 2): tags, rule 9 imports (shared, platform-core, persistence-sqlite,
  zod only), single SC-7 schema, R6-1 in all three stores with 500/3/497 specs, KV over
  `IStateStorage`, `store.test-support.ts` spec-only (excluded in tsconfig.lib, not exported)
- Carry to the P2 code-logic review (after Batch 20): (a) KV `evict()` drops receipts whose
  `runId` has no kept row, so a receipt recorded before its row exists is lost on the next
  write (idempotency); (b) `holdReport` purges with `Date.now()` rather than a caller `nowMs`;
  (c) SQLite `decode` fixes `telemetryJoin`/`skillsLoaded`/`sessionEvidenceClass` to defaults
  because migration 0054 has no such columns (deferred to B4c per the report)

## Batch 7 (A1b): Row `family` + spawn routing fields — COMPLETE (commit 15b9c2c02; actual executor: CLI lane Glm, Zhipu)

- Recommended executor: CLI lane Glm (Zhipu) — TypeScript, MCP formatter
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P1 reviewed by Anthropic
- Rationale: bounded vscode-lm-tools edits; resolves IA-1
- Tasks: 1 | Depends on: Batch 2
- Phase: P1 Foundations | Phase review: code-logic + code-style

### Task 7.1: Expose `family` on agent rows; accept `taskKind`/`routingSource` on spawn — COMPLETE

- IA-1 result (report `reports/batch-7-report.md`): the args → `SpawnAgentRequest` mapping is in two Batch 29 (AB9) files — `protocol-dispatcher.ts:1212-1227` (HTTP) and `mcp-stdio/agent-tool.dispatcher.ts:434-448` (stdio). Not edited here; the `taskKind`/`routingSource` copy lines moved to Task 29.1. Schema accepts both fields; nothing forwards them until Batch 29 lands.
- F52 byte-lock in `mcp-response-formatter.spec.ts` re-locked deliberately for the new `Family` column only (header, separator, one cell per row); roles block and remaining bytes unchanged.

- File: MODIFY `VLT\namespace-builders\agent-namespace.builder.ts`, `VLT\mcp-core\mcp-response-formatter.ts` (+ spec), `VLT\mcp-core\agent-spawn-args.schema.ts` (+ spec), and the spawn-args → `SpawnAgentRequest` mapping site
- Plan reference: implementation-plan.md:740; part-a:933; SC-6 :233-253
- Pattern to follow: existing `role`/`effort` copy along the `ptah_agent_spawn` path
- Quality requirements: optional fields, validated, copied into `SpawnAgentRequest`
- Validation notes: IA-1 first (grep `effort` along the spawn path). If the mapping is in `protocol-dispatcher.ts`, do NOT edit it: report, and the team-leader moves that line to Batch 29 (AB9)
- Implementation details: formatter prints `family` per row

### Batch 7 verification

- `J(libs/backend/vscode-lm-tools, <formatter spec, agent-namespace spec, spawn-args spec>)`, then `npx nx typecheck @ptah-extension/vscode-lm-tools`
- Result (team-leader, decision #53): Jest 3 suites / 272 tests passed; typecheck passed; eslint on the 6 files 0 errors (8 pre-existing warnings in `mcp-response-formatter.ts`, none on changed lines)
- Minor (recorded, not fixed — fix-round rule): Prettier wrap drift introduced in `agent-spawn-args.schema.spec.ts:1-4` (named import fits one line) and `agent-namespace.builder.spec.ts:996-998` (`toBe('z-ai')` fits one line); lint-staged `nx format:write` did not reformat them. `agent-namespace.builder.spec.ts` already had Prettier drift before this batch (e.g. `:1198`, `:1237`, `:1266` at 5e5c9ffca). Fold into the P1 fix batch if one is raised; otherwise left for a formatting sweep

## Batch 8 (B8): Library Agents-tab outcome signals — PENDING

- Recommended executor: CLI lane antigravity (Google) — Angular frontend
- Execution mode: sequential
- Fallback order: Glm -> grok -> subagent frontend-developer
- Subagent reason: N/A
- Review family: different from implementer — P5 reviewed by Anthropic; visual-reviewer for rendered evidence
- Rationale: one frontend lib, contract-only dependency on AB1; parity surface
- Tasks: 1 | Depends on: Batch 2
- Phase: P5 Outcome producers + Agents tab | Phase review: code-logic + code-style + visual

### Task 8.1: Replace agent "Success" % with outcome signals — PENDING

- File: CREATE `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-outcome-signals.ts` (+ spec); MODIFY `clone-card.component.ts` (+ spec), `clone-detail-drawer.component.ts` (+ spec), `skill-clones-view.component.ts`, `W\libs\frontend\skill-synthesis-ui\src\lib\services\skill-clones-state.service.ts` (+ spec), `W\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts` (+ spec)
- Plan reference: implementation-plan.md:739; part-b:552-589 (§9); `T\parity-inventory.md`
- Pattern to follow: `clone-card.component.ts:401-439` metrics `computed`
- Quality requirements: only `kind === 'agent'` loses "Success" (decision #13); skills/commands keep it; invocations, last enhanced, history count, scorecard badge unchanged (parity rows `keep`); `outcomeSignals = input<AgentOutcomeSignals | ...>`
- Validation notes: R-10 — before screenshots (dark + light) of the Agents tab from base commit c57a9a1e7 are captured before this batch is committed; PB-4 acceptance; R-11 parity
- Implementation details: `SkillSynthesisRpcService.getAgentOutcomeSignals(slugs)` → `'agent:outcomeSignals'`

### Batch 8 verification

- `npx nx test @ptah-extension/skill-synthesis-ui --parallel=1`, then `npx nx lint @ptah-extension/skill-synthesis-ui`

## Batch 9 (A4): Matrix data — COMPLETE (commit 55a58c96b; actual executor: subagent backend-developer, Anthropic — decision #56; report `reports/batch-9-report.md`; checks: seed-matrix.spec 36/36, typecheck lane-routing pass, eslint matrix/ clean; TL-9, TL-10, TL-11)

- Recommended executor: CLI lane antigravity (Google)
- Execution mode: sequential
- Fallback order: Glm -> grok -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: critical path; pure data + schema
- Tasks: 1 | Depends on: Batch 5
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 9.1: Capability matrix types, schema and seed — COMPLETE

- File: CREATE `LR\matrix\matrix.types.ts`, `LR\matrix\matrix.schema.ts`, `LR\matrix\seed-matrix.ts`, `LR\matrix\seed-matrix.spec.ts`
- Plan reference: implementation-plan.md:741; part-a:923 and §3 (Req 6.2, 6.3)
- Pattern to follow: Zod schema style from Batch 5 contracts
- Quality requirements: seed validates against the schema; no vendor-to-task table outside the matrix (Req 6.9)
- Validation notes: rule 9
- Implementation details: seed is data, schema-checked in spec

### Batch 9 verification

- `J(libs/backend/lane-routing, LR/matrix/seed-matrix.spec.ts)`

## Batch 10 (A5a): Hard constraints — IN_PROGRESS (actual executor: CLI lane grok, xAI — first fallback, Glm busy)

- Recommended executor: CLI lane Glm (Zhipu)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: pure functions, own folder
- Tasks: 1 | Depends on: Batch 5
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 10.1: Candidate types and hard-constraint filter — PENDING

- File: CREATE `LR\ranking\candidate.types.ts`, `LR\ranking\hard-constraints.ts`, `LR\ranking\hard-constraints.spec.ts`
- Plan reference: implementation-plan.md:742; part-a:924 (Req 3.2-3.6)
- Pattern to follow: Batch 5 contracts
- Quality requirements: each Req 3.x exclusion has a spec case with its reason
- Validation notes: rule 9
- Implementation details: pure, deterministic

### Batch 10 verification

- `J(libs/backend/lane-routing, LR/ranking/hard-constraints.spec.ts)`

## Batch 11 (A6a): System One wire + payload — IN_PROGRESS (actual executor: CLI lane Glm, Zhipu — first fallback, grok busy)

- Recommended executor: CLI lane grok (xAI)
- Execution mode: sequential
- Fallback order: Glm -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: HTTP client + payload builder; runs before Batch 12 on the same lane (assumption A6b may reuse it)
- Tasks: 1 | Depends on: Batch 5
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 11.1: System One client and decision payload — PENDING

- File: CREATE `LR\decision-model\system-one.schema.ts`, `LR\decision-model\system-one.client.ts` (+ `system-one.client.spec.ts`), `LR\decision-model\decision-payload.ts` (+ `decision-payload.spec.ts`)
- Plan reference: implementation-plan.md:743; part-a:925, :300-360 (§5)
- Pattern to follow: existing fetch-based clients with `AbortSignal` timeouts in the repo
- Quality requirements: any live 404/405 → `notFound: true` with the body's `error` text (R3-2, decision #46; not a route verdict); payload field set pinned (NFR)
- Validation notes: client never persists a mark itself
- Implementation details: typed result union, timeout and network classes

### Batch 11 verification

- `J(libs/backend/lane-routing, LR/decision-model/system-one.client.spec.ts LR/decision-model/decision-payload.spec.ts)`

## Batch 12 (A6b): Decision-model settings and probe — PENDING

- Recommended executor: CLI lane grok (xAI), after Batch 11
- Execution mode: sequential
- Fallback order: Glm -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: settings + probe + re-check; carries R3-2 acceptance
- Tasks: 1 | Depends on: Batch 5, Batch 11
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 12.1: Decision-model config, probe, `recheckAfterLiveNotFound` — PENDING

- File: CREATE `LR\decision-model\decision-model.types.ts`, `LR\decision-model\decision-model.config.ts` (+ `decision-model.config.spec.ts`), `LR\decision-model\structured-decision.port.ts`
- Plan reference: implementation-plan.md:744; part-a:929, §5; decisions #42, #46
- Pattern to follow: `IStateStorage` usage in platform-core consumers
- Quality requirements: probe `POST /v1/systemone {}` vs control path discriminator (ambiguous 404/405 → unsupported); `markUnsupported(base)` persisted under `ptah.decisionModel.unsupported.v1`; `recheckAfterLiveNotFound` coalesced (at most one per 60 s); `ready` re-check writes no mark, clears an existing one, row stays `ready` with `last call failed: <error>` detail
- Validation notes: acceptance specs (a) live model-not-found (route `400 {"error":"model is required"}` vs control `404 page not found`) → no mark, nothing stored, row `ready`; (b) live route missing → mark persisted across restart; (c) two live 404s in 60 s → one re-check. Write-path: record key, scope and value format for the Mode 3 trace
- Implementation details: `StructuredDecisionCompleter` port per part-a:713

### Batch 12 verification

- `J(libs/backend/lane-routing, LR/decision-model/decision-model.config.spec.ts)`

## Batch 13 (A7): Reasons and confidence — PENDING

- Recommended executor: CLI lane antigravity (Google)
- Execution mode: sequential
- Fallback order: Glm -> grok -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: pure functions, own folder
- Tasks: 1 | Depends on: Batch 5
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 13.1: Compile reasons and confidence — PENDING

- File: CREATE `LR\reasons\compile-reasons.ts`, `LR\reasons\confidence.ts`, `LR\reasons\compile-reasons.spec.ts`, `LR\reasons\confidence.spec.ts`
- Plan reference: implementation-plan.md:745; part-a:926 (Req 13.2-13.5)
- Pattern to follow: Batch 10 pure-function style
- Quality requirements: every Req 13.x rule has a spec case
- Validation notes: rule 9. TL-10: matrix provenance in reasons comes from the cell's `source` enum (`seed`/`user`/`local`); the dataset URL is the separate `sourceRef` field (`LR/matrix/matrix.types.ts`, commit 55a58c96b)
- Implementation details: deterministic text from structured inputs

### Batch 13 verification

- `J(libs/backend/lane-routing, LR/reasons/compile-reasons.spec.ts LR/reasons/confidence.spec.ts)`; wave-3 lane-routing check (wave table) before committing the wave's last lane-routing batch

## Batch 14 (A10): Lane model listing adapter — PENDING

- Recommended executor: CLI lane Glm (Zhipu)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P4 reviewed by OpenAI
- Rationale: rpc-handlers adapter; resolves PA-1; only wave-3 batch touching `register-shared-rpc-handlers.ts`
- Tasks: 1 | Depends on: Batch 5
- Phase: P4 Decision-model settings | Phase review: code-logic + visual

### Task 14.1: `LaneModelListing` adapter with Ptah CLI provider discovery — PENDING

- File: CREATE `W\libs\backend\rpc-handlers\src\lib\services\lane-model-listing.adapter.ts` (+ spec); MODIFY `W\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts`
- Plan reference: implementation-plan.md:746; part-a:934, §9 integration note
- Pattern to follow: existing service registrations in `register-shared-rpc-handlers.ts`
- Quality requirements: implements the Batch 5 port under `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING`
- Validation notes: PA-1 first (grep callers in the three roots); rule 8 — run `J(apps/ptah-extension-vscode, apps/ptah-extension-vscode/src/di)`, then electron, then `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/di --coverage=false --maxWorkers=2`, one at a time
- Implementation details: adapter registered as a singleton; no host root edits

### Batch 14 verification

- `J(libs/backend/rpc-handlers, <adapter spec>)`, then `npx nx typecheck @ptah-extension/rpc-handlers`, then rule-8 guard specs

## Batch 15 (B4b): Journal, write pipeline, report holds — IN_PROGRESS

- Recommended executor: CLI lane codex (OpenAI)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer (full brief every spawn)
- Subagent reason: N/A
- Review family: different from implementer — P2 reviewed by Anthropic
- Rationale: highest-risk logic of the task (decisions #41, #45, #48, #51, #52); first slot of wave 3
- Tasks: 2 | Depends on: Batch 6
- Phase: P2 Outcome store core | Phase review: code-logic + code-style

### Task 15.1: `KeyValueOutcomeJournal` — IN_PROGRESS

- File: CREATE `LO\write\key-value-outcome-journal.ts` (+ spec)
- Plan reference: implementation-plan.md:738; SC-10 :383-650 (journal value incl. `heldRuns` with `holdExpiries`)
- Pattern to follow: `IStateStorage` single-key `update` per drain turn
- Quality requirements: 5 000-entry bound with durable refusal counter; `heldRuns: [{ runId, expiresAt, holdExpiries }]` added on applied hold (op acked only after the `update` resolves), removed on join, per-report expiry, 24 h self-expiry, cap 500, rebuilt from the hold table at open (store wins)
- Validation notes: restart, delayed-open, bound, ordering, shutdown specs
- Implementation details: pure serialization + bounded append/remove

### Task 15.2: `OutcomeWritePipeline` with holds and backlog validation — IN_PROGRESS

- Depends on: Task 15.1
- File: CREATE `LO\write\outcome-write-pipeline.ts` (+ spec)
- Plan reference: implementation-plan.md:738; SC-10 :383-650 (capacity text :536-546; `queued`/`held`/error table ~:520-535); SC-7 :254-367; decisions #45, #48, #51, #52
- Pattern to follow: Batch 6 store interface
- Quality requirements: per-op acknowledgement, failure classes and backoff, backlog mode, receipts, dead-letter key; backlog `submit` validates the target against pending inserts, pending holds, `heldRuns` (only when the store is not readable) and a readable store before appending; hold expiry sweep at most once per 60 s
- Validation notes — acceptance fixtures, all required:
  - backlog unknown-id (a)-(e) and dead-lettered target: `{ ok: false }` naming the id, journal deep-equal before/after, no store, receipt or hold write
  - held review across a store outage: apply + ack a `subagent:z` deliverables hold, close the store, submit its review → `held`, reopen, insert the stop → one joined row with `reviseRounds = 1`; variants (i)-(iv)
  - hold cap per report: 500 held `deliverables` reports for one `subagent:m` run, store closed, 501st → `too many held reports`, journal deep-equal; variants (i)-(v)
  - **R6-1 (decision #52)**: readable store with 500 `lane_outcome_held_reports` rows for `subagent:r`, 3 with `expires_at <= now` and the last sweep under 60 s ago; submit a new `deliverables` hold → `held` (count uses only `expires_at > now`); after apply the 3 expired rows are deleted before the new row is inserted (497 + 1 rows, all unexpired). Variant: 500 unexpired rows → `{ ok: false, error: 'too many held reports' }`, journal deep-equal, no row written
  - replay-failure, restart, recovery, ack-crash, >1 000 pre-open and capacity specs
- Implementation details: capacity = held reports (readable: unexpired table rows; else unexpired `holdExpiries`) + pending report holds; newest refused, never a held one

### Batch 15 verification

- `npx nx test @ptah-extension/lane-outcomes --parallel=1`, then `npx nx lint @ptah-extension/lane-outcomes`
- TL note from Batch 6: the held-report cap is global (plan:342-345, :538-545), so use the store's
  global `countHeldReports(nowMs)`; `holdReport` purges expired rows with `Date.now()`, so specs that
  pin `now` must use a value at or below wall-clock time. The pipeline must not delete receipts.
  KV `evict()` drops receipts whose run has no kept row; if the pipeline records a receipt before its
  row exists, report that to the team-leader rather than editing Batch 6 files silently

## Batch 16 (A4b): Matrix store + local derivation — PENDING

- Recommended executor: CLI lane antigravity (Google)
- Execution mode: sequential
- Fallback order: Glm -> grok -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: critical path; resolves PA-2
- Tasks: 1 | Depends on: Batch 9
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 16.1: Capability matrix store and local derivation — PENDING

- File: CREATE `LR\matrix\capability-matrix.store.ts`, `LR\matrix\local-derivation.ts`, `LR\matrix\capability-matrix.store.spec.ts`, `LR\matrix\local-derivation.spec.ts`
- Plan reference: implementation-plan.md:749; part-a:927 (Req 6.4-6.8); SC-2 :143-167
- Pattern to follow: Batch 9 types
- Quality requirements: reads `isPersistent`, `SUBAGENT_LANE_ID`, `LANE_DEFAULT_MODEL` from shared
- Validation notes: PA-2 first (grep `'.ptah'` in `libs/backend/platform-core/src`); if absent, take the home path by injection (AB14 supplies it). Write-path: record file path and format for the Mode 3 trace. TL-10: cells carry `source` (enum) plus `sourceRef` (dataset/URL, required on seed, forbidden on local); the view file must include `sourceRef` with `source`, `asOf`, `stale`, sample count (Req 6.2/6.8); user-file cells must have `source: 'user'` (reject `seed`/`local` in the user file, naming the entry, Req 6.7); reuse `isStale` from `seed-matrix.ts` and the Batch 9 schemas
- Implementation details: derivation from outcome summaries is pure

### Batch 16 verification

- `J(libs/backend/lane-routing, LR/matrix/capability-matrix.store.spec.ts LR/matrix/local-derivation.spec.ts)`

## Batch 17 (A5b): Score, spread, rotation — PENDING

- Recommended executor: CLI lane Glm (Zhipu)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: pure ranking + small rotation store
- Tasks: 1 | Depends on: Batch 9, Batch 10
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 17.1: Score, spread band, rotation store — PENDING

- File: CREATE `LR\ranking\score.ts`, `LR\ranking\spread.ts`, `LR\ranking\rotation.store.ts`, `LR\ranking\score.spec.ts`, `LR\ranking\spread.spec.ts`, `LR\ranking\rotation.store.spec.ts`
- Plan reference: implementation-plan.md:750; part-a:928, :231 (Req 7.1-7.6, B boundaries)
- Pattern to follow: Batch 10
- Quality requirements: band = eligible with `top - score <= B`; boundary specs at B
- Validation notes: rule 9; write-path for rotation state recorded for the Mode 3 trace
- Implementation details: deterministic given inputs and rotation state

### Batch 17 verification

- `J(libs/backend/lane-routing, LR/ranking/score.spec.ts LR/ranking/spread.spec.ts LR/ranking/rotation.store.spec.ts)`; wave-4 lane-routing check before committing the wave's last lane-routing batch

## Batch 18 (A11): Decision-model config RPC — PENDING

- Recommended executor: CLI lane grok (xAI)
- Execution mode: sequential
- Fallback order: Glm -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P4 reviewed by OpenAI
- Rationale: two files across shared + rpc-handlers; existing methods only
- Tasks: 1 | Depends on: Batch 12, Batch 14
- Phase: P4 Decision-model settings | Phase review: code-logic + visual

### Task 18.1: Decision-model fields on `agent:getConfig`/`agent:setConfig` — PENDING

- File: MODIFY `W\libs\shared\src\lib\types\rpc\rpc-agents.types.ts`, `W\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (delegate only); CREATE `W\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.decision-model.spec.ts`
- Plan reference: implementation-plan.md:751; part-a:935, :507, D5 :951; SC-8 :368-374
- Pattern to follow: existing `agent:getConfig` handling, `rpc.types.ts:1274-1281`
- Quality requirements: no new RPC method; DTO state set unchanged (decision #46)
- Validation notes: write-path: setting keys and scope recorded for the Mode 3 trace
- Implementation details: handler delegates to the lane-routing config service through its token

### Batch 18 verification

- `J(libs/backend/rpc-handlers, libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.decision-model.spec.ts)`, then `npx nx typecheck @ptah-extension/shared`, then `npx nx typecheck @ptah-extension/rpc-handlers`, one at a time

## Batch 19 (A13): Structured-output adapter — PENDING

- Recommended executor: CLI lane Glm (Zhipu)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P4 reviewed by OpenAI
- Rationale: one adapter + DI line in agent-sdk (after B3, same DI files)
- Tasks: 1 | Depends on: Batch 3, Batch 12
- Phase: P4 Decision-model settings | Phase review: code-logic + visual

### Task 19.1: `StructuredDecisionCompleter` adapter in agent-sdk — PENDING

- File: CREATE `W\libs\backend\agent-sdk\src\lib\lane-routing\structured-decision.adapter.ts` (+ spec); MODIFY `W\libs\backend\agent-sdk\src\lib\di\register.ts`
- Plan reference: implementation-plan.md:752; part-a:489-498 (§10), :937
- Pattern to follow: `sdk-internal-query.curator-llm.ts:214-256`; `internal-query.types.ts:65`
- Quality requirements: resolver throws → `auth`; network → `unreachable`; no structured output → `bad-output`; `isReady(providerId)` via the auth resolver
- Validation notes: PA-3 first (`internal-query.types.ts:40-80`); R-8 — confirm `lane-routing` imports neither agent-sdk nor anything that imports it (`npx nx lint @ptah-extension/agent-sdk`); rule 8 guard specs for the new registration
- Implementation details: registered under `LANE_ROUTING_TOKENS.STRUCTURED_DECISION`

### Batch 19 verification

- `J(libs/backend/agent-sdk, <adapter spec>)`, then `npx nx typecheck @ptah-extension/agent-sdk`, then `npx nx lint @ptah-extension/agent-sdk`, then rule-8 guard specs

## Batch 20 (B4c): Recorder, reader, signals, join, DI — PENDING

- Recommended executor: CLI lane codex (OpenAI)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer (full brief every spawn)
- Subagent reason: N/A
- Review family: different from implementer — P2 reviewed by Anthropic
- Rationale: last third of plan batch B4; unblocks B5, B6, B7
- Tasks: 1 | Depends on: Batch 15
- Phase: P2 Outcome store core | Phase review: code-logic + code-style

### Task 20.1: Recorder (SC-4 hook), reader (`LaneOutcomeQueries`), signals, subagent join, DI — PENDING

- File: CREATE `LO\lane-outcome-recorder.service.ts`, `LO\lane-outcome-reader.service.ts`, `LO\skill-telemetry-seam.port.ts`, `LO\agent-signals.ts`, `LO\subagent-join.ts`, `LO\di\register.ts`, `LO\di\start.ts` (spec beside each logic file); MODIFY `W\libs\backend\lane-outcomes\src\index.ts`
- Plan reference: implementation-plan.md:738; part-b:225-329 (§3, `computeAgentSignals` :286); SC-2 :143-167; SC-4 :181-215; SC-9 :375-382; SC-10 lifecycle ~:490
- Pattern to follow: Batch 6 tokens; `register*Services(container, logger)` structural logger (SC-9)
- Quality requirements: recorder calls the `LaneFailureClassifier` fire-and-forget once per newly inserted lane record with a null class (decision I4); `startLaneOutcomes` returns an awaited disposer (SC-10 flush); `agentSignals(slugs, 30)` per Req 9.1
- Validation notes: PB-1 first (read the agent-sdk producer of `SubagentStopPayload`); fallback `subagentSessionId` as `run_id`
- Implementation details: no host root edits (AB14)

### Batch 20 verification

- `npx nx test @ptah-extension/lane-outcomes --parallel=1`, then `npx nx lint @ptah-extension/lane-outcomes`, then `npx nx typecheck @ptah-extension/lane-outcomes`

## Batch 21 (A8): Route decide pipeline — PENDING

- Recommended executor: subagent backend-developer (Anthropic, in-process)
- Execution mode: sequential
- Fallback order: codex lane is excluded (P3 reviewer); grok -> antigravity
- Subagent reason: plan row A8 — integration of five modules with a long fixture set and the lib's `register.ts`/index; needs interactive reading across all wave 3-4 outputs
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: critical path; first slot of wave 5
- Tasks: 1 | Depends on: Batch 16, Batch 17, Batch 11, Batch 12, Batch 13
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 21.1: `RouteDecideService`, pipeline, DI register, index — PENDING

- File: CREATE `LR\route-decide.service.ts`, `LR\pipeline\gather.ts`, `LR\pipeline\model-refine.ts`, `LR\pipeline\answer-validation.ts`, `LR\route-decide.gate.spec.ts`, `LR\route-decide.preflight.spec.ts`, `LR\di\register.ts` (+ `register.spec.ts`); MODIFY `W\libs\backend\lane-routing\src\index.ts`
- Plan reference: implementation-plan.md:755; part-a:930 (Req 2.7, 3.1, 3.7, 4.1-4.6, 7.7-7.8, 11.2-11.5, 12.3-12.9)
- Pattern to follow: Batches 9-17 modules
- Quality requirements: a live `notFound` failure goes to `recheckAfterLiveNotFound`, never to `markUnsupported` directly (R3-2); `STRUCTURED_DECISION` optional
- Validation notes: acceptance — probe stubbed `ready` keeps the row `ready`; stubbed `unsupported-endpoint` shows it
- Implementation details: register takes the host logger (SC-9)

### Batch 21 verification

- `npx nx test @ptah-extension/lane-routing --parallel=1`, then `npx nx lint @ptah-extension/lane-routing`, then `npx nx typecheck @ptah-extension/lane-routing`

## Batch 22 (A12): Decision model settings row — PENDING

- Recommended executor: CLI lane antigravity (Google) — Angular frontend
- Execution mode: sequential
- Fallback order: Glm -> grok -> subagent frontend-developer
- Subagent reason: N/A
- Review family: different from implementer — P4 reviewed by OpenAI; visual-reviewer subagent
- Rationale: one frontend lib
- Tasks: 1 | Depends on: Batch 18
- Phase: P4 Decision-model settings | Phase review: code-logic + visual

### Task 22.1: Decision-model row in orchestration settings — PENDING

- File: CREATE `decision-model-row.component.ts` (+ spec) under `W\libs\frontend\chat\src\lib\`; MODIFY `provider-consumer-rows.ts` (+ spec), `provider-consumer-assignments.component.ts`, `orchestration-settings.component.ts` (+ spec)
- Plan reference: implementation-plan.md:756; part-a:936, §11
- Pattern to follow: existing provider-consumer rows
- Quality requirements: row shows `ready` / `unsupported-endpoint` / detail text from the DTO; no new DTO states
- Validation notes: TASK_2026_658 overlap check first (`W\.ptah\specs\TASK_2026_658_advanced_settings\`); R-10 before screenshots (dark + light) of orchestration settings from c57a9a1e7
- Implementation details: reads/writes through `agent:getConfig`/`agent:setConfig`

### Batch 22 verification

- `J(libs/frontend/chat, <changed specs>)`, then `npx nx lint @ptah-extension/chat`

## Batch 23 (B5): Lane write point, failure class, spawn-field copy — PENDING

- Recommended executor: CLI lane codex (OpenAI)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer (full brief)
- Subagent reason: N/A
- Review family: different from implementer — P5 reviewed by Anthropic
- Rationale: part B chain (R-2); resolves PB-4, PB-5, IA-2
- Tasks: 1 | Depends on: Batch 2, Batch 20
- Phase: P5 Outcome producers + Agents tab | Phase review: code-logic + code-style + visual

### Task 23.1: Lane failure class, auth classifier, notifier enqueue, APM field copy — PENDING

- File: CREATE `W\libs\backend\cli-agent-runtime\src\lib\limits\lane-failure-class.ts` (+ spec), `W\libs\backend\cli-agent-runtime\src\lib\limits\lane-auth-classifier.ts` (+ spec); MODIFY `W\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.ts` (+ spec), `W\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`, `W\libs\backend\cli-agent-runtime\src\index.ts`
- Plan reference: implementation-plan.md:747; part-b:330-376 (§4); SC-4, SC-5, SC-6, SC-10
- Pattern to follow: `lane-completion-notifier.service.ts:512-520` deliverable check
- Quality requirements: notifier call is an SC-10 enqueue (never awaits the store); family via `laneFamilyOf`; APM copies `taskKind`/`routingSource`
- Validation notes: signal-path specs with a 5 s store write and a throwing store; PB-4, PB-5 (export the deliverable helper), IA-2 first
- Implementation details: deterministic failure-class precedence list

### Batch 23 verification

- `J(libs/backend/cli-agent-runtime, <classifier, auth, notifier specs>)`, then `npx nx typecheck @ptah-extension/cli-agent-runtime`

## Batch 24 (B6): Kept skill-synthesis stores — PENDING

- Recommended executor: CLI lane grok (xAI)
- Execution mode: sequential
- Fallback order: Glm -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P5 reviewed by Anthropic
- Rationale: one lib; decision #23 items 1-3
- Tasks: 1 | Depends on: Batch 4, Batch 20
- Phase: P5 Outcome producers + Agents tab | Phase review: code-logic + code-style + visual

### Task 24.1: Trigger, recorder dedup by `runId`, candidate store, seam adapter — PENDING

- File: MODIFY `W\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts` (+ spec), `W\libs\backend\skill-synthesis\src\lib\skill-invocation-recorder.ts` (+ spec), `W\libs\backend\skill-synthesis\src\lib\skill-candidate.store.ts` (+ spec), the skill-synthesis DI register file; CREATE `W\libs\backend\skill-synthesis\src\lib\outcome-seam\skill-telemetry-seam.adapter.ts` (+ spec)
- Plan reference: implementation-plan.md:748; part-b:408-468 (§6)
- Pattern to follow: existing recorder/store specs
- Quality requirements: recorder dedups by `runId` (finding 3); seam adapter implements `LO` seam port
- Validation notes: PB-1, PB-3 first; rule 8 guard specs for the DI register edit
- Implementation details: `run_id` column from migration 0055

### Batch 24 verification

- `npx nx test @ptah-extension/skill-synthesis --parallel=1`, then rule-8 guard specs

## Batch 25 (B7): `agent:outcomeSignals` handler — PENDING

- Recommended executor: CLI lane Glm (Zhipu)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P5 reviewed by Anthropic
- Rationale: one handler + registration; after A10 (same registration file)
- Tasks: 1 | Depends on: Batch 2, Batch 20, Batch 14
- Phase: P5 Outcome producers + Agents tab | Phase review: code-logic + code-style + visual

### Task 25.1: Outcome-signals RPC handler — PENDING

- File: CREATE `W\libs\backend\rpc-handlers\src\lib\handlers\agent-outcome-rpc.handlers.ts` (+ spec), `W\libs\backend\rpc-handlers\src\lib\handlers\agent-outcome.schema.ts`; MODIFY `W\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts`, `W\libs\backend\rpc-handlers\src\lib\rpc-allowlist.spec.ts`, `W\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` (the `'agent:outcomeSignals'` `RPC_HANDLER_MANIFEST` entry; added at Batch 2 verify — without it the manifest totality invariant and the three host `rpc-surface.spec.ts` partitions stay one method short)
- Plan reference: implementation-plan.md:753; part-b:469-493 (§7); SC-8 :368-374
- Pattern to follow: existing `agent:*` handler classes
- Quality requirements: Zod `.strict()`, at most 500 slugs of at most 200 chars; result `{ signals, windowDays: 30, persistent }`
- Validation notes: rule 8 — run the RPC guard specs (vscode, electron, cli-engine `rpc-surface.spec.ts` + `surface-composition.spec.ts`) and the vscode/electron/cli `container.smoke.spec.ts`, one at a time; if a spec is red only because `LANE_OUTCOME_TOKENS` are registered in AB14, stop and report (R-6). R-5 (DEFERRED here from Batch 2): the `rpc.types.ts` entry already exists (Batch 2 kept it); this batch owns the R-5 guard-spec check — vscode/electron/cli-engine `rpc-surface.spec.ts` + `surface-composition.spec.ts` and `rpc-allowlist.spec.ts` "claims every registry method exactly once" must all go green, and if the handler's `requires` capability switches it off on a host, the served-vs-absent list edit (e.g. `VSCODE_EXPECTED_ABSENT_METHODS`) is made here
- Implementation details: reader via the lane-outcomes token

### Batch 25 verification

- `J(libs/backend/rpc-handlers, <outcome handler spec> libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts)`, then `npx nx typecheck @ptah-extension/rpc-handlers`, then rule-8 guard specs

## Batch 26 (A9a): Route tool modules — PENDING

- Recommended executor: CLI lane antigravity (Google)
- Execution mode: sequential
- Fallback order: Glm -> grok -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P6 reviewed by OpenAI
- Rationale: critical path; new files only, no registration edits
- Tasks: 1 | Depends on: Batch 21
- Phase: P6 MCP + host integration | Phase review: code-logic + code-style

### Task 26.1: `ptah_route_decide` tool modules and namespace builder — PENDING

- File: CREATE `VLT\mcp-core\route-tools.ts`, `VLT\mcp-core\route-tool-handlers.ts`, `VLT\namespace-builders\route-namespace.builder.ts`, and their specs
- Plan reference: implementation-plan.md:757; part-a §8, :931-932
- Pattern to follow: existing `mcp-core` tool modules
- Quality requirements: no edits to `protocol-dispatcher.ts`, `tool-result-budget.ts` or other registration files (AB9)
- Validation notes: PA-4 first (`ptahAPI.agent.listRoles()`)
- Implementation details: handler calls `RouteDecideService` through its token

### Batch 26 verification

- `J(libs/backend/vscode-lm-tools, <route specs, namespace spec>)`

## Batch 27 (A16): Decision-model failure classifier — PENDING

- Recommended executor: CLI lane grok (xAI)
- Execution mode: sequential
- Fallback order: Glm -> antigravity -> subagent backend-developer
- Subagent reason: N/A
- Review family: different from implementer — P3 reviewed by OpenAI
- Rationale: one classifier + register/index edits after A8
- Tasks: 1 | Depends on: Batch 21
- Phase: P3 Routing engine | Phase review: code-logic + code-style

### Task 27.1: `DecisionModelFailureClassifier` behind `FAILURE_CLASSIFIER` — PENDING

- File: CREATE `LR\failure-class\decision-model-failure-classifier.ts` (+ spec); MODIFY `LR\di\register.ts` (+ spec), `W\libs\backend\lane-routing\src\index.ts`
- Plan reference: implementation-plan.md:758; SC-4 :181-215
- Pattern to follow: Batch 21 `answer-validation.ts`
- Quality requirements: spec — unset → zero requests; fake client counts exactly 1; below threshold → null; outside five → null; payload field set pinned
- Validation notes: rule 9
- Implementation details: implements the shared `LaneFailureClassifier` port

### Batch 27 verification

- `npx nx test @ptah-extension/lane-routing --parallel=1`, then `npx nx lint @ptah-extension/lane-routing`

## Batch 28 (B10a): Report tool module — PENDING

- Recommended executor: CLI lane codex (OpenAI)
- Execution mode: sequential
- Fallback order: grok -> antigravity -> subagent backend-developer (full brief)
- Subagent reason: N/A
- Review family: different from implementer — P5 reviewed by Anthropic
- Rationale: part B chain (R-2); new file only
- Tasks: 1 | Depends on: Batch 20, Batch 23
- Phase: P5 Outcome producers + Agents tab | Phase review: code-logic + code-style + visual

### Task 28.1: `ptah_outcome_report` tool module — PENDING

- File: CREATE `VLT\mcp-core\tools\outcome-report.tool.ts` (+ spec)
- Plan reference: implementation-plan.md:754; part-b:494-551 (§8); SC-7 :254-367
- Pattern to follow: Batch 26 tool modules
- Quality requirements: imports `OutcomeReportArgsSchema` from lane-outcomes (no second schema); `reportId` per call; held deliverables store stat facts only; `held`/`queued` results; no registration edits
- Validation notes: fixtures — repeated/concurrent same-run sequence by run tag and by `agentId`; report-before-stop; held review; R3-1 tool fixture: real pipeline over a fake connection (`isOpen = false`), journal `[L1]`, review for `L9` → error naming `L9`, journal unchanged, `InMemoryLaneOutcomeStore` has no row, receipt or hold after open; a `subagent:` deliverables report in the same state → `held`. IA-4 dev capture if feasible (optimisation only)
- Implementation details: deliverable check via the helper exported by Batch 23 (PB-5)

### Batch 28 verification

- `J(libs/backend/vscode-lm-tools, <outcome-report spec>)`

## Batch 29 (AB9): MCP registration for both tools — PENDING

- Recommended executor: subagent backend-developer (Anthropic, in-process)
- Execution mode: sequential
- Fallback order: grok -> antigravity (codex excluded: P6 reviewer)
- Subagent reason: plan row AB9 — nine shared registration files for both tools; cross-cutting wiring stays in-process
- Review family: different from implementer — P6 reviewed by OpenAI
- Rationale: critical path; single owner of every registration file
- Tasks: 1 | Depends on: Batch 26, Batch 28, Batch 7
- Phase: P6 MCP + host integration | Phase review: code-logic + code-style

### Task 29.1: Register `ptah_route_decide` (always-on) and `ptah_outcome_report` (deferred) — PENDING

- File: MODIFY `VLT\...\protocol-dispatcher.ts` (route tool after `buildSessionHandoffTool()`; two `case`s in `switch (name)` at `:1037`), `tool-result-budget.ts`, `ptah-api-builder.service.ts`, the `PtahAPI` type file, `mcp-http\http-mcp-server.service.ts`, `mcp-stdio\{tool-builders.ts,agent-tool.dispatcher.ts,index.ts}`, `ptah-system-prompt.constant.ts` (two rows); tool-name registry specs
- Plan reference: implementation-plan.md:759; part-a §8; part-b §8
- Pattern to follow: `buildSessionHandoffTool()` registration
- Quality requirements: route tool always-on, report tool deferred; plus the IA-1 mapping lines Batch 7 deferred (below)
- IA-1 copy lines (moved from Batch 7): copy `taskKind` and `routingSource` from the parsed `AgentSpawnArgsSchema` result into `SpawnAgentRequest` beside the existing `role`/`effort` copy at both mapping sites — HTTP `VLT\mcp-core\protocol-dispatcher.ts:1212-1227` (request built at `:1226`, `effort: spawnArgs.effort`; `role` at `:1225`), stdio `VLT\mcp-stdio\agent-tool.dispatcher.ts:434-448` (`ptahAPI.agent.spawn({...})`, `effort: p.effort` at `:448`; parsed at `:384`). Line numbers as of commit of Batch 7; re-locate by the `effort` copy. Add one spec per transport proving both fields reach `SpawnAgentRequest`, and `undefined` when absent
- Validation notes: file cap exception (plan: one owner for all registration files); rule 8 — tool-name registry specs updated here
- Implementation details: both dispatchers (HTTP, stdio) serve both tools

### Batch 29 verification

- `npx nx test @ptah-extension/vscode-lm-tools --parallel=1` (covers A1b, B10a, A9a), then `npx nx typecheck @ptah-extension/vscode-lm-tools`

## Batch 30 (AB14): Host wiring and guard specs — PENDING

- Recommended executor: subagent backend-developer (Anthropic, in-process)
- Execution mode: sequential
- Fallback order: grok -> antigravity (codex excluded: P6 reviewer)
- Subagent reason: plan row AB14 — three composition roots plus app guard specs; touches pre-push gates
- Review family: different from implementer — P6 reviewed by OpenAI
- Rationale: final integration; resolves IA-3
- Tasks: 2 | Depends on: Batches 21, 14, 19, 27, 29, 20, 23, 24, 25
- Phase: P6 MCP + host integration | Phase review: code-logic + code-style

### Task 30.1: Register both libs in the three roots — PENDING

- File: MODIFY `W\apps\ptah-extension-vscode\src\di\phase-2-libraries.ts`, `W\apps\ptah-electron\src\di\phase-2-libraries.ts`, `W\libs\backend\cli-engine\src\lib\container.ts`
- Plan reference: implementation-plan.md:760; SC-3 :168-180; SC-10 shutdown; part-a §12; part-b:590-607 (§10)
- Pattern to follow: `useToken` precedent `phase-2-libraries.ts:214` (vscode), `:302` (electron)
- Quality requirements: `registerLaneOutcomeServices` before `registerCliAgentRuntimeServices`; `registerLaneRoutingServices` before `registerVsCodeLmToolsServices`; SC-3 aliases; `startLaneOutcomes` disposer awaited on host shutdown; PA-1/PA-2 fallbacks if those batches reported them
- Validation notes: write-path trace inputs (matrix store path, decision-model mark key, outcome journal key) collected for Mode 3
- Implementation details: logger passed per root (SC-9)

### Task 30.2: Guard specs and validate-deps — PENDING

- Depends on: Task 30.1
- File: MODIFY `W\apps\ptah-extension-vscode\src\di\expected-resolvable.ts`, `W\apps\{ptah-extension-vscode,ptah-electron,ptah-cli}\src\di\container.smoke.spec.ts`, `rpc-surface.spec.ts`, Electron `surface-composition.spec.ts`; validate-deps allowlist only if the pre-push gate flags a new lib
- Plan reference: implementation-plan.md:760; IA-3 row :805
- Pattern to follow: existing smoke specs
- Quality requirements: smoke specs resolve `LANE_ROUTING_TOKENS.LANE_OUTCOME_READER` and `LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER` in each host (IA-3); VS Code smoke resolves `KeyValueLaneOutcomeStore` over `PLATFORM_TOKENS.STATE_STORAGE`
- Validation notes: R-6, R-7
- Implementation details: none beyond the listed specs

### Batch 30 verification

- One at a time: `J(apps/ptah-extension-vscode, apps/ptah-extension-vscode/src/di)`, then `npx nx test ptah-electron --parallel=1`, then `npx nx test @ptah-extension/cli-engine --parallel=1`, then `npx nx test ptah-cli --parallel=1`

## Batch 31 (A15): Orchestration skill integration — PENDING

- Recommended executor: CLI lane opencode (light docs work; near monthly limit)
- Execution mode: sequential
- Fallback order: Glm -> grok -> subagent (any)
- Subagent reason: N/A
- Review family: n/a — docs only; team-leader checks grep evidence
- Rationale: assets only, file-disjoint from Batch 30; opencode may lack `ptah_*` tools, which this batch does not need
- Tasks: 1 | Depends on: Batch 29
- Phase: P7 Skill docs | Phase review: none — docs only

### Task 31.1: Skill text for routing and outcome reports — PENDING

- File: MODIFY `W\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\SKILL.md`, `...\orchestration\references\lane-assignment.md`, `...\agent-lanes\SKILL.md`
- Plan reference: implementation-plan.md:761; part-a:939, §13; decision I8; Handoff to TASK_2026_662_3eea :807-820
- Pattern to follow: existing skill sections
- Quality requirements: Req 8.7 call sites (three, R3); spawn passes `taskKind`/`routingSource`; subagent reports use the Ptah run tag `runId`, else the Agent result `agentId`; `held`/`queued` count as reported; reviews keep the `runId`; skip silently when the tool is not listed; no vendor-to-task tables (Req 6.9)
- Validation notes: PA-5 first; IA-4 is an optimisation only
- Implementation details: grep for vendor-to-task tables and both tool names; record results in the report

### Batch 31 verification

- Grep evidence in the report: no vendor-to-task tables; `ptah_route_decide` and `ptah_outcome_report` present at the named call sites. No Nx run.
