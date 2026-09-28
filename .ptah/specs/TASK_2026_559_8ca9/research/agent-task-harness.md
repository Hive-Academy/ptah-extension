# Agent / Task / Dashboard / Harness / Approval tools — TASK_2026_559

Scope: `ptah_agent_*` (spawn/status/read/message/report/stop/list), `ptah_task_*`
(create/get/list/update/check), `ptah_dashboard_propose_spec`, `ptah_harness_*`
(create_skill/install_mcp_server/list_installed_mcp/propose_config/search_mcp_registry/search_skills),
`approval_prompt`.

Live server probed via `mcp__ptah__*` (2026-09-25). Running-build proxy: `git log -1` on HEAD =
`9afac1aa2` (merge of PR #596, 2026-09-25T16:14:32+03:00) — no version/build-id tool is exposed in
this tool group, so the HEAD commit is the best available correlate; the running Electron process
may lag it by an unknown margin. Source data: `.ptah/specs/TASK_2026_557_tokaudit/research-report.md`
(RC3, RC5, RC6, Wave 1, Wave 4) and `C:/Users/abdal/.ptah-token-audit/mcp_surface.md`, both dated
2026-09-25, window 09-21..09-25.

---

## ptah_agent_spawn

**Contract.** `ptah-core-prompt.ts:97-101` (`CLI_DELEGATION_PATTERN`): "Spawn → completion signal →
Read... Wait for the push signal... do not poll." `agent-lanes/SKILL.md` §4: "Do not poll in a loop...
Ptah pushes one `<agent-lane-completed>` turn." §8: "Default ceiling: 40 tool calls per lane. State
it in `task`; a lane near it reports and stops." §2: `timeout` "Default one hour, no maximum."

**Live behaviour.** Not spawned (rule: no lane spawns). `mcp_surface.md` toolslist.out: schema+desc
5,008 chars (~1,252 tok), eager. `AgentSpawnArgsSchema` validated server-side; errors are typed
(`CliCommandLineTooLongError`, `AgentRoleError`) — `protocol-dispatcher.ts:805-818`.

**Code path.** Handler `protocol-dispatcher.ts:760-836`. Prompt assembly `buildTaskPrompt`
(`cli-agent-runtime/.../cli-adapters/cli-adapter.utils.ts:490-540`): prepends `systemPrompt ||
projectGuidance`, then `NATIVE_AGENT_TOOL_POLICY` (`:409-415`), then the task, then
`renderLaneCompletionContract` (`lane-reporting-contract.ts:30`). Codex spawn/resume:
`codex-cli.adapter.ts:605-669`.

**Regression forensics.** `codex-cli.adapter.ts:666-669`:
```
const thread = options.resumeSessionId
  ? codex.resumeThread(options.resumeSessionId, threadOptions)
  : codex.startThread(threadOptions);
const taskPrompt = buildTaskPrompt({ ...options, role: undefined });
```
`buildTaskPrompt` is called identically for both branches — `resumeSessionId` never suppresses
`systemContext` (the `systemPrompt || projectGuidance` prefix). `git log -S"resumeThread" --
codex-cli.adapter.ts` and `git log -S"const systemContext" -- cli-adapter.utils.ts` both return a
single commit, `80d26911d` ("Code purshing (#292)"), the squash that introduced these files — there
is no later commit that added, then removed, a resume-time skip. **This is a gap present since the
resume feature's origin, not a point regression**: TASK_2026_557 RC3 measured 154.9M Codex input
(40.7% of Codex input) on resumed tasks at 133k/request vs 88.5k for first tasks, and named the same
two lines as the fix target (Wave 4.2, not yet shipped).

**Root cause.** No branch distinguishes a resume from a fresh spawn in `buildTaskPrompt`'s inputs;
the full system/role/policy prefix is re-sent on every resume.

**Fix design.** In `codex-cli.adapter.ts` (and the equivalent branch in `buildTaskPrompt` for other
adapters), when `resumeSessionId` is set, omit `systemPrompt`/`projectGuidance` and the role block
from the options passed to `buildTaskPrompt`, keeping only `NATIVE_AGENT_TOOL_POLICY` + the
continuation task + the completion contract. Matches Wave 4.2's design (`agent-lanes/SKILL.md:130,171`
would need the "resume with a 2-5k handoff" note added).

**Regression guard.** A spec asserting `buildTaskPrompt({resumeSessionId: 'x', systemPrompt: 'Y'.repeat(1000), task:'t'})` output excludes the system-prompt text, run in `cli-adapter.utils.spec.ts`.

**Verdict.** Degraded (design gap, not point regression). Priority **P1** — 40.7% of Codex lane
input is resumed-task input at the audit's measured baseline.

---

## ptah_agent_status

**Contract.** `ptah-core-prompt.ts:101`: "`ptah_agent_status` is a ONE-OFF check — to recover a CLI
Session ID for resume, or after an unexpectedly long silence. Never call it in a loop."
`agent-lanes/SKILL.md` §4: "make one `ptah_agent_status({ agentId })` call, then wait at least 60 s
before the next — at most 5 checks per lane, never a loop."

**Live behaviour.** Not called directly here (would need a live agent); tool description
(`tool-description.builder.ts:626-647`) matches the contract's resume-recovery framing but states no
enforcement. Size: 621-632 chars (small; not the waste driver for this tool).

**Code path.** Handler `protocol-dispatcher.ts:838-846`: `ptahAPI.agent.status(agentId)` called and
formatted with no rate limiting, no repeat-suppression, no cache of the previous answer.

**Regression forensics.** No throttle was ever implemented — `git log -S` on `agent-process-manager.service.ts`
finds no commit adding then removing a status-repeat guard. Gap since inception.

**Root cause.** The "ONE-OFF check" / "never in a loop" rule is prose only; nothing in
`AgentProcessManager` or the dispatcher enforces or even detects a repeat call for the same
`agentId`. RC3 measured 360 poll-only Codex lane requests (9.6% of Codex input) and 207 Claude
status/sleep-only parent turns (46.3M tokens) — `ptah_agent_status` is one of the tools a model
reaches for when it polls instead of waiting for `<agent-lane-completed>`.

**Fix design.** Wave 1.8: a repeat-status throttle — a second `ptah_agent_status` call for the same
`agentId` within 60s returns one line, `"unchanged since t"`, instead of the full markdown block.
Implement in `protocol-dispatcher.ts:838-846` with a small per-agentId last-call timestamp map (TTL
= 60s, cleared on agent exit).

**Regression guard.** `protocol-dispatcher.spec.ts` case: two `ptah_agent_status` calls for the same
id inside 60s return a short "unchanged" body on the second call.

**Verdict.** Degraded (contract text not enforced in code). Priority **P2** — real but smaller than
the resume-guidance duplication; overlaps with Wave 4.3's blocking `ptah_agent_wait`, which removes
the need to poll at all (see `ptah_agent_read` below and RC3 §3, "Blocking waits").

---

## ptah_agent_read

**Contract.** `agent-lanes/SKILL.md` §4: "`read ptah_agent_read({ agentId })` then Read the
deliverable file" — read once, after the completion signal, not incrementally. Tool description
(`tool-description.builder.ts:653-676`): "Use tail parameter to get only the last N lines" — `tail`
is optional with no stated default.

**Live behaviour.** Not called (no live agent to read from this session; rule: don't spawn to test
it). `mcp_surface.md` §0/§3: Codex average 69,988 chars/call (12 calls, 840k chars observed);
"agent_read has a p95 of 496k" (RC5-d, RC3 headline).

**Code path.** Handler `protocol-dispatcher.ts:848-859`: `const { agentId, tail } = args as {...}` —
`tail` is `undefined` unless the caller passes it. `AgentProcessManager.readOutput`
(`agent-process-manager.service.ts:896-922`):
```
if (tail && tail > 0) {
  stdout = tailLines(stdout, tail);
  stderr = tailLines(stderr, tail);
}
```
No `tail` argument ⇒ the entire accumulated `stdoutBuffer`/`stderrBuffer` is returned, unbounded.
Formatter `formatAgentRead` (`mcp-response-formatter.ts:636-665`) wraps the full text in a fenced
code block with no size cap.

**Regression forensics.** `git log -S"tail && tail > 0" -- agent-process-manager.service.ts` → one
commit, `80d26911d` ("Code purshing (#292)"), the same import squash as above. No default tail has
ever existed; this is a gap since inception, not a regression from a specific later PR.

**Root cause.** `tail` is opt-in and the model has to know to pass it; nothing defaults it, and the
prompt tells the model to call `ptah_agent_read` once at the end, when the buffer is largest.

**Fix design.** Default `tail` to a bounded value (e.g. 200 lines, matching the ~4k-char budget the
audit's Wave 1.4 names) when the argument is omitted, with a `truncated`/`totalLines` field in the
response so an agent that wants more can ask with an explicit `tail` or a future `offset`. Change
site: `protocol-dispatcher.ts:848-859` (default the destructured `tail`) or
`agent-process-manager.service.ts:896` (default inside `readOutput`, preferred — single source of
truth for both MCP surfaces). Update `tool-description.builder.ts:653-676` to state the default and
the cap explicitly, since a silent default that the description doesn't mention just relocates the
surprise.

**Regression guard.** `agent-process-manager.service.spec.ts` case: `readOutput(id)` with no `tail`
on a >200-line buffer returns ≤200 lines and `truncated: true`.

**Verdict.** Broken (unbounded by default, matches the audit's largest single per-call figure in this
group — 496k p95). Priority **P0**.

---

## ptah_agent_message

**Contract.** `ptah-core-prompt.ts` (via `PTAH_MCP_MANDATE_PROMPT`) and `cli-adapter.utils.ts:442-447`
(`TWO_WAY_MESSAGING_GUIDANCE`): delivery mode is chosen per call and reported back
(`steer`/`queue-next-turn`/`interrupt-resume`/`unsupported`); "Always read `mode`... do not assume
one." `agent-lanes/SKILL.md` §7 restates the same table.

**Live behaviour.** Not called (no live agent). Description (`tool-description.builder.ts:695-706`)
matches the contract verbatim (mode table, "Call `ptah_agent_list` first"). Size ~842 chars per
`mcp_surface.md`.

**Code path.** Handler `protocol-dispatcher.ts:861-896`. Errors are typed via `AgentMessageError`
with a `code` (`not_found`/`restored`/`not_running`), matching the skill's "three unroutable record
states" note.

**Regression forensics.** No commit history reviewed here found a behavioural change; not named as a
waste driver in either audit source.

**Root cause.** N/A.

**Fix design.** N/A.

**Regression guard.** Existing `agent-namespace.builder.spec.ts` / message-routing specs cover this;
no new guard proposed.

**Verdict.** Works. Priority — none (not a measured contributor).

---

## ptah_agent_report

**Contract.** `lane-reporting-contract.ts:53-61` (`renderLaneCompletionContract`): "call
`ptah_agent_report` once with: what you produced... That call reaches the session that spawned you
immediately." `agent-lanes/SKILL.md` §3.6: "call `ptah_agent_report` once before the final message."

**Live behaviour.** Not called (no live agent). `mcp_surface.md`: 1,061 chars, eager,
"163 calls" observed in the prior audit window (Wave 1.8 note).

**Code path.** Handler `protocol-dispatcher.ts:898-935`. Identity is taken from
`request._callerAgentId` (transport-bound, never from arguments) — an unattributed caller gets
`{ delivered: false, reason: 'unattributed-caller' }` rather than a thrown error, matching the
contract's "a `delivered: false` answer... is a normal outcome."

**Regression forensics.** No cap on report frequency was ever implemented (Wave 1.8: "Cut
`ptah_agent_report` to a start and an end report" is proposed, not shipped) — this is a design gap,
not a regression; the contract says "once" but nothing enforces "once."

**Root cause.** No enforcement of the "call once" contract; a lane that reports repeatedly (contrary
to the prompt) is not stopped or throttled.

**Fix design.** Low priority given no measured waste from over-reporting in this window. If pursued:
count reports per `agentId` in `AgentProcessManager` and downgrade the response after the first
non-final report to a one-line acknowledgement.

**Regression guard.** Not proposed at this priority.

**Verdict.** Works (small, correctly attributed). Priority — none/low.

---

## ptah_agent_stop

**Contract.** No specific prompt/skill claim beyond "for a lane you no longer need" (`agent-lanes/SKILL.md`
§4 run table).

**Live behaviour.** Not called (would kill nothing, but rule is read-only tools only).

**Code path.** Handler `protocol-dispatcher.ts:937-945`, thin pass-through to `ptahAPI.agent.stop`.

**Regression forensics / root cause / fix design / guard.** None — not named as a waste or
correctness issue in either audit source, and the handler is a direct pass-through with no
formatting overhead.

**Verdict.** Works. Priority — none.

---

## ptah_agent_list

**Contract.** `ptah-core-prompt.ts:144`: "Which CLI agents exist is a runtime fact — call
`ptah_agent_list`... Never rank the results." `agent-lanes/SKILL.md` §1: "No `ptah_agent_*` tools in
this session → do the work natively... call `ptah_agent_list` before choosing. Its rows are the only
lanes that exist on this machine now."

**Live behaviour (called live).** Result: 7 agents, 15 roles, **660 characters**, correct — matches
the actual installed adapters (codex/copilot/cursor/antigravity/opencode CLIs + one ptah-cli
provider) with accurate `Status` (`installed`/`not installed`/`disabled (installed)`) and
`Capabilities` (messaging mode + role-delivery mode per row). No waste: this is a small, correct,
well-bounded tool.

**Code path.** Handler `protocol-dispatcher.ts:947-967`; formatter `formatAgentList`
(`mcp-response-formatter.ts:491-552`).

**Regression forensics.** None found; not named in either audit as a waste driver.

**Root cause / Fix design / Guard.** N/A.

**Verdict.** Works. Priority — none (this is the tool the rest of the contract correctly assumes is
cheap and reliable).

---

## ptah_task_create / ptah_task_update

**Contract.** `tasks-namespace.builder.ts:1-31` (module doc): task tools are "ALWAYS ON" so an agent
never falls back to hand-writing task metadata (the original lost-status bug). `create`'s success
note tells the agent to write prose to `context.md`, "never into the carrier" — a real
prompt-substitute for documentation that would otherwise cost a whole file read to discover.

**Live behaviour.** Not called (rule: do not create/update tasks). Description sizes from
`mcp_surface.md`: create 2,012 chars, update 1,976 chars, both eager (create) or default (update).

**Code path.** Handlers `protocol-dispatcher.ts:1856-1864`, thin pass-through to
`ptahAPI.tasks.create(args)` / `.update(args)`. Validation is Zod-first inside
`tasks-namespace.builder.ts:157-200` (`TaskCreateArgsSchema`, `TaskUpdateArgsSchema`), with
machine-readable `{ ok:false, error, code }` on failure (e.g. `TASK_CONFLICT` is explicitly flagged
retryable, `tasks-namespace.builder.ts:421-427`).

**Regression forensics / Root cause.** None found; these are small, single-record mutations and are
not named as a waste driver in either audit source.

**Fix design / Guard.** None proposed.

**Verdict.** Works. Priority — none.

---

## ptah_task_get

**Contract.** `tasks-namespace.builder.ts` doc: read-back of one task plus derived relations
(`children`, `blocks`, `unmetDependencies`, etc.) computed from the same graph the Tasks board uses,
"so an agent and a human reading the same workspace never see two different answers."

**Live behaviour (called live, twice).**
- `taskId: "TASK_2026_557_tokaudit"` → `{"ok":false,"code":"TASK_NOT_FOUND", ...}` — correct: that
  folder is a research-audit directory with no `task.md` carrier (confirmed by directory listing in
  the audit's own evidence trail), and the tool's error message names the actual cause ("It may have
  no carrier — run the spec doctor").
- `taskId: "TASK_2026_559_8ca9"` (this task) → **1,006 characters**, `ok:true`, full metadata
  (status `in_progress`, type `BUGFIX`, title, description, body, `derived` block all empty/correct
  for a task with no relations) — correct and appropriately small.

**Code path.** Handler `protocol-dispatcher.ts:1866-1869`; namespace method
`tasks-namespace.builder.ts:436-477`.

**Regression forensics / Root cause.** None — this tool works as contracted and is not named as a
waste driver.

**Fix design / Guard.** None proposed.

**Verdict.** Works. Priority — none.

---

## ptah_task_list

**Contract.** `tool-description.builder.ts:207-215`: "List tasks, optionally filtered by status
and/or type... Use it to find the highest existing id too, rather than reading a generated registry,
which can be stale." The description gives no output-size caveat.

**Live behaviour (called live, no filters).** The MCP call **failed at the client boundary**:
```
Error: result (223,297 characters across 1 line) exceeds maximum allowed tokens.
Output has been saved to <path>...tool-results\mcp-ptah-ptah_task_list-....txt
```
This reproduces the audit's `mcp_surface.md` §0 figure (220,912 chars, 235 tasks, measured
2026-09-21..25) almost exactly, live, three days later — **the tool is still unfixed and still
unusable for its stated purpose** ("find the highest existing id") without the caller separately
paging the saved file. On this host the calling harness's own client-side guard caught it before it
entered context (a safety net *outside* Ptah's server); a client without that guard — e.g. a Codex
lane, which has none — would receive the full 221k-char JSON inline, as `mcp_surface.md` §2 already
documents for `task_list`.

**Code path.** Handler `protocol-dispatcher.ts:1871-1874`: `JSON.stringify(result)` of the full
`TaskListResult`. Namespace `tasks-namespace.builder.ts:204-207`:
```
export const TaskListArgsSchema = z.object({
  status: z.array(statusEnum).optional(),
  type: z.array(typeEnum).optional(),
});
```
No `limit`, `fields` or `cursor` parameter exists anywhere in the schema, and `list()`
(`:479-504`) returns every `TaskSpecSummary` — which, per `mcp_surface.md`, carries full
`description` text (131k of the 221k chars measured).

**Regression forensics.** `git log -S"TaskListArgsSchema" -- tasks-namespace.builder.ts` → one
commit, `f80fa299c` ("feat(vscode): close the task-id allocation race with a real compare-and-swap"),
which is where this schema was introduced. No later commit added and then removed a limit — **this
is a gap since the tool's origin** (TASK_2026_179 step 17), not a point regression. 235 tasks now
exist where presumably far fewer did at introduction; the tool degraded by data growth against a
schema that was never bounded, which is functionally identical to a regression from the caller's
point of view even though no single commit "broke" it.

**Root cause.** No `limit`/`fields`/`cursor` on `ptah_task_list`; the workspace now has 235 tasks and
every call returns all of them with full descriptions.

**Fix design.** Exactly Wave 1/P3's proposal, scoped to this schema: add
`limit` (default 25), `fields: 'summary'|'full'` (default `'summary'` — drop `description` unless
asked), and a `cursor`/`offset`. Change sites: `TaskListArgsSchema`
(`tasks-namespace.builder.ts:204-207`), `list()` (`:479-504`) to slice and project, and
`buildTaskListTool` (`tool-description.builder.ts:207-233`) to document the default and the "find
the highest id" use case with `fields:'summary'` explicitly (ids/status/type only, no description
needed for that use case).

**Regression guard.** A spec that seeds >100 task folders and asserts an unfiltered
`ptah_task_list` call returns ≤25 summaries by default and stays under an 8k-char budget; add to
`tasks-namespace.builder.spec.ts` alongside a live-repo benchmark case (`mcp/bench.py` per the audit's
Wave 1.4 measurement convention) that fails if the default-call size exceeds a fixed ceiling.

**Verdict.** **Broken** (live-reproduced failure against its own stated purpose). Priority **P0** —
highest measured single-call size of any tool in this group, live-confirmed on 2026-09-25, no
regression window (present since 235-task-workspace growth against an unbounded schema).

---

## ptah_task_check

**Contract.** `tool-description.builder.ts:236-246`: "Health-check the whole task tree... Run this
when a task folder you expect is missing from the board."

**Live behaviour.** Not called (would rebuild the whole graph; not one of the five tools the task
names for live testing, and its shape is the same unbounded-array risk as `task_list` — calling it
against 235 tasks risks the same client-side truncation observed above without adding new evidence).

**Code path.** Handler `protocol-dispatcher.ts:1876-1879`; namespace `:506-538`. Returns every
`invalid` task's full `validationIssues` array with no cap, same unbounded shape as `task_list`.

**Regression forensics / Root cause.** Same class of gap as `ptah_task_list` — no result cap — but
unmeasured in either audit source (no call-volume or char-count data exists for this tool).

**Fix design.** Cap `invalid` and `excluded` arrays at, e.g., 50 entries each with a
"N more, filter by..." trailer if this tool is ever observed at scale; low priority until measured.

**Regression guard.** None proposed pending measurement.

**Verdict.** Unverified (not measured in either audit; live call skipped as redundant risk to the
shared tool-output ceiling). Priority **P2** — same failure shape as `task_list` is plausible but
unconfirmed.

---

## ptah_dashboard_propose_spec

**Contract.** `protocol-dispatcher.ts:308-314`: "Always-on... the tool's success result is a plain-text
rendering of the dashboard, so it is the answer on a host with no dashboard page rather than a dead
end." No entry in `PTAH_MCP_SUBSTITUTION_SECTION` or the agent-lanes skill — it is not part of the
token-saving substitution contract at all; its contract is functional (render a dashboard), not a
token-economy claim.

**Live behaviour.** Not called (mutating; rule excludes it). `mcp_surface.md` §0/§1: **15,208 chars
total (2,470 desc + 12,567 schema), ~3,802 tokens, 24% of the entire 63,188-char `tools/list`
payload** — the single largest tool definition on the server, live-confirmed by the audit's
`toolslist.out` on this same HEAD lineage.

**Code path.** `dashboard-propose-spec.tool.ts:43-100`. The schema is `z.toJSONSchema
(DashboardProposeSpecInputSchema, {io:'input', target:'draft-7'})` — generated from a recursive Zod
schema (components nest `children`), which is why it is large: draft-7 `$ref`/`definitions` expansion
of a recursive component tree, not hand-written bloat. It is registered unconditionally in
`handleToolsList` (`protocol-dispatcher.ts:294-317`, in the always-on block, no `disabled.has(...)`
guard) — every client, including every Codex lane (`tool_search_always_defer_mcp_tools:false`, so no
lane ever defers it), carries this 15.2k-char definition on every single request whether or not the
task involves a dashboard.

**Regression forensics.** `git log --follow` on this file → one commit, `0277e328e` ("feat(shared):
add the declarative surface contract and its MCP tool"), the tool's origin (TASK_2026_493). Not a
regression — it shipped this size and has not grown since; it is a design choice (always-on,
generated recursive schema) that is now the largest fixed cost in the surface, confirmed by
`mcp_surface.md` P1/P6 as the top target for schema-shrinking.

**Root cause.** (a) generated draft-7 JSON Schema for a recursive component tree is inherently large;
(b) the tool has no namespace toggle, so it cannot be excluded per-client even when a lane will never
render a dashboard (e.g. a headless Codex reviewer lane).

**Fix design.** Per `mcp_surface.md` P6: keep the tool always-on for correctness (its own doc argues
this correctly — a host with no dashboard still needs the plain-text fallback), but shrink the
*schema* sent in `tools/list`: hand-author a minimal `$ref`-free schema (top-level shape only, with
`components` typed as a bounded array of a loosely-typed object) plus a `ptah.help('dashboard')`
pointer for the full component-kind contract, moving the 2,470-char prose description's detail into
that on-demand help call instead of every `tools/list` response. Change site:
`dashboard-propose-spec.tool.ts:43-96`.

**Regression guard.** A spec asserting `buildDashboardProposeSpecTool().inputSchema` stays under a
fixed char budget (e.g. 4k), pinned next to the existing `dashboard-propose-spec.tool.spec.ts`.

**Verdict.** Works (functionally correct, validated, all-or-nothing as documented) but **degraded on
cost** — it is the single largest fixed per-request tax in the tool group. Priority **P1** — it rides
every Codex lane request unconditionally per `codex-cli.adapter.ts:627`, unlike the Claude SDK path
where non-eager tools defer.

---

## ptah_harness_search_skills

**Contract.** Tool description (loaded live via ToolSearch, `tool-description.builder.ts:1278+`):
searches local plugin skills AND the skills.sh marketplace; local results are "the on-disk plugin
inventory, NOT the set of skills you can invoke right now"; a `status`/`sources` envelope
distinguishes `ok` from `degraded` so the caller doesn't report "no such skill" on a transient
failure.

**Live behaviour (called live, query "agent lanes").** `status: "ok"`, both sources `ok`. **1 local
result** (`agent-lanes`, exact match, correct) plus **50 skills.sh results that are almost entirely
unrelated** (Lark VC agent, Chainlink CCIP/VRF/data-feeds skills, a cheese-culture skill, several
`langsmith-*` fetch skills, "Kermt" bioinformatics skills) — none of the top 50 besides the count are
about background-agent orchestration. Total payload ~7-8k chars for 51 entries with mostly-empty
`description` fields (per-skill descriptions blank for ~45 of 50 skills.sh rows, matching
`mcp_surface.md`'s "best-effort... a blank description means that lookup failed" caveat, which is
stated in the tool's own description text).

**Code path.** `skills-sh-api-client.ts:100,125,170-193`: `search()`/`searchPage()` call
`GET /search?q=<query>&limit=<count>` against `skills.sh`'s own API and return whatever it ranks.
Ptah forwards `q=` correctly — this was confirmed by reading the client, not inferred.

**Regression forensics.** Not a Ptah regression: the ranking is skills.sh's own server-side result,
external and outside this codebase's control. Ptah's only local contribution (the `agent-lanes`
match) was correct. No commit in this repo changed the marketplace ranking.

**Root cause.** External: skills.sh's `/search` endpoint does not rank "agent lanes" usefully against
this repo's expectations. Nothing in `libs/backend/.../skills-sh-api-client.ts` post-filters or
re-ranks the upstream results before returning them.

**Fix design.** Optional, not a Ptah bug to "fix" in the strict sense: add a client-side relevance
re-rank or a minimum-score cutoff over the upstream results before returning them (e.g. drop rows
whose description, when present, has zero token overlap with the query), or surface `installs` as a
secondary sort only when no local match exists, so an unrelated 669k-install skill doesn't rank above
a correct local match in presentation order (in this call, the local result set was already
correctly biased to the top). Low priority since the tool's own documentation already tells the
caller how to interpret blank descriptions and mixed sources.

**Regression guard.** Not proposed — the defect, if any, is upstream and outside this repository's
test surface.

**Verdict.** Works (as designed — local inventory correct, marketplace forwarding correct, envelope
honest about degraded sources). Priority — none for a code fix here; note only.

---

## ptah_harness_list_installed_mcp

**Contract.** Tool description (loaded live): "list the MCP servers already configured in the
workspace. Reads from `.vscode/mcp.json` and `.mcp.json`... Use this to check what is already
available before searching the registry."

**Live behaviour (called live).** **10 servers, correct and complete**: `sequential-thinking`,
`angular-cli`, `chrome-devtools`, `daisyui`, `firecrawl` (×2, one per file), `shopify-dev-mcp` (×2),
`davinci-resolve`, `ptah` — each tagged with its `source` file (`.vscode/mcp.json` vs `.mcp.json`).
This matches this session's actual configured servers (cross-checked against the MCP-server-instructions
system reminder for this session, which lists the same set: firecrawl, davinci-resolve, sonarqube,
shopify). Output is compact JSON, ~1.3k chars — well-bounded, no waste.

**Code path.** Handler `protocol-dispatcher.ts:1524-1539` (per grep hit list; not separately read in
depth since the live result already confirms correctness and size).

**Regression forensics / Root cause.** None found; correct and small.

**Fix design / Guard.** None needed.

**Verdict.** Works. Priority — none.

---

## ptah_harness_install_mcp_server / ptah_harness_propose_config / ptah_harness_create_skill

**Contract.** `protocol-dispatcher.ts:311-313`: `ptah_harness_propose_config` exists specifically "to
remove" the improvisation where an agent without `ptah_dashboard_propose_spec` writes a markdown
table instead — i.e., these tools exist to give a structured alternative to hand-rolled config/skill
text.

**Live behaviour.** Not called (all three are mutating or install actions; rule excludes them).
Sizes from `mcp_surface.md`: install_mcp_server 1,889 chars, propose_config 2,402 chars (both eager
per §1), create_skill 2,231 chars (eager). None is named as an oversized or wasteful tool in either
audit source, and none appears in the RC5/RC6 findings lists.

**Code path.** Handlers `protocol-dispatcher.ts:1428-1486` (create_skill), `:1540-1596`
(install_mcp_server), `:1597+` (propose_config) — not read in full depth given no live or audit
evidence of a defect; grep confirms they exist as distinct, appropriately-sized cases.

**Regression forensics / Root cause / Fix design / Guard.** None proposed — no evidence of waste or
breakage in either audit pass or in this session's targeted checks.

**Verdict.** Unverified but no negative signal (not called live per the rules; not named as a problem
in `mcp_surface.md`'s empirical benchmark table, which specifically tested the tools it found
suspicious). Priority — none at this time.

---

## ptah_harness_search_mcp_registry

**Contract.** Same "structured alternative to improvisation" framing as above; description
(`tool-description.builder.ts:1399+`) says to use it to discover installable MCP servers.

**Live behaviour.** Not called (would hit an external registry; not one of the five tools named for
live testing).

**Code path.** Handler at `protocol-dispatcher.ts:1486-1523` per the grep hit list.

**Regression forensics / Root cause / Fix design / Guard.** None — not named as a problem in either
audit source; 2,675 chars, eager, unremarkable size.

**Verdict.** Unverified but no negative signal. Priority — none at this time.

---

## approval_prompt

**Contract.** `protocol-dispatcher.ts:154`: "absent in Electron where approval_prompt auto-allows (no
webview UI)." No token-economy claim in the prompt harness or agent-lanes skill — this is a
permission gate, not a context-saving substitution.

**Live behaviour.** Not called (it is a permission hook, not something to probe standalone; calling
it outside a real tool-call context would not exercise its real path).

**Code path.** `protocol-dispatcher.ts:618-622`: on Electron (no `WebviewManager`), the call is
auto-allowed and logged: `'approval_prompt auto-allowed (no WebviewManager — Electron mode)'`. In a
VS Code webview host it presumably prompts the user (not verified here — outside this group's live
scope and not measured token-wise in either audit source).

**Regression forensics / Root cause.** None — not named as a waste driver; it is on every `tools/list`
unconditionally (`protocol-dispatcher.ts:301`) but its own definition is small and not in the "when"
column's list of confusing tools.

**Fix design / Guard.** None proposed.

**Verdict.** Works (as far as evidenced). Priority — none.

---

## Summary

| Tool | Verdict | Root cause (one line) | Regressing commit | Fix (one line) | Guard | Priority |
|---|---|---|---|---|---|---|
| ptah_agent_spawn (resume path) | Degraded | `resumeThread` reuses `buildTaskPrompt` unchanged — full system/role prefix re-sent every resume | none (gap since origin `80d26911d`) | Skip systemPrompt/projectGuidance/role when `resumeSessionId` is set | spec: resumed prompt excludes system-prompt text | P1 |
| ptah_agent_status | Degraded | "ONE-OFF check" contract has no code enforcement; no repeat-call throttle | none (gap since origin) | 60s repeat-status throttle returning "unchanged since t" | spec: 2nd call <60s returns short body | P2 |
| ptah_agent_read | Broken | No default `tail`; unbounded buffer returned unless caller passes `tail` | none (gap since origin `80d26911d`) | Default `tail` (e.g. 200 lines) with `truncated`/`totalLines` | spec: no-tail call on >200-line buffer truncates | P0 |
| ptah_agent_message | Works | — | — | — | existing specs | — |
| ptah_agent_report | Works | "call once" not enforced, but no measured waste | none | optional: count and downgrade repeats | none proposed | — |
| ptah_agent_stop | Works | — | — | — | — | — |
| ptah_agent_list | Works (live-verified, 660 chars, correct) | — | — | — | — | — |
| ptah_task_create/update | Works | — | — | — | — | — |
| ptah_task_get | Works (live-verified, 1,006 chars, correct on hit and on NOT_FOUND) | — | — | — | — | — |
| ptah_task_list | **Broken (live-reproduced)** | No `limit`/`fields`/`cursor`; full descriptions always returned | none (gap since origin `f80fa299c`, exposed by data growth to 235 tasks) | `limit=25`, `fields:'summary'` default, cursor | spec: >100 tasks, default call ≤25 rows / ≤8k chars | **P0** |
| ptah_task_check | Unverified | Same unbounded-array shape as task_list, unmeasured | n/a | Cap `invalid`/`excluded` arrays if measured at scale | none proposed pending data | P2 |
| ptah_dashboard_propose_spec | Works but cost-degraded | Recursive z.toJSONSchema output is 12.5k chars, always-on, undeferred on every Codex lane request | none (size since origin `0277e328e`) | Hand-authored minimal schema + `ptah.help('dashboard')` for detail | spec: schema char budget ceiling | P1 |
| ptah_harness_search_skills | Works (local correct; marketplace ranking is external) | skills.sh's own `/search` ranking, not a Ptah defect | n/a | Optional client-side re-rank/cutoff | none proposed | — |
| ptah_harness_list_installed_mcp | Works (live-verified, 10 servers, correct, ~1.3k chars) | — | — | — | — | — |
| ptah_harness_install_mcp_server / propose_config / create_skill | Unverified, no negative signal | — | — | — | — | — |
| ptah_harness_search_mcp_registry | Unverified, no negative signal | — | — | — | — | — |
| approval_prompt | Works | — | — | — | — | — |
