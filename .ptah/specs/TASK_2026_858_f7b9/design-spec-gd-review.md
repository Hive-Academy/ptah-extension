# G-D design revision review — TASK_2026_858_f7b9

## Round 2 re-review

**Verdict: APPROVED** (8/10, high confidence for this document and static prototype gate). Both Round 1 findings are fixed. The score is above the 5–6 band because the W6/W8 field names agree and the rendered first-attach failure no longer fabricates history. It remains below 9–10 because the prototype is static: the Refresh transition, Send race, and draft preservation are specified in `design-spec.md:135-140` but cannot be exercised here.

### Round 1 finding status

1. **Serious — 9c invented history: fixed.** `prototype/prototype.js:143-148` adds `bare` and omits the three sample events when it is true. `watchBody` passes `!!o.tx` (`prototype/prototype.js:219-220`), and 9c supplies its own empty-history content (`:252-258`). Fresh browser renders of `#ownerUnavail` in both themes contain only “No saved history is available because the session could not be checked.” in `.tx`, no approval block, and disabled input/Send. This matches `design-spec.md:126-132` and W8's failed freshness check (`implementation-plan.md:390-406`). See the two 09c screenshots below.
2. **Moderate — `sessions.list` field name: fixed.** `design-spec.md:115` now assigns `drivenBy: holder.label` to `session.attach` and `driver?` to `sessions.list`; the banner and row chip use those respective values. W8 specifies `drivenBy` on the attach snapshot (`implementation-plan.md:402-405`), and W6 specifies `driver?` on the list item (`:299`). No additional wire field is required.

### New findings and regression check

No new findings in this scope. Fresh renders of 9 and 9b retain saved events, the read-only request block, and disabled input/Send (`prototype/prototype.js:216-247`); 9d retains saved events, no request block, and enabled input/Send (`:266-274`). The 9c banner reports `DRIVER_LOCK_UNAVAILABLE` without an owner claim (`:252-262`). The eight renders had no horizontal overflow at 1280×760. The revised copy remains consistent with W10's `DriverHolder` fields, refusal when a holder does not answer, no time-based stale inference, conditional release command, and local `SESSION_DRIVER_LOCK_UNAVAILABLE` (`implementation-plan.md:458-470,516-529,537-541`). Static captures do not prove the transitions or keyboard behavior of the eventual Electron implementation.

### Screenshots recaptured

All eight PNGs were overwritten from `prototype/index.html` via `file://` at **1280×760**, with `ptah_browser_navigate` and `ptah_browser_screenshot`:

| State | Dark | Light |
| --- | --- | --- |
| 9 / `#owner` | `prototype/screenshots/09-local-driver-dark.png` | `prototype/screenshots/09-local-driver-light.png` |
| 9b / `#ownerHung` | `prototype/screenshots/09b-local-driver-dark.png` | `prototype/screenshots/09b-local-driver-light.png` |
| 9c / `#ownerUnavail` | `prototype/screenshots/09c-local-driver-dark.png` | `prototype/screenshots/09c-local-driver-light.png` |
| 9d / `#ownerFree` | `prototype/screenshots/09d-local-driver-dark.png` | `prototype/screenshots/09d-local-driver-light.png` |

### Decisions and clarifications

- **D17 remains accepted:** Phase 1 re-checks on Refresh, window focus, and list reload, without a 30-second timer (`design-spec.md:136`; `implementation-plan.md` W10 has no polling requirement). This is reversible after polling cost and status behavior are defined.
- **Clarifications needed:** none. No build, verify, server, git operation, or fleet access was used.

The Round 1 and original reviews below remain as prior-round records; this verdict supersedes them.

## Round 1 re-review

**Verdict: REVISE** (6/10, high confidence). Six original findings are fixed; the seventh still fails in the rendered 9c state. A separate `sessions.list` field mismatch also remains. The score is above the original 5/10 because the error copy, recovery path, disabled controls, contrast, local holder boundary, and screenshot inventory now agree with the plan. It remains below the sound 7–8 band because a first failed attach still displays history that W8 cannot return. This is a static prototype and document gate; interaction transitions, the Send race, and draft restoration remain specified behaviour rather than executable prototype behaviour.

### Per-finding status

| Original finding | Status | Round 1 evidence |
| --- | --- | --- |
| 1. Remote 9c exposes local error cause and fix | **Fixed** | `design-spec.md:126-131` separates fixed remote `DRIVER_LOCK_UNAVAILABLE` copy and log ref from local `SESSION_DRIVER_LOCK_UNAVAILABLE` cause/fix, matching `implementation-plan.md:537-541,883-890`. The remote prototype banner uses only the remote code, safe copy, and ref (`prototype/prototype.js:252-256`; `09c-local-driver-{dark,light}.png`). |
| 2. 9c claims a holder and unverified history | **Not fixed** | The chip, composer, and banner no longer claim an owner, and the request block is absent (`prototype/prototype.js:255-262`). But `watchBody` calls `transcript(o.tx)` (`:219`), and `transcript` always prepends a user message, Claude reply, and Read tool (`:143-148`). Both 9c captures visibly show those events above “No saved history is available,” contrary to `design-spec.md:132` and `implementation-plan.md:390-409`. |
| 3. 9b release instruction omits live-record guard | **Fixed** | Close or stop the holder comes first, and the command is conditional on an ended session with `in-use` explained (`design-spec.md:122-124`; `prototype/prototype.js:245-247`). This matches `implementation-plan.md:516-529`; `09b-local-driver-{dark,light}.png` renders the text. |
| 4. Stop remains focusable without a reason | **Fixed** | Stop and Send now have native `disabled` and `aria-describedby="why9"` (`prototype/prototype.js:226,230`), with a visible banner at `id="why9"` (`:236,246,256`). In the rendered 9 state, `Stop.focus()` did not focus it. |
| 5. Disabled Send misses the stated contrast target | **Fixed** | The specific disabled rule removes opacity and applies `--bcm` (`prototype/prototype.css:68-69`). Browser colour sampling of Send over the composer measured **11.70:1 dark** and **5.93:1 light**, matching `design-spec.md:145`; `09-local-driver-{dark,light}.png`. |
| 6. Full holder details have no renderer transport | **Fixed for the original concern** | The remote screen now uses only the label; the full `DriverHolder` disclosure is explicitly local (`design-spec.md:115`; `prototype/prototype.js:235-237`; `implementation-plan.md:458-459`). A distinct `sessions.list` field mismatch remains below. |
| 7. README omits 9b–9d screenshots | **Fixed** | `prototype/README.md:17-19` names all eight 09/09b/09c/09d dark and light captures. |

### Remaining and new findings

1. **Serious — 9c first failed attach still shows invented history.** `prototype/prototype.js:143-148` hard-codes three events before the `extra` argument; `watchBody` supplies the 9c empty message as that `extra` (`:219,257`). Thus `09c-local-driver-light.png` and `09c-local-driver-dark.png` at **1280×760** show a user prompt, Claude reply, and completed Read tool immediately above “No saved history is available.” W8 says a failed freshness check returns `DRIVER_LOCK_UNAVAILABLE`, with no snapshot (`implementation-plan.md:390-409`), and the revised design specifically requires an empty first-attach transcript (`design-spec.md:132`). **Impact:** the screen implies saved work exists when no history was obtained. **Fix:** give 9c a genuinely empty transcript container on first attach; render cached events only in the separately labelled cached case.

2. **Moderate — the spec invents `drivenBy` on `sessions.list`.** `design-spec.md:115` says both `session.attach` and `sessions.list` carry `drivenBy: holder.label`. W8 specifies that field for `session.attach` (`implementation-plan.md:402-405`), but W6 lists `driver?` for `sessions.list` (`:299`). **Impact:** the session-row chip has an ambiguous data source; an implementer following the spec may add an unapproved field or expect one the list contract does not provide. **Fix:** use the approved `driver?` name and state its label shape, or have the architect revise the list contract before implementation. This is a document contract finding; the 9 screenshot shows the row context, not a wire response.

### Screenshots recaptured

All eight were overwritten from `file:///home/amun/ptah-extension/.claude-worktrees/remote-workers/.ptah/specs/TASK_2026_858_f7b9/prototype/index.html` with `ptah_browser_navigate` and `ptah_browser_screenshot`, **1280×760**:

| State | Dark | Light |
| --- | --- | --- |
| 9 / `#owner` | `prototype/screenshots/09-local-driver-dark.png` | `prototype/screenshots/09-local-driver-light.png` |
| 9b / `#ownerHung` | `prototype/screenshots/09b-local-driver-dark.png` | `prototype/screenshots/09b-local-driver-light.png` |
| 9c / `#ownerUnavail` | `prototype/screenshots/09c-local-driver-dark.png` | `prototype/screenshots/09c-local-driver-light.png` |
| 9d / `#ownerFree` | `prototype/screenshots/09d-local-driver-dark.png` | `prototype/screenshots/09d-local-driver-light.png` |

### Decisions and clarification

- **D17 accepted:** no 30-second background re-check in Phase 1; Refresh, window focus, and list reload are the triggers (`design-spec.md:136,213,220`). A timer is reversible later, and the current plan has no typed status or measured polling cost.
- No user clarification is needed for the two remaining findings; both can be resolved against the approved W6/W8 contracts. No build, server, verify, or fleet access was used.

The original review below is retained as the prior-round record; its verdict and findings are superseded by this section.

## Verdict

**REVISE** (5/10, high confidence). The core watch-only treatment meets the G-D requirement in `batches.md:128-134`: screen 9 removes Allow/Deny, preserves a read-only request, names the driver, and disables the composer. Screens 9b–9d and the native Codex lock scope are represented. The score is below the sound 7–8 band because 9c contradicts the approved error contract and its own no-owner rule, and because the prototype misses stated keyboard and contrast requirements. It is above the 3–4 band because all four states render in both themes, the main watch-only path is coherent, and no horizontal overflow appeared at 400px.

This is a document and static-prototype review. The prototype was opened from `file:///home/amun/ptah-extension/.claude-worktrees/remote-workers/.ptah/specs/TASK_2026_858_f7b9/prototype/index.html`; no app build, server or `npm run verify` was run. Hash states show intended snapshots; they cannot prove live re-checks, Send races, draft restoration, or one-time live announcements. No skill-loading tool was exposed in this lane; no optional skill was loaded.

## Findings

1. **Serious — 9c requires error details that the approved remote contract removes.** `design-spec.md:126-128` requires the remote banner to show the lock failure's cause and fix verbatim from `RpcUserError`. W10 requires that message locally (`implementation-plan.md:537-541`), but W12 maps `SESSION_DRIVER_LOCK_UNAVAILABLE` to `DRIVER_LOCK_UNAVAILABLE`, uses fixed wire copy, and passes only allow-listed detail fields; neither cause nor fix is among them (`implementation-plan.md:883-890`). The rendered 9c banner displays a specific permission-denied cause, folder repair instruction, and the internal error code, none of which is in the approved remote payload (`prototype/prototype.js:252-259`). **Impact:** implementation must either leak an unapproved raw error or invent a cause. **Fix:** use safe fixed remote copy and the remote error code, or approve a specific sanitized cause/fix contract. Screenshot: `prototype/screenshots/09c-local-driver-light.png`, 1280×760.

2. **Serious — 9c falsely claims a known driver and shows unproven history.** The spec says no owner is known and forbids “Someone is driving” copy (`design-spec.md:126-129`), but shared `watchBody` puts “driven from Horus” in the disabled placeholder and “Someone at Horus is driving” in its accessible description for 9c (`prototype/prototype.js:226-228,252-259`). It also renders a saved transcript and pending Bash request unconditionally (`prototype/prototype.js:219-225`). On a first attach whose lock check is unavailable, W8 returns `DRIVER_LOCK_UNAVAILABLE`, not snapshot events (`implementation-plan.md:390-409`). **Impact:** users may infer a holder or request the app could not verify. **Fix:** give 9c an unknown-owner composer explanation; show only previously cached, explicitly labelled history if it exists, otherwise an unavailable transcript state. Screenshots: `prototype/screenshots/09c-local-driver-dark.png`, `09c-local-driver-light.png`, 1280×760.

3. **Moderate — the 9b release instruction omits W10's live-record restriction.** `design-spec.md:122-124` and `prototype/prototype.js:242-249` tell the user to close the process *or run* `ptah worker locks release <session id>` when the holder is not responding. W10's command returns `in-use` when that process still has a live session record (`implementation-plan.md:516-529`); a 500 ms timeout never proves it has none (`:467-470`). **Impact:** the apparent recovery step can fail in the shown paused/hung case without explanation. **Fix:** state that the command can release only a lock with no live session record, and describe `in-use` as a reason to close or recover the owning process. The command name itself matches W10. Screenshot: `prototype/screenshots/09b-local-driver-dark.png`, 1280×760.

4. **Moderate — Stop remains a Tab stop and has no linked reason.** `design-spec.md:140-144` says disabled controls are not Tab stops and have an `aria-describedby` explanation. `watchHead` emits Stop with `aria-disabled="true"` but no native `disabled`, `tabindex`, or `aria-describedby` (`prototype/prototype.js:230`). Browser evaluation on `#owner&light` found `disabled=false`, `tabIndex=0`, no `aria-describedby`, and `Stop.focus()` made it the active element. **Impact:** keyboard users reach an unavailable control without hearing why; an implementation copying this markup must also suppress activation. **Fix:** use native `disabled` while preserving layout, or remove it from Tab order and suppress activation, with a visible linked explanation. Screenshot: `prototype/screenshots/09-local-driver-light.png`, 1280×760.

5. **Moderate — disabled Send text misses the revision's own contrast target.** `design-spec.md:140-142` says *all* disabled copy remains above 4.5:1. The prototype applies `opacity:.55` to disabled buttons (`prototype/prototype.css:68`), including Send (`prototype/prototype.js:226`). Browser-computed colors composited over the composer background yield **3.90:1 dark and 2.48:1 light** for Send text. WCAG exempts inactive controls, but the design explicitly promises legibility beyond that exemption; section 5 measures the opaque primary button, not this state (`design-spec.md:164-178`). **Fix:** avoid whole-button opacity for disabled Send; use the measured muted text token and a distinct border/shape while retaining `disabled`. Screenshots: `prototype/screenshots/09-local-driver-dark.png`, `09-local-driver-light.png`, 1280×760; Send is at the lower edge and is reachable by scrolling.

6. **Moderate — full holder details have no explicit renderer transport shape.** `design-spec.md:113-115` requires `kind`, `hostname`, `pid`, and `acquiredAt` in “Who has it?”; these are genuine W10 `DriverHolder` fields (`implementation-plan.md:458-459`), not invented fields. But `session.attach` carries only `drivenBy: holder.label` (`implementation-plan.md:402-405`), and `sessions.list` leaves `driver?` untyped (`:299-300`). W11 does not specify a full-holder response (`:856-870`). **Impact:** the disclosure cannot be built from the attach result, and a list response might contain only a label. **Fix:** specify `sessions.list.driver?: DriverHolder` or a reviewed subset in the implementation contract and use that shape in the design. Screenshot: `prototype/screenshots/09-local-driver-dark.png`, 1280×760; `prototype/prototype.js:235-236` supplies the fields.

7. **Minor — the prototype README's screenshot inventory is stale.** `prototype/README.md:17-19` lists `09-local-driver` only, although its hash list includes 9b–9d (`:9`) and the G-D revision log calls for new captures (`design-spec.md:235`). **Impact:** a reviewer following the README may skip three states. **Fix:** list all eight 09/09b/09c/09d theme captures and note they were regenerated. Screenshot: `prototype/screenshots/09d-local-driver-light.png`, 1280×760.

## Screenshots captured

All eight files were captured with `ptah_browser_navigate` on the file URL and `ptah_browser_screenshot` at **1280×760**:

| State | Dark | Light |
| --- | --- | --- |
| 9 / `#owner` | `prototype/screenshots/09-local-driver-dark.png` | `prototype/screenshots/09-local-driver-light.png` |
| 9b / `#ownerHung` | `prototype/screenshots/09b-local-driver-dark.png` | `prototype/screenshots/09b-local-driver-light.png` |
| 9c / `#ownerUnavail` | `prototype/screenshots/09c-local-driver-dark.png` | `prototype/screenshots/09c-local-driver-light.png` |
| 9d / `#ownerFree` | `prototype/screenshots/09d-local-driver-dark.png` | `prototype/screenshots/09d-local-driver-light.png` |

Also inspected `#owner&light` at **400×812** without saving a ninth file: `body.scrollWidth=body.clientWidth=385`; the list and session pane scroll independently, and scrolling the pane to its end exposes the composer. The tall prototype state bar consumes much of this viewport. No horizontal overflow was observed. Live focus preservation, draft restoration, Refresh behavior, race handling, reduced-motion state swaps, and announcements remain unverified because the prototype changes states by hash rather than by those interactions.

## Decisions

- **Recommend no optional 30 s background re-check in Phase 1** (`design-spec.md:131-136,209,216`). Refresh, window-focus, and list-reload checks give a transition path, while W11 exposes no dedicated driver-poll method (`implementation-plan.md:856-865`). A timer adds repeated remote work and another announcement path without solving the Send race; lock refusal already handles that race. Revisit a visibility-limited cadence after the typed status contract and cost are measured. Options: add 30 s polling now, or defer it; **defer** is reversible.
- The error-code and command names in the revision are W10/W11 names: `SESSION_DRIVER_LOCK_UNAVAILABLE`, `SESSION_DRIVEN_ELSEWHERE`, and `ptah worker locks release <sessionId>` (`implementation-plan.md:519-529,537-541,667-670,856-870`). The issues above concern remote error exposure and command eligibility.
- Watch-only is approved Q1(a) scope and applies to native Codex sessions under Round 5 (`context.md:45-51`; `implementation-plan.md:547-549,653-666`). The read-only permission block has no Allow/Deny controls (`prototype/prototype.js:221-225`). The 9d spec preserves a draft and refuses a losing Send race (`design-spec.md:131-136`); these are specified but not interactive in this prototype.

## Clarifications Needed

None for the G-D verdict. The findings are resolvable from the approved contracts; the architect can decide optional polling as recommended above.
