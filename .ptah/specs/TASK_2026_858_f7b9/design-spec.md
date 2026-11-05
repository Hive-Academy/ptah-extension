# Design Spec - TASK_2026_858_f7b9 - Electron Machines view

Design system applied: the existing Electron webview themes `ptah-glass` (dark) and `ptah-glass-light`. No new visual system is introduced. Prototype: `prototype/index.html` (README there). Requirements source: `task-description.md` (Gate 1 approved), requirement 3 (Phase 1: 3.1-3.4, 3.6-3.7; 3.5 in Phase 2), plus UI parts of 1.4-1.5, 1.8-1.9, 2.2-2.4, 4, 6.

## 1. Scope and project rules

- Electron first: this spec targets `apps/ptah-electron` (the webview rendered by `apps/ptah-extension-webview`). No TUI or VS Code extension feature work. Screenshots in the prototype are design artifacts, not app reviews. `[project-rule]` CLAUDE.md "Product focus".
- Verification is `npm run verify -- -p <changed projects>` only; never workspace-wide; no build/serve/dev/e2e/package targets. `[project-rule]` CLAUDE.md.
- Git: designer commits nothing. `[project-rule]`.
- Out of scope: the PWA (Phase 3), `ptah fleet add` UI beyond showing readiness results (Phase 2 requirement 7), Tailscale/Cloudflare transport UI (Phase 2/4).
- Only the main shell chrome (navbar, a view slot, Chat) is reused. The Machines view is new; Chat, session list and local sessions are unchanged (3.7).

## 2. Token and component sources

| Value | Source |
| --- | --- |
| Surfaces `base-100/200/300`, `base-content`, `--bcm` muted text, `--state-ink-run/need/err/done/idle`, primary, radii (`--rounded-box` 1.5rem and `--rounded-btn` 9999px in both glass themes, tailwind.config.js L265-266 and L310-311; `--rounded-badge` 9999px) | `apps/ptah-extension-webview/tailwind.config.js` themes `ptah-glass` (L232) and `ptah-glass-light` (L277) |
| Fonts: Inter (UI), JetBrains Mono (aliases, commands, args), Cinzel (logo only) | same file, `fontFamily` (L43-47) |
| Theme names, picker, `data-theme` switching | `libs/frontend/core/src/lib/services/theme.service.ts` |
| Navbar tab strip (`role="tablist"`, `.tab`, `.tab-active`, `title`/`aria-label` per tab), Workspace sidebar, vertical tabs | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` (tabs at L224-305; `ptah-workspace-sidebar`, `ptah-sidebar-tab` L421-491) |
| Surface/route ids (`ViewType`, `SURFACE_ROUTE_IDS`) | `libs/shared/src/lib/types/webview-surface.types.ts` via `libs/frontend/core/src/lib/routing/surface-routes.ts` |
| Component grammar (rows, banners, tool call item, badge) | existing `session-list-row`, `tool-call-item`, `resume-notification-banner` under `libs/frontend/chat/src/lib/components/molecules/`; the frontend developer reuses them where they fit and wraps them with machine context |

Radius rule: DaisyUI controls (buttons, badges, chips) and large containers (pairing panel, readiness panel, banners, approval block, user bubble) use the theme tokens (pill / 1.5rem). Dense inline items (input fields, command boxes, tool-call blocks, replayed-item boxes, selected machine row) use Tailwind `rounded-md` (.375rem), which is project precedent in `session-list-row.component.ts` (L160-199: `rounded-md`, `input-bordered ... rounded-md`) and `tool-call-item`. This is not an exception to the tokens; it follows how the existing components already mix the two.

One derived value: input border `--edge-ui` = `base-content` mixed at 40% (dark) / 50% (light) so form fields reach 3:1 non-text contrast. If the project's DaisyUI `input-bordered` already passes in both themes, use it and drop this value (frontend developer to measure).

## 3. Placement in the Electron shell (decision)

Decision: a new top-level surface, **Machines**, as a tab in the Electron global navbar, between Tasks and Analytics. It has its own route id. It owns a left machine list (300px) and a right pane (machine detail, session list, remote session).

Evidence:
- The navbar already holds one tab per top-level surface (Chat, Voice, Apps, Tasks, Analytics, Setup hub) driven by `appState.currentView()` (electron-shell.component.ts L224-305); a comment in `app-shell.component.html` L178 confirms "Electron has [Tasks] in global navbar". A Machines tab follows the same pattern.
- `ptah-workspace-sidebar` is a folder list scoped to the local machine (`workspace-sidebar.component.ts`: `switchWorkspace`, `addFolder`). Merging machines into it would mix a machine axis into a workspace axis and break 3.7.
- Remote sessions need their own session list because they come from the worker's own reports (3.2), not the local session store.
- Chat remains the local-machine home. The machine list footer says so ("amun-PC stays in Chat") to teach the model.

Reachability without local folders (review S1): `electron-shell.component.ts` L216-222 renders the tab strip only when `layout.hasWorkspaceFolders()`. Decision: when there are no local folders the shell still renders the navbar, but its tablist shrinks to one tab, **Machines** (a registered machine exists or not; with none it still shows, so "Add machine" is reachable), and the content slot honours the Machines route even though the "no folders and no configuration surface" branch (L368-370) would normally show the welcome screen. The welcome screen gains a secondary "Machines (N connected)" button next to its primary "Open folder". Chat, Voice, Apps, Tasks, Analytics and Setup hub return when a folder opens. Shown in prototype states 10 and 10b. Implementer: change the `@if (layout.hasWorkspaceFolders())` guard to render the Machines tab outside it, and make the welcome branch yield when `currentView() === 'machines'`.

Consequences for implementation (frontend developer / architect): add a surface id for the new view in `libs/shared` (shared with the VS Code host, which must keep compiling; no VS Code UI is added); the tab is Electron-only (hide where the host cannot show it). A tab count badge (pending approvals) sits on the tab label: it is a hint, not a button.

Phase 2 (3.5): the machine list already shows every machine with its own state and running-session count (screen 5, 5b). Phase 1 ships the same layout with one row; no redesign.

## 4. Screens and states

All values use tokens from section 2. Layout: navbar 40px high; left list 300px; right pane fills; row heights from `padding 8px 12px`; text 13px base, 12px for meta. Only one primary (filled) button per surface; everything else is ghost/outline. Status is a hint (icon, text), never a button.

### 4.1 Empty (no machines) - screen 1
- Left list: heading "Machines", primary "Add machine" (compact), body "No machines yet."
- Pane: centred block, max 52ch: title "Control Ptah on your other machines"; one sentence on the SSH approach ("nothing is opened on your network"); the single primary "Add machine"; hint with a link "What is checked?" to the readiness list.
- Footer note in the list: "amun-PC (this machine) stays in Chat."
- Both "Add machine" buttons are primary here only because the left one is compact chrome; implementer: show the primary in the pane only and make the left control ghost when the list is empty (see Decision D6).

### 4.2 Add machine by SSH alias + pairing code - screen 2 (3.1, 2.3)
- Form pane max 640px. Field 1: "SSH alias" (mono) with a datalist suggested from `~/.ssh/config`; hint "Hosts from your ~/.ssh/config". Free text is allowed.
- Pairing panel (`base-200`, 1px edge, rounded-box): short instruction (open the pairing window on the worker; code shown once, expires in 5 min `[documented lifetime, value from architect]`), a copyable command (`ptah worker pair`, mono), 8 single-character cells (`aria-label="Character n"`, uppercase, paste fills all cells), and a ghost "Pair automatically via SSH" (2.3.1 Electron may read the code over the user's SSH login).
- Actions: primary "Pair and connect"; ghost "Cancel". Enter submits. While pairing: button shows "Pairing..." and is disabled; field set stays enabled for cancel.
- Success: pane goes straight to the readiness check (4.4), then the machine appears in the list as Connected (3.1).
- Code length (8) and the 5 minute lifetime are placeholders for the architect's documented values (2.3.5); the layout works for 6-10 characters.

### 4.3 Pairing failure - screen 3 (2.3.3, 2.4)
- Banner (`role="alert"`, full 1px border in `--state-ink-err`, label "Pairing failed" in bold): "The code was not accepted. It may be wrong, expired or already used; Ptah cannot tell which. If the pairing window on <machine> is still open, check the code and try again (2 attempts left). If it closed or expired, open a new one on <machine>." The recovery path depends on the window state the user can see on the worker, not on which failure occurred. The wording intentionally does not say which cause (matches 2.3.3 "does not say which of the three").
- Cells get `aria-invalid="true"` and the error border; focus returns to the first cell.
- Under the form, the other failures use the same banner pattern: "Cannot reach host" (SSH to alias failed, with the SSH message) and "Too many attempts" (worker closed its pairing window; open a new one).
- "Nothing was stored. No token exists for <machine> on this machine" confirms 3.6 hygiene.

### 4.4 Readiness check results - screen 4 (1.8, 1.9)
- Heading "<Machine>: readiness check". Summary banner: "Not ready: 2 of 6 checks need your attention. Sessions cannot start on <machine> until they pass." (matches 1.9 "refuse to start a session when no provider is ready").
- Ordered list in one panel. Each row: mark + text label (Pass / Fail / Warning) + name + detail. A failing or warning row shows the fix as a copyable command (mono) and a plain sentence. Pass rows show the found value (version, address).
- Checks: worker reachable (loopback address), versions compatible (Ptah + protocol), Node version, provider signed in (per provider), provider CLI installed, workspace folders readable. The exact list comes from the 1.8 prerequisites; the layout holds any count.
- Actions: primary "Check again"; ghost "Copy report". Footer: "The same list is printed by `ptah worker doctor`." (name `[TBC by architect]`).
- Do not mark an optional missing provider as a failure: use Warning, and say what becomes unavailable.

### 4.5 Machine list with status - screens 5, 5b (3.2, 3.4, 3.5)
Row (list is a `<ul>`, not cards): name (bold) + alias (mono, muted) ... status; second line: running-session count or last seen, version. States:

| State | Marker (not colour alone) | Label | Ink token |
| --- | --- | --- | --- |
| Connected | filled circle | Connected | `--state-ink-done` |
| Offline | hollow circle | Offline | `--state-ink-idle` |
| Reconnecting | open ring, rotating 1s linear (static under reduced motion) | Reconnecting | `--state-ink-need` |
| Version mismatch | filled triangle | Version mismatch | `--state-ink-err` |
Sessions use the same marker idea: Running = filled square (`--state-ink-run`), Idle, Interrupted = triangle. An unreachable worker shows its running sessions as "Running (last known)" with the reconnecting marker, never as failed (3.4). A worker crash reports in-flight turns as "Interrupted" (1.6).
- Right pane header: machine name, status, "via SSH alias <alias> - ptah <version> - protocol <n>". Primary "New session"; ghost destructive-coloured "Remove machine" (text only colour `--state-ink-err`, also requires a confirm dialog that states "Deletes the stored token and stops the tunnel", 3.6).
- Sessions grouped by workspace as the worker reports them (3.2): group header row (`base-200`), rows `[state] [title] ... [provider] [Open]`.
- Reconnecting pane: banner "Lost contact 12 s ago. Sessions keep running; shown as unknown, not failed. Next attempt in 5 s." + ghost "Retry now".
- Version mismatch (non-functional "Version skew"): error banner states both versions, says "Not connected", and gives the update command (copy). The client refuses to connect rather than failing mid-session.

### 4.6 Remote session streaming - screen 6 (3.3, 5.1)
- Reuse the local session transcript components (user bubble, assistant text, tool call item) so remote and local read identically (3.3); differences are listed in the capability document (1.2).
- Header: title, "on <Machine> - <workspace path>", connection status, ghost "Stop". A "N viewers" chip is Phase 2 only (4.5 multi-client delivery); Phase 1 shows none.
- Machine name appears in each assistant author label ("Claude on Horus") so a user never confuses which machine a message came from.
- Composer: while a turn is in flight the input stays focusable with a placeholder "(a turn is in progress)" and Send disabled (4.7). Streaming text uses a caret that stops blinking under reduced motion. Live region announces "Claude is responding" once.

### 4.7 Remote tool-use approval - screens 7, 7b, 7c (6.1-6.3, 4.6)
- Pending (Phase 1): a block in the transcript, not a modal (so it does not hide the transcript or block other tabs). 2px border in `--state-ink-need`, badge "Waiting for you", title "<Machine> wants to run a command", key/value list: Machine, Session, Tool, Arguments (mono), "If unanswered: stays pending, like a local request" (6.3; the actual timeout text comes from the local behaviour). Actions: primary "Allow once"; ghost "Deny". Hint: "The session stays paused until someone answers." No copy promises multi-client delivery in Phase 1.
- The Machines tab shows a small count badge while any approval is pending; the same appears on the machine row (`aria-label="1 approval waiting"`). Native Electron notification wording is out of scope here (decision D7).
- Answered elsewhere (Phase 2 only, 4.6; prototype screen 7b is labelled "Phase 2"): block collapses to the neutral border, badge "Already answered", sentence "Allowed once from the keyboard on Horus at 14:02:11. Your answer was not applied; the session continues." Buttons disappear. Live region announces it. If the user's own answer wins, the same block shows "You allowed this".
- Not permitted (Phase 1, screen 7c): buttons stay visible but disabled, with an error banner. Neutral copy that does not reveal whether the session or workspace exists (2.9 returns the same "not found or not permitted" result for missing and excluded resources): "This request could not be answered from this app. The session was not found, or this machine's access on <Machine> does not include it. Check the access list on <Machine> (`ptah worker grants`, name TBC by architect), or answer at <Machine>." The actionable step is worker-side: list the grants (workspaces this paired machine may use) at the worker. Phase 1 grants are full-rights per registered workspace, so no scope wording appears. Phase 2 (scoped tokens, 2.5) adds one variant, shown only when the token's scope is known to the client: "This machine's token cannot approve tool use. Re-pair with approval scope." It is never shown for a resource-exclusion denial.
- Dangerous-command emphasis: arguments are never truncated in the block; long values scroll horizontally with a copy button (decision D8).

### 4.8 Reconnect and replay - screen 8 (4.2-4.4)
- Banner (`role="status"`, `--state-ink-done`): "Reconnected. Replayed 37 events from #1204 to #1241 while the link was down. No gaps, duplicates removed." Auto-dismiss only on user close; the numbers help debugging.
- In the transcript, a dashed divider "Connection lost 14:07:02", the replayed items sit in a dashed box with a "Replayed" badge, then a divider "Reconnected 14:07:19 - live". The badge fades after 10 s once the user has seen it (no layout shift: it is outlined, not removed from flow; reduced motion: it disappears without animation). Replay never reorders content; rendered result equals a client that never disconnected.
- Header chip: "Caught up". During replay it reads "Catching up..." with the reconnecting marker.
- Phase 2 snapshot fallback (4.3): banner "Restored from snapshot" and the transcript is replaced in place without a flash (crossfade, instant under reduced motion).
- Gap detected (4.4): chip "Fetching missing events" for the duration of the replay request; no partial render out of order.

### 4.9 Session driven by someone else: watch-only - screens 9, 9b, 9c, 9d (1.4, 1.5, Q1 (a), W10)
Applies when the session's driver lock is held by another process: another Electron window, a worker, a CLI, or a native Codex session (`DriverHolder.kind` = `desktop | worker | cli`). The remote client can only watch. Phase 1 has no live watch of a driven session and no remote answering (Q1 (a); both are Phase 2, C11), so this screen shows the last-saved transcript and nothing in it can be acted on. Same layout as 4.6 (opened session); only the items below differ. All values are existing tokens (section 2).

**9 - Driven elsewhere (holder responding)**
- Header: owner chip `Driver: <label>` (e.g. "Driver: Horus keyboard"), neutral border, shape = lock mark, text always present. Stop is disabled (`aria-disabled="true"`, not removed, so the layout does not move). A ghost "Refresh" button is added next to the chip and is the only enabled header action.
- Banner (`role="status"`, `--state-ink-run` border, label "Watch only"): "<Holder> is driving this session. You can read what was saved so far. Sending, stopping and answering requests are unavailable until they are done." Second line, `--bcm`, small: "Last saved 14:02:11. Press Refresh to check again."
- Who holds the session. Two sources, never mixed. Remote client (the Machines view): `session.attach` carries only `drivenBy: holder.label` (plan W8) and `sessions.list` carries `driver?` (plan W6), which is that same holder label; the banner uses `drivenBy` and the session-row chip uses `driver?`, and both show the label and nothing else; there is no "Who has it?" disclosure and no pid, host or time is invented. Local lock (the worker's own Ptah, or any Ptah that reads the full `DriverHolder` from the local lock): the disclosure appears, closed by default, listing Kind ("Ptah desktop app" / "Worker" / "Command line"), Machine (`hostname`), Process (`pid`, mono), Since (`acquiredAt`, local time). Prototype screen 9 shows the local variant; the remote variant is the same screen without the disclosure. The session row shows the chip with `label`; its screen-reader name ends "driven by <label>, watch only".
- Transcript: read-only, the last saved events (the read-only history source of W7/ChatHistoryReadService). A dashed divider at its end, `--bcm` text: "Saved up to 14:02:11. Newer activity is not shown."
- Permission block (a request that is pending in the driver's session): read-only. Same block as 4.7 (2px `--state-ink-need` border, badge "Waiting at <Machine>", title "<Machine> is waiting for an answer", Machine, Tool, Arguments in mono, never truncated, D8), but **no Allow, no Deny and no buttons at all** (not disabled buttons, because disabled controls invite retries and are skipped by assistive tech). In their place one sentence in base-content: "Answer this request at <Machine>. It cannot be answered from this app." If the request is not visible in the saved transcript, the block is absent; nothing is inferred.
- Composer: input and Send are `disabled` (native), placeholder "Sending is unavailable: driven from <Machine>", `aria-describedby` text "Someone at <Machine> is driving this session. Sending is unavailable until they are done." The composer stays in the DOM and in the same place. (9c uses different text, below.)
- Not offered, ever, in Phase 1: take over, force release, copy-to-new-session. 1.5 requires refusal with a visible message naming the owner; the file is not corrupted.
- Reverse case (the worker's own Ptah while a remote client drives): banner label "Watch only", text "Driven remotely by <client machine>. You can read this session; sending is unavailable until they are done." Same disabled rules. It uses the same lock refusal, `SESSION_DRIVEN_ELSEWHERE`.

**9b - Holder not responding** (`responding: false`, label "another Ptah process (not responding)")
- Same as 9, but the banner label is "Watch only" with `--state-ink-need` border and the text: "Another Ptah process holds this session and is not answering. It may be busy or paused. The session stays locked until that process finishes or is closed." Chip reads "Driver: another Ptah process (not responding)". Fix line leads with the owner: "Close or stop that process on <Machine>." Second line, smaller: "If it has already ended its session, `ptah worker locks release <session id>` on <Machine> frees the lock; it refuses with `in-use` while that process still has a live session, and then the only fix is to close or recover that process." The command releases a lock only when its holder has no live session record (W10); a 500 ms silence never proves that, so the app never calls the lock stale, never offers to release it, and never infers liveness from time. The command name is W10's; the architect owns it.
- "Stranded" holders (label ends "(release pending)"): the chip shows that label and the banner adds "It is finishing up; try again in a moment." No extra control.

**9c - Lock could not be checked** (`SESSION_DRIVER_LOCK_UNAVAILABLE`, fail closed)
- This is a different state from 9: nobody is known to hold the session; the app could not check, so it refuses. No owner text anywhere: not in the chip, placeholder, `aria-describedby` or banner. The header chip reads "Not available" in `--state-ink-err` with an error mark.
- Banner (`role="alert"`, `--state-ink-err` border, label "Cannot check who has this session"). Two cases, because the wire differs:
  - Remote client (Machines view): the wire carries only fixed copy per `WorkerErrorCode` `DRIVER_LOCK_UNAVAILABLE`, allow-listed detail (`holder.label`, `turnId`, `providerId`, `sessionId`) and a log `ref` (plan W12). Copy: "This machine could not confirm that no one else is using this session, so it will not start or send anything. Try again, and if it keeps happening check the Ptah log on <Machine>." Under it, small mono: "DRIVER_LOCK_UNAVAILABLE &middot; ref <ref>". No cause, no fix path and no `SESSION_DRIVER_LOCK_UNAVAILABLE` string (a local-only code) is shown; nothing is invented.
  - Lock failure local to this Ptah (the worker's own Ptah, W10): copy "This app could not confirm that no one else is using this session, so it will not start or send anything. <Cause from the `RpcUserError` message>. Fix: <fix text from the error>, then press Refresh." shown verbatim; small mono `SESSION_DRIVER_LOCK_UNAVAILABLE`.
  Refresh is enabled and re-runs the check in both cases.
- Transcript and permission block in 9c: shown only when a snapshot was actually returned before (a cached view from an earlier successful attach), labelled "Cached from 14:02:11, may be out of date"; the request block is then read-only as in 9 but not claimed to be pending. On a first attach whose check failed, no history is returned (plan W8), so the transcript area shows the empty text "No saved history is available because the session could not be checked." and there is no permission block. Composer placeholder "Sending is unavailable", `aria-describedby` text "This app could not check who has this session. Sending is unavailable." Stop follows the same disabled rules.
- Do not reuse 9 copy ("Someone is driving", "driven from <Machine>") anywhere in 9c: it would claim something the app does not know.

**9d - Lock freed**
- There is no push in Phase 1, so freedom is learned when the client re-checks: on "Refresh", when the window regains focus while this session is open, and each time the session list reloads. Not on a timer: no 30 s or other background re-check in Phase 1 (deferred, D17).
- On a successful re-check the banner swaps in place (no layout shift, no flash; crossfade, instant under reduced motion) to `role="status"`, `--state-ink-done`, label "Available": "Horus finished. You can send messages again." The chip becomes "Idle". The composer enables, placeholder returns to the normal one, Stop returns to its normal state. The transcript is replaced with the current saved history in place; the scroll position is kept unless the user was at the bottom. The banner stays until closed by the user (same rule as 4.8); it never auto-dismisses.
- Focus is not moved (the user may be elsewhere). If the user last had focus on the disabled composer's region (the "Refresh" button or the transcript), focus stays where it was. Enabling the composer does not place a caret in it.
- If, on pressing Send right after, another process won the lock first, the send is refused with `SESSION_DRIVEN_ELSEWHERE` and the view returns to 9 with the new holder. The message is never queued or retried silently.
- Opposite transition (a driver appears while the user is composing): the composer is disabled in place, the typed text is kept in the field's draft and shown again when it re-enables; the banner changes to 9 and the live region announces it. Nothing typed is lost or sent.

**Accessibility for 4.9**
- Live regions: 9, 9b, 9d banners are `role="status"` (polite); 9c is `role="alert"`. Announcements, one per change, never repeated on re-render: "This session is driven by Horus. Watch only." / "Cannot check who has this session." / "Horus finished. You can send messages again."
- Disabled controls: Send and Stop use the native `disabled` attribute (so neither is a Tab stop and neither activates) while keeping their layout; each has `aria-describedby` pointing to the visible reason text (the banner id). Stop's reason is read by a screen-reader user by browsing, since a disabled control is not focusable; the same reason is also visible text in the banner. The composer input is `disabled` but its explanation is also visible text (placeholder plus the banner), not only in the placeholder (placeholders disappear and have lower contrast).
- Disabled text is not exempt from legibility: placeholder and disabled button labels use `--bcm` at full opacity (no whole-button `opacity`, which dropped Send to 3.90:1 dark and 2.48:1 light). Measured on the composer background base-200 (section 5): `--bcm` 11.70:1 dark and 5.93:1 light; on base-100 13.07 / 6.49; on base-300 10.13 / 5.25. All disabled copy stays above 4.5:1 even though WCAG exempts inactive controls. A disabled Send is a transparent button with a dashed `--edge-ui` border and `--bcm` text (no primary fill), and Stop the same; they also have a not-allowed cursor and a visible text reason, so disabled is not signalled by contrast alone.
- Banner label colours and their measured pairs (section 5): ink-run 9.19/7.23, ink-need 9.77/5.69 (use on base-100/200 only), ink-err 8.43/6.90, ink-done 10.61/6.63 (dark/light, on base-100). The label is always text, with a mark and a distinct border; colour is never the only signal (1.4.1).
- Focus order: Header ("Refresh" before the chip's disclosure) -> banner "Who has it?" disclosure -> transcript -> permission block (read-only; focusable only as a region with `tabindex="0"` and an accessible name so it can be read by keyboard; no control inside) -> composer area. Disabled controls are not Tab stops; the visible 2px `--focus` ring applies to Refresh, the disclosure and the transcript region.
- Opening this state never steals focus. Pressing Refresh keeps focus on Refresh and announces "Checking" then the result through the status region.
- Reduced motion: no crossfade or pulse; state swaps instantly.

### 4.10 Narrow and embedded widths
Below 760px the list stacks above the pane (max 45% height, own scroll); the tab strip scrolls horizontally and the active tab is centred on activation and on route change (implementer: set the tablist `scrollLeft` so the active tab is centred; `scrollIntoView({inline:'center'})` also works if the page does not scroll). In session rows only the provider label hides below 760px; the "Open" button stays in every row with the accessible name "Open session: <title>". Verified in `prototype/narrow.html` and `screenshots/11-narrow-400-list-dark-and-light.png` (active Machines tab visible, Open buttons present).

## 5. Accessibility

Standard: no project accessibility standard is stated for the webview beyond the existing contrast tests (`--bcm` comment cites base-content-muted.spec.ts); applying WCAG 2.2 AA (1.4.3 text 4.5:1, 1.4.11 non-text 3:1, 2.4.7 focus visible, 1.4.1 use of colour).

Keyboard order: navbar tabs (arrow keys move within the tablist, Tab leaves it) -> left pane: "Add machine", then the machine rows (Up/Down move between rows, Enter selects; one Tab stop for the list) -> pane header actions -> session rows (Open buttons are the Tab stops) -> transcript (scrollable region, focusable) -> approval block (focus moves to its heading when it appears; it does not steal focus from the composer if the user is typing: it announces via live region and the badge instead) -> composer. Add-machine form: alias, copy button, code cells (auto-advance; Backspace moves back; paste fills), "Pair automatically", primary, cancel. Esc cancels the form.

Focus: 2px solid `--focus` (`#f2cd6b` dark, `#624300` light) with 2px offset on every focusable element; never removed.

Status not by colour alone: every state has a distinct shape and a text label (table in 4.5); banners carry a text label ("Pairing failed", "Not ready"); readiness rows use "Pass/Fail/Warning" text plus a mark.

Live regions: `role="alert"` for pairing failure and version mismatch; `role="status"` for reconnect/replay and answered-elsewhere; streaming announces once per turn, not per token.

Reduced motion: spinner and caret are static under `prefers-reduced-motion: reduce`.

Contrast measured (WCAG relative luminance; script run on the token values from section 2; `--bcm` converted from OKLCH):

| Pair | Dark (ptah-glass) | Light (ptah-glass-light) |
| --- | --- | --- |
| base-content on base-100 / base-200 | 15.71 / 14.05 | 15.39 / 14.05 |
| muted (`--bcm`) on base-100 / 200 / 300 | 13.07 / 11.70 / 10.13 | 6.49 / 5.93 / 5.25 |
| ink-run on 100 / 200 / 300 | 9.19 / 8.22 / 7.12 | 7.23 / 6.60 / 5.85 |
| ink-need on 100 / 200 / 300 | 9.77 / 8.74 / 7.56 | 5.69 / 5.20 / 4.60 |
| ink-err on 100 / 200 / 300 | 8.43 / 7.54 / 6.53 | 6.90 / 6.30 / 5.58 |
| ink-done on 100 / 200 / 300 | 10.61 / 9.49 / 8.21 | 6.63 / 6.06 / 5.37 |
| ink-idle on 100 / 200 / 300 | 13.07 / 11.70 / 10.13 | 6.09 / 5.56 / 4.93 |
| primary button text on primary | 9.88 | 6.16 |
| input border (`--edge-ui`) vs panel | 3.86 (40% mix) | 3.43 (50% mix) |

All text pairs pass 4.5:1 in both themes (lowest 4.60, light ink-need on base-300: use ink-need text only on base-100/200 where it is 5.2+, and avoid placing it on base-300 chips). Decorative panel/row borders at 22%/30% mix are 1.6-2.0:1 and carry no information alone (rows are also separated by spacing and the selected row is marked with `aria-current` plus a background step), so 1.4.11 does not apply to them. Not measured: the real app's hover/active states and the glass (`data-glass`) background effect; the frontend developer re-measures with the project's spec harness.

## 6. Copy rules
- Say "machine", not "worker" or "node", in the UI; "worker" appears only inside commands and the doctor line. Say what to do next in every error.
- Security-relevant wording that is user-reserved: pairing failure text and the not-permitted text (see Clarifications Needed).

## 7. Implementation notes for the frontend developer
- Machine list rows, banners and transcript blocks: build as small standalone components in a new `libs/frontend/` view lib or the existing chat lib (architect decides); reuse `ptah-theme` tokens through Tailwind/DaisyUI classes, not literal hexes.
- State markers are one atom (`machine-status`) with inputs `state` and a visible label; used in the list, the pane header, and the session rows.
- Machine connection state must be derived from the worker/tunnel signal, not from session state (3.4).
- The prototype's `prototype.css` is local to the prototype; do not ship it.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Machines is a navbar tab (own surface) | (a) navbar tab; (b) section inside Workspace sidebar; (c) Settings page | Section 3 evidence | Yes (route + tab) |
| D2 | Add flow lives in the Machines pane, not a modal | modal; wizard in Setup hub; pane | Pairing needs the worker window open at the same time, so a modal blocking other windows is wrong; Setup hub is for first-run setup | Yes |
| D3 | Approval is an inline block, not a modal | modal; inline; toast only | Transcript and other tabs stay usable; matches local tool-call grammar | Yes |
| D4 | Approvals offer "Allow once" and "Deny" only in Phase 1 | add "Always allow" | 6.1 requires approve or deny; remote persistent allow rules widen risk and are not in requirements | Yes |
| D5 | Status via shape + label + colour using existing `--state-ink-*` | colour only; dot + colour | WCAG 1.4.1 | Yes |
| D6 | In the empty state the pane holds the primary "Add machine"; the list control becomes ghost | two primaries | "One primary action per surface" (ui-ux-designer skill) | Yes |
| D7 | OS notifications for pending approvals are not specified here | include; defer | Not in the Phase 1 UI requirements; notification centre exists (`ptah-notification-center`) and can carry it later | Yes |
| D8 | Approval arguments are never truncated | truncate with expand | Approving a command you cannot fully read is unsafe; matches local behaviour (frontend developer to confirm against `tool-call-item`) | Yes |
| D9 | Pairing code UI as 8 cells (length from architect) | single field; cells | One-time code read from another screen; cells reduce transcription errors; works with paste | Yes |
| D10 | Remove machine is a ghost danger-text action with confirm | primary danger; menu item | One primary per surface; destructive but local | Yes |
| D12 | Machines tab stays reachable with no local folder; tablist shrinks to Machines only | keep hidden; always show all tabs; Machines only | Section 3; electron-shell L216-222, L368-370 | Yes |
| D13 | Phase 1 denial copy is neutral and points to a worker-side grant check; scope copy is Phase 2 only | scope copy now; neutral | task-description 2.9, 2.5 | Yes |
| D14 | Radii follow theme tokens for controls and large containers; dense inline items use `rounded-md` per session-list-row | all tokens; all small radii | Section 2 radius rule | Yes |
| D15 | Code-failure cause is never shown and no "Always allow" or local-driving block exists in Phase 1 | show cause; add persistent allow | 2.3.3; Phase 1 capability set; 1.4 watch+approve; 4.6 first answer wins (Phase 2) | Yes |
| D16 | 4.9 is watch-only in Phase 1: last-saved transcript, owner chip, composer and Stop disabled, permission request shown read-only with "Answer at <Machine>" and no Allow/Deny controls; lock refusal `SESSION_DRIVER_LOCK_UNAVAILABLE` is its own state (9c) with no owner | keep answerable block (needs C11 bridge); disabled buttons; read-only text | User answer Q1 (a), decisions.md row 10; W10 fail closed; implementation-plan Clarifications Q1 | Yes (Phase 2 C11 restores 4.7 controls) |
| D17 | Lock-freed detection is by re-check (Refresh, window focus, list reload), not by a timer | timer poll; push | Phase 1 has no live watch of driven sessions; a poll cadence is a cost the architect owns | Yes |
| D11 | Machines tab shows a count badge for pending approvals (hint only) | no badge; per-row only | Approvals stall sessions (6, goal); a hint is not an action | Yes |

## Clarifications Needed

1. Exposing an exact remaining-attempts count in the pairing failure banner (security policy, user-reserved). Recommendation: show it ("2 attempts left"); the user must already hold the SSH session or the worker's keyboard to reach the pairing window, so the count helps legitimate retries more than an attacker. Options: (a) show the count (Recommended); (b) show "a few attempts left" without a number; (c) hide the count and only say when the window closes. Consequence of (b) or (c): users cannot tell when to stop retrying and open a new window.

2. Closed: no background re-check in Phase 1 (deferred, D17). Refresh, window focus and list reload are the only triggers; revisit a visibility-limited cadence once the typed status contract and its cost are measured.

Resolved from the approved requirements and moved to Decisions (formerly clarifications): the common wrong/expired/used result (2.3.3, D15); local watching and approval with first-answer-wins from Phase 2 (1.4, 4.6, D15); no persistent remote approval option in Phase 1 (Phase 1 capability set, D4, D15).

## Revision log

Round 1 (answering `design-spec-review.md`, Verdict REVISE). Screenshots were re-rendered for every state because the radius change affects all of them.

| Review item | Change |
| --- | --- |
| S1 Machines tab hidden without local folders | Section 3 "Reachability without local folders"; D12; prototype states 10 and 10b with `10-no-local-folder-*` and `10b-no-folder-machines-*` screenshots |
| S2 narrow rows hide Open | 4.10 rewritten; only the provider label hides; Open kept with per-row accessible name; narrow capture replaced by `11-narrow-400-list-dark-and-light.png` (the old `10-narrow-...` file removed) |
| S3 radii contradict theme tokens | Section 2 table corrected to 1.5rem / 9999px; radius rule paragraph with `session-list-row` precedent; D14; prototype CSS (`--rbox`, `--rbtn`, `--rsm`); all screenshots replaced |
| S4 Phase 1 denial references approval scope | 4.7 "Not permitted (Phase 1)" neutral copy plus worker-side grant check; scope copy reserved for Phase 2 and only when the client knows the scope; D13; prototype 7c and README |
| S5 local-driver screen lacks session UI | 4.9 rewritten; prototype state 9 now an opened session with transcript, answerable permission block, disabled composer, owner chip; `09-local-driver-*` replaced |
| M1 pairing copy contradicts attempts counter | 4.3 copy changed (retry in the open window, new window only if closed or expired); prototype 3; `03-pairfail-*` replaced |
| M2 narrow capture lacks active Machines tab | Active tab centred on render (prototype JS), rule in 4.10, `11-narrow-...` shows it |
| M3 clarifications overstate user decisions | Clarifications reduced to the single attempts-count policy question with consequence; the other three resolved into D15 and D4 |
| M4 Phase 2 behaviour in Phase 1 approval copy | Phase 1 hint now "The session stays paused until someone answers"; "viewers" chip removed from Phase 1 screens 6 and 7; screen 7b labelled "Phase 2" (tab link, badge, chip); 4.6 and 4.7 updated |
| G-D watch-only (Q1 (a)) | 4.9 rewritten as states 9, 9b, 9c, 9d; D16, D17; prototype screen 9 now watch-only with 9b/9c/9d variants; screens 7 and 7b unaffected. Screenshots `09-local-driver-*` need re-capture from the prototype (not done here: no browser run in this step); revise round 1: 9c remote vs local error copy, 9c no owner text or unverified history, 9b release-command limits, native disabled Stop and Send with measured contrast, remote shows `drivenBy` label only, README inventory |
