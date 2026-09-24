# Cross-side review — PR #584, opencode native-binary resolution order fix

## Verdict

PASS (with two residual risks recorded, both pre-dating and outside the literal scope of this commit) — the reorder correctly fixes the CodeRabbit-cited ordering bug and is proven by an order-sensitive regression test; two unaddressed gaps remain that leave the underlying "wrong opencode.exe wins" class of bug alive for scenarios CodeRabbit did not name.

## Findings

### 1. Detected-path candidates use a package-name family (`opencode-ai` / `opencode-windows-x64`) that does not exist for the currently-published `@opencode/cli` 2.x npm distribution — Moderate, pre-existing, not lane-introduced

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:100-102,176,184,207,221`
- Evidence gathered on this machine (read-only):
  - `where opencode` → `C:\Users\abdal\AppData\Roaming\npm\opencode.cmd`
  - `npm ls -g` shows `@opencode/cli@2.0.12` installed globally (not `opencode-ai`).
  - `AppData\Roaming\npm\node_modules\@opencode\cli\bin\opencode.exe` and `...\@opencode\cli\node_modules\@opencode\cli-windows-x64\bin\opencode.exe` are the real on-disk paths (verified with `ls`/`find`; both are the same inode/size, 203226152 bytes).
  - `opencode.cmd` itself is a plain batch file invoking `%dp0%\node_modules\@opencode\cli\bin\opencode.exe` directly — not the `.ps1` wrapper the function's docstring describes.
  - `npm view opencode-ai version` → `1.18.32` (still published, updated `2026-09-22`) vs `npm view @opencode/cli version` → `2.0.15`. Two parallel package families exist: the legacy `opencode-ai` (1.x) the code targets, and the current `@opencode/cli` (2.x) scoped package actually installed here.
  - Constructed candidate 1 for this machine: `AppData\Roaming\npm\node_modules\opencode-windows-x64\bin\opencode.exe` — does not exist. Nested candidate 2 (`...\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe`) — does not exist either. Neither of the two reordered detected-path candidates, nor the APPDATA fallback candidates (same package names, `opencode-cli.adapter.ts:219-222`), can ever match a 2.x `@opencode/cli` install.
- Impact: for the very version line this PR's context repeatedly cites ("standalone... needed on opencode 2.x"), `resolveOpencodeNativeBinary` returns `undefined` at every tier — the reorder has zero observable effect because none of the candidates, old or new position, ever matched this layout. `runSdk` then falls back to the detected `.cmd` (`opencode-cli.adapter.ts:572-576`), which happens to work fine here since the 2.x `.cmd` invokes the `.exe` directly rather than through the `/bin/sh.exe`-dependent `.ps1` path the docstring worries about — so the practical failure mode is muted for 2.x, not worsened, but the claimed protection is illusory for the primary distribution channel used today.
- This predates the reviewed commit (the package-name strings are untouched by the diff) and is not something CodeRabbit's ordering finding was about, so it does not block this fix. It does mean CHECK-1's premise ("do the detected-path candidates match the real Windows layout") only holds for the older `opencode-ai` 1.x family, not for `@opencode/cli` 2.x. Recommend a follow-up ticket to add `@opencode/cli` / `@opencode/cli-windows-{x64,arm64}` as additional candidate package names.

### 2. When `detectedCliPath` is already the native `.exe` (non-npm install: Scoop/curl/direct download), the detected-path candidates can never match, so a foreign fallback binary can still shadow the correct one — Serious, real remaining risk, out of scope for this specific commit but reproduces the bug class it claims to close

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:180-186`
- The two detected-path candidates are built as `path.join(path.dirname(detectedCliPath), 'node_modules', ...)` — they assume `detectedCliPath` is an npm-wrapper (`.cmd`/`.ps1`) sitting next to a `node_modules` tree. `resolveDirectSpawn` (called at `opencode-cli.adapter.ts:622`, used identically by `antigravity-cli.adapter.ts:619`, `copilot-sdk.adapter.ts:274`, `pi-cli.adapter.ts:365`) and the function's own docstring (`opencode-cli.adapter.ts:161-162`, "installed via Homebrew/Scoop/curl rather than npm") both acknowledge `detectedCliPath` can already be the native binary for non-npm installs.
- Failing scenario: a user has a Scoop-installed `opencode.exe` at `C:\scoop\shims\opencode.exe` (already correct, already the exact binary the user chose) *and* a stale/older global npm `opencode-ai`/`opencode-windows-x64` install left in `%APPDATA%\npm\node_modules` (or Ptah itself transitively depends on `opencode-windows-x64`, resolvable via `require.resolve` from Ptah's own `node_modules` — the module-resolved tier at `opencode-cli.adapter.ts:205-215`). The detected-path candidates (`C:\scoop\shims\node_modules\...`) never exist, so resolution falls through to the module-resolved or APPDATA tier and silently returns that unrelated, possibly older/incompatible binary in place of the one the user actually installed and that `detect()` reported.
- Symptom: `runSdk` overwrites the already-correct detected `.exe` with a foreign one (`opencode-cli.adapter.ts:573-576`, `if (native) { binary = native; }` — unconditional, no check that `native` belongs to the same install as `detectedCliPath`), and the subsequent `--standalone` probe (`opencode-cli.adapter.ts:585`) runs against that foreign binary's version, which is exactly the CodeRabbit-described failure (wrong binary decides `--standalone`), just for an install method this fix does not cover.
- Current handling: none — no check that a fallback candidate is version/identity-compatible with `detectedCliPath` before substituting it.
- Recommendation: when `detectedCliPath` does not look like an npm wrapper (e.g., its own filename already ends in `.exe`, or no `node_modules` sibling can be found), either skip the Electron/module-resolved/APPDATA fallback tiers entirely and return `undefined` (keep the detected `.exe` as-is, which is what CHECK-2 in the task suggests is preferable), or treat `undefined`-from-detected-tier as a hard stop rather than falling through to unrelated npm-package tiers. Confirmed in-scope callers: `resolveOpencodeNativeBinary` has exactly one call site (`opencode-cli.adapter.ts:573`); no other adapter calls it (grepped workspace-wide).

### 3. Other callers — none found

- Grepped the whole `libs` tree for `resolveOpencodeNativeBinary`: only the function definition (`opencode-cli.adapter.ts:168`), its single production call in `runSdk` (`opencode-cli.adapter.ts:573`), and the test file's imports/calls. No other adapter or service depends on this function or its ordering, so the reorder's blast radius is confined to `OpencodeCliAdapter.runSdk`.

## Checks run

1. `where opencode`, `npm ls -g --depth=0`, and `ls`/`find` over `%APPDATA%\npm\node_modules` (read-only) — confirmed real layout is `@opencode/cli` 2.0.12 (scoped), not `opencode-ai`/`opencode-windows-x64`. Neither reordered detected-path candidate, nor the APPDATA fallback, matches this real layout (Finding 1).
2. Traced `detectedCliPath` origin (`resolveDirectSpawn`, used by 4 adapters) and the docstring's own Scoop/curl acknowledgment to confirm the detected-path candidates structurally cannot match a non-npm-wrapper detected path, leaving fallback tiers able to shadow a correct non-npm binary (Finding 2). Judged a real, unaddressed risk, not out of scope for the bug class though outside this specific commit's literal diff.
3. `Grep` for `resolveOpencodeNativeBinary` across `libs` — one definition, one production call site, test-only otherwise. No other callers.
4. `npx nx test @ptah-extension/cli-agent-runtime --testPathPatterns=opencode-cli.adapter --skip-nx-cache` → `Test Suites: 1 passed, 1 total`, `Tests: 49 passed, 49 total`.
5. Read the two new `it.each` priority tests (`opencode-cli.adapter.spec.ts:1012-1041`) directly: the first pair mocks `existsSync` true simultaneously for the detected candidate, the module-resolved (`asarCandidate`), and the APPDATA candidate, then asserts the detected one wins — this is genuinely order-sensitive and would fail against the pre-fix candidate order (module-resolved was pushed before detected). Confirmed this is a real regression guard, not a tautology.
6. `mcp__ptah__ptah_get_diagnostics` scoped to both changed files — 0 errors, 0 warnings.

## Lane-introduced constraints

None found in the diff itself (docstring update, candidate reorder, and four new tests only). The two findings above are pre-existing gaps the diff did not introduce and did not fully close, not constraints the lane added.
