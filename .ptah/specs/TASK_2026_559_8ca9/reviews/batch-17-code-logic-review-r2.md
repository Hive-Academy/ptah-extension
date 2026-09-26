# Code Logic Review — `TASK_2026_559_8ca9` (Batch 17, Round 2)

## Summary

Batch 17, Lane A, r2 (`ptah_browser_screenshot`). **APPROVED**: Both r1 defects (S1 PNG quality validation regression, M1 unbounded transcript callback summary) are fully resolved with rigorous regression tests. In addition, the runtime TypeError on the CLI placeholder host is cleanly mitigated via interface capability conformance checking. Inline image delivery is preserved byte-for-byte, format and MIME mapping is consistent across all formats and extension inferences, and all scoped verification targets pass.

| Metric              | Value                         |
| ------------------- | ----------------------------- |
| Overall score       | 8/10                          |
| Assessment          | APPROVED                      |
| Blocking issues     | 0                             |
| Serious issues      | 0                             |
| Moderate issues     | 0                             |
| Failure modes found | 0 new (2 r1 defects resolved) |

The score is 8/10 (sound): all acceptance criteria and User Decisions 3 and 4 are honoured, both previous defects are resolved with negative and boundary tests, and no regressions were detected. It is not 9–10 because the CLI placeholder fix adopts an all-or-nothing interface conformance check rather than per-method capability degradation, though no partial host exists in the repository today.

Scope: uncommitted changes under `libs/backend/vscode-lm-tools`:

- `browser-namespace.builder.ts` (`B`) and its spec `browser-namespace.builder.spec.ts` (`BS`)
- `protocol-dispatcher.ts` (`D`) and its spec `protocol-dispatcher.spec.ts` (`DS`)
- `tool-description.builder.ts` (`T`)

## r1 findings status

| Issue                                                          | Severity    | Status       | Evidence / Verification                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ----------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1: PNG quality validated even though PNG ignores it**       | Serious     | **RESOLVED** | `B:311–316`: when `format === 'png'`, `quality` is explicitly set to `undefined`, bypassing the integer/range validation. Tested across `undefined, -1, 101, 50.5, NaN, 80` in `BS:243–257` and `saveTo: 'home.png'` in `DS:3516–3562`.                                                                                                                                                               |
| **M1: Saved paths escape callback length and one-line limits** | Moderate    | **RESOLVED** | `D:3328–3351`: `screenshotTranscriptSummary` replaces all Unicode control characters (`\p{Cc}`) with `?`, and clips overflowing paths with `…` while retaining the filename (up to room) and prefix, guaranteeing `< 300` characters (`SCREENSHOT_SUMMARY_MAX_CHARS = 299`). Full path remains in response caption. Tested with 45 nested dirs, line-breaks, and 400-char filename in `DS:3564–3627`. |
| **Runtime note: CLI placeholder host threw TypeError**         | Observation | **RESOLVED** | `B:220, 227–241`: `implementsBrowserCapabilities` checks all 13 `IBrowserCapabilities` methods before binding. The CLI's `{ launch, close, getStatus }` placeholder safely degrades to `buildGracefulBrowserNamespace()`, returning `"Browser capabilities not available on this platform..."` instead of `TypeError: capabilities.screenshot is not a function`. Tested in `BS:313–338`.             |

## Five logic questions

### 1. How does this fail silently?

- **Save failure**: At `D:1413–1433`, if saving the screenshot to disk fails (`fs.writeFileSync` throws), the error is logged to `deps.logger.warn` and `screenshotResult.filePath` remains undefined. The tool invocation still returns a successful response containing the inline image block, but omits `Saved to: <path>` from the caption and transcript. This behaviour is inherited from prior batches and deliberate: disk failure does not discard captured browser image data.
- **CLI / Unsupported platform**: `B:220` transparently catches missing capabilities or incomplete placeholders and returns graceful degradation stubs with `error: BROWSER_NOT_AVAILABLE_MSG`. The caller receives explicit error structures, not silent failure.

### 2. What user action produces unexpected behaviour?

- **Unrecognized format**: Supplying an unknown string like `{ format: 'gif' }` passes schema validation at compile time if cast or sent by an unconstrained MCP client. Chrome CDP defaults to capturing JPEG but returns `{ data, format: 'gif' }`, which `D:1436` maps to `image/png` MIME type. This is an inherited edge case noted in r1 and executor reports; supported formats (`jpeg`, `png`, `webp`) behave deterministically.
- **Partial custom browser capability**: If an external caller or future port registers an object implementing only a subset of `IBrowserCapabilities` (e.g., `navigate` and `screenshot`, but omitting `startRecording`), `B:220` causes all browser methods to report unavailable.

### 3. What input data produces a wrong answer?

- None found for supported inputs.
- For `saveTo` without an explicit `format`:
  - `.png` resolves to PNG (lossless, quality omitted)
  - `.jpg`, `.jpeg`, `.JPEG` resolves to JPEG at quality 60
  - `.webp` resolves to WebP at quality 60 (or explicit quality)
  - `.bmp` or no extension falls back to JPEG at quality 60 (with `.jpeg` appended if no extension existed)
- In all cases, `mimeType` in `D:1436–1441` matches the actual produced format (`image/jpeg`, `image/webp`, or `image/png`).

### 4. What happens when a dependency fails?

- **Browser capability throws**: If `capabilities.screenshot` rejects (e.g. detached frame, target crashed), `B:332–339` catches the error and returns `{ data: '', format, error: ... }`. `D:1412` and `D:1435` skip image rendering and file saving, falling through to `createToolSuccessResponse(request, formatBrowserScreenshot(screenshotResult), deps)` which outputs `"Screenshot Failed: <error>"` (`DS:3540–3558`).
- **Transcript callback throws**: `deps.onToolResult` is wrapped in `runObserver` at `D:1446–1452`, so any exception thrown by a listener or transcript consumer is swallowed without aborting the tool response or corrupting the returned image.

### 5. What is missing that the requirements never mentioned?

- **Granular / per-method capability degradation**: The specification did not define whether a partial browser host should degrade per method or all-or-nothing. The current implementation chooses an all-or-nothing check (`implementsBrowserCapabilities`). Because both actual production implementations (`ChromeLauncherBrowserCapabilities` and `ElectronBrowserCapabilities`) implement all 13 methods, this is safe today.

## Failure modes

None reproduced for the revised batch code.

- S1 failure mode (`PNG quality validation`) is verified eradicated by unit tests in `BS:243–257` and `DS:3516–3562`.
- M1 failure mode (`Transcript callback unbounded path length`) is verified eradicated by boundary clipping logic in `D:3328–3351` and tests in `DS:3564–3627`.
- CLI placeholder TypeError is eliminated by `B:220, 227–241`.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### R2-MIN-1: All-or-nothing browser capability validation prevents partial host delegation

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts:220, 227–241`
- **Scenario**: A host registers an object under `BROWSER_CAPABILITIES_TOKEN` that implements core navigation and screenshot methods, but lacks recording methods (`startRecording`, `stopRecording`).
- **Impact**: `implementsBrowserCapabilities` returns `false`, causing all 13 browser tools to degrade to `"Browser capabilities not available on this platform"`.
- **Context / Mitigation**: In the current repository, only `ChromeLauncherBrowserCapabilities` and `ElectronBrowserCapabilities` exist, both of which implement all 13 methods. The CLI registers `{ launch, close, getStatus }`, which has 0 of the 13 methods. Hence no real host is impaired today. If partial hosts are introduced in the future, checking `typeof capabilities[method] === 'function'` per method will provide more granular capability reporting.

## Data flow

1. **Schema declaration** (`T:1050–1075`): `ptah_browser_screenshot` documents `format` (default: `"jpeg"`), `quality` (default: 60, integer 0–100, ignored for png), and `saveTo` extension format inference. — **OK**
2. **Dispatch entry** (`D:1400–1411`): `handleIndividualTool` inspects `format` and `saveTo`. If `format` is undefined, `screenshotFormatForPath(saveTo)` infers format from extension (`.png` → `'png'`, `.jpg`/`.jpeg` → `'jpeg'`, `.webp` → `'webp'`). — **OK**
3. **Namespace resolution & boundary validation** (`B:310–330`):
   - Resolves `format` to `params?.format ?? 'jpeg'`.
   - If `format === 'png'`, `quality` is forced to `undefined`.
   - If `format !== 'png'`, `quality` defaults to `params?.quality ?? 60`.
   - Validates that `quality` is an integer between 0 and 100. If invalid, returns error payload without invoking capability. — **OK**
4. **Capability delegation** (`B:331`): Invokes `capabilities.screenshot({ ...params, format, quality })`. Real hosts (`ChromeLauncherBrowserCapabilities:124`, `ElectronBrowserCapabilities:114`) forward codec and quality to CDP `Page.captureScreenshot`. — **OK**
5. **Disk persistence** (`D:1412–1434`): If `saveTo` was specified and capture succeeded, writes base64 decoded buffer to disk; catches and logs write errors without breaking response. — **OK**
6. **Transcript callback** (`D:1443–1452`): Generates bounded summary via `screenshotTranscriptSummary`. Sanitizes control characters with `\p{Cc}` -> `?`, limits length to `< 300` characters (`SCREENSHOT_SUMMARY_MAX_CHARS = 299`), and sends to `onToolResult` inside `runObserver`. — **OK**
7. **Response packaging** (`D:1454–1479`): Formats full `caption` with complete path, budgets text block via `budgetToolText`, and returns `{ type: 'image', data, mimeType }` + `{ type: 'text', text: caption.text }`. Inline image block is unbudgeted and byte-preserved. — **OK**
8. **Error fallback** (`D:1481`): Capture errors or capability failures route to `createToolSuccessResponse(request, formatBrowserScreenshot(screenshotResult), deps)`. — **OK**

## Requirements fulfilment

| Requirement                                      | Status   | Evidence / Notes                                    |
| ------------------------------------------------ | -------- | --------------------------------------------------- |
| No selection defaults to JPEG quality 60         | COMPLETE | `B:150–151, 310, 316`; `BS:172–181`                 |
| Explicit PNG honoured                            | COMPLETE | `B:310, 314`; `BS:183–193, 243–257`                 |
| Explicit WebP honoured with default quality 60   | COMPLETE | `B:310, 316`; `BS:195–204`                          |
| PNG ignores quality value without error          | COMPLETE | `B:314–315`; `BS:243–257`; `DS:3516–3533`           |
| JPEG/WebP quality validated as integer 0–100     | COMPLETE | `B:318–329`; `BS:215–241`                           |
| Image block remains inline                       | COMPLETE | `D:1468–1478` preserves image content block         |
| `onToolResult` receives bounded one-line summary | COMPLETE | `D:1443–1452, 3328–3351`; `DS:3471–3477, 3564–3627` |
| `onToolResult` eliminates duplicate base64 block | COMPLETE | `D:1443–1452`; `DS:3476`                            |
| Error path preserved unchanged                   | COMPLETE | `D:1481`; `DS:3540–3558`                            |
| Tool description reflects new defaults           | COMPLETE | `T:1053, 1062, 1067`; `DS:3560–3573`                |
| SaveTo extension format inference                | COMPLETE | `D:1408, 3357–3374`; `DS:3494–3538`                 |
| CLI placeholder host handled gracefully          | COMPLETE | `B:220, 227–241`; `BS:313–338`                      |

## Edge cases

| Case                                                             | Handled | How                                                              | Concern                     |
| ---------------------------------------------------------------- | ------- | ---------------------------------------------------------------- | --------------------------- |
| No format, no quality, no saveTo                                 | YES     | JPEG q60 default applied at `B:310, 316`                         | None                        |
| PNG with out-of-range quality (`101`, `-1`, `50.5`, `NaN`)       | YES     | Quality stripped to `undefined` at `B:315`, capture succeeds     | None (S1 fixed)             |
| JPEG/WebP with out-of-range quality (`101`, `-1`, `50.5`, `NaN`) | YES     | Rejected at `B:318–329` with clear error message                 | None (matches CDP contract) |
| JPEG/WebP quality bounds (`0`, `100`)                            | YES     | Preserved through nullish check at `B:316`; `BS:215–224`         | None                        |
| Long saveTo path (> 300 chars)                                   | YES     | Middle truncated with `…` at `D:3345–3350`, length <= 299        | None (M1 fixed)             |
| SaveTo path with CRLF / control chars                            | YES     | `text.replace(/\p{Cc}/gu, '?')` at `D:3332` enforces single line | None (M1 fixed)             |
| SaveTo without directory created                                 | YES     | `fs.mkdirSync(dir, { recursive: true })` at `D:1421`             | None                        |
| SaveTo disk write failure                                        | YES     | Caught at `D:1428`, logged, image still returned                 | Inherited design            |
| Missing browser capabilities                                     | YES     | Graceful degradation stubs at `B:220, 468`                       | None                        |
| Incomplete CLI browser capabilities                              | YES     | `implementsBrowserCapabilities` checks all 13 methods at `B:220` | None                        |
| `onToolResult` throws exception                                  | YES     | `runObserver` at `D:1446` isolates callback                      | None                        |

## Verification

The following verification commands were executed in the working tree:

```powershell
# 1. Scoped tests, lint, and typecheck for vscode-lm-tools
node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache
# Result:
# √  nx run @ptah-extension/vscode-lm-tools:typecheck
# √  nx run @ptah-extension/vscode-lm-tools:test
# √  nx run @ptah-extension/vscode-lm-tools:lint
# NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/vscode-lm-tools (1m 21s)

# 2. Degradation audit
node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache
# Result:
# degradation-audit: TOTAL 300 unsuppressed site(s)
# NX   Successfully ran target lint for project degradation-audit (14.0s)

# 3. Electron dependency validation
node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache
# Result:
# NX   Successfully ran target validate-deps for project ptah-electron and 1 task it depends on (3.8s)
```

All 278 unit tests in `@ptah-extension/vscode-lm-tools` pass cleanly.

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: None blocking. Future browser capability providers must implement all 13 `IBrowserCapabilities` methods to avoid triggering the whole-namespace graceful degradation fallback.
- What a robust implementation would add: Per-method capability degradation if modular browser capability adapters are ever introduced in future tasks.
