# Code Logic Review, Phase 2 (Batches 5-9) — TASK_2026_617

Scope: `git diff 5caeff54d..b720f2f18` and `git diff 72b5677d0..HEAD` (excluding `.ptah`), worktree `task-617-grok-acp`.
Method: read the Grok profile, adapter and the whole ACP session handle, permission policy and transport write path;
traced the settings write path; swept every SYSTEM_CLI_TYPES / CliType consumer and every hard-coded CLI list; compared
`describeGrokError` with the `grok-p3-*` fixtures. Ran `nx test @ptah-extension/cli-agent-runtime` (103 suites,
2133 passed, 1 skipped, 0 failed). No source edited.

## Summary

| Metric   | Value                                |
| -------- | ------------------------------------ |
| Score    | 7/10                                 |
| Verdict  | REVISE (no blocking defect; 3 Major) |
| Blocking | 0                                    |
| Major    | 3                                    |
| Minor    | 9                                    |

The wiring is complete and the security-sensitive mandatory checks pass. The Majors are about claims the code makes but
never verified (API-key auth), a fatal path for a soft hint (effort), and a permission label that understates what the
lane can do.

## Mandatory checks

| #   | Check                                                        | Result                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No env values or argv reach logs in grok paths               | PASS                    | `buildSpawn` returns no env (`grok-acp-profile.ts:102-104`). Logged fields are `command` (bare name or resolved path) plus `error.message` only: `grok-cli.adapter.ts:163-166`, `acp-process-transport.ts:267,276,447`. Session handle logs `vendor`, JSON-RPC `code`/`message`/`detail`, `configId`, `configValue` (model id), exit code/signal: `acp-session-handle.ts:339-346,437,614-618`. `spawnCli`'s long-command error carries sizes and an argument index, not content (`cli-adapter.utils.ts:175`). MCP URL (port, cwd, agentId) is never logged.                                                                              |
| 2   | `describeError` matches real Grok wording                    | PASS, with 2 Minor gaps | -32003 on `session/prompt`: fixture `grok-p3-rate-limited-429` has `message "Rate limited"`, `data` a string; `readAcpErrorDetail` (`acp-vendor-profile.ts:114-125`) returns the string, or an object's `message`, so both shapes work (`grok-acp-profile.ts:67-72`). -32000 on `session/new` / `session/resume`: fixture `grok-p3-signed-out` id 1 is `session/new`, matches (`:74-79`). -32602 on `set_config_option` with `configId==='model'`: fixture `grok-p3-set-model-unknown` matches, and the available list comes from `configOptions` (`:81-92`). Gaps: D6 (-32000 on any other method), D4 (unverified XAI_API_KEY advice). |
| 3   | `--no-leader` always; `--always-approve` never; `stdio` last | PASS                    | Static `GROK_ARGS = ['agent','--no-leader','stdio']` (`grok-acp-profile.ts:44`), returned unconditionally (`:103`). `--always-approve` appears only in comments (`:14-18`). `grok models` is run as `['models']` (`grok-cli.adapter.ts:161`), which is not an agent invocation.                                                                                                                                                                                                                                                                                                                                                          |
| 4   | Permission policy answers `allow_once`                       | PASS                    | `resolveAutoApprove('grok')` returns `undefined` (`agent-spawn-environment.service.ts:142-150`), so `autoApprove !== false` and `firstOptionIdOfKind(offered,'allow_once')` is chosen first, by kind not id (`acp-permission-policy.ts:91-99`; wired at `acp-session-handle.ts:319-322`). Falls back to `allow_always` (with an info), then `reject_once`, then cancelled.                                                                                                                                                                                                                                                               |
| 5   | Write-path trace                                             | PASS, with 2 Minor gaps | See trace below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | Every SYSTEM_CLI_TYPES consumer handles grok                 | PASS                    | See list below. No missed exhaustive consumer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7   | Loose ends                                                   | See D7-D9               | `agent-process-manager.service.spec.ts:2624` fixable now; backpressure is Minor; `agent-models.store.ts` needs no grok entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Check 5: write path

1. Matrix cell: `cli-matrix-rows.ts:182-187` (`modelKey: 'grokModel'`) → `ProvidersOrchestrationField` includes `'grokModel'` (`providers-settings.types.ts:69`).
2. Commit: `providers-commit.service.ts:194` pushes an operation when `patch.orchestration?.grokModel !== undefined`. An empty string is `!== undefined`, so a cleared value is written. Read-back via `agent:getConfig` and `sameSetting`.
3. RPC: `agent-rpc.handlers.ts:529-531` writes `ptah.agentOrchestration.grokModel` (`setAgentCfg`, global scope; `SCOPED_SETTING_KEYS` is `global` only, `rpc-auth.types.ts:465-468`). `getConfig` returns it at `:355`. Key is in `FILE_BASED_SETTINGS_KEYS` with default `''` (`file-settings-keys.ts:194,515`) and `KNOWN_CONFIG_KEYS`.
4. Spawn: `MODEL_CONFIG_KEYS.grok = 'grokModel'` (`agent-spawn-environment.service.ts:65`) → `resolveModel` reads `agentOrchestration.grokModel` only when no request model is given → `resolveLaneModel` (`lane-spawn-policy.ts:50-61`): `''` is falsy so source `cli-default`, model `undefined`. → `runSdk({model})` (`agent-process-manager.service.ts:680-688`).
5. Profile `sessionConfig` pushes `{configId:'model', value}` only when `options.model` is truthy (`grok-acp-profile.ts:124-126`); the runner applies it only if `configOptions` advertises `model` (`acp-session-handle.ts:466-473`), as `session/set_config_option` before the first prompt. Fixtures confirm the `model` id and that Grok advertises it (`grok-p3-set-model-unknown`).

A cleared value sends nothing, so no stale model is sent. Gaps: D5 (whitespace-only value is truthy), D10 (clearing does not reset a resumed session).

### Check 6: consumers

Derived from `SYSTEM_CLI_TYPES`, so they follow automatically: `agent-spawn-args.schema.ts:25`, `tool-description.builder.ts:607,640`, `system-namespace.builders.ts:482`, `ptah-system-prompt.constant.ts:244`, `ptah-core-prompt.ts:283`, `agent-rpc.schema.ts:39`, `agent-cli.ts:92,233`, `preferredCli` (`agent-spawn-environment.service.ts:322`).
Explicit grok entries present: `SYSTEM_CLIS` and `CLI_INSTALL_GUIDES` and `FIXED_NOTES` (frontend chat), `CLI_LABELS` (`chat-view.component.ts:98`), `CLI_DISPLAY_NAMES` (`task-agent-discovery.service.ts:19`), `CLI_FAMILIES` and `spawnArgsFor` (tribunal; the `switch` has no `default`, so TS enforces it), `AgentListCliModelsResult` + `cli-model-list.service.ts:76,85`, `effortMapperFor` (`lane-spawn-policy.ts:175`), `refreshCliTokens` (`cli-detection.service.ts:244`), adapter registration (`:75`).
Deliberately not requiring grok, and degrading safely: `LANE_SUCCESS_BILLING` (Partial), `lane-limit-classifier.ts` `MATCHERS` (see D9), `LaneOwnerResolver` (default branch), `ROLE_TRANSFORM_TARGETS` (pi is absent too, so the raw role body is used), `AGENT_MODEL_PROVIDERS` (claude, codex, copilot, cursor, opencode only; antigravity and pi are absent too). MCP install target lists (`mcp.ts`, `harness-*`, `editor-rpc`) are a separate concept (config-file targets), not lane CLIs.

## Defects

### Major

**D1. A soft hint can kill the lane: `reasoning_effort` is applied without checking the value is advertised.**
`acp-session-handle.ts:466-491` only checks that the `configId` is advertised, not that `entry.value` is one of
`advertisedValuesOf(option)`. Effort reaches Grok lanes without any setting: spawn `effort`, the chat effort (step 5) and the
reviewer/tester default `medium` (step 4) all resolve for grok (`lane-spawn-policy.ts:140-155,175`), and `max` maps to
`xhigh` (`:229-239`). If the active model advertises a narrower list (the fixtures show per-model effort lists:
`grok-4.6` vs `grok-4.7` `reasoningEfforts` in `_meta.modelState`), `set_config_option` returns -32602, `call()` throws
`AcpTurnFailure` with the generic text (`describeGrokError` only handles `configId==='model'`), and `runFirstTurn` kills
the process (`:632-637`). A model rejection is meant to be fatal; an effort mismatch should not be.
Fix: in `applySessionConfig`, for any entry whose `configId !== 'model'` (or via a profile flag `optional`), skip with an
`emitInfo` when `advertisedValuesOf(option)` does not contain the value, and catch an `AcpTurnFailure` from an optional
entry, downgrading it to an info. Also re-read `configOptions` after the model change (the `set_config_option` response
carries the updated options) before validating the effort. Add a spec: advertised `['high']`, requested `xhigh`, lane runs.

**D2. The permission note understates the lane's authority.**
`cli-permission-notes.ts` (grok entry): badge "Allow once", tone `info`, detail "Ptah answers each Grok permission
request with allow-once; nothing is persisted." Because `autoApprove` is `undefined` for grok, every request, shell and
file writes included, is approved (`acp-permission-policy.ts:91-99`). That is full auto, like Codex/Cursor/Antigravity,
which are shown as "Full auto" with `warning` tone. A user reading "Allow once" will assume a gate exists.
Fix: badge `Auto-approve`, tone `warning`, detail "Ptah approves every Grok tool request, shell commands and file edits
included, one request at a time; nothing is remembered between requests." Update `cli-permission-notes.spec.ts`.

**D3. XAI_API_KEY is advertised as a working credential but was never verified for `agent stdio`.**
`grok-cli.adapter.ts:166-167,364-367` (`ensureTokensFresh` reports usable when `XAI_API_KEY` is set), the profile header
(`grok-acp-profile.ts:19-20`) and the error text (`:78`, "run `grok login` or set XAI_API_KEY") all assume it.
`grok-probe.md:376` records `XAI_API_KEY` mode as not tested. The signed-out fixture shows `initialize` advertising only
`authMethods:[{"id":"grok.com"}]` with `defaultAuthMethodId:null`, and `session/new` failing with `data: "no auth method id
provided"`. That suggests the agent expects an `authenticate` call when no cached login exists; the runner never calls
`authenticate`. A key-only user gets "not signed in: ... or set XAI_API_KEY" while the key is already set.
Fix: before merge, run one live probe with `XAI_API_KEY` set and `~/.grok/auth.json` absent (needs quota). If it fails, either
add an `authenticate` step for the advertised method (profile-level) or drop the API-key claim from the three places above and
make `ensureTokensFresh` check `auth.json` only. Until verified, soften the message to "run `grok login`".

### Minor

**D4.** Same root as D3, wording only: `describeGrokError` ignores `failure.message`. -32000 is JSON-RPC's generic server-error code; any -32000 on `session/new`/`session/resume` is reported as "not signed in" (`grok-acp-profile.ts:74-79`). Guard on `/auth/i.test(failure.message)` or on `detail`, and let others fall through to the generic text, which keeps the raw message.

**D5.** Whitespace-only model is sent. `resolveLaneModel` treats `'  '` as set (`lane-spawn-policy.ts:55-60`), `agent:setConfig` stores values untrimmed and unvalidated (`agent-rpc.handlers.ts:529-531`; `ptah agent-cli config set grokModel " "` passes through, `agent-cli.ts` string passthrough). Result: "Grok rejected model ' '". Trim in `AgentSpawnEnvironment.resolveModel` (or in the grok `sessionConfig`), and reject non-string `grokModel` in `applySetConfig` as `cursorApiKey` already is (`:469-474`).

**D6.** -32000 raised by `session/prompt` mid-lane (token expiry) falls through to `Grok session/prompt failed: Authentication required (...) [code -32000]` (`acp-session-handle.ts:310-317`) with no `grok login` hint. Extend the auth mapping to any method when the message matches (see D4).

**D7.** `agent-process-manager.service.spec.ts:2624`: add `'grok'` to the `it.each`. The executor's note says the mock needs to report grok installed, but `createMockCliDetection` (`:262-274`) returns the same `det` (installed) for every `getDetection` and `getInstalledClis`, and `getAdapter` returns the adapter for any name, so `preferredCli()` will return `'grok'` once it is in `SYSTEM_CLI_TYPES` (it is). Also update the comment above it ("antigravity/opencode/pi").

**D8.** Stdin backpressure (`acp-process-transport.ts:329-357`): `stdin.write(chunk)`'s boolean is ignored and the write promise resolves immediately, so a stalled agent lets Node buffer unbounded data. Prompts and responses are small, so real risk is low; to fix, when `write` returns false, resolve on `stdin.once('drain')` or `'close'`/`'error'`, whichever comes first, and keep the existing drop-on-closed-stdin path. Record as accepted if not done.

**D9.** Grok free-usage exhaustion (`subscription:free-usage-exhausted`, 24 h rolling window, in the -32003 data) is not recognised by `lane-limit-classifier.ts` `MATCHERS` (`:155-162`), so no plan-limit evidence is recorded and no reset time is surfaced beyond the error text. The lane still ends `done` 1 with a clear message, so this is a feature gap, not a defect. Add a `matchGrok` in a later task; note it in future-enhancements.

**D10.** Clearing the model setting does not reset a resumed session. On `session/resume` the agent keeps its stored model; with an empty setting nothing is sent (`grok-acp-profile.ts:124`), so a lane that first ran on `grok-4.x` stays on it after the user chooses "CLI default". Acceptable and arguably correct (resume keeps the session's model); document it, or send the advertised default (`currentValue` of the original `session/new`) when `source === 'cli-default'` and `restoredContext`.

**D11.** `parseGrokModels` (`grok-cli.adapter.ts:215-246`) was fitted to a single observed row. A row with trailing description text (`grok-4.7 - frontier model`) fails the row regex and is silently dropped, leaving only the `Default model:` id. The ACP `session/new` `models.availableModels` is structured; consider sourcing the picker from it, or loosening the row regex to take the first token.

**D12.** Stale docs and test data: `agent-cli.ts:27,81` and `:226-232` still say "six system CLIs / seventh adapter"; `agent-rpc.handlers.ts:739-746` debug log omits `grokCount`; `settings-live-shape.fixtures.ts` has no `grokModel` and `settings.fixtures.ts:148-170` has no grok in `detectedClis`, so the Orchestration matrix QA/e2e screenshots will not show a Grok row. Add a `{cli:'grok', installed:true, version:'1.0.46', messagingMode:'queue'}` fixture before taking the dark/light screenshots required by the handoff. Also `mapEffortToGrok` (`lane-spawn-policy.ts:225-239`) is a verbatim copy of `mapEffortToCli`; reuse it.

(D7 to D12 are Minor; D4 to D6 are Minor; counted as 9 Minor in the summary.)

## Five logic questions

1. Silent failure. A model that Grok's session does not advertise is skipped with an `info` only (`acp-session-handle.ts:467-472`), visible but not an error. Dropped stdin writes resolve silently (`acp-process-transport.ts:340-349`), but connection close then rejects the pending request. No swallowed error found that reports success. `detect()` and `listModels()` return empty on any failure by design.
2. User action. Clearing the model after a resumed session (D10); typing spaces as the model (D5); reading "Allow once" as a gate (D2); setting only XAI_API_KEY (D3).
3. Input data. Effort value outside the advertised list on a given model (D1); a `grok models` row with a description (D11).
4. Dependency failure. Rate limit, signed-out, bad model, handshake timeout (30 s), process exit mid-turn and `grok models` timeout (8 s) all end with one `error` segment and exit 1; verified against fixtures and the spec suite. A mid-lane auth expiry has no hint (D6).
5. Missing from the requirements. Plan-limit classification (D9); API-key auth path (D3); no live verification of `ptah_agent_report`, queued follow-up, stop and resume (deferred for quota, handoff item 4).

## Residual risk

Not run: a live Grok session (quota exhausted), the frontend/core/chat/rpc-handlers test targets (reported green by the team-leader for Batches 5-9; the `rpc-handlers` flake under parallel load was noted in the handoff). `grok models` multi-row format is untested against real output.

## Recommended fix order

D1, D2, D3 (probe), then D5, D7, D12 fixtures. D4, D6, D8-D11 can be recorded as follow-ups.
