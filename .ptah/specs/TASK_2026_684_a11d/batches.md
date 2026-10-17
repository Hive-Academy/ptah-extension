# Batches - TASK_2026_684_a11d

Total tasks: 45 | Batches: 23 (Batch 0 gate + 22 implementation batches) | Complete: 14/23

## Execution precondition (read first)

- No batch after Batch 0 starts until PR #731 (`feat/decision-model-routing`, task 646) is merged to
  `main` AND `origin/main` is merged into this worktree. PR #731 was still OPEN at decomposition
  (2026-10-16). Batch 0 owns the merge and the re-check of every `file:line` the plan and this file
  cite.
- Line citations below were checked read-only against
  `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing` at `2ad20c173` (41i and 41j
  committed). Batch 0 re-checks them after the merge. A cited line that moved is drift, not a
  blocker. Record it in the Batch 0 drift table.
- `W` = `D:\projects\ptah-extension\.claude-worktrees\ollama-cloud-decision-model` (branch
  `feat/ollama-cloud-decision-model`). Every path below is under `W`. Every lane gets `W` as its
  `workingDirectory`.
- Plan: `implementation-plan.md` (approved by the user 2026-10-16). Requirements:
  `task-description.md` (45 criteria). Decisions D1-D4: `context.md`.

## Verification rules (CLAUDE.md, repeat in every lane prompt)

- Prefix every Nx command with `NX_NO_CLOUD=true`. Nx uses `--parallel=1`. Jest uses `--maxWorkers=2`.
- `J(root, specs)` = `npx jest -c <root>/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
  For `apps/ptah-cli` and `libs/backend/cli-engine`, the config is `jest.config.cjs`.
- `T(p)` = `NX_NO_CLOUD=true npx nx test <p> --parallel=1 2>&1 | tail -40`. `TC(p)` = `nx typecheck <p>`.
  `L(p)` = `nx lint <p>` (filter the output with `tail`).
- Several projects: `NX_NO_CLOUD=true npx nx run-many -t test -p A B --parallel=1`. Confirm that the
  header says "Running target test for N projects" with the requested N. Never pass project names
  positionally to `nx test`.
- Only verify the projects a batch changed, plus the downstream guard a batch names. Never run
  workspace-wide checks. Never run `build`, `serve`, `e2e` or `package`. Never run
  `nx test ptah-cli` or `nx test ptah-electron`. For app roots, use J on the guard specs only.
- DI guards (any batch that changes DI registration or RPC wiring), run one at a time:
  `J(apps/ptah-extension-vscode, apps/ptah-extension-vscode/src/di/container.smoke.spec.ts)`,
  `J(apps/ptah-electron, apps/ptah-electron/src/di/container.smoke.spec.ts)`,
  `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`.
- RPC surface guards (any batch that adds an RPC method), run one at a time:
  `J(apps/ptah-extension-vscode, apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-extension-vscode/src/di/surface-composition.spec.ts)`,
  the same two specs with `apps/ptah-electron`, and
  `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts libs/backend/cli-engine/src/lib/surface-composition.spec.ts --coverage=false --maxWorkers=2`.
- Repo audits, run after the project checks in backend batches:
  `NX_NO_CLOUD=true npx nx run degradation-audit:lint` (always) and
  `NX_NO_CLOUD=true npx nx run di-lint:lint` (when DI changes).
- Only one heavy check runs at a time across all lanes. Lanes never run git. The team-leader owns
  staging and commits (foreground). The orchestrator owns the background push and PR.

## Executors and review families

- Implementers are CLI lanes. Each batch names a profile (backend-developer, frontend-developer,
  senior-tester or devops-engineer). Any live family may run a batch except codex: codex is
  reserved for this task's reviews. Fallback order: another non-codex family with the same
  capability, then the same family with another provider or model, then a subagent of the named
  profile.
- Phase reviewer: a codex CLI lane. It is a different family from every implementer, so no
  same-family exception is expected. If a phase reviewer must come from an implementer's family,
  record the reason and label the review "weaker evidence" in the phase summary.
- Visual review (Phase 4): visual-reviewer subagent. Subagent reason: it needs a rendered webview
  and a browser, which a CLI lane cannot drive.

## Plan validation

Status: PASSED WITH RISKS

The plan is sound in design. Defects found are in sequencing and file lists only. No BLOCKER: each
has a mitigation inside this batching, and the design does not change.

### Plan defects found (stress test, read-only on the #731 tree at `2ad20c173`)

| # | Defect | Evidence | Mitigation |
| --- | --- | --- | --- |
| PD-1 | Widening the selection union, as the plan orders it, leaves commits that do not compile. Shared C1 widens `DecisionModelSelectionDto` and `DecisionModelSelectionInputDto`, which breaks the chat switches (TS2366: they have no default and return a non-undefined type). Those switches are fixed only in C12, much later. Lane-routing C3 widens `DecisionModelSelectionSchema`, which breaks lane-routing switches and narrowings. Those are fixed in C5, C6 and C7. It also breaks a rpc-handlers switch that is fixed in C9. rpc-handlers also assigns the lane-routing status DTO to the shared DTO type, so shared must widen no later than lane-routing. | chat `provider-consumer-rows.ts:579,599`; lane-routing `decision-model.config.ts:243,274,681`, `route-decide.service.ts:330-363` (`provider: selection.kind`), `failure-class/decision-model-failure-classifier.ts:104-107,138-140`; rpc-handlers `agent-rpc.handlers.ts:293-311`, `:508` -> shared `rpc-agents.types.ts:235` | "Widen last". Batch 3 adds the two member schemas but keeps them out of the union. Batch 5 widens shared together with the chat helpers, before lane-routing widens. Batch 9 adds the members to the lane-routing union in one compile set with every consumer (Decisions TL-1) |
| PD-2 | C4 deletes `hasJevApiKey`, `readJevApiKey` and `setJevApiKey`. rpc-handlers types its injected config as a `Pick` of those methods, and 6 specs mock them. The plan moves the callers only in C9, so rpc-handlers does not compile in between. | `agent-rpc.handlers.ts:366-374,878-896`; mocks in `agent-rpc.handlers{,.list-rows,.migration,.resume-parent-session,.set-config,.decision-model}.spec.ts`; `decision-model.config.spec.ts` (10 refs) | One atomic Batch 4 (the Jev slot switch), which is allowed to exceed the file cap (Decisions TL-2) |
| PD-3 | The C12 file list leaves out `decision-model-row.component.ts`. Its import block takes the helpers that C12 moves out of `provider-consumer-rows.ts`. Without that file the move breaks chat. | `decision-model-row.component.ts:29-40` | Batch 5 Task 5.2 updates the import block |
| PD-4 | The C10 checks leave out the RPC surface guard specs. Task 646 needed them for every new `agent:` method. The plan also does not say that the CLI jest config is `.cjs`. | 646 `batches.md:44-46,358,1462`; `apps/ptah-cli/jest.config.cjs`, `libs/backend/cli-engine/jest.config.cjs` | Batch 14 runs the RPC surface guards, and Batches 13-16 run the DI guards with the right configs |
| PD-5 | C5 says `localityOf()` delegates to the resolver. The resolver is async because it reads keys, but `localityOf` has sync callers. | `decision-model.config.ts:722` (`dto()`), `agent-rpc.handlers.ts:574` | Batch 6: `decision-model.target.ts` also exports a sync `localityOfSelection(...)`, which needs no key (DC7). `localityOf` delegates to it, and `resolveDecisionEndpoint` stays async |
| PD-6 | Minor line drift in a citation. | C2 cites `ollama-model-discovery.service.ts:16-19` for the `isCloudTag` import; it is at `:30` | Batch 0 drift table |

### Assumptions

- A1 `POST https://ollama.com/v1/systemone` accepts `clef:27b-cloud`. Unverified until the user's
  local keyed run (U1). Batch 19 records both id forms. If A1 is false, Batch 21 Task 21.3 applies
  the plan's fix: strip the suffix on the direct path only, in `decision-model.target.ts`.
- A2 A keyed `POST /v1/systemone {}` answers 400/422 without running inference, and the control path
  answers 404. Unverified until U1. Batch 19 has a probe case. If A2 is false, Task 21.3 switches
  endpoint-mode status to key presence (one branch in `decision-model.config.ts`).
- A3 An unknown model returns 404, read as `provider-error` with `notFound: true`. Unverified until
  U1 (Batch 19 error-mapping case).
- A4 clef answers pass the `.strict()` answer schema (`system-one.schema.ts`). Unverified until U1.
  If A4 is false, Task 21.3 relaxes `.strict()` on the answer object only.
- A5 `workflow_dispatch` runs only workflows that are on the default branch. This is the documented
  GitHub behaviour. The user's choice (local run, U1) avoids it. The first workflow dispatch is a
  post-merge step (U3).
- A6 The daemon's `/api/show` returns `capabilities`, and older daemons omit it. Batch 12 treats an
  omitted field as undetermined (4.3).
- A7 `ISecretStorage` reads the same store as `AuthSecretsService` on all three hosts. VERIFIED:
  `platform-vscode/src/registration.ts:72` (raw `context.secrets`, no prefix);
  `vscode-core/src/services/auth-secrets.service.ts:128,262-276` (`ptah.auth.provider.<id>`);
  `vscode-core/src/di/register-storage-shims.ts:45-80`, which is called by
  `apps/ptah-electron/src/di/phase-1-infra.ts` and `libs/backend/cli-engine/src/lib/container.ts`.
- A8 `provider.ollama-cloud.baseUrl` is a file-based setting key. VERIFIED: it matches
  `PROVIDER_BASE_URL_PATTERN` (`platform-core/src/file-settings-keys.ts:740-744`).
- A9 No secret-key allowlist blocks `ptah.laneRouting.customEndpointApiKey`. VERIFIED: the only
  readers of `ptah.laneRouting.*` are lane-routing and rpc-handlers.
- A10 `toCloudId('clef:27b')` returns `clef:27b-cloud`. VERIFIED: `ollama-cloud-metadata.service.ts:127-148`.

### Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| #731 has not merged, and the merge moves cited lines | HIGH | Batch 0 (merge and drift table); every task re-reads its cited lines first |
| Intermediate commits do not compile because of union widening (PD-1) | HIGH | Widen-last order (Batches 3, 5, 9); Batch 5 also typechecks rpc-handlers as a downstream guard |
| Removing the Jev methods breaks rpc-handlers between batches (PD-2) | HIGH | Atomic Batch 4 |
| A key reaches a log, a DTO, an error or a URL (1.6) | HIGH | Sentinel-key specs in Batches 3, 10 and 11; URL rules in Batch 3 (no userinfo, query or fragment); workflow redaction in Batch 20 |
| A key is sent to the wrong origin, or over plain http (2.3, D4, DC3, DC6) | HIGH | Batch 3 (origin binding, `keyTransportAllowed`); Batch 6 resolver table; Batch 11 refuses the save |
| Rollback on a failed save loses or leaks the custom key (2.5) | MEDIUM | Batch 11 runs `describe.each` over both key fields |
| Direct API rejects `clef:27b-cloud` (A1) | MEDIUM | Batch 19 id-form case; Task 21.3 conditional fix |
| Cloud cold start above 3000 ms makes routing fall back | MEDIUM | Remote timeout ships at 3000 (5.3 path). Batch 21 applies the plan formula from U1 numbers |
| Routing quota is shared with chat (D1) | MEDIUM | 646 fallback absorbs 429; workflow runs weekly; about 40 calls per live run |
| `agent:listDecisionModels` is not mocked in the webview e2e harness | LOW | The call happens only when the editor opens on an Ollama kind. Phase 4 review checks the settings scenarios. No e2e run unless the user asks |
| A UI intermediate build offers a kind the host refuses | LOW | `DECISION_KIND_OPTIONS` gets its new entries only in Batch 17, after the host accepts the kinds (Batch 9) and the RPC exists (Batch 14) |
| Large shared files collide with other open work (`agent-rpc.handlers.ts`, `rpc.types.ts`) | LOW | Extraction in Batch 11; registry edits are two entries |

### Edge cases

- Ollama Cloud key added or removed between two calls or probes (1.4): Tasks 6.1 and 10.2.
- `-cloud` model on a loopback daemon reads `remote` (1.5): Task 6.1, wired in Task 7.1.
- Custom endpoint with a key on non-https, non-loopback http is refused at save (Task 11.2) and
  blocked at call (Task 6.1). Without a key, http is allowed (D4).
- Custom key stored for origin A while the selection points at origin B: the key is not sent (Task 3.2, Task 6.1).
- `provider.ollama-cloud.baseUrl` override with a key: the key goes to the override only if the
  override passes `keyTransportAllowed`; otherwise the row reads `unsupported-endpoint` with a
  fixed detail (DC6, Task 6.1).
- Request sets both `decisionModelJevApiKey` and `decisionModelCustomApiKey`: refused (DC10, Task 11.2).
- `''` deletes a key; a blank key never stores (Task 3.2, Task 11.2).
- Invalid JSON in the custom secret slot reads as no key and logs a warn with no value (Task 3.2).
- Catalog: lookup fails, or an old daemon omits capabilities: the model is not listed and the
  filter reads `partial` or `unavailable` (Task 12.1, Task 17.3).
- Catalog budget runs out (4000 ms, under the row RPC's 5000 ms): unanswered models are undetermined (Task 12.1).
- Picker opens: nothing is preselected. Suggestions arrive: `draft.model` is not written (4.5, Task 17.3).
- Base URL with a path (`https://host/gw`): the path is kept when joining (DC11, Task 3.1, Task 8.2).
- Remote call past its timeout falls back, with no retry (5.4, Task 7.2).
- Missing `OLLAMA_API_KEY` secret: the workflow ends green with a notice and opens no issue (6.8, Task 20.1).

### Preserve list (verified in Mode 3)

This is not a surface replacement, so no `parity-inventory.md` is needed (task-description
Decisions). The row is refactored (helpers move, key field becomes a component), so these existing
capabilities must still work, each with a passing spec:

- Kinds `unset`, `ollama`, `jev`, `structured`: same save, status and locality, except the
  deliberate DC7 change (an `ollama` cloud-tag model reads `remote`).
- Free-text model entry for every kind (4.4).
- Jev key: write-only, never prefilled, "Remove stored key" sends `''`, and the button is hidden
  when no key is stored.
- Jev rollback rules and `DECISION_MODEL_KEY_MAY_HAVE_CHANGED` (646 specs keep passing).
- Setup-provider deep link (`setupProviderRequested`), "newer request wins" suggestions counter,
  Undo after save, and the fixed failed-save sentence.
- `structured` suggestions from `PROVIDER_MODELS_LOADER`.
- `settings:set` still refuses `agentOrchestration.decisionModel` (41j).

## Batch 0: Gate 0 - merge prerequisite and re-baseline — COMPLETE

- Recommended executor: Task 0.1 orchestrator/team-leader (git); Task 0.2 CLI lane, read-only,
  backend-developer profile (non-codex family)
- Execution mode: sequential
- Fallback order: other non-codex family, read-only -> same family other model -> Explore subagent
- Subagent reason: N/A (Task 0.1 is git, which lanes never run; that is an orchestrator step, not a subagent)
- Review family: N/A
- Rationale: every later batch cites lines from the #731 tree. They must be re-checked once,
  before any code change.
- Tasks: 2 | Depends on: PR #731 merged to `main`
- Phase: 0 (Gate) | Phase review: none (no code change)
- Status note: #731 merged; `origin/main` merged into `W` at 096f014bc (2026-10-17), no conflicts.

### Task 0.1: Merge `origin/main` after #731 — COMPLETE

- File: none (git). In `W`, run `git fetch origin`, then `git merge origin/main` (foreground).
- Plan reference: implementation-plan.md:26-27; context.md:3-6
- Pattern to follow: CLAUDE.md "Git" rules
- Quality requirements: the merge is clean; the only difference from `origin/main` is the task folder.
- Validation notes: confirm these on disk after the merge:
  `libs/backend/lane-routing/src/lib/decision-model/` exists;
  `platform-core/src/file-settings-keys.ts` lists `agentOrchestration.decisionModel` (41i);
  `rpc-handlers/.../settings-rpc.handlers.ts` refuses that key (41j).
- Implementation details: if `origin/main` lacks #731, stop and keep Batch 0 IN_PROGRESS.

### Task 0.2: Re-check the plan's and this file's `file:line` citations — COMPLETE

- Depends on: Task 0.1
- File: none written by the lane. The lane returns a drift table (cited -> actual), and the
  team-leader records it below.
- Plan reference: implementation-plan.md:29-74 (Codebase evidence), :812-817 (contracts to confirm)
- Quality requirements: cover every line cited in "Plan defects found" and in each task below.
  Re-confirm the union-consumer list for PD-1 by searching for `switch (` and `.kind ===` over
  `DecisionModelSelection` and the shared DTOs. Confirm the `PROVIDER_KEY_SECRET_PREFIX` export and
  `assertManifestInvariants`. Confirm there is no `vscode-core` import under `libs/backend/lane-routing/src`.
- Validation notes: drift is recorded, not fixed. A missing symbol (not just moved) is a BLOCKER
  that goes back to the orchestrator.
- Implementation details: read-only `ptah_*` tools, then Grep.

### Batch 0 verification

- `git log --oneline -3` shows the merge, and the three 41i/41j facts hold.
- The drift table is recorded here before Batch 1 is assigned.

Drift table (Task 0.2, 2026-10-17, merged tree `096f014bc`):

- Baseline: `2ad20c173` and `5474665e6` are ancestors of `HEAD`. `git diff 2ad20c173 HEAD`
  touches none of the files the plan, this file or context.md cite (257 files changed, all in
  harness, command-center, chat-session and webview areas). `5474665e6..2ad20c173` changed only
  the 41i/41j files (`file-settings-keys.ts`, `file-settings-manager.ts`, their specs,
  `settings-rpc.handlers.ts` + spec); the plan's citations into them match the merged tree.
- No merged code overlaps this task: no added line mentions `systemone`, `decisionModel`,
  `listDecisionModels`, `isCloudTag`, `toCloudId` or `clef`. Every planned CREATE path is still absent.
- Merge facts: `file-settings-keys.ts:219,504` list `agentOrchestration.decisionModel`;
  `settings-rpc.handlers.ts:68-78` refuses it; `PROVIDER_KEY_SECRET_PREFIX` at
  `provider-key-slots.ts:24`, exported at `platform-core/src/index.ts:362`;
  `assertManifestInvariants` at `host-profile/manifest.ts:496`; no `vscode-core` import under
  `libs/backend/lane-routing/src` (two doc-comment mentions in `lane-routing-logger.ts:6-7` only).
- PD-1 union consumers: unchanged (no cited file changed); the lines at
  `provider-consumer-rows.ts:579,599`, `decision-model.config.ts:243,274,681`,
  `decision-model-failure-classifier.ts:104-107,138-140`, `agent-rpc.handlers.ts:293-311` still hold.

| Cited | Actual | Where corrected |
| --- | --- | --- |
| `ollama-model-discovery.service.ts:16-19` (`isCloudTag` import, PD-6) | `:30` | plan C2 |
| `agent-rpc.handlers.ts:856-939` (`writeDecisionModel` .. `storedSelectionState`) | `:856-936` (`:937-939` is the Cursor key doc comment) | plan evidence row, C9 (x2); Task 11.1 |
| `decision-model.config.ts:180-205` / `:180-224` (Jev key methods) | `:181-206` / `:181-225` | Tasks 3.2, 4.1 |
| `decision-model.config.ts:211-255` (`resolveSystemOneTarget`..`localityOf`) | `:212-256` | Task 6.1 |
| `implementation-plan.md:24-25` (merge prerequisite) | `:26-27` | Task 0.1 |
| `Plan :788-789` (`DecisionKeySlot` ordering, TL-4) | `:783-784` | Decisions TL-4 |

Material findings: none. No design, decision, batch scope or acceptance criterion changes.

## Batch 1: Cloud model id helpers move to shared (C2) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family same capability -> same family other provider/model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex (different from implementer)
- Rationale: a pure-function move across two libraries with one consumer. Small and mechanical.
- Tasks: 1 | Depends on: Batch 0. May run concurrently with Batches 2 and 3 (disjoint files).
  Heavy checks still run one at a time, and commits go in batch order.
- Phase: 1 - Contracts, keys and view helpers | Phase review: code-logic (codex)
- Criteria: supports 1.3, 4.1 and 6.10 (`toCloudId`); 6.1 (moved cases still pass)

### Task 1.1: Move `isCloudTag` and `toCloudId` to `@ptah-extension/shared` — COMPLETE

- Files (6; the spec is a `git mv`, so it counts once):
  - CREATE `W\libs\shared\src\lib\providers\ollama-cloud-model-id.ts`
  - MOVE `W\libs\backend\auth-providers\src\lib\providers\local\ollama-cloud-metadata.cloud-id.spec.ts` -> `W\libs\shared\src\lib\providers\ollama-cloud-model-id.spec.ts`. The team-leader stages it as a rename; the lane copies the cases unchanged and deletes the old file.
  - MODIFY `W\libs\shared\src\lib\providers\index.ts`
  - MODIFY `W\libs\backend\auth-providers\src\lib\providers\local\ollama-cloud-metadata.service.ts` (remove the two functions, import from shared)
  - MODIFY `W\libs\backend\auth-providers\src\lib\providers\local\ollama-model-discovery.service.ts` (import line, `:30`)
  - MODIFY `W\libs\backend\auth-providers\src\lib\providers\local\index.ts` (drop the re-exports at `:17-18`)
- Plan reference: implementation-plan.md:169-190
- Pattern to follow: `ollama-cloud-metadata.service.ts:120-148` (bodies moved verbatim)
- Quality requirements: behaviour is identical and no copy is left behind. No importer exists
  outside auth-providers (verified).
- Validation notes: PD-6 (import line drift).
- Implementation details: shared depends only on shared; the functions are pure.

### Batch 1 verification

- `J(libs/shared, libs/shared/src/lib/providers/ollama-cloud-model-id.spec.ts)`; `T(@ptah-extension/auth-providers)`;
  `TC(@ptah-extension/shared)`; `TC(@ptah-extension/auth-providers)`; `L` for both.
- `isCloudTag` and `toCloudId` are not defined anywhere under `libs/backend/auth-providers/src`.
- No per-batch review.

## Batch 2: Additive shared contracts (C1, non-widening part) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: optional fields, constants and a new types file. Nothing that consumers switch on changes (PD-1).
- Tasks: 1 | Depends on: Batch 0. May run concurrently with Batches 1 and 3.
- Phase: 1 | Phase review: code-logic (codex)
- Criteria: 2.2 (field-named constants, DC12), 2.4 (write-only field type), 2.7/DC13 (`apiKeyStored?`), 4.x (catalog types)

### Task 2.1: Add the key field, status indicator, error constants and catalog types — COMPLETE

- Files:
  - MODIFY `W\libs\shared\src\lib\types\rpc\rpc-agents.types.ts`: `DecisionModelStatusDto.apiKeyStored?: boolean`;
    `AgentOrchestrationConfig.decisionModelCustomApiKey?: string` (write-only, `''` deletes, documented like
    `decisionModelJevApiKey` at `:357-362`); constants `DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED`,
    `DECISION_MODEL_INVALID_BASE_URL`, `DECISION_MODEL_INVALID_MODEL`, `DECISION_MODEL_KEY_NEEDS_HTTPS`,
    `DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT` beside `DECISION_MODEL_KEY_MAY_HAVE_CHANGED`
  - CREATE `W\libs\shared\src\lib\types\rpc\rpc-decision-model-catalog.types.ts`
  - MODIFY `W\libs\shared\src\lib\types\rpc.types.ts` (re-export line only; the registry entries land in Batch 14)
- Plan reference: implementation-plan.md:139-167
- Pattern to follow: `rpc-lane-outcome.types.ts`; `rpc-agents.types.ts:155-161`
- Quality requirements: no secret field on any read DTO; each error text names its field.
- Validation notes: do NOT add the `ollama-cloud` or `custom` members to the selection DTO unions
  here. Batch 5 does that (PD-1).
- Implementation details: `DecisionModelCatalogSource = 'ollama' | 'ollama-cloud'`;
  `AgentListDecisionModelsResult { models: string[]; filter: 'applied' | 'partial' | 'unavailable'; undetermined: number }`.

### Batch 2 verification

- `TC(@ptah-extension/shared)`; `L(@ptah-extension/shared)`; then `TC(@ptah-extension/rpc-handlers)` as a downstream guard.
- No per-batch review.

## Batch 3: Endpoint URL policy, decision keys and member schemas (C3 additive part, C4) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: two new pure units, each with its own spec, plus additive constants. The union stays unchanged (PD-1).
- Tasks: 3 | Depends on: Batch 0. May run concurrently with Batches 1 and 2.
- Phase: 1 | Phase review: code-logic (codex)
- Criteria: 2.2 (URL rules and D4), 2.3 (path join, origin), 1.6 (keys sentinel), 7.3 (literal slot), DC3, DC11

### Task 3.1: `decision-endpoint.url.ts` and its spec — COMPLETE

- Files: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-endpoint.url.ts`,
  CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-endpoint.url.spec.ts`
- Plan reference: implementation-plan.md:192-221
- Pattern to follow: `decision-model.probe.ts:20,151-159` (loopback set, `normaliseBaseUrl`)
- Quality requirements: `parseEndpointBaseUrl` accepts only absolute http/https URLs of at most 2048
  characters, with no userinfo, query or fragment. `keyTransportAllowed` = https or loopback.
  `systemOneUrl` keeps the base path. `originOf`.
- Validation notes: no secret may be carried inside a stored base URL.
- Implementation details: a table-driven spec of accepted and refused URLs, loopback hosts, the transport rule and the path join.

### Task 3.2: `DecisionModelKeys` and its spec — COMPLETE

- Files: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.keys.ts`,
  CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.keys.spec.ts`
- Plan reference: implementation-plan.md:223-250
- Pattern to follow: `decision-model.config.ts:181-225` (secret reads and trims)
- Quality requirements: slots `'jev' | 'custom'` (exported `DecisionKeySlot`). The custom value is
  JSON `{origin, key}`, validated with Zod, and returned only for the matching origin.
  `snapshot`/`restore` take an opaque raw value. `readOllamaCloudKey()` reads
  `ptah.auth.provider.ollama-cloud` and never writes it. No cache (1.4).
- Validation notes: 1.6. Search logger calls and thrown errors for a sentinel key. Assert the literal slot string (7.3).
- Implementation details: in-memory `ISecretStorage` in the spec.

### Task 3.3: Constants, member schemas and `config.keys` — COMPLETE

- Files: MODIFY `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.types.ts`,
  MODIFY `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.config.ts`
- Depends on: Tasks 3.1, 3.2
- Plan reference: implementation-plan.md:203-206, 236-237
- Pattern to follow: `decision-model.types.ts:10-28,98-112`
- Quality requirements: add `DECISION_MODEL_CUSTOM_SECRET_KEY`, `OLLAMA_CLOUD_SECRET_KEY`
  (`PROVIDER_KEY_SECRET_PREFIX + 'ollama-cloud'`), `OLLAMA_CLOUD_BASE_URL_CONFIG_KEY`, and
  `DecisionModelStatusDto.apiKeyStored?`. Export `OllamaCloudSelectionSchema` and
  `CustomEndpointSelectionSchema` (both `.strict()`, model 1..128) and their types, but do NOT add
  them to `DecisionModelSelectionSchema` yet. `DecisionModelConfig` gains `readonly keys: DecisionModelKeys`.
- Validation notes: PD-1 and PD-2. Keep the three Jev methods unchanged; Batch 4 removes them.
- Implementation details: construct `keys` from the injected `ISecretStorage` and logger.

### Batch 3 verification

- `T(@ptah-extension/lane-routing)`; `TC(@ptah-extension/lane-routing)`; `L(@ptah-extension/lane-routing)`; degradation-audit.
- No `vscode-core` import under `libs/backend/lane-routing/src`.
- No per-batch review.

## Batch 4: Jev key slot switch (atomic, cross-library) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: PD-2. Removing the methods and moving their callers must share one commit, or
  rpc-handlers does not compile. 9 files, over the 6-file cap (Decisions TL-2). 7 of them change only mocks or calls.
- Tasks: 2 | Depends on: Batch 3
- Phase: 1 | Phase review: code-logic (codex)
- Criteria: 2.5 groundwork (slot snapshot and restore for Jev; 646 rollback specs unchanged), 6.1

### Task 4.1: Replace the Jev key methods in lane-routing — COMPLETE

- Files: MODIFY `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.config.ts` (delete
  `hasJevApiKey`, `readJevApiKey` and `setJevApiKey` at `:181-206`; `jevStatus` uses `keys.has('jev')`;
  `resolveSystemOneTarget` uses `keys.get('jev')`), MODIFY `...\decision-model.config.spec.ts` (renames only)
- Plan reference: implementation-plan.md:236-237; Architecture "Effect on existing code" (no V2 copies)
- Pattern to follow: Task 3.2 API
- Quality requirements: behaviour is identical for Jev.
- Validation notes: PD-2.
- Implementation details: none beyond the rename.

### Task 4.2: Move the rpc-handlers callers and mocks to the slot API — COMPLETE

- Depends on: Task 4.1
- Files: MODIFY `W\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (`Pick` at `:366-374`
  gets `'keys'` in place of the two Jev methods; `writeDecisionModel` at `:856-909` uses
  `keys.snapshot('jev')`, `keys.set('jev', ...)` and `keys.restore('jev', ...)` with identical rules);
  MODIFY the mocks in `agent-rpc.handlers.decision-model.spec.ts`, `agent-rpc.handlers.list-rows.spec.ts`,
  `agent-rpc.handlers.migration.spec.ts`, `agent-rpc.handlers.resume-parent-session.spec.ts`,
  `agent-rpc.handlers.set-config.spec.ts`, `agent-rpc.handlers.spec.ts` (same directory)
- Plan reference: implementation-plan.md:405-440 (the generalisation itself is Batch 11)
- Pattern to follow: existing rollback cases in `agent-rpc.handlers.decision-model.spec.ts`
- Quality requirements: no behaviour change. Every existing rollback case passes without edits to its assertions.
- Validation notes: this batch does not extract the writer (Batch 11).

### Batch 4 verification

- `NX_NO_CLOUD=true npx nx run-many -t test -p @ptah-extension/lane-routing @ptah-extension/rpc-handlers --parallel=1`
  (header: "2 projects"); `TC` and `L` for both; degradation-audit.
- `hasJevApiKey|readJevApiKey|setJevApiKey` appear nowhere under `libs/` or `apps/`.
- No per-batch review.

## Batch 5: Shared DTO widening and decision row view helpers (C1 widening, C12) — COMPLETE

- Recommended executor: CLI lane, frontend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> frontend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: PD-1. The shared unions must widen together with every chat switch over them, and
  before lane-routing widens (Batch 9). Six files in two projects.
- Tasks: 3 | Depends on: Batch 2. Must commit before Batch 9.
- Phase: 1 | Phase review: code-logic (codex)
- Criteria: 1.1 (setup target), 2.1 (input building), 2.6 (row locality text), 3.2 (row messages), 4.4 (parse accepts any model)

### Task 5.1: Widen the shared selection DTO unions — COMPLETE

- File: MODIFY `W\libs\shared\src\lib\types\rpc\rpc-agents.types.ts` (`:110-131`: add
  `{ kind: 'ollama-cloud'; model }` and `{ kind: 'custom'; baseUrl; model }` to both unions)
- Plan reference: implementation-plan.md:144-145
- Pattern to follow: existing members
- Quality requirements: mirrors the lane-routing member schemas from Task 3.3.
- Validation notes: run the rpc-handlers typecheck downstream guard. A wider shared union still
  accepts the narrower lane-routing DTO at `agent-rpc.handlers.ts:508`.

### Task 5.2: Move the decision helpers to `decision-model-row.view.ts` (no behaviour change) — COMPLETE

- Files: CREATE `W\libs\frontend\chat\src\lib\settings\providers\decision-model-row.view.ts`,
  CREATE `...\decision-model-row.view.spec.ts` (moved cases), MODIFY `...\provider-consumer-rows.ts`
  (remove `:398-651`), MODIFY `...\provider-consumer-rows.spec.ts` (remove the moved `describe`, `:299` onward),
  MODIFY `...\decision-model-row.component.ts` (import block `:29-40` only, PD-3)
- Plan reference: implementation-plan.md:493-518
- Pattern to follow: the moved code itself
- Quality requirements: a pure move. Only `decision-model-row.component.ts` imports these helpers
  (verified: `provider-consumer-assignments.component.ts` and `orchestration-settings.component.ts`
  import only non-decision symbols).

### Task 5.3: Extend the view helpers for the new kinds — COMPLETE

- Depends on: Tasks 5.1, 5.2
- Files: `decision-model-row.view.ts`, `decision-model-row.view.spec.ts`
- Plan reference: implementation-plan.md:500-508
- Quality requirements: the draft gains `baseUrl`. `decisionModelInput`, `sameDecisionSelection`,
  `parseSelection` and `parseDecisionModelStatus` (plus `apiKeyStored`) handle both kinds.
  `servedBy` returns "Ollama Cloud" or the custom host. `stateMessageOf(no-credential)` points to
  provider setup or to the key field. `setupProviderOf`. `endpointFieldError(draft, keyPresent)`
  mirrors Task 3.1 and D4.
- Validation notes: do NOT add entries to `DECISION_KIND_OPTIONS` here. Batch 17 adds them
  (Decisions TL-3), so no intermediate build offers a kind the host refuses.

### Batch 5 verification

- `TC(@ptah-extension/shared)`; `J(libs/frontend/chat, libs/frontend/chat/src/lib/settings/providers/decision-model-row.view.spec.ts libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.spec.ts libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.spec.ts)`;
  `TC(@ptah-extension/chat)`; `L(@ptah-extension/chat)`; then `TC(@ptah-extension/rpc-handlers)` as the downstream guard.
- No per-batch review.

## Batch 6: Target resolver, standalone (C5) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: the one place that holds every per-kind rule. It is built and specced before
  anything is wired to it, so the batch is additive.
- Tasks: 2 | Depends on: Batches 1, 3, 4
- Phase: 2 - Target resolution, probe and new kinds | Phase review: code-logic (codex)
- Criteria: 1.2, 1.3, 1.4, 1.5, 2.3, 2.6, DC6, DC7, DC8, DC9

### Task 6.1: `decision-model.target.ts` and its spec — COMPLETE

- Files: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.target.ts`,
  CREATE `...\decision-model.target.spec.ts`
- Plan reference: implementation-plan.md:252-287 (resolution table)
- Pattern to follow: `decision-model.config.ts:212-256`
- Quality requirements: `resolveDecisionEndpoint(selection, deps)` (async) accepts
  `DecisionModelSelection | OllamaCloudSelection | CustomEndpointSelection`. It returns
  `DecisionEndpoint {baseUrl, model, apiKey?, probe, locality, timeoutMs}`, or
  `{blocked, detail}`, or `null`. Separately it exports a sync `localityOfSelection(selection, deps)`
  that reads no key (PD-5). `ollama-cloud` sends `toCloudId(model)` on both paths.
- Validation notes: a key goes only to the base URL resolved for it; a `-cloud` model never reads
  `local`. The spec covers every table row, override with and without a key, key added or removed
  between calls, and the blocked cases.
- Implementation details: deps are the workspace reader, `DecisionModelKeys` and `ollamaBaseUrl()`.

### Task 6.2: Remote timeout constant, fixed details and the slot export — COMPLETE

- Files: MODIFY `W\libs\backend\lane-routing\src\lib\routing-constants.ts`
  (`DECISION_REQUEST_TIMEOUT_REMOTE_MS = 3000`, with a comment citing plan Component 16;
  `OVERALL_CALL_BUDGET_MS` derived from the larger of the two timeouts), MODIFY
  `...\decision-model\decision-model.detail.ts` (key refused, key required, key needs https),
  MODIFY `W\libs\backend\lane-routing\src\index.ts` (export `DecisionKeySlot` and the
  `DecisionModelKeys` type; Batch 11 imports `DecisionKeySlot`)
- Plan reference: implementation-plan.md:331-333, 310-311, 788-789
- Quality requirements: fixed texts with no host text in them.

### Batch 6 verification

- `T`, `TC` and `L` on `@ptah-extension/lane-routing`; degradation-audit.

## Batch 7: Wire the resolver into the call path, per-target timeout (C5 wiring, C7 timeout) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: making `timeoutMs` required breaks the spec call sites that build targets, so the type change and those call sites go together.
- Tasks: 2 | Depends on: Batch 6
- Phase: 2 | Phase review: code-logic (codex)
- Criteria: 5.2 plumbing, 5.4, 1.5 (DC7 wired)

### Task 7.1: Delegate `resolveSystemOneTarget` and `localityOf` — COMPLETE

- File: MODIFY `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.config.ts`;
  MODIFY `...\decision-model.config.spec.ts` only if an existing locality case changes under DC7
- Plan reference: implementation-plan.md:276-279
- Quality requirements: `SystemOneTarget` becomes the endpoint shape, with `timeoutMs` required.
  A blocked result returns `null` to callers. `localityOf` calls `localityOfSelection` (sync, PD-5).

### Task 7.2: Pass the target timeout through the pipeline — COMPLETE

- Depends on: Task 7.1
- Files: MODIFY `W\libs\backend\lane-routing\src\lib\pipeline\model-refine.ts` (`:89-101`, use `target.timeoutMs`),
  MODIFY `...\pipeline\model-call.spec.ts` (the client gets the target timeout; a timed-out remote
  call falls back, 5.4), MODIFY `W\libs\backend\lane-routing\src\lib\route-decide.preflight.spec.ts`
  (`:169`), MODIFY `...\route-decide.gate.spec.ts` (`:330`)
- Plan reference: implementation-plan.md:330-341
- Quality requirements: the payload field set is unchanged (`decision-payload.spec.ts` passes). No retry.

### Batch 7 verification

- `T`, `TC` and `L` on `@ptah-extension/lane-routing`; degradation-audit.

## Batch 8: Prober and path-preserving URL joins (C6 prober, C7 client join) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: the probe moves out of the config class unchanged and gains an endpoint mode. The
  URL joins in the client and the probe switch to `systemOneUrl` in the same batch.
- Tasks: 2 | Depends on: Batches 3, 7
- Phase: 2 | Phase review: code-logic (codex)
- Criteria: 3.1, 2.3 (path join and header), 1.2 (client header case)

### Task 8.1: `DecisionEndpointProber` — COMPLETE

- Files: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.prober.ts`,
  CREATE `...\decision-model.prober.spec.ts`, MODIFY `...\decision-model.config.ts` (`probe` and
  `send` at `:546-605` move out; the seams are passed in), MODIFY `...\decision-model.probe.ts`
  (`buildProbeUrls` uses `systemOneUrl`)
- Plan reference: implementation-plan.md:289-325
- Quality requirements: endpoint mode skips `checkVersion` and sends Bearer on the route and
  control POSTs only when the endpoint has a key. One 1500 ms budget (DC14). Daemon mode keeps the
  version floor (0.35.0, and 0.40.0 for `laya*`).
- Validation notes: the probe never sends request text and never logs a key.

### Task 8.2: Client URL join — COMPLETE

- Files: MODIFY `W\libs\backend\lane-routing\src\lib\decision-model\system-one.client.ts` (`:124`, and
  the `apiKey` doc comment), MODIFY `...\system-one.client.spec.ts` (path-join and custom-key header cases)
- Plan reference: implementation-plan.md:330
- Quality requirements: all 18 existing cases pass.

### Batch 8 verification

- `T`, `TC` and `L` on `@ptah-extension/lane-routing`; degradation-audit.

## Batch 9: Union widening and consumers that do not branch on kind (atomic compile set) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: PD-1. Every consumer that narrows on `DecisionModelSelection` must change in the
  same commit as the union. Six files in two libraries.
- Tasks: 3 | Depends on: Batches 4, 5, 6, 7, 8
- Phase: 2 | Phase review: code-logic (codex)
- Criteria: 3.2-3.5 wired to status, 1.5 (Ollama Cloud remote), DC9, DC13

### Task 9.1: Widen the union; status switches on probe mode — COMPLETE

- Files: MODIFY `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.types.ts` (add the
  members to `DecisionModelSelectionSchema`), MODIFY `...\decision-model.config.ts`
  (`statusForCurrent`, `applyProbe`, `isMarkedUnsupported`, `recheckAfterLiveNotFound`,
  `currentProbeKey` and `currentRowWithoutProbe` switch on the resolved probe mode; `dto()` sets
  `reportsConfidence` for every System One kind and `apiKeyStored` for `jev` and `custom`),
  MODIFY `W\libs\backend\lane-routing\src\lib\route-decide.service.ts` (`:330-363`: `provider` maps
  `ollama`, `ollama-cloud` and `custom` to `'ollama'`, and `jev` to `'jev'`)
- Plan reference: implementation-plan.md:296-312, 334-335
- Quality requirements: the five-state set is unchanged (3.4). A 401/403 gives `no-credential`.
  Unreachable or a timeout gives `unreachable`. A control match gives `unsupported-endpoint`.

### Task 9.2: Classifier — COMPLETE

- Files: MODIFY `W\libs\backend\lane-routing\src\lib\failure-class\decision-model-failure-classifier.ts`
  (`SystemOneSelection` covers the new kinds, `:104-107,138-140`; URL through `systemOneUrl` at
  `:231`; budget = `target.timeoutMs + DECISION_RETURN_MARGIN_MS`), MODIFY
  `...\decision-model-failure-classifier.spec.ts` (a case for a new kind)
- Plan reference: implementation-plan.md:336-338

### Task 9.3: rpc-handlers selection equality — COMPLETE

- File: MODIFY `W\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (`:293-311`:
  `ollama-cloud` compares `model`; `custom` compares `baseUrl` and `model`)
- Plan reference: implementation-plan.md:410-412
- Validation notes: Batch 11 moves this function into the writer.

### Batch 9 verification

- `NX_NO_CLOUD=true npx nx run-many -t test -p @ptah-extension/lane-routing @ptah-extension/rpc-handlers --parallel=1`
  (header: "2 projects"); `TC` and `L` for both; degradation-audit.
- `TC(@ptah-extension/chat)` as the downstream guard (the shared unions widened in Batch 5).

## Batch 10: Schema and endpoint-status specs (C3 and C6 proofs) — COMPLETE

- Recommended executor: CLI lane, senior-tester profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> senior-tester subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: spec-only proofs of the behaviour Batch 9 wired. They are kept out of Batch 9 so that
  batch stays within the file cap.
- Tasks: 2 | Depends on: Batch 9
- Phase: 2 | Phase review: code-logic (codex), on the combined diff of Batches 6-10
- Criteria: 3.1-3.5, 1.4, 1.6 (DTO sentinel), 2.1 (schema), 2.7 (fresh config reports `apiKeyStored`), 4.5 (fresh profile reads `unset`)

### Task 10.1: `decision-model.types.spec.ts` — COMPLETE

- File: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.types.spec.ts`
- Plan reference: implementation-plan.md:215-216
- Quality requirements: both kinds parse; extra keys, an empty model and a bad base URL are refused
  with the issue path (`baseUrl` or `model`).

### Task 10.2: `decision-model.config.endpoint.spec.ts` — COMPLETE

- File: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.config.endpoint.spec.ts`;
  MODIFY `...\decision-model.config.spec.ts` only to add the fresh-profile `unset` case if it is absent (4.5)
- Plan reference: implementation-plan.md:316-318; traceability :692-708
- Quality requirements: a fake fetch drives 3.1-3.5 for each kind (no `/api/version` in endpoint
  mode); key added or removed between probes (1.4); search every DTO and log for a sentinel key
  (1.6); a fresh config reports `apiKeyStored` (2.7).

### Batch 10 verification

- `T(@ptah-extension/lane-routing)`; `TC(@ptah-extension/lane-routing)`.
- Phase 2 is complete: return NEEDS REVIEW (code-logic) for the combined diff of Batches 6-10.

## Batch 11: Decision-model writer and custom key (C9) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: the write path that rolls back on failure, extracted from a 1746-line file and generalised over key slots.
- Tasks: 3 | Depends on: Batches 2, 3, 6 (export), 9
- Phase: 3 - Write path, catalog and RPC | Phase review: code-logic + style (new public API) (codex)
- Criteria: 2.1, 2.2, 2.4, 2.5, 1.6 (RPC sentinel), D4, DC10

### Task 11.1: Extract `DecisionModelWriter` — COMPLETE

- Files: CREATE `W\libs\backend\rpc-handlers\src\lib\handlers\decision-model-writer.ts`, MODIFY
  `...\agent-rpc.handlers.ts` (`writeDecisionModel`, `storedSelectionState` and
  `sameDecisionModelSelection` at `:293-311,856-936` move out; `setConfigQueue` stays)
- Plan reference: implementation-plan.md:405-415
- Quality requirements: generalised over `DecisionKeySlot`. The restore-failure text is
  `DECISION_MODEL_KEY_MAY_HAVE_CHANGED` for jev and `DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED`
  for custom. Logs carry error types only.

### Task 11.2: Validate before any write — COMPLETE

- Depends on: Task 11.1
- File: `agent-rpc.handlers.ts` (`applySetConfig`, `:618-650`)
- Plan reference: implementation-plan.md:416-421
- Quality requirements: the custom key must be a string. Both key fields together are refused.
  A schema issue path maps to `DECISION_MODEL_INVALID_BASE_URL` or `DECISION_MODEL_INVALID_MODEL`.
  The writer refuses `..._CUSTOM_KEY_NEEDS_ENDPOINT` and `..._KEY_NEEDS_HTTPS`; the effective key is
  the new key, or the stored key bound to the same origin. A failed validation changes nothing (2.2).

### Task 11.3: Specs — COMPLETE

- Files: MODIFY `W\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.decision-model.spec.ts`
  (rollback cases become `describe.each` over both key fields, 2.5), CREATE
  `...\agent-rpc.handlers.decision-endpoint.spec.ts` (2.2, D4, DC10; `getConfig` returns only
  `apiKeyStored`; search logs and DTOs for a sentinel key)
- Plan reference: implementation-plan.md:430-434

### Batch 11 verification

- `T`, `TC` and `L` on `@ptah-extension/rpc-handlers`; degradation-audit.
- `settings:set` still refuses `agentOrchestration.decisionModel` (existing 41j spec passes).

## Batch 12: Decision-model catalog (C8 class) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: a new standalone class with its own boundary schemas. It is not registered yet.
- Tasks: 1 | Depends on: Batches 1, 7. May run concurrently with Batch 11 (disjoint files).
- Phase: 3 | Phase review: code-logic + style (codex)
- Criteria: 4.1, 4.2, 4.3, 4.6

### Task 12.1: `DecisionModelCatalog`, schemas and spec — COMPLETE

- Files: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\decision-model.catalog.ts`,
  CREATE `...\ollama-catalog.schema.ts`, CREATE `...\decision-model.catalog.spec.ts`
- Plan reference: implementation-plan.md:361-403
- Pattern to follow: `auth-providers/.../ollama-model-discovery.service.ts` TTLs (10 min for answers, 60 s for failures)
- Quality requirements: at most 5 `/api/show` calls in flight. The cache is keyed by
  `[baseUrl, name, digest]`, pruned against the latest tag list, and cleared when the base URL
  changes. Cloud fetch: `https://ollama.com/api/tags` with no key, ids passed through `toCloudId`.
  One 4000 ms budget per call. It never rejects, and no host text reaches the result.
- Validation notes: 4.6. Use a fixture without clef, and no model-name literal in the code.
  The spec asserts at most one lookup per model while the TTL holds.

### Batch 12 verification

- `T`, `TC` and `L` on `@ptah-extension/lane-routing`; degradation-audit.
- Searching `decision-model.catalog.ts` for `clef` finds nothing.

## Batch 13: Catalog DI registration and lane-routing exports (C8 wiring) — COMPLETE

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: DI wiring is isolated so that the DI guards run against one small change.
- Tasks: 1 | Depends on: Batch 12
- Phase: 3 | Phase review: code-logic + style (codex)
- Criteria: 7 (the catalog resolves in every host), 4.x

### Task 13.1: Register `DECISION_MODEL_CATALOG` — COMPLETE

- Files: MODIFY `W\libs\backend\lane-routing\src\lib\di\tokens.ts`, `...\di\register.ts`,
  `...\di\register.spec.ts`, `W\libs\backend\lane-routing\src\index.ts` (token and result types)
- Plan reference: implementation-plan.md:384-386
- Pattern to follow: `di/register.ts:84-98` (`instanceCachingFactory`)
- Quality requirements: no network call at registration.
- Added by the orchestrator: `index.ts` also exports `keyTransportAllowed`
  (`decision-endpoint.url.ts`). The Batch 11 writer
  `rpc-handlers/.../decision-model-writer.ts` imports it from `@ptah-extension/lane-routing`
  and its local copy of the D4 rule is deleted, so the rule has one copy.

### Batch 13 verification

- `T`, `TC` and `L` on `@ptah-extension/lane-routing`; then the three DI guards one at a time
  (no edits expected; they must stay green); di-lint; degradation-audit.

## Batch 14: `agent:listDecisionModels` handler and registry (C10, library part) — PENDING

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: the registry entry, manifest entry and handler must land together, or
  `assertManifestInvariants` and `rpc-allowlist.spec.ts` fail. 7 files in two libraries, of which
  two are export lines (Decisions TL-2).
- Tasks: 2 | Depends on: Batches 2, 13
- Phase: 3 | Phase review: code-logic + style (codex)
- Criteria: 4.1-4.3 served over RPC, 7 (all hosts)

### Task 14.1: Handler and spec — PENDING

- Files: CREATE `W\libs\backend\rpc-handlers\src\lib\handlers\decision-model-catalog-rpc.handlers.ts`,
  CREATE `...\decision-model-catalog-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:442-475
- Pattern to follow: `agent-outcome-rpc.handlers.ts:42-60`
- Quality requirements: Zod validates `source`. An unexpected rejection returns
  `filter: 'unavailable'` and logs the error type.

### Task 14.2: Registry, manifest, registration and exports — PENDING

- Depends on: Task 14.1
- Files: MODIFY `W\libs\shared\src\lib\types\rpc.types.ts` (registry entry after `:1306`, name after
  `:3892`), `W\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` (after `agentOutcome`,
  `requires: []`), `...\register-shared-rpc-handlers.ts` (`:84`), `...\handlers\index.ts`, `W\libs\backend\rpc-handlers\src\index.ts`
- Quality requirements: with `requires: []` the method is served on every host, so the
  `*_EXPECTED_ABSENT_METHODS` lists do not change.

### Batch 14 verification

- `J(libs/backend/rpc-handlers, libs/backend/rpc-handlers/src/lib/handlers/decision-model-catalog-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts)`;
  `TC(@ptah-extension/rpc-handlers)`; `TC(@ptah-extension/shared)`; `L` for both; then `T(@ptah-extension/rpc-handlers)`.
- The RPC surface guards (PD-4) and the three DI guards, one at a time; di-lint; degradation-audit.

## Batch 15: VS Code and Electron DI guards (C10 guard part) — PENDING

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: two app projects, the 2-project cap.
- Tasks: 2 | Depends on: Batch 14. May run concurrently with Batch 16.
- Phase: 3 | Phase review: code-logic + style (codex)
- Criteria: 7 (the catalog handler resolves in VS Code and Electron)

### Task 15.1: VS Code guard — PENDING

- Files: MODIFY `W\apps\ptah-extension-vscode\src\di\expected-resolvable.ts` (`DECISION_MODEL_CATALOG_TOKEN`, pattern `:39-47`),
  `W\apps\ptah-extension-vscode\src\di\container.smoke.spec.ts` (resolve assertion)

### Task 15.2: Electron guard — PENDING

- Files: MODIFY `W\apps\ptah-electron\src\di\expected-resolvable.ts` (pattern `:47-53`), `W\apps\ptah-electron\src\di\container.smoke.spec.ts`

### Batch 15 verification

- `J(apps/ptah-extension-vscode, apps/ptah-extension-vscode/src/di/container.smoke.spec.ts)`, then
  `J(apps/ptah-electron, apps/ptah-electron/src/di/container.smoke.spec.ts)`. Never `nx test ptah-electron`.

## Batch 16: CLI DI guard (C10 guard part) — PENDING

- Recommended executor: CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: the third app project, kept apart because of the 2-project cap.
- Tasks: 1 | Depends on: Batch 14. May run concurrently with Batch 15.
- Phase: 3 | Phase review: code-logic + style (codex), on the combined diff of Batches 11-16
- Criteria: 7 (CLI)

### Task 16.1: CLI guard — PENDING

- Files: MODIFY `W\apps\ptah-cli\src\di\expected-resolvable.ts` (pattern `:37-43`), `W\apps\ptah-cli\src\di\container.smoke.spec.ts`

### Batch 16 verification

- `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`. Never `nx test ptah-cli`.
- Phase 3 is complete when Batches 15 and 16 are committed: return NEEDS REVIEW (code-logic and
  style) for the combined diff of Batches 11-16.

## Batch 17: Decision row editor for Ollama Cloud and custom endpoint (C13) — PENDING

- Recommended executor: CLI lane, frontend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> frontend-developer subagent
- Subagent reason: N/A for the implementation. Visual review uses a subagent (see Phase 4 review).
- Review family: codex (code-logic); visual-reviewer subagent (rendered UI)
- Rationale: one Angular row with a new dumb component and a suggestions helper. Signals, OnPush
  and `inject()`, as the row already uses.
- Tasks: 4 | Depends on: Batches 5, 14
- Phase: 4 - Decision row editor | Phase review: code-logic (codex) + visual (visual-reviewer subagent)
- Criteria: 1.1, 2.1, 3.2 (UI), 4.1, 4.3 (help text), 4.4, 4.5

### Task 17.1: `decision-model-key-field.component.ts` — PENDING

- File: CREATE `W\libs\frontend\chat\src\lib\settings\providers\decision-model-key-field.component.ts`
- Plan reference: implementation-plan.md:531-535
- Quality requirements: a password input that is never prefilled; inputs `label`, `value`,
  `disabled`, `showRemove`; outputs `valueChange`, `remove`; the existing labels and `aria-describedby`.

### Task 17.2: `decision-model-suggestions.ts` — PENDING

- File: CREATE `W\libs\frontend\chat\src\lib\settings\providers\decision-model-suggestions.ts`
- Plan reference: implementation-plan.md:536-541
- Quality requirements: `ollama` and `ollama-cloud` call `agent:listDecisionModels`. `structured`
  keeps `PROVIDER_MODELS_LOADER`. `jev` and `custom` stay idle. Help text for `partial` and
  `unavailable`, word for word as in the plan.

### Task 17.3: Row editor — PENDING

- Depends on: Tasks 17.1, 17.2
- Files: MODIFY `W\libs\frontend\chat\src\lib\settings\providers\decision-model-row.component.ts`,
  MODIFY `...\decision-model-row.view.ts` (add the `DECISION_KIND_OPTIONS` entries in the plan's order, Decisions TL-3)
- Plan reference: implementation-plan.md:520-558
- Quality requirements: Ollama Cloud has no key input, shows help text and a "Set up Ollama Cloud"
  action that emits `setupProviderRequested('ollama-cloud')`. Custom endpoint has base URL, model
  (free text) and key field, with inline field errors, and Save is disabled while a field is
  invalid. One `apiKey` signal sends `decisionModelJevApiKey` or `decisionModelCustomApiKey`.
  Nothing is preselected. The "newer request wins" counter stays. No timer or listener is added.

### Task 17.4: Specs — PENDING

- Depends on: Task 17.3
- Files: CREATE `W\libs\frontend\chat\src\lib\settings\providers\decision-model-row.endpoint.spec.ts`,
  MODIFY `...\decision-model-row.component.spec.ts` (selector updates only where the key field moved)
- Quality requirements: covers the preserve-list rows for the row (Jev remove button, setup link, Undo, free text).

### Batch 17 verification

- `J(libs/frontend/chat, libs/frontend/chat/src/lib/settings/providers/decision-model-row.endpoint.spec.ts libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.spec.ts libs/frontend/chat/src/lib/settings/providers/decision-model-row.view.spec.ts)`;
  `TC(@ptah-extension/chat)`; `L(@ptah-extension/chat)`.
- Phase 4 is complete: return NEEDS REVIEW (code-logic and visual). Visual evidence: the row adds
  editors to an existing surface and there is no prototype, so the visual-reviewer captures
  before/after screenshots of Settings -> Agent Orchestration -> Decision model in dark and light
  themes. The "before" comes from the base commit (Batch 0 merge, before Batch 1).

## Batch 18: Persistence proof (C11) — PENDING

- Recommended executor: CLI lane, senior-tester profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> senior-tester subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: one spec file with literal fixtures and no dependencies.
- Tasks: 1 | Depends on: Batch 0. May run at any point after Batch 0; it is placed here for the phase grouping.
- Phase: 5 - Evals, persistence proof and workflow | Phase review: code-logic (codex)
- Criteria: 2.7, 7.1 (no new key, DC2), 7.2

### Task 18.1: Extend the 41i round-trip spec — PENDING

- File: MODIFY `W\libs\backend\platform-core\src\file-settings-manager.spec.ts` (`:243-265`)
- Plan reference: implementation-plan.md:477-491
- Quality requirements: writer -> disk -> fresh reader returns the whole
  `{kind:'ollama-cloud', model:'clef:27b-cloud'}` and
  `{kind:'custom', baseUrl:'https://decide.example.com/gw', model:'m1'}`, with no `.baseUrl` leaf key.

### Batch 18 verification

- `J(libs/backend/platform-core, libs/backend/platform-core/src/file-settings-manager.spec.ts libs/backend/platform-core/src/file-settings-keys.spec.ts)`; `TC(@ptah-extension/platform-core)`.

## Batch 19: Live eval spec (C14) — PENDING

- Recommended executor: CLI lane, senior-tester profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> senior-tester subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: test-only. It is skipped locally without env, and the lane never handles the key.
- Tasks: 2 | Depends on: Batches 8, 9, 12
- Phase: 5 | Phase review: code-logic (codex)
- Criteria: 6.2-6.7, 6.10 and 5.1 (spec side; the numbers come from U1)

### Task 19.1: `system-one.live.fixtures.ts` — PENDING

- File: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\system-one.live.fixtures.ts`
- Plan reference: implementation-plan.md:571-573
- Quality requirements: about 10 routing questions, each with one unambiguous expected `choice`.
  Each body is checked against `SystemOneRequestBodySchema`.

### Task 19.2: `system-one.live.spec.ts` — PENDING

- Depends on: Task 19.1
- File: CREATE `W\libs\backend\lane-routing\src\lib\decision-model\system-one.live.spec.ts`
- Plan reference: implementation-plan.md:560-592
- Pattern to follow: `auth-providers/src/lib/model-lists.live.spec.ts:11-32`
- Quality requirements: skipped unless `PTAH_LIVE_PROBES === '1'` and `OLLAMA_API_KEY` is set.
  Checks: the catalog; both id forms (prints which are accepted, and asserts the `toCloudId` form);
  probe ready and bad key (A2); 3 runs where every fixture must be correct; confidence in [0,1];
  probabilities sum to 1 within 0.01; prints exactly one line
  `DECISION_LIVE_LATENCY {"coldMs":..,"p50Ms":..,"p95Ms":..,"probeMs":..}`; error mapping (auth,
  notFound, timeout); a 30 s client timeout. Never prints the key or headers.

### Batch 19 verification

- `J(libs/backend/lane-routing, libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts)`
  with no env set: the suite reports skipped. Then `TC(@ptah-extension/lane-routing)` and `L(@ptah-extension/lane-routing)`.

## Batch 20: Live eval workflow (C15) — PENDING

- Recommended executor: CLI lane, devops-engineer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> devops-engineer subagent
- Subagent reason: N/A
- Review family: codex
- Rationale: one workflow file modelled on `model-lists-probe.yml`.
- Tasks: 1 | Depends on: the Batch 19 file name (fixed above). May run concurrently with Batch 19.
- Phase: 5 | Phase review: code-logic (codex), on the combined diff of Batches 18-20 (the workflow handles a secret)
- Criteria: 6.8, 6.9

### Task 20.1: `.github/workflows/decision-model-live-eval.yml` — PENDING

- File: CREATE `W\.github\workflows\decision-model-live-eval.yml`
- Plan reference: implementation-plan.md:594-617
- Pattern to follow: `W\.github\workflows\model-lists-probe.yml` (whole file)
- Quality requirements: triggers are only `workflow_dispatch` and `schedule: '41 5 * * 1'`. Least
  permissions (`actions: read`, `contents: read`, `issues: write`). A concurrency group with no
  cancel. When the secret is missing: a `::notice` names `OLLAMA_API_KEY`, the job ends green and
  opens no issue. The issue step runs only on a keyed failure, keeps one issue, and redacts the
  output if it contains the key (`grep -qF`).

### Batch 20 verification

- `rg -n "system-one.live|PTAH_LIVE_PROBES|decision-model-live-eval" .github/workflows/ci.yml` returns nothing (6.9).
- The workflow has no `pull_request` or `push` trigger. YAML structure is checked by review.
- Phase 5 is complete: return NEEDS REVIEW (code-logic) for the combined diff of Batches 18-20.
- Then the user runs step U1 (below) before Batch 21 starts.

## Batch 21: Remote timeout calibration and live-result fixes (C16) — PENDING

- Recommended executor: Task 21.1 orchestrator (records numbers the user shared; no agent handles
  the key); Tasks 21.2 and 21.3 CLI lane, backend-developer profile (non-codex)
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: codex (only if Task 21.3 applies)
- Rationale: user choice, final small batch: the plan's formula is applied once U1 numbers arrive.
- Tasks: 3 | Depends on: Batch 19 committed, plus U1 result
- Phase: 6 - Calibration and docs | Phase review: none if only the constant changes
  (measurement); code-logic (codex) if any Task 21.3 fix applies
- Criteria: 5.1, 5.2, 5.3, 6.10, and 6.4/6.5/6.7 results

### Task 21.1: Record the live result in `test-report.md` — PENDING

- File: `test-report.md` in the task folder (orchestrator or senior-tester writes it from the
  user's shared output: the `DECISION_LIVE_LATENCY` line, the accepted id form, pass/fail per case)
- Quality requirements: cold, warm p50 and p95 (5.1); the accepted hosted id (6.10); the margin, when 5.3 applies.

### Task 21.2: Apply the timeout formula — PENDING

- Depends on: Task 21.1
- File: MODIFY `W\libs\backend\lane-routing\src\lib\routing-constants.ts` (only if 5.2 applies)
- Plan reference: implementation-plan.md:619-635
- Rule: if `p95 <= 3000` and `cold <= 3000`, keep 3000 and record the margin. Otherwise
  `REMOTE = min(8000, max(3000, roundUpTo500(max(1.5 x p95, 1.2 x cold))))`, with the numbers cited
  in this batch header. If the formula gives more than 8000, keep 8000, record that cold calls fall
  back, and open a follow-up. Local stays 3000.

### Task 21.3: Conditional fixes from the live result (A1, A2, A4) — PENDING

- Applies only if U1 shows: A1 false (strip the suffix on the direct path in
  `decision-model.target.ts`, plus a spec case); A2 false (endpoint-mode status reads key presence,
  in `decision-model.config.ts`, plus a spec case); A4 false (relax `.strict()` on the answer object
  only, in `system-one.schema.ts`, plus a spec case). Otherwise record "not needed".

### Batch 21 verification

- `T`, `TC` and `L` on `@ptah-extension/lane-routing` (if code changed); degradation-audit.
- If Task 21.3 applied, ask the user to re-run U1 once to confirm.

## Batch 22: Documentation correction (C17) — PENDING

- Recommended executor: CLI lane, backend-developer profile (non-codex), docs only
- Execution mode: sequential
- Fallback order: other non-codex family -> same family other model -> backend-developer subagent
- Subagent reason: N/A
- Review family: N/A (docs only)
- Rationale: dated notes in two task-646 files, which exist on `main` only after #731.
- Tasks: 1 | Depends on: Batch 0. May run at any point after Batch 0.
- Phase: 6 | Phase review: none (docs only)
- Criteria: 9.1

### Task 22.1: Dated correction notes — PENDING

- Files: MODIFY `W\.ptah\specs\TASK_2026_646_136a\research-decision-models.md` (under `:209` and
  `:545`), MODIFY `W\.ptah\specs\TASK_2026_646_136a\task-description.md` (beside `:125-126`)
- Plan reference: implementation-plan.md:637-648
- Quality requirements: dated 2026-10-16 or later; cites this task's `context.md` "Ollama Cloud
  API"; the original text stays.

### Batch 22 verification

- Diff review only: the notes are added and no original line is removed.

## User-run steps (no agent handles any key)

- U1, local keyed live run. After Batch 19 is committed, the user runs it once in PowerShell from `W`:
  `$env:PTAH_LIVE_PROBES='1'; $env:OLLAMA_API_KEY='<your ollama.com key>'`, then
  `npx jest -c libs/backend/lane-routing/jest.config.ts libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts --coverage=false --maxWorkers=2`,
  then `Remove-Item Env:OLLAMA_API_KEY; Remove-Item Env:PTAH_LIVE_PROBES`. The user shares only the
  `DECISION_LIVE_LATENCY {...}` line, the id-form line, and the pass/fail summary. These feed Batch 21 (5.1, 6.10).
- U2, our own setup. After merge and release to the user's build: Settings -> Agent Orchestration ->
  Background Model Roles -> Decision model -> Ollama Cloud -> choose clef from the filtered list,
  using the existing Ollama Cloud key. Confirm the row shows `ready` and `remote`. Keep
  `skillSynthesis.enabled = false`. Run one `/orchestrate` Pre-flight and report whether its source
  was the decision model; the orchestrator records it in `test-report.md` (8.1, 8.2).
- U3, repository secret. The user adds the `OLLAMA_API_KEY` Actions secret (8.3). After merge, the
  user or orchestrator dispatches `decision-model-live-eval.yml` once (`gh workflow run
  decision-model-live-eval.yml`) and confirms it is green (6.8, A5). Before the secret exists, a
  dispatch must end green with the notice.

## Mode 3 completion checks (pre-recorded)

- Preserve list: each row above is present, with a passing spec.
- Visual: before/after screenshots in dark and light (Phase 4); there is no prototype.
- Write-path trace:
  - Selection: `setConfiguration('ptah', 'agentOrchestration.decisionModel')`, a file-based whole
    object (41i). Reader: `DecisionModelConfig.getSelection()`.
  - Custom key: `ptah.laneRouting.customEndpointApiKey` holds JSON `{origin, key}`. Reader:
    `DecisionModelKeys.get('custom', origin)`. It is outside `ptah.auth.`, so it never triggers SDK
    re-auth (`provider-key-slots.ts:60-64`).
  - Jev slot: unchanged.
  - `ptah.auth.provider.ollama-cloud`: read only, never written by this task.
- Criteria 8.1-8.3 close only through U2 and U3. Mode 3 lists them as user-pending if they have not happened yet.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| TL-1 | "Widen last": the member schemas are added first (Batch 3); shared widens together with the chat helpers (Batch 5); the lane-routing union widens in one compile set (Batch 9) | follow the plan's component order and accept red intermediate commits / widen last | PD-1 evidence; the TL rule that each batch passes its scoped checks | Yes |
| TL-2 | File-cap exceptions: Batch 4 (9 files, the atomic Jev slot switch) and Batch 14 (7 files, registry, manifest and handler must land together) | split them and leave non-compiling or invariant-failing commits / exception | PD-2; `assertManifestInvariants` and `rpc-allowlist.spec.ts:41` ("claims every registry method exactly once") | Yes |
| TL-3 | `DECISION_KIND_OPTIONS` gets its new entries only in Batch 17 | Batch 5 / Batch 17 | No intermediate build offers a kind the host refuses before Batches 9 and 14 | Yes |
| TL-4 | `DecisionKeySlot` is exported in Batch 6, before the writer (Batch 11) imports it | Batch 3 / Batch 6 / Batch 13 | Plan :783-784; keeps Batch 3 at 6 files | Yes |
| TL-5 | Six review phases: 1 (B1-5), 2 (B6-10), 3 (B11-16, plus style), 4 (B17, plus visual), 5 (B18-20), 6 (B21-22: none unless Task 21.3 applies). Reviewer: codex lane | one phase / per library / per risk boundary | TL risk-based review rule; codex is reserved for reviews | Yes |
| TL-6 | The remote timeout ships at 3000 ms until U1; Batch 21 applies the formula | wait for U1 / ship 3000 and calibrate | User choice (local run); plan "Needs the user" option (a) | Yes |
| TL-7 | Persistence proof (B18) and docs (B22) are independent and may run at any point after Batch 0 | fixed slot / floating | No code dependency | Yes |
