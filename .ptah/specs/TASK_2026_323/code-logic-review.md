# Code Logic Review — TASK_2026_323 (AREA 3 + AREA 4)

Scope note: this file covers only AREA 3 (B6 — memory curator / internal query
concurrency gate) and AREA 4 (B4 — JSONL streaming reader, `readJsonlTail`,
trajectory hash, caller triage). AREA 1/2 review content from an earlier pass
of this session was not recoverable in this continuation and is not included
here — this is a partial file by design, not a full-task verdict.

Commits reviewed: `0e238190a` (B6, internal-query concurrency gate),
`332ba3ed8` (B4, streaming JSONL reader + `readJsonlTail`), plus the
already-landed `TRANSCRIPT_TAIL_BYTES` wiring in `d263ec9ae` (B2) that this
depends on.

Verification performed: full read of both commits' diffs, the current source
of every touched file plus its callers, a live Node repro of the `readJsonlTail`
edge case below, `npx jest --config libs/backend/skill-synthesis/jest.config.ts
trajectory-extractor` (19/19 pass), `npx nx run-many -t test -p
@ptah-extension/skill-synthesis` (1329 passed / 37 skipped / 0 failed) and
`-p @ptah-extension/agent-sdk` (1116 passed / 0 failed), and all three DI
container smoke specs (`ptah-cli`, `ptah-electron`, `ptah-extension-vscode`).

## Ranked findings

### 1. SERIOUS — interactive wizard calls have no bound on the new global one-shot queue wait (AREA 3, B6)

- **File**: `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`
  (`InternalQueryConcurrencyGate`, `DEFAULT_MAX_CONCURRENT = 1`, `acquireSlot`)
- **Also**: `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:273`,
  `libs/backend/agent-generation/src/lib/services/agent-customization.service.ts:178`,
  `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:710-719`,
  `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts:170-195`,
  `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:421-438,546`
- **Before**: `InternalQueryService.execute()` called `runner.runOneShot()`
  directly. No queueing existed anywhere, so every caller — background or
  interactive — started its subprocess immediately.
- **Now**: `execute()` first `await`s `InternalQueryConcurrencyGate.acquire(limit,
signal)`, `limit` defaulting to 1, and the gate is one process-wide singleton
  (`SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE` registered `Lifecycle.Singleton` in
  `di/register.ts:437-441`) shared by memory-curator, every skill-synthesis
  lane, `harness-llm-runner`, and every `agent-generation` wizard service. Two
  of the five `agent-generation` call sites (`content-generation.service.ts`,
  `agent-customization.service.ts`) pass **no `abortController` at all**, so
  `config.abortController?.signal` is `undefined` and the queued wait has no
  exit condition whatsoever short of a slot freeing up. The other three
  (`enhanced-prompts`, `agentic-analysis`, `multi-phase-analysis`) do create an
  `AbortController`, but the only `setTimeout` that ever fires it is wired into
  `SdkStreamProcessor`/`processStream`, which only starts running **after**
  `execute()` has already resolved a handle — i.e. after the queue wait is
  already over. None of the five bounds the wait itself.
- **Contrast (does it correctly)**: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:734-738`
  and `libs/backend/rpc-handlers/src/lib/harness/ai/harness-llm-runner.service.ts:104-105`
  both call `setTimeout(() => abortController.abort(), ms)` **before** calling
  `execute()`, so their timer covers the queue wait too. The pattern exists in
  the codebase; it just wasn't applied to the wizard.
- **Reproduction**: with the default `ptah.internalQuery.maxConcurrent = 1`,
  trigger any background one-shot call that legitimately runs long (a
  skill-synthesis lane call — `lane.config.timeoutMs` is commonly tens of
  seconds up to the archaeologist's 120 s default per the lib's own docs — or a
  memory-curator extract/resolve pass) and, while it is in flight, open the
  setup wizard and trigger content generation
  (`ContentGenerationService.generateSectionsForTemplate`). The wizard's
  `await this.internalQueryService.execute(...)` at line 273 does not return
  until the background call releases the slot. From the user's perspective this
  is indistinguishable from the wizard hanging — the exact symptom class this
  task exists to remove, now relocated from the Electron event loop into an
  application-level semaphore with no visibility and no priority.
- **Missing spec**: `internal-query.service.spec.ts`'s concurrency-gate `describe`
  block (`InternalQueryService — concurrency gate (TASK_2026_323 B6)`) only
  exercises the gate in isolation — sequencing, early-break release, abort
  removal, configured limit. No test drives a scenario where a slow
  background-shaped caller (no or late-armed abort signal) blocks a
  wizard-shaped caller, and nothing in `agent-generation`'s specs asserts a
  wait-time ceiling on `execute()`.

### 2. MODERATE — `InternalQueryService`'s new optional deps aren't declared optional to tsyringe (AREA 3, B6)

- **File**: `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`
  (constructor)
- **Before**: constructor took only `runner: SdkQueryRunner`.
- **Now**: two more parameters, `@inject(TOKENS.LOGGER) logger: Logger | null =
null` and `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) workspace:
IWorkspaceProvider | null = null` — neither `@inject()` call carries `{
isOptional: true }`. tsyringe resolves constructor injections by token
  regardless of a JS default value; only `isOptional: true` makes it pass
  `undefined` instead of throwing when the token isn't registered. The
  established convention for a genuinely optional dependency, in the very same
  file family, is `@inject(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER, { isOptional:
true })` (`sdk-internal-query.curator-llm.ts:130,132`) — not present here.
- **Reproduction (indirect)**: resolving `InternalQueryService` from a tsyringe
  container that has not yet registered `PLATFORM_TOKENS.WORKSPACE_PROVIDER`
  throws `UnresolvableDependencyError` instead of constructing with `workspace
= null` as the class's own `readMaxConcurrent()` fallback assumes. All three
  current host container smoke specs (`apps/ptah-cli`, `apps/ptah-electron`,
  `apps/ptah-extension-vscode` — `src/di/container.smoke.spec.ts`) pass today,
  which only proves current registration ORDER happens to register
  `WORKSPACE_PROVIDER`/`LOGGER` first in all three hosts — it does not prove the
  fallback path is reachable or exercised.
- **Missing spec**: no test resolves `InternalQueryService` through a real
  tsyringe container with `WORKSPACE_PROVIDER` (or `LOGGER`) deliberately
  unregistered to confirm the documented `null`-fallback behaviour.

### 3. LOW / informational — curator's own gate wait is likewise unbounded, but the failure mode is already tolerated

- **File**: `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:250-317`
  (`runQuery`), `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:776-836`
  (`invokeCurate`)
- Neither `invokeCurate`'s callers nor `runQuery` supply a deadline-bound
  `AbortSignal` for the queue wait, so a curation pass can queue indefinitely
  behind other one-shot callers under the same singleton gate, same as
  Finding 1. Rated lower than Finding 1 because the existing `'stalled'`
  outcome plumbing (commit `5dfedc09c`) already treats a curation pass that
  doesn't run as "keep the input, try again later" rather than losing data or
  hanging a user-visible UI — the cost is delayed memory curation, not a
  frozen screen.

## AREA 4

### 4. MODERATE — `readJsonlTail` drops the file's genuine first line when the tail window starts exactly at byte 0

- **File**: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:233-267`
  (`readJsonlTail`: `windowStart = stats.size - maxBytes`, stream opened at
  `start: windowStart - 1`, `dropFirstLine: true` unconditionally)
- **Before**: N/A — new method.
- **Now**: the docstring's invariant ("the window starts one byte EARLIER…
  if the extra byte is a newline the discarded 'line' is empty… otherwise the
  discarded line is the fragment the window cut in half") implicitly assumes
  there is always a real byte before the read start to borrow a newline
  decision from. That assumption is false in exactly the case `windowStart ===
1` (`maxBytes === stats.size - 1`): the read starts at byte 0, the true
  start of the file, not mid-fragment, yet the first parsed "line" is still
  unconditionally discarded as if it were a boundary artifact — destroying a
  complete, valid, wanted record.
- **Reproduction (executed)**: wrote a 12-byte file `AAA\nBBB\nCCC\n` to a
  temp dir, opened `createReadStream(filePath, { start: windowStart - 1 })`
  with `maxBytes = stats.size - 1 = 11` (⇒ `windowStart = 1`, `readStart =
0`); the stream yields the WHOLE file `"AAA\nBBB\nCCC\n"` starting at byte 0,
  so `readJsonlTail` would still drop the resulting first parsed line (`AAA`)
  and return only `['BBB', 'CCC']`. Confirmed against real
  `node:fs`/`node:fs/promises` semantics, not a mock.
- **Practical exposure**: LOW today. The only current caller,
  `memory-trigger.service.ts`'s `TRANSCRIPT_TAIL_BYTES = 512 * 1024`, would
  need a transcript of exactly `524289` bytes to hit this — vanishingly
  unlikely — but `readJsonlTail` is exported as part of `JsonlReaderService`'s
  public surface (re-exported from `@ptah-extension/agent-sdk`) with no such
  caveat documented, so a future caller passing a size-derived `maxBytes` can
  hit it deterministically, silently, with no error or warning.
- **Missing spec**: `jsonl-reader.streaming.spec.ts`'s `readJsonlTail` suite
  covers mid-line cut, exact-newline-boundary, CRLF, empty file, and
  larger-than-50MB-cap — but not the `windowStart === 1` degenerate case. No
  test pins the documented invariant against this boundary.

## Clean-checked (verified correct, no defect found)

1. `InternalQueryConcurrencyGate` — FIFO ordering, abort-while-queued removal
   (leaves the queue, does not consume a slot), idempotent `release()` across
   `abort()` / `close()` / stream-drain-to-completion / early `break` /
   `runner.runOneShot` rejection, and `Lifecycle.Singleton` DI registration
   (`di/register.ts:437-441`). All 8 gate-specific tests in
   `internal-query.service.spec.ts` pass.
2. `readJsonlTail`'s general first-line-drop algorithm — mid-fragment cut,
   exact-newline-boundary cut (dropped line is empty, next line survives
   whole), and CRLF handling — is correct by construction and by the real-file
   test suite (`jsonl-reader.streaming.spec.ts`); only the byte-0 edge case
   (Finding 4) is broken.
3. `readJsonlMessages` streaming/yielding — verified byte-for-byte equivalent
   to the old whole-file `split(/\r?\n/)` + `JSON.parse` output on a
   5,000-line fixture that straddles the 64 KB read-chunk boundary, plus an
   explicit event-loop-yield race (`jsonl-reader.streaming.spec.ts:95-128`)
   that empirically proves the new reader yields control (a bounded 20-hop
   `setImmediate` chain wins the race against the parse), which the old
   synchronous implementation could not have lost.
4. Trajectory hash (`trajectory-extractor.ts`) — the refactor from
   `map(normalize).join().createHash().update()` to a single loop calling
   `hasher.update(TURN_SEPARATOR)` / `hasher.update(part)` per turn is
   byte-identical to the old algorithm **by construction**: every `.update()`
   call boundary sits on the plain-ASCII `TURN_SEPARATOR`, never directly
   between two `part` strings, so no UTF-16 surrogate pair can ever straddle a
   call boundary and change how the pieces individually encode to UTF-8
   relative to encoding the joined string once. The reused global
   `workspacePattern` regex is safe across turns because
   `String.prototype.replace` resets a global pattern's `lastIndex` to 0 on
   entry, so correctness does not depend on the regex being freshly
   constructed per turn as the old code did. Ran
   `trajectory-extractor.spec.ts` directly: 19/19 pass, including the
   hash-stability and workspace-path-normalization hash tests.
   **Gap** (not a bug): none of the 19 tests pin the new hash against a
   hard-coded golden value computed by the pre-refactor algorithm — they only
   check the current code's internal self-consistency. Recommend one golden
   fixture test so the commit message's byte-identity claim is independently
   checkable in CI rather than resting on code review.
5. Caller triage for the B4 switch to `readJsonlTail` is correct:
   `MemoryTriggerService.invokeCurate` (the actual "per turn complete" trigger,
   `onStop` etc.) is the one caller switched to `readJsonlTail` (512 KB), and
   `SubagentMetricsExtractor.extract` / `TrajectoryExtractor.extract` correctly
   kept `readJsonlMessages` (full read) because their outputs are aggregates
   over the WHOLE transcript (token/cost sums, min/max timestamp duration,
   full session turn count, first-user-prompt task id, and the skill-dedup
   hash) that a tail read would silently truncate or corrupt.
   `subagent-metrics-extractor.ts`'s new docstring ("This one genuinely needs
   the WHOLE transcript") accurately describes the code.
   **Residual note** (scope boundary, not a regression): `MemoryCuratorService`'s
   PreCompact handler (`memory-curator.service.ts:117`) and boot-scan path
   (`:894`) still call `transcriptReader.read()` with no `tailBytes` — full
   reads, benefiting only from the generic streaming/yielding fix, not from
   the tail-read optimization. Consistent with the original B4 ranking (which
   named "per turn-complete", not PreCompact/boot-scan) but worth a follow-up
   measurement if PreCompact fires more often than assumed in a chatty
   session.
6. `composeTranscript`'s pre-existing 32 KB clamp on the formatted excerpt
   (`memory-trigger.service.ts:1161-1184`) is unaffected by, and composes
   correctly with, the new 512 KB raw tail read — the 16x margin between
   `MAX_JSONL_BYTES` and `TRANSCRIPT_TAIL_BYTES` is documented and consistent.
7. Full regression run: `@ptah-extension/skill-synthesis` — 1329 passed / 37
   skipped / 0 failed; `@ptah-extension/agent-sdk` — 1116 passed / 0 failed.
   No regressions surfaced anywhere else in either lib from the B4/B6 changes.
8. All three DI container smoke specs (`ptah-cli`, `ptah-electron`,
   `ptah-extension-vscode`) resolve `InternalQueryService` successfully today
   — Finding 2 is latent, not currently triggered.
