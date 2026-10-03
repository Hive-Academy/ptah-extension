# Batches - TASK_2026_597_ab22

Total tasks: 131 | Batches: 49 | Complete: 7/49 | PR 1 subset: 15 batches (7 complete, 8 open, 16 open tasks) | Deferred: 34

Worktree root (every path below is absolute under it): `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn`.
Never touch `D:/projects/ptah-extension` (main checkout).

## PR 1 scope (decision 11)

Source: context.md § User Decisions item 11 (2026-10-03). PR 1 = SAVINGS-FIRST SUBSET. Every other batch is marked
`DEFERRED (follow-up, decision 11)` in its header and moves to follow-up tasks; its content stays as the input for those
tasks. N7/N8 is a follow-up task too: `implementation-plan-addendum-n7-n8.md` (revision 1, possibly with partial
revision-2 edits from the stopped run) and `implementation-plan-addendum-review.md` stay in this folder as its input.
No batch for N7/N8 is added here.

Branch rebased on origin/main (base `21c27d17f`). Recorded SHAs updated: 1 `b9da189e7`, 2 `70af32f03`,
3 `d81210d77`, 4 `30108c20c`, 5 `abe828c2b`, 6 `15a8362d4`, 10 `85bfdd4a9`.

### Subset

| Order | Batch   | Item                                       | State                 | Executor                        | Depends on (inside the subset only) |
| ----- | ------- | ------------------------------------------ | --------------------- | ------------------------------- | ----------------------------------- |
| -     | 1-6, 10 | S1a + M                                    | COMPLETE              | -                               | -                                   |
| 1     | 7       | S1a spawn-surface `effort`                 | IN_PROGRESS (running) | backend-developer               | 5, 6                                |
| 2     | 23      | A1 auto-compact machinery (narrowed)       | PENDING               | backend-developer               | none                                |
| 2     | 42      | N3 allowlist policy + generator            | PENDING               | backend-developer               | none (gate Task 42.1 first)         |
| 2     | 48      | N5 lean rules in the orchestration skill   | PENDING               | backend-developer (text only)   | none                                |
| 3     | 43      | N3 frontmatter, reviewers and planners     | PENDING               | backend-developer (config text) | 42                                  |
| 3     | 44      | N3 frontmatter, remaining restricted types | PENDING               | backend-developer (config text) | 42                                  |
| 4     | 45      | N4 subagent text trim (narrowed)           | PENDING               | backend-developer               | 7, 23 (shared files)                |
| 4     | 49      | N5 lean rules in the team-leader files     | PENDING               | backend-developer (text only)   | 43 (same `team-leader.md`)          |
| 5     | -       | ONE code-logic review on the combined diff | -                     | code-logic-reviewer             | all of the above                    |

Executor: one Claude subagent per batch (CLI lanes stay disabled, context.md § CLI Lanes). Execution mode inside each
batch: sequential. Max 3 subagents at once.

Parallel waves (file-disjoint, verified against each batch's file list):

- Wave 2, while Batch 7 runs: Batches 23 and 42 (agent-sdk and agent-generation; neither touches vscode-lm-tools).
  Batch 48 joins as soon as a slot frees (it touches only `.claude/skills/orchestration` and its plugin copy).
- Wave 3, after 42: Batches 43 and 44 (disjoint `.claude/agents/*.md` sets), plus 48 if still open.
- Wave 4: Batch 45 after 7 AND 23 (it may edit `tool-description.builder.ts` / `protocol-dispatcher.ts` from Batch 7 and
  `sdk-query-options-builder.ts` from Batch 23). Batch 49 after 43, in parallel with 45.
- Commits stay serial (one batch per commit, team-leader owns git); a parallel pair is committed in finish order.

### Dependencies on deferred batches — resolved

| Subset batch | Deferred dependency                                            | Resolution                                                                                                                                                                                                                                                                                                                                                              | Evidence                                                                                                                           |
| ------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 23           | 17 (compaction keys move to the file store)                    | DROPPED. Batch 23 extends the provider as it reads today; the 17 reroute later changes only where the two keys are read from.                                                                                                                                                                                                                                           | `compaction-config-provider.ts:58-59` already reads `compaction.enabled` / `compaction.threshold` and validates the range at `:72` |
| 23           | 14 (strict MCP, cost)                                          | DROPPED. 14 only shared `sdk-query-options-builder.ts` for serialisation; no 14 symbol is used by 23.                                                                                                                                                                                                                                                                   | Task 23.1-23.4 file lists                                                                                                          |
| 23           | 12 via Task 23.3 (`isProxiedProviderBaseUrl`, Task 12.2)       | DROPPED. Task 23.3 derives the model class from the builder's existing first-party test (`!baseUrl` or `api.anthropic.com`). With `A1_DEFAULT_WINDOW = { claude: null, proxied: null }` the class changes no output in PR 1; Task 12.2 replaces the predicate in the follow-up.                                                                                         | `isProxiedProviderBaseUrl` absent from `libs/`; existing test at `sdk-query-options-builder.ts:1536-1538` and `:1619-1621`         |
| 23           | 11 via Task 23.3 (`sdk-query-options-builder.capture.spec.ts`) | DROPPED. The capture entry does not exist yet (Task 11.2); the "capture records window and source" step moves to the follow-up with Batch 11.                                                                                                                                                                                                                           | file absent; `sdk-query-options-builder.auto-compact-argv.spec.ts` exists and is the spec to extend                                |
| 42           | 36 (M `--subagents` before baselines)                          | DROPPED. "Before" = context.md § Handoff (start prefix 34-44k, median 39.6k, 1,075 requests). "After" = a QA step with the existing tool M, which already classifies subagent transcripts (`claude-transcript.reader.ts:189` `kind: 'subagent'`), within the decision 6 budget. The per-type prefix view is deferred with Batch 36.                                     | `claude-transcript.reader.ts:4-5, 189`                                                                                             |
| 45           | 36                                                             | DROPPED, same as 42 (separate "after" column for N4 at QA).                                                                                                                                                                                                                                                                                                             | as above                                                                                                                           |
| 45           | 11 (agent-sdk capture entry for attribution)                   | DROPPED. Task 45.1 is narrowed to a static attribution: Ptah does not inject text into Claude subagents through hooks (no `additionalContext` on `SubagentStart` in `libs/backend`), so the Ptah-owned candidates are the MCP server `instructions` and the MCP tool descriptions, measured with `ptah_count_tokens` on the built strings. The STOP rule (AS-N4) stays. | grep `SubagentStart                                                                                                                | additionalContext`in`libs/backend`: only registry hooks (`subagent-hook-handler.ts:135-300`), no injection |
| 45           | 38 (N1 TTL in the options builder)                             | DROPPED. 38 only shared `sdk-query-options-builder.ts`; N4 does not use the TTL.                                                                                                                                                                                                                                                                                        | Task 38.2 file list                                                                                                                |
| 45           | 7                                                              | KEPT (in subset): same vscode-lm-tools files.                                                                                                                                                                                                                                                                                                                           | Task 7.2 / 7.3 file lists                                                                                                          |
| 49           | 43                                                             | KEPT (in subset): same `.claude/agents/team-leader.md`.                                                                                                                                                                                                                                                                                                                 | Task 43.1 / 49.1 file lists                                                                                                        |

Risks added by the subset:

| Risk                                                                                                                                  | Severity | Mitigation                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 ships with null defaults, so Batch 23 alone saves no tokens until E2 passes (decision 2)                                           | MEDIUM   | Batch 23 lands the machinery and the INFO line; E2 runs at QA (decision 6 budget). Setting a class default (S5) stays out of PR 1 unless E2 passes and the user approves. Recorded in the QA hand-off. |
| N4 candidates (MCP instructions, tool descriptions) also reach the parent session, but Task 45.2 requires the parent prompt unchanged | MEDIUM   | Task 45.1 reports which parts are subagent-only. If every Ptah-owned part is shared with the parent, Batch 45 reports and stops (no code edit) and the team-leader records N4 as deferred.             |
| Without Batch 36 the N3/N4 "after" numbers are coarser (whole-transcript first request, not a per-type view)                          | LOW      | QA records the first-request size per subagent transcript from M's output; numbers go to `measurements/s9-subagent-baselines.md` (created at QA).                                                      |
| `.codex/agents/team-leader.toml` and `.opencode/agent/team-leader.md` are modified in the main checkout                               | MEDIUM   | Batch 49 adds one section only; the merge on those two files is expected at PR time.                                                                                                                   |

### Review policy (decision 11)

- No per-batch review. Before each commit the executor and then the team-leader run the batch's scoped
  `npx nx run-many -t typecheck,lint,test -p <projects>` (output tailed); the commit hooks run as usual.
- ONE code-logic review at the end of the subset on the combined diff `15a8362d4..HEAD` (Batches 7, 23, 42-45, 48, 49).
  Batches 1-6 and 10 were already reviewed. Findings are fixed in one fix round, then a re-review scoped to the fixes.
- No review at all for batches that change only types, tests, docs or measurement (48, 49; 43 and 44 are frontmatter
  config, checked by the content check and covered by the combined review).
- The team-leader still verifies every batch on disk before its commit.

## Run defaults (recorded by the team-leader)

- Slice order follows implementation-plan.md § Sequencing (:1371-1389) and the orchestrator brief: S1a (Batches 1-7),
  S1b (8-9), S2 (10-11), S3 (12-22), S4 (23-35). S5 is NOT scheduled (deferred section at the end).
- CLI lanes are DISABLED by the user (context.md § CLI Lanes). Every batch runs on ONE Claude subagent
  (backend-developer or frontend-developer). Execution mode is `sequential` inside every batch. No batch may spawn a
  `ptah_agent_*` lane.
- Batch size: at most 6 production files across at most 2 libraries. Specs and fixtures beside a production file do not
  count toward the 6. An app `package.json` or host DI file counts as a file but not as a library.
- Parallelism between batches: batches are file-disjoint where marked "Concurrent-safe with". The orchestrator MAY run
  such a pair as two subagents at once (max 3 at a time). Otherwise it runs them in numeric order. S2 Batch 10 is
  concurrent-safe with every S1 batch (the user allows S2 in parallel with S1).
- Verification: one scoped `npx nx run-many -t test,lint,typecheck -p <projects>` per batch, output tailed or filtered.
  When a batch changes `libs/shared` types or `tsconfig.base.json`, it also runs
  `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli`. If a project lacks a target, run the
  targets it has and say so in the report.
- Live L runs (C1-C5, O1-O5, K1-K5, U1-U5) and E2/E3 belong to QA (senior-tester). They are not build batches. U1 must
  run on a build of `4e246388a` (pre-S3) and be recorded before the PR merges (plan :1400-1403).
- No executor commits. The team-leader owns git.

## Plan validation

Status: PASSED WITH RISKS

Reviewer notes carried from implementation-plan-review.md round 2:

- N-A (MUST FIX) — on the S1a SDK path the leftover thread options (`webSearchEnabled`, `approvalPolicy`,
  `modelReasoningEffort`; `codex-cli.adapter.ts:648-668`, verified on HEAD) are emitted AFTER the raw
  `configOverrides`, so they win. `codexWebSearch=false` would be silently ignored. Fixed in Task 4.3 and pinned in
  Task 4.4.
- N-B — the plan header (:10) says S1b is independent of S1a; the Sequencing table (:1376) says S1b depends on S1a. The
  Sequencing table governs: Batches 8-9 run after Batch 4.
- N-C — the cli-agent-runtime capture entry calls components 1, 5 and 11. It is placed in Batch 11 (after S1a Batches
  1 and 5), and its OpenCode part is added in Batch 13 together with component 11. M (Batch 10) has no such dependency.

Assumptions:

- D9 (no new platform port; reuse `harness-sync` `codex-home.ts`) — unverified as an explicit answer. context.md
  decision 8 records "approved" for plan revision 2, which contains D9 as its Gate 2 question. Treated as accepted.
  If the orchestrator knows otherwise, a platform-port batch must be inserted before Batches 1, 10, 18 and 32 (plan
  :323-325).
- AS5 / AS15 (Codex config rejection shape) — unverified. Task 4.2 captures the no-model-call fixture with the bundled
  binary and builds the matcher. Task 8.2 reuses it.
- AS6 (role survives on resume) — unverified. S1a keeps `CODEX_RESUME_RESENDS_ROLE = true`. Task 10.3 runs the offline
  `--resumed` report. C2 at QA decides S5.
- AS7 (OpenCode `step_finish` tokens per step, `cache.read`) — checked offline in Task 13.4.
- AS8 (OpenCode compaction trigger) — checked offline in Task 13.3 before `OPENCODE_COMPACTION_RESERVED_TOKENS` is set.
- AS9 (`updatedToolOutput` must keep shape) — Task 25.1 rewrites only the text field inside the original shape and is
  fail-open.
- AS10 (forwarded subagent messages carry `message.usage`) — checked with a transcript fixture in Task 28.1.
- AS11 (session id reaches the translator) — checked in Task 12.3. Fallback is the routing id, logged once.
- AS12 (Ollama `/api/show` context length) — checked in Task 12.1. Failure means "unknown".
- AS14 (every host builds `ConfigManager` with `FILE_BASED_SETTINGS_KEYS`) — checked in Task 17.1 before the
  compaction keys are rerouted.
- R3.4 "before" figures — the plan asks S2 to record R3.4 and R3.6 before tables. R3.6 before/after comes from the
  all-roles table spec (Task 5.1). R3.4 per-item "before" chars come from context.md § Evidence and research-report.md
  (role 34,608, base 21,428, guidance 12,474, skills 21,070, agent blocks about 2,700), because the capture entry can
  only run on post-S1a code (N-C). Task 10.3 records them with that source. QA confirms.

| Risk                                                                                                                                                                      | Severity | Mitigation                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The worktree has no `node_modules`, so no verification command can run                                                                                                    | HIGH     | Task 1.0 runs `npm ci` in the worktree before any code change                                                                                              |
| N-A: SDK thread options override the builder's `web_search`, `approval_policy`, `model_reasoning_effort`                                                                  | HIGH     | Task 4.3 keeps only `model`, `sandboxMode`, `workingDirectory`, `skipGitRepoCheck` as thread options; Task 4.4 asserts on the argv the SDK double receives |
| Per-turn `Codex` instance on `continue()` loses the thread or the abort/cleanup guarantees                                                                                | HIGH     | Task 4.3 uses `resumeThread(threadId)` with the resume variant; Task 4.4 pins `continue()` and abort                                                       |
| A Codex config rejection on the SDK path leaves the lane dead                                                                                                             | HIGH     | Task 4.2 + 4.3: one retry with essential keys only, WARN + info segment + `Lane policy` re-emit (`prefixKeys: 'dropped (config rejected)'`)                |
| `gpt-6-sol` rejected by the account                                                                                                                                       | MEDIUM   | Task 4.3 F10 error segment naming `agentOrchestration.codexModel`; no fallback model                                                                       |
| Rewriting the settings-routing spec case at `:111` hides a real regression                                                                                                | MEDIUM   | Task 6.3 rewrites it to the R2.3 order and keeps every key-form case unchanged                                                                             |
| Role condenser exceeds 10,000 chars on a heading-free body                                                                                                                | MEDIUM   | Task 5.1 cuts at the last paragraph break; table spec over every `.claude/agents/*.md`                                                                     |
| Removing `systemPrompt` from lanes drops guidance entirely                                                                                                                | MEDIUM   | Task 5.3 asserts the capped `projectGuidance` still reaches `buildTaskPrompt` once                                                                         |
| Runner (S1b) regresses abort/cleanup or leaks secrets in logs                                                                                                             | HIGH     | Task 8.2 spec: abort, consumer stop, non-zero exit, `redactSecrets` on bad-line and stderr excerpts                                                        |
| R1.3 OpenCode baseline lost if component 11 lands first                                                                                                                   | HIGH     | Task 10.3 records it; Batch 13 depends on Batch 10                                                                                                         |
| VS Code-set `compaction.threshold` lost when the manifest declaration is removed                                                                                          | MEDIUM   | Task 17.2 migration reads the raw VS Code value before any read moves to the store; never overwrites a store value; spec "runs once"                       |
| `compaction.*` reroute fails in a host that builds `ConfigManager` with another key set                                                                                   | MEDIUM   | Task 17.1 (AS14) checks each host first                                                                                                                    |
| TOML writer corrupts `~/.codex/config.toml`                                                                                                                               | HIGH     | Batch 18 byte-identity specs (comments, CRLF, tables, profiles, quoted duplicates), `.bak`, atomic write under lock, hash conflict                         |
| Plan serialisation "18 → 19 → 20 → 21" conflicts with 20 needing 21's context-usage port                                                                                  | MEDIUM   | Order changed to 18 (B25) → 21 (B26-27) → 19 (B28) → 20 (B29). Only the order of serial `di/tokens.ts` edits changes                                       |
| Lane-guard settings keys planned in S4, but the S3 UI card binds them                                                                                                     | LOW      | Keys contract moved into Batches 16-17 (S3). Enforcement stays in Batch 35 (S4). Unused keys with defaults change no behaviour                             |
| AS16: the `mcp_servers={...}` inline-table disable form (Batch 1 deviation) behaves differently in `codex exec` than in `mcp list`, or names a server Codex does not load | MEDIUM   | Task 4.3 retry drops the entry; QA offline `codex mcp list --json` + C1                                                                                    |
| Pi `inherit` passed raw to `pi --thinking` between the Batch 2 and Batch 6 commits (branch-only window, not shipped)                                                      | MEDIUM   | Task 6.3 routes Pi through the policy and pins it; the PR must not merge before Batch 6 is COMPLETE                                                        |
| `agent-process-manager.service.ts` (1,846 lines) edited by 4 batches                                                                                                      | MEDIUM   | Serial: Batch 6 → 32 → 33 → 35, matching plan order 4 → 14 → 15 → 16                                                                                       |
| A3 capper rewrites built-in output wrongly                                                                                                                                | MEDIUM   | Task 25.1 shape-preserving, fail-open, `mcp__ptah__*` skipped                                                                                              |
| Compaction coordinator stalls a session                                                                                                                                   | HIGH     | Task 26.1 BACKOFF after `COMPACTION_MAX_DWELL_MS`; Task 27.1 bounded watchdog dwell                                                                        |
| R6.2 unverified against the live Codex-proxy backend (F14)                                                                                                                | LOW      | Pinning spec in Task 12.3; QA records it as unverified                                                                                                     |

Edge cases:

- Codex binary version unknown or outside `CODEX_VERIFIED_VERSIONS` — warning, keys still emitted (Tasks 1.2, 4.2).
- No native Codex binary — S1a keeps the SDK `findCodexPath` fallback (Task 4.3); S1b refuses with the D2 message (Task 9.1).
- User Codex/OpenCode config unreadable — no disables plus one WARN (Tasks 1.1, 13.3).
- `CODEX_RESUME_RESENDS_ROLE` false case — builder spec proves omission (Task 1.2) though S1a ships `true`.
- Unknown effort string in setting or argument — ignored at its step, next step applies, log names it (Task 6.1).
- `inherit` effort — yields chat effort (Task 6.1); never written to TOML (Task 18.2).
- Invalid RPC writes — rejected with field name, never clamped, never masked by the generic catch (Tasks 3.2, 17.2, 17.4).
- U+2028 / U+2029 / U+0085 in stdout and split chunk boundaries (Task 8.1).
- Missing price or missing cache price with cache tokens > 0 — `costUsd = null` (Task 14.3).
- Provider with `reportsCacheUsage === false` — "not reported", never 0 (Task 22.2).
- `/api/show` timeout — window unknown, never 128000 (Task 12.1).
- TOML: multi-line string, duplicate bare/quoted key — preview refuses (Task 18.1); hash mismatch — conflict (Task 18.2).
- Manual `/compact` during TRIGGERED/COMPACTING — not resent (Task 26.1).
- Two PreCompacts inside the curator interval — fire once (Task 30.2).
- Rollout missing on resume — labelled estimate (Task 32.3).
- `ptah_run_check` bad project/target — schema rejects; timeout kills tree (Task 33.3). Wait/check replies ≤4,000 chars.
- Steer delivery `unsupported` — logged; stop threshold still applies (Task 35.4).

---

## Batch 1: Codex lane config builder (S1a, component 1) — COMPLETE (commit b9da189e7)

- Recommended executor: backend-developer
- Fallback executor: a second backend-developer run with the failing spec output attached
- Execution mode: sequential
- Rationale: new pure files in one library; Task 1.0 must finish before any spec can run
- Tasks: 3 | Depends on: none | Concurrent-safe with: Batches 2, 5, 10
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime`

### Task 1.0: Install worktree dependencies — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/node_modules` (generated, never committed)
- Plan reference: implementation-plan.md:94-96 (node_modules exists only in the main checkout)
- Pattern to follow: `package-lock.json` at the worktree root
- Quality requirements: run `npm ci` from the worktree root. Do not symlink or junction the main checkout's
  `node_modules`. Do not modify `package.json` or `package-lock.json`.
- Validation notes: confirm `node_modules/@openai/codex-sdk` and the `@openai/codex-<platform>` package exist (needed
  by Task 4.2's fixture capture and Batch 8).
- Implementation details: if `npm ci` fails, report the error. Do not work around it with `npm install`, which rewrites
  the lockfile.

### Task 1.1: Read-only user MCP server name reader — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-user-mcp-servers.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:571-601, :514 (key table row), D9 :309-325
- Pattern to follow: `libs/backend/harness-sync/src/lib/targets/mcp/codex-home.ts:44-59`; `parseMcpServerTables` and `codexHomeConfigFile` from `@ptah-extension/harness-sync` (`src/index.ts:201-213`); trust reader `harness-sync/.../codex-project-trust.ts:176`
- Quality requirements: read-only; home `config.toml` plus a trusted workspace `.codex/config.toml`; excludes `ptah`; returns `{ names, warnings }`.
- Validation notes: unreadable or unparsable file gives no names plus a warning (never throws). No `vscode-core` or `tsyringe` import in this file.
- Implementation details: reuse harness-sync owners only, add no path literal; spec covers home only, home + trusted workspace, untrusted workspace ignored, unreadable file.

### Task 1.2: `buildCodexLaneConfig` pure builder — COMPLETE

- Depends on: Task 1.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:177-189 (D1), :499-521 (key table and order), :440-446 (constants), :571-601
- Pattern to follow: `ptahMcpServerUrl` in `cli-adapters/ptah-mcp-url.ts`; SDK flattening notes at plan :116
- Quality requirements: returns ordered `string[]` of `key=value` (accepted unchanged as SDK `configOverrides` and as runner `--config`) plus `warnings`. Two variants, `first-turn` and `resume`. Exports `CODEX_RESUME_RESENDS_ROLE = true`, `CODEX_VERIFIED_VERSIONS = ['0.155','0.160']`, `CODEX_PTAH_TOOL_TIMEOUT_SEC = 960`. Dotted and special keys quoted with TOML basic-string rules. Numbers validated (finite integers ≥ 0; 0 omits the key). Pure: equal input gives byte-equal output.
- Validation notes: `features.tool_search_always_defer_mcp_tools` never emitted; `mcp_servers.ptah.enabled_tools` and `agents.max_depth` never emitted. Version input unknown or outside the list adds a warning. R9.7: two concurrent builds share no state.
- Implementation details: emit `agents.enabled=false`, `features.plugins=false`, `features.apps=false`, `skills.include_instructions=false`, `model_auto_compact_token_limit`, `tool_output_token_limit`, `web_search` ("live"/"disabled"), `approval_policy="never"`, `model_reasoning_effort` (when given), `mcp_servers.ptah.url` + `tool_timeout_sec` (when a port is given), `mcp_servers."<name>".enabled=false` per user server, `developer_instructions` (first turn always; resume only while the constant is true). The spec pins every key, the order, the quoting, both variants, a `false`-constant omission case, the missing dead flag, numeric validation and both version warnings.

### Batch 1 plan deviation (accepted by the team-leader; consistent with R3.1/R3.2)

- User-server disables are ONE entry, `mcp_servers={"<name>"={enabled=false},...}`, emitted immediately BEFORE
  `mcp_servers.ptah.*`, instead of plan :514's `mcp_servers."<name>".enabled=false` per server. Evidence (executor's
  offline probe of bundled codex 0.155.1, `codex -c ... mcp list --json`, scratch `CODEX_HOME`, no model call): Codex
  splits override KEYS on every `.` and ignores quotes, so the dotted form breaks the whole config; the VALUE is TOML
  and merges with file layers; a later `mcp_servers={...}` replaces earlier `mcp_servers.ptah.*` overrides, so order
  matters. R3.1 intent (per-lane disable of every user server except `ptah`, TOML-quoted names, read-only) is kept.
- The reader returns only names it can read exactly (bare, or quoted without escapes or dots split by the scanner) and
  skips the rest with a warning, because disabling a server Codex did not load fails the whole config. Plan intent
  ("odd config gives no disables plus a warning") is kept.
- Numbers: 0 omits silently; negative, fractional, NaN, infinite omit with a warning (no throw). Port outside 1-65535
  emits no ptah keys and warns.
- New assumption AS16: the inline-table form and its ordering behave the same in a real `codex exec` run as in
  `mcp list`. Checked at QA by the offline `codex mcp list --json` with captured overrides and by C1. Backstop: the
  Task 4.3 config-rejection retry, which drops the `mcp_servers={...}` entry.
- Batch 1 test-target note: the scoped `test` target failed on 5 EXISTING tests in files Batch 5 is editing
  concurrently (Codex, Antigravity, Copilot and ptah-cli "oversized role" tests; `PtahCliRegistry ... hands the
resolved policy to the spawn-option assembly`). Nothing imports the Batch 1 files (grep, team-leader), and the
  Batch 1 suites pass alone. These 5 tests are assigned to Batch 5 (see Batch 5 verification).

### Batch 1 fix round 1 (code-logic review APPROVED 7.5/10, sent back by the team-leader per orchestrator direction)

- F1 (M1, can break every lane): `validCount` must use `Number.isSafeInteger`; `1e21` renders as `1e+21`, which Codex
  parses as a float and rejects, failing the whole config. Unsafe or float-rendering values omit the key with a warning.
  Spec with `1e21`, `Number.MAX_SAFE_INTEGER + 1`, and a value just under the limit.
- F2 (M2): when the home or workspace config text holds an `[mcp_servers...]`-looking header the scanner did not
  report (for example a header with a trailing comment, odd spacing, or an array-of-tables form), the reader adds a
  warning naming the line, so a server that keeps loading is visible. Do not guess the name. Spec for the trailing-
  comment header.
- F3 (M3): the builder spec parses every emitted VALUE as TOML (wrap as `k = <value>` and parse with a minimal
  in-spec checker or a dev-only parser already in `node_modules`; do not add a dependency) and asserts the round-trip
  value, covering every escape class and the inline `mcp_servers={...}` table.
- F4: the purity spec must not wrap the sync builder in `Promise.all`; assert byte-equal output from repeated and
  interleaved calls with distinct inputs, and that the input object is not mutated.
- F5: the resume spec must assert `developer_instructions` IS present in both outputs when the constant is `true`
  (not only equality), and absent on resume when `resendRoleOnResume:false`.
- F6 (minor, trust scope): first verify offline (Git Bash, scratch `CODEX_HOME`, `codex mcp list --json`, no model
  call) whether Codex trusts a subdirectory or a git worktree of a trusted project. If it does, resolve the project root
  the same way Codex does inside `codex-user-mcp-servers.ts` (walk up to the `.git` entry; no git process) before the
  trust check, without editing harness-sync. If Codex does not, keep the exact-path rule and state the probe result in
  the file header. Over-reporting trust is the unsafe direction: disabling a server Codex did not load fails the config.
- Files: only the four Batch 1 files under `cli-adapters/codex/`.

### Batch 1 fix rounds 1-2 outcome (review round 3 APPROVED 8.5/10)

- F1-F6 done. R2-1: custom `project_root_markers` → no workspace layers plus a warning. R2-2: realpath before the
  trust check; unresolvable → untrusted plus a warning. 10 junction and worktree probes against codex 0.155.1 never
  over-trust. 87 tests.
- Residuals:
  - (a) The marker scan stops at the first `[` line, so a top-level multi-line array of arrays above
    `project_root_markers` could hide it → ACCEPTED, backstop is the Task 4.3 retry that drops `mcp_servers={...}` on a
    config rejection (pinned in Task 4.4).
  - (b) Markers in system or managed Codex config are not seen → ACCEPTED, same backstop.
  - (c) The deleted-working-directory warning repeats on every spawn → Task 4.3: log reader warnings once per distinct
    message per adapter instance.

### Batch 1 fix round 3 (team-leader; found at commit time)

- K1: the pre-commit `degradation-audit:lint` fails on
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-user-mcp-servers.ts:356`
  `[orphaned-suppression]`: the `// degradation-audit: optional-capability` marker attaches to no flagged site (the
  catch pushes a warning, so it is not a swallowed literal). Remove the orphaned marker, or move it to the exact site
  the audit flags if one exists. Prove it with
  `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1` (no
  `orphaned-suppression` line for `cli-adapters/codex/`) and re-run the Batch 1 specs. No other change.

### Batch 1 verification

- Both new files exist with real logic and specs; `node_modules` present in the worktree
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime` passes
- Reviewer: code-logic-reviewer (key correctness and ordering are behavioural)
- Edge cases: unreadable user config; version warnings; resume-without-role case

---

## Batch 2: Lane settings types — Codex budget keys and `inherit` (S1a, component 6 part 1) — COMPLETE (commit 70af32f03)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: contract-only edits in two libraries; downstream batches 3 and 6 read these types
- Tasks: 2 | Depends on: Task 1.0 | Concurrent-safe with: Batches 1, 5, 10
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/shared` and the three-app typecheck

### Task 2.1: File-based keys and defaults for the three Codex budget keys — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/platform-core/src/file-settings-keys.ts` (+ its spec)
- Plan reference: implementation-plan.md:396-421, :777-800
- Pattern to follow: existing `agentOrchestration.codexModel` entries at `file-settings-keys.ts:154, 162-174, 453, 461-473`
- Quality requirements: add `agentOrchestration.codexAutoCompactTokens` (120000), `agentOrchestration.codexToolOutputTokenLimit` (2500), `agentOrchestration.codexWebSearch` (true) to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`.
- Validation notes: lane-guard keys are NOT added here (they land in Batch 16).
- Implementation details: spec asserts the defaults are present.

### Task 2.2: RPC types and scoped keys — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc/rpc-auth.types.ts`
- Plan reference: implementation-plan.md:416-421, :460-461, :777-800
- Pattern to follow: `CLI_REASONING_EFFORT_VALUES` / `PI_REASONING_EFFORT_VALUES` at `rpc-agents.types.ts:156-176`; `SCOPED_SETTING_KEYS` `codexModel` entry at `rpc-auth.types.ts:346` (`appScopable:false, supportedTargets:['global']`)
- Quality requirements: `inherit` added to both effort arrays; `AgentOrchestrationConfig` and `AgentSetConfigParams` gain the three Codex budget fields; three `SCOPED_SETTING_KEYS` entries.
- Validation notes: `invalidReasoningEffort` (`agent-rpc.handlers.ts:80-93`) uses these arrays, so `inherit` is accepted with no handler change; Batch 3 confirms.
- Implementation details: types only; no runtime logic.
- Executor decision (recorded): the three new `AgentOrchestrationConfig` fields are optional so builders outside the batch (`agent-rpc.handlers.ts:192`) keep compiling. Task 3.2 fills them on every `agent:getConfig` response with defaults.
- Batch 2 style-review minors (batch-2-code-style-review.md): M1 `KNOWN_CONFIG_KEYS` gap → Task 3.1. M2 optional fields on `AgentOrchestrationConfig` → ACCEPTED (matches the newer-key convention `piReasoningEffort?`, `antigravityModel?`; making them required needs a `libs/shared` edit outside Batch 3's two libs; Task 3.2 guarantees the handler always populates them). M3 redundant non-negative-integer spec case → ACCEPTED (harmless pin, no behaviour). M4 JSDoc restates numeric defaults → Task 16.3 (drop the literals, point at `FILE_BASED_SETTINGS_DEFAULTS`).
- Follow-ups raised by the Batch 2 executor, each owned by a later task: (1) Pi `inherit` passed raw to `pi --thinking` → Task 6.3; (2) UI shows raw `inherit` → Task 21.3; (3) new keys missing from `KNOWN_CONFIG_KEYS` → Task 3.1.

### Batch 2 verification

- Keys, defaults, fields and `inherit` present; scoped and three-app typecheck pass
- Reviewer: code-style-reviewer (contract and registration consistency)

---

## Batch 3: Lane settings RPC — get/set and validation (S1a, component 6 part 2) — COMPLETE (commit d81210d77)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: validate-before-write logic in the RPC handler plus the export key list
- Tasks: 2 | Depends on: Batch 2 | Concurrent-safe with: Batches 4, 5, 10
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk`

### Task 3.1: `KNOWN_CONFIG_KEYS` entries — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`
- Plan reference: implementation-plan.md:777-800, :424
- Pattern to follow: existing entries at `settings-export.types.ts:59-60`
- Quality requirements: the three Codex budget keys are exportable (Batch 2 follow-up 3: they are absent from `KNOWN_CONFIG_KEYS` until this task lands).
- Validation notes: none beyond the existing spec.
- Implementation details: list additions only.

### Task 3.2: `agent:getConfig` / `agent:setConfig` with range validation — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (+ `agent-rpc.handlers.spec.ts` and the existing set-config spec)
- Plan reference: implementation-plan.md:777-800 (F17 at :35)
- Pattern to follow: `invalidReasoningEffort` `:80-93`; validate-before-write block `:282-295`; `getAgentCfg`/`setAgentCfg` `:1089-1109`
- Quality requirements: new validator beside `invalidReasoningEffort` (integers ≥ 0 for the token keys, boolean for web search), called inside the `:282-295` block, returns `{ success:false, error:'Unsupported <field> value' }` before any write. Never clamps.
- Validation notes: the generic catch at `:394-406` must never mask the message; spec proves a rejected field returns its own message and not "Could not save the orchestration settings.". Legacy migration list (`:1144-1155`) is NOT extended.
- Implementation details: get returns the three fields with defaults (fields are optional on `AgentOrchestrationConfig` since Batch 2; the handler must always populate them); round-trip spec; `inherit` accepted.

### Batch 3 verification record (team-leader)

- On disk (diff read): `invalidCodexBudget` (safe integer >= 0; boolean web search) runs inside the validate-before-write
  block right after `invalidReasoningEffort`, returning `Unsupported <field> value` before any write; writes only defined
  fields; `agent:getConfig` always fills the three fields through `getCodexBudgetTokens` / `getCodexWebSearch`
  (hand-edited invalid file values read as the default); `KNOWN_CONFIG_KEYS` gains the three keys (+ spec).
- Deviation ACCEPTED: `agent-rpc.handlers.spec.ts` does not exist; cases went into the existing
  `agent-rpc.handlers.set-config.spec.ts`.
- Handler-side defaults constant mirrors `FILE_BASED_SETTINGS_DEFAULTS`; ACCEPTED because a spec pins the two equal
  (rpc-handlers cannot read platform-core defaults without a new dependency direction). Batch 17's lane-guard keys must
  follow the same pinned pattern.
- Degradation audit (team-leader run on the working tree): exit 0. The one rpc-handlers finding
  (`agent-rpc.handlers.ts:1144`, catch returning `undefined` in the `agent:resumeCliSession` default-id lookup) is
  pre-existing code whose line shifted; the directory stays at its baseline (1 of 1). It does not block the hook.
- Typecheck: the combined run failed only on TS5023 (`--maxWorkers` forwarded to tsc); per-project typecheck passes.
  The commit hook runs lint only, so this is not a commit risk.
- Commit set (explicit paths): `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` + `.spec.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts`. NOT the Batch 4 files now in the
  worktree (`cli-adapter.interface.ts`, `cli-adapter.utils.ts` + spec, `codex/__fixtures__/`).

### Batch 3 review outcome (code-logic APPROVED 8.5/10) and commit

- Team-leader scoped verification: lint and typecheck pass for rpc-handlers and agent-sdk; Batch 3 suites pass
  (`agent-rpc.handlers*` 4 suites / 75 tests, settings-export 1 / 5). The only red suite,
  `rpc-handlers/.../chat-session-auth.spec.ts`, fails to compile Batch 4's in-flight `codex-cli.adapter.ts`
  (`resolveCodexNativeBinary` mid-rename); it is NOT a Batch 3 defect and must be green in Batch 4's verification.
- Moderate (settings IMPORT path does not validate values) → Task 4.3/4.4 (lane reader applies the same rule;
  already sent to the Batch 4 developer).
- Minor: no spec for a value above `MAX_SAFE_INTEGER` or for `-0` → Task 17.4 (same handler and spec). Intended
  behaviour: `-0` is ACCEPTED as 0 (`Number.isSafeInteger(-0)` and `-0 >= 0` are true; JSON stores it as `0`); a value
  above `MAX_SAFE_INTEGER` is rejected with the field name.
- Audit location resolved from the hook files: `.husky/pre-commit` runs lint-staged; `.lintstagedrc.mjs` runs
  `npx nx affected --target=lint` for any staged TS file; the `degradation-audit` Nx project's `lint` target IS the
  audit (`tools/degradation-audit/project.json`). So it runs at pre-commit indirectly as well as in CI (`ci.yml:143-146`).
  The reviewer's "CI only" reading is corrected. `agent-rpc.handlers.ts:1144` is pre-existing (`:1066` on HEAD),
  directory count at baseline.

### Batch 3 verification

- Handler validates before writing; spec covers rejection message; scoped command passes
- Reviewer: code-logic-reviewer (boundary validation)

---

## Batch 4: Codex adapter on the SDK path (S1a, component 3a + N-A) — COMPLETE (commit 30108c20c)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run with reviewer findings
- Execution mode: sequential
- Rationale: tightly coupled edits in one 1,158-line adapter; needs design judgment on per-turn SDK instances
- Verify also: `npx nx run-many -t test -p @ptah-extension/rpc-handlers` (transitive importer of the adapter)
- Tasks: 4 | Depends on: Batch 1, Batch 5 (Batch 5 edited `codex-cli.adapter.spec.ts`; start Batch 4 only after Batch 5 is committed) | Concurrent-safe with: Batches 3, 10
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime`

### Task 4.1: `laneBudgets` on `CliCommandOptions` — COMPLETE (commit 30108c20c)

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`
- Plan reference: implementation-plan.md:457-459
- Pattern to follow: existing optional fields of `CliCommandOptions`
- Quality requirements: `laneBudgets?: { autoCompactTokens: number; toolOutputTokenLimit: number; webSearch: boolean }`. No `cliVersion` field.
- Validation notes: the adapter must work when `laneBudgets` is absent (Batch 6 wires it): fall back to the plan defaults 120000 / 2500 / true.
- Implementation details: interface only.

### Task 4.2: Native binary version and config-rejection matcher — COMPLETE (commit 30108c20c)

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` (`resolveCodexNativeBinaryInfo`), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-config-rejection.ts` (+ spec, `codex/__fixtures__/`)
- Plan reference: implementation-plan.md:659-663 (version, F2), :621-632 (rejection + S1a note), AS15 :392
- Pattern to follow: `resolveCodexNativeBinary` and `relsFromPkg` at `codex-cli.adapter.ts:246-331` (package root four levels above `vendor/<triple>/<layout>/<binary>`)
- Quality requirements: `{ path, version }` from the owning `@openai/codex-<platform>` `package.json`; one cached `probeCliVersion(path)` fallback; `detect()` not used. Rejection matcher implements the AS15 regex, adjusted to a real fixture.
- Validation notes: capture the fixture with a no-model-call command on the bundled binary (for example `codex features list -c model_auto_compact_token_limit="x"`), store it under `codex/__fixtures__/`; redact nothing secret (none present). The matcher lives in its own file so Batch 8's runner reuses it.
- Implementation details: spec covers a fixture package tree, missing `package.json` → probe fallback, and the matcher against the captured fixture plus a non-matching stderr.

### Task 4.3: `runSdk` rewire with `configOverrides`, per-turn `Codex`, N-A fix — COMPLETE (commit 30108c20c)

- Depends on: Tasks 4.1, 4.2
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`; `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts` (+ spec, H4 per-block flags only)
- Plan reference: implementation-plan.md:650-676, :191-200 (D2 slice placement), :225-245 (D3, F10), implementation-plan-review.md § 2 item 1 (N-A)
- Pattern to follow: current `runSdk` at `:596-680`; `continue()` at `:790-791`; startup watchdog `:684-716`; `summarizeCliSdkError`
- Quality requirements:
  - First turn: `new sdk.Codex({ configOverrides: buildCodexLaneConfig(first-turn), env, codexPathOverride })`; each `continue()` turn and each `resumeSessionId` spawn constructs a new `Codex` with the resume variant and calls `resumeThread(threadId)`.
  - N-A: thread options carry ONLY `model`, `sandboxMode`, `workingDirectory`, `skipGitRepoCheck`. `webSearchEnabled`, `approvalPolicy`, `modelReasoningEffort` are removed from thread options; the builder alone emits `web_search`, `approval_policy`, `model_reasoning_effort`. The SDK `config` object option is no longer used.
  - Delete the dead `tool_search_always_defer_mcp_tools` block (`:623-632`).
  - Config rejection on the SDK error text ("Codex Exec exited with code ..." + stderr): ONE retry with only `mcp_servers.ptah.*`, `developer_instructions`, `approval_policy`, `web_search` and `--model`; WARN with redacted stderr excerpt (≤200 chars, `redactSecrets`); `info` segment "Codex rejected a lane budget key; this run uses Codex defaults and the full Codex prefix"; second failure is a normal error segment. Expose the retry state so Batch 6's `Lane policy` line can carry `prefixKeys: 'dropped (config rejected)'`.
  - F10: model-not-found / unsupported-model text with source `ptah-default` emits "Codex rejected `gpt-6-sol`, Ptah's lane default. Set `agentOrchestration.codexModel` to a model your account offers." With another source, the message names it. Never retry with another model. (Until Batch 6 passes the source, treat an undefined source as "setting or request".)
  - `SUPPORTED_MODELS` (`:507-514`) becomes `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, noting Ptah's default.
  - Resume-site comment: role resent while `CODEX_RESUME_RESENDS_ROLE` is true, with the measured extra chars (from the condensed role length); tokens filled in S5.
  - Keep `buildTaskPrompt(..., resumeRestoresContext: true)`; keep the no-binary SDK `findCodexPath` fallback.
- Validation notes: abort and consumer-stop cleanup must still kill the child (SDK `finally`, `:738-746`). Version from Task 4.2 is passed to the builder and logged. `assertCommandLineWithinLimit` still checks `developer_instructions`.
- Batch 1 hand-off notes (binding for this task):
  1. N-A: remove the leftover thread options; the builder already emits `web_search`, `approval_policy` and `model_reasoning_effort` as entries.
  2. The "essential keys only" retry must LEAVE OUT the `mcp_servers={...}` user-server entry (it is the likeliest rejection cause, AS16), while keeping `mcp_servers.ptah.url`, `mcp_servers.ptah.tool_timeout_sec`, `developer_instructions`, `approval_policy`, `web_search` and `--model`.
  3. Call `readCodexUserMcpServerNames(workingDirectory)` per spawn and send its `warnings` together with the builder's `warnings` to the lane log (the adapter's logger sink); never to the stream.
- Batch 3 review (moderate): settings IMPORT does not validate values, so the lane must not trust stored values. The lane budget reader (`resolveLaneBudgets` or the adapter's fallback) applies the same rule as the RPC handler — token budgets are safe integers >= 0, web search is a boolean — and otherwise uses the default (120000 / 2500 / true) with one WARN naming the key. Task 4.4 adds spec cases: a string, a float, a negative value, a value above `MAX_SAFE_INTEGER`, and a non-boolean web search.
- Batch 3 verification: `rpc-handlers/.../chat-session-auth.spec.ts` imports this adapter transitively; it must be green when Batch 4 is verified (run `-p @ptah-extension/rpc-handlers` test as well).
- Batch 1 residual (c): log reader warnings once per distinct message per adapter instance (a deleted working directory must not warn on every spawn). The retry that drops `mcp_servers={...}` is the backstop for Batch 1 residuals (a) and (b) and for AS16.
- Batch 5 hand-off (binding): (H6) the `assertCommandLineWithinLimit` call on `developer_instructions` alone is unreachable since the role cap; replace it with a guard over the WHOLE `configOverrides` list that the SDK will put on argv (reachable with many user servers or a long role plus budgets), and add a spec that drives it through the real path to `CliCommandLineTooLongError`. (H4, revised after Batch 5 review round 2) Replace the Batch 5 option `resumePreamblesDelivered: boolean` in `cli-adapter.utils.ts` with per-block flags, e.g. `resumeDeliveredPreambles?: { toolPolicy: boolean; messaging: boolean }`; `buildTaskPrompt` omits each block on a restored-context resume only when its own flag is true; absent keeps both. Update Batch 5's specs in `cli-adapter.utils.spec.ts` for the new signature (no `V2`/alias; replace in place). In the Codex adapter, record per handle what the first turn's prompt actually carried (tool policy always on a first turn; messaging only when that turn had `agentId` and `mcpPort`) and pass those flags on `continue()` turns. A `resumeSessionId` spawn (new process) passes nothing. Specs: both carried → both omitted; tool policy only → messaging kept, policy omitted; none → both kept.
- Builder contract (Batch 1): `buildCodexLaneConfig(input) → { entries, warnings }`; pass `entries` as `configOverrides`. Leave `resendRoleOnResume` unset.
- Implementation details: the adapter must lose lines overall; new logic goes in the `codex/` collaborators.

### Task 4.4: Adapter spec on the argv the SDK double receives — COMPLETE (commit 30108c20c)

- Depends on: Task 4.3
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts`
- Plan reference: implementation-plan.md:677-684; review N-A
- Pattern to follow: existing SDK double in the same spec. Batch 5 already replaced the "oversized role rejected before the Codex client is constructed" case with "oversized role capped to ≤10,000 in `developer_instructions`" and removed the `CliCommandLineTooLongError` import; keep that case passing on the new `configOverrides` path (the role now arrives inside the `developer_instructions=` entry).
- Quality requirements: assert the RESUME-variant overrides (resume spawn and `continue()`) contain `skills.include_instructions=false` (Batch 10 finding a); assert the retry argv omits the `mcp_servers={...}` entry and keeps the ptah keys; assert reader and builder warnings reach the log sink; assert first-turn overrides contain `developer_instructions`; resume and `continue()` overrides follow the constant; the dead flag never appears; ptah URL scoped per workspace and agent; `web_search` live by default AND `codexWebSearch=false` yields `web_search="disabled"` with NO later thread-option override (N-A pin); `approval_policy` and effort come only from overrides; version from the platform package and the probe fallback; F10 message for `ptah-default`; config-rejection retry runs once and a second failure is an error.
- Validation notes: assertions inspect the options the double receives, not the builder output alone.
- Implementation details: none beyond the cases.

### Batch 4 verification

- Thread options limited to the four keys; dead flag gone; spec covers N-A; scoped command passes
- Reviewer: code-logic-reviewer (process lifecycle, retry and override precedence are behavioural)

### Batch 4 outcome (recorded by the team-leader)

- Review: code-logic-reviewer NEEDS_REVISION (1 Serious, 4 Moderate, 2 Minor), fix round 1 fixed S1, M1, M2, M3;
  re-review APPROVED (0 Blocking, 0 Serious).
- Verified before commit: `typecheck,lint` and `test --maxWorkers=2` on `@ptah-extension/cli-agent-runtime` and
  `@ptah-extension/rpc-handlers` all green (136 + 83 suites; `chat-session-auth.spec.ts` included). Pre-commit hooks passed.
- Plan deviations accepted: resolver lives in `codex/codex-native-binary.ts`; new collaborators
  `codex-exec-args.ts`, `codex-model-rejection.ts`, `codex-lane-budgets.ts` (adapter net shorter).
- Re-review Moderate (dotted model names such as `gpt-5.1-codex` miss the F10 matcher at
  `codex/codex-model-rejection.ts:18`; the original Codex text still reaches the user, only the settings advice is
  lost) → NOT fixed here (lean rule 4: no lane config break, no data loss); recorded as Task 9.3.
- Remaining Minor items from the first review: recorded only, not scheduled.

---

## Batch 5: Role cap, guidance once, resume preambles (S1a, component 5) — COMPLETE (commit abe828c2b)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: shared rendering seam across two libraries; ordering between condenser and callers
- Tasks: 4 | Depends on: Task 1.0 | Concurrent-safe with: Batches 1, 2, 3, 4, 10
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools`

### Task 5.1: `condenseLaneRole` and the all-roles table spec — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/lane-role-condenser.ts` (+ `.spec.ts`, + a table spec)
- Plan reference: implementation-plan.md:261-281 (D5), :733-775
- Pattern to follow: `renderRoleBlock` at `cli-adapter.utils.ts:465-477`; `AgentRoleDefinition.sourcePath` `agent-process.types.ts:81-82`
- Quality requirements: `LANE_ROLE_MAX_CHARS = 10_000`; keeps pre-heading text then whole `## ` sections in order; cuts a section that does not fit at its last paragraph break; ends with one pointer line naming omitted headings and "the full definition is at `<sourcePath>`; read a section only when the task needs it". Cap includes header and pointer.
- Validation notes: heading-free body cut at last paragraph break. Table spec renders every `.claude/agents/*.md` in the repo for Codex and opencode, asserts ≤10,000, and prints the before/after table (R3.6 record).
- Implementation details: synthetic 5k, 12k, 25k bodies.

### Task 5.2: `renderRoleBlock` applies the cap; resume omits preambles — COMPLETE

- Depends on: Task 5.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts` (+ `cli-adapter.utils.spec.ts`)
- Plan reference: implementation-plan.md:740-745, :756
- Pattern to follow: `buildTaskPrompt` `:490-549`; `NATIVE_AGENT_TOOL_POLICY` `:409-415`; `TWO_WAY_MESSAGING_GUIDANCE` `:442-447`; completion contract `:540-546`
- Quality requirements: on `resumeSessionId && resumeRestoresContext`, omit the tool policy and the messaging block; keep the completion contract. First turn keeps all three.
- Validation notes: keep the 826-byte pin (`:432-436`) and the TASK_2026_515 completion contract green. Guidance-once spec on Codex `developer_instructions` + task prompt and on the opencode prompt: guidance appears at most once.
- Implementation details: resume spec asserts neither block present and the contract kept.

### Task 5.3: Namespace builder stops attaching `systemPrompt` — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts` (+ spec)
- Plan reference: implementation-plan.md:124, :739
- Pattern to follow: `:198` (`projectGuidance`), `:290-316`
- Quality requirements: system-CLI spawns get the capped `projectGuidance` only; `systemPrompt` is neither fetched nor attached for them.
- Validation notes: spec asserts guidance still reaches the spawn request once.
- Implementation details: do not touch `ptah.agent.waitFor` here (Batch 34).

### Task 5.4: Ptah-CLI spawn options drop the second guidance copy — COMPLETE

- Depends on: Task 5.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts` (+ spec)
- Plan reference: implementation-plan.md:740-741, :754
- Pattern to follow: `:183-206`
- Quality requirements: remove the appended `## Project Guidance` copy; role at `:203` rendered through `renderRoleBlock`.
- Validation notes: Ptah-CLI skill listing and agent-listing delta are kept (justified, measured).
- Implementation details: spec asserts one guidance copy and a capped role.

### Batch 5 verification record (team-leader)

- Out-of-scope edits ACCEPTED (each forced by the change; no other running batch owns them):
  `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (dead `getSystemPrompt` wiring and
  the unused `getEnhancedPromptContent` member of the local `EnhancedPromptsServiceLike` removed; the real service
  method stays, still used by `chat-sdk-context.service.ts:58`, `gateway-chat-bridge.ts:646`,
  `wizard-generation-rpc.handlers.ts:587`); `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
  (`projectGuidance` option and positional argument removed; no other caller passes it, grep); specs
  `ptah-cli-registry-capabilities.spec.ts`, `ptah-cli-registry-auto-compact-argv.spec.ts`,
  `ptah-cli-spawn-options.session-ids.spec.ts`, `antigravity-cli.adapter.spec.ts`, `copilot-sdk.adapter.spec.ts`,
  `codex-cli.adapter.spec.ts` (the 5 tests assigned from Batch 1 are fixed with real updates).
- `systemPrompt` write-path trace: the only producer for CLI lanes was the namespace builder (removed). The MCP spawn
  schema is `.strict()` with no `systemPrompt`, and no other code sets `SpawnAgentRequest.systemPrompt` (grep of
  `systemPrompt?:` across libs and apps). Remaining references are pass-throughs only:
  `agent-process-manager.service.ts:349`, `cli-adapter.interface.ts:47`, `cli-adapter.utils.ts:507`
  (`options.systemPrompt || options.projectGuidance`), `agent-process.types.ts:191`, and an antigravity comment
  (`:47`, `:650`). The chat-session `systemPrompt` (`chat-session.service.ts:722`, `chat-ptah-cli.service.ts:167`) is a
  different path (Claude chat), unaffected. Ptah-CLI lanes still get guidance once via `enhancedPromptsContent`
  (`sdk-query-options-builder.ts:318`). Result: nothing a lane needs is dropped; the leftover field is dead and is
  removed in Task 6.5 (replace, do not accumulate).
- Role pointer target: `AgentRoleDefinition.sourcePath` has one producer, `agent-role-resolver.service.ts:91-127`, which
  sets it to the absolute path it just read (`join(agentsDir, fileName)`). The resolver is in `cli-agent-runtime`, used
  by all three hosts, so the pointer always names a file that existed at spawn on that host. Recorded.
- Commit set for Batch 5 (stage by explicit path): the 3 new `lane-role-condenser*` files, `cli-adapter.utils.ts` + spec,
  `ptah-cli-spawn-options.service.ts` + `.role.spec.ts` + `.session-ids.spec.ts`, `agent-namespace.builder.ts` + spec,
  `ptah-api-builder.service.ts`, `ptah-cli-registry.ts`, `ptah-cli-registry-capabilities.spec.ts`,
  `ptah-cli-registry-auto-compact-argv.spec.ts`, `antigravity-cli.adapter.spec.ts`, `copilot-sdk.adapter.spec.ts`,
  `codex-cli.adapter.spec.ts`. NOT `package.json` or `scripts/` (Batch 10).

### Batch 5 fix round 1 (code-logic review APPROVED 7/10, sent back per orchestrator direction; batch-5-code-logic-review.md "Failure modes")

- H1 (whole-body loss): when no paragraph break fits, fall back to the last line break, then to a hard cut at a code-point
  boundary (never split a surrogate pair or a fence). Applies to the opening unit and to the first section that does not
  fit; later sections that still fit after a partial cut are kept in order. If nothing of the body fits, the header must
  not claim "the definition below governs" over an empty body: use a header variant that points to the full file. Specs:
  `'x'.repeat(50000)`, 5,000 single-newline lines, `## A` with one 30k paragraph then a small `## B` (A cut short, B
  kept if it fits).
- H2 (pointer crowds out content): bound the omitted-name list to a fixed char budget (for example 600 chars, then "and
  N more"), computed AFTER the kept text, so the pointer never takes room the kept text needs. Spec with 3,000
  sections: kept text non-empty, pointer ≤ the budget, total ≤ 10,000.
- H3 (quadratic cost): with the bounded list, condensing is linear in input size. Spec: 8,000 sections in < 200 ms
  (generous bound; assert, do not only log).
- H4 (preamble omitted when the first turn never carried it): safe rule — `buildTaskPrompt` omits
  `NATIVE_AGENT_TOOL_POLICY` and `TWO_WAY_MESSAGING_GUIDANCE` on a restored-context resume ONLY when the caller passes a
  new explicit option `resumePreamblesDelivered: true`. Default (absent) keeps both blocks. No adapter sets it in this
  batch (Codex and Cursor therefore keep sending them on resume, which is today's behaviour). Task 4.3 sets it for Codex
  `continue()` turns only when that adapter instance's first turn actually included each block (track per handle;
  messaging requires the first turn's `agentId` and `mcpPort`). Specs: absent → both kept on resume; true → both
  omitted; completion contract always kept.
- H5 (guidance must never drop to zero where it was non-zero): in
  `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`, when the stored
  generated prompt has no `## Project-Specific Guidance` marker, `getProjectGuidanceContent` returns the WHOLE generated
  prompt passed through the existing `PROJECT_GUIDANCE_MAX_BYTES` cap (same helper at `:82-100`), instead of `null`.
  Return `null` only when there is no generated prompt at all. One cap, one owner; both the system-CLI lane path and
  the Ptah CLI path benefit. Specs: marker present (unchanged), marker absent (capped slice ≤ 4,000 bytes, non-empty),
  no prompt (null). This adds `agent-generation` as a third library to Batch 5, accepted: it is the single owner of the
  cap and a one-method change.
- H6 (dead Codex command-line guard): assigned to Task 4.3, which rewrites that exact block (`codex-cli.adapter.ts:636-640`).
  Batch 5 does not touch `codex-cli.adapter.ts`.
- H7 (minor, fence close): a closing fence must have nothing but the fence markers (and whitespace) on the line; an
  info-string line such as "```ts" inside a fence does not close it. Spec.
- H8 (minor, weak specs): the Codex cap case in `codex-cli.adapter.spec.ts` must also assert that the identity
  paragraph survives (for a body with paragraph breaks) and the pointer names `sourcePath`; rename the Ptah CLI
  "64 KiB role" case in `ptah-cli-registry-auto-compact-argv.spec.ts` to what it now proves (a capped role travels over
  initialize, never argv or env) and drop the misleading 64 KiB fixture size if it no longer matters.
- Accepted, recorded (no change): review Moderate 3 — the 10,000 cap is above the 8,191 Windows `.cmd` shim limit, so
  an argv adapter on a shim-fallback host can still raise `CliCommandLineTooLongError`. Pre-existing, loud, and smaller
  than before. `ptah.agent.spawn({ systemPrompt })` from `execute_code` remains an explicit caller choice; Task 6.5
  re-checks it before removing the field (stop and report if that path is still used).
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/agent-generation`.

### Batch 5 fix round 1 outcome (review round 2 APPROVED 8/10)

- H1-H5, H7, H8 verified by the reviewer by running the code (2,000-size boundary scan, 8,000 sections in 11 ms, default
  keeps both preambles, 826-byte pin and completion contract unchanged). Three-project verify exit 0. H5 committed diff
  of `enhanced-prompts.service.ts` checked by the team-leader: only the H5 change and its doc comment, no formatter
  churn; no other batch edits that file.
- Moderate (assigned to Task 4.3): the resume saving is inert until an adapter sets the option, and one boolean cannot
  express a first turn that carried the tool policy but not the messaging block. Task 4.3 replaces
  `resumePreamblesDelivered: boolean` with per-block flags and may change the Batch 5 signature.
- Minor: the head slice of a marker-less legacy prompt may be boilerplate → ACCEPTED (legacy or hand-edited state only;
  the generator always writes the marker; non-zero guidance was the requirement).
- Minor: a hard cut can end mid-word → ACCEPTED (last-resort path after paragraph and line breaks; announced by the
  pointer; no repository role reaches it).
- H6 (dead Codex guard) remains with Task 4.3.

### Batch 5 verification

- Every role ≤10,000; guidance once; resume preambles omitted; scoped command passes
- Owns the 5 existing tests found failing during Batch 1 verification, which must pass with REAL updates, not
  deletions: the "oversized role" tests in the Codex, Antigravity, Copilot and ptah-cli specs (rebuild them so the
  command-line / initialize-request guard is still exercised, e.g. with an oversized non-role input or a role whose
  capped render still breaches the limit, or state why the guard is now unreachable for roles and move the case to
  another oversized input), and `PtahCliRegistry.spawnAgent > ordering > hands the resolved policy to the spawn-option
assembly` (update for the new `assembleSpawnOptions` argument position).
- Reviewer: code-logic-reviewer (prompt content correctness)

---

## Batch 6: Lane spawn policy — model default, effort precedence, log (S1a, component 4 core) — COMPLETE (commit 15a8362d4)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: cross-file change through the spawn environment and the manager; serial edit of the manager
- Tasks: 5 | Depends on: Batches 2, 4, 5 | Concurrent-safe with: none in S1a
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared` and the three-app typecheck

### Task 6.1: `lane-spawn-policy.ts` — COMPLETE (commit 15a8362d4)

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts` (+ spec)
- Plan reference: implementation-plan.md:249-259 (D4), :688-704; task-description.md R2.3 (six steps)
- Pattern to follow: `mapEffortToCli` / `mapEffortToAgy` / pi raw at `agent-spawn-environment.service.ts:85-115` (MOVE, not copy)
- Quality requirements: `resolveLaneModel` → `{model, source: 'request'|'setting'|'ptah-default'|'cli-default'}` (`CODEX_LANE_DEFAULT_MODEL = 'gpt-6-sol'`, Codex only); `resolveLaneEffort` → `{effort, step: 1..6}`; `isReviewerOrTester` (ends with `-reviewer` or equals `senior-tester`; undefined false). `findBlockedLaneModel` is NOT added here (Batch 35).
- Validation notes: unknown effort ignored at its step, next step applies, the ignored value is returned for logging. Recorded behaviour change: pi and antigravity follow R2.3.
- Implementation details: one spec case per step, both identification cases, every model source.

### Task 6.2: `SpawnAgentRequest.effort` — COMPLETE (commit 15a8362d4)

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/agent-process.types.ts`
- Plan reference: implementation-plan.md:450-451
- Pattern to follow: `SpawnAgentRequest` `:151-209`
- Quality requirements: `effort?: string` only. Usage fields, `stopReason`, `lastRequestContext` land in later batches.
- Validation notes: three-app typecheck.
- Implementation details: type only.

### Task 6.3: Spawn environment delegates; returns lane budgets; routing spec rewrite — COMPLETE (commit 15a8362d4)

- Depends on: Task 6.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.settings-routing.spec.ts`
- Plan reference: implementation-plan.md:699-705, :724-727 (F17)
- Pattern to follow: routed reads `getConfiguration('ptah', 'agentOrchestration.<key>', default)` at `:124-127, 147-150, 173-175`; invalid file value → default pattern `:196-210`
- Quality requirements: `resolveModel` / `resolveReasoningEffort` delegate to the policy; new `resolveLaneBudgets()` returns the three Codex budgets with defaults.
- Validation notes: Batch 2 follow-up 1 — since Batch 2, `PI_REASONING_EFFORT_VALUES` accepts `inherit`, and today's Pi branch (`agent-spawn-environment.service.ts:122-129`) passes the setting raw, so a saved `inherit` becomes `pi --thinking inherit`. This task must route Pi through `resolveLaneEffort` so `inherit` resolves to the chat effort (or the next R2.3 step) and is NEVER passed raw; add a routing-spec case for Pi `inherit`. Codex and Copilot already drop `inherit` through `mapEffortToCli`; keep a spec case proving it never reaches argv. The case "still prefers the UI effort selection over the file-stored value" (`:111`) is REWRITTEN: a concrete setting wins over the UI effort, and `inherit` yields the UI effort. Key-form cases unchanged.
- Implementation details: no key-form changes (upstream did it).

### Task 6.4: `doSpawnSdk` passes effort, role name, budgets; `Lane policy` INFO line — COMPLETE (commit 15a8362d4)

- Depends on: Tasks 6.2, 6.3
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (doSpawnSdk only, + spec)
- Plan reference: implementation-plan.md:706-710 (minus the blocked-model refusal), :1361
- Pattern to follow: `doSpawnSdk` `:280-370`
- Quality requirements: passes `effort: request.effort`, `roleDefinition.name`, `laneBudgets`, and the model source to the adapter; logs one INFO `[AgentProcessManager] Lane policy` with model, modelSource, effort, effortStep, Codex binary version and prefix-key state (re-emitted with `prefixKeys: 'dropped (config rejected)'` when Batch 4's retry fires).
- Validation notes: no new `vscode-core` import; existing `Logger` only. Do not touch the resume warning (`:332-336`, Batch 32).
- Implementation details: spec asserts the log line fields.

### Task 6.5: Remove the dead `systemPrompt` spawn field — COMPLETE (commit 15a8362d4)

- Depends on: Batch 5 (producer removed), Task 4.1 (same interface file)
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/agent-process.types.ts` (`SpawnAgentRequest.systemPrompt`), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (`:349` pass-through), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts` (`:47`), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts` (`:488`, `:507`) and the antigravity adapter comments (`:47`, `:650`)
- Plan reference: Batch 5 verification record (systemPrompt trace); working rule "replace, do not accumulate"
- Pattern to follow: Batch 5's removal of `getSystemPrompt`
- Quality requirements: re-grep first; if any producer of `SpawnAgentRequest.systemPrompt` exists, stop and report instead of removing. Known candidate: `ptah.agent.spawn({ systemPrompt })` through `execute_code` (`agent-namespace.builder.ts:304-317` `...requestFields`); decide with evidence whether it is a supported caller field (keep it and keep the `systemPrompt ||` branch, documented) or remove it from the namespace surface too. Otherwise remove the field, the pass-through and the `systemPrompt ||` branch so `buildTaskPrompt` uses `projectGuidance` only; update comments and specs that set `systemPrompt`.
- Validation notes: chat-session `systemPrompt` (Claude chat path) is NOT touched. Three-app typecheck.
- Implementation details: the antigravity edit is comment-only.

### Batch 6 verification

- Policy pure and fully specced; routing spec rewritten; manager log line; scoped + app typecheck pass
- Reviewer: code-logic-reviewer (precedence order)

Verification record (commit 15a8362d4, 15 files):

- `npx nx run-many -t typecheck,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers`: exit 0.
- `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli`: exit 0.
- `npx nx run-many -t test -p` (the same four projects) `--maxWorkers=2`: "Successfully ran target test for 4 projects", exit 0.
- Pre-commit hooks (format, affected lint, electron validate-deps, commitlint) passed. No hooks were skipped.
- code-logic-reviewer: APPROVED 8/10, with 0 Blocking, 0 Serious, 2 Moderate and 3 Minor findings (`batch-6-code-logic-review.md`). Under lean rule 4 there was no fix round. Each finding is routed below.
- Plan deviations accepted from the executor report:
  - `resolveModel` and `resolveReasoningEffort` return structured results.
  - `codexVersion` comes from `detection.version` through the internal `SdkSpawnOptions.cliVersion`, which is never passed to the adapter (F2).
  - The `Lane policy` line is logged before `runSdk`.
  - The `agent-spawn-environment.service.spec.ts` edit and the three adapter-spec fixture edits were needed for the new return shape and the removal of `systemPrompt`.

Batch 6 follow-ups (recorded, not fixed now):

- **F6-M1 (Moderate):** a caller-supplied `systemPrompt` passed through `execute_code` `ptah.agent.spawn({systemPrompt})` (`agent-namespace.builder.ts` `...requestFields`) is now dropped without any signal. Owner: Task 34.2, which owns `agent-namespace.builder.ts`. Destructure and drop the field with a one-line WARN, as `roleDefinition` already is. Also validate that `effort` is a string at that boundary (review Q5).
- **F6-M2 (Moderate, behaviour note):** Pi lanes now follow the chat effort when the Pi setting is empty (R2.3 step 5). Reviewer and tester lanes get `medium`. Other Pi lanes can now get `max`/`xhigh` when that is the chat effort. This is intended per D4. Record it in the release notes and the QA handoff (Mode 3). No code change.
- **F6-m1 (Minor):** `prefixKeys: 'applied'` is logged before `runSdk`, so it records intent rather than outcome. Owner: Task 35.4, which edits the same `doSpawnSdk` path. Either document it as intent, or only emit `applied` once `runSdk` resolves.
- **F6-m2 (Minor):** `ignoredEfforts` echoes the raw spawn `effort` without a length limit, and a non-string effort logs as `[object Object]`. Owner: Task 35.4. Use `String(value).slice(0, 32)`.
- **F6-m3 (Minor, note):** `isReviewerOrTester` is an exact, case-sensitive match, as R2.4 is written. Owner: Task 35.3, which edits `lane-spawn-policy.ts`, if R2.4 is ever relaxed. No change now.
- **F6-c (stale comments):** three places still name `AgentSpawnEnvironment.mapEffortToCli`, which now lives in `lane-spawn-policy.ts`. Each is assigned to the task that owns its file:
  - `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:160`: Task 16.3
  - `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts:153`, the test title: Task 17.4
  - `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.ts:24`: Task 21.3

---

## Batch 7: `effort` on the spawn surfaces (S1a, component 4 surface) — COMPLETE (commit d992ea3b9)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: four files in one library kept equal by the parity spec
- Tasks: 3 | Depends on: Batches 5, 6 | Concurrent-safe with: Batch 10
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools`

### Task 7.1: zod schema `effort` — COMPLETE (commit d992ea3b9)

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts` (+ spec)
- Plan reference: implementation-plan.md:129, :711
- Pattern to follow: `.strict()` schema `:15-33`
- Quality requirements: optional `effort` string; schema stays strict.
- Validation notes: invalid types rejected.
- Implementation details: none.

### Task 7.2: Advertised schema — COMPLETE (commit d992ea3b9)

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (+ spec)
- Plan reference: implementation-plan.md:129
- Pattern to follow: `:602-728`
- Quality requirements: `effort` described with the allowed values and that it is step 1 of R2.3.
- Validation notes: keep the description short (token cost).
- Implementation details: none.

### Task 7.3: Both dispatchers and the parity spec — COMPLETE (commit d992ea3b9)

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts` (+ `agent-spawn-surface-parity.spec.ts`)
- Plan reference: implementation-plan.md:129, :711
- Pattern to follow: `protocol-dispatcher.ts:1058-1102`; `agent-tool.dispatcher.ts:350-364`
- Quality requirements: both forward `effort` into `SpawnAgentRequest`.
- Validation notes: parity spec keeps HTTP and stdio equal.
- Implementation details: none.

### Batch 7 verification

- `effort` flows from both MCP surfaces; parity spec green; scoped command passes
- Review (decision 11): no per-batch review; scoped `typecheck,lint,test` before commit; covered by the end-of-subset code-logic review
- Result: scoped `typecheck,lint` and `test --maxWorkers=2` both passed (team-leader re-run); pre-commit hooks passed. MCP-boundary `effort` is length-bounded (1..32), which partly closes F6-m2. Still open: the `execute_code` path `ptah.agent.spawn({ effort })` is not type-validated (F6-M1); deferred to Task 34.2.

---

## Batch 8: `CodexExecRunner` (S1b, component 2) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: new isolated files; process and stream handling needs care
- Tasks: 2 | Depends on: Batch 4 (rejection matcher and fixture; N-B: Sequencing governs) | Concurrent-safe with: Batches 5, 6, 7, 10
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime`

### Task 8.1: `jsonl-line-splitter.ts` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/jsonl-line-splitter.ts` (+ spec)
- Plan reference: implementation-plan.md:603-612
- Pattern to follow: plan :207-208 (why not `readline`)
- Quality requirements: splits on `\n` only; strips a trailing `\r`; carries partial lines across chunks.
- Validation notes: U+2028, U+2029, U+0085 inside a line stay in that line.
- Implementation details: spec with a mid-line chunk boundary.

### Task 8.2: `codex-exec.runner.ts` — PENDING

- Depends on: Task 8.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-exec.runner.ts` (+ spec)
- Plan reference: implementation-plan.md:191-223 (D2), :603-648
- Pattern to follow: SDK arg grammar (plan :207-208); `redactSecrets` `sdk-error-summary.ts:34`; `assertCommandLineWithinLimit`
- Quality requirements: argv `exec --experimental-json [--config ...] [--model] [--sandbox] [--cd] [--skip-git-repo-check] [resume <id>]`; env = `process.env` + `FORCE_COLOR=0`, `NO_COLOR=1`, `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_sdk_ts` when unset; `shell:false`; prompt on stdin; unparseable line logged (first 200 chars, redacted) and skipped; non-zero exit raises the shape `summarizeCliSdkError` handles; child killed on abort and on consumer stop; every listener removed in `finally`. Log sink is an injected function.
- Validation notes: reuse Batch 4's `codex-config-rejection.ts` and its fixture; do not duplicate the regex. `secrets` = `CODEX_API_KEY` / `OPENAI_API_KEY` values present in the child env.
- Implementation details: spec with a fake child: U+2028/2029/0085 line parses as ONE event; garbage line skipped and logged; split chunk; abort; non-zero exit; rejection fixture then successful retry (runner reports the rejection; the adapter retries); fake API key redacted in stderr.

### Batch 8 verification

- Runner and splitter exist with specs; scoped command passes
- Reviewer: code-logic-reviewer (process lifecycle and secret redaction)

---

## Batch 9: Adapter switches to the runner (S1b, component 3b) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: single-file swap behind the turn seam; revertable alone
- Tasks: 3 | Depends on: Batches 4, 8 | Concurrent-safe with: Batch 10
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime`

### Task 9.1: Replace SDK exec with the runner; delete `getCodexSdk`; no-binary error — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`
- Plan reference: implementation-plan.md:216-223, :673-674
- Pattern to follow: `getCodexSdk` `:164-171`; turn seam from Batch 4
- Quality requirements: `runner.run({ args, prompt, signal })` replaces `thread.runStreamed`; SDK kept for types only; no native binary → spawn refused with "Codex native binary not found. Reinstall Ptah, or install `@openai/codex` globally." naming the searched triple; never falls back to the `.cmd`/`.js` shim. Config-rejection retry now driven by the runner's error.
- Validation notes: startup watchdog 30 s kept; thread id still captured for resume.
- Implementation details: `@openai/codex-sdk` stays a dependency.

### Task 9.2: Adapter spec with a runner double — PENDING

- Depends on: Task 9.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts`
- Plan reference: implementation-plan.md:677-684
- Pattern to follow: Batch 4 cases
- Quality requirements: every Batch 4 assertion holds on the runner double; no-binary error case.
- Validation notes: none.
- Implementation details: none.

### Task 9.3: Model-rejection matcher accepts dotted model names — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-rejection.ts` (+ `codex-model-rejection.spec.ts`)
- Origin: Batch 4 re-review Moderate (`batch-4-code-logic-review.md` § Re-review, New Moderate).
- Quality requirements: the verdict gap at `:18` (`[^\n.]{0,80}?`) lets a backtick- or quote-delimited token contain
  dots, e.g. ``(?:`[^`]*`|'[^']*'|[^\n.]){0,80}?``. Spec cases: "The model `gpt-5.1-codex` does not exist or you do
  not have access to it." and "The model `gpt-5.1` does not exist" both match; existing `gpt-6-sol` and non-matching
  cases stay green.
- Validation notes: matcher must not widen to bare "unsupported" (Batch 4 S1 fix).

### Batch 9 verification

- `getCodexSdk` deleted; runner used; scoped command passes
- Reviewer: code-logic-reviewer

---

## Batch 10: Measurement tool M and offline baselines (S2, component 10 part 1) — COMPLETE (commit 85bfdd4a9)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: scripts-only work, disjoint from every library batch; the offline baselines must exist before Batch 13
- Tasks: 3 | Depends on: Task 1.0 | Concurrent-safe with: Batches 1-9
- Verify: `npm run test:scripts`

### Task 10.1: Readers, lane metrics and fixtures — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/scripts/agent-usage/codex-rollout.reader.ts`, `opencode-db.reader.ts`, `claude-transcript.reader.ts`, `lane-metrics.ts` (all under `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/scripts/agent-usage/`, + specs and `__fixtures__/`)
- Plan reference: implementation-plan.md:339-347 (D11), :945-993
- Pattern to follow: parsing in `scripts/agent-usage-report.mjs`; `scripts/jest.config.ts`; `scripts/drain-observation-queue.spec.ts`
- Quality requirements: Codex from rollout `token_count` / `turn_context` / `session_meta` under `CODEX_HOME` or `~/.codex`; OpenCode `opencode.db` read-only via `node:sqlite`; Claude transcripts. Ptah lane = `originator=codex_sdk_ts` AND `source=exec` AND the lane completion contract marker in the first user message (spec pins it against `renderLaneCompletionContract`).
- Validation notes: sanitized fixture of the 74-turn lane holds only `token_count` numbers and `session_meta` keys (no content), extracted read-only from the user's rollout; test asserts first 27,464, peak 183,759, total 9.59M ±0.01M. OpenCode fixture DB created in temp. Missing store or bad line → reported as a skipped source.
- Implementation details: readers never write to user stores.

### Task 10.2: `agent-usage-report.ts` replaces the `.mjs` — COMPLETE

- Depends on: Task 10.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/scripts/agent-usage-report.ts` (delete `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/scripts/agent-usage-report.mjs`), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/package.json` (`usage:report` script only)
- Plan reference: implementation-plan.md:945-960, :984-985
- Pattern to follow: `"db:drain-observations": "npx ts-node --project scripts/tsconfig.json scripts/drain-observation-queue.ts"` (`package.json:72`)
- Quality requirements: keeps the existing aggregate views; `--lanes` prints model, effort, first-request input, peak, total, cached, output, request count, largest tool output, compaction events; `--opencode-config` lists declared MCP servers and plugins; `--resumed` reports per resumed Ptah lane whether the developer role message appears once or twice. Header documents the sessions location (R1.2).
- Validation notes: no other `package.json` change (Batch 11 adds `lane:capture`).
- Implementation details: none.

### Task 10.3: Run M offline and record the S2 baselines — COMPLETE

- Depends on: Task 10.2
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.ptah/specs/TASK_2026_597_ab22/measurements/s2-offline-baselines.md`
- Plan reference: implementation-plan.md:1377 (S2 records), :383 (AS6), :1261 (R1.3)
- Pattern to follow: none
- Quality requirements: read-only runs on the user's local stores (no model call, no quota): `--lanes` for the 2026-10-03 Codex rollouts; `--resumed` (AS6); `--opencode-config` and `--lanes` on `opencode.db` (R1.3 OpenCode baseline, including whether lanes load user servers or plugins); R3.4 per-item "before" chars cited from context.md § Evidence and research-report.md with that source stated.
- Validation notes: strip any content; numbers, names and keys only. If a store is absent, record "absent".
- Implementation details: this file gates Batch 13 (component 11).

### Batch 10 deviations (accepted by the team-leader)

- Sixth source file `scripts/agent-usage/jsonl-files.ts` (shared JSONL walk/parse) — accepted: avoids reader-to-reader
  imports; scripts-only, no library touched.
- `opencode.db` read through a temp copy (+ `-wal`, `-shm`), opened read-only, deleted in `finally` — accepted: stronger
  than plan's "read-only" (opening a live WAL DB touches `-shm`).
- "Largest tool output" counts text only, excluding inline base64 images — accepted: the metric targets context text.
- Claude requests deduped by `message.id` — accepted: fixes over-counting in the old `.mjs`; same rule as the ledger.
- Whole-folder `tsc -p scripts/tsconfig.json` already fails on HEAD (TS6059/TS7016); not a declared gate. Recorded.

### Batch 10 findings assigned to later tasks

- (a) Resumed Codex turns re-recorded a 21-22k-char `<skills_instructions>` block 6 times in 4 lanes → Task 4.4 must
  assert `skills.include_instructions=false` is present in the RESUME variant passed to the SDK on resume and on
  `continue()`; QA run C2/C3 confirms with M that no `<skills_instructions>` part is recorded in a resumed turn.
- (b) OpenCode lanes made 11,791 `glob` calls in 30 days → Task 35.1 adds a spec case with a long run of identical
  `glob` calls (repeat stop) and one with varying `glob` args (tool-call budget stop); QA O-runs record per-tool counts
  with M. Attribution to a single lane is left to QA.

### Batch 10 fix round 1 (code-logic review CHANGES REQUIRED 7/10; batch-10-code-logic-review.md)

- G1 (Serious): Claude `output_tokens` undercounted. `claude-transcript.reader.ts:137-147` keeps the FIRST line per
  `message.id`; later lines carry the larger, final `output_tokens` (2,482 of 3,001 multi-line messages on 332
  transcripts). Use last-line-wins per `message.id` for the whole usage object (the ledger rule,
  `session-usage-ledger.ts:124-133`), or max per field if a later line can drop fields. Spec: a 3-line message with
  growing `output_tokens` counts the final value once; input and cache stay counted once.
- G2: OpenCode temp copy must be deleted even when `db.close()` throws (`opencode-db.reader.ts:292-295`): close in its
  own try, delete in `finally`, report a close failure as a skipped-source note without aborting the report. Spec: a
  throwing close still removes the temp dir, and a normal read leaves no temp dir behind.
- G3: AS6 verdict `twice` must mean the role text is recorded again in a RESUMED turn (same hash in a later turn, or a
  role part inside a resumed turn), not "role parts >= 2". Define the verdicts `once`, `twice`, `absent`,
  `inconclusive` in the report header, and add spec cases for each.
- G4: Claude and OpenCode lanes are identified by the contract marker only, so lanes before the marker existed
  (2026-09-21) are invisible. State this limit in the report header and in the baselines file. Print the first date the
  marker is seen next to the lane counts.
- G5: `--lanes` sort mixes Codex local time with UTC. Normalise every lane's start time to one zone (UTC internally,
  with one stated display zone) before sorting. Spec with mixed sources across a date boundary.
- G6: explain the 4 resumed lanes reading `absent`. Check whether the `<`-prefix role heuristic hides a role that
  starts with `<` or arrives in another developer-part shape: match the role by the lane role header that
  `renderRoleBlock` emits (pin it with a spec against the real renderer), not by "not a `<tag>` block". Report a lane
  with no detectable role as `inconclusive`, with the reason, rather than `absent`.
- After G1-G6: regenerate `measurements/s2-offline-baselines.md` with the same commands. Keep the privacy rules (numbers,
  names and keys only). Run `npm run test:scripts` and lint on the changed files.
- Files: only Batch 10's files (`scripts/agent-usage/*`, `scripts/agent-usage-report.ts` + spec, the baselines file).
  `package.json` stays at the single `usage:report` line.

### Batch 10 fix round 1 outcome (review round 2 APPROVED 9/10)

- G1-G6 confirmed, plus three extra fixes (line-start marker, zero-usage line no longer ends the first-request window,
  bad OpenCode timestamp no longer crashes the report). `npm run test:scripts`: 78 passed (team-leader re-run).
- Residuals, all ACCEPTED (offline QA tool, not product code):
  - OpenCode snapshot copies `opencode.db` + `-wal` + `-shm` without a note if the WAL moves during the copy. A torn copy
    surfaces as skipped or unparseable rows, which the report already counts. QA re-runs M if a skipped-row count
    appears.
  - Codex total can drift when a `token_count` lacks `last_token_usage`. R1.1 holds on the real 74-turn lane; QA
    cross-checks per-lane totals against `total_token_usage` when it reports L runs.
  - Claude and OpenCode lanes are identified by the contract marker only; documented in the report header and the
    baselines file (G4).
  - AS6 `absent` has no real-log case; synthetic specs cover it, and C2 is the deciding evidence anyway.
- Commit attempt 1 was BLOCKED by the pre-commit `degradation-audit:lint`. That audit scans the working tree, and it
  flagged Batch 1's uncommitted `codex/codex-user-mcp-servers.ts:356 [orphaned-suppression]`, not a Batch 10 file.
  Batch 10 stays staged by explicit path and is committed after Batch 1 fix round 3 clears the audit. The hook is
  not bypassed.

### Batch 10 verification

- `.mjs` deleted; `npm run test:scripts` passes; baselines file written
- Reviewer: code-logic-reviewer (lane identification and metric arithmetic)

---

## Batch 11: Lane capture entries (S2, component 10 part 2) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: opt-in Jest entries in two libraries plus a launcher; placed after S1a per N-C
- Tasks: 3 | Depends on: Batches 1, 5, 10 (package.json), 4 | Concurrent-safe with: Batches 8, 9
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/agent-sdk` (entries must be skipped when `PTAH_LANE_CAPTURE_DIR` is unset), plus one manual `npm run lane:capture` into a temp dir

### Task 11.1: cli-agent-runtime capture entry (Codex variants) — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-capture.capture.spec.ts`
- Plan reference: implementation-plan.md:961-968; review N-C
- Pattern to follow: `cli-agent-runtime/jest.config.ts:18` (`vscode` mock)
- Quality requirements: `describe.skip` unless `PTAH_LANE_CAPTURE_DIR`; inputs from `PTAH_LANE_CAPTURE_ROLE`, `_CLI`, `_MODEL`, `_SETTINGS_JSON`; writes `<dir>/<cli>-<ts>/{argv.json, env.json, developer_instructions.txt, prompt.txt}` for Codex first-turn AND resume variants, plus a variant with `CODEX_RESUME_RESENDS_ROLE=false` for C2.
- Validation notes: OpenCode part is added in Task 13.5. `env.json` holds no secret values.
- Implementation details: uses components 1 and 5 and `buildTaskPrompt`.

### Task 11.2: agent-sdk capture entry (three routes) — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.capture.spec.ts`
- Plan reference: implementation-plan.md:969-974
- Pattern to follow: mock harness in `sdk-query-options-builder.spec.ts`; `agent-sdk/jest.config.ts:17`
- Quality requirements: routes: direct Anthropic Claude model, Codex proxy on localhost, Ollama Cloud `https://ollama.com`; writes `options.json` with `settings` (`autoCompactWindow`), `strictMcpConfig`, `mcpServers`, `settingSources`, non-secret `env` keys, hook names. Secrets redacted.
- Validation notes: skipped unless the env var is set. U1 at QA runs this entry against `4e246388a`.
- Implementation details: extended in Tasks 14.2 and 23.3.

### Task 11.3: Launcher, npm script and docs — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/scripts/lane-capture.mjs`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/package.json` (`lane:capture`), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/apps/ptah-docs/src/content/docs/agents/cli-agents.md`
- Plan reference: implementation-plan.md:975-979
- Pattern to follow: existing `scripts/*.mjs`
- Quality requirements: sets env and runs both entries via `nx test <project> --testFile=...` from an argument array, no shell. Docs: the sessions location (R1.2) and how to run the capture.
- Validation notes: none.
- Implementation details: none.

### Batch 11 verification

- Entries skip in CI; a manual capture writes the expected files; scoped command passes
- Reviewer: code-style-reviewer (test-entry and script conventions)

---

## Batch 12: Ollama window, proxied predicate, Responses translator (S3, components 12 + 13 part) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: auth-providers fixes plus the shared predicate they and Batch 14 use
- Tasks: 3 | Depends on: Batch 11 (U1 inputs exist before any S3 change) | Concurrent-safe with: Batches 15, 18
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers @ptah-extension/shared` and the three-app typecheck

### Task 12.1: Never fabricate 128k — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/auth-providers/src/lib/providers/local/ollama-cloud-metadata.service.ts` (+ spec)
- Plan reference: implementation-plan.md:1010-1022
- Pattern to follow: `resolveContextCapacity` `libs/shared/src/lib/utils/pricing.utils.ts:495-521`
- Quality requirements: delete `DEFAULT_CLOUD_CONTEXT` and its three writes; `/api/show` context length (5 s timeout, one attempt) registered as a discovered window; otherwise unknown.
- Validation notes: AS12 — read Ollama docs; spec cases unmatched, matched, success, failure, timeout; no case yields 128000.
- Implementation details: OpenRouter pricing matches stay (cost only).

### Task 12.2: `isProxiedProviderBaseUrl` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/utils/auth-env.utils.ts` (+ spec)
- Plan reference: implementation-plan.md:1028
- Pattern to follow: `includesUserSettingSource`, `LOCALHOST_BASE_URL_RE` `:3-38`
- Quality requirements: true for localhost, Ollama daemon, `ollama.com`, Moonshot; false for `api.anthropic.com`.
- Validation notes: none.
- Implementation details: none.

### Task 12.3: Translator sends the system prompt once with `prompt_cache_key`; proxy INFO line — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts` (+ specs)
- Plan reference: implementation-plan.md:1032-1043
- Pattern to follow: `responses-request-translator.ts:130-155`; `translation-proxy-base.ts:966-976`
- Quality requirements: no developer-item copy when `instructions` is set; `prompt_cache_key = <session id>`; terminal input and cached tokens logged at INFO.
- Validation notes: AS11 — open `AnthropicMessagesRequest` and the proxy handler; fallback key = routing id, logged once per session. Check PR #602 overlap; keep a pinning spec for any part already fixed. Fixture request shaped like a real Claude Code request.
- Implementation details: R6.2 stays "unverified against the backend" at QA.

### Batch 12 verification

- No 128000 path; one system copy; scoped + app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 13: OpenCode lane config and usage split in both adapters (S3, components 11 + 9 adapters) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: `opencode-cli.adapter.ts` is touched by components 9 and 11, so they share one batch
- Tasks: 5 | Depends on: Batches 9, 10 (R1.3 baseline recorded), 11 | Concurrent-safe with: Batches 15, 18
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared` and the three-app typecheck

### Task 13.1: Usage fields on `CliOutputSegment.usage` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/agent-process.types.ts`
- Plan reference: implementation-plan.md:455-456
- Pattern to follow: existing `usage` shape
- Quality requirements: `cacheReadTokens?`, `cacheCreationTokens?`, `contextTokens?`; doc comment: `inputTokens` is non-cached input for every adapter that reports cache.
- Validation notes: three-app typecheck.
- Implementation details: none.

### Task 13.2: Codex `handleTurnCompleted` split — PENDING

- Depends on: Task 13.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` (handleTurnCompleted only, + spec)
- Plan reference: implementation-plan.md:921-922
- Pattern to follow: `:1113-1133`
- Quality requirements: `inputTokens = input - cached`, `cacheReadTokens = cached`, `outputTokens`; text line keeps both figures.
- Validation notes: none.
- Implementation details: none.

### Task 13.3: OpenCode lane config builder and user server reader — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode/opencode-lane-config.builder.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode/opencode-user-mcp-servers.ts` (+ specs)
- Plan reference: implementation-plan.md:283-287 (D6), :523-540, :995-1008
- Pattern to follow: `buildMcpConfigContent` `opencode-cli.adapter.ts:528-544`
- Quality requirements: `buildOpencodeLaneConfig({mcpUrl, userServerNames, reserved, prune})` returns the JSON string; `prune:false`; user server disables only if Batch 10's R1.3 baseline found lanes load user servers.
- Validation notes: AS8 — read the installed opencode source/docs offline before setting `OPENCODE_COMPACTION_RESERVED_TOKENS`; record the source in a comment. Unreadable user config → no disables plus one WARN (no stream segment). Plugins: not disabled by guesswork.
- Implementation details: builder spec covers shape, empty list, prune flag.

### Task 13.4: OpenCode adapter env and `handleStepFinish` — PENDING

- Depends on: Tasks 13.1, 13.3
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` (+ spec)
- Plan reference: implementation-plan.md:923-924, :1001, :1008
- Pattern to follow: `:604-611`, `:118-129`, `:768`, `:873-896`
- Quality requirements: `buildMcpConfigContent` removed; `OPENCODE_CONFIG_CONTENT` always set (with and without an MCP port); each step emits `contextTokens` (input + cache read) and split cache when `tokens.cache.read` present; `stop` step keeps the display line.
- Validation notes: AS7 — compare a captured `--format json` line with `opencode.db` token rows offline; record the result in a code comment.
- Implementation details: adapter spec covers env with and without a port.

### Task 13.5: Capture entry gains the OpenCode part — PENDING

- Depends on: Task 13.4
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-capture.capture.spec.ts`
- Plan reference: implementation-plan.md:968; review N-C
- Pattern to follow: Task 11.1
- Quality requirements: writes `OPENCODE_CONFIG_CONTENT` and the opencode prompt.
- Validation notes: still skipped without the env var.
- Implementation details: none.

### Batch 13 verification

- Both adapters report split usage; OpenCode config always set; scoped + app typecheck pass
- Reviewer: code-logic-reviewer (usage arithmetic, compaction config)

---

## Batch 14: Strict MCP on proxied routes, cache flag, ledger cost (S3, components 13 options + 9 ledger) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: agent-sdk options and ledger plus the shared provider flag they read
- Tasks: 3 | Depends on: Batches 11, 12 | Concurrent-safe with: Batches 15, 18
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk @ptah-extension/shared` and the three-app typecheck

### Task 14.1: `reportsCacheUsage` provider flag — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/providers/provider-registry.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/providers/entries/local-provider-entry.ts`
- Plan reference: implementation-plan.md:474-475
- Pattern to follow: `AnthropicProvider` `:73-140`; entries `:34`, `:114`
- Quality requirements: `reportsCacheUsage?: false` set on Ollama and Ollama Cloud entries.
- Validation notes: none.
- Implementation details: none.

### Task 14.2: `strictMcpConfig: true` for proxied base URLs — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (strict flag only, + spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.capture.spec.ts`
- Plan reference: implementation-plan.md:1029-1031
- Pattern to follow: `capabilityIsolationOptions` `:505-510, 1145-1154`
- Quality requirements: strict flag on every proxied URL; off for `api.anthropic.com`; Ptah's `ptah` server stays.
- Validation notes: capture entry still writes the flag per route.
- Implementation details: none.

### Task 14.3: `UsageRecord.costUsd` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts` (+ spec)
- Plan reference: implementation-plan.md:478, :926-927, N4 :1445
- Pattern to follow: `findModelPricing` `pricing.utils.ts:221`; ledger `:21-34, 124-133, 200-217`
- Quality requirements: cost per record; `null` when no pricing or when cache tokens > 0 and the cache price is missing. Never estimated.
- Validation notes: `gpt-6-*` reads unknown.
- Implementation details: none.

### Batch 14 verification

- Strict flag per route; cost null cases; scoped + app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 15: Skill budget cache columns and extractor dedupe (S3, component 9 storage) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: additive migration plus its two consumers
- Tasks: 3 | Depends on: Task 1.0 | Concurrent-safe with: Batches 12, 13, 14, 16, 18
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/skill-synthesis @ptah-extension/persistence-sqlite`

### Task 15.1: Migration 0052 — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/persistence-sqlite/src/lib/migrations/0052_skill_budget_cache_tokens.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
- Plan reference: implementation-plan.md:479-480
- Pattern to follow: `0035_skill_synthesis_budget_stage.ts` and its spec; latest `0051_skill_lifecycle.ts`
- Quality requirements: two `INTEGER NOT NULL DEFAULT 0` columns.
- Validation notes: additive only.
- Implementation details: none.

### Task 15.2: Store records and sums cache columns — PENDING

- Depends on: Task 15.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/skill-synthesis/src/lib/queue/skill-budget.store.ts` (+ spec)
- Plan reference: implementation-plan.md:928
- Pattern to follow: `:100-104, 193, 276-295`
- Quality requirements: `SkillBudgetUsage` gains `cacheReadTokens?`, `cacheCreationTokens?`.
- Validation notes: none.
- Implementation details: none.

### Task 15.3: Extractor dedupes by `message.id` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts` (+ spec)
- Plan reference: implementation-plan.md:929-930
- Pattern to follow: ledger dedupe `session-usage-ledger.ts:124-133` (last line wins)
- Quality requirements: duplicate `message.id` counted once.
- Validation notes: none.
- Implementation details: none.

### Batch 15 verification

- Migration and specs; scoped command passes
- Reviewer: code-logic-reviewer

---

## Batch 16: Compaction and lane-guard settings types (S3, component 6b part 1 + component 6 guard keys) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: contract edits serialised on `file-settings-keys.ts` and `rpc.types.ts`. Lane-guard keys moved here from S4 so the S3 UI can bind them (no behaviour until Batch 35)
- Tasks: 3 | Depends on: Batch 2 | Concurrent-safe with: Batches 15, 18
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/shared @ptah-extension/platform-core` and the three-app typecheck

### Task 16.1: `rpc-compaction.types.ts` and registry entries — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc/rpc-compaction.types.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc.types.ts`
- Plan reference: implementation-plan.md:462-467
- Pattern to follow: method map near `rpc.types.ts:1240`; `RPC_METHOD_ENTRIES` `:3665`
- Quality requirements: `compaction:getConfig` / `compaction:setConfig` types and registration.
- Validation notes: every method listed in both places.
- Implementation details: none.

### Task 16.2: File-based keys — four compaction keys and three lane-guard keys — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/platform-core/src/file-settings-keys.ts` (+ spec)
- Plan reference: implementation-plan.md:409-414, :422-438
- Pattern to follow: Task 2.1
- Quality requirements: `compaction.threshold` (null), `compaction.toolOutputBudgetTokens` (2500), `compaction.subagentHandoffTokens` (150000), `compaction.rotationSuggestTokens` (300000); `agentOrchestration.laneToolCallSteerAt` (40), `laneToolCallStopAt` (60), `laneRepeatCallStopAt` (20).
- Validation notes: `compaction.enabled` stays VS Code-contributed. The reroute takes effect in hosts only after AS14 (Task 17.1).
- Implementation details: none.

### Task 16.3: Lane-guard fields in RPC types and scoped keys — PENDING

- Batch 6 follow-up F6-c: fix the stale `AgentSpawnEnvironment.mapEffortToCli` comment at `rpc-agents.types.ts:160`. The function now lives in `lane-spawn-policy.ts`.

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc/rpc-auth.types.ts`
- Plan reference: implementation-plan.md:460-461
- Pattern to follow: Task 2.2
- Quality requirements: three fields and three scoped entries. Do not restate numeric defaults in JSDoc; also remove the restated `120000` / `2500` from the Codex budget field JSDoc added in Batch 2 (`rpc-agents.types.ts:121,123`, style minor M4) and point at `FILE_BASED_SETTINGS_DEFAULTS`.
- Validation notes: none.
- Implementation details: none.

### Batch 16 verification

- Types and keys present; scoped + app typecheck pass
- Reviewer: code-style-reviewer

---

## Batch 17: Compaction RPC, migration, provider reads, lane-guard RPC (S3, component 6b part 2 + 6 guard keys) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: validate-before-write handlers and the one-shot migration; AS14 first
- Tasks: 5 | Depends on: Batches 3, 16 | Concurrent-safe with: Batches 15, 18
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk`

### Task 17.1: AS14 host check — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/apps/ptah-extension-vscode/src/di/phase-1-infra.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/apps/ptah-electron/src/di/phase-1-infra.ts`, and the `ptah-cli` `ConfigManager` construction (read-only unless a host passes a different set)
- Plan reference: implementation-plan.md:391 (AS14)
- Pattern to follow: `libs/backend/vscode-core/src/config/config-manager.ts:91-117`
- Quality requirements: report per host which key set is passed. If a host passes a different set, add the compaction keys there.
- Validation notes: blocks Task 17.3 if unresolved.
- Implementation details: none.

### Task 17.2: `CompactionRpcHandlers` with migration — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/handlers/compaction-rpc.handlers.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/apps/ptah-extension-vscode/package.json` (drop `compaction.threshold` at `:254-268`)
- Plan reference: implementation-plan.md:802-822, :434-438
- Pattern to follow: `migrateAgentOrchestrationSettings` `agent-rpc.handlers.ts:1139`
- Quality requirements: validation of the ranges before any write, returns `{success:false, error:'Values outside A-B are not applied', field}`; reads and writes via `IWorkspaceProvider.getConfiguration` / `setConfiguration('ptah', 'compaction.<key>')`; one-shot migration in `register()` guarded by its own state flag.
- Validation notes: the migration reads the raw VS Code value and never overwrites a store value; spec "runs once, never clobbers". Confirm the VS Code value is still readable after the manifest declaration is removed; if not, the migration reads via `inspect()`.
- Implementation details: errors returned as values, never thrown across RPC.

### Task 17.3: `CompactionConfigProvider` reads the new keys — PENDING

- Depends on: Task 17.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts` (+ spec)
- Plan reference: implementation-plan.md:812-815
- Pattern to follow: `:58-76`
- Quality requirements: reads the three new keys with defaults; hand-edited invalid value treated as unset.
- Validation notes: A1 env read lands in Batch 23.
- Implementation details: none.

### Task 17.4: `agent:getConfig`/`setConfig` lane-guard keys — PENDING

- Batch 6 follow-up F6-c: rename the stale test title at `agent-rpc.handlers.set-config.spec.ts:153`. It names `AgentSpawnEnvironment.mapEffortToCli`, which now lives in `lane-spawn-policy.ts`.

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`
- Plan reference: implementation-plan.md:784-790
- Pattern to follow: Task 3.2 validator
- Quality requirements: integers; steer ≥ 1; stop > steer; repeat ≥ 2; rejected with field name before any write; `KNOWN_CONFIG_KEYS` entries.
- Validation notes: a partial write that changes only one of steer/stop is validated against the stored other value. Batch 3 follow-up: add spec cases to `agent-rpc.handlers.set-config.spec.ts` for the Codex budget keys with a value above `MAX_SAFE_INTEGER` (rejected with the field name) and `-0` (accepted, stored as 0), and apply the same two cases to the lane-guard keys.
- Implementation details: none.

### Task 17.5: `KNOWN_CONFIG_KEYS` keeps `compaction.*` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`
- Plan reference: implementation-plan.md:424
- Pattern to follow: `:59-60`
- Quality requirements: the three new compaction keys exportable.
- Validation notes: same file as Task 17.4; one edit pass.
- Implementation details: none.

### Batch 17 verification

- AS14 result reported; handlers validate first; migration safe; scoped command passes
- Reviewer: code-logic-reviewer (write path and migration)

---

## Batch 18: Codex config TOML writer (S3, component 8 part 1) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: user-owned file writer; byte-identity is the main risk
- Tasks: 3 | Depends on: Task 1.0 | Concurrent-safe with: Batches 12-17
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/harness-sync` and the three-app typecheck (tsconfig path)

### Task 18.1: `planCodexTopLevelKeyEdits` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/harness-sync/src/lib/targets/codex-config/codex-top-level-keys.ts` (+ `codex-top-level-keys.spec.ts`)
- Plan reference: implementation-plan.md:327-337 (D10), :542-566, :880-910
- Pattern to follow: fences in `codex-toml-mcp-facet.ts:1-28, 205`
- Quality requirements: edits only top-level keys before the first table; keeps trailing comments; inserts missing keys into `# ptah:begin lane-budgets` / `# ptah:end lane-budgets` before the first table; deletes on empty; returns new text plus the change list. Normalises bare and quoted key forms.
- Validation notes: refuses multi-line strings or spanning inline tables in the top-level region and duplicate managed keys (including bare + quoted). Byte-identical outside edits on fixtures with comments, CRLF, profiles and `[mcp_servers.*]`.
- Implementation details: no TOML library.

### Task 18.2: `CodexConfigKeysWriter` — PENDING

- Depends on: Task 18.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/harness-sync/src/lib/targets/codex-config/codex-config-keys-writer.service.ts` (+ spec)
- Plan reference: implementation-plan.md:886-901
- Pattern to follow: `codexHomeConfigFile`, `atomicWriteWithRetry`, `withMcpConfigLock` (`harness-sync/src/index.ts:186, 211, 298`); backup `codex-toml-mcp-facet.ts:277-289`
- Quality requirements: `preview(keys)` (missing file → `exists:false`), `apply(keys, baseHash)`: lock, re-read, hash compare (conflict → no write), `.bak`, atomic write. Only ticked keys touched; `inherit` or empty effort removes `model_reasoning_effort`.
- Validation notes: path only from `codexHomeConfigFile()`; values validated; strings as TOML basic strings. No write without apply.
- Implementation details: spec: conflict, `.bak` written, unticked keys untouched.

### Task 18.3: Deep-import entry — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/harness-sync/src/codex-config.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/tsconfig.base.json`
- Plan reference: implementation-plan.md:492-494 (F16)
- Pattern to follow: `@ptah-extension/harness-sync` entry at `tsconfig.base.json:153-154`
- Quality requirements: path `@ptah-extension/harness-sync/codex-config` re-exports the writer and the plan function only. `harness-sync/src/index.ts` NOT modified.
- Validation notes: lint module-boundary rules accept the deep import.
- Implementation details: none.

### Batch 18 verification

- Byte-identity specs pass; no `index.ts` change; scoped + app typecheck pass
- Reviewer: code-logic-reviewer (user-owned file safety)

---

## Batch 19: Codex config RPC (S3, component 8 part 2) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: serialised after Batches 16-17 on `rpc.types.ts` and `register-shared-rpc-handlers.ts`
- Tasks: 2 | Depends on: Batches 16, 17, 18 | Concurrent-safe with: Batch 15
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/rpc-handlers @ptah-extension/shared` and the three-app typecheck

### Task 19.1: `rpc-codex-config.types.ts` and registration — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc/rpc-codex-config.types.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc.types.ts`
- Plan reference: implementation-plan.md:468-473
- Pattern to follow: Task 16.1
- Quality requirements: `codexConfig:previewLaneBudgetWrite` / `codexConfig:applyLaneBudgetWrite` shapes; method map + `RPC_METHOD_ENTRIES`.
- Validation notes: none.
- Implementation details: none.

### Task 19.2: `codex-config-rpc.handlers.ts` — PENDING

- Depends on: Task 19.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/handlers/codex-config-rpc.handlers.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
- Plan reference: implementation-plan.md:893, :914
- Pattern to follow: Task 17.2 handler shape
- Quality requirements: constructs the writer with the resolved path owner via `@ptah-extension/harness-sync/codex-config`; values from current Ptah settings; errors as values.
- Validation notes: the caller never supplies a path.
- Implementation details: none.

### Batch 19 verification

- Methods registered; handler spec; scoped + app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 20: Frontend settings state (S3, component 7 state) — DEFERRED (follow-up, decision 11)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer re-run
- Execution mode: sequential
- Rationale: state services in one library; write plus read-back for every field
- Tasks: 3 | Depends on: Batches 3, 17, 19 | Concurrent-safe with: Batch 15
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/core`

### Task 20.1: Field unions and patch types — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/core/src/lib/services/providers-settings.types.ts`
- Plan reference: implementation-plan.md:852-858
- Pattern to follow: `ProvidersOrchestrationField` `:63-73`, patch `:89-94`
- Quality requirements: `ProvidersLaneBudgetField` (six `agentOrchestration` keys) joined into the orchestration patch; `compaction?` patch member.
- Validation notes: none.
- Implementation details: none.

### Task 20.2: Commit loop — PENDING

- Depends on: Task 20.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/core/src/lib/services/providers-commit.service.ts` (+ spec)
- Plan reference: implementation-plan.md:855-858
- Pattern to follow: `:185-205`
- Quality requirements: new fields written with `agent:setConfig` and read back with `agent:getConfig`; compaction via `compaction:setConfig` / `compaction:getConfig` with read-back; rejection message reaches the `unsaved` list.
- Validation notes: none.
- Implementation details: none.

### Task 20.3: State service — PENDING

- Depends on: Task 20.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/core/src/lib/services/providers-settings-state.service.ts` (+ spec)
- Plan reference: implementation-plan.md:859-861
- Pattern to follow: `saveSettings` `:596`
- Quality requirements: `compaction` and `codexConfigPreview` read states; preview and apply calls; conflict re-runs preview.
- Validation notes: none.
- Implementation details: none.

### Batch 20 verification

- Every new field written and read back; scoped command passes
- Reviewer: code-logic-reviewer

---

## Batch 21: Lane budgets card, Codex default label, inherit option (S3, component 7 UI) — DEFERRED (follow-up, decision 11)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer re-run
- Execution mode: sequential
- Rationale: rendered UI work on the rebuilt settings surface plus e2e scenarios
- Tasks: 4 | Depends on: Batch 20 | Concurrent-safe with: Batch 15
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat @ptah-extension/webview-e2e-harness`

### Task 21.1: `ptah-lane-budget-settings` component — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/settings/ptah-ai/lane-budget-settings.component.ts` (+ spec)
- Plan reference: implementation-plan.md:824-841, :862-867
- Pattern to follow: `CONTROL` constant `orchestration-settings.component.ts:18`; `role="alert"`/`role="status"` `:53, :58`
- Quality requirements: Codex budgets and web search; three lane-guard numbers; four compaction fields with inline validation ("Values outside 100,000-1,000,000 are not applied" for the threshold); curator hint pointing at `background-roles-details`; "Write to Codex config" → per-key checkbox dialog (all unticked) → preview rows (key, before, after) → Confirm/Cancel; refused preview disables Confirm; conflict says the file changed. Every control has `<label for>`.
- Validation notes: no apply without Confirm.
- Implementation details: none.

### Task 21.2: Mount in `orchestration-settings` behind `@defer (on viewport)` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`
- Plan reference: implementation-plan.md:830-832
- Pattern to follow: deferred matrix block `:40-50`
- Quality requirements: placed after the matrix block, inside its own `@defer`.
- Validation notes: eager bundle at budget (`:44`).
- Implementation details: none.

### Task 21.3: Popover and matrix rows — PENDING

- Batch 6 follow-up F6-c: fix the stale `AgentSpawnEnvironment.mapEffortToCli` comment at `cli-model-effort-popover.component.ts:24`. It should point at `lane-spawn-policy.ts`.

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts` (+ specs)
- Plan reference: implementation-plan.md:842-848
- Pattern to follow: `EFFORT_LABELS` `:19-27`, help text `:82, :91`; `cli-matrix-rows.ts:117, 159-164, 204`
- Quality requirements: Codex shows "Ptah default (gpt-6-sol)"; other CLIs keep "Provider default"; `inherit: 'Inherit chat effort'` (Batch 2 follow-up 2: until this task the popover shows the raw `inherit` value, for Codex, Copilot and Pi).
- Validation notes: none.
- Implementation details: none.

### Task 21.4: e2e scenarios — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts` (+ a lane-budget scenario beside it)
- Plan reference: implementation-plan.md:873-874
- Pattern to follow: existing entries in the same file
- Quality requirements: inherit option, Codex default label, lane-budget card.
- Validation notes: rendered visual evidence (dark + light) is required at completion; the visual-reviewer runs after this batch.
- Implementation details: none.

### Batch 21 verification

- Card renders and saves; e2e scenarios pass; scoped command passes
- Reviewer: visual-reviewer (rendered UI), then code-logic-reviewer for the dialog flow

---

## Batch 22: Usage displays and the no-cache hint (S3, component 9 frontend + component 7 N6) — DEFERRED (follow-up, decision 11)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer re-run
- Execution mode: sequential
- Rationale: display-only edits in two frontend libraries
- Tasks: 3 | Depends on: Batches 13, 14 | Concurrent-safe with: Batches 15-20
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat @ptah-extension/chat-ui`

### Task 22.1: Agent card sums cache separately — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts` (+ spec)
- Plan reference: implementation-plan.md:925
- Pattern to follow: `:37-66`
- Quality requirements: `cacheReadTokens` summed apart, never added to input.
- Validation notes: none.
- Implementation details: none.

### Task 22.2: "not reported" for providers without cache usage — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts` (+ spec)
- Plan reference: implementation-plan.md:931-932
- Pattern to follow: existing summary bindings
- Quality requirements: "not reported" instead of 0 when `reportsCacheUsage === false`; cost "unknown" when `costUsd` is null.
- Validation notes: none.
- Implementation details: none.

### Task 22.3: Provider card no-cache hint — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` (+ specs)
- Plan reference: implementation-plan.md:849-851
- Pattern to follow: existing card inputs
- Quality requirements: `reportsCacheUsage` input; text "This provider does not report prompt caching, so every request is charged for the full context."
- Validation notes: none.
- Implementation details: none.

### Batch 22 verification

- Displays honest; scoped command passes
- Reviewer: visual-reviewer (rendered text), then code-style-reviewer

---

## Batch 23: A1 auto-compact machinery, defaults null (S4, component 17) — COMPLETE (commit 65aed6387)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: agent-sdk only; serialised on `sdk-query-options-builder.ts` and `compaction-config-provider.ts`
- Tasks: 4 | Depends on: none (decision 11: Batches 14 and 17 dropped, see § PR 1 scope) | Concurrent-safe with: Batches 7, 42, 43, 44, 48, 49
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk 2>&1 | tail -40`
- Decision 11 narrowing: the provider is extended in its current form (`config.get('compaction.*')`); the model class
  comes from the builder's existing first-party base-URL test, not from Task 12.2; the capture-entry step is deferred
  with Batch 11.

### Task 23.1: `resolveAutoCompactControl` — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/auto-compact-control.ts` (+ spec)
- Plan reference: implementation-plan.md:1122-1145
- Pattern to follow: `:34-36, 78-86`
- Quality requirements: input `{enabled, windowTokens, modelClass, envWindow}`; precedence env → setting → class default → runtime; `A1_DEFAULT_WINDOW = { claude: null, proxied: null }`; stale 0.3.150 header corrected.
- Validation notes: with null defaults, output is unchanged from today (no behaviour change).
- Implementation details: none.

### Task 23.2: Provider env read and visible rejection — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts` (+ spec)
- Plan reference: implementation-plan.md:1130-1131
- Pattern to follow: current file `compaction-config-provider.ts:50-72` (Batch 17 is deferred; do not move the keys)
- Quality requirements: reads `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for the log only; out-of-range WARN. Keys still read
  through `this.config.get('compaction.enabled' | 'compaction.threshold')`.
- Validation notes: none.
- Implementation details: none.

### Task 23.3: Builder log line and model class — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (+ `sdk-query-options-builder.auto-compact-argv.spec.ts`)
- Plan reference: implementation-plan.md:1132, :1151-1152
- Pattern to follow: `:377-399, 1099-1103`
- Quality requirements: one INFO line per session start with window and source; model class `claude` when
  `ANTHROPIC_BASE_URL` is empty or `api.anthropic.com` (the test already at `:1536-1538` and `:1619-1621`), else
  `proxied`. If the test is extracted into a module-private helper, both existing call sites use it (no third copy of
  the regex). Task 12.2 (deferred) replaces it later.
- Validation notes: output unchanged while defaults are null.
- Implementation details: the capture-entry record (old `sdk-query-options-builder.capture.spec.ts`) is deferred with
  Batch 11.

### Task 23.4: Live threshold change — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts` (+ specs)
- Plan reference: implementation-plan.md:1133-1134
- Pattern to follow: `session-lifecycle-manager.ts:86`; `session-control.service.ts:499`
- Quality requirements: `applyFlagSettings` interface widened to `{effortLevel?, autoCompactWindow?}`; threshold change applies to active sessions.
- Validation notes: none.
- Implementation details: none.

### Batch 23 verification

- Precedence specced; no behaviour change with null defaults; scoped command passes
- Review (decision 11): no per-batch review; scoped `typecheck,lint,test` before commit; covered by the end-of-subset code-logic review

---

## Batch 24: Output budget engine moves to tool-output-reducers (S4, component 18 part 1) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: behaviour-preserving move across two libraries, pinned by the existing spec
- Tasks: 2 | Depends on: Task 1.0, Batch 7 | Concurrent-safe with: Batches 23, 32
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools`

### Task 24.1: `applyOutputBudget` and `spool` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/tool-output-reducers/src/lib/output-budget/apply-output-budget.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/tool-output-reducers/src/lib/output-budget/spool.ts` (+ specs), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: implementation-plan.md:299-307 (D8), :1160-1162
- Pattern to follow: `tool-result-budget.ts:20-24, 52-54, 162-215, 291+`
- Quality requirements: generic reduce, fit, spool, trailer; depends only on `platform-core`.
- Validation notes: barrel stays ≤150 lines.
- Implementation details: none.

### Task 24.2: `applyToolResultBudget` becomes a thin wrapper — PENDING

- Depends on: Task 24.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
- Plan reference: implementation-plan.md:1160-1162
- Pattern to follow: same file
- Quality requirements: keeps Ptah override tables; calls the moved engine.
- Validation notes: existing `tool-result-budget.spec.ts` passes with unchanged expectations.
- Implementation details: none.

### Batch 24 verification

- Existing spec unchanged and green; scoped command passes
- Reviewer: code-style-reviewer (behaviour-preserving move)

---

## Batch 25: A3 capper wiring (S4, component 18 part 2) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: first of the serial agent-sdk `di/tokens.ts` edits; host bindings for the outliner
- Tasks: 3 | Depends on: Batches 17, 24 | Concurrent-safe with: Batch 32
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk` and `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron`

### Task 25.1: `ToolOutputCapper` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.ts` (+ spec)
- Plan reference: implementation-plan.md:1163-1170
- Pattern to follow: `applyOutputBudget` from Batch 24
- Quality requirements: Bash, PowerShell, Grep, Read, non-`ptah` MCP; `mcp__ptah__*` skipped; budget from `compaction.toolOutputBudgetTokens`; whole-file Read over budget → outline + trailer naming the path and "read with offset/limit"; others → reduced form + spool path.
- Validation notes: AS9 shape-preserving (Bash `stdout`/`stderr`, Grep `content`, Read `file.content`, MCP `content[].text`); unknown shape unchanged; fail-open with one log line.
- Implementation details: optional `SDK_CODE_OUTLINER`; absent → log reducer plus path pointer.

### Task 25.2: Hook returns `updatedToolOutput` — PENDING

- Depends on: Task 25.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts` (+ spec)
- Plan reference: implementation-plan.md:1169
- Pattern to follow: `:60-108`
- Quality requirements: returns `hookSpecificOutput.updatedToolOutput` only when changed.
- Validation notes: none.
- Implementation details: none.

### Task 25.3: Tokens, register, host outliner bindings — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/di/tokens.ts`, the agent-sdk register file under `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/di/`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/apps/ptah-extension-vscode/src/di/` and `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/apps/ptah-electron/src/di/` phase files
- Plan reference: implementation-plan.md:487-491
- Pattern to follow: `Symbol.for` tokens at `agent-sdk/src/lib/di/tokens.ts:49`; `TreeSitterCodeOutliner` `vscode-lm-tools mcp-core/code-outliner.adapter.ts:338`
- Quality requirements: `SDK_TOOL_OUTPUT_CAPPER`, `SDK_CODE_OUTLINER` (optional injection).
- Validation notes: no new `vscode-core` import in agent-sdk.
- Implementation details: none.

### Batch 25 verification

- Capper fail-open and shape-preserving; scoped + host typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 26: A8 coordinator core and context-usage port (S4, component 21 part 1) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: state machine needs design care; placed before A5/A6 because the advisor needs the port (order deviation recorded above)
- Tasks: 3 | Depends on: Batches 23, 25 | Concurrent-safe with: Batches 30, 32
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk`

### Task 26.1: State types and coordinator — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-state.types.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts` (+ spec)
- Plan reference: implementation-plan.md:1225-1250
- Pattern to follow: `/compact` streamed path `slash-command-interceptor.ts:1-20, 77`
- Quality requirements: IDLE, ARMED, TRIGGERED, COMPACTING, COOLDOWN, BACKOFF, OBSERVE_ONLY with the listed transitions; `COMPACTION_MAX_DWELL_MS = 180_000`; dedupe of manual `/compact` with "compaction already running"; rebind on PostCompact `session_id`; sync idempotent `dispose`.
- Validation notes: OBSERVE_ONLY for the Codex proxy path and any class whose E2 failed (null default today).
- Implementation details: spec per transition, dedupe, rebind.

### Task 26.2: `IContextUsagePort` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction/context-usage.port.ts` (+ spec)
- Plan reference: implementation-plan.md:1245-1246
- Pattern to follow: SDK `getContextUsage` (plan :151)
- Quality requirements: `{totalTokens, maxTokens, autoCompactThreshold?, source}`; at most once per turn end.
- Validation notes: provenance spec.
- Implementation details: none.

### Task 26.3: Tokens and register — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/di/tokens.ts`, the agent-sdk register file
- Plan reference: implementation-plan.md:487
- Pattern to follow: Task 25.3
- Quality requirements: `SDK_COMPACTION_COORDINATOR`, `SDK_CONTEXT_USAGE_PORT`.
- Validation notes: none.
- Implementation details: none.

### Batch 26 verification

- Every transition specced; scoped command passes
- Reviewer: code-logic-reviewer (state machine)

---

## Batch 27: A8 wiring — watchdog, hooks, executor, events (S4, component 21 part 2) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: edits to live session plumbing; serial on `session-query-executor` and `sdk-adapter-events`
- Tasks: 2 | Depends on: Batch 26 | Concurrent-safe with: Batches 30, 32
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk`

### Task 27.1: Bounded watchdog dwell — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.ts` (+ spec)
- Plan reference: implementation-plan.md:1243-1244
- Pattern to follow: `arm()` `:215-238, 249`
- Quality requirements: stops re-arming once compaction has been open 180 s, then fires its timeout path.
- Validation notes: none.
- Implementation details: none.

### Task 27.2: Hook handler, executor and events wiring — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts` (+ specs)
- Plan reference: implementation-plan.md:1247, :1253
- Pattern to follow: `compaction-hook-handler.ts:246, 353-387, 404-480`; `session-query-executor.service.ts:259-268`; `sdk-adapter-events.service.ts:131-137`
- Quality requirements: PreCompact/PostCompact and `compact_boundary` reach the coordinator; turn end calls the port once; `compactionStateChanged` (from, to, trigger, pre/post) logged at INFO.
- Validation notes: coordinator released on session end.
- Implementation details: none.

### Batch 27 verification

- Coordinator wired; watchdog bounded; scoped command passes
- Reviewer: code-logic-reviewer

---

## Batch 28: A5 subagent budget monitor (S4, component 19) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: agent-sdk only; serial on options builder, executor and tokens
- Tasks: 3 | Depends on: Batch 27 | Concurrent-safe with: Batches 30, 32
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk`

### Task 28.1: `SubagentBudgetMonitor` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts` (+ spec)
- Plan reference: implementation-plan.md:1183-1199
- Pattern to follow: `stopSubagent` `subagent-message-dispatcher.ts:280`
- Quality requirements: at or above `compaction.subagentHandoffTokens`, stop the subagent, stream the one parent handoff message, mark not resumable; fresh spawn delegated to the parent model.
- Validation notes: AS10 — fixture from a `~/.claude/projects/**/subagents/*.jsonl` line (sanitized); no usage → observe-only, logged once per session.
- Implementation details: spec: below threshold no action; at threshold stop + message once.

### Task 28.2: Selective `subagentPromptCacheTtl` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (TTL only, + spec)
- Plan reference: implementation-plan.md:1195-1196
- Pattern to follow: `session-metadata-store.ts:117`
- Quality requirements: `'1h'` only when the session lists resumable subagents.
- Validation notes: none.
- Implementation details: none.

### Task 28.3: Executor feed, tokens, register — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/di/tokens.ts`, the agent-sdk register file
- Plan reference: implementation-plan.md:1200, :487
- Pattern to follow: Batch 27 wiring
- Quality requirements: forwarded subagent messages reach the monitor; `SDK_SUBAGENT_BUDGET_MONITOR`.
- Validation notes: none.
- Implementation details: none.

### Batch 28 verification

- Monitor specced; scoped command passes
- Reviewer: code-logic-reviewer

---

## Batch 29: A6 rotation advisor backend (S4, component 20 backend) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: agent-sdk advisor plus the shared message contract
- Tasks: 3 | Depends on: Batch 28 | Concurrent-safe with: Batch 32
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk @ptah-extension/shared` and the three-app typecheck

### Task 29.1: Message type and payload — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/messages/message-constants.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/sdk-hook.types.ts`
- Plan reference: implementation-plan.md:476-477
- Pattern to follow: `SESSION_COMPACTION_COMPLETE` `message-constants.ts:136`
- Quality requirements: `SESSION_CONTEXT_ADVISORY = 'session:contextAdvisory'`; payload `{ sessionId, kind: 'rotation-suggested', contextTokens, threshold, seedPrompt }`.
- Validation notes: none.
- Implementation details: none.

### Task 29.2: `SessionRotationAdvisor` with tokens and register — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/compaction/session-rotation-advisor.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/di/tokens.ts`, the agent-sdk register file
- Plan reference: implementation-plan.md:1206-1209
- Pattern to follow: port from Batch 26
- Quality requirements: one advisory per session per threshold crossing at `compaction.rotationSuggestTokens`; `seedPrompt` ≤4,000 chars with task folder paths if known, latest compact summary or last assistant text, and "continue from here".
- Validation notes: fires once per crossing.
- Implementation details: `SDK_SESSION_ROTATION_ADVISOR`.

### Task 29.3: `SdkAdapterEvents` emits the advisory — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts` (+ spec)
- Plan reference: implementation-plan.md:1209
- Pattern to follow: `emitCompactionComplete` `:131-137`
- Quality requirements: new emit method.
- Validation notes: none.
- Implementation details: none.

### Batch 29 verification

- Advisor specced; scoped + app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 30: Advisory notifier and A7 curator guardrail (S4, component 20) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: two small disjoint edits in two libraries
- Tasks: 2 | Depends on: Task 29.1 for the notifier (curator part has no dependency) | Concurrent-safe with: Batches 26-28 (curator part only), 32
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/rpc-handlers @ptah-extension/memory-curator`

### Task 30.1: `SessionLifecycleNotifier` forwards the advisory — PENDING

- Depends on: Batch 29
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts` (+ spec)
- Plan reference: implementation-plan.md:1209, :1214
- Pattern to follow: `:90-113`
- Quality requirements: broadcast to the webview; failure logged (`:107-113`).
- Validation notes: none.
- Implementation details: none.

### Task 30.2: Curator PreCompact coalescing — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/memory-curator/src/lib/memory-curator.service.ts` (+ spec)
- Plan reference: implementation-plan.md:1212-1213
- Pattern to follow: reactor `:218-276`
- Quality requirements: per-session `{lastFiredAt}`; `CURATOR_PRECOMPACT_MIN_INTERVAL_MS = 900_000`; skip logged; reactor stays registered; entry deleted on session end.
- Validation notes: two PreCompacts within the interval fire once; after it, fires again.
- Implementation details: none.

### Batch 30 verification

- Notifier and curator specs; scoped command passes
- Reviewer: code-logic-reviewer

---

## Batch 31: Session rotation banner (S4, component 20 frontend) — DEFERRED (follow-up, decision 11)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer re-run
- Execution mode: sequential
- Rationale: rendered chat UI
- Tasks: 2 | Depends on: Batch 30 | Concurrent-safe with: Batch 32
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat`

### Task 31.1: `session-rotation-banner` component — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/components/molecules/session-rotation-banner.component.ts` (+ spec)
- Plan reference: implementation-plan.md:1210-1211
- Pattern to follow: existing chat molecules
- Quality requirements: "Rotate session" opens a new session tab prefilled with `seedPrompt` (the user sends it); "Keep this session" dismisses, nothing changes.
- Validation notes: accessible buttons and `role="status"`.
- Implementation details: none.

### Task 31.2: Store and handler wiring — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` (+ specs)
- Plan reference: implementation-plan.md:1221
- Pattern to follow: `compaction-lifecycle.service.ts:584`
- Quality requirements: handles `session:contextAdvisory`; banner shown per session.
- Validation notes: none.
- Implementation details: none.

### Batch 31 verification

- Accept opens a prefilled tab; decline is a no-op; scoped command passes
- Reviewer: visual-reviewer (rendered banner, dark + light), then code-logic-reviewer

---

## Batch 32: Lane resume gate (S4, component 14) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: second serial edit of the manager; adds `lastRequestContext` (moved here from component 16 because the gate needs it first)
- Tasks: 4 | Depends on: Batches 6, 13 | Concurrent-safe with: Batches 23-31
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared` and the three-app typecheck

### Task 32.1: `AgentProcessInfo.lastRequestContext` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/agent-process.types.ts`
- Plan reference: implementation-plan.md:454
- Pattern to follow: existing `AgentProcessInfo`
- Quality requirements: `{ tokens: number; source: 'rollout' | 'stream' | 'estimate' }`.
- Validation notes: none.
- Implementation details: none.

### Task 32.2: Codex rollout usage reader — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-rollout-usage.reader.ts` (+ spec)
- Plan reference: implementation-plan.md:1053-1055
- Pattern to follow: field names in `scripts/agent-usage/codex-rollout.reader.ts` (Batch 10); `codexHomeDir()`
- Quality requirements: finds `rollout-*-<threadId>.jsonl`, newest date dirs first; reads the last `token_count` `info.last_token_usage` from the file tail.
- Validation notes: never the `turn.completed` sum.
- Implementation details: fixture tail spec.

### Task 32.3: `LaneResumeGate` with token and register — PENDING

- Depends on: Task 32.2
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/di/tokens.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/di/register.ts`
- Plan reference: implementation-plan.md:1050-1058, :484-486
- Pattern to follow: `CLI_AGENT_RUNTIME_TOKENS` `di/tokens.ts:1-25`; `register.ts:49, 77`
- Quality requirements: `RESUME_GATE_MAX_CONTEXT_TOKENS = 60_000`, `RESUME_GATE_MAX_IDLE_MS = 600_000`; Codex from rollout, OpenCode from stream, others labelled estimate; logs through `IOutputChannel`.
- Validation notes: missing rollout → estimate; decision always logged with source.
- Implementation details: spec boundaries 60k, 10 min, each source.

### Task 32.4: Manager consults the gate; handoff spawn; stale warning fixed — PENDING

- Depends on: Tasks 32.1, 32.3
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (resume entry, + spec)
- Plan reference: implementation-plan.md:1059-1062
- Pattern to follow: `:332-336`
- Quality requirements: on `fresh`, spawn a new lane with the new message, the original task, the previous final text (last 2,000 chars) and changed files from `file-change` segments; no git process. Records `lastRequestContext` from the stream.
- Validation notes: stale "does not support session resume" warning corrected.
- Implementation details: spec: fresh decision yields a new spawn with the handoff fields.

### Batch 32 verification

- Gate specced; manager handoff; scoped + app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 33: Blocking waits — manager and tools (S4, component 15 part 1) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: third serial manager edit plus new tool files; process spawning in `run-check`
- Tasks: 3 | Depends on: Batch 32 | Concurrent-safe with: Batches 23-31
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools`

### Task 33.1: `waitForAgents` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (+ spec)
- Plan reference: implementation-plan.md:362-372 (D13), :1074-1075
- Pattern to follow: `events` emitter `:143-144, 1269, 1653`
- Quality requirements: `(ids, 'any'|'all', timeoutMs ≤ 900_000)`; resolves on `agent:exited`, no polling; timeout returns partial; unknown ids reported per id; listeners removed.
- Validation notes: resolves within one tick of the exit event.
- Implementation details: none.

### Task 33.2: Schema and `ptah_agent_wait` tool — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/wait-tools-args.schema.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-wait.tool.ts` (+ specs)
- Plan reference: implementation-plan.md:1076-1078
- Pattern to follow: `agent-spawn-args.schema.ts`; `tool-result-budget.ts:52-54`
- Quality requirements: `{agentIds, mode, timeoutSec ≤ 900}`; per lane status, exit code, duration, stop reason, deliverable check, last lines; whole reply ≤4,000 chars (`WAIT_SUMMARY_MAX_CHARS`).
- Validation notes: size bound asserted.
- Implementation details: none.

### Task 33.3: `ptah_run_check` tool — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/run-check.tool.ts` (+ spec)
- Plan reference: implementation-plan.md:1079-1093
- Pattern to follow: `.ptah/tmp` convention `tool-result-budget.ts:20-24`
- Quality requirements: `project` `^[A-Za-z0-9@/_.-]{1,120}$`; `targets` ⊆ test, lint, typecheck, build; runs `node <workspace>/node_modules/nx/bin/nx.js run-many -t <targets> -p <project> --outputStyle=static` from an argument array, `shell:false`, cwd = caller workspace root; full log `.ptah/tmp/checks/<ts>-<project>.log`; summary ≤4,000 chars; timeout kills the process tree.
- Validation notes: `nx` missing → error result naming the path; path never from the caller.
- Implementation details: none.

### Batch 33 verification

- Size bounds and schema rejections specced; scoped command passes
- Reviewer: code-logic-reviewer (process spawning and input validation)

---

## Batch 34: Blocking waits — surfaces and `waitFor` rewrite (S4, component 15 part 2) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: one library; serial after Batches 5 and 7 on the same files
- Tasks: 2 | Depends on: Batch 33 | Concurrent-safe with: Batches 23-31
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools`

### Task 34.1: Advertised schemas and both dispatchers — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts` (+ parity spec)
- Plan reference: implementation-plan.md:1099
- Pattern to follow: Batch 7 edits
- Quality requirements: both tools on HTTP and stdio surfaces.
- Validation notes: parity spec updated.
- Implementation details: none.

### Task 34.2: `ptah.agent.waitFor` uses `waitForAgents`; help text — PENDING

- Batch 6 follow-up F6-M1: in `ptah.agent.spawn`, destructure and drop a caller-supplied `systemPrompt` with a one-line WARN, as `roleDefinition` already is. Also reject a non-string `effort` at this boundary.
- Carried from Batch 7 (d992ea3b9), deferred: the MCP surfaces now bound `effort` with `MAX_EFFORT_LENGTH` (`mcp-core/agent-spawn-args.schema.ts`), but the `execute_code` path does not. Apply the same string, 1..32 rule here so the `Lane policy` log line stays bounded.

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` (+ specs)
- Plan reference: implementation-plan.md:1087, :1099
- Pattern to follow: `agent-namespace.builder.ts:29-30, 415-450`; `system-namespace.builders.ts:508`
- Quality requirements: polling loop removed.
- Validation notes: none.
- Implementation details: none.

### Batch 34 verification

- Parity green; polling removed; scoped command passes
- Reviewer: code-style-reviewer

---

## Batch 35: Lane budget guard and blocked models (S4, component 16 + R9.5) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: last serial manager edit; reads the lane-guard keys from Batches 16-17
- Tasks: 4 | Depends on: Batches 17, 33 | Concurrent-safe with: Batches 23-31
- Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared` and the three-app typecheck

### Task 35.1: `LaneBudgetGuard` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts` (+ spec)
- Plan reference: implementation-plan.md:1101-1117
- Pattern to follow: plain class, no token (plan :485-486)
- Quality requirements: counts `tool-call` segments; ONE steer at steer-at ("You have made N tool calls. Stop exploring, finish the deliverable now, and report."); stop at stop-at with `stopReason:'tool-call-budget'`; identical tool + normalised `toolInput` (else `toolArgs`, else name) reaching repeat-at stops with `'repeat-call'`. O(1) per segment, no timers.
- Validation notes: cursor keys may be coarser (accepted, recorded).
- Implementation details: spec: steer once at 40, stop at 60, repeat at 20, settings honoured; a long run of identical `glob` calls stops at the repeat threshold, and varied `glob` args stop at the call budget (Batch 10 finding b).

### Task 35.2: `AgentProcessInfo.stopReason` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/agent-process.types.ts`
- Plan reference: implementation-plan.md:452-453
- Pattern to follow: Task 32.1
- Quality requirements: `stopReason?: 'tool-call-budget' | 'repeat-call' | string`.
- Validation notes: none.
- Implementation details: none.

### Task 35.3: `findBlockedLaneModel` and guard thresholds in the spawn environment — PENDING

- Batch 6 note F6-m3: `isReviewerOrTester` is exact and case-sensitive, per R2.4. Leave it unchanged unless R2.4 is relaxed.

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts`
- Plan reference: implementation-plan.md:440-441, :698, :728
- Pattern to follow: Task 6.1
- Quality requirements: `BLOCKED_LANE_MODELS = ['mimo-v2.6-flash-free']`, matched on the id after the last `/`, case-insensitive; spawn environment returns the three guard thresholds (routed reads, defaults 40/60/20; invalid file values → default).
- Validation notes: spec with and without a provider prefix.
- Implementation details: none.

### Task 35.4: Manager hooks the guard and refuses blocked models — PENDING

- Batch 6 follow-ups F6-m1 and F6-m2, both in the `doSpawnSdk` `Lane policy` log:
  - `prefixKeys: 'applied'` is logged before `runSdk`. Either document it as intent, or emit it after `runSdk` resolves.
  - Bound each `ignoredEfforts` value with `String(v).slice(0, 32)`.

- Depends on: Tasks 35.1-35.3
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (+ spec)
- Plan reference: implementation-plan.md:708-710, :1113
- Pattern to follow: `trackSdkHandle` `:476-605`, segment subscription `:535-548`, `stop` `:1227`
- Quality requirements: guard per tracked lane, released on exit; steer through `sendToAgent`; `unsupported` delivery logged, stop still enforced; `stopReason` in status; `LaneModelBlockedError` (lib error base) thrown before `runSdk`: "Model `<id>` is blocked for lanes because it is known to loop. Choose another model."
- Validation notes: nothing started for a blocked model.
- Implementation details: spec: stopReason surfaced; refusal.

### Batch 35 verification

- Guard and refusal specced; scoped + app typecheck pass
- Reviewer: code-logic-reviewer

---

## Deferred: S5 evidence follow-ups — NOT SCHEDULED

S5 needs E2 and the live L results from QA (implementation-plan.md:1381-1389). It is decomposed only after QA reports.
Contents, for the record:

- A1 defaults to 200,000 per model class whose E2 passed (component 17), then the 88/88 `autoCompact {}` audit re-run.
- `CODEX_RESUME_RESENDS_ROLE = false` only if the Task 10.3 AS6 report AND C2 both show the role survives in history;
  update the resume-site comment with measured tokens.
- AS2 fallback: `agents.max_depth=1` plus a nested-agent stop in the guard.
- AS3: `mcp_servers.ptah.enabled_tools` only if proven useful.
- OpenCode `prune:true` if O2 passes; `reserved` tuned from O1.
- R4.2 description gap text if AS1 fails.

## QA hand-off notes (not build batches)

- senior-tester owns L runs C1-C5, O1-O5, K1-K5, U1-U5, E2/E3 and the `research-report.md` appendix (decision 6:
  direct `codex exec` / `opencode run` / headless SDK, cheap model `gpt-6-luna`, hard turn caps, ≤5 runs per runtime).
- U1 runs on a build of `4e246388a` with the agent-sdk capture entry from Batch 11; the baseline is recorded before the
  PR merges.
- Offline QA: `codex debug prompt-input` and `codex mcp list --json` with the captured overrides. Run the AS16 probe from Git Bash: PowerShell 5.1 strips embedded double quotes from native arguments and corrupts the `mcp_servers={"name"=...}` override.
- C2/C3: confirm with M that no `<skills_instructions>` part is recorded in a resumed turn (Batch 10 finding a).
- Recorded as unverified: R6.2 against the live Codex-proxy backend; the Ptah-CLI agent-listing delta (measured only).
- Completion (Mode 3) needs visual-reviewer screenshots (dark + light) for Batches 21, 22 and 31, and write-path traces
  for the new `agentOrchestration.*` keys, the `compaction.*` move with its migration, and the `~/.codex/config.toml`
  writer.

---

# Addendum: decision 9 scope addition (N1-N6) — Batches 36-49

Source: context.md § User Decisions item 9 (N1-N6, user-approved 2026-10-03) and § Handoff lean rules 1-5. Appended by
the team-leader (Mode 2 scope addition). Batches 1-35 above are unchanged. The header counts at the top of this file
cover Batches 1-35 only; with this addendum the run is **Total tasks: 131 | Batches: 49** (Complete count unchanged).
No implementation-plan.md section exists for N1-N6; plan references below point at context.md item 9 and at the
existing plan lines each item extends.

## Addendum plan validation

Status: PASSED WITH RISKS

Assumptions:

- AS-N1a: `subagentPromptCacheTtl` is a `Settings` field (`sdk.d.ts:8540-8542`, installed SDK 0.3.278), so it is set
  through the flag-settings path of the options builder (`buildFlagSettings` `sdk-query-options-builder.ts:377`), not
  as a top-level `Options` field. Unset = 5 minutes unless `ENABLE_PROMPT_CACHING_1H=1`; the env var
  `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` wins in the SDK. Verified from sdk.d.ts; Task 38.2 re-checks.
- AS-N1b: unverified — the host's `process.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` reaches the SDK child process
  (auth env building may replace `env`). Task 38.2 verifies; if the env is stripped, the override display (Task 38.1)
  must say "set in your environment but not passed to the SDK", never claim it is effective.
- AS-N1c: unverified — Ptah builds query options once per live session (streaming input). Then the Task 28.2 gate
  ("metadata lists resumable subagents") is false for every fresh session, and `auto` would never send `'1h'` for
  subagents spawned in that session. Task 38.2 verifies against `session-query-executor.service.ts`; the `auto` rule
  below is chosen so it works either way.
- AS-N2: the last activity of a Claude subagent is approximated by the last `SubagentRegistryService` register/update
  (start, status change, SubagentStop). Records restored without `lastActivityAt` are `cold`. Task 40.2 verifies the
  hook points.
- AS-N3: unverified — filesystem agent frontmatter `disallowedTools` (SDK `AgentDefinition.disallowedTools`,
  `sdk.d.ts:50`) is honoured for `.claude/agents/*.md` by the pinned SDK, including a server prefix form
  (`mcp__firecrawl`). Task 42.1 verifies before any agent file changes; if false, Batch 42 stops and the team-leader
  returns a BLOCKER. The SDK `agents` option is NOT used: it requires a full `prompt`, which would duplicate every
  agent body.
- AS-N4: unverified — the 34-44k subagent start prefix includes Ptah-owned text (memory snapshot, symbol list,
  orchestration tables). Claude transcripts do not record the system prompt, so attribution needs the agent-sdk
  capture entry (Task 11.2). If the measured parts are not Ptah-owned, Batch 45 reports and stops (no edit).

| Risk                                                                                                                       | Severity | Mitigation                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 vs Task 28.2: two gates for the same SDK field                                                                          | HIGH     | Batch 38 depends on Batch 28 and REPLACES the 28.2 gate in place with the N1 resolver (Task 38.2). Task 28.2 stays as written and is valid until Batch 38 lands. No second TTL code path. |
| The user's Windows env var `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=1h` masks the N1 `auto` effect in every "after" run      | HIGH     | Task 36.2 records the env state of the baseline transcripts; QA "after" runs for N1 clear the env var in the run process and record that (decision 6 budget).                             |
| `.codex/agents/team-leader.toml` and `.opencode/agent/team-leader.md` have uncommitted edits in the MAIN checkout          | MEDIUM   | Batch 49 only adds a "Lean orchestration rules" section; the orchestrator should expect a merge on those two files.                                                                       |
| Over-restricting a subagent's tools breaks its job (visual-reviewer needs the browser, researcher-expert needs web search) | MEDIUM   | Task 42.2 policy table is per type and spec-pinned; reviewers lose browser and web-scrape servers only.                                                                                   |
| N6 cost differs from M for the same data                                                                                   | MEDIUM   | Task 46.1 uses the same four usage fields and the shared pricing table; its spec reuses the Batch 10 M fixture and asserts equal totals.                                                  |
| N2 resume guidance contradicts the Batch 32 lane gate wording                                                              | LOW      | Task 41.1 reuses the Batch 32 guidance shape.                                                                                                                                             |

Edge cases:

- Env var with an invalid value (`2h`) — reported as `invalid`, shown verbatim; effective TTL falls back to the
  setting — Tasks 37.2, 38.1, 39.2.
- Internal queries (curator, commit message, internal-query service) never spawn subagents — `auto` leaves the field
  unset — Task 38.2.
- Subagent restored from metadata after a restart with no timestamp — `cold` — Task 40.1.
- `lastActivityAt` in the future (clock skew) — `warm`, idle 0, never negative — Task 40.1.
- Provider without cache usage (Ollama Cloud) in the N6 panel — "not reported", never 0 (R7.4) — Tasks 46.2, 47.1.

## Addendum dependency note (Batches 36-49 relative to Batches 4-35)

- Batch 36 (scripts only) can run NOW, concurrently with Batches 4-9 and 12-35; it is serial only with Batch 11 (both
  under `scripts/`). It must finish before Batches 38, 42 and 45 so the "before" numbers exist.
- Batch 48 (skill text) has no code dependency and can run at any time. Batch 49 waits for Batch 43 (same
  `team-leader.md`).
- N1/N2 (Batches 37-41) sit after the S3/S4 settings and session plumbing: 37 after 16; 38 after 14, 17, 28, 36, 37;
  39 after 20, 21, 38; 40 after 37; 41 after 40.
- N3/N4 (Batches 42-45) run after 36; 43 and 44 after 42; 45 also after 7, 11 and 38.
- N6 (Batches 46-47) runs last: 46 after 13, 22, 32, 41; 47 after 46.
- Concurrent-safe (file-disjoint): 38 with 40; 39 with 41; 42-44 with 37-41; 48 with every batch.
- "After" measurements for N1, N3 and N4 are QA work (decision 6 budget: at most 5 short Claude-side runs), recorded
  in the Batch 36 measurement file.

---

## Batch 36: M subagent views and decision-9 "before" baselines (N1/N3/N4 measurement) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: scripts-only extension of tool M (Batch 10); the baselines must exist before any N1/N3/N4 change lands
- Tasks: 2 | Depends on: Batch 10 | Concurrent-safe with: Batches 4-9, 12-35, 37-41, 46-49 (serial with 11)
- Verify: `npm run test:scripts 2>&1 | tail -30` (scripts are not an Nx project; same exception as Batch 10)

### Task 36.1: `--subagents` view in M — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/scripts/agent-usage/claude-transcript.reader.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/scripts/agent-usage/subagent-metrics.ts` (new), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/scripts/agent-usage-report.ts` (+ specs and a sanitized `__fixtures__/` subagent jsonl)
- Plan reference: context.md item 9 N1, N3; implementation-plan.md:945-993 (M)
- Pattern to follow: `lane-metrics.ts` and the `--lanes` view (Task 10.2)
- Quality requirements: reads `~/.claude/projects/**/subagents/*.jsonl` read-only. Per subagent: agent type, first-request prefix (input + cache_read + cache_creation), request count, total cache_read / cache_creation / output, and every request whose gap to the previous request of the SAME subagent is > 300 s, with its cache_creation tokens. Summary: prefix min / median / max per agent type; "resume after > 5 min" count, cache_creation sum and median; `--since <iso>` filter.
- Validation notes: dedupe by `message.id`, last line wins (R7.2); missing usage → skipped and counted, never 0.
- Implementation details: no new `package.json` script; run as `npm run usage:report -- --subagents`.

### Task 36.2: Record the decision-9 "before" baselines — PENDING

- Depends on: Task 36.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.ptah/specs/TASK_2026_597_ab22/measurements/s9-subagent-baselines.md` (new)
- Plan reference: context.md § Handoff (1,075 requests; start prefix 34-44k, median 39.6k)
- Pattern to follow: `measurements/s2-offline-baselines.md` (Task 10.3)
- Quality requirements: run M on this task's Claude session transcripts. Record N1 "before" = resumes after > 5 min (count, cache_creation sum, median) and N3/N4 "before" = start prefix min / median / max per agent type. The median must land within 10% of 39.6k, or the difference is explained. Record whether `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` was set for those sessions (set on 2026-10-03; split before/after that time). Leave empty "after (QA)" tables for N1, N3 and N4.
- Validation notes: numbers only, no transcript content.
- Implementation details: none.

### Batch 36 verification

- View specced on the fixture; baselines file holds the prefix median and the resume numbers
- Reviewer: code-logic-reviewer

---

## Batch 37: N1 setting key and TTL resolver (platform-core, shared) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: types and a pure resolver that Batches 38-41 import; same files as Batches 2 and 16
- Tasks: 2 | Depends on: Batch 16 | Concurrent-safe with: Batches 36, 42-44, 48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core @ptah-extension/shared 2>&1 | tail -40` and `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli 2>&1 | tail -20`

### Task 37.1: File-based key `agentOrchestration.subagentPromptCacheTtl` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/platform-core/src/file-settings-keys.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
- Plan reference: context.md item 9 N1; pattern of Tasks 2.1-2.2
- Pattern to follow: `agentOrchestration.codex*` keys `file-settings-keys.ts:162-167`
- Quality requirements: values `'auto' | '5m' | '1h'`, default `'auto'`; the getConfig result gains `subagentPromptCacheTtl` and `subagentPromptCacheTtlEnvOverride?: '5m' | '1h' | 'invalid'`; setConfig accepts the key.
- Validation notes: none.
- Implementation details: none.

### Task 37.2: `resolveSubagentPromptCacheTtl` pure resolver — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/utils/subagent-prompt-cache-ttl.ts` (new, + spec, exported from the shared utils barrel)
- Plan reference: context.md item 9 N1
- Pattern to follow: `resolveContextCapacity` `pricing.utils.ts:495-521`
- Quality requirements: input `{ setting, envValue, canSpawnSubagents }`; output `{ sdkValue: '5m' | '1h' | undefined, effective: '5m' | '1h', source: 'env' | 'setting' | 'auto' | 'sdk-default', envOverride?: '5m' | '1h' | 'invalid' }`. A valid env value → `effective` = env, `source:'env'`; `sdkValue` still follows the setting (the SDK lets env win). `auto` → `'1h'` when `canSpawnSubagents`, else unset (`effective:'5m'`, `source:'sdk-default'`). Unknown setting value → treated as `auto`.
- Validation notes: spec table covers every setting x env (unset / 5m / 1h / invalid) x canSpawn.
- Implementation details: none.

### Batch 37 verification

- Key, types and resolver specced; scoped + three-app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 38: N1 RPC and options builder (replaces the Task 28.2 gate) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: one serial edit on the options builder after Batches 14, 23 and 28 have landed there
- Tasks: 2 | Depends on: Batches 14, 17, 28, 36, 37 | Concurrent-safe with: Batches 40, 42-44, 48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk 2>&1 | tail -40`
- Before/after: before = Task 36.2 "resumes after > 5 min" cache_creation; after = QA re-run of `npm run usage:report -- --subagents` on post-build runs with the env var cleared, recorded in `measurements/s9-subagent-baselines.md`.

### Task 38.1: `agent:getConfig` / `agent:setConfig` for the TTL key; env override reported — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (+ spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` (`KNOWN_CONFIG_KEYS`)
- Plan reference: context.md item 9 N1; Tasks 3.1-3.2, 17.4
- Pattern to follow: Task 3.2 validation
- Quality requirements: set rejects values outside `auto | 5m | 1h` with the Task 3.2 error shape; get returns the setting plus `subagentPromptCacheTtlEnvOverride` from `resolveSubagentPromptCacheTtl` (host env), including `'invalid'`.
- Validation notes: AS-N1b — if Task 38.2 finds the env is not passed to the SDK, add `envOverrideReachesSdk: false` and say so in the report.
- Implementation details: none.

### Task 38.2: Builder sets the TTL through the resolver; one INFO line — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (+ spec)
- Plan reference: context.md item 9 N1; implementation-plan.md:1195-1196 (Task 28.2, superseded here)
- Pattern to follow: `buildFlagSettings` `sdk-query-options-builder.ts:377`; Task 23.3 log line
- Quality requirements: REPLACE the Task 28.2 gate in place (no second path). `canSpawnSubagents` = the query is not an internal query AND the subagent tool (`Task`/`Agent`) is not disallowed, OR session metadata lists resumable subagents (the 28.2 condition). Set `subagentPromptCacheTtl` in the flag settings only when `sdkValue` is defined. Log once per session at INFO: `subagentPromptCacheTtl effective=<5m|1h> source=<env|setting|auto|sdk-default> sdkOption=<5m|1h|unset>`.
- Validation notes: AS-N1a (Settings field), AS-N1b (env reaches the child — check how `env` is built), AS-N1c (options built once per session — record the finding in the report). Internal queries leave the field unset.
- Implementation details: spec: auto + subagent-capable → `'1h'`; auto + internal → unset; `5m` setting → `'5m'`; env set → log `source=env`; the Task 28.2 spec cases are kept or rewritten to the new rule.

### Batch 38 verification

- Setting honoured end to end in specs; the Task 28.2 gate code is gone; scoped command passes
- Reviewer: code-logic-reviewer

---

## Batch 39: N1 setting and env-override display in the UI — DEFERRED (follow-up, decision 11)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer re-run
- Execution mode: sequential
- Rationale: settings state, then one small card mounted in orchestration settings
- Tasks: 2 | Depends on: Batches 20, 21, 38 | Concurrent-safe with: Batches 41-45, 48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat 2>&1 | tail -40`

### Task 39.1: State carries the TTL setting and env override — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/core/src/lib/services/providers-settings.types.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/core/src/lib/services/providers-settings-state.service.ts` (+ spec)
- Plan reference: context.md item 9 N1; Batch 20
- Pattern to follow: Task 20.1 field unions, Task 20.3 state service
- Quality requirements: field `subagentPromptCacheTtl` committed through the Batch 20 commit loop; read-only `subagentPromptCacheTtlEnvOverride`.
- Validation notes: none.
- Implementation details: none.

### Task 39.2: `subagent-cache-ttl-setting` component — PENDING

- Depends on: Task 39.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/settings/ptah-ai/subagent-cache-ttl-setting.component.ts` (new, + spec), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`
- Plan reference: context.md item 9 N1 ("show it in the UI when the env var overrides the setting")
- Pattern to follow: `lane-budget-settings.component.ts` (Task 21.1) and its `@defer (on viewport)` mount (Task 21.2)
- Quality requirements: select `Auto (1 hour for sessions with subagents) | 5 minutes | 1 hour`. With an env override the select stays editable and a notice reads "`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=<value>` is set in your environment and takes precedence." (`invalid` → "has an invalid value and is ignored by Ptah"; `envOverrideReachesSdk: false` → "is set but not passed to the SDK").
- Validation notes: dark + light screenshots needed at Mode 3 (added to the visual list with Batches 21, 22, 31).
- Implementation details: none.

### Batch 39 verification

- Component specced with and without an override; scoped command passes
- Reviewer: code-logic-reviewer (visual-reviewer at QA)

---

## Batch 40: N2 subagent activity and cache state (shared, vscode-core) — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: shared type and pure function, then the registry stamps activity
- Tasks: 2 | Depends on: Batch 37 | Concurrent-safe with: Batches 38, 42-44, 48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core 2>&1 | tail -40` and `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli 2>&1 | tail -20`

### Task 40.1: `lastActivityAt` and `computeSubagentCacheState` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/subagent-registry.types.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/utils/subagent-cache-state.ts` (new, + spec)
- Plan reference: context.md item 9 N2
- Pattern to follow: `SubagentRecord.startedAt` `subagent-registry.types.ts:52`
- Quality requirements: `SubagentRecord.lastActivityAt?: number`; `SubagentCacheInfo = { cacheState: 'warm' | 'cold'; effectiveTtl: '5m' | '1h'; idleMs: number }`; pure `computeSubagentCacheState(lastActivityAt, effectiveTtl, now)`: warm when idle < TTL; missing timestamp → cold; future timestamp → warm, idle 0.
- Validation notes: idle exactly equal to the TTL → cold.
- Implementation details: none.

### Task 40.2: Registry stamps activity — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-core/src/services/subagent-registry.service.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.ts` (+ specs)
- Plan reference: context.md item 9 N2
- Pattern to follow: `register` `:89-130`, `update` `:276-358`, `restoreResumableBySession` `:519-551`
- Quality requirements: `lastActivityAt = now` on register and every update (including the SubagentStop completion); restore keeps a persisted value, else leaves it unset (cold).
- Validation notes: AS-N2 — the report names which hooks reach `update` during a subagent run.
- Implementation details: injectable clock for specs.

### Batch 40 verification

- Function and stamping specced; scoped + three-app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 41: N2 cache state in agent status and the orchestrator-facing context — DEFERRED (follow-up, decision 11)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: the two places the orchestrator and the UI read Claude subagent status
- Tasks: 2 | Depends on: Batch 40 | Concurrent-safe with: Batches 39, 42-45, 48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers @ptah-extension/shared 2>&1 | tail -40` and `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli 2>&1 | tail -20`

### Task 41.1: Resumable-subagent context carries cache state and guidance — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.ts` (+ spec)
- Plan reference: context.md item 9 N2; Batch 32 guidance (component 14)
- Pattern to follow: Task 32.4 stale warning wording
- Quality requirements: each resumable subagent line adds `cache: warm|cold (TTL <5m|1h>, idle <n> min)`; one guidance line: "Resume a subagent only when its cache is warm. When it is cold, start a fresh subagent with a short brief." Effective TTL from `resolveSubagentPromptCacheTtl` (setting + host env, `canSpawnSubagents: true`).
- Validation notes: no change to which subagents are listed.
- Implementation details: none.

### Task 41.2: Subagent status RPC returns `SubagentCacheInfo` — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts` (+ spec; `subagent-rpc.schema.ts` only if the response is schema-checked), `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
- Plan reference: context.md item 9 N2
- Pattern to follow: the existing resumable-list response in `subagent-rpc.handlers.ts`
- Quality requirements: optional `cacheInfo` on each returned record (optional so older webviews still parse).
- Validation notes: none.
- Implementation details: none.

### Batch 41 verification

- Context lines and RPC field specced; scoped + three-app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 42: N3 per-type tool allowlist policy in agent generation — COMPLETE (commit 349df3ac2; writer is `buildAgentFileContent` in orchestrator.service.ts; full tool names or server-level entries only, no partial wildcard, no bare `*`)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: verify the mechanism first, then one pure policy table rendered into generated agent frontmatter
- Tasks: 3 | Depends on: none (decision 11: Batch 36 dropped, see § PR 1 scope) | Concurrent-safe with: Batches 7, 23, 48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation 2>&1 | tail -40`
- Before/after: before = context.md § Handoff start prefix (34-44k, median 39.6k); after = QA step with the existing
  tool M on post-build subagent transcripts (Batch 36 per-type view deferred).
- Scope guard: tool allowlist ONLY (the tool part of Wave 4.5). No model pins, no review-policy change.

### Task 42.1: Verify frontmatter `disallowedTools` is honoured (gate) — COMPLETE

- File: none (evidence in the executor report)
- Plan reference: AS-N3
- Pattern to follow: `sdk.d.ts:38-59` `AgentDefinition`
- Quality requirements: show from the pinned SDK / CLI how filesystem agent frontmatter `tools` / `disallowedTools` / `mcpServers` are parsed, and whether a server prefix (`mcp__firecrawl`) or a wildcard (`mcp__ptah__ptah_browser_*`) matches. If not honoured, STOP and report; the team-leader returns a BLOCKER.
- Validation notes: none.
- Implementation details: none.

### Task 42.2: `subagent-tool-allowlist.ts` policy table — COMPLETE

- Depends on: Task 42.1
- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts` (new, + spec)
- Plan reference: context.md item 9 N3
- Pattern to follow: plain exported constant + pure function (Task 6.1 style)
- Quality requirements: per agent type (the 15 template names) → a `disallowedTools` list in the form Task 42.1 proved. Reviewers (code-logic, code-style), planners (project-manager, software-architect, team-leader) and modernization-detector: no browser tools, no web-scrape / web-search servers. visual-reviewer keeps the browser; researcher-expert keeps web search; developers lose web-scrape servers only. Unknown type → no restriction.
- Validation notes: spec pins every row.
- Implementation details: none.

### Task 42.3: Generator writes the policy into agent frontmatter — COMPLETE

- Depends on: Task 42.2
- File: the frontmatter writer, one of `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-generation/src/lib/services/content-generation.service.ts` or `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-generation/src/lib/services/template-storage.service.ts` (executor confirms which writes frontmatter; edit only that one) (+ spec)
- Plan reference: context.md item 9 N3
- Pattern to follow: how `model:` frontmatter is emitted from `templates/agents/*.template.md`
- Quality requirements: generated `.md` agents carry the `disallowedTools` line; Codex/OpenCode mirrors (`user-layer-mirror.service.ts`) unchanged (Claude tool names do not apply there).
- Validation notes: idempotent on re-generation.
- Implementation details: none.

### Batch 42 verification

- Gate evidence recorded; policy and writer specced; scoped command passes
- Review (decision 11): no per-batch review; scoped `typecheck,lint,test` before commit; covered by the end-of-subset code-logic review

---

## Batch 43: N3 applied to this repo's agents — reviewers and planners — COMPLETE (commit 825d8dff2)

- Recommended executor: backend-developer (config text only)
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: this repo's own `.claude/agents` are what the "after" measurement runs on
- Tasks: 1 | Depends on: Batch 42 | Concurrent-safe with: Batches 44, 45, 48
- Verify: no Nx project owns `.claude/agents`; content check — each changed frontmatter line equals its Task 42.2 row (`git diff -U0 -- .claude/agents | tail -40`), and `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation 2>&1 | tail -20` stays green

### Task 43.1: Frontmatter `disallowedTools` on six agents — COMPLETE

- File: `code-logic-reviewer.md`, `code-style-reviewer.md`, `modernization-detector.md`, `project-manager.md`, `software-architect.md`, `team-leader.md` (all under `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/`)
- Plan reference: context.md item 9 N3
- Pattern to follow: Task 42.2 table
- Quality requirements: frontmatter only; bodies unchanged.
- Validation notes: none.
- Implementation details: none.

### Batch 43 verification

- Six frontmatter lines match the policy
- Review (decision 11): config text only — content check before commit; covered by the end-of-subset code-logic review

---

## Batch 44: N3 applied to this repo's agents — remaining restricted types — COMPLETE (commit 6c7859d59)

- Recommended executor: backend-developer (config text only)
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: the second half of the repo agents, kept to at most six files
- Tasks: 1 | Depends on: Batch 42 | Concurrent-safe with: Batches 43, 45, 48, 49
- Verify: as Batch 43

### Task 44.1: Frontmatter `disallowedTools` on the remaining restricted agents — COMPLETE

- File: every `.md` under `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/` that has a non-empty Task 42.2 row and is not in Task 43.1 (expected: `backend-developer.md`, `frontend-developer.md`, `devops-engineer.md`, `senior-tester.md`, `technical-content-writer.md`, `ui-ux-designer.md`; at most six)
- Plan reference: context.md item 9 N3
- Pattern to follow: Task 43.1
- Quality requirements: frontmatter only.
- Validation notes: visual-reviewer, researcher-expert and video-director keep their tools unless the table says otherwise.
- Implementation details: none.

### Batch 44 verification

- Lines match the policy
- Review (decision 11): config text only — content check before commit; covered by the end-of-subset code-logic review

---

## Batch 45: N4 trim injected text for Claude subagents — NO-OP (deferred; see batch-45-executor-report.md: the memory snapshot, symbol list and orchestration tables reach the main session only; MCP instructions and ptah_* tool schemas reach subagents through the shared MCP connection, so N3 is the only lever)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-run
- Execution mode: sequential
- Rationale: attribution first (which Ptah-owned text reaches a subagent), then a scoped trim
- Tasks: 2 | Depends on: Batches 7, 23 (shared files; decision 11 dropped 11, 36, 38 — see § PR 1 scope) | Concurrent-safe with: Batches 43, 44, 48, 49
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools 2>&1 | tail -40`
- Before/after: before = context.md § Handoff start prefix median 39.6k; after = QA step with the existing tool M, in a column separate from N3 so the two effects are not mixed.

### Task 45.1: Attribute the subagent start prefix — NO-OP

- File: none in code (evidence in the executor report)
- Plan reference: context.md item 9 N4; 562 Wave 2.6 (R3.4)
- Pattern to follow: static attribution (decision 11 narrowing; the Task 11.2 capture entry is deferred). Trace in code
  which Ptah-owned strings reach a Claude subagent, and size each built string with `ptah_count_tokens` or a spec that
  prints its length.
- Quality requirements: list each part of a Claude subagent's first request with its token size and source: Claude Code built-in, `.claude/agents` body, CLAUDE.md, MCP server `instructions`, tool schemas, skills listing, Ptah-appended text (memory block `memory-prompt-injector.ts`, symbol list, orchestration tables `ptah-core-prompt.ts`). Mark each Ptah-owned part as subagent-only or shared with the parent. Known from the re-plan check: no `SubagentStart` `additionalContext` injection exists in `libs/backend`, so the main-session system-prompt append is expected NOT to reach subagents; the MCP `instructions` and tool descriptions are the likely shared candidates. If no Ptah-owned memory / symbol / orchestration text reaches subagents, or every Ptah-owned part is shared with the parent, STOP and report (AS-N4); the team-leader then records N4 as deferred.
- Validation notes: no paid live runs beyond the decision 6 QA budget; prefer an existing capture.
- Implementation details: none.

### Task 45.2: Keep only the role and project rules in subagent context — NO-OP

- Depends on: Task 45.1
- File: only the Ptah-owned sources Task 45.1 names, from `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (+ specs)
- Plan reference: context.md item 9 N4
- Pattern to follow: Task 5.2 (resume omits preambles); R3.4 "at most once"
- Quality requirements: subagent context has no memory snapshot, no symbol list and no orchestration tables; it keeps the role and the project rules. The parent session's text is unchanged.
- Validation notes: spec asserts the parent prompt is byte-identical before/after for a non-subagent session.
- Implementation details: none.

### Batch 45 verification

- Attribution recorded; trim specced; scoped command passes
- Review (decision 11): no per-batch review; scoped `typecheck,lint,test` before commit; covered by the end-of-subset code-logic review

---

## Batch 46: N6 per-agent usage, context and cache data (extends R7) — DEFERRED (follow-up, decision 11)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer re-run
- Execution mode: sequential
- Rationale: one shared estimate function, then the monitor store mapping; same data as M
- Tasks: 2 | Depends on: Batches 13, 22, 32, 41 | Concurrent-safe with: Batches 42-45, 48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/chat-streaming 2>&1 | tail -40` and `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli 2>&1 | tail -20`

### Task 46.1: `estimateUsageCost` on the shared pricing table — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/shared/src/lib/utils/pricing.utils.ts` (+ spec)
- Plan reference: context.md item 9 N6; R7.3; Task 14.3
- Pattern to follow: `findModelPricing` `pricing.utils.ts:221` and its cache-rate fields
- Quality requirements: `{ input, cacheRead, cacheWrite, output, model }` → USD estimate, or `undefined` when the model has no price; reuse an existing function if one already does this (no duplicate).
- Validation notes: spec uses the Batch 10 M fixture numbers and asserts the totals M reports.
- Implementation details: none.

### Task 46.2: `MonitoredAgent` gains context size, cache state and usage — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (+ spec)
- Plan reference: context.md item 9 N6
- Pattern to follow: `MonitoredAgent` `agent-monitor.store.ts:86`
- Quality requirements: per agent `contextTokens` (last request input + cache read + cache write; lanes from `lastRequestContext`, Task 32.1), `cacheState` (subagents from `cacheInfo`, Task 41.2; lanes when the Batch 32 status reports it, else `unknown`), `usage { cacheRead, cacheWrite, output }` and `estimatedCostUsd`. No cache fields from the provider → `cacheReported: false`.
- Validation notes: never coerce missing values to 0.
- Implementation details: none.

### Batch 46 verification

- Estimate equals M on the fixture; store mapping specced; scoped + three-app typecheck pass
- Reviewer: code-logic-reviewer

---

## Batch 47: N6 agent panel display — DEFERRED (follow-up, decision 11)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer re-run
- Execution mode: sequential
- Rationale: display only, on the agent card the agent monitor panel renders
- Tasks: 1 | Depends on: Batches 22, 46 | Concurrent-safe with: Batches 42-45, 48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat 2>&1 | tail -40`

### Task 47.1: Context, cache state and cost on each agent card — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts` (+ specs)
- Plan reference: context.md item 9 N6; R7.4
- Pattern to follow: Task 22.1 (cache summed separately), Task 22.2 ("not reported")
- Quality requirements: shows context size, a warm/cold badge (TTL in the tooltip), cache read / write / output tokens and "~$x.xx est."; "not reported" when the provider reports no cache; `unknown` state shows no badge.
- Validation notes: dark + light screenshots at Mode 3 (added to the visual list).
- Implementation details: none.

### Batch 47 verification

- Display specced including "not reported"; scoped command passes
- Reviewer: code-logic-reviewer (visual-reviewer at QA)

---

## Batch 48: N5 lean orchestration rules in the orchestration skill — COMPLETE (commit 26386239c; rule 3 updated to the decision 11 risk-based review; the pre-commit Prettier hook reformatted the plugin copies, so they now differ from `.claude/skills` in formatting only)

- Recommended executor: backend-developer (docs / skill text only, no code)
- Fallback executor: technical-content-writer
- Execution mode: sequential
- Rationale: text only; the repo copy and the shipped plugin copy get the same section
- Tasks: 1 | Depends on: none | Concurrent-safe with: every batch
- Verify: no Nx project owns `.claude/skills`; content check — `grep -c "Lean orchestration rules"` = 1 in each of the four files, and `git diff --no-index --stat` between each repo file and its plugin copy shows no new difference beyond what existed at base

### Task 48.1: Encode lean rules 1-5 — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/skills/orchestration/SKILL.md`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/skills/orchestration/references/team-leader-modes.md`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/team-leader-modes.md`
- Plan reference: context.md § Handoff lean rules 1-5 (rule 6 is task-specific and stays out)
- Pattern to follow: existing section style in `SKILL.md`
- Quality requirements: a "Lean orchestration rules" section: (1) a fresh team-leader for every Mode 2/3 call, given only the batch report and review paths, never a resumed long-lived one; (2) resume a developer or reviewer only inside the cache window (5 min, or the effective subagent TTL / `cacheState: warm` from N1/N2), otherwise start fresh with the batch section and report paths; (3) one shipping-code review per batch (code-logic-reviewer), a style review only when the batch is mostly new public API; (4) Blocking and Serious fixed in one fix round, Moderate only if it can break a lane config or lose data (otherwise a named later task), Minor recorded not fixed; at most one fix round, then a re-review scoped to the fixes; (5) short orchestrator updates, no status message per notification.
- Validation notes: if a plugin copy already differs from its repo copy at base, add the section to both without reconciling other text.
- Implementation details: none.

### Batch 48 verification

- Section present once in all four files and matches context.md
- Review (decision 11): doc-only — no review; content check before commit; included in the combined diff

---

## Batch 49: N5 lean rules in the team-leader definition and its mirrors — COMPLETE (commit 4f99318aa; Minor left: the older Mode 2 text in team-leader.md still says one review per batch, the new section placed before it sets the per-phase rule)

- Recommended executor: backend-developer (docs / agent text only, no code)
- Fallback executor: technical-content-writer
- Execution mode: sequential
- Rationale: the team-leader definition, its Codex/OpenCode mirrors and its generation template kept in sync
- Tasks: 1 | Depends on: Batch 43 (same `team-leader.md`) | Concurrent-safe with: Batches 45-48
- Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation 2>&1 | tail -30` (template) and `grep -c "Lean orchestration rules"` = 1 in each of the four files

### Task 49.1: Lean rules section in four team-leader files — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/team-leader.md`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.codex/agents/team-leader.toml`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.opencode/agent/team-leader.md`, `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/agent-generation/templates/agents/team-leader.template.md`
- Plan reference: context.md § Handoff lean rules 1-5
- Pattern to follow: Task 48.1 text; mirror formats from `user-layer-mirror.service.ts`
- Quality requirements: the same rules as Task 48.1, phrased from the team-leader's side (it expects a fresh invocation per transition, one review per batch, at most one fix round). Only an added section; no other text changes (the main checkout has uncommitted edits to the two mirror files — keep the diff minimal).
- Validation notes: TOML string escaping stays valid in the `.codex` file.
- Implementation details: none.

### Batch 49 verification

- Section present once in all four files; agent-generation green
- Review (decision 11): doc-only — no review; content check and agent-generation green before commit; included in the combined diff

---

## Addendum Mode 3 additions

- Visual list adds Batches 39 and 47 (dark + light).
- Write-path trace adds `agentOrchestration.subagentPromptCacheTtl` → `resolveSubagentPromptCacheTtl` → flag setting
  `subagentPromptCacheTtl` (and the env precedence), and the `.claude/agents` frontmatter written by Batches 42-44.
- Measurement: `measurements/s9-subagent-baselines.md` must hold N1, N3 and N4 before AND after numbers.
- Decision 11 override for PR 1: N1, N6 and Batches 39/47 are deferred, so the PR 1 Mode 3 visual list is empty for
  the addendum, the write-path trace covers only the `.claude/agents` frontmatter (Batches 42-44), and the measurement
  file is created at QA with N3 and N4 only (before = context.md § Handoff, after = existing tool M).

## PR 1 phase-end review (decision 11) — APPROVED

Review: `pr1-phase-end-code-logic-review.md` (0 Blocking, 0 Serious, 2 Moderate, 3 Minor). No fix round. Follow-ups:

- PR1-M1: a Ptah-CLI lane silently drops `effort` (`agent-namespace.builder.ts:231`). Follow-up task, with F6-M1 (Task 34.2).
- PR1-M2: a live change to `compaction.enabled` is not applied; only `compaction.threshold` is (`session-lifecycle-manager.ts:409`). Follow-up task, with the deferred compaction settings batches (16/17).
- Minor items: recorded in the review file only.
