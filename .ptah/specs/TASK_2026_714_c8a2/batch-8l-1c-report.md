# Batch 8l-1c report — Ptah MCP attached natively to Codex chat

Written 2026-10-28 by the team-leader (session 20). W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`.

## Result

COMPLETE, commit `b959b58d9` (`feat(cli-agent-runtime,rpc-handlers): attach Ptah MCP to Codex chat (8l-1c)`).

## Executor

In-process `backend-developer` subagents (Claude), not a CLI lane. Subagent reason: the
team-leader ran the round alone (lane completion signals route to the coordinator, which was not
relaying in this round), and the batch was small and sequential. Review family for the P8
re-review: implementer Claude, so the coordinator's P8 re-review should use a different family
where available (or record the same-family exception).

`git status` after each subagent: only the declared files.

## Files

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url.ts`: new
  `ptahMcpSessionUrl(port, routingId, cwd)` ->
  `http://localhost:{port}/session/{enc(routingId)}/workspace/{enc(cwd)}` (empty cwd omits the
  workspace segment; empty/whitespace routing id throws). Sibling of `ptahMcpServerUrl` (DL4).
- `.../cli-adapters/ptah-mcp-url.spec.ts`: Windows path encoding, routing-id encoding, empty cwd,
  empty and whitespace routing id throw.
- `.../cli-adapters/index.ts`: exports `ptahMcpSessionUrl` and `CODEX_PTAH_TOOL_TIMEOUT_SEC`
  (reaches the lib public index through `lib/cli-agents/index.ts` -> `src/index.ts`).
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts`: the
  "Ptah MCP is not attached" log is removed. When `input.mcpServerRunning === true` the profile
  gets one `ptah` http server (session URL from the live `PTAH_MCP_PORT`, cwd,
  `headerReferences: {}`, `toolTimeoutSec` 960). Routing id = non-empty `tabId`, else the session
  id (Claude parity). MCP running with no routing id -> coded `CodexChatRoutingError`
  (`ptah-mcp-routing-id-missing`) before provider resolution; never attached anonymously. The
  user-server log and the D6 strip stay for 8l-2.
- `.../codex-chat-host-ports.spec.ts`: notice spec updated (no info log; `['ptah']` / `[]`);
  new: new session by tab id (exact entry, 960), not running / absent -> no server, resume
  without tab id uses the session id, resume under a NEW tab id still resumes with an unchanged
  fingerprint (DL3), missing routing id -> coded error, no provider resolution.
- `.../codex-chat-native-contract.spec.ts`: jest mock of `@ptah-extension/cli-agent-runtime`
  with the two real leaf modules (the full barrel pulls workspace-intelligence's ESM-only
  `wasm-bundle-dir.ts` under Jest; the first verify failed with "Test suite failed to run").

## Dependency direction

rpc-handlers already depends on cli-agent-runtime (package.json, other rpc-handlers imports);
cli-agent-runtime does not import rpc-handlers. `PTAH_MCP_PORT` comes from
`@ptah-extension/agent-sdk` (live `let` binding read at `profile()` time).

## Verify

`npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers`
- Run 1: 6 tasks, 5 succeeded, rpc-handlers:test failed (native-contract suite did not load;
  187/188 suites passed).
- Run 2 after the spec mock: `NX 6 tasks: 6 succeeded, 3 cached`, EXIT 0 (6 tasks = lint, test,
  typecheck x 2 projects, as requested).

## Risks carried

- The App Server applying thread `config` dotted keys is still UNPROVEN (coordinator probe).
- A new native session always has a tab id in practice (`codex-chat-adapter.ts:249` refuses an
  open with neither tab id nor resume id); the coded error is a backstop.
