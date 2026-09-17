# TASK_2026_402 — Batch 8 empirical acceptance run

Run: 2026-09-17, Electron host, `main` at `63feb0881`. Orchestrator session
`16434295-01ff-4e67-88ac-ae31be8f17c8` (pid 17564, registry ref `[3b8865]`).

Lanes installed: codex, antigravity, ptah-cli (ollama cloud, claude cli).
Not available: copilot (disabled), cursor, opencode, pi (not installed) — recorded as **untested**.

Agents used: codex `3f14fa9f-2515-4adb-9827-c1a40275c2b2`, ptah-cli (ollama cloud)
`7d6e89d7-6549-4899-b990-31fc1cc5d7a0`, antigravity `db593bbc-…` / `cb987454-…` (earlier the same day).

## Results

| # | Case | Result | Evidence |
|---|------|--------|----------|
| 1 | Peer session → Ptah CLI agent (`SendMessage`) | **FAIL (not observed)** | `SendMessage` to `ptah-ptah-extension-ollama-cloud-7d6e89` returned `success: true` (msg `cb8ff828-…`) while the lane was busy, before its 120 s shell step. The lane ran further tool rounds and reported `INBOUND: none`. The message was accepted but never surfaced to the model within the turn. |
| 2 | Child (bypass) → main chat | **PASS** | The ollama cloud lane's `SendMessage` to `…-03497c [3b8865]` arrived in the orchestrator as `<cross-session-message from-name="ptah-ptah-extension-ollama-cloud-7d6e89" from-mode="bypass">`. |
| 3 | Registry name role-plus-task, unique per session | **PARTIAL / FAIL on 2.2** | `~/.claude/sessions/17564.json`: `nameSource: "user"`, name `ptah-ptah-extension-clear-merged-worktrees-and-tasks-03497c`. Req 2.1 met. But live pid 2368 (`7d2539d1-…`, started ~11 min earlier, same tab) carries the **identical** name; `ListAgents` shows both as `[3b8865]` and `[a4f121]`. The suffix is not unique across a restart of the same tab, so a bare-name send is ambiguous (Req 2.2). Spawned lane name `ptah-ptah-extension-ollama-cloud-7d6e89` was unique. |
| 4 | `ptah_agent_message` mode matches `ptah_agent_list` | **PASS (3 vendors)** | codex: `queue-next-turn` vs `messaging: queue`; lane replied `QUEUED_ACK: codex received the queued message` as its next turn, then `completed` exit 0. ptah-cli (ollama cloud): `queue-next-turn` vs `queue`; `QUEUED_ACK: ollama cloud lane received the queued message`, `completed` exit 0. antigravity: `unsupported` vs `messaging: none`. claude cli (same ptah-cli adapter), copilot, cursor, opencode, pi: untested. |
| 5 | `ptah_agent_report` → parent chat and tile | **PASS (chat) / untested (tile)** | Both lanes got `Delivered: Yes`, `Parent Session: 16434295-…` (correct spawn-time parent). Both arrived in the orchestrator chat as `<agent-report agent-id=… agent=… cli=…>`. Defect: the ollama cloud report rendered its text twice because the lane passed the same text as `message` and `summary`. Tile: the codex tile shows "Reported to the spawning session: B8 report from codex lane" (user screenshot). |
| 6 | Tools on HTTP and stdio MCP surfaces | **PASS (HTTP) / BLOCKED (stdio)** | HTTP: both tools are listed and callable from this session and from both lanes. stdio: rebuilt `ptah-cli` (`npx nx build ptah-cli`, exit 0) and ran `node dist/apps/ptah-cli/main.mjs mcp-serve` with `initialize` + `tools/list`; the server exited before answering: `[ptah-mcp] fatal: No Anthropic API key configured.` Environment, not code — rerun with CLI auth configured. |

## Defects found

1. **Case 1** — inbound peer message to a busy ptah-cli lane was accepted but not seen by the lane within its turn.
2. **Case 3 / Req 2.2** — two live sessions from the same tab share one registry name (`…-03497c`).
3. **Case 5** — report body duplicated when `summary` equals `message`.
4. **Case 6** — `mcp-serve` fails fatally without an Anthropic API key even though it only needs to list tools.

## Other observations

- Codex agent records `491455dc-…` and `94010aa8-…` (TASK_2026_464) disappeared from `ptah_agent_status` ("Agent not found") shortly after completing, while agents from another session remained listed.
- ptah-cli lanes cannot run a foreground `Start-Sleep` in PowerShell (harness block); the lane fell back to Bash.

## Verdict

Batch 8 does **not** pass in full: cases 2 and 4 pass, 5 passes for chat delivery,
1 fails, 3 fails Req 2.2, 6 is blocked on stdio. The user closed TASK_2026_402 as
`done` and moved the open defects to TASK_2026_466_b70b.
