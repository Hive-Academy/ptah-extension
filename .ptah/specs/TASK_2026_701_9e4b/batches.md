# Batches - TASK_2026_701_9e4b

Total tasks: 34 | Batches: 27 | Complete: 17/27

Phases: P1 foundation (Batches 1-9) | P2 wizard and packs (Batches 10-18) | P3 Library and
Marketplace (Batches 19-25) | P4 rubric (Batch 26).

Worktree (all paths below are absolute under it; work only here):
`D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment` (branch
`feat/wizard-library-alignment`, base `38d9cc427`).

Inputs: implementation-plan.md (Gate 2 APPROVED, rev 3), implementation-plan-review.md (Round 2
re-review APPROVED), decisions.md (D3, D7-D16 final), design-spec.md + prototype/ (Gate 1.7
APPROVED), parity-inventory.md (77 capabilities, 0 removals), task-description.md.

## Rules for every batch (repeat into every executor prompt)

- Never run workspace-wide checks and never `nx run-many` across projects you did not change.
  Verify only with the batch's `npm run verify -- -p <projects>` command, one foreground run with a
  long timeout, output filtered (`| tail -40`). Confirm the header "Running target ... for N
  projects" names every listed project.
- Never run `build`, `serve`, `dev`, `e2e` or `package` targets.
- Electron first. Do not add feature or polish work for the TUI or the VS Code extension; keep every
  host (Electron, VS Code extension, CLI, TUI) compiling, which is why host projects are in the
  verify lists.
- Implementation agents never run `git commit`, `git push` or open PRs, and never edit
  `batches.md` or `task.md`. The team-leader owns git and task state.
- Real code only: no stubs, TODO/PLACEHOLDER markers, empty bodies, or mock data standing in for
  logic. No `any`. Replace in place; delete replaced code (no V2/Legacy copies).
- Edit only the files the batch lists. A file outside the list that must change to keep the batch
  compiling is reported with the reason, not silently edited.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | --- | --- | --- | --- |
| TL1 | Executors are Claude subagents (backend-developer / frontend-developer), not CLI lanes; reviews are codex (other family) | CLI lane per batch; Claude subagent | decisions.md D2 (Claude subagents author, codex lanes review); orchestrator prompt pins the executor types | yes |
| TL2 | "File-disjoint" = no two batches own a file at the same time and no batch runs in parallel with another that shares a file. A few files must be revisited by later batches in strict order; they are listed in the Shared-file ledger. Strict once-only ownership is impossible: A33 requires the `rpc.types.ts` registry entries and guard specs to land with each new method (B8 in P2, B12 in P3), and the plan's own shared-file list orders `wizard-generation-rpc.handlers.ts`, `register-shared-rpc-handlers.ts` and agent-generation `index.ts` across components | strict once-only (forces one giant batch per lib); ordered hand-off | implementation-plan.md:1612-1629 (shared files edited in phase order); A33 | yes |
| TL3 | B2 (guarded writer) moves from P1 to P2 and shares Batch 10 with B3 | keep B2 in P1; merge with B3 | B2 makes `writeAgent(agent, guard)` take a required guard (plan :336-337) and deletes `writeAgentsBatch`; its only caller `orchestrator.service.ts:874` is changed by B3 (P2). In P1 alone the agent-generation lib would not compile, which breaks "each phase compiles alone" | yes |
| TL4 | B1 does not add `HarnessRepairBlockedPath.expectedDigest` or the `'changed-since-approval'` outcome; Batch 7 (B9 repair) adds them together with the consumers (A-outcome) | add in B1; add with consumer handling | Adding a union member in B1 can break an exhaustive consumer switch in marketplace that only B9 (A-outcome) updates | yes |
| TL5 | B9 is split into keep policy (Batch 6), scanner + digest repair (Batch 7) and port + propagation (Batch 9, with all three host refresher adapters, B11 and B10's host wiring). The Electron coalescer contract change (A24) is its own Batch 8 | one B9+B11 batch (~20 files, 5 projects) | Plan :621-623 binds only the port change to the three adapters. The coalescer change compiles alone: existing `request()` callers ignore the result (plan :735) | yes |
| TL6 | B10 host wiring (libraryScopeRoot, descriptors, skills.sh roots) is in Batch 9, not with the B10 library batch | separate host batch; with B11 | Same files as B11 (Electron/VS Code `plugin-activation.ts`, CLI `harness-boot.ts`); B11's spec seam already asserts `libraryScopeRoot` and descriptors (plan :749-750) | yes |
| TL7 | B12 is split: services + B13 (Batch 19, owns `skills-synthesis-rpc.handlers.ts`, `register-shared-rpc-handlers.ts`, the three `container.smoke.spec.ts`), then routes + both new methods (Batch 20, owns `rpc.types.ts` registry, allowlist and rpc-surface specs) | one B12 batch then B13 | Plan :1612-1613 requires `skills-synthesis-rpc.handlers.ts` in one batch or ordered for B12/B13. Services registered and unit-tested in Batch 19 are wired by Batch 20 inside the same phase | yes |
| TL8 | F2 and F4 share one batch (Batch 15) | ordered; merged | Both edit `agent-selection.component.ts` and `wizard-rpc.service.ts` (plan :1616-1617) | yes |
| TL9 | D16 applied in Batch 2 (B16): `JSONRPC_SCHEMA_VERSION` `'0.2'` → `'1.0'`; JSON-RPC wire `"jsonrpc": "2.0"` and `protocol_version: "2.0"` unchanged; version examples and the breaking-change note updated in `jsonrpc-schema.md` and both copies of the `ptah-cli-usage` skill references | keep 0.2 (A34); bump | decisions.md D16 overrides A34. Constant at `apps/ptah-cli/src/cli/jsonrpc/types.ts:32`; examples at `jsonrpc-schema.md:66,527,539`, note `:69`; skill refs `references/jsonrpc.md:4,73,111,141`, `references/mcp-serve.md:170` (two identical copies) | yes |
| TL10 | Batch size limit (6 files, 2 projects) is exceeded only where compile-alone or a user decision forces it: Batch 1 (B1 shared types), Batch 2 (B16, D11/D16 "one batch"), Batch 9 (port + three host adapters), Batch 13 (B8 + A33 guard specs), Batch 14 (F1, 7 new small components in one folder), Batch 20 (B12 routes + A33 guard specs) | split further | Splitting any of these leaves a batch that does not compile or violates D11/D16/A33 | yes |
| TL11 | Every verify command lists the changed projects plus the host projects that depend on a changed lib: ptah-electron, ptah-extension-vscode, ptah-cli (and @ptah-extension/cli-engine where its rpc-surface or harness-boot is involved; ptah-tui where shared plugin-config types change; ptah-extension-webview for frontend libs) | changed projects only | CLAUDE.md "Keep every host compiling ... run typecheck and tests for each host project that depends on it" | yes |

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A-dir (B5): `handlers/wizard-generation/` subfolder is acceptable — unverified; Task 11.1 checks
  the lib index and neighbours (folder does not exist today; `setup/`, `marketplace/`,
  `skill-synthesis/` also do not exist and are created by Batches 13 and 19).
- A-cache (B8): pack cache metadata has no other reader — Task 13.1 checks with
  `ptah_lsp_references`.
- A-retire, A-paths (B9) — Task 6.1 and Task 7.1. A-outcome (B9) — Task 7.1.
- A-sidecar, A-reap, A-disabled (B10) — Task 5.1 (A-reap: the plan names
  `user-layer-mirror.service.reap.spec.ts`, which does not exist; the reap spec on disk is
  `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-reap.spec.ts`) and Task 9.3
  (A-disabled host filtering).
- A-plan, A-rebase-lock, A-smoke (B12) — Task 19.1; A-cli-plugins (B12) — Task 20.1.
- A-rows (B13) — Task 19.2.
- A-type, A-dis (B14) — Task 26.1 (A-dis may need `wizard-generation-rpc.handlers.ts`; P4 runs
  after P2/P3 so the edit is allowed inside Batch 26 and recorded in the ledger).
- A-info, A-session, A-global-sync (B15) — Task 3.1.
- A-nav, A-hint (F6) — Tasks 22.1 and 23.1. A-share, A-search (F7) — Tasks 24.1 and 25.1.
- Union extension in B1 (`wizard/phase.ts:205`, `rpc-setup.types.ts:319`) breaks no exhaustive
  consumer — unverified; Batch 1 verify includes rpc-handlers, setup-wizard and the hosts.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| B2's required guard breaks `orchestrator.service.ts:874` if it lands in P1 without B3 | HIGH | TL3: Batch 10 = B2 + B3 |
| Port change (`IUserLayerRefresher.refresh` returns a status) compiles only with all three host adapters | HIGH | Batch 9 carries the port, propagation, Electron, VS Code and CLI adapters together |
| D14 config home: wrong routing hides or loses saved sibling plugin config | HIGH | Task 3.1 verification matrix (two siblings open at once, conflict, adopt no-union, dismiss, save during conflict, concurrent save during import, write failures, idempotent import, intentional empty config); no folder record written or deleted; Batch 20 resolve-config-home rejects unknown folders |
| Approval digests (A21): replace applied after the content changed (A → B) | HIGH | Task 7.1 (repair under lock), Task 19.1 (rebase re-digest, approvals), Task 10.1 (writer baseline); A → B, delete/recreate, unreadable-after-plan cases required |
| Pack install concurrency (A22): shared mutation promise across targets/decisions | HIGH | Task 13.1 deletes existence-only cache short-circuit and target-blind dedup; per-root serialization; concurrency specs |
| D13: pack prompt fixture lost the unreadable and bulk states | MEDIUM | Task 13.1 (server: unreadable forced Keep, bulk decisions skip unreadable) and Task 15.2 (UI: unreadable row forced Keep and disabled, bulk "Replace all" skips it) |
| B16 rename spans 40 files in 7 projects plus the schema bump (D11, D16) | MEDIUM | One batch (Batch 2), repo search before and after (`overwrittenLocalEdit` count must be 0 outside `.ptah/specs`), full consumer verify list |
| Shared-file revisits across batches (TL2) | MEDIUM | Shared-file ledger below; batches strictly sequential; each later batch reads the file fresh |
| B1 outcome-union extension or new message type breaks a consumer | MEDIUM | TL4; Batch 1 verify includes rpc-handlers, setup-wizard, webview and hosts |
| F7i notice and F6 pointer are outside the approved prototype (D15) | MEDIUM | P3 phase review includes an Electron visual review, dark + light, narrow window |
| Services added in Batch 19 are unused until Batch 20 | LOW | Same phase; Batch 19 unit-tests and smoke-resolves them; P3 review covers the wiring |
| Heavy verify lists (hosts in every backend batch) | LOW | Shared Nx cache and the verify lock; one foreground run per batch |
| A-dis may need the wizard handler in P4 | LOW | P4 runs last; ledger entry |

Edge cases:

- Unreadable local file = forced Keep everywhere; bulk skips it — Tasks 10.1, 11.1, 13.1, 14.1, 15.2, 24.1.
- Re-preview after content change (exists A → B / differs A → B): old revision's Replace rejected — Tasks 11.1, 13.1, 14.1.
- Stale/superseded preview token with Replace → `preview-required` — Task 11.1.
- Untabbed (wizard-view modal) submit still token-bound — Tasks 11.1, 15.1.
- Resume/retry never replaces a kept file; pre-change manifest resumes create-only — Task 12.1.
- Kept agent never listed as diverged; completion counts equal rows — Tasks 12.2, 17.1.
- Coalescer: success then skipped batch → second request gets `skipped`; request during a running pass gets the next batch outcome — Task 8.1.
- Fresh workspace without agent-sync consent: plugin agents still become Library clones; rival fan-out stays gated — Task 5.1.
- Two external plugins with one basename; uninstall of a plugin whose display name ≠ id — Tasks 5.1, 19.2.
- Two sibling folders open at once with conflicting plugin config — Task 3.1.
- Opened-folder pack/wizard target → no consent grant, no pass, `not-applicable` — Tasks 12.2, 13.1.
- All pack files failed → `success:false`, no consent, no pass — Task 13.1.
- Library failure notice only for its own `scopeRoot`; out-of-order replies dropped — Task 23.1.
- `plugins:replace-kept-items` rejects an approvalId from another family — Task 20.1.
- Edited managed copy kept in every pass until "Review and replace" (D8) — Task 6.1.

## Shared-file ledger (ordered hand-offs, TL2)

| File (under the worktree) | Batches in order |
| --- | --- |
| `libs/shared/src/lib/types/rpc.types.ts` | 1 (DTO types only) → 13 (`wizard:plan-pack-install` registry) → 20 (`plugins:replace-kept-items`, `plugins:resolve-config-home` registry) |
| `libs/shared/src/lib/types/harness-sync.types.ts` | 2 (D11 rename) → 7 (`expectedDigest?`, `'changed-since-approval'`) |
| `libs/backend/harness-sync/src/lib/targets/{claude-target,workspace-target,harness-target.port,mcp/mcp-facet-planner}.ts`, `health/harness-health.ts`, `reconciler/harness-reconciler.service.ts` and their specs | 2 (rename) → 6 (keep semantics) |
| `libs/backend/harness-sync/src/lib/di/register.ts`, `src/index.ts` | 7 (scanner) → 9 (`NO_USER_LAYER_REFRESH` status, propagation exports) |
| `libs/backend/agent-generation/src/index.ts` | 4 (B4) → 5 (B10) → 10 (B3) → 12 (`KeptAgentOutcome` export removed, reported deviation) |
| `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts` | 17 only (added after Batch 12) |
| `libs/backend/agent-generation/src/lib/di/tokens.ts`, `di/register.ts` | 4 only |
| `apps/ptah-electron/src/activation/coalesced-job.ts` (+ spec) | 8 only |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` | 11 (B5) → 12 (B6, B7) → 26 only if A-dis requires it |
| `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts` | 11 → 13 → 19 |
| `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`; `apps/ptah-electron/src/di/rpc-surface.spec.ts`; `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`; `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` | 13 → 20 |
| `apps/ptah-{electron,extension-vscode,cli}/src/di/container.smoke.spec.ts` | 19 (A-smoke); 4/11/13 only if a guard there fails (report first) |
| `apps/ptah-{electron,extension-vscode,cli}/src/di/expected-resolvable.ts`; `apps/ptah-electron/src/di/surface-composition.spec.ts`, `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`, `libs/backend/cli-engine/src/lib/surface-composition.spec.ts` | No change expected (handler lists already hold Setup/WizardGeneration; new services are not handlers). Must stay green in Batches 4, 7, 11, 13, 19, 20; a batch that adds a service and finds one of these failing updates it in that same batch (A33) |
| `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`, `services/wizard-rpc.service.ts` | 15 only (TL8) |
| `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` | 19 only (TL7) |
| `libs/frontend/marketplace/src/services.ts`, `apps/ptah-extension-webview/src/app/app.config.ts` | 21 only |

## Phase reviews

One codex code-logic review per phase on the combined diff (parent of the phase's first commit
to `HEAD` of its last). Implementer family: Claude (subagents). Reviewer family: codex (different
family; no exception needed).

| Phase | Batches | Review |
| --- | --- | --- |
| P1 foundation | 1-9 | code-logic (codex) + style (new public API: CLI JSON schema 1.0 / `keptLocalEdit`, `MirrorSources`/plugin-loader options, coalescer contract) |
| P2 wizard and packs | 10-18 | code-logic (codex) + style (new RPC `wizard:plan-pack-install`) + Electron visual review (dark + light, narrow ~400px) of the wizard preview, sidebar dialog, pack prompt and completion against `prototype/` |
| P3 Library and Marketplace | 19-25 | code-logic (codex) + style (new RPCs `plugins:replace-kept-items`, `plugins:resolve-config-home`) + Electron visual review (dark + light, narrow) incl. the F7i notice states and the F6 pointer (D15) against `prototype/` |
| P4 rubric | 26 | code-logic (codex) |

P1 review result: `reviews/p1-code-logic-review-a.md` (4/10 REVISE), `reviews/p1-code-logic-review-b.md`
(5/10 REVISE), `reviews/p1-code-style-review.md` (6/10 REVISE). P1 fix round (S1, S2, A1-A4, B1-B3,
CLI B3 D25, follow-ups D24) — COMPLETE (commit: 16042c885). Verified by the combined session-5
verify (72/73; only the accepted D21 agent-sdk lint). Minor recorded, not fixed:
`apps/ptah-electron/src/di/container.smoke.spec.ts:508` exact-text assertion; Claude-target removals
still delete an owned copy without move-aside. The one re-review scoped to the fix commit is still
due (codex, different family).

P1 re-review (scoped to 16042c885, codex, different family) — DONE:
`reviews/p1-code-logic-review-a-rereview.md` APPROVED (A1-A4 fixed);
`reviews/p1-code-style-review-rereview.md` APPROVED (S1, S2 fixed);
`reviews/p1-code-logic-review-b-rereview.md` REVISE (B2 partial: ambiguity judged only over enabled
pass roots). One bounded B2 correction (`reports/p1-b2-correction-report.md`: ambiguity now counts
every installed plugin from the descriptors, disabled included) — `reviews/p1-b2-correction-review.md`
APPROVED (commit: eae561cf6). Minor recorded, not fixed: ambiguity is logged only (no
`ReconcileResult` counter / UI). Recorded as D28. **P1 phase: CLOSED.**

Phase-end host keep-alive (team-leader, before requesting the review):
`npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`.

Batches that need no review of their own (types, tests or docs only): Batch 1. No batch has a
per-batch review; Batch 1 is still inside the P1 combined diff.

---

## Batch 1: Shared contracts (B1) — COMPLETE (commit: 2596f6fc4)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents as authors (decisions.md D2)
- Review family: codex (different from implementer)
- Rationale: one lib of new types and pure fixtures; every later batch imports them.
- Tasks: 1 | Depends on: none
- Phase: P1 | Phase review: covered by P1 code-logic; this batch is types/tests only (no review of its own)

### Task 1.1: Shared DTOs, provenance labels, sidecar fields, message type, agreement fixtures — COMPLETE

- Files (root `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/`):
  - CREATE `libs/shared/src/lib/types/rpc/rpc-setup-decisions.types.ts`
  - CREATE `libs/shared/src/lib/types/library-provenance.ts` + `library-provenance.spec.ts`
  - CREATE `libs/shared/src/testing/fixtures/library-agreement.ts`
  - MODIFY `libs/shared/src/testing/index.ts` (+ `index.spec.ts` export case)
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`, `wizard/phase.ts`,
    `rpc/rpc-skill-clone.types.ts`, `origin-sidecar.types.ts`, `rpc/rpc-plugin-marketplace.types.ts`,
    `rpc/rpc-misc.types.ts`, `rpc.types.ts` (DTO/result types only, NO registry entries),
    `messages/message-constants.ts`, `messages/payload-map.ts`, the index barrels that export them,
    `rpc/rpc-setup-generation.contract.spec.ts`
- Plan reference: implementation-plan.md:236-331
- Pattern to follow: `libs/shared/src/testing/fixtures/dashboard-spec.ts` (pure fixture); existing optional fields in `rpc-setup.types.ts`
- Quality requirements: all new fields optional; no `any`; exact design-spec section 5 strings in `provenanceLabel`/`divergedReasonText`/`orphanedText`; fixture file imports only shared types (no Angular, no Playwright).
- Validation notes: TL4 — do NOT touch `harness-sync.types.ts` (no `expectedDigest`, no `'changed-since-approval'`; Batch 7 owns them) and do NOT rename `overwrittenLocalEdit` (Batch 2). No `rpc.types.ts` method-map or true-map entries (A33). `host-source-registry.contract.spec.ts` must stay green with no baseline change. If extending the outcome union breaks a consumer's exhaustive map, report it (do not edit outside the list).
- Implementation details: decisions/target/model/outcome/pack-plan types in the new decisions file re-exported where `rpc-setup.types.ts` is; `CloneSummary` provenance fields + `scopeRoot`; sidecar `sourceRef`/`sourceLabel` optional Zod; marketplace `ExternalLocalItem`/`KeptItem`/replace-kept-items/config-home DTOs; `PluginInfo` counts/names; `MESSAGE_TYPES.LIBRARY_CHANGED = 'library:changed'` with payload `{workspaceRoot, status, reasons}`; the 8 agreement fixtures listed in plan :320-325.

### Batch 1 verification

- Every listed artifact exists with real content; library-provenance spec covers every variant; origin-sidecar parse case with and without new fields; testing index exports the fixtures
- `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/setup-wizard,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` passes (output tailed)
- No per-batch review; P1 code-logic review covers it
- Edge cases: older sidecars parse unchanged

### Batch 1 outcome

- Verified on disk by team-leader: 5 new files, 12 modified shared files; no stubs, no `any`.
  Extra file `libs/shared/src/lib/types/origin-sidecar.types.spec.ts` accepted (it carries the
  required "parse with and without new fields" case).
- `wizard/phase.ts` intentionally unchanged: the outcome-union widening is deferred (D18,
  report D-B1-1). Carried by Task 12.1 and Task 17.1 below.
- Verify (D19): 71 tasks, 70 pass; only `ptah-extension-webview:lint` fails, identical on `main`
  (pre-existing circular dependency), accepted for every batch.
- Report: reports/batch-1-report.md

## Batch 2: D11 rename and D16 schema bump (B16) — COMPLETE (commit: b0f9d3402)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: D11 requires the field rename and every consumer in one batch so nothing is half-renamed; D16 adds the schema bump to the same batch. Mechanical, many files (TL10).
- Tasks: 2 | Depends on: Batch 1
- Phase: P1 | Phase review: P1 code-logic + style (breaking CLI JSON change)

### Task 2.1: Rename `overwrittenLocalEdit` → `keptLocalEdit: string[]` in the type and every consumer — COMPLETE

- Files (all MODIFY, root as above):
  - shared: `libs/shared/src/lib/types/harness-sync.types.ts`, `harness-sync.types.spec.ts`, `harness-sync.blocked.spec.ts`, `capability-id-codec.spec.ts`
  - harness-sync `libs/backend/harness-sync/src/lib/`: `health/harness-health.ts`; `targets/claude-target.ts`, `targets/harness-target.port.ts`, `targets/workspace-target.ts`, `targets/mcp/mcp-facet-planner.ts`; `reconciler/harness-reconciler.service.ts`; specs `targets/rival-targets.agent-model.spec.ts`, `targets/workspace-target.overwrite-detach.spec.ts`, `reconciler/harness-reconciler.{cancellation,capability-policy,foreign-edits,idempotency-removal,local-edit-report,manifest-recovery,verify-agreement,write-failure}.spec.ts`
  - rpc-handlers: `libs/backend/rpc-handlers/src/lib/harness/health/harness-health-rpc.service.spec.ts`
  - marketplace `libs/frontend/marketplace/src/lib/`: `data/attention.ts`, `data/attention.spec.ts`, `data/coverage.spec.ts`, `harness/harness-health.model.ts`, `harness/harness-target-row.component.ts`, `harness/harness-blocked-paths.spec.ts`, `harness/harness-health-badge.component.spec.ts`, `harness/harness-health.store.spec.ts`, `harness/harness-repair-dialog.spec.ts`, `pages/overview/overview-kpis.spec.ts`, `pages/overview/overview-page.component.spec.ts`, `pages/skills/skill-detail.component.spec.ts`
  - skill-synthesis-ui `libs/frontend/skill-synthesis-ui/src/lib/components/clones/`: `agent-sync-chips.spec.ts`, `reconcile-guard.spec.ts`, `skill-clones-view.component.spec.ts`
  - webview-e2e-harness: `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts`
  - ptah-cli: `apps/ptah-cli/src/cli/output/formatter.ts` (`:156-168,483,521`), `formatter.spec.ts`, `apps/ptah-cli/src/cli/commands/harness.spec.ts`
- Plan reference: implementation-plan.md:1103-1158; decisions.md D11
- Pattern to follow: existing field usages at each site
- Quality requirements: field rename only — the meaning change (kept instead of overwritten) is Batch 6. UI copy that says "overwritten" for this list is updated to the kept meaning only where the plan's B16 section says so; otherwise leave behaviour.
- Validation notes: before and after, repo search `overwrittenLocalEdit` excluding `.ptah/specs` and `node_modules`; after = 0 hits. Any hit outside the list is reported and added only if needed to compile.
- Implementation details: rename in the shared type, producers, formatter output key and every spec/fixture assertion.

### Task 2.2: Bump `JSONRPC_SCHEMA_VERSION` to `1.0` and update docs (D16) — COMPLETE

- Depends on: Task 2.1
- Files (MODIFY): `apps/ptah-cli/src/cli/jsonrpc/types.ts` (`:32` `'0.2'` → `'1.0'`); `apps/ptah-cli/docs/jsonrpc-schema.md` (section 1.5 field rename; `schema_version`/`schemaVersion` examples at `:66,527,539`; the versioning note at `:69`); `.claude/skills/ptah-cli-usage/references/jsonrpc.md` (`:4,73,111,141`), `.claude/skills/ptah-cli-usage/references/mcp-serve.md` (`:170`); the identical copies under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/` (`jsonrpc.md`, `mcp-serve.md`)
- Plan reference: decisions.md D16; implementation-plan.md:1103-1158; implementation-plan-review.md "A34 assessment"
- Pattern to follow: the existing `0.2` paragraph in `jsonrpc-schema.md:69`
- Quality requirements: keep the JSON-RPC wire version `"jsonrpc": "2.0"` and `protocol_version: "2.0"` unchanged. Do not touch the CLI package `version` examples (`0.1.5`, `0.2.32`). Specs compare against the constant (`session-describe.builder.spec.ts`, `mcp-serve.spec.ts`, `interact.spec.ts`) and need no literal change; confirm no literal `'0.2'` schema assertion remains.
- Validation notes: breaking-change note states `1.0` is a MAJOR bump for the D11 rename (`harness.*` results: `overwrittenLocalEdit` removed, `keptLocalEdit` added with kept semantics) and that a host advertising `PTAH_HOST_SCHEMA_VERSION=0.2` gets the non-fatal skew warning (`apps/ptah-cli/src/main.ts:140-154`).
- Implementation details: one constant, three doc examples, one note, four skill-reference sites per copy.

### Batch 2 verification

- `overwrittenLocalEdit` search = 0 outside `.ptah/specs`; `JSONRPC_SCHEMA_VERSION = '1.0'`; doc examples and note updated in all three doc locations; wire `2.0` untouched
- `npm run verify -- -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/rpc-handlers,@ptah-extension/marketplace,@ptah-extension/skill-synthesis-ui,@ptah-extension/webview-e2e-harness,@ptah-extension/cli-engine,ptah-cli,ptah-electron,ptah-extension-vscode,ptah-extension-webview` passes
- No per-batch review; P1 review covers it

### Batch 2 outcome

- Verified on disk by team-leader: 48 modified files (40 rename sites, constant, 5 docs, plus
  batches.md/decisions.md); `overwrittenLocalEdit` appears only in the two intentional
  breaking-change notes in `apps/ptah-cli/docs/jsonrpc-schema.md:71,201`; constant is `'1.0'`;
  wire `2.0` unchanged.
- Verify re-run by team-leader: 78 tasks, 77 pass (75 cached); only `ptah-extension-webview:lint`
  fails (D19, pre-existing). `harness-sync:test` passes after the D20 marker move.
- Carried to Task 6.1: the doc comment at `libs/shared/src/lib/types/harness-sync.types.ts:146`
  still says "overwritten (source wins)"; Batch 6 changes the behaviour and must update it, and
  the `{@link keptLocalEdit}` wording near `:178`.
- Report: reports/batch-2-report.md

## Batch 3: Plugin loader harness-root config home (B15) — COMPLETE (commit: e7a2be488)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: D14 data-safety core; isolated in agent-sdk with opt-in options, so hosts compile unchanged.
- Tasks: 1 | Depends on: Batch 1
- Phase: P1 | Phase review: P1 code-logic + style

### Task 3.1: `PluginConfigHome`, storage routing, descriptors, plugin contents — COMPLETE

- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts` (+ spec); MODIFY `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts` (+ spec); MODIFY `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.spec.ts` (agreement case only)
- Plan reference: implementation-plan.md:971-1102; decisions.md D14
- Pattern to follow: `plugin-loader.service.ts:791-830` (`storageFor`, `canonicalRootKey`); `capability-resolver.service.ts:280-305`
- Quality requirements: home active only when workspace storage is workspace-scoped AND both options given; otherwise identical behaviour. No agent-sdk → harness-sync import (`harnessRootOf` injected). Legacy folder records never written or deleted. No union of lists.
- Validation notes (A-info, A-session, A-global-sync): locate every `skillCount` site with `ptah_code_search_symbols`; prove A-session with the `repo/a` save / `repo/b` read agreement case; check global state storage write semantics. Verification matrix required: sole legacy + empty home; intentional empty config counts as present; `repo/a` and `repo/b` open at once with conflicting lists → conflict, latest `lastUpdated` governs (tie → lowest folder key); adopt (no union); dismiss; save during conflict; concurrent save during import; import and save write failures; idempotent import; open/close home or open root does not move the home; malformed home record → strict read `error`.
- Implementation details: `initialize(..., options?)`; `storageFor` maps to `R = harnessRootOf(...)` and returns the single-key home view; `getConfigHomeStatus`, `adoptFolderConfig`, `dismissFolderConfig`, per-key promise chain; `getPluginSourceDescriptors()`; `PluginInfo` `agentCount`/`skillNames`/`agentNames`/`commandNames`.

### Batch 3 verification

- Files exist; every matrix case above is a named spec case
- `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review

### Batch 3 outcome

- Verified on disk by team-leader: 2 new files (`plugin-config-home.ts` 692 lines, spec 232),
  3 modified (`plugin-loader.service.ts`, its spec, the cli-agent-runtime agreement case). No
  stubs, no `any`; the moved helpers (`countPluginCommands`, `normalizeStoredConfig`, private
  `canonicalRootKey`) have no remaining callers. Every D14 matrix item maps to a named spec case
  (report table). No agent-sdk → harness-sync import (`harnessRootOf` injected).
- Verify (D21, combined with Batch 4, re-run by team-leader): 64 tasks, 63 pass (61 cached);
  only `@ptah-extension/agent-sdk:lint` fails, on 2 `no-unexpected-multiline` errors in
  `session-query-executor.accounts.spec.ts:174,183`, a file identical to `main` (pre-existing).
  `eslint` on the four Batch 3 agent-sdk files: 0 errors.
- Carried forward: `PluginLoaderInitOptions` / `PluginSourceDescriptor` are not re-exported from
  the agent-sdk barrel; Batch 9 (host wiring of config-home options) adds the export if a host
  needs the named type.
- Report: reports/batch-3-report.md

## Batch 4: Wizard agent-origin store (B4) — COMPLETE (commit: 20fd5a2a8)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: small agent-generation service with its DI token; owner of the lib's DI files.
- Tasks: 1 | Depends on: Batch 1
- Phase: P1 | Phase review: P1 code-logic

### Task 4.1: `WizardAgentOriginStore` + `AGENT_ORIGIN_STORE` token — COMPLETE

- Files: CREATE `libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.ts` (+ spec); MODIFY `libs/backend/agent-generation/src/lib/di/tokens.ts`, `libs/backend/agent-generation/src/lib/di/register.ts`, `libs/backend/agent-generation/src/index.ts`
- Plan reference: implementation-plan.md:384-410
- Pattern to follow: `managed-manifest.ts:177-203` (atomic tmp+rename); `tokens.ts:4-18` (`Symbol.for`); `user-layer/source-hash.ts:69-75`
- Quality requirements: Zod-validated `{version:1, agents}`; corrupt/missing = empty with warn; hash via `computeSourceHash`; failed `recordWritten` logged, non-fatal.
- Validation notes: A33 — the token is registered here; resolution is proven later through `WizardGenerationRpcHandlers` (Batch 11). Host guard specs (container.smoke, expected-resolvable, surface-composition) must stay green; if one fails, update it in this batch and report it.
- Implementation details: `recordWritten`, `forget`, `read`; spec compares the store hash with the mirror's `pendingSourceHash` for the same bytes.

### Batch 4 verification

- `npm run verify -- -p @ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review

### Batch 4 outcome

- Verified on disk by team-leader: `wizard-agent-origin.store.ts` (225 lines) + spec (12
  tests); `AGENT_ORIGIN_STORE = Symbol.for('WizardAgentOriginStore')` in `tokens.ts` and the
  token map; `register.ts` registers it `useClass` + `Lifecycle.Singleton` (needed for the
  per-path write serialization); barrel exports the class and the two types. Zod-validated
  `{version:1, agents}`, missing = `{}` silently, corrupt/unreadable = `{}` with warn,
  `recordWritten`/`forget` non-fatal `Promise<boolean>`. No stubs, no `any`.
- Accepted deviation: atomic write via harness-sync `atomicWriteWithRetry` instead of the FS
  port (the port has no rename); same helper as the cited `managed-manifest.ts` pattern.
- Verify (D21): the report's host failures came from Batch 3's in-progress file and are
  superseded by the combined run (64 tasks, 63 pass; only the pre-existing agent-sdk lint).
  Host guard specs (container.smoke, expected-resolvable, surface-composition) pass unedited.
- Report: reports/batch-4-report.md

## Batch 5: User-layer mirror library work (B10 library part) — COMPLETE (commit: a23b72e5a)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: library-side mirror capability; host wiring follows in Batch 9 (TL6). New `MirrorSources` fields are optional so hosts compile unchanged.
- Tasks: 1 | Depends on: Batches 1, 3, 4
- Phase: P1 | Phase review: P1 code-logic + style

### Task 5.1: Plugin-agent mirroring, clone edit state, source identity, skills.sh doc — COMPLETE

- Files: CREATE `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts` (+ spec), `user-layer-clone-state.ts` (+ spec), `user-layer-mirror.service.plugin-agents.spec.ts` (same folder); MODIFY `user-layer-mirror.service.ts`, `user-layer-reap.spec.ts` (the plan's `user-layer-mirror.service.reap.spec.ts` does not exist), sidecar writers found by A-sidecar inside `user-layer/`, `libs/backend/agent-generation/src/index.ts`; MODIFY `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.ts` (doc block `:35-42` only)
- Plan reference: implementation-plan.md:646-704
- Pattern to follow: `user-layer-mirror.service.ts:363-405,2156-2233` (create-if-absent, `recordConflict`, `reconcileFileClone`)
- Quality requirements: plugin agents mirrored whenever `libraryScopeRoot` is set, independent of consent; rival fan-out stays gated (`harness-manifest.builder.ts:567-574` untouched); per-file errors counted, never thrown.
- Validation notes: A-sidecar (every sidecar write carries `sourceRef`/`sourceLabel` forward), A-reap (vanished skills.sh root reaped like a harness root). Required spec cases: fresh workspace with no consent and with sync explicitly disabled → plugin agents are clones and `buildAgents` still returns `[]`; workspace collision; two-plugin collision; edited clone diverges on update; orphan keeps `sourceLabel`; two external plugins with one basename.
- Implementation details: `MirrorSources.libraryScopeRoot?`, `pluginDescriptors?`; `mirrorAll`/`reconcile` delegate one line each; `readCloneEditState(kind, slug, scopeRoot)` with `contentDigest` exposed through the mirror facade.

### Batch 5 verification

- `npm run verify -- -p @ptah-extension/agent-generation,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review

### Batch 5 outcome

- Verified on disk by team-leader: `user-layer-plugin-agents.ts`, `user-layer-clone-state.ts`
  (+ specs) and `user-layer-mirror.service.plugin-agents.spec.ts` created;
  `MirrorSources.libraryScopeRoot?`/`pluginDescriptors?`, one `pluginAgentPass` delegate in
  `mirrorAll`/`reconcile`, facade `readCloneEditState`; ownership by `pluginId` + `sourceRef`;
  fresh sidecars go through `newSourcedSidecar`; the reap spec covers a vanished skills.sh
  root. The `skills-sh-source-root.ts` change is the doc block only. No stubs, no `any`.
- D22 confirmed: the final spec builds its workspace inside the mocked `homedir()` with a
  `.git` marker and asserts `resolveHarnessWorkspaceRoot(workspace) === workspace`
  (`user-layer-mirror.service.plugin-agents.spec.ts:82-85`).
- Accepted decisions: legacy seed keyed on "no workspace clone" instead of "dir absent";
  the seed quarantine knows plugin-owned slugs; the reap walks `libraryScopeRoot` when agent
  sync is off; a relative `libraryScopeRoot` is refused and counted. All within the intent
  of plan :646-704.
- Verify: orchestrator combined run (8 projects, 70 tasks, 70 succeeded, exit 0).
- Report: reports/batch-5-report.md

## Batch 6: Harness keep policy for edited managed copies (B9 part 1) — COMPLETE (commit: a621f0323)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: the D8 semantic change in the planners, health and reconciler, after Batch 2 renamed the field (TL5).
- Tasks: 1 | Depends on: Batch 2
- Phase: P1 | Phase review: P1 code-logic

### Task 6.1: Plan edited managed copies as kept; remove the dead overwrite branch — COMPLETE

- Files (MODIFY, `libs/backend/harness-sync/src/lib/`): `targets/claude-target.ts`, `targets/workspace-target.ts`, `targets/harness-target.port.ts`, `targets/mcp/mcp-facet-planner.ts`, `health/harness-health.ts`, `reconciler/harness-reconciler.service.ts`; specs `reconciler/harness-reconciler.local-edit-report.spec.ts`, `reconciler/harness-reconciler.foreign-edits.spec.ts`, `targets/workspace-target.overwrite-detach.spec.ts` and any other reconciler/target spec whose assertion encodes the old overwrite
- Plan reference: implementation-plan.md:583-600,625-645; decisions.md D8
- Pattern to follow: `claude-target.ts:515-520`, `workspace-target.ts:530-539`
- Quality requirements: edited copy byte-identical and listed in `keptLocalEdit` and `localEdit`; manifest keeps the old hash so later passes are stable; unmodified managed file still replaced.
- Validation notes: A-retire — check `detachForOverwrite` callers with `ptah_lsp_references` before deleting `claude-target.ts:376-383` / `workspace-target.ts:925-973`.
- Implementation details: `actual !== null && actual !== owned.hash` → kept, not a write.

### Batch 6 verification

- `npm run verify -- -p @ptah-extension/harness-sync,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review

### Batch 6 outcome

- Verified on disk by team-leader: `planEntry` returns `'kept'` when
  `actual !== null && actual !== owned.hash` (`claude-target.ts:528`); kept paths skip the
  write and keep the manifest entry from `baseEntries`; `HarnessPlan.keptLocalEdit` is
  required; the MCP facet checks the edit before the source change; health reads kept paths
  off the plan; the shared `keptLocalEdit`/`localEdit` docs describe D8.
- Accepted deviation (B6-1): `detachForOverwrite` is kept as the apply-time race guard and
  now restores a found edit instead of overwriting it. A-retire did not hold (it is the only
  defence against a save landing between plan and apply), and D8 requires that edit to
  survive, so keeping it follows the plan's intent rather than redesigning it. The P1
  code-logic review should examine `restoreDetachedEdit` (hard link / rename back, never
  replaces a newer save).
- Out of batch, now assigned: the marketplace wording `attention.ts:165` ("local edits
  replaced") and the `harness-target-row.component.ts:130,142` testid
  `harness-target-overwritten` are added to Task 7.1 (Batch 7 already edits marketplace
  repair-outcome consumers and verifies marketplace).
- Verify: orchestrator combined run (70/70, exit 0); the Batch 8 report's host failure was
  this batch in progress and is superseded.
- Report: reports/batch-6-report.md

## Batch 7: Destination scanner and digest-checked repair (B9 part 2) — COMPLETE (commit: 4809d01fe)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: approval-digest safety (A21) plus the shared outcome member and its consumers in one place (TL4).
- Tasks: 1 | Depends on: Batch 6
- Phase: P1 | Phase review: P1 code-logic

### Task 7.1: `HarnessDestinationScanner`, `expectedDigest` repair, outcome `changed-since-approval` — COMPLETE

- Files: MODIFY `libs/shared/src/lib/types/harness-sync.types.ts` (`HarnessRepairBlockedPath.expectedDigest?`, outcome `'changed-since-approval'`); CREATE `libs/backend/harness-sync/src/lib/health/harness-destination-scanner.ts` (+ spec); MODIFY `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts` (+ spec), `libs/backend/harness-sync/src/lib/di/register.ts`, `di/tokens.ts`, `libs/backend/harness-sync/src/index.ts`; MODIFY `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts` (strip client `expectedDigest`, A30); marketplace consumers of the repair outcome found by A-outcome (render "Kept: changed since approval"); MODIFY the marketplace wording left over from
  Batch 6 / D8: `libs/frontend/marketplace/src/lib/data/attention.ts:165` labels
  `keptLocalEdit` "local edits replaced" (change to kept wording, + `attention.spec.ts`), and
  `harness/harness-target-row.component.ts:130,142` testid `harness-target-overwritten`
  (rename to a kept testid; update any spec or e2e selector that reads it)
- Plan reference: implementation-plan.md:583-645 (scanner, repair); A21, A30
- Pattern to follow: `blocked-repair.service.ts:199-229` (`moveOccupants` under the workspace lock); `content-hash.ts:126-136,299-320`
- Quality requirements: scanner read-only and never throws; digest is the current content digest (`hashFile`/`hashDir`), never the manifest hash; re-digest under the lock before `moveToQuarantine`; quarantine/restore unchanged.
- Validation notes: A-paths (derive relPath per target like `harnessAgentRelPath`, no duplicated layout strings); A-outcome (find consumers with `ptah_lsp_references`). Spec cases: kept-local-edit path without digest refused; matching digest repaired; edited A → B before repair → `changed-since-approval`; deleted, recreated, now-unreadable → `changed-since-approval`; scanner rival-CLI fixture, directory digest, unreadable. Host guard specs must stay green (A33); update in this batch if the scanner token trips one.
- Implementation details: `scan(harnessRoot, items)` → per target `{target, relPath, state, digest}`; `repair` accepts `blocked ∪ keptLocalEdit` from a fresh verify.

### Batch 7 verification

- `npm run verify -- -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/rpc-handlers,@ptah-extension/marketplace,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-extension-webview` passes
- No per-batch review

### Batch 7 outcome

- Verified on disk by team-leader: `harness-destination-scanner.ts` (276 lines, + 350-line
  spec) is real; `blocked-repair.service.ts` re-digests with `probeDestination` under the
  lock before the move and returns `changed-since-approval` on mismatch; a kept local edit
  without a digest is refused `not-blocked`; `harness-rpc.schema.ts` accepts and drops a
  client `expectedDigest` via `.transform` while staying `.strict()` (A30). Marketplace:
  `attention.ts` "local edits kept", testid `harness-target-kept` (no stale
  `harness-target-overwritten` selector left), repair dialog renders the new outcome.
- Accepted deviation: `libs/shared/src/lib/types/harness-blocked-wording.ts` (same project,
  outside the list) adds `HARNESS_REPAIR_REASONS.changedSinceApproval` and the dialog
  sentence "Kept: changed since approval. ..." to the approved-prose allowlist. It matches
  implementation-plan.md:644 and design-spec.md:76 ("Kept: changed since approval"), uses no
  destructive verb, and is required by the wording guard spec.
- Verify: 72/73; the one failure is `ptah-extension-webview:lint`, the accepted pre-existing
  D19 circular dependency (webview <-> command-center), no Batch 7 file involved.
  Degradation audit exit 0 (harness-sync 6 = baseline, rpc-handlers 1 = baseline).
- Report: reports/batch-7-report.md

## Batch 8: Electron coalescer per-batch outcome (B11 part 1, A24) — COMPLETE (commit: f083b037d)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: self-contained contract change; existing callers ignore the result, so it compiles alone (TL5).
- Tasks: 1 | Depends on: none in code (P1 order)
- Phase: P1 | Phase review: P1 code-logic

### Task 8.1: `createCoalescedJob<TPayload, TResult>` returns `CoalescedOutcome` per batch — COMPLETE

- Files: MODIFY `apps/ptah-electron/src/activation/coalesced-job.ts` + `coalesced-job.spec.ts`
- Plan reference: implementation-plan.md:705-722,740-745
- Pattern to follow: `coalesced-job.ts:152-275`
- Quality requirements: `ran` for every request merged into an admitted batch whose run resolved; admission skip → `skipped` for that batch only; throw → `threw` and still `onError`; a request during a running pass joins the next batch and gets that outcome. Remove the per-root map.
- Validation notes: spec cases: success → `ran`; success then skipped batch → second request `skipped`; overlapping pass; merged requests share one outcome; throw.
- Implementation details: `request` returns `Promise<CoalescedOutcome<TResult>>`.

### Batch 8 verification

- `npm run verify -- -p ptah-electron` passes
- No per-batch review

### Batch 8 outcome

- Verified on disk by team-leader: `CoalescedOutcome<TResult>` (`ran`/`skipped`/`threw`)
  settles on each batch's own promise; admission skip gives `skipped`; a throw goes to
  `onError` and gives `threw`; `TResult = void` by default. Spec: 22 cases (5 new
  per-batch outcome cases).
- Accepted deviation: `plugin-activation.ts` `refreshUserLayer()` gained
  `.then(() => undefined)` because it returned `request(...)` directly (the TL5 assumption
  was wrong for this caller). Task 9.2 replaces that line with the `UserLayerPassOutcome`
  mapping. "Remove the per-root map": no such map existed, so nothing was removed.
- Verify: orchestrator combined run (70/70, exit 0).
- Report: reports/batch-8-report.md

## Batch 8b: D23 degradation-audit fix (agent-generation ratchet) — COMPLETE (commit: 7c87ccd37)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: decisions.md D23. Batch 4's `wizard-agent-origin.store.ts` is owned by no later
  batch, so this is a dedicated one-file fix. It is file-disjoint from Batch 7 and can run in
  parallel with it.
- Tasks: 1 | Depends on: Batch 4
- Phase: P1 | Phase review: covered by the P1 code-logic review

### Task 8b.1: Attach or remove the unattached suppression in `WizardAgentOriginStore.read` — COMPLETE

- File: `libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.ts` (+ its
  spec only if behaviour changes)
- Plan reference: decisions.md D23; `tools/degradation-audit/check-degradation.ts:30-60,100-108`
  (marker grammar `// degradation-audit: optional-capability|reported - <reason>` and the
  zones in which a marker attaches to a `catch` clause)
- Pattern to follow: an attached marker elsewhere in agent-generation that the audit counts
  as suppressed (Grep `degradation-audit:`)
- Quality requirements: the audit reports `libs/backend/agent-generation` at or below its
  baseline (1) with no `orphaned-suppression`. Do not edit `baseline.json`. The catch at
  `:88` keeps its behaviour (ENOENT gives `{}` silently; other errors warn and give `{}`).
- Validation notes: the `:92` marker sits inside the catch after the `if`, outside every
  attach zone, so it is orphaned and `:88` is flagged as catch-return-sentinel. Move the
  marker into a zone the audit reads, or restructure so the audit accepts the reporting.
- Implementation details: one catch site; no API change.

### Batch 8b verification

- `node scripts/verify.mjs --exec --task degradation-audit -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  reports `libs/backend/agent-generation` ok and no orphaned marker in agent-generation
- `npm run verify -- -p @ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review

### Batch 8b outcome

- Verified on disk by team-leader: the first `catch` marker in `WizardAgentOriginStore.read`
  now opens the catch body (attach zone 2) and covers both returns; behaviour unchanged
  (ENOENT silent `{}`, other errors warn and `{}`). Batch 7's prettier pass rewrapped the two
  `logger.warn` calls in this file (formatting only), committed with this batch.
- Verify: degradation audit `libs/backend/agent-generation: 1 ok (baseline 1)`, no orphaned
  marker in agent-generation; team-leader host run
  `npm run verify -- -p @ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli`
  58/58 succeeded (56 cached), exit 0.
- Out of scope: the orphaned marker at
  `libs/backend/agent-sdk/src/lib/session-importer.service.ts:993` is identical on `main`
  (last touched by e3965c65c); not this task's. The audit still passes.
- Report: reports/batch-8b-report.md

## Batch 9: Refresher port, propagation report, Electron pass + `library:changed`, host wiring (B9 part 3 + B11 + B10 hosts) — COMPLETE (commit: a96d12d50)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: the port return change compiles only with all three host adapters (plan :621-623); the same host files carry B10's wiring and B11's config-home options (TL6, TL10).
- Tasks: 3 | Depends on: Batches 3, 5, 7, 8, 8b
- Phase: P1 (last) | Phase review: P1 code-logic + style — due after this batch commits

### Task 9.1: Port status and `propagateWithReport` (harness-sync) — COMPLETE

- Files: MODIFY `libs/backend/harness-sync/src/lib/sources/user-layer-refresher.port.ts`, `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts` (+ `harness-propagation.service.spec.ts`), `libs/backend/harness-sync/src/lib/di/register.ts` (`NO_USER_LAYER_REFRESH` → `'skipped'`), `libs/backend/harness-sync/src/index.ts`
- Plan reference: implementation-plan.md:612-615
- Pattern to follow: `harness-propagation.service.ts:93-142`; `register.ts:194-205`
- Quality requirements: `refresh(): Promise<'refreshed' | 'failed' | 'skipped'>`; `propagate` delegates and returns `.health`; propagation never throws; `refreshUserLayerInBackground` logs failures.
- Validation notes: spec covers each report status.
- Implementation details: `propagateWithReport(cwd, reason, options) → {health, userLayer}`.

### Task 9.2: Electron pass outcome, broadcaster, config-home options, mirror sources — COMPLETE

- Depends on: Task 9.1
- Files: MODIFY `apps/ptah-electron/src/activation/plugin-activation.ts` (+ `plugin-activation.spec.ts`); CREATE `apps/ptah-electron/src/activation/library-change-broadcaster.ts` (+ spec); MODIFY `apps/ptah-electron/src/di/phase-2-libraries.ts` (comment/spec case only)
- Plan reference: implementation-plan.md:705-751, 646-704 (host wiring), 971-1102 (options)
- Pattern to follow: `boot-readiness-broadcaster.ts:40-67` (lazy WEBVIEW_MANAGER)
- Quality requirements: pass steps keep swallowing errors and return `'ok' | 'failed' | 'skipped'`; `runUserLayerPass` aggregates and broadcasts `LIBRARY_CHANGED` with `resolveHarnessWorkspaceRoot(workspaceRoot)`; refresher maps outcomes; `initialize` gets `{harnessRootOf, homeStorage: STATE_STORAGE}`; mirror-source config reads pass the harness root; mirror sources include `libraryScopeRoot`, `pluginDescriptors` and `discoverSkillsShPluginPaths()` roots.
- Validation notes: A-disabled (skills.sh roots filtered by `disabledPluginIds` like harness roots). Spec cases: step failure → refresher `failed` + broadcast `failed`; success → `updated`; no WEBVIEW_MANAGER → no throw; phase-2 reader: sub-folder opened, harness root unregistered → harness-root home config. Electron `container.smoke.spec.ts` unchanged (no new DI token).
- Implementation details: `refreshUserLayer` returns `Promise<UserLayerPassOutcome>` via the Batch 8 coalescer, replacing Batch 8's interim `.then(() => undefined)` in `refreshUserLayer()` (`plugin-activation.ts:532-534`).

### Task 9.3: VS Code and CLI refresher adapters and mirror sources — COMPLETE

- Depends on: Task 9.1
- Files: MODIFY `apps/ptah-extension-vscode/src/activation/plugin-activation.ts`, `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts`
- Plan reference: implementation-plan.md:733-739, 670-675
- Pattern to follow: the current refresher at VS Code `plugin-activation.ts:212-215`, CLI `harness-boot.ts:98`
- Quality requirements: return `refreshed`/`failed` from their own try/catch; never broadcast; no config-home options (single storage answers every root); add `libraryScopeRoot`, descriptors and skills.sh roots to mirror sources. No VS Code feature work beyond compiling (D3, Electron first).
- Validation notes: A-disabled as in 9.2.
- Implementation details: adapter return values only plus the mirror-source fields.

### Batch 9 verification

- `npm run verify -- -p @ptah-extension/harness-sync,@ptah-extension/agent-sdk,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- Then phase-end keep-alive: `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`
- P1 code-logic + style review requested on the combined P1 diff after commit
- Team-leader carry-over (recorded at the Batch 7/8b commit): `PluginLoaderInitOptions` and
  `PluginSourceDescriptor` (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:88,96`)
  are not in the agent-sdk barrel; Task 9.2 adds them as `type` exports to the existing
  `plugin-loader.service` block at `libs/backend/agent-sdk/src/index.ts:422-425`, hence
  `@ptah-extension/agent-sdk` in the first verify command. `MirrorPluginDescriptors` is
  already exported from agent-generation (`index.ts:132`).

### Batch 9 outcome

- Verified on disk by team-leader: port returns `UserLayerRefreshStatus`
  (`NO_USER_LAYER_REFRESH` → `'skipped'`); `propagateWithReport` returns `{health, userLayer}`
  and never throws; `refreshUserLayerInBackground` logs failures; Electron
  `runUserLayerPass` broadcasts `library:changed` through the new lazy, non-throwing
  `library-change-broadcaster.ts`; all three hosts add `libraryScopeRoot`,
  `pluginDescriptors` and skills.sh roots (filtered by `disabledPluginIds`) to mirror
  sources; agent-sdk barrel exports `PluginLoaderInitOptions`, `PluginSourceDescriptor`.
- D14 config-home deviation accepted: `phase-2-libraries.ts` is unchanged, but the
  production path is wired — `boot-heavy-services.ts:193` calls `initPluginLoader`, which
  passes `{harnessRootOf: resolveHarnessWorkspaceRoot, homeStorage: STATE_STORAGE}` to
  `pluginLoader.initialize` (`plugin-activation.ts:277-283`), pinned by
  `plugin-activation.spec.ts:749`. The phase-2 reader case lives in the new
  `phase-2-libraries.config-home.spec.ts`. Reason the file stayed untouched: lint-staged
  rewraps its line 308, which `container.smoke.spec.ts:508` asserts as exact text.
- Out-of-list edits accepted: `wizard-generation.preview-fidelity.spec.ts` (one-line stub
  return, orchestrator-approved), `harness-boot.spec.ts` (mock + status cases).
- Verify (team-leader re-run): command 1 with rpc-handlers 67 tasks, 66 succeeded, only
  `@ptah-extension/agent-sdk:lint` failing on the D21 errors
  (`session-query-executor.accounts.spec.ts:174,183`, confirmed by direct eslint);
  phase-end keep-alive 55/55 succeeded. Degradation audit at/below baselines (executor).
- Carried to the P1 review fix round (Minor, doc-only): stale doc of
  `discoverSkillsShPluginPaths` (`plugin-loader.service.ts:1453-1468`) still says skills.sh
  roots never reach `buildMirrorSources`. Also noted: `container.smoke.spec.ts:508` exact-text
  assertion should become a regex in the next batch that edits `phase-2-libraries.ts`.
- Report: reports/batch-9-report.md

## Batch 10: Guarded writer and orchestrator decisions (B2 + B3) — COMPLETE (commit: 4795f0b44)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: writer signature change and its only caller in one batch (TL3).
- Tasks: 2 | Depends on: Batch 4
- Phase: P2 | Phase review: P2 code-logic + style

### Task 10.1: `writeAgent(agent, guard)`; delete `writeAgentsBatch`/`rollback` (B2) — COMPLETE

- Files: MODIFY `libs/backend/agent-generation/src/lib/services/file-writer.service.ts` (+ spec), `libs/backend/agent-generation/src/lib/interfaces/agent-file-writer.interface.ts`
- Plan reference: implementation-plan.md:332-355; A6, A19
- Pattern to follow: `file-writer.service.ts:211-241`; `hashContent` (`content-hash.ts:121`)
- Quality requirements: ENOENT → absent; other read error → `kept`; equal bytes → `unchanged`; create-only present → `kept`; replace-allowed with mismatched baseline → `changed-since-preview`; write error → `failed`.
- Validation notes: spec cases differs, identical, missing, unreadable (EACCES), create-only present, missing→present, changed hash.
- Implementation details: `AgentWriteGuard` union per plan :336-337.

### Task 10.2: Orchestrator output root, file guards, model resolution (B3) — COMPLETE

- Depends on: Task 10.1
- Files: MODIFY `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts` (+ spec), `libs/backend/agent-generation/src/lib/types/core.types.ts`, `libs/backend/agent-generation/src/index.ts`; CREATE `libs/backend/agent-generation/src/lib/services/agent-model-resolution.ts` (+ spec)
- Plan reference: implementation-plan.md:356-383
- Pattern to follow: `orchestrator.service.ts:790-900,1095-1147`
- Quality requirements: `keep` guard skips render and write (no LLM call) and records `kept`; missing guard = `create-only`; kept/changed-since-preview are not failures in the `successful === 0` check; analysis stays on `workspacePath`.
- Validation notes: spec cases keep skips `generateContent`; outputRoot; all-kept → completed; model resolution workspace/machine/template/none/ignored `gpt-5`.
- Implementation details: `outputRoot?`, `fileGuards?`, `onAgentWritten?` options; pure `resolveClaudeAgentModel` exported.
- D18 note: do NOT widen the shared `GenerationAgentOutcome.status` / `ResumableGenerationAgent.status` here; keep `kept` / `changed-since-preview` inside agent-generation types. The shared widening is Task 12.1.

### Batch 10 verification

- `npm run verify -- -p @ptah-extension/agent-generation,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review
- Result: orchestrator combined verify (agent-generation, rpc-handlers, setup-wizard,
  ptah-electron, ptah-extension-vscode, ptah-cli, ptah-extension-webview): 66/67 passed; the
  one failure is ptah-extension-webview:lint, pre-existing D19 (fails identically on main).
- Report: reports/batch-10-report.md

## Batch 11: Generation preview service and token-bound decisions (B5) — COMPLETE (commit: e62d1dfe8)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: first owner of the wizard handler file (ledger); extraction + token binding.
- Tasks: 1 | Depends on: Batches 4, 5, 10
- Phase: P2 | Phase review: P2 code-logic

### Task 11.1: `GenerationPreviewService` — COMPLETE

- Files: CREATE `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation/generation-preview.service.ts` (+ spec); MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` (+ spec), `wizard-generation-rpc.schema.ts` (+ spec), `wizard-generation-binding.ts`, `wizard-generation.preview-fidelity.spec.ts`, `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
- Plan reference: implementation-plan.md:411-462; A1, A26, R1-5
- Pattern to follow: `register-shared-rpc-handlers.ts:64-76`; `wizard-generation-rpc.handlers.ts:1083-1099,1223-1244`
- Quality requirements: random tokens, per-process HMAC revisions, Zod (≤ 200 agent ids); four rival statuses; harness-root default target; tab-bound non-resume submits keep the mandatory preview; untabbed submits are still token-bound.
- Validation notes: A-dir (subfolder vs flat name). A33: service registered here; `WizardGenerationRpcHandlers` in all three `EXPECTED_RESOLVABLE` lists proves it and `AGENT_ORIGIN_STORE` transitively — run the hosts. Spec cases: stale token + replace → `preview-required`; no token → create-only; replace on unreadable rejected; exists(A) → exists(B) new revision, old rejected; model origins; preview-fidelity stays green.
- Implementation details: move `previewRivals`/`previewAgent`/`previewFile`/`previewSignature`; `validateDecisions` → `{ok, guards}` or `preview-required`.
- D18 note: do NOT widen the shared outcome unions here; Task 12.1 owns it (it is the first batch that edits `wizard-generation-checkpoint.service.ts`).

### Batch 11 verification

- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review
- Result: covered by the combined session-5 verify (72/73; only the accepted D21 agent-sdk lint).
  Host smoke specs needed an `AGENT_ORIGIN_STORE` stub in all three `container.smoke.spec.ts`
  (D27, `reports/host-smoke-fix-report.md`); committed with this batch. Temporary rule until
  Batch 12: below the harness root, submit is create-only and preview paths and the run disagree.

## Batch 12: Run manifest decisions and post-run Library outcome (B6 + B7) — COMPLETE (commit: e55e7c962)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: second owner of the wizard handler; B6 and B7 together keep it to one more hand-off.
- Tasks: 2 | Depends on: Batches 9, 11
- Phase: P2 | Phase review: P2 code-logic

### Task 12.1: Persist guards and target per run; resume/retry (B6) — COMPLETE

- Files: MODIFY `libs/backend/agent-generation/src/lib/types/generation-checkpoint.types.ts`, `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts` (+ spec), `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`, `wizard-generation-run.supervisor.ts` only if `afterSettled` (`:896`) builds the counts
- Plan reference: implementation-plan.md:463-486
- Pattern to follow: `wizard-generation-checkpoint.service.ts:136-178,296-303`
- Quality requirements: options built from the manifest only; `isTrusted` accepts the harness root and rejects siblings; pre-change manifest resumes create-only.
- Validation notes: resume keeps kept files byte-identical; retry never replaces a kept file; edited after confirm → `changed-since-preview`.
- Implementation details: manifest `target?`, `outputRoot?`, `fileGuards?`, new statuses.
- D18 carry-over from Batch 1 (D-B1-1): ADD files `libs/shared/src/lib/types/wizard/phase.ts`,
  `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`,
  `libs/shared/src/lib/types/rpc/rpc-setup-generation.contract.spec.ts`, and a type-only edit of
  `libs/frontend/setup-wizard/src/lib/components/completion.component.ts` (`AgentOutcomeTile`
  status union, ~:28/:416) so setup-wizard keeps compiling. Widen `GenerationAgentOutcome.status`
  to `FileOutcome` and `ResumableGenerationAgent.status` with `kept` and `changed-since-preview`;
  flip `_AgentOutcomeNotYetWidened` to `Equal<GenerationAgentOutcome['status'], FileOutcome>`;
  fix the checkpoint record at `wizard-generation-checkpoint.service.ts:430`. No rendering work in
  the component (Batch 17 owns it).

### Task 12.2: `generation-library-outcome.ts` (B7) — COMPLETE

- Depends on: Task 12.1
- Files: CREATE `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation/generation-library-outcome.ts` (+ spec); MODIFY `wizard-generation-rpc.handlers.ts`
- Plan reference: implementation-plan.md:487-505
- Pattern to follow: pure functions, no DI
- Quality requirements: `libraryPass` from `propagateWithReport`; diverged list only for `written` agents whose clone diverged AND `pendingSourceHash` equals B4's hash; read failure omits the agent with a warn.
- Validation notes: failed refresher after writes → outcomes intact + `failed`; skipped batch → `not-applicable` even after a prior success; kept agent never listed; opened-folder → `not-applicable`.
- Implementation details: fill counts, `libraryPass`, `libraryDiverged`, `target`.

### Batch 12 verification

- `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-generation,@ptah-extension/rpc-handlers,@ptah-extension/setup-wizard,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` passes (D18 widening touches shared and setup-wizard; webview lint failure is pre-existing, D19)
- No per-batch review
- Result: orchestrator combined verify (same 9 projects) `74 tasks: 73 succeeded, 1 failed`; only
  failure is pre-existing D19 `ptah-extension-webview:lint`. Degradation audit exit 0.
- Report: reports/batch-12-report.md

### Batch 12 outcome

- Plan deviations (reported, needed to compile): `core.types.ts` (+ spec), `orchestrator.service.ts`
  (+ spec), agent-generation `index.ts` (`KeptAgentOutcome` export removed — ledger entry for this
  file extended to Batch 12), `wizard-generation-binding.ts`,
  `wizard-generation.preview-fidelity.spec.ts`, `guidance-generation-run.supervisor.spec.ts`,
  `wizard-generation-run.supervisor.spec.ts`.
- Decisions to review in the P2 code-logic review (all reversible):
  1. The wizard origin record (B4 `recordWritten`) is hooked to the orchestrator `onAgentWritten`
     after-write callback, and only for runs whose output root is the harness root.
  2. File guards are persisted in the orchestrator's `AgentFileGuard` shape (`mode` key), not the
     plan's `{decision; baseline}`; the Zod schema mirrors it (replace guard must carry a baseline).
  3. A retry that ends `kept` counts as success; `changed-since-preview` returns `success:false`
     with a message.
- Out of scope, assigned to Batch 17:
  `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts:38` —
  `toProgressItem` treats only `written`/`unchanged` as complete, so a `kept` or
  `changed-since-preview` agent in a resumable run shows as pending although resume will not rerun
  it. Batch 17 owns rendering of the new `FileOutcome` statuses and no other P2 batch owns this
  file (Batch 15 owns `agent-selection.component.ts` and `wizard-rpc.service.ts` only), so it goes
  to Batch 17 (see Task 17.1 files).

## Batch 13: Community pack plan and guarded install (B8) — COMPLETE (commit: ccb672f6e)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: A33 puts the new method's registry entry and guard specs in the handler's batch (TL10).
- Tasks: 1 | Depends on: Batches 4, 7, 9
- Phase: P2 | Phase review: P2 code-logic + style (new RPC)

### Task 13.1: `wizard:plan-pack-install`, guarded `installFiles`, concurrency fix — COMPLETE

- Files: MODIFY `libs/backend/platform-core/src/agent-pack-download.service.ts` (+ spec); CREATE `libs/backend/rpc-handlers/src/lib/handlers/setup/pack-install.service.ts` (+ spec); MODIFY `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts` (+ spec), `setup-rpc.schema.ts` (+ spec), `libs/shared/src/lib/types/rpc.types.ts` (registry entries only), `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`, `apps/ptah-electron/src/di/rpc-surface.spec.ts`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`
- Plan reference: implementation-plan.md:506-582; A14/D9, A22, A25, A26; decisions.md D13
- Pattern to follow: `rpc-allowlist.spec.ts:134-152`; `setup-rpc.handlers.ts:91` METHODS; `agent-pack-download.service.ts:213-245`
- Quality requirements: plan writes nothing; create-only default; replace only with valid token + `differs` baseline + matching revision; delete existence-only cache short-circuit and target-blind mutation dedup (URL dedup only for fetches); per-canonical-target serialization; texts capped at 256 KiB; consent grant + `propagateWithReport` + B4 `forget` only on harness-root completion with ≥ 1 non-failed file; `setup-rpc.handlers.ts` registers and delegates only.
- Validation notes: A-cache. **D13: spec cases for an unreadable local file (forced Keep: a Replace decision for it is refused/kept, never written) and for bulk decisions (a whole-pack Replace applies to every `differs` file and skips unreadable ones).** Plus: cached pack + hand-edited file Keep byte-identical / Replace with matching revision writes; concurrent installs into different roots with different decisions; same-root serialization; identical → `unchanged`; sub-folder default → harness root; opened-folder → no pass, `not-applicable`; replace without token rejected; differs A → B revision rejected; all-unchanged/all-kept/re-install run the pass; refresh failure → `failed`; all failed → no pass; single-file plan scope. Host guard specs: `SetupRpcHandlers` already in `EXPECTED_RESOLVABLE`; container.smoke and surface-composition must stay green.
- Implementation details: `planDownload` + `installFiles` in platform-core (B2 rules re-implemented there); `PackInstallService` with a 64-entry token map.

### Batch 13 verification

- `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/rpc-handlers,@ptah-extension/shared,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review
- Result: own verify 67/67 passed. Combined orchestrator verify for Batches 13/16/18
  (`-p shared,platform-core,rpc-handlers,cli-engine,setup-wizard,ptah-electron,
  ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`): 77 tasks, 76 passed,
  1 failed = pre-existing D19 ptah-extension-webview:lint (accepted).
- Deviations (accepted): `platform-core/src/index.ts` (export of deleted type) and
  `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` (TS2554, 7th ctor arg).
- Note for Batch 15: `wizard:install-pack-agents` refuses Replace without a plan. The UI must
  call `wizard:plan-pack-install` first and send `planToken`, `decisions` (with each row's
  `revision`) and `target`.
- Report: reports/batch-13-report.md

## Batch 14: Setup-wizard decision components (F1) — COMPLETE (commit: 493027b0e)

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2); UI work against the approved prototype
- Review family: codex (different from implementer)
- Rationale: shared building blocks for F2-F4; one new folder, seven small components (TL10).
- Tasks: 1 | Depends on: Batch 1
- Phase: P2 | Phase review: P2 code-logic + visual

### Task 14.1: Keep/replace control, row, diff disclosure, bulk bar, target choice, model note, state — COMPLETE

- Files: CREATE under `libs/frontend/setup-wizard/src/lib/components/preview-decisions/`: `keep-replace-control.component.ts`, `file-decision-row.component.ts`, `diff-disclosure.component.ts`, `bulk-decision-bar.component.ts`, `target-root-choice.component.ts`, `model-origin-note.component.ts`, `preview-decisions.state.ts`, a spec for each; MODIFY `libs/frontend/setup-wizard/jest.config.ts` only if the lazy diff import needs a mapper
- Plan reference: implementation-plan.md:1159-1198; design-spec.md (C1-C6, Review responses :298, Revise round 2 :320); prototype/wizard-preview.html, packs.html
- Pattern to follow: `skill-synthesis-ui/.../lazy-diff-view.component.ts:165` (lazy `@ptah-extension/git-ui/diff-renderer`); `skill-synthesis-ui/src/__mocks__/ptah-git-ui-diff-renderer.ts`
- Quality requirements: signals + OnPush; Keep default; visible focus ring on selected Keep (2px offset); diff colours `bg-success/15`/`bg-error/15`; wrap at ~400px; exact per-host strings.
- Validation notes: unreadable = forced Keep (control disabled) and bulk skips it; Replace carried only on equal revision; target change resets every choice to Keep; "Unchanged since the setup wizard wrote it" note (D10).
- Implementation details: `preview-decisions.state.ts` is the one decision-state helper shared by modal, sidebar and pack prompt.

### Batch 14 verification

- `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview` passes
- No per-batch review
- Result: same orchestrator combined verify as Batch 10 (66/67; only failure is pre-existing
  D19 ptah-extension-webview:lint). jest.config.ts not modified (spec uses jest.doMock).
- Report: reports/batch-14-report.md

## Batch 15: Wizard-view preview modal and pack install prompt (F2 + F4) — PENDING

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: both edit `agent-selection.component.ts` and `wizard-rpc.service.ts` (TL8).
- Tasks: 2 | Depends on: Batches 11, 13, 14
- Phase: P2 | Phase review: P2 code-logic + visual

### Task 15.1: `GenerationPreviewModalComponent` and token-bound submit (F2) — PENDING

- Files: CREATE `libs/frontend/setup-wizard/src/lib/components/generation-preview-modal.component.ts` (+ spec); MODIFY `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts` (+ spec), `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` (+ spec)
- Plan reference: implementation-plan.md:1199-1214; design-spec Review F3/R1-5
- Pattern to follow: existing modal + `wizard-rpc.service.ts:202-248`
- Quality requirements: keeps source status, model picker, informational rival rows; three exclusive rival states; sub-folder warning only for opened-folder target; submit sends `previewToken`, `fileDecisions`, `target` even untabbed; modal keyboard trap.
- Validation notes: `preview-required` rejection re-previews and resets choices.
- Implementation details: compose F1 components.

### Task 15.2: `PackInstallPromptComponent` on every pack path (F4) — PENDING

- Depends on: Task 15.1
- Files: CREATE `libs/frontend/setup-wizard/src/lib/components/pack-install-prompt.component.ts` (+ spec); MODIFY `libs/frontend/setup-wizard/src/lib/components/community-packs-panel.component.ts` (+ spec), `agent-selection.component.ts`, `wizard-rpc.service.ts`
- Plan reference: implementation-plan.md:1231-1253; design-spec Review F4/R1-2; prototype/packs.html; decisions.md D13
- Pattern to follow: Task 15.1 modal
- Quality requirements: one target-choice prompt scoped to the whole pack or one file for wizard Install All, Choose location, per-file Install and Retry, and sidebar Change, Install All and Retry; no-conflict case still shows the target; target change re-plans and resets to Keep.
- Validation notes: **D13: spec cases for an unreadable pack row (forced Keep, control disabled, never sent as replace) and for the bulk state (Replace all / Keep all across many rows, skipping unreadable)** — the prototype fixture lost these; implement them from parity-inventory rows.
- Implementation details: `wizard:plan-pack-install` then `wizard:install-pack-agents` with `planToken`, `decisions`, `target`.

### Batch 15 verification

- `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview` passes
- No per-batch review

## Batch 16: Sidebar preview dialog (F3) — COMPLETE (commit: a0b61b0e6)

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: separate files from Batch 15; same F1 building blocks.
- Tasks: 1 | Depends on: Batches 11, 14
- Phase: P2 | Phase review: P2 code-logic + visual

### Task 16.1: Sidebar dialog decisions — COMPLETE

- Files: MODIFY `libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts` (+ spec), `agent-selection-list.component.ts` (+ spec), `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts` (+ spec)
- Plan reference: implementation-plan.md:1215-1230; design-spec R1-4
- Pattern to follow: `agent-selection-list.component.ts:307-360`
- Quality requirements: every existing-file row starts on Keep; first confirm label "Confirm and generate"; re-preview on confirm uses the shared decision-state helper.
- Validation notes: stale token → re-preview path; unreadable forced Keep.
- Implementation details: replace the ad-hoc definite-target comparison with `preview-decisions.state.ts`.

### Batch 16 verification

- `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview` passes
- No per-batch review
- Result: combined orchestrator verify for Batches 13/16/18: 77 tasks, 76 passed, 1 failed =
  pre-existing D19 ptah-extension-webview:lint (accepted).
- Deviation (D29, coordinator-approved): `wizard-rpc.service.ts` (+ spec) gained optional
  `decisions` on `startBoundAgents`. Batch 15 owns this file next and must build on it.
- Report: reports/batch-16-report.md

## Batch 17: Completion surfaces (F5) — PENDING

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: depends on the final outcome DTO (B7) only.
- Tasks: 1 | Depends on: Batches 12, 13
- Phase: P2 | Phase review: P2 code-logic + visual

### Task 17.1: Outcome summary, stale-Library notice, grade expectation — PENDING

- Files: CREATE `libs/frontend/setup-wizard/src/lib/components/completion/outcome-summary.component.ts`, `library-stale-notice.component.ts`, `grade-expectation.component.ts` (+ a spec each); MODIFY `libs/frontend/setup-wizard/src/lib/components/completion.component.ts` (+ spec), `agent-next-steps.component.ts` (+ spec); MODIFY `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts` (+ spec) — added after Batch 12: `toProgressItem` (:38) must treat `kept` and `changed-since-preview` as settled on resume
- Plan reference: implementation-plan.md:1254-1269; design-spec Review F8; prototype/completion.html
- Pattern to follow: existing `completion.component.ts`
- Quality requirements: counts equal per-file rows; a kept file is never listed as newly diverged; sidebar shows five outcomes; C10 notice on `libraryPass: 'failed'`.
- Validation notes: replace the local status-union copy at `completion.component.ts:28` with the shared union. D18: by now Task 12.1 has widened the shared union to `FileOutcome`; render `kept` and `changed-since-preview` tiles and drop the type-only bridge Task 12.1 added.
- Implementation details: consume `SetupGenerationResultFacts.libraryPass`/`libraryDiverged`/counts.

### Batch 17 verification

- `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview` passes
- No per-batch review

## Batch 18: CLI wizard kept-file output (F8) — COMPLETE (commit: see git log "batch 18")

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: CLI host output only; TUI is typecheck-only.
- Tasks: 1 | Depends on: Batch 12
- Phase: P2 (last) | Phase review: P2 code-logic + style + Electron visual — due after this batch commits

### Task 18.1: Print kept files in `ptah agent`/`ptah wizard` (A20) — COMPLETE

- Files: MODIFY `apps/ptah-cli/src/cli/commands/agent.ts` (+ `agent.spec.ts`), `apps/ptah-cli/src/cli/commands/wizard.ts` (+ `wizard.spec.ts`)
- Plan reference: implementation-plan.md:1388-1399
- Pattern to follow: existing command output in those files
- Quality requirements: no D11 formatter changes here (done in Batch 2); TUI untouched (typecheck only).
- Validation notes: outcome DTO from B6/B7.
- Implementation details: list kept and changed-since-preview files with reasons.

### Batch 18 verification

- `npm run verify -- -p ptah-cli,ptah-tui` passes
- Then phase-end keep-alive: `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`
- P2 review (code-logic + style + Electron visual dark/light/narrow) requested on the combined P2 diff
- Result: own verify 45/45 passed. Combined orchestrator verify for Batches 13/16/18 (covers the
  keep-alive hosts ptah-electron, ptah-extension-vscode, ptah-tui, ptah-cli): 77 tasks,
  76 passed, 1 failed = pre-existing D19 ptah-extension-webview:lint (accepted).
- P2 review is not due yet: Batches 15 and 17 are still PENDING. Request it after both commit.
- Outcome, items for the P2 code-logic review:
  - `ptah agent apply <name>` (`agent.ts` `runApply`) still overwrites
    `.ptah/agents/<name>.md` whenever the content differs (single-template apply; A20 does
    not clearly cover it; left unchanged).
  - `agent.pack.install.complete` can report `changed: true` when every file was kept.
- Report: reports/batch-18-report.md

## Batch 19: Marketplace services and Library provenance (B12 services + B13) — PENDING

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: sole owner of `skills-synthesis-rpc.handlers.ts` (rebase extraction + provenance) and of the smoke specs (TL7).
- Tasks: 2 | Depends on: Batches 3, 4, 5, 7, 10
- Phase: P3 | Phase review: P3 code-logic

### Task 19.1: `LocalItemApprovals`, `CloneRebaseService`, `InstallLocalItemsService` — PENDING

- Files: CREATE `libs/backend/rpc-handlers/src/lib/handlers/marketplace/local-item-approvals.ts` (+ spec), `libs/backend/rpc-handlers/src/lib/handlers/marketplace/install-local-items.service.ts` (+ spec), `libs/backend/rpc-handlers/src/lib/handlers/skill-synthesis/clone-rebase.service.ts` (+ spec); MODIFY `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (+ spec; `rebaseClone` delegates), `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `apps/ptah-electron/src/di/container.smoke.spec.ts`, `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`, `apps/ptah-cli/src/di/container.smoke.spec.ts`
- Plan reference: implementation-plan.md:761-890 (approvals, confirm routes, registration); A21
- Pattern to follow: `skills-synthesis-rpc.handlers.ts:505-556`; `register-shared-rpc-handlers.ts:64-76`
- Quality requirements: bounded 256-entry map, expiry with consent token or 30 min; only `approvalId` leaves the server; file items → repair with `expectedDigest`; clone items → rebase re-digested immediately before write; agent-source → `writeAgent` replace-allowed with baseline = approval digest; mismatch/unreadable → kept `changed-since-approval`; family-bound apply.
- Validation notes: A-rebase-lock; A-smoke (add resolution assertions for `PluginRpcHandlers` and `SkillsSynthesisRpcHandlers` only in hosts that register them). Spec cases: A → B before confirm, delete/recreate, unreadable-after-plan, edit during install.
- Implementation details: services registered with `container.registerSingleton`.

### Task 19.2: `CloneProvenanceResolver` and harness-root agent scope (B13) — PENDING

- Depends on: Task 19.1
- Files: CREATE `libs/backend/rpc-handlers/src/lib/handlers/skill-synthesis/clone-provenance.resolver.ts` (+ spec); MODIFY `skills-synthesis-rpc.handlers.ts` (+ spec), `register-shared-rpc-handlers.ts`
- Plan reference: implementation-plan.md:891-926; A28
- Pattern to follow: `skills-synthesis-rpc.handlers.ts:1172-1245`
- Quality requirements: resolve by `sourceRef`, never basename; orphan keeps `sourceLabel`; resolver failure → provenance omitted; list result returns `scopeRoot`.
- Validation notes: A-rows. Spec cases per plan :916-921 incl. uninstall with display name ≠ id, two plugins one basename, sub-folder lists harness-root agents, `scopeRoot` equals the broadcast root.
- Implementation details: `agentScope()` uses `resolveHarnessWorkspaceRoot`.

### Batch 19 verification

- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` passes
- No per-batch review

## Batch 20: Marketplace installer routes and new plugin RPCs (B12 routes) — PENDING

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: both new methods with their registry entries and guard specs (A33, TL10).
- Tasks: 1 | Depends on: Batches 3, 9, 19
- Phase: P3 | Phase review: P3 code-logic + style (new RPCs)

### Task 20.1: Harness root + config home at the boundary, consent local items, kept reports, `plugins:replace-kept-items`, `plugins:resolve-config-home` — PENDING

- Files: MODIFY `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts` (+ spec), `plugin-rpc.schema.ts`, `libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts` (+ spec), `libs/backend/plugin-marketplace/src/lib/install/external-plugin-installer.service.ts` (+ spec), `libs/shared/src/lib/types/rpc.types.ts` (registry entries only), `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`, `apps/ptah-electron/src/di/rpc-surface.spec.ts`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`
- Plan reference: implementation-plan.md:761-890; A13, A21, A27, A30; D14
- Pattern to follow: `plugin-rpc.handlers.ts:130` METHODS; `rpc-allowlist.spec.ts:134-152`
- Quality requirements: every plugin-config call passes `harnessRoot`; `resolve-config-home` accepts `folder` only from current candidates (else `RpcUserError`, never used as a path); adopt → reconcile + background refresh; save-config background refresh; primary failures return failure with no replace step and no kept report; post-success refresh failure → `libraryPass: 'failed'`.
- Validation notes: A-plan (`attachLocalItems`/`takePlan`), A-cli-plugins (registered in CLI or listed in `CLI_EXPECTED_ABSENT_METHODS`). Per-family spec cases (external, skills.sh, plugin enable, plugin-agent) per plan :853-889, including sub-folder workspace agreement, config-home cases, cross-family approvalId rejected.
- Implementation details: `buildConsentResponse` adds `localItems` from the scanner, edited clones and agent-source shadows; confirm applies decisions through `InstallLocalItemsService`.

### Batch 20 verification

- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/plugin-marketplace,@ptah-extension/shared,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` passes
- No per-batch review

## Batch 21: Library change feed and catalog config-home signal (F7d + core) — PENDING

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: infrastructure F6 and F7 consume; owns `services.ts` and `app.config.ts`.
- Tasks: 1 | Depends on: Batches 1, 20
- Phase: P3 | Phase review: P3 code-logic

### Task 21.1: `LibraryChangeFeed` and `PluginCatalogService.configHome` — PENDING

- Files: CREATE `libs/frontend/marketplace/src/lib/services/library-change-feed.ts` (+ spec); MODIFY `libs/frontend/marketplace/src/services.ts`, `apps/ptah-extension-webview/src/app/app.config.ts`, `libs/frontend/core/src/lib/services/plugin-catalog.service.ts` (+ spec)
- Plan reference: implementation-plan.md:1340-1343 (F7d), 1381-1383 (core)
- Pattern to follow: `message-router.types.ts:33-51`; `app.config.ts:403-407`; `plugin-catalog.service.ts:41,206,212-214`
- Quality requirements: `providedIn: 'root'` MessageHandler, signal `{workspaceRoot, status, reasons, at}`; inert in VS Code (D3); `configHome` read-only, scoped and cleared on workspace switch.
- Validation notes: no import of `webview-e2e-harness` (A29).
- Implementation details: register next to existing MESSAGE_HANDLERS providers.

### Batch 21 verification

- `npm run verify -- -p @ptah-extension/marketplace,@ptah-extension/core,ptah-extension-webview` passes
- No per-batch review

## Batch 22: Library cards and drawer provenance (F6 part 1) — PENDING

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: presentational half of F6, disjoint from the view/state half.
- Tasks: 1 | Depends on: Batches 1, 19
- Phase: P3 | Phase review: P3 code-logic + visual

### Task 22.1: `ProvenanceBadgeComponent`, `DivergedReasonComponent`, card and drawer — PENDING

- Files: CREATE `libs/frontend/skill-synthesis-ui/src/lib/components/clones/provenance-badge.component.ts` (+ spec), `diverged-reason.component.ts` (+ spec); MODIFY `clone-card.component.ts` (+ spec), `clone-detail-drawer.component.ts` (+ spec), `clone-action-gating.spec.ts` (same folder)
- Plan reference: implementation-plan.md:1270-1306; design-spec section 5; prototype/library.html
- Pattern to follow: `clone-card.component.ts:102-121`; `clone-detail-drawer.component.ts:243-277`
- Quality requirements: badge first in the card meta row and in the drawer; text from `provenanceLabel`; hint no longer says "no upstream source" when provenance exists.
- Validation notes: A-hint (`hasUpstreamSource` gating unchanged); orphan with former label; agreement specs import `@ptah-extension/shared/testing`.
- Implementation details: pure presentational components.

### Batch 22 verification

- `npm run verify -- -p @ptah-extension/skill-synthesis-ui,ptah-extension-webview` passes
- No per-batch review

## Batch 23: Library view, state refresh and settings pointer (F6 part 2) — PENDING

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: consumes the feed and `configHome` from Batch 21.
- Tasks: 1 | Depends on: Batches 21, 22
- Phase: P3 | Phase review: P3 code-logic + visual (F6 pointer is a D14 addition, D15)

### Task 23.1: Feed-driven refresh, empty Agents copy, model-editor help, plugin-settings pointer — PENDING

- Files: MODIFY `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` (+ spec), `agent-model-editor.component.ts` (+ spec), `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts` (+ spec)
- Plan reference: implementation-plan.md:1270-1297
- Pattern to follow: `skill-clones-state.service.ts:69-84`; `skill-clones-view.component.ts:133-140,511-525`
- Quality requirements: refresh on every signal with a request epoch (stale reply dropped); toast from the current list's added clones only; C10 failure notice only when `workspaceRoot` equals the last `scopeRoot`; pointer shown for `conflict`/`differs`, hidden for null, Electron only, `role=status`.
- Validation notes: A-nav (how the Library opens the wizard / Skills & Plugins).
- Implementation details: subscribe to `LibraryChangeFeed`; read `PluginCatalogService.configHome`.

### Batch 23 verification

- `npm run verify -- -p @ptah-extension/skill-synthesis-ui,ptah-extension-webview` passes
- No per-batch review

## Batch 24: Marketplace consent, report and repair prompt (F7 a, b, g, h) — PENDING

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: install-flow components, disjoint from the installed view.
- Tasks: 1 | Depends on: Batches 20, 21
- Phase: P3 | Phase review: P3 code-logic + visual

### Task 24.1: Consent dialog local-files section, install report counters, `KeptItemsRepairPromptComponent` — PENDING

- Files: MODIFY `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts` (+ spec), `external-install-report.component.ts`; CREATE `libs/frontend/marketplace/src/lib/external-install-report.component.spec.ts`, `libs/frontend/marketplace/src/lib/kept-items-repair-prompt.component.ts` (+ spec); MODIFY `libs/frontend/marketplace/src/lib/external-marketplaces.component.ts` (+ spec)
- Plan reference: implementation-plan.md:1307-1338, 1362-1369; design-spec Review F2, F5, F9, R1-3; prototype/marketplace.html
- Pattern to follow: existing consent dialog blocks; marketplace-local copy of C1 (A-share)
- Quality requirements: every existing block stays; new section after the shadowed block, before the error; forced Keep for unreadable; re-approval resets to Keep; `confirmed` emits decisions by `approvalId`; modal keyboard trap; failed confirm keeps the dialog open with "Retry install"; repair prompt bound to the opening family (`.claude/agents/release-manager.md` row for plugin-agent).
- Validation notes: A-share. Agreement fixtures from `@ptah-extension/shared/testing`.
- Implementation details: Written/Kept/Shadowed/Skipped counters; "Review and replace…" opens the prompt; prompt calls `plugins:replace-kept-items`.

### Batch 24 verification

- `npm run verify -- -p @ptah-extension/marketplace,ptah-extension-webview` passes
- No per-batch review

## Batch 25: Marketplace installed view and config-home notice (F7 c, f, i) — PENDING

- Recommended executor: subagent frontend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: installed-view files plus the D14 notice rendered in that page.
- Tasks: 1 | Depends on: Batches 21, 24
- Phase: P3 (last) | Phase review: P3 code-logic + style + Electron visual (dark, light, narrow; F7i states and F6 pointer) — due after this batch commits

### Task 25.1: Installed rows/page/detail, inventory store, `PluginConfigHomeNoticeComponent` — PENDING

- Files: MODIFY `libs/frontend/marketplace/src/lib/pages/skills/installed-skill-rows.ts` (+ spec), `installed-skills-page.component.ts` (+ spec), `skill-detail.component.ts` (+ spec), `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts` (+ spec); CREATE `libs/frontend/marketplace/src/lib/pages/skills/plugin-config-home-notice.component.ts` (+ spec)
- Plan reference: implementation-plan.md:1320-1361; design-spec Review F1, R1-1; D14
- Pattern to follow: `installed-skill-rows.ts:152-193`; `installed-skills-page.component.ts:121,180-187`
- Quality requirements: every existing group/state unchanged; provenance badge; "N skills · M commands · K agents" + names; inspector facts follow the selected row; multi-word search across name/description/source/kind; agent shadow state (F7f); notice copy and roles exactly as plan :1344-1356; buttons busy/disabled during the call; failure in `actionError`; null renders nothing; folder paths relative to the harness root.
- Validation notes: A-search (extend today's matcher, keep the search parity row green); inventory store drops on workspace switch.
- Implementation details: notice calls `plugins:resolve-config-home` then reloads the catalog.

### Batch 25 verification

- `npm run verify -- -p @ptah-extension/marketplace,ptah-extension-webview` passes
- Then phase-end keep-alive: `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`
- P3 review (code-logic + style + Electron visual) requested on the combined P3 diff

## Batch 26: Generation prompt rubric alignment (B14) — PENDING

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: orchestrator pinned Claude subagents (D2)
- Review family: codex (different from implementer)
- Rationale: independent of P2/P3 except A-dis; placed last so a handler edit is not contended.
- Tasks: 1 | Depends on: Batch 3 (config home for A-dis); runs after P3
- Phase: P4 | Phase review: P4 code-logic — due after this batch commits

### Task 26.1: Rules module, invocable plugin-skill gate, pinned rubric agreement — PENDING

- Files: CREATE `libs/backend/agent-generation/src/lib/services/generation-prompt-rules.ts` (+ spec), `libs/backend/agent-generation/src/lib/services/invocable-plugin-skills.ts` (+ spec); MODIFY `libs/backend/agent-generation/src/lib/services/content-generation.service.ts` (+ spec), `subagent-tool-allowlist.ts` (export the has-type check if needed); `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` only if A-dis requires it
- Plan reference: implementation-plan.md:927-970; A31
- Pattern to follow: `.claude/skills/skill-creator/references/prompt-authoring-rubric.md:7-66` headings
- Quality requirements: pinned table hand-written in the spec (title, body sha256, instruction sha256); prompt contains every instruction verbatim; unknown type or `Skill` disallowed → no plugin-skill block; 6.7 representative case with its limits stated; no `TASK_\d{4}_\d+` or dates in generated output; `generated-section-validator` specs unchanged.
- Validation notes: A-type, A-dis.
- Implementation details: "RUBRIC RULES" block appended at `content-generation.service.ts:370-392`.

### Batch 26 verification

- `npm run verify -- -p @ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli` passes (add `@ptah-extension/rpc-handlers` if A-dis edited the handler)
- P4 code-logic review requested after commit
