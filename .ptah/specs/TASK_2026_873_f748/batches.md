# Batches — TASK_2026_873_f748

Worktree and command cwd: `D:\projects\ptah-extension\.claude-worktrees\ptah-review`. Paths below are repository relative. `npm run verify -- -p ...` is the only verification command for a batch; run one check at a time. New files named below include focused adjacent `*.spec.ts` where specified. Generated Nx configuration (`project.json`, `tsconfig*.json`, `jest.config.*`, `eslint.config.*`, `src/index.ts`) belongs to the batch that runs the generator; the generator also owns its `tsconfig.base.json` alias edit. All implementers: Codex lane by default. No production code, spawning, or commits are authorized by this breakdown.

## P1 — local dry-run pipeline and replay

### P1-01 — Shared schemas and port

- Executor: `backend-developer`.
- Files: create `libs/shared/review-contracts/` generated config and `src/index.ts`; create `src/lib/review-config.schema.ts`, `review-finding.schema.ts`, `review-run.schema.ts`, `review-rpc.schema.ts`, `github-review.port.ts` and focused specs; generator owns `tsconfig.base.json`.
- Generator: `npx nx g @nx/js:library libs/shared/review-contracts --name=review-contracts --importPath=@ptah-extension/review-contracts --tags=scope:shared,type:util --bundler=none --unitTestRunner=jest --linter=eslint --no-interactive` (repo pattern: `tools/migration/extract-domain.ts:307-323`).
- Depends on: none. Parallel group A with P1-02, P1-03, P1-04.
- Acceptance: strict/versioned config, settings, finding, verdict, run and RPC schemas; malformed SHA, unknown keys and oversized payload rejected; exported `IGitHubReviewPort` uses no feature import. FR-6/7/9/13; AC-6.1, AC-7.1, AC-13.3.
- Nx projects: `@ptah-extension/review-contracts`. Verify: `npm run verify -- -p @ptah-extension/review-contracts`.

### P1-02 — Forward-only review tables

- Executor: `backend-developer`.
- Files: create `libs/backend/persistence-sqlite/src/lib/migrations/0065_ptah_review.ts` and `0065_ptah_review.spec.ts`; modify `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`.
- Depends on: none. Parallel group A. Recheck migration head before creation; if 65 is occupied, allocate next migration and record why.
- Acceptance: unique repo/PR/SHA identity, distinct manual attempts, durable stages, lease/outbox/artifact metadata and crash recovery schema. AC-2.1/2.4/2.5, AC-3.1.
- Nx projects: `@ptah-extension/persistence-sqlite`. Verify: `npm run verify -- -p @ptah-extension/persistence-sqlite`.

### P1-03 — GitHub read adapter

- Executor: `backend-developer`.
- Files: create `libs/backend/review-github/` generated config, `src/index.ts`, `src/di/tokens.ts`, `src/di/registration.ts`, `src/lib/github-review.adapter.ts` and adjacent spec; generator owns `tsconfig.base.json`.
- Generator: `npx nx g @nx/js:library libs/backend/review-github --name=review-github --importPath=@ptah-extension/review-github --tags=scope:extension,type:data-access --bundler=none --unitTestRunner=jest --linter=eslint --no-interactive`.
- Depends on: P1-01 for port integration; generator scaffolding can start in group A but adapter completion waits for P1-01.
- Acceptance: authenticated REST read pagination, ETag, 401/403/rate-limit/malformed responses; fork/author metadata; no ambient `gh`; adapter imports only shared/util ports and platform-core. AC-1.1–1.5, AC-15.1.
- Nx projects: `@ptah-extension/review-github`. Verify: `npm run verify -- -p @ptah-extension/review-github`.

### P1-04 — Core scaffold, policy and queue

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/` generated config, `src/index.ts`, `src/di/tokens.ts`, `src/di/registration.ts`, `src/lib/review-policy.service.ts`, `src/lib/review-queue.service.ts` and focused specs; generator owns `tsconfig.base.json`.
- Generator: `npx nx g @nx/js:library libs/backend/review-core --name=review-core --importPath=@ptah-extension/review-core --tags=scope:extension,type:feature --bundler=none --unitTestRunner=jest --linter=eslint --no-interactive`.
- Depends on: P1-01 contracts; scaffold can begin in group A, integration waits. File ownership is reserved here even while later core batches run.
- Acceptance: exact PtahCode/maintainer/non-fork/ready trust; draft and invalid config audited; dry-run and global/repo pause policy; queue selects latest head and permits distinct manual attempt. FR-1/2/3/13/15; AC-1.1–1.5, AC-2.1–2.5, AC-3.1–3.4, AC-15.1.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P1-05 — SQLite repository and lease

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/src/lib/persistence/review-repository.interface.ts`, `sqlite-review.repository.ts` and focused specs.
- Depends on: P1-02, P1-04. Parallel group B with P1-06, P1-07, P1-08.
- Acceptance: transactionally dedupe overlap polls, durable attempts/stages/checkpoints, lease expiry recovery, no duplicate run on restart. AC-2.1–2.5, AC-14.2.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P1-06 — Exact-SHA context and deterministic checks

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/src/lib/context/review-worktree.service.ts`, `review-context.service.ts`, `review-checks.service.ts`, `review-dependencies.service.ts` and focused specs.
- Depends on: P1-04. Parallel group B.
- Acceptance: detached exact SHA, caller map outside diff, path and lockfile provenance, `npm ci` with scripts disabled, verify lock, check availability recorded, source cleanup/integrity. FR-5/15; AC-5.1–5.7, AC-15.3–15.6.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P1-07 — Lane admission and parsing

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/src/lib/lanes/review-lane.runner.ts`, `review-lane-selector.ts`, `review-lane-admission.service.ts`, `review-output.parser.ts` and focused specs.
- Depends on: P1-01, P1-04. Parallel group B.
- Acceptance: six-lane PR budget, global three-slot review semaphore with one operator slot reserved, confirmed/unknown/at-limit distinction, no-room partial result, deadlines, family capability gate, attempt-root cwd `src/out/meta`, strict output parse and source mutation rejection. FR-6/7/14; AC-6.1–6.5, AC-7.1–7.6, AC-14.1–14.7.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P1-08 — Prompts and artifacts

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/src/lib/lanes/prompts/triage.prompt.ts`, `correctness-lifecycle.prompt.ts`, `contracts-callers.prompt.ts`, `security-privacy.prompt.ts`, `host-di-config.prompt.ts`, `libs/backend/review-core/src/lib/lanes/review-artifact.writer.ts` and focused specs.
- Depends on: P1-01, P1-04. Parallel group B.
- Acceptance: canonical four lenses (N1), fenced untrusted content, triage plus walkthrough in one lane, no secrets in artifacts, preview renders accepted/suppressed findings and capped inline candidates, default Minor (N2). FR-4/6/9/10; AC-4.1–4.4, AC-6.1–6.5, AC-9.1–9.3, AC-10.1–10.4.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P1-09 — Stage coordinator

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/src/lib/review-orchestrator.service.ts`, `stages/discovery-stage.runner.ts`, `context-stage.runner.ts`, `triage-stage.runner.ts`, `lens-stage.runner.ts`, `verification-stage.runner.ts` and focused specs. Reserve `publication-stage.runner.ts` for P1-10.
- Depends on: P1-03, P1-05–08.
- Acceptance: short cron discovery, detached worker, startup poll after 48h, stage durability, deadline and partial coverage, cross-family disproof or weaker same-family label, stale-head supersession. FR-1/2/4/6/7/14; AC-1.1–1.5, AC-2.1–2.5, AC-7.1–7.6, AC-14.1–14.7.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P1-10 — Dry-run publication stage and fixture

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/src/lib/stages/publication-stage.runner.ts`, `testing/dry-run-fixture.spec.ts` and fixture helpers under `testing/` only as needed.
- Depends on: P1-09.
- Acceptance: local fixture PR can traverse queue to preview and persisted export with UI absent; no GitHub mutation; stage/history/artifact survive restart; unavailable checks remain unavailable. FR-2/3/9/10; AC-2.4/2.5, AC-3.3/3.4, AC-10.1–10.4.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P1-11 — Replay fixture and snapshot

- Executor: `devops-engineer`.
- Files: create `tools/review-eval/fixture-builder.ts`, `snapshot-builder.ts`, `fixture-manifest.schema.ts`, `fixture-manifest.json`, and focused specs.
- Depends on: P1-01. Parallel group C with P1-12, P1-14 UI scaffold.
- Acceptance: 15 pre-fix heads and 108 CodeRabbit root IDs with source/checksums and adjudication version; bounded pre-head refs, no remote/alternates/post-head reachability; fixture reference outside lane. FR-17; AC-17.1–17.7.
- Nx projects: none (repository tool; see Plan issues). Verify: `npm run verify -- -p @ptah-extension/review-contracts` for imported schema only; tool specs require a project target before they can be verified under the mandated command.

### P1-12 — Ubuntu replay isolation

- Executor: `devops-engineer`.
- Files: create `tools/review-eval/ubuntu-bwrap-launcher.ts`, `model-api-broker.ts`, `isolation-attestation.ts`, denial-probe specs; modify `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts` and adjacent spec.
- Depends on: P1-01; coordinate with P1-11 on manifest interface, with no overlapping files. Parallel group C.
- Acceptance: Codex process-spawner wrapper; read-only snapshot/write-only out; broker-only inference egress; denial of `gh`, GitHub/network, secrets, MCP and post-head refs; invalid score on any leak; attestation persisted outside lane. AC-17.6/17.7.
- Nx projects: `@ptah-extension/codex-runtime` plus unprojected tool (see Plan issues). Verify: `npm run verify -- -p @ptah-extension/codex-runtime`.

### P1-13 — Replay runner and quality report

- Executor: `devops-engineer`.
- Files: create `tools/review-eval/replay-runner.ts`, `match-findings.ts`, `report.ts`, `adjudication.schema.ts` and focused specs.
- Depends on: P1-10–12.
- Acceptance: fake GitHub/fixed clock, accepted and suppressed findings, semantic match/miss/extra/disputed report, 108-root denominator and isolation attestation; CodeRabbit remains enabled (D13). FR-17; AC-17.1–17.7.
- Nx projects: none (see Plan issues). Verify: `npm run verify -- -p @ptah-extension/review-contracts` for imported contracts only; tool specs need a target.

### P1-14 — Review UI scaffold and list

- Executor: `frontend-developer` (Angular rendering and actual Electron screenshots required).
- Files: create `libs/frontend/review-runs-ui/` generated config and `src/index.ts`, `src/lib/review-runs.store.ts`, `components/review-runs-page.component.ts`, `review-repositories.component.ts`, `review-runs-list.component.ts` and focused specs; generator owns `tsconfig.base.json`.
- Generator: `npx nx g @nx/angular:library libs/frontend/review-runs-ui --name=review-runs-ui --importPath=@ptah-extension/review-runs-ui --tags=scope:webview,type:feature,platform:angular --prefix=ptah --unitTestRunner=jest --linter=eslint --style=css --no-interactive`.
- Depends on: P1-01; may consume contract mocks before RPC. Parallel group C.
- Acceptance: responsive runs list, filters, statuses, cached/offline/loading/no-lanes states, keyboard and focus, prototype-only controls omitted (N3). FR-16; AC-16.1–16.4.
- Nx projects: `@ptah-extension/review-runs-ui`. Verify: `npm run verify -- -p @ptah-extension/review-runs-ui`.

### P1-15 — Review drawers and findings

- Executor: `frontend-developer` (Angular rendering and Electron screenshots required).
- Files: create `libs/frontend/review-runs-ui/src/lib/components/review-run-detail.component.ts`, `review-settings-drawer.component.ts`, `review-findings-table.component.ts` and focused specs.
- Depends on: P1-14; can run parallel with P1-09–13.
- Acceptance: stage timeline, coverage/capacity, safe error and publication state, effective settings and exact config error, masked credential status, no raw secrets/logs, keyboard/focus, dark/light and 900px screenshot comparison to approved design. FR-13/14/16; AC-13.3–13.5, AC-14.1–14.7, AC-16.1–16.4.
- Nx projects: `@ptah-extension/review-runs-ui`. Verify: `npm run verify -- -p @ptah-extension/review-runs-ui`.

### P1-16 — Shared host integration (single owner)

- Executor: `backend-developer` with `frontend-developer` rendering handoff; **Angular route/screenshots required**. This is the one integration owner for shared composition and guard files; see project-cap conflict under Plan issues.
- Files: create `apps/ptah-electron/src/activation/review-worker.activation.ts`, `libs/shared/src/lib/types/rpc-review.types.ts`, `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts`; modify `apps/ptah-electron/src/activation/boot-heavy-services.ts`, `src/di/phase-2-libraries.ts`, `phase-3-storage.ts`, `container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`, `libs/shared/src/lib/types/rpc.types.ts`, `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `rpc-allowlist.spec.ts`, `libs/backend/vscode-core/src/messaging/rpc-handler.ts`, `apps/ptah-extension-webview/src/app/app.routes.ts`, `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts` and focused routing specs.
- Depends on: P1-03, P1-09/10, P1-14/15. Sequential; no parallel edit to listed files.
- Acceptance: Electron starts/stops poll and worker independently of UI; read/list/retry/refresh/settings/export RPC Zod boundary and no token echo; `review:` allowlist; four Electron DI guards and CLI smoke; Review runs route/link render and screenshot matches design. FR-2/3/16; AC-2.2, AC-3.1–3.3, AC-16.1–16.4.
- Nx projects: `ptah-electron`, `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`, `@ptah-extension/vscode-core`, `ptah-extension-webview`, `@ptah-extension/cron-scheduler-ui` (required exception; see Plan issues). Verify sequentially: `npm run verify -- -p ptah-electron,@ptah-extension/rpc-handlers` then `npm run verify -- -p @ptah-extension/shared,@ptah-extension/vscode-core` then `npm run verify -- -p ptah-extension-webview,@ptah-extension/cron-scheduler-ui`.

**P1 phase-end acceptance checkpoint — “Local dry-run reviewer, replay, and no-UI proof.”** Apply every P1 proof in `implementation-plan.md:367-385`: eligible head once, draft-to-ready, superseded push, 48h restart, cron independence, exact worktree, dependency/check provenance, capacity labels, verifier suppression, threshold cap, kill switch preview, secret-free artifact, route/drawer and 108-root valid isolated replay. Explicitly run the fixture with the Review runs route unavailable. One independent combined-diff code-logic review by Grok (different family from Codex implementers); fix local Minor findings; record changed-project verify output and actual Electron screenshot comparison. Known unrelated Windows `user-layer-reap.spec.ts` symlink `EPERM` applies only if `agent-generation` enters the verify set.

## P2 — automatic publication and incremental review

### P2-01 — Publication migration and identity

- Executor: `backend-developer`.
- Files: create `libs/backend/persistence-sqlite/src/lib/migrations/0066_review_publication.ts` and adjacent spec; modify `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`; create `libs/backend/review-core/src/lib/publication/finding-identity.service.ts`, `finding-recheck.service.ts` and focused specs.
- Depends on: P1 checkpoint. Parallel group D with P2-02 and P2-04. Never edit shipped 0065.
- Acceptance: assigned ULID roots, path/symbol/category shortlist, semantic same/distinct/uncertain relation; reworded same bug dedupes and distinct bug in same symbol stays distinct; fixes/reopens require confirmation. FR-8; AC-8.1–8.5.
- Nx projects: `@ptah-extension/persistence-sqlite`, `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/persistence-sqlite,@ptah-extension/review-core`.

### P2-02 — GitHub mutation adapter

- Executor: `backend-developer`.
- Files: create `libs/backend/review-github/src/lib/github-review-publication.adapter.ts` and adjacent spec; modify `libs/backend/review-github/src/index.ts`, `src/di/registration.ts`.
- Depends on: P1 checkpoint. Parallel group D.
- Acceptance: fake API walkthrough upsert; one COMMENT review/head, ≤10 new inline RIGHT anchors, 422 fallback, token/scope/rate errors, current-head and switches rechecked before each mutation; no real PR write in tests. FR-10/11; AC-3.4, AC-7.3, AC-10.1–10.4, AC-11.1–11.6.
- Nx projects: `@ptah-extension/review-github`. Verify: `npm run verify -- -p @ptah-extension/review-github`.

### P2-03 — Durable publication and reconciliation

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/src/lib/publication/review-publication.service.ts`, `publication-outbox.service.ts` and focused specs; modify `libs/backend/review-core/src/lib/stages/publication-stage.runner.ts`.
- Depends on: P2-01/02.
- Acceptance: serialized per-PR outbox, unknown outcome after timeout reconciled by marker/ID, no duplicate GitHub object after crash, stale-head and pause guard every write, suppression reasons and rank cap. FR-8/10/11; AC-8.1–8.5, AC-10.1–10.4, AC-11.1–11.6.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P2-04 — Incremental context

- Executor: `backend-developer`.
- Files: create `libs/backend/review-core/src/lib/context/incremental-scope.service.ts` and focused spec; modify `libs/backend/review-core/src/lib/review-orchestrator.service.ts`, `review-queue.service.ts`, `lanes/prompts/triage.prompt.ts`, `context/review-context.service.ts`.
- Depends on: P1 checkpoint. Parallel group D; disjoint from P2-01/02 and P2-03 files except P2-03 must not touch orchestrator/queue.
- Acceptance: new commits and touched dependents, old open failure recheck, changed-head supersession, 48h outage catch-up, new verified roots only. FR-2/4/8; AC-2.2–2.4, AC-4.3/4.4, AC-8.2–8.5.
- Nx projects: `@ptah-extension/review-core`. Verify: `npm run verify -- -p @ptah-extension/review-core`.

### P2-05 — Credential and confirmation UI

- Executor: `frontend-developer` (**Angular rendering and Electron screenshots required**).
- Files: create `libs/frontend/review-runs-ui/src/lib/components/review-confirm-dialog.component.ts` and focused spec; modify `review-settings-drawer.component.ts`, `review-runs.store.ts`, `review-run-detail.component.ts` and focused specs.
- Depends on: P1 checkpoint. Parallel group D.
- Acceptance: write-only token input, connected bot login/scopes/time, maintainer/repo rollout, live rerun and pause-off confirmation, CodeRabbit coexistence, token absent from UI/read DTO, focus trap and dark/light screenshots. FR-3/11/13/15/16; AC-3.4, AC-11.7, AC-13.4, AC-15.4, AC-16.1–16.4.
- Nx projects: `@ptah-extension/review-runs-ui`. Verify: `npm run verify -- -p @ptah-extension/review-runs-ui`.

### P2-06 — Shared integration and publication gate

- Executor: `backend-developer`; **Angular live state screenshot required** via P2-05 handoff. Sole owner of all P1-16 shared composition files in P2; project-cap exception persists.
- Files: modify `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts`, `libs/shared/src/lib/types/rpc-review.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`, `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `libs/backend/vscode-core/src/messaging/rpc-handler.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `phase-3-storage.ts`, `container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`, `apps/ptah-electron/src/activation/boot-heavy-services.ts` and relevant focused specs. No route edit unless needed; if needed, same owner edits `app.routes.ts`.
- Depends on: P2-03–05.
- Acceptance: token stored via platform secret port and never echoed; fine-grained bot identity/scope and allowlist checked before live enablement; fake publication fixture proves timeout/restart idempotency and kill/head guards; all four DI guards and CLI smoke; canary dry-run preview manually inspected; no real PR write in automated test. FR-3/11/13/15/16; AC-3.4, AC-11.1–11.7, AC-13.4, AC-15.4, AC-16.1–16.4.
- Nx projects: `ptah-electron`, `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`, `@ptah-extension/vscode-core` (required exception). Verify sequentially: `npm run verify -- -p ptah-electron,@ptah-extension/rpc-handlers` then `npm run verify -- -p @ptah-extension/shared,@ptah-extension/vscode-core`.

**P2 phase-end gate:** per-repository live rollout for PtahCode only with CodeRabbit still enabled; one walkthrough and at most one COMMENT review/head with at most ten new inline comments; new head edits walkthrough and posts only new verified roots; retry/restart reconcile IDs; every mutation respects head and kill switch. Combined-diff independent Grok code-logic review, fix local Minor findings, and one final whole-PR review before first push (rule 5).

## Plan issues

1. **Integration batch limit is internally inconsistent.** The required single owner must edit Electron, shared, RPC handlers, VS Code core, webview and cron UI files (`implementation-plan.md:247-249,387-404`), spanning six Nx projects and far more than six production files. The requested ≤2-project/≈6-file cap cannot coexist with the single integration batch requirement. P1-16/P2-06 explicitly document this exception and serialize two-project verify invocations; resolve with the spawner before execution if the cap is absolute.
2. **Replay verification is unprojected.** `implementation-plan.md:223-230,250` places the harness in `tools/review-eval/` as a dev tool with no Nx project. `npm run verify -- -p <projects>` cannot run its focused specs or replay report until the plan adds a project target, or a permitted tool-specific verification command. P1-11/12/13 therefore cannot claim full acceptance from their listed scoped verify commands.
3. **Ubuntu replay cannot be completed in this Windows worktree.** `implementation-plan.md:223-230` expressly requires Ubuntu, `bwrap`, broker isolation and live 15-PR fixture preparation, and says Windows dry-run cannot yield a valid score. P1-11–13 must execute on the designated Ubuntu machine with fixture access, then attach attestation/report; a local Windows verify cannot satisfy AC-17.6/17.7.
4. **Dry-run result target differs from requested command policy.** `implementation-plan.md:419-422` expects an end-to-end fixture and actual Electron screenshot, while the batch rule disallows build/serve/e2e and allows only `npm run verify`. Unit fixture can run under a project test target, but actual Electron render/screenshot requires a running app supplied externally or a one-time exception to the command restriction. Do not infer visual acceptance from source/type checks.
5. **Secret adapter persistence is an open implementation assumption.** `implementation-plan.md:31,409-411` requires an Ubuntu Electron secret-storage persistence contract test before P2 publication; the plan does not name its file or project. P2-06 must locate the adapter and add that focused test before enabling writes, which may increase its file/project count.

## Decisions

- **Batch order:** contracts and migration first; core policy/adapter scaffolds next; context/lane/replay/UI seams parallel after contracts; stage coordinator after dependencies; integration last. Evidence: `implementation-plan.md:237-253`; reversible by reordering unstarted file-disjoint batches.
- **Migration ownership:** 0065 belongs to P1 storage, 0066 to P2 publication; never mutate a shipped migration. Evidence: `implementation-plan.md:259,266`; not reversible after release.
- **Review ownership:** Codex implementers, independent Grok code-logic review per combined phase diff, local Minor fixes, final whole-PR review before first push. Evidence: D18 and task instruction; reversible only before review work begins.

### Next action: Execute P1-01 and P1-02 first with `backend-developer` Codex lanes; scaffold P1-03/P1-04 only after generator alias edits are serialized.
