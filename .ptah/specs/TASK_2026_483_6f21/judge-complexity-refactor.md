# Judge — complexity refactor of `main` in `scripts/drain-observation-queue.ts`

VERDICT: PASS

Adversarial review of the uncommitted diff against `HEAD`. Method: read the full
diff, read the post-refactor file top-to-bottom across the changed region, and
run a mechanical normalised-line comparison of the whole tail of both file
versions to prove no executable statement was deleted, added or altered beyond
the declared move. The script was NOT executed in any mode and no test suite was
run, per the brief. No file was edited.

---

## Mechanical evidence (the strongest single check)

Normalising whitespace and comments, and expanding the one `’` escape, the
set of code lines from `:1019`→EOF in the original is compared with `:1022`→EOF
in the new file:

- **Lines present in ORIGINAL but absent from NEW: exactly one** —
  `const result = drainBatches(db, options, cutoffMs, () => interrupted);`,
  which reappears as
  `const result = drainBatches(db, options, cutoffMs, isInterrupted);`
  (`:1206`) where `isInterrupted` is bound to the same `() => interrupted`
  closure at `:1326`. Same for the `reclaimPages` call, reflowed from three
  lines to one (`:1213`).
- **Zero `console.*` statements removed.** Count is 53 in both versions
  (`grep -c 'console\.'`), and no `console` line appears in the
  original-only set.
- **Zero `return`, `db.*`, `pragma`, `fs.*`, `assert*`, `createBackup`,
  `recheckBeforeDelete`, `openDatabase` or `process.*` statements removed.**

Everything in the NEW-only set is a function signature, a doc comment, the
`DestructiveRunContext` interface, a destructuring binding, a context-object
field, or one of the four new call sites. That is the signature of a move, not a
rewrite.

Only non-move textual delta in the whole diff: `'’'` at the `--force`
warning became the literal `’` (`:1182`). Same code point U+2019, identical
runtime string. Cosmetic.

---

## The nine invariants

### 1. Interlocks run BEFORE the database handle is opened — HOLDS

`main` (`:1248-1276`), in order:

| Line    | Step                                                            |
| ------- | --------------------------------------------------------------- |
| `:1252` | `parseArgs(argv)`                                                |
| `:1254` | `fs.existsSync` guard → `throw`                                  |
| `:1258` | `cutoffMs` computed                                              |
| `:1260` | `printRunBanner(options, cutoffMs)` — `void`, pure stdout        |
| `:1265` | `livenessChecker(options.dbPath, options.dryRun)`                |
| `:1270` | `reportLivenessFindings(...)`                                    |
| `:1271` | `if (refusal !== undefined) return refusal;`                     |
| `:1273` | `openDatabase(...)` ← **first handle, strictly after the above** |

`printRunBanner` (`:1027-1052`) returns `void` and contains only `console.log`
and one `if (options.dryRun)` over two print blocks. It cannot affect control
flow. The refusal return at `:1271` precedes `openDatabase` at `:1273`, exactly
as the inlined `return 1` did.

### 2. Backup completes AND is verified (byte size + `PRAGMA quick_check`) before the first DELETE, both aborting — HOLDS

- `createBackup` is still `await`ed: `:1185`.
- Inside `createBackup`: `await db.backup(destination)` (`:748`) then
  `verifyBackup(dbPath, destination)` (`:749`) — synchronous, before the
  promise resolves.
- `verifyBackup` byte-size check `:779` `if (copyBytes < sourceBytes) throw`,
  plus the empty-file check above it. **Throws** — does not log and continue.
- `verifyBackup` `PRAGMA quick_check` `:791`, `:794` `throw` on anything other
  than `'ok'`. **Throws.**
- Neither throw is caught: there is no `try`/`catch` anywhere between
  `runDestructiveDrain`'s body (`:1167-1246`) and `main`'s `try` (`:1294`),
  whose `finally` (`:1328-1332`) has no `catch` — so the throw propagates out
  of `main` and reaches the entrypoint's `.catch` at `:1340`, which sets
  `exitCode = 1`. The first DELETE (`drainBatches`, `:1206`) is 21 lines below
  and unreachable.

None of these lines is in the diff. `verifyBackup` and `createBackup` were not
touched.

### 3. `recheckBeforeDelete` runs AFTER `createBackup` returns and BEFORE the first DELETE — HOLDS

`runDestructiveDrain` `:1180-1206`:

```
:1180  if (options.force) { warn }           // no backup
:1185  else { await createBackup(db, ...) }  // backup + verify
:1191  const reblocking = recheckBeforeDelete(options.dbPath);
:1192  if (reblocking.length > 0) { … return 1; }   // no row deleted
:1205  console.log('');
:1206  const result = drainBatches(...)      // FIRST DELETE
```

It did **not** drift into a different helper. It sits in the same function body
as the backup and the first DELETE, with nothing but the refusal branch between
it and `drainBatches`. The TOCTOU comment (`:1188-1190`) moved with it. The
helper boundary was cut at `if (options.force)` — i.e. strictly *after* the
liveness check and *after* the dry-run return — so no interlock crossed it.

### 4. Dry run returns before `createBackup`; handle opened read-only — HOLDS

- `:1274` — `readonly: options.dryRun` on the one and only `openDatabase` call
  in `main`. Unchanged by the diff.
- `:1315-1317` — `if (options.dryRun) return reportDryRunProjection(...)`.
- `reportDryRunProjection` body is `:1119-1145` in full. It contains only
  `console.log`, one `if/else` on `autoVacuumMode`, and `return 0` (`:1144`).
  No `createBackup`, no `drainBatches`, no `reclaimPages`, no `pragma`, no
  `fileSizeBytes`. Verified by reading the whole body, not by grep alone.
- The `runDestructiveDrain` call at `:1319` is the statement *after* that `if`,
  so it is unreachable on a dry run for precisely the reason the inlined code
  was. The new helper boundary did **not** make anything downstream reachable:
  the `return` is taken in `main`'s own frame, not inside a helper that could
  fall through.

### 5. `--force` gates ONLY `createBackup` — HOLDS

`options.force` is read at exactly one place, `:1180`. Its `else` (`:1184-1186`)
wraps exactly one statement, `await createBackup(db, options.dbPath)`. The
`if/else` closes at `:1186`; `recheckBeforeDelete` is at `:1191`, **outside and
after** it. `livenessChecker` at `:1265` runs before `runDestructiveDrain` is
entered at all, so `--force` cannot reach it. `force` appears in none of the
four new helpers except `runDestructiveDrain`'s single `:1180` test.

### 6. Both SQL statements keep `processed_at IS NOT NULL AND processed_at < @cutoff` — HOLDS

Outside the refactored region; absent from the diff entirely.

- `SELECT_BATCH_SQL` `:828-830`:
  `WHERE id > @cursor AND processed_at IS NOT NULL AND processed_at < @cutoff`
- `DELETE_BATCH_SQL` `:838-841`:
  `WHERE id IN (SELECT value FROM json_each(@ids)) AND processed_at IS NOT NULL
  AND processed_at < @cutoff`

`cutoffMs` reaching them is covered under item 12.

### 7. No bare `VACUUM`; only `incremental_vacuum` — HOLDS

Case-insensitive sweep of the file: prose `:28-29`, `AUTO_VACUUM_INCREMENTAL = 2`
`:105`, comment `:116`, the `autoVacuumMode` field/read `:638`/`:650`, the mode
branch `:925-938` (including the explicit "will NOT fall back to VACUUM"), the
one executed pragma `db.pragma(\`incremental_vacuum(${stepPages})\`)` `:957`,
the availability reason `:972`, the report line `:1002`, and the dry-run branch
now at `:1131`/`:1141`. **No `VACUUM` statement is executed anywhere.** None of
these lines is in the diff.

### 8. `targetsLiveDatabase` keeps `fs.realpathSync.native` on BOTH sides and fails closed — HOLDS

Untouched. `normaliseRealPath` `:509-518` uses
`fs.realpathSync.native(path.resolve(value))` at `:511` and returns `undefined`
from the `catch` at `:512-516`. `targetsLiveDatabase` `:520-527` calls it for
**both** `dbPath` and `livePath`, and `:526` is
`if (target === undefined || live === undefined) return true;` — unresolvable on
*either* side reads as live, the stricter classification.

### 9. `inspectProcesses` still THROWS when it cannot answer — HOLDS

Untouched. `:393` re-throws a PowerShell/JSON failure as
`Could not verify that Ptah is closed: …`; `:396` throws
`Process inspection returned malformed data` on a non-array payload;
`findPtahProcesses` throws at `:345` on a malformed record. Nothing in the four
new helpers catches anything — the diff introduces **no** `try`, `catch` or
`.catch`, so a throw from `livenessChecker` at `:1265` still escapes `main`
before the database is opened.

---

## The refactor-specific checks

### 10. `reportLivenessFindings` return contract — HOLDS, and the `if (refusal)` trap is not present

Signature `:1064-1068`: `): number | undefined`.

Its body has **exactly two** return points:

- `:1093` `return 1;` — inside `if (blocking.length > 0)` → `if (!options.dryRun)`,
  the destructive refusal. Identical nesting to the original.
- `:1110` `return undefined;` — the single fall-through at the end.

There is **no path that returns `0`**, so the falsy-zero hazard has no way to
arise even in principle. Independently, the call site is the strict form:

`:1270-1271`
```ts
const refusal = reportLivenessFindings(options, blocking, advisory);
if (refusal !== undefined) return refusal;
```

`!== undefined`, not truthiness. A refusal of `1` is therefore honoured and
`main` returns `1` at `:1271`, **before** `openDatabase` at `:1273` — so a
refused destructive run never even acquires a writable handle, exactly as
before. The dry-run blocking branch (`:1095-1107`) prints and falls through to
`:1110` `undefined`, so the dry run continues — also as before.

Cross-check against the original: the original's `return 1` stood at the same
nesting inside the same `if (blocking.length > 0) { if (!options.dryRun) {…} }`,
and the original's dry-run branch likewise had no return. The mechanical
comparison shows no `return` line dropped.

### 11. `interrupted` is read LIVE through a closure — HOLDS

`let interrupted = false;` is at `:1278`, in `main`'s scope. `onSignal`
(`:1280-1290`) is unmoved: `signalCount += 1`, `if (signalCount > 1)` →
`process.exit(130)` (`:1284`), else `interrupted = true` (`:1286`).

The context field is built at `:1326` as `isInterrupted: () => interrupted` — a
**closure expression**, not a boolean. `runDestructiveDrain` destructures it as a
value of type `() => boolean` (`:1154`, `:1177`) and passes the *same function
reference* to both consumers:

- `drainBatches(db, options, cutoffMs, isInterrupted)` — `:1206`
- `reclaimPages(db, options.reclaimStepPages, isInterrupted)` — `:1213`

Each loop still calls it at its top-of-loop check, and each call re-reads the
live `interrupted` binding. The original created two separate `() => interrupted`
closures over the same variable; one shared closure over that same variable is
semantically identical. **No call site captured the boolean by value** —
TypeScript would reject `boolean` where `() => boolean` is declared, and the
field type at `:1154` is `readonly isInterrupted: () => boolean;`.

`main` still surfaces the interrupted exit through
`return result.interrupted ? 2 : 0;` (`:1245`).

### 12. `DestructiveRunContext` fields all populated with the original values — HOLDS

Interface `:1147-1155`; every field is **required** (no `?`), so TypeScript
rejects a missing one — nothing can be silently `undefined`. The literal at
`:1319-1327` populates all seven with shorthand or the identical expression:

| Field           | Value at call site (`:1320-1326`) | Original source                           |
| --------------- | --------------------------------- | ----------------------------------------- |
| `db`            | `db`                              | `openDatabase(...)` `:1273`                |
| `options`       | `options`                         | `parseArgs(argv)` `:1252`                  |
| `cutoffMs`      | `cutoffMs`                        | `:1258`, feeds both SQL predicates         |
| `beforeQueue`   | `beforeQueue`                     | `readQueueStats(db, cutoffMs)` `:1295`     |
| `beforePages`   | `beforePages`                     | `readPageStats(db)` `:1296`                |
| `beforeBytes`   | `beforeBytes`                     | `fileSizeBytes(options.dbPath)` `:1297`    |
| `isInterrupted` | `() => interrupted`               | the same closure, item 11                  |

All six shorthand properties resolve to the bindings declared inside `main`'s
`try` at `:1295-1297` and `main`'s scope at `:1252`/`:1258`/`:1273`, which is
where the inlined code read them from. The DELETE predicate inputs are the two
that matter most: `cutoffMs` (`:1258`, unchanged expression
`Date.now() - options.processedDays * MILLISECONDS_PER_DAY`) reaches
`drainBatches` at `:1206` and `readQueueStats` at `:1226`, and `options` reaches
`drainBatches` whole. Neither is recomputed, defaulted or shadowed.

**Additional hazard checked and cleared**: `:1319` is `return await
runDestructiveDrain({…})`, not a bare `return runDestructiveDrain({…})`. The
`await` keeps the promise inside `main`'s `try`, so the `finally` at
`:1328-1332` — which does `process.off` twice and `db.close()` — runs only
*after* the destructive drain settles. A missing `await` here would have closed
the handle mid-drain. It is present.

### 13. `main`'s signature byte-for-byte unchanged — HOLDS

`:1248-1251`:

```ts
export async function main(
  argv: readonly string[],
  livenessChecker: LivenessChecker = collectLivenessFindings,
): Promise<number> {
```

The diff shows these four lines removed from their old position and re-added
verbatim at the new one — a pure move, no character changed. The default is
still the real `collectLivenessFindings`; none of the four helpers accepts a
checker parameter, and `reportLivenessFindings` receives only the
already-computed findings, so no second injection point was created.

Production entry `:1336`: `main(process.argv.slice(2))` — one argument, so the
default binds. `.then` sets `process.exitCode = code` (`:1338`) and `.catch`
sets `1` (`:1344`). Unchanged.

### 14. Only `scripts/drain-observation-queue.ts` changed among source files; the spec is untouched — HOLDS, with one note

`git diff --name-only` in this worktree:

```
apps/ptah-electron-e2e/src/specs/git/glyph-margin-visual.spec.ts
scripts/drain-observation-queue.ts
```

- **`scripts/drain-observation-queue.spec.ts` is NOT modified.** That is the
  check that mattered: the refactor did not bend a single assertion to match a
  behaviour change. The absence of a spec edit is consistent with the
  behaviour-preservation claim rather than merely asserted alongside it.
- `apps/ptah-electron-e2e/src/specs/git/glyph-margin-visual.spec.ts` is a
  Playwright electron test for git glyph-margin rendering. It has no import,
  symbol or subject in common with the drain script, and the report attributes
  it to another agent working in this shared worktree. It is **not** part of
  this change and must not be swept into the commit.
- `.ptah/specs/TASK_2026_483_6f21/complexity-refactor-report.md` is a new
  untracked document, not source.

---

## Findings

None blocking. Two notes, neither affecting behaviour:

1. **Commit hygiene (Moderate, process not code).** The worktree carries an
   unrelated modified file, `apps/ptah-electron-e2e/src/specs/git/glyph-margin-visual.spec.ts`.
   Stage `scripts/drain-observation-queue.ts` explicitly — `git add -A` here
   would commit another agent's in-flight work.
2. **Standing coverage gap, unchanged by this work (Minor).** The blocking
   refusal path — now `reportLivenessFindings` returning `1` at `:1093`, checked
   at `:1271` — still has no test through `main` in either direction. This is
   carried over from judge round 2 and is not a regression; the extraction in
   fact makes it unit-testable for the first time, since
   `reportLivenessFindings` is a pure function of `(options, blocking, advisory)`.
   Worth a follow-up test, not a blocker on this diff.

## Verdict

- Recommendation: **APPROVE — commit `scripts/drain-observation-queue.ts` only**
- Confidence: **HIGH**. The conclusion rests on a mechanical whole-tail line
  comparison (one line differs, and it is the declared closure rename) plus a
  read of every changed line and every invariant site, not on the test suite.
- Residual uncertainty: the destructive path's real-database behaviour was not
  and must not be exercised here. That uncertainty is identical before and
  after the refactor, because the diff changes no executed statement.
- Top risk: none introduced by this change; the standing risk remains that the
  `reportLivenessFindings` refusal path is proven by reading rather than by a
  test.
