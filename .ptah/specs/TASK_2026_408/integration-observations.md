# TASK_2026_408 Batch 9 — SDK/CLI/Proxy Integration Observations

Spec: `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts`

REAL: pinned `@anthropic-ai/claude-agent-sdk` 0.3.278 `query()` in a child
`node --input-type=module` process, spawning the SDK's own real platform CLI
binary (no `spawnClaudeCodeProcess` override); the real `CodexTranslationProxy`
running in-process on a loopback port.

MOCKED: the upstream Responses API — a plain `http` server, scripted by
inspecting request content, never call order (except S6's inherently
sequential, isolated-server case). Any unrecognised ("side query") request
gets a plain-text `ok` rather than an error, so the CLI's own housekeeping
requests never break a scenario.

Isolation: fresh temp `HOME`/`USERPROFILE`/`CLAUDE_CONFIG_DIR` per scenario,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_AUTOUPDATER=1`,
`settingSources: ['project','local']`, project `.claude/skills/fixture-skill`
and `.claude/commands/fixture-cmd.md` fixtures. Env passed to the child is an
explicit allowlist (not `process.env` minus a denylist) — see code comment at
`ALLOWED_HOST_ENV_KEYS` for why (an ambient coding-session env var wholesale
copy previously hung the CLI for 280s+ with zero upstream traffic).

Limits applied this run (previous run took too long):
- Per-scenario jest timeout: 90s (`SCENARIO_TIMEOUT_MS`).
- Child CLI process hard-kill: 75s (`CHILD_HARD_KILL_MS`), so no scenario can
  hang the whole suite. Revision round 2 lowered this to **55 s**. The timeout
  cleanup is bounded at 22 s: descendant discovery 10 s, tree kill 4 s, exit
  wait 4 s and survivor poll 4 s. The spec checks at load time that the hard
  kill plus cleanup is at most 90 s minus a 10 s margin.
  - The cleanup fails loudly if descendants cannot be enumerated, if the tree
    kill reports an error, or if any process is still alive.
  - The tree-kill test always kills its wrapper and grandchild in `finally`.

## Batch 11 revision (review `code-logic-review-b9-b11.md`, F1–F5)

The per-scenario notes below are the Batch 9 observations. Where the harness
changed, the assertions are now:
- **Scripting (F2):** every scenario is scripted by content only.
  - A scenario's tool call is issued only for a request whose *user* message
    carries its marker (`S1-MARKER`, `S4-MARKER`, `S5-MARKER`) and, for
    S1/S5, whose `tools[]` holds the expected tool.
  - The follow-up is recognised by a structured `function_call_output` with
    the scenario's call id.
  - Everything else, including all CLI housekeeping, gets `ok`.
  - S2 no longer reads `requests[0]`.
  - Line 10's "never call order" claim is now true for S1–S5 (S6 was already
    content-scripted).
- **Structured assertions (F3):** the recorded request is parsed.
  - **S1:** the replayed `function_call` has name `Skill` and exactly the
    arguments sent. A `function_call_output` carries the same call id. The
    substituted skill body `SKILL-MARKER-7f3 args=alpha beta` appears outside
    the `function_call` item, which proves `$ARGUMENTS` substitution. The
    final result is `success` and contains `S1-DONE`.
  - **S4:** the replayed call is named `NoSuchTool`. The paired
    `function_call_output.output` is a string starting `Error:` and containing
    `No such tool available`.
  - **S5:** the alias, never the raw name, is in `tools[]`. The replayed
    `function_call` uses the alias with `{"value":"42"}`. The paired output is
    an array containing exactly
    `{type:'input_image', image_url:'data:image/png;base64,<fixture PNG>'}`.
- **S3 pinned (F4):** there is no local `Unknown command` rejection, and a user
  message carries `/no-such-cmd x` literally, with a `success` result. A CLI
  change to local rejection now fails the test and must be re-decided at the
  SDK upgrade.
- **Zod (F1):** the child imports Zod by absolute URL, resolved from the pinned
  SDK's own location (`createRequire(sdk.mjs)`). The spec throws unless it
  resolves inside the real path of this checkout's `node_modules`.
  - This worktree's `node_modules` is a symlink to
    `<main checkout>/node_modules`, so that is where it resolves.
  - A bare `import("zod")` from the temp script had resolved to a user-profile
    install (`%USERPROFILE%\node_modules`).
- **Cleanup (F5):**
  - **Fixture location:** all fixtures (scenario dirs, child scripts, and the
    child's `TEMP`/`TMP`/`TMPDIR`) live under one `mkdtemp`
    `%TEMP%\ptah-sdk-int-*` suite root.
  - **Removal:** each scenario's teardown removes its own directory, even on
    failure, and `afterAll` removes the suite root.
  - **Timeout:** on timeout the child's descendants are listed from the OS
    process table and the tree is killed with the platform-core
    `killProcessTree` (Windows `taskkill /T /F`, POSIX process group). The
    wrapper's exit is awaited, and the test fails loudly, listing the PIDs, if
    any recorded process is still alive.
  - **Mock upstream:** closing it is bounded (`closeAllConnections` after 2 s).
  - **Test:** a dedicated test proves the tree kill on a node wrapper with a
    long-lived grandchild.
  - **Result:** after the new runs, the count of leftover `%TEMP%\ptah-sdk-int-*`
    dirs stayed at 96. Those 96 dirs and 4 `ptah-sdk-integration-*.mjs`
    scripts are Batch 9 leftovers, dated 21:53–23:10 on 2026-09-26. They were
    not deleted in this pass.
- **Stray `%TEMP%\.claude`:** NOT from this spec,
  so it was not deleted.
  - It was created at 17:09:54 and holds only empty `commands\` and `skills\`
    folders.
  - This spec's fixtures are written under a scenario `project\.claude`, with
    `skills\fixture-skill\SKILL.md` and `commands\fixture-cmd.md`, and none of
    its markers appear in the stray folder.
  - This spec's earliest temp artefact is from 21:53, 4 h 44 min after the
    stray folder was created.

## Per-scenario results

### S1 — Skill with args (REAL CLI + REAL proxy, MOCKED upstream)
- Observed: real CLI declared a `Skill` tool on turn 1; upstream scripted a
  `function_call` invoking `Skill` with `{skill: 'fixture-skill', args: 'alpha
  beta'}`-shaped args (derived from the tool's own declared schema). Turn 2
  upstream body contained `SKILL-MARKER-7f3`, `alpha beta`, and the call id —
  i.e. the real CLI ran the fixture skill file and forwarded its output.
- Final result: `type: result`, `subtype: success`.
- Upstream request count: 2 (>= 2 asserted).
- Mocked vs real: CLI/SDK/proxy real; upstream mocked.
- Result: PASS.

### S2 — `/fixture-cmd hello world` (REAL CLI)
- Observed: the real CLI expanded the slash command locally before ever
  contacting upstream — turn-1 body contained `CMD-MARKER-91c hello world`
  (the fixture command file's content with `$ARGUMENTS` substituted).
- Upstream request count: 1 (>= 1 asserted).
- Result: PASS.

### S3 — unknown slash command `/no-such-cmd x` (Assumption A3, OBSERVED)
- Observed behaviour actually pinned by this run: the real CLI does **not**
  silently expand `/no-such-cmd x` into the known `fixture-cmd` body (no
  upstream body ever contains `CMD-MARKER-91c` with a substituted argument —
  only the raw catalog listing with the literal `$ARGUMENTS` placeholder, if
  present at all, is tolerated).
- The transcript did not contain a local "Unknown command" rejection message
  in this run, so the OBSERVED branch taken was: the literal `/no-such-cmd x`
  text was forwarded upstream as ordinary user content, rather than rejected
  client-side. The test asserts exactly this (not the alternative "local
  rejection" branch), i.e. A3 = "forwarded literally", not "silently
  expanded" and not "locally rejected" in this SDK/CLI version.
- Result: PASS.

### S4 — unknown tool call → "No such tool available" (REAL CLI)
- Observed: upstream scripted a `function_call` for a hallucinated
  `NoSuchTool`; the real CLI rejected it itself and reported the failure back
  upstream on the next turn as a tool result whose `output` field is exactly
  `Error: ...No such tool available...` (regex-matched: starts with `Error:`,
  contains the literal phrase `No such tool available`).
- Upstream request count: 2 (>= 2 asserted).
- Result: PASS.

### S5 — long MCP tool name round-trip (Assumption A5-adjacent aliasing, REAL CLI)
- Server/tool names chosen so the raw `mcp__<server>__<tool>` name exceeds 64
  chars.
- Observed: upstream's turn-1 `tools[]` never sees the raw concatenation —
  only some CLI-generated alias (asserted `!==` the raw form). The scripted
  `function_call` uses that same alias; the real SDK routed it to the actual
  in-process MCP tool handler (`mcpCalls` in the child equalled
  `[{ value: '42' }]`, proving the handler received the real args, not just
  an echo). Turn 2 upstream body contains the alias again (replay reuses the
  same alias) and contains `input_image` — i.e. the tool's returned base64
  PNG image content was translated to Codex's `input_image` content-part
  shape before being sent upstream.
- Upstream request count: 2 (>= 2 asserted).
- Result: PASS.

### S6a — overflow, plain HTTP 400 `context_length_exceeded` JSON (Assumption A5)
- Two-run child: a large seed prompt (`S6-SEED-1` + 4000-char filler) followed
  by a `resume`d target prompt (`S6-TARGET`) against the same session.
- Observed: **A5 HOLDS for this variant.** The real CLI, on hitting the
  scripted HTTP 400 `context_length_exceeded` on the target turn, triggered
  its own reactive compaction: it issued a follow-up upstream request
  containing the seed content but not the target prompt (summarisation turn,
  answered with `Summary of prior turns: S6-SUMMARY`), then re-issued the
  target turn with the summary in place of the seed
  (`compact_metadata.trigger === 'auto'`, `compact_boundary` message present
  at index > 0). Final result: `type: result`, `subtype: success`,
  `result` contains `S6-DONE`. All three scripted upstream roles were hit
  exactly once each, in order.
- Upstream request count: 3 for the target run's own server instance (seed
  turn(s) use the same server but are scoped by content markers, not order).
- Run time contribution: a few seconds (fast cold start once warm).
- Result: PASS.

### S6b — overflow, streamed `response.failed` split across two raw chunks — **PASS after Batch 11**

#### Batch 11 re-run (current state)
- Root cause of the earlier failure was in the proxy, not the CLI's SSE
  parser: the Responses streaming handler wrote `200` SSE headers and
  `message_start` before reading any upstream event, so an overflow arriving
  as the first event could only leave as an SSE `event: error`. The real CLI
  retries an SSE error (`api_retry`) and only compacts on an HTTP 400
  prompt-too-long.
- Fix: the streaming handler now defers headers and `message_start` until the
  first client-visible output (a content block or a successful terminal). An
  error terminal that comes first leaves as a plain HTTP error with the same
  mapping as the non-stream paths; here, HTTP 400 `invalid_request_error`
  `prompt is too long: ...`.
- Observed (2 consecutive runs, split-chunk delivery kept): the real CLI
  compacted exactly as in S6a. It sent the summarisation turn, then the target
  turn again with the summary. `compact_boundary` was present with
  `compact_metadata.trigger === 'auto'` at index > 0, and the final message
  was `type: result`, `subtype: success`, `result` containing `S6-DONE`. Both
  scripted follow-up roles were hit. There was no `api_retry` loop and no
  hard-kill.
- S6a and S6b are now one `describe.each` table with identical, strict
  assertions: compaction is REQUIRED. The earlier S6a fallback, which also
  accepted plain prompt-too-long propagation, was removed. The child hard-kill
  stayed at 75 s here; revision round 2 later lowered it to 55 s.
- Documented limit (not covered by an integration scenario): a
  `response.failed` that arrives AFTER output has started still leaves as the
  stream's single SSE `error` terminal, because headers are already sent. The
  real CLI treats that as retryable and does not compact. The unit spec
  `keeps an overflow that follows output as the single SSE error terminal`
  pins this behaviour. The optional S6c scenario was not added, because an SSE
  error after output enters the CLI's retry/backoff loop and would not surface
  promptly within budget.

#### Original Batch 9 observation (superseded)
- Same two-run shape, but the overflow signal is delivered as a real SSE
  `response.failed` event whose *raw bytes* are split into two separate
  `res.write()` calls at the halfway point of the wire string (simulating a
  TCP chunk boundary landing mid-event, not on an SSE `\n\n` boundary).
- Observed: the real CLI did **not** propagate a clean error and did **not**
  reach `compact_boundary` within the 75s child hard-kill budget. Its stderr
  trace showed `MSG system init` followed by seven consecutive
  `MSG system api_retry` lines with no further progress — i.e. the real CLI
  entered a retry loop against the mocked upstream and never resolved the
  target turn. This was reproduced once at the original 100s child timeout
  (same symptom, same message pattern) before the timeout was tightened to
  75s per the new budget.
- Given the ~30-minute total budget and per-scenario limits, root-causing
  whether this is (a) a genuine CLI defect in parsing a `response.failed`
  event whose bytes are split off an SSE boundary, or (b) the mock server
  producing a wire that is not a legal representation of how a real
  chunked-transfer HTTP/1.1 or HTTP/2 response would ever actually be
  delivered to the CLI's HTTP client (the split point does not respect any
  chunk-transfer-encoding framing, only the SSE payload string), was out of
  scope for this pass.
- This describe block is intentionally renamed to end in
  `(NOT PROVEN: ...)` and its single test asserts only what was reliably
  observed: that the suite itself stays bounded (the child is hard-killed at
  `CHILD_HARD_KILL_MS` and the stderr trace contains `api_retry`), not that
  compaction happens and not that a clean error propagates. It is never
  silently skipped.
- Gap recorded for follow-up: confirm against a real (non-mocked) upstream,
  or against a mock that fragments strictly on `res.write()` calls aligned to
  SSE line boundaries, whether the real CLI's SSE parser can recover an event
  whose `data: {...}` payload spans two `write()` calls at all, and if not,
  whether that is worth a defect report against the CLI/SDK's stream parser
  (this spec's `startMockUpstream` framing utility is a plausible, if
  unusual, adversarial split — not obviously invalid).

## Defects Found

Batch 9 recorded none. The S6b open question turned out to be a defect in
Ptah's own proxy, not in the CLI. Batch 11 fixed it in
`translation-proxy-base.ts` / `responses-stream-translator.ts`: an error-first
streamed terminal used to be sent as an SSE error on an already-open 200
stream. The split-chunk delivery was never the cause.

## Execution summary

- Command: `npx jest -c libs/backend/auth-providers/jest.config.ts
  libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts`
- Result: 7 passed, 0 failed, 0 skipped (Batch 11: 2 runs, 103 s and 94 s,
  S6a and S6b both with required auto-compaction). Batch 11 revision: 9 tests
  (7 scenarios, the fixture-root check and the tree-kill check). The standalone
  run gave 8/8 (92 s) before the tree-kill test was added; the tree-kill test
  alone passed (34 s); the full suite passed inside the nx test gate.
- Total run time (Batch 9): ~142–157s across repeated runs in this session (well under
  the 30-minute work budget; no single run exceeded 5 minutes).
- `npx prettier --check` on the spec: initially failed (pre-existing
  formatting drift from source edits), fixed with `npx prettier --write`
  (formatting only, no behavioural change), re-verified clean.
