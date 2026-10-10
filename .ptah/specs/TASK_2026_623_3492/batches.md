# Batches - TASK_2026_623_3492

Total tasks: 77 | Batches: 37 (incl. fix batches 6F, 12F, 15F, post-cap correction 12F2) | Complete: 25/37

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
- A3 every SDK subagent record's `parentToolUseId` matches a transcript node `toolCallId` — unverified; checked in
  Task 22.3 (unmatched R belongs to no turn, D7).
- A4 open-turn messages carry streaming text nodes in `vm().messages` — unverified; checked in Task 22.2.
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
| 5 Transcript and dock | 22-25 | code-logic |
| 6 Previews (R7, both webviews) | 26-28 | code-logic, plus style (new exported `copy-text-button` atom and `tool-language` util) |
| 7 Hint, skill, measurement, eager gate | 29-32 | code-logic |
| 8 Visual verification (V1) | 33 | visual (visual-reviewer subagent); no code-logic |

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

## Batch 21: C6 display panel and turn summary cards — COMPLETE (commit PENDING_SHA)

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
  row action), #85 (no sparklines/trend pills), #86 (Lines/Tokens/Cost/Duration expand), #88 (subtitle) provisional,
  NEEDS USER; #90 acceptance.
- Follow-ons carried: Batch 23 (new Task 23.5), Batch 25 (Task 25.1 outputs and imports).

## Batch 22: H1 transcript projections — PENDING

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: eager, zero-import pure projections in the chat lib.
- Tasks: 3 | Depends on: Batch 3
- Phase: 5 Transcript and dock | Phase review: code-logic (after Batch 25)

### Task 22.1: fence-line display check — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\execution\ptah-ui-fence-line.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\execution\ptah-ui-fence-line.spec.ts (CREATE)
- Plan reference: implementation-plan.md:833-881 (component 7)

### Task 22.2: `collectDisplayCandidates` — PENDING

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

### Task 22.3: `collectTurnAgentFacts` — PENDING

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-agent-facts.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-agent-facts.spec.ts
- Plan reference: D6-D8
- Quality requirements: turn attribution per D7; allow-listed fields only.
- Validation notes: resolve A3 (`agent-monitor.store.ts:241-251`); R5.9(d) fixture seeds the Task tool node.

### Batch 22 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/execution/ptah-ui-fence-line.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-candidates.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`

## Batch 23: H2 dock state, transcript host sources, sidebar tab — PENDING

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the per-tab store and the host-sources provider the transcript wires next.
- Tasks: 5 (Task 23.4 added by decision #59, Task 23.5 by #89) | Depends on: Batches 16, 20, 21, 22
- Phase: 5 | Phase review: after Batch 25

### Task 23.1: `DisplayDockState` — PENDING

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

### Task 23.4: main-barrel export of the dock port (decision #59) — PENDING

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

### Task 23.5: display-panel lazy entry exports the panel (decision #89) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\display-panel.ts
- Implementation details: add `export { DisplayPanelComponent, DISPLAY_PANEL_SUMMARY_KEY } from
  './lib/organisms/display-panel/display-panel.component'` and `export type { DisplayPanelViewStateChange }` from the
  same file. Lazy entry only: nothing is added to `src/index.ts` for these. `TurnSummaryComponent` and its children
  stay unexported.
- Cleanup (decision #82): delete the untracked, unreferenced scratch files
  `libs\frontend\chat-ui\src\lib\organisms\display-panel\_files.html` and `_tests.html`; report that
  `grep -rn "_files.html\|_tests.html" libs/frontend/chat-ui/src` finds nothing.
- Validation: the chat-ui typecheck and lint in the Batch 23 verification line cover the entry.

### Task 23.2: transcript host-sources provider — PENDING

- File (CREATE): D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-ptah-ui-host-sources.ts
- Plan reference: implementation-plan.md:833-881, 977-993
- Quality requirements (decision #54): `capacities` is `[liveModelStats.contextCapacity]` of the tab when that value
  is present, and `[]` otherwise. `PtahUiAgentsSource` reads only this list (plan:685). The spec covers both cases.

### Task 23.3: sidebar tab atom (count badge / tab ARIA) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\atoms\sidebar-tab.component.ts
- Plan reference: implementation-plan.md:975

### Batch 23 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/display-dock --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

## Batch 24: H3 transcript wiring and tests-row removal — PENDING

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the Electron placement move; export removal and deletion stay together so the boundary compiles.
- Tasks: 2 | Depends on: Batches 23, 19, 20
- Phase: 5 | Phase review: after Batch 25

### Task 24.1: transcript publishes candidates/summary inputs, mounts sync and chip — PENDING

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

### Task 24.2: delete the tests row — PENDING

- Depends on: Task 24.1 and Task 19.1 (cases already ported)
- Files:
  - DELETE D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-tests-row.component.ts
  - DELETE D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-tests-row.component.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\turn-recap.ts
- Quality requirements: no remaining reference to `TurnTestsRowComponent` / `ptah-turn-tests-row` (grep).

### Batch 24 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`

## Batch 25: H4 dock component and ChatView integration — PENDING

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: one coherent UI integration (dock, ChatView, monitor move); closes Phase 5.
- Tasks: 2 | Depends on: Batches 24, 21
- Phase: 5 (last batch) | Phase review: code-logic on Batches 22-25

### Task 25.1: display dock component (Displays and Agents tabpanels) — PENDING

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

### Task 25.2: ChatView mounts the dock; monitor panel becomes the Agents tabpanel — PENDING

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
- Note: this batch touches 6 files in one lib (limit reached).

### Batch 25 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/display-dock libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx jest -c libs/frontend/chat/jest.config.ts execution-node.ptah-ui.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 20 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`
- Phase 5 code-logic review due after commit

## Batch 26: P1 tool-language util, copy button, code output — PENDING

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: shared preview building blocks first.
- Tasks: 3 | Depends on: none (runs after Phase 5)
- Phase: 6 Previews (R7) | Phase review: code-logic + style (after Batch 28)

### Task 26.1: tool-language util — PENDING

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\utils\tool-language.utils.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\utils\tool-language.utils.spec.ts
- Plan reference: implementation-plan.md:1086-1145 (component 11)
- Quality requirements: R7.5; keeps existing detection (extension, `bash`, JSON sniffing — parity section 4).

### Task 26.2: copy-text button atom — PENDING

- Files (CREATE):
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\atoms\copy-text-button.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\atoms\copy-text-button.component.spec.ts

### Task 26.3: code output expand, language label — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.spec.ts
- Quality requirements: R7.4; keep `max-h-48` scroll, ANSI/system-reminder/`N→` stripping (parity section 4).

### Batch 26 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/utils/tool-language.utils.spec.ts libs/frontend/chat-ui/src/lib/atoms/copy-text-button.component.spec.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

## Batch 27: P2 tool-call header and tool-call item — PENDING

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: header redesign and its host item; edits `chat-ui/src/index.ts` after Batch 16.
- Tasks: 2 | Depends on: Batches 26, 16
- Phase: 6 | Phase review: after Batch 28

### Task 27.1: tool-call header (command preview, status text, accessible names) — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-call-header.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-call-header.component.spec.ts (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\index.ts
- Quality requirements: R7.1-R7.3; every header parity row (gold `mcp__ptah` styling, badges, toggle `aria-expanded`,
  file path link, Bash description/40-char truncation with full command, streaming description, parse-error warning,
  status icons, duration badge).
- Validation notes: resolve A9; with no exit code, "Command succeeded/failed".

### Task 27.2: tool-call item — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\molecules\tool-execution\tool-call-item.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\molecules\tool-execution\tool-call-item.component.spec.ts
- Quality requirements: collapsed by default; auto-expand on permission request; R7.10 both webviews.

### Batch 27 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -n 20`

## Batch 28: P3 diff, input and output displays — PENDING

- Recommended executor: frontend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: the three file-preview molecules; closes Phase 6.
- Tasks: 3 | Depends on: Batch 26
- Phase: 6 (last batch) | Phase review: code-logic + style on Batches 26-28

### Task 28.1: diff display (+/− counts, gutter) — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\diff-display.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\diff-display.component.spec.ts
- Quality requirements: R7.6; keeps path link, replacements badge, `max-h-64`.

### Task 28.2: tool input display (full command, Write preview) — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-input-display.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-input-display.component.spec.ts
- Quality requirements: R7.2, R7.7; trivial-input hiding, 60-char truncation for other params, retention notice kept.

### Task 28.3: tool output display — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-output-display.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-output-display.component.spec.ts
- Quality requirements: output routing, retention notice and error alert kept.

### Batch 28 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`
- Phase 6 code-logic + style review due after commit

## Batch 29: A1 prompt hint and no-write-back fixtures — PENDING

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: hint text with its token gate, plus the two host-data sentinel specs.
- Tasks: 2 | Depends on: Batches 6, 7, 19
- Phase: 7 Hint, skill, measurement, eager gate | Phase review: code-logic (after Batch 32)

### Task 29.1: `PTAH_UI_HINT` — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts
- Plan reference: implementation-plan.md:1146-1192 (component 12)
- Quality requirements: R8.1 ≤ 100 tokens; names `display [id]`, the id-update rule, `$diff $tests $usage $agents
  $limits`, points to the skill; examples parse; no `/note/i`; if over budget drop `$limits` and record both counts.

### Task 29.2: host-data sentinel specs — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.host-data.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\services\message-sender.host-data.spec.ts
- Quality requirements: R5.8 (`$agents` sentinel name, cost `0.623623`), R10.5 (`$limits` sentinel lane, `62.3623%`),
  R6.7 (summary) never reach the outgoing prompt/options.

### Batch 29 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx lint @ptah-extension/agent-sdk --parallel=1 2>&1 | tail -n 20`

## Batch 30: DOC1 `ptah-surface-authoring` skill text — PENDING

- Recommended executor: technical-content-writer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: documentation in two mirrored copies; every example must be a corpus case from Task 6.1.
- Tasks: 2 | Depends on: Batches 6, 29
- Phase: 7 | Phase review: after Batch 32

### Task 30.1: asset skill copy — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\SKILL.md
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\ptah-ui.md
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\catalog.md
- Plan reference: implementation-plan.md:1146-1192
- Quality requirements: R3 EBNF and lexical delta; display and id rules; `$agents` (context, unavailable/no-percent,
  `session`, CLI context unavailable today); `$limits`; the three worked examples; "Common mistakes" for `session` and
  indentation; `/4` kinds in catalog.md.

### Task 30.2: `.claude/skills` mirror — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\SKILL.md
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\references\ptah-ui.md
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\references\catalog.md
- Quality requirements: byte-identical to Task 30.1.

### Batch 30 verification

- `diff -r apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring .claude/skills/ptah-surface-authoring && npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 20`
- Team-leader also confirms each skill example appears in `ptah-ui.corpus.ts`.

## Batch 31: DOC2 content manifest and measurement — PENDING

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: generated manifest plus the measurement record.
- Tasks: 2 | Depends on: Batches 30, 29
- Phase: 7 | Phase review: after Batch 32

### Task 31.1: regenerate `content-manifest.json` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\content-manifest.json
- Quality requirements: `npm run manifest:generate` then `npm run manifest:check` (scripts, not build targets).

### Task 31.2: `measurement.md` and A8 — PENDING

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.ptah\specs\TASK_2026_623_3492\measurement.md (CREATE)
  - D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\vscode-lm-tools\src\lib\code-execution\surface-catalog-reference.spec.ts (only if A8 requires a change)
- Quality requirements: hint text, characters and tokens; corpus fence vs JSON (R8.4) and fence vs markdown (R8.5);
  coding `tools/list` parity (NFR 5.10); Apps `tools/list` delta (A8); an eager-closure section left for Batch 33.

### Batch 31 verification

- `npm run manifest:check 2>&1 | tail -n 20 && npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`

## Batch 32: G1 eager-closure gate patterns — PENDING

- Recommended executor: backend-developer
- Fallback executor: general-purpose subagent
- Execution mode: sequential
- Rationale: script plus its synthetic spec; closes Phase 7.
- Tasks: 1 | Depends on: Batch 25
- Phase: 7 (last batch) | Phase review: code-logic on Batches 29-32

### Task 32.1: forbidden and allowed eager inputs — PENDING

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

### Batch 32 verification

- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
- Phase 7 code-logic review due after commit

## Batch 33: V1 single build, gate run and visual review — PENDING

- Recommended executor: team-leader runs the build and gate once; visual-reviewer subagent reviews the launched app
- Fallback executor: none (a second run needs a new user decision)
- Execution mode: sequential
- Rationale: decisions.md #17 allows exactly one webview build and one app launch, after every frontend batch and G1.
- Tasks: 3 | Depends on: Batches 13-28, 32
- Phase: 8 Visual verification | Phase review: visual (visual-reviewer), no code-logic
- PRECONDITION (Risk HIGH above): the orchestrator records a user ruling that the one launch includes the Electron
  main-process build (`nx build-dev ptah-electron`) and native rebuild. Do not start this batch without it.

### Task 33.1: one production webview build with stats — PENDING

- Command (once): `npx nx copy-renderer ptah-electron --parallel=1` (its dependsOn runs the single production
  `ptah-extension-webview:build`, `statsJson: true`), producing `dist/apps/ptah-extension-webview/stats.json`.

### Task 33.2: eager-closure gate on the head stats — PENDING

- Command: `node scripts/eager-closure-gate.js dist/apps/ptah-extension-webview/stats.json`
- No merge-base stats exist: record "growth check not run (single build, decisions.md #17)" and list added eager inputs
  by name and bytes in D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.ptah\specs\TASK_2026_623_3492\measurement.md.

### Task 33.3: one Electron app launch and visual review — PENDING

- Launch once (after the ruled main-process build): `node apps/ptah-electron/scripts/launch.js`
- visual-reviewer checks against `prototype/screenshots/`: widths 360/1024 (chat) and 300/960 (panel), dark and light,
  collapsed and expanded; chat chips, previews (Bash/Read/Write/Edit, Electron and VS Code webviews per R7.8/R7.10),
  summary, states, agents, atoms, dock, empty, the Agents empty tabpanel; R9.5 width script (prototype `?check=1`);
  collapsed row ≤ 36 px (R7.9); axe zero serious/critical. Writes visual-review.md in the task folder.
- Approved differences from the prototype (not fidelity defects): the expanded display chip shows no item counts or
  totals (decision #63); an evicted chip has no open button (decision #61).
- Plan reference: implementation-plan.md:1324-1345, 1420
