# Complexity refactor — `main` in `scripts/drain-observation-queue.ts`

SonarCloud reported cognitive complexity 27 for `main` against a limit of 15
(PR #539 quality gate). This change is a **pure structural move**: four blocks of
whole statements were lifted out of `main` into named functions. No condition was
rewritten, no branch inverted, no statement reordered, nothing "simplified".

Only `scripts/drain-observation-queue.ts` was changed. No spec change was needed
or made.

---

## The four helpers

All four sit immediately above `main`, in the order `main` calls them.

### 1. `printRunBanner(options, cutoffMs)` — `:1027-1056`

The opening three-lines-plus-mode banner: database path, cutoff timestamp, and
the `if (options.dryRun) { … } else { … }` that prints either the six-line
DRY RUN explanation or `mode : DESTRUCTIVE`.

**Coherent unit**: it is the only thing in `main` that writes to stdout before
any check runs, and it is pure I/O — it reads `options` and `cutoffMs` and
returns `void`. It cannot affect control flow.

### 2. `reportLivenessFindings(options, blocking, advisory): number | undefined` — `:1064-1113`

The advisory `NOTE` block, the destructive-path `REFUSING TO RUN` block, and the
dry-run `NOTE — the database is IN USE right now` block. Returns `1` where the
original `return 1` stood, `undefined` otherwise; `main` does
`if (refusal !== undefined) return refusal;` (`:1270-1271`).

**Coherent unit**: it is "print what the pre-flight interlocks found and decide
whether the run may continue". It takes the findings as `readonly` arrays and
performs no probing of its own — the classification it prints was already made
by `collectLivenessFindings`.

### 3. `reportDryRunProjection(options, beforeQueue, beforePages): number` — `:1119-1145`

The projection paragraph plus the `auto_vacuum` availability branch, ending in
the `return 0` that was the dry run's exit.

**Coherent unit**: the entire tail of the dry-run path, one entry and one exit.

### 4. `runDestructiveDrain(context): Promise<number>` — `:1167-1245`

Everything from the `--force` / backup branch through to the invariant
assertion, in the original order. Takes a `DestructiveRunContext` object
(`:1148-1156`) rather than seven positional parameters.

**Coherent unit**: the destructive path in full — the one sequence where every
step is a precondition of the next. Keeping it whole is what makes invariant 1
inspectable in a single function body rather than spread across shards.

The connection and the two signal handlers remain owned by `main`: `openDatabase`
at `:1273`, `process.on` at `:1291-1292`, and the `finally` at `:1328-1332` that
does `process.off` twice and `db.close()`. A `return` taken inside
`runDestructiveDrain` still unwinds through that `finally`, exactly as the
inlined `return` did.

**Deliberately NOT extracted**: the BEFORE-stats block (`:1295-1313`) stays
inline in `main`. It is four statements with no branching, so it contributes
nothing to cognitive complexity, and extracting it would have produced a
fifth fragment for no benefit — against the repository's guardrail on fragment
sprawl (`CLAUDE.md`, File size).

---

## The nine invariants, point by point

### 1. Order is semantic — HOLDS

Read off the current file, top to bottom:

| Line | Step |
| --- | --- |
| `:1265` | `livenessChecker(...)` — interlocks, **before** the database is opened |
| `:1273` | `openDatabase(...)` |
| `:1315-1317` | dry run returns here |
| `:1181-1186` | `runDestructiveDrain`: `--force` branch / `await createBackup(db, options.dbPath)` |
| `:750` | `verifyBackup` is called **inside** `createBackup`, before it resolves |
| `:1191` | `recheckBeforeDelete(options.dbPath)` — after the backup returns |
| `:1192-1203` | blocking → `return 1`, no row deleted |
| `:1206` | `drainBatches` — the first DELETE |

`createBackup` is still `await`ed (`:1185`) and `recheckBeforeDelete` is still a
synchronous call six lines later, with nothing between its failure branch and
`drainBatches`. `verifyBackup` still runs inside `createBackup` at `:750`, so byte
size (`:775-786`) and `PRAGMA quick_check` (`:791-799`) both complete before the
`await` resolves and therefore before the first DELETE. Nothing moved across
these boundaries — the helper boundary was cut at `if (options.force)`, which is
strictly *after* the liveness check and the dry-run return.

### 2. Dry run returns before `createBackup`; handle is read-only — HOLDS

`:1274` — `readonly: options.dryRun` on the one `openDatabase` call in `main`,
unchanged. `:1315-1317`:

```ts
if (options.dryRun) {
  return reportDryRunProjection(options, beforeQueue, beforePages);
}
```

`reportDryRunProjection` returns `0` (`:1144`) and contains no call to
`createBackup`, `drainBatches`, `reclaimPages`, `wal_checkpoint` or
`assertUnprocessedUnchanged` — grep-verifiable: its body is `:1119-1145`. The
`runDestructiveDrain` call at `:1319` is the statement *after* that `if`, so it is
unreachable on a dry run for the same reason the inlined code was. Confirmed by
the existing dry-run `main` test, which still asserts no `backups/` directory is
created and all 9 fixture rows survive.

### 3. `--force` gates only `createBackup` — HOLDS

`options.force` appears exactly once in the file, at `:1181`, and the `else` at
`:1184-1186` wraps exactly one call. Everything else is outside the branch:
`livenessChecker` at `:1265` runs before `runDestructiveDrain` is even entered,
and `recheckBeforeDelete` at `:1191` sits **after** the `if/else` closes at
`:1187`, not inside it. `force` is read nowhere in `collectLivenessFindings`,
`recheckBeforeDelete`, `probeExclusiveAccess`, `probeWriteLock`, `findLockfiles`,
`inspectProcesses`, or in any of the four new helpers.

### 4. Both SQL statements keep the predicate — HOLDS

Neither statement was touched; both are outside the refactored region.

- `SELECT_BATCH_SQL` `:828` —
  `WHERE id > @cursor AND processed_at IS NOT NULL AND processed_at < @cutoff`
- `DELETE_BATCH_SQL` `:838-841` —
  `WHERE id IN (SELECT value FROM json_each(@ids)) AND processed_at IS NOT NULL AND processed_at < @cutoff`

### 5. No bare `VACUUM` — HOLDS

Case-insensitive grep for `vacuum`: `AUTO_VACUUM_INCREMENTAL = 2` (`:105`), the
mode comparison (`:925`), the dry-run availability branch now at `:1131`, prose
at `:28` and the "will NOT fall back to VACUUM" sentence at `:938`, and the one
executed pragma `db.pragma(\`incremental_vacuum(${stepPages})\`)` at `:957`. The
`1..65_536` integer re-proof immediately before interpolation (`:945-951`) is
untouched. No `VACUUM` statement exists.

### 6. `targetsLiveDatabase` fails closed on both sides — HOLDS

Untouched, outside the refactored region. `normaliseRealPath` uses
`fs.realpathSync.native(path.resolve(value))` at `:511` and returns `undefined`
on throw (`:514`); `targetsLiveDatabase` (`:519-527`) calls it for **both**
`dbPath` and `livePath` and returns `true` when either is `undefined`.

### 7. `inspectProcesses` throws when it cannot answer — HOLDS

Untouched. `:391-394` re-throws a PowerShell failure as `Could not verify that
Ptah is closed`; `:395-397` throws on a non-array payload; `findPtahProcesses`
throws on a malformed record (`:344-346`) and on a `node` process with an
unreadable `CommandLine` (`:355-358`). None of the four helpers catches anything
— there is no new `try`/`catch` in this change, so a throw from
`collectLivenessFindings` at `:1265` still propagates out of `main` unchanged.

### 8. Liveness-check injection stays a default parameter, unreachable from argv — HOLDS

`main`'s signature is byte-for-byte unchanged (`:1248-1251`):

```ts
export async function main(
  argv: readonly string[],
  livenessChecker: LivenessChecker = collectLivenessFindings,
): Promise<number> {
```

The default is still the real `collectLivenessFindings`. Production entry is
still `main(process.argv.slice(2))` at `:1336` — one argument. None of the four
helpers takes a checker parameter, and `reportLivenessFindings` receives only the
*already-computed* findings, so the refactor adds no second injection point.

### 9. First interrupt drains gracefully; second exits 130 — HOLDS

`onSignal` (`:1280-1290`) is unmoved and unmodified: `signalCount += 1`, the
`> 1` branch printing and `process.exit(130)` at `:1284`, then `interrupted =
true` and the warning. `interrupted` is still a `let` in `main`'s scope. The
closure `() => interrupted` is now passed as `isInterrupted` on the context
object (`:1326`) and reaches both `drainBatches` (`:1206`) and `reclaimPages`
(`:1214`) — a closure over the same variable, so the flag is still read live at
each top-of-loop check, not captured by value. `main` returns `2` on an
interrupted drain via `runDestructiveDrain`'s `return result.interrupted ? 2 : 0`
(`:1244`).

---

## Verification

```
npm run test:scripts
```

Baseline before the refactor: `Test Suites: 1 passed, 1 total` /
`Tests: 26 passed, 26 total`.

After the refactor:

```
Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total
Time:        5.003 s
```

All 26 pass, including the destructive-path tests that matter here: the
NULL-`processed_at` survivor, the absurd-future-cutoff predicate isolation, the
interrupt-and-resume pair, `verifyBackup`'s four cases, `probeWriteLock` in three
states, and both end-to-end `main` runs (destructive exit 0 with a backup that
predates the delete, and the dry run with no `backups/` directory).

```
npx tsc --noEmit --project scripts/tsconfig.json
```

Zero errors in `drain-observation-queue.ts`. One pre-existing, unrelated error in
`scripts/build-eval-harness.ts` (`TS7016` missing `@types/better-sqlite3`), present
before this change and not touched by it.

```
npx eslint scripts/drain-observation-queue.ts
```

Before: `1 warning — File has too many lines (905). Maximum allowed is 700`.
After: `1 warning — File has too many lines (951)`. 0 errors either way. The
+46 counted lines are the four helpers' doc comments and the
`DestructiveRunContext` interface; the `max-lines` warning was already present
and is warn-level by design (`CLAUDE.md`, File size). Correctness beat line
count, as instructed.

The script was **not executed in any mode** against
`C:\Users\abdal\.ptah\state\ptah.sqlite`. Every run was the Jest suite against
`os.tmpdir()` fixtures, which `assertIsFixture` (spec `:66-75`) enforces.

## Notes

- **Nothing outside this file was changed.** `git status` shows
  `scripts/drain-observation-queue.ts` modified, plus
  `apps/ptah-electron-e2e/src/specs/git/glyph-margin-visual.spec.ts`, which is
  another agent's pre-existing work in this shared worktree and was not touched
  by me. No commit, no push, no `nx reset`.
- **No spec change was required.** The refactor is behaviour-preserving, so every
  assertion in `scripts/drain-observation-queue.spec.ts` still holds as written.
  A spec edit here would have been the red flag the brief named.
- **Standing gap, unchanged by this work** (carried over from judge round 2,
  item 6 / coderabbit item 3): `main`'s blocking-refusal path — now
  `reportLivenessFindings` returning `1` — still has no test through `main` in
  either direction. The extraction makes it directly unit-testable for the first
  time, since it is a pure function of `(options, blocking, advisory)`, but no
  test was added because the brief scoped this change to the structural move.
