# Prompt Token-Efficiency Audit — Ptah shipped prompt surfaces

Worktree: `.claude-worktrees/prompt-token-efficiency` (branch `feat/prompt-token-efficiency`, from `origin/main` a3099987e).

## 0. Measured motivation (Codex lane, 7 days, `scripts/codex-usage-report.mjs`)

| Measure | Value |
|---|---|
| Codex sessions | 159 (156 from the Ptah spawn lane `codex_sdk_ts`) |
| API requests | 10,837 (avg 68 per session) |
| Average context per request | 115k tokens (711 requests above 200k) |
| Compactions | 24 |
| Total input tokens | 1.23 billion (97% cached) |
| Output tokens | 3.7 million |

Every tool call resends the whole thread, so cost = requests × context. Drivers, largest first:

1. Polling long work: 3,167 `wait` calls = 29% of all requests, each a full-context request.
2. Huge shell output in context: 56 MB total, 516 outputs > 40 KB, largest 1.8 MB (test/build logs).
3. No early compaction: contexts run to the 258k window.
4. 27k-token baseline per spawn: base instructions + ~33 KB role block + tool schemas.
5. Long multi-batch lanes instead of short narrow ones (one worktree: 18 sessions, 296M tokens).

These drivers are vendor-independent (every CLI resends the thread per tool call).

## 1. Summary table per surface

| # | Surface | Path | Bytes | ~Tokens | Cost-raising directives |
|---|---|---|---|---|---|
| A | 15 subagent role definitions (rendered per lane by `renderRoleBlock`) | `.claude/agents/*.md` | 201,464 total (8,401 min / 22,871 max / 13,431 avg) | ~50,366 total; ~3,358 avg per spawn | ~8 per agent |
| A' | Codex-synced copies | `.codex/agents/*.toml` | 181,467 (15 files) | ~45,367 | same, inherited |
| B | `orchestration` skill (SKILL + 7 refs) | `.claude/skills/orchestration/` | 77,405 | ~19,351 | 4 |
| B | `agent-lanes` | `.claude/skills/agent-lanes/SKILL.md` | 11,251 | ~2,813 | 3 |
| B | `fleet-orchestration` | `.claude/skills/fleet-orchestration/SKILL.md` | 5,755 | ~1,439 | 4 |
| B | `tribunal` (SKILL + 6 refs) | `.claude/skills/tribunal/` | 37,072 | ~9,268 | 3 |
| B | `execute-phase-gated-task` | `.claude/skills/execute-phase-gated-task/SKILL.md` | 4,236 | ~1,059 | 5 |
| B | `ptah-cli-usage` (SKILL + 7 refs) | `.claude/skills/ptah-cli-usage/` | 87,445 | ~21,861 | 0 |
| C | Shipped plugins | `apps/ptah-extension-vscode/assets/plugins/**` | 1,466,463 (204 files) | ~366,616 | 6 (all in `ptah-core` copies of B) |
| D | Chat system prompt `PTAH_CORE_SYSTEM_PROMPT` | `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:26-274` | 18,057 | ~4,514 (header claims 3,500–4,000) | 5 |
| D | `PTAH_MCP_MANDATE_PROMPT` (same file) | `…/ptah-core-prompt.ts:292-356` | 5,693 | ~1,423 | 3 |
| D | Parent-side agent guidance | `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` | 24,269 | ~6,067 | 2 |
| E | `NATIVE_AGENT_TOOL_POLICY` | `cli-adapter.utils.ts:396-397` | 196 | ~49 | 0 |
| E | `TWO_WAY_MESSAGING_GUIDANCE` | `cli-adapter.utils.ts:424-429` | 826 (pinned by spec) | ~207 | 1 |
| E | `renderLaneCompletionContract` | `lane-reporting-contract.ts:30-64` | ~700 | ~175 | 0 (the one anti-cost text) |

Measured per-spawn fixed block (`buildTaskPrompt`, `cli-adapter.utils.ts:471-525`): 16–24 KB ≈ 4,000–6,000 tokens before the task text. At 68 requests/session that is 270k–410k input tokens per session before any work.

## 2. Cost-raising directives by driver

### Driver 1 — Polling
- "Spawn → Poll → Read" stated verbatim in 12 agent files (`backend-developer.md:85` and the same line in code-logic-reviewer:68, code-style-reviewer:68, devops-engineer:85, frontend-developer:85, modernization-detector:68, project-manager:103, researcher-expert:68, senior-tester:85, software-architect:85, technical-content-writer:68, video-director:85).
- `.claude/skills/fleet-orchestration/SKILL.md:143-147` "poll `ptah_agent_status` until not running", `:153` "Poll until done."
- `ptah-core-prompt.ts:125-128` teaches Spawn → Poll → Read, never mentions the push signal.
- `.claude/skills/agent-lanes/SKILL.md:106-107` "every ~8s".
- `.claude/skills/tribunal/references/council.md:55` "Poll and read all critiques."
- No surface says what to do while a long shell command runs (background + one completion check).

### Driver 2 — Large shell output
- No surface states an output-size cap, truncation rule, quiet/reporter flag, or tail-the-log rule (exhaustive grep).
- Unscoped verification mandates: `orchestration/SKILL.md:76`, `agent-lanes/SKILL.md:154`, `tribunal/references/crucible.md:151` ("relay the real failure output"), `execute-phase-gated-task/SKILL.md:18,31`, `backend-developer.md:171-173` (+frontend, devops), `senior-tester.md:148`.
- `ptah-core-prompt.ts:84,321` routes agents to raw build/test commands with no guard.

### Driver 3 — No context hygiene
- Zero occurrences of "compact", "context window", "token budget" in agents or focus skills.
- Whole-file/whole-set read mandates: `team-leader.md:285`, `execute-phase-gated-task/SKILL.md:8,14`, `agent-lanes/SKILL.md:145`, `code-logic-reviewer.md:296`, `code-style-reviewer.md:288`, `backend-developer.md:119-120` (×13).

### Driver 4 — Spawn baseline
- `renderRoleBlock` (`cli-adapter.utils.ts:446-458`) emits the full body on every spawn and resume.
- `getProjectGuidanceContent` (`libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:710-720`) returns an unbounded substring prepended to every spawn.
- `ptah-core-prompt.ts` is 13–29% over its own stated budget; the MCP table appears twice (55-135 and 298-350) and a third near-copy sits in `ptah-system-prompt.constant.ts:19-78`.
- `ptah-system-prompt.constant.ts` ships ~24 KB of per-tool signatures into every parent session.

### Driver 5 — Long lanes
- "Implement every task in the batch" (`backend-developer.md:112-113`, frontend, devops); no batch size cap in `team-leader.md:143-271`, `fleet-orchestration/SKILL.md:64-76`, `orchestration/references/lane-assignment.md:66`.
- Default lane timeout one hour with no maximum (`agent-lanes/SKILL.md:48`).

## 3. Duplication across the 15 agent files

| Block | Bytes/copy | Files | Total | Removable |
|---|---|---|---|---|
| `## Tooling precedence` | 1,150 | 15/15 | 17,250 | 16,100 |
| `## Task specs (.ptah/specs/)` | 1,084 / 2,276 | 15/15 | 18,644 | 16,368 |
| `## Clarifications: return them, do not ask` | ~985 | 15/15 | 14,775 | 13,790 |
| `## Replace, do not accumulate` | 819 | 9/15 | 7,371 | 6,552 |
| `## Delegating to CLI agents` | 1,196 | 12/15 | 14,352 | 13,156 |
| Total | | | 72,392 (35.9%) | 65,966 |

Plus `## Reviewer stance` ~1,480 B ×3. `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/*` is byte-identical to `.claude/skills/*`. `.codex/agents/*.toml` mirrors the agent bodies and must be regenerated after edits.

## 4. Existing efficiency rules (do not duplicate)

- No-poll push signal: `agent-lanes/SKILL.md:91-95`, `ptah-system-prompt.constant.ts:233-237,267`.
- 3-lane concurrency cap; 2-round revise cap; cost announced before spending (`agent-lanes:182-185`).
- "Load references on demand, never all at once" (`orchestration/SKILL.md:82`).
- Prefer AST/summary tools over whole-file Read (`ptah-core-prompt.ts:72-73`, `ptah-system-prompt.constant.ts:48`).
- `ptah_get_diagnostics` once after edits (`ptah-core-prompt.ts:65,111`); one AskUserQuestion per task (`:164`).
- `nx run-many -t test -p <projects>` rule (`fleet-orchestration/SKILL.md:110-120`).
- `renderLaneCompletionContract` report-instead-of-read design.

## 5. Recommended edits, ranked by impact

- R1 Compress the shared agent preamble (in place, so Claude-native subagents stay self-contained) from ~4.8 KB to ≤1.2 KB per file; regenerate `.codex/agents/*.toml`.
- R2 Add a shell-output policy to `NATIVE_AGENT_TOOL_POLICY` (`cli-adapter.utils.ts:396`): reaches every lane on every vendor.
- R3 Add a long-command policy (background + one completion check, no wait loops), respecting the 8,191-byte argv limit.
- R4 Rewrite every surface that teaches polling (`ptah-core-prompt.ts:125-128`, `fleet-orchestration:143-153`, `agent-lanes:106-107`, agent files line ~85).
- R5 Cap `getProjectGuidanceContent` at ~4,000 bytes.
- R6 "Run only the projects you changed, with `-p`, never workspace-wide" in every verification directive.
- R7 Trim `ptah-system-prompt.constant.ts` (move browser/corpus namespaces behind lazy references).
- R8 De-duplicate the MCP table in `ptah-core-prompt.ts` and bring it under its stated budget.
- R9 Batch size cap in `team-leader.md` decomposition and `fleet-orchestration`.
- R10 Concrete per-lane cost model (requests × context), tool-call ceiling, and a shorter default timeout in `agent-lanes` §8.
- R11 (deferred) Stop committing the byte-identical plugin copy of `.claude/skills`; generate at package time.
