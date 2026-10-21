# Code Logic Review — `TASK_2026_710` (frontend)

Review family: grok reviewing Glm (B7) and codex (B8, B11)

Scope: uncommitted frontend for HTML artifacts. Read in full: `artifact-card.component.ts`, `artifact-viewer.component.ts`, `artifact-theme-bridge.service.ts`, `artifacts/index.ts`, `artifact.store.ts`, `artifact-message-handler.service.ts`, `tool-call-item.component.ts`, `display-sheet.component.ts`, `display-dock.state.ts` (`openArtifact` and selection equality), `artifact.schemas.ts`, and the artifact branch of `display-panel.component.ts` (template loop through `activeKey` / `sameSeq`). Wiring checked at `apps/ptah-extension-webview/src/app/app.config.ts`. Host list/session behaviour read only to explain the frontend call (`artifact-rpc.handlers.ts`, `session-lifecycle-manager.ts`). Batch reports 7, 8 and 11 and `context.md` were read. No style-only findings. Diagnostics, tests, typecheck and build were not run: this lane was told not to run heavy checks, and the `ptah_*` tool server was not connected.

## Summary

| Metric              | Value |
| ------------------- | ----- |
| Overall score       | 5/10 |
| Assessment          | NEEDS_REVISION (REVISE) |
| Blocking issues     | 1 |
| Serious issues      | 2 |
| Moderate issues     | 3 |
| Failure modes found | 6 |

The per-frame gates are real: sandbox is exactly `allow-scripts`, `bypassSecurityTrustResourceUrl` runs only after `VIEWER_URL_PATTERN`, incoming messages need `event.source`, `ArtifactPageToHostMessageSchema`, and the current nonce, and the card template contains no iframe. That is why this is not a 3–4. It is not a 6: the display sheet mounts one live scripted frame per artifact and keeps those frames after the sheet collapses, which breaks the single-viewer rule the feature is built on, and two likely user actions (Escape, in-page link) do something other than what the controls say.

## Five logic questions

### 1. How does this fail silently?

- `artifacts:list` failure, an invalid payload, or a thrown RPC leaves the previous map in place and writes only `console.warn` (`artifact.store.ts:52-68`). The sheet and the card keep showing stale metadata, or nothing, with no error in the UI.
- A publish whose tool row is `complete` but whose id is not in the store renders no card and no explanation (`tool-call-item.component.ts:150-164`).
- `artifacts:openLink` returning `opened !== true`, or rejecting, is `console.warn` only (`display-sheet.component.ts:207-216`). The page looks as if the click was ignored.
- `ArtifactThemeMessageSchema.safeParse` failure returns without posting (`artifact-theme-bridge.service.ts:145-146`). One computed value longer than 200 characters drops the whole theme; the frame stays on its unthemed first paint.
- `onFrameLoad` clears the load timer before it knows `contentWindow` exists (`artifact-viewer.component.ts:279-282`). A null window leaves a blank 160px frame and never reaches the error state.

### 2. What user action produces unexpected behaviour?

- Opening the display when the session has more than one artifact runs every artifact's scripts, not only the selected strip item (`display-panel.component.ts:220-246`). `[hidden]` does not destroy the component or the iframe.
- Collapsing the sheet hides the region but leaves it mounted (`display-sheet.component.ts:84-87` and `181`). Frames and `message` listeners stay attached.
- The card button labelled "Full screen" calls `openArtifact` and `DisplaySheetState.setMode(..., 'full')` (`tool-call-item.component.ts:104`, `167-171`). That is the sheet's chat-height mode (`display-sheet.component.ts:54-58`, `197`). It does not set `ArtifactViewerComponent.fullscreen`. The viewer's own dialog is a different control.
- Escape while that viewer dialog is open bubbles to the sheet region first (`display-sheet.component.ts:87`, `192-196`), which collapses the sheet, and only then hits the viewer's document listener (`artifact-viewer.component.ts:89-91`, `269-271`). The user leaves full screen and loses the panel. Focus inside the iframe does not see this key at all (opaque document).
- Open on a card whose record is not in this tab's session list still opens the dock (`tool-call-item.component.ts:167-171`, `display-dock.state.ts:167-171`). The panel then falls back to the first strip item (`display-panel.component.ts:362-368`).

### 3. What input data produces a wrong answer?

- `artifacts:list` is called with `{}` (`artifact.store.ts:51`). The host lists `getActiveSessionIds()[0]`, most recently active SDK session (`artifact-rpc.handlers.ts:52`, `session-lifecycle-manager.ts:554-558`). The frontend then keeps only rows whose `sessionId` equals the tab it asked for and writes that bucket (`artifact.store.ts:62-65`). It does not copy another session's rows onto this tab. A tab that is not the SDK's most recent session therefore gets an empty merge. After a reload, `recordById` misses and the card disappears.
- The card looks up by id across every session (`artifact.store.ts:34-39`). The sheet lists only `tab.claudeSessionId` (`display-sheet.component.ts:121-126`). A record stored under a different session id shows a card whose Open target is absent from the strip.
- Tool output that is neither a JSON string nor a `content[]` text part yields `null` (`tool-call-item.component.ts:153-164`). `status !== 'complete'` or `isError` also yields `null` (`152`). Error and in-progress rows correctly hide the card. A successful row with an unparsed result looks like a publish that never happened.
- The tool-name test is `/^(?:mcp__ptah__)?ptah_artifact_publish$/` (`152`). Names outside that pair never card.

### 4. What happens when a dependency fails?

- List RPC failure: see question 1. In-flight reloads are not cancelled. `merge` refuses an older revision (`artifact.store.ts:77-79`), so a late stale list does not downgrade a newer notification. It also never deletes an id the server no longer returns.
- Invalid `artifact:published` payload: warn and drop (`artifact-message-handler.service.ts:13-17`). The handler is registered (`app.config.ts:241`). A dropped notification plus a list that does not contain this tab's session leaves no record.
- Protocol load slower than 10s, or a load event that never fires: `loadFailed` becomes true, the iframe is removed from the template, and there is no retry (`artifact-viewer.component.ts:298-305`, `94-101`).
- `openLink` host failure: question 1. The viewer never calls `window.open`.
- Theme `postMessage` targetOrigin `'*'` (`artifact-theme-bridge.service.ts:147-151`) is aimed at `contentWindow` only. The opaque origin cannot be named. The nonce is the check on the way back (`artifact-viewer.component.ts:344-350`). That part holds.

### 5. What is missing that the requirements never mentioned?

- No user-visible error for list, notification, or open-link failure.
- No teardown of the frame when the sheet collapses or when the strip selection moves.
- The viewer's `fullscreen` input is never bound by the panel (`display-panel.component.ts:242-245`), so the card and the viewer dialog cannot stay in sync.
- The dialog sets `role="dialog"` and `aria-modal` (`artifact-viewer.component.ts:105-109`) and restores focus (`243-252`) but does not trap focus or mark the rest of the sheet `inert`.
- Session buckets in `records` are never dropped when a chat tab closes. Metadata only, capped at 200 per session (`artifact.store.ts:7`, `81-83`).

## Failure modes

### Every artifact in the sheet is a live frame

- Trigger: the sheet has been opened once and the session has two or more artifacts, or the user collapses the sheet after opening one.
- Symptom: unselected and collapsed artifacts keep executing under `sandbox="allow-scripts"`. Each has its own nonce and listener.
- Evidence: `display-panel.component.ts:220-246`; `display-sheet.component.ts:84-87`, `181`.
- Current handling: inactive tabpanels use `[hidden]`. Collapse sets `hidden` and `display: none` on an ancestor that stays in the DOM because `everOpened` is sticky.
- Recommendation: create `ptah-artifact-viewer` only for `activeKey`, and only while the sheet region is open. Destroying the component runs `ngOnDestroy` (`artifact-viewer.component.ts:257-262`), which is the path that actually drops the listener and the nonce.

### Escape closes the panel out from under the viewer dialog

- Trigger: focus is in the parent (the viewer's Full screen button) and the viewer overlay is active.
- Symptom: one Escape exits the dialog and collapses the display. The overlay cannot remain, because `hidden` on the section hides `position: fixed` descendants.
- Evidence: `artifact-viewer.component.ts:89-91`, `269-271`; `display-sheet.component.ts:87`, `192-196`.
- Current handling: the viewer does not stop the event. The sheet listener runs on the bubble path before the document listener.
- Recommendation: handle Escape in the capture phase on the dialog, call `stopPropagation`, and have the sheet ignore Escape whose target is inside `[role="dialog"]`.

### Open and in-page links can succeed in the code and fail on screen

- Trigger: card Open when `recordById` hits a record the tab's `artifacts()` computed does not contain; or a validated `open-link` whose RPC does not open.
- Symptom: the sheet shows some other strip item, or the click does nothing. No alert.
- Evidence: `artifact.store.ts:34-39`; `display-sheet.component.ts:121-126`, `207-216`; `tool-call-item.component.ts:167-171`; `display-panel.component.ts:362-368`.
- Current handling: selection is stored even when the key is absent. `activeKey` substitutes `items[0]`. Open-link failures are console warnings.
- Recommendation: if the selected id is not in this tab's records, show the viewer error state instead of another item. Surface a one-line failure when `opened` is not true.

### List reloads the wrong session and the UI treats that as an empty tab

- Trigger: `artifacts:list` with `{}` while this tab's `claudeSessionId` is not `getActiveSessionIds()[0]`, including a cold reload of an older tab.
- Symptom: cards vanish and the strip has no artifact items. Rows are not written onto the wrong tab: the filter drops them.
- Evidence: `artifact.store.ts:18-21`, `49-65`. Host side, not changed here: `artifact-rpc.handlers.ts:45-57`.
- Current handling: warn only when the RPC fails. A successful foreign snapshot merges as an empty addition.
- Recommendation: this is the known issue. Do not patch around it by deleting the filter. The contract has to carry the tab session id; until then the empty bucket is the honest result and the card should say the record is unavailable.

### Publish row with no matching record

- Trigger: tool status is not `complete`, `isError` is set, the tool name misses the regex, the output is not a JSON string or a text content block, or the store has no id.
- Symptom: no card. The expanded tool body may still show the raw result. Error and running states hide the card on purpose (`tool-call-item.component.ts:152`).
- Evidence: `tool-call-item.component.ts:150-164`.
- Current handling: `null` computed, `@if` removes the card.
- Recommendation: for a `complete` non-error publish whose id does not resolve, render the card shell with the title from the JSON when present and a "not loaded" line. Keep hiding error and in-progress rows.

### Theme or load failure looks like a blank artifact

- Trigger: a theme variable value longer than 200 characters, or `contentWindow` null on `load`, or load after the 10s timer.
- Symptom: unthemed page, or a short empty frame, or the title error with no retry.
- Evidence: `artifact-theme-bridge.service.ts:134-146`; `artifact-viewer.component.ts:279-305`.
- Current handling: silent return, or `loadFailed` with the title and no second attempt.
- Recommendation: skip over-long vars instead of failing the whole message. If `contentWindow` is missing, set `loadFailed`. Add a retry that re-arms `resetFrame`.

## Blocking issues

### More than one live iframe

- File: `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts:220-246` and `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts:84-87`, `181`
- Scenario: any opened display whose artifact list length is greater than one, and any later collapse of that sheet.
- Impact: the fixed rule is one sandboxed viewer. Each mounted viewer loads `ptah-artifact://…/index.html` with scripts. Unselected pages keep a bridge nonce and a window `message` listener. Collapse does not call `detach`.
- Fix: render the viewer only for the active artifact key, and only while the sheet is open. Cards already comply: `artifact-card.component.ts` has no iframe. Full screen on one viewer does not clone the iframe; `containerClass` only swaps classes (`artifact-viewer.component.ts:212-217`). The break is the `@for` plus `[hidden]`.

## Serious issues

### Escape collapses the sheet while a viewer dialog is open

- File: `artifact-viewer.component.ts:89-91`, `269-271`; `display-sheet.component.ts:87`, `192-196`
- Scenario: user turns on the viewer's Full screen control and presses Escape with focus outside the iframe.
- Impact: the dialog and the display both close. The component comment says Escape closes full screen and restores the opener (`artifact-viewer.component.ts:78-81`, `243-252`). The sheet handler wins the bubble order and never sees `defaultPrevented`.
- Fix: capture-phase handler on the dialog that stops propagation while `fullscreenActive()` is true. Sheet Escape should no-op when the event target is inside that dialog.

### Open and open-link fail without a visible result

- File: `tool-call-item.component.ts:167-171`; `display-panel.component.ts:362-368`; `display-sheet.component.ts:207-216`; `artifact.store.ts:34-39`; `display-sheet.component.ts:121-126`
- Scenario: the card's record is not in this tab's artifact array, or the main process declines `artifacts:openLink`.
- Impact: Open shows a different strip item. A link click in the page does nothing the user can see. Both look like success paths that dropped the outcome.
- Fix: bind the viewer to the selected record or show `artifact-viewer-error` when the id is missing. When `result.success` is false or `opened` is not true, set a short alert on the sheet.

## Moderate and minor issues

- Card "Full screen" is sheet height, not the viewer dialog. `tool-call-item.component.ts:104`, `167-171`. The panel never binds `[fullscreen]` (`display-panel.component.ts:242-245`). Batch 11 recorded this on purpose (`batch-11-report.md` decisions). It is still a defect against the button text and against `ArtifactCardComponent.fullscreen`, which the card comment describes as the full-screen viewer (`artifact-card.component.ts:23-24`, `84-85`). Relabel the card button to the sheet's Expand action, or pass `fullscreen` through to the one viewer. Not a second iframe.
- Complete publish with no store row is indistinguishable from "this tool is not an artifact" (`tool-call-item.component.ts:150-164`).
- List and notification failures are console-only (`artifact.store.ts:52-68`, `artifact-message-handler.service.ts:14-16`). A theme value over 200 characters drops the entire theme post (`artifact-theme-bridge.service.ts:145-146`).

## Data flow

1. Publish notification `{ type: 'artifact:published', payload }` reaches `ArtifactMessageHandler.handleMessage` (`artifact-message-handler.service.ts:11-18`). Schema failure stops the path. Success calls `upsert`, keyed by `record.sessionId` (`artifact.store.ts:42-46`). OK when the payload matches the tab session.
2. Active tab change runs `reload` (`artifact.store.ts:18-21`) which calls `artifacts:list` with `{}` (`51`). Gap: host session is not the tab session. Filter at `62-65` then stores an empty addition under the tab. Known issue. Not a cross-tab write.
3. Transcript card reads `recordById` (`tool-call-item.component.ts:150-164`). Gap: global id search versus the sheet's per-tab list.
4. Open calls `openArtifact` (`display-dock.state.ts:167-171`). The sheet maps that to `artifact:<id>` (`display-sheet.component.ts:146-148`). The panel renders every artifact viewer and hides the inactive ones (`display-panel.component.ts:220-246`). Gap: N live frames. Missing id falls through to `items[0]` (`362-368`).
5. Viewer checks `VIEWER_URL_PATTERN` (`artifact-viewer.component.ts:38`, `184-202`). Mismatch: error alert, no iframe. Match: `bypassSecurityTrustResourceUrl` on that string only. Sandbox attribute is the literal `allow-scripts` (`144`). No `innerHTML`, `srcdoc`, or `window.open` in the reviewed files.
6. `load` calls `attach`, which replaces the nonce (`artifact-theme-bridge.service.ts:101-104`) and posts theme to that window with `'*'` (`125-151`). `resetFrame` on `viewerUrl` change clears listener and nonce first (`artifact-viewer.component.ts:287-295`). A later message must match the new nonce (`344-350`). OK for one frame. Gap: hidden siblings each run this path, and sheet collapse does not.
7. `height` is schema-bounded to 160–1600 and throttled at 100ms with a trailing update (`361-380`). `open-link` emits to the sheet RPC (`357`, `display-sheet.component.ts:207-216`). Gap: RPC failure is invisible. Viewer full screen toggles classes on the same iframe (`212-217`). Gap: Escape also collapses the sheet.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Card is metadata only; one iframe lives in the viewer | PARTIAL | Card has no frame. The panel mounts one viewer per artifact and keeps them while collapsed |
| `sandbox="allow-scripts"` exactly, no `srcdoc` / `innerHTML` / `window.open` | COMPLETE | `artifact-viewer.component.ts:139-149`, `199-202`. Grep of the reviewed files found no `innerHTML`, `srcdoc`, or `window.open` call |
| `src` only after strict URL check; bypass only on that string | COMPLETE | `38`, `184-202`. Publisher ids are UUIDs, which match the pattern |
| Bridge: source, Zod, nonce; nonce per load; height clamp and throttle; theme allowlist | COMPLETE | For the attached frame. Stale nonce is cleared on src change and destroy. Not cleared on sheet collapse because the component is not destroyed |
| `postMessage` targetOrigin `'*'` justified | COMPLETE | `artifact-theme-bridge.service.ts:147-151` |
| Scripts, no network, minimal bridge | PARTIAL | Frontend sandbox does not block network. Network blocking is `ARTIFACT_CSP` on the protocol response (`artifact-protocol.ts:6-11`), which this review did not re-test. Extra live frames widen the script surface |
| Transcript card from the publish tool, including error and incomplete | PARTIAL | Regex and status gate exist. Missing record is silent |
| Open and full screen | PARTIAL | Open selects the dock item. Full screen is sheet height. Viewer dialog exists and is not what the card drives |
| Store dedupe, cap, per session, reload on session switch | COMPLETE | Dedupe and cap 200 at `artifact.store.ts:72-83`. Reload tracks `activeTabSessionId` |
| `artifacts:list` `{}` files under the wrong tab | CONFIRMED, not a cross-write | See decision below. Lines: `artifact.store.ts:51`, `62-65`; symptom lines `display-sheet.component.ts:121-126`, `tool-call-item.component.ts:150-164` |

Implicit requirements not addressed: visible failure for list and open-link; frame teardown on panel close; focus trap for the dialog.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Empty artifact list | YES | Strip omits artifact items | None in the viewer |
| Invalid `viewerUrl` | YES | Error alert, no iframe | Title is interpolated as text, not HTML |
| Second height within 100ms | YES | Trailing timer keeps the latest | Spec name says "ignores"; the timer still applies it |
| Revision replay | YES | `revision >=` replaces, older is kept out | Equal revision still replaces |
| Over 200 records | YES | Newest by `createdAt` then revision | Older cards lose `recordById` with no explanation |
| Concurrent list and notification | YES | Merge by revision | Late list cannot downgrade |
| Sheet collapse / strip switch | NO | Hidden, not destroyed | Blocking finding |
| Viewer full screen plus sheet full | YES | One iframe; classes only | Escape conflict |
| Null `contentWindow` on load | NO | Timer cleared, no error | Moderate |
| Foreign list payload | YES | Filtered out | Tab looks empty |

## Decisions

- Multiple mounted viewers is a blocking defect. Options: treat "one live iframe" as one per artifact id (the sheet and the viewer dialog do not duplicate a single id), or as one frame in the whole panel. Evidence: the task text says "a single sandboxed viewer", the card comment says the only live iframe is the viewer, and `[hidden]` still loads and runs the document. Recommendation taken: one mounted viewer. Reversible by rendering only the active key.
- Card "Full screen" is a moderate defect, not a second-iframe defect. Options: accept batch 11's sheet-height mode, or require the viewer dialog. Evidence: `batch-11-report.md` chose `DisplaySheetState` mode `full` and said it is not OS fullscreen; the button still says "Full screen" and the viewer implements a different dialog the card never drives. Recommendation taken: report it, do not block solely on it. Reversible by relabelling or binding `[fullscreen]`.
- The known `{}` list issue is an empty tab, not a frontend cross-file. Options: describe it as mis-filing, or as a dropped snapshot. Evidence: `artifact.store.ts:62-65` writes the requested session key only with rows whose own `sessionId` matches. The wrong session is chosen in `artifact-rpc.handlers.ts:52`. Recommendation taken: cite those frontend lines as the call site and the symptom, and do not ask this review's fix to remove the filter.

## Unknowns

- Real `toolOutput` shape for `ptah_artifact_publish` on the Electron transcript was not traced past the two shapes the spec feeds (JSON string, and `{ type: 'text', text }`). Another wrapper would hide the card.
- Whether a `hidden` iframe can miss `load` long enough to trip the 10s error was not executed.
- `ptah-ptah_artifact_publish` (the Copilot prefix in `isPtahMcpToolName`) is not accepted by the card regex. Not shown as an Electron name in this pass.
- No runtime browser pass and no diagnostics.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Top risk: every artifact on an opened or collapsed display sheet is a live scripted iframe.
- What a robust implementation would add: mount one viewer for the selected artifact only; destroy it on collapse; stop Escape at the dialog; show list and open-link failures; say when a complete publish has no record; skip over-long theme values instead of dropping the message.
