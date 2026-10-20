# Attention-first unified notifications

## Outcome and classification

People using Ptah in Electron or VS Code can spot and act on requests that need them without a stream of finished-turn notices or large persistent strips. One attention state drives the small snackbar, bell panel, and eligible host notification. The bell becomes the single attention place after TASK_2026_702_594d removes the canvas dock and needs-you chip. The [parity inventory](parity-inventory.md) records the current surfaces before redesign.

**Type:** FEATURE, as carried by `task.md`: this adds cross-host attention behavior and changes existing UI. **Estimate:** XL, as carried by `task.md`: the work crosses shared event/RPC contracts, two hosts, several Angular surfaces, accessibility, and migration. The existing `task.md` title/description still reflects the superseded 2026-10-02 scope; the 2026-10-19 section of `context.md` governs this description. No priority is assigned because the task does not define a priority scale.

## In scope

- A single keyed model for unresolved permissions and ask-user questions, including CLI-agent lane permissions. The same model tracks failure and actionable-warning notices separately from pending requests. It records source, workspace, session, lifecycle, severity, safe actions, and whether the item remains actionable. Duplicate events update one item; resolution removes live UI everywhere.
- Small, dismissible, keyboard-operable snackbars in Electron, the VS Code webview, and canvas; pending request prompts persist until handled or snoozed from view without losing the underlying request. An actionable failure persists in the bell until resolved or cleared. Snackbars never cover primary actions.
- Bell panel with "Needs you" first, "Recent notices" for failures and actionable warnings, clear labels and workspace context, a badge counting only unique unresolved "Needs you" requests, per-item dismissal for dismissible notices, Clear all, sound control, and navigation. The bell provides CLI-agent lane permission Allow, Deny, and Open actions previously available in the canvas chip. Clear all clears recent notices and transient presentations; it does not decline, answer, or hide live requests from "Needs you."
- Host-level attention: Electron OS `Notification` while its window is unfocused, with click showing/restoring/focusing the window and opening the correct workspace/session; VS Code host `show*Message` with an Open action while the webview is hidden or unfocused, revealing Ptah and its target. A user-facing toggle controls host notices. Host messages are advisory; live state is re-read on webview reveal.
- Migrate the original-scope notices according to their behavior: git stale status keeps a keyed, dismissable local strip and receives a snackbar and Recent notices row while the git surface is open; all resolve when status recovers. ActionBanner errors/warnings and voice-provider failures retain their existing actions; back-office failures receive safe, concise failure notices with Open relevant context only when a target exists, plus Dismiss. Routine ActionBanner info/success stays local as transient feedback or inline text. Routine back-office progress, including skill-synthesis pause/resume, has no user-facing presentation after the ticker is removed. Other original sticky non-dismissable strips become keyed, dismissable local presentations that resolve when their condition clears. Preserve the settings Undo flow and in-flight compaction status.
- Sound and screen-reader announcement behavior tied to new attention only, with duplicate/burst suppression and the existing voice-session sound guard.

## Out of scope

- Finished-turn completion notices in snackbar, bell, OS, and sound/announcer; removal is approved in `context.md`. Turn state remains in the session list.
- Form/field validation messages and the git conflict workflow banner: these require the user to see the affected form or conflict context.
- Routing routine successful actions, successful settings saves, and in-flight compaction into the bell or host notices: they retain local contextual feedback. Routine back-office progress is suppressed from user-facing surfaces by the approved ticker removal.
- A general message archive or cross-device notification sync: the requested bell is an attention place, not a history product.
- Canvas dock, needs-you chip, back-office ticker, chat start screen, and setup-card implementation: TASK_2026_702_594d owns their removal or changes. This task does not edit the dock or `orchestra-canvas.component.ts`.

## Acceptance criteria

1. When a new chat permission, ask-user question, or CLI-agent lane permission arrives, the system shall show exactly one live "Needs you" row in the bell and an eligible small actionable snackbar unless its owning surface is focused and visible; the bell shall expose the lane permission's Allow, Deny, and Open actions.
2. When Allow, Deny, or Answer succeeds in any surface, the system shall resolve that request by stable identity and remove its snackbar, bell "Needs you" row/badge count, and Electron OS notification without a stale reappearance on page change or webview reveal; a VS Code message action selected after resolution shall detect that it is stale and shall not act on the answered request.
3. When a request is answered from a different session view or host-side path, the system shall reconcile from the authoritative pending state and clear all local presentations on the next state update; a dismissed snackbar shall not answer the request.
4. When a duplicate event with the same request/condition key arrives, the system shall update its existing attention item and shall not add another row, snackbar, sound burst, or host notice.
5. When several workspaces have pending items, the system shall preserve in-app workspace/session labels, count unique unresolved requests, and open the originating workspace and owning session or surface from bell, snackbar, or host action.
6. When the user opens the bell, the system shall show "Needs you" before "Recent notices" failure/actionable-warning rows, offer Clear all, and exclude every successful or neutral finished-turn completion row and routine info/success message.
7. When Clear all is used, the system shall remove dismissible Recent notices rows and transient presentations, including live-request snackbars, while keeping unanswered chat/lane permissions and questions accessible and counted in "Needs you"; it shall not perform Allow, Deny, or Answer.
8. When a turn finishes successfully or with a listed non-failure reason and has no separate failure event, the system shall keep its result in the session list and shall emit no bell row, snackbar, OS/host notice, completion sound, or live announcement.
9. When a failure occurs, the system shall provide a concise snackbar and dismissible "Recent notices" row until resolution or Clear all, with a working recovery/Open action when a target exists and Dismiss otherwise; neither shall increase the badge count.
10. When a git status becomes unavailable, the system shall keep one keyed, dismissable local strip, show one workspace-scoped warning snackbar with Retry while the git surface is open, and add a dismissible "Recent notices" row without changing the badge count; when a fresh status is received, it shall remove the live warning from all surfaces automatically.
11. When routine back-office progress occurs, including skill-synthesis pause/resume, the system shall show no ticker, bell row, badge change, snackbar, host notice, or attention sound.
12. When a voice provider fails, the system shall offer the existing switch-to-local path through the unified attention surface; successful switch shall resolve the item.
13. When Electron is focused, the system shall use in-app attention without a redundant OS notification. When it is unfocused and host notices are enabled, it shall raise at most one native notification per eligible request, grouped within the burst window; click shall show/restore/focus the window and route to the correct session.
14. When no Ptah VS Code sidebar or panel webview is visible and host notices are enabled, the extension shall surface an actionable non-modal host message without depending on Angular being mounted; Open shall reveal Ptah and its target, and the webview shall reconcile current state on reveal.
15. When host notices are disabled in settings, the system shall stop new OS/VS Code host notices while keeping the bell and in-app snackbar active, including when canvas is open; the setting shall survive host restart.
16. When OS/host text is constructed, the system shall show only the fixed event/action label, workspace basename, agent/provider name and tool name; it shall never include secrets, full prompts/questions, tool arguments, file contents, or raw error text.
17. When a snackbar or bell control receives keyboard focus, the system shall expose a named action and visible focus, support activation/dismissal without a pointer, and return focus sensibly after the surface closes.
18. When a screen reader is active, the system shall announce new attention once, use polite live behavior for ordinary requests and assertive behavior only for urgent errors, and avoid announcing a request again when the bell opens or the view changes.
19. When reduced motion is requested, the system shall present and dismiss snackbars without motion; in dark and light themes, controls and text shall remain readable and pass axe with no critical/serious issues and meet AA contrast.
20. When the request's tab has an active voice session or sound is muted, the system shall suppress the attention sound while retaining visual and screen-reader cues; resolved items shall not generate a second sound.
21. When the task is delivered, focused unit/integration coverage shall exercise deduplication, resolution from elsewhere, Clear all semantics, lane permission Allow/Deny/Open in the bell, multi-workspace targeting, host focus/reveal actions, privacy filtering, settings persistence, and accessibility states in both hosts.

## Non-functional constraints and placement

- Angular components follow standalone, `OnPush`, `inject()`, and signals; frontend host communication uses `ClaudeRpcService` and `MESSAGE_HANDLERS`. Do not use `text-base-content/NN` alpha utility classes. Respect reduced motion and AA contrast in dark and light.
- A new host capability is a port in `libs/backend/platform-core` with Electron, VS Code, and CLI adapters in `platform-electron`, `platform-vscode`, and `platform-cli`; host-neutral libraries never import `electron` or `vscode`. The CLI can safely no-op host display while preserving the port contract.
- Validate new IPC/RPC payloads with Zod at the boundary. The RPC contract belongs in `libs/shared/src/lib/types/rpc.types.ts`; host notifications carry safe, bounded display fields and stable target identity, not raw prompt data.
- Notification preferences belong with existing settings infrastructure: `libs/backend/settings-core/src/schema/index.ts` registers Zod definitions, `libs/backend/platform-core/src/file-settings-keys.ts` routes file-backed keys, and `settings:get`/`settings:set` are declared in `libs/shared/src/lib/types/rpc.types.ts:1678`. Current sound mute is only a localStorage key in `notification-sound.service.ts:3`; no notification setting exists in the inspected settings schema. A persisted host-notification toggle must be exposed in the existing Settings page rather than relying on localStorage alone.
- Root-level notification behavior must work while Settings or canvas is open, as the current ledger explicitly intends (`notification-ledger.service.ts:108`). Live requests must never be evicted by a bounded history cap.

## Stakeholders

- Electron users need timely, private, actionable attention while Ptah is in the background and a click that reaches the relevant session.
- VS Code users need a host action when the sidebar is hidden and correct state on reveal.
- Canvas users need the bell to provide the CLI-agent lane permission count and Allow/Deny/Open actions that the removed dock chip provided.
- Screen-reader and keyboard users need meaningful announcements and complete action access without duplicate speech.
- Maintainers need one event lifecycle and tests that prevent completion noise or cross-workspace misrouting from returning.

## Attention and surface contract

### Attention set and surface rules

A **pending request** is a chat permission, ask-user question, or CLI-agent lane permission. All three use one authoritative keyed model and their existing responders. The bell badge and "Needs you" count equal the number of unique unresolved requests across all workspaces; failures, warnings, and routine information never increase the count. The bell replaces the canvas chip as the only attention place and exposes lane permission Allow, Deny, and Open actions with the existing double-answer guard. Unroutable requests remain counted and show a disabled "Target unavailable" row. A surfaceMode request remains counted once: when its owning surface is known, bell, snackbar, and host Open actions focus that surface and its request chrome; when it cannot be resolved, the row is disabled and labelled "Answer in <surface>" with an unavailable-target explanation, and no action is attempted. Multiple attached tabs must not multiply one request identity.

A **failure** is a terminal turn with phase `failed` or terminal reason `api_error`, `model_error`, `image_error`, `budget_exhausted`, `blocking_limit`, `rapid_refill_breaker`, `prompt_too_long`, `turn_setup_failed`, `malformed_tool_use_exhausted`, or `structured_output_retry_exhausted`; a failed CLI-agent lane; an ActionBanner error/warning; or a back-office failure such as skill synthesis failed, embedder error, or indexing failed/degraded. Non-failure terminal reasons `completed`, `aborted_*`, `background_requested`, `hook_stopped`, `stop_hook_prevented`, `tool_deferred*`, and `max_turns` produce no completion item. Failed turns remain actionable notices even when they simply indicate the run ended; failures offer Dismiss and Open session/relevant context when a reliable target exists. Failed turns, lane failures, and back-office failures have a snackbar and a bell "Recent notices" row; their OS/host notice appears only when the separate failure host-notice setting, off by default, is enabled and the background rule is met. This setting gates only OS/host notices: snackbars and bell rows remain active. Error snackbars have a longer auto-dismiss interval or remain until dismissed, with bell history retained. Only successful/neutral finished-turn notices are removed.

ActionBanner errors and warnings become tab-scoped failure snackbars and bell "Recent notices" rows with Open/Dismiss. ActionBanner info, including "Branch created" and rewind completion, stays tab-local as a short transient toast or inline text; it never enters the bell or global snackbar stack. Back-office failures become failure snackbars and bell "Recent notices" rows with safe fixed labels and Dismiss; Open relevant context is offered only when a reliable target exists. Raw back-office error summaries may contain diagnostic content and are not copied into the notice. Routine back-office progress, including skill-synthesis rate-limit pause/resume, has no presentation after ticker removal. Git stale status keeps its local strip and adds a keyed warning snackbar only while a git surface is open plus a "Recent notices" row, with no host notice; the first-read unavailable body stays inline. Existing sticky local strips become dismissable and keyed, then resolve when their underlying condition clears. Voice-provider failure retains switch-to-local and never auto-applies it; while voice interaction is active it raises no host notice.

The bell badge counts only unresolved "Needs you" requests. Failure and actionable-warning rows belong to "Recent notices" and never change the count. Routine info/success has no bell row. Clear all clears dismissible "Recent notices" rows and transient presentations, including a live request's snackbar, but never answers or hides the request from "Needs you".

### Event-to-surface matrix

| Event | Snackbar + persistence | OS/host notification + when | Bell section | Badge count | Sound/announce |
| --- | --- | --- | --- | --- | --- |
| Chat permission | Small actionable prompt until answered or dismissed from view | General host setting on and host background eligibility; one per request | Needs you until resolved | Yes, unique request | One gated attention sound and polite announcement |
| Ask-user question | Small actionable prompt until answered or dismissed from view | General host setting on and host background eligibility; one per request | Needs you until resolved | Yes, unique request | One gated attention sound and polite announcement |
| CLI-agent lane permission | Small actionable prompt until answered or dismissed from view | General host setting on and host background eligibility; one per request | Needs you until resolved | Yes, unique request | One gated attention sound and polite announcement |
| Failed turn | Error snackbar, longer timeout or dismiss; Open session | Failure host setting on and background eligibility | Recent notices until dismissed/Clear all | No | One gated error sound and assertive announcement |
| Failed CLI-agent lane | Error snackbar, longer timeout or dismiss; Open relevant context | Failure host setting on and background eligibility | Recent notices until dismissed/Clear all | No | One gated error sound and assertive announcement |
| ActionBanner error/warning | Tab-scoped snackbar; Open/Dismiss; error has longer timeout | No host notice for tab-local banner | Recent notices until dismissed/Clear all | No | Error: one gated sound/assertive announcement; warning: polite announcement |
| ActionBanner info/success | Short tab-local toast or inline text; no global snackbar | None | None | No | No attention sound or announcement |
| Git status unavailable | Keyed warning with Retry while git surface is open; keyed dismissable local strip remains; both resolve on fresh status | None | Recent notices; dismiss/Clear all or recovery | No | Polite announcement once; no attention sound |
| Routine back-office progress, including skill synthesis pause/resume | None; removed ticker has no replacement | None | None | No | No attention sound or announcement |
| Back-office failure, including synthesis, embedder, and indexing failures | Safe error snackbar, longer timeout or dismiss; Open only when a reliable target exists | Failure host setting on and background eligibility | Recent notices until dismissed/Clear all | No | One gated error sound and assertive announcement |
| Voice-provider failure | Scoped error snackbar with manual switch-to-local; longer timeout or dismiss | Failure host setting on and background eligibility, except during active voice interaction | Recent notices until dismissed/Clear all | No | Assertive announcement; sound suppressed during active voice session |
| Successful/neutral finished turn | None; result remains in session list | None | None | No | No completion sound or announcement |

Host background eligibility means Electron's window is unfocused or no Ptah VS Code sidebar/panel webview is visible. The failure host setting gates only its OS/host column; it never gates snackbars or bell rows. Unroutable and surfaceMode request variants follow their request-class row, with the disabled-target behavior above. Existing voice-session mute, global mute, 2000 ms cooldown, audio-enabled gate, and duplicate/burst suppression apply to all attention sounds.

At most three snackbars are visible. Further eligible items collapse into one "+N more" entry that opens the bell. A request whose owning surface is visible and focused shows no snackbar because its inline prompt is visible; the bell still counts it. Snackbars cannot overlap the chat composer/send button or inline permission actions at Electron and VS Code sidebar sizes.

Host notice eligibility: Electron only when the app window is unfocused; VS Code only when **no** Ptah sidebar or panel webview is visible. VS Code `show*Message` is a VS Code window message, not a guaranteed OS notification. Host state sends at most one notice per request regardless of mounted webviews and groups arrivals in the existing burst window. The general host-notice setting is enabled by default; a separate failure host-notice setting is disabled by default. Neither affects in-app attention. When native notifications are unsupported, denied, or suppressed by the OS, retain in-app attention, do not throw or retry in a loop, and log once. A stale VS Code host action shall do nothing to the answered request, open its session, and say "already answered"; if a retractable surface is chosen, it closes on resolution.

Host text defaults to a fixed event label ("Permission needed", "Question waiting", "Session failed"), fixed action label, workspace folder basename, agent/provider name, and tool **name** only. Session titles derived from user messages, prompts, questions, raw errors, file contents, tool arguments, and secrets are excluded. A separate title-display opt-in may show the session title and defaults off; it never permits prompt/body text, arguments, or secrets. The text builder must pass a canary test spanning all excluded fields.

### Additional acceptance criteria

22. When a turn ends with a listed failure reason or failed phase, the system shall create one failure snackbar and "Recent notices" row with Open session regardless of the failure host setting; only its OS/host notice depends on that setting and background eligibility, and listed non-failure reasons shall create no completion item.
23. When a fixture includes chat permission, question, lane permission, unroutable request, surfaceMode request and multiple attached tabs, the bell shall count each unique unresolved identity once and provide Allow, Deny, and Open for a routable lane permission through its existing responder.
24. When more than three snackbars qualify, the system shall show at most three plus one "+N more" bell action; when the request's owning surface is focused and visible, its snackbar shall be absent while the bell count remains.
25. When snackbar placement is checked at Electron and VS Code sidebar sizes, it shall not cover the composer/send button or permission card buttons.
26. When host notice text is built from a request with canaries in title, question, tool input and raw error, the default notice shall contain none; when multiple webviews are mounted, extension-host state shall emit at most one notice per request and group burst arrivals.
27. When native host notification support/permission is absent, the system shall preserve in-app attention, avoid throwing/retry loops and log once.
28. When Clear all or snackbar dismiss hides a live request presentation, the request shall remain in "Needs you"; activation shall use the existing responder and guard against double answer.
29. When the bell opens, focus shall move to the first enabled row; Escape and outside-pointer dismissal shall restore focus, the bell shall update when requests resolve elsewhere, and its lane permission answer actions shall be guarded against double submission.
30. When accessibility is checked, axe shall show no critical/serious issue, dark and light themes shall have AA contrast, and reduced motion shall avoid snackbar animation.
31. When a voice-provider error appears, the switch-to-local action shall remain available and shall never run automatically. When the request's own tab has an active voice session, attention sound shall be suppressed; the existing 2000 ms cooldown and `NOTIFICATION_AUDIO_ENABLED` gate remain.
32. When a surfaceMode request is activated from the bell, snackbar, or OS/host action, the system shall focus its owning surface and request chrome when the owner is known; when unavailable, it shall show a disabled "Answer in <surface>" row with an unavailable-target explanation and shall not attempt an answer.
33. When branch creation or rewind completion occurs, the system shall keep its short transient or inline feedback local and shall create no bell row, badge increment, global snackbar, or host notice; when routine back-office progress occurs, including skill-synthesis pause/resume, it shall create no user-facing notice or ticker entry.
34. When a sticky local warning strip is dismissed or its condition clears, the system shall hide that keyed local presentation; dismissing it shall not claim the condition recovered, and a later distinct occurrence may be presented again.
35. When skill synthesis, embedding, or indexing reports a failure or degraded failure condition, the system shall show a safely labelled failure snackbar and a dismissible "Recent notices" row, with Open only if a reliable target exists and without increasing the bell badge; an OS/host notice shall appear only if the failure host-notice setting is enabled and the host is background eligible. Raw diagnostic text shall not appear in these notices.

### Phasing and ownership correction

Phase A owns the shared contract, `rpc.types.ts` additions, snackbar host and mounts in Electron/VS Code shells, and bell model including lane permission actions. Phase B follows A and owns host notices and any further shell or `rpc.types.ts` integration. Phase C follows A/B and migrates the scoped notices, including back-office failures, without editing the shells or `rpc.types.ts`. TASK_702 owns dock removal, the needs-you chip and ticker removal, start-screen, and setup-card files. This task does not edit `orchestra-canvas.component.ts` or the dock.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Retain failed turns, lane failures and ActionBanner errors/warnings; remove successful/neutral completion notices only | Remove all completions; split success/failure | User approval covered finished-turn noise; reviewer S1 and ledger terminal reasons | Yes |
| Use one pending model including lane permissions | Exclude lanes; include lanes | Canvas already counts `agents.pendingPermissions()`; reviewer S2 | Yes |
| Count unroutable and surfaceMode requests once | Drop or duplicate; count by request identity | Ledger currently fans out tabs and filters surfaceMode; reviewer S2 | Yes |
| Private default host text and separate title opt-in off | Show titles; fixed allowlist | Titles may derive from first user message; reviewer S3 | Yes |
| Three snackbar cap and focused-inline suppression | Unbounded; bounded | User requests low distraction; reviewer S4 | Yes |
| General host notices on, failure host notices off | Both on; both off | User requests system notice while failures can be noisy; orchestrator decision | Yes |
| VS Code stale actions invalidate, retract if surface permits | Require close; invalidate | `decisions.md` #7; `show*Message` has no close handle | Yes |
| Back-office failures receive a failure notice; routine progress has no presentation | Keep ticker/local status; remove ticker and surface failures | User-approved dock/ticker removal in `decisions.md` #13 | Yes |
| Git stale has no OS notice | Notify; in-app warning | Poll may self-recover; reviewer M4 | Yes |
| Bell badge counts only pending Needs you requests; failures/actionable warnings appear in Recent notices; routine info/success stays out of bell | Count all unread rows; count only pending requests | Orchestrator final R1 decision in `decisions.md` #12, refining #8; user wants only important attention | Yes |
| Remove the canvas dock/chip/ticker in TASK_702; make this task's bell cover chip actions without editing the dock | Retain chip; remove chip and migrate actions | User-approved decision in `decisions.md` #13 | Yes |

## Risks and mitigations (revision 1)

| Risk | Likelihood | Impact | Owner | Mitigation |
| --- | --- | --- | --- | --- |
| Stale request acts twice | Medium | High | Architect | Key by request identity, reconcile authoritative pending state, guard responder completion |
| Private host text leaks on lock screen | Medium | High | Host implementer | Build allowlisted text and test canary exclusion |
| Multiple webviews duplicate host notices | Medium | Medium | VS Code implementer | Emit from extension-host state once per request |
| Electron click arrives before renderer is ready | Medium | Medium | Electron implementer | Restore/focus then queue target until renderer ready |
| Dock removal strands lane permission actions | Medium | High | Frontend implementer | Bell provides lane Allow/Deny/Open and tests its responder and double-answer guard before TASK_702 removes the dock |
| Clear all obscures unresolved permission | Medium | High | Frontend implementer | Derive Needs you from authoritative pending state |
## Handoff

ui-ux-designer, then software-architect, as specified by `context.md`. The architect chooses design, libraries and file layout within the ownership boundary above.

## Open questions

None for this requirements handoff.




