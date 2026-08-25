# Units 7 + 8 — closing report for TASK_2026_187

**Headline**: **Unit 7 LANDED** (not dropped). **Unit 8 LANDED.** Final initial total
**2,200,514 B / 467.90 kB**. Build is **green with zero budget warnings of any kind** —
initial-bundle _and_ component-style. `maximumError` reads `"3.5mb"`.

The only warnings left in the build are the three `@xterm/* is not ESM` notices, which
I-7 mandates be left unactioned.

**Nothing committed.** No file on the I-8 DO-NOT-TOUCH list was modified. TASK_2026_196 was
not touched.

---

## 1. Unit 7 — `message-bubble.component.css`

### What I did

Sibling-stylesheet split, as the batch prompt preferred. **No rule was moved to
`apps/ptah-extension-webview/src/styles.css`** — moving a `:host ::ng-deep` rule to a global
sheet strips its `[_nghost-*]` prefix and would let selectors like `markdown p` match outside
the bubble. That risk was not worth 977 bytes, so the global route was rejected outright.

| File                                                                                 | Action                                                                               |                                           Bytes |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------: |
| `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.css`       | truncated to the head of the original                                                |                              17,892 → **9,495** |
| `libs/frontend/chat/src/lib/components/organisms/message-bubble-prose.component.css` | **CREATED** — the verbatim tail                                                      | **9,183** (8,397 CSS + 786 B of header comment) |
| `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts`        | `styleUrl` → `styleUrls: [...]`, plus a comment recording that order is load-bearing |                                        +9 lines |

### The split point

A **single byte boundary**, immediately before the `Callout Cards` section header (source line
369). Nothing was rewritten, reordered, reformatted, merged or deleted.

- **Part 1** (lines 1–368) — `:host` `content-visibility` rules, the collapse-grid transition,
  the `bubbleFadeIn`/`bubbleFadeOut` keyframes, the reduced-motion block, and every
  `markdown <element>` rule (p, strong, code, pre, h1–h6, blockquote, ul/ol, hr, a, table, img).
- **Part 2** (lines 369–702) — `.callout*`, `.code-block-*`, `.code-lang-badge`,
  `.prose-divider*`, `.prose-heading-*`, `.prose-list-card*`, the enhanced-table addenda, and
  `.streaming-avatar-glow` + `avatar-ring-pulse`.

Part 2 **must stay second in `styleUrls`** and the component now says so in a comment. Three
rules in part 2 deliberately override part 1 by source order: `.code-block-container pre` over
`markdown pre`, `markdown table { border-top }` over the base `markdown table` block, and
`markdown tr:nth-child(even) td` over the `tr:last-child` / `tr:hover` rules. No rule in part 1
depends on following anything in part 2, so a single-point split in this direction is safe.

### Proof that rendering is unchanged — measured, not argued

I did not want to hand back an argument on the most-seen surface in the product, so I built
**both** versions and diffed the emitted CSS.

**(a) Source is byte-identical.** Part 1 + part 2 (minus the 786 B documentation comment I
added) reconstitutes `git show HEAD:message-bubble.component.css` exactly:

```
HEAD bytes     : 17892
partA bytes    : 9495
partB bytes    : 9183 (header comment: 786 bytes)
rejoined bytes : 17892
BYTE-IDENTICAL TO HEAD: true
```

**(b) Emitted CSS is byte-identical.** I temporarily restored the pre-split single file, ran a
full production build, extracted the compiled component CSS out of the chunk, restored the
split, rebuilt, and extracted again. The **entire** difference between the two bundles is three
characters at the split point — the JS array separator between the two style strings:

```
single: ...img:not([height]){aspect-ratio:16 / 9}[_nghost-%COMP%]     .callout{border-left...
split : ...img:not([height]){aspect-ratio:16 / 9}','[_nghost-%COMP%]     .callout{border-left...
                                                 ^^^
```

Removing that 3-char separator makes the split build's CSS **string-equal** to the single-file
build's (10,313 bytes both):

```
split minus the 3-char array separator: 10313 bytes
IDENTICAL TO SINGLE-FILE BUILD: true
```

Both halves compile to the **same** `[_nghost-%COMP%]` placeholder, i.e. the same component id
at runtime — encapsulation is preserved, which is exactly what the `styles.css` route would
have destroyed. Two adjacent `<style>` elements, same order, same specificity, same selectors:
the computed cascade cannot differ.

### What I verified vs. what I did not

- **Verified**: emitted CSS byte-equality (above); `nx test chat` 53 suites / 705 passed,
  2 skipped — unchanged from the recorded baseline; typecheck and lint green; the component
  budget warning is gone from the build output.
- **NOT verified**: nothing rendered was looked at. There is no visual/pixel check here, and
  `nx test chat` covers `message-bubble` behaviour, not appearance. I consider the byte-equality
  proof strictly stronger than a screenshot for this particular change — the shipped CSS is
  provably the same bytes — but the honest statement is that **no human saw a message bubble
  during this unit**, and Task 5.3's manual gate still owns that.

### Isolated cost of Unit 7: **+3 bytes**

Measured, not estimated, by building both states back to back on the same tree:

| Build                                    |               Initial total | Component-style warning                              |
| ---------------------------------------- | --------------------------: | ---------------------------------------------------- |
| Pre-split (single file, `git show HEAD`) | **2,200,511 B** / 468.06 kB | ⚠️ _"not met by 977 bytes with a total of 10.98 kB"_ |
| Post-split (shipped)                     | **2,200,514 B** / 467.90 kB | ✅ **none**                                          |

The +3 B is the `','` separator itself and nothing else. It also settles a loose end: the
pre-split build reproduced the team-leader's **2,200,511 B** figure _exactly_, so the concurrent
session's commits between that measurement and this one moved the webview bundle by **zero**
bytes. The 977-byte overage was bought out for 3 bytes.

---

## 2. Unit 8 — `maximumError` restored

`apps/ptah-extension-webview/project.json`, `budgets[0]`:

```jsonc
{ "type": "initial", "maximumWarning": "2.5mb", "maximumError": "3.5mb" }
```

`"4mb"` → `"3.5mb"`. Confirmed on disk:

```
"maximumWarning": "2.5mb"
"maximumError": "3.5mb"      ← initial
"maximumWarning": "10kb"
"maximumError": "20kb"       ← anyComponentStyle, UNCHANGED (not raised)
```

### Graph refresh — `nx reset` failed exactly as R12a predicted

```
 NX   Resetting the Nx cache and stopping the daemon.
 NX   Failed to reset the Nx workspace.
Failed to clean up the workspace data directory.
Error: EPERM, Permission denied: \\?\D:\projects\ptah-extension\.nx\workspace-data
```

Exit code 1. Not retried — R12a is explicit that retrying does not help. Applied the Unit 9
substitute instead: deleted the four graph artifacts inside `.nx/workspace-data` directly.

```
deleted: project-graph.json
deleted: file-map.json
deleted: source-maps.json
deleted: nx_files.nxt
created .nx/cache/terminalOutputs
```

`.nx/cache/terminalOutputs` was created pre-emptively per R12a even though I am not committing.

**The graph refresh was verified, not assumed.** Before building, `npx nx show project
ptah-extension-webview --json` was read back off the **recomputed** graph:

```json
"budgets":[{"type":"initial","maximumWarning":"2.5mb","maximumError":"3.5mb"},
           {"type":"anyComponentStyle","maximumWarning":"10kb","maximumError":"20kb"}]
```

The graph carries `3.5mb`. F-11 is closed on evidence — the final budget check did not validate
against a stale graph.

Then `npx nx build ptah-extension-webview --configuration=production` (no `--skip-nx-cache`,
per the mandated procedure). A further `--skip-nx-cache` build was run last, after restoring the
split from the isolation measurement, so the shipped tree state is the one that was built last.
All three builds produced identical chunk names, sizes and totals.

---

## 3. Final before/after chunk table

Baseline is the clean-tree `npx nx reset` measurement recorded in `tasks.md:162-176`.

### Initial chunks

| BEFORE (3,628,659 B) |           Raw |      Transfer |     | AFTER (2,200,514 B) |               Raw |      Transfer |
| -------------------- | ------------: | ------------: | --- | ------------------- | ----------------: | ------------: |
| `main.js`            |       1.90 MB |     353.23 kB |     | `chunk-N2CX72CB.js` |         675.43 kB |     127.42 kB |
| `chunk-HAMQW4KR.js`  |     685.72 kB |     136.22 kB |     | `chunk-BPMPN5B7.js` |         279.75 kB |      75.94 kB |
| `chunk-GZKAFEM7.js`  |     677.31 kB |     143.75 kB |     | `styles.css`        |         251.01 kB |      29.00 kB |
| `styles.css`         |     276.07 kB |      34.60 kB |     | `chunk-64AKWBGT.js` |         225.59 kB |      43.56 kB |
| `scripts.js`         |      48.20 kB |      14.01 kB |     | **`main.js`**       |     **186.88 kB** |  **44.08 kB** |
| `polyfills.js`       |      35.73 kB |      11.58 kB |     | `chunk-LFEJAX6B.js` |         146.81 kB |      36.22 kB |
| `chunk-6F4HVVOU.js`  |       1.38 kB |         601 B |     | `chunk-FO6Q67RH.js` |         111.77 kB |      21.22 kB |
|                      |               |               |     | `chunk-Z5YDQYTN.js` |          89.86 kB |      22.21 kB |
|                      |               |               |     | `scripts.js`        |          48.20 kB |      14.01 kB |
|                      |               |               |     | `chunk-Z2XOU7JQ.js` |          39.70 kB |       8.41 kB |
|                      |               |               |     | `polyfills.js`      |          35.73 kB |      11.58 kB |
|                      |               |               |     | `chunk-H2XNPZBG.js` |          30.77 kB |      10.67 kB |
|                      |               |               |     | `chunk-7U3HNK4S.js` |          23.59 kB |       7.06 kB |
|                      |               |               |     | `chunk-IQZSSOB5.js` |          18.42 kB |       6.54 kB |
|                      |               |               |     | `chunk-3CUXOTGX.js` |          16.40 kB |       3.69 kB |
|                      |               |               |     | `chunk-SGXTX6YD.js` |          15.74 kB |       4.13 kB |
|                      |               |               |     | `chunk-S27POIGU.js` |           2.81 kB |         884 B |
|                      |               |               |     | `chunk-6F4HVVOU.js` |           1.38 kB |         601 B |
|                      |               |               |     | `chunk-AJFZQ646.js` |             511 B |         511 B |
|                      |               |               |     | `chunk-Q77VTPPG.js` |             162 B |         162 B |
|                      |               |               |     | `chunk-JXTWWDFB.js` |               0 B |           0 B |
| **Initial total**    |   **3.63 MB** | **694.00 kB** |     | **Initial total**   |       **2.20 MB** | **467.90 kB** |
| _7 files_            | _3,628,659 B_ |               |     | _21 files_          | _**2,200,514 B**_ |               |

### Lazy chunks

| BEFORE              |          Raw |     Transfer |     | AFTER                                              |             Raw |    Transfer |
| ------------------- | -----------: | -----------: | --- | -------------------------------------------------- | --------------: | ----------: |
| `chunk-HG3P62SC.js` |      6.60 kB |      2.29 kB |     | `chunk-VW6SPXS5.js` (editor/xterm)                 |       539.41 kB |   101.14 kB |
| `chunk-EVUY35PO.js` |      1.13 kB |        420 B |     | `chunk-7H7K7SB7.js` (zod)                          |       311.94 kB |    51.88 kB |
| `chunk-FWCFY4EX.js` |        292 B |        292 B |     | `chunk-2UKG7KS5.js`                                |       302.61 kB |    57.89 kB |
|                     |              |              |     | `chunk-TBBOLVHM.js`                                |       122.90 kB |    26.69 kB |
|                     |              |              |     | `theme-extra.css` (daisyUI themes)                 |        52.97 kB |     6.06 kB |
|                     |              |              |     | `chunk-UOFIJKH4.js`                                |        52.26 kB |    11.25 kB |
|                     |              |              |     | `chunk-JDPQP3DC.js`                                |        46.31 kB |    11.68 kB |
|                     |              |              |     | `chunk-YPI6NWOJ.js`                                |        41.22 kB |     9.55 kB |
|                     |              |              |     | `chunk-BR3UW7BT.js`                                |        15.47 kB |     2.51 kB |
|                     |              |              |     | `chunk-HG3P62SC.js`                                |         6.60 kB |     2.29 kB |
|                     |              |              |     | `chunk-GZ6EKSRQ.js`                                |         5.00 kB |     1.77 kB |
|                     |              |              |     | `chunk-OOC73I7J.js` (`services`)                   |           336 B |       336 B |
|                     |              |              |     | `chunk-KOCWNZVU.js` (`metadata-patch-schema-lazy`) |           129 B |       129 B |
| **Lazy total**      | **~8.02 kB** | **~3.00 kB** |     | **Lazy total**                                     | **1,497,165 B** | **~283 kB** |
| _3 files_           |              |              |     | _13 files_                                         |                 |             |

### Totals

|                                               |                       Bytes |                  Transfer |
| --------------------------------------------- | --------------------------: | ------------------------: |
| Initial BEFORE                                |                   3,628,659 |                 694.00 kB |
| Initial AFTER                                 |               **2,200,514** |             **467.90 kB** |
| **Delta**                                     | **−1,428,145 B (−39.36 %)** | **−226.10 kB (−32.58 %)** |
| Headroom under the 2,500,000 B warning        |               **299,486 B** |                           |
| Headroom under the restored 3,500,000 B error |             **1,299,486 B** |                           |
| Lazy BEFORE → AFTER                           |   8,022 B → **1,497,165 B** |                      ×186 |

The proportion of the app that is deferred went from **0.22 %** to **40.5 %**. That inversion —
not the raw byte count — is the finding `context.md` opened with (_"Under 8 kB of a 3.63 MB
application is deferred. That is the finding."_).

### I-4 — `main.js` transfer trace

|           |                   Raw |                 Transfer |
| --------- | --------------------: | -----------------------: |
| Baseline  | 1.90 MB (1,904,251 B) |                353.23 kB |
| **Final** |         **186,883 B** |             **44.08 kB** |
| Delta     |      **−1,717,368 B** | **−309.15 kB (−87.5 %)** |

I-4 required only that `main.js` never _grow_. It fell to an eighth of its transfer size.

### R7 — `modulepreload` diff

**No new `modulepreload` entries versus the previous batch, and no lazy chunk is preloaded.**
`index.html` carries **10** `modulepreload` links; every one resolves to a file on the
**initial** list above:

```
chunk-Z5YDQYTN.js  chunk-7U3HNK4S.js  chunk-Q77VTPPG.js  chunk-SGXTX6YD.js  chunk-JXTWWDFB.js
chunk-Z2XOU7JQ.js  chunk-AJFZQ646.js  chunk-3CUXOTGX.js  chunk-N2CX72CB.js  chunk-FO6Q67RH.js
```

Zero of the 13 lazy chunks appear. `theme-extra.css` retains its inert Unit 9 marker —
`<link id="ptah-theme-extra" rel="ptah-deferred-stylesheet" href="theme-extra.css"/>` — which is
not a `stylesheet`, `preload` or `modulepreload` rel and so is not fetched by the browser.

Neither Unit 7 nor Unit 8 can move this list: one is CSS-only inside an already-initial chunk,
the other is a budget threshold.

---

## 4. Final build output — verbatim

```
Initial total   |   2.20 MB |  467.90 kB
Application bundle generation complete. [19.688 seconds] - 2026-08-10T01:11:52.636Z
▲ [WARNING] Module '@xterm/xterm' used by 'libs/frontend/editor/src/lib/terminal/terminal.component.ts' is not ESM
  CommonJS or AMD dependencies can cause optimization bailouts.
▲ [WARNING] Module '@xterm/addon-fit' used by 'libs/frontend/editor/src/lib/terminal/terminal.component.ts' is not ESM
  CommonJS or AMD dependencies can cause optimization bailouts.
▲ [WARNING] Module '@xterm/addon-webgl' used by 'libs/frontend/editor/src/lib/terminal/terminal.component.ts' is not ESM
  CommonJS or AMD dependencies can cause optimization bailouts.
Output location: D:\projects\ptah-extension\dist\apps\ptah-extension-webview

 NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

**Budget warnings remaining: ZERO.** Not the initial-bundle one, not the component-style one.
I-9 is satisfied in its strict reading _and_ in the broader one the batch prompt hoped for.

The three `@xterm/*` notices are **I-7** — explicitly not to be chased, emitted for CJS interop
regardless of chunk placement, and now costing nothing because the module lives in a lazy chunk
(`chunk-VW6SPXS5.js`). No `allowedCommonJsDependencies` was added; `terminal.component.ts` is
untouched.

---

## 5. `maximumError` confirmation

`apps/ptah-extension-webview/project.json` `budgets[0].maximumError` = **`"3.5mb"`**.

Confirmed twice: read back off disk, and read back off the **recomputed Nx project graph** via
`nx show project`. `budgets[1]` (`anyComponentStyle`) is untouched at 10 kb / 20 kb — the
component-style warning was silenced by splitting the file, never by raising the budget.

---

## 6. Tree stability during these units

Checked by **mtime**, not `git status` letters, as instructed.

|                                                                      | Local time   |
| -------------------------------------------------------------------- | ------------ |
| Last write by the concurrent session (TASK_2026_197 `output-styles`) | **03:54:17** |
| My first edit                                                        | 04:02:26     |
| My last edit                                                         | 04:06:26     |
| Report written                                                       | ~04:12       |

**Files modified by anyone other than me between 04:02 and 04:12: 0.** The tree did **not**
shift mid-unit.

The concurrent session was active earlier in the evening (00:55 → 03:54, ~110 files across
`libs/backend/output-styles/**`, `libs/shared/src/lib/types/**`, `rpc-handlers`,
`chat/src/lib/settings/output-style/**`), but it went quiet eight minutes before I started and
stayed quiet throughout. Independent corroboration: my pre-split control build reproduced the
team-leader's 2,200,511 B **exactly**, which it could not have done if their work had landed
webview bytes in between.

My four touched files:

```
04:02:26  libs/frontend/chat/src/lib/components/organisms/message-bubble.component.css
04:02:37  libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts
04:02:45  libs/frontend/chat/src/lib/components/organisms/message-bubble-prose.component.css
04:06:26  apps/ptah-extension-webview/project.json
```

Nothing else. All scratch files used for the isolation measurement were deleted.

---

## 7. Tests, typecheck, lint

| Gate      | Command                                                                       | Result                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests     | `npx nx test chat --skip-nx-cache`                                            | ✅ **53 suites / 705 passed, 2 skipped** (707 total) — identical to the figure the team-leader recorded pre-Unit-7                              |
| Typecheck | `npx nx run-many -t typecheck -p chat,ptah-extension-webview --skip-nx-cache` | ✅ **2/2 projects**, 0 errors                                                                                                                   |
| Lint      | `npx nx lint chat --skip-nx-cache`                                            | ✅ **0 errors**, 13 warnings — all pre-existing (`no-non-null-assertion`, `no-empty-function`, an unused test helper); none in a file I touched |
| Build     | `npx nx build ptah-extension-webview --configuration=production`              | ✅ green, zero budget warnings                                                                                                                  |

Scope note: I ran the projects Units 7 and 8 actually touch. The **workspace-wide** typecheck
(89/89) and the wider `core` / `shared` / `tasks-ui` / `ptah-extension-webview` test suites were
run by the team-leader on this same tree during the Units 9 + 10 verification and are recorded
in `tasks.md:1285-1291`; nothing in Units 7 or 8 can affect them — one change is a CSS file
split with byte-identical output, the other is a build-time threshold.

---

## 8. Constraints honoured

| Constraint                                      | Status                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| I-8 DO-NOT-TOUCH list (5 paths)                 | ✅ none modified                                                     |
| I-5 Monaco                                      | ✅ untouched — no `provideMonacoEditor` change, no asset-glob change |
| I-7 xterm CJS warnings                          | ✅ unactioned, as required                                           |
| `anyComponentStyle` budget not raised           | ✅ still 10 kb / 20 kb                                               |
| No global-stylesheet relocation of scoped rules | ✅ rejected by design; encapsulation preserved                       |
| I-6 / R13 graph refresh before the budget check | ✅ performed **and verified** via `nx show project`                  |
| Unit 8 last                                     | ✅                                                                   |
| No commit                                       | ✅ nothing staged, nothing committed                                 |
| TASK_2026_196                                   | ✅ not touched                                                       |

---

## 9. Outstanding — for the team-leader, not for me

1. **`tasks.md` statuses not edited.** Task 5.2 still reads `⏸️ PENDING` and Task 5.4
   `⏸️ PENDING — NOW UNBLOCKED`. I left the carrier alone rather than race the concurrent
   session in a file it also has dirty. Both are now implemented and verified; 5.2's outcome is
   **landed**, not skipped.
2. **Task 5.3 (full regression gate) is still open** and is the right owner of everything I
   could not verify: chat TTI, the Monaco add/remove highlighting re-check (I-5 / R1), every
   deferred surface opening, the `@else` spinners under throttling, the Unit 9 theme-switch
   triad, and — new from this unit — **a human looking at a message bubble** with markdown,
   a code block, a callout, a table and a streaming avatar in view. The byte-equality proof in
   §1 makes a regression very hard to construct, but it is not a pair of eyes.
3. **`nx reset` is now 3-for-3 broken on this machine** (Batch 1 ×2, Unit 9, Unit 8). R12a's
   direct-delete substitute is 2-for-2. Worth promoting from a risk-row footnote to the
   standing procedure for any `project.json` edit in this repo.
