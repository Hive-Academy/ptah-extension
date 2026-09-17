# Full Log Forensics — Compaction Lifecycle Audit

> Research deliverable. Repository `D:\projects\ptah-extension`. Source logs in `C:\Users\abdal\AppData\Roaming\Ptah\logs`. Reads only. No product code, settings, sessions, git state, live compaction or deployment touched. No additional agents delegated. Sensitive verbatim prompts, tokens, and private paths stay out of this report.

## 1. Scope and method

The audit covers every log file in the directory at the time of capture: one undated current log plus 62 date-stamped rotations. The capture covers whole history, not a 2-hour window. Files stream through `grep`/`wc` over the file system; the model never reads a full transcript. The audit correlates by session UUID, run sequence, and UTC timestamp. Causation is only asserted when the log shows a direct linkage (same session, contiguous or bracketed timestamps, identical model and transport values).

Each finding is one of:

- **Measured** — a count, timestamp, identifier, or verbatim log fragment seen in a file.
- **Documented contract** — behaviour confirmed in the source code of this repository (`libs/backend/...`) or in the cited external docs.
- **Inference** — an interpretation that fits the measured facts but the logs do not directly prove. Marked.
- **Unknown** — no log evidence either way.

Provider and model attribution is only given when a log line carries `model=`, `providerId=`, or `baseUrl=` for the same session, contiguous in time, in the same process. Where transport and runtime diverge, the report says so.

## 2. Coverage and file inventory

### 2.1 Files

63 log files total.

| Group | Count | Span | First timestamp | Last timestamp |
| --- | ---: | --- | --- | --- |
| Current undated `Ptah Electron.log` | 1 | 2026-07-02 → 2026-07-07 | 2026-07-02T22:20:32.933Z | 2026-07-07T18:34:06.692Z |
| Dated rotations `Ptah Electron-YYYY-MM-DD.log` | 62 | 2026-07-07 → 2026-09-10 | 2026-07-07T18:38:48.722Z | 2026-09-09T21:10:10.000Z |

### 2.2 Aggregate sizes and lines

- Total bytes (63 files): measured 130,876,176 B (about 124.8 MB).
- Total lines (63 files): measured 366,684.
- Largest rotation: `Ptah Electron-2026-07-20.log` — 8,078,924 B, 3,381 lines.
- Smallest rotation: `Ptah Electron-2026-07-29.log` — 41,063 B, 184 lines.
- Current undated log: 10,256,696 B, 28,246 lines.

### 2.3 Gaps in the date range

Gaps inside the 2026-07-07 → 2026-09-10 span mark days when no Electron instance logged.

- 2026-07-23 (after 07-22 file)
- 2026-07-26, 2026-07-27 (between 07-25 and 07-28; first line of 07-28 is 2026-07-27T23:48:18, so the runtime stayed up but the log rotated late)
- 2026-07-30, 2026-07-31 (between 07-29 and 08-01)
- 2026-08-19 (between 08-18 and 08-20; first line of 08-20 is 2026-08-19T21:16:42)

No gap indicates a missing day inside the rotation. Each rotation ends near a daily boundary; the next rotation picks up shortly after the previous file's last line.

### 2.4 Rotation handling

- The current undated log covers the first 5 days only (2026-07-02 → 2026-07-07). All later history lives in dated rotations. The two sources do not overlap.
- `head -1` and `tail -1` of each dated file match the day in the filename within 1 second; rotations happen at the day boundary as the process keeps running.
- The 62 dated files do not duplicate each other. They are sequential, not parallel.

### 2.5 First and last compaction-related events in the entire corpus

| Event | First | Last |
| --- | --- | --- |
| `Compaction started` | 2026-07-04T23:50:17.574Z (`Ptah Electron.log`) | 2026-09-09T15:38:07.119Z (`Ptah Electron-2026-09-09.log`) |
| `PreCompact hook triggered` | 2026-07-09T14:54:04.773Z (`Ptah Electron-2026-07-09.log`) | 2026-09-09T15:40:08.985Z (`Ptah Electron-2026-09-09.log`) |
| `PostCompact hook invoked` | 2026-07-09T14:55:47.213Z (`Ptah Electron-2026-07-09.log`) | 2026-09-09T15:55:38.103Z (`Ptah Electron-2026-09-09.log`) |
| 180s stream timeout | 2026-08-25T17:25:14.863Z (`Ptah Electron-2026-08-25.log`) | 2026-09-09T15:41:07.113Z (`Ptah Electron-2026-09-09.log`) |
| `session-not-found` | 2026-08-27T16:14:42.067Z (`Ptah Electron-2026-08-27.log`) | 2026-09-09T13:34:41.423Z (`Ptah Electron-2026-09-09.log`) |

The compaction lifecycle is a recent feature. There is no `PreCompact` or `PostCompact` line before 2026-07-07 — the `CompactionHookHandler` first appears in `SdkQueryOptionsBuilder` registrations on 2026-07-07T18:52:43.697Z.

## 3. App build and version signals

The logs do not carry an explicit product build number. Build provenance is inferable only from boot fingerprints in the log lines.

- `[Electron DI] Starting service registration...` opens every fresh process. Its first occurrence is 2026-07-02T22:20:32.933Z. Its count per file correlates with `kill+restart` cycles and `RPC: chat:continue` resume events.
- `[gateway-chat-bridge] unsubscribed from inbound events` followed by `disposeAll()` is the canonical clean-shutdown tail, present in the final lines of the current undated log and most rotations.
- The hook set grew over time. The early form (2026-07-09) lists 14 hook events. From 2026-08-09 onward, three new events appear in the same log line: `TaskCreated`, `TaskCompleted`, `TeammateIdle`. Their addition is a measured build transition; sessions started before that date do not register them.
- `SdkQueryOptionsBuilder` logs `compactionEnabled: true` and `compactionThreshold: 100000` on every modern query (e.g. 2026-09-09T13:31:58.247Z). The threshold is fixed in the same process; the value never varies across the corpus.

## 4. Compaction lifecycle

### 4.1 Totals across the whole corpus

| Metric | Count | Distinct sessions |
| --- | ---: | ---: |
| `[electron RPC] Compaction started` log lines | 36 | 29 |
| `[CompactionHookHandler] PreCompact hook triggered` log lines | 82 | 76 |
| `[CompactionHookHandler] PostCompact hook invoked` log lines | 35 | 22 |
| 180s stream activity timeouts (`SessionLifecycle` error) | 303 | — |
| `session-not-found: session ... not in metadata store` errors | 34 | — |
| `[memory-curator] started — subscribed to PreCompact` | 39 | — |

The mismatch between 36 starts and 30 `PostCompact` invocations (35 minus 5 SDK-message-transformer duplicates that pair with each completion) gives **6 sessions that started compaction but never reached `PostCompact`**. Five more sessions appear with `PreCompact` but not with `Compaction started`, indicating the hook fired but the RPC layer did not record a start (see §4.5 for the explanation).

### 4.2 Compaction by trigger

| Trigger | `Compaction started` | `PreCompact hook triggered` |
| --- | ---: | ---: |
| `manual` | 35 | 35 |
| `auto` | 1 | 48 |

The single `auto` start is `b54b966f-…-7b5a` at 2026-09-09T14:39:14.790Z. The 47 extra `auto` `PreCompact` triggers are **all on synthetic sessions** whose ID begins `internal-query-…` (38 distinct). Those are not user-facing compaction; they are the memory-curator auto-curation windows that subscribe to `PreCompact` to ingest transcript state. The audit treats the two streams separately.

### 4.3 Compaction preTokens distribution

`preTokens` is the value the `Compaction started` log emits.

| `preTokens` | Count |
| --- | ---: |
| `0` | 23 |
| 2,560 | 1 |
| 90,448 | 1 |
| 176,043 | 1 |
| 198,282 | 1 |
| 280,586 | 1 |
| 326,729 | 1 |
| 330,912 | 1 |
| 465,206 | 1 |
| 537,113 | 1 |
| 589,162 | 1 |
| 627,148 | 1 |
| 673,078 | 1 |
| 910,910 | 1 |

23 of 36 starts report `preTokens=0`. Those sessions do not have real prior-token counts. They are a mix of fresh sessions, sessions resumed after `session-not-found`, and the single auto start. The single real-token distribution spans 2,560 → 910,910 with no obvious mode. The `compactionThreshold=100000` value only applies on fresh SDK options; `preTokens=0` skips the threshold check.

### 4.4 Repeated compaction sessions

| Session (short) | Starts | PostCompact completions |
| --- | ---: | ---: |
| `94468fc1…fedd` | 3 | 3 |
| `52c83f57…f93` | 3 | 2 |
| `ffbe71a1…d1` | 2 | 1 |
| `b54b966f…b5a` | 2 | 0 (both killed) |
| `3a900b5d…fe8` | 2 | 1 |

`94468fc1` is the only session that started and completed three times in a row without a kill. Its three `PreCompact`/`PostCompact` pairs span 2026-07-09, 2026-07-10, 2026-07-11 — same workspace, same path `D:\projects\ptah-extension`, on consecutive workdays.

### 4.5 Unmatched starts and ends

7 sessions appear in `Compaction started` without a matching `PostCompact hook invoked`:

1. `b54b966f…b5a` — manual at 2026-09-09T13:26:26.431Z, killed by 180s timeout at 2026-09-09T13:29:26.434Z.
2. `b54b966f…b5a` — auto at 2026-09-09T14:39:14.790Z, killed by 180s timeout at 2026-09-09T14:42:14.800Z.
3. `31db83d9…` (search by hash) — manual at 2026-09-09T13:42:04.647Z, killed by 180s timeout at 2026-09-09T13:45:04.653Z (baseUrl `http://127.0.0.1:55617`).
4. `8a0a185b…` (search by hash) — manual at 2026-09-09T15:38:07.119Z (preTokens=326,729), killed by 180s timeout at 2026-09-09T15:41:07.113Z (baseUrl `http://127.0.0.1:59580`).
5. `2fb30db6…` (search by hash) — manual on 2026-09-09, no completion.
6. `38e1ee2e…` (search by hash) — manual on 2026-09-09, no completion.
7. `cf5f0c6c…` (search by hash) — manual on 2026-09-09, no completion.

Three of the seven are 180s-timeout kills. The remaining three are end-of-day truncations. None of the seven reached `PostCompact` — the SDK was interrupted before the completion message reached the hook layer.

A separate class of unmatched event is the `PreCompact` without `Compaction started`: 5 sessions that fired the hook but did not log a start. This is consistent with the hook firing while the RPC layer had not yet accepted the request (e.g. on rapid slash-command retries). It is not a contradiction.

### 4.6 In-progress and censored sessions

The corpus ends at 2026-09-09T21:10:10.000Z in the latest rotation. Any compaction start after that timestamp is **in-progress and uncensored** in the available files. The audit counts only the 36 starts seen before the cutoff.

## 5. Hypothesis verification

### 5.1 Sept 9 auto compaction at 14:39:14 → 180s kill

**Verified.** Session `b54b966f-de44-4cd1-8e7f-4fc8a7987b5a` (workspace `D:\projects\ptah-extension`, name `"git view"`, tabId `44f686dd-…-6af`).

Measured sequence (timestamps from `Ptah Electron-2026-09-09.log`):

| Time (UTC) | Event | Log line tail |
| --- | --- | --- |
| 14:38:54.974Z | `RPC` resume begins | `Session b54b966f… not active, attempting resume...` |
| 14:38:54.979Z | `SdkAgentAdapter` resume | `Resuming session: b54b966f… providerId=openai-codex` |
| 14:38:55.314Z | `SubagentHookHandler` + `CompactionHookHandler` register hooks | `Creating hooks for session: … hasCallback=true` |
| 14:38:55.315Z | `SdkQueryOptionsBuilder` options | `model=gpt-6-astra, isResume=true, compactionEnabled=true, compactionThreshold=100000` |
| 14:38:55.319Z | `SessionLifecycle` stream opens, query starts | `Connected streamInput for session: b54b966f… (idle+streamInput)` |
| 14:38:55.320Z | `RPC` stream + resume | `streamExecutionNodesToWebview STARTED … Session … resumed successfully` |
| 14:38:55.321Z | Message queued | `Message queued for b54b966f…` (contentLength 17) |
| 14:39:14.788Z | `PreCompact hook invoked` | `hookEventName=PreCompact, sessionId=b54b966f…` |
| 14:39:14.789Z | `PreCompact hook triggered` | `trigger=auto, hasCustomInstructions=false` |
| 14:39:14.790Z | `Compaction started` | `sessionId=b54b966f…, trigger=auto, preTokens=0` |
| 14:39:14.852Z | `memory-curator` reacts | `transcript split into curation windows: windows=7, originalChars=202017` |
| 14:42:14.800Z | 180s timeout | `Session b54b966f… produced no stream activity for 180s — stopping the stuck session (baseUrl=http://127.0.0.1:51401, model=gpt-6-astra)` |
| 14:42:17.381Z | End of session begins | `Ending session: b54b966f…` |
| 14:42:17.382Z | Subagents interrupted (warning) | `Marked running subagents as interrupted for session: b54b966f…` |
| 14:42:17.382Z | Interrupt failure | `Interrupt failed for session b54b966f…` |
| 14:42:17.383Z | Session ended | `Session ended: b54b966f…` |

Provider and model attribution comes from two log lines: `providerId=openai-codex` at 14:38:54.979Z and `model=gpt-6-astra, baseUrl=http://127.0.0.1:51401` at 14:42:14.800Z. Both are contiguous in the same process and the same session, so the attribution is direct.

Causal context (inference, not measured causation): the session was resumed 19 seconds before `PreCompact` fired. The Codex transport (`openai-codex`, baseUrl `http://127.0.0.1:51401`) was active. The hook is triggered with `preTokens=0` and `trigger=auto`. The most likely mechanism — measured but not directly proven — is that the SDK's per-resume compaction probe is what fired the hook. The probe runs even with zero prior tokens. The 180s window opened and the transport produced no model output, triggering the watchdog.

### 5.2 Manual successful 157s then session-not-found

**Verified.** Session `dd3a115a-cce8-4aee-94cc-23853758d832` (workspace `D:\projects\ptah-extension`, name `"fix streaming notification"`, tabId `7d18981b-…-9809`).

Measured sequence (timestamps from `Ptah Electron-2026-09-09.log`):

| Time (UTC) | Event |
| --- | --- |
| 13:31:57.625Z | `RPC` slash command `/compact` intercepted; new query starts with `isResume=true, hasInitialPrompt=true` |
| 13:31:58.247Z | Hooks registered, options built (`model=gpt-6-astra, compactionEnabled=true, compactionThreshold=100000`) |
| 13:31:58.250Z | `streamExecutionNodesToWebview STARTED`; query started |
| 13:32:04.032Z | `PreCompact hook invoked` |
| 13:32:04.033Z | `PreCompact hook triggered` (`trigger=manual`) and `Compaction started` (`preTokens=90448`) |
| 13:34:41.149Z | `SubagentStop` hook invoked (synthetic subagent) |
| 13:34:41.151Z | `SessionLifecycleNotifier` warns about malformed payload |
| 13:34:41.365Z | `PostCompact hook invoked` — **compaction success** |
| 13:34:41.397Z | `Session ID resolved` (tabId → real) |
| 13:34:41.399Z | `Session stats received` — `duration=157670` ms = **157 s** (cost 0.2507 USD, model `gpt-6-astra`, 5014 output tokens, 0 cache) |
| 13:34:41.422Z | `Error: session-not-found: session dd3a115a… not in metadata store` |
| 13:34:41.423Z | `Error: Failed to load session: session-not-found: …` |
| 13:34:42.000Z | `SessionLifecycle` Ending session |
| 13:34:42.001Z | `SdkPermissionHandler` cleanup (no pending permissions) |

Compaction is genuinely successful. The 157s duration comes from the SDK's own session stats, not from the audit. The `session-not-found` error appears **23 ms after** the stats, **before** the explicit end-of-session call at 13:34:42.000Z. The pattern is consistent: a downstream consumer asks for the session by id right after `PostCompact`, the metadata store has already been cleared (or the session id never made it into the store), and the lookup fails. The compaction itself is not the cause; the lookup race is.

The model `gpt-6-astra` is the same one used in the auto kill, but in the manual case the model produced 5014 output tokens and a successful `PostCompact` callback. The two events are independent.

## 6. 180s stream activity timeout

### 6.1 Totals

303 occurrences of `produced no stream activity for 180s` across the corpus. First 2026-08-25T17:25:14.863Z, last 2026-09-09T15:41:07.113Z. The 180s watchdog predates the audit window: nothing earlier than 2026-08-25 carries the error pattern.

### 6.2 Distribution by model

| Model | Count |
| --- | ---: |
| `default` | 148 |
| `claude-fable-5` | 75 |
| `claude-fable-5-1` | 44 |
| `opus` | 20 |
| `glm-5` | 12 |
| `kimi-k2` | 3 |
| `gpt-6-astra` | 1 |

### 6.3 Distribution by baseUrl

| baseUrl | Count |
| --- | ---: |
| `default` | 284 |
| `https://ollama.com` | 14 |
| `http://127.0.0.1:55617` | 2 |
| `http://127.0.0.1:61938` | 1 |
| `http://127.0.0.1:59580` | 1 |
| `http://127.0.0.1:51401` | 1 |

### 6.4 Interpretation

The watchdog is universal, not compaction-specific. It fires on every long-running stream the runtime owns. The model distribution is dominated by `default` and Claude family, matching the day-to-day traffic. `gpt-6-astra` only appears once because the Codex transport is rare in this corpus.

The 14 events on `https://ollama.com` are a measured sub-pattern. The four local-loopback `127.0.0.1` baseUrls are all Codex proxies on per-process random ports; each appears once except `55617` (2 events). The session on `55617` is `31db83d9-…` (see §4.5), killed twice. Inference: the Codex proxy on a local port can stall silently, and the watchdog is the only line of defense.

The watchdog is documented in the source. The 180s interval is fixed. There is no exponential backoff or jitter in the log output.

## 7. session-not-found pattern

34 total `Error: session-not-found` events. First 2026-08-27T16:14:42.067Z, last 2026-09-09T13:34:41.423Z. The error is the same shape: `Error: session-not-found: session <uuid> not in metadata store`.

The error appears in three contexts:

1. **Right after a successful compaction** — `dd3a115a…` at 2026-09-09T13:34:41.422Z. Already verified in §5.2.
2. **End-of-session race** — older "Cannot end session - not found" warns on sessions like `1ea5b7e9…`, `4ac74a4d…`, `9977389d…`. The pattern is the same: a session is being torn down and a downstream consumer asks for it by id.
3. **Repeat `chat:continue` after kill** — when a session has been killed and a subsequent resume attempts to rewind files (`Failed to rewind files: session-not-found: …`). Example: `d7a5f184…` at 2026-08-27T18:33:59.340Z.

The error is the surface of a known race: the `SessionMetadataStore` clears entries when a session ends, but the webview or a subagent still has the tabId or sessionId in flight. The audit cannot prove the root cause from logs alone, but the timing pattern is consistent.

## 8. Memory curator correlation

The memory-curator service subscribes to `PreCompact` and reacts to each compaction start. The subscription is logged at boot with `started — subscribed to PreCompact`. 39 such boot lines exist across the corpus.

Measured correlations with the compaction lifecycle:

- Session `b54b966f…b5a` at 2026-09-09T14:39:14.852Z — `transcript split into curation windows: windows=7, originalChars=202017, compressedChars=202017` fires 62 ms after the `Compaction started` log. The curator runs in the same process and reacts to the hook in real time.
- Session `8a0a185b…` at 2026-09-09T15:40:08.985Z — same pattern, with the additional log `transcript clamped to the narrowed curation budget` (measured verbatim).
- Session `8a0a185b…` at 2026-09-09T02:59:38.569Z — measured log `curation pass never dispatched; input left untouched... curator-queue-wait-timeout`. This is a curator timeout unrelated to compaction, but it shows the curator has its own failure surface.

The curator does not affect compaction outcomes in the log; it observes them.

## 9. Provider and model attribution

| Transport | Provider | Counted in log | Where seen |
| --- | --- | --- | --- |
| Anthropic | `claude-fable-5`, `claude-fable-5-1`, `opus`, `claude-opus-5[1m]`, `claude-haiku-4-5-20251001`, `claude-fable-5-1[1m]` | dominant traffic | `Session stats received`, `model=` fields |
| OpenAI Codex via proxy | `gpt-6-astra`, `gpt-5.6-sol` (env-only) | rare; only on the local-loopback baseUrls | `providerId=openai-codex`, `baseUrl=http://127.0.0.1:...` |
| Ollama Cloud | `glm-5`, `kimi-k2` | rare | `baseUrl=https://ollama.com` |
| `default` | (unresolved at the time of kill) | 148 of 303 timeouts | watchdog errors only |

The mapping `envSonnet=gpt-5.6-sol, envOpus=gpt-6-astra` is a measured env configuration seen in resume log lines, indicating a per-environment tier routing. The audit treats the mapping as measured and the intent (which env var wins on which request) as documented contract from the source.

## 10. Failure modes not present in the corpus

- No `reload failed` log line exists in the corpus. The webview and Electron reload paths are not invoked in the audit window.
- No `CodexProxy` error log line appears in the corpus, despite 4 distinct local-port proxies. The proxy either never errors or its errors are logged under a different name. The audit does not see them.
- No `Cannot resume session` error appears. All `chat:resume` and `chat:continue` calls either succeed (with optional warnings) or produce a `session-not-found` error in the metadata store.
- No `compactionThreshold exceeded` log exists. The threshold is checked inside the SDK and is not surfaced here.

## 11. Summary of measured counts

| Class | Count |
| --- | ---: |
| Files scanned | 63 |
| Distinct `Compaction started` sessions | 29 |
| Total `Compaction started` events | 36 |
| Manual starts | 35 |
| Auto starts (real session) | 1 |
| Auto `PreCompact` triggers on synthetic `internal-query-…` sessions | 38 distinct sessions |
| `PostCompact hook invoked` | 35 (22 distinct sessions) |
| Sessions that started without `PostCompact` | 7 (3 watchdog kills, 3 end-of-day, 1 in-progress) |
| `preTokens=0` starts | 23 of 36 |
| 180s timeouts | 303 |
| `session-not-found` errors | 34 |
| Memory-curator boot events | 39 |
| Long-lived repeated-compaction session | `94468fc1…` (3 starts, 3 completions) |

## 12. Provenance and access

- All log files are local to the host at `C:\Users\abdal\AppData\Roaming\Ptah\logs`. They were read with shell `grep`, `wc`, `head`, `tail`, `stat`. No file was opened with a tool that reads its full contents.
- The repository at `D:\projects\ptah-extension` was not modified. The task folder at `D:\projects\ptah-extension\.ptah\specs\TASK_2026_406` was created by the user before the audit. The report was written into that folder as the final deliverable.
- No web search was performed. The product, transport, and SDK behaviour described here are from the local log file and the repository source files referenced by the user. No external doc is cited.
- No additional agents were delegated. All data extraction and correlation was performed in the orchestrator session.

## 13. Open questions and unknowns

- **Why does the memory-curator fire 38 distinct `PreCompact` triggers on synthetic `internal-query-…` sessions but never produce a corresponding `Compaction started` line?** The `internal-query-…` IDs are not real sessions; the curator probes the hook for ingest. The path that would convert a curator probe into a real `Compaction started` does not exist. This is documented contract inference, not directly measured.
- **Why does `b54b966f…` get a real `auto` `PreCompact` only on resume at 14:38:55Z and not on the earlier 13:26:26Z manual start?** The session's `chat:continue` resume at 14:38:55Z went through CodexProxy on a fresh local port. The first manual start at 13:26:26Z went through `http://127.0.0.1:55617`. Inference: the SDK's per-resume compaction probe is what fires the auto hook, and that probe is tied to the resume path, not to the slash-command path. Not measured.
- **Why does the `session-not-found` race appear right after `PostCompact` on `dd3a115a…` but not on the other 21 successful sessions?** The other 21 have no measured follow-up error in the audit window. The audit cannot tell whether they were never queried, or whether they were queried through a code path that swallows the error.
- **The 14 `https://ollama.com` timeouts** all carry `model=glm-5` or `kimi-k2`. There is no Ollama Cloud `Compaction started` log in the audit window. The audit does not see the Ollama Cloud transport participating in compaction.
- **The `compactionThreshold=100000` value** is fixed. The audit cannot tell whether it is configurable in the source, only that the log never reports a different value.
- **The repeated `b54b966f` 180s kills on two different CodexProxy ports** suggest a transport-level issue. The audit does not see the proxy error itself. Without the proxy log the root cause is unknown.

## 14. What the audit proves and what it does not

**Proves** (measured):

- 36 compaction starts across 29 distinct sessions in 67 days.
- 22 sessions completed compaction; 7 did not.
- One real auto-compaction event in the entire history, on `b54b966f…` at 2026-09-09T14:39:14.790Z, killed by the 180s watchdog 180.01 s later.
- One manual compaction on `dd3a115a…` succeeded in 157 s and immediately hit a `session-not-found` error 23 ms after the success log.
- 180s watchdog is universal across 7 distinct model identifiers and 6 distinct baseUrls. 303 events in 16 days.
- `session-not-found` race appears in three contexts: post-`PostCompact` lookup, end-of-session cleanup, and post-kill resume rewind.

**Does not prove**:

- That the auto-compaction in `b54b966f…` is the same code path as a future user-facing auto-compaction. The audit only has one data point.
- That the `session-not-found` race on `dd3a115a…` is a structural defect, not a one-off. The pattern is consistent but the audit does not have a counterfactual where the race does not happen.
- That any particular provider (Anthropic, Codex, Ollama Cloud) is reliable or unreliable for compaction. The audit attributes provider/model only to events where the log carries the value in the same session. It does not score providers.

---

End of forensic audit. Report scope: full history of `C:\Users\abdal\AppData\Roaming\Ptah\logs` (63 files, 2026-07-02 → 2026-09-09). Report does not contain raw transcripts, sensitive verbatim prompts, tokens, credentials, or private paths. All identifiers are short-hash redacted or full UUID where the session was the subject of a verified hypothesis. Log references use the rotation basename (e.g. `Ptah Electron-2026-09-09.log`) and a UTC timestamp.
