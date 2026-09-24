# Cross-side review (rev1) — PR #584, thread 4087747965 — opencode detected-install isolation

## Verdict

PASS — commit `f511d7010` correctly closes CodeRabbit thread 4087747965. A detected `.exe`
now short-circuits to `undefined` before any candidate is built, a detected wrapper (`.cmd`
etc.) is now scored only against its own install's candidates, and the Electron/module/APPDATA
fallback tiers now run exclusively in the no-detected-path branch. `runSdk` still falls back to
`options.binaryPath` whenever the resolver returns `undefined`, so no caller regresses. This is
also the exact fix the prior review round's Finding 2 recommended.

## What the commit changes

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`:

- Line 175: `if (/\.exe$/i.test(detectedCliPath)) return undefined;` — an already-native detected
  binary is returned untouched (case-insensitive), before any `existsSync` call.
- Lines 176-181: when `detectedCliPath` is present and not `.exe`, only its own two candidates
  (`cliDir/node_modules/<platformPkg>/bin/opencode.exe` and the nested
  `cliDir/node_modules/opencode-ai/node_modules/<platformPkg>/bin/opencode.exe`) are considered,
  and the function returns `candidates.find(...)` — i.e. the first match or `undefined` —
  immediately. The Electron `resourcesPath`, module-resolved (`require.resolve`), and `APPDATA`
  tiers below (lines 184-219) are structurally unreachable once `detectedCliPath` is truthy,
  because of the early `return` at line 181.
- Lines 184-224 (unchanged code, now reachable only for `detectedCliPath === undefined`): Electron
  resources, module-resolved packages (with `app.asar.unpacked` twins), then `APPDATA` npm
  packages — same as before this commit.

## Check 1 — does `runSdk` keep `options.binaryPath` when the resolver returns `undefined`?

Confirmed unchanged and correct, `opencode-cli.adapter.ts:568-572`:

```ts
let binary = options.binaryPath ?? 'opencode';
const native = resolveOpencodeNativeBinary(options.binaryPath);
if (native) {
  binary = native;
}
```

`native` is only assigned into `binary` when truthy. Both new failure paths the commit introduces
(detected `.exe` -> `undefined`; detected wrapper with no own-install candidate -> `undefined`)
leave `binary` at `options.binaryPath ?? 'opencode'`, i.e. the CLI keeps the exact path `detect()`
reported. This is the behaviour the CodeRabbit thread asked for ("otherwise retain
`options.binaryPath` for `resolveDirectSpawn`").

## Check 2 — do callers still work when detection gives no path?

`options.binaryPath` undefined is the pre-existing, untouched branch: `resolveOpencodeNativeBinary(undefined, ...)`
skips the `if (detectedCliPath)` block entirely (line 174) and falls through unchanged to the
Electron/module-resolved/APPDATA tiers (lines 184-224), exactly as before this commit. `binary`
then defaults to `'opencode'` and is overwritten only if one of those tiers finds a candidate.
Verified against the two `it.each(['module-resolved', 'APPDATA'])('falls back to %s when no
detected path is given', ...)` tests (`opencode-cli.adapter.spec.ts:1059-1070`), both passing.
No regression for the "opencode not detected at all" case.

## Check 3 — regression risk for packaged Electron users whose detected path is a `.cmd` wrapper outside the app

Traced the shared helper `resolveDirectSpawn` (`cli-adapter.utils.ts:607`), which is the code
path a `.cmd` falls back to when `resolveOpencodeNativeBinary` now returns `undefined`. It is not
new or opencode-specific: it is the same function `antigravity-cli.adapter.ts:619`,
`copilot-sdk.adapter.ts:274`, and `pi-cli.adapter.ts:365` already rely on to spawn an npm `.cmd`
shim directly (pointing spawn at the shim's real node entrypoint so `child.pid` is the actual
process, not `cmd.exe`). So when this commit makes the resolver return `undefined` for a detected
wrapper whose own install has no sibling native `.exe`, the caller does not regress to something
untested — it takes the exact same `resolveDirectSpawn(binary)` path three other adapters already
depend on for their primary (non-native-optimized) binary.

The scenario the prior review's Finding 2 warned about — a Scoop/curl `opencode.exe` shadowed by
an unrelated npm `opencode-ai`/`opencode-windows-x64` install reachable via `require.resolve` from
Ptah's own `node_modules` — is exactly what the `.exe` short-circuit at line 175 now prevents: the
function returns before reaching any of those fallback tiers. This is a net risk reduction versus
`f72a4448c`, not a new regression.

One narrower residual case remains, correctly out of scope for this specific commit: a packaged
Electron build's bundled `opencode-ai`/`opencode-windows-x64` native binary (reached only through
the Electron `resourcesPath` or `app.asar.unpacked` tiers) can no longer be substituted for a
detected npm wrapper's own install, even if that wrapper's own `node_modules` lacks the platform
package (e.g. `--no-optional` install, or a hoisting layout this resolver's two candidate shapes
don't cover). Before this commit that gap was filled by the Electron-bundled binary as an
unconditional fallback; after this commit, such a wrapper is spawned via `resolveDirectSpawn`
unchanged. That is the deliberate, requested trade-off ("select a native executable only when it
belongs to the detected installation") and matches CodeRabbit's ask, so it is not a defect of this
commit — but it is worth naming as the fix's accepted cost: any user whose npm install genuinely
lacks its own native binary sibling now always runs the wrapper, never gets an automatic native
upgrade from the app bundle. No evidence this regresses a previously-working case, since the
wrapper path is the one every other adapter already uses as its default.

## Test quality

Read `opencode-cli.adapter.spec.ts:1012-1071` directly (not just the author's report):

- `it.each(['exe','EXE','ExE'])` (1029-1043): asserts `resolveOpencodeNativeBinary` returns
  `undefined` for a detected native binary regardless of case, and — usefully — asserts
  `mockExistsSync` was never called, which pins the short-circuit as happening before any
  filesystem probe (not just before a match). This is a real behavioural assertion, not a
  tautology.
- `it.each(['module-resolved', 'APPDATA'])('ignores %s when a detected .cmd has no detected-path
  candidate', ...)` (1045-1057): mocks `existsSync` true only for the foreign candidate (never for
  either of the two detected-path candidates) and asserts `undefined`. This is the direct
  regression test for the CodeRabbit-cited bug: pre-fix code would have returned the foreign
  candidate here (module-resolved was checked unconditionally); post-fix it returns `undefined` and
  the caller keeps `options.binaryPath`. Confirmed this assertion would fail against the pre-fix
  candidate list by inspection (pre-fix these tiers ran unconditionally once the detected-path
  candidates missed).
- `it.each(['module-resolved', 'APPDATA'])('falls back to %s when no detected path is given', ...)`
  (1059-1071): confirms the untouched no-detected-path branch still works, guarding Check 2 above.
- The existing priority test (1012-1027, "prefers the detected-path candidate ... over
  module-resolved and APPDATA candidates") still passes; its title is now slightly imprecise (the
  new code never evaluates the module-resolved/APPDATA tiers at all for a detected path rather than
  "preferring" between them), but the assertion itself remains correct — Minor, naming only, not a
  logic defect. Route to style review if desired.

No test exercises the `resourcesPath` (Electron) tier in combination with a detected `.exe`/`.cmd`
input (i.e. proving the Electron tier is unreachable once a detected path is supplied), but the
`return` at line 181 makes that unreachability a static property of the code, not something that
needs a dedicated dynamic test — the `.exe` short-circuit test already proves `existsSync` (which
every tier depends on) is never invoked.

## Requirements fulfilment

| Requirement (CodeRabbit thread 4087747965) | Status | Gap |
| --- | --- | --- |
| Select a native executable only when it belongs to the detected installation | COMPLETE | `opencode-cli.adapter.ts:175-181` |
| Otherwise retain `options.binaryPath` for `resolveDirectSpawn` | COMPLETE | `opencode-cli.adapter.ts:568-572`, unchanged, still correct against the new `undefined` paths |

Implicit requirements not addressed: none within this commit's stated scope. The scoped
`@opencode/cli` package-name mismatch (prior review Finding 1) remains an explicit, out-of-scope,
pre-existing follow-up per the task brief, and package name strings are untouched by this diff —
confirmed by `git show f511d7010` (no edits to `OPENCODE_WINDOWS_PACKAGES` or the `opencode-ai`
literal).

## Verification

```
$ npx nx run-many -t test lint typecheck -p @ptah-extension/cli-agent-runtime 2>&1 | tail -n 20
✓ nx run @ptah-extension/cli-agent-runtime:typecheck
✓ nx run @ptah-extension/cli-agent-runtime:lint
 NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/cli-agent-runtime
 (Nx Cloud disabled — free-plan limit; local run only, no remote cache)
```

Re-ran the scoped suite directly to confirm the new tests execute and pass:

```
$ npx nx test @ptah-extension/cli-agent-runtime --testPathPatterns=opencode-cli.adapter --skip-nx-cache
Test Suites: 1 passed, 1 total
Tests:       54 passed, 54 total
```

(49 pre-commit + 5 net new: 3 `.exe`-case variants, 2 "falls back ... when no detected path is
given" — matches the two renamed "ignores" tests replacing the two pre-fix "falls back ... when no
detected-path candidate exists" tests one-for-one, no count drift.)

## Verdict

- Recommendation: PASS
- Confidence: HIGH
- Top risk: none blocking. The one residual gap (Electron-bundled native binary can no longer
  patch a detected npm wrapper whose own install lacks its platform package) is the commit's
  intended, requested trade-off, not an unintended regression, and is bounded to a narrower
  surface than the bug this commit fixes.
- Scope examined: the full resolver function (`opencode-cli.adapter.ts:150-225`), its one
  production call site in `runSdk` (`opencode-cli.adapter.ts:555-628`), the shared
  `resolveDirectSpawn` helper and its three other call sites, the full new/changed spec block
  (`opencode-cli.adapter.spec.ts:920-1071`), the prior review document, and the author's lane
  report. Verification command run once as specified.
