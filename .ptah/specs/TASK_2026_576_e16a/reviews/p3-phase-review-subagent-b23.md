# P3 phase-end logic review (subagent) — Batch 23

Scope: `libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.ts` (+ `.spec.ts`), `libs/frontend/git-ui/src/diff-renderer.ts`, alias `@ptah-extension/git-ui/diff-renderer` (`tsconfig.base.json:105-106`), Batch 23 section of `bundle-measurements.md`. Compared against `pierre-diff-host.component.ts` and `pierre-config.ts`, and checked against the real `@pierre/diffs` 1.5.1 sources in `node_modules/@pierre/diffs/dist`. I also ran `parseDiffFromFile` directly under node for the edge inputs below.

Score: 7/10. Verdict: REVISE (one functional defect, one spec that locks that defect in, the rest moderate).

## What is correct (verified, not assumed)

- Lifecycle mirrors the sibling exactly and is sound. Effect 1 (`text-diff-view.component.ts:86-97`) reads all content inputs, mounts untracked, and registers `onCleanup`. Angular runs that cleanup before the next run and on destroy, so there is no instance leak. `dispose` nulls `this.instance` first, calls `cleanUp()` (`:151`), then clears the shadow root (`:152`).
- Pierre API usage matches the 1.5.1 types: `FileDiff(options, workerManager, isContainerManaged)` (`FileDiff.d.ts:150`), `render({fileDiff, fileContainer})` (`:210`), `setThemeType` (`:161`), `cleanUp(recycle?)` (`:179`), and `parseDiffFromFile(old|null, new|null, options?, throwOnError)` (`parseDiffFromFile.d.ts:10`). `isContainerManaged = true` makes `cleanUp()` skip `fileContainer.remove()` (`FileDiff.js:348`), so the explicit shadow-root clear is correct and necessary.
- Theme effect (`:100-103`) running before or alongside mount is harmless. Effects run in creation order, so the instance exists on first run and `setThemeType` early-returns when the mode is unchanged (`FileDiff.js:233`). Re-mounts construct with the current `themeType`, so a recreated instance is never stale.
- Stale error state: `dispose` clears `_error` (`:154`) before every re-mount, and `mount` clears it on success or both-null. Recovery after an error is therefore correct in the code.
- Real `parseDiffFromFile` behaviour (node run): `(null,'x')` returns type `new`; `('x',null)` returns `deleted`; `('','')`, `('a','a')` and `(null,'')` return OK with 0 hunks; empty name `''` is accepted. It throws only for both null, which the component pre-guards (`:115`). The `throwOnError=true` argument (`:128`) turns `processFile` failures into the caught path.
- Eager bundle: `diff-renderer.ts` is not re-exported from `src/index.ts` or `services.ts`. The alias is a separate path (`tsconfig.base.json:105`), and the entry is the only place that reaches `pierre-config.ts`.

## Findings

### F1 — Serious: `language` hint produces `file.<language>`, which Pierre does not recognise
- Evidence: `text-diff-view.component.ts:121-122` builds `file.${language}`. Pierre resolves language from the extension (`getFiletypeFromFileName.js:351-361`), and `typescript` is not a key of `EXTENSION_TO_FILE_FORMAT` or of the custom map. `pierre-config.ts` registers only extensions such as `ts`, `js` and `yml`. The input is documented as "Optional language hint" (`:67`).
- Scenario: a consumer (Batch 44 `LazyDiffView`) passes `language="typescript"` with no `fileName`. The name becomes `file.typescript`, which resolves to `text`, so the diff renders with no syntax highlighting and no error.
- Silent failure: nothing signals that the hint was ignored.
- The spec asserts this behaviour (`spec.ts:170-176`, `'file.typescript'`), so the test certifies the defect.
- Fix: pass the language as `FileContents.lang` (`types.d.ts:18`, `lang?: SupportedLanguages`), i.e. `{ name, contents, lang }`. Alternatively, map language name to extension, or rename the input to `extension`. Update the spec to assert `lang` is forwarded.

### F2 — Moderate: no feedback for an empty diff (identical texts, both null)
- Evidence: identical texts parse to 0 hunks (node run). `mount` then renders an empty Pierre tree (`:131-141`). Both null returns early (`:115-118`) with no instance and no message.
- Scenario: the user compares two identical strings or opens a not-yet-loaded pair. A blank block appears, which cannot be told apart from "still loading" or "broken".
- Fix: expose a `hasChanges`/`empty` state or render a muted "No differences" note for the 0-hunk case. Decide whether both-null should show a placeholder.

### F3 — Moderate: parse and render error detail is swallowed
- Evidence: `:142-144` stores `err.message` in `_error`, but the template shows only a constant string (`:51`). The message is neither logged nor emitted.
- Scenario: a Pierre or highlighter failure shows "This diff could not be displayed." with no diagnostics anywhere. Pierre's own async highlight failures land in its `errorWrapper` inside the shadow root and are not observed at all.
- Fix: log via the repository's logging convention, or surface the message via `title`/an output. At minimum, do not keep a signal nobody reads.

### F4 — Moderate: `themeType` default is a one-shot read
- Evidence: `:71` `input(readDocumentThemeMode())` is evaluated at construction. The sibling does the same (`pierre-diff-host.component.ts:129`).
- Scenario: a consumer that omits `[themeType]` keeps the construction-time theme after the user switches the app theme at runtime, so the diff stays dark or light incorrectly.
- Fix: document that consumers must bind it, or follow `data-theme-mode` (the attribute observed in `pierre-config.ts:104`).

### F5 — Moderate: spec mock is weaker than the real 1.5.1 contract
- Evidence: the mock `parseDiffFromFile` (`spec.ts:68-79`) never throws for both-null. The real one throws, and the component only avoids that through its own guard.
- The mock `setThemeType` (`spec.ts:55-57`) lacks the real early-return on an unchanged mode (`FileDiff.js:233`).
- The mock `cleanUp` does not model container-managed semantics.
- Result: `FakeFileDiff` constructor and render signatures do match the real `FileDiff`, but the tests cannot catch the F1/F2 class of bugs. They have no case for identical texts, one-side null (new or deleted file), error then recovery (`parseThrows=false` followed by an input change, asserting `error()` returns to null and the note disappears), or a render that throws after `this.instance` is assigned.
- Fix: add those four cases. Consider an integration-style test against the real `parseDiffFromFile` with only `FileDiff` mocked.

### F6 — Minor: measurement does not prove the entry stays out of the eager bundle
- Evidence: `bundle-measurements.md` Batch 23 shows `main.js` unchanged at 362,218 B with a delta of 0, but no source imports `@ptah-extension/git-ui/diff-renderer` yet (grep: only the entry, component and spec reference it). The delta is 0 by construction.
- The lazy sizes come from a throwaway esbuild bundle with Angular externalised (stated in the doc), not the Angular build, so 149.7 KB gz is an approximation.
- The eager-isolation claim therefore becomes testable only at Batch 44, when a `import('@ptah-extension/git-ui/diff-renderer')` consumer lands. Re-run `verify-eager-bundle` and a real lazy-chunk measurement then. No defect today.

### F7 — Minor: layout detail
- Evidence: `:45-54` renders the error `<p>` above `<diffs-container>`. Both stay in the DOM, so on error an empty container follows the note. This is cosmetic and harmless.

## Five logic questions (short)

1. Silent failure: language hint ignored (F1); empty or identical diff shows nothing (F2); async Pierre render errors are unobserved (F3).
2. Unexpected user action: rapid input changes are safe, since each re-mount cleans up first. A runtime theme switch without a bound `themeType` has no effect (F4).
3. Wrong output without error: `language` input and `file.<lang>` naming (F1).
4. Dependency failure: a parse throw is caught and shown (`:142`); a throw from `render` after `this.instance` is set is also cleaned by the effect cleanup. A failing grammar `import()` is handled inside Pierre.
5. Missing: an empty-state message, a language-forwarding path, an error log, and tests for new/deleted/identical inputs.

## Verdict
REVISE. Fix F1 (forward `lang`) and update its spec, and add the F5 edge-case tests. F2 to F4 are cheap and should be folded in. No leak, ordering or Pierre API misuse was found, and the lifecycle is correct.
