# Batch 17 executor report: ptah_browser_screenshot defaults to jpeg q60 and drops the duplicate re-encode

Lane A, Task 17.1. Nothing staged or committed. The working tree is left dirty.

## Changes

- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts`
  - :146-152 adds `DEFAULT_SCREENSHOT_FORMAT = 'jpeg'` and `DEFAULT_SCREENSHOT_QUALITY = 60`.
  - :283-314 changes `screenshot()`:
    - If no format is given, the format is jpeg.
    - For jpeg and webp, a missing quality becomes 60. For png, quality is passed through unchanged; hosts ignore it.
    - An explicit quality must be an integer from 0 to 100. Anything else returns `{ data: '', format, error: 'Invalid quality. Must be an integer between 0 and 100.' }` and the capability is not called. This follows the same reject-before-delegating pattern as the viewport check in `navigate()`. There was no quality validation before.
    - The catch block now uses `error: unknown` and reports the resolved format instead of the hard-coded `'png'`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
  - :1406-1411: when no format is given, the format comes from the `saveTo` extension (see Deviations).
  - :1443-1453: on the success path, `onToolResult` now receives the same one-line summary as the caption: `Screenshot captured (<fmt>, ~<N>KB)[ | Saved to: <path>]`. It no longer receives `formatBrowserScreenshot` output with the base64 code block. The `image` block stays inline. The error path (:1471-1475) is unchanged.
  - :3310-3332 adds the new helper `screenshotFormatForPath` (.png → png; .jpg/.jpeg → jpeg; .webp → webp; anything else → undefined).
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
  - :1053 adds "Defaults to jpeg at quality 60; pass format \"png\" for a lossless image."
  - :1062 changes the format default from `"png"` to `"jpeg"`.
  - :1067 changes the quality default from 80 to 60 and says it must be an integer. Only claims that the change made false were edited (Decision 4). The saveTo text ("The file extension determines the format if not specified") was false before and is now true.
- Specs:
  - `browser-namespace.builder.spec.ts` :167-247 adds the `screenshot() format and quality` describe with 11 cases.
  - `protocol-dispatcher.spec.ts` :3436-3574 adds the `ptah_browser_screenshot transcript summary and default format` describe with 10 cases. It also adds a `buildBrowserScreenshotTool` import at :43-46.

## Decisions on the requested edge cases

- **Quality given without a format:** jpeg is used at that quality. Spec: `{quality:85}` → `{format:'jpeg', quality:85}`.
- **Explicit webp:** honoured. If no quality is given, it gets the default 60.
- **Explicit jpeg or webp without quality:** now gets 60. Before, the hosts filled in 80. There is now one documented default.
- **Quality out of range:** rejected, not clamped. The cases -1, 101, 50.5 and NaN are all rejected, and 0 and 100 are accepted.
- **A host that cannot produce jpeg:** there is none. Both implementations call CDP `Page.captureScreenshot`, which supports png, jpeg and webp:
  - `chrome-launcher-browser-capabilities.ts:124-149` (VS Code)
  - `apps/ptah-electron/src/services/electron-browser-capabilities.ts:114-138` (Electron)

  ptah-cli registers no `IBrowserCapabilities`, so it gets the graceful stub, which is an error path only.

## Result size (40,000-char synthetic base64 payload)

- **`onToolResult` text before:** the `formatBrowserScreenshot` markdown, which is the whole 40,000-char base64 plus a header of about 80 chars, so more than 40,000 chars.
- **`onToolResult` text after:** `Screenshot captured (jpeg, ~29KB)`, which is 33 chars.
- **Image payload:** jpeg q60 compared with png was not measured, because no live browser was available in this run. The 5-10x figure comes from research/browser.md:139-141 and has not been verified here.

## Fails-before

I ran the new specs against the unmodified source with `jest -c libs/backend/vscode-lm-tools/jest.config.ts --maxWorkers=2 <both spec files>`. Result: `Tests: 15 failed, 250 passed, 265 total`.

Builder, 9 failures:

- both default cases
- webp default quality
- quality without format
- the 4 out-of-range rejections
- the resolved format in the catch block

Dispatcher, 6 failures:

- the summary has no base64 and is under 300 chars
- `saveTo` 'home.png' sends format png
- .jpg, .JPEG and .webp map to their formats
- the description states the default

These 6 new cases passed before the fix and act as guards: explicit png, the jpeg 0/100 bounds, `shot` and `shot.bmp` giving an undefined format, explicit format winning over the extension, and the error path.

After the fix, the same command gives `Tests: 265 passed, 265 total`.

## Verification (tails)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: typecheck, test and lint all passed ("Successfully ran targets test, lint, typecheck").
- `nx run-many -t typecheck -p ptah-cli,ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache`: "degradation-audit: TOTAL 300 unsuppressed site(s)". Target succeeded.
- `prettier --check` on the 5 changed files: "All matched files use Prettier code style!"
- `git status --short`: the 5 files above show as M. The untracked `code-logic-review.md`, `implementation-plan-languages*.md` and `research/diagnostics-worktree-repro.ts` were already there and are not mine.

## Deviations

1. **The `saveTo` extension picks the format when no format is given** (dispatcher :1406-1411, :3310-3332). Without this, switching the default to jpeg would write JPEG bytes into `homepage.png`, which is the tool description's own example. The saveTo description already promised this behaviour. It is not an offload and does not suppress the inline image. If you want Decision 3 read strictly, drop it and change the saveTo description instead.
2. **Quality validation was added** because the brief asked for it. It is not in Decision 3.

## Out of scope, not touched

- Both hosts still fall back to png and quality 80 when called directly without options. The namespace now always passes a format, so this only affects direct callers of the capability.
- An unknown `format` string from MCP (for example "gif") is still passed through. The hosts capture jpeg but report the format as "gif", and the dispatcher labels it `image/png`. This was already the case before this batch.
- `ptah-system-prompt.constant.ts:110-112` makes no claim about the default, so it was not changed.

## Revision round 1 (r1 REVISE 6/10)

The r1 review is at `reviews/batch-17-code-logic-review-r1.md`. The saveTo-extension inference was accepted and is kept unchanged.

### S1: png with a quality value is rejected

Fixed in `browser-namespace.builder.ts:311-330`. The quality rule is now:

- **png:** any quality value is dropped without being checked, and none is sent. This is what the hosts already did (`chrome-launcher-browser-capabilities.ts:137`, `electron-browser-capabilities.ts:126`), so png calls that carry a quality work as they did before this batch.
- **jpeg and webp:** a missing quality becomes 60. The effective quality must be an integer from 0 to 100, or the call is rejected before the capability is called. I kept rejection instead of clamping because CDP types quality as an integer (review :108). Before this batch, an out-of-range value went straight to CDP with no local check, so there was no clamping to match.

The tool description already says "Ignored for png" (`tool-description.builder.ts:1067`), so it is unchanged.

### M1: the transcript summary has no length limit

Fixed in `protocol-dispatcher.ts:1443-1462` and :3319-3353 (`screenshotTranscriptSummary`, max 299 chars).

- Control characters become `?`, so the summary is always one line.
- If the saved path doesn't fit, its middle is replaced by `…`. The start of the path is kept, and the file name is kept whole whenever it fits.
- A final slice guarantees the limit even if the host returns a very long `format` string.
- The response caption still contains the full path; it is budgeted as before.

### CLI placeholder host

The reviewer was right: the CLI registers a placeholder under the browser token, with only `launch`, `close` and `getStatus` (`libs/backend/cli-engine/src/lib/container.ts:775`). Before this fix, a screenshot on that host failed with "capabilities.screenshot is not a function".

Fixed in `browser-namespace.builder.ts:218-250`. `buildBrowserNamespace` now uses the graceful stub unless the registered object has every `IBrowserCapabilities` method. So every browser tool on the CLI answers "Browser capabilities not available on this platform. …" instead of throwing a TypeError. `cli-engine` itself was not edited; it is outside this batch's files.

### New specs

- `browser-namespace.builder.spec.ts`:
  - :230-241: out-of-range quality with an explicit webp or jpeg is rejected.
  - :243-257: png with quality undefined, -1, 101, 50.5, NaN or 80 is captured and no quality is sent. This replaces the earlier single explicit-png case.
  - :313-338: a CLI-placeholder describe with 2 cases.
- `protocol-dispatcher.spec.ts`:
  - :3516-3562: a saveTo `home.png` with quality 50.5, run through the real namespace, captures a png.
  - :3564-3627: a long path (45 nested directories), a path containing line breaks, and a 400-char file name. Each summary stays under 300 chars and on one line, and the caption keeps the full path.

### Fails-before

I ran the new specs against the r0 code with `jest --maxWorkers=2` on both spec files. Result: `Tests: 11 failed, 267 passed, 278 total`. The 11 failures:

- png with quality -1, 101, 50.5, NaN and 80
- the CLI-placeholder screenshot case and the navigate/status case
- the saveTo png with quality 50.5
- the long-path, line-break and long-file-name summaries

These passed before the fix and act as guards: png without quality, and the jpeg/webp quality 101 rejections.

After the fix: `Tests: 278 passed, 278 total`.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: typecheck, lint and test all passed ("Successfully ran targets test, lint, typecheck").
- `nx run-many -t typecheck -p ptah-cli,ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache`: "degradation-audit: TOTAL 300 unsuppressed site(s)".
- `prettier --check` on the 5 changed files: "All matched files use Prettier code style!"
- `git status --short`: the same 5 files show as M, and this report as ??. The other untracked `.ptah` files belong to other agents.

### Correction to the r0 report

The r0 report said "ptah-cli registers no IBrowserCapabilities". That was wrong: the CLI registers the incompatible placeholder described above. The r0 report also named `ElectronBrowserCapabilities` as the Electron host. The review found that Electron registers the Chrome-launcher implementation (`apps/ptah-electron/src/di/phase-3-storage.ts:147`).
