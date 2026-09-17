# TASK_2026_466 — Batch 8 follow-up defects

Source: `TASK_2026_402_a5c7/test-report.md` (live run 2026-09-17, Electron, `main` at `63feb0881`).
TASK_2026_402 is closed as `done`; these defects carry its remaining acceptance gaps.

## Defects

1. **Peer message to a busy ptah-cli lane is not surfaced (Req 1.1).**
   `SendMessage` to `ptah-ptah-extension-ollama-cloud-7d6e89` returned `success: true`
   (msg `cb8ff828-5d26-4553-a8cb-4537f4890f2d`) while the lane was busy. The lane ran further
   tool rounds and reported `INBOUND: none`, then completed. Find where the inbound peer turn
   is dropped or held (cross-session inbound setting on ptah-cli spawns, prompt mailbox,
   end-of-turn handling).
2. **Registry name not unique across a restart of the same tab (Req 2.2).**
   Live pids 2368 and 17564 both registered `ptah-ptah-extension-clear-merged-worktrees-and-tasks-03497c`
   (`ListAgents` refs `[a4f121]` and `[3b8865]`). The suffix must differ per live process, or the
   old process must release the name.
3. **Report rendered twice.** A `ptah_agent_report` with `summary === message` shows the text
   twice in the parent chat (`<agent-report agent="ollama cloud">`). Render `summary` only when it
   adds information.
4. **`mcp-serve` needs no model auth to list tools.** `node dist/apps/ptah-cli/main.mjs mcp-serve`
   exits with `[ptah-mcp] fatal: No Anthropic API key configured.` before answering `tools/list`.
   Tool listing (and tools that do not call a model) should work without a provider key, or the
   failure must be a JSON-RPC error, not a fatal exit.
5. **Turns concatenated on the agent tile.** The codex tile shows
   `STEP2: doneQUEUED_ACK: codex received the queued message` — the queued turn's text is joined to
   the previous turn with no separator.

## Acceptance criteria

1. A peer message sent to a busy ptah-cli lane is visible to that lane by its next turn boundary.
2. Two live sessions never share a registry name.
3. A report whose `summary` equals `message` renders once.
4. `mcp-serve` answers `initialize` and `tools/list` (listing `ptah_agent_message` and
   `ptah_agent_report`) on a machine with no Anthropic API key.
5. Each agent turn on a tile is visually separated.
6. Re-run Batch 8 cases 1, 3 and 6 and append the results to this folder.
