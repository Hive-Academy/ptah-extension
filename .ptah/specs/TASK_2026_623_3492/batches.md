# Batches - TASK_2026_623_3492

Total tasks: 85 | Batches: 40 (incl. fix batches 6F, 12F, 15F, 21F, 28F, 33F, post-cap correction 12F2) | Complete: 40/40

Worktree root `W` = `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel` (branch
`feat/task-623-display-panel`, base `70f995a56`). Every path below is absolute.

Inputs: implementation-plan.md rev 2 (Gate 2), task-description.md rev 3.2, design-spec.md rev 3 + `prototype/`
(Gate 1.7), parity-inventory.md rev 2, decisions.md #1-#18.

## Chosen defaults (recorded, not asked)

- Batch boundaries and order follow the plan's batch table (implementation-plan.md:1383-1425) and its component
  dependency list (implementation-plan.md:1326-1336). The plan fixes the order, so no batching question is raised.
- Execution is strictly sequential, one batch at a time, because the user pinned subagents as implementers
  (decisions roster in the orchestrator prompt) and CLAUDE.md allows one heavy check at a time. The plan's
  parallel-safe sets (L* with frontend, P* with S*/D*) are not used; they would only overlap heavy checks.
- Implementation executors: `backend-developer` (shared, backend, scripts, hint) and `frontend-developer` (Angular).
  The skill text (DOC1) goes to `technical-content-writer`. No implementation batch is assigned to a CLI lane.
- Reviews: phase code-logic reviews run as Codex CLI lanes (user roster). Style review only for phases that add new
  public API. V1 visual review is the `visual-reviewer` subagent.
- Batch numbers are sequential; the plan's batch ids (S1, L3, C5 ...) are kept in each batch name.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1 `PtahAPIBuilder.build()` cost/memoization (`ptah-api-builder.service.ts:543`) — verified in Task 9.1: not memoized; the handler builds lazily once and does not cache a failed build (specs pin build-once, register-without-build, retry-after-failure).
  If not memoized the handler builds once lazily and keeps the `PtahAPI`.
- A2 `TOKENS.PTAH_API_BUILDER` registered before `registerRpcSurface` in Electron — verified:
  `registerVsCodeLmToolsServices` runs in `apps/ptah-electron/src/di/phase-3-storage.ts:134`, and
  `container.smoke.spec.ts:683` already resolves `TOKENS.PTAH_API_BUILDER`. Task 11.2 adds the resolution test.
- A3 every SDK subagent record's `parentToolUseId` matches a transcript node `toolCallId` — verified in Task 22.3
  (decision #93): it is the Task tool_use id, carried on the Task tool node even with no agent node; an unmatched R
  belongs to no turn (D7).
- A4 open-turn messages carry streaming text nodes in `vm().messages` — FALSE on the default path (Task 22.2,
  decision #94): with `STREAM_PRESENTATION_RECORDS_ENABLED` `vm().messages` changes only on structural changes. Task
  24.1 feeds both projections `vm().slots.map((slot) => slot.record())` with `vm().streamingBoundary`.
- A5 capabilities default false; expected-absent lists asserted — verified: `EXPECTED_ABSENT_CAPABILITIES` is read by
  `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` and `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`;
  Task 12.1 adds `lanePlanLimits` to both lists and runs both specs.
- A6 `add-component` / `locate` treat any layout kind as a parent — verified: `isSurfaceLayoutComponent` derives from
  `SURFACE_LAYOUT_KINDS` (`surface-bindings.ts:30-36`), so `accordion` is accepted once added. Only the error text at
  `surface-patch.ts:165` ("only section, stack, grid and card take children") is hard-coded; Task 2.2 updates it.
- A7 spark points count toward `maxSeriesPoints` per component like chart series (`dashboard-catalog.ts:167`) —
  unverified; checked in Task 1.2.
- A8 `surface-catalog-reference.spec.ts` (exists at
  `libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts`) derives or pins Apps text —
  checked in Task 31.2.
- A9 no exit code on `ExecutionNode` — unverified; checked in Task 27.1 (if absent, "Command succeeded/failed" with no
  number).
- Plan correction (path): the declarative-dashboard trust-boundary spec is
  `libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts` (not under `components/`). Task 15.2 extends it.
- Plan correction (commands): Nx project names are scoped, e.g. `@ptah-extension/shared`, `@ptah-extension/chat-ui`;
  the plain names in implementation-plan.md:1427-1474 are replaced by the scoped names in every batch below.
  `ptah-electron`, `ptah-extension-vscode` and `ptah-extension-webview` are unscoped.

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| V1 launch prerequisites exceed decisions.md #17's literal wording. No `dist/` exists in the worktree; `apps/ptah-electron/scripts/launch.js` needs `dist/apps/ptah-electron/main.mjs`, which only `nx build-dev ptah-electron` (main, preload and 5 worker builds) produces, plus `copy-renderer` and possibly `rebuild-native`. The main-process build is required anyway because this branch adds the `agent:getLanePlanLimits` handler. | HIGH | Batch 33 precondition: before V1 the orchestrator obtains a user ruling that the one "app launch" includes the Electron main-process build (`nx build-dev ptah-electron`) and native rebuild, with exactly one production webview build via `nx copy-renderer ptah-electron` (dependsOn `ptah-extension-webview:build`, production has `statsJson: true`). No batch before 33 is affected. |
| No merge-base `stats.json` exists (`dist/` absent), so the eager-closure growth check cannot run under the single-build rule. | MEDIUM | Task 33.2 records "growth check not run (single build, decisions.md #17)" and lists added eager inputs by name and bytes in measurement.md, as the plan prescribes. |
| Intermediate commits L1-L5 can leave cross-project specs red: L1 adds the RPC method to `RPC_METHOD_ENTRIES` before the manifest covers it (manifest coverage, `manifest.ts:486-539`); L3 adds a capability-gated entry before Electron/VS Code/CLI profiles list it. | MEDIUM | Batches 7-12 run back to back with no other batch interleaved. Batch 9 runs `resolve-handler-plan.spec.ts`; Batches 11 and 12 run the Electron, VS Code and CLI `rpc-surface` / `container.smoke` specs. Phase 2 review covers the combined diff. |
| `/3` behaviour regression from the `/4` bump (610 corpus, Apps renderer viewport layout). | HIGH | Task 1.2 (`/3` rejects `/4` features), Task 6.2 (610 corpus deep-equal except `catalogVersion`, plus `surface-contract`, `dashboard-trust-boundary`, `surface-budgets`, `host-source-registry.contract` specs), Task 13.1 (`layoutWidth` defaults to `'viewport'`). |
| Parser rewrite (`ptah-ui-parser.ts`) breaks 610 fences. | HIGH | Task 3.2 keeps every existing `ptah-ui-parser.spec.ts` case passing; Task 6.2 corpus. |
| `$limits` privacy / side effects (owner, account, email, CLI session ids; refresh or lane spawn). | HIGH | Task 7.1 field-by-field type; Task 9.1 recording-proxy tests (no `refresh`, no spawn/stop/session call), sentinel test; Task 10.1 lookup-level no-`refresh` case. |
| `formatPlanLimitsSection` / `formatAgentList` output drift after exporting `planLimitRows`. | MEDIUM | Task 8.1 byte-identical snapshot plus formatter-equivalence fixture; `mcp-response-formatter.spec.ts` runs. |
| Eager bundle growth: panel, renderer or summary leaking into the initial chunk. | HIGH | D14 chunking in Tasks 20.1, 25.1; Task 32.1 gate patterns; Task 33.2 real-build gate run. |
| Parity loss when the Electron tests row and change-set card leave the chat (decisions #5, #10). | HIGH | Task 19.1/21.2 port every `turn-tests-row.component.spec.ts` case before Task 24.2 deletes it; Task 24.1 keeps the VS Code path unchanged; Mode 3 row-by-row parity check. |
| Auto-open re-triggering after remount, or reopening a panel the user closed this turn (R1.7-R1.10). | MEDIUM | Task 20.2 (`seenBlockKeys` in the ChatView store, `userClosedTurnKey`), Task 23.1 store spec. |
| Shared-file sequencing: `chat-ui/src/index.ts` (Batches 16, 27) and `chat-ui/src/turn-recap.ts` (Batches 19, 24). | LOW | Sequential execution; noted on the tasks. |
| R7 preview changes reach the VS Code webview (decisions #8) — host branching untested. | MEDIUM | Tasks 26-28 run each spec for both host configurations where the component branches; V1 covers both webviews. |

Edge cases:

- Unclosed / streaming fence, closed fence then more streaming (same body must not re-apply) — Tasks 3.1, 20.2, 22.2.
- Reserved `ptah.` display id (R2.5) — Tasks 5.1, 20.1.
- Surface cap eviction order and `evicted` status (D11) — Task 20.1.
- Reload rebuilds the panel from stored messages; R-only fields "unavailable" after reload (D8, R2.9, R5.6) — Tasks
  4.2, 20.1, 22.3.
- Agents tab with no agents shows its own tabpanel empty state "No agents in this session" (decisions #11, R1.13) —
  Tasks 21.1, 25.1.
- CLI lanes show `context` "unavailable"; no context percent without a known limit (decisions #14, #16) — Task 4.2.
- `$limits` RPC failure or VS Code host (no capability) renders "unavailable" — Tasks 17.2, 9.1.
- Hint over 100 tokens: drop `$limits` first and record both counts (R8.1) — Task 29.1.
- Grid at 300 px is one column (R3.5 beats the 128 px design minimum) — Tasks 13.1, 15.1.
- Aborted / errored turn shows "(incomplete)" in the summary (parity row) — Task 19.1.
- No exit code on the node (A9) — Task 27.1.

## Phases

| Phase | Batches | Phase review |
| ----- | ------- | ------------ |
| 1 Contract `/4` and grammar | 1-6, 6F (fix) | code-logic (REVISE 6/10, `code-logic-review.md`); re-review of 6F: APPROVED 8/10 (`code-logic-review-phase1-fix.md`). Phase 1 ACCEPTED |
| 2 Lane plan-limit read (R10 backend) | 7-12, 12F (fix) | code-logic (REVISE 6/10, `code-logic-review-phase2.md`), style (APPROVED 8/10, `code-style-review-phase2.md`); fix round 12F, re-review REVISE 5/10 (`code-logic-review-phase2-fix.md`, Serious #1 open); post-cap correction 12F2 (decision #46), cross-side re-review APPROVED 9/10 (`code-logic-review-phase2-fix2.md`). Phase 2 ACCEPTED |
| 3 Renderer `/4` | 13-15, 15F (fix) | code-logic (REVISE 6/10, `code-logic-review-phase3.md`, Serious #1); fix round 15F, re-review APPROVED 8/10, Serious #1 CLOSED, no new findings (`code-logic-review-phase3-fix.md`). No style (Task 15.3 and 15F added no barrel exports). Phase 3 ACCEPTED |
| 4 chat-ui display panel | 16-21 | code-logic, plus style (new entry `@ptah-extension/chat-ui/display-panel`, new host-sources token) |
| 5 Transcript and dock | 22-25 | code-logic (APPROVED WITH NOTES 8/10, `code-logic-review-phase5.md`, Codex lane on `b57910d88..2ca5c9048`); #81 a/b/c and #94 PASS; one Minor (closed-tab dock state retained) recorded as a later item, decision #115. Phase 5 ACCEPTED |
| 6 Previews (R7, both webviews) | 26-28 | code-logic, plus style (new exported `copy-text-button` atom and `tool-language` util). Implementation complete (Batches 26-28 committed); review on `ec4347772..HEAD` pending (`code-logic-review-phase6.md`, `code-style-review-phase6.md`) |
| 7 Hint, skill, measurement, eager gate | 29-32 | code-logic |
| 8 Visual verification (V1) | 33, 33F (fix) | visual (visual-reviewer subagent); no code-logic. `visual-review.md` FAIL (D1, D2 serious) -> fix round 33F (commit 5a2344e37) -> scoped re-check `visual-review-33F.md` PASS WITH NOTES (D1, D2 FIXED; populated surfaces UNVERIFIED, named follow-up per USER #155(b)); decisions #158-#161. Phase 8 ACCEPTED |

Verification rule for every batch (CLAUDE.md): changed projects only, `--parallel=1`, `--maxWorkers=2`, one heavy check
at a time, output filtered with `| tail -n 40`, no build/serve/dev/e2e/package except Batch 33.

---

## Batch 1: S1 catalog `/4` contract — COMPLETE (commit 29c30cf06)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent with the same prompt
- Execution mode: sequential
- Rationale: four tightly coupled contract files (catalog, types, schemas, validator) whose types must agree.
- Tasks: 2 | Depends on: none
- Phase: 1 Contract `/4` and grammar | Phase review: code-logic (after Batch 6)

### Task 1.1: catalog `/4` constants, types and schemas — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-catalog.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.types.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.schemas.ts
- Plan reference: implementation-plan.md:176-200 (D1, D2), 390-432 (component 1)
- Pattern to follow: existing `/3` entries in `surface-catalog.ts:9-47`, `surface.types.ts:201-206`
- Quality requirements: `accordion` layout kind `{id, kind, title (required SurfaceRichText), children}`; `avatar`
  display kind; stat `trend` and `spark` (2..`maxSeriesPoints`); closed enums; no class/style/url/colour/icon field;
  `SURFACE_SUPPORTED_CATALOG_VERSIONS` gains `/4`; `DASHBOARD_CONTRACT_VERSION_PAIRS` gains `[spec/2, catalog/4]`.
- Validation notes: `/3` must remain semantically unchanged (released catalog, TASK_2026_594).
- Implementation details: add kinds/fields per version so `/3` vocabularies exclude them.

### Task 1.2: validator whole-pair check and `/3` rejection — COMPLETE

- Depends on: Task 1.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.validator.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-validator.spec.ts
- Plan reference: implementation-plan.md:176-190 (D1), 390-432
- Pattern to follow: `surface.validator.ts:150-163` (current `find` by schema, to be replaced by whole-pair match)
- Quality requirements: R4.1-R4.2; a `/3` envelope using a `/4` kind or field is rejected with a reason naming the
  field; spark points counted per component like chart series.
- Validation notes: verify A7 against `dashboard-catalog.ts:167` / `checkChart` and record the outcome in the report.
- Implementation details: pair check matches `[schema, catalog]` as a pair; add `/4` field rejection for `/3`.

### Batch 1 verification

- Every listed artifact exists and contains the required work
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`
- No per-batch review: Phase 1 code-logic review after Batch 6
- Edge cases above addressed

### Batch 1 decisions (recorded at verification)

- Verified on disk: jest `surface-validator.spec.ts` 109/109 passed; `@ptah-extension/shared` typecheck passed; lint 0
  errors, 6 warnings (includes `surface.schemas.ts` over the 700-line warning, 758 lines; left to the Phase 1 review).
- Out-of-list file ACCEPTED IN SCOPE: `libs/shared/src/mcp-apps-contracts/surface-bindings.ts`. The batch kept
  `SURFACE_LAYOUT_KINDS` at its `/3` value (Task 1.1 "add kinds per version"; `surface-contract.spec.ts` pins 19 `/3`
  kinds), so A6's walk had to switch to `SURFACE_CATALOG_4_LAYOUT_KINDS` or the validator would miss duplicate ids,
  inputs and submit scope inside `accordion`. Same lib, same rollback boundary, pinned by the spec case "walks accordion
  children". Committed with Batch 1. Task 2.2 now derives the patch message from `SURFACE_CATALOG_4_LAYOUT_KINDS`.
- `surface-contract.spec.ts:74-77` (pair count) is red from the Batch 1 commit: D1 mandates the third pair and no
  batch listed the spec as an edit target (Task 6.2 only ran it). Decision: moved the one-assertion update into Task 2.2
  and added the spec to the Batch 2 verification command, so the red window is one commit, inside Phase 1, in the same
  project. Batch 1 is not rejected: its own scoped command passes and the edit is outside its file list.
- `@ptah-extension/declarative-dashboard` typecheck is expected to be red from Batch 1 until Batch 13
  (`surface-view-model.ts:29-30,190-211`: `SurfaceComponent` now includes `accordion` / `avatar`, unmapped). Not run
  here (outside the batch's project, per CLAUDE.md). Decision: acceptable, no reorder. Batch 13 depends only on
  Batch 2 but runs in plan order; no `/4` producer exists before Batch 4 and no consumer is wired before Phase 4, so
  nothing breaks at runtime; Batch 13's own verification command already runs that typecheck and must clear it.
  Constraint: no batch between 2 and 12 may run `declarative-dashboard` typecheck as its acceptance gate, and the
  branch must not be pushed for CI or merged before Batch 13 commits. The Phase 1 review is told this is known.

## Batch 2: S2 text fallback, index, patch text, budgets — COMPLETE (commit e6826d07d)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: small follow-ons to S1 in the same lib, ordered after the types.
- Tasks: 3 | Depends on: Batch 1
- Phase: 1 | Phase review: code-logic (after Batch 6)

### Task 2.1: text fallback for `accordion`, `avatar`, stat trend/spark — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-text-fallback.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-text-fallback.spec.ts
- Plan reference: implementation-plan.md:390-432
- Pattern to follow: existing kind cases in `surface-text-fallback.ts`
- Quality requirements: every new kind has a readable text fallback.
- Validation notes: none beyond `/3` fallback output unchanged.
- Implementation details: extend the kind switch; spec covers each new kind.

### Task 2.2: barrel exports, patch error text (A6), contract pair spec — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.index.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-patch.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-contract.spec.ts
    (added at Batch 1 verification, see the Batch 1 decisions)
- Plan reference: implementation-plan.md:367-370 (A6), 423-431
- Pattern to follow: `surface-patch.ts:160-166`
- Quality requirements: export new types and the new `SURFACE_CATALOG_VERSION_4` / `SURFACE_CATALOG_4_*` constants;
  the parent-kind error message names `accordion` (derive the list from `SURFACE_CATALOG_4_LAYOUT_KINDS`, not a
  literal — Batch 1 kept `SURFACE_LAYOUT_KINDS` at the `/3` value); `surface-contract.spec.ts:74-77` expects the
  third pair `['dashboard-spec/2', SURFACE_CATALOG_VERSION_4]` (D1), and its `/3` assertions (19 kinds) stay
  unchanged.
- Validation notes: A6 verified at decomposition (`surface-bindings.ts:30-36`); only the message is hard-coded.
- Implementation details: message built from the layout-kinds constant.

### Task 2.3: budgets spec for spark points (A7) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-budgets.spec.ts
- Plan reference: implementation-plan.md:371-372 (A7)
- Pattern to follow: `dashboard-budgets.spec.ts:133` (`maxSeriesPoints` case)
- Quality requirements: spark above the per-component point budget is rejected; at the limit accepted.
- Validation notes: consistent with Task 1.2's A7 finding.
- Implementation details: add boundary cases.

### Batch 2 verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/surface-text-fallback.spec.ts libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`
- No per-batch review

### Batch 2 decisions (recorded at verification)

- Verified on disk:
  - `avatar` case and `renderStatExtras` in `surface-text-fallback.ts`;
  - `PARENT_KINDS_TEXT` in `surface-patch.ts`, derived from `SURFACE_CATALOG_4_LAYOUT_KINDS`;
  - the `/4` constant and type exports in `surface.index.ts`;
  - the third pair and the `SURFACE_CATALOG_VERSION_4` assertion in `surface-contract.spec.ts`;
  - the A7 spark boundary cases in `surface-budgets.spec.ts`.
- Scoped checks passed:
  - Jest: 5 suites, 254 tests (the Batch 2 spec list plus `surface-patch.spec.ts`, in one invocation);
  - `@ptah-extension/shared` typecheck;
  - lint: 0 errors and 6 warnings, the same warnings as Batch 1.
- Out-of-list file `surface-patch.spec.ts` is ACCEPTED IN SCOPE (decision #22). It pinned the old parent-kinds literal
  that Task 2.2 had to change, and it gains the `avatar`-into-`accordion` case. Same lib, same rollback boundary.
- The contract-pair red window from Batch 1 (decision #20) is closed by this commit.
- Noted for later, not a Batch 2 defect: the main barrel `mcp-apps-contracts/index.ts:113-120` does not re-export
  `SURFACE_CATALOG_VERSION_4`. A zod-free consumer in a later batch may need it there; the `/surface` subpath already
  has it.

## Batch 3: S3 fence and parser rewrite — COMPLETE (commit d702fc14a)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: parser rewrite with its types and fence tokenizer; one coherent grammar unit needing design judgement.
- Tasks: 2 | Depends on: Batch 1
- Phase: 1 | Phase review: code-logic (after Batch 6)

### Task 3.1: types and fence (`display [id]`, closed fences only) — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui.types.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-fence.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-fence.spec.ts
- Plan reference: implementation-plan.md:433-514 (component 2)
- Pattern to follow: existing `segmentPtahUi` in `ptah-ui-fence.ts`
- Quality requirements: R2.1, R2.7; info string `ptah-ui display [id]`; unclosed fences never yield a block.
- Validation notes: 610 fences (no `display`) unchanged.

### Task 3.2: parser REWRITE (nested layout grammar) — COMPLETE

- Depends on: Task 3.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-parser.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-parser.spec.ts
- Plan reference: implementation-plan.md:449-502 (R3 EBNF, lexical delta, caps)
- Pattern to follow: current parser error/reason shape
- Quality requirements: R3.1-R3.4; row/col/grid/card/section/accordion; stat trend + spark; progress, badge, avatar,
  note; depth and size caps; every existing parser spec case still passes.
- Validation notes: HIGH risk of 610 regression; keep the existing spec cases unchanged.

### Batch 3 verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-fence.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`
- Added at verification (decision #24): `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.spec.ts --coverage=false --maxWorkers=2`
- Result: fence + parser 2 suites / 180 tests passed; typecheck passed; lint 0 errors, 6 baseline warnings;
  converter + resolver + pipeline 3 suites / 66 tests passed.

### Batch 3 decisions (recorded at verification)

- #23 Parser spec case `rejects note because it belongs to PR D` became `accepts note now that R3 folds in PR D`.
  Accepted: R3 adds `note` (task-description.md:403, 426, 442; implementation-plan.md:464, 504), so the old case
  pins behaviour the requirements remove. Every other 610 case is unchanged (one case only re-wrapped by Prettier).
- #24 Out-of-list `ptah-ui-converter.ts` (throw on new constructs, caught by `renderPtahUiBlock` → atomic code-block
  fallback) and `ptah-ui-resolver.ts` (`agents`/`limits` → "unavailable") accepted as interim seams; Tasks 4.1 and 5.1
  replace them. Because both files ship in this commit, their specs and the pipeline spec were run now (passed).
- #25 New `ptah-ui-lexical.ts` and `ptah-ui-values.ts` accepted (split to keep the parser under the 700-line
  `max-lines` limit; public exports unchanged, `PTAH_UI_SOURCES` re-exported from `ptah-ui-parser.ts`).
- #26 Fence segment uses `target?: 'display'` (absent = inline) instead of required `'inline'|'display'`. Accepted:
  same information, and 610 segments keep their exact shape. Consumers must test `target === 'display'` and treat an
  absent `target` as inline; notes added to Tasks 18.2 and 22.2.

## Batch 4: S4 converter and `$agents` source — COMPLETE (commit 31904b890)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: converter emits `/4`; the pure `$agents` module is consumed by the resolver next.
- Tasks: 2 | Depends on: Batch 3
- Phase: 1 | Phase review: code-logic (after Batch 6)

### Task 4.1: converter emits `/4`, maps new nodes — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-converter.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-converter.spec.ts
- Plan reference: implementation-plan.md:176-200 (D1 "converter always emits /4"), 433-514
- Quality requirements: R3.1 (the only literal change for 610 output is `catalogVersion`).
- Validation notes (decision #24): replace the Batch 3 interim `notConvertible(...)` throws with real `/4` mapping
  for containers, atoms and stat trend/spark; remove the seam.

### Task 4.2: pure `$agents` source module — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-agents-source.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-agents-source.spec.ts
- Plan reference: implementation-plan.md:515-567 (component 2a), D6-D8 (in 176-354)
- Pattern to follow: capacity predicate restates `libs/frontend/chat/.../session-live-stats.util.ts:77-89` over a passed
  evidence list (no import from chat)
- Quality requirements: R5.1-R5.13; allow-listed fact types only (no prompt/output text); turn vs `session` scope;
  `context` field (decisions #14), CLI lanes "unavailable" (#16), no percent without a known limit; unknown start sorts
  last by key (R5.11); reload yields "unavailable" for R-only fields (D8).
- Validation notes: shared is `type:util`; no imports from frontend libs.

### Batch 4 verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`

- Result: 2 suites / 82 tests passed; typecheck passed; lint 0 errors, 6 baseline warnings.

### Batch 4 decisions (recorded at verification)

- #27 Interim gap accepted: the converter now emits nested bindings (`c1.0.0`) but the resolver still maps top-level
  components only, so a source-bound value inside a container shows its placeholder text until Task 5.1. No commit
  between Batch 4 and Batch 5 is shipped or merged. Task 5.1 now carries this as an explicit requirement with a test.
- #28 `CliLaneFact` has no context field. Accepted: matches R5.10 and decision #16 (CLI `context` "unavailable" in
  this task); the follow-up CLI-context task adds the field.
- #29 `tokens` scalar is unavailable when any in-scope row's tokens are unavailable (same rule as `cost`, R5.3).
  Accepted: R5.3 says missing tokens are never zero and values are never guessed; a sum skipping an unknown row would
  be a guessed figure.
- #30 Other executor choices accepted: R tokens = input + output, else `totalTokens` (R5 names input + output first);
  fact `status` typed `string` so the unknown → `pending` rule is reachable; `ptah-ui-agents-source.ts` is not
  exported from the eager `surface.index.ts` barrel (D6: the module is lazy and forbidden-eager).

## Batch 5: S5 resolver and pipeline (`compilePtahUiBlock`) — COMPLETE (commit 00db87c36)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: resolver and pipeline share the live-source input contract (D5).
- Tasks: 2 | Depends on: Batch 4
- Phase: 1 | Phase review: code-logic (after Batch 6)

### Task 5.1: resolver with `$agents` / `$limits` inputs — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.spec.ts
- Plan reference: implementation-plan.md:200-215 (D5), 433-567
- Quality requirements: `agents?`, `limits?` inputs separate from `TurnSourceSnapshot`; missing source → "unavailable";
  reserved `ptah.` id invalid with reason "reserved display id" (R2.5, D11).
- Validation notes (decision #24): replace the Batch 3 interim `agents`/`limits` → "unavailable" branches in
  `scalarValue` and `rowsSource` with the real inputs. The parser already declares `'reserved-id'`; this task produces it.
- Required (decision #27): the resolver walks the component tree recursively (containers and `accordion` children),
  so every binding emitted by the converter at any depth (ids like `c1.0.0`) is resolved, including scoped
  `$agents.session.<field>` placeholders and `rows` bindings with `scope: 'session'`. Spec: a block with `$agents.total`
  in a stat nested two levels deep and a nested `table $agents session` resolves to real values, and no resolved
  surface text contains a `$agents.` / `$limits.` / `$diff.` placeholder.
- Required: build the `$agents` branches on `ptah-ui-agents-source.ts` (`resolvePtahUiAgents`, `agentsScalarValue`,
  `agentsRowValues`); do not re-implement merge or aggregation. Decide and pin by spec how a zero-agent `cost` scalar
  renders (`formatUsdCost(0)` gives `$0.0000`, a true zero, not a missing value).

### Task 5.2: pipeline `compilePtahUiBlock(body, surfaceId)` + `usedSources` — COMPLETE

- Depends on: Task 5.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-pipeline.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-pipeline.spec.ts
- Plan reference: implementation-plan.md:200-215 (D5)
- Quality requirements: parse+convert once per body; `renderPtahUiBlock` keeps its signature and composes
  compile/resolve/validate; an invalid block falls back atomically.
- Validation note (Batch 4): the converter no longer throws for containers, atoms or stat trend/spark (decision #24
  seam removed). Any pipeline spec case that expected the code-block fallback for those constructs must now expect a
  rendered `/4` surface.

### Batch 5 verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`
- Result (team-leader run): 2 suites, 83 tests passed; shared typecheck passed; shared lint 0 errors / 6 baseline
  warnings (none in the four batch files).

### Batch 5 decisions

- #31-#36 (decisions.md): six executor choices accepted, none reverted:
  - #31: the reserved-id check is in `compilePtahUiBlock`;
  - #32: `PtahUiLimitsInput` with `pending` lives in the resolver;
  - #33: `resolveCompiledPtahUiBlock`;
  - #34: `list $limits` lists each lane once;
  - #35: zero-agent cost is `$0.0000`;
  - #36: the budget reason names the limit, `<maxX> (<n>) exceeded`, as plan:64/477 and R3.3 require. The old generic
    text was the behaviour to replace.
- #37: the `surface.index.ts` exports go to Task 16.2 (the file and the shared checks join Batch 16). The
  `ptah-ui-agents-source.ts` forbidden-eager pattern goes to Task 32.1. Task 17.2 carries the `PtahUiLimitsInput`
  mapping.

## Batch 6: S6 corpus and compactness — COMPLETE (commit 7206eb973)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: closes Phase 1 with the regression corpus and R8.4/R8.5 measurements.
- Tasks: 2 | Depends on: Batch 5
- Phase: 1 (last batch) | Phase review: code-logic on Batches 1-6

### Task 6.1: corpus cases for the new grammar and skill examples — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui.corpus.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-compactness.spec.ts
- Plan reference: implementation-plan.md:433-514, 1146-1192 (examples become corpus cases)
- Quality requirements: R8.4; includes the subagent-usage dashboard, id update, and "CLI tools with usage and context
  stats" examples that DOC1 will publish.
- Validation notes (Batch 5, decisions #32-#36):
  - Render the corpus through `renderPtahUiBlock(body, {surfaceId, snapshot, agents?, limits?, countBytes})`. Supply
    `$agents`/`$limits` inputs as `PtahUiAgentsInput` / `PtahUiLimitsInput` (from `ptah-ui-agents-source.ts` /
    `ptah-ui-resolver.ts`).
  - A budget-breach case expects `<maxX> (<n>) exceeded`, not "block exceeds a display limit".
  - The "CLI tools with usage and context stats" example expects CLI-lane `context` as "unavailable" (#16, #28).

### Task 6.2: `$agents` compactness spec and `/3` regression run — COMPLETE

- File (CREATE): D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-agents-compactness.spec.ts
- Plan reference: implementation-plan.md:512 (R8.5), 1435-1438
- Quality requirements: fence vs markdown counts; 610 corpus deep-equal except `catalogVersion`.

### Batch 6 verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-agents-compactness.spec.ts libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts libs/shared/src/mcp-apps-contracts/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`
  (the executor locates any of these specs not under `mcp-apps-contracts/` with Glob and uses the real path)
- Phase 1 code-logic review due after commit
- Result (team-leader run): one Jest run of the six Batch 6 specs plus the three corpus consumers
  (`ptah-ui-parser.spec.ts`, `ptah-ui-converter.spec.ts`, `ptah-ui-pipeline.spec.ts`), with
  `host-source-registry.contract.spec.ts` at `libs/shared/src/lib/types/rpc/`: 9 suites, 529 tests passed. Shared
  typecheck passed. Shared lint: 0 errors, 6 baseline warnings.

### Batch 6 decisions

- #38: the `release`/`displayId` corpus fields are accepted. The `/3` goldens were checked against the base-commit
  converter logic.
- #39: `maxComponents (200)` cannot be reached from a fence body; no action.
- Phase 1 review: REVISE 6/10, 0 Blocking, 1 Serious (`code-logic-review.md`, Codex CLI lane). Fix round: Batch 6F
  (decision #40).

## Batch 6F: Phase 1 review fix — `list $limits` lanes independent of the row cap — COMPLETE (commit f0d5df3a4; review code-logic-review-phase1-fix.md APPROVED 8/10)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: one function and its spec in one file pair; the list-cap policy is a judgment the executor applies
  inside the same edit.
- Tasks: 1 | Depends on: Batch 6
- Phase: 1 (fix batch, last of phase) | Phase review: code-logic re-review scoped to the 6F commit only

### Task 6F.1: derive `list $limits` lanes from every row, then apply the list cap — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.spec.ts
- Review reference: code-logic-review.md, Serious #1 (`ptah-ui-resolver.ts:379-387`); decisions.md #34, #40
- Defect: `limitsRows` builds `lanes` from `shown` (rows already sliced to `SURFACE_LIMITS.maxTableRows`), so a lane
  whose windows all come after the cap is missing from `list $limits` while `$limits.lanes` still counts it.
- Fix (decision #40 policy):
  - Table path unchanged: `rows` = first `maxTableRows` rows, note `+<omittedRows> more`.
  - List path: ordered unique lanes from ALL of `limits.rows` (first-occurrence order; dedupe on the raw `row.lane`,
    clamp only for display), computed independently of `shown`.
  - List cap: `maxTableRows` also caps `list.items` (`dashboard-catalog.ts:165`). If unique lanes <= `maxTableRows`,
    list them all. If more, list the first `maxTableRows - 1` lanes and make the last item `+<n> more`, where `n` is
    the number of lanes not listed, so the list stays within the cap and the omission is visible (the list path
    renders no `notes`, `ptah-ui-resolver.ts:249-258`).
  - Update the `limitsRows` doc comment to state the list projection and its cap.
- Regression tests (required, in `ptah-ui-resolver.spec.ts`, near the existing cap case at ~line 555):
  1. `limits.rows` = `maxTableRows` rows for lane `codex` (distinct windows) followed by one row for lane `grok`;
     body `list $limits` → items exactly `['codex', 'grok']`; the same input with `table $limits` still has
     `maxTableRows` rows and the `+1 more` note (table behaviour unchanged).
  2. Lane cap: `maxTableRows + 2` distinct lanes, one row each → `list $limits` has exactly `maxTableRows` items,
     the first `maxTableRows - 1` are the lanes in input order and the last is `+3 more`.
  3. Exactly `maxTableRows` distinct lanes → all listed, no `+N more` item (boundary).
- Must not change: `$limits.*` scalar values, the pending/unavailable list status, `$agents`/`$runs` list paths.
- Out of scope (recorded, not fixed): `$agents`/`$runs` lists also take the first `maxTableRows` rows with no list
  `+N more` item; not flagged by the review and each row is one item there, so no item is silently merged away.

### Batch 6F verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`,
  then `npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`, then
  `npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20` (one at a time; 0 errors, 6 baseline warnings).
- The new case 1 fails on the pre-fix code (executor states that it confirmed this).
- After commit: one code-logic re-review scoped to the 6F commit.
- Result (team-leader run): `laneListItems(limits.rows)` verified on disk (dedupe on raw lane over all rows,
  clamp for display only, `maxTableRows - 1` lanes + `+N more` above the cap); the three regression cases are present.
  Jest 3 suites, 133 tests passed. Shared typecheck passed. Shared lint: 0 errors, 6 baseline warnings (resolver
  477 lines, spec 685 lines, both under max-lines).
- Phase 1 re-review (scoped to f0d5df3a4): APPROVED 8/10, Serious #1 CLOSED, no new findings
  (`code-logic-review-phase1-fix.md`). Phase 1 (Batches 1-6, 6F) accepted.

## Batch 7: L1 lane plan-limit RPC types — COMPLETE (commit 6d0421cb9)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: shared wire contract consumed by the handler (L3) and the webview source (C2).
- Tasks: 1 | Depends on: none (run after Batch 6 to keep shared commits ordered)
- Phase: 2 Lane plan-limit read | Phase review: code-logic + style (after Batch 12)

### Task 7.1: `agent:getLanePlanLimits` types and registration — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\lib\types\rpc\rpc-lane-plan-limits.types.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\lib\types\rpc\rpc-lane-plan-limits.contract.spec.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\lib\types\rpc.types.ts
- Plan reference: implementation-plan.md:994-1085 (component 10), D13
- Pattern to follow: `rpc.types.ts:4027-4066,4188-4202` (`RPC_METHOD_ENTRIES`)
- Quality requirements: R10.1-R10.4; response = exactly five text cells per row, four scalars, `asOf`; no owner,
  account, provider id, CLI session id or email; `provider:getPlanLimits` untouched.
- Validation notes: privacy sentinel in the contract spec.

### Batch 7 verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/rpc-lane-plan-limits.contract.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`

### Batch 7 result

- Verified on disk: closed types (no index signature, `Record<string, never>` params, no `refresh`), registry and
  `RPC_METHOD_ENTRIES` entries, `provider:getPlanLimits` untouched; no TODO/STUB markers.
- Jest 1 suite, 10 tests passed. Shared typecheck passed. Shared lint: 0 errors, 6 baseline warnings.
- Known red window (MEDIUM risk): manifest coverage and host `rpc-surface`/`container.smoke` specs may be red until
  Batches 9-12 land; do not push before Batch 12 (and Batch 13 per decision #21).

## Batch 8: L2 export `formatPlanLimitRows` — COMPLETE (commit 89894ac0a)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: one function export with byte-identical output proof.
- Tasks: 1 | Depends on: none
- Phase: 2 | Phase review: after Batch 12

### Task 8.1: export `planLimitRows` as `formatPlanLimitRows` — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-limit.formatter.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-limit.formatter.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\vscode-lm-tools\src\index.ts
- Plan reference: implementation-plan.md:1037-1041, D13
- Pattern to follow: `agent-limit.formatter.ts:147-232`
- Quality requirements: one implementation for both callers; `formatPlanLimitsSection` and `formatAgentList` output
  byte-identical; formatter-equivalence fixture per R10.2 case.

### Batch 8 verification

- `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/vscode-lm-tools --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/vscode-lm-tools --parallel=1 2>&1 | tail -n 20`

### Batch 8 result

- Verified on disk: `formatPlanLimitRows` = `limits.flatMap(planLimitRows)`; `formatPlanLimitsSection` calls it (one
  implementation); private `planLimitRows` unchanged; barrel exports the function and `type AgentLimit` (accepted
  deviation: the parameter type consumers need). Spec adds a byte-identity snapshot and an equivalence fixture per
  R10.2 case; no TODO/STUB markers.
- Jest 2 suites, 197 tests passed (re-run by team-leader). vscode-lm-tools typecheck passed. Lint: 0 errors,
  77 baseline warnings.
- Decision (Jest in this worktree): `jest.preset.js:30-35` maps `^marked$` to `<repo>/node_modules/marked`, and this
  worktree has no `node_modules`. Accepted evidence for worktree runs: the same command with a CLI
  `--moduleNameMapper` that repeats the lib's own mappers and points `^marked$` at
  `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js` — the same package Node resolves for every other
  import from this worktree. No repo file changes for it; CI (real checkout) is unaffected. Applies to every later
  vscode-lm-tools / app spec that reaches `marked`.

## Batch 9: L3 `LanePlanLimitsRpcHandlers` — COMPLETE (commit a59a701cd)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: one handler family with schema, manifest entry and capability; cross-file but one lib.
- Tasks: 2 | Depends on: Batches 7, 8
- Phase: 2 | Phase review: after Batch 12

### Task 9.1: handler class and zod schema — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.schema.ts
- Plan reference: implementation-plan.md:295-323 (D13), 994-1085
- Pattern to follow: `diagnostics-consent-rpc.handlers.ts:26-29,98-119`; `boot-rpc.schema.ts:1-14`
- Quality requirements: `@injectable()`; inject `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`, `TOKENS.PTAH_API_BUILDER`;
  `agent.list()` then `agent.limits(rows)`; never `refresh`; never spawn/stop/session; rows via `formatPlanLimitRows`;
  logs without row contents. Specs: recording proxy (no refresh, no lane), sentinel privacy test, failure → per-lane
  `failed`/undefined.
- Validation notes: resolve A1 (`ptah-api-builder.service.ts:543`); if `build()` is not memoized, build once lazily.

### Task 9.2: barrel, manifest entry and capability — COMPLETE

- Depends on: Task 9.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\index.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\host-profile\capabilities.ts
- Pattern to follow: `manifest.ts:459-467` (`diagnosticsConsent` entry)
- Quality requirements: entry `lanePlanLimits` with `requires: ['lanePlanLimits']`; capability defaults false.

- Batch 9 decisions: decisions.md #41 (out-of-list `host-profile.ts` `lanePlanLimits: false` accepted) and #42 (unavailable lookup throws plain `Error` with fixed text, not `RpcUserError`; accepted). Verified: Jest 2 suites / 27 tests (Batch 8 worktree mapper), rpc-handlers typecheck pass, lint 0 errors / 50 baseline warnings.

### Batch 9 verification

- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -n 20`

## Batch 10: L3b lookup never passes `refresh` — COMPLETE (commit 47d8fb903)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: single spec case in another lib.
- Tasks: 1 | Depends on: none
- Phase: 2 | Phase review: after Batch 12

### Task 10.1: lookup-level no-`refresh` case — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-lookup.service.spec.ts (exists; extend)
- Plan reference: implementation-plan.md:1082-1083, decisions #18
- Pattern to follow: existing cases in the same spec; `lane-limit-lookup.service.ts:110-168,186`
- Quality requirements: asserts the lookup never forwards `refresh`.

- Batch 10 verified: Jest 1 suite / 11 tests (Batch 8 `marked` mapper override on the command line), lint 0 errors / 45 baseline warnings. Test only, no production change; `lane-limit-lookup.service.ts:186` passes `{ signal }` only.

### Batch 10 verification

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx lint @ptah-extension/cli-agent-runtime --parallel=1 2>&1 | tail -n 20`

## Batch 11: L4 Electron enablement — COMPLETE (commit 02d47eb3b)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: root export plus Electron profile and container resolution proof.
- Tasks: 2 | Depends on: Batch 9
- Phase: 2 | Phase review: after Batch 12

### Task 11.1: root export and Electron capability flag — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\index.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-electron\src\rpc-host-profile.ts
- Plan reference: implementation-plan.md:295-323
- Pattern to follow: `rpc-host-profile.ts:43-45` (`goVetDiagnostics: true`)
- Quality requirements: `lanePlanLimits: true` in Electron only; no `registerSingleton` in `phase-4-handlers.ts`.

### Task 11.2: Electron container resolution test — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-electron\src\di\container.smoke.spec.ts
- Pattern to follow: `container.smoke.spec.ts:630-690`
- Quality requirements: `container.resolve(LanePlanLimitsRpcHandlers)` succeeds and registers its method (A2).

- Batch 11 verified: Jest 2 suites / 23 tests (Batch 8 `marked` mapper override on the command line), `nx typecheck ptah-electron` success, rpc-handlers lint 0 errors / 50 baseline warnings. Deviation accepted: the `composePhase3` helper in `container.smoke.spec.ts` keeps the same stub list and order, and both tests share it (behaviour-preserving, inside the assigned file). A2 is pinned: the handler's `apiBuilder` is the `TOKENS.PTAH_API_BUILDER` singleton, and it registers exactly `agent:getLanePlanLimits`. `lanePlanLimits: true` is set in the Electron profile only.

### Batch 11 verification

- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/container.smoke.spec.ts apps/ptah-electron/src/di/rpc-surface.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck ptah-electron --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -n 20`

## Batch 12: L5 expected-absent lists (VS Code, CLI) — COMPLETE (commit c8c137611; Phase 2 review pending)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: two one-line list edits with their asserting specs; closes Phase 2.
- Tasks: 1 | Depends on: Batch 9
- Phase: 2 (last batch) | Phase review: code-logic + style on Batches 7-12

### Task 12.1: add `lanePlanLimits` to both expected-absent lists — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\src\di\expected-absent.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\cli-engine\src\lib\rpc\expected-absent.ts
- Plan reference: implementation-plan.md:365-366 (A5), 1080-1081
- Pattern to follow: `expected-absent.ts:62-74`
- Quality requirements: R10.9; VS Code and CLI do not expose the read.

### Batch 12 verification

- `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
- Phase 2 code-logic + style review due after commit
- Phase 2 review: code-logic REVISE 6/10 (1 Serious, 1 Moderate; `code-logic-review-phase2.md`), style APPROVED 8/10
  no findings (`code-style-review-phase2.md`). Fix round: Batch 12F (decision #45).

## Batch 12F: Phase 2 review fix — malformed `agent.limits()` output and `null` params — COMPLETE (commit 76b125fa0; re-review REVISE 5/10, code-logic-review-phase2-fix.md)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: one handler and its spec; both findings sit in the same method.
- Tasks: 1 | Depends on: Batch 12
- Phase: 2 (fix batch, last of phase) | Phase review: code-logic re-review scoped to the 12F commit only

### Task 12F.1: fixed-text boundary over the whole response build; reject `null` params — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.spec.ts
- Review reference: code-logic-review-phase2.md Serious #1 (`:86-127`), Moderate #2 (`:78`); decisions #42, #45
- Fix (Serious #1): a resolved `agent.limits()` value that is `null`, not an array, or holds a row whose
  formatting/counting throws must end in the same fixed `Error('Lane plan limits are unavailable on this host')`,
  cause dropped, logged by error name only (never message). Either validate the resolved value (array, each item an
  object with an object `state`) before use, or wrap the formatting/counting in the same fixed-text path — the
  executor picks; both `formatPlanLimitRows` and the counts must be inside the boundary. `undefined` keeps its current
  "no lane limit lookup" path. A valid empty array still returns `rows: []` and zero counts.
- Fix (Moderate #2): normalise only `undefined` to `{}` (`params === undefined ? {} : params`); `null` reaches the
  strict schema and throws `RpcUserError(..., 'INVALID_PARAMS')` before the API is built or `list()` is called.
- Regression tests (required, in the spec):
  1. `limits` resolves `null` → rejects with exactly the fixed text.
  2. `limits` resolves a non-array (e.g. `{}` or a string) → fixed text.
  3. `limits` resolves `[ <valid row>, <malformed row whose getter/field access throws an Error with a sentinel
     message such as 'SENTINEL-lane-/home/acct'> ]` → fixed text; the sentinel appears in no logger call argument
     and the thrown error has no `cause`.
  4. `params = null` → `INVALID_PARAMS` `RpcUserError`; `build()` and `list()` not called.
  5. Existing omitted-params (`undefined`) case still succeeds.
- Must not change: response shape, cells 0-4 mapping, counts for valid input, read semantics (no `refresh`, only
  `list()`/`limits(rows)`), the lazy build cache and its retry-after-throw behaviour, the schema file.

### Batch 12F verification

- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.spec.ts --coverage=false --maxWorkers=2` with the Batch 8 `marked` `--moduleNameMapper` override (batches.md:571-576), `| tail -n 40`; then `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1 | tail -n 20`; then `npx nx lint @ptah-extension/rpc-handlers --parallel=1 | tail -n 20`. One at a time.
- Phase 2 code-logic re-review scoped to the 12F commit after commit
- Re-review (76b125fa0): REVISE 5/10, Moderate #2 CLOSED, Serious #1 OPEN (`unavailable()` could throw while
  inspecting a hostile caught value). Fix round spent; one bounded post-cap correction follows as Batch 12F2.

## Batch 12F2: post-cap correction — non-throwing error-name inspection — COMPLETE (commit e05d8250f; review code-logic-review-phase2-fix2.md APPROVED 9/10)

- Executor: orchestrator (one bounded post-cap correction, agent-lanes §6; decision #46)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 12F
- Phase: 2 (post-cap correction, last of phase) | Phase review: independent cross-side code-logic re-review scoped to
  the correction

### Task 12F2.1: `unavailable()` never throws while naming the caught value — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.spec.ts
- Change: module function `errorName(error: unknown): string` wraps the `instanceof`/`name` read in try/catch and
  returns `'uninspectable'` on throw; `unavailable()` logs `errorName(error)`. Spec `it.each` covers an Error whose
  `name` getter throws and a Proxy whose `getPrototypeOf` trap throws: fixed text, no `cause`, `errorName:
  'uninspectable'`, no sentinel in any logger argument.

### Batch 12F2 verification

- Orchestrator: handler spec 29/29 (marked override), `nx typecheck @ptah-extension/rpc-handlers` pass, eslint on both
  files exit 0. Team-leader rerun of the handler spec: 1 suite, 29/29 passed.
- Cross-side re-review: APPROVED 9/10, Serious #1 CLOSED, no new findings (`code-logic-review-phase2-fix2.md`).
  Phase 2 (Batches 7-12, 12F, 12F2) accepted.

## Batch 13: D1 renderer container layout and `/4` view model — COMPLETE (commit 51a6aa3a9)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: coupled renderer components and view model in one lib.
- Tasks: 2 | Depends on: Batch 2
- Phase: 3 Renderer `/4` | Phase review: code-logic (after Batch 15)

### Task 13.1: view model for `accordion`, `avatar`, trend, spark — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\view-model\view-model.types.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\view-model\surface-view-model.ts
- Plan reference: implementation-plan.md:568-629 (component 3)

### Task 13.2: `layoutWidth` input, container queries, accordion layout — COMPLETE

- Depends on: Task 13.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-node.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-layout.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-layout.component.spec.ts
- Plan reference: implementation-plan.md:248-264 (D9), 568-629
- Quality requirements: `layoutWidth = input<'viewport'|'container'>('viewport')`; Apps page unchanged; container mode:
  one column below 360 px, `auto-fit minmax(min(100%,128px),1fr)` above with `columns` as ceiling, stat grids 3 cols
  at ≥ 700 px; accordion closed by default with toggle ARIA (R4.6, R9.1-R9.4); section open by default.

### Batch 13 verification

- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20`

### Batch 13 decisions (recorded at verification)

- Team-leader reran: Jest 5 suites / 111 tests passed (layout, node, renderer, view-model, trust-boundary specs);
  `nx typecheck @ptah-extension/declarative-dashboard --skip-nx-cache` passes (decision #21 closed, #47);
  lint 0 errors / 115 warnings.
- Out-of-list `surface-node.component.spec.ts` edit accepted (decision #48).
- Avatar node wiring moved to new Task 15.0 (decision #49): Batch 14 is at the 6-file cap.
- Section collapse container-only and container root stat grid accepted (decision #50).

## Batch 14: D2 stat trend/sparkline and avatar — COMPLETE (commit cf913a15f)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: new display atoms sharing the geometry helper.
- Tasks: 2 | Depends on: Batch 13
- Phase: 3 | Phase review: after Batch 15

### Task 14.1: stat trend pill and sparkline — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\charts\sparkline-geometry.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\dashboard-sparkline.component.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\dashboard-stat.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\dashboard-stat.component.spec.ts
- Plan reference: implementation-plan.md:568-629; design-spec.md (stat, sparkline)
- Pattern to follow: `charts/chart-geometry.ts`
- Quality requirements: R4.3-R4.5; highlight uses theme `primary` (decisions #12); polarity good/bad tone via semantic
  tokens; accessible text for trend; no per-element timers.

### Task 14.2: avatar atom — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\dashboard-avatar.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\dashboard-avatar.component.spec.ts
- Quality requirements: R4.7-R4.8; initials only, no URL or image (trust boundary).
- Validation notes: input shape is the Batch 13 `AvatarNode` (`view-model.types.ts`: `name`, optional `subtitle`,
  `selectable`). Do NOT edit `surface-node.component.ts` here; the node switch wiring is Task 15.0 (decision #49).
- Stat inputs (Task 14.1): stat `DisplayNode` carries optional `trend` and `spark` (already validated by the view
  model). Use the renderer tokens `--dp-su-text`, `--dp-er-text`, `--dp-hl`, `--dp-bar-dim`, `--dp-er-fill`.

### Batch 14 verification

- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.spec.ts libs/frontend/declarative-dashboard/src/lib/components/dashboard-avatar.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20`

- Team-leader verification: 4 created + 2 modified files read on disk; jest 2 suites 16/16, typecheck passed, lint
  0 errors / 127 warnings (new warnings are spec `no-non-null-assertion` only).
- Failing-series signal ruled: `trend.polarity === 'bad'` draws the latest spark bar in `--dp-er-fill` (decision #51).

## Batch 15: D3 container-width and trust-boundary specs, exports — COMPLETE (commit 5bfbb8b00; Phase 3 review REVISE 6/10, fix batch 15F)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: proof specs and barrel for the renderer; closes Phase 3.
- Tasks: 4 | Depends on: Batch 14
- Phase: 3 (last batch) | Phase review: code-logic on Batches 13-15 (plus style if Task 15.3 adds exports)

### Task 15.0: wire `avatar` into the node switch — COMPLETE (decision #49; runs first)

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-node.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-node.component.spec.ts
- Implementation details: import `DashboardAvatarComponent` (Batch 14), add `'avatar'` to `SURFACE_NODE_KINDS`, add
  `@case ('avatar')`, update the doc comment; node spec kind count 20 → 21 with an `avatar` entry built under `/4`.
- Validation notes: until this lands an avatar surface fails closed (`renderFailed`); Task 15.2 trust-boundary avatar
  cases depend on this task.

### Task 15.1: container-width spec (R3.5) — COMPLETE

- File (CREATE): D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-container-width.spec.ts
- Quality requirements: 300 px → 1 column; 960 px → ceiling; `'viewport'` mode unchanged.

### Task 15.2: trust-boundary spec for new kinds — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\trust-boundary.spec.ts (exists; corrected path)
- Quality requirements: no agent HTML/URL/script reaches the DOM through `accordion`, `avatar`, trend, spark.

### Task 15.3: barrel exports, only if needed — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\index.ts

### Batch 15 verification

- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-container-width.spec.ts libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20`
- Phase 3 code-logic review due after commit
- Verified by team-leader: Jest 3 suites / 46 tests passed; typecheck passed (re-run after the spec-only change); lint 0 errors, 127 warnings (Batch 14 baseline). Task 15.3: no exports (no consumer outside the lib), so no style review for Phase 3.
- Phase 3 review (range e05d8250f..5bfbb8b00, Codex cross-side): REVISE 6/10 (`code-logic-review-phase3.md`), 1
  Serious, no Moderate/Minor. Fix round: Batch 15F.

## Batch 15F: Phase 3 review fix — override builder result bypasses `/4` atom validation — COMPLETE (commit b66148f4c; re-review APPROVED 8/10, code-logic-review-phase3-fix.md)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: one guard function and its renderer spec in one lib; the finding sits in `isRenderableNode()`.
- Tasks: 1 | Depends on: Batch 15
- Phase: 3 (fix batch, last of phase) | Phase review: code-logic re-review scoped to the 15F commit only (no style:
  no new public API)

### Task 15F.1: `isRenderableNode()` validates avatar, stat trend and stat spark fields — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.spec.ts
  - Optional, only if the executor shares predicates instead of duplicating them:
    D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\view-model\surface-view-model.ts
- Review reference: code-logic-review-phase3.md Serious #1 (`:10-16`); decision #51 unchanged.
- Pattern to follow: the default mapper's closed checks `checkTrend` / `checkSpark` / `mapAvatar`
  (`view-model/surface-view-model.ts:180-225`). Same rules, applied as boolean predicates in the renderer guard:
  - `avatar`: `name` a string with non-empty trimmed length; `subtitle` absent or a string.
  - `stat` with `trend` present: plain object; `direction` in `SURFACE_TREND_DIRECTIONS`; `amount` a finite number
    `>= 0`; `percent` boolean; `polarity` absent or in `SURFACE_TREND_POLARITIES`.
  - `stat` with `spark` present: array, length in `[SURFACE_SPARK_MIN_POINTS, SURFACE_LIMITS.maxSeriesPoints]`, every
    item a finite number.
  - A failing check makes `isRenderableNode()` return false, so `attemptBuild()` returns null and the component emits
    `renderFailed` once and renders nothing. Must stay non-throwing (it already runs inside the try/catch).
- Preferred shape: export small boolean predicates (e.g. `isSurfaceStatTrend`, `isSurfaceSpark`, `isAvatarText`) from
  the view-model file and have both `checkTrend`/`checkSpark`/`mapAvatar` and the renderer guard use them, so the two
  boundaries cannot drift. Not exported from the lib barrel (`src/index.ts` untouched). If the executor keeps them
  local to the renderer instead, the rules must match the mapper exactly.
- Regression tests (required, in `surface-renderer.component.spec.ts`, via a `SURFACE_VIEW_MODEL_BUILDER` override that
  returns `{ renderFailed: false, viewModel }`), each asserting no rendered node and exactly one `renderFailed`:
  1. avatar `name: { text: 'Agent' }` (rich-text object).
  2. avatar valid name with `subtitle: { text: 'x' }`.
  3. avatar `name: '   '` (blank).
  4. stat `trend: { direction: 'sideways', amount: 1, percent: false }`.
  5. stat trend with `polarity: 'danger'`; and one with `amount: NaN` (or `-1`).
  6. stat `spark` containing `NaN`, one containing `Infinity`, one below `SURFACE_SPARK_MIN_POINTS`, one longer than
     `SURFACE_LIMITS.maxSeriesPoints` (`it.each` is fine).
  7. positive control: a well-formed avatar and a stat with valid trend and spark through the same override render and
     emit no `renderFailed`.
- Must not change: the agent-content contract, the default mapper's behaviour and error texts, the 21-kind catalog,
  decision #51 (`bad` polarity → `--dp-er-fill`), templates, barrel exports. `sparklineGeometry()` stays as is (the
  guard closes its exposure; reviewer Q5 resolved by this fix).

### Batch 15F verification

- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts libs/frontend/declarative-dashboard/src/lib/view-model --coverage=false --maxWorkers=2 2>&1 | tail -n 40`; then `npx nx typecheck @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20`; then `npx nx lint @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20` (0 errors; warnings at or below the 127 baseline). One at a time. Apply the `marked` `--moduleNameMapper` override on the Jest command line only if the suite needs it.
- Phase 3 code-logic re-review scoped to the 15F commit after commit
- Re-review (b66148f4c, Codex cross-side): APPROVED 8/10, Serious #1 CLOSED, no new findings
  (`code-logic-review-phase3-fix.md`; focused Jest 3 suites / 93 tests passed). Phase 3 (Batches 13-15, 15F) accepted.

## Batch 16: C1 host-sources token and ptah-ui block — COMPLETE (commit 24e882f14)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the token is eager-light; the block consumes it and the new pipeline.
- Tasks: 2 | Depends on: Batches 5, 13
- Phase: 4 chat-ui display panel | Phase review: code-logic + style (after Batch 21)

### Task 16.1: host-sources token (component 9) — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\services\ptah-ui-host-sources.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\index.ts
- Plan reference: implementation-plan.md:977-993
- Validation notes: `chat-ui/src/index.ts` is edited again in Batch 27; sequential only. No `mcp-apps-contracts`
  runtime import (eager-light).

### Task 16.2: ptah-ui block uses `compilePtahUiBlock`, container layout, live inputs — COMPLETE

- Depends on: Task 16.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.index.ts (decision #37a)
- Plan reference: implementation-plan.md:630-673 (component 4), D5
- Quality requirements: computes agents/limits input only when `usedSources` contains them; passes
  `layoutWidth='container'`; inline live cap 8.
- Validation notes (decisions #33, #37a):
  - First, add these exports to `surface.index.ts`, next to the existing `resolvePtahUi`/`renderPtahUiBlock`
    re-exports (`surface.index.ts:139-141`):
    - the functions `compilePtahUiBlock` and `resolveCompiledPtahUiBlock`;
    - the types `CompiledPtahUiBlock`, `CompilePtahUiBlockResult` and `ResolvePtahUiBlockInput` (`ptah-ui-pipeline.ts`);
    - the types `PtahUiLimitsInput`, `PtahUiLimitRow` and `PtahUiLiveSources` (`ptah-ui-resolver.ts`).
  - Do not export `ptah-ui-agents-source.ts` runtime symbols from the barrel (#30, D6). A type-only `PtahUiAgentsInput`
    export is allowed if needed.
  - The block compiles once per body (`compilePtahUiBlock(body, surfaceId)`), and on input change re-resolves with
    `resolveCompiledPtahUiBlock`, never parsing again.
  - A compile failure, including `reserved-id`, shows the fallback with `reason`.

### Batch 16 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`
- Verified by the team-leader:
  - Jest on the block spec and the message-text spec: 2 suites, 44 tests passed. The `marked` mapper override was
    passed on the command line only.
  - `@ptah-extension/shared` typecheck passed. Its lint has 0 errors and 6 warnings, the Batch 5 baseline.
  - `@ptah-extension/chat-ui` typecheck passed (uncached). Its lint has 0 errors and 10 warnings, all in pre-existing
    files and none in a batch file.
- Out-of-list seam `PTAH_UI_BLOCK_LIVE_SOURCES` in `ptah-ui-block.component.ts`: accepted under decision #52. Batch 17
  (Task 17.3) provides it.

## Batch 17: C2 live source adapters (`$agents`, `$limits`) — COMPLETE (commit b3d5ce368)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: two lazy adapters with the same acquire/release shape. Task 17.3 then wires them into the block through
  the Batch 16 seam (decision #52).
- Tasks: 3 | Depends on: Batches 16, 7
- Phase: 4 | Phase review: after Batch 21

### Task 17.1: `$agents` adapter — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\sources\ptah-ui-agents.source.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\sources\ptah-ui-agents.source.spec.ts
- Plan reference: implementation-plan.md:674-719 (component 4a)
- Quality requirements: R5.4 live during the turn; allow-list projection only.

### Task 17.2: `$limits` adapter — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\sources\ptah-ui-lane-limits.source.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\sources\ptah-ui-lane-limits.source.spec.ts
- Quality requirements: R10.6; first acquire calls `agent:getLanePlanLimits`; re-read on `PlanLimitsStore.snapshot()`
  change while acquired; response type-guarded; RPC failure → "unavailable", `console.warn` without payload; no timers.
- Validation notes (decision #32):
  - The signal holds `PtahUiLimitsInput` (exported from the `surface` entry by Task 16.2).
  - It starts at `{kind:'pending'}`, and becomes `{kind:'unavailable'}` on failure or timeout.
  - A successful read maps 1:1 onto `{kind:'available', rows, lanes, atLimit, nearLimit, unknown, asOf}`: five string
    cells per row, and `asOf` in epoch ms.
  - No owner, account or session fields are copied.
- Fix required (decision #56; not accepted at the first verification):
  - Remove the `burstFailed` latch. A failed read sets `{kind:'unavailable'}`, logs as today, and leaves the watcher
    armed. The next `snapshot()` change re-reads once, and a successful read restores "available".
  - Keep single-flight, the one queued follow-up per push, and no timers.
  - Spec: replace "makes one attempt per acquire burst on a host without the method" with two cases:
    - after a failed read with no push, no further call is made;
    - a push after a failed read makes exactly one call, and a success there shows "available".

### Task 17.3: provide `PTAH_UI_BLOCK_LIVE_SOURCES` from the two adapters (decision #52) — COMPLETE

- Depends on: Tasks 17.1, 17.2
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.spec.ts
- Plan reference: implementation-plan.md:636-637 (the block reads through 4a), 674-693, 858 (lazy entries only inside
  `@defer`), 986-988
- Pattern to follow: the `PTAH_UI_BLOCK_PIPELINE` root factory in the same file (`ptah-ui-block.component.ts:57-65`).
- Implementation details:
  - Give `PTAH_UI_BLOCK_LIVE_SOURCES` the options `{ providedIn: 'root', factory }`.
  - The factory calls `inject(PtahUiAgentsSource)` and `inject(PtahUiLaneLimitsSource)`.
  - It returns `{ agentsInput: (h, i) => agents.agentsInput(h, i), acquireLimits: () => limits.acquire(),
    releaseLimits: () => limits.release() }`.
  - Keep the `PtahUiBlockLiveSources` interface and the block's consuming code unchanged. Keep `optional: true` on the
    inject, so a test or a host can still provide `null`.
  - Update the token's doc comment. It now says the token is provided by default, and that the absent path applies
    only when the token is explicitly provided as `null`.
- Validation notes:
  - The factory lives only in the block file, which is reachable only through the lazy `@ptah-extension/chat-ui/ptah-ui`
    entry.
  - Do not export the adapters or the token from the main `chat-ui` barrel (`src/index.ts`).
  - Do not provide anything from the `chat` lib.
  - The chat-ui → chat-streaming import is allowed (plan:654, 699). Lint confirms it.
  - A host without the `agent:getLanePlanLimits` method (VS Code, capability false) must end in
    `{kind:'unavailable'}` through Task 17.2's failure path, with no retry loop and no timer.
    - Corrected by decision #56: this does not mean one attempt per burst. Each `snapshot()` push still re-reads once
      after a failure (R10.6, plan:704).
    - The factory resolves the adapters lazily through `injector.get` (decision #53).
- Spec requirements (`ptah-ui-block.component.spec.ts`):
  - By default, the existing tests provide a stub for `PTAH_UI_BLOCK_LIVE_SOURCES`, so no real store or RPC is built.
  - The "no adapter" cases provide the token explicitly as `null`. Each one still shows "unavailable" with a valid
    block.
  - Add one case where the root factory is used, with `PtahUiAgentsSource` and `PtahUiLaneLimitsSource` overridden by
    stubs. It asserts the following:
    - `agentsInput` receives the host sources and the turn index;
    - a `$limits` block calls `acquire` once on mount and `release` once on destroy;
    - a `$diff`-only block calls neither.
  - The 37 Batch 16 cases keep passing.

### Batch 17 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.spec.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`
- Lint stays at 0 errors, with warnings at or below the 10-warning baseline and none in a batch file. Pass the
  `--moduleNameMapper` override from handoff.md on the Jest command line only.
- Verified by the team-leader after the decision #56 fix round:
  - Jest on `sources/`, the block spec and the message-text spec: 4 suites, 74 tests passed (mapper override on the
    command line only).
  - `@ptah-extension/chat-ui` typecheck passed (uncached). Lint: 0 errors, 10 warnings (baseline), none in a batch file.
  - On disk: no `burstFailed`, no timers, no TODO markers under `sources/`. The two new failure cases are present. The
    token factory resolves adapters lazily via `injector.get` (decision #53).

## Batch 18: C3 display chip and message text — COMPLETE (commit 3ee10e554)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the chip and its host in the message text, both in the `ptah-ui` entry.
- Tasks: 2 | Depends on: Batch 16
- Phase: 4 | Phase review: after Batch 21

### Task 18.1: display chip — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-display-chip.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-display-chip.component.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\services\ptah-ui-display-dock.ts
    (out-of-list, accepted under decision #59)
- Plan reference: implementation-plan.md:630-673
- Quality requirements: R1.11, R2.10-R2.11, decisions #7 ("Open in display", "updated later" when superseded);
  collapsible and responsive (decisions #9).

### Task 18.2: message text renders the chip for display fences — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-message-text.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-message-text.component.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\ptah-ui.ts
- Validation notes (decision #26): the fence segment carries `target?: 'display'`; branch on
  `segment.target === 'display'` and treat an absent `target` as inline. `displayId` is optional. If this task needs
  the new `ptah-ui.types` exports (`PtahUiNode`, atom/container types) from `surface.index.ts`, add them here.

### Batch 18 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.spec.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

### Batch 18 result (recorded at verification)

- Team-leader re-ran in the worktree (command-line `--moduleNameMapper` for `^marked$` only, handoff.md Batch 8
  ruling): Jest 2 suites, 40 passed; `nx typecheck @ptah-extension/chat-ui` succeeded; `nx lint` 0 errors, 10 baseline
  warnings, none in a batch file. No TODO/placeholder markers or timers in the batch files.
- `src/index.ts` untouched; the token file's only runtime import is `@angular/core`.
- Rulings: decisions #59 (chat-ui-owned dock port), #60 (Batch 20 sync write port and status keying), #61 (evicted
  chip has no action, R1.12), #62 (superseded "Open latest"), #63 (no counts/totals in the expanded chip; approved
  difference for Batch 33).
- Follow-ons carried: Batch 20 (Task 20.2), Batch 23 (Task 23.1, new Task 23.4), Batch 25 (Task 25.2), Batch 32
  (Task 32.1), Batch 33 (Task 33.3).

## Batch 19: C4 turn summary model and chip — COMPLETE (commit 4229545e1)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: renderer-free summary model and chip in the existing `turn-recap` entry.
- Tasks: 2 | Depends on: Batch 1
- Phase: 4 | Phase review: after Batch 21

### Task 19.1: summary model (ports every tests-row case) — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary.model.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary.model.spec.ts
- Plan reference: implementation-plan.md:802-832 (component 6); parity-inventory.md sections 1-2
- Quality requirements: R6.1-R6.4, R6.6, R6.8; Tests card omitted when empty; "(incomplete)" for aborted turns; label
  cases ported from `turn-tests-row.component.spec.ts`; Files and Lines cards carry change-set capabilities.

### Task 19.2: summary chip and entry export — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.spec.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\turn-recap.ts
- Quality requirements: R6.5, R6.9, R6.10; warm gradient kept (decisions #13); no renderer import.
- Validation notes: `turn-recap.ts` is edited again in Batch 24 (keep the `TurnTestsRowComponent` export here).

### Batch 19 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/turn-recap --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

### Batch 19 result (recorded at verification)

- Team-leader re-ran in the worktree (no `--moduleNameMapper` needed): Jest 3 suites, 69 passed (model, chip,
  unchanged tests-row); `nx typecheck @ptah-extension/chat-ui` succeeded; `nx lint` 0 errors, 10 baseline warnings
  (same count as Batch 18). No TODO/FIXME/placeholder markers in the batch files.
- On disk: `turn-summary.model.spec.ts` compiles a real `ptah-ui` block and compares `resolvePtahUi` output with the
  model (R6.1); every `turn-tests-row.component.spec.ts` case is ported (report table). `src/index.ts` untouched; the
  new exports are in the lazy `turn-recap.ts` only.
- Rulings: decisions #66 (Lines omitted with Files), #67 (`openable` input), #68 (`formatFileCounts` reuse), #69
  (counts unavailable shows "?"), #70 (chip gradient overturned; chip goes flat `base-200`).
- Follow-ons carried: Batch 21 (Task 21.2 notes, new Task 21.3), Batch 24 (Task 24.1 `openable`/`open` binding).

## Batch 20: C5 display-panel entry, surfaces and sync — COMPLETE (commit 5558f064a)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: pure surfaces computation plus the headless sync and the new lazy entry; needs design judgement.
- Tasks: 2 | Depends on: Batches 17, 18
- Phase: 4 | Phase review: after Batch 21

### Task 20.1: `display-surfaces.ts` pure computation — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-surfaces.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-surfaces.spec.ts
- Plan reference: implementation-plan.md:216-247 (D3), 265-294 (D10-D12), 720-801 (component 5)
- Quality requirements: R1.12, R2.3-R2.6, R2.8, R2.9; keys `id:X` / `anon:<blockKey>:<ordinal>`; reserved `ptah.`;
  cap via `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId`, LRU drop with `evicted`; view-state pruning on replace;
  pure function of ordered candidates.

### Task 20.2: surface sync, entry file and tsconfig path — COMPLETE

- Depends on: Task 20.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-surface-sync.component.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-surface-sync.component.spec.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\display-panel.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\tsconfig.base.json
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\services\ptah-ui-display-dock.ts (MODIFY, decision #60)
- Pattern to follow: `tsconfig.base.json:52-60` (`chat-ui/ptah-ui`, `chat-ui/turn-recap` paths)
- Quality requirements: R1.1, R1.5, R1.6, R1.8; compile cache by body; auto-open only for applied, live, unseen
  `blockKey:ordinal`; `seenBlockKeys` in the ChatView store; summary never auto-opens.
- Validation notes (decisions #59, #60, from Batch 18):
  - chat-ui cannot import `DisplayDockState` (`chat` depends on `chat-ui`). The sync writes through a write-side port
    added to `ptah-ui-display-dock.ts`: a separate interface and optional token (e.g. `PtahUiDisplayDockSync` /
    `PTAH_UI_DISPLAY_DOCK_SYNC`) carrying the plan's `setSurfaces(tabId, …)`, statuses and auto-open request. Keep the
    chip's read port (`PTAH_UI_DISPLAY_DOCK`) read-only.
  - That file stays eager-light: runtime import `@angular/core` only; anything else (e.g. surface types from
    `display-surfaces.ts`) is `import type`.
  - Key every per-fence status with `displayFenceKey(messageId, nodeId, ordinal)` (the chip's lookup,
    `ptah-ui-display-chip.component.ts:318-321`). `applied` / `superseded` / `evicted` carry `surfaceKey`, `title`
    and `description` (`null` when absent); `invalid` carries `reason`. A spec asserts a chip-shaped lookup finds
    what the sync published.
  - No dock-sync provider (absent token) → the sync does nothing and does not throw.
  - Do not touch `src/index.ts`; Batch 23 adds the main-barrel export. If the port cannot carry D12 auto-open, stop
    and report it for the architect.

### Batch 20 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/display-panel --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

### Batch 20 result (recorded at verification)

- Team-leader re-ran in the worktree (command-line `--moduleNameMapper` for `^vscode$`/`^marked$`, handoff.md Batch 8
  ruling): Jest 2 suites, 33 passed; `nx typecheck @ptah-extension/chat-ui` succeeded; `nx lint` 0 errors, 10
  baseline warnings (same as Batch 19), none in a batch file. No TODO/FIXME/placeholder markers or timers.
- On disk: `display-panel.ts` exports the sync and the pure functions only; `index.ts` untouched; the dock port file's
  runtime import is `@angular/core` only (line 2 is `import type`); `tsconfig.base.json` has the
  `@ptah-extension/chat-ui/display-panel` path. With the dock-sync token absent the sync registers no effects.
- Rulings: decisions #71-#79 (nine deviations accepted as gap fills or equivalent wiring; none changes the approved
  architecture), #80 (acceptance).
- Follow-ons carried: Batch 21 (Task 21.1), Batch 22 (Task 22.2), Batch 23 (Tasks 23.1, 23.4; Task 23.2 heading
  repaired), Batch 24 (Task 24.1), Batch 32 (Task 32.1).

## Batch 21: C6 display panel and turn summary cards — COMPLETE (commit 5f356dc96; Phase 4 review: code-logic APPROVED, code-style REVISE → fix Batch 21F)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the two visible panel components; closes Phase 4.
- Tasks: 3 | Depends on: Batches 19, 20, 14
- Phase: 4 (last batch) | Phase review: code-logic + style on Batches 16-21

### Task 21.1: display panel component — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-panel.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-panel.component.spec.ts
- Plan reference: implementation-plan.md:720-801; design-spec.md sections 1-10; prototype/
- Quality requirements: R1.13 (summary first, strip, surfaces, per-surface view state); collapsible, responsive at
  300/960 px (decisions #9); R9.1-R9.4.
- Batch 20 follow-ons (decisions #74, #79): render the strip and the body in the published surface order. The unpinned
  R1.6 scroll target is the surface with the highest `updatedSeq`. Bind `viewState`/`viewStateChange` to the store;
  the panel does not prune view state (the store applies `retainedViewStateIds`).

### Task 21.2: turn summary cards — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\turn-summary.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\turn-summary.component.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\turn-summary-files.component.ts (added, decision #82)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\turn-summary-tests.component.ts (added, decision #82)
- Quality requirements: R6.1-R6.4, R6.8; tests-row capabilities (expand/collapse ARIA, run rows, icons with labels,
  `<details>` command, failure lines); 1 column at 300 px (R9.6).
- Validation notes (from Batch 19):
  - Build from `buildTurnSummaryModel` (`turn-recap` model) and render `model.cards` in order. Do not add omission
    logic: the model already omits Files, Lines and Tests when there is nothing to show (decision #66).
  - Counts unavailable: Files and Lines read "?" with a neutral "counts unavailable" pill. Cost keeps the word
    "unavailable" (decision #69, design-spec.md:154).
  - Map the model's run-row `tone` to the tests-row classes and pass `tests.polarity` to the stat trend (decision #51).
  - The warm hero gradient (decision #13) goes on this host-built section: `secondary @12%` into card colour at
    135 deg (design-spec.md:27, prototype `.dp-card.dhero`, `prototype/index.html:81`).

### Task 21.3: summary chip back to flat `base-200` — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.spec.ts
- Plan reference: decision #70; prototype `.chip{background:oklch(var(--b2))}` (`prototype/index.html:169`)
- Quality requirements: remove the hero `linear-gradient` from the chip host style (`turn-summary-chip.component.ts`
  around lines 56-62, including its doc comment); the chip background is flat `base-200`. Update any spec assertion
  on the gradient. Nothing else in the chip changes.

### Batch 21 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/display-panel libs/frontend/chat-ui/src/lib/molecules/turn-recap --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`
- Phase 4 code-logic + style review due after commit

### Batch 21 result (recorded at verification)

- Team-leader re-ran in the worktree (command-line `--moduleNameMapper` for `^vscode$`/`^marked$`): Jest 7 suites,
  147 passed; `nx typecheck @ptah-extension/chat-ui` succeeded; `nx lint` 0 errors, 10 baseline warnings, none in a
  batch file. No TODO/FIXME/placeholder markers, timers or observers.
- Files committed: the six `organisms/display-panel` files (panel, summary, files child, tests child, two specs) and
  the chip plus its spec. Not committed: stray unreferenced `_files.html` and `_tests.html` (decision #82; deleted by
  Task 23.5).
- Rulings: #82 (two child files), #84 (no `openScm`), #87 (no stacked layout), #89 (entry exports) accepted; #83 (one
  row action), #85 (no sparklines/trend pills), #86 (Lines/Tokens/Cost/Duration expand), #88 (subtitle) accepted,
  user-confirmed in #91 (R6.1 amended by #86); #90 acceptance.
- Follow-ons carried: Batch 23 (new Task 23.5), Batch 25 (Task 25.1 outputs and imports).
- Phase 4 review (Batches 16-21, `b66148f4c..5f356dc96`): code-logic APPROVED 7/10, no findings
  (code-logic-review-phase4.md); code-style REVISE 7/10, one Serious (code-style-review-phase4.md). Ruling #92: one
  fix round, Batch 21F. Phase 4 closes when the 21F re-review accepts.

## Batch 21F: Phase 4 review fix — dock port re-exported from the lazy `ptah-ui` entry — COMPLETE (commit b57910d88; code-style re-review APPROVED 9/10, code-style-review-phase4-fix.md; Phase 4 ACCEPTED)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: one export block in one file; a single sub-agent is cheaper than a lane.
- Tasks: 1 | Depends on: Batch 21
- Phase: 4 (fix round) | Phase review: code-style re-review scoped to the 21F commit (decision #92)

### Task 21F.1: remove the dock-port re-export from `src/ptah-ui.ts` — COMPLETE

- File (MODIFY):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\ptah-ui.ts
- Plan reference: code-style-review-phase4.md (Serious); decisions #59, #60, #73, #76, #92
- Pattern to follow: `libs/frontend/chat-ui/src/change-set-card.ts` and `src/mermaid.ts` (lazy entries export only
  their lazy component surface).
- Quality requirements: delete the `export { PTAH_UI_DISPLAY_DOCK, displayFenceKey, type PtahUiDisplayDock,
  type PtahUiDisplayFenceState, type PtahUiDisplayFenceStatus } from './lib/services/ptah-ui-display-dock';` block
  (lines 25-31 at `5f356dc96`). Keep the header comment's paragraph at lines 17-21 (it already says an eager provider
  must not import the port through this entry); reword it only if it would otherwise imply the port is exported here.
  Do NOT add the port to `src/index.ts` — that is Batch 23 Task 23.1. No other file changes.
- Validation notes: import-site check done (decision #92) — no file in `libs` or `apps` imports a dock symbol
  through `@ptah-extension/chat-ui/ptah-ui`; chat-ui consumers import `../../services/ptah-ui-display-dock`
  directly. Re-run `grep -rn "PTAH_UI_DISPLAY_DOCK\|displayFenceKey\|PtahUiDisplayFence\|PtahUiDisplayDock"
  libs apps --include=*.ts` after the edit and confirm no hit imports from `ptah-ui` (the entry) and no
  `ptah-ui` mock in a spec returns those names. If one does, change that import to the relative service path (chat-ui)
  and report it; there should be none.

### Batch 21F verification

- Bash, not PowerShell. `npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint
  @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx jest -c libs/frontend/chat-ui/jest.config.ts
  libs/frontend/chat-ui/src/lib/organisms/display-panel libs/frontend/chat-ui/src/lib/organisms/ptah-ui --coverage=false
  --maxWorkers=2 --moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'
  2>&1 | tail -n 40` (handoff.md Batch 8 ruling; run sequentially, one heavy check at a time).
- Then the code-style re-review scoped to the 21F commit.

### Batch 21F result (recorded at verification)

- Diff verified on disk: the five-name dock export block is gone from `src/ptah-ui.ts`, and the header paragraph now
  says the port is not exported from this entry. `src/index.ts` is untouched. No other code file changed.
- Team-leader re-ran the grep. The only hits outside `src/lib/` are comments (`src/display-panel.ts:13`,
  `src/ptah-ui.ts:17`). The four `chat-ui/ptah-ui` consumers in `libs/frontend/chat` import no dock symbol.
- Checks re-run in bash: `nx typecheck @ptah-extension/chat-ui` succeeded. `nx lint` gave 0 errors and the same 10
  baseline warnings, none in `ptah-ui.ts`. Jest (display-panel and ptah-ui, with the command-line override) gave
  9 suites and 184 tests passed.
- Not committed: `_files.html` and `_tests.html` (Task 23.5 deletes them).
- Phase 4 closes when the code-style re-review of this commit accepts.
- Phase 4 accepted: code-logic APPROVED 7/10 (code-logic-review-phase4.md); code-style re-review of `b57910d88`
  APPROVED 9/10, Serious finding CLOSED, no new findings (code-style-review-phase4-fix.md, Codex lane).

## Batch 22: H1 transcript projections — COMPLETE (commit 92d6a9597)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: eager, zero-import pure projections in the chat lib.
- Tasks: 3 | Depends on: Batch 3
- Phase: 5 Transcript and dock | Phase review: code-logic (after Batch 25)

### Task 22.1: fence-line display check — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\execution\ptah-ui-fence-line.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\execution\ptah-ui-fence-line.spec.ts (CREATE)
- Plan reference: implementation-plan.md:833-881 (component 7)

### Task 22.2: `collectDisplayCandidates` — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-display-candidates.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-display-candidates.spec.ts
- Quality requirements: R2.1, R2.7, R2.10-R2.11; `blockKey`, `orderKey`, `turnKey`, `live`.
- Validation notes: resolve A4 (streaming text nodes in `vm().messages`). Decision #26: display fences are segments
  with `target === 'display'` (absent `target` = inline), `displayId` optional.
- Batch 20 follow-on (decision #71): each candidate also carries `messageId` and `nodeId`, the same ids that form
  `blockKey` (`messageId:nodeId`). Type the result with
  `import type { DisplayCandidate } from '@ptah-extension/chat-ui/display-panel'`, type-only (never a value import
  from that entry in eager code). The spec asserts both fields, including an id that contains `:`.

### Task 22.3: `collectTurnAgentFacts` — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-agent-facts.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-agent-facts.spec.ts
- Plan reference: D6-D8
- Quality requirements: turn attribution per D7; allow-listed fields only.
- Validation notes: resolve A3 (`agent-monitor.store.ts:241-251`); R5.9(d) fixture seeds the Task tool node.

### Batch 22 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/execution/ptah-ui-fence-line.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-candidates.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`

### Batch 22 acceptance (team-leader)

- Files verified on disk: `ptah-ui-fence-line.ts` (modified) and its new spec; `transcript-display-candidates.ts` and
  `transcript-agent-facts.ts` with specs. Real implementations; no TODO/placeholder/skip markers.
- Reruns in bash with the command-line `^vscode$`/`^marked$` mapper: Jest 4 suites / 92 passed (the three batch specs
  plus the `hasPtahUiFenceLine` consumer `execution-node.ptah-ui.spec.ts`); `nx typecheck @ptah-extension/chat`
  succeeded; `nx lint` 0 errors, 34 baseline warnings, none in a batch file.
- A3 verified (decision #93). A4 FALSE on the default path; carried into Task 24.1 (decision #94).
- Deviations: 1, 2, 4, 5 accepted (decision #95); 3 accepted provisionally, NEEDS USER (decision #96), no batch
  blocked on it.

## Batch 23: H2 dock state, transcript host sources, sidebar tab — COMPLETE (commit a4b7cc22e)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the per-tab store and the host-sources provider the transcript wires next.
- Tasks: 5 (Task 23.4 added by decision #59, Task 23.5 by #89) | Depends on: Batches 16, 20, 21, 22
- Phase: 5 | Phase review: after Batch 25
- Decision #81 hard check (repeat in the executor prompt): `DisplayDockState.hasSeen`/`markSeen` stay synchronous
  and per-tab (no await between `hasSeen` -> open -> `markSeen`); `setSurfaces` applies `retainedViewStateIds`; each
  sync mounts under its own transcript's `PTAH_UI_HOST_SOURCES` provider. Omitting any is a Serious defect.

### Task 23.1: `DisplayDockState` — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\services\display-dock\display-dock.state.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\services\display-dock\display-dock.state.spec.ts
- Plan reference: implementation-plan.md:227-238 (D4), 265-294 (D12), 882-976 (component 8)
- Quality requirements: per-tab `open`, `pinned`, `activeTab`, `widthPx`, `userClosedTurnKey`, `newCount`,
  `seenBlockKeys`, selections, surfaces, statuses, summaries; `requestAutoOpen` ignored when the user closed this turn
  (increments `newCount`); types-only import from `mcp-apps-contracts`.
- Validation notes (decisions #59, #60, from Batch 18):
  - `DisplayDockState implements PtahUiDisplayDock` and the Batch 20 sync port, imported from the main barrel
    `@ptah-extension/chat-ui` (Task 23.4), never from `@ptah-extension/chat-ui/ptah-ui` or `/display-panel`.
  - Statuses are stored per tab keyed by `displayFenceKey(messageId, nodeId, ordinal)`; `fenceStatus(tabId, key)` is
    an O(1) signal-backed lookup returning `null` when absent, so a chip's `computed` re-runs on change.
  - `openSurface(tabId, surfaceKey)` opens the tab's dock on the Displays tab and selects that surface.
  - The spec covers both ports: a status written through the sync port is read back through `fenceStatus`, and an
    unknown tab or key returns `null`.
- Batch 20 follow-ons (decisions #73, #74):
  - Implement all five `PtahUiDisplayDockSync` methods per tab: `surfaces(tabId)` returns the last published
    surfaces (empty for an unknown tab); `setSurfaces(tabId, {surfaces, statuses})`; `hasSeen(tabId, fenceKey)` /
    `markSeen(tabId, fenceKeys)` over `seenBlockKeys` (the key is `displayFenceKey`, equal to `blockKey:ordinal`);
    `requestAutoOpen(tabId, turnKey, surfaceKey)` opens on the Displays tab and selects the surface, or, when
    `userClosedTurnKey === turnKey`, stays closed and increments `newCount`. It never moves focus (R1.7).
  - `setSurfaces` applies D10: drop the view state of surface keys no longer present; per surface keep only
    view-state entries whose component id is in `retainedViewStateIds`. The spec covers both, plus the R1.8 sequence
    through the real store (open, user close, second block same turn → closed with `newCount` 1, next turn opens).

### Task 23.4: main-barrel export of the dock port (decision #59) — COMPLETE

- Order: runs first in the batch; Task 23.1 imports from it.

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\index.ts
- Pattern to follow: `libs/frontend/chat-ui/src/index.ts:103-106` (`PTAH_UI_HOST_SOURCES` export)
- Implementation details: export `PTAH_UI_DISPLAY_DOCK`, the sync token, `displayFenceKey` and the port/status types
  from `./lib/services/ptah-ui-display-dock`. Export nothing from `./ptah-ui` or `./display-panel`.
- Validation notes: eager bundle stays light only while that file's runtime imports are `@angular/core` alone. Before
  adding the export, confirm with `grep -n "^import" libs/frontend/chat-ui/src/lib/services/ptah-ui-display-dock.ts`
  that every non-`@angular/core` import is `import type`; report the output. Batch 32 lists the file as an allowed
  eager input and Batch 33 measures it.
- Why here: `DisplayDockState` (eager `chat` code, Task 23.1) is the first eager consumer, and this batch already
  lints chat-ui.
- Batch 20 follow-ons (decisions #73, #76): also export `PTAH_UI_DISPLAY_DOCK_SYNC`, `PtahUiDisplayDockSync` and
  `PtahUiDisplaySurfacesPublication`. If `DisplayDockState` needs to name `DisplaySurface`, add
  `export type { DisplaySurface } from './lib/organisms/display-panel/display-surfaces'` (type-only, erased); never a
  value export from that folder. The grep check must show line 2 of the dock file as `import type`.

### Task 23.5: display-panel lazy entry exports the panel (decision #89) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\display-panel.ts
- Implementation details: add `export { DisplayPanelComponent, DISPLAY_PANEL_SUMMARY_KEY } from
  './lib/organisms/display-panel/display-panel.component'` and `export type { DisplayPanelViewStateChange }` from the
  same file. Lazy entry only: nothing is added to `src/index.ts` for these. `TurnSummaryComponent` and its children
  stay unexported.
- Cleanup (decision #82): delete the untracked, unreferenced scratch files
  `libs\frontend\chat-ui\src\lib\organisms\display-panel\_files.html` and `_tests.html`; report that
  `grep -rn "_files.html\|_tests.html" libs/frontend/chat-ui/src` finds nothing.
- Validation: the chat-ui typecheck and lint in the Batch 23 verification line cover the entry.

### Task 23.2: transcript host-sources provider — COMPLETE

- File (CREATE): D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-ptah-ui-host-sources.ts
- Plan reference: implementation-plan.md:833-881, 977-993
- Quality requirements (decision #54): `capacities` is `[liveModelStats.contextCapacity]` of the tab when that value
  is present, and `[]` otherwise. `PtahUiAgentsSource` reads only this list (plan:685). The spec covers both cases.
- Batch 22 follow-on (report, "Decision #81 compatibility"): `turnIndexOf(messageId)` uses the same turn rule as
  `collectTurnAgentFacts` and a candidate's `turnKey`: count user messages up to and including the message's turn
  opener, index from 0, and return `null` for a message before the first user message. Index `i` must address
  `collectTurnAgentFacts(...)[i]`. The spec covers a message before the first user message (`null`) and a message
  in the second turn (`1`). The provider takes its messages from the same current records as Task 24.1 (#94).

### Task 23.3: sidebar tab atom (count badge / tab ARIA) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\atoms\sidebar-tab.component.ts
- Plan reference: implementation-plan.md:975

### Batch 23 verification

- Run in bash with the command-line `--moduleNameMapper` override from handoff.md (Batch 8 ruling) on each Jest call;
  the chat Jest call also names `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.spec.ts`,
  and a chat-ui Jest call (`-c libs/frontend/chat-ui/jest.config.ts`) runs the sidebar-tab spec if one is added.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/display-dock --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

### Batch 23 result (recorded at verification)

- Team-leader re-ran in the worktree (bash, command-line `^vscode$`/`^marked$` mapper): chat Jest 2 suites / 32
  passed (`display-dock` + `transcript-ptah-ui-host-sources.spec.ts`); chat-ui Jest 1 suite / 8 passed (sidebar tab);
  `nx typecheck` succeeded for `@ptah-extension/chat` and `@ptah-extension/chat-ui`; `nx lint` 0 errors with the
  baseline warnings (chat 34, chat-ui 10), none in a batch file. No TODO/FIXME/placeholder markers or timers.
- Decision #81 hard check PASS on disk: `hasSeen`/`markSeen` are synchronous over a per-tab `Map<tabId, Set>`
  (`display-dock.state.ts:314-326`); `setSurfaces` applies `retainedViewStateIds` and drops departed keys
  (`:284-312`, `retainViewState` `:386-407`); `createTranscriptPtahUiHostSources` builds one instance per call with no
  module-level state (`transcript-ptah-ui-host-sources.ts:51-71`), so each transcript can provide its own. #94 PASS:
  the provider reads `slot.record()` per slot (`:54`), never `vm().messages`.
- Scratch files `_files.html`/`_tests.html` are gone. Dock port file line 2 is `import type` (#76).
- Deviations ruled in decisions #98-#103: 3, 5, 6, 7, 8 accepted; 1, 2, 4 accepted as GAP RULINGS (Codex peer
  review). Follow-ons below in Tasks 24.1, 25.1 and 25.2.

## Batch 24: H3 transcript wiring and tests-row removal — COMPLETE (commit 1d85c1dfa)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the Electron placement move; export removal and deletion stay together so the boundary compiles.
- Tasks: 2 | Depends on: Batches 23, 19, 20
- Phase: 5 | Phase review: after Batch 25
- Decision #81 hard check (repeat in the executor prompt): `DisplayDockState.hasSeen`/`markSeen` stay synchronous
  and per-tab (no await between `hasSeen` -> open -> `markSeen`); `setSurfaces` applies `retainedViewStateIds`; each
  sync mounts under its own transcript's `PTAH_UI_HOST_SOURCES` provider. Omitting any is a Serious defect.

### Task 24.1: transcript publishes candidates/summary inputs, mounts sync and chip — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.display.spec.ts (CREATE)
- Plan reference: implementation-plan.md:833-881, 1219-1242
- Quality requirements: R6.5, R6.9, R6.10; Electron: change-set card and tests row replaced by the summary chip
  (decisions #5, #10); VS Code transcript unchanged (keeps the card, still no tests row); sync under `@defer`.
- Chip wiring (decision #67): bind `[openable]` to whether the optional `DisplayDockState` was injected, and
  `(open)` to `dock.openSummary(tabId, turnKey)`. `chat-transcript.display.spec.ts` asserts both the openable and the
  "Display panel unavailable" state. Leave `change-set-card.component.ts` in place: VS Code still mounts it, and the
  summary model reuses its `formatFileCounts` (decision #68).
- R10.9 webview half (decision #56): with `isElectron` false, a `$limits` fence renders as an ordinary code block and
  `agent:getLanePlanLimits` is never called. `chat-transcript.display.spec.ts` asserts both.
- Batch 20 follow-on (decision #72): the sync has no `hostSources` input; it injects `PTAH_UI_HOST_SOURCES`. Mount
  `ptah-display-surface-sync` in the transcript's own template (under `@defer`) with `[tabId]`, `[candidates]` and
  `[snapshots]` (the transcript's `ptahUiSnapshots`), so it sits under the transcript's provider. The spec asserts a
  `$agents` display fence resolves through the transcript's host sources.
- Batch 22 follow-on (decisions #94, #95), HARD INPUT REQUIREMENT (A4 is false on the default path):
  - Feed BOTH projections the current records, never `vm().messages`: inside one `computed`, read
    `records = vm().slots.map((slot) => slot.record())`, then
    `collectDisplayCandidates(records, vm().streamingBoundary, previous)` and `collectTurnAgentFacts(records)`. With
    `STREAM_PRESENTATION_RECORDS_ENABLED` (default true) `vm().messages` changes only on a structural change, so
    using it makes candidates and N values lag the stream (R2.7, R5.4): a Serious defect in the Phase 5 review.
  - `previous`: keep the last candidates array in a per-instance field (the `_allMessagesCache` pattern in
    `chat-transcript.component.ts`) and pass it back, so an unchanged tick returns the same array. No module-level
    state (#81).
  - `chat-transcript.display.spec.ts` covers a content-only streaming write (no id, boundary or `isStreaming` change)
    that adds a display fence opener to the streaming message, and asserts the candidate appears.
- Batch 23 follow-ons (decisions #99, #101, #102):
  - Host sources (#102, deviation 7): build `createTranscriptPtahUiHostSources({ tabId, sessionId, slots, liveModelStats })`
    once in a field of the transcript instance (`slots` = `computed(() => this.vm().slots)`, `liveModelStats` = the
    tab's `liveModelStats ?? null`) and provide it in the transcript's own `providers` with
    `{ provide: PTAH_UI_HOST_SOURCES, useFactory: () => inject(ChatTranscriptComponent).<field> }` (or the
    `useExisting: forwardRef` equivalent). The transcript itself must not inject `PTAH_UI_HOST_SOURCES` (cycle). Use
    the provider's `turnFacts` instead of a second `collectTurnAgentFacts` call. The display spec asserts two
    transcripts resolve different host-source instances (#81).
  - Live turn (#99, GAP): an effect calls `dock.setLiveTurn(tabId, turnKey)` while the tab streams, where `turnKey`
    is the id of the last user message (the same rule as a candidate's `turnKey`), and `setLiveTurn(tabId, null)`
    when the turn reaches a terminal state. Skip when the dock is not injected. The display spec asserts both calls.
  - Summaries (#101, GAP): publish `dock.setSummaries(tabId, map)` with
    `ReadonlyMap<turnKey, { model: TurnSummaryModel; changeSet: TurnChangeSet | null }>` in turn order; `changeSet`
    is the turn's recorded change set from the same source the change-set card reads, else `null`. The same model
    feeds the chip's `[summary]`. HARD CONSTRAINT: `buildTurnSummaryModel` is a value of the lazy
    `@ptah-extension/chat-ui/turn-recap` entry; the transcript must not import it statically (that pulls the entry
    into the eager closure; Batches 32/33 gate it). Load it through one cached dynamic
    `import('@ptah-extension/chat-ui/turn-recap')`, Electron-gated, and publish nothing until it resolves; or an
    equivalent lazy route, reported as a deviation. A failed load leaves no chip and no summaries (no throw).
    Amendment (#104, Codex peer review `decisions-review-99-101.md`): (a) the loader cache holds only the module
    namespace promise and is shared; a REJECTED promise is cleared so the next eligible summary publication retries
    (at most one attempt in flight, never a retry loop inside one reactive tick); (b) every async completion checks,
    before `setSummaries`, that the transcript instance is not destroyed and that its generation/`tabId`/turn inputs
    are still the ones the load started for, else it drops the result; (c) summary maps and turn data are never
    cached outside `DisplayDockState`'s tab-keyed state. The display spec adds: rejection-then-retry publishes on the
    next eligible update; two transcripts (one destroyed and remounted) never publish each other's or stale summaries.

### Task 24.2: delete the tests row — COMPLETE

- Depends on: Task 24.1 and Task 19.1 (cases already ported)
- Files:
  - DELETE D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-tests-row.component.ts
  - DELETE D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-tests-row.component.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\turn-recap.ts
- Quality requirements: no remaining reference to `TurnTestsRowComponent` / `ptah-turn-tests-row` (grep).

### Batch 24 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`
- Result (team-leader, before commit 1d85c1dfa): display + change-set specs 2 suites / 16 passed; typecheck chat-ui and
  chat passed; lint chat 0 errors / 34 warnings (baseline); lint chat-ui 0 errors / 10 warnings; no
  `TurnTestsRowComponent` / `ptah-turn-tests-row` reference left. #81 and #94 hard checks verified on disk.
  Deviations ruled in decisions.md #105 (GAP, Codex peer), #106, #107, #108.
- Follow-ons for Batch 25 (decision #108): add nothing inline to `chat-transcript.component.ts` (at the 700-line
  ceiling); provide `DisplayDockState` only where the dock mounts, so the live-turn effect stays inert in VS Code.
  Batch 32: the new eager transcript files (`transcript-display-feed.ts`, `transcript-turn-summaries.ts`,
  `transcript-turn-recap-loader.ts`) are eager growth the allow-list must name (decision #107).

## Batch 25: H4 dock component and ChatView integration — COMPLETE (commit 2ca5c9048; Phase 5 review code-logic-review-phase5.md APPROVED WITH NOTES 8/10, decision #115; Phase 5 ACCEPTED)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: one coherent UI integration (dock, ChatView, monitor move); closes Phase 5.
- Tasks: 2 | Depends on: Batches 24, 21
- Phase: 5 (last batch) | Phase review: code-logic on Batches 22-25
- Decision #81 hard check (repeat in the executor prompt): `DisplayDockState.hasSeen`/`markSeen` stay synchronous
  and per-tab (no await between `hasSeen` -> open -> `markSeen`); `setSurfaces` applies `retainedViewStateIds`; each
  sync mounts under its own transcript's `PTAH_UI_HOST_SOURCES` provider. Omitting any is a Serious defect. The
  Phase 5 code-logic review checks all three.

### Task 25.1: display dock component (Displays and Agents tabpanels) — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.spec.ts
- Plan reference: implementation-plan.md:882-976 (component 8)
- Pattern to follow: `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts`
- Quality requirements: pin, close, resize; Agents tab always controls a `role="tabpanel"` with "No agents in this
  session" (decisions #11, R1.13); lazy `display-panel` import; chunk failure → dock alert line.
- Batch 21 follow-ons (decisions #84, #89): import `DisplayPanelComponent`, `DISPLAY_PANEL_SUMMARY_KEY` and the type
  `DisplayPanelViewStateChange` from `@ptah-extension/chat-ui/display-panel` (Task 23.5) inside the lazy boundary.
  Bind the panel's inputs (`surfaces`, `summary`, `selectedKey`, `pinned`, `viewStates`, `actionError`) to the dock
  store and handle its outputs: `selectedKeyChange`, `viewStateChange` → `setViewState(tabId, surfaceKey, …)`,
  `openFile(path)` → `ChangeSetActionsService.openFile(changeSet, path)`, `review()` → `review(changeSet)`; a
  rejection sets `actionError`. No `openScm` wiring. The summary pill selects `DISPLAY_PANEL_SUMMARY_KEY`.
- Batch 23 follow-ons (decisions #101, #102):
  - Selection (deviation 3): `selectedKey` = `DISPLAY_PANEL_SUMMARY_KEY` for `{ kind: 'summary' }`, the
    `surfaceKey` for `{ kind: 'surface' }`, `null` for `null`. `selectedKeyChange(key)` calls
    `dock.select(tabId, key === DISPLAY_PANEL_SUMMARY_KEY ? { kind: 'summary' } : { kind: 'surface', surfaceKey: key })`.
  - Summary (#101): `[summary]` = `dock.summaryFor(tabId)?.model ?? null`; `openFile(path)` / `review()` act on
    `dock.summaryFor(tabId)?.changeSet`, and a `null` change set sets `actionError` instead of calling the service.
  - No `setCandidates` exists (deviation 5); surface counts come from `tab(tabId).surfaces`.

### Task 25.2: ChatView mounts the dock; monitor panel becomes the Agents tabpanel — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.dock.spec.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.ts
- Plan reference: implementation-plan.md:954-965 (R1.3)
- Quality requirements: R1.2-R1.4, R1.7, R1.9, R1.14; `DisplayDockState` provided by ChatView; dock under
  `@defer (when dockOpen())`; one panel element, one visible tabpanel, chat width = host − one dock width at 1280 px;
  the user-closed rule.
- Validation notes (decisions #59, #60, from Batch 18): ChatView `providers` add
  `{ provide: PTAH_UI_DISPLAY_DOCK, useExisting: DisplayDockState }` and the Batch 20 sync token with `useExisting`
  too, imported from `@ptah-extension/chat-ui` (main barrel), never from `/ptah-ui`. `chat-view.dock.spec.ts` asserts
  both tokens resolve to the same `DisplayDockState` instance, so the transcript's chips leave "Display panel
  unavailable".
- Batch 23 follow-ons (decision #100, GAP; deviation 8):
  - Agent auto-open maps the existing rule (`chat-view.component.ts:1194-1211`) per tab: running agents or a pending
    permission → `dock.requestAgentsOpen(tabId)`; all agents settled with at least one agent →
    `dock.releaseAgentsUserClose(tabId)`. An explicit `panelOpenRequest` for this tab (`:1163-1174`) →
    `selectTab(tabId, 'agents')`, `open(tabId)`, `releaseAgentsUserClose(tabId)`. `toggleAgentPanel`/`closeAgentPanel`
    route to `dock.toggle`/`dock.close`, so `_userExplicitlyClosed` is deleted (the store owns it). One user close
    of the dock, on either tab, holds agent auto-open until release.
  - The toggle is `ptah-sidebar-tab label="Display"` with `[newCount]="dock.tab(tabId).newCount"` and
    `[isOpen]`; its name reads "Toggle Display panel, 1 new" and it carries `aria-expanded`.
  - `chat-view.dock.spec.ts` covers: user close then running agent stays closed; agents settle then a new running
    agent opens on Agents; a chip request opens on Agents after a user close.
- Note: this batch touches 6 files in one lib (limit reached).

### Batch 25 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/display-dock libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx jest -c libs/frontend/chat/jest.config.ts execution-node.ptah-ui.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 20 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`
- Phase 5 code-logic review due after commit
- Result (team-leader, first verification, not committed): all scoped checks pass (Jest dock + chat-view +
  keepalive + agent-monitor-panel: 6 suites / 143 passed; execution-node ptah-ui: 27 passed; typecheck chat passed;
  lint chat 0 errors / 34 warnings, baseline). #81 and #94 hard checks pass on disk (store and transcript files
  unchanged; `hasSeen`/`markSeen` synchronous per tab; `setSurfaces` applies `retainedViewStateIds`; per-transcript
  `PTAH_UI_HOST_SOURCES` provider; no `.messages` read in added code). NOT ACCEPTED on deviation 2 (decision #109,
  GAP, Serious parity regression): a failed dock chunk leaves Electron with no agent monitor. Deviations 1, 3, 5
  accepted (#110, #112); deviation 4 accepted as GAP (#111); later items #113.
- Fix required in Task 25.2 (decision #109), files `chat-view.component.html` and `chat-view.dock.spec.ts` only: the
  dock `@error` block keeps the one-line `role="alert"` "Display panel failed to load" and, while `panelOpen()`,
  renders the eager `ptah-agent-monitor-panel` with the VS Code branch bindings (`[embeddedAgents]="sessionAgents()"`,
  `[embeddedOpen]="panelOpen()"`, `[sessionId]="resolvedSessionId()"`, `[isOverlay]="isOverlay()"`,
  `(closed)="closeAgentPanel()"`, not `docked`). Spec: render the dock defer block in `DeferBlockState.Error`
  (`DeferBlockBehavior.Manual`) with a running agent; assert the alert, exactly one `ptah-agent-monitor-panel`, no
  `ptah-display-dock`, and that the toggle closes it. Re-run the Batch 25 verification commands plus the
  agent-monitor-panel spec.
- Result (team-leader, final verification before commit, after fix rounds #109 and #114): Jest 9 suites / 168 passed
  (display-dock, chat-view dock/component/keepalive/memo, agent-monitor-panel + scope, chat-transcript display +
  change-set; command-line `^vscode$`/`^marked$` mapper); execution-node ptah-ui 1 suite / 27 passed; `nx typecheck
  @ptah-extension/chat` succeeded (uncached); `nx lint @ptah-extension/chat` 0 errors / 34 warnings (baseline). #109
  fallback on disk: dock `@error` keeps the `role="alert"` line and, while `panelOpen()`, the eager non-docked
  `ptah-agent-monitor-panel` with the VS Code bindings. #81: store and transcript production files unchanged since
  1d85c1dfa (`git diff` empty), ChatView provides only the store and the two `useExisting` ports, never
  `PTAH_UI_HOST_SOURCES`. #94: no `.messages` read in added code. #100: `_userExplicitlyClosed` and `agentPanelOpen`
  gone from ChatView. #114(a) spec changes present (exact publication log; shared pending-load case). Eager-closure
  gate: Batch 32 (#107, #113(b)), not this batch. Phase 5 code-logic review on `b57910d88..2ca5c9048`: APPROVED WITH NOTES 8/10
  (`code-logic-review-phase5.md`); the Minor closed-tab retention finding is a later item with #113(a) (decision #115).

## Batch 26: P1 tool-language util, copy button, code output — COMPLETE (commit 583108bcf)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: shared preview building blocks first.
- Tasks: 3 | Depends on: none (runs after Phase 5)
- Phase: 6 Previews (R7) | Phase review: code-logic + style (after Batch 28)
- Team-leader constraints (set when Phase 5 was accepted):
  - Both webviews (decision #8): no `isElectron` gating; behaviour identical in VS Code and Electron.
  - Replace, do not accumulate: Task 26.1 MOVES `languageMap`, `detectLanguage` and `getLanguageFromPath` out of
    `code-output.component.ts` (`:78-166,238-243`) into `tool-language.utils.ts`; `code-output` consumes the util and
    keeps no private copy. Detection stays byte-for-byte equivalent (extension map, `bash` for Bash, JSON sniffing and
    the "not JSON keeps the tool language" rule at `:150-163`); the existing code-output spec stays green unedited
    for those cases.
  - Task 26.2 is a new atom beside `copy-button.component.ts` (plan D15: the existing one copies whole messages);
    do not change `ptah-copy-button`. Clipboard via `@angular/cdk/clipboard`; a rejection or `false` result shows
    "Copy failed" in a polite live region and never throws (plan component 11 failure behaviour).
  - No export from `libs/frontend/chat-ui/src/index.ts` in this batch unless chat consumes it now (it does not until
    Batch 27); the style review judges any new public API.

- Team-leader Mode 2 (first report, `batch-26-report.md`): NOT ACCEPTED, batch stays IN_PROGRESS. Checks pass (Jest
  3 suites / 79, typecheck OK, lint 0 errors / 9 baseline warnings), but Task 26.3 keeps `overflow-x-auto`, which
  breaks R9.5 (decision #119). Fix round for Task 26.3 only: #119 (wrap, no horizontal scroll), #118 (row estimate
  counts wrapped rows for every language), #120(a) (Escape collapses expanded output, refocuses the toggle, stops
  the event). Tasks 26.1 and 26.2 verified on disk (#117); not to be touched again.
- Team-leader Mode 2 (fix report, `batch-26-fix-report.md`): ACCEPTED. Verified on disk: no `overflow-x-auto`;
  `pre, code` inside `.tool-output-markdown` use `white-space: pre-wrap` + `overflow-wrap: anywhere`; `max-h-48
  overflow-y-auto` kept when not clipped; `collapsible` counts `max(1, ceil(length / WRAP_CHARS))` rows for every
  language; host `(keydown.escape)` collapses, refocuses the toggle and calls `preventDefault()` +
  `stopPropagation()` only while expanded. The three #118 cases, the #119 case and the two #120(a) cases sit inside
  `describe.each([true, false])`; `git diff -U0` on the spec removes no line. Checks: Jest 3 suites / 91 tests
  passed; `nx typecheck @ptah-extension/chat-ui` OK; `nx lint @ptah-extension/chat-ui` 0 errors / 9 baseline
  warnings. Codex peer review of #118/#120 recorded (#121): no Batch 26 code change.

### Task 26.1: tool-language util — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\utils\tool-language.utils.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\utils\tool-language.utils.spec.ts
- Plan reference: implementation-plan.md:1086-1145 (component 11)
- Quality requirements: R7.5; keeps existing detection (extension, `bash`, JSON sniffing — parity section 4).

### Task 26.2: copy-text button atom — COMPLETE

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\atoms\copy-text-button.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\atoms\copy-text-button.component.spec.ts

### Task 26.3: code output expand, language label — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.spec.ts
- Quality requirements: R7.4; keep `max-h-48` scroll, ANSI/system-reminder/`N→` stripping (parity section 4).
- Fix required (decisions #118, #119, #120(a)): `max-h-48` is the vertical limit only; remove `overflow-x-auto`
  and wrap code (`white-space: pre-wrap`, `overflow-wrap: anywhere` on `pre`/`code`, R9.5); every line counts
  `max(1, ceil(length / WRAP_CHARS))` rows; Escape while expanded collapses, focuses the toggle, and calls
  `preventDefault()` + `stopPropagation()`; Escape while collapsed bubbles. Add the spec cases named in #118-#120
  under the existing `describe.each([true, false])`; original cases stay unedited.

### Batch 26 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/utils/tool-language.utils.spec.ts libs/frontend/chat-ui/src/lib/atoms/copy-text-button.component.spec.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

## Batch 27: P2 tool-call header and tool-call item — COMPLETE (commit f70499432; deviations ruled in decisions #122-#124)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: header redesign and its host item; edits `chat-ui/src/index.ts` after Batch 16.
- Tasks: 3 | Depends on: Batches 26, 16
- Phase: 6 | Phase review: after Batch 28
- Team-leader constraints (set at Batch 26 Mode 2; real API names, decisions #117-#120):
  - Starts only after Batch 26 is COMPLETE and the Codex peer review of #118 and #120 is recorded.
  - Use the Batch 26 API as built: `detectToolLanguage(node)`, `getLanguageFromPath(path)`,
    `getLanguageLabel(language)` from `../../utils/tool-language.utils` (chat-ui) and `ptah-copy-text-button`
    (`[text]`, `label`, no outputs). Do not re-implement language maps or a copy button anywhere.
  - `chat-ui/src/index.ts`: export `CopyTextButtonComponent` and the three util functions (plus
    `ToolLanguageSource`) only if chat imports them; the style review judges the new public API.
  - Header (27.1): the file-tool language label is `getLanguageLabel(getLanguageFromPath(file_path))`; Bash body uses
    `<ptah-copy-text-button label="Copy command">` with the full command; command and paths wrap, never scroll
    sideways (#119, R9.5); the open-file button is a sibling of the toggle, not nested.
  - Item (27.2): Escape per #120(b) as amended by #121(b): with focus inside an expanded item and
    `event.defaultPrevented` false, collapse, refocus the header toggle, then call `preventDefault()` +
    `stopPropagation()`; while a permission request is pending Escape is a no-op for the item (auto-expand kept) but
    the item STILL calls `preventDefault()` + `stopPropagation()` so no enclosing Escape action runs; when
    `event.defaultPrevented` is already true, do nothing. A collapsed item with no pending permission leaves the
    event alone. Do not edit `code-output` (it owns its own Escape).
  - ChatView guard (27.3, #121(b)): `ChatViewComponent.onEscapeKey` (`chat-view.component.ts:514-519`) returns at once
    when `event.defaultPrevented`, then keeps its existing overlay-close behaviour unchanged. One-line guard only; no
    other ChatView change.
  - Integration cases (#121(b)), in `tool-call-item.component.spec.ts` with a real `CodeOutputComponent` child and an
    outer keydown listener standing in for the ChatView handler: (1) expanded item, collapsed inner code-output,
    Escape -> only the item collapses, toggle focused, outer listener not reached; (2) pending permission, Escape ->
    item stays expanded, outer listener not reached; (3) expanded item, expanded inner code-output, Escape -> only
    the code-output collapses, item stays expanded, outer listener not reached.
  - Decision #8: no `isElectron` gating; specs that touch host behaviour run `describe.each([true, false])` with
    `{ provide: VSCodeService, useValue: { isElectron } }`; file-open via `FILE_LINK_OPENER` in both.

### Task 27.1: tool-call header (command preview, status text, accessible names) — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-call-header.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-call-header.component.spec.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\index.ts
- Quality requirements: R7.1-R7.3; every header parity row (gold `mcp__ptah` styling, badges, toggle `aria-expanded`,
  file path link, Bash description/40-char truncation with full command, streaming description, parse-error warning,
  status icons, duration badge).
- Validation notes: resolve A9; with no exit code, "Command succeeded/failed".

### Task 27.2: tool-call item — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\molecules\tool-execution\tool-call-item.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\molecules\tool-execution\tool-call-item.component.spec.ts
- Quality requirements: collapsed by default; auto-expand on permission request; R7.10 both webviews; Escape per
  #120(b)/#121(b) plus the three integration cases above.

### Task 27.3: ChatView Escape guard (#121(b)) — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts
- Change: first line of `onEscapeKey(event)`: `if (event.defaultPrevented) return;`. Existing behaviour otherwise
  unchanged.
- Spec case: overlay mode with the agent panel open, dispatch a cancelable Escape keydown whose default is already
  prevented -> the panel stays open (`closeAgentPanel` not called); existing overlay-close cases stay green unedited.

### Batch 27 verification

Run ONE AT A TIME (memory-safe rules, CLAUDE.md), from the worktree root; add the command-line `--moduleNameMapper`
override (`^vscode$`, `^marked$`) to each Jest run when the default config fails to resolve them:

1. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
2. `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
3. `npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`
4. `npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`
5. `npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`
6. `npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`

## Batch 28: P3 diff, input and output displays — COMPLETE (commit f96a6d5a7; deviations ruled in decisions #125-#128, fix verified #130; Phase 6 implementation complete, review pending)

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the three file-preview molecules; closes Phase 6.
- Tasks: 3 | Depends on: Batch 26
- Phase: 6 (last batch) | Phase review: code-logic + style on Batches 26-28
- Team-leader constraints (set at Batch 27 Mode 2; reflects Batches 26-27 as built, decisions #117-#124):
  - Starts only after the Codex peer review of #123 is recorded (Batch 28 does not build on #123's code, but the
    orchestrator closes the review before Phase 6 review). #122 and #124 need no peer review.
  - Use the Batch 26 API as built, imported by relative path inside chat-ui: `detectToolLanguage(node)`,
    `getLanguageFromPath(path)`, `getLanguageLabel(language)` from `../../utils/tool-language.utils`, and
    `ptah-copy-text-button` (`[text]`, `label`, no outputs) from `../../atoms/copy-text-button.component`. Do not
    re-implement a language map, a copy button or a clipboard call. Do not edit `code-output`,
    `tool-call-header` or `tool-language.utils` (Batches 26-27 own them); `chat-ui/src/index.ts` stays unchanged
    (#124: chat imports none of these symbols).
  - Wrapping (#119, R9.5): no `overflow-x-auto`, `overflow-x-scroll` or `whitespace-nowrap` on any code, diff, input
    or output block; code lines wrap (`white-space: pre-wrap` + `overflow-wrap: anywhere`, or Tailwind
    `whitespace-pre-wrap break-all`); vertical height limits stay (`max-h-64` in diff, existing limits elsewhere)
    with `overflow-y-auto`. Each of the three specs asserts no horizontal-scroll class in any state.
  - Height-limited blocks are focusable (`tabindex="0"`) with an aria-label naming their content (design-spec.md
    section 6); clipped text stays in the accessibility tree.
  - 28.1 diff: keep the existing path link (`ptah-file-path-link`, which still opens through `FILE_LINK_OPENER`),
    the replacements badge and the old-then-new order; add removed/added counts in the header and a sign gutter
    (`+`/`-` glyph with `aria-label` "added"/"removed") plus row tint and a line-number gutter.
  - 28.2 input: Bash `command` and Write `content` are never cut to 60 characters (R7.2, R7.7); other parameters
    keep the 60-character rule; trivial-input hiding and the retention notice are kept. Write preview:
    highlighted, height-limited, "Show all N lines" toggle (`aria-expanded`) and "Copy content" via
    `ptah-copy-text-button`. Correct the stale "chat-ui is type:ui" comment at `tool-input-display.component.ts`
    (plan component 11).
  - 28.3 output: output routing, retention notice and error alert kept; correct the stale "chat-ui is type:ui"
    comment in `tool-output-display.component.ts`. Escape inside these components is not added: only
    `code-output` and `tool-call-item` own Escape (#120, #121(b)); if a Write preview toggle is expandable, it
    follows #120(a) exactly (collapse on Escape only while expanded, focus its toggle, `preventDefault()` +
    `stopPropagation()`; otherwise bubble) and gets the two #120 spec cases.
  - Decision #8: no `isElectron` gating; every new spec block runs `describe.each([true, false])` with
    `{ provide: VSCodeService, useValue: { isElectron } }`; file opening through `FILE_LINK_OPENER` in both.
  - Existing spec cases stay green unedited; only add cases.

### Task 28.1: diff display (+/− counts, gutter) — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\diff-display.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\diff-display.component.spec.ts
- Quality requirements: R7.6; keeps path link, replacements badge, `max-h-64`.
- Mode 2 result (decision #125): NOT ACCEPTED as built — dead `formattedDiff`. Fix (same executor, these two files
  only): delete `formattedDiff`, `generateUnifiedDiff` and the `fenceCodeBlock` import from the component; delete the
  original spec case "fences a diff beyond the longest backtick run in either input" (reason recorded in #125: it pins
  only dead code; `code-fence.spec.ts` keeps the fence contract); add one case in the `describe.each([true, false])`
  block: `old_string` = three backticks, `new_string` = ten backticks + `\n<div class="fixed">x</div>` -> both render
  verbatim as `.diff-code` text and no `div.fixed` element exists; drop `provideMarkdown()` /
  `provideSurfaceActiveTesting()` from the diff spec only if it passes without them. Then re-run the three checks.
- Fix result (decision #130): verified on disk and accepted; dead code and the pinned spec case gone, new case in
  `describe.each([true, false])`, `provideMarkdown()` / `provideSurfaceActiveTesting()` dropped.

### Task 28.2: tool input display (full command, Write preview) — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-input-display.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-input-display.component.spec.ts
- Quality requirements: R7.2, R7.7; trivial-input hiding, 60-char truncation for other params, retention notice kept.

### Task 28.3: tool output display — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-output-display.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-output-display.component.spec.ts
- Quality requirements: output routing, retention notice and error alert kept.

### Batch 28 verification

Run ONE AT A TIME (memory-safe rules, CLAUDE.md), from the worktree root, with the command-line override
`--moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'` on the Jest run:

1. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
2. `npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`
3. `npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20` (baseline 0 errors / 9 warnings)
- Phase 6 code-logic + style review due after commit
- Phase 6 review result (decision #133): code-logic REVISE 6/10 (2 Moderate, CRLF row estimate), style APPROVED
  WITH NOTES 8/10 (0 findings). One fix round: Batch 28F.

## Batch 28F: Phase 6 fix round — CRLF row estimate, collapsed header path, diff snippet gutter — COMPLETE (commit 1527efcc1; spec edit ruled #134; Phase 6 code-logic re-review code-logic-review-phase6-fix.md APPROVED WITH NOTES 8/10, decision #135; Phase 6 ACCEPTED)

- Recommended executor: frontend-developer (fresh sub-agent)
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: four small edits in four sibling molecules of one directory, each with its own spec; one scoped Jest
  run covers them. 8 files exceeds the 6-file cap by ruling #133(e) (single fix batch allowed per phase).
- Tasks: 3 | Depends on: Batch 28 (f96a6d5a7)
- Phase: 6 (fix round) | Phase review: one scoped Codex code-logic re-review on the 28F commit
  (`code-logic-review-phase6-fix.md`); no style re-review (#133(f))
- Executor writes `batch-28F-report.md` in the task folder; does not edit `batches.md`, `decisions.md`, or commit.
- Constraints (all tasks):
  - Edit only the 8 files listed below. `chat-ui/src/index.ts`, `tool-language.utils.ts`, the copy button,
    `tool-call-item`, `tool-output-display` and anything in `libs/frontend/chat` stay unchanged.
  - Existing spec cases stay green unedited; only add cases. New cases go inside the existing
    `describe.each([true, false])` blocks (decision #8, `VSCodeService` `isElectron` both ways, `FILE_LINK_OPENER`).
  - No `isElectron` gating; no horizontal-scroll or `whitespace-nowrap` on code/diff/input/output blocks (#119).
    `truncate` on the collapsed header path is allowed: it is a one-line header label, not a code block, and mirrors
    the Bash command row (#131(d)).
  - `tool-input-display.component.ts` stays under 500 lines (#133(b)).
  - No TODO, stub or placeholder; no new exported symbol.

### Task 28F.1: CRLF-safe row estimate (code-logic Moderates 1 and 2) — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-input-display.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-input-display.component.spec.ts
- Review reference: `code-logic-review-phase6.md` findings 1-2; explicit check 7.
- Implementation details: `collapsible` (`code-output.component.ts:182-189`) and `writePreviewCollapsible`
  (`tool-input-display.component.ts:321-328`) split on `/\r\n|\r|\n/` instead of `'\n'`; the Write line count
  (`tool-input-display.component.ts:295-297`) uses the same line split (trailing line terminator, CRLF or LF, still
  not counted as an extra line). Update the doc comments to say line terminators are CRLF, CR or LF.
- Acceptance (spec cases, each in both `isElectron` values):
  - code-output: 6 CRLF-terminated lines of exactly 100 characters -> not collapsible (no "Show full output",
    not clipped); 7 such lines -> collapsible; empty output -> not collapsible; one single 701-character line ->
    collapsible (wrapped-row count).
  - tool-input-display: Write content of 11 CRLF lines of exactly 100 characters -> not collapsible / not clipped;
    12 such lines -> collapsible; "Show all N lines" reports 11 (not 12) for 11 CRLF-terminated lines; lone-CR
    content counts its lines.

### Task 28F.2: collapsed header file path one line (decision #131(d)) — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-call-header.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-call-header.component.spec.ts
- Pattern to follow: the Bash command row in the same file (`tool-call-header.component.ts:246-266`:
  `[class.truncate]="isCollapsed()"`, wrap classes only when `!isCollapsed()`, `[title]`).
- Implementation details: the `data-testid="tool-file-path"` span (`:127-140`) uses `truncate` (one line,
  ellipsis) while `isCollapsed()` and `break-all` only while expanded; `[title]="filePath()"` kept in both states;
  it stays `flex-1 min-w-0` (Tailwind `flex-1` is `flex: 1 1 0%`, so the path shrinks instead of wrapping to its own
  line) and the language badge stays `flex-shrink-0`. File name stays visible first, directory muted after it.
- Acceptance (spec, both `isElectron` values): collapsed Read/Write/Edit with a 200-character path -> path span has
  `truncate`, lacks `break-all`, `title` equals the full path; after expanding -> lacks `truncate`, has `break-all`,
  `title` unchanged. Height <= 36 px at 360 px is asserted in Batch 33 Task 33.3, not here (jsdom has no layout).

### Task 28F.3: diff gutter labelled as snippet line numbers (decision #132) and CRLF split — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\diff-display.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\diff-display.component.spec.ts
- Implementation details: add a visible caption "Snippet lines" (muted, `text-[10px]`, `data-testid` e.g.
  `diff-gutter-caption`) in the diff header row or above the gutter; `blockLabel` becomes
  `Diff of <name>, line numbers count within the replaced snippet`. Gutter numbers stay `aria-hidden` and keep
  their current ordinals; no file-relative range is computed or shown (inputs carry no file offset, #132).
  `splitLines` (`:24-26`) splits on `/\r\n|\r|\n/` so no `\r` remains in `.diff-code` text and counts are unchanged.
- Acceptance (spec, both `isElectron` values): the caption text "Snippet lines" is rendered; the region's
  `aria-label` contains "line numbers count within the replaced snippet"; the rendered text contains no
  file-relative range (no "line N of", no `L<n>-<m>`); a CRLF `old_string`/`new_string` gives `.diff-code` texts
  without `\r` and the same -/+ counts as the LF equivalent.

### Batch 28F verification

Run ONE AT A TIME (memory-safe rules, CLAUDE.md), from the worktree root, in bash, with the command-line override
`--moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'` on the Jest run:

1. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
   (baseline 6 suites / 174 tests before 28F; all pass, count grows by the new cases)
2. `npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`
3. `npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20` (baseline 0 errors / 8 warnings; none new
   in the 8 batch files)
- Team-leader commits 28F (8 files plus `batches.md`), then the orchestrator runs the scoped Codex code-logic
  re-review on that commit. Phase 6 ACCEPTED when it approves.

## Batch 29: A1 prompt hint and no-write-back fixtures — COMPLETE (commit 36a8b37f9; deviations ruled in decisions #136-#139, #136 GAP)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: hint text with its token gate, plus the two host-data sentinel specs.
- Tasks: 2 | Depends on: Batches 6, 7, 19
- Phase: 7 Hint, skill, measurement, eager gate | Phase review: code-logic (after Batch 32)

### Task 29.1: `PTAH_UI_HINT` — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts
- Plan reference: implementation-plan.md:1146-1192 (component 12)
- Quality requirements: R8.1 ≤ 100 tokens; names `display [id]`, the id-update rule, `$diff $tests $usage $agents
  $limits`, points to the skill; examples parse; no `/note/i`; if over budget drop `$limits` and record both counts.

### Task 29.2: host-data sentinel specs — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.host-data.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\services\message-sender.host-data.spec.ts
- Quality requirements: R5.8 (`$agents` sentinel name, cost `0.623623`), R10.5 (`$limits` sentinel lane, `62.3623%`),
  R6.7 (summary) never reach the outgoing prompt/options.

### Batch 29 verification

- Run ONE AT A TIME (memory-safe rules, CLAUDE.md), from the worktree root, in bash, adding to each Jest call
  `--moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'`
  (the worktree has no local `node_modules/marked`; decision #135), then `npx nx typecheck @ptah-extension/agent-sdk
  --parallel=1 2>&1 | tail -n 20` after the command below.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx lint @ptah-extension/agent-sdk --parallel=1 2>&1 | tail -n 20`

## Batch 30: DOC1 `ptah-surface-authoring` skill text — COMPLETE (commit d7a69fbd0; round 2 accepted, no GAP)

- Recommended executor: technical-content-writer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: documentation in two mirrored copies; every example must be a corpus case from Task 6.1.
- Tasks: 2 | Depends on: Batches 6, 29
- Phase: 7 | Phase review: after Batch 32

### Task 30.1: asset skill copy — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\SKILL.md
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\ptah-ui.md
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\catalog.md
- Plan reference: implementation-plan.md:1146-1192
- Quality requirements: R3 EBNF and lexical delta; display and id rules; `$agents` (context, unavailable/no-percent,
  `session`, CLI context unavailable today); `$limits`; the three worked examples; "Common mistakes" for `session` and
  indentation; `/4` kinds in catalog.md.
- Gate note (decision #136, GAP): the hint has no example fence (87/100 tokens), so the skill must carry every worked example; do not add examples to the hint.

### Task 30.2: `.claude/skills` mirror — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\SKILL.md
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\references\ptah-ui.md
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\references\catalog.md
- Quality requirements: byte-identical to Task 30.1.

### Batch 30 verification

- `diff -r apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring .claude/skills/ptah-surface-authoring && npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 20`
- Team-leader also confirms each skill example appears in `ptah-ui.corpus.ts`.

### Batch 30 verification round 1 — NOT ACCEPTED (team-leader)

- Checks pass: `diff -r` exit 0; compactness spec 31/31; `surface-catalog-reference.spec.ts` 4/4.
- Ruling (a), ACCEPTED: the `/4` kinds in catalog.md are a table with no `###` headings or fences, because
  `surface-catalog-reference.spec.ts` needs exactly one JSON example per `/3` kind. No GAP; later batches need not
  touch it.
- Ruling (b), claims checked against code:
  - TRUE: turn scope and `$agents session` covering turns `0..turnIndex` (`ptah-ui-agents-source.ts:136-141,175`);
    order turn, start, key (`:217-226`); session scalars over every in-scope row (`:103-108`); `$agents` table
    "+N more" (`ptah-ui-resolver.ts:353-366`); `$limits` "as of", table "+N more", list one item per lane with a
    trailing "+N more" item (`ptah-ui-resolver.ts:369-404`); `$limits` read only for a valid block that names it
    (`ptah-ui-block.component.ts:294-307,405-416`).
  - FALSE 1: `references/ptah-ui.md:144` says a `$agents` *list* ends with "+N more". A list renders no notes
    (`ptah-ui-resolver.ts:249-258`, comment `:374`) and `agentsRows` puts no "+N more" item in `listItems`
    (`:362-366`). A `list $agents` past 1,000 rows shows the first 1,000 names and nothing else.
  - FALSE 2: `SKILL.md:20` says `session` widens `$agents` "to the whole session". It covers the block's turn and
    earlier turns only, never a later one (`ptah-ui-agents-source.ts:136-141`).
  - IMPRECISE: `references/ptah-ui.md:145` omits that rows with no known start time sort last within their turn
    (`ptah-ui-agents-source.ts:217-223`).
- Fix: text-only edits to those three places in the asset copy, then re-mirror; Batch 30 stays IN_PROGRESS.

### Batch 30 verification round 2 — ACCEPTED (team-leader)

- Report `batch-30-fix-report.md`. The three edits are on disk: `SKILL.md:20` (turns up to and including the
  block's own turn, never a later one), `references/ptah-ui.md:144` (table "+N more"; `list $agents` first 1,000
  names, no note), `:145` (unknown start time sorts last within its turn).
- Citation drift only, not a defect: current lines are `ptah-ui-agents-source.ts:171-172` (`firstTurn` 0 or
  `turnIndex` .. `turnIndex`), `:175-176` (cap at `maxTableRows` = 1,000), `:325-334` (`compareScopedRows`, null
  start returns after known).
- "list $agents has no +N more" confirmed: `ptah-ui-resolver.ts` `agentsRows` returns `listItems:
  rows.map(firstCellText)` with the omitted count only in `notes`; the list branch renders `listItems` and never
  `notes`. Contrast `laneListItems`, which appends a "+N more" item for `$limits` only.
- Checks: `diff -r` exit 0; `ptah-ui-compactness.spec.ts` 31/31. No fence, example or catalog.md touched. No GAP.

## Batch 31: DOC2 content manifest and measurement — COMPLETE (commit 29c3418f0; decisions #141-#142)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: generated manifest plus the measurement record.
- Tasks: 3 | Depends on: Batches 30, 29
- Phase: 7 | Phase review: after Batch 32

### Task 31.1: regenerate `content-manifest.json` — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\content-manifest.json
- Quality requirements: `npm run manifest:generate` then `npm run manifest:check` (scripts, not build targets).

### Task 31.2: `measurement.md` and A8 — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.ptah\specs\TASK_2026_623_3492\measurement.md (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\vscode-lm-tools\src\lib\code-execution\surface-catalog-reference.spec.ts (only if A8 requires a change)
- Quality requirements: hint text, characters and tokens; corpus fence vs JSON (R8.4) and fence vs markdown (R8.5);
  coding `tools/list` parity (NFR 5.10); Apps `tools/list` delta (A8); an eager-closure section left for Batch 33.
- Decision #140 (amends #136's rationale after Codex peer review): `measurement.md` must not repeat the 106-token
  claim. Record only the hint counts measured in this batch, with the command that produced them.

### Task 31.3: relabel two hint spec case titles (decision #140) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts
- Quality requirements: title-only edit of the two cases about the future-fence guard and component syntax
  coverage, so each title states what the case asserts under #140's amended rationale. No assertion, fixture,
  import or `PTAH_UI_HINT` change.

### Batch 31 verification — ACCEPTED (team-leader)

- Report `batch-31-report.md`. On disk: `content-manifest.json` hash `a40c077c...` (2-line diff); `measurement.md`
  (untracked, decision #142) records hint 371 chars / 87 tokens with its command, R8.4 22/22 fence smaller, R8.5
  25 vs 127, NFR 5.10 byte-identical coding `tools/list`, A8 delta 0; no "106-token" claim. Spec diff is the two
  titles only (2+/2-).
- Team-leader checks, one at a time: `manifest:check` up to date (229 files); hint spec 1 suite 7/7;
  `nx lint agent-sdk` 0 errors, 50 warnings (baseline).
- No `zz-*` scratch files remain (`git status --untracked-files=all` shows only the three batch files and task-folder
  artifacts).
- Stale in-body comment in the component-syntax case ("no full example to stay in budget") carried to Task 32.2
  (decision #141).

### Batch 31 verification

- `npm run manifest:check 2>&1 | tail -n 20 && npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
- Then, one at a time: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 20` (Task 31.3).
- Every Jest call adds the `--moduleNameMapper` from Batch 29 verification (decision #135).

## Batch 32: G1 eager-closure gate patterns — COMPLETE (commit 21074df38; decision #143; Phase 7 review code-logic-review-phase7.md APPROVED WITH NOTES 8/10, 0 Blocking/Serious/Moderate/Minor; Phase 7 ACCEPTED, no fix round; the only residual, the real production-metafile eager-closure run, is Task 33.2)

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: script plus its synthetic spec; closes Phase 7. Task 32.2 is a one-line comment fix carried in from
  Batch 31 (decision #141) so the Phase 7 review sees no stale #136 rationale.
- Tasks: 2 | Depends on: Batch 25
- Phase: 7 (last batch) | Phase review: code-logic on Batches 29-32

### Task 32.1: forbidden and allowed eager inputs — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\scripts\eager-closure-gate.js
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-electron\src\config\eager-closure-gate.spec.ts
- Plan reference: implementation-plan.md:1193-1216 (component 13)
- Pattern to follow: `scripts/eager-closure-gate.js:11-25,76,99-104`
- Quality requirements: forbidden: `chat-ui/src/display-panel.ts`, `chat-ui/src/lib/organisms/display-panel/`,
  `chat/.*/organisms/display-dock/`; allowed growth: the five eager files plus
  `chat-ui/src/lib/services/ptah-ui-display-dock.ts` (decision #59, eager port, `@angular/core` only); fails closed;
  synthetic fixtures per pattern.
- Validation notes (decision #37b):
  - Add `shared/src/mcp-apps-contracts/ptah-ui-agents-source.ts` to the forbidden-eager patterns (D6), with its own
    synthetic fixture.
  - Since Batch 5, `ptah-ui-resolver.ts` imports it at runtime, and the `surface` barrel re-exports the resolver and
    pipeline, so an eager barrel importer could pull it in.
  - If the real gate run trips on it, report the eager importer chain as a finding. Do not drop or loosen the pattern.
- Batch 20 follow-on (decision #76): the eager port `ptah-ui-display-dock.ts` has an erased
  `import type { DisplaySurface }` from `organisms/display-panel/`. Keep matching patterns against esbuild output
  inputs, never source import text. Add a synthetic fixture whose eager `main.js` lists `ptah-ui-display-dock.ts` and
  no `display-panel` input, and assert it passes. The sync's reuse of `organisms/ptah-ui/ptah-ui-block.component.ts`
  is already covered by the existing `organisms/ptah-ui/` pattern.
- Decision #113(b): name `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts`
  explicitly as lazy-only (a comment or entry next to the `chat/.*/organisms/display-dock/` forbidden pattern), and
  add a synthetic fixture whose eager `main.js` lists that exact input and assert the gate fails closed on it.

### Task 32.2: correct the stale rationale comment in the hint spec (decision #141) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts
- Quality requirements: comment-only edit inside the `component syntax coverage: ...` case. Replace "The hint carries
  no full example to stay in budget" with #140's rationale: the hint carries no example because R8.1 does not require
  one and R8.3 assigns worked examples to the `ptah-surface-authoring` skill, so the forms it names are checked
  instead. No title, assertion, fixture, import or `PTAH_UI_HINT` change.

### Batch 32 verification

- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
- Then (Task 32.2): `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 20`
- Every Jest call adds the `--moduleNameMapper` from Batch 29 verification (decision #135).
- Phase 7 code-logic review due after commit
- Result (team-leader): gate spec 20/20, hint spec 7/7, eslint on the three files clean. Executor points ruled in
  decisions.md #143: the three #107 transcript files are required (not a GAP); copy-text-button, tool-language.utils,
  rpc-lane-plan-limits.types and the two declarative-dashboard components stay off the allow-list until Batch 33
  measures them (not a GAP); the ts-jest allowJs warning predates this batch.

## Batch 33: V1 single build, gate run and visual review — COMPLETE (no source commit of its own: build/gate/review only; fix commit 5a2344e37 via Batch 33F; visual-review.md FAIL D1/D2 -> visual-review-33F.md PASS WITH NOTES; decisions #148-#161; Phase 8 ACCEPTED)

- Recommended executor: team-leader runs the build and gate once; visual-reviewer subagent reviews the launched app
- Fallback executor: none (a second run needs a new user decision)
- Execution mode: sequential
- Rationale: decisions.md #17 allows exactly one webview build and one app launch, after every frontend batch and G1.
- Tasks: 3 | Depends on: Batches 13-28, 32
- Phase: 8 Visual verification | Phase review: visual (visual-reviewer), no code-logic
- PRECONDITION (Risk HIGH above): the orchestrator records a user ruling that the one launch includes the Electron
  main-process build (`nx build-dev ptah-electron`) and native rebuild. Do not start this batch without it.
- PRECONDITION SATISFIED: decisions.md #116 (user, 2026-10-11, blanket approval) approves `nx build-dev ptah-electron`
  for Batch 33 alongside #17's one webview build and one app launch. Memory-safe rules still apply.

### Task 33.1: one production webview build with stats — COMPLETE (measurement.md "Eager closure (Batch 33)"; no tracked source change)

- Command (once): `npx nx copy-renderer ptah-electron --parallel=1` (its dependsOn runs the single production
  `ptah-extension-webview:build`, `statsJson: true`), producing `dist/apps/ptah-extension-webview/stats.json`.

### Task 33.2: eager-closure gate on the head stats — COMPLETE (PASS, exit 0, 781 eager inputs; two #143(b) files ruled allow-list in #148, applied by 33F.3)

- Command: `node scripts/eager-closure-gate.js dist/apps/ptah-extension-webview/stats.json`
- No merge-base stats exist: record "growth check not run (single build, decisions.md #17)" and list added eager inputs
  by name and bytes in D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.ptah\specs\TASK_2026_623_3492\measurement.md.
- Decision #143: flag any of `copy-text-button.component.ts`, `tool-language.utils.ts`, `rpc-lane-plan-limits.types.ts`,
  `dashboard-avatar.component.ts`, `dashboard-sparkline.component.ts` found in the eager closure as "unlisted eager
  growth, ruling needed"; the team-leader rules after the run. Do not edit the gate script in Batch 33.

### Task 33.3: one Electron app launch and visual review — COMPLETE (first run visual-review.md FAIL: D1, D2 serious; after 33F, scoped re-check on the #157 rebuild visual-review-33F.md PASS WITH NOTES, #158; populated surfaces are follow-up #161(1) per USER #155(b))

- Launch once (after the ruled main-process build): `node apps/ptah-electron/scripts/launch.js`
- visual-reviewer checks against `prototype/screenshots/`: widths 360/1024 (chat) and 300/960 (panel), dark and light,
  collapsed and expanded; chat chips, previews (Bash/Read/Write/Edit, Electron and VS Code webviews per R7.8/R7.10),
  summary, states, agents, atoms, dock, empty, the Agents empty tabpanel; R9.5 width script (prototype `?check=1`);
  collapsed row height (R7.9) per decision #123: header toggle row ≤ 36 px for Bash/Read/Write/Edit, collapsed
  Bash card ≤ the prototype's collapsed Bash card (header + one ellipsised command line), merge-base Bash height
  recorded; axe zero serious/critical. Writes visual-review.md in the task folder.
- Code-output row estimate (decisions #118, #121(a)): at chat-narrow (360) and chat-wide (1024), dark and light,
  render code-output with three named inputs: (1) six short lines of 60-100 ASCII characters each; (2) six lines
  of wide/CJK text; (3) a multi-line structural markdown sample (headings, a list, a fenced block). For each, assert
  no clipped content and no horizontal overflow (`scrollWidth <= clientWidth` on the block), and record whether the
  "Show full output" toggle or the non-collapsible `max-h-48` vertical-scroll fallback appears. The fallback is
  accepted for this task; if the reviewer judges it unacceptable, record it as the later width-aware-estimate
  change, not a Batch 26 redesign.
- Approved differences from the prototype (not fidelity defects): the expanded display chip shows no item counts or
  totals (decision #63); an evicted chip has no open button (decision #61); user-approved in decision #91: each
  Files row has one action, "Review"/"Resolve", no "Open file" pill (#83); summary stat cards have no sparklines or
  trend pills (#85); Lines/Tokens/Cost/Duration cards expand to a short detail, R6.1 amended (#86); the Turn summary
  subtitle reads "host-built" only (#88). Pending the #127 peer review: the Edit meta bar has no "Lines 41-46" (diff
  gutter numbers lines within the snippet) and the Write meta reads "N lines", not "New file - N lines" (#127).
- Shared path link (#128): record the diff-header `ptah-file-path-link` with a long path at chat-narrow (360); it
  ellipsises (`truncate`) where design-spec.md:140 wants wrapping. A defect there is a named later task (shared atom).
- Plan reference: implementation-plan.md:1324-1345, 1420

## Batch 33F: Phase 8 fix round — dock tabpanel display, chip word values, eager allow-list — COMPLETE (commit 5a2344e37; visual re-check visual-review-33F.md PASS WITH NOTES, #158; landmark-unique and markdown scrollable-region rulings #159; follow-ups #161)

- Recommended executor: CLI lanes x3, one per task (self-contained prompts, absolute paths, CLAUDE.md memory-safe rules
  repeated in each prompt)
- Fallback executor: frontend-developer sub-agent sequential for 33F.1 then 33F.2; backend-developer for 33F.3
- Execution mode: parallel
- Rationale: three file-disjoint tasks (2 files each), no shared registry, entry point or config, no task depends on
  another; one batch across three projects by orchestrator request (decision #153).
- Tasks: 3 | Depends on: Batch 33 (Tasks 33.1-33.3)
- Phase: 8 Visual verification (fix round) | Phase review: none for code-logic (decision #153); the one re-review is
  the scoped visual re-check below, which needs USER approval of a second webview build and app relaunch (#154(d))
- Decisions: #148 (allow-list), #149 (D1), #150 (D2), #151 (M1/M3 deferred), #152 (empty-state copy), #154 (re-check)
- Lanes do not run git, do not edit batches.md or decisions.md, and do not run build/serve/package targets.

### Task 33F.1: dock tabpanels honour `hidden` (D1) — COMPLETE (display-dock Jest 21/21)

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.spec.ts
- Plan reference: visual-review.md Group 3 and Defects D1; decision #149; design-spec.md:31-40 (one dock, two tabs)
- Pattern to follow: the existing tabpanel blocks at display-dock.component.ts:168-175 and :191-198
- Quality requirements: on both `role="tabpanel"` divs remove the static `flex` class; keep `min-h-0 min-w-0 flex-1
  flex-col`, `[id]`, `aria-labelledby`, `[hidden]` and `data-testid`; add `[class.flex]="<active>"` and
  `[class.hidden]="!<active>"` where `<active>` is `state().activeTab === 'displays'` / `=== 'agents'`. Both panels
  stay mounted (no `@if`), so agent-monitor and display-panel state survive tab switches.
- Spec to add (display-dock.component.spec.ts): for activeTab `displays` and for `agents`, the inactive panel
  (`[data-testid=display-dock-agents]` / `display-dock-displays`) has the `hidden` attribute, class `hidden`, and
  NOT class `flex`; the active panel has class `flex`, no class `hidden`, no `hidden` attribute. Comment that jsdom
  does not compute CSS, so the class contract is the guard against `.flex` overriding `[hidden]`.
- Validation notes: do not touch `display-panel.component.ts` or `dashboard-stat.component.ts` (audited in #149, no
  display utility on their `[hidden]` elements).

### Task 33F.2: chip word values never break mid-word (D2) — COMPLETE (turn-recap Jest 58/58)

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.spec.ts
- Plan reference: visual-review.md Group 4 and Defects D2; decision #150; design-spec.md:110, 161, 172-173
- Pattern to follow: `miniCards` computed at turn-summary-chip.component.ts:323-370 and the value span at :182-188
- Quality requirements: add `word: boolean` to the chip's `ChipMiniCard` type, true when the shown value is the
  literal `'unavailable'` or `'pending'` (`TurnSummaryUnavailable`, turn-summary.model.ts:24); set it for every card
  in `miniCards`. The value span binds classes: word values `block break-normal text-sm font-medium`; all other
  values (numbers, `?`, `+N −M`, `N/M`) keep `block break-words text-lg font-semibold tabular-nums`. Keep the
  `.ts-mini-grid` minimum at 104 px (design-spec.md:173). Text, srSuffix and caption are unchanged.
- Spec to add (turn-summary-chip.component.spec.ts): expanded chip with tokens, cost and duration `unavailable`:
  those value spans have `break-normal` and `text-sm` and NOT `break-words` / `text-lg`; their text is still
  "unavailable"; a numeric value span (e.g. Files `3` or Tests `2/3`) keeps `text-lg` and `break-words`; a `pending`
  value takes the word classes too.

### Task 33F.3: allow-list the two eager tool-preview helpers (#143(b) ruling) — COMPLETE (gate Jest 23/23)

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\scripts\eager-closure-gate.js
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-electron\src\config\eager-closure-gate.spec.ts
- Plan reference: decision #148; measurement.md "Eager closure (Batch 33)"; decision #143(b)
- Pattern to follow: `ALLOWED_EAGER_GROWTH_INPUTS` at scripts/eager-closure-gate.js:26-37 (anchored `$` regexes,
  one comment per entry); the `allows listed eager growth input %s` table at eager-closure-gate.spec.ts:124-143
- Quality requirements: add `/libs\/frontend\/chat-ui\/src\/lib\/atoms\/copy-text-button\.component\.ts$/` and
  `/libs\/frontend\/chat-ui\/src\/lib\/utils\/tool-language\.utils\.ts$/` with a comment: eager because the
  pre-existing inline tool-call header, input display, diff display and code output import them (#148). Add both
  paths to the `it.each` allow table. Add one negative case: an unlisted sibling such as
  `libs/frontend/chat-ui/src/lib/atoms/other-new.component.ts` still throws `unlisted eager input growth`. No change
  to forbidden patterns, `assertNoForbiddenEager`, or the CLI.

### Batch 33F verification (team-leader, one at a time, output tailed)

Every Jest call adds `--moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'` (decision #135).

1. `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
2. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/turn-recap --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
3. `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
4. `npx eslint` on the six changed files, then `npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`
   and `npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20` (sequential).
5. Commit 33F (team-leader). Then, ONLY with user approval of a second build (#154(d)): one
   `npx nx copy-renderer ptah-electron --parallel=1`, one relaunch on CDP 9333, and a scoped visual-reviewer re-check
   per #154(a): dock tab switching dark/light, chip at 360 dark/light, dock keyboard/focus pass, populated surfaces
   if the provider can produce a turn. Re-running `node scripts/eager-closure-gate.js` on the new stats is cheap and
   rides on the same build. Batch 33 moves to COMPLETE when that re-check passes; a still-429 provider goes to the
   user per #154(b).
