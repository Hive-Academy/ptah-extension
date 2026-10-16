# Code Style Review - P1 Foundations - `TASK_2026_646_136a`

Review family: Anthropic (Claude Sonnet 5.5). Implementers were Zhipu (Glm: Batches 2, 4, 7), xAI (grok: Batch 1) and OpenAI (codex: Batches 3, 5), so for those batches the reviewer is a different family. Commit `566fa772c` was written by the orchestrator (Anthropic), the same family as this reviewer. Treat the verdict on that commit as weaker evidence. Reason: it is a bounded orchestrator hook-unblock fix, and nobody outside the family has read it yet.

Scope: `git diff 7ea895538 78e8fddfb -- . ':!.ptah'`, which covers Batches 1, 2, 3, 4, 5, 7 and 9 plus `566fa772c` and `78e8fddfb`. 69 files, 20 of them reported as unformatted below. Every non-spec source file was read in full. Specs were read only where a claim depended on them. No Nx or Jest was run. I ran `ptah_get_diagnostics` on three files (0 errors) and `prettier --stdin-filepath` against the committed blobs. The P1 code-logic review (`reviews/p1-code-logic-review.md`) is not repeated here. I reference it for the RPC dev-boot state (FM-3).

## Summary

| Metric          | Value                               |
| --------------- | ----------------------------------- |
| Overall score   | 7/10                                |
| Assessment      | APPROVED (with moderate follow-ups) |
| Blocking issues | 0                                   |
| Serious issues  | 0                                   |
| Moderate issues | 11                                  |
| Minor issues    | 9                                   |
| Files reviewed  | 69 changed files (about 45 source) + 6 sibling comparisons |

Score rationale. The boundary and wiring work is sound.
- Tags are `scope:extension` + `type:feature`, the same as `skill-synthesis`.
- Tokens are `Symbol.for` in `di/tokens.ts`.
- The logger is structural (SC-9) and nothing imports `vscode-core` into the new lib.
- Migrations follow the 0037/0053 header and static-SQL conventions.
- `matrix.schema.ts` is the model for how the contracts should be written (`satisfies z.ZodType<...>`, constants imported).

It is not 8+ because the same facts are spelled out two or three times in different places, with no compile-time tie between the copies (Moderate 2, 3, 4, 5). Twenty of the P1 files were committed unformatted (Moderate 1). A few wiring choices differ from the nearest sibling (Moderate 6, 7, 8).

The line between 7 and 8 is the duplicated-literal cluster. Each copy is correct today, and each is cheap to fix now. It will be expensive once the router, outcomes and the skill all depend on them.

## Five style questions

### 1. What breaks in six months?

- A seventh task kind added to `OUTCOME_TASK_KINDS` (`libs/shared/src/lib/types/lane-outcome.types.ts:17-24`) compiles everywhere and then drifts silently.
  - `ROTATION_TASK_KINDS` (`routing-constants.ts:80-87`) is a hand copy of the list, and `RotationTaskKind` is a second type for the same union.
  - `MatrixCellsSchema` (`matrix.schema.ts:92-99`) lists the six keys by hand. The `satisfies z.ZodType<MatrixCells>` makes this one compile-checked, so it is fine.
  - The spawn schema and result schema are tied to the shared constant correctly (`agent-spawn-args.schema.ts:45`, `route-decide-result.schema.ts:67`).
- `['model', 'ranking', 'pin']` is spelled out in three places (see Moderate 4). Adding a routing source touches three files with no failing compile.
- `route-decide-result.schema.ts` hard-codes `max(2)` for requests (`:107`) and `0..100` for score (`:65`) instead of `MAX_DECISION_REQUESTS` and `SCORE_MIN/SCORE_MAX` (`routing-constants.ts:17-18,128`). Retuning a constant leaves the response schema rejecting valid results at runtime.
- The `ptah-run: runId=subagent:<agentId>` tag (`subagent-run-tag.ts:36`) is a wire format. Its reader will live in lane-outcomes or the skill. Writer and reader have no shared builder, so a rename breaks the join with no test failing.

### 2. What would a new team member misread?

- `LaneOutcomeRecord` is documented as "as the outcome pipeline persists it" (`lane-outcome.types.ts:65`). Three of its fields (`telemetryJoin`, `skillsLoaded`, `sessionEvidenceClass`, lines 99-103) have no column in migration 0054. The SQLite store defaults them (`sqlite-lane-outcome.store.ts:65-66`). The type reads as a row mirror, and it is not.
- `SubagentBudgetStopCallbackRegistry` sits next to `SubagentStopCallbackRegistry` with no doc comment saying when it fires (a budget stop, not an SDK SubagentStop) or why a second registry exists (`subagent-budget-stop-callback-registry.ts:15-21`).
- `CliDetectionResult.family?` reads as a property of every row, but it is filled in only by `agent-namespace.builder.ts`. The formatter then prints `N/A` for a value the pure function could compute (`mcp-response-formatter.ts:1746`).
- Comments cite plan letters ("part A §3", "S scale, B band, T tie-break, K rotation key", `routing-constants.ts:3-7`; `matrix.types.ts:4`). Those letters mean nothing once the task folder is archived.

### 3. What does this cost to maintain?

- Every migration costs about 14 hand-edited `toBe(55)` ratchet assertions (the 14 specs in the Batch 4 stat). That is the existing convention, and P1 continues it without making it worse. A shared `LATEST_MIGRATION_VERSION` would remove it, but that is out of scope here.
- `LaneRoutingLogger` and `LaneOutcomeLogger` (working tree, P2) are identical interfaces. SC-9 sanctions this, and the rule of three says wait for a third user.
- `routing-constants.ts` exports 36 names through the public barrel (`index.ts:13-47`) although nothing outside the lib needs them yet. Each one is public API to keep.
- Formatter drift: 20 P1 files need a `format:write` pass, so the first person to touch any of them gets unrelated diff noise (Moderate 1).

### 4. Where is this inconsistent with the rest of the repository?

- The helpers barrel is skipped for the new registry (`agent-sdk/src/index.ts:142-146` against `helpers/index.ts:104-105`, where `SubagentStopCallbackRegistry` is exported).
- `PostToolUseHookHandler` types its registry parameter with an inline structural literal (`post-tool-use-hook-handler.ts:76-79`). `SubagentHookHandler` (`subagent-hook-handler.ts:67-68`) and `SessionLifecycleManager` (`session-lifecycle-manager.ts:375-376`) inject the same token typed as `SubagentRegistryService`.
- Inside `lane-routing`, `matrix.schema.ts` uses `satisfies z.ZodType<T>` and constants. `route-decide-result.schema.ts` does neither. Its private schemas (`Confidence`, `Cause`, `Excluded`, `Usage`, `Answer`, lines 32-123) have no `Schema` suffix, while `PhaseSchema` and `PinSchema` in the sibling file do.
- The new smoke assertions live inside unrelated tests (Moderate 8).

### 5. What would I have done differently?

- Export one `SPAWN_ROUTING_SOURCES` const from shared and derive the type, the spawn schema and the result schema from it. The plan prescribes the inline literal (SC-6), but plan R4j already commits to a single task-kind union, and the same argument applies here.
- Build the run id in one place. Add `subagentRunId(agentId)` next to `SUBAGENT_LANE_ID` in shared. Both the tag writer and the lane-outcomes recorder call it, and the tag prefix becomes a named constant.
- Split `LaneOutcomeRecord` into the persisted row (`LaneOutcomeRow`) and the read-time join fields. Or document on each of the three fields that it is not stored.
- Compute family in the formatter with `laneFamilyOf(agent)` and keep `CliDetectionResult.family` only if some consumer cannot import the helper.
- Run `format:write` over the 20 files before the next batch lands.

## Blocking issues

None. No `eslint-disable` of `@nx/enforce-module-boundaries` (checked the lane-routing eslint config and every changed file). No `vscode-core` import in `lane-routing` (grep clean). No deep `/src/` cross-lib paths (the `agent-sdk` barrel export at `index.ts:142-146` is intra-lib). No `any`, `@ts-ignore` or `as unknown as` in non-spec P1 sources.

## Serious issues

None. The nearest candidate, the RPC method added without a manifest owner, is the known R-5 interim state (`batches.md:112`). It is rated Moderate 11 for the same reason as the logic review (D-1).

## Moderate issues

### 1. Twenty P1 files are not Prettier-clean at `HEAD`

- Evidence: `git show 78e8fddfb:<file> | npx prettier --stdin-filepath <file>` differs from the committed blob for 20 files. The files are:
  - `apps/ptah-cli/src/di/container.smoke.spec.ts`
  - `apps/ptah-electron/src/di/container.smoke.spec.ts`
  - `libs/backend/agent-sdk/src/lib/helpers/subagent-run-tag.ts`
  - four agent-sdk specs (`subagent-budget-monitor`, `post-tool-use-hook-handler`, `subagent-budget-stop-callback-registry`, `subagent-run-tag`)
  - `libs/backend/lane-routing/README.md`
  - `libs/backend/lane-routing/src/index.ts`
  - `libs/backend/lane-routing/src/lib/routing-constants.ts`
  - `libs/backend/lane-routing/src/lib/route-candidate-source.port.ts`
  - `libs/backend/lane-routing/src/lib/contracts/contracts.spec.ts`
  - four persistence-sqlite files (migrations 0054 and 0055, each with its spec)
  - `libs/shared/src/lib/types/lane-outcome.types.ts`
  - `libs/shared/src/lib/types/rpc/rpc-lane-outcome.types.ts`
  - `libs/shared/src/lib/utils/lane-family.ts`
  - `libs/shared/src/lib/utils/lane-family.spec.ts`
- Several end without a trailing newline. `subagent-run-tag.ts:17-36` has unwrapped long lines.
- `78e8fddfb` formatted only Batch 5, 7 and 9 files. Batches 1 to 4 escaped the `.lintstagedrc.mjs` `nx format:write` step.
- Impact: formatting is owned by tooling, so this is not a style opinion. There is no CI format gate (`sync-release-branch.yml:8`), so nothing will catch it. The next lint-staged run on any of these files reformats them inside an unrelated diff.
- Fix: `npx nx format:write --files=<the 20 paths>`. Commit it as `style(...)` the way `78e8fddfb` did. Check whether the Batch 1-4 commits ran with hooks skipped.

### 2. `ROTATION_TASK_KINDS` is a hand copy of `OUTCOME_TASK_KINDS`

- File: `libs/backend/lane-routing/src/lib/routing-constants.ts:80-89`.
- Problem: the six-element list and a second type, `RotationTaskKind`, duplicate the shared constant and its `OutcomeTaskKind` type. Plan R4j (`implementation-plan.md:667`) says "the single task-kind union is `OUTCOME_TASK_KINDS` in shared, which ... its rotation key K import".
- Impact: this is the drift hazard in Five questions 1.
- Fix: `import { OUTCOME_TASK_KINDS, type OutcomeTaskKind } from '@ptah-extension/shared'`. Define the rotation key as `${phaseId}|${OutcomeTaskKind}`. Delete `ROTATION_TASK_KINDS` and `RotationTaskKind`, and remove them from `index.ts:33,40`.

### 3. The route-decide result schema re-states constants and drops the type tie

- File: `libs/backend/lane-routing/src/lib/contracts/route-decide-result.schema.ts`. Hard-coded literals:
  - `:65` score `.min(0).max(100)`, which is `SCORE_MIN`/`SCORE_MAX`
  - `:107` `requests ... .max(2)`, which is `MAX_DECISION_REQUESTS`
  - `:55` `z.enum(['lane','subagent'])`, which is `TIE_BREAK_EXECUTOR_KIND_ORDER` (the same two kinds)
  - `:5-30` the local const arrays `FALLBACK_CAUSES`, `EXCLUSION_RULES` and `PROVENANCE`. `PROVENANCE` overlaps the `LaneModelEntry.provenance` union (`lane-model-listing.port.ts:5`) plus `lane-default`, with no compile tie.
- Sibling: `matrix.schema.ts:36,41-47,85-99` imports `SCORE_MIN`, `SCORE_MAX` and `MINIMUM_SAMPLE_COUNT`, and ends every schema with `satisfies z.ZodType<...>`.
- Fix: import the constants. Declare `ChosenEntry`, `UnavailableEntry` and the result types as interfaces (or as the schemas' `z.infer`) and add the same `satisfies`. Derive `LaneModelEntry['provenance']` from `PROVENANCE` (`Exclude<..., 'lane-default'>`).
- Also rename the private schemas with the `Schema` suffix (`ConfidenceSchema`, `UsageSchema`, and so on) to match `PhaseSchema` and `PinSchema` in the sibling file.

### 4. The "routed by" triple `['model','ranking','pin']` has three owners

- Files:
  - `libs/shared/src/lib/types/agent-process.types.ts:212,303-318` (`Exclude<OutcomeRoutingSource, 'not-routed'>`, which is tied to the constant)
  - `libs/backend/vscode-lm-tools/.../agent-spawn-args.schema.ts:50` (literal)
  - `libs/backend/lane-routing/.../route-decide-result.schema.ts:66` (literal, the `source` field of `ChosenEntrySchema`)
- Problem: only the shared copy follows `OUTCOME_ROUTING_SOURCES`. The two Zod copies cannot fail a compile when the source list changes. SC-6 itself prescribes the literal (`implementation-plan.md:240`), so the plan is the origin.
- Fix: in shared, `export const SPAWN_ROUTING_SOURCES = OUTCOME_ROUTING_SOURCES.filter(...) as ...`, or simply declare `['model','ranking','pin'] as const` and derive `OUTCOME_ROUTING_SOURCES` from it by appending `'not-routed'`. Use that constant in both schemas. This is a plan amendment to SC-6, and it is reversible.

### 5. The run-id and tag format has no single owner

- Files: `libs/backend/agent-sdk/src/lib/helpers/subagent-run-tag.ts:36` and `libs/shared/src/lib/types/lane-outcome.types.ts:58,67-68`.
- Problem: the tag writes the literal `` `ptah-run: runId=subagent:${agentId}` ``. The shared contract defines `SUBAGENT_LANE_ID = 'subagent'` and documents the subagent runId as `subagent:${agentId}`. The `subagent:` prefix is built twice (here and in the future lane-outcomes recorder) from two sources of truth. `ptah-run: runId=` is a wire prefix that an unseen reader must parse, and it is neither a named constant nor documented. `subagent-run-tag.ts` has no JSDoc on any export, and the `AGENT_ID` regex is unexplained.
- Fix: add `subagentRunId(agentId)` to `libs/shared/src/lib/utils/` beside `lane-family.ts`, and export `RUN_TAG_PREFIX`. Use both in the tag writer and in lane-outcomes. Add a short doc comment saying what consumes the tag.

### 6. The registry parameter in `PostToolUseHookHandler` bypasses the established type

- File: `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts:76-79`.
- Problem: an inline `{ get(toolCallId: string): { agentId: string } | null | undefined }` replaces `SubagentRegistryService`. The file already imports `Logger`/`TOKENS` from `vscode-core` (`:2-3`), and its sibling handlers inject the class type for the same token (see Five questions 4). The inline literal also allows `undefined`, which the real `get` never returns (`subagent-registry.service.ts:379`, returns `SubagentRecord | null`). So a reader cannot tell which contract is promised.
- Fix: `private readonly subagentRegistry?: Pick<SubagentRegistryService, 'get'>`, with `import type { SubagentRegistryService } from '@ptah-extension/vscode-core'`.

### 7. The budget-stop registry skips the helpers barrel and has no explanatory doc

- Files: `libs/backend/agent-sdk/src/index.ts:142-146`, `libs/backend/agent-sdk/src/lib/helpers/subagent-budget-stop-callback-registry.ts:15-21`.
- Problem: the top-level barrel exports straight from the deep file. All 12 other registries are exported from `helpers/index.ts` first and re-exported (`helpers/index.ts:64-154`). The class has no comment, and its payload (`:8-12`) deliberately omits `workspaceRoot`, unlike `SubagentStopPayload`.
- Fix: add the export to `helpers/index.ts` next to `SubagentStopCallbackRegistry` (`:104`) and re-export from `./lib/helpers` in `index.ts`. Add a doc comment: "fires when SubagentBudgetMonitor stops a subagent for budget, not on SDK SubagentStop".

### 8. The container smoke assertions are in the wrong tests and are weak

- Files: `apps/ptah-electron/src/di/container.smoke.spec.ts:327-328` and `apps/ptah-cli/src/di/container.smoke.spec.ts:426`.
- Problem:
  - The Electron assertion sits inside the test "resolves SDK_PROCESS_SPAWNER ... (plan Assumption 1)", before the spawner assertion. A failure there would be reported as a spawner problem.
  - The CLI assertion is in the shared container-builder helper that every test in the file runs through, for a describe about the session-organization recorder.
  - `resolve()` throws when the token is unbound, so `toBeDefined()` adds nothing.
- Fix: one dedicated `it('binds SDK_SUBAGENT_BUDGET_STOP_CALLBACK_REGISTRY as a singleton')` in each file. Mirror `wire-runtime.spec.ts:312-318`, which asserts same-instance resolution for `SDK_SUBAGENT_STOP_CALLBACK_REGISTRY`.

### 9. `LaneOutcomeRecord` declares fields the 0054 table does not persist

- Files: `libs/shared/src/lib/types/lane-outcome.types.ts:65,99-103` and `libs/backend/persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.ts:36-65`.
- Problem: `telemetryJoin`, `skillsLoaded` and `sessionEvidenceClass` have no column. `family` is documented as the nullable-column exception (`:9-12`), which implies the rest map one to one. The store papers over it (`sqlite-lane-outcome.store.ts:65-66`, P2). The plan has the same shape (`implementation-plan.md:118-120`), so this is a legibility finding and not a deviation.
- Fix: say on the type, field by field, "read-time join, not stored". Better, split the persisted fields into `LaneOutcomeRow` and make `LaneOutcomeRecord extends LaneOutcomeRow` with the three joins. Do this before lane-outcomes P2 hardens the shape.

### 10. `CliDetectionResult.family?` stores a value a pure function already derives

- Files: `libs/shared/src/lib/types/agent-process.types.ts:409-415`, `libs/backend/vscode-lm-tools/.../agent-namespace.builder.ts:479-485`, `mcp-response-formatter.ts:1746`.
- Problem: `laneFamilyOf` takes a `CliDetectionResult` as is (`lane-family.ts:1-10`), so the stored copy adds a second source of truth and an `N/A` state the function would never return. Consumers that obtain rows from anywhere except this builder silently get `undefined`. Plan AB1 added the field (`implementation-plan.md:733`).
- Recommendation: let the formatter and the future `RouteCandidateSource` call `laneFamilyOf(row)` directly. Keep the stored field only if a webview consumer cannot import the helper. Reversible.

### 11. `agent:outcomeSignals` lands with no manifest owner, so host surface specs are red until Batch 25

- Files: `libs/shared/src/lib/types/rpc.types.ts:1383-1390,3888`, `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` (no entry), `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:210-215`.
- Problem: the logic review already covers the dev-boot throw (FM-3). The style side is that `'partitions the RPC registry with no overlap or gap'` asserts `registered + excluded === RPC_METHOD_NAMES.length`. That assertion fails while `agent:outcomeSignals` has neither a manifest entry nor an expected-absent line. The sibling `agent:getLanePlanLimits` was added with its manifest entry (`manifest.ts:463-465`), `capabilities.ts:82-84` and the expected-absent lists in the same change.
- Impact: the interim red state is staged (R-5), but it also means the VS Code, cli-engine and Electron surface specs cannot serve as per-batch gates for the batches in between.
- Fix: no change needed in P1, but record in `batches.md` that those three spec files are known-red until Batch 25. Alternatively, add the manifest entry with a stub owner and the expected-absent lines in the same batch as the contract. Reversible.

## Minor issues

1. `libs/backend/lane-routing/src/lib/routing-constants.ts:153-168` throws at module load (`assertRoutingConstantInvariants()`). It guards compile-time constants, so a failing build and a throwing import are both caught late. A unit test pinning `CLOSENESS_BAND < gap` is the usual form here, and it keeps the barrel free of import side effects.
2. `libs/backend/lane-routing/src/index.ts:13-47` publishes 36 tuning constants and no port, schema or matrix type yet. `LaneModelListing`, `RouteCandidateSource`, `RouteDecideArgsSchema` and the matrix types exist (Batches 5 and 9) but are unreachable through the `@ptah-extension/lane-routing` alias. The plan stages this ("A8 owns the index edits", `batches.md:364`), but Batch 24-style adapters in `rpc-handlers` need `LaneModelListing` from the barrel. Export it with the batch that first consumes it, and prune the constants no host reads (`ROTATION_*`, `TIE_BREAK_*`, `PROVIDER_OPTION_LIMIT`).
3. `routing-constants.ts:107-111` `PROVIDER_OPTION_LIMIT` (`ollama: 26`, `jev: 255`, `structuredOutput: 8`) carries no source or reason. Add a one-line citation per number. It also mixes provider names with a mechanism name.
4. `libs/backend/lane-routing/src/lib/contracts/route-decide-args.schema.ts:4,17` exports `PHASE_KINDS` and `DEPTHS` with generic names. Both will collide in meaning with the shared task vocabulary (`TASK_TYPES`, depth in the skill) as soon as the barrel exposes them. Prefix them (`ROUTE_PHASE_KINDS`, `ROUTE_DEPTHS`).
5. `libs/backend/lane-routing/src/lib/matrix/seed-matrix.ts:72` `isStale` is general matrix logic (the local-cell builder needs the same rule, per `matrix.types.ts:41`) but lives in the seed file. Move it to a `matrix/staleness.ts` before a second caller imports the seed module for it.
6. `libs/shared/src/lib/types/lane-outcome.types.ts:15` and `agent-process.types.ts:9-12` import each other. The imports are type-only and erased, and the repo has no cycle lint. Moving `OutcomeTaskKind` and `OutcomeRoutingSource` into the smaller file, or `AgentStatus` into a third, removes the cycle.
7. `libs/backend/lane-routing/README.md` and `src/index.ts:1-4` say the lib "may import only shared and platform-core". Contracts import `zod` (allowed by rule 9). Neither says so. No ESLint rule enforces rule 9 either: `depConstraints` permit any `scope:extension` lib, so the guarantee depends on review. Consider a `no-restricted-imports` entry for `@ptah-extension/vscode-core` in `libs/backend/lane-routing/eslint.config.mjs` (the file's comment already discusses this shape).
8. `libs/backend/lane-routing/src/lib/di/tokens.ts:11-36` declares nine tokens, of which five have no implementation yet (`ROUTE_DECIDE_SERVICE`, `CAPABILITY_MATRIX_STORE`, `ROTATION_STORE`, `FAILURE_CLASSIFIER` and `DECISION_MODEL_CONFIG`), and the `LaneRoutingDIToken` type (`:34-36`) is unused. The plan fixes the token surface (SC-3, SC-9), so this is staged. Remove `LaneRoutingDIToken` if no consumer appears by P2.
9. The commit `566fa772c` mixes behaviour with churn: it reflows the untouched "agent ids disagree" `warn` block and the `if (...)` conditions while fixing the catch. The reflow is Prettier-only and harmless, but a reader of the diff has to find the one real change.

## File-by-file

### `libs/shared/src/lib/types/lane-outcome.types.ts`

Score 8/10, 0 B / 0 S / 2 M (Moderate 9, Minor 6). Well-commented, closed unions derived from `as const` arrays, `Pick` for the summary, and the privacy rule is stated once at the top. The port interfaces (`LaneOutcomeReader`, `LaneFailureClassifier`) are in shared as SC-2 and SC-4 prescribe. This is the right boundary choice: it keeps lane-routing from importing lane-outcomes. Not formatted (Moderate 1).

### `libs/shared/src/lib/types/rpc/rpc-lane-outcome.types.ts` and `rpc.types.ts`

Score 8/10, 0 / 0 / 1 M (Moderate 11). The new contract is split into its own domain file, as the oversized `rpc.types.ts` (4,241 lines) requires. The registry entry and allow-map entry are added in the order the neighbours use (`rpc.types.ts:1383-1390,3888`). The header names the no-text rule and the sibling contract it follows. `slugs: string[]` is mutable in a type where the rest of the file is `readonly`, but sibling RPC param types do the same, so no finding.

### `libs/shared/src/lib/types/agent-process.types.ts`, `utils/lane-family.ts`, `utils/index.ts`

Score 8/10, 0 / 0 / 1 M (Moderate 10). `readonly` is used for fields set at spawn, and mutable only for the lifecycle fields (`stopReason`, `failureKind`), matching the file's own pattern. `laneFamilyOf` is pure, documented and structural-input, and its spec pins the fallbacks.

### `libs/backend/lane-routing/` scaffold (`project.json`, tsconfigs, `jest.config.ts`, `eslint.config.mjs`, README, `di/tokens.ts`, `lane-routing-logger.ts`)

Score 8/10, 0 / 0 / 0 M, with Minor 7 and 8. A line-for-line match of `skill-synthesis` (`project.json`, `jest.config.ts`, tsconfigs), minus the host externals (`vscode`, `better-sqlite3`, `sqlite-vec`), which is correct for a host-neutral lib. The structural logger is typed so the vscode-core `Logger` satisfies it (`logger.ts:123-160`). `LANE_ROUTING_TOKENS` follows the `Symbol.for` plus `as const` convention. The `.port.ts` suffix is established (cli-agent-runtime, agent-sdk, harness-sync, memory-contracts). The ports are not `I`-prefixed, which agrees with the lib-local ports and not with the platform-core interfaces.

### `libs/backend/lane-routing/src/lib/routing-constants.ts`

Score 7/10, 0 / 0 / 1 M (Moderate 2), Minor 1, 2, 3. Good doc comments, `satisfies` against `LaneLimitState`, and derived budgets. The duplicated task-kind list and the load-time throw are the issues. Not formatted.

### `libs/backend/lane-routing/src/lib/contracts/route-decide-args.schema.ts`

Score 8/10, 0 / 0 / 0 M (Minor 4). `.strict()` everywhere, bounded lengths and arrays, `superRefine` for the cross-reference checks, and Zod used at the boundary. The `8000` and `100` limits are inline but have one use each.

### `libs/backend/lane-routing/src/lib/contracts/route-decide-result.schema.ts`

Score 6/10, 0 / 0 / 2 M (Moderate 3 and 4). Correct and strict, but it is the one file in the lib where constants, `satisfies`, and naming conventions all depart from the sibling.

### `libs/backend/lane-routing/src/lib/matrix/matrix.types.ts`, `matrix.schema.ts`, `seed-matrix.ts`

Score 9/10, 0 / 0 / 0 M (Minor 5). The model file for the lib. `satisfies z.ZodType<...>`, constants imported, the dedupe in `superRefine`, and a seed header that explains each excluded row with its evidence. Only `isStale` is misplaced.

### `libs/backend/lane-routing/src/lib/lane-model-listing.port.ts`, `route-candidate-source.port.ts`

Score 8/10, 0 / 0 / 0 M (Minor 2). Small, host-neutral, shared types only. Not exported from the barrel yet.

### `libs/backend/agent-sdk/` (registry, run tag, monitor, hook handler, DI)

Score 6/10, 0 / 0 / 4 M (Moderate 5, 6, 7, 8). Tokens, `register.ts` (`:268-272`, singleton like its sibling, and the monitor factory resolves it at `:546-548`) and the optional last constructor parameter on the monitor follow existing practice. `SUBAGENT_BUDGET_STOP_*` naming is consistent with `SDK_SUBAGENT_STOP_CALLBACK_REGISTRY`. The deviations are the barrel path, the inline registry type and the run-id literal.

### `566fa772c` (orchestrator fix to `PostToolUseHookHandler.runTag`)

Score 8/10. Same-family evidence, see the family line.
- The marker `// degradation-audit: reported - ...` sits as the first line in the catch, with the same wording shape as `subagent-handoff-files.ts:88` and `user-layer-seed-quarantine.ts:520`.
- The catch uses `error: unknown`, logs at `warn` with `error.message` and `toolName` only (no input or response body), and returns `null`, so the hook still yields the tool result.
- No `any` or console, and the injected logger is used.
- It does what the commit message says: warn plus marker, which is how a reported swallow is made visible to `tools/degradation-audit`.
- The `debug` call on the `result.reason` path is not a swallow and needs no marker.
- Only Minor 9 (mixed reflow).
- Not covered: whether the audit baseline is satisfied by a `warn` log. The repo siblings treat "logged" as reported, so I accept it. Run `tools/degradation-audit` once (not run here, per the memory-safe rules).

### `libs/backend/persistence-sqlite/src/lib/migrations/0054_*.ts`, `0055_*.ts`, `index.ts`

Score 8/10, 0 / 0 / 1 M (Moderate 9, for the record/row mismatch), plus Moderate 1 for formatting. Header comments follow the 0037/0053 convention (idempotence statement, static-SQL security note, no CHECK on enums with the reason). Version and name registration in `index.ts:82-83,394-403` matches the neighbours. The 14 spec ratchet bumps follow the existing practice.

### `libs/backend/vscode-lm-tools/` (spawn schema, response formatter, namespace builder)

Score 7/10, 0 / 0 / 2 M (Moderate 4, 10). Additive and consistent with the surrounding code (`'N/A'` placeholder matches `:1758,1982`). The new `taskKind` and `routingSource` args are accepted by the schema but plumbed nowhere yet (no consumer in `libs/backend` outside the schema). That is staged for B5.

### `apps/*/src/di/container.smoke.spec.ts`

Score 5/10, 0 / 0 / 1 M (Moderate 8), plus formatting (Moderate 1).

### `tsconfig.base.json`, `.commitlintrc.json`

Score 9/10. The alias `@ptah-extension/lane-routing` and the `lane-routing` scope are present. Alias order is not alphabetical, but the file does not require it.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Imports via `@ptah-extension/*` aliases, no deep `/src/` paths | PASS | grep of changed non-spec files: only `@ptah-extension/shared` and `@ptah-extension/vscode-core` aliases cross libs. |
| Nx tags `scope:extension` + `type:feature` on the new project | PASS | `lane-routing/project.json:5`, the same as `skill-synthesis/project.json`. |
| Lib graph acyclic, lane-routing imports only shared/platform-core/zod | PASS (by convention) | Only `@ptah-extension/shared` and `zod` appear (`routing-constants.ts:1`, `route-decide-*.schema.ts:1-2`). No ESLint guard (Minor 7). |
| No `vscode-core` in host-neutral libs | PASS | Zero hits in `libs/backend/lane-routing/src`. `LaneRoutingLogger` is structural (SC-9). |
| `Symbol.for` DI tokens in `di/tokens.ts` | PASS | `lane-routing/src/lib/di/tokens.ts:9-35`, `agent-sdk/.../di/tokens.ts:145-147`. |
| New agent-sdk registry registered in `register.ts`, resolved in smoke specs | PASS (with finding) | `register.ts:268-272,546-548`. Assertions misplaced (Moderate 8). |
| New port bound in all three platform adapters plus a contract runner | NOT_APPLICABLE | P1 adds no `platform-core` port. The lane-routing ports are lib-owned and optional. |
| Kebab-case file names with role suffixes | PASS | `*.port.ts`, `*.schema.ts`, `*.types.ts`, `registration`-style `register.ts` (P2). |
| Ports `I*`-prefixed (platform-core) | NOT_APPLICABLE | The rule is for `platform-core/interfaces`. Lib-local `.port.ts` files use un-prefixed names (`LaneModelListing`), as the cli-agent-runtime and harness-sync siblings do. |
| Strict TS: no `any`, `@ts-ignore`, `as unknown as`; `unknown` in catch | PASS | No hits in non-spec P1 sources. `catch (error: unknown)` at `post-tool-use-hook-handler.ts:121`. |
| Zod at boundaries | PASS | `RouteDecideArgsSchema` is `.strict()` and bounded. Spawn schema `z.enum(OUTCOME_TASK_KINDS)` (`agent-spawn-args.schema.ts:45`). |
| Injected logger, never `console.*` | PASS | No `console.` in the changed sources. |
| `degradation-audit: reported` marker on intentional swallows | PASS | `post-tool-use-hook-handler.ts:121-122`. |
| File size under the `max-lines` (700, warn) limit | PASS | Largest new source file is `route-decide-result.schema.ts` (162). `rpc.types.ts` grew 16 lines but the new contract went to its own file. |
| Interface contracts rather than concrete classes at library boundaries | PASS (with finding) | `LaneOutcomeReader`, `LaneFailureClassifier` and `RouteCandidateSource` are interfaces. The hook handler's registry type is the exception (Moderate 6). |
| Webview/host messages through the typed `rpc.types.ts` contract, split by domain | PASS | `rpc-lane-outcome.types.ts` plus registry and allow-map entries. Handler and manifest owner follow in Batch 25 (Moderate 11). |
| Naming consistent between shared types, schemas and the plan (SC-1..SC-9) | PASS (with finding) | SC-1/2/4/5/6 names and shapes match the plan text. `ChosenEntry.taskKind` is present (SC-6). The duplicated literals are Moderate 2, 3, 4. |
| Formatter-clean per `.lintstagedrc.mjs` | FAIL | 20 files (Moderate 1). |
| Commit scopes in `.commitlintrc.json` | PASS | `lane-routing` added at `.commitlintrc.json:70`. All eight P1 commit subjects use enum scopes. |
| Migration conventions (header, static SQL, registration in `index.ts`) | PASS | `0054`/`0055` headers, `index.ts:82-83,394-403`. |

## Maintenance debt

- Introduced:
  - four duplicated vocabularies (task kinds, routing sources, run-id format, score/request limits) with no compile tie;
  - 20 unformatted files;
  - a record type that overstates what the table stores;
  - an optional derived field on `CliDetectionResult`;
  - 36 public constants on a new barrel;
  - the 14-spec migration ratchet bump, which is the existing convention.
- Retired: the `vscode-core` logger dependency for the two new libs (SC-9). Part B's planned shared-rule exception is gone.
- Net: slightly positive on architecture (boundaries, ports in shared, a structural logger). Small negative on local duplication, all of it cheap to remove now and costly after Batches 10 to 25 consume it.

## Verdict

- Recommendation: APPROVE (proceed to P2), with the Moderate items scheduled. Items 1, 2 and 6 are single-commit fixes that should go in before the next batch touches these files.
- Confidence: MEDIUM-HIGH. Source was read in full and the sibling comparisons are cited. Prettier was run against the committed blobs. No tests, Nx or `tools/degradation-audit` were run (memory-safe rules). The same-family evidence for `566fa772c` is weaker for the reason given at the top.
- Key concern: the same facts are spelled in several places with nothing tying them together (task kinds, routing sources, the run-id format, score and request limits).
- What a 10/10 version would do differently:
  1. Derive `ROTATION_TASK_KINDS`, the spawn `routingSource` enum and the result schema's enums from the shared constants, with `satisfies z.ZodType<...>` on every result schema.
  2. Add `subagentRunId()` and `RUN_TAG_PREFIX` in shared and use them from the tag writer and lane-outcomes.
  3. Type the hook handler's registry as `Pick<SubagentRegistryService, 'get'>`. Export the new registry through `helpers/index.ts` with a doc comment.
  4. Split `LaneOutcomeRecord` into the persisted row and the read-time joins.
  5. Compute `family` on read, or document why the stored copy is needed.
  6. Put the smoke assertions in dedicated `it` blocks.
  7. Run `nx format:write` on all P1 files.
  8. Add an ESLint restriction on `@ptah-extension/vscode-core` for the lane-routing lib.
  9. Export the ports and schemas through the barrel in the batch that first consumes them.

VERDICT: APPROVED
