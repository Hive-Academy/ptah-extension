# Batch 22 report — Pierre renderer host and hunk mapping (A1, A2 gate)

Executor: frontend-developer. Worktree `task-576-p3` (branch `feat/task-2026-576-p3`). No git
operations were run.

## Files

| Change   | Path                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| MODIFIED | `package.json`: `"@pierre/diffs": "1.5.1"` (exact). The orchestrator wrote it; see Deviations. |
| MODIFIED | `package-lock.json`: additions only (129 lines). New entries: `@pierre/diffs`, `@pierre/theme`, `@pierre/theming`, `@shikijs/transformers` (plus its nested `@shikijs/core`, `primitive`, `types`), `lru_map`. |
| CREATED  | `libs/frontend/git-ui/src/lib/renderer/pierre-config.ts`                      |
| CREATED  | `libs/frontend/git-ui/src/lib/renderer/pierre-hunk-mapping.ts` (not in the file list; see Deviations) |
| CREATED  | `libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.ts`         |
| CREATED  | `libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.spec.ts`    |
| CREATED  | `libs/frontend/git-ui/src/lib/renderer/pierre-hunk-mapping.real-git.spec.ts`  |

The component is unmounted. No app, barrel (`index.ts`, `services.ts`) or existing component
references the `renderer/` folder.

## A1 — Pierre source at tag `diffs-v1.5.1`

Sources read:

- From GitHub: `raw.githubusercontent.com/pierrecomputer/pierre/diffs-v1.5.1/packages/diffs/src/{renderers/DiffHunksRenderer.ts,utils/getLineAnnotationName.ts,utils/getHunkSeparatorSlotName.ts}`.
- From the published tarball: `@pierre/diffs@1.5.1` `dist/` (`npm pack`).

The two agree.

1. **The separator rule is unchanged from `main`.** `DiffHunksRenderer.ts:2393` defines `pushSeparator`,
   and `:2406-2408` reads `if (typeof collapsedLines === 'number' && collapsedLines <= 0) return;`.
   The caller at `:1593` pushes leading separators only when `collapsedBefore > 0`, so:
   - a hunk at line 1 never gets a separator;
   - a hunk whose context touches the previous hunk never gets one.

   The dist file has the same check at `dist/renderers/DiffHunksRenderer.js:1135`.
2. **The slot names are as the plan assumed.**
   - `getHunkSeparatorSlotName(type, i)` returns `hunk-separator-${type}-${i}`, where `type` is
     `'unified' | 'additions' | 'deletions'`.
   - `getLineAnnotationName(a)` returns `annotation-${side}-${lineNumber}` (just
     `annotation-${lineNumber}` when there is no side).
   - Both functions are exported from the package root, so the host imports them instead of
     hard-coding the strings.
3. **New finding that contradicts the plan: separators carry no `<slot>` under `'line-info'`.**
   - `createSeparator.ts` emits a `<slot name=…>` only for `type === 'custom'`, which is the
     deprecated function form of `hunkSeparators`.
   - `'line-info'` renders Pierre's own expand UI and no slot. A light-DOM element with
     `slot="hunk-separator-…"` would therefore never be projected.
   - Result: with the required config (`hunkSeparators: 'line-info'`), every hunk resolves to its
     **annotation slot**.
   - The host still applies the batch rule ("separator slot, else annotation slot"). It decides
     from the `<slot name>` elements actually present in the rendered shadow tree, never from
     configuration, so a Pierre upgrade that adds separator slots is picked up without guessing.
4. **There is an extra trailing separator.** `DiffHunksRenderer.ts:1924-1938` pushes a trailing
   separator with `hunkIndex = last + 1`, an index beyond the hunk list. The host only looks up
   indices `< hunks.length`, so it can never claim that separator.
5. **The annotation slots are real `<slot>` elements.**
   - `createAnnotationElement.ts` renders one `<slot name=getLineAnnotationName(a)>` per
     registered line annotation, independent of `renderAnnotation`.
   - With a host-managed container (`new FileDiff(opts, undefined, true)`), Pierre appends no
     light-DOM children of its own (`FileDiff.js` `renderAnnotations`/`renderSeparators`/header
     slots all return early). Angular owns the only light-DOM children.
6. **`cleanUp()` does not empty the shadow root.**
   - `FileDiff.cleanUp()` releases the resize, scroll and interaction managers.
   - It drops references to `pre`/code nodes without removing them (`FileDiff.js:333-365`).
   - The host therefore calls `shadowRoot.replaceChildren()` after `cleanUp()`. The adopted core
     stylesheet is not a child node, so it survives.

**Executable evidence.** `pierre-hunk-mapping.real-git.spec.ts` runs the real 1.5.1 `parsePatchFiles`
and `DiffHunksRenderer.asyncRender` on real `git diff` output. It asserts that:

- the rendered HAST contains no `hunk-separator-*` slot under `'line-info'`;
- each hunk's annotation slot is rendered exactly once;
- this holds for a hunk at line 1 (`collapsedBefore` 0) and for `-U0` hunks one line apart
  (`collapsedBefore` 1). Git never emits zero-gap hunks: it merges them.

## A2 — CSP gate (Task 22.2)

**Verdict: no BLOCKER.**

- **The app build contains no Pierre code.**
  - `nx run ptah-extension-webview:verify-eager-bundle` ran a production build and passed.
  - `grep -l diffs-container dist/apps/ptah-extension-webview/browser/*.js` finds 0 files.
  - Cause: the component is unmounted, so the application build emits no Pierre lazy chunk. The
    gate's literal grep over "built lazy chunks that contain Pierre" has no input until Batch 23
    wires the lazy entry.
- **The whole-app `grep -E "new Function|eval\("` finds 1 file, and it is not Pierre.**
  - The file is `chunk-C-uNnTFe.js`.
  - The hit is zod v4's capability probe
    `try { return new Function(''), !0 } catch(e) { return !1 }`. It is a try/catch feature test,
    not a code path that needs eval. It was there before this batch.
- **Pierre-specific evidence comes from an esbuild bundle that matches how Angular splits lazy chunks.**
  - Setup: esbuild ESM bundle with splitting, minified, `platform: 'browser'`. The entry imports
    `FileDiff`/`parsePatchFiles` from `@pierre/diffs` 1.5.1 plus `pierre-config.ts`
    (`registerPierreLanguages`, `createPierreDiffOptions`). Output went to `/tmp/pierre-a2/out`:
    411 chunks, 13 MB raw, made up of every Shiki grammar plus the core.
  - `grep -lE "new Function|eval\(" out/*.js` finds **0 files**.
  - A broader `[^a-zA-Z_.]Function\(` scan hits 14 files. All are TextMate grammar regex
    *strings* (the `typescript`, `tsx`, `jsx`, `angular-ts`, `blade`, `hack`, `nsis`, `vue-vine`
    and shared grammar chunks), not calls.
  - The Pierre dist itself also has no `new Function` and no `eval(`.
- **WebAssembly is present but never runs with this config.**
  - `WebAssembly.instantiate*` appears in the core chunk (Shiki's oniguruma loader) and in the
    `wasm` grammar chunk.
  - Pierre only reaches the loader when `preferredHighlighter === 'shiki-wasm'`
    (`highlighter/shared_highlighter.js:18`).
  - `pierre-config.ts` pins `'shiki-js'`, so neither `wasm-unsafe-eval` nor the wasm chunk is
    needed.
- **Electron console check: not possible in this batch.** "Load one diff in Electron with a clean
  devtools console" needs the component mounted, which is out of scope (unmounted by
  instruction). Carry it to the batch that first mounts the host (Batch 23 lazy entry, or the P4
  review canvas).
- **Risk to carry into that check: VS Code webview `style-src`.**
  - `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:283-293` sets
    `style-src ${webview.cspSource} 'nonce-…'` with **no `'unsafe-inline'`**.
  - Pierre writes theme CSS into `<style>` elements (`utils/hostTheme.js:14`,
    `utils/createUnsafeCSSStyleNode.js:4`). It also sets code rows through `innerHTML` of
    `hast-util-to-html` output (`FileDiff.js:1516-1577`), which can carry `style` attributes for
    token colors.
  - Nonce-less `<style>` elements and inline style attributes are blocked under that policy.
  - The Electron shell allows `'unsafe-inline'` styles (`apps/ptah-electron/scripts/copy-renderer.js:159`),
    so Electron is unaffected. The core stylesheet is adopted through `CSSStyleSheet.replaceSync`,
    which CSP does not block.
  - This is a style/rendering risk, not a script-eval risk. It does not trip the A2 `@codemirror/merge`
    fallback trigger. It does need a decision before the host renders in the VS Code webview
    (skills drawer): nonce propagation, `useCSSClasses`, or a CSP change.

## Implementation notes

- **`pierre-config.ts`:**
  - `preferredHighlighter: 'shiki-js'`;
  - `lineDiffType: 'word'`;
  - `hunkSeparators: 'line-info'`;
  - `expandUnchanged: false`;
  - `diffStyle` comes from the input;
  - `theme: DEFAULT_THEMES` (`pierre-dark`/`pierre-light`, resolved lazily by `@pierre/theming`), with `themeType` taken from
    `<html data-theme-mode>` (no `@ptah-extension/core` import);
  - ten fine-grained `() => import('shiki/langs/<lang>.mjs')` loaders registered once through
    `registerCustomLanguage` (guarded, because Pierre logs an error on re-registration);
  - `shiki` 4.4.3 is reached as Pierre's dependency.
- **`PierreDiffHostComponent`:**
  - Standalone, OnPush, signal inputs. No CDK. Uses `CUSTOM_ELEMENTS_SCHEMA` for Pierre's `<diffs-container>`.
  - Inputs: `patch | oldText/newText/fileName`, `hunks`, `diffStyle`, `themeType`, and
    `hunkToolbar: TemplateRef` (the consumer's per-hunk controls).
  - Public signals: `hunkHosts`, `mappingError`.
  - The `FileDiff` is created imperatively in an `afterRenderEffect`. That effect's `onCleanup`
    disposes the instance on every content-input change and on destroy.
  - A theme change calls `setThemeType` in place.
  - The patch is passed verbatim (no CR handling). Parsing uses
    `parsePatchFiles(patch, undefined, true)` and requires exactly one file.
- **Mapping (`pierre-hunk-mapping.ts`, pure):**
  - Requires equal hunk counts, and for every `i`: `index`, `additionStart/Count ==
    modifiedStart/Lines` and `deletionStart/Count == originalStart/Lines`.
  - The count check matters because Pierre silently "repairs" a hunk whose body disagrees with
    its header.
  - Anchors: the `additions` side at `modifiedStart`; for a pure deletion, the `deletions` side
    at `originalStart`.
  - Read-only reasons: `parse-failed`, `file-count`, `hunk-count`, `hunk-position`, `slot-missing`,
    `duplicate-anchor`. Any of them gives no hosts and a `role="status"` note, and the diff still
    renders.
- **Bug found by the spec and fixed.** On a `hunks` input change, the template read
  `hunks()[host.index]` one render before the hosts were re-resolved, which could index past the
  new array. The template now reads `hostedHunks`, the list the current hosts were resolved
  against. It is published together with the hosts.
- **Accessibility.** Each host is `role="group"` with `aria-label="Hunk N actions"` and lives in
  the light DOM, so the toolbar's own buttons stay keyboard-reachable and Angular-owned.

## Verification

| Command | Result |
| ------- | ------ |
| `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui --parallel=1 --skip-nx-cache` | Succeeded. Test: **30 suites, 536 tests passed** (Batch 21 had 516; +13 component, +7 real-git). Lint: 0 errors, 2 `max-lines` warnings in pre-existing files (none in `renderer/`). |
| `npx eslint libs/frontend/git-ui/src/lib/renderer` | Clean |
| `npx prettier --check libs/frontend/git-ui/src/lib/renderer/` | Clean after `--write` |
| `npx nx run ptah-extension-webview:verify-eager-bundle --skip-nx-cache` | Passed: "no forbidden markers in the eager closure". `main.js` 362,218 B gz, closure 778,076 B gz, both **identical to Batch 21**. The existing `bundle initial exceeded maximum budget` (3.33 MB vs 2.50 MB) warning is unchanged by this batch. |
| `grep -lE "new Function\|eval\("` over the dist and the Pierre esbuild bundle | See A2 |

**How the real-git spec runs:**

- git-ui's `jest.config.ts` has no `testPathIgnorePatterns` for `*.real-git.spec.ts`, unlike
  vscode-core, so the default `test` target picks it up. It is among the 536 tests above.
- git-ui has no separate `test-real-git` target.
- In CI it runs in the main job whenever git-ui is affected (`nx affected -t test`, ubuntu).
- It is **not** in the `git-real-git` OS-matrix job (`.github/workflows/ci.yml:204`), which
  only runs the vscode-core and ptah-electron real-git specs. Windows/macOS CRLF evidence for
  this spec therefore exists only locally (this run was on Windows 11). Adding git-ui to that
  matrix job is a devops follow-up; CI was not edited.
- The spec sets its own local git identity and pins `main`. It needs `git` and `node` on PATH.

## Deviations

1. **npm install and node_modules.**
   - `npm install @pierre/diffs@1.5.1 --save-exact` replaced the worktree's `node_modules`
     junction with a real directory and started a full install.
   - After about 30 minutes, apparently stuck on Electron's `install.js` binary download, it
     failed and rolled back. That left `node_modules` with 2 entries and `package.json`
     untouched. The main `node_modules` was not affected.
   - I stopped all npm activity as instructed. The orchestrator restored the junction and wrote
     the `package.json`/`package-lock.json` changes; this batch owns them, and I did not edit them.
2. **Extra file `pierre-hunk-mapping.ts`.**
   - The plan's real-git spec name implies a mapping unit. Keeping it free of any runtime
     `@pierre/diffs` import lets that spec test the production mapping without mocking an
     ESM-only package.
   - Requirement 3.3: the assertions run the shipped functions on real Pierre data.
3. **Jest and ESM handling.** git-ui's Jest config is unchanged.
   - `pierre-diff-host.component.spec.ts` uses `jest.mock('@pierre/diffs')` with a double that
     reproduces the 1.5.1 slot contract from A1. The component is loaded through
     `await import()` after the mock is registered, because in this file ts-jest did not hoist
     `jest.mock` above a static import once the decorated test host was present. That was
     reproduced and bisected.
   - The real-git spec runs real Pierre in a child Node process (`execFileSync(process.execPath,
     ['--input-type=module', '-e', PROBE])`, 60 s timeout).
4. **The separator-slot path is inert at 1.5.1 with `'line-info'`** (A1 item 3). It is kept as a
   runtime check because the batch requires it.
5. **Empty annotation row in the separator case.** When a hunk does resolve to a separator slot
   (only possible with a slot-bearing separator type), its line annotation is still registered,
   which leaves an empty annotation row. There is no second render pass to drop it, because the
   case cannot occur under the required config.

## Out-of-scope observations

- **One `ResizeObserver` per file.** Pierre's `FileDiff` attaches one through its
  `ResizeManager`, plus interaction listeners. A review canvas that mounts one host per changed
  file therefore holds one observer per file. The P4 canvas should mount hosts only for visible
  files, or use Pierre's `CodeView`/virtualizer.
- **VS Code webview `style-src`** (A2 above): decide before the host renders in the VS Code host.
- **`git-real-git` matrix job:** consider adding `@ptah-extension/git-ui` so the CRLF cases run
  on Linux and macOS.
