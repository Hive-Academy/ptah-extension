# Batch 4 review — `mcp-serve` without provider credentials

Reviewed by the orchestrator, not by a lane. The author is the only free lane on this
machine, and a lane never reviews its own work. Read line by line, plus the live
stdio run recorded in `batch-4-mcp-serve-no-key.md`.

## Verdict

`accept with fixes` — the change is correct and proved live. Three findings, all
non-blocking. Finding 1 should be fixed before merge.

## Findings

1. **A failed SDK initialization is cached for the life of the process.**
   `apps/ptah-cli/src/cli/commands/mcp-serve.ts:278-296`. `sdkInitPromise` is
   assigned once and returned on every later call, including when it settled with
   `{ initialized: false }`.
   Failure scenario: a user starts `mcp-serve` with no key, calls `session_submit`
   and gets `sdk_init_failed`, then adds a key in Settings. Every later
   `session_submit` in that process still returns `sdk_init_failed`, because the
   rejected promise is cached. The server must be restarted to recover, which is the
   startup coupling this batch set out to remove.
   Severity: **medium**. Fix: clear `sdkInitPromise` when the result is not
   `initialized`, so the next call retries.

2. **`tools/list` is registered twice, and the first registration's main branch is
   unreachable.** Registered eagerly at `mcp-serve.ts:207` and again at
   `mcp-serve.ts:338` after the transport starts. The later registration replaces
   the earlier one, so the `cachedServerService !== null` branch inside the eager
   handler at `mcp-serve.ts:209-212` can never run: while that handler is installed,
   `cachedServerService` is still `null`, and by the time it is set the handler has
   been replaced.
   Failure scenario: none at runtime. This is dead code that reads as a fallback and
   will mislead the next reader.
   Severity: **low**. Fix: reduce the eager handler to the `buildMcpMvpTools()` path
   alone, or drop the second registration.

3. **`sdkReady` no longer means what its name says.** `mcp-serve.ts:266` sets
   `sdkReady = true` immediately after the stdio server is constructed, which is now
   before any SDK adapter exists. The `tools/call` gate at `mcp-serve.ts:348` reads
   it and answers "still bootstrapping".
   Failure scenario: none. The gate wants "is the stdio surface up", and that is what
   the flag now holds. The name is the defect, not the logic.
   Severity: **low**. Fix: rename to `stdioReady`.

## Claims I verified

- **The fatal exit is gone and the tool list answers with no credential.** Ran the
  built binary over stdio with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and
  `CLAUDE_API_KEY` removed from the environment. `initialize` and `tools/list` both
  answered, eight tools including `agent_message` and `agent_report`, exit code 0.
  Transcript in `batch-4-mcp-serve-no-key.md`.
- **The credential check was moved, not deleted.** `SessionSubmitService.execute`
  calls `ensureSdk()` before `chat:start` and returns an MCP error result carrying
  `ptah_code: 'sdk_init_failed'` instead of exiting.
- **Tests pass.** `ptah-cli` 1018 passed, and the three sibling projects with it.

## Claims I could not verify

- **That the OLD binary fails on this machine.** This machine carries provider
  settings in `~/.ptah/settings.json`, so clearing the environment does not reproduce
  the original "no provider configured" state end to end. The original failure rests
  on the 2026-09-17 log quoted in `context.md`.
- **Whether the eight MVP tools are the complete intended stdio surface.** If the
  full `StdioMcpServerService` exposes more tools than `buildMcpMvpTools()`, a host
  that lists during the bootstrap window caches the short list and is never told it
  changed, because no `notifications/tools/list_changed` is emitted. The live run
  logged `ready (tools=mvp:8)` and returned eight, which is consistent with the MVP
  set being the whole surface, but I did not confirm that from the code.
