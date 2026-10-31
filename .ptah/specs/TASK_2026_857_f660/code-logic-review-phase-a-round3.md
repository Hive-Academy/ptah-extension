## Verdict

**REVISE — 6/10.** The three targeted fixes work on their direct paths, but replaying an early review after its agent alias resolves counts the same `revise` twice. This is a narrower gap than the prior round, yet wrong learning counts keep the result below the sound 7–8 band. I reviewed `f4a4e5f33` at HEAD. The executor reports scoped verify passing; my scoped `ptah_get_diagnostics` returned unavailable after its TypeScript timeout, and I did not rerun verification.

## Review family

Reviewer: **codex**. Implementer: **claude**.

## Fix verification

1. **Finding 2 — Confirmed for a single held report, with the replay defect below.** A tool review of an unseen `agentId` is held under that bare ID (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:110-125`); host capture also preserves an unresolved bare ID (`libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:364-381`). `heldReportJoinsRow` accepts the row's run ID or its agent ID only for reviews (`libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts:27-40`). SQLite retargets the held report, applies it, then deletes it in one transaction (`store/sqlite-lane-outcome.store.ts:192-221`); the in-memory store does the same (`store/in-memory-lane-outcome.store.ts:42-83`). The pipeline removes both run and agent aliases from its journal index after the insert (`write/outcome-write-pipeline.ts:571-583`) and resolves a bare-ID report submitted after that insert via `findLatestByAgent` (`write/outcome-write-pipeline.ts:674-712`). This prevents a single hold from joining two later rows and closes the missing-target race. The receipt identity is still unstable across that transition; Finding 1.

2. **Finding 4 — Confirmed for the specified identity rule.** Every tool review chooses `getCallerAgentId() ?? reviewerRunId ?? session:<callerSessionId>` or returns `reviewer identity required`; it then calls `isSelfReview` before writing (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:142-158`). Every admitted review uses `deterministicReviewReportId`; `randomUUID()` is limited to deliverables (`outcome-report.tool.ts:217-221`). A session identity is an attribution fallback, so this check can compare only that supplied identity with the reviewed agent; it does not prove which agent controls an agentless session URL.

3. **Finding 3 — Confirmed.** The stream-loop log is a fixed string plus the error class, without `rawMessage`; only the displayed output/segment receives the sanitized message (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:696-711`).

## Findings

1. **Moderate — wrong learning counts.** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:121-125,217-220`; `libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.ts:151-178,201-221`. **Scenario:** call `ptah_outcome_report` with `kind: review`, `target: { agentId: 'implementer' }`, `verdict: revise`, `reviewerRunId: 'reviewer'` before the implementer row exists. The report ID is `review:implementer|reviewer`; it is held and then joins `implementer:<completedAt>`, leaving `reviseRounds = 1`. Retry the _same call_ after that row lands. The tool now resolves the concrete run ID and derives `review:implementer:<completedAt>|reviewer`. That ID differs from the stored receipt, so `applyInTransaction` increments `reviseRounds` to 2. The in-memory receipt check has the same key behavior (`store/in-memory-lane-outcome.store.ts:86-106`). This is a replay of one review, distinct from the per-agent second-turn case deferred in decision row 26. **Smallest sound fix:** preserve both the alias and canonical run receipt identities when a held review joins, or otherwise normalize both submissions to one stable event key before receipt lookup. Add a two-store fixture that repeats identical tool arguments before and after the target row lands.

### Five logic questions

1. **Silent failure:** the replay is accepted as `applied` while it increments an already reviewed row (`libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts:268-285`; `store/sqlite-lane-outcome.store.ts:151-178`).
2. **Unexpected user action:** retrying the same early agent-target review after the row lands yields a second count (Finding 1; `outcome-report.tool.ts:110-125,217-220`).
3. **Wrong input result:** a `revise` report against an unseen bare agent ID, followed by its concrete lane row and the identical report, yields `reviseRounds = 2` (`store/sqlite-lane-outcome.store.ts:201-221,151-178`).
4. **Dependency failure:** a store lookup failure is reported as unavailable before tool submission (`outcome-report.tool.ts:110-139`); a transient write failure is deferred by the pipeline (`write/outcome-write-pipeline.ts:451-469`). I found no new lost-report path in these branches.
5. **Unstated case:** the requirements demand replay deduplication but do not specify how an early agent alias and the eventual concrete run share one receipt (`.ptah/specs/TASK_2026_857_f660/task-description.md:105-109`; `outcome-report.tool.ts:121-125,217-220`).
