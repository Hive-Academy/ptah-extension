# Task Context - TASK_2026_579_f2e2

## Evidence

`%APPDATA%\Ptah\logs\Ptah Electron-2026-09-30.log`:

- 12:56Z–12:59Z: about 20 requests through `[CodexProxy]`, each `Rate limited by Codex Responses API`, then
  `curation pass stalled before dispatch ... reason: provider-unreachable, providerId: openai-codex`.
- 13:18Z: user clicked Run now. Same pattern. 13:21Z: `memory:runNow` slow handler, `durationMs: 202290.6`,
  `runNow — pass stalled before dispatch; nothing was consumed`.
- 13:33Z: `Provider quota exhausted; retrying in about 3 min` → `reason: provider-cooling-down`.
- `observation_queue`: 70,773 rows, 23,710 unprocessed.

The stall-safe behavior is correct: nothing was consumed or lost. The defect is that curation depends on
one provider.

## Code

- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:231-249` resolves
  one `curatorProviderId` and returns `cooling-down` on quota errors.
- `libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts` feeds unreachable outcomes to
  the back-off.
- `libs/backend/agent-sdk/src/lib/internal-query/network-backoff.ts`.
- The skill enhancer uses the same resolution (`libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`).

## Scope

1. An ordered fallback list of curator providers (setting), default: configured provider, then the active
   chat provider. Only providers with usable auth are tried.
2. On `cooling-down` or `provider-unreachable`, try the next provider in the same pass before stalling.
   Record which provider served the pass.
   - Dedupe by provider identity. The configured provider and the active chat provider can be the same
     one. A provider that returned `cooling-down` or `provider-unreachable` is not tried again in the
     same pass. Skipping a duplicate does not skip the auth check: only providers with usable auth are
     tried.
   - Fallback retries the failed window, not the pass. Windows run in order and their drafts stay in
     memory (`libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts:186-237`).
     Nothing is written to SQLite until every window and the resolve call are done
     (`libs/backend/memory-curator/src/lib/memory-curator.service.ts:670-709`). So the next provider
     starts at the first window that did not complete, and the drafts already extracted are kept.
     Today a stall drops them (`curator-window-runner.ts:218`).
   - The curator query is not side-effect free. It runs with the `claude_code` tool preset and
     `bypassPermissions` (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:456-463`),
     plus the Ptah MCP server (`sdk-internal-query.curator-llm.ts:424`), for up to `CURATOR_MAX_TURNS`
     (6) turns (`:204`, `:429`). A window can call Write, Edit or Bash before the provider fails.
   - `cooling-down` is decided before dispatch (`sdk-internal-query.curator-llm.ts:403-414`). No tool ran,
     so fallback is always allowed.
   - `provider-unreachable` is decided after the stream (`:495-501`). Fallback is allowed only when the
     failed run completed no mutating tool call. A read-only tool (for example Read, Grep, Glob,
     `ptah_memory_search`) does not block fallback. Any other tool counts as mutating and not
     idempotent, and the pass stalls without replaying the window. The `unreachable` outcome must carry
     the tool names it saw; today it carries only the signal (`:501`).
3. Detect a 429 early: a rate-limited response must end the attempt on that provider instead of retrying
   for minutes inside the proxy.
4. Show the serving provider and the cooling-down providers in memory diagnostics.

## Acceptance criteria

1. A spec: primary provider returns a quota error, the fallback provider serves the pass, and observations
   are consumed.
2. A spec: all providers fail, the pass stalls, and nothing is consumed (current guarantee kept).
3. A spec: the configured provider and the active chat provider are the same identity. It returns a quota
   error once, it is not tried a second time, and the pass stalls.
4. A spec for the fallback rule: (a) window 2 of 3 returns `cooling-down`, the fallback serves windows 2
   and 3, window 1 is not re-sent, and its drafts are kept; (b) `provider-unreachable` after only
   read-only tool calls falls back; (c) `provider-unreachable` after a Write or Bash call stalls and does
   not call the fallback provider.
5. A manual Run now with a rate-limited primary finishes in less than 30 s on the fallback.
