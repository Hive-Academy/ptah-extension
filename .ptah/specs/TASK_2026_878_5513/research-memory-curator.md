# Research: "Run curator now" does nothing (Electron)

Paths are relative to the worktree. Verified = read in source or logs. Unverified = inferred.

## 1. Verdict

The button is wired correctly end to end. The curator does run. For this user it fails every time, and the UI never says so.

- Every curator LLM call fails with `Codex chat requires a host with the native Codex runtime.`
- The click finishes "successfully" with no visible change.
- Evidence is in the Electron logs and the user's settings (section 3).

## 2. Click trace (verified)

| Step | Location | What happens |
|---|---|---|
| Button | `libs/frontend/memory-curator-ui/.../memory-diagnostics-accordion.component.ts:193-205` | Disabled if `loading() \|\| !hasActiveSession() \|\| paused()`. Only one curate button exists in the tab. "Refresh" at :221 only re-reads diagnostics. |
| Hint text | same file :206-220 | "Open a session to run curator manually" shows when no session. |
| State | `.../services/memory-diagnostics-state.service.ts:177-213` (`runNow`) | Checks workspace, `activeTab().claudeSessionId`, paused. Calls `rpc.runNow`, then `refresh()`. |
| RPC client | `.../services/memory-diagnostics-rpc.service.ts:54-66` | Calls `memory:runNow`. Throws on `isSuccess()` false. `PAUSED` becomes `MemoryPausedError`. |
| Host handler | `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:643-743` | Zod validation, workspace auth, pause check. Then `curator.curate({userInitiated:true})`. Pushes a `manual-run` event. Returns `{success:true, stats:{outcome,extracted,merged,created,skipped}}`. A thrown error returns `success:false` with `error`. |
| Electron DI | `apps/ptah-electron/src/di/phase-4-handlers.ts:132` registers `MemoryRpcHandlers`. Manifest at `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:422`. | Registered. The log line "RPC surface registered" appears at boot. |
| Curator | `libs/backend/memory-curator/src/lib/memory-curator.service.ts:472` (`curate`), then queue, `doCurate`, window runner | Reads the session transcript, splits it into windows, runs the LLM extract stage, then the resolve stage. |
| LLM route | `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:57,248-272` | Reads `memory.curatorProvider`. If set, resolves auth for that provider and runs an internal query on it. |
| Failure | `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts:340-375` (`recordError`) | Returns `outcome:'failed'` with zero counts. Sets `lastRunStats`. Pushes a `curator-error` event. |

Two findings in this trace:

1. The handler returns `success:true` even when `stats.outcome === 'failed'`. The code comment says `success` is reserved for thrown failures (handler :699-705).
2. The UI never reads `outcome`. `runNow` in the state service ignores the result and calls `refresh()`. The only feedback is the "Last curator run" label, which is `formatSnapshot` (accordion :355-372). It prints the first three stat keys (`outcome=failed, extracted=0, merged=0`) after a timestamp. That is easy to miss.

## 3. Root cause (verified in logs and settings)

- `~/.ptah/settings.json:96-99` has `memory.curatorProvider = "openai-codex"` and `curatorModel = "gpt-5.6-terra"`.
- `~/.config/Ptah/logs/Ptah Electron-2026-11-04.log` has 80 occurrences, and the 11-03 log has 72, of:
  - `[memory-curator] curator LLM query failed: {"error":"Codex chat requires a host with the native Codex runtime."}`
  - `curation pass failed; observations kept for a retry ... failures:N maxRetries:3`
  - then `failed after every retry; observations marked processed uncurated`.
- The 11-01 and 11-02 logs have zero such errors.
- The newest row in the `memories` table (`~/.ptah/state/ptah.sqlite`, opened read-only) has `created_at` 1793590247833, which is 2026-11-02 03:30 UTC. Nothing has been learned since the errors began.
- The same pattern hits idle, session-end and manual passes. Manual passes appear as `source` values in the same log lines.
- The error string is thrown only in `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:100-134`.
  - It throws when the serving provider is `openai-codex` and `nativeEnabled`, `this.native` or `this.admission` is falsy.
  - `nativeEnabled` comes from `RUNTIME_HOST_CAPABILITIES`, which defaults to `{nativeCodex:false}` in `libs/backend/agent-sdk/src/lib/wiring/codex-runtime-composition.ts:13`.
  - The Electron source sets both flags true (`apps/ptah-electron/src/di/codex-runtime-composition.ts:82-86`).

So the Codex route is rejected inside the curator's internal-query path.

**Open, unverified:**

- The failing logs come from the installed app at `/opt/Ptah/...`. It may be an older build than this worktree.
- Which of `nativeEnabled`, `native` or `admission` is falsy for the internal-query (non-chat) caller is not established. It may be a missing `consumer` or runtime argument from `sdk-internal-query`, or the capability binding for non-chat consumers. The smallest experiment is to run a source build in Electron with `curatorProvider=openai-codex` and click the button.

**Not the cause (verified):**

- The button is not stuck disabled. If it were disabled, the hint text would show. The log shows passes ran, though those were idle and session-end passes, so this does not prove the button was enabled.
- The `PAUSED` path has its own visible notice.
- RPC registration is fine.

**Why "nothing happens", plainly:** the click runs a pass, the pass fails fast in milliseconds, and the UI shows a spinner for a moment. After `refresh()` it shows a small stats string. No toast, no error banner, no reason shown.

**Caveat on `hasActiveSession`** (`memory-diagnostics-state.service.ts:58-61`): it needs `tabManager.activeTab().claudeSessionId` to be non-null. A fresh tab before the first turn, or a non-chat view, disables the button and shows the hint. Whether that applies to this user is unverified. Even when it holds, the curator can only work on the active tab's session, not "all uncurated sessions".

## 4. How memory learning works (partly verified, partly from UI labels)

Verified from the DB schema and the UI:

- **Triggers** are the toggles in the accordion (:61-120):
  - idle timer (ms)
  - turn threshold
  - boot scan
  - PostToolUse hook
  - turn-complete (Stop hook)
  - error-to-recovery episodes
  - session-end flush
  - UserPromptSubmit cues (min prompt length, plus a read-only cue list)
  - max curates per hour
- Hooks record observations into an observation queue (`observation-queue.store.ts`). `MemoryTriggerService` drains it and calls `curate` per session. The log shows `source:"idle"` and `source:"session-end"` with `observations:N` counts.
- **Failure handling** (`curator-activity-log.ts:40-60`):
  - `ran`: observations are consumed.
  - `stalled`: input was never read, so observations stay.
  - `failed`: observations are kept for a bounded number of retries (`maxRetries:3`). After that they are marked "processed uncurated", meaning the learning is lost. This is happening now for this user.
- **Extraction:**
  - The transcript is compressed and split into windows (up to 8, a 262144-char cap).
  - An LLM extracts draft memories (stage `extract`).
  - A resolve stage merges the drafts with related existing memories. The merge candidates are collected by `merge-candidate-collector.ts`.
  - The result counts are extracted, merged, created and skipped.
- **Storage** (`memories` table, read-only):
  - Tiers in the user's DB: `core` 2 and `recall` 669. Total 671.
  - Kinds: fact 555, preference 65, event 48, entity 3.
  - Columns: `salience`, `decay_rate`, `hits`, `pinned`, `expires_at`, `archived_at`, `quarantined_at`.
  - There are FTS and vec chunk tables (`memory_chunks`, 1124 rows).
  - Retention code is in `libs/backend/memory-curator/src/lib/retention/` and `salience-ranking.ts` (not read in depth).
- **Reaching a session** (unverified detail): `memory-search.service.ts` provides hybrid BM25 plus vector search. It is exposed via the `memory:search` RPC and the `ptah.memory` namespace for MCP tools (`memory-namespace.builder.ts`). I did not trace automatic injection into prompts.

## 5. Observability gaps

What the accordion shows today:

- One "Last curator run" line (timestamp plus the first three stat keys).
- Trigger toggles.
- The curator model.
- `ptah-event-feed` (recent events, from a ring of 200 on the host, `RING_CAPACITY` in `curator-activity-log.ts`).
- DB and storage health.
- A generic `error` alert.

Gaps:

1. The `runNow` result's `outcome` is dropped. There is no toast, and no inline "failed because X".
2. `curator-error` events do carry text (`memory extraction failed: ...`), but the feed is a flat list. There is no per-run row with outcome, reason, counts and duration, and no link between a click and its outcome.
3. `recordError` flattens the real cause. The log has the Codex message; the user-facing error is "could not complete its language-model query".
4. The curator model card shows "openai-codex -> gpt-5.6-terra" with no health or last-error indicator.
5. The state is in-memory only (200 events, lost on restart). Nothing persists run history.
6. No pre-flight check. The button does not test whether the curator route is usable before running.
7. The "Max curates per hour" budget and the retry-exhaustion "processed uncurated" outcome are not surfaced.

Existing tests on this path (not run):

- `memory-diagnostics-state.service.spec.ts`
- `memory-diagnostics-accordion.component.spec.ts` (713 lines)
- `memory-diagnostics-rpc.service.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.spec.ts`
- `memory-curator.service.spec.ts`
- `sdk-internal-query.curator-llm.spec.ts`
- `routing-agent-adapter` has specs in agent-sdk.

I did not check whether any test covers `outcome:'failed'` being shown in the UI. A grep for `outcome` in the frontend lib would answer that.

## 6. How to evaluate: `tools/mcp-bench/src/memory-skills`

- This is a benchmark harness for memory and skills quality. It has suites for memory, skills and audits (`suites/{memory,skills,audits}`).
- It has ground-truth labelling, matching, metrics, baselines and recorded cassettes. Labels come from a cross-family model panel, not humans (`tools/mcp-bench/README.md`). Metrics such as `mem.extraction` stay `na` until the matcher gate is met.
- It runs offline suites by default (`runner/offline-suites.ts`). Live cassettes are recorded through the openai-codex provider with gpt-5.6-terra.
- Run it with Nx target `bench-memory-skills` (`tools/mcp-bench/project.json:333`). It builds `memory-skills-host.mjs`, bundles the runner with esbuild, then runs `node dist/tools/mcp-bench/run-memory-skills.mjs`.
- CLAUDE.md forbids build targets unless the user asks, so run it only on request. Its unit specs (`run-memory-skills.spec.ts`, `case-runner.spec.ts` and others) can run with `npm run verify -- -t test -p mcp-bench`. I have not confirmed the exact project name.
- It measures extraction and skills quality offline. It does not exercise the Electron UI button or the live provider route, so it would not have caught this bug.

## 7. Fix proposal

1. **`libs/frontend/memory-curator-ui/.../memory-diagnostics-state.service.ts`**
   - Keep the `rpc.runNow` result. Expose a `lastManualResult` signal with `outcome`, counts, an error message and a timestamp.
   - Treat `outcome === 'failed'` or `'stalled'` as `_error`, with text such as "Curator ran but failed: <reason>".
   - Treat `ran` with zero extracted as "Nothing new to learn".
2. **`libs/frontend/memory-curator-ui/.../memory-diagnostics-rpc.service.ts`**
   - Return `result.data`. If `success === false`, throw `Error(result.data.error)`. Today the mapping is correct for RPC errors, but verify that a `success:false` body is not treated as success.
3. **`memory-diagnostics-accordion.component.ts`**
   - Add a status line under the button showing the last manual result: outcome, counts, time, and the error with a "see events" hint.
   - Replace the raw `k=v` stats string in `formatSnapshot` with outcome-aware wording.
   - In the event feed, show `curator-error` rows prominently, with a link to the model settings for provider errors.
4. **`libs/backend/rpc-handlers/.../memory-rpc.handlers.ts`**
   - Add `error` and `reason` fields (the last curator-error message) to `runStats` when `outcome === 'failed'`. This needs a small change to the `MemoryRunNowResult` type in `libs/shared`, or keep it in the string-valued `stats` map.
5. **`libs/backend/memory-curator/.../curator-activity-log.ts`**
   - Preserve the underlying cause (`detail`) in the `curator-error` event and in `lastRunStats`. Today the user sees only the generic LLM-query message.
6. **Root cause for Codex (agent-sdk, apps/ptah-electron)**
   - Find why the internal-query path reaches `RoutingAgentAdapter.startChatSession` with `nativeEnabled` or `native` falsy. Check the `consumer`/`runtime` args from `sdk-internal-query.curator-llm.ts` and the capability binding in `libs/backend/agent-sdk/src/lib/di/register.ts:1070-1090`.
   - Confirm that the current source works in Electron before changing anything. The installed build may be stale.
   - As a stopgap, a fallback to the main-agent route when the curator route fails admission would keep learning going.
7. **Tests:** add a state-service spec for `outcome:'failed'` and `'stalled'`, an accordion spec for the status line, and a handler spec that `failed` carries a reason.

Not investigated: the retention/decay algorithm, automatic prompt injection of memories, and Skills tab actions.
