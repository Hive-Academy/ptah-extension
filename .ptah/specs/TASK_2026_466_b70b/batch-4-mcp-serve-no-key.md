# Batch 4: `mcp-serve` lists tools without model provider credentials (TASK_2026_466)

## Cause

- **File & line**: `apps/ptah-cli/src/cli/commands/mcp-serve.ts:234` (now line 254) and `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:321-348`.
- **Trigger**: `ptah mcp-serve` invoked `withEngine(globals, { mode: 'full', requireSdk: true })`. When `requireSdk` was `true`, `withEngine` synchronously invoked `ctx.initializeSdk()`, which called `adapter.initialize()` via `initializeSdkAdapter(container)`. On a machine without an Anthropic API key (or other active provider credentials), `adapter.initialize()` returned `false` with `errorMessage: "No Anthropic API key configured. Add an API key in Settings, or switch to Claude CLI."`. `withEngine` then threw `SdkInitFailedError(message)`. In `mcp-serve.ts:417-421`, the top-level catch handler logged `[ptah-mcp] fatal: No Anthropic API key configured.` and exited the process with code 5 before ever reading stdin or answering JSON-RPC `initialize` or `tools/list` requests.

## Change

1. `apps/ptah-cli/src/cli/commands/mcp-serve.ts:20` & `254`:
   - Changed engine options from `{ mode: 'full', requireSdk: true }` to `{ mode: 'full', requireSdk: false }`.
   - Updated documentation comment explaining that bootstrap DI boots with `requireSdk: false` so that tool discovery and listing need no model credentials.
2. `apps/ptah-cli/src/cli/commands/mcp-serve.ts:207-223`:
   - Eagerly registered the `tools/list` JSON-RPC handler alongside `initialize` before `server.start(stdinReader, stdoutWriter)`. This ensures `tools/list` can answer immediately using the MVP tool definitions from `buildMcpMvpTools()` even before `withEngine` completes, and seamlessly delegates to `cachedServerService.handleToolsList()` once resolved.
3. `apps/ptah-cli/src/cli/commands/mcp-serve.ts:266-302` & `96-103`:
   - Created lazy `ensureSdk` initializer that defers `ctx.initializeSdk()` until model execution is actually needed.
   - Forwarded `ensureSdk` to `SessionSubmitService` and `hooks.sessionSubmitFactory`.
4. `apps/ptah-cli/src/services/mcp/session-submit.service.ts:123-132` & `350-362`:
   - Added `ensureSdk` to `SessionSubmitServiceDeps`.
   - In `SessionSubmitService.execute()`, invoked `ensureSdk()` at the point of actual model use before setting up in-flight event listeners or calling `chat:start`. If SDK initialization fails (e.g. no Anthropic API key), it settles with an MCP `isError: true` result carrying `ptah_code: 'sdk_init_failed'` and the error message without fatal process exit.
5. `apps/ptah-cli/src/services/mcp/session-submit.service.spec.ts`:
   - Added unit tests verifying that `session_submit` fails with `sdk_init_failed` JSON-RPC MCP error without calling `chat:start` when SDK initialization fails, and proceeds to `chat:start` when `ensureSdk` succeeds.
6. `apps/ptah-cli/src/cli/commands/mcp-serve.spec.ts`:
   - Added unit test asserting that `mcp-serve` boots `withEngine` with `{ mode: 'full', requireSdk: false }`.

## Live proof

The lane left this section unrun. The orchestrator ran it on 2026-09-19.

Command, with every Anthropic credential removed from the environment:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_API_KEY \
    node dist/apps/ptah-cli/main.mjs mcp-serve
```

Observed:

```
[ptah-mcp] starting (session=01M2V5ZMWX1NVE8ZXJQJ3BXBP7, pid=40536, version=0.1.0)
[ptah-mcp] ready (tools=mvp:8)
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"ptah","version":"0.1.0"}}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[ ... 8 tools ... ]}}
[ptah-mcp] shut down (exit=0)
```

The eight tools include `agent_message` and `agent_report`. No fatal exit, exit code 0.

**Limit of this proof.** It shows the new path answers with no credential in the
environment. It does not re-prove that the old path failed on this machine, because
this machine also carries provider settings in `~/.ptah/settings.json`. The original
failure is evidenced by the 2026-09-17 log in `context.md`.

## Tests

Run by the orchestrator, not by the lane:

```
npx nx run-many -t test -p ptah-cli @ptah-extension/cli-agent-runtime @ptah-extension/platform-electron @ptah-extension/agent-sdk

Test Suites: 2 skipped, 111 passed, 111 of 113 total   (agent-sdk)
Tests:       3 skipped, 1984 passed, 1987 total
Test Suites: 62 passed, 62 total                        (cli-agent-runtime)
Tests:       1 skipped, 916 passed, 917 total
Test Suites: 2 skipped, 36 passed, 36 of 38 total       (platform-electron)
Tests:       4 skipped, 3 todo, 619 passed, 626 total
Test Suites: 1 skipped, 67 passed, 67 of 68 total       (ptah-cli)
Tests:       3 skipped, 1018 passed, 1021 total

NX   Successfully ran target test for 4 projects and 32 tasks they depend on
```

## Revision 1 — review findings, applied by the orchestrator

`batch-4-review.md` returned `accept with fixes` with three findings.

### Finding 1 (MEDIUM) — a failed SDK init was cached for the life of the process. FIXED.

`sdkInitPromise` was assigned once and returned on every later call, including
when it settled `{ initialized: false }`. A user who started `mcp-serve` with no
key, added one in Settings, and called `session_submit` again still got
`sdk_init_failed` until they restarted the server — which is the startup
coupling this batch exists to remove.

The promise is now cleared when the result is not `initialized`, so the next
call retries.

### Finding 2 (LOW) — `tools/list` registered twice, first registration's main branch unreachable. FIXED.

The eager handler carried a `cachedServerService !== null` branch that could
never run: while that handler is installed the field is still `null`, and by the
time it is set the later registration has replaced the handler. The branch read
as a fallback and did nothing.

The eager handler is now the `buildMcpMvpTools()` path alone, with a comment
saying why there is deliberately no service branch in it.

### Finding 3 (LOW) — `sdkReady` no longer meant what its name said. FIXED, by deleting it.

The reviewer proposed renaming it to `stdioReady` and judged the name to be the
defect rather than the logic. Tracing it further, the logic was dead too.

`sdkReady = true` ran at `:265`, inside the same `withEngine` callback that
registers `tools/call` at `:353`. The two are sequential, and nothing ever set
the flag back to `false`, so `if (!sdkReady)` was unreachable at registration
time and for the rest of the process. Renaming it would have preserved a
bootstrap guard that cannot fire.

The flag and its branch are gone. A `tools/call` made during the bootstrap
window finds no handler registered and gets the JSON-RPC method-not-found
answer, which is the truthful one — and is what it already got, because the
eager registrations were only ever `initialize` and `tools/list`. The comment
left in its place states that.
