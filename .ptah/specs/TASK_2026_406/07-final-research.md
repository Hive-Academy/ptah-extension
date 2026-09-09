# 07 — Final Research: Runtime-Agnostic Intelligent Compaction

Task: TASK_2026_406 (research only — no product code was modified, no live compaction was triggered by this work).
Author: final-reconciliation worker. Local verification date: 2026-09-10 (log timestamps in this report are UTC; log files rotate on local time UTC+3).
Inputs: reports 01–06 in this folder, direct re-verification of SDK artifacts, product source, and the full log corpus.

---

## 1. Executive Verdict

**The compaction coordinator architecture from report 05 is approved as the target design, with the seven corrections from report 06 applied and two evidence corrections from this reconciliation.** Most of the plan is buildable now without any SDK change. One item (Settings.autoCompactWindow) stays blocked on a live experiment (E2), and three items are SDK-blocked permanently on the current SDK version.

The decisive new facts, all verified directly in this session:

1. **The bundled runtime is Claude Code 2.1.150** (SDK 0.3.150 wrapper; `node_modules\@anthropic-ai\claude-agent-sdk\manifest.json`: `"version": "2.1.150"`, buildDate `2026-05-23T01:31:13Z`, commit `28d4819e0f0a51840356d175c2a710f0c83db5b4`). This is **before** both the third-party auto-compact regression (anthropics/claude-code#65585, v2.1.161+) and the `--autocompact` flag documentation floor (v2.1.221). Report 06's B1 objection is confirmed and it **removes** two of report 04's headline risks for this install.
2. **Auto compaction fires and completes in this environment on real sessions.** The log corpus (62 files, `C:\Users\abdal\AppData\Roaming\Ptah\logs`) contains 86 PreCompact hook events: 35 manual + **51 auto**, of which **13 auto events are on real ptah-cli session UUIDs** (not synthetic `internal-query-*` sessions). This corrects report 02 ("all auto on synthetic sessions") and report 06 ("51 internal + 1 user"). Four of the 13 are August sessions (9a4a9994, b9acdc5a, 184f8f6e, f86f78c0) that both reports had in-corpus but misattributed; each shows **zero** PostCompact.
3. **Auto compaction completion is now measured, closing B6.** In `Ptah Electron-2026-09-10.log` (rotation created after reports 02 and 06 were written), eight auto PreCompact events fired on bridge research-worker sessions during 2026-09-09 21:05–21:29 UTC, and **four clean PreCompact(auto) → PostCompact pairs** are observed (21:05:02→21:06:11, 21:06:19→21:07:11, 21:07:54→21:08:16, 21:08:31→21:08:51). The memory-curator PreCompact reactor ran for each (transcript splits of 51,039 / 103,012 / 117,168 characters). Pairing is by timestamp interleaving because PostCompact log lines carry no sessionId — this is an inference, labeled as such in §3.3.

**What this means:** the native auto-compact loop is alive and healthy on this SDK version even with third-party providers. The correct posture for Ptah is **coordination and observability around native compaction** (dedup, dwell bound, usage reporting, memory handoff) — not replacing it. The settings layer Ptah already ships (`ptah.compaction.enabled`, `contextTokenThreshold`) is currently **dead configuration** at the SDK boundary, and one part of it is fabricated metadata (the 128k default context window for Ollama Cloud models) that can cause premature or wrong-sized compaction decisions.

**No tests were run and no live compaction was triggered by this research.** All claims below are labeled [M]easured, [D]ocumented contract, [I]nference, or [U]nknown.

---

## 2. Current Behavior — Reconciled Log Evidence

### 2.1 Corpus and counts [M, re-measured 2026-09-10]

Corpus: `C:\Users\abdal\AppData\Roaming\Ptah\logs`, 62 files, rotations named `Ptah Electron-YYYY-MM-DD.log` (local time UTC+3) plus a small number of other processes.

| Signal | Count | Notes |
|---|---|---|
| `PreCompact hook triggered` | **86** | 35 with `"trigger":"manual"`, **51** with `"trigger":"auto"` |
| — auto on `internal-query-*` sessions | 38 | memory-curator internal queries |
| — auto on real session UUIDs | **13** | correction to 02 and 06, see §2.2 |
| `Compaction started` | 36 | SDK-side line |
| `PostCompact hook invoked` | 38 | was 35 at report 02's measurement; +3 in the 09-10 rotation |
| `Operation overdue` | **0** | across the whole corpus |

### 2.2 The 13 real-session auto events [M]

Four are August sessions, each verified as a real ptah-cli session via `SessionMetadataStore` "Linked CLI session ... (ptah-cli)" lines:

- 2026-08-25 (UTC) → logged in `Ptah Electron-2026-08-26.log` (UTC+3 rotation): sessions 9a4a9994, b9acdc5a, 184f8f6e. Zero PostCompact for these three.
- 2026-08-27 → `Ptah Electron-2026-08-27.log`: session f86f78c0. Zero PostCompact.
- The remaining auto events are on sessions in the 09-09 burst (§2.3) and later rotations.

The August four fired PreCompact but no matching PostCompact appears. Whether they hung, failed silently, or their PostCompact landed in a rotation boundary gap is [U] — but the 09-09 evidence (§2.3) proves the loop can complete, so the August gaps are more likely lost lines or rotation-boundary loss than a systemic hang.

### 2.3 The 09-09 burst: auto compaction completing [M + I]

`Ptah Electron-2026-09-10.log` contains eight auto PreCompact events, 2026-09-09 21:05–21:29 UTC, on sessions 847a899d, 0c38fe03, d05d13c2, 232a9e39, d05d13c2, 8388d934, 7c11eba2, a2676dbb, 92d00188 — the bridge research-worker sessions that wrote reports 02–06 (report files written 21:13–21:31 UTC, matching the SubagentStop/skill-synthesis log lines on the same sessions).

Four PreCompact(auto) → PostCompact pairs, gap 39–69 seconds each [M]. The pairing itself is [I]: PostCompact lines log only `{"hookEventName":"PostCompact"}` with no sessionId, so pairs were matched by timestamp interleaving. This is the first measured evidence in this corpus that the native auto-compact loop **completes** — report 06's B6 objection ("zero evidence of completion") is now answered.

Memory-curator reacted to each event (transcript split: windows=2/51,039 chars; windows=4/103,012; windows=4/117,168) [M] — the PreCompact reactor path works end-to-end on auto triggers.

### 2.4 Watchdog silence explained [M]

Zero `Operation overdue` lines corpus-wide, despite compaction dwell observed at 39–69 s. Direct source verification of `libs\backend\agent-sdk\src\lib\helpers\no-activity-watchdog.ts` `arm()` (~lines 215–230): while `compacting`, it pushes `'compaction'` into the operations map and calls `this.onOverdue(operations)` in a `try` whose `finally` **re-arms forever** — so overdue can never fire for compaction. B2 confirmed: there is no bounded dwell for compaction today. The wiring exists (`session-query-executor.service.ts` ~:204–213 passes an `onOverdue` callback that logs "Operation overdue; liveness unknown, continuing"), which answers report 01's open question — but the callback is unreachable for compaction.

### 2.5 Settings-layer behavior [M]

- `CompactionConfigProvider` defaults: `enabled: true`, `contextTokenThreshold: 100000`; values < 1000 rejected (documented in code). [D/M]
- `SdkQueryOptionsBuilder` **logs** `compactionEnabled`/`compactionThreshold` (~:762–773) but does **not** forward them into SDK `Options` — no such SDK option exists to forward to. [M]
- ptah-cli passes `compactionControl` into Options via an `as Options` cast (`libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`:750–753, plus spawn-options helper :55/:222/:247). Verified: `compactionControl` is **not** an `Options` field in `sdk.d.ts`. It is dead configuration — silently ignored by the SDK. [M]
- `SlashCommandInterceptor` `NATIVE_COMMANDS = new Set(['clear'])` (:30); `/compact` is intercepted and routed as a new query, not passed raw to the SDK. `executeSlashCommandQuery` calls `await this._control.endSession(sessionId)` **before** the new query (`session-lifecycle-manager.ts` ~:528). [M]

---

## 3. Runtime / Provider Capability Matrix

### 3.1 Claude Agent SDK 0.3.150 (bundled runtime 2.1.150) [D — verified in sdk.d.ts/sdk.mjs this session]

| Surface | Status | Reference |
|---|---|---|
| `/compact [instructions]` prompt injection | Available — the only input channel to trigger compaction | report 01; sdk.d.ts |
| PreCompact / PostCompact hooks | Available, notification-only (cannot cancel/modify) | sdk.d.ts :5183 region; report 03 |
| `SDKCompactBoundaryMessage` with `compact_metadata` (trigger, pre/post tokens, duration, preserved segment/messages) | Available — typed, emitted at boundary | sdk.d.ts, verified in full |
| `SDKStatusMessage` `status:'compacting'` + `compact_result`/`compact_error` | Available | sdk.d.ts, verified in full |
| `SessionStart` source `'compact'` | Available | report 03 |
| `Query.getContextUsage()` (autoCompactThreshold optional) | Available | sdk.d.ts |
| `Settings.autoCompactWindow` | Exists in type (:5373) but **zod-gated**: `int().min(1e5).max(1e6).optional().catch(void 0)` in sdk.mjs — out-of-range values silently vanish; no evidence on 2.1.150 that the runtime honors the value even when valid (needs E2) | sdk.mjs, verified |
| `applyFlagSettings` mid-session | Available | sdk.d.ts |
| `forkSession(sessionId,{upToMessageId})` + `resumeSessionAt` | Available — typed rollback/history-slice surfaces | sdk.d.ts ("Slice transcript up to this message UUID (inclusive)") |
| Cancel/modify in-flight compaction | **Blocked** — no API | report 03 |
| History edit / message deletion | **Blocked** — no API | report 03 |
| `Options.compact()` / `compactionControl` | **Blocked** — not SDK fields | sdk.d.ts + ptah-cli-registry.ts:750 cast |

### 3.2 Codex TS SDK 0.147.0 [D — report 04]

Zero compaction types. `Op::Compact` / `ContextCompacted` exist in-process only. Observe-only via generic hook events is possible; app-server JSON-RPC surface [U]. Any Ptah coordinator must treat Codex as **observe-only** and skip injection.

### 3.3 Provider truth (Ollama Cloud) [M]

`libs\backend\auth-providers\src\lib\providers\local\ollama-cloud-metadata.service.ts:71` defines `DEFAULT_CLOUD_CONTEXT = 128_000`, substituted **unconditionally** at :382 and via `?? DEFAULT_CLOUD_CONTEXT` at :404/:426. `getModelContextWindow` returns 0 for unknown models. `CLAUDE_CODE_MAX_CONTEXT_TOKENS` override applies only to non-first-party base URLs. Net effect: real model context limits are unknown and every Ollama Cloud model is reported as 128k. This is a fabrication vector for any consumer that trusts it for compaction sizing (B3.1). Whether the 09-09 burst sessions used Ollama Cloud is [U] — model/baseUrl attribution for those sessions returned no matches in the searched window.

**Compatibility note [M+I]:** the burst sessions are bridge workers known to run on Ollama Cloud models, and native auto-compact fired and completed on them. This is measured for the burst sessions themselves; the provider/model line for each specific session was not recoverable from logs, so "auto-compact works on Ollama Cloud" is a strong [I], not a per-session [M].

---

## 4. What Can Be Built Now vs SDK-Blocked

### 4.1 GO — buildable now, no SDK change

1. **CompactionCoordinator state machine** (report 05: IDLE/ARMED/TRIGGERED/COMPACTING/COOLDOWN/BACKOFF/OBSERVE_ONLY) as the single decision point. Native auto-compact stays on; the coordinator adds dedup, dwell bounding, and reporting.
2. **`/compact` injection seam** with two B4/B5 fixes: the existing `executeSlashCommandQuery` **must not** call `endSession` for compact (or must capture and reattach the new session id), because the SDK returns a **new session id** after compaction — otherwise session-scoped state (token snapshots, metadata links) is orphaned. Reuse `SlashCommandInterceptor`'s routing; add `'compact'` handling distinct from the generic new-query path.
3. **Bounded dwell for compaction** — fix `no-activity-watchdog.ts` `arm()`: while compacting, do not re-arm infinitely; arm a bounded timer (recommend 180 s, matching the existing watchdog constant) whose expiry escalates per the coordinator's BACKOFF policy. The `onOverdue` wiring already exists and is currently unreachable.
4. **Auto/manual dedup** — coordinator suppresses injected `/compact` while `status:'compacting'` is live or within COOLDOWN after a boundary message.
5. **`IContextUsagePort`** (report 05) with B3 fixes: values carry **provenance** (live-snapshot / resume-baseline / provider-metadata / unknown) and a **presence** signal, never a bare number. `LiveUsageTracker.getCumulativeTokens` today returns a bare number and its doc says "A live snapshot always wins, even if it happens to sum to 0" — a consumer cannot distinguish "0 tokens" from "no data". Also: `clearSessionTokenSnapshot` drops both slots at `compact_boundary`, which is correct for the old session id but interacts with the new-session-id problem in item 2.
6. **Memory-curator PreCompact reactor** — keep. Measured working on auto triggers (§2.3), MANUAL_COMPACTION_MAX_WINDOWS=1 / CURATOR_MAX_WINDOWS=8 / `internal-query-` filter verified in reports 01/02 and not contradicted.
7. **Observability surface** — report 05's telemetry: compaction counts, trigger split, pre/post token deltas from `compact_metadata`, duration, failures from `SDKStatusMessage.compact_result/compact_error`.
8. **Recovery/rollback design** (report 06 GO with edits): use `forkSession`+`resumeSessionAt` only behind experiment E4 first (§6).

### 4.2 CONDITIONAL — gated on an experiment

- **LiveUsageTracker as usage fallback when `getContextUsage()` is absent**: only with the provenance/presence fix above; and E3 must confirm `getContextUsage()` behavior on third-party base URLs.
- **80%-of-window trigger with reserve**: depends on real window sizes; **blocked in practice** on the 128k fabrication (fix §5 item 4 first) and on E3.

### 4.3 NO-GO — SDK-blocked on 0.3.150

- **`Settings.autoCompactWindow`** — field exists and zod-bounds 100k–1M, but no evidence the 2.1.150 runtime honors it (the documented flag floor is v2.1.221). Experiment E2 (live test on a disposable session) gates this. Until then, do not wire Ptah settings to it.
- **Cancel/modify in-flight compaction** — no API. Do not design UI that promises it.
- **History replacement / manual summary editing** — no API. The coordinator can only *inject a prompt* and *react to boundaries*.
- **Codex parity** — no surface at all; observe-only stub at most.

---

## 5. Corrected Architecture (05 + B1–B7 applied)

Report 05's coordinator design stands. Amendments adopted from report 06 plus this reconciliation:

1. **(B1)** All version-conditional claims are re-anchored to 2.1.150. The architecture must not assume `--autocompact`/`autoCompactWindow` works. Pin a re-verification step into any SDK upgrade: on bump, re-read `manifest.json` version and re-run E2.
2. **(B2)** The coordinator owns the dwell bound. Do not rely on NoActivityWatchdog firing for compaction — fix its `arm()` loop and additionally have the coordinator treat a PostCompact that arrives after the bound as a policy input (BACKOFF/escalate), not as a silent pass.
3. **(B3.1)** Before any window-fraction logic, fix the provider fabrication: Ollama Cloud metadata must stop reporting 128k for unknown models (return unknown/provenance-tagged instead). This is a prerequisite, not an enhancement.
4. **(B3.2/B7)** Usage values are `{value, provenance, present}` triples end to end. No bare numbers cross the port boundary.
5. **(B4)** `/compact` handling is its own path in the session lifecycle: no `endSession` before injection; capture the post-compact new session id (from `SDKCompactBoundaryMessage`/`SessionStart` source `'compact'`) and rebind session-scoped state (token snapshots, SessionMetadataStore links, callback registry entries).
6. **(B5)** Injection happens only at turn boundaries and only in ARMED state, with user-initiated compaction winning over an auto-armed one (user-wins queue, report 05).
7. **(B6)** Completion detection uses `SDKStatusMessage.compact_result` and PostCompact hooks, **not** assumption; the four measured pairs (§2.3) prove the loop completes but the four August gap events (§2.2) prove completion is not guaranteed — the coordinator must handle both.

---

## 6. Exact Existing Code — Reuse / Change Map

| File | Action |
|---|---|
| `libs\backend\agent-sdk\src\lib\helpers\no-activity-watchdog.ts` (~:215–230) | **Change**: bounded dwell while compacting instead of infinite re-arm. |
| `libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts` (~:204–213) | Reuse: `onOverdue` wiring already exists. |
| `libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts` (`executeSlashCommandQuery`, ~:528) | **Change**: compact-specific path without pre-`endSession`; new-session-id rebinding. |
| `libs\backend\agent-sdk\src\lib\helpers\slash-command-interceptor.ts` (:30, :56) | **Change**: route `'compact'` to the compact path, not generic new-query. |
| `libs\backend\agent-sdk\src\lib\helpers\live-usage-tracker.ts` | **Change**: provenance + presence on `getCumulativeTokens`; review `clearSessionTokenSnapshot` interaction with session rebinding. |
| `libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts` | Reuse config schema; **change**: values feed the coordinator, and stop implying SDK forwarding. |
| `libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` (~:762–773) | **Change**: remove misleading compaction logging or re-scope it to coordinator config. |
| `libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts`, `compaction-callback-registry.ts` | Reuse: hook ingestion and shared-token registry. |
| `libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts` (:750–753), `helpers\ptah-cli-spawn-options.service.ts` (:55/:222/:247) | **Change**: delete the `compactionControl` → `as Options` cast (dead config) once the coordinator replaces it. |
| `libs\backend\auth-providers\src\lib\providers\local\ollama-cloud-metadata.service.ts` (:71/:382/:404/:426) | **Change**: no unconditional 128k default; unknown → provenance-tagged unknown. |
| `libs\backend\memory-curator` PreCompact reactor | Reuse as-is. |
| New lib (per one-concern rule; suggested `libs\backend\compaction-coordinator`) | Create: state machine, `IContextUsagePort` (or add to `platform-core` ports), injection policy, telemetry. |

---

## 7. Phased Implementation and Test Plan (proposed — requires user approval)

**Phase 0 — experiments (all on disposable sessions; user-approved triggers only):**
- E1 manifest read — **done** (2.1.150, this report).
- E2: send `Settings.autoCompactWindow` in-range on a disposable session; observe via `compact_metadata.pre_tokens` whether the window moved. Gates §4.3 item 1.
- E3: call `Query.getContextUsage()` on a third-party (Ollama Cloud) session; record `autoCompactThreshold` presence and accuracy. Gates §4.2.
- E4: `forkSession` + `resumeSessionAt` round-trip on a disposable session; verify transcript slice and state rebinding. Gates rollback design.
- E5: instrument auto-completion on one long disposable session (pre/post token deltas from `compact_metadata`). E6: correlate provider usage frames to SDK usage. (Both optional; E5 partially answered by the §2.3 measurement.)

**Phase 1 — correctness fixes (no behavior change to native compaction):** watchdog bounded dwell; provider metadata fabrication fix; usage provenance/presence; remove dead `compactionControl` cast and misleading builder logging.

**Phase 2 — coordinator:** state machine, dedup, turn-boundary injection with session rebinding, observability. Unit tests: state transitions, dedup windows, rebinding on new session id, BACKOFF on overdue PostCompact.

**Phase 3 — gated features:** window-fraction triggering (after E2/E3 + fabrication fix), rollback UX (after E4), Codex observe-only stub.

Testing rules: no live-compaction claims in CI; hook/state tests use synthetic SDK messages; integration verification on disposable sessions only, with user approval each time (per task constraints).

---

## 8. Remaining Questions

1. Provider/model attribution for the 09-09 burst sessions — [U]; grep for model/baseUrl in the window returned no matches.
2. Why the four August auto events show no PostCompact — rotation-boundary loss vs silent failure [U]; E5 on a disposable session would settle it.
3. Does 2.1.150 honor `autoCompactWindow`? [U] — E2.
4. `getContextUsage()` fidelity on third-party base URLs? [U] — E3.
5. Does `forkSession`+`resumeSessionAt` preserve compaction-produced history? [U] — E4.
6. PostCompact hook reliability as a completion signal (no sessionId in its payload) — consider correlating via `SDKCompactBoundaryMessage` instead [I].

---

## 9. Report and Source Index

| Source | Role |
|---|---|
| `01-runtime-map.md` (worker f234970b) | SDK surface map; onOverdue wiring question (answered in §2.4) |
| `02-full-log-forensics.md` (provenance unverified) | Log corpus baseline; auto-trigger attribution **corrected** in §2.2 |
| `03-native-runtime-contracts.md` (worker cc55e790; date discrepancy noted: 09-10 vs 09) | SDK documented contracts; hook semantics; blocked-surface list |
| `04-provider-capabilities.md` (worker f2cb1e6b) | Codex zero-surface; provider matrix; 128k-default risk (confirmed B3.1) |
| `05-architecture-proposal.md` (worker 02827437, opus) | Coordinator architecture — adopted as target |
| `06-adversarial-review.md` (worker 6cd10185, opus) | Objections B1–B7 and experiments E1–E6 — all resolved or adopted above |

Local artifacts verified directly this session (2026-09-10): `node_modules\@anthropic-ai\claude-agent-sdk\manifest.json`, `sdk.d.ts` (:5183, :5373, compact boundary/status types), `sdk.mjs` (autoCompactWindow zod); product sources listed in §6; log corpus `C:\Users\abdal\AppData\Roaming\Ptah\logs` (62 files).

External sources relied on via reports 01/03/04 (accessed 2026-09-09/10; not re-fetched for this report): Anthropic Agent SDK documentation (https://docs.anthropic.com/en/api/agent-sdk/), anthropics/claude-code issue #65585 (https://github.com/anthropics/claude-code/issues/65585), Claude Code changelog for the v2.1.221 `--autocompact` floor. Treat version-conditional external facts as report-verified, not independently re-verified here.

---

## 10. Coverage Limitations

- Research only. **No tests were run, no build was executed, and no live compaction was triggered** by this work. The 09-09 burst events were triggered by other bridge sessions' normal work, not by this research.
- Log evidence is limited to what Ptah logs; SDK-internal decisions (e.g., actual auto-compact threshold used) are not logged and remain [U] until E2/E5.
- PostCompact pairing (§2.3) is timestamp-based inference; the PostCompact payload carries no session id.
- Provider attribution for burst sessions is unestablished (§8.1); the "auto-compact works on Ollama Cloud" claim is inference from session identity, not from per-session model logs.
- External documentation facts are cited from reports 01/03/04 and were not independently re-fetched in this session.
- The task carrier (`task.md`) was not modified; status is owned by the parent.