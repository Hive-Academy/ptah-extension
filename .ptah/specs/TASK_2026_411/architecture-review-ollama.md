# TASK_2026_411 — Independent Architecture Review (Ollama)

Reviewer: glm-5.3:cloud (Ollama), independent adversarial pass over `implementation-plan.md`.
Scope: read-only. No source, plan, profile, credential, process, commit, or remote state was changed.
All SDK claims were verified against the pinned `@anthropic-ai/claude-agent-sdk` 0.3.150 in the main checkout (`D:/projects/ptah-extension/node_modules/...`; this worktree has no `node_modules`).

---

## Verdict: BLOCK

Two findings block implementation. Both sit on the load-bearing premise of the plan and would ship a feature that does not work, or does not fix the incident:

- **F1** — Section E wires compaction control through `Options.compactionControl`, which the pinned SDK does not forward to the CLI transport. The setting is inert on every Ptah path.
- **F2** — Section A does not incorporate the requested correction: per-key sharding leaves `ptah.sessionMetadata` as one ~128 MB key that is re-serialized on the main thread on every turn.

Sections B and C are sound (C is smaller than the plan states). Section D and the storage protocol need targeted revisions (F3, F4) but are not fundamentally wrong.

---

## F1 — Compaction: `Options.compactionControl` is the wrong seam (BLOCKER)

**Plan claim (line 186, 312):** "The pinned Claude Agent SDK already exposes `Options.compactionControl`, and the CLI-agent spawn path already passes it."

**Verified facts (pinned SDK 0.3.150):**

1. `compactionControl` is **not typed** in `sdk.d.ts` — it appears nowhere in the type surface. The CLI-agent path compiles only because `ptah-cli-registry.ts:750` passes it inside an object cast `as Options` (`ptah-cli-registry.ts:753`). "Already compiled" is true; "supported" is not.
2. In `sdk.mjs` runtime, `params.compactionControl` is consumed only by the in-process `BetaToolRunner` loop (`if (!Q || !Q.enabled) return !1; ... if (J < Y) return !1;`), which then calls `this.client.beta.messages.create` directly. That loop runs only when the SDK drives the model in-process.
3. Both Ptah paths use `ProcessTransport` (the SDK spawns the Claude CLI subprocess). `ProcessTransport.initialize()` destructures roughly forty options to build the CLI argv. **`compactionControl` is not among them** — it is silently dropped. `settings` is forwarded as `--settings <json>`; `extraArgs` passes through.
4. The same runtime emits: `console.warn('Anthropic: The compactionControl parameter is deprecated and will be removed in a future version. Use server-side compaction instead by passing edits: [{type: "compact_20260112"}] ...')` (same code in `bridge.mjs` / `assistant.mjs`).
5. The typed, forwarded seam in this SDK version is `Options.settings.autoCompactEnabled?: boolean` (`sdk.d.ts:5373`) and `Options.settings.autoCompactWindow?: number` (`sdk.d.ts:5183`) — carried to the CLI via `--settings`.

**Failure scenario:** The user disables compaction in settings. Plan Section E passes `{ enabled: false, contextTokenThreshold }` on the interactive path (`sdk-query-options-builder.ts:762-773` today only logs it). `ProcessTransport` drops the field. The CLI subprocess keeps its native auto-compaction. The user sees compaction still firing; the setting is a no-op; the acceptance test "Captured SDK options contain enabled/disabled threshold exactly as configured" (line 297) passes anyway because it inspects the options object, not the CLI argv. The same inertness applies to the CLI-agent path even after the plan fixes the disabled→`undefined` defect (`ptah-cli-spawn-options.service.ts:221-227`) — `enabled: false` is equally dropped by the transport.

**Recommended fix:**

- Replace the Section E mechanism with `settings.autoCompactEnabled` / `settings.autoCompactWindow` on both paths. Merge into the existing `settings` object the builder already forwards; do not add a second settings source.
- Change the acceptance test to assert the **effective CLI argv / `--settings` payload**, not the in-memory options object.
- Drop the "already compiled on the CLI-agent path" claim from "Supported now" (line 312); keep a note that `compactionControl` is deprecated in-process-only and must not be used.
- Keep plan lines 12 and 24 as they are — they are correct. Verified: the runtime threshold check (`J < Y`) runs before compaction starts, so the threshold changes *when* compaction fires, never *how long* the 213–216 s summarization takes.

---

## F2 — The requested session-metadata correction is not incorporated (BLOCKER)

**Plan claim (lines 76, 215):** "`SessionMetadataStore.getAll()` and agent-output reads use `getAsync()`" — reads only.

**Verified facts (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts`):**

1. Every session lives under ONE key, `STORAGE_KEY = 'ptah.sessionMetadata'`. The file's own comment says "every write re-serializes every session".
2. `stage`/`flush`/`settleWrite` coalesce turns, but the flush payload is the whole metadata blob under that single key.
3. `leanCliSessions` / `migrateRefOutput` already implement the durable-extraction pattern this review was asked to require: extract historical inline events into `ptah.agentOutput:<agentId>` keys FIRST, lean the reference, keep the fat reference if migration fails ("longer wins"), never delete output.

**Failure scenario:** Migration to v2 completes. Sharding fixes every small key. But a live streaming session stages its per-turn stats; the write chain serializes bytes "proportional to the changed key" (line 274) — and the changed key is the whole ~128 MB `ptah.sessionMetadata` blob. `JSON.stringify` of 128 MB on the Electron main thread is a multi-second freeze per turn. The incident the task exists to fix survives the entire storage rework. Additionally, plan line 76 says "`get()` lazily reads small compatibility values" — a lazy synchronous `get()` on the metadata key would parse 128 MB of JSON on the main thread on first hit.

**Recommended fix — write into the plan, as Section A acceptance criteria (this is the parent's requested correction, verbatim requirements):**

1. **Durable extraction, no deletion:** extend the existing `migrateRefOutput` pattern to session metadata. Historical inline events move into per-session durable keys before any lean happens; a failed extraction leaves the fat record in place; nothing is deleted.
2. **Lean aggregate:** `ptah.sessionMetadata` shrinks to a bounded per-session summary (identity, status, lean CLI references, aggregate usage). The per-session detail the UI lists comes from the per-session keys.
3. **Bounded large-value work off the main thread:** `getAsync()` must run parse in the storage worker, and writes of large values must serialize in the worker too. "Async-named" methods that still `JSON.parse`/`JSON.stringify` on main fail the gate. Add a test-matrix line: "no parse or serialize of a value larger than N bytes on the main thread, for reads OR writes" (line 273 currently gates reads and full-state stringify only).
4. Migration B1/B2 must include the metadata split, not just the storage format — otherwise B2's gate ("no workspace-state parse/stringify on main thread") can pass while the per-turn freeze remains.

---

## F3 — Section D: unverifiable source URL; account identity not pinned (HIGH)

**Verified correct in the plan:**

- The methods are real: `account/read`, `account/rateLimits/read`, `account/usage/read` exist in openai/codex `codex-rs/app-server-protocol/src/protocol/common.rs` ([protocol source](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs)); `account/usage/read` landed June 2026 ([commit 5e62c73](https://github.com/openai/codex/commit/5e62c73)). The plan already treats per-version availability as uncertain (line 320) — keep that.
- `provider:` prefix already exists in the shared contracts and the runtime allowlist, so `provider:getAccountUsage` needs no dual-registration change (plan line 234 correct).

**Findings:**

1. **Bogus citation (plan line 164).** `https://learn.chatgpt.com/es-419/docs/app-server` is not an OpenAI domain and is not a verifiable source. The methods happen to be real, but the plan's "Official OpenAI documentation" claim rests on a dead link. Replace the citation with the openai/codex repository files above; keep "uncertain" status for anything the repo does not show.
2. **Params must be omitted, not `{}`.** The app-server methods take no params; a `{}` params field can be rejected by strict servers. State this in the plan and let the Zod schemas on the RESPONSE side only.
3. **Identity not pinned (the review's explicit concern).** The plan never says the spawned `codex app-server` must resolve the SAME Codex home the proxy account uses. `codex-auth.service.ts:43` hardcodes `join(homedir(), '.codex', 'auth.json')`, while `harness-sync/src/lib/targets/mcp/codex-home.ts` knows `CODEX_HOME` relocates the entire Codex home. If `CODEX_HOME` is set, `codex app-server` reads `$CODEX_HOME/auth.json` while `CodexAuthService` reads `~/.codex/auth.json` — the surfaced account then does not match the chosen proxy account, silently.

**Failure scenario:** A user with a relocated Codex home opens the new "Provider account usage" card. It shows the rate limits of a different account than the one answering chats. No error is raised anywhere.

**Recommended fix:** resolve the Codex home once (honoring `CODEX_HOME`), derive both the app-server spawn env and the auth-file path from that single resolution, and add a fake-app-server test asserting the spawned env's `CODEX_HOME` equals the auth service's resolved home. Also fix `codex-auth.service.ts:43` to honor `CODEX_HOME` or document the mismatch as out-of-scope explicitly.

---

## F4 — Storage protocol: four gaps (HIGH, plan-revisable)

Section A's core design is right: manifest as the commit point, blob-before-manifest ordering, reclaim-after-commit, staging-directory rename, retained v1, no deletion. Verified against `electron-state-storage.ts` (whole-file sync load in the constructor, `JSON.stringify(this.data, null, 2)` per write — the incident is real) and `phase-1-infra.ts:99-102` (the registration hook point). The gaps:

1. **Post-migration corruption fallback silently loses v2-era writes (lines 62–63).** "Committed manifest with a missing/hash-invalid blob: reject v2 ... and retry from v1" is correct ONLY before the first post-migration write. After v2 has been live, v1 is a stale pre-migration snapshot: falling back to it discards every write since migration, presented to the user as recovery. The `materialize-v1` path (line 88) cannot rescue this case — it needs a valid v2, which is exactly what is corrupt. Fix: scope the v1-retry rule to "no post-migration mutation ever committed" (checkable from the journal); after that, corruption is a quarantine-and-surface event, never a silent v1 fallback.
2. **The rollback journal is underspecified and possibly redundant (lines 45, 72, 88).** Journal records "without value contents" (line 72) cannot reconstruct state by themselves; superseded blobs are reclaimed after manifest commit (line 74), so pre-update values exist nowhere either. Then what does the journal add over reading the committed blobs directly? Either (a) it exists to record mutation history the blobs no longer hold — then old blobs must be retained and the reclaim rule undoes it; or (b) the final state is fully derivable from committed blobs — then the journal is dead weight that grows without bound (200 persisted ref segments × per-turn stats writes). Fix: define the journal record content, its role in `materialize-v1` precisely, and a retention/compaction bound. If replay only needs the final state, drop the journal.
3. **Windows crash-durability is weaker than "deterministic" (lines 56, 60, 73).** Node's `fs.rename` has no `MOVEFILE_WRITE_THROUGH`; a flush+rename survives process death but a power-loss window remains where the rename itself is lost. The ordering invariants make every crash state *identifiable*, which is the real property. Fix: state the durability limit explicitly in the plan (rename-after-fsync = process-crash durable, not power-loss durable) so the test matrix does not promise more than the platform gives. File rename-over-existing works on Windows; directory rename to an existing destination fails — the generation-directory scheme avoids that, keep it.
4. **Sync-consumer semantics during migration are unspecified (lines 33, 76, 81).** `get()`/`keys()`/`update()` on the migrating workspace before `whenReady()`: the plan forbids user mutations (line 82) and holds concurrent updates (line 266), but never says what `get()` answers while v1 is unparsed on the worker — it cannot read v1 synchronously (that is the incident) so it must throw or return defaults. Fix: specify it in the `platform-core` interface doc — recommended: `get()` returns `undefined`/default and logs a degradation code until ready, and the readiness gate (line 33) covers every consumer that cannot tolerate that. `WorkspaceAwareStateStorage` (workspace-aware-state-storage.ts:95-113) must also define whether readiness forwards per-delegate or per-active-delegate, and what happens when the active workspace has no registered storage (today it warns and falls to default — the readiness answer must follow the same delegate, not mix).

---

## F5 — Section C: correct but smaller than stated (MEDIUM, no revision needed)

Verified against source:

- `responses-stream-translator.ts` — `emitFinalEvents` puts only `usage: { output_tokens }` on `message_delta` (lines 492–498); `ResponsesCompletedData.usage` lacks `input_tokens_details` (lines 65–74); `handleResponseCompleted` accumulates input tokens but never emits them. The plan's gap is real.
- The non-stream path already contains the exact mapping the plan proposes (`responses-stream-collector.ts:191-197`, including the `cached_tokens` subtraction and conditional `cache_read_input_tokens`). Reusing it as the shared helper is right.
- The plan's "update the local stream-event typing" (line 150) is stale: `stream-event.transformer.ts:258-304` already reads `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` from `message_delta` usage and feeds `LiveUsageTracker`; and `@anthropic-ai/sdk` 0.98.0's `MessageDeltaUsage` already types all four fields. No typing work is needed — only the translator emission changes.
- `LiveUsageTracker.recordSessionUsage` merges by per-field maxima (live-usage-tracker.ts:86-95), so `message_start` zeros + full `message_delta` cannot double count. Plan claim verified.

The decisive end-to-end test design (line 154: fake Responses SSE server → `CodexTranslationProxy` → `@anthropic-ai/sdk` consumer → `StreamEventTransformer`/`LiveUsageTracker`) is the strongest part of the plan. Keep it.

---

## F6 — Section B: sound, no overengineering found (LOW)

- Current behavior verified: `session:stats-batch` calls `historyReader.readSessionHistory()` per session at concurrency 5 (session-rpc.handlers.ts:826-834) — full replay per stats request, confirming the plan's motivation.
- `jsonl-reader.service.ts` already streams (`createReadStream` + `for await`, lines 84, 393), so a projection sibling method fits the existing pattern and "do not disturb full-history replay callers" (line 220) is the right constraint.
- The scope/range semantics (line 112) fix a real mismatch and the `coverage: 'partial'` answer for untimestamped records is honest.
- The cache validity token (file size/mtime + directory membership + rate-card revision, lines 124–131) is exact without a TTL substitute — correct design. The bounded LRU and in-flight coalescing match repo idioms (`auth:getAuthStatus` cache).
- Frontend cache key `workspaceScopeKey + range + until + sessionId` (line 122) plus load-generation/abort (line 121) fixes the real stale-write class. Not overengineered: each element maps to a listed failure mode.

One addition: the test matrix (line 284) asserts page latency on a "reference quiet machine" — keep the concurrency-cap and event-loop-yield assertions primary and the wall-clock secondary, as the plan already words it.

---

## What must change before approval

| # | Finding | Section | Change required |
|---|---------|---------|-----------------|
| F1 | `compactionControl` inert on CLI transport; deprecated | E (lines 186–189, 312) | Switch to `settings.autoCompactEnabled`/`autoCompactWindow`; test the argv |
| F2 | 128 MB `ptah.sessionMetadata` key survives sharding | A (lines 76, 215) | Durable extraction + lean aggregate + off-main parse/serialize, no deletion |
| F3 | Bogus source URL; account identity not pinned | D (lines 164, 169) | Cite openai/codex source; pin app-server `CODEX_HOME` to auth identity |
| F4 | v1 fallback loses v2-era writes; journal role unspecified; Windows durability; pre-readiness `get()` | A (lines 60–76) | Scope v1-retry to pre-first-mutation; define journal or drop it; state rename-durability limit; specify pre-readiness sync answers |

Sections B (F6) and C (F5) are approved as designed, with F5's typing note simplified.

Test proposals throughout use generated fixtures, temp profiles, and fake local servers only, per the task constraints — confirmed in the plan's matrix (lines 262, 288, 291).