# Ptah attention notifications — visual specification

Status: prototype for Gate 1.7 review. Scope follows `context.md` → “Scope expansion 2026-10-19”, `task-description.md`, `parity-inventory.md`, and `decisions.md`. No production implementation is authorized by this document. Interactive reference: [prototype/notifications.html](prototype/notifications.html); capture list and controls: [prototype/README.md](prototype/README.md).

## Product rule and surface contract

Pending reply requests project to the snackbar and bell Needs you section from one keyed source. Failures and actionable warnings project to a snackbar and Recent notices without changing the count. Routine information and success remain local to their owning surface. Chat permissions, ask-user questions, and CLI-agent lane permissions remain live until the owning request resolves or withdraws. Dismissing a snackbar only hides that presentation. Successful and neutral finished turns produce no attention item, sound, OS notice, or bell row; their result remains in the session list. Failed turns and failed lanes create one failure item, as do actionable ActionBanner errors. Local field errors, conflict work, routine success, in-flight compaction, and passive activity stay in context.

| Event | Snackbar | Bell | Host notice |
| --- | --- | --- | --- |
| Permission | Persistent until resolved or presentation dismissed; Allow, Deny, Open session | Needs you until resolved; Allow, Deny, Open | Once per request when Electron unfocused or VS Code webview hidden/unfocused |
| Ask-user question | Same persistence; Answer, Open session | Needs you until resolved; Answer, Open | Same eligibility |
| CLI-agent lane permission | Same persistence; Allow, Deny, Open lane/session | Needs you until resolved; same source and count | Same request rule; host emits once across mounted tabs |
| Failed turn, failed lane, voice/tool/agent failure | Dismissible failure; Open session or relevant recovery | Recent failures until resolved or Clear all | Failure host setting off by default; only if enabled and unfocused |
| ActionBanner error/warning | Dismissible keyed notice, retaining tab scope; Open or recovery when available | Recent notices | No host notice for tab-local banner |
| Back-office failure: synthesis, embedder, indexing | Error snackbar with Open relevant context | Recent notices | Only when failure host setting is enabled and host is eligible |
| Git status unavailable | Show one keyed warning snackbar for 10s only while the git surface is not visible. When the git surface is visible, its dismissible local strip is the sole active presentation; Retry lives in strip and row. Dismissing the strip does not clear the row. | Recent notices while stale; Clear all clears history, fresh status confirms recovery | No OS notice |
| Routine info/success, including Branch created and skill synthesis paused/resumed | Short transient toast or inline text on the owning surface only; synthesis pause has no global replacement after ticker removal | None | None |
| Settings save/Undo, routine success, compaction progress | Local context only; no global item | None | None |

### Lifecycle and counts

Key by event kind + authoritative request ID or scoped condition key (`git-status:<workspace>`), not display title. A duplicate updates the same item and never replays host notice, sound, or announcement. Resolution removes the live item, snackbar, badge count and corresponding panel row together. Retry does not mark a condition resolved until fresh source state confirms recovery. A handled request invalidates all action handlers before presentation cleanup. Reconciliation on app/webview reveal reads current source state rather than trusting a queued event.

Unroutable requests remain counted with a disabled “Target unavailable” row. A surfaceMode request is counted once and opens its owning surface when known; otherwise show a disabled “Answer in &lt;surface&gt;” row with the reason. Multiple mounted webviews or attached tabs never multiply a request identity. Clear all notices removes only Recent notices and transient failure/warning snackbars. It leaves live request snackbars and Needs you rows untouched; those leave only on authoritative answer or withdrawal. A per-snackbar dismiss X may hide that request presentation without answering it. A failed turn receives one failure item for its stable terminal identity; a non-failure terminal reason receives none.

The bell badge alone shows **unresolved requests that need a reply**: chat permissions, ask-user questions, and CLI-agent lane permissions. Failure and actionable-warning history never inflates this count. One authoritative global count and keyed request identities cover all workspaces, including unroutable and surfaceMode requests once across attached tabs. Focused visible requests remain counted even when their snackbar is suppressed. At zero, the bell has no badge; at one or more, it displays N. The bell opens the single Needs you list with Allow, Deny, Answer, and Open actions, including lane permissions formerly available through the removed canvas chip. Failures and actionable warnings remain in Recent notices even when they offer recovery; routine info/success has no bell row.

## Layout and anatomy

The current design retains top tabs, bell at far right, canvas workspace rail, session sidebar, and composer. The canvas dock under the tabs is removed entirely, including its ticker, chip, and New Session action; the sidebar New session action remains. Snackbar host sits at the **top right of the canvas content area**, 16px below the tab bar and 18px inside the right edge at 1440px. Its 348px maximum width, 8px inter-item gap, 9px corner radius, 11px/12px padding, 3px semantic left border, and three visible item limit are `[lane-proposed]` geometry shown in the prototype. At 800px, use 10px inset and available width up to 348px. If available vertical space is shorter than the visible stack, collapse to one card plus the overflow control. At 420px and below, including the VS Code sidebar, show one request card plus overflow. The bell panel spans viewport minus 20px with 10px side gutters; the rail and wide shell navigation collapse in this prototype. At narrower widths, use `min(348px, viewport minus 20px)` and keep the composer unobstructed. These dimensions are prototype geometry, not preexisting project tokens.

A snackbar contains, in order: Lucide category icon; short, actionable title (one line where possible); one context line with safe workspace/session label; direct actions; and an accessible close button that hides its presentation. Permission uses `ShieldQuestion`; question `MessageCircleQuestion`; failure `CircleAlert`; actionable warning `TriangleAlert`. Left border and icon share semantic role color, while **text uses full `text-base-content` or measured `text-base-content-muted`**. Actions are `btn-primary` equivalent for the leading action and `btn-ghost`/outlined equivalent for alternatives. Allow and Deny are separate buttons; no action is triggered by dismissal. `Open session` focuses the exact workspace and session, and `Answer` opens the question in context. If session navigation is unavailable, disable the action and expose a reason in accessible text. For every permission, the in-app context line and Needs you row show agent/provider, Tool: <tool name>, and workspace; never tool arguments, paths, or prompt text. When tool name is unavailable, disable one-click Allow and retain Deny and Open session so the full request can be inspected. In-app failure snackbars and Recent failures bell rows may show the session title as context; this in-app rule does not inherit the host-notification privacy filter.

Newest live request appears first. Suppress the snackbar when its own session is visible and focused. Show at most three cards at desktop width; at 900px and below show one card so the stack does not cover the board content. Overflow is a `+N more` button that opens the bell to Needs you. A repeated event updates its existing card without moving it or replaying animation. When an item resolves, the next queued item enters the visible stack. A user-dismissed live snackbar does not reappear until the request changes materially or a new request arrives; its Needs you row remains. Do not visually stack finished-turn or passive activity notices.

Bell panel opens below the bell, aligned to the right. Existing component uses `surface-3`, `rounded-xl`, `w-80`, `max-h-[70vh]` at `notification-center.component.ts`; prototype uses 340px width and a 780px/viewport cap `[lane-proposed]` to fit three live rows and recent notices. Use one internal scroll area, with a sticky header: “Notifications”, existing sound toggle, and **Clear all notices**. Then “Needs you” with count and one row per live request, then “Recent notices” with failures and actionable warnings, workspace and session context, safe actions, and per-row dismiss. Avoid completion grouping and “Read all”. Empty state reads “All clear / Nothing needs your attention.” Clear all notices is enabled when a Recent notice or transient failure/warning snackbar is present; otherwise disabled. It clears only Recent notices and transient failure/warning presentations, never live request snackbars or Needs you rows. Pending requests leave only when answered or withdrawn. Limit retained dismissible history to 75 per the existing ledger cap; never evict live requests to satisfy the cap.

Open via bell click or keyboard activation; initial focus to the heading. Escape and outside click close and return focus to the bell. Do not trap focus in this nonmodal panel. When a panel is open, pause snackbar timeouts and hide redundant snackbars for that viewport.

## Time, motion, and accessibility

| Class | Presentation timeout | Stored item | Announcement |
| --- | --- | --- | --- |
| Chat/lane permission, question | None; user may dismiss presentation | Until resolved or withdrawn | Once per request, concise `aria-live=polite` status; no raw prompt |
| Actionable failure | 8 seconds; user may dismiss sooner | Until resolved or Clear all | One `role=alert`/assertive announcement when first raised |
| Actionable warning: ActionBanner or git stale | 10 seconds; user may dismiss | Recent notices until source resolves or Clear all | One polite warning; no polling repeats |
| Local routine info/success | 6 seconds if shown as a local toast; inline text follows owning surface | No bell item | No global attention announcement or sound |

Timeouts above are `[lane-proposed]` product behavior; existing context only specified per-severity timeouts. If an actionable warning cannot be completed in ten seconds, its action remains in Recent notices. Do not auto-dismiss while keyboard focus is inside a snackbar. Hover and focus pause/resume remaining time, rather than restart it. Dismiss button target at least 24×24px visually and 44×44px hit area where layout allows. Tab order follows rendered card order; action buttons are native buttons with visible focus `focus-visible:outline-2 focus-visible:outline-primary`. Opening the bell moves focus to the first enabled request row; if none, focus the panel heading. Escape or outside pointer closes and restores focus to trigger; the panel closes when emptied. Answer actions guard double submission. Do not autofocus snackbars or move focus on arrival. The shell-level announcer owns one announcement per item; snackbar host is a plain container with no live role; snackbar DOM itself is not a second live region. Sound follows new attention only, coalesced using the existing 350ms burst window and 2000ms cooldown, respecting `NOTIFICATION_AUDIO_ENABLED`; preserve active voice-session sound suppression and the bell sound mute control. Sound mute does not mute visual/assistive messages.

Entry/exit: 120ms opacity and 4px vertical translate `[lane-proposed]`; no bouncing or pulsing. Existing `.notification-row` uses 120ms motion in `notification-center.component.ts`. Under `prefers-reduced-motion: reduce`, remove transitions and transform. Reordering never animates the whole stack. Keep light/dark focus indication and labels intact.

## Host notice rules

Use the persisted host-notification Settings toggle described in `task-description.md`; general notices default on `[lane-proposed]`, failure host notices default off, and OS permission is respected. Electron emits a native `Notification` only when its Ptah window is unfocused. VS Code uses `window.showWarningMessage` for permissions, `showErrorMessage` for enabled failures, and `showInformationMessage` for questions, each with **Open Ptah**; emit only when no Ptah sidebar or panel webview is visible. Host messages are advisory, and direct Allow/Deny never run from a host notification. Title uses only fixed labels: “Permission needed”, “Question waiting”, “Session failed”. Body includes only sanitized workspace **folder name**, agent/provider name, and tool **name**; omit unavailable fields. Never include prompt or question text, tool arguments, file content/path, raw error, secrets, assistant text, or a session title in OS or VS Code host notifications. Session titles have no host-notification opt-in. Windows and VS Code examples: “Permission needed / ptah-extension · Claude · Tool: Bash”. One host notice per request key and lifecycle, emitted from host state only when the window is unfocused; group bursts and do not replay on page switching. Unsupported OS notification permission leaves in-app state intact and logs once without retry loops. Git stale has no host notice.

Clicking Electron native notice restores/shows/focuses the window, then routes to the current workspace/session when renderer ready. VS Code Open Ptah reveals the webview, re-reads current attention state, then routes to the target. `show*Message` has no close handle; when a request resolves elsewhere, its stale Open action only reveals the session and reports “Already answered” without executing a request action. This follows `decisions.md` #7. The mock Windows and VS Code notifications in the prototype demonstrate content hierarchy; their actual geometry belongs to the host OS/editor.

## Tokens and contrast

The authoritative project system is `apps/ptah-extension-webview/tailwind.config.js` plus `apps/ptah-extension-webview/src/styles.css` (surface ladder lines 147–163). The prototype embeds only the two eager themes for offline viewing; implementation uses DaisyUI classes and project variables so the other supported themes inherit their configured colors. No `text-base-content/NN` opacity text.

| Use | Exact project source |
| --- | --- |
| Dark body / row / panel | `bg-base-100` `#131317`; `bg-base-200` `#1a1a20`; `--surface-3: color-mix(in oklch, oklch(var(--b3)) 86%, oklch(var(--b2)))` |
| Light body / row / panel | `bg-base-100` `oklch(97.788% .004 56.375)`; `bg-base-200` `oklch(93.982% .007 61.449)`; same `--surface-3` formula using `base-300: oklch(91.586% .006 53.44)` |
| Primary text | `text-base-content`: dark `#e8e6e1`; light `oklch(23.574% .066 313.189)` |
| Secondary text | `text-base-content-muted` → `oklch(var(--bcm, var(--bc)))`: dark `66.509856% .007403 31.090978`; light `48.955188% .044796 348.478612` |
| Brand / action | dark `primary #2563eb` and `primary-content #f8f7f4`; light `primary oklch(85% .138 181.071)` and `primary-content oklch(36% .078 188.216)`; gold `secondary #d4af37` dark, `oklch(58% .132 75)` light |
| Semantic edge/icon | `text-state-need`, `text-state-err`, `text-state-run` or DaisyUI `warning`, `error`, `info`; icon and edge only, with full-opacity content text; prototype light warning/icon edge #8f5200 and error/icon edge #9b1c31 meet 3:1 |
| Panel edge/elevation | `--surface-border`, `--elev-shadow-raised` from `styles.css`; `surface-3 rounded-xl` from current bell component |
| Font | `font-sans` = Inter, system-ui, -apple-system, sans-serif; body 13px and titles 12–14px from current bell prototype/component sizing |

WCAG 2.2 AA normal-text criterion: **at least 4.5:1**. Ratios below were measured from rendered CSS colors in Chromium by `capture-screenshots.js` using the WCAG relative luminance formula. Values are for the prototype's base/row/panel surfaces; production `surface-3` blends a little differently and must be remeasured in implementation. Semantic icon contrast uses the separate 3:1 non-text criterion; color never acts alone as the severity label.

| Text / background | Dark | Light |
| --- | ---: | ---: |
| Base content / body base-100 | 14.86 | 15.92 |
| Base content / panel base-300 | 12.29 | 13.18 |
| Muted content / panel base-300 | 5.90 | 5.00 |
| Base content / row base-200 | 13.89 | 14.21 |
| Muted content / row base-200 | 6.66 | 5.39 |
| Primary content / primary button | 4.82 | 6.81 |
| Needs-you badge text / warning badge | 6.61 | 6.22 |
| Warning icon and 3px edge / panel base-300 (non-text, 3:1 minimum) | 5.47 | 4.83 |
| Failure icon and 3px edge / panel base-300 (non-text, 3:1 minimum) | 4.07 | 6.26 |

## Icon mapping

| Surface | Lucide name | Purpose |
| --- | --- | --- |
| Bell and count | `Bell` | Trigger; count is numeric text |
| Permission | `ShieldQuestion` | Direct consent request |
| Question | `MessageCircleQuestion` | User answer required |
| Failure | `CircleAlert` | Failure/action needed |
| Actionable warning | `TriangleAlert` | Warning snackbar and Recent notices |
| Local routine information | `Info` | Owning surface only; no global snackbar or bell row |
| Sound control | `Volume2` / `VolumeX` | Existing mute state |
| Dismiss | `X` | Presentation or dismissible history only |
| Clear all | `Trash2` | Dismissible history |
| Empty | `Check` | All clear |

## Parity map

This table maps **every** row of `parity-inventory.md`; capability wording is shortened here but order matches the inventory.

| Existing capability | New location / behavior |
| --- | --- |
| Bell trigger and unread badge | Shell bell; live needs-you count; ordinary notices do not inflate it |
| Bell opening, closing, focus restoration | Bell panel; first enabled row focus (heading if empty), then Escape/outside close to bell |
| Sound mute/unmute | Bell header, persisted existing sound preference |
| Read all for completion cards | Removed with completion history; Clear all is a distinct dismissible-history action |
| Per-completion dismiss | Removed; per-item dismiss on failure/recovery rows |
| Pending question and permission rows | Needs you, first panel section; same authoritative source as bell badge and snackbar |
| Pending row opens target session | Moves to bell Needs you row and snackbar; canvas chip removed by TASK_702 after this task merges (decision #14); host Open routes to target |
| Workspace labels and completion grouping | Workspace context in live/recent rows; no completion groups |
| Finished-turn success/failure entries | Success and neutral completion removed; failed turns become one keyed failure snackbar and Recent failures row |
| Ledger cap of 75 completion cards | Cap dismissible recent attention history at 75; never evict live requests |
| 350ms completion/attention burst merge | Coalesce attention sound/announcement only; no completion burst |
| Root-scoped announcer | Shell-level single attention announcement on all pages |
| Sound suppression in active voice session | Keep for attention cue |
| Canvas All clear / N need you chip and dock ticker/New Session | Approved removal under decision #13; bell badge is the only attention entry point, sidebar New session remains |
| Canvas permission Allow/Deny | Moves to bell Needs you row and snackbar; canvas chip removed by TASK_702 after this task merges (decision #14) |
| Canvas Open session | Moves to bell Needs you row and snackbar; canvas chip removed by TASK_702 after this task merges (decision #14); host Open remains |
| Git stale-status strip and last-known warning | Local strip when git visible; keyed snackbar only when git hidden; Recent notices retains Retry until Clear all or recovery |
| Git conflict workflow banner | Remains inline in conflict workflow |
| Back-office synthesis pause/rate-limit activity | Owning surface only when useful as transient text; no bell row, global snackbar, or count |
| Tab-scoped branch/rewind/editor action banners | Actionable failures to scoped snackbar/recent row; normal success contextual |
| Voice provider failure with switch-to-local | Failure snackbar/recent row with switch action; host notice only if failure setting enabled |
| In-flight compaction card | Remains inline progress; only actionable failure enters attention |
| Settings save/undo toast | Remains settings-local; actionable failure may enter attention |
| Electron information/warning/error message API | Keep dialogs for their uses; native attention uses dedicated notification capability |
| VS Code information/warning/error message API | Keep; map eligible host attention to `show*Message` with Open Ptah |
| VS Code webview delivery/readiness queue | Keep; reveal reconciles current state, host notice raised outside hidden renderer |
| CLI-agent lane permissions | Needs you row, bell badge, snackbar and host notice keyed by lane request identity; preserve Allow/Deny/Open |
| ActionBanner errors/warnings | One scoped failure/warning item in snackbar and Recent notices, with existing safe action |

## Deviations

The offline prototype uses inline CSS and a small mock board instead of compiled application CSS; it copies the two eager theme values and surface hierarchy from project sources. Chrome uses simplified symbols and text to identify tabs; production uses existing Lucide components. OS/editor notification frames are illustrative and do not constrain host-owned appearance. Prototype interactions mock action completion locally and do not exercise RPC, OS, sound, or persistence. The panel and snackbar geometry and timeouts are `[lane-proposed]` and require Gate 1.7 acceptance. Screenshots were captured at 1440x900, 800x900, and 400x800, inspected, and checked for composer collision; the bell-badge close-up is a 240x110 crop of the 1440x900 state. Decision #13 removes the entire canvas dock and its chip; `dark-chip.png` is replaced by `dark-bell-badge.png`. The bell badge alone counts Needs you requests. Git status unavailable is an actionable warning with Retry, local strip, and a recovery lifecycle.

## Decisions

Decision #12: The bell badge counts only unresolved Needs you requests. Failures and actionable warnings have snackbars and dismissible Recent notices rows without changing that count. Routine information and success stay on the owning surface as brief text or a transient local toast. Decision #13 supersedes the earlier chip reconciliation: the entire dock and chip are removed; the bell is the sole attention entry point. This follows the latest user instruction and is reversible.

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Anchor snackbars immediately under the tab bar at upper right of canvas | Upper right vs bottom right. Removed dock frees the area below tabs; the bottom composer still needs clearance. | Yes |
| Count unique chat and lane reply requests in the bell badge only | The approved dock removal eliminates the chip; the bell retains the keyed Needs you count. | Yes |
| Clear only dismissible history/presentations | Clear all requests vs retain live requests. `task-description.md` explicitly preserves unanswered permissions and questions. | Yes |
| Keep actionable git warning and recovery | Remove all non-request notices vs allow useful recovery. Original scope explicitly names stale git with Retry; expansion filters by actionability. | Yes |
| Treat host notices as advisory and privacy-filtered | Full prompt preview vs fixed short copy. Lock-screen privacy and cross-host routing risk in `task-description.md`. | Yes |
| Invalidate stale VS Code action after remote resolution | Retractable UI vs `show*Message`. `decisions.md` #7 records lack of a close handle and the agreed stale-action guard. | Yes |
| Bell alone shows the global Needs you count | The user-approved decision #13 removes the whole dock and chip, superseding earlier shared-count guidance. | Yes |
| Three visible snackbars and focused-session suppression | Unlimited stack vs cap; user/orchestrator limit is three plus overflow, with own focused session silent in the snackbar layer. | Yes |
| Separate general and failure host defaults | One setting vs separate failure setting. Revised `task-description.md` and orchestrator note require general on, failure off. | Yes |

## Lane-introduced constraints

- `[lane-proposed]` 348px snackbar maximum width, three-card stack, 8px gap, and `+N more` collapse.
- `[lane-proposed]` 340px panel width; implementation may retain existing `w-80` if content and focus review pass.
- `[lane-proposed]` 8s failure, 10s warning, and 6s local routine information toast times; live requests do not time out.
- `[lane-proposed]` host notification setting defaults on.
- [lane-proposed] Prototype light warning edge/icon #8f5200, error edge/icon #9b1c31, and white warning-badge text, measured above to meet contrast.
