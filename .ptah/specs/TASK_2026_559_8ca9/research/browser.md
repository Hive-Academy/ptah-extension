# Browser tools — degradation research (TASK_2026_559)

Scope: `ptah_browser_navigate/click/type/content/evaluate/screenshot/network/status/close/record_start/record_stop`
(11 tools; `mcp-core/protocol-dispatcher.ts:345-357` registers exactly these 11 under the `browser` namespace — no
other browser/computer-use tool exists in `tools/list`).

Running server checked live: extension `apps/ptah-extension-vscode/package.json` version **0.2.43**, workspace HEAD
**9afac1aa2** (2026-09-25, `main`). Test target: `https://example.com` (static, tiny — chosen per instructions to
avoid forms/login). Browser closed at the end of the session (`ptah_browser_close` confirmed
"Browser Session Closed").

## Summary verdict

Ten of eleven browser tools are **correct and reasonably bounded**. Two formatters — `formatBrowserScreenshot` and
`formatBrowserEvaluate` — were **shipped with no output cap on 2026-05-24 (commit 9beb66e4e) and have never had
one**. This is not a regression (no later commit touched either function — confirmed by `git log -S` below); it is
a design gap the token audit (`mcp_surface.md:88-89`) already flagged: *"Only formatBrowserContent has a cap"*.
`formatBrowserContent` (the one capped formatter) and `formatBrowserNetwork` (capped by the capability layer, not
the formatter) both work as documented. `formatBrowserEvaluate`'s lack of a cap is additionally a **loophole**
around `formatBrowserContent`'s 32KB cap: an agent can call `ptah_browser_evaluate` with
`document.documentElement.outerHTML` and get the whole DOM back with zero truncation.

---

## 1. `ptah_browser_navigate`

**Contract** (`tool-description.builder.ts:970-1022`):
> "Navigate the browser to a URL. Lazily starts a browser session if none exists. Returns the final URL and page
> title after load." (:974-977)

**Live behaviour.** `ptah_browser_navigate({url:"https://example.com"})` → 67 chars:
```
## Navigation Complete
**URL:** https://example.com/
**Title:** Example Domain
```
Matches contract exactly.

**Code path.** Dispatch `protocol-dispatcher.ts:1115-1151` → `formatBrowserNavigate`
(`mcp-response-formatter.ts:1004-1021`, no cap needed — output is two lines).

**Regression forensics.** `git log -S"case 'ptah_browser_navigate'" -- protocol-dispatcher.ts` → single hit,
`9beb66e4e` (2026-05-24, "Feature/ptah app mcp task 2026 128 (#298)"). No commit since.

**Root cause.** N/A — works as specified.

**Verdict.** Works. Priority: n/a (no fix needed).

---

## 2. `ptah_browser_content`

**Contract** (`tool-description.builder.ts:1147-1166`):
> "Read the current page content. Returns both HTML and extracted text. Optionally scope to a specific element via
> CSS selector." (:1150-1153)

**Live behaviour.** `ptah_browser_content()` on example.com → 852 chars total (Text 118 chars + HTML 622 chars +
markdown chrome). Matches a plain `curl https://example.com` (1,256-byte canonical HTML) closely — the HTML
returned is the live-DOM serialization (slightly reformatted, `<link rel="icon" href="data:,">` etc. present),
content is correct and complete, well under the cap.

**Code path.** Dispatch `protocol-dispatcher.ts:1333-1344` → `formatBrowserContent`
(`mcp-response-formatter.ts:1133-1163`). `MAX_TEXT_LENGTH = 32 * 1024` at **:1142** truncates `text` and `html`
independently at 32KB each with a `[...truncated]` marker (:1143-1151). This is the one formatter the task brief
names as already capped, confirmed.

**Regression forensics.** `git log -S"MAX_TEXT_LENGTH" -- mcp-response-formatter.ts` → single hit, `9beb66e4e`
(2026-05-24). Cap has existed since the file's introduction; never modified.

**Root cause.** N/A — this tool already implements the pattern the other two need.

**Fix design.** None needed. (Only enhancement, out of scope for a bugfix: a `maxChars` param so callers can ask
for less than 32KB up front, mirrored on `evaluate` per §4.)

**Regression guard.** Already exists: `mcp-response-formatter.spec.ts:578`
`'formatBrowserContent truncates text longer than 32KB with a marker'`.

**Verdict.** Works. Priority: n/a.

---

## 3. `ptah_browser_screenshot`

**Contract** (`tool-description.builder.ts:1028-1064`):
> "Take a screenshot of the current browser page. Returns the image as base64-encoded data. Optionally saves the
> screenshot to disk in the workspace." (:1031-1034). `saveTo` description (:1053-1058): "Save screenshot to disk
> ... Omit to return base64 data only without saving" — i.e. the contract frames `saveTo` as an *alternative* to
> inlining, but the code never treats it that way (see Code path).

**Live behaviour.**
- Default params (`format:"png"`, no `quality`, `fullPage:false`, viewport 1920x1080, visible/non-headless
  session) → **the call timed out** on the first attempt (client-side tool timeout, "The operation timed out").
  `ptah_browser_status` immediately after showed the session still alive and connected, so the browser itself did
  not crash — the screenshot round trip (CDP capture + PNG encode + full-resolution base64 transmit) simply ran
  long enough to exceed the caller's timeout budget.
- Retried as `{format:"jpeg", quality:40}` → succeeded, returned an MCP `image` content block (rendered visually
  by this client, not counted as raw text) plus a one-line text summary `Screenshot captured (jpeg, ~18KB)`.
- The 18KB figure is `data.length*3/4/1024` (base64→bytes) computed at `protocol-dispatcher.ts:1214` and again at
  `mcp-response-formatter.ts:1039` — both un-capped estimates of an un-capped payload.

**Code path.** `protocol-dispatcher.ts:1152-1225`:
- :1159-1163 calls `ptahAPI.browser.screenshot({format, quality, fullPage})` — no size ceiling requested.
- :1164-1186 — if `saveTo` is set, writes the PNG/JPEG bytes to disk (`filePath` attached), but this is **additive,
  not a substitute**: nothing below skips inlining once a file is saved.
- :1187-1218 — whenever `screenshotResult.data` is non-empty, the JSON-RPC result **always** includes
  `{type:'image', data: screenshotResult.data, mimeType}` (:1206-1211) with **no length check anywhere in this
  branch**, regardless of `saveTo`.
- :1195-1196 — `deps.onToolResult?.(id, formatBrowserScreenshot(screenshotResult), false)` additionally serializes
  the **same full base64 string a second time**, inline in a markdown code block
  (`mcp-response-formatter.ts:1028-1053`, no cap). This side channel feeds VS Code's webview stream only
  (`http-mcp-server.service.ts:570-576`, doc comment: "Used by agentic analysis to stream tool results to the
  frontend") — confirmed not part of the model-visible MCP response, so it does not add to the requesting agent's
  context, but it does mean every screenshot is base64-encoded and copied twice per call regardless of client.
- A client without native MCP `image` content-block rendering (e.g. a text-only CLI) has to fall back to
  serializing the whole `content` array as text, which puts the **entire uncapped base64 `data` field** into the
  model's context. This matches `mcp_surface.md:88` and `:126`: *"Codex ... browser_screenshot (average 117,442
  chars per call)"* — Codex's harness is exactly such a client.

**Regression forensics.** `git log -S"case 'ptah_browser_screenshot'"` and `git log -S"type: 'image'"` on
`protocol-dispatcher.ts` both return **only** `9beb66e4e` (2026-05-24, PR #298). `git log -L 1152,1225:...` shows
two earlier-looking hits (`80d26911d`, `2b537f44c`) but those predate the feature (2026-05-15/21, before browser
tools existed) — `git log -L`'s line-similarity tracker false-matched unrelated old code at the same line numbers;
the `-S` string-pickaxe search is authoritative and confirms no touch since introduction. **Not a regression** —
the tool has never had a size bound.

**Root cause.** The screenshot path was designed for a visual/multimodal client (renders the `image` block, pays
image tokens, never sees the base64 text) and never added a text-serialization fallback path or a size ceiling for
clients that can't render `image` blocks. `saveTo` was built as an add-on, not as a way to suppress inlining.

**Fix design (preserves quality: the full-resolution image is still produced and, when requested, saved to disk —
nothing about visual fidelity is reduced, only the default transport for non-rendering clients changes):**
1. When `saveTo` is supplied, **do not** attach the `image` content block by default; return only the file path,
   format, byte size and dimensions in the text summary (a new opt-in `inlineData:true` param restores today's
   behaviour for callers that need it in-band). File: `protocol-dispatcher.ts:1164-1218`.
2. When `saveTo` is omitted and the encoded payload exceeds a fixed ceiling (propose 200KB base64, ~150KB image),
   auto-save to `.ptah/screenshots/<timestamp>.<ext>` and return the path instead of inlining — same principle as
   Wave 1.2's proposed global result budget in the token audit, applied locally since P1/P2 there don't name
   browser tools. File: `protocol-dispatcher.ts:1187-1218`.
3. Default `format` to `jpeg` with `quality:60` instead of `png` when the caller does not specify a format, since
   JPEG at moderate quality is 5-10x smaller for photographic/rendered UI content and this tool's own contract
   already frames `quality` as ignorable "for jpeg/webp" (:1046) — i.e. the option exists but PNG's absence of a
   quality knob makes it the worse default for token cost. File: `tool-description.builder.ts:1038-1042`,
   `browser-namespace.builder.ts:276-286`.
4. Drop the always-on duplicate `formatBrowserScreenshot` call at `protocol-dispatcher.ts:1195-1196` for the
   success path (keep it for the error path only, where there is no image to render) — it currently re-encodes
   the identical uncapped base64 into a markdown code block on every successful screenshot for no consumer benefit
   beyond frontend streaming, which could instead receive the same `{filePath, sizeKB}` summary.

**Regression guard.** `mcp-response-formatter-extra.spec.ts:357-387` (`formatBrowserScreenshot` describe block)
currently only checks the error branch, the `filePath` line, and the "no Saved to" line — it has **no assertion on
output size**. Add: (a) a case with a `saveTo` result that asserts the returned image content block is absent /
the text is under N chars; (b) a case with a large synthetic base64 string that asserts the dispatch response (not
just the formatter) truncates or off-loads to disk above the ceiling. Natural home:
`mcp-response-formatter-extra.spec.ts` (formatter-level) plus `protocol-dispatcher.spec.ts` (dispatch-level, since
the inlining decision is made in the dispatcher, not the formatter).

**Verdict.** **Degraded** for non-vision clients (Codex measured at avg 117,442 chars/call, `mcp_surface.md:88`);
**works** for vision-capable clients that render the `image` block, modulo the default-PNG timeout risk observed
live. Priority: **P1**. Usage is not the audit's largest tool by call count (browser tools are a small slice of
the measured 542 Codex / 1,002 Claude ptah calls, and `mcp_surface.md` gives no explicit screenshot call count —
say so rather than infer one), but the **per-call cost is the single largest measured ptah payload after
`get_diagnostics`/`get_symbol_index`/`task_list`**, so each use is expensive even though use is rare.

---

## 4. `ptah_browser_evaluate`

**Contract** (`tool-description.builder.ts:1070-1089`):
> "Execute JavaScript in the browser page context. Returns the result value and type. ... Max expression size:
> 64KB." (:1073-1076) — the 64KB limit is documented and enforced **only for the input expression**; the contract
> makes no claim about output size, and none is enforced.

**Live behaviour.** `ptah_browser_evaluate({expression:"document.title"})` → 92 chars, correct
(`Type: string`, `Value: Example Domain`). Example.com is too small to demonstrate the unbounded-output risk
live without fetching a large page (out of scope per instructions), so this is confirmed by code inspection
instead (below), consistent with the measured `context_enrich_file`-style "no cap" pattern the audit already
found elsewhere in this server (`mcp_surface.md` §2, `context_enrich_file` row).

**Code path.**
- `browser-namespace.builder.ts:288-309` enforces `MAX_EXPRESSION_LENGTH = 64 * 1024` (:145) on the **input**
  only; the returned `value` from `capabilities.evaluate()` is passed straight through with no size check.
- `electron-browser-capabilities.ts:140-153+` (`evaluate()`) calls CDP `Runtime.evaluate` with
  `returnByValue:true` and returns whatever value comes back — no truncation.
- `mcp-response-formatter.ts:1058-1087` (`formatBrowserEvaluate`) — `JSON.stringify(result.value, null, 2)` for
  objects, `String(result.value)` for primitives, with **no length cap anywhere in the function**.
- This means `ptah_browser_evaluate({expression:"document.documentElement.outerHTML"})` returns the entire page
  HTML with **no truncation**, bypassing `formatBrowserContent`'s 32KB cap (§2) entirely through a different tool.

**Regression forensics.** `git log -S"formatBrowserEvaluate" -- mcp-response-formatter.ts` → single hit,
`9beb66e4e` (2026-05-24). Never touched since. **Not a regression — the cap never existed.**

**Root cause.** Same asymmetric-design gap as screenshot: the formatter was written per-tool with no shared
size-budget helper, and `evaluate`'s open-ended nature (arbitrary JS, arbitrary return shape) was never given the
truncation that `content` got for the same underlying data (page HTML/text).

**Fix design (preserves quality: evaluate remains a general JS-execution tool for any expression; only the
rendering of an oversized *result* changes, which is exactly the same trade `content` already makes safely):**
Apply the same `MAX_TEXT_LENGTH`-style budget used in `formatBrowserContent` (propose reusing the same 32KB
constant, or a smaller 8-16KB budget matching the token audit's Wave 1.2 proposal) to the stringified value in
`formatBrowserEvaluate` (`mcp-response-formatter.ts:1068-1071`), with a `[...truncated: N more chars]` trailer and
a one-line hint: "for full page content use ptah_browser_content with a selector." This closes the
content-cap bypass without limiting what expressions can be evaluated.

**Regression guard.** `mcp-response-formatter-extra.spec.ts:417-424`
(`'renders long primitive as code block'`) currently does `const longStr = 'x'.repeat(150); ...
expect(out).toContain(longStr)` — this test **actively pins the uncapped behaviour** and will need to be rewritten
(assert truncation above the new budget) as part of any fix, not just extended. Add a second case with a
value far larger than the new cap (e.g. 100KB) asserting the trailer appears and the raw string does not.

**Verdict.** **Degraded** (silent, unbounded, and doubles as an unintended bypass of `content`'s cap). Priority:
**P1** — same reasoning as screenshot: low call volume in the audit (browser tools are a small fraction of the
542/1,002 measured ptah calls; no per-tool `evaluate` count is given in `mcp_surface.md`, so this is stated as a
risk rather than a measured share), but unbounded per-call cost once an agent uses `evaluate` to read page state,
which is a very natural thing to do for anyone doing browser-driven verification work.

---

## 5. `ptah_browser_network`

**Contract** (`tool-description.builder.ts:1172-1190`):
> "Read captured network requests ... Returns URL, method, status, type, and size for each request." `limit`:
> "Maximum number of requests to return (default: 50, max: 500)" (:1181-1185).

**Live behaviour.** `ptah_browser_network()` after loading example.com (1 request) → 197 chars, one table row,
matches the actual single document request. Correct.

**Code path.** Dispatch `protocol-dispatcher.ts:1345-1356` → `formatBrowserNetwork`
(`mcp-response-formatter.ts:1168-1205`); per-URL truncation to 80 chars at :1189. Entry count is bounded upstream
by the capability layer, **not** by the formatter or the `limit` param alone:
`electron-browser-capabilities.ts:32` and `chrome-launcher-browser-capabilities.ts:42` both define
`MAX_NETWORK_ENTRIES = 500`, enforced at capture time (`electron-browser-capabilities.ts:487-489`,
`chrome-launcher-browser-capabilities.ts:484-486`, ring-buffer slice) and again at read time
(`:306-308`/`:304-306`, `entries.slice(-Math.min(limit, MAX_NETWORK_ENTRIES))`). The contract's "max: 500" is
real and enforced in two places, not just documented.

**Regression forensics.** `git log -S"MAX_NETWORK_ENTRIES"` on both capability files → single hit each,
introduced with the browser feature. Unchanged since.

**Root cause.** N/A — this tool is already correctly bounded end-to-end (worst case ≈500 rows × ~150 chars ≈
75KB, acceptable and far below screenshot/evaluate's exposure).

**Fix design.** None required.

**Regression guard.** None found for the 500-cap specifically; low priority to add given the tool already behaves
correctly and is cheap even unbounded-by-formatter.

**Verdict.** Works. Priority: n/a.

---

## 6. `ptah_browser_click` / `ptah_browser_type` / `ptah_browser_status` / `ptah_browser_close`

**Contract:** click (`:1095-1113`) and type (`:1119-1141`) return success/failure only; status (`:1213-1226`) and
close (`:1196-1207`) return small fixed-shape summaries.

**Live behaviour.** `ptah_browser_status()` (before and after navigation) and `ptah_browser_close()` both matched
contract exactly (40-260 chars). Click/type were not exercised live (instructions say do not submit forms or log
in anywhere, and example.com has no interactive elements to click/type into without navigating elsewhere) —
verified by code inspection only: `formatBrowserClick`/`formatBrowserType`
(`mcp-response-formatter.ts:1092-1127`) return one fixed line each, no cap needed, nothing to degrade.

**Regression forensics.** All four formatters trace to `9beb66e4e` only, untouched since.

**Verdict.** Works (status, close — measured live) / works by inspection (click, type — not exercised, output
shape is fixed and trivially small so there is no plausible size-degradation path). Priority: n/a.

---

## 7. `ptah_browser_record_start` / `ptah_browser_record_stop`

**Contract** (`tool-description.builder.ts:1232-1271`): start records CDP screencast frames into a ring buffer
(`maxFrames` default 500, ~2.5 min); stop assembles a GIF and returns `filePath, frameCount, durationMs,
fileSizeBytes` plus a `truncated` flag if the ring buffer wrapped.

**Live behaviour.** Not exercised live — starting a 2.5-minute recording is out of scope for a bounded token-audit
pass on a static page and would not exercise anything the code doesn't already show. Verified by code inspection.

**Code path.** `formatBrowserRecordStart`/`formatBrowserRecordStop`
(`mcp-response-formatter.ts:1273-1330`) return **only metadata** (no inline frame data, no base64) — this is the
opposite pattern from screenshot: the actual binary artifact never touches the response text, and an explicit
`truncated` warning already tells the caller when the ring buffer capped the recording (:1321-1324). This is the
correct pattern the fix for screenshot should imitate.

**Regression forensics.** `9beb66e4e` only, untouched since.

**Root cause.** N/A.

**Fix design.** None needed — cite as the reference pattern for the screenshot fix (§3).

**Verdict.** Works (by inspection). Priority: n/a.

---

## Table

| tool | verdict | root cause (one line) | regressing commit | fix (one line) | guard | priority |
|---|---|---|---|---|---|---|
| ptah_browser_navigate | works | n/a | n/a (9beb66e4e, unchanged) | none | n/a | n/a |
| ptah_browser_content | works | n/a — already capped | n/a (9beb66e4e, unchanged) | none | mcp-response-formatter.spec.ts:578 (exists) | n/a |
| ptah_browser_screenshot | degraded | shipped with no output cap on the `image` block or the duplicate base64 text path; never fixed | none — never regressed, never capped since 9beb66e4e (2026-05-24) | skip inlining when `saveTo` set; auto-offload above a size ceiling; default jpeg/quality; drop the duplicate onToolResult re-encode | new size-assertion cases in mcp-response-formatter-extra.spec.ts + protocol-dispatcher.spec.ts | P1 |
| ptah_browser_evaluate | degraded | result stringification has no size cap; also bypasses content's 32KB cap | none — never regressed, never capped since 9beb66e4e | apply the same 32KB-style budget used in formatBrowserContent to the stringified value | rewrite mcp-response-formatter-extra.spec.ts:417-424 (currently pins unbounded output) + add an over-cap case | P1 |
| ptah_browser_network | works | n/a — capped in capability layer (MAX_NETWORK_ENTRIES=500) at capture and read time | n/a (9beb66e4e, unchanged) | none | none found; low priority to add | n/a |
| ptah_browser_click | works | n/a | n/a (9beb66e4e, unchanged) | none | n/a | n/a |
| ptah_browser_type | works | n/a | n/a (9beb66e4e, unchanged) | none | n/a | n/a |
| ptah_browser_status | works (measured live) | n/a | n/a (9beb66e4e, unchanged) | none | n/a | n/a |
| ptah_browser_close | works (measured live) | n/a | n/a (9beb66e4e, unchanged) | none | n/a | n/a |
| ptah_browser_record_start | works (by inspection) | n/a | n/a (9beb66e4e, unchanged) | none — reference pattern for screenshot fix | n/a | n/a |
| ptah_browser_record_stop | works (by inspection) | n/a | n/a (9beb66e4e, unchanged) | none — reference pattern for screenshot fix | n/a | n/a |
