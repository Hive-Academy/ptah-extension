# Phase-end Code Logic Review — PR 1 (`TASK_2026_597`)

Scope: `git diff 15a8362d4..HEAD`, product code only — Batch 7 (vscode-lm-tools mcp-core/mcp-stdio `effort`), Batch 23 (agent-sdk helpers: auto-compact window, env read, live threshold change), Batch 42 (agent-generation `subagent-tool-allowlist` + `disallowedTools`). Plus the one `.claude/agents/*.md` consistency check.

## Summary

| Metric        | Value                                                    |
| ------------- | -------------------------------------------------------- |
| Overall score | 8/10                                                     |
| Assessment    | APPROVED                                                 |
| Blocking      | 0                                                        |
| Serious       | 0                                                        |
| Moderate      | 2 (neither can break a lane/session config or lose data) |
| Minor         | 3                                                        |

## Five logic questions

1. Silent failure: a Ptah-CLI lane given `effort` ignores it without any log (M1). Live window apply failure is logged at warn and the session keeps its start-time window (session-control.service.ts, catch block); that is a visible degradation, not a lie.
2. User action: editing `compaction.threshold` while sessions are live fires `applyFlagSettings`; invalid value → provider returns `null` → window cleared (runtime decides). Toggling `compaction.enabled` live is not applied (M2).
3. Wrong-answer input: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is clamped/ignored per the runtime; `parseAutoCompactWindowEnv` mirrors that and only feeds the log. Keys are unaffected by env (auto-compact-control.ts, env branch returns `...keys`).
4. Dependency failure: a stuck child on `applyFlagSettings` is bounded by a 5 s race; the timer is cleared in `finally`; the late promise is already handled by `Promise.race`, so no unhandled rejection. `ConfigManager`/provider are `isOptional`, so containers without them construct.
5. Missing: no test or log distinguishes "effort ignored by CLI" from "effort applied" on the Ptah-CLI path; `compaction.enabled` live change.

## Batch 23 confirmations

- Keys unchanged with null defaults: `A1_DEFAULT_WINDOW` is `{claude:null, proxied:null}` (auto-compact-control.ts), so `keys` is `{autoCompactEnabled:false}` / `{autoCompactWindow:<user>}` / `{}` exactly as before. `buildFlagSettings` copies `autoCompactEnabled` and `autoCompactWindow` by name (sdk-query-options-builder.ts:387-392), so the new `effectiveWindow`/`source` fields never reach `--settings`. The base-URL refactor (`isFirstPartyAnthropicBaseUrl`) keeps the identical regex and empty-string semantics for the 1M beta and model pre-flight.
- Live change cannot hang: 5 s timeout per session, `Promise.all` over sessions, per-session catch, method never throws; the watch callback runs off-stack with its own `.catch`, so it cannot reject the settings write. A `null` window is valid for the pinned SDK type (`Settings[K] | null`, sdk.d.ts:2769) and `autoCompactWindow` exists in `Settings` (sdk.d.ts:8578).
- Crash safety: `rec.accountingAuthEnv` is read per record; sessions with `query === null` are filtered, so a starting session is skipped and reads fresh config at its own build.
- Watcher disposal: `compactionThresholdWatch` is disposed and nulled in `dispose()`; `SdkAgentAdapter` calls `sessionLifecycle.dispose()` (sdk-agent-adapter.ts:559). `ConfigManager.watch` replays the current value on registration; with zero live sessions the callback returns immediately (session-lifecycle-manager.ts:410).
- Ordering: control requests share one channel and each apply re-reads `getConfig()`, so rapid edits converge on the latest value.
- Secrets: the env read logs only `rawLength` for a bad value and the effective window for a clamped value; the raw text is never echoed. The new `Auto-compact window` info line carries enabled, window, source and class only.

## Moderate

### M1 — Ptah-CLI lane silently ignores `effort`

- File: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:231 (the `registry.spawnAgent` options at lines ~74-85 and the `spawnFromSdkHandle` record at ~255 have no `effort`).
- Scenario: `agent_spawn {ptahCliId, effort:'high'}`. The schema accepts it, the dispatchers forward it, and the Ptah-CLI branch drops it with no log. The tool text says "A value the chosen CLI does not take is ignored", which is defensible, but the Ptah-CLI lane is an SDK/Claude lane that does take effort.
- Breaks lane/session config or loses data? No. The lane runs with its configured effort. This is a caller-expectation gap, not a config break.
- Fix: either thread `effort` into `registry.spawnAgent` options or log "effort ignored for ptah-cli" so the drop is visible.

### M2 — `compaction.enabled` change is not applied live

- File: libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:409 (watches `compaction.threshold` only); session-control.service.ts (`!config.enabled` early return).
- Scenario: the user re-enables compaction, or changes the threshold while disabled, mid-session. A session that started with `autoCompactEnabled:false` keeps it until restart; the early return also skips the window apply.
- Breaks lane/session config or loses data? No. It is stale-until-next-start behaviour, matching the documented "applies from the next start" degradation. Nothing is lost.
- Fix: optional; also watch `compaction.enabled` and send `autoCompactEnabled`, or document it.

## Minor

- m1: `ConfigManager.watchers` is a `Map` keyed by config key (config-manager.ts:50, 263-274). A second watcher on `compaction.threshold` would overwrite this one, and this one's `dispose` would delete the other's. Only one watcher exists today (grep), so no defect now.
- m2: With `CLAUDE_CODE_AUTO_COMPACT_WINDOW` set, the live apply still sends the flag-layer window (harmless; the runtime ignores it) and logs `source: env`. Slightly noisy only.
- m3: `effort` is a free string up to 32 chars. It is logged raw in the dispatcher info lines (agent-tool.dispatcher.ts:348, protocol-dispatcher.ts:1098). The bound keeps that safe; it is not a secret channel.

## Batch 7 notes

`AgentSpawnArgsSchema` is `.strict()` and now allows `effort` (agent-spawn-args.schema.ts), so the field is not rejected as unknown on either surface. The `buildAgentSpawnTool` description is shared by the HTTP tool and the stdio `agent_spawn` (tool-builders.ts:89), so both advertise `effort`. Both dispatchers pass it into `agent.spawn`, whose request type has `effort` (agent-process.types.ts:188), and `AgentProcessManager` consumes it (agent-process-manager.service.ts:354, 381). Wire path OK for every non-Ptah-CLI lane.

## Batch 42 notes

- `subagent-tool-allowlist.ts` only emits exact tool names or the bare server spec `mcp__firecrawl`; there is no partial wildcard and no bare `*`. The comma-joined single line matches the runtime's comma/space split.
- `.claude/agents/*.md` check: all 12 files with a `disallowedTools:` line match the allowlist exactly. The six NO_BROWSER_NO_WEB types carry firecrawl + ptah_web_search + 11 browser tools; the six NO_WEB_SCRAPE types carry `mcp__firecrawl` only. `visual-reviewer`, `researcher-expert` and `video-director` have no line, as intended. No wildcard or bare `*` appears.
- Silent-denial check: none of the 12 denied agent files mention firecrawl, web_search, ptah_browser, WebSearch or WebFetch outside the frontmatter, so no agent is denied a tool its body instructs it to use. Unknown or custom template names get `[]` (no restriction), and the `hasOwnProperty` lookup avoids prototype keys such as `constructor`.
- Edge: a user-authored template that reuses a shipped name (for example `team-leader`) inherits that deny list. This is acceptable and by design.

## Data flow

effort: schema parse → dispatcher → `agent.spawn` → process manager / environment resolver → lane policy log (OK; Ptah-CLI branch drops it, M1).
Compaction: setting + env → provider `getConfig` → `resolveAutoCompactControl` → `buildFlagSettings` (keys only) → `--settings` (OK). Live: config watch → `getConfig` → `applyAutoCompactConfig` → `applyFlagSettings` with timeout (OK).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on batch 23 and 42, MEDIUM-HIGH on batch 7 (the downstream process manager was reviewed in earlier batches)
- Top risk: a Ptah-CLI lane silently ignoring `effort` (M1), a visibility gap rather than a break.
- Robust additions: log or thread `effort` on the Ptah-CLI path; optionally watch `compaction.enabled`.
