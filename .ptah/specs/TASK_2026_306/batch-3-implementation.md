# Batch 3 implementation report — TASK_2026_306

**Branch**: `ak/boot-blocker-quota-gate` (no branch created, no commit made)
**Tasks**: 3.1 (Defect C), 3.2 (Defect G adapter half), 3.3 (Defect G RPC half)
**Status**: all three implemented, verified, mutation-checked.

---

## Task 3.1 — session importer discards every file

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-importer.service.ts`

### What changed

1. **New module constant `METADATA_PREFIX_BYTES = 8192`** with a docblock stating that
   this is a BYTE bound, not a record bound. Replaces the four `8192` literals that were
   spread across `extractMetadata` and `isTitleOnlySidecar`.

2. **New module-level pure function `splitCompleteRecords(content, bytesRead)`.** Splits
   on `\n` and drops the trailing element **only when** `bytesRead >= METADATA_PREFIX_BYTES`
   **and** the content does not end on a newline. The second half of that condition is
   load-bearing in the other direction: a short read means the whole file is in hand, so
   its final line is complete even without a trailing newline and must be **kept**.

3. **`extractMetadata` per-record `try` / `continue`**, plus a `parsedRecords` counter.
   The bare `const msg = JSON.parse(line)` at the old `:492` is gone; the local `msg` is
   now explicitly typed rather than implicitly `any`.

4. **Corruption is still refused.** `if (lines.length > 0 && parsedRecords === 0)` returns
   `null` and logs at **`warn`** (`No parseable records in session file prefix`, carrying
   `filePath` and `completeLines`). Complete records were present and none was JSON — that
   is corruption, not truncation.

5. **The `sawSessionContent` sidecar guard is kept, but gated on `parsedRecords > 0`.**
   This is the one judgement call in 3.1 and it is worth reading closely, because two of
   the brief's requirements collide here:
   - "Keep the filename fallback at `:516` — it is now the **primary** path for large files."
   - "Keep the `sawSessionContent` sidecar guard intact."

   In the "first record alone exceeds 8 KB" case there is **no complete record in the
   prefix at all**, so `sawSessionContent` is `false` — and the ungated guard would
   `return null` before ever reaching the filename fallback, making that fallback dead on
   exactly the case it was kept for. Gating on `parsedRecords > 0` resolves it without
   weakening the sidecar rule: an `ai-title` sidecar is a few dozen bytes, so it is always
   read whole, always yields `parsedRecords > 0`, and always still reaches the guard.
   Pinned by two of the four new spec cases (large-first-record, and ai-title-still-skipped).

6. **Method-level `catch` raised from `debug` to `warn`.** Per-record parse failures no
   longer reach it, so what remains is genuine I/O on a file we already opened. This is the
   "11-of-11 silent failures" point from the brief.

7. **`isTitleOnlySidecar` now uses `splitCompleteRecords` too.** Its per-line
   `try`/`continue` was already correct (it was the in-file precedent for the fix); this
   only stops it judging a half-record. Behaviour on every previously-correct input is
   unchanged.

### Not changed

The filename fallback, the sidecar rule itself, the 8 KB budget, `pruneTitleOnlySessions`,
and both index-import paths.

---

## Task 3.2 — `SdkAgentAdapter.initialize()` in-flight guard

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`

### What changed

1. **New field `private initInFlight: Promise<boolean> | null = null`** with a docblock
   recording why `initialized` was never a flight marker (assigned at the old `:333`, after
   both `configureAuthentication` and `findExecutable()`), and naming the four re-entry
   points.

2. **`initialize()` is now a thin guard**, shaped exactly on
   `auth-manager.ts:115-129`: if a pass is held, `debug`-log and return it; otherwise store
   `doInitialize()`, `await` it, and clear the field in a **`finally`** — not a `then`, so a
   failed pass does not latch permanently.

3. **The original body moved verbatim into `private async doInitialize()`.** Not one line of
   the initialization logic changed. `this.initialized` semantics are untouched — the guard
   is purely additive.

4. **`reset()` drains any in-flight pass before disposing.**

   ```ts
   if (this.initInFlight) {
     await this.initInFlight.catch(() => false);
   }
   this.dispose();
   await this.initialize();
   ```

   **This is a deliberate addition beyond the literal instruction and the reviewer should
   check it.** The brief says "`reset()` must still force a genuine re-init — do not let the
   guard swallow it." Without this drain, a `reset()` issued _while a pass is in flight_
   would be answered by the guard with the pre-reset pass and would never dispose or
   re-initialize — i.e. the guard would swallow it in exactly the case the instruction names.
   With the drain, `reset()` is unreachable by the guard by construction. The result of the
   drained pass is discarded (`doInitialize` never rejects; the `.catch` is belt-and-braces).

### Not changed

The watcher state check at the old `:183-195` (`if (this.initialized && health.status !== 'error') return;`)
is untouched, as instructed — it answers a state question, not a flight question.

---

## Task 3.3 — RPC verification logged its success line twice per pass

**Files**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-verification.ts`
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\verify-and-report.ts`

### What changed

`assertRpcRegistration` gained a **fourth optional parameter** `precomputed?: RpcVerificationResult`
and now does `precomputed ?? verifyRpcRegistration(...)`. `verifyAndReportRpcRegistration`
passes the result it already computed. Both changes carry a comment explaining that
verification **logs as a side effect of verifying**, which is why re-running it inside the
assert doubled the line.

The parameter is optional, so every other caller of `assertRpcRegistration` (the exported
public API of `vscode-core`) is source-compatible and still asserts standalone.

**The assertion was not deleted and what it verifies did not change** — same handler, same
exclusion list, therefore an identical result. Only the duplicate work and the duplicate log
are removed. Pinned by a spec case that still expects the throw on drift.

---

## Spec cases added — exact counts

**12 new spec cases across 3 files.** Two files extended, one file created.

| File                                                              | New cases | New file? |
| ----------------------------------------------------------------- | --------- | --------- |
| `libs\backend\agent-sdk\src\lib\session-importer.service.spec.ts` | 4         | no        |
| `libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts`        | 4         | no        |
| `libs\backend\rpc-handlers\src\lib\verify-and-report.spec.ts`     | 4         | **yes**   |

### `session-importer.service.spec.ts` — describe `8 KB prefix truncation (TASK_2026_306)`

All four use a new `mockPositionalRead` helper: a **faithful positional `fd.read`** that
honours the caller's length bound and reports the real `bytesRead`. The file's existing
`open` mock copies the whole file into the buffer regardless of size, which is precisely
the condition under which this defect cannot occur — no existing spec could have caught it.

1. `imports a session whose prefix is cut mid-token (the reported case)` — record 1 carries
   the id, record 2 is long enough that byte 8192 lands inside its string, and nothing
   resolves a name, so the loop genuinely reaches the truncated record.
2. `falls back to the filename when the first record alone exceeds the prefix` — a single
   12 KB record; no newline in the prefix at all.
3. `still returns nothing for a genuinely corrupt file, and warns` — short read, ends on a
   newline, every record complete and none of them JSON.
4. `still skips an ai-title sidecar (no phantom "Session <date>" entry)`.

### `sdk-agent-adapter.spec.ts` — describe `initialize() in-flight guard (TASK_2026_306)`

Mirrors the shape of `auth-manager.spec.ts` (deferred promise gating `configureAuthentication`).

1. `collapses two concurrent calls into one pass, resolving both to the same result` —
   asserts `configureAuthentication` and `findExecutable` each called **once**, and counts
   the two log lines from the captured boot log (`Initializing SDK adapter`,
   `Detecting Claude CLI installation`) at exactly 1 each.
2. `is a concurrency guard, not a memo — sequential calls each run a real pass`.
3. `does not latch after a failed pass — the guard is cleared in a finally`.
4. `reset() still forces a genuine re-init even when a pass is in flight`.

### `verify-and-report.spec.ts` (new)

1. `logs the success line exactly once for a pass that reaches the assert`.
2. `still throws on registration drift — the assertion is not weakened`.
3. `computes the verification once on the drift path too`.
4. `skips the assert entirely outside development`.

---

## Mutation check — which cases are load-bearing

Every new case was re-run against the **reverted pre-fix source** (source files reverted,
spec files kept). **6 of the 12 fail there**; the other 6 pass either way and are
preservation guards, not fix proofs. Reported honestly rather than rounded up.

| Spec case                                     | Fails pre-fix?          |
| --------------------------------------------- | ----------------------- |
| importer: prefix cut mid-token                | **yes**                 |
| importer: first record exceeds prefix         | **yes**                 |
| importer: genuinely corrupt file + warn       | **yes**                 |
| importer: ai-title sidecar still skipped      | no — preservation guard |
| adapter: collapses two concurrent calls       | **yes**                 |
| adapter: guard is not a memo                  | no — preservation guard |
| adapter: no latch after failed pass           | no — preservation guard |
| adapter: reset() forces re-init               | no — preservation guard |
| rpc: success line logged once                 | **yes**                 |
| rpc: still throws on drift                    | no — preservation guard |
| rpc: verification computed once on drift path | **yes**                 |
| rpc: assert skipped outside development       | no — preservation guard |

The three adapter guards pass pre-fix for a structural reason worth stating: pre-fix there
was **no guard at all**, so there was nothing for them to catch being broken. They exist to
catch the guard being written wrong later — a `then`-cleared latch, a memoized result, or a
`reset()` the guard answers.

---

## Verification output

| Command                                          | Result                                                        |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `npx nx test agent-sdk`                          | **74 suites / 1038 tests, all pass**                          |
| `npx nx test rpc-handlers`                       | **87 suites / 2438 tests — 2407 pass, 31 pre-existing skips** |
| `npx nx test vscode-core`                        | **22 suites / 365 tests, all pass**                           |
| `npx nx build agent-sdk rpc-handlers`            | **success** (2 projects + 22 dependent tasks)                 |
| `npx nx lint agent-sdk rpc-handlers vscode-core` | **success — 0 errors** (11 / 38 / 19 warnings)                |

All lint findings are warnings, and all are pre-existing kinds
(`no-non-null-assertion`, `no-explicit-any`, `no-empty-function`, `no-unused-vars`,
`max-lines`) on code this batch did not introduce. `max-lines` was already firing on
`sdk-agent-adapter.ts` (931 → 978) and `sdk-agent-adapter.spec.ts` before this change;
no file newly crossed the 700-line soft ceiling. `session-importer.service.ts` is 621 lines
and remains under it.

### One existing spec broke transiently, and was fixed in my code, not in it

`SessionImporterService › does not re-import sessions already in the metadata store` failed
on the first run. Cause was mine: my new cases need **persistent** (`mockResolvedValue`) fs
stubs, because `pruneTitleOnlySessions` re-opens every imported file after the scan and a
`...Once` queue runs dry mid-pass — and the file's outer `beforeEach` uses
`jest.clearAllMocks()`, which clears call records but **not implementations**. My
always-succeeding `access` stub leaked forward into that spec and its stored entry got
pruned. Fixed with an `afterEach` inside my own `describe` that resets the four fs mocks.
**The existing spec was not edited.** Final state: no pre-existing spec is modified in this
batch.

---

## Acceptance criteria NOT satisfied

Three of Batch 3's four acceptance criteria are **boot-log observations**, and I verified
them only at unit-spec level. They need a real `nx serve ptah-electron` run to close:

1. **"Session import over a real `~/.claude/projects/` directory reports a non-zero
   `imported` count."** Not run against a real directory. The reported failure mode is
   reproduced and fixed in spec, including the exact reported shape (truncated tail, and
   an unreachable `session_id`), but a real-directory count is not evidence I have.
2. **"`Initializing SDK adapter...` and `Detecting Claude CLI installation...` each appear
   once per cold start, including with an expired Codex token."** The spec proves one pass
   and one of each log line under a held `configureAuthentication`; it does not reproduce
   the real trigger (the boot OAuth refresh writing `~/.codex/auth.json` mid-flight).
3. **"`[RPC Verification] All N RPC methods correctly registered` appears once."** Proven at
   the helper level with the real `RPC_METHOD_NAMES` registry; not observed in a boot log.

The fourth — **"`reset()` still forces a real re-initialisation"** — is satisfied, and is
covered by a spec in both the idle and the in-flight case.

**Recommendation for the reviewer**: these three are cheap to close in one boot now that
Batch 1 has restored a usable window. All three lines are in the first few hundred lines of
`nx serve ptah-electron` output.
