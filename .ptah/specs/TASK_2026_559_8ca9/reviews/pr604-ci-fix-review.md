# Independent Review — PR #604 CI Fixes (TASK_2026_559_8ca9)

Scope: uncommitted working-tree changes on `fix/task-559-mcp-tool-contract`,
HEAD `5f10aaae4`, per `git status`/`git diff` (14 modified files, no source
files outside that list touched). Read-only review; nothing edited except
this document. Verification performed independently — the author's own
`pr604-ci-fix-linux-tests-report.md` and `pr604-ci-fix-sonar-report.md` were
read only after forming my own conclusions from the diff and test runs, to
cross-check rather than to source the verdict.

## Verdict

**APPROVE**

Score: **9/10**. All five checked areas hold up under independent
re-verification, including a reverse test (restoring the pre-fix `isEsrch`
and confirming the new regression test then fails). One pre-existing
Moderate-severity gap in the S8707 mitigation is worth a follow-up but does
not block this CI-fix PR — it does not regress anything the packaging flow
exercises today.

## 1. `process-tree-reaper.ts` — `isEsrch` duck-typing

**Correct and does not introduce a new false-"process gone" path.**

- Diff (`process-tree-reaper.ts:38-44`): dropped `error instanceof Error` and
  now checks `code === 'ESRCH' || String(message).includes('ESRCH')` on a
  duck-typed `{code, message}` destructure of `error ?? {}`.
- The `message.includes('ESRCH')` substring check is **not new** — it existed
  in the pre-fix code too (`error.message.includes('ESRCH')`), gated behind
  `instanceof Error`. The only behavioural change is removing the `instanceof`
  gate, which is exactly the fix the bug required (see below). A non-ESRCH
  error whose message merely contains the substring "ESRCH" (e.g. a
  fabricated string) would already have been misclassified before this patch,
  on any object that happened to pass `instanceof Error`; this is a pre-existing,
  unchanged corner case, not a regression.
- `EPERM` is unaffected: `code !== 'ESRCH'` and a real Node `EPERM` message
  ("kill EPERM") does not contain "ESRCH", so `isEsrch` still returns `false`
  and the poll keeps running — confirmed by the untouched EPERM test at
  `process-tree-reaper.spec.ts:160-179`, which still passes.
- `isEsrch` is only reached from the POSIX branch (`killGroup`'s fallback
  catch, and the liveness poll) — `process-tree-reaper.ts:75-120`. The Windows
  branch uses `execFile`/`taskkill` and never calls `isEsrch`, so the
  duck-typing risk has zero surface on win32.
- Defensive to malformed input: `error` being `null`/`undefined`/a primitive
  does not throw — `(error ?? {})` short-circuits, and destructuring a string
  primitive yields `undefined` for both fields, so `String(undefined)` is
  `"undefined"`, which does not match. No new crash path.

**Regression test is real and does reproduce the actual Jest cross-realm
gap** (`process-tree-reaper.spec.ts:203-235`). I independently verified this,
not just read the comment:

- Ran the new spec as-is: 9/9 pass, including the new test
  (`npx jest -c libs/backend/platform-core/jest.config.ts src/utils/process-tree-reaper.spec.ts`).
- Wrote a throwaway probe spec (deleted after) that calls
  `process.kill(<exited pid>, 0)` inside the same Jest project and logged
  `realEsrch instanceof Error` → **`false`**, `code` → `"ESRCH"`. This
  confirms the realm-crossing claim empirically, not just by the author's
  comment.
- Reverse-verified the fix is load-bearing: `git stash push -u` on only
  `process-tree-reaper.ts` (restoring the old `instanceof Error`-gated
  `isEsrch`, spec file left at its new content), reran the spec — the new
  regression test **fails** (`onError` called twice with `[Error: kill
ESRCH]`), the other 8 tests still pass. Reapplied the stash and dropped it;
  `git diff --stat` afterward matched the pre-check state exactly, so the
  working tree was left as found.
- Conclusion: the test would have caught the shipped bug, and does not pass
  vacuously against the new code for an unrelated reason.

## 2. vscode-lm-tools fixture-root fixes

**Confirmed: product is correct, only the test fixtures assumed Windows.**

- `toAbsoluteWorkspacePath` (`analysis-namespace.builders.ts:347-349`) is
  `path.isAbsolute(file) ? file : path.join(workspaceRoot, file)` — host-scoped
  `path.isAbsolute`, by design (per the file's own comment at lines ~532-538
  about resolving relative paths safely). On a real Linux/macOS workspace,
  `ptah.search.findFiles()` and `getWorkspaceRoot()` return genuine POSIX
  absolute paths (`/home/...`), so `path.isAbsolute` correctly recognizes them
  and no doubling occurs there. The doubling was purely an artifact of the
  spec fixture using the Windows-literal `'D:/ws/...'`, which
  `path.posix.isAbsolute` correctly reports as `false`.
- Fix scope is fixtures only: `analysis-namespace.builders.spec.ts` now
  derives `root = path.join(path.sep, 'ws')` (absolute on both POSIX,
  `/ws`, and Windows, `\ws`, since `path.win32.isAbsolute('\ws')` is `true`),
  and `export-disclosure.integration.spec.ts` changed `ROOT` from
  `'D:/ws-24d'` to `'/ws-24d'` (absolute on both platforms). No production
  file in `vscode-lm-tools` was touched for this issue —
  `dashboard-contract-help.ts` is the only non-spec change in that library
  and it is the unrelated S2871 sort fix (see §3).
- **No assertion weakened.** Diffed each `expect(...)` in both spec files:
  counts, glob/exclude assertions, truncation limits, and the shape of
  `out.files` are unchanged; only the literal root values were parameterized
  through `root`/`alreadyAbsolute` variables computed from `path.join`/`path.sep`,
  and the expected `files` arrays are still built by joining the same `root`,
  so the assertion is exactly as strict as before, just host-portable.
- Independently ran both spec files: `114/114` pass
  (`npx jest -c libs/backend/vscode-lm-tools/jest.config.ts export-disclosure.integration.spec.ts analysis-namespace.builders.spec.ts`).

## 3. S2871 sort-comparator fixes

**All 9 flagged sites are fixed, all hold string arrays, and the comparator
is order-preserving.**

`(a, b) => (a < b ? -1 : a > b ? 1 : 0)` on strings replicates
`Array.prototype.sort()`'s default (no-comparator) behaviour exactly, because
the default sort also converts elements to strings and compares them by
UTF-16 code unit — it is the same ordering relation, not `localeCompare`
(which can reorder on locale-sensitive equivalences). Verified each site:

| Site                                                                  | Element type                                              | Verified                                                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/copy-wasm.js` (two sorts, ~448/456, same `assert.deepEqual`) | file names (strings)                                      | Comparator added to both; ran `node scripts/copy-wasm.js --self-test` → PASS                                                                                                |
| `go-vet-consent-store.ts:113`                                         | `Object.keys(value)` strings                              | Comparator added; positional comparison against `RECORD_KEYS`/`BINARY_KEYS` unaffected since both sides are sorted the same way                                             |
| `required-keys.ts:139` (`sortedRequiredKeys`)                         | `<capability>:<language>` strings                         | Comparator added                                                                                                                                                            |
| `dashboard-contract-help.ts:296`                                      | keyword strings                                           | Comparator added                                                                                                                                                            |
| `run-diagnostics-provider-contract.ts:186`                            | rendered `${line}:${severity}:${code}:${message}` strings | Comparator added; the adjacent `.sort((a,b)=>a.file.localeCompare(b.file))` at the outer level was correctly left alone (different, pre-existing sort, not in Sonar's list) |
| `workspace-analyzer.service.ts:74` (`monorepoFrameworks`)             | framework name strings                                    | Comparator added                                                                                                                                                            |
| `monorepo-member-discovery.ts:186` (directory names)                  | strings                                                   | Comparator added                                                                                                                                                            |
| `monorepo-member-discovery.ts:300` (candidates)                       | relative path strings                                     | Comparator added                                                                                                                                                            |
| `monorepo-member-discovery.ts:332` (directories)                      | relative path strings                                     | Comparator added                                                                                                                                                            |

That is 9 distinct call sites plus the duplicate sort inside `copy-wasm.js`'s
self-test (11 comparator instances total, matching the report's claim of "9
sites, one file has two"). None of the 9 sites sorts numbers, so the "numbers
must not change order" concern does not apply anywhere in this batch. Ran the
affected suites: `go-vet-consent-store`, `required-keys`,
`workspace-analyzer.service`, `monorepo-member-discovery` (50/50 pass) and
`run-diagnostics-provider-contract` (35/35 pass).

## 4. `verify-packed-wasm.cjs` — S8707 / S5443 / S4036

**S8707 (`apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs`,
`resolveCliVsixPath`, lines 83-101):** blocks paths outside `DIST_DIR` in the
common case, but the mitigation is narrower than the file's own comment
claims. It accepts a resolved path when either:

- it is inside `DIST_DIR` (`resolved === DIST_DIR || resolved.startsWith(DIST_DIR + path.sep)`), or
- it is **any existing `.vsix` file anywhere on disk** (`path.extname === '.vsix' && fs.existsSync(...) && isFile()`).

The second branch means the restriction to "inside the base" is not actually
enforced for a `.vsix`-suffixed argument that already exists outside
`DIST_DIR` — the function's own stderr message ("pass a .vsix file inside
${DIST_DIR}") overstates what it enforces, since an existing `.vsix` outside
`DIST_DIR` is accepted, not refused. This is a real gap in the hotspot fix,
but low severity here: this is a local, developer-invoked build script (no
network or CI-untrusted input reaches `argv[2]`), and both `package.json`/
`project.json` build targets invoke the script with **no** CLI argument
(`node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs`, confirmed
via `project.json:129,137` — both call `--self-test` or no-arg, using
`packagedVsixPath()`, never `resolveCliVsixPath`). So the normal packaging
flow is unaffected and still passes (`--self-test` ran clean:
`VSIX WASM self-test PASS: ...`). Recorded as a Moderate finding below,
not blocking.

**S5443 (`run-diagnostics-provider-contract.ts:327-346`):** confirmed — the
seeded file label now comes from `fs.mkdtempSync(path.join(os.tmpdir(),
'ptah-diag-floor-'))`, used only as a string label passed to `setup.seed?.()`
(not an actual file write), and removed via `fs.rmSync(seededRoot, {
recursive: true, force: true })` in a `finally`, so cleanup runs even if the
assertion throws. Test passes (`35/35`, including this one).

**S4036 (`apps/ptah-cli/scripts/verify-packed-wasm.cjs`):** four
`// NOSONAR` comments added, each with a one-line reason tied to a concrete
constraint (`tar`/`npm` must resolve through `PATH` because they are
external binaries or a `.cmd` wrapper on Windows; `name`/`entry` are
internal, never user input). This is a local build/self-test script with no
externally-reachable input, so suppressing the "no shell/PATH lookup"
hotspot with a stated reason is an acceptable, proportionate resolution
rather than a rewrite that would break MSYS/Windows `tar` resolution. Ran
`node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test` → exit 0.

## 5. `content-manifest.json`

Confirmed via `git diff`: only `contentHash` and `generatedAt` changed (4
line diff, 2 removed/2 added), everything else byte-identical. This matches
a regeneration artifact, not a hand edit — cross-checked against
`scripts/generate-content-manifest.js`, which is the tool that owns this
file's schema (`$schema` field references it). No other file in the diff
references or depends on the changed hash/timestamp values in a way that
would make them suspect.

## Test evidence (self-run, independent of the author's reports)

```
npx jest -c libs/backend/platform-core/jest.config.ts src/utils/process-tree-reaper.spec.ts
  9 passed / 9 total

npx jest -c libs/backend/vscode-lm-tools/jest.config.ts export-disclosure.integration.spec.ts analysis-namespace.builders.spec.ts
  114 passed / 114 total

npx jest -c libs/backend/platform-core/jest.config.ts run-diagnostics-provider-contract
  35 passed / 35 total

npx jest -c libs/backend/workspace-intelligence/jest.config.ts go-vet-consent-store required-keys workspace-analyzer.service monorepo-member-discovery
  50 passed / 50 total

node scripts/copy-wasm.js --self-test                                   -> PASS, exit 0
node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test           -> PASS, exit 0
node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs --self-test -> PASS, exit 0
```

Reverse-verification of the `isEsrch` fix (temporary, reverted, stash
dropped): old `isEsrch` + new regression test → **1 test fails** (`onError`
called 2×); new `isEsrch` + new regression test → **9/9 pass**.

## Findings

### Moderate — S8707 mitigation is narrower than it claims

- File: `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs:83-101`
- Scenario: an argument that resolves to an existing `.vsix` file anywhere
  outside `DIST_DIR` (e.g. `../../../tmp/anything.vsix`, or an attacker-
  planted symlink named `*.vsix`) is accepted, not refused, contradicting
  the function's own stderr message and doc comment ("accept it only inside
  the package output directory or as an existing `.vsix` file" — the "or"
  is the gap).
- Impact: low today — the script is developer/CI-invoked with a fixed,
  no-argument command in both build targets; no untrusted input reaches
  `argv[2]` in the current pipeline. If this script is ever wired into a
  path where `argv[2]` comes from an external or less-trusted source, the
  restriction would not hold.
- Fix: either drop the `existingVsix` fallback (require strictly inside
  `DIST_DIR`) or document explicitly why an escape hatch for ad hoc/manual
  verification of an arbitrary `.vsix` is intentional and acceptable, so the
  next Sonar pass doesn't need to re-derive this.

### Minor — `isEsrch` substring check remains generic (pre-existing, not introduced here)

- File: `libs/backend/platform-core/src/utils/process-tree-reaper.ts:43`
- Scenario: any thrown value whose `.message` happens to contain the
  literal substring `"ESRCH"` (not necessarily a real ESRCH errno) is
  classified as "process gone" and swallowed instead of surfacing through
  `onError`.
- Impact: theoretical only — `process.kill`'s real errno-carrying errors
  always populate `.code` correctly, so the substring branch is a backstop,
  not the primary path, and this exact behavior existed before this PR
  (previously gated behind `instanceof Error`, which any genuine
  `process.kill` error already satisfies on some Node builds, so the
  practical exposure is unchanged). Not a regression from this diff; noting
  for awareness only, no fix required as part of this CI-fix PR.

No Blocking or Serious issues found in the reviewed diff.

## Requirements checklist

| Item                                                      | Status   | Evidence             |
| --------------------------------------------------------- | -------- | -------------------- |
| `isEsrch` correctness / no new false "process gone"       | COMPLETE | §1                   |
| Regression test is real, fails on old code                | COMPLETE | §1, reverse-verified |
| vscode-lm-tools fixture fix is test-only, product correct | COMPLETE | §2                   |
| No assertion weakened in the two specs                    | COMPLETE | §2                   |
| All 9 S2871 sites fixed, order-preserving, string-only    | COMPLETE | §3                   |
| S8707 blocks outside-base paths                           | PARTIAL  | §4, Moderate finding |
| Normal packaging flow unaffected by S8707 fix             | COMPLETE | §4                   |
| S5443 mkdtemp + cleanup                                   | COMPLETE | §4                   |
| S4036 NOSONAR with reason, acceptable                     | COMPLETE | §4                   |
| `content-manifest.json` regeneration-only diff            | COMPLETE | §5                   |
