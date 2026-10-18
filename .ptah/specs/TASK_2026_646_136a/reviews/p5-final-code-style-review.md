# Code Style Review (final, P5 fix round) — `TASK_2026_646_136a` — Batches 39a-39d

Review family: reviewer Anthropic; implementer codex (OpenAI) CLI lanes, plus small orchestrator spec fixes.
Scope: commits b5e38c780 (39a), 40dcfb9ae (39b), 7f8f93adf (39c), 81c1f5af9 (39d), read at the worktree HEAD.
No check was executed (tests, typecheck, lint and the DI guard were verified by the orchestrator). Findings come from
reading the changed files whole, their siblings and the earlier review `p5-code-style-review.md`.

## Verdict

| Metric | Value |
| --- | --- |
| Overall score | 7.5/10 |
| Assessment | NEEDS_REVISION |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 1 |
| Minor | 7 |
| Files reviewed | 19 source files (specs sampled) |

All five Serious items and M4 are closed or closed in substance. One Moderate remains: the S1 fix is correct on
enums and bounds, but it hand-rolls a third union flattener beside an exported one and so loses the per-kind
"required" information the sibling tools publish (D1). Everything else is Minor and does not gate.

## Item table

| Item | Status | Evidence |
| --- | --- | --- |
| S1 MCP `inputSchema` from Zod (39a) | CLOSED in substance, PARTIAL on required-ness (see D1) | `outcome-report.tool.ts:42-66` builds the schema with `z.toJSONSchema` per branch; `:80` uses it. Enums, `maxItems`, string length bounds and the exactly-one `target` union now come from `lane-outcome.schema.ts:9-31`. `required` is the intersection (`kind`, `target`), so `paths` (deliverables) and `verdict` (review) are not marked required anywhere. |
| S2 P1c hook log regression, unbounded set, re-spelled union (39d) | CLOSED | `post-tool-use-hook-handler.ts:127-128` only calls `logRunTagSkip` when `tag === null`; `:150-152` returns silently for non-Agent/Task tools, so the per-call debug line is gone. `:68` plus `:155-164` bound the set to `RUN_TAG_MISS_HISTORY_SIZE = 256` with oldest-first eviction (same size as `SIGNALLED_HISTORY_SIZE`, `lane-completion-notifier.service.ts:72`). `:147` uses `SubagentRunTagResult['reason']`. Residue: D5. |
| S3 `Pick<LaneOutcomeQueries, ...>` (39b) | CLOSED | `agent-outcome-rpc.handlers.ts:37-40`; the type is imported from `@ptah-extension/lane-outcomes` at `:18-21`, so the `{@link}` at `:34` now resolves. |
| S4 one `limits/` directory (39c) | CLOSED | Both pairs now sit in `cli-agents/limits/` (git renames at 100% / 71% similarity). Imports updated at `agent-process-manager.service.ts:91`, `lane-completion-outcome.ts:9`, `index.ts:5-6`. No tracked file remains under `src/lib/limits/` (an empty untracked directory is left on disk; git ignores it). |
| S5 no raw SQL on foreign tables (39d) | CLOSED | The adapter (`skill-telemetry-seam.adapter.ts`) has no `prepare` call and injects `SkillCandidateStore` and `SessionVerdictStore` (`:25-30`). SQL and Zod row validation live in `skill-candidate.store.ts:1618-1685` (`findSubagentRuns`, `listSkillsForScopes`, schemas at `:61-78`) and `session-verdict.store.ts:208-235` (`evidenceClassForSessions`). The per-scope query loop is batched in groups of 100. Residue: D6, D7. |
| M4 / logic M-6 false "missing" fact (39a) | CLOSED | `outcome-report.tool.ts:139-154`: only `ENOENT` / `ENOTDIR` yields `exists: false`; any other stat error returns `{ reason }`, and `:157-160` returns `{ recorded: false, reason }`. The escape guard also returns a reason instead of throwing inside `Promise.all` (`:130-138`), which closes the "contract looseness" half of M4. |
| logic M-2 invalid `taskKind` / `routingSource` drops row (39a) | CLOSED | `agent-namespace.builder.ts:199-210` (`assertOutcomeField`) called at `:239-245`, using the shared constants, same shape as `assertEffort`. |
| logic M-8 drive-relative path (39a) | CLOSED | `outcome-report.tool.ts:130-137` rejects `win32.isAbsolute`, `/^[A-Za-z]:/` and `isAbsolute(rel)` in addition to the old checks. |
| logic S-1 coded `RpcUserError`, fixed text (39b) | CLOSED | `agent-outcome-rpc.handlers.ts:89-98`: the real `Error` goes to the logger, the caller gets `'Outcome signals are unavailable.'` with `PERSISTENCE_UNAVAILABLE` (an established code, e.g. `corpus-rpc.handlers.ts:149`). |
| logic S-2 error / non-durable state distinct from "no data" (39b) | CLOSED | `skill-clones-state.service.ts:53-58,113-131` (four-state `outcomeStatus`, failed refresh keeps `agentOutcomeSignals` and `outcomeWindowDays`); `agent-outcome-signals.ts:41-58`; card `:192-206` and drawer `:181-196` notes. |
| logic S-3 auth classifier (39c) | CLOSED for bare `401` / "unauthorized"; one residual false-positive shape noted for the logic reviewer | `lane-auth-classifier.ts:3-5`; spec rejects `file.ts:401:15`, `line 4012` and "the user is unauthorized to access this resource". Pattern 3 (`error|status|http` within 80 chars of "unauthorized") still matches a sentence such as "Error: expected unauthorized users to be rejected". Not a structure defect. |

## Defects

### Moderate

**D1. Third bespoke discriminated-union flattener; per-kind required fields are not published (S1 follow-on).**
- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:33-66`
- `surface-tools.ts:72` already exports `flattenOperationUnion(fragment, discriminator)`, which merges a `oneOf` of closed
  branches discriminated by a `const` and adds "Required for <discriminator> X; not allowed for any other" to each
  field. `route-tools.ts:55-` has a private copy for `stage`. The outcome tool adds a third merge with its own
  `isJsonObject` / `stringArray` copies (`:33-40`, identical to `route-tools.ts:19-27`).
- Effect: the published schema lists `paths` and `verdict` as optional with no note on which `kind` needs them
  (`required` is only `kind`, `target`, `:58-62`). The tool description (`:76-79`) does not name them either. The model
  learns that `paths` is mandatory for `deliverables` from a `ZodError`, which is the original S1 complaint, now
  limited to required-ness. The two sibling tools state that rule in the schema.
- Fix: build `generate(OutcomeReportArgsSchema)` and call the exported `flattenOperationUnion(fragment, 'kind')`
  (strip `$schema` as `surface-tools.ts:55-62` does), or move that helper to a shared file and use it from both. Delete
  the local flattener and helper pair. Keep the existing enum / bounds spec.

### Minor (recorded, do not gate)

- **D2.** The `'loading' | 'ready' | 'unavailable' | 'not-persistent'` union is restated in production code at
  `skill-clones-state.service.ts:53-55`, `clone-card.component.ts:339-341` and `clone-detail-drawer.component.ts:473-475`
  while `OutcomeStatus` is exported from `agent-outcome-signals.ts:18-19` in the same directory. A new state needs
  four edits. Import the alias (the compiler would catch a mismatch, hence Minor).
- **D3.** `outcomeReadFailures` (`skill-clones-state.service.ts:57,128`) is written and never read by production
  code (grep: only spec stubs). The audit marker at `:126-127` says the failure is "reported" through it. The status
  signal carries the report; the counter is dead state.
- **D4.** The unavailable-without-figures state renders the same sentence twice: the metric row value
  (`agent-outcome-signals.ts:50-57`) and the note (`clone-card.component.ts:192-199`, `clone-detail-drawer.component.ts:181-188`);
  the spec asserts both. One source of the text would do.
- **D5.** `post-tool-use-hook-handler.ts:165` logs `reason: 'no reason'`, a literal made up at the log site (the same smell
  as the removed `'not-an-agent-tool'`). The no-reason path is only reachable for an Agent/Task call that carries `agent_id`
  (a nested call), which is not a lost join key, and it shares the once-per-session key with real misses
  (`:155-158`), so it can suppress a later genuine `missing-agent-id` warning for that session. The spec pins the behaviour
  (`post-tool-use-hook-handler.spec.ts:205-228`) and reads the private set through `Reflect.get` (`:268`).
- **D6.** `SubagentRunRow` (`skill-candidate.store.ts:72`) is the store's only exported snake_case row type; the adapter
  still encodes `run_id`, `input_tokens`, `is_error === 1` (`skill-telemetry-seam.adapter.ts:41-62`). Column names and the
  integer-flag encoding are partly still known outside the owning store. A camelCase return type would finish S5.
- **D7.** `findSubagentRuns` (`skill-candidate.store.ts:1618-1632`) and `evidenceClassForSessions`
  (`session-verdict.store.ts:208-220`) build unbounded `IN (?,...)` lists, while `listSkillsForScopes` in the same class
  chunks by 100 (`:1648-1651`). Same class, two policies.
- **D8.** `lane-completion-notifier.service.ts:112` still documents `checkLaneDeliverable` as "shared with outcome
  reporting", but 39a removed the tool's use of it (the only caller is the notifier, `:619`). The tool now carries its own
  existence / stat / escape rule (`outcome-report.tool.ts:125-154`), so two deliverable disk rules exist; fix the comment.

## Five style questions

1. **Six months:** a new `OUTCOME_TASK_KINDS` value now reaches the model-facing schema and the spawn check
   (`agent-namespace.builder.ts:239-245`) with no further edit. A fourth outcome status needs four edits (D2).
2. **New team member misreads:** `reason: 'no reason'` (D5); `outcomeReadFailures` looks like it is shown (D3); the
   `Window` metric still renders `(last 30 days)` as a value (`agent-outcome-signals.ts:72-73`, an earlier Minor, unchanged).
3. **Maintenance cost:** one more JSON-schema flattener (D1); the card / drawer agent-metrics branch is still duplicated
   (LT-P5-9, planned).
4. **Inconsistency:** the outcome tool differs from `surface-tools.ts` / `route-tools.ts` in how it publishes a union (D1);
   everything else in the round follows nearest siblings (`assertEffort` shape, `RpcUserError` codes, FIFO bound size, owning-store readers).
5. **Different:** import `flattenOperationUnion` instead of writing a flattener, and use `OutcomeStatus` everywhere.

## File-by-file

- `outcome-report.tool.ts` — 7/10, 1 moderate (D1), 1 minor (D8). Boundary improved: the `cli-agent-runtime` import is gone.
  Escape and stat rules are correct and return one result shape.
- `agent-namespace.builder.ts` — 9/10. Small, matches `assertEffort`.
- `agent-outcome-rpc.handlers.ts` — 9/10. Type linkage and error mapping are right. The log-and-rethrow (earlier M1) remains by plan (LT-P5-7).
- `agent-outcome-signals.ts`, `clone-card.component.ts`, `clone-detail-drawer.component.ts`, `skill-clones-state.service.ts`,
  `skill-clones-view.component.ts` — 7.5/10, minors D2-D4. Status plumbing is sound and keeps last-good figures.
- `lane-auth-classifier.ts`, `lane-failure-class.ts`, `index.ts` — 9/10. Clean move; imports consistent. Root barrel still cherry-picks (LT-P5-11).
- `post-tool-use-hook-handler.ts` — 8/10, minor D5.
- `skill-telemetry-seam.adapter.ts`, `skill-candidate.store.ts`, `session-verdict.store.ts` — 8.5/10, minors D6, D7. Port inversion kept; DI via class tokens as siblings; smoke and register specs updated for the new dependencies.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| No `eslint-disable` of module boundaries, no deep cross-lib imports | PASS | none in the diff |
| Cross-lib imports through `@ptah-extension/*` barrels | PASS | `agent-outcome-rpc.handlers.ts:18-21`, `agent-namespace.builder.ts` imports from `@ptah-extension/shared` |
| Agnostic libs do not import adapters | PASS | no platform-* import added |
| No new `as any` / `@ts-ignore` / `console.*` | PASS | diff read |
| Tool schemas derived from the Zod contract | PARTIAL | D1 |
| Table access through the owning store | PASS | S5 above |
| Naming (kebab-case, role suffix) | PASS | moved files keep names |
| DI wiring consistent | PASS | `skill-synthesis/src/lib/di/register.ts:72-73,111` singleton stores and adapter |
| Comment-marker rules for caught errors | PASS | `skill-clones-state.service.ts:126` uses the `reported — reason` form |

## Maintenance debt

- Introduced: one more union flattener (D1), one dead counter (D3), one unbounded `IN` list per store (D7).
- Retired: the hand-written MCP schema, the foreign-table SQL, the second `limits/` directory, the local reader interface, the per-call debug log.
- Net: down.

## Recommendation

NEEDS_REVISION on D1 alone (Moderate). Confidence HIGH. A 10/10 version reuses `flattenOperationUnion`, uses the
`OutcomeStatus` alias throughout, returns camelCase domain rows from the stores, and drops the dead counter and the
`'no reason'` literal.
