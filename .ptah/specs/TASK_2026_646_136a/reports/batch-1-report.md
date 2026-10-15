# Batch 1 report — A2 lane-routing scaffold

Task 1.1 is implemented. `@ptah-extension/lane-routing` exists as an Nx library with the skill-synthesis project shape, the routing tokens and constants, and a local structural logger. No Nx or Jest command was run (verification override, decision #53). The team-leader owns `nx test`, `nx lint`, and `nx typecheck`.

## Files

Created:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\project.json`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\tsconfig.json`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\tsconfig.lib.json`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\tsconfig.spec.json`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\jest.config.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\eslint.config.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\README.md`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\routing-constants.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\lane-routing-logger.ts`

Modified:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\tsconfig.base.json`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.commitlintrc.json`

Not created, on purpose: `src\lib\di\register.ts` and `register.spec.ts`. Batch 21 Task 21.1 creates them (`batches.md:705`) and the register function takes the host logger (`batches.md:710`). Part A §2 lists `register.ts` on the component; the integrated batch split gives that file to A8.

## Task 1.1 evidence

- Tags `scope:extension`, `type:feature`: `libs\backend\lane-routing\project.json` (same pair as `libs\backend\skill-synthesis\project.json:6`).
- Targets `test`, `lint`, `typecheck`: `project.json`. `typecheck` is `tsc --noEmit --project libs/backend/lane-routing/tsconfig.lib.json`, the skill-synthesis target at `project.json:29-34`. `test` sets `passWithNoTests: true`. `jest.config.ts` also sets `passWithNoTests: true`.
- `tsconfig.json`, `tsconfig.lib.json`, and `tsconfig.spec.json` copy the skill-synthesis compiler options, including `ignoreDeprecations: "6.0"`, `module: "preserve"`, and the spec `moduleResolution: "node10"`.
- `jest.config.ts` copies the skill-synthesis transform, `reflect-metadata` setup, and `vscode` mock mapper, with `displayName: 'lane-routing'`.
- `eslint.config.mjs` spreads `../../../eslint.config.mjs`. It does not copy skill-synthesis's `applyPersistedTiers` / `setModelTier` bans; those are that library's R1 hazard (`skill-synthesis\eslint.config.mjs:50-72`).
- Path alias `@ptah-extension/lane-routing` → `./libs/backend/lane-routing/src/index.ts` in `tsconfig.base.json`, inserted after the skill-synthesis entry.
- Commitlint scope `lane-routing` in `.commitlintrc.json` `scope-enum`, after `skill-synthesis`.
- Tokens in `src\lib\di\tokens.ts`, each `Symbol.for('LaneRouting…')` and `as const`: `ROUTE_DECIDE_SERVICE`, `DECISION_MODEL_CONFIG`, `LANE_MODEL_LISTING`, `STRUCTURED_DECISION`, `LANE_OUTCOME_READER`, `CAPABILITY_MATRIX_STORE`, `ROTATION_STORE`, `FAILURE_CLASSIFIER`, `LOGGER`.
- `src\lib\routing-constants.ts` exports the part A constant table (`implementation-plan-part-a.md:101-127`): score scale 0–100, neutral 50, seed labels 80/65/35, band 5, inside-band limit order, tie-break steps, rotation key parts and `laneRouting.rotation.v1` with cap 200, option caps, 32 questions, 3000 ms + 250 ms, listing budget 2000 ms, gather budget 2000 ms, overall budget computed as 2000 + 2 × (3000 + 250), confidence 0.5, 64 KiB, staleness 180 days, minimum sample 5, outcome window 90 days. A load-time check throws if the band is not smaller than both seed gaps, or if the phase cap is below 2.
- Structural logger: `src\lib\lane-routing-logger.ts` exports `LaneRoutingLogger` with `debug` / `info` / `warn` / `error(message, meta?)`. `LANE_ROUTING_TOKENS.LOGGER` is the token the register function will bind. The barrel `src\index.ts` exports the tokens, the logger types, and the constants.
- Imports: the only module import is `import type { LaneLimitState } from '@ptah-extension/shared'` in `routing-constants.ts`. No `vscode-core`, no `lane-outcomes`, no `agent-sdk`, no `platform-core` (this batch has no platform port call). Limit spellings match `LaneLimitState` at `libs\shared\src\lib\utils\plan-limits\lane-state.ts:158-159`, re-exported from `libs\shared\src\lib\utils\index.ts:124` and `libs\shared\src\index.ts:61`.

## Decisions

1. **Token symbol text is `LaneRouting` + PascalCase, not the characters `LaneRouting<Name>`.** Options: literal placeholder from part A §2 (`implementation-plan-part-a.md:167-168`), or the prefix style the same section cites. Evidence: `libs\backend\platform-core\src\di\tokens.ts:7` and `:13-25` (`Symbol.for('PlatformFileSystemProvider')` and the rest). Reversible: yes, before any host registers the symbols.
2. **`register.ts` is not in this batch.** Options: create it now because part A §2 lists it (`implementation-plan-part-a.md:183`), or leave it. Evidence: Task 1.1's file list (`batches.md:188`) omits it; Task 21.1 creates it (`batches.md:705`) and says the register function takes the host logger (`batches.md:710`). Reversible: yes.
3. **Logger interface is `src\lib\lane-routing-logger.ts`, not a method on the token file.** Options: put the interface in `tokens.ts`, or a dedicated file. Evidence: SC-9 (`implementation-plan.md:375-381`) requires the interface; Task 1.1's named files do not include a logger path. The interface is a separate responsibility from the symbol table. Reversible: yes.
4. **No `platform-core` import in this batch.** Options: import a platform token unused, or import nothing until a store needs `IStateStorage`. Evidence: part A §2 dependencies (`implementation-plan-part-a.md:175-176`) are the allowlist; rule 9 (`batches.md:45-48`) says `lane-routing` may depend on `shared` and `platform-core` only. Unused imports would fail lint. Reversible: yes.
5. **Build `external` is `tsyringe` only.** Options: copy skill-synthesis's `vscode`, `better-sqlite3`, and `sqlite-vec` externals, or list what this lib will load. Evidence: part A §2 dependencies name `tsyringe` (`implementation-plan-part-a.md:176`); this lib must not import `vscode` or sqlite. Reversible: yes.
6. **Verification was not run.** The batch text says to run `nx test`, `nx lint`, then `nx typecheck` (`batches.md:197`). The lane prompt's decision #53 forbids every Nx and Jest command because other lanes are in parallel. The team-leader runs that check.

## Assumptions

Batch 1 owns none of PA-1..PA-5, PB-1..PB-6, or IA-1..IA-5 (`batches.md:88-104`).

Checked anyway, because SC-9 depends on it:

- **PB-8 (closed): `platform-core` has no logger token.** Grep of `libs\backend\platform-core\src\di\tokens.ts` for `logger` / `Logger` returned no matches. The file's tokens are `Symbol.for('Platform…')` and similar (`tokens.ts:13-155`), including `OUTPUT_CHANNEL` (`:36`) and no logger. SC-9 therefore stands (`implementation-plan.md:377-381`). Result: local `LaneRoutingLogger` plus `LANE_ROUTING_TOKENS.LOGGER`.
- **Commitlint had no `lane-routing` scope before this edit.** `batches.md:74-75` and the pre-edit `scope-enum` (skill-synthesis at `.commitlintrc.json:69`, no `lane-routing` match). Result: scope added.
- **Limit-state spellings already exist.** `LaneLimitState` is `'at-limit' | 'near-limit' | 'confirmed-room' | 'unknown'` (`lane-state.ts:158-159`). Result: `INSIDE_BAND_LIMIT_ORDER` and `EXCLUDED_LIMIT_STATE` use those strings and `satisfies LaneLimitState`.
- **The lib directory was a create.** Plan validation (`batches.md:71-72`) said `libs\backend\lane-routing` did not exist. The files above were created, not overwritten.

## Risks and validation notes

- **R-3 (MEDIUM).** `lane-routing` added to `.commitlintrc.json` `scope-enum`. `lane-outcomes` is Batch 6's scope (`batches.md:110`); not added here.
- **Scaffold file count.** The plan allows the scaffold to exceed six files (`implementation-plan-part-a.md:921`, `batches.md:192`). This batch wrote the named scaffold plus `lane-routing-logger.ts` for SC-9.
- **Rule 9 graph.** Source imports only `@ptah-extension/shared`, as a type. It does not import `vscode-core`, `lane-outcomes`, or `agent-sdk`. The workspace tag rule still allows any `scope:extension` peer (`eslint.config.mjs:291-292`: `scope:extension` may depend on `scope:shared` and `scope:extension`). `platform-core` is tagged `scope:shared` (`libs\backend\platform-core\project.json:6`), so a later import of it is legal. A later `nx lint` will not, by itself, reject an `agent-sdk` import. This batch holds the narrower edge by not writing that import. Batch 19 is the cycle check (`batches.md:115`).
- **R-7 (LOW).** Pre-push `validate-deps` / di-lint may flag the new lib before AB14 wires it. Allowlist change is Batch 30 (`batches.md:114`). Not edited here.
- **R-8 (MEDIUM).** No edge from `lane-routing` to `agent-sdk`. Lint was not run (decision #53).
- **Tokens spec.** Task 1.1 says the tokens spec is optional (`batches.md:193`). None was added. There is no empty spec.
- **R-1, R-2, R-4, R-5, R-6, R-9, R-10, R-11.** Not this batch's files.

## Could not do

- Did not run `npx nx test @ptah-extension/lane-routing`, `npx nx lint @ptah-extension/lane-routing`, or `npx nx typecheck @ptah-extension/lane-routing`. Decision #53 in the lane prompt forbids Nx and Jest while other lanes run. No test tail exists.
- `ptah_*` tools (`ptah_workspace_analyze`, `ptah_code_search_symbols`, `ptah_get_diagnostics`, `ptah_agent_report`) are not on this machine. Tool search against the connected MCP servers returned no `ptah` tools. Reads and edits used the native tools.
- Did not register the logger or any service. That is Batch 21's `registerLaneRoutingServices`.
- Did not edit host composition roots, guard specs, or `batches.md`.
