# Batch 2 report — TASK_2026_383

## Revision 1 — review response

Triggered by `code-logic-review.md` (Batch 2 section: APPROVED WITH NOTES, 7/10
— 1 serious, 3 moderate, 4 failure modes) and `code-style-review.md` (Batch 2
section: APPROVED, 8/10 — 3 minor). Same worktree, same five owned files. `nx
reset` was **not** run; nothing is committed; Batch 3's `tools/degradation-audit/**`,
`.github/workflows/ci.yml` and `eslint.config.mjs` are untouched.

Net change since revision 0: **+137 lines** (76 in `boot-coordinator.ts`, 172 in
`wire-runtime.ts`, 189 in `boot-coordinator.spec.ts` — was 53 / 147 / 100),
**3 new spec cases** (19 total for the batch, up from 16). No production
behaviour changed: every code edit in this revision is a doc comment except the
three new tests.

### 1. Serious — the abort path now has specs

`boot-coordinator.spec.ts:649-735`, three cases beside the settle and fail cases
in the same `describe`:

| Case                                                                         | What it pins                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `still fires the summary exactly once when a quit aborts the boot`           | The `fn` yields until `abortSignal` fires (the heavy boot's own shape); `coordinator.abort()` is called; the summary fires **exactly once** and `phase` is `settled`. Also asserts the summary had **not** fired before the abort, so "once" is measured across the whole path.                                            |
| `does not delay the bounded drain when the summary throws on the abort path` | A throwing summary during a quit: `awaitCompletion(2000)` resolves in **under 1000 ms** (asserted against a wall clock), and the swallow's `console.warn` fired. `handleWillQuit` gives the drain ~2 s; a diagnostic may not spend it.                                                                                     |
| `leaves the summary UNFIRED when an aborted boot never observes the signal`  | The honest limit, pinned rather than assumed. A boot body that ignores `abortSignal` is still pending when the drain expires, so its line is lost — deliberate, because a summary emitted from a timeout would describe a still-running boot. The persistence gate is still asserted released, so no consumer is stranded. |

The behaviour the review suspected "correct by construction" is confirmed: the
summary rides the shared `.finally()`, so the abort path is the same code path
as settle and fail, and `abort()` resolving the gate does not double-fire it.
The third case is the one the review offered as an alternative ("or documents
that it is accepted as best-effort during a quit") — this batch does **both**:
asserts it and documents it, in `armBootSummary`'s doc comment and here.

### 2. Moderate findings and failure modes

| Review finding                                                                                                                                                                                                                                                                                                                     | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FM-1 / moderate — fire-and-forget reports race past the summary.** A future `reporter.report(...)` inside `boot-heavy-services.ts`'s detached `prefetchPricing().catch(...)` / `cliDetection.detectAll().then(...)` lands after `emitBootSummary()` has fired and nulled itself: tallied, never narrated.                        | **Fixed as the review recommended** (document the narrower guarantee; a second emission is new scope). `logBootDegradationSummary`'s doc comment now states in full that the line narrates the **awaited chain**, names both detached sites, and tells a later batch its two options: move the report inside the awaited chain, or accept counted-and-never-narrated. Nothing reports from those sites today, so there is no live defect to fix — only a guarantee that read wider than it was.                                                                |
| **FM-3 / moderate — `snapshot().total` is cumulative since process start, not this boot's count.** A pre-window site converted to a report would silently be counted by a line called "boot summary".                                                                                                                              | **Fixed as the review recommended** (it explicitly says "no code change needed for this batch; flag"). Documented in the same doc comment, including the verification that every pre-window fallback in `wire-runtime.ts` logs and reports nothing today, so the two numbers are currently identical.                                                                                                                                                                                                                                                          |
| **Moderate — workspace-switch boots never receive a summary, and that is not stated anywhere.** A second `startOrJoin` boot goes through `wire-runtime.ts`'s listener, never the coordinator.                                                                                                                                      | **Fixed** — `armBootSummary`'s doc comment now says "once per PROCESS, for the STARTUP workspace only", names `booter.startOrJoin(active)` as the path that bypasses the coordinator, and states that summarising a switch needs its own terminal signal and is not this batch's scope. The review's own reading ("plausibly the intended scope … but not stated") is exactly right; the gap was documentation, not behaviour.                                                                                                                                 |
| **FM-2 — abort timing unverified.**                                                                                                                                                                                                                                                                                                | Fixed by item 1 above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **FM-4 / moderate / style minor 2 — keytar suppression-comment placement unresolved across the Batch 2/3 boundary.** Style review verified against `check-degradation.ts:222-245` ("the line directly above `node.getStart()`") that a `CatchClause`'s `getStart()` is the `catch` keyword, so the in-body comment may not attach. | **Not changed, on the coordinator's explicit instruction**: Batch 3's tool is being widened right now to accept exactly this placement (comment block above a statement, wrapped lines, and a leading comment inside a catch body). Both suppressions at `cli-master-key-provider.ts:156-171` are left byte-for-byte as written. This resolves the open question the previous revision recorded — the parser moves to the code, not the code to the parser — and the file is unchanged in this revision (`git diff` shows the same three hunks as revision 0). |
| **Logic minor — the workspace-switch swallow (`console.error`, still unreported) would have been a low-cost consistency fix.** Recorded by the review itself as "an opportunity, not a defect, since the plan never assigned that site to this batch."                                                                             | **Out of scope, recorded.** Giving that site a degradation code means minting a second code and a second report call at a site `implementation-plan.md`'s evidence table does not name; Batch 2's owned scope is the startup swallow. What _was_ done is the style fix below, so the asymmetry is legible from the code.                                                                                                                                                                                                                                       |

### 3. Style minors

| Minor                                                                                                                                                   | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1 — no cross-reference between the two near-identical `booter.startOrJoin` call sites** (`wire-runtime.ts:419-424` bare log vs `:457-460` reporting). | **Fixed.** A six-line comment now sits directly above the listener's `booter.startOrJoin(active)` (`wire-runtime.ts:438-443`): same method, two error contracts, only the startup swallow was the named defect, this path already logs, and whoever gives it a code should reuse `reportStartupBootFailure`'s shape with its own code. Verified the comment cannot disturb `wire-runtime.boot-order.spec.ts`, which strips whole-line `//` comments before every assertion (`stripComments`, `:49-51`) — and those tests still pass. |
| **3 — `bootSummary` is the third arm/fire hook field in the class with no shared extension point.**                                                     | **Fixed as the review framed it** ("worth naming so a fourth hook triggers a look rather than a fourth copy"). The field's doc comment now names all three (`emitReadiness`, `warmupRun`, `bootSummary`), states why three copies still beat an abstraction here (the file's no-runtime-import rule forces any registry to be data-only), and says a fourth should trigger a look. No consolidation attempted — the review is explicit that three is below the threshold.                                                            |
| **2 — keytar suppression placement.**                                                                                                                   | See FM-4 above: left as written, per the coordinator's instruction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Revision 1 verification

Re-run in full, `--skip-nx-cache`, from
`D:/projects/ptah-extension/.claude-worktrees/task-383`. Header read back
`Running target … for 2 projects` on all three.

```
> nx run @ptah-extension/platform-cli:test
Test Suites: 12 passed, 12 total
Tests:       3 todo, 197 passed, 200 total

> nx run ptah-electron:test
Test Suites: 1 skipped, 35 passed, 35 of 36 total
Tests:       8 skipped, 457 passed, 465 total

 NX   Successfully ran target test for 2 projects
```

```
 platform-cli:   ✖ 3 problems (0 errors, 3 warnings)
 ptah-electron:  ✖ 5 problems (0 errors, 5 warnings)
 NX   Successfully ran target lint for 2 projects
```

```
> tsc --noEmit --project libs/backend/platform-cli/tsconfig.lib.json
> tsc --noEmit --project apps/ptah-electron/tsconfig.app.json
 NX   Successfully ran target typecheck for 2 projects
```

`wire-runtime.ts` is now 592 lines and `boot-coordinator.ts` 656 — both still
under the 700-line soft ceiling. All 8 lint warnings are the same pre-existing
ones enumerated in the revision-0 section below; none is in a Batch 2 file.

#### Every test that is not "passed", named

**`ptah-electron` — 1 skipped suite, 8 skipped tests.** Identified by running
Jest with `--json` and reading `assertionResults[].status`, not by inference.
All are pre-existing `describe.skip` guards; the review independently confirmed
against a `git stash` re-run of the pre-batch tree that the same 1 suite and 8
tests were skipped before this batch (438 passed pre-batch vs 457 now — the 19
new tests, all passing).

`src/config/integrity-worker-bundle.spec.ts` — 4 skipped, suite still counts as
**passed** because its two banner-source tests run. Guard:
`const describeBundle = existsSync(host.bundle) ? describe : describe.skip;`
(`:108`) — the built `integrity-worker.mjs` does not exist in this worktree
because no `nx build-integrity-worker` has been run here.

1. `ptah-electron integrity worker bundle › built artifact › anti-vacuity: the bundle is non-empty and is the integrity worker`
2. `ptah-electron integrity worker bundle › built artifact › defines require via createRequire before any dynamic-require shim can run`
3. `ptah-cli integrity worker bundle › built artifact › anti-vacuity: the bundle is non-empty and is the integrity worker`
4. `ptah-cli integrity worker bundle › built artifact › defines require via createRequire before any dynamic-require shim can run`

This is exactly the `:108` skip that **Batch 4, Task 4.2** owns — it folds into
the `PTAH_ALLOW_SKIP_UNBUILT` policy and the file is renamed to
`esm-bundle-gate.spec.ts`. Not Batch 2's to change.

`src/integration/wizard-seed.integration.spec.ts` — 4 skipped, and this is the
**1 skipped suite** (every test in it is pending, so Jest counts the suite as
skipped). Guard: `const describeNative = nativeAvailable ? describe :
describe.skip;` (`:316`), set by a `try`/`catch` require of `better-sqlite3`
(`:305-315`) — the native module is not built for this Node ABI in the worktree.

5. `wizard-seed › [electron-end-to-end] real SQLite: 2 core + 1 recall entries with expected kind/pinned`
6. `wizard-seed › [electron-rerun-no-duplicates] second run with changed content replaces entries (no duplicate rows)`
7. `wizard-seed › [electron-rerun-hash-skip] second run with identical content makes zero insertMemoryWithChunks calls`
8. `wizard-seed › [electron-workspace-rename] fingerprint-based identity survives workspaceRoot rename`

These are four of the ~75 `nativeAvailable ? describe : describe.skip` guards
that **Batch 4, Task 4.2 lists as explicitly out of scope, do not touch**.

**`@ptah-extension/platform-cli` — 3 `todo`, 0 skipped.** All three are
`it.todo` in `src/settings/cli-master-key-provider-keytar.spec.ts` — the spec
file for the very provider this batch classified, so they were checked
individually rather than waved through:

1. `IMasterKeyProvider contract › CliMasterKeyProvider (keytar) › [DECISION REQUIRED] corrupt key-ref: regenerate silently (data loss) vs. throw loudly (no data loss)`
2. `IMasterKeyProvider contract › CliMasterKeyProvider (keytar) › [DECISION REQUIRED] wrong-length key-ref: regenerate silently vs. throw loudly`
3. `MKP-DL › CliMasterKeyProvider (keytar): data-loss audit › MKP-DL-4: covered by IMasterKeyProvider contract › two concurrent calls return identical bytes`

All three are pre-existing, all three concern `notifyCorruption` /
regenerate-vs-throw policy on a **corrupt or wrong-length stored key**, and none
touches `tryLoadKeytar`, which is the only function this batch changed in that
file (and it changed only comments). The first two are marked `[DECISION
REQUIRED]` — an open product question about data loss, not a gap this batch
created or can close. Recorded rather than adopted: deciding regenerate-vs-throw
is not a degradation-audit change.

---

## Revision 0 — original submission

**Batch**: 2 — Boot degradation summary and the named degradation fixes
(components 3, 7)
**Executor**: `backend-developer`
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/task-383`, branch
`task/383-degradation-audit`
**Status**: COMPLETE — NEEDS REVIEW
**Committed**: no. Working tree left dirty for the team-leader.

Batch 3's uncommitted files (`tools/degradation-audit/**`,
`.github/workflows/ci.yml`, `eslint.config.mjs`) were **not** touched and are
still `M` / `??` exactly as they were. `npx nx reset` was **not** run.

---

## Files

| Action | Path                                                                | Lines                                                            | What                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODIFY | `apps/ptah-electron/src/activation/boot-coordinator.ts`             | +14 at `:238-251`, +34 at `:296-329`, +5 at `:445-449`           | The `bootSummary` field, `armBootSummary` / `emitBootSummary`, and the one call in the post-window `.finally()`.                                                                                  |
| MODIFY | `apps/ptah-electron/src/activation/boot-coordinator.spec.ts`        | +100 at `:557-656`                                               | Six cases, new `describe` block.                                                                                                                                                                  |
| MODIFY | `apps/ptah-electron/src/activation/wire-runtime.ts`                 | +5 at `:10-14`, +125 at `:103-227`, `:453-460`, +7 at `:469-475` | The type import; `MAX_SUMMARISED_DEGRADATION_CODES`, `formatDegradationSummary`, `logBootDegradationSummary`, `reportStartupBootFailure`; the rewritten reservation; the `armBootSummary` wiring. |
| MODIFY | `apps/ptah-electron/src/activation/wire-runtime.spec.ts`            | +1 at `:7`, +5 at `:39-43`, +248 at `:391-638`                   | Ten cases across two new `describe` blocks.                                                                                                                                                       |
| MODIFY | `libs/backend/platform-cli/src/settings/cli-master-key-provider.ts` | +17 at `:136-152`, +3 at `:156-158`, +3 at `:169-171`            | The classification rationale on `tryLoadKeytar` plus two `degradation-audit: optional-capability` suppressions.                                                                                   |

575 insertions, 2 deletions. Nothing outside the batch's "Files owned" list was
created or modified. `wire-runtime.boot-order.spec.ts` was deliberately **not**
edited (it is not in the owned list) — see "The one existing spec this could
have broken" below.

---

## Task 2.1 — the boot degradation summary

**Hook, confirmed and cited.** `BootCoordinator.startPostWindow`
(`boot-coordinator.ts:343` pre-edit, `:392` post-edit) is the method. The
terminal transition is its promise chain: `this.phase = 'settled'` in the
`.then()` (the `:370` the plan validation named) and the deliberate phase-KEEP
in the `.catch()`. The summary fires from the chain's `.finally()`, as the last
statement, after `markPersistenceSettled`.

**The wiring, and why it is split across two files.** `boot-coordinator.ts`
states its own invariant at `:42-44`: _"Nothing in this file imports a runtime
value. Every import is `import type`, so the module is loadable under ts-jest
without an Electron runtime"_, and `:229-232` records that the readiness emitter
is a plain function rather than a container **for exactly this reason**.
Resolving `TOKENS.DEGRADATION_REPORTER` inside the coordinator would have ended
that invariant and broken its spec file, which requires the module directly. So
the coordinator gained a `armBootSummary(emit: () => void)` hook — the precise
shape of the existing `onReadinessChange` / `armWarmup` pair — and
`wire-runtime.ts`, which owns the container, arms it beside `armWarmup`:

```ts
coordinator.armWarmup(() => runEmbedderWarmup(container));
coordinator.armBootSummary(() => {
  logBootDegradationSummary(container);
});
```

**Lazy resolution behind `isRegistered`.** `logBootDegradationSummary` checks
`container.isRegistered(TOKENS.DEGRADATION_REPORTER)` and
`container.isRegistered(TOKENS.LOGGER)` per call before resolving either — the
idiom `DegradationReporter.broadcast` uses for `TOKENS.WEBVIEW_MANAGER`
(`degradation-reporter.ts:182`). A host with neither gets silence, not a throw.

**Exactly one line.** `emitBootSummary` nulls `this.bootSummary` before invoking
it, so the line cannot be emitted twice even if a future caller reached the
terminal transition more than once. The line itself is built by
`formatDegradationSummary`, which slices `snapshot.entries` (already sorted
count-desc, code-asc by Batch 1) to five codes and folds the remainder into
"and N more" — a boot with forty degradations produces one line, pinned by the
named spec case.

**The two wordings, quoted verbatim from the passing tests.**

`info`, at zero degradations
(`wire-runtime.spec.ts`, "logs exactly one info line when the boot degraded
nothing"):

```
[Degradation] Boot summary: no capability degraded during this boot.
```

`warn`, otherwise
(`wire-runtime.spec.ts`, "logs exactly one warn line naming the top codes and
their counts"):

```
[Degradation] Boot summary: 5 degradations across 2 codes — electron.boot.startOrJoin-failed x3, database.backup.no-worker x2.
```

With the two Batch-1 counters non-zero, the same single line extends
("names the dropped reports and the pushes that never landed"):

```
[Degradation] Boot summary: 2 degradations across 1 code — settings.keytar-unavailable x1. 1 report dropped past the code cap. 1 push never reached the renderer.
```

The level is derived from `snapshot.total`, never from any report's own
`severity` — the reporter's contract is that severity is one call site's
judgement about one capability, not about the boot.

**Failure isolation.** Two layers, and both are asserted. `emitBootSummary`
wraps the call in `try` / `catch (error: unknown)` and logs one
`console.warn`; and because it runs in `.finally()` the phase, the readiness,
their emit, and `markPersistenceSettled` have all already happened, so the
summary is structurally incapable of being upstream of the transition. A spec
throws from the summary and asserts the snapshot is still
`{ readiness: 'ready', phase: 'settled', … }` and that the persistence gate
still resolves.

**CLI: no line was emitted, and none was invented.** `libs/backend/cli-engine`
has **no boot terminal**. Grepped its whole `src` for
`setPhase|BootPhase|bootPhase|boot complete|booted|ready in` — the single hit is
an unrelated doc comment in `bootstrap/with-engine.ts:218`. `withEngine`
(`:249`) is a scoped run wrapper with **no logging statements at all**
(`grep -n "console\.|logger\."` over the file returns nothing), and the CLI has
no equivalent of the Electron phase vocabulary. Per the batch instruction this
is recorded rather than fabricated: a CLI summary needs a boot terminal to
exist first, and creating one is not this batch's work. `cli-engine` is also not
in Batch 2's owned files.

---

## Task 2.2 — the `wire-runtime.ts` startup swallow

**PC-4 confirmed**: the site was line **325**, not 324.

Before:

```ts
if (startupWorkspaceRoot) {
  void booter.startOrJoin(startupWorkspaceRoot).catch(() => undefined);
}
```

After (`wire-runtime.ts:453-460`):

```ts
if (startupWorkspaceRoot) {
  const reserved = booter.startOrJoin(startupWorkspaceRoot);
  void reserved.catch((error: unknown) => {
    reportStartupBootFailure(container, error);
  });
}
```

`reportStartupBootFailure` (`wire-runtime.ts:194-227`) does both halves:

- The sibling's logging form —
  `console.error('[Ptah Electron] Failed to boot heavy services for the startup workspace:', error)`.
  The suffix differs from the `:290-295` sibling's "lazily" only so a reader can
  tell the two call sites apart in a log; the shape, the level and the raw
  `error` second argument are the sibling's.
- **One** `reporter.report({ source: 'boot', code:
'electron.boot.startOrJoin-failed', severity: 'critical', summary: …, detail:
<the message> })`. `critical` because nothing about the app works normally
  when the startup workspace never booted its database, harness or sessions —
  the level Batch 1 defined for exactly that.
- Resolution is behind `isRegistered` and wrapped: with no reporter registered
  the `console.error` still happens and nothing throws, asserted by a named
  case.

The **varying** part of the failure goes in `detail`; the `code` is a string
literal. A spec drives two different errors through and asserts the set of
emitted codes has size 1 — the interpolated-code failure mode Batch 1 can only
contain and Batch 3 must detect.

**The spec forces a real rejection.** "logs AND reports exactly once when the
startup startOrJoin rejects" builds
`{ startOrJoin: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY')) }`,
reproduces the call site's exact shape (reserve, then `.catch` with the
production handler), awaits it, and asserts `console.error` was called once with
the exact message and `report` was called once with the exact payload.

**The one existing spec this could have broken.**
`wire-runtime.boot-order.spec.ts:73/83/99` locates the reservation by searching
the source for the literal substring `booter.startOrJoin(startupWorkspaceRoot)`
and asserts it comes after `await bringUpSubsystems(` and after the
workspace-folders listener. The natural rewrite
(`void booter\n  .startOrJoin(startupWorkspaceRoot)\n  .catch(…)`) is what
Prettier produces and it would have split that substring across lines, silently
unpinning three ordering invariants without failing anything. The local
`const reserved = …` keeps the call one unbroken expression; a comment at the
call site says so, and all three assertions still pass.

---

## Task 2.3 — the keytar probe

Classified as a **legitimate optional capability** and suppressed with a reason.
The fallback is untouched.

Two suppressions, because `tryLoadKeytar` swallows twice for one reason — the
`.catch(() => null)` on the dynamic import (the site the plan named, now
`:156-159`) and the surrounding `catch` that covers a synchronous
module-resolution failure (`:169-172`):

```ts
// degradation-audit: optional-capability — keytar is an optional native
// module; absent on headless hosts with no OS keyring, and the caller falls
// back to an HKDF-derived key.
const kt = await import('keytar').catch(() => null);
```

**Why a suppression and not a reported code.** `platform-cli`'s own CLAUDE.md
fixes its dependencies at "**Internal**: `@ptah-extension/platform-core`" and
forbids importing sibling adapters; `DegradationReporter` lives in
`vscode-core`. Emitting a report from this probe would add an
adapter → infrastructure edge to satisfy a diagnostic, against the hexagonal
rule, and the probe is a free function with no container to resolve one from
anyway. The doc comment records where a CLI-side report would belong if one is
ever wanted: the **caller**, which already knows whether it fell back. This is
the batch-sanctioned alternative ("either add a reported code **or** a
`// degradation-audit: optional-capability — <reason>` suppression"), and
neither suppression is bare.

**One thing for Batch 3 to confirm.** The suppression comments sit
_immediately above the swallowing expression_ and, for the `catch`, _as the
first line inside the catch block_ — not above the `} catch {` line. If the
audit tool's parser expects the comment strictly above the `catch` clause
token, this one placement needs moving; the tool is uncommitted and under review
so the convention could not be read from it.

---

## Report codes introduced

| Code                               | Source | Severity   | Site                                                   |
| ---------------------------------- | ------ | ---------- | ------------------------------------------------------ |
| `electron.boot.startOrJoin-failed` | `boot` | `critical` | `wire-runtime.ts:206` (via `reportStartupBootFailure`) |

No code was introduced for the keytar probe — see task 2.3.

---

## Test names added (16, all passing)

`apps/ptah-electron/src/activation/boot-coordinator.spec.ts` —
`BootCoordinator — degradation summary (TASK_2026_383)`:

- fires the armed summary exactly once when the boot settles
- fires the summary after the terminal phase is already written
- **still fires the summary when the boot FAILS**
- **does not let a throwing summary disturb the terminal transition**
- does not let a throwing summary strand the persistence gate
- tolerates a boot with no summary armed

`apps/ptah-electron/src/activation/wire-runtime.spec.ts` —
`logBootDegradationSummary (TASK_2026_383 task 2.1)`:

- logs exactly one info line when the boot degraded nothing
- logs exactly one warn line naming the top codes and their counts
- **emits ONE line for a boot with forty degradations, not forty**
- names the dropped reports and the pushes that never landed
- stays silent, and does not throw, with no reporter registered
- does not throw when the reporter itself explodes

`reportStartupBootFailure (TASK_2026_383 task 2.2)`:

- **logs AND reports exactly once when the startup startOrJoin rejects**
- carries a non-Error rejection through as its string form
- uses a string literal code, so the tally means something
- still logs when no reporter is registered

Confirmed these ran rather than being silently absent:
`npx jest --config apps/ptah-electron/jest.config.ts --rootDir apps/ptah-electron -t "TASK_2026_383"`
→ `Tests: 446 skipped, 16 passed, 462 total`.

---

## Verification

All commands from `D:/projects/ptah-extension/.claude-worktrees/task-383`, all
with `--skip-nx-cache` so the output is real execution and not a replayed
cache hit. Header read back on each: **`Running target … for 2 projects`** —
the count asked for.

### `npx nx run-many -t test -p ptah-electron @ptah-extension/platform-cli`

```
 NX   Running target test for 2 projects:

- ptah-electron
- @ptah-extension/platform-cli

> nx run @ptah-extension/platform-cli:test
Test Suites: 12 passed, 12 total
Tests:       3 todo, 197 passed, 200 total
Time:        25.318 s

> nx run ptah-electron:test
Test Suites: 1 skipped, 35 passed, 35 of 36 total
Tests:       8 skipped, 454 passed, 462 total
Time:        45.166 s

 NX   Successfully ran target test for 2 projects
```

The 1 skipped suite / 8 skipped tests are pre-existing (build-artifact and
platform guards; Batch 4 owns that policy) and identical to the pre-change run.
The 3 `todo` in `platform-cli` are likewise pre-existing.

### `npx nx run-many -t lint -p ptah-electron @ptah-extension/platform-cli`

```
 platform-cli:   ✖ 3 problems (0 errors, 3 warnings)
 ptah-electron:  ✖ 5 problems (0 errors, 5 warnings)

 NX   Successfully ran target lint for 2 projects
```

**Zero errors.** All 8 warnings are pre-existing and in files this batch did not
touch: `plugin-activation.ts` (unused `path`), `electron-adapters.ts` and
`electron-browser-capabilities.ts` (empty functions), `editor-rpc.handlers.ts`
(`max-lines`, 774), plus three in `platform-cli` files outside this batch. No
warning is attributable to a Batch 2 file. `wire-runtime.ts` is 565 lines and
`boot-coordinator.ts` 633 — both under the 700-line soft ceiling after the
change.

### `npx nx run-many -t typecheck -p ptah-electron @ptah-extension/platform-cli`

```
> nx run @ptah-extension/platform-cli:typecheck
> tsc --noEmit --project libs/backend/platform-cli/tsconfig.lib.json

> nx run ptah-electron:typecheck
> tsc --noEmit --project apps/ptah-electron/tsconfig.app.json

 NX   Successfully ran target typecheck for 2 projects
```

`nx affected -t typecheck` was **not** used as the gate, for the reason Batch 1
recorded and re-verified: the 13 `libs/api` projects fail on a gitignored,
ungenerated Prisma client in this worktree. Per PC-3 every project name above
was read from `project.json`.

### Formatting

`npx nx format:write --files <the five files>` was run before the final test
pass, so a later `git add` cannot fire husky's `nx format:write` and reformat
these files into a diff nobody wrote. Tests were re-run **after** formatting and
are the results quoted above.

---

## Acceptance criteria

| Criterion                                                                   | Result                                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A boot with zero degradations logs one `info` line                          | Met — named spec case, wording quoted above; `logger.warn` asserted not called.                                                                              |
| A forced `startOrJoin` rejection produces both a log and exactly one report | Met — named spec case, `toHaveBeenCalledTimes(1)` on both.                                                                                                   |
| The keytar site is classified in the diff                                   | Met — two `degradation-audit: optional-capability` suppressions, each with a reason, plus a doc comment giving the architectural reason no code is reported. |
| Exactly one line per boot, not one per code                                 | Met — the forty-degradation case asserts one `warn` call and a line with no newline in it.                                                                   |
| A summary failure cannot affect the terminal transition                     | Met — two cases: the snapshot is unchanged and the persistence gate still resolves.                                                                          |

---

## Deviations

**D-1. The summary fires from the post-window chain's `.finally()`, not from
beside `this.phase = 'settled'` in the `.then()`.** The batch prompt named the
`:370` transition as the hook. Same method, same terminal chain, ~20 lines
later, and the move is deliberate on two grounds. First, the `.then()` runs
**only on a successful boot**: the `.catch()` at `:374` deliberately KEEPS the
last phase on failure, so a summary hung off `.then()` alone would print nothing
for a failed boot — the boot whose degradations a reader most needs. Second,
`.finally()` runs after the phase, the readiness, their emit and
`markPersistenceSettled` have all completed, which makes "a summary failure
cannot affect the terminal phase transition" true by construction rather than
only by its catch block. Both properties are pinned by named spec cases ("still
fires the summary when the boot FAILS", "does not let a throwing summary
disturb the terminal transition"). Reversible in one line if the reviewer
disagrees.

**D-2. `BootCoordinator` gained an `armBootSummary` hook rather than resolving
the reporter itself.** The batch text implies the coordinator emits the line.
It cannot without breaking the invariant the file documents at `:42-44` (every
import is `import type`, so the module loads under ts-jest with no Electron
runtime) — the same reason `:229-232` gives for the readiness emitter being a
plain function rather than a container. The hook is the shape that file already
uses twice (`onReadinessChange`, `armWarmup`), and the container-owning half
lives in `wire-runtime.ts`, which is also owned by this batch. No new file, no
new module.

**D-3. Two suppressions in `cli-master-key-provider.ts`, not one.** The plan
names `:139` (`await import('keytar').catch(() => null)`). The enclosing
`catch` a few lines below swallows the synchronous half of the same probe for
the same reason; suppressing one and leaving the other would have left the audit
tool a bare unexplained swallow in a function whose whole point had just been
documented.

**D-4. The startup-failure log message says "for the startup workspace" where
the sibling says "lazily".** Same form, same level, same raw-`error` second
argument. Two call sites of one method that print an identical line are
indistinguishable in a log, which is a small version of the problem this task
exists to fix.

Nothing else diverged.

---

## Out-of-scope observations

- **`cli-engine` has no boot terminal.** Recorded above under task 2.1. If a CLI
  degradation summary is wanted, it needs a terminal boot moment in
  `with-engine.ts` first — a design decision, not a batch-2 edit.
- **`notifyCorruption` (`cli-master-key-provider.ts:120-130`) has a third bare
  `catch`** that falls back from `showErrorMessage` to `console.error`. It is
  outside task 2.3's named site so it is left unclassified; Batch 5's triage
  pass over `platform-cli` (if that lib is ever opened — it is not in the
  current six) should take it. It is a legitimate fallback, not a defect.
- **`wire-runtime.ts:336` also calls `booter.startOrJoin(startupWorkspaceRoot)`,
  awaited, inside `postWindow()`.** That rejection is _not_ swallowed today: it
  propagates into `coordinator.startPostWindow`, which sets `readiness =
'failed'` and logs. So the reservation at `:453` and the await at `:469` can
  in principle both surface the same failure — the reservation's `.catch` fires
  first and the coordinator's failure path second. That is one report and one
  `readiness: 'failed'`, not a double report, because the reservation returns
  the same latched promise. Noted so a reviewer does not read the two as
  duplicate reporting.
- **Batch 3's `no-empty` / `no-floating-promises` rules are not yet active** in
  this worktree's lint run, so the `void reserved.catch(...)` form above was not
  checked against them. It carries an explicit `.catch`, so it should satisfy
  `no-floating-promises` when that block lands.
