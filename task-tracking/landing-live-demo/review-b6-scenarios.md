# Review: B6 scenarios + real-session `orchestration` (on-send)

Reviewer: code-logic-reviewer (read-only; no builds, Jest or nx run). Evidence comes from a throwaway structural checker (`/tmp/chk.mjs`), greps, `generate-live-demo-types.mjs --check`, the evidence screenshots, and reading the runtime and frontend sources.

## Verdict: NEEDS_REVISION

The three synthetic scenarios (`tribunal-council`, `multi-agent`, `command-center`) are contract-clean and privacy-clean. `orchestration.json` is structurally valid but violates the "all data is synthetic" rule and ships visible placeholder and truncated text. `scripts/landing/session-to-scenario.mjs` hardcodes a real home path. The known visual defects are explained below. Their fixes come from reading code, not from a browser run, so each needs a re-run of `check-live-demo.mjs` plus a screenshot.

| Severity | Count |
| --- | --- |
| Blocker | 1 |
| Major | 5 |
| Minor | 6 |

## Contract checks (item 1): PASS for all four

Checked by script over `timeline`, `rpc` and `rpcCases`:

- Every `id` is UUID v4 (`11111111-1111-4111-8111-111111111111` style, plus the 2222/3333/4444 agent ids). No non-v4 UUID-shaped string was found.
- All timeline payloads carry `sessionId`. There is no `tabId` key anywhere, no `rpc:response` and no `batch`.
- `at` is ascending in all four files. There are no numeric timestamps outside `[timeBase, timeBase+86.4M]`.
- `turn_state` ordering:
  - tribunal-council: `generating` at 300, `message_start` at 700, last `message_complete` at 32300, `idle` at 32600.
  - multi-agent: `generating` at 300, `message_start` at 700, `message_complete` at 34800, `idle` at 35100.
  - orchestration: `generating` at 200, `message_start` at 500, `message_complete` at 39500 and 46000, `idle` at 46500.
  - command-center has no chat turn (Command Center view only), which is consistent.
- `bootMessages` is present in tribunal-council, multi-agent and command-center, each with a `switchView` carrying `sessionId`.
- orchestration has `start: { mode: "on-send" }` and deliberately no `bootMessages`. `replay-bridge.entry.ts` skips them for on-send.
- Observation: tribunal-council and multi-agent have nested `message_start`s (at 4600, 10700, 16800 and 27000 for tribunal; at 4000, 8300 and 27500 for multi-agent). They are closed in LIFO order before `idle`. This is acceptable because they are member and subagent messages, but it is the only place the "start then complete" pairing is not strictly sequential.

## Generated files (item 3): PASS

`node scripts/landing/generate-live-demo-types.mjs --check` exits 0 (no "Stale generated scenario" output). All five `*.scenario.generated.ts` files match the `JSON.stringify(json, null, 2)` template exactly.

## Findings

### BLOCKER

**B-1. `orchestration.json` carries real internal task, PR and path identifiers.**

- The plan's rule "All data is synthetic ... No real paths, names ... or private code" is violated. The B2 `privacy-scan.ts` does not detect any of this, so the green scan gives false assurance.
- File `libs/web/landing/src/lib/live-demo/scenarios/orchestration.json`, 21 lines match `plugin-session|FIX_PLUGIN|868`. JSON paths (index into `timeline`):
  - `[5].message.payload.event.toolInput.task`, `[6].payload.task`, `[29].payload.task`: "Revise round 1 for batch 3 of FIX_PLUGIN_SESSION_ROOT. The branch was rebased on origin/main; ..."
  - `[8]`, `[9]`, `[33]`: "FIX_PLUGIN_SESSION_ROOT (backend)"
  - `[17]`, `[19]`, `[41]`: "Defect (CodeRabbit, confirmed by the coordinator):"
  - `[22]`, `[23]`, `[45]`: "Review round 2 for FIX_PLUGIN_SESSION_ROOT (PR #868)"
  - `[18].payload.stdoutDelta`, `[27]`: "Root: /workspace/acme-app/.claude-worktrees/plugin-session-root"
  - `[10]`: "`resolveSessionFolder` ... policy-roots ... symlink regression" (real internal function names)
  - Lines 311-315 plus `start.prompt` (line 1272) and `title` (line 3): "plugin session notice / Orchestrated plugin review" (the real work subject)
  - `[11]`: real Claude tool-call id `toolu_01JYMVj5xzSaik91rixgtdk9`, and `taskId` "task-a379c9a5178f6519a" (line 508), the real subagent id.
  - `[7].payload.stdoutDelta`: "(model: k3.1-pro[1m])", a real provider and model string.
- Impact: the landing page exposes internal ticket codes, a PR number, review-bot names and code symbols from the real repo. Even if the repo is public, this is real session data rather than a demo fixture.
- Fix (data only, then regenerate):
  1. Replace the five `task` strings with synthetic text that is complete and short (under 100 chars, never cut mid-word). Apply the same text to the matching `toolInput.task`, `spawned.task`, `exited.task` and the `[29]/[33]/[38]/[41]/[45]` copies.
     - Kimi: "Fix the stale session notice and add a regression test."
     - Codex 1: "Harden the session folder resolver against symlinks."
     - Antigravity 1: "Confirm each finding is fixed and no new defect was added."
     - Codex 2: "Fix the read-only notice path and add focused specs."
     - Antigravity 2: "Read-only review of the final change set."
  2. Replace `.claude-worktrees/plugin-session-root` with `/workspace/acme-app`. Rewrite the `resolveSessionFolder` and `policy-roots` sentences generically ("I'll inspect the session folder code and add a regression test for symlinks.").
  3. Replace the tool-call id and task id with fake values (`toolu_demo_0001`, `task-demo-0001`), and replace `k3.1-pro[1m]` with `demo-model`.
  4. Change `title` to "PtahCode orchestrates a review" (see M-5). Optionally reword the prompt to avoid "plugin session notice" (for example "Review the session notice, delegate focused fixes to CLI agents, and get an independent visual review.").
  5. Change `scripts/landing/session-to-scenario.mjs` so these replacements are applied after sanitizing (see M-1), then run `generate-live-demo-types.mjs`.

### MAJOR

**M-1. `scripts/landing/session-to-scenario.mjs:10` hardcodes a real user and home path.**

- The default is `join(process.env.HOME, '.claude/projects/-home-amun-ptah-extension')`. It also reads `~/.ptah/state/sessions.sqlite`.
- Fix: make `--project-dir` required (throw the usage error if it is missing), and use `process.env.PTAH_STATE_DIR ?? join(HOME, '.ptah/state')`. If the script is meant to stay local-only, do not commit it. If it is committed, the default must not name a real user.
- The script's `--prompt` and `--title` also bypass the strict scan until the final `scanScenarioPrivacy`. That check is good, but the script needs a deny-list option (see B-1, which the scan misses) such as `--redact "FIX_PLUGIN_SESSION_ROOT=TASK-123"`.

**M-2. Visible placeholder text `[sanitized cli output]` and `[sanitized tool output]` in all four scenarios.**

- Counts: orchestration 21, tribunal-council 3 (tool `output` at lines 594, 781, 1017), multi-agent 4 (lines 585, 793, 811, 903), command-center 2 (lines 537, 579).
- These appear in `agent-monitor:output.segments[].content` and `tool_result.output`, which render in the lane output and tool panels. A visitor will see the literal sanitizer marker.
- Fix: replace each with synthetic readable text, for example "Checked 14 files, no issues." or "3 tests passed". Use `segments[].content` for the segment display. Keep `stdoutDelta` identical to it for consistency.

**M-3. Truncated mid-word strings in orchestration.**

- The converter slices with `.slice(0, 140)` and `.slice(0, 240)` (for example `session-to-scenario.mjs` segment content and task).
- Examples: `[5]` "...line n", `[8]` "...line nu", `[10]` "...symlink regressio", `[21]` stdoutDelta " will", `[22]` "do not edit source files and". These render in lane cards and chat.
- Fix: hand-edit to complete sentences as in B-1. In the script, truncate at a word boundary and append an ellipsis.

**M-4. Raw tool and log noise in orchestration lane output.**

- `[16]` "Usage: 12861 input, 592 output tokens", `[24]` "175 lines, 24655 bytes", `[26]` a raw JSON blob `{"parseStatus":"ok","errorNodeCount":0,...}`, `[18]` and `[27]` "## Workspace Analysis **Project Type:** nx-monorepo ... **Version:** 0".
- These are meaningless (or look like internal dumps) in a marketing replay.
- Fix: replace with short human lines such as "Read 6 files", "Wrote 2 files", "Ran focused tests: 18 passed".

**M-5. User-visible product naming ("PtahCode") is inconsistent in orchestration.**

- Check (5) result: `title` is "Orchestrated plugin review" (`orchestration.json:3`). The other three use "PtahCode ..." (`tribunal-council.json:3`, `multi-agent.json:3`, `command-center.json:3`).
- Fix: `"title": "PtahCode orchestrates a review"` (the converter default in `session-to-scenario.mjs` already uses this, so the committed JSON was overridden with `--title`).
- Note: in-app UI strings such as "Ptah" in the app header come from the webview itself and are out of scope here. Lane card labels "Kimi Code", "Codex" and "Antigravity" are third-party CLI names, which is correct.

### Known visual defects (item 4)

**V-1. User bubble rendered below the assistant block (orchestration, on-send).**

- Cause: not in the data but in the interaction of `scenario-loader.ts:58-63` and `replay-bridge.entry.ts`. Timeline timestamps are shifted once at load (`shiftRecordedTimes(entry.message, timeBase)` adds `Date.now()-timeBase` at load time). In on-send mode, playback starts only when the visitor presses Send, which can be many seconds after load. The optimistic user message gets `Date.now()` at send time, so it is later than every assistant `chunk.event.timestamp` (load time + `at`), and the transcript sorts the user bubble after the assistant block. The evidence screenshot `real-orchestration-end.png` shows the right order only because the Playwright run sent within about a second of load.
- The three synthetic scenarios do not hit this because their user prompt comes from `chat:resume` history events stamped exactly `timeBase`, which shifts to load time and is earlier than all timeline events.
- Exact fix (runtime, not data): in on-send mode, defer the timeline shift to the moment `engine.sent()` is called. In `scenario-loader.ts`, keep the unshifted `timeline` and `timeBase` on the returned scenario for on-send. In `PlaybackEngine.sent()` (`playback-engine.ts:65`), before `this.play()`, run `this.scenarioData.timeline = raw.timeline.map(e => ({ ...e, message: shiftRecordedTimes(e.message, timeBase, Date.now()) }))`. Add a spec: "on-send timeline timestamps are not earlier than the send time".
- Data-only workaround (weaker): none reliable, since the delay is unbounded.

**V-2. Tokens and Cost show "—" (orchestration, and the first third of tribunal-council and multi-agent).**

- Cause: the header and inspector read `tab.sessionStats`, which is installed only by a `session:stats` or `session:stats-live` (`tab-manager.service.ts` `installSessionStats`). The data supplies the first live snapshot too late:
  - `orchestration.json`: the only `session:stats-live` is at `at: 38000` (of 47000), so Tokens and Cost are "—" for 81% of the replay. The mid screenshot shows this.
  - `tribunal-council.json`: first stats-live at 15000, `multi-agent.json`: first at 17000. `command-center.json` is fine (first at 500).
  - In the end screenshot the lane rows (Antigravity, Codex, visual-reviewer) also show "—" for Tokens and Cost. The CLI lane rows do not take figures from `modelUsageList`.
- Exact fix (data): add an early provisional live snapshot to each of the three affected files, with lower revisions, then keep the later ones ascending.
  - orchestration: insert at `at: 800` a copy of the existing `[42]` stats-live payload with `tokens {input:1200, output:300, cacheRead:400, cacheCreation:60}`, `tokenCount:1960`, `totalCost:0.017`, `knownCost:0.017`, `revision:1`, `provisional:true`, `agentSessionCount:0`, `cliAgents:[]`, `context.contextTokens:1500`. Keep the 38000 one at `revision:2`. Optionally add one at `at: 20000` with `revision:2` and move the final to `revision:3`.
  - tribunal-council and multi-agent: insert an equivalent `revision:1` snapshot at `at: 800` (the existing ones are `revision 2` and `4`, so ascending order holds).
  - The revision floor (`session-stats-snapshot.ts`) rejects only lower revisions, so equal and ascending values are safe.
  - The snapshot must include `provisional:true` (a missing or false value fails `parseSessionStatsLivePayload`).
- Per-lane figures: add `usage`/`tokenUsage` (or put the figures in the lane's `agent-monitor:exited` payload) only if the app reads them. Otherwise accept "—" for lanes. Verify against `agent-monitor` types before adding; I did not trace that path.

**V-3. Command Center shows "Context unknown" (`command-overlay.component.ts:154`, and the Chat view's "Context" tile shows "—" in `real-orchestration-end.png`).**

- Cause: context percent comes from `tab.liveModelStats`. It is set only from a `session:stats` result event with `modelUsage` (`session-stats-aggregator.service.ts` ~L152-171 via `deriveLiveModelStats`), or from `applyLoadedSessionStats` (which sets `contextKnown:false`). `session:stats-live.context` is applied only to an existing reading (`liveContextStats` returns `null` when `prior` is missing), so it is a no-op here. None of the four scenarios emits a `session:stats` result event.
- Exact fix (data): add one `session:stats` message per scenario shortly after the final `message_complete` (orchestration, tribunal-council, multi-agent) or at `at: 600` (command-center, which has no turn). Payload:

```json
{ "at": <t>, "message": { "type": "session:stats", "payload": {
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "turnCost": 0.084,
  "tokens": { "input": 5400, "output": 1750, "cacheRead": 2100, "cacheCreation": 350 },
  "duration": 30000,
  "modelUsage": [ {
    "model": "claude-sonnet-4-5",
    "inputTokens": 5400, "outputTokens": 1750, "cacheReadInputTokens": 2100,
    "costUSD": 0.084,
    "lastTurnContextTokens": 6800,
    "contextCapacity": { "model": "claude-sonnet-4-5", "tokens": 200000, "source": "sdk-native" }
  } ],
  "sessionStats": { <same object as the stats-live sessionStats, without "provisional", revision above the latest live one> }
} } }
```

  - Result: `deriveLiveModelStats` yields `contextKnown:true`, `contextWindow:200000` and `contextPercent:3.4`, so the badge reads 3.4%. Place it before `session:turnEnded` and give it a revision greater than the last stats-live (use 5 if the last is 4).
  - Caveats (not verified in a browser): this is the turn-result path, so it also runs `streamingHandler.handleSessionStats` (message footer) and `sessionLoader.loadSessions()` (an RPC `session:list`, which the scenarios do answer). For command-center there is no chat tab; the Command Center overlay reads the session tab. Confirm the tab exists via `bootMessages` before relying on it. Field names `cacheReadInputTokens`, `lastTurnContextTokens` and `contextCapacity` were taken from `deriveLiveModelStats`; confirm against `ResultStatsPayload` in `agent-adapter.types.ts`.

### MINOR

1. `orchestration.json` has no `session:stats-batch` or `chat:running-agents` fixtures, which the other three provide. No miss was recorded in the last check run, but a visitor who opens the sessions rail may trigger a `REPLAY_MISS`. Copy the `session:stats-batch` entry from `multi-agent.json`.
2. `replay-bridge.entry.ts` (on-send block): the session is created by DOM scraping (`button` text "New session", then "Create"). A UI label change silently skips the click, and only the later composer miss is reported. Add `report('ready-timeout', 'New session button not found')` when `tries === 0` finds no button, and match by a stable `data-testid` instead.
3. On-send: a visitor who edits the pre-filled prompt still gets the fixed replay, and the user bubble shows their text. Acceptable, but consider showing "Demo replay" copy in the host page. A second Send after playback is silently swallowed (`waitingForSend` is false, and the RPC answer is the static `chat:start`).
4. `orchestration.json` has duplicate lane display names (two "Codex", two "Antigravity" rows in the Agents list). This is realistic but reads like a bug in a demo. Consider distinguishing them in the `task` text.
5. tribunal-council and multi-agent have a 3rd-party model string "claude-sonnet-4-5" (fine) and `"authMethod": "claudeCli"`. Not private, no change required.
6. `plugins:get-config` returns `enabledPluginIds: []` in the orchestration file while the prompt is about a plugin notice. Cosmetic only.

## Privacy sweep (item 2): details

- Synthetic files (tribunal-council, multi-agent, command-center): grep for `/home`, `/Users`, `amun`, `abdallah`, `hive`, `github`, `http`, `localhost`, `sk-`, `.com`, `.io` and `.dev` returned no real data. The only `@` hit is `demo@example.invalid` (allowed by the scan). Token hits are usage counters. The only filesystem paths are `/workspace/acme-app/...` (including `.ptah/demo/*.txt`). Verdict: clean.
- `orchestration.json`: no `/home`, no emails (only `demo@example.invalid`), no hostnames or keys. The leaks are the B-1 items (task id, PR number, worktree directory name, code symbols, tool-call and subagent ids, real model string). Verdict: not clean.
- `session-to-scenario.mjs`: real username in a path default (M-1).
- The privacy scan has no rule for identifier shapes (`toolu_...`, `FIX_*`, `PR #nnn`, `.claude-worktrees/*`). Consider adding `\btoolu_[A-Za-z0-9]{16,}`, `\bPR #\d+`, `\.claude-worktrees/` and `\b[A-Z]{3,}(?:_[A-Z]+){2,}\b` to `privacy-scan.ts` and add cases to `scenario-privacy.spec.ts`. The scan runs on all scenario JSON in the spec, so this would catch B-1 in CI.

## Not examined or uncertain

- No browser run: the V-1, V-2 and V-3 fixes follow the frontend sources. Re-run `node scripts/landing/check-live-demo.mjs --scenario <id>` and take screenshots after the changes.
- The `agent-monitor` per-lane Tokens and Cost rendering path was not traced.
- The runtime specs and the full privacy spec were not run (not permitted); I only read their intent from the notes.
