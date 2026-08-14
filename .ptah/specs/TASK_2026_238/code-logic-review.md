# Code Logic Review - TASK_2026_238

## Review Summary

| Metric              | Value                  |
| ------------------- | ---------------------- |
| Overall Score       | 8/10                   |
| Assessment          | APPROVED WITH CONCERNS |
| Critical Issues     | 0                      |
| Serious Issues      | 0                      |
| Moderate Issues     | 1                      |
| Minor Issues        | 2                      |
| Failure Modes Found | 3                      |

Commit reviewed: `31b37f386` on `ak/task-238-codex-binary-path` (worktree
`D:/projects/ptah-extension/.claude-worktrees/task238`).

## The 5 Paranoid Questions

### 1. How does this fail silently?

It doesn't, structurally — `resolveCodexNativeBinary()` / `resolveOpencodeNativeBinary()`
both return `undefined` on total miss and the callers (`codex-cli.adapter.ts:467`,
`opencode-cli.adapter.ts:405`) fall back to letting the SDK/`.cmd` shim self-resolve
rather than throwing. That's the existing (pre-diff) contract and this diff doesn't
change it. The one place a silent failure _could_ reappear is if a future vendor
layout change adds a _third_ directory name — nothing here future-proofs beyond
`CODEX_VENDOR_DIRS = ['bin', 'codex']`; a third rename ships this exact bug again,
just with a different string. That's an acceptable, documented trade-off (the doc
comment says so), not a defect.

### 2. What user action causes unexpected behavior?

None from this diff specifically — it's pure binary-path resolution, no user-facing
control flow changed. The risk surface is packaging-time (asar layout), not user-input
driven.

### 3. What data makes this produce wrong results?

A path that legitimately contains the literal substring `app.asar` **twice** (e.g. a
nested/mirrored build output) would only have its _first_ occurrence rewritten by
`withAsarUnpackedTwin()` (`cli-adapter.utils.ts:304-310`), because `.replace()` is
called without the `/g` flag. In practice Electron's `resourcesPath` layout only ever
contains one `.asar` segment, so this is not reachable today — flagged as Minor #2
below rather than a live bug.

### 4. What happens when dependencies fail?

- `require.resolve(...)` failures are caught in both adapters (unchanged control flow,
  just parameterized over two layouts now) — verified every new `try/catch` still
  wraps exactly the call it wrapped before.
- `existsSync` throwing (e.g. permission-denied edge of a network share) is not
  caught by the `for (const candidate of candidates) if (existsSync(candidate))`
  loop in either adapter (`codex-cli.adapter.ts:308-310`,
  `opencode-cli.adapter.ts:207-209`) — but this is pre-existing behavior, untouched
  by this diff, not something introduced here.

### 5. What's missing that the requirements didn't mention?

The task's own review checklist asked for this, and I found it real: the shared
`withAsarUnpackedTwin()` helper's actual asar-rewrite _behavior_ (not just its
existence) is exercised end-to-end by exactly one adapter's tests (opencode, via the
injected `resolveModulePath` seam) and has **zero direct unit test** in
`cli-adapter.utils.spec.ts`. See Moderate Issue #1.

## Failure Mode Analysis

### Failure Mode 1: Codex's own asar-twin call site is untested where it matters

- **Trigger**: A future change to `withAsarUnpackedTwin()` (or to how
  `resolveCodexNativeBinary()`'s sdk-package-walk-up branch calls it) that breaks the
  asar→asar.unpacked rewrite specifically for Codex.
- **Symptoms**: None visible in CI for the Codex adapter — `codex-cli.adapter.spec.ts`
  has no test that constructs a path containing a real `app.asar` substring through
  that branch (see Moderate Issue #1 for the mechanics). The regression would only be
  caught transitively, by `opencode-cli.adapter.spec.ts`'s test of the _same shared
  helper_ via a different adapter.
- **Impact**: Low today (the helper is simple and correct, verified by hand), but the
  safety net is coincidental, not deliberate, for the Codex side.
- **Current Handling**: None — no dedicated regression test.
- **Recommendation**: Either (a) add 2-3 direct unit tests for
  `withAsarUnpackedTwin()` in `cli-adapter.utils.spec.ts` (it's a pure function, no
  seam/mocking required — `expect(withAsarUnpackedTwin('C:/a/app.asar/b')).toEqual(['C:/a/app.asar/b', 'C:/a/app.asar.unpacked/b'])` and the "already unpacked" / "no asar" cases), or (b) give
  `resolveCodexNativeBinary()` the same injectable-resolver seam opencode got, so its
  own spec can drive a synthetic `app.asar` path through the identical branch. (a) is
  cheaper and closes the gap for both adapters at once.

### Failure Mode 2: `require.resolve`-derived candidates are environment-dependent during tests

- **Trigger**: Running `codex-cli.adapter.spec.ts`'s new
  "native binary resolution" suite on a non-Windows/non-x64 CI runner.
- **Symptoms**: `@openai/codex-win32-x64` carries `"os": ["win32"], "cpu": ["x64"]`
  in its own `package.json` (confirmed on disk), so npm skips installing it on other
  platforms. `require.resolve('@openai/codex-win32-x64/package.json')` inside
  `resolveCodexNativeBinary()`'s platform-package branch (`codex-cli.adapter.ts:263-268`)
  throws on such a runner and is silently caught — vs. resolving to a real path (and
  exercising `pushLayouts`/`withAsarUnpackedTwin` against real filesystem paths) on a
  Windows dev/CI box. This is not a flakiness bug: none of the five new assertions in
  that `describe` block depend on this branch's candidates (they only check
  `probedPaths()[0]`/`[1]`, which come from the `resourcesPath` root, unconditionally
  constructed). But it is worth knowing the test's _effective_ coverage of the
  require.resolve-driven branches silently varies by host OS/CPU — reinforces Failure
  Mode 1's point that the sdk-package-walk-up branch isn't deliberately pinned.
- **Impact**: None on correctness or CI green/red; informational only.
- **Current Handling**: N/A — not a bug, a coverage-shape observation.
- **Recommendation**: Covered by the same fix as Failure Mode 1 (a).

### Failure Mode 3: A third vendor-layout rename repeats this exact bug class

- **Trigger**: `@openai/codex-sdk` ships a third vendor subdirectory name in some
  future version (this has already happened once, `codex/` → `bin/`, per the task's
  own root-cause narrative).
- **Symptoms**: Same as the original bug — `resolveCodexNativeBinary()` returns
  `undefined`, `codexPathOverride` unset, SDK self-resolves, ENOENT under asar.
- **Impact**: High if it recurs (this is literally what shipped in production per
  `context.md`), but out of scope for this diff — `CODEX_VENDOR_DIRS` is a `const`
  array, trivially extended, and the doc comment at
  `codex-cli.adapter.ts:169-175` correctly documents the assumption instead of hiding
  it. Not a defect in this diff; noted because the paranoid-review mandate asks for it.
- **Current Handling**: Documented assumption, easy single-point fix if it recurs.
- **Recommendation**: None required for this diff. Worth a comment-only note (already
  present) so the next person who hits this doesn't have to re-derive the root cause.

## Critical Issues

None found.

## Serious Issues

None found.

## Moderate Issues

### Issue 1: `withAsarUnpackedTwin()` has no direct unit test, and its only real

end-to-end exercise is through the opencode adapter, not codex

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:304-310`
- **Scenario**: See Failure Mode 1 above.
- **Impact**: Test-coverage gap, not a functional bug — I traced the logic by hand
  and it is correct (regex negative-lookahead correctly refuses to double-rewrite an
  already-`.unpacked` path; verified against `"app.asar.unpacked"` input matching no
  position). But "verified correct by manual trace" is exactly the situation code
  review exists to eliminate going forward.
- **Evidence**: `grep -rn "withAsarUnpackedTwin" libs/.../cli-adapters/*.spec.ts` hits
  only usage inside `opencode-cli.adapter.spec.ts`'s `resolveModulePath`-seam tests
  (lines 583-603); `cli-adapter.utils.spec.ts` has zero references to the symbol.
  `codex-cli.adapter.spec.ts`'s asar-related assertion (line 868-870,
  `expect(probedPaths().some((p) => /app\.asar(?!\.unpacked)/.test(p))).toBe(false)`)
  passes vacuously in this environment because none of the candidates constructed
  during that test ever contain the substring `app.asar` to begin with (they're real
  Windows dev-machine paths under `D:\projects\...` or the synthetic
  `RESOURCES = /ptah-app/resources` + `app.asar.unpacked` literal, which was never
  `app.asar` to start with).
- **Fix**: Add a small dedicated `describe('withAsarUnpackedTwin')` block to
  `cli-adapter.utils.spec.ts` covering: (1) a path containing `app.asar` returns
  `[original, rewritten]` with rewritten adjacent; (2) a path already containing
  `app.asar.unpacked` returns `[original]` (no double-rewrite); (3) a path with no
  `app.asar` segment returns `[original]` only (verifies the "improvement" over the
  old inline code's harmless duplicate push, called out under "What Robust
  Implementation Would Include" below).

## Data Flow Analysis

```
resolveCodexNativeBinary(detectedCliPath?)
  targetTriple = getTargetTriple()              [unchanged]
  platformPkg  = CODEX_PLATFORM_PACKAGES[triple] [unchanged]
  relsFromPkg         = ['bin','codex'].map(d => vendor/<triple>/<d>/<binary>)
  relsFromNodeModules = relsFromPkg.map(r => '@openai/<pkgDir>/' + r)
  relsFromBin         = relsFromNodeModules.map(r => 'node_modules/' + r)

  candidates = []
    ① resourcesPath        → pushLayouts(resourcesPath/app.asar.unpacked, relsFromBin)      [bin, codex]
    ② require.resolve(platformPkg/package.json)  → pushLayouts(dirname, relsFromPkg)         [bin, codex]
    ③ require.resolve(codex-sdk/package.json) walk-up
         → for each of relsFromNodeModules: push ...withAsarUnpackedTwin(nodeModulesRoot+rel) [bin, bin.unpacked?, codex, codex.unpacked?]
    ④ npm globals (win: APPDATA\npm | unix: /usr/local/lib, /usr/lib, ~/.npm-global, ~/.nvm/...)
         → pushLayouts(root, relsFromBin) per root                                            [bin, codex] x N
    ⑤ detectedCliPath heuristics
         → pushLayouts(cliDir, relsFromBin)                                                   [bin, codex]
         → pushLayouts(cliDir/node_modules/@openai/codex/node_modules, relsFromNodeModules)    [bin, codex]
         → (unix, basename==='bin') pushLayouts(dirname(cliDir)/lib, relsFromBin)              [bin, codex]

  for candidate in candidates: if existsSync(candidate) return candidate
  return undefined
```

Cross-root order (①→②→③→④→⑤) and within-root order (`bin` before `codex`) both
verified unchanged from the pre-diff version by direct comparison of
`git show 31b37f386^:...codex-cli.adapter.ts` against the current file — every one of
the 10 candidate-construction call sites present pre-diff has a corresponding
`pushLayouts`/`withAsarUnpackedTwin`-based call post-diff, none dropped, none
reordered relative to its siblings.

### Gap Points Identified

1. None found in the resolution logic itself — full site-by-site trace confirmed no
   candidate root was silently dropped (the two sites called out in the task
   description — the `detectedCliPath` heuristics and the nested
   `@openai/codex/node_modules/...` candidate — are both correctly dual-layout).
2. Test-coverage gap only, per Moderate Issue #1 — does not affect production
   correctness, affects the safety net around future changes.

## Requirements Fulfillment

| Requirement                                                                        | Status   | Concern                                                                     |
| ---------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| Codex: every candidate root probes both `bin/` and `codex/`, newest first          | COMPLETE | None — all 10 sites verified                                                |
| Codex: cross-root priority order preserved                                         | COMPLETE | None                                                                        |
| opencode: `app.asar` → `app.asar.unpacked` twin on both module-resolved candidates | COMPLETE | None                                                                        |
| Shared `withAsarUnpackedTwin()` helper, used by both adapters                      | COMPLETE | Helper itself under-tested directly (Moderate #1)                           |
| Unit tests pinning "resolves when only `bin/` layout exists"                       | COMPLETE | Verified this test fails against the pre-diff code (see Test Quality below) |
| Doc comments match actual behavior                                                 | COMPLETE | Both adapters' doc comments updated and accurate                            |

### Implicit Requirements NOT Addressed

None beyond the test-coverage gap already called out — the task's stated scope
(candidate completeness, ordering, helper correctness, seam justification, test
quality, doc accuracy) is fully covered by this review.

## Test Quality — Would Each New Test Fail on Revert?

Manually reverted the fix (mentally, by re-reading `codex-cli.adapter.ts^`) and traced
each new assertion against the old single-layout (`codex/` only) candidate
construction:

| Test                                                                         | Fails on revert?       | Why                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probes both vendor layouts per candidate root, bin/ first`                  | **YES**                | `probed[0]` would be the `codex/` path (old code's only candidate), not `bin/`                                                                                                                                                                    |
| `probes the packaged Electron root under app.asar.unpacked`                  | No (passes either way) | Tests an orthogonal, already-correct invariant (resourcesPath always targets `.unpacked`) — not a regression pin for _this_ bug, but not tautological/wrong either, just testing a different property. Flagged for completeness, not as a defect. |
| `prefers the bin/ layout when both layouts exist`                            | **YES**                | Old code never constructs a `bin/` candidate at all, so `resolvedOverride()` would be `legacyLayout`, not `binLayout`                                                                                                                             |
| `resolves when only the current bin/ layout exists`                          | **YES**                | Old code never probes `binLayout`; `existsSync` never returns true for anything probed → `undefined`, not `binLayout`                                                                                                                             |
| `resolves when only the legacy codex/ layout exists`                         | No (passes either way) | Legitimate backward-compat check, not a regression pin — old code already supported this path                                                                                                                                                     |
| opencode: `probes the app.asar.unpacked twin right after the asar candidate` | **YES**                | Old code never pushes the unpacked twin at all; `indexOf(unpackedCandidate)` would be `-1`                                                                                                                                                        |
| opencode: `resolves the unpacked twin when only it exists on disk`           | **YES**                | Old code never probes the twin path; would resolve `undefined` instead                                                                                                                                                                            |

Verdict: the tests that matter for regression-pinning genuinely fail against the
pre-diff code — not tautological. `process.platform`/`arch` stubbing uses
`Object.defineProperty(..., { configurable: true })` with restoration in `afterEach`
in both new `describe` blocks; confirmed no leakage risk since `afterEach` runs
regardless of test outcome.

## Edge Case Analysis

| Edge Case                                        | Handled   | How                                                                | Concern                                                 |
| ------------------------------------------------ | --------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| Only `bin/` layout exists on disk                | YES       | `bin/` probed first at every root                                  | None                                                    |
| Only legacy `codex/` layout exists               | YES       | `codex/` probed second, still found                                | None                                                    |
| Both layouts exist                               | YES       | `bin/` wins (probed first, loop returns on first `existsSync` hit) | None                                                    |
| Neither layout exists                            | YES       | Returns `undefined`, caller lets SDK self-resolve                  | Pre-existing behavior, unchanged                        |
| Path already under `app.asar.unpacked`           | YES       | Negative lookahead prevents double-rewrite                         | None                                                    |
| Path contains `app.asar` twice                   | Partially | Only first occurrence rewritten (no `/g` flag)                     | Minor #2 — not reachable in real Electron layouts today |
| `require.resolve` throws (package not installed) | YES       | Caught, no candidates added from that root                         | Pre-existing pattern, correctly preserved               |
| opencode on non-Windows                          | YES       | Early `return undefined` before any candidate construction         | Unaffected by this diff                                 |

## Integration Risk Assessment

| Integration                                                           | Failure Probability             | Impact                                      | Mitigation                                                |
| --------------------------------------------------------------------- | ------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `@openai/codex-sdk` ships a third vendor layout                       | LOW (has happened once already) | High if it recurs (repeats the shipped bug) | `CODEX_VENDOR_DIRS` const array, one-line fix; documented |
| `withAsarUnpackedTwin()` regression, caught only via opencode's tests | LOW-MED                         | Low (helper is simple, correct today)       | Add direct unit tests (Moderate #1)                       |

## The Developer's Flagged Deviation — `resolveModulePath` Seam

Assessed as **justified and well-contained**:

- The seam (`ModulePathResolver` type + `requireResolveModulePath` default,
  `opencode-cli.adapter.ts:126-131, 150-152`) is the only way to drive a synthetic
  `app.asar` path through `require.resolve`-derived candidates under Jest, since Jest
  can never make `require.resolve` return a fabricated `app.asar` path. Without it,
  the asar-twin logic for opencode's two module-resolved candidates would be as
  untested as codex's (Moderate #1) — worse, actually, since opencode's two candidates
  are the _entire_ point of this half of the fix (per the commit message).
- The default wrapper (`requireResolveModulePath`) keeps `require` inside the
  function body, not the module top level, and every call site still routes through
  the pre-existing `try { ... } catch { // noop }` blocks unchanged — confirmed via
  diff, structurally identical to before, just substituting `resolveModulePath(...)`
  for `require.resolve(...)`.
- It does **not** leak into the library's public API: `resolveOpencodeNativeBinary` is
  exported from `opencode-cli.adapter.ts` (marked `@internal`, doc-commented as
  "Exported for unit tests only"), but the barrel
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts` uses
  explicit named re-exports and does **not** re-export it — confirmed by reading the
  barrel. `libs/backend/cli-agent-runtime/src/index.ts` doesn't reach it either. So
  external consumers of the lib's public surface never see this seam; only the spec
  file (which imports directly from the file, not the barrel) does.
- **Inconsistency with codex**: real, and already covered under Moderate Issue #1 /
  Failure Mode 1. My judgment: the inconsistency is acceptable _as shipped_ (it
  doesn't cause a production bug), but it does mean codex's own asar-twin call site is
  the less-tested of the two. Recommend closing via direct `withAsarUnpackedTwin` unit
  tests rather than adding a matching seam to `resolveCodexNativeBinary()` — codex's
  function isn't exported at all today, and adding the seam there purely to satisfy a
  test would be the "test-shaped API leaking into production" the task asked me to
  watch for. Testing the shared pure helper directly avoids that trade-off entirely
  for both adapters at once.

## Verdict

**Recommendation**: APPROVE — with the test-coverage gap (Moderate Issue #1) noted for
a fast follow-up, not a blocker. The core fix (candidate completeness, ordering,
`withAsarUnpackedTwin` correctness) is correct by direct trace against the pre-diff
source, and the regression-pinning tests genuinely fail when the fix is reverted.

**Confidence**: HIGH — every candidate-construction site was individually diffed
against the pre-change file; the shared helper's regex was traced by hand against the
three relevant input shapes (asar, already-unpacked, no-asar); barrel exports were
checked to confirm the test seam doesn't leak into the public API.

**Top Risk**: `withAsarUnpackedTwin()` — the piece of logic actually fixing the
"ENOENT under asar" half of this bug — has no test that would catch a regression in
it specifically for the Codex adapter (only opencode's tests would catch it, coincidentally).

## What Robust Implementation Would Include

- A direct unit-test suite for `withAsarUnpackedTwin()` in `cli-adapter.utils.spec.ts`
  (pure function, trivial to test, closes the gap for both adapters at once — see
  Moderate Issue #1's recommended fix).
- Optionally, a comment on `CODEX_VENDOR_DIRS` cross-referencing the exact upstream
  SDK version/commit where `bin/` was introduced, so the "resolver was written against
  the pre-0.147 layout" failure mode (Failure Mode 3) is easier to diagnose from a
  version bump alone next time, without needing to re-run the `require.resolve` trace
  the human author did in `context.md`.
