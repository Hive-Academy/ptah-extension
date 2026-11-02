## Changes

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:607-609` — unroutable `present` returns after the `requested` publish when `pending` no longer holds that wire id. A publisher that settles the prompt inside `requested` (`handlePermissionResponse` or `dismiss`) no longer reaches the `PERMISSION_REQUEST` broadcast. The deny timer (`:610-619`) is armed only when the entry is still pending. The routable UUID branch has no lifecycle publish and is unchanged.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:1400-1407` and `:1420-1426` — `answers once when publication resolves the prompt reentrantly` asserts no `PERMISSION_REQUEST` broadcast for the settled id, one native accept, and one `resolved` event, including after the deny window.

## Not done

- Finding 2 (teardown must go through `CodexChatAdapter.close` → `sink.dispose`) was left unchanged. The coordinator decided that chain is covered link by link.
- No test, lint, typecheck, build, Nx command, or `ptah_get_diagnostics` was run. The lane forbids those checks.
- No connected MCP server is named `ptah`, so `ptah_agent_report` was not called. No skill applies to this host-port control-flow fix; none was loaded.
