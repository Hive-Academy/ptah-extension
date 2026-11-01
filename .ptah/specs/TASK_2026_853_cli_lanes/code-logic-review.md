# Code Logic Review — TASK_2026_853_cli_lanes

Score: 7/10
Verdict: REVISE (two small fixes; no blocking defects)
Review family: reviewer: claude; implementer: codex

Scope: full `git diff` and `git status` in the worktree, read statically. Nothing was run, as instructed. I read the new core prompt text, the dispatcher eager set and its spec, both rewritten pins, both skills and their bundled copies, and the manifest diff.

## Logic defects

1. **Moderate — `.claude/skills/orchestration/SKILL.md:27-33` (and the bundled copy).** The `ptah_route_decide` pre-flight call was removed outright. The task said to reuse a `Routing:` reminder instead of calling pre-flight again. It did not say to stop calling it when no reminder exists.
   - Failure scenario: on a host where the reminder is not injected (TUI, VS Code, or Electron before the other branch lands), the orchestrator now has no model-assisted pre-flight at all.
   - The `decisions.md` audit record is lost too: stage, each answer's source/confidence/fallbackCause/modelProposal, overallConfidence, reasons and usage.
   - `agent-lanes/SKILL.md:56-58` still says `ptah_route_decide` is called "as described at orchestration Gate 0.1", so the two skills now describe different flows.
   - Fix: restore the call as the fallback. For example: "When a `Routing:` reminder is present, use it and do not call stage 'pre-flight'. Otherwise, if `ptah_route_decide` is listed, call it once with `{stage:'pre-flight', request}` and record the result in `decisions.md` as before."
2. **Moderate — `lane-policy-sync.spec.ts:89-98`.** The moved pin is weaker than the old one. The old test asserted every `SHARED_TOOL_NAMES` entry was in `PTAH_SYSTEM_PROMPT`. The new test hard-codes an exemption for `ptah_browser_navigate` and `ptah_browser_screenshot`.
   - Failure scenario: `PTAH_LANE_POLICY` tells lanes about browser tools that the parent core prompt (grep: no `ptah_browser` in `ptah-core-prompt.ts`) never mentions. The "parent guidance must agree with the lane policy" invariant is now silently exempt for those two.
   - The implementer's report does not record this as a decision.
   - Fix: either add one short browser line to the core prompt (about 15 tokens, within the 3,380 pin), or keep the exemption as a named constant with a comment saying why the core intentionally omits them, and record it as a decision.
3. **Minor — `ptah-core-prompt.ts` Delegation table (about line 183).** The `subagent_type` roster (`backend-developer`, `frontend-developer`, `software-architect`, `senior-tester`, the reviewers, `researcher-expert`, `devops-engineer`) was dropped entirely, and the new row says only "a repo specialist role".
   - Failure scenario: the model can no longer map "server code vs UI vs review" to a specialist from the core prompt.
   - This is partly intended by the token diet, since the Task tool lists agent types itself.
   - Fix: none required if the Task tool is known to enumerate them. Otherwise add "see the Task tool's agent list".
4. **Minor — `protocol-dispatcher.spec.ts` (new "keeps other agent and routing tools deferred").** The deferred list omits `ptah_agent_wait`, which the task also says stays deferred. Spec criterion A is satisfied for every other tool.
   - Fix: add `ptah_agent_wait` to the list.

## Style defects

1. **Minor — `protocol-dispatcher.spec.ts` test title "marks the seven always-eager tools".** A hard-coded count in the title goes stale on the next addition. Rename to "marks the always-eager tools".
2. **Minor — `lane-policy-sync.spec.ts:91-94`.** Inline name-literal exemption inside the loop. Hoist to a named `PARENT_PROMPT_EXEMPT` set with a reason comment (see logic defect 2).
3. **Minor — `ptah-core-prompt.ts` (about line 112).** The new paragraph is a dense run-on of seven clauses in one line (`PTAH_LANE_POLICY ... deliverables ... verdict ... ptah_agent_report ... ptah_agent_message`). Split into bullets or sentences for readability. Token cost is about the same.

## Acceptance check

| Criterion | Status |
| --- | --- |
| A: only `ptah_agent_list` and `ptah_agent_spawn` added to `ALWAYS_EAGER_TOOLS` (`protocol-dispatcher.ts` about 688-693). Comment block updated. | Met |
| A: `ptah_route_decide`, `ptah_outcome_report`, `read`, `status`, `stop`, `message` asserted deferred. | Met in spec (`wait` not asserted, see logic defect 4) |
| A: a fresh Electron session lists both tools with full schemas. | Not provable statically |
| B1: one table with Task subagent / CLI lane / Neither, using the brief's criteria. | Met |
| B2: 3-Tier text replaced with the criteria and "2+ independent subtasks → at least one CLI lane in parallel". | Met |
| B3: Orchestration Rules wording "Task subagent or a CLI lane per the table". | Met |
| B4: `Routing:` line matches the spec verbatim, and no rule tells the model to call `ptah_route_decide`. Grep finds no `route_decide` in the core prompt, so it is deferred and invisible there. | Met |
| B5: no hard-coded vendors. The `SYSTEM_CLI_TYPES` interpolation is gone and the roster is sent to `ptah_agent_list`. The vendor-drift spec was updated to match. | Met |
| B: concise, budget. Net diff is +1,497 / -1,201 characters, about +74 tokens at length/4. This agrees with the reported 3,143 → 3,219. Pin 3,301 → 3,380 and the pin is kept. | Met (token count not re-measured by me) |
| C: no remaining importer or caller of `PTAH_SYSTEM_PROMPT` / `buildPlatformSystemPrompt` / `ptah-system-prompt` in `apps`, `libs`, `scripts` or `tools` source. The only hits are historical `.ptah/specs` notes and `tools/mcp-bench` fixtures. The export is removed from `index.ts`, the file is deleted, and the stale comments in `cli-adapter.utils.ts`, `diagnostics-cache-invalidator.service.ts`, `ai-provider.types.ts` and `enhanced-prompts.service.ts` are fixed. | Met |
| C: pins moved, not dropped. The vendor-roster pin ("lists every shipped adapter") was intentionally inverted to "defers to `ptah_agent_list`, never rank". The tool-name pin was moved, with the browser exemption (logic defect 2). The `unconditionalModeSentences` pin was moved intact. `PTAH_SYSTEM_PROMPT` was also removed from the `agentFacingStrings` scan, but `PTAH_CORE_SYSTEM_PROMPT` was already in that list. | Met with one weakening (defect 2) |
| C: Fire-and-Check content landed in the core prompt: lane policy auto-injected, `deliverables` and `verdict`, `ptah_agent_report`, `ptah_agent_message` mode and `ptah_agent_list` capability. This agrees with `PTAH_LANE_POLICY`, `TWO_WAY_MESSAGING_GUIDANCE` and `renderLaneCompletionContract` as far as I could read statically. The "must agree" tests were not run. | Met statically |
| D: skills and bundled copies byte-identical (`diff` clean for both). `agent-lanes` §7 now names `ptah-core-prompt.ts`. Gate 0.1 text is intact. | Met |
| D: say the host may already have run pre-flight, and reuse a `Routing:` reminder instead of calling pre-flight again. `orchestration` says this but removed the fallback call (defect 1). `agent-lanes` adds a "do not repeat host pre-flight" line. | Partly met |
| `content-manifest.json`: only `contentHash` and `generatedAt` changed (4-line diff, no per-file entries touched). | Met |
| "Review my last commit and add tests" leads to at least one lane spawn. | Not provable statically. Two independent subtasks plus the "prefer at least one lane" wording makes it likely, but it is soft guidance. |
| "No dead export remains." | Met |

Verification caveat from the report: the scoped verify showed 3 failures (two timeouts under load in unrelated `analysis-namespace.builders.spec.ts` cases, one in `session-usage-ledger-cache.spec.ts`, plus a pre-existing circular-dependency lint failure in `webview`). None of them involve the changed specs. The changed specs were not shown to pass individually. A clean rerun scoped to `ptah-core-prompt.spec`, `lane-policy-sync.spec`, `vendor-roster-drift.spec` and `protocol-dispatcher.spec` is advisable before the push.

## Five logic questions

1. **How does this fail silently?** The orchestration routing path: with no `Routing:` reminder and no fallback call, the skill silently drops to rule-of-thumb routing with no audit trail (defect 1). The exempted browser-tool pin also fails silently if the lane policy and parent drift (defect 2).
2. **What user action produces unexpected behaviour?** A single-subtask request such as "implement X" does not trigger the "2+ independent subtasks" lane preference. It falls back to a Task subagent, which is intended per the brief. The soft "prefer" wording means a model may still never spawn a lane for review-plus-tests.
3. **What input data produces a wrong answer?** A `Routing:` reminder that suggests an executor conflicting with the table. The prompt says "follow its suggestions", with no tie-break against the Neither row. This is a low risk.
4. **What happens when a dependency fails?** If `ptah_agent_list` shows no installed or capable CLI, the prompt still says to prefer a lane. It does not say "fall back to a Task subagent when no lane is spawnable". This is a Moderate gap in the prompt. The orchestration skill's Gate 0.1 default covers only skill-driven flows.
5. **What is missing that the requirements never mentioned?**
   - A fallback sentence when no lanes are available.
   - A browser-tool mention in the core prompt.
   - An assertion that `ptah_agent_wait` stays deferred.
   - A spec pin for the `Routing:` line or the delegation-table criteria in `ptah-core-prompt.spec.ts`. The spec only changed the budget number, so removal of the new lane guidance would pass CI. Consider adding `toContain` pins for "CLI lane", "Routing:" and "at least one as a CLI lane".

## Round 1 re-review

Score: 9/10
Verdict: APPROVED
Scope: static read of the diff, both skill pairs, the prompt text and the three specs. Nothing was run.

| Defect | Status | Evidence |
| --- | --- | --- |
| 1 Pre-flight fallback | Resolved | `.claude/skills/orchestration/SKILL.md:30-38` reuses a `Routing:` reminder, otherwise calls listed `ptah_route_decide` once, records the audit fields in `decisions.md`, and has a not-listed path. `agent-lanes/SKILL.md:56-60` agrees. |
| 2 Browser exemption | Resolved | `lane-policy-sync.spec.ts:32-36` names `PARENT_PROMPT_EXEMPT` with a reason comment; used at `:97`. |
| 3 subagent_type roster | Declined by the coordinator; stands. | |
| 4 `ptah_agent_wait` deferred | Resolved | `protocol-dispatcher.spec.ts:1300`. The eager test title no longer has a count. |
| Style: run-on paragraph | Resolved | `ptah-core-prompt.ts:111-118`. |
| Missing behaviour pins | Resolved | `ptah-core-prompt.spec.ts:43-55` pins the CLI-lane row, the "2+ independent subtasks" rule and the `Routing:` line. The pinned strings match `ptah-core-prompt.ts:111,190,201`. |

Regression checks:
- The core prompt contains no `route_decide` (grep). The spec asserts its absence.
- Both skill pairs are byte-identical (`cmp`).
- No code caller of `PTAH_SYSTEM_PROMPT`, `buildPlatformSystemPrompt` or `ptah-system-prompt` remains under `apps/` or `libs/`. Hits are only in `.ptah/specs` history and `tools/mcp-bench` snapshot JSON.

Remaining (not blocking):
- Moderate, carried over from round 1 and unchanged: no "no spawnable lane, use a Task subagent" fallback sentence in the core prompt.
- The spec for the verify run is unresolved: `subagent-handoff-index.spec.ts` is a load flake being re-run.
