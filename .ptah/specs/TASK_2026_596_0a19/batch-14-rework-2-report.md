# Batch 14 rework round 2 of 2: report (TASK_2026_596_0a19)

Executor: backend-developer sub-agent (took over from the codex lane, which could not run the Nx tests).
Scope: edits only under `libs/backend/vscode-lm-tools/**`. Batch 15's `libs/backend/rpc-handlers/**` was not touched. No git commands were run except read-only `git status` and `git diff`.

Wording source: design-spec.md §2.2 and §5, plus the prototype's tool-text renderer (`prototype/index.html:611-715`: `stateCell`, `planRows`, `winLine`, `altLine`, `alternatives`, `spawnText`), which the design cites as the source for every variant.

## Defect → fix

All paths below are relative to `libs/backend/vscode-lm-tools/src/lib/code-execution/`.

1. **Malformed fixture (F42, F48 failing).** `mcp-core/agent-limit.formatter.spec.ts` was rewritten.
   - Every fixture is now a typed `PlanLimitWindow` / `PlanLimitOwnerSnapshot` (shape from `libs/shared/src/lib/types/plan-limit.types.ts`).
   - Each lane's state comes from the real `classifyLaneState(applicableLimits(...))` (`lane()` helper, `:146-170`).
   - The spec has no `as unknown as`. F42 is at `:207` and F48 at `:352`/`:365`; both pass.
2. **Dead duplicate code.** Deleted `legacyLimitReason`, `legacyFormatLimitColumn`, `legacyMarkdownTable`, `rowName`, `legacyFormatPlanLimitsSection`, `alternativeLine`, `legacyFormatAlternatives` and `legacyFormatSpawnLimitBlock` from `mcp-core/mcp-response-formatter.ts`.
   - Removed their now-unused imports (`formatToolResetText`, `formatToolSourceText`, `formatUsed`, `groupAlternatives`, `LaneStateReason`, `LaneLimitResult`, `targetRowKey`, `AgentLimitTarget`). `AgentLimit` is imported from `agent-limit.formatter`.
   - The duplicated "with limits / without limits" branches of `formatAgentList` were collapsed into one path: `agentListRow` (`:1742`) and `formatAgentList` (`:1785`). The `Limit state` column and the two sections are added only when `limits` is passed.
3. **Failed spawn ignored the target lane.** New `spawnRequestTarget(request)` (`agent-limit.formatter.ts:49`). A `ptahCliId` wins over `cli`, as it does in `agent.spawn`; it returns `undefined` when the CLI is auto-detected.
   - `formatSpawnLimitBlock(limits, target, attempted, now)` (`:408`) resolves the row itself with `findAgentLimit`.
   - Protocol (`mcp-core/protocol-dispatcher.ts:1143-1149`): the generic error is re-thrown first, without a lookup. For role and command-line-too-long errors the block uses `spawnRequestTarget(spawnArgs)`.
   - stdio (`mcp-stdio/agent-tool.dispatcher.ts:409-411`): `spawnRequestTarget(p)` on every error branch. The generic text is still `agent_spawn failed: …`.
   - Success: `formatAgentSpawn` resolves from `result.cli` + `result.ptahCliId`, the lane that ran. The `limitTarget` option was removed and the transports no longer pass it.
4. **§5 wording verbatim** (`mcp-core/agent-limit.formatter.ts`):
   - (a) Owner-level list cell (`:147-156`): `AT LIMIT (window unknown, reset unknown) [error-derived] · no usage source`. The reset becomes `resets <time>` when known, and `· no usage source` is added only when the snapshot status is `no-usage-source`.
   - (b) Window State cells (`WINDOW_STATE_CELL`, `:69`): `LIMIT REACHED` and `not confirmed (last reset unknown)`. The rest follow the prototype `FLAG` table.
   - (c) Reason labels (`reasonText`, `:80`; `WINDOW_STATE_REASON`, `:60`):
     - `stale` → `aged value`
     - `window-set-not-established` → `window set not established, partial data` (the §2.2 prototype example, which contains the §2.2 label)
     - window states → `<window>: aged value | last reset unknown | usage unknown | reset passed, usage unknown | estimate only`
   - (d) Alternatives (`alternativeLine` `:280`, `noWindowsDetail` `:266`, `windowLine` `:252`):
     - Unknown lanes with windows open with `not confirmed: <reason>.`
     - Unknown lanes without windows keep their reason: `limit lookup timed out; no windows known`, or `<reason>; no windows reported`.
     - Owner-level at-limit reads `at limit, window unknown, reset unknown [error-derived] · no usage source`.
     - Windows carry `(LIMIT REACHED)`, `(not confirmed, last reset unknown)`, `(aged, observed …)`, `(near limit)` or `(estimate)`, and `Weekly used unknown, reset unknown`.
     - The at-limit sentence uses "other lane" when a spawn target is excluded.
   - (e) Owner-level Plan-limits row (`planLimitRows`, `:185`): Used is `no usage source`, State is `AT LIMIT (owner level, window unknown)`, Reset is the evidence reset, and Source is the evidence source. Lookup-failure rows read `| (none) | unknown | <reason> | - | - |`.
5. **Estimate note ignored later reasons.** `estimateNote` (`:387`) checks every window for `estimate-only` and every reason for `estimated-limit`. It runs only for lanes that are neither at nor near their limit, so an estimate never produces a `WARNING` (`formatSpawnLimitBlock` `:408`).
   - `model-scope-unknown`: no detection depends on `reasons[0]` any more. The only remaining `reasons[0]` use is the leading reason in the unknown cell and the alternatives prefix, as the prototype `stateCell`/`altLine` do. No note applies to it.
   - Related fix: the cooldown line now prints only for an **active** cooldown (`activeCooldown`, `:138`). Before, any snapshot `cooldown` printed, including an expired one.
6. **Missing specs.** See below.

## Specs added or replaced

- `mcp-core/agent-limit.formatter.spec.ts` (rewritten, 21 tests):
  - F42; F43
  - F44 ×2 (row key; `spawnRequestTarget`)
  - F45; F46 ×2
  - §2.2 reason labels
  - §5.1 Plan-limits rows verbatim; §5.1 alternatives lines verbatim
  - F47
  - every-lane-at-limit and single-lane sentences
  - F48 ×2 (window warning; owner-level warning "…still attempted.")
  - F49 ×2 (estimated limit that is not the first reason; estimate-only window; both assert no `WARNING`)
  - F50
  - F51 ×2 (active cooldown; expired cooldown omitted)
- `mcp-core/agent-spawn-limits.transport.spec.ts` (new). It runs `describe.each` over **protocol** and **stdio** (6 tests each) plus 3 generic-failure tests, 15 in total:
  - success block appended after spawn settled (`invocationCallOrder`)
  - role failure shows the same `Limit state` as success
  - command-line-too-long shows the `Limit state`
  - failed Ptah CLI spawn resolves to its own lane by `ptahCliId`
  - lookup throw leaves the role failure text unchanged
  - lookup throw leaves the success text equal to `formatAgentSpawn(result)`
  - protocol generic error still re-thrown (`Tool ptah_agent_spawn failed: no slot`, no `list`/`limits` call)
  - stdio generic error is `agent_spawn failed: no slot` plus the target block
  - stdio generic text unchanged on a lookup throw
- `namespace-builders/agent-namespace.limits.spec.ts` (new, 4 tests). It is wired to the **real** `LaneLimitLookupService`:
  - a ptah-cli `ollama-cloud` row carries `providerId`, `ownerForPtahCliKey('glm-1','ollama-cloud')` is called, and the lookup is `ok` with the owner and snapshot
  - the same row without `providerId` is `no-owner` (shows the binding matters)
  - when the lookup throws, `limits` gives one `failed`/unknown per row with no owner and no snapshot
  - `undefined` when no lookup is wired
- `mcp-core/mcp-response-formatter.spec.ts`: the tautological F52 was replaced by two literal comparisons (`:1803-1855`).
  - `formatAgentList` with no `limits` (codex with role delivery, disabled copilot, a ptah-cli row) and `formatAgentSpawn` with no `limits` must `toBe` stored strings.
  - The strings were produced by `json2md` from the pre-change structure (confirmed against the pre-change `formatAgentList`/`formatAgentSpawn` in the main checkout), not by the new code.

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools` (foreground, no extra flags, cache 0/3 hit): typecheck PASS, lint PASS, test PASS.
- Test counts (`nx test … --output-style=static` replay): **Test Suites: 84 passed, 84 total; Tests: 2717 passed, 2717 total**. The guard specs in `tool-description.builder.spec.ts` (vendor-roster-drift, lane-rule-single-home, agent-spawn-surface-parity) are in that run and green.
- `ptah_get_diagnostics` on all changed and new files: 0 errors.
- Prettier `--write` run on all changed files.
- R8: no static string in `agent-limit.formatter.ts` names a vendor (grep for Glm/Ollama/Antigravity/Claude/Codex/Gemini finds nothing).
- No `as unknown as` in the three new or rewritten specs.

## Plan deviations

- `formatSpawnLimitBlock` signature is now `(limits, target, attempted, now)`, and the `formatAgentSpawn` `limitTarget` option was removed. The success target is the lane that actually ran (`result.cli`/`result.ptahCliId`), which is the same row the failure path resolves for an explicit request.
- The list `AT LIMIT (<window>, resets <time>)` cell has no relative time, matching the §5.1 sample and prototype `stateCell` (F43 updated). Table, alternatives and warning resets keep the relative time.
- Cooldown line follows the prototype: `**Cooldown:** retrying after <time> (<rel>). This is a retry delay, not a plan reset.` The source tag is omitted because `PlanLimitCooldown` carries none.
- Following prototype `planRows`, the owner-level `(none)` row appears only when the lane has no windows.

## Out-of-scope observations

- The spawn `**Limit state:**` line sits after a blank line, not directly under `**CLI Session ID:**` as in the §5.2 sample. Making it adjacent would change the pre-change json2md paragraph bytes, which the byte-identity requirement forbids, so it is left as is.
