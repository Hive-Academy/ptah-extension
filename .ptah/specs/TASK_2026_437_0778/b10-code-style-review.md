# Code Style Review — `TASK_2026_437_0778` Batch 10

## Summary

| Metric          | Value                              |
| --------------- | ---------------------------------- |
| Overall score   | 7/10                               |
| Assessment      | NEEDS_REVISION                     |
| Blocking issues | 0                                  |
| Serious issues  | 2                                  |
| Minor issues    | 3                                  |
| Files reviewed  | 13 (11 modified + 2 new tsconfigs) |

## Five style questions

### 1. What breaks in six months?

The two directory-walk helpers in `apps/ptah-electron/scripts/verify-packed-native.js` — `findPackedAddons` (`:98-114`) and `findPackedParcelWatcher` (`:118-134`) — are structurally identical except for the suffix constant and the recursive call target. The next native dependency that needs a packed-load gate (there will be one; this file's own history shows better-sqlite3 → `@parcel/watcher` in one release) copies the pattern a third time instead of parameterizing it, and the three copies drift silently the way `WORKER_TARGET_SUFFIX` almost did before this batch generalized it from `-worker$` to `-(worker|host)$` in both `esm-bundle-gate.spec.ts` copies.

### 2. What would a new team member misread?

`.github/workflows/publish-electron.yml:298-305,327-333,572-575` renames three steps to "Verify packed native deps (better-sqlite3 ABI + @parcel/watcher, ...)" and the new comment above the macOS/Linux step (`:301-306`) explicitly reads "this is the cross-platform proof the Batch 1 spike could only run on win32-x64 locally." A reader would take that as "the matrix now covers arm64 and every OS the spike couldn't reach." The `strategy.matrix` at `:150-156` is unchanged by this diff — `windows-latest`, `macos-latest`, `ubuntu-latest` only, no `windows-arm64`/`macos-arm64` runner and no Task-10.5-style separate `npm_config_arch` smoke. The comment overstates what the diff actually proves; a reader who trusts it will believe D10 (batches.md:70, Windows-arm64/macOS/Linux prebuild risk) is closed when the matrix that would close it was never touched.

### 3. What does this cost to maintain?

`apps/ptah-electron/scripts/verify-packed-native.js:167` carries `// eslint-disable-next-line @typescript-eslint/no-var-requires` on a plain `require()` call inside a `.js` file. `npx eslint` on the file reports it as an **unused directive** (the rule never fires here — TS-only rule in a CJS script). It is dead noise that will be copy-pasted into the next `require()` in this same file under the belief it is load-bearing, the same way the two find-helpers will be copy-pasted.

### 4. Where is this inconsistent with the rest of the repository?

Everywhere else this batch mirrors precedent exactly: `build-workspace-watch-host` in `apps/ptah-cli/project.json` (`:182-208`) reproduces `build-integrity-worker` (`:161-181`) option-for-option including the `createRequire` banner and `dependsOn: ["build"]`; the Electron copy (`project.json:187-212`) reproduces Electron's own `build-integrity-worker` (`:159-184`) including its `dependsOn: []` and single-file `outputs` array — a detail the CLI and Electron copies of the _same-named_ target deliberately keep different from each other because that's how the sibling `build-integrity-worker` targets already differ between the two apps. That is the right kind of consistency (match your own app's convention, not the other app's). The one place this discipline lapses is `verify-packed-native.js`, where the new `findPackedParcelWatcher` (`:118-136`) is a hand-copy of `findPackedAddons` (`:98-114`) rather than a shared helper, despite the file explicitly calling out consistency with "the existing better-sqlite3 check" in its own doc comment (`:16-29`).

### 5. What would you have done differently, and why is that better rather than merely other?

Factor `findPackedAddons`/`findPackedParcelWatcher` into one `findPackedFiles(dir, suffixPath, found)` and call it twice with the two `ADDON_SUFFIX`/`PARCEL_WATCHER_INDEX_SUFFIX` constants. Same behavior, one fewer place for the `app.asar.unpacked${path.sep}node_modules${path.sep}` substring check to drift. And I would have added at least one non-`ubuntu/windows/macos-latest` matrix leg (or a documented follow-up task, since Task 10.5 is explicitly "PENDING" in `batches.md:658-661` and this diff does not check off the arm64 half of it) rather than letting the step-rename comment imply the gap is closed.

## Serious issues

### Duplicated path-walking helper in the native-packed gate

- File: `apps/ptah-electron/scripts/verify-packed-native.js:98-114` (existing `findPackedAddons`) vs `:118-136` (new `findPackedParcelWatcher`)
- Problem: Two recursive directory walkers with identical structure (`readdirSync(..., {withFileTypes:true})`, recurse into directories, match `full.includes(asarUnpackedNodeModulesSubstring) && full.endsWith(suffix)`), differing only in the suffix constant and their own name. This is exactly what the review checklist for this batch called out to check ("no duplicated path-walking helper") and it is present.
- Tradeoff: A shared `findPackedFiles(dir, suffix, found)` costs one extra parameter at each of the two call sites and removes an entire duplicate function body (17 lines) that will otherwise be copied a third time for the next native dependency this gate grows to cover.
- Recommendation: Extract `findPackedFiles(dir: string, suffix: string, found: string[])`, keep `ADDON_SUFFIX` and `PARCEL_WATCHER_INDEX_SUFFIX` as the two suffix constants, and call the one helper twice.

### CI matrix does not gain the coverage the new comment claims

- File: `.github/workflows/publish-electron.yml:150-156` (unchanged `strategy.matrix`: `windows-latest`, `macos-latest`, `ubuntu-latest`) vs `:301-306` (new comment: "this is the cross-platform proof the Batch 1 spike could only run on win32-x64 locally")
- Problem: The comment is true only in the narrow sense that `verify-packed-native.js` now also checks `@parcel/watcher` on whichever OS each existing runner happens to be. It does not add the arm64 leg (or an `npm_config_arch`-forced smoke) that Task 10.4/10.5 and risk D10 (`batches.md:52,70,658-661`) call for. Task 10.5 is still marked PENDING in `batches.md:658` and its own verification line (`:667`) requires "Release CI package matrix (macOS / Linux / Windows arm64) green ... before P2 is declared done" — arm64 is not in this matrix before or after the diff.
- Tradeoff: Leaving the comment as-is invites the next reader (or the team-leader closing P2) to treat D10 as resolved by this batch when the matrix gap it names is untouched.
- Recommendation: Either add the missing runner leg in this batch, or soften the comment to state plainly that it covers `windows-latest`/`macos-latest`/`ubuntu-latest` only and that arm64 remains open per Task 10.5, so the gap is visible at the point someone would sign off Batch 10 as done.

## Minor issues

- `apps/ptah-electron/scripts/verify-packed-native.js:167` — unused `eslint-disable-next-line @typescript-eslint/no-var-requires`; `npx eslint` flags it as a no-op directive on a plain `.js` `require()`. Delete the comment.
- `apps/ptah-electron/scripts/verify-packed-native.js:181` — `await watcher.subscribe(tmpDir, () => {})` triggers the repo's warn-level `@typescript-eslint/no-empty-function`; a one-word inline comment (`() => {} /* no-op listener */`) or a named `noop` const would silence it for free, matching how the file already comments every other non-obvious line.
- `apps/ptah-electron/CLAUDE.md:50` — the new `build-workspace-watch-host` bullet is inserted first in the per-target bullet list, ahead of `build-integrity-worker` and `build-embedder-worker`, while the "chains" summary one line above (`:49`) and the `project.json` `dependsOn` arrays it documents both list `workspace-watch-host` last. Move the bullet to match reading order.

## File-by-file

### apps/ptah-cli/project.json

Score 9/10 — 0 blocking, 0 serious, 0 minor. `build-workspace-watch-host` (`:182-208`) is a faithful structural copy of `build-integrity-worker` (`:161-181`): same banner, same tsconfig pattern, same `dependsOn: ["build"]`, correctly wired into `restore-cli-manifest` and `test.dependsOn`. `@parcel/watcher` added to `build-esbuild.external` in the right alphabetical slot.

### apps/ptah-electron/project.json

Score 9/10 — 0 blocking, 0 serious, 0 minor. `build-workspace-watch-host` (`:187-212`) mirrors this app's own `build-integrity-worker` (`:159-184`) exactly, including the single-file `outputs` array and `dependsOn: []` convention Electron workers use (correctly different from the CLI's `dependsOn: ["build"]`, because that's how the sibling targets already differ per app). Correctly added to `build`, `build-dev`, `serve:watch`, and `test.dependsOn`.

### apps/ptah-cli/tsconfig.workspace-watch-host.json / apps/ptah-electron/tsconfig.workspace-watch-host.json

Score 10/10 — both are structural copies of their app's `tsconfig.integrity-worker.json`, `include`/`exclude` shape identical to precedent.

### apps/ptah-cli/src/test-utils/esm-bundle-gate.spec.ts / apps/ptah-electron/src/config/esm-bundle-gate.spec.ts

Score 8/10 — 0 blocking, 0 serious, 1 minor (documentation only, not double-counted above). The two copies took the same structural edit (regex widened to `-(worker|host)$`, `EXPECTED_ESM_TARGETS` and `WORKER_ENTRY_GUARDS` both extended) with platform-appropriate prose rather than a verbatim comment copy, which is correct — the CLI host only ever runs under `child_process.fork` while the Electron host has three possible transports, and the guard-string text for each (`apps/ptah-cli/...spec.ts:244`, `apps/ptah-electron/...spec.ts:317-318`) matches that difference rather than papering over it.

### apps/ptah-electron/scripts/verify-packed-native.js

Score 6/10 — 0 blocking, 2 serious (duplicated helper, one shared with the discussion above), 2 minor (unused disable directive, empty-function warning). The header doc comment (`:16-29`) is a genuine strength — it explains the ABI-vs-N-API distinction and cites the Sentry issue and the `b1-spike-report.md` risk by name, which is exactly the kind of "why" comment this repo rewards elsewhere. The duplication is the one real structural gap.

### apps/ptah-electron/electron-builder.yml

Score 9/10 — 0 blocking, 0 serious, 0 minor. New `asarUnpack` block (`:82-99`) follows the existing `TASK_2026_HERMES` block's comment style (explains _why_, cites the failure mode and its source document), correctly ordered after `onnxruntime-node`, and does not collide with any pre-existing `picomatch`/`is-glob` entry.

### apps/ptah-cli/package.json / apps/ptah-electron/package.json / package.json

Score 8/10 — 0 blocking, 0 serious, 0 minor (the missing `integrity-worker.mjs` in `files` is noted below as a pre-existing gap, not a Batch 10 defect). `@parcel/watcher` is inserted in the correct alphabetical position in all three manifests. `apps/ptah-cli/package.json` `files` (`:33-36`) correctly gains `workspace-watch-host.mjs` next to the existing `embedder-worker.mjs` entry.

### .github/workflows/publish-electron.yml

Score 6/10 — 0 blocking, 1 serious (see above), 0 minor. Step renames are accurate (all three now genuinely verify two things, not one) and do not break anything: none of the three renamed steps has an `id:` that anything else in the workflow references (`grep -n "steps\."` shows no reference to these specific steps by output). The added comments are useful except for the cross-platform-proof overclaim on the macOS/Linux step.

### apps/ptah-tui/tsconfig.app.json

Score 10/10. Excludes `src/build-artifact-gate.ts` by explicit path, matching Electron's own convention of excluding its non-test-utils gate file by path (`apps/ptah-electron/tsconfig.app.json:19`) rather than by a glob (which is what the CLI does, because the CLI's copy already lives under `src/test-utils/**`). All three apps now use the placement-appropriate exclusion style for their own gate file.

### apps/ptah-electron/CLAUDE.md

Score 8/10 — 0 blocking, 0 serious, 1 minor (bullet ordering, above). Content is accurate and specific: verified the `ElectronWorkspaceWatchHostFactory.fork()` really does call `ElectronUtilityWorkerProcess.fork` (`apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts:61-62`), so the doc's "Forked as a `utilityProcess`" claim is not aspirational.

## Pattern compliance

| Repository rule or nearby convention                                                     | Status         | Evidence                                                                                     |
| ---------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| New esbuild target mirrors `build-integrity-worker` shape (per-app)                      | PASS           | `apps/ptah-cli/project.json:182-208`, `apps/ptah-electron/project.json:187-212`              |
| New worker/host target wired into `build`, `build-dev`/`serve:watch`, `test.dependsOn`   | PASS           | both `project.json` diffs                                                                    |
| ESM bundle gate spec kept in lockstep with the target list it audits                     | PASS           | both `esm-bundle-gate.spec.ts` diffs                                                         |
| No duplicated path-walking / structurally identical helper functions                     | FAIL           | `verify-packed-native.js:98-114` vs `:118-136`                                               |
| `asarUnpack` new entries follow existing comment-explains-why convention                 | PASS           | `electron-builder.yml:82-99`                                                                 |
| Dependency manifests keep alphabetical ordering                                          | PASS           | `apps/ptah-cli/package.json`, `apps/ptah-electron/package.json`, root `package.json`         |
| CI step renames do not break `id:`-based references                                      | PASS           | no `steps.<renamed-step-id>` reference found in `publish-electron.yml`                       |
| tsconfig exclude of the app's own gate file matches the app's existing placement pattern | PASS           | `apps/ptah-tui/tsconfig.app.json` vs `apps/ptah-electron/tsconfig.app.json:19`               |
| No unused/no-op lint-disable directives                                                  | FAIL           | `verify-packed-native.js:167`                                                                |
| `apps/ptah-cli/CLAUDE.md` documents the CLI build artifacts                              | NOT_APPLICABLE | file untouched by this batch; see Maintenance debt — a pre-existing gap, not introduced here |
| Batch's own Task 10.5 (cross-platform CI smoke) closed                                   | FAIL           | `batches.md:658-661` still PENDING; matrix unchanged, see Serious issues                     |

## Maintenance debt

- Introduced: one genuine duplicate helper (`findPackedParcelWatcher`) that should have been a parameterized reuse of `findPackedAddons`; one dead lint-disable comment likely to be copy-pasted forward; a CI comment that reads as closing a risk (D10) the diff does not actually close.
- Retired: nothing — this is additive packaging/build-target work with no removed surface.
- Net: mildly negative on this file (`verify-packed-native.js`) alone, neutral-to-positive everywhere else (the `project.json`/`tsconfig`/gate-spec trio is a clean, faithful mirror of established precedent).

## Out-of-scope observations (reported per the review brief, not scored)

- `apps/ptah-cli/package.json` `files` (`:33-36`) still does not list `integrity-worker.mjs`, even though `build-integrity-worker` has shipped that artifact into `dist/apps/ptah-cli` since before this batch (confirmed via `git log -p --follow` on the manifest — the entry was never added when the target was). This is a pre-existing gap, not something Batch 10 introduced or was scoped to fix (Task 10.2/10.4 only mention `embedder-worker.mjs`-adjacent files by cross-reference), but it means the CLI npm tarball has been missing a shipped worker file for longer than this batch and it doesn't belong in Batch 10 to silently pick up — flagging for the orchestrator to open as its own follow-up.
- `apps/ptah-cli/CLAUDE.md` was not touched by this batch and documents none of the CLI's build artifacts (no mention of `main.mjs`, `embedder-worker.mjs`, `integrity-worker.mjs`, or the new `workspace-watch-host.mjs`) — unlike `apps/ptah-electron/CLAUDE.md`'s detailed "Build & Run" section. This is a pre-existing doc gap, not something this batch made worse, but the batch was an opportunity to close it for the CLI's newest artifact and didn't.
- `libs/backend/platform-cli/CLAUDE.md` and `libs/backend/platform-electron/CLAUDE.md` were checked for stale "produced in Batch 10"-style future-tense text; none found — both describe the workspace-watch-host entry in accurate present tense, consistent with it already existing from an earlier batch.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `verify-packed-native.js` copies its directory-walk helper instead of reusing it, and the `publish-electron.yml` comment claims cross-platform coverage the untouched CI matrix does not provide — both are cheap to fix and neither requires touching the (correctly mirrored) `project.json`/tsconfig/gate-spec trio.
- What a 10/10 version would do differently: (1) one shared `findPackedFiles` helper called twice instead of two copies; (2) either an added arm64 matrix leg or an honest comment scoped to what the current three-OS matrix actually proves; (3) drop the dead eslint-disable comment; (4) move the new `apps/ptah-electron/CLAUDE.md` bullet to match the existing dependency-chain reading order.

---

## Delta review (review fixes)

Scope: the fixes applied after the base review above, plus new structure introduced alongside them. `libs/backend/persistence-sqlite/**` is excluded (separate commit/concern). Re-read every file in the original diff plus the new ones; ran `npx prettier --check` and `npx eslint` again on all touched JS/TS.

### Base findings — verification

| #                              | Base finding                                   | Status                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Serious #1                     | Duplicated path-walking helper                 | FIXED                                                                                                                                                                                                                                                                                             | `apps/ptah-electron/scripts/verify-packed-native.js:102-125` — one `findPackedFiles(dir, suffix, found)`, called at `:168` (parcel-watcher search) and `:246` (better-sqlite3 search) with a doc comment that names the finding it closes ("code-style-review.md Batch 10 Serious #1")                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Serious #2                     | CI comment overclaimed cross-platform coverage | FIXED                                                                                                                                                                                                                                                                                             | `.github/workflows/publish-electron.yml:144-161` (new comment on the `build:` job, above the unchanged 3-leg matrix) states precisely, per OS, what ships and under what arch: `windows-latest -> win32-x64`, `macos-latest -> darwin-arm64` (no darwin-x64 leg), `ubuntu-latest -> linux-x64`; explicitly says darwin-x64 and windows-arm64 are "NOT built and NOT published ... at all — nothing unproven ships under those two, because nothing ships under them, period." The three per-step comments at `:316-331` and `:352-361` were narrowed to match (each names exactly which single arch its own runner proves). This is the correct fix: not "add a matrix leg" (out of this batch's scope) but "stop the comment claiming more than the matrix does." |
| Minor — dead eslint-disable    | FIXED                                          | `verify-packed-native.js:167` comment removed; `require(indexPath)` at the old line has no disable comment now. `npx eslint` on the file: 0 problems (previously 2 warnings).                                                                                                                     |
| Minor — empty-function warning | FIXED                                          | `verify-packed-native.js:198-200` — named `noopListener` with an inline comment ("no-op listener -- this gate only proves subscribe/unsubscribe settle, it does not need real events") replaces the bare `() => {}`. `no-empty-function` no longer fires.                                         |
| Minor — CLAUDE.md bullet order | FIXED                                          | `apps/ptah-electron/CLAUDE.md:51` — `build-workspace-watch-host` bullet now sits after `build-embedder-worker`, matching the `dependsOn` order in the "chains" line one bullet above (`embedder-worker` → `voice-worker` → `integrity-worker` → `state-storage-worker` → `workspace-watch-host`). |

One thing not requested but worth recording: the fix for Serious #1 also added a `withTimeout()` wrapper (`verify-packed-native.js:135-146`) around `subscribe()`/`unsubscribe()` with a 30s bound, addressing a logic-review finding (Batch 10 Serious #1, cited in the code) about a hang-forever failure mode. That is a logic fix riding along with the style fix in the same hunk; it does not conflict with anything in this style review and the naming/placement (`PARCEL_WATCHER_SUBSCRIBE_TIMEOUT_MS`, `withTimeout` defined once and reused for both calls) is clean.

### New structure

**Scoped `outputs` (`apps/ptah-cli/project.json:14-20,141,165,192`, `apps/ptah-tui/project.json:10`)** — PASS. Every esbuild target in both files now declares `outputs` as an explicit file (or small file list), replacing the previous `["{options.outputPath}"]` whole-directory glob: `build-esbuild` lists `main.mjs`, `main.mjs.map`, `package.json`, `README.md`, `LICENSE.md`, `docs`; the three worker/host targets each list their single `.mjs`; `ptah-tui:build` lists `tui.mjs` only. This is the same per-file `outputs` convention `apps/ptah-electron/project.json`'s `build-main`/`build-integrity-worker`/etc. already use (confirmed against `build-main`'s `outputs` array, which lists `main.mjs`, `main.mjs.map`, `package.json`, `package-lock.json`, `electron-builder.yml`, `assets`, `templates` individually rather than the whole directory). It also fixes a real hazard the old unscoped form created specifically for CLI: `ptah-tui:build` and every `ptah-cli` esbuild target wrote into the _same_ `dist/apps/ptah-cli` directory, so an unscoped `outputs: ["{options.outputPath}"]` meant Nx could treat any one target's cache hit as authoritative for files another target owns — the exact mechanism `packaged-files.spec.ts`'s doc comment (`:5-13`) says shipped a broken tarball. Scoping to per-file outputs is the correct fix, not a cosmetic one.

**`publish-cli.yml` build collapsed to `npx nx run ptah-cli:restore-cli-manifest`** (`:128-135` disabled `smoke` job, `:333-352` `publish` job) — PASS. Replaces the hand-rolled `nx build ptah-cli` + `nx build ptah-tui` + manual `copyFileSync` sequence with the one target whose `dependsOn` graph (`build-embedder-worker` → `build-integrity-worker` → `build-workspace-watch-host` → `ptah-tui:build` → manifest copy) actually produces every bundle in the right order, and both steps carry a comment stating why the old sequence was unsafe, consistent with this repo's existing convention of leaving a load-bearing "why" comment at the point of a fix (matches the `TASK_2026_HERMES` and `TASK_2026_437` comment style already used in `electron-builder.yml`/`publish-electron.yml`). The `smoke` job's copy of this step (`:128-135`) was updated identically even though the job carries a pre-existing, untouched `if: false` (line 89, confirmed not part of this diff) — keeping dead-but-disabled code in sync rather than letting it drift is the right call if that job is ever re-enabled. The "Verify dist contents" step's `for f in ...` list (`:355-361`) was extended with the three new bundle names, matching `REQUIRED_CLI_BUNDLES` in the new spec (see below) — verified by substring match, both lists agree.

**`apps/ptah-cli/src/test-utils/packaged-files.spec.ts`** — PASS on naming, placement, and the YAML-reading pattern. This should NOT extend `esm-bundle-gate.spec.ts`: that file's job is discovering and structurally validating `@nx/esbuild:esbuild` _target_ wiring in `project.json`; this new file's job is validating the _npm package_ surface (`package.json` `files`, the publish workflow's shell-level file list, and on-disk artifact presence) — a different boundary with a different failure mode, and merging them would make `esm-bundle-gate.spec.ts` responsible for two unrelated contracts. Placement in `apps/ptah-cli/src/test-utils/` matches its sibling `esm-bundle-gate.spec.ts` exactly. Reading workflow YAML as text inside a unit spec is not a new pattern in this repo: `apps/ptah-electron/src/config/packaged-deps.spec.ts` already does exactly this — same `REPO_ROOT`/`APP_DIR`/`PUBLISH_WORKFLOW_PATH` constant shape, same "read the workflow file, `toContain()` a substring, with a comment explaining why a full YAML+bash parse isn't attempted" approach, same "guards what actually ships" framing in its header comment. `packaged-files.spec.ts` is that file's direct CLI-side analogue, correctly reusing `describeIfBuiltOrFail` from the local `build-artifact-gate.ts` copy (`:28,125-128`) the same way `esm-bundle-gate.spec.ts` does. The one naming asymmetry — sibling is `esm-bundle-gate.spec.ts` ("-gate" in the name) while this is `packaged-files.spec.ts` (no "-gate") — is not a defect: `packaged-deps.spec.ts`, the file this one is modeled on, also omits "-gate" despite gating the same way, so the naming is consistent with its actual precedent, just not with the other sibling in the same folder. Not worth renaming.

**Set-equality assertion in both `esm-bundle-gate.spec.ts` copies** — PASS, still in sync. Both gained the identical `'discovers exactly EXPECTED_ESM_TARGETS -- no undeclared ESM esbuild target exists'` test (`apps/ptah-cli/...spec.ts:141-148`, `apps/ptah-electron/...spec.ts:171-180`) with the same sorted-array-equality assertion and the same rationale (closes the gap where a new ESM target not ending in `-worker`/`-host` would bypass every existing check), each citing `code-logic-review.md Batch 10 review-fix, Logic #1` in a comment. The prose differs only in the platform-specific detail each file already carried before this delta (expected — this is the same "same structural edit, platform-appropriate prose" pattern the base review approved for the `-host` suffix change).

**`apps/ptah-cli/CLAUDE.md` new "Build & Run" table** — PASS, and closes an out-of-scope gap the base review flagged. The five-artifact table plus the `restore-cli-manifest`-is-the-one-safe-path paragraph (`:43-72`) is exactly the documentation the base review's "out-of-scope observations" section said the CLI's CLAUDE.md was missing relative to Electron's. Cross-checked every claim: the table's "Built by" column matches the actual target names in `project.json`; the "Do not replay that sequence by hand" warning matches the real regression `packaged-files.spec.ts`'s header describes; the "outputs scoped to their own single file" sentence matches the actual `project.json` diff.

**`apps/ptah-cli/package.json` `files` += `integrity-worker.mjs`** — PASS, closes the pre-existing gap the base review flagged as out-of-scope (`integrity-worker.mjs` had been missing from `files` since the target was added, confirmed via `git log -p --follow` in the base review). Now both `integrity-worker.mjs` and `workspace-watch-host.mjs` are present (`:36-37`), following build-artifact order rather than alphabetical — consistent with the pre-existing list's own ordering (`main.mjs`, `tui.mjs`, `embedder-worker.mjs`, ... is build-artifact order, not alphabetical, so the new entries correctly follow the existing convention rather than introducing a new one).

### Delta verdict

- Recommendation: APPROVE
- Confidence: HIGH
- All five base findings (2 serious, 3 minor) are fixed, verified against the actual diff line-by-line, not just the stated intent. `npx eslint`/`npx prettier --check` clean on every touched file (0 errors, 0 warnings — the two eslint warnings from the base review are gone).
- New structure (`outputs` scoping, `restore-cli-manifest`-only build, `packaged-files.spec.ts`, the set-equality assertion, the CLI CLAUDE.md table, the `files` completion) is well-founded, correctly placed against existing precedent in each case, and closes real gaps (including two the base review noted as pre-existing but out-of-scope) rather than introducing new ones. No new blocking, serious, or minor findings from this delta.
- Updated overall assessment for Batch 10 as a whole: APPROVED.
