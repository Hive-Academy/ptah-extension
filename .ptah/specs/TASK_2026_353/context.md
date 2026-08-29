# TASK_2026_353 — Cache session/model lookups

## Evidence

Baseline: `tmp/logs/log.log` (Electron boot + two workspace switches, 2026-08-28).

| Symptom                        | Evidence                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config:models-list` 7095.7 ms | `log.log:753`. Fetch starts at `:630`/`:632` (`[SdkModelService] Fetching models via SDK supportedModels()`), resolves at `:747`. Called again at `:868, 1195, 1624, 1800, 2046, 2132, 2257` — those repeats **do not** re-spawn (no second `Fetching models via SDK` line), so the per-process cache already works; the cost is the ONE spawn and what it does to everything else. |
| `session:list` 3542.3 ms       | `log.log:760`. The call is logged as starting at `:684` and "succeeded" at `:759` — one line after the models fetch resolved. It did no 3.5 s of work; it sat behind the spawn.                                                                                                                                                                                                     |
| `chat:resume` 5675 / 9332 ms   | `log.log:846, 856`, for a 281-event and a 20-event transcript (`:806, 858`). Same window.                                                                                                                                                                                                                                                                                           |
| `[event-loop] lag`             | `log.log:772` `maxMs: 1803.6` and `log.log:801` `maxMs: 1992.3` — inside that same window, matching the claude.exe spawn cost documented by TASK_2026_341.                                                                                                                                                                                                                          |
| `findSessionsDirectory` rescan | 24 `[JsonlReader] findSessionsDirectory` lines, every one `dirCount: 18` for `D:\projects\qa3elhamor` (`:674, 675, 677, 681, 682, 768, 770, 834, 844, 866, 934, 953, 997, 1000, 1100, 1239, 1240, 1363, 1446, 1957, 1972, 1976, 1986, 2340`). Plus 9 `[SessionImporter] findSessionsDirectory`.                                                                                     |

## Root cause

**One dominant cause, three amplifiers.**

1. **`libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:495`** — `fetchModelsViaSdk`
   calls `query({ prompt, options })` **without** `spawnClaudeCodeProcess`. The Claude Agent
   SDK spawns the CLI inside `query()`'s synchronous prologue, and
   `child_process.spawn` is not async: `uv_spawn` runs `CreateProcessW` on the calling
   thread and Windows scans the 253 MB `claude.exe` image while doing it. TASK_2026_341
   landed `OffThreadProcessSpawner` and wired it into `SdkQueryRunner.useOffThreadSpawner`
   (`sdk-query-runner.service.ts:195`), and `libs/backend/agent-sdk/CLAUDE.md` names the
   two remaining direct callers explicitly: "`cli-agent-runtime`'s `ptah-cli-registry.ts`,
   `sdk-model-service.supportedModels` still block and must pass the spawner themselves."
   This is that leftover. It is why `session:list` and `chat:resume` report multi-second
   durations while doing almost no work — they are queued behind a frozen loop.

2. **`sdk-model-service.ts:190`** — `cachedModels` is a single unkeyed field. Invalidation
   is entirely by `clearCache()` callers (`sdk-agent-adapter.ts:216, 349, 535, 542`). Any
   auth or provider change that does not route through one of those four sites serves a
   catalog belonging to the previous provider until the process restarts.

3. **`libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:105`** —
   `findSessionsDirectory` `readdir`s `~/.claude/projects` on every call, from every
   caller (`SessionHistoryReaderService` x3, `memory-curator`, `skill-synthesis`,
   `SessionRpcHandlers.listTranscriptIds`). The answer changes only when the projects
   directory gains or loses a child.

4. **`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:685` and `:693`** —
   `chat:resume` calls `readSessionHistory()` and then `readHistoryAsMessages()`, and each
   one independently streams and `JSON.parse`s **the same transcript**. Two full parses per
   resume. `session:stats-batch` (`session-rpc.handlers.ts:793`) then parses the same files
   a third time for the sidebar. The parse itself yields to the event loop
   (TASK_2026_323), so it does not freeze — it is just duplicated work on the boot path.

## Files

- `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts` — off-thread spawn,
  auth-keyed cache, generation-guarded write-back.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.spec.ts` — new cases.
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts` —
  sessions-directory memo + parsed-transcript memo.
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.spec.ts` — new cases.

Deliberately untouched: `SessionImporter.findSessionsDirectory`
(`session-importer.service.ts:835`) is a second, **behaviourally different** copy — it has
a leading-hyphen-stripping fallback that `JsonlReaderService` does not. It runs once per
workspace scan, not per RPC. Unifying the two is a correctness change to session discovery
and does not belong in a caching task. Recorded here so it is not mistaken for an
oversight.

## Plan

1. Route `SdkModelService.fetchModelsViaSdk` through `OffThreadProcessSpawner`
   (`SDK_TOKENS.SDK_PROCESS_SPAWNER`), mirroring `SdkQueryRunner.useOffThreadSpawner`
   including the `stderr` → `onStderr` hand-down.
2. Key the model cache on an auth fingerprint (auth method + base URL + hashed
   credentials + tier env), so an auth change misses by construction instead of relying on
   a `clearCache()` caller. In-flight dedupe becomes per-key. Write-back is conditional on
   a monotonic `cacheGeneration` (the `AuthRpcHandlers` idiom, TASK_2026_342).
3. Memoise `findSessionsDirectory` per workspace path, validated against the
   `~/.claude/projects` directory `mtimeMs`. A new or removed project directory bumps that
   mtime, so both positive and negative answers invalidate correctly.
4. Memoise parsed transcripts in `readJsonlMessages`, keyed on `(path, size, mtimeMs)`,
   with a TTL and byte/entry caps. Tail reads are not cached.

## Acceptance criteria

- A second `getSupportedModels()` call spawns no SDK bridge.
- The SDK bridge launch passes `spawnClaudeCodeProcess`, so it does not block the caller's
  thread.
- A change to the active auth (method, base URL, credential) makes the next call re-fetch.
- `findSessionsDirectory` scans `~/.claude/projects` once per workspace while that
  directory is unchanged, and rescans once it changes.
- `readJsonlMessages` parses once for repeated reads of an unchanged file and re-parses
  when size or mtime moves.
- No behaviour change for fresh data: same resolved directory, same parsed messages, same
  model list.

## Test projects

`@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`

```
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
```

---

## Implementation notes

### What changed

**`libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`**

1. `fetchModelsViaSdk` now passes `spawnClaudeCodeProcess`, delegating to the injected
   `OffThreadProcessSpawner` (`SDK_TOKENS.SDK_PROCESS_SPAWNER`, sixth constructor
   parameter). The `stderr` callback was hoisted to a named `onStderr` and handed to the
   spawner as well, because supplying a custom spawner makes the SDK skip its own stderr
   wiring — the same rule `SdkQueryRunner.useOffThreadSpawner` documents. This is the fix
   for the 1803 ms / 1992 ms event-loop stalls, and therefore for the reported
   `session:list` and `chat:resume` durations, which were queueing, not working.
2. `cachedModels` / `pendingModelsPromise` / `cachedNativeModels` /
   `pendingNativeModelsPromise` collapsed into `modelsCache` + `pendingModels`, both keyed
   by `authFingerprint()` — active auth method plus `ANTHROPIC_BASE_URL`, the two
   credential keys (SHA-256, first 12 hex chars, so no secret becomes a Map key or a log
   field) and the three tier `_MODEL` keys. The ambient Claude login keeps a fixed
   `'native'` key. `this.authEnv` is the object the auth strategies mutate in place, so
   reading it per call is what makes a provider switch visible with no notification wiring.
3. `cacheGeneration`, bumped by `clearCache()` and re-checked before every write-back, so
   a fetch in flight across an invalidation cannot restore the pre-change catalog. In-flight
   entries are deleted by identity, not by key. Both idioms copied from
   `AuthRpcHandlers` (TASK_2026_342).
4. `hasCachedModels()` now answers for the CURRENT auth identity. `SdkQueryOptionsBuilder`
   uses it to decide whether its model pre-flight is free, and that question is only
   meaningful about the auth the next query would run under.

**`libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts`**

5. `findSessionsDirectory` memoises per workspace path against the `~/.claude/projects`
   `mtimeMs`. The four-pass matching moved verbatim into `scanForSessionsDirectory` so
   there is one cache-write site instead of five return statements. A `stat` that fails for
   any reason falls through to a full scan and caches nothing, so the memo can never be the
   reason a lookup fails. The `[JsonlReader] findSessionsDirectory` debug line now marks a
   real scan, which makes the 24-per-boot symptom directly observable in the log.
6. `readJsonlMessages` memoises the parse on `(path, size, mtimeMs)`, reusing the `stat`
   already taken for the size guard. TTL 60 s, at most 8 entries / 24 MB of source, nothing
   over 12 MB cached; LRU on read, so the transcript being resumed is not the first
   evicted. Entries without a numeric `mtimeMs` are not cached at all — no token, no entry.
   Each caller gets its own array (`[...messages]`); elements are shared, and nothing in
   the history pipeline mutates a parsed message. `readJsonlTail` is untouched.

This removes the second full parse `chat:resume` did (`readSessionHistory()` then
`readHistoryAsMessages()`, `chat-session.service.ts:685` and `:693`) and the third one
`session:stats-batch` did, without either handler changing — the deduplication happens at
the one place that owns the parse.

### Deliberately not done

- **No handler-level cache for `config:models-list`.** The repeats at `log.log:868` onward
  already re-spawn nothing; `SdkModelService` was serving them from memory. Adding a second
  cache layer over a corrected one buys nothing and doubles the invalidation surface.
- **`SessionImporter.findSessionsDirectory` left alone.** It is a second copy with
  different matching rules (a leading-hyphen-stripping fallback `JsonlReaderService` lacks)
  and it runs once per workspace scan, not per RPC. Unifying them changes session
  discovery, which is not a caching change.
- **The first `config:models-list` is still slow in wall-clock terms.** Starting the SDK
  bridge and waiting for `supportedModels()` genuinely takes seconds. What changed is that
  it no longer takes them from every other handler on the loop, and it happens once per
  auth identity.

### Verification

- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts` is 703 lines —
  3 over the warn-level `max-lines` soft ceiling. The addition is one concern (read
  caching) bound to the two methods it guards; extracting it would produce a sub-150-line
  fragment with no name better than "cache helper", which the facade rule's nameability
  guardrail rejects. Lint reports 0 errors.
- `nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers`: header
  `Running target test for 2 projects`. agent-sdk 81 suites / 1251 tests green;
  rpc-handlers 91 suites / 2530 tests green. `nx run-many -t typecheck` green for both,
  and for `memory-curator`, `skill-synthesis` and `cli-agent-runtime` (the downstream
  consumers of the changed exports).
- Two transient failures during verification, both from OTHER agents editing this same
  working tree mid-run, both green on a targeted re-run and neither in a file this task
  touches: `internal-query.service.spec.ts` failed to COMPILE against an in-flight
  TASK_2026_352 edit to `internal-query.service.ts`, and `adoptLegacySkillsShInstalls`
  failed against an in-flight edit to `rpc-handlers/src/lib/utils/skills-sh-cli.ts`
  (5 skills-sh suites / 97 tests pass on rerun). This task modified no file under
  `libs/backend/rpc-handlers`.

---

## Follow-up (judge round 1)

Three non-blocking findings, landed as a separate change on top of `a9ddfda6d`.

### 1. The workspace switch no longer wipes every provider's catalog

`SdkAgentAdapter.reconfigureAuthIfChanged` still called the blanket
`modelService.clearCache()`. With the catalogs now keyed per auth identity that call was
not protection — the incoming provider cannot reach the outgoing one's key — it was a
guaranteed cost: alternating between workspace A (provider X) and workspace B (provider Y)
paid the full SDK-bridge spawn on **every** switch back, three spawns for two providers.

- `SdkModelService.invalidateForAuthChange()` drops only the genuinely auth-scoped part:
  `cachedApiModels`, a single unkeyed field behind a 5-minute TTL whose contents depend on
  the base URL and credentials that just changed. It deliberately does **not** bump
  `cacheGeneration` — an in-flight fetch is keyed to the identity that started it, so its
  write-back stays correct however the active auth moves, and discarding it would only cost
  the next visitor to that provider another spawn.
- `clearCache()` keeps its blanket behaviour for the three sites that mean it: config
  change (`sdk-agent-adapter.ts:217`), `dispose` (`:542`) and `clearModelCache()` (`:549`).
- **`providerId` joined the fingerprint**, and this is a correctness fix rather than
  belt-and-braces. `applyTierMapping` resolves tier aliases through `ModelResolver`, which
  falls back to the ACTIVE provider's registry `defaultTiers`. Two providers can present
  byte-identical `AuthEnv`s and still map `opus` to different model ids, so the env-only
  key committed in round 1 could have let one provider's catalog answer for the other. It
  also makes the key agree with the adapter's own definition of "the auth changed"
  (`reconfigureAuthIfChanged` compares exactly `authMethod` + `providerId`).

Pinned by `A → B → A is two fetches`, plus a case for a provider change with an unchanged
env, plus the existing `sdk-agent-adapter.spec.ts` workspace-switch case updated to assert
the scoped call and that the blanket one is **not** made.

### 2. `sessionsDirCache` is bounded

The mtime token invalidates an entry but never removes one, so the map grew once per
distinct workspace path for the life of the process. Now a 32-entry LRU, renewed on read as
well as on write (a hit re-inserts, so a hot workspace cannot age out behind one merely
visited later). 32 is a leak guard rather than a tuning knob: it is far above any plausible
set of open projects, and a host that reaches it was not going to get hits on the evicted
entries. A count, not a byte budget — the entries are a path and a number.

### 3. The dead self-skip branch is gone, and the invariant that made it dead is now enforced

The judge was right that `if (key === filePath) continue;` in `cacheTranscript` was
unreachable: the fresh entry is last in insertion order and satisfies both caps alone, so
the loop always breaks before reaching it. Rather than delete a guard and leave the reader
to re-derive why it was safe, `TRANSCRIPT_CACHE_MAX_FILE_BYTES` is now **derived** as
`TRANSCRIPT_CACHE_MAX_BYTES / 2`. "Anything cacheable fits in the cache on its own" is the
property the loop depends on, and it is now structural instead of a coincidence between two
independently written constants — raising the per-file cap past the total was what would
have made the branch live, and now cannot happen silently.

Added specs: TTL expiry at the boundary (`Date.now` spied rather than fake timers — the
parse loop yields through `setImmediate`, which faked timers never fire); LRU eviction past
the entry cap; eviction on the byte cap with the entry cap untouched; a file over the
per-file cap never cached at all; and two files at exactly `MAX_BYTES / 2` both surviving,
which is the invariant above written as a test.

### Verification

`npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers`
— header `Running target test for 2 projects`, `Successfully ran target test for 2
projects`. agent-sdk 81 suites / 1263 tests green; rpc-handlers 91 suites / 2535 tests
green. `run-many -t typecheck` green for both. Lint on agent-sdk: 0 errors.
`jsonl-reader.service.ts` is 754 lines against the warn-level 700 soft ceiling — see the
round-1 note; the additions are bounds and eviction for caches the same methods own.
