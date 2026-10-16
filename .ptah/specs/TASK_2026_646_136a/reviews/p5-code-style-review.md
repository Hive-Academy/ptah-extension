# Code Style Review — `TASK_2026_646_136a` — Phase P5 (Outcome producers + Agents tab)

Reviewer family: Anthropic. Implementers: OpenAI codex, xAI grok and others (batch headers).
Scope: B8 `4876fe923`, B5 `bf898ae9c`, B6 `2f7833b8f`, B7 `cc34e1624`, B10a outcome-report part of `0c52b416b`, P1c `58916fc69`.
Committed versions were read. Line numbers refer to the committed version (identical to the worktree except
`outcome-report.tool.ts`, which has uncommitted fix-round edits; its line numbers are from `0c52b416b`).
No check was executed (no Nx, Jest, tsc, lint, build, diagnostics). Findings come from reading code and sibling code only.

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 6.5/10         |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 0              |
| Serious issues  | 5              |
| Moderate issues | 7              |
| Minor issues    | 8              |
| Files reviewed  | 34 source files, spec files sampled |

Score evidence: no boundary, type-safety or allowlist invariant is broken (band 7-8 territory), but five places
diverge from the nearest sibling in a way that has a real cost (band 5-6): a hand-written MCP schema that has
already drifted from its Zod contract, a hot-path log regression plus an unbounded set in P1c, a duplicated reader
type, a second `limits/` directory, and raw SQL on tables owned by other stores. Not 8 because of those five;
not below 6 because layering, DI, tokens, Zod-at-boundary and Angular rules are followed.

## Five style questions

### 1. What breaks in six months?

- `outcome-report.tool.ts:40-70` restates `OutcomeReportArgsSchema` by hand. The Zod schema already constrains
  `taskKind` and `routingSource` to enums (`lane-outcome.schema.ts:19,21`) and paths to 1-1024 chars; the JSON
  schema says `{ type: 'string' }` (`:53,:55`). The first enum value added to `OUTCOME_TASK_KINDS` makes the model-facing
  contract wrong without any test failing.
- `agent-outcome-rpc.handlers.ts:36-42` is a copy of two methods of `LaneOutcomeQueries`. A signature change in
  `lane-outcome-reader.service.ts:22-27` compiles here because `resolve<OutcomeSignalReader>` is an unchecked cast.
- The handler comments say hosts register the reader "in a later batch" (`:6`, `:75`). Batch 30 has landed
  (`e082c0cbe`), so the lazy service-locator path is now permanent without anyone having decided that.
- `post-tool-use-hook-handler.ts:68` grows one entry per parent session for the life of the process.

### 2. What would a new team member misread?

- Two directories called `limits`: `cli-agent-runtime/src/lib/limits/` (new) and `src/lib/cli-agents/limits/`
  (existing, holds `lane-limit-classifier.ts`). A reader looking for "how a lane failure is classified" finds the
  quota classifier in one and the failure-class/auth classifier in the other.
- `logRunTagSkip(..., reason)` logs `reason: 'not-an-agent-tool'` (`post-tool-use-hook-handler.ts:164`) which is a
  value `buildSubagentRunTag` never returns; it reads as a third result reason but is a literal made up at the log site.
- The `Window` metric renders as label `Window`, value `(last 30 days)` (`agent-outcome-signals.ts:48-51`): the
  parentheses are formatting leaking into data.

### 3. What does this cost to maintain?

- Card and drawer now both carry the same `kind !== 'agent'` / `raw.slug === c.slug` branch (`clone-card.component.ts:423-435`,
  `clone-detail-drawer.component.ts:578-591`). Every change to agent metrics is a two-place edit; the new
  `agent-outcome-signals.ts` module was the natural home for the whole branch.
- Envelope helpers exist twice (see "known and tracked" below).
- The tool and handler each re-derive part of what the lane-outcomes lib already owns (report TTL, reader slice).

### 4. Where is this inconsistent with how the same problem is solved elsewhere?

- `route-tools.ts` in the same commit (`0c52b416b`) generates its MCP `inputSchema` from the Zod schema (header comment: "the
  same contract the handler validates with"). `outcome-report.tool.ts` hand-writes it.
- RPC schema files are `<domain>-rpc.schema.ts` (`agent-rpc.schema.ts`, `lane-plan-limits-rpc.schema.ts`, 50+ siblings);
  the new one is `agent-outcome.schema.ts`.
- MCP tools in `mcp-core` live flat (`agent-wait.tool.ts`, `agent-limit.formatter.ts`, `route-tools.ts`); `tools/` is a new
  subdirectory holding one file.
- Table access in `skill-synthesis`: each table is read and written by its owning store (`skill-candidate.store.ts`,
  `session-verdict.store.ts`). The new adapter issues SQL against two tables it does not own.
- The rest of `rpc-handlers` lets `RpcHandler` log the failure once (`rpc-handler.ts:243` passes the Error object).

### 5. What would I have done differently?

- Generate the tool `inputSchema` from `OutcomeReportArgsSchema` the way `route-tools.ts` does, and give `checkLaneDeliverable` an
  `mtimeMs` field so the tool needs one stat, not two.
- Type the handler's reader as `Pick<LaneOutcomeQueries, 'agentSignals' | 'isPersistent'>` (the handler already imports from
  `@ptah-extension/lane-outcomes`), and drop the try/catch that logs and rethrows.
- Put `failure-class`/`auth-classifier` beside `lane-limit-classifier.ts` in `cli-agents/limits/`.
- In P1c, log only `missing-agent-id` / `invalid-agent-id` (they are already only produced for Agent/Task) and bound or
  clear the once-per-session set.
- Give the adapter two read methods on the owning stores (`SkillCandidateStore`, `SessionVerdictStore`) and keep SQL there.

## Blocking issues

None. No `eslint-disable` of `@nx/enforce-module-boundaries`, no deep relative import into another lib, no adapter import from an
agnostic lib, no new `as any` / `@ts-ignore` in production code, no `[innerHTML]`, no `console.*`.
Dependency graph checked: `lane-outcomes` imports only `shared`, `platform-core`, `persistence-sqlite`, `agent-sdk`
(grep of its non-spec sources); none of the new consumers (`cli-agent-runtime`, `skill-synthesis`, `rpc-handlers`,
`vscode-lm-tools`) is imported back, so the graph stays acyclic. All three consumers are `scope:extension / type:feature`, as is
`lane-outcomes`.

## Serious issues

### S1. MCP `inputSchema` for `ptah_outcome_report` is hand-written and already weaker than its Zod contract

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:40-70`
- Problem: `taskKind` and `routingSource` are `{ type: 'string' }` (`:53`, `:55`) while `OutcomeReportArgsSchema`
  (`libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:19,21`) uses `z.enum(OUTCOME_TASK_KINDS)` and
  `z.enum(OUTCOME_ROUTING_SOURCES)`; `paths` items have no length bound (Zod: 1-1024); `taskId` has no length bound (Zod: 1-200);
  `target` allows an empty object or both keys, the Zod union allows exactly one. The model reads this schema, so it is told
  nothing about the legal enum values and learns them from a `ZodError` at call time.
- Tradeoff: sibling `route-tools.ts` (same commit) derives the schema from Zod and states that as a design rule. One source of
  truth costs a small converter; two sources cost a silent drift on every enum change.
- Recommendation: derive from `OutcomeReportArgsSchema` (reuse the flattening in `route-tools.ts` if the discriminated union needs it),
  or at minimum import the enum constants into the literal schema.

### S2. P1c: per-tool-call debug log regression, and an unbounded per-session set

- File: `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts:141-168` (`logRunTagSkip`), `:68`
- Problem (a): `buildSubagentRunTag` returns `{ tag: null }` with no `reason` for every non-Agent/Task tool and for any call with `agent_id`
  (`subagent-run-tag.ts:21-23`). Before this batch the debug line was guarded by `if (result.reason)`. The new fall-through
  (`:161-167`) fires for every non-Agent/Task PostToolUse in every session, logging `reason: 'not-an-agent-tool'` on the hottest hook in the
  host. Agent/Task calls that skip without a reason are now silent, the opposite of the intent in the commit message.
- Problem (b): `runTagMissSessions` (`:68`, `:151-154`) gains one session id per session with a lost join key and has no release path
  (no session-end hook, no size bound). The repo bounds comparable once-per-key sets (`SIGNALLED_HISTORY_SIZE = 256` in
  `lane-completion-notifier.service.ts:72`).
- Problem (c): the `reason` parameter re-spells the union (`:146`) instead of `SubagentRunTagResult['reason']`.
- Tradeoff: warn-once-per-session is a good idea; the cost is a leak and noise the old code did not have.
- Recommendation: restore `if (result.reason)` as the outer guard (the two reasons are only produced for Agent/Task), drop the
  `'not-an-agent-tool'` branch, bound the set (FIFO as in the notifier) or clear on session end, and use the exported result type.

### S3. Local `OutcomeSignalReader` duplicates the lane-outcomes port (known note, confirmed)

- File: `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome-rpc.handlers.ts:33-42`, resolve at `:80-82`
- Problem: the interface copies `agentSignals` and `isPersistent` from `LaneOutcomeQueries` / `LaneOutcomeReaderPort`
  (`lane-outcome-reader.service.ts:21-27`, exported at `lane-outcomes/src/index.ts:52`). The file already value-imports
  `LANE_OUTCOME_TOKENS` from the same package (`:19`), so the "avoid importing the lib" reason does not apply. The doc comment's
  `{@link LaneOutcomeQueries}` points at a symbol not imported here. `resolve<T>` is an unchecked cast, so the copy is never compared to the real one.
- Tradeoff: `Pick<LaneOutcomeQueries, 'agentSignals' | 'isPersistent'>` keeps the narrow slice and adds compile-time linkage.
- Recommendation: replace with the `Pick`, and import the type with `import type`.

### S4. Second `limits/` directory in `cli-agent-runtime`

- File: `libs/backend/cli-agent-runtime/src/lib/limits/lane-failure-class.ts`, `lane-auth-classifier.ts` (new); existing
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-classifier.ts`
- Problem: the lane-failure classification vocabulary now lives in two sibling-named directories at different depths; `cli-agents/*` imports
  the new one through `../limits/...` (`agent-process-manager.service.ts:91`, `lane-completion-outcome.ts:8`). No other domain in the lib has a
  top-level `lib/<x>` counterpart inside `lib/cli-agents/<x>`.
- Tradeoff: the placement costs a navigational hop on every future failure-class change; moving two files and their specs costs nothing now.
- Recommendation: move both pairs into `cli-agents/limits/` (the `index.ts` exports stay valid via the barrel).

### S5. `SkillTelemetrySeamAdapter` reads tables owned by other stores with raw SQL

- File: `libs/backend/skill-synthesis/src/lib/outcome-seam/skill-telemetry-seam.adapter.ts:51-56`, `:100-104`, `:123-126`
- Problem: it queries `skill_invocation_events` (owned by `SkillCandidateStore`, `skill-candidate.store.ts:~1195`) and `skill_session_verdicts`
  (owned by `archaeology/session-verdict.store.ts`) through `connection.db.prepare`. Column names, the `source = 'subagent'` filter and the
  `run_id` semantics are now encoded in two places. Results are cast (`as RunRow[]`, `as Array<...>`) with no row validation, unlike
  the Zod-parsed `decode()` in the lane-outcomes SQLite store. `skillsLoaded` also runs one query per scope inside a loop (`:98-107`).
- Tradeoff: the port inversion (port in `lane-outcomes`, adapter in `skill-synthesis`) is correct and tested; the cost is only the SQL placement.
  Read methods on the owning stores keep schema knowledge with the writer of the `run_id` column added in this same batch.
- Recommendation: add `findSubagentRuns`, `listSkillsForSession` and `evidenceClassFor` style readers to the owning stores and have the adapter
  delegate; batch the per-scope query.

## Moderate issues

### M1. Redundant catch-log-rethrow with a context object (known note)

- File: `agent-outcome-rpc.handlers.ts:90-99`
- `Logger.error` accepts `Record<string, unknown>` (`vscode-core/src/logging/logger.ts:156-159`), and `agent-rpc.handlers.ts:697` logs `{ errorType }` for
  a secret-bearing path, so the call is legal and has precedent. But here the error is rethrown, and `RpcHandler` already logs it with the Error object
  (`rpc-handler.ts:243`). The result is two lines per failure, one without a stack. `LaneOutcomeReader` already logs and degrades its own failures.
  Remove the try/catch; if a log is wanted keep the original error (`error instanceof Error ? error : new Error(String(error))`, as `agent-rpc.handlers.ts:474` does).
  The same context-object pattern is used at `outcome-report.tool.ts:162`, where it is acceptable because that path returns a result instead of rethrowing.

### M2. Service-locator resolve is now permanent; "later batch" comments are stale

- File: `agent-outcome-rpc.handlers.ts:4-7`, `:75`; `register-shared-rpc-handlers.ts:82-84`
- Decision #73 justified `isRegistered/resolve` until Batch 30. Batch 30 registered the reader on all hosts. The comments now describe a state that no longer
  exists and nobody owns the follow-up (switch to `@inject` or an explicit, documented optional contract). The `persistent: false` empty
  result also hides a mis-wired host as "no data". Either update the comments and record the lazy path as intentional, or move to `@inject` and keep one
  explicit "unavailable" test.

### M3. Agent-metrics branch duplicated in card and drawer

- File: `clone-card.component.ts:423-435` and `clone-detail-drawer.component.ts:578-591`
- Identical `c.kind !== 'agent' ? success : (slug check + formatAgentOutcomeSignals)` in both. The preexisting card/drawer metric duplication was extended rather
  than reduced. Move the "pick signals for this slug and format" step into `agent-outcome-signals.ts` (one function taking clone, signals, window days).

### M4. `checkLaneDeliverable` reuse is awkward: second stat, `Number.NaN` sentinel, unused argument

- File: `outcome-report.tool.ts:100-125` (calls at `:108-112`, re-stat at `:120`)
- The shared helper returns `bytes` but not `mtime`, so the tool stats again (two disk calls and two error paths per path, with two near-identical warn logs).
  `Number.NaN` is passed to suppress `writtenAfterSpawn`; `deliverables: args.paths` is passed only to satisfy `DeliverableTarget`.
  The workspace-escape guard (`:104-107`) re-implements what `resolveDeliverablePath` does for relative paths. Extend the helper to return `mtimeMs` (and take
  an optional `startedMs`), then delete the second stat.
- Related contract looseness: the escape guard `throw`s inside `Promise.all` (`:107`), so one bad path rejects the whole `runOutcomeReport`, while every
  other failure returns `{ recorded: false, reason }` (`:63`, `:84`, `:171`). Return the same shape.

### M5. Constructor thunk is an un-annotated defaulted parameter on an `@injectable()` class

- File: `lane-completion-notifier.service.ts:311-315`
- Parameter 4 is a function with a default and no `@inject`. It works only because `register.ts:98-113` builds the class from a factory; any other
  `container.resolve(LaneCompletionNotifier)` path would try to resolve `Function`. Sibling optional dependency (agent adapter) uses
  `@inject(..., { isOptional: true })`. Document the "factory-only" constraint on the parameter (di-lint passed, per the batch report, but it
  cannot see this). `enqueueLaneCompletionOutcome` takes six positional arguments (`lane-completion-outcome.ts:11-18`) with the same inline `Pick<...>` type repeated in
  the notifier; export one alias (`LaneOutcomeEnqueuer`) from `lane-completion-outcome.ts`.

### M6. Public barrel grows without a consumer

- File: `libs/backend/cli-agent-runtime/src/index.ts:2-6`
- `classifyLaneFailureClass`, `LaneFailureClassInput` and `matchesAuthFailure` are exported from the package barrel; grep shows no use outside the lib.
  `checkLaneDeliverable` is the only new export with an external consumer. Public surface should follow use; drop the first three.

### M7. Frontend: the 500-slug ceiling lives only in the backend schema

- File: `agent-outcome.schema.ts:16` (max 500) vs `skill-clones-state.service.ts` `loadAgentOutcomeSignals` (sends every agent slug)
- A workspace with more than 500 agent clones makes the whole call fail validation, the state service swallows the rejection, and every card says "no
  data yet". The limit is not in the shared contract (`libs/shared/src/lib/types/rpc/rpc-lane-outcome.types.ts`) and the client does not chunk.
  Export the constant from `shared` and chunk, or document the ceiling at the call site. (Behavioural effect is for the logic reviewer; the placement of the limit is the style point.)

## Minor issues

- `agent-outcome.schema.ts`: name drifts from the `*-rpc.schema.ts` convention (`agent-rpc.schema.ts`, `lane-plan-limits-rpc.schema.ts`). `agentOutcomeIssueText` is the third first-issue formatter in the lib (`file-open-rpc.schema.ts:37`, `wizard-generation-rpc.schema.ts:77`, `enhanced-prompts-rpc.schema.ts:57`); reuse one.
- `outcome-report.tool.ts` sits in a new `mcp-core/tools/` directory while its siblings (`agent-wait.tool.ts`, `route-tools.ts`) are flat in `mcp-core/`.
- `outcome-report.tool.ts:155` `24 * 60 * 60 * 1000` is the held-report TTL; the pipeline (`lane-outcomes`) should own that constant, not the MCP tool.
- `lane-failure-class.ts:9` `failureKind?: string | null` should be `AgentFailureKind | null` (`agent-process.types.ts:59`), which keeps the `'quota'` comparison checked.
- `register.ts` (cli-agent-runtime) adds a second `@ptah-extension/platform-core` import and a separate `@ptah-extension/shared` import beside existing ones; merge them.
- `lane-completion-outcome.ts` and `lane-completion-envelope.ts` have no header comment (siblings document the rationale; the extracted envelope also lost the "mirrors `<agent-report>`" explanation that `buildEnvelope` carried).
- `agent-outcome-signals.ts:48-51` `Window` metric value `(last 30 days)`: put the parentheses in the label or drop them.
- State service: `persistent` from the RPC result is documented on the RPC service (`skill-synthesis-rpc.service.ts` JSDoc) but never stored or shown, so "store unreadable" and "no data" look identical in the UI.

## Known and tracked, not re-filed

- Envelope helper duplication (`escapeAttribute`, `formatDuration`, `deliverableLine`/`deliverableState` in both `lane-completion-envelope.ts` and the notifier) and the lost `resolveDeliverablePath` comments: TL-57, FE-23b.
- Missing APM spec for `authMatched` / `taskKind` copy: FE-23c.
- Oversized files grown a few lines (`agent-process-manager.service.ts` 2748, `skill-trigger.service.ts`, `skill-candidate.store.ts`): TL-54, TL-56, FE-24c/d. `skill-clones-view.component.ts` (1039 lines, +18 in B8) is in the same class and was not recorded; it is an existing oversize file and I rate it Minor.
- The notifier was kept at 687 lines by moving the envelope out (batch report); the cap was met by relocation while the duplicated helpers stayed behind. Covered by FE-23b.
- Spec-only `as unknown as` casts (`cc34e1624` handler spec, `2f7833b8f` smoke specs, `bf898ae9c` notifier spec): mock-harness pattern already used by sibling specs and noted in TL-55; no production code uses it.

## File-by-file

### `libs/frontend/skill-synthesis-ui/.../clones/agent-outcome-signals.ts` (B8)
Score 8/10 — 0 B, 0 S, 1 M (M3 adjacency), 1 m. Pure function, no Angular, shared contract imported from `@ptah-extension/shared`, "no data yet" paths explicit. Good home for the logic; it should own the slug check too.

### `clone-card.component.ts`, `clone-detail-drawer.component.ts` (B8)
Score 7/10 — 0 B, 0 S, 1 M. Standalone, OnPush, `input()`, `computed`, `track m.testId`, text interpolation only (no `[innerHTML]`). Branch duplicated between the two (`:423-435`, `:578-591`).

### `skill-clones-view.component.ts`, `skill-clones-state.service.ts`, `skill-synthesis-rpc.service.ts` (B8)
Score 7/10 — 0 B, 0 S, 1 M (M7), 2 m. `inject()` and signals used; the new `catch {}` (`loadAgentOutcomeSignals`) mirrors `loadScorecards` and does not trip the degradation-audit (no literal return, statements present). `persistent` unused.

### `lane-completion-outcome.ts`, `lane-completion-envelope.ts`, `lane-completion-notifier.service.ts`, `register.ts` (B5)
Score 6.5/10 — 0 B, 0 S, 2 M (M5, M6), 3 m. Type-only import of `LaneOutcomeRecorder`, injected `Logger`, no `console.*`, enqueue is sync and its `catch` logs at `warn` (passes the audit). Lazy thunk through `isRegistered(token, true)` follows the repo's optional-dependency idiom but leaves a naked ctor parameter.

### `lib/limits/lane-failure-class.ts`, `lane-auth-classifier.ts` (B5)
Score 6/10 — 0 B, 1 S (S4), 2 m. Small, pure, tested; placed in a second `limits` directory; `string` instead of `AgentFailureKind`.

### `agent-process-manager.service.ts`, `tracked-agent.ts`, `ptah-cli-registry.ts`, `agent-process.types.ts` (B5)
Score 7/10 — 0 B, 0 S, 0 M. `laneFailureTexts` extraction removes a duplicate from the quota path; `authMatched?` as a mutable flag on `TrackedAgent` is consistent with its neighbours.

### `skill-telemetry-seam.adapter.ts`, `skill-candidate.store.ts`, `skill-invocation-recorder.ts`, `skill-trigger.service.ts`, `di/register.ts` (B6)
Score 6.5/10 — 0 B, 1 S (S5), 0 M. `useToken` alias registration is the right shape and smoke-tested on Electron and CLI. `harvestTimers` is cleared in `dispose` (release path present). Raw SQL on foreign tables.

### `agent-outcome-rpc.handlers.ts`, `agent-outcome.schema.ts`, `manifest.ts`, `register-shared-rpc-handlers.ts`, barrels (B7)
Score 7/10 — 0 B, 1 S (S3), 2 M (M1, M2), 2 m. Own file per sub-domain, `agent:` prefix already in `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:66`), `METHODS ... satisfies readonly RpcMethodName[]`, Zod `.strict()` at the boundary, `RpcUserError` with code, manifest key and barrel exports present, contract in `libs/shared/src/lib/types/rpc/rpc-lane-outcome.types.ts` (split by domain, not appended to `rpc.types.ts`).

### `outcome-report.tool.ts` (B10a)
Score 6/10 — 0 B, 1 S (S1), 1 M (M4), 2 m. Zod parse at the boundary, injected logger, dependency interface, no casts. Hand-written schema and double stat.

### `post-tool-use-hook-handler.ts`, `subagent-budget-monitor.ts` (P1c)
Score 6/10 — 0 B, 1 S (S2), 0 M. `Pick<SubagentRegistryService, 'get'>` is the right replacement for the structural literal. Budget-monitor change is minimal and its warn carries ids only. Hook logging regression and leak in the handler.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Cross-lib imports only via `@ptah-extension/*` barrels | PASS | all new imports are package names; no `../../` into other libs |
| `@nx/enforce-module-boundaries` not disabled | PASS | no `eslint-disable` in added production lines (diff grep) |
| Nx graph acyclic (lane-outcomes -> shared, platform-core, persistence-sqlite, agent-sdk) | PASS | grep of lane-outcomes sources; no back import |
| New project carries `scope:*` and `type:*` tags | NOT_APPLICABLE | no new project in these commits (`lane-outcomes` pre-existing, tagged `scope:extension`, `type:feature`) |
| Runtime-agnostic libs avoid host adapters | PASS | no `platform-vscode/electron/cli` import in scope |
| No new `vscode-core` leak into agnostic code | PASS | `cli-agent-runtime`, `rpc-handlers`, `agent-sdk` already depend on it; no new token import in agnostic libs |
| DI tokens `Symbol.for` in a token object | PASS | `lane-outcomes/src/lib/di/tokens.ts:1-17` |
| Ports `I*`/`export type`, adapter bound where host composes | PASS | `SkillTelemetrySeam` port in lane-outcomes, adapter bound by `useToken` (`skill-synthesis/di/register.ts`) |
| Guard/expected-resolvable specs updated with resolvable surface | PASS | `2f7833b8f` touches both guard specs and Electron/CLI smoke specs (TL-61) |
| RPC handler per sub-domain, in manifest, allowlisted prefix | PASS | `manifest.ts` `agentOutcome` entry; `rpc-handler.ts:66` `'agent:'` |
| RPC contract in typed shared file, split by domain | PASS | `rpc/rpc-lane-outcome.types.ts`, not appended to `rpc.types.ts` |
| Zod at the boundary | PASS | handler schema `.strict()`; tool `OutcomeReportArgsSchema.parse` (`:61`) |
| MCP tool schema generated from the Zod contract (as `route-tools.ts`) | FAIL | `outcome-report.tool.ts:40-70` (S1) |
| Injected `Logger`, no `console.*` | PASS | diff grep clean |
| Pass real Error objects to `logger.error` | PARTIAL | `agent-outcome-rpc.handlers.ts:93` context object only (M1); allowed by the Logger signature and by `agent-rpc.handlers.ts:697` precedent |
| No `any` / `@ts-ignore` / `as unknown as` in production | PASS | specs only |
| Degradation-audit markers on intentional swallows | PASS | new swallows either log (`warn`) or are non-sentinel `catch {}` that do not match the audit's patterns; existing `degradation-audit:` markers retained (`post-tool-use-hook-handler.ts` catch) |
| kebab-case, role-suffixed filenames | PARTIAL | `agent-outcome.schema.ts` should be `agent-outcome-rpc.schema.ts` (Minor) |
| File size limits for new files | PASS | new files <= 330 lines; existing oversize files tracked (TL-54, TL-56) |
| Angular: standalone, OnPush, `inject()`, `input()`, signals | PASS | `clone-card.component.ts`, `clone-detail-drawer.component.ts`, state service |
| No `[innerHTML]` with untrusted text | PASS | metrics rendered with `{{ }}` interpolation |
| Resources released (timers/sets) | PARTIAL | `harvestTimers` cleared in `dispose`; `runTagMissSessions` never released (S2) |
| Commit scope in `.commitlintrc.json` enum | NOT_APPLICABLE | commits already landed; not re-checked |

## Maintenance debt

- Introduced: one hand-written schema that must be kept in step with Zod; one duplicate reader type; one extra `limits/` directory; raw SQL on two foreign tables; a permanent service-locator path with stale rationale; a per-session set with no release; envelope helper duplication (tracked); duplicated card/drawer branch.
- Retired: the structural `subagentRegistry` type literal (replaced by `Pick`); the inline `laneFailureTexts` duplication in the process manager; the envelope code inside the notifier (moved, not de-duplicated).
- Net: roughly neutral to slightly negative. The producers and the read path are architecturally sound; the debt is in places where an existing sibling pattern was close at hand and not used.

## Verdict

- Recommendation: REVISE (NEEDS_REVISION)
- Confidence: HIGH on the structure findings (all verified against sibling files); MEDIUM on S2(a) because it rests on `buildSubagentRunTag` returning no `reason` for non-Agent tools, which I read at `subagent-run-tag.ts:21-23` but did not exercise by running a test.
- Key concern: the P1c hook change adds a debug line to every non-Agent tool call and an unreleased set, and the outcome-report MCP schema has already diverged from the Zod contract it is meant to mirror.
- What a 10/10 version would do differently: derive the MCP schema from Zod; type the RPC reader with `Pick<LaneOutcomeQueries, ...>` and drop the catch-log-rethrow; keep failure classifiers next to `lane-limit-classifier.ts`; give `checkLaneDeliverable` an `mtimeMs` output; delegate SQL to the owning stores; restore the `if (result.reason)` guard and bound the once-per-session set; fold the agent-metrics slug check into `agent-outcome-signals.ts`; rename the schema file to `agent-outcome-rpc.schema.ts`; update the stale "later batch" comments; share the 500-slug ceiling through `shared`.
