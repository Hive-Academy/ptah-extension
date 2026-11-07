# Lane control design specification

Design system: existing webview Anubis / Anubis Light DaisyUI themes (`apps/ptah-extension-webview/tailwind.config.js`), with the app's `base-content-muted` and `state-*` tokens. Electron is the first host. The prototype is an interaction reference, not an implementation contract for backend capability values.

## Principles

1. Show the effective action before the press. Resolve modes from the live handle and lane status, then explain them in one fixed-height hint under the composer.
2. One primary action per composer: **Send**. **Send now** is a secondary outline action and never silently substitutes an interrupt for a steer.
3. Keep the same control order on card, grid, transcript, and inspector: lane identity, capabilities and policy, Stop/Resume, composer, delivery status. Use the compact variant outside the full transcript.
4. Use words and icons together for receipts. Color is supplemental. Preserve text, draft, and scroll position across state updates.
5. Distinguish potential CLI capabilities in Settings from effective live-lane capabilities on controls.

## Information architecture

| Surface | Always visible | On expansion |
|---|---|---|
| Lane card | Name, CLI, state, labelled capability/policy group, Stop or Resume, latest receipt, compact composer and mode hint | Queue summary and transcript link |
| Monitor grid tile | Compact single-line draft and split action, one queue/receipt summary line | Queue list and timeline in the selected lane detail |
| Lane tab / transcript | Full composer, receipt list, queue, unified communication timeline and completion verdict | Full timestamps and failure details |
| Inspector row and background strip | Name, state, labelled badges, Stop/Resume, latest receipt, compact composer | Opens lane transcript for queue and timeline |
| Settings → CLI tools | Manifest table, installation/status, enable switch, capability explanations | Row disclosure for unsupported policy combinations and limit-source detail |

At widths under 420px, badges wrap beneath identity, Stop/Resume remains at the right of the first row, and composer actions wrap into two full-width buttons. Do not truncate the mode hint or loss disclosure. At 420–700px the queue and timeline are single-column; above 700px, use the existing split/grid layout. Use no fixed width inside a resizable grid tile.

## Component specs

### Shared lane header and policy badges

Anatomy: 20px identity glyph, 14px semibold name, 12px CLI/state; second row is a labelled policy group in order `Messaging: steer`, `Permission: Ask`, `Network: denied`, `Limit: near` (substitute effective values). Permitted values are plan/ask/auto-edit/yolo; network allow/deny; limit tracked/near/at/no reliable source. On a running lane policy values are read-only; the group tooltip says `Permission and network chosen by parent at spawn` or `Adapter default` for omitted fields. Unsupported combinations say `This CLI cannot enforce {permission} with network {network}. Choose a supported combination before spawn.`

| State | Presentation |
|---|---|
| Running | `state-run` dot and `Running` |
| Idle | `state-idle` dot and `Idle` |
| Stopped | `state-idle` dot and `Stopped` |
| Near / at limit | `state-need` / `state-err` text and icon; never infer remaining capacity from unknown |

Tokens/classes: `bg-base-200`, `border border-base-300`, `text-base-content`, `text-base-content-muted`, `rounded-box`, `badge badge-outline`, `text-state-run/need/err/done`; 12px horizontal badge gap 6px, header padding 16px. Use `--bcm` muted tier, not alpha-dimmed body text. Badge tooltips are reachable by keyboard and duplicated as visible text in the Settings disclosure. Badge text contrast must meet 4.5:1 on its actual surface.

### Lane composer

FULL variant (lane tab/transcript): labelled textarea (minimum 44px, max 144px before scroll), fixed-height mode hint, Send primary and Send now outline, queue list only when nonempty, complete receipts and timeline. COMPACT variant (card, monitor tile, inspector row, background strip): labelled single-line input with split action `[Send | ▾ Send now]` and one summary line such as `2 queued · last: Received`. The menu item retains the exact Send now outcome and loss disclosure before press; it is focusable when disabled to expose the reason. Both variants keep 52px reserved for hint/disclosure and use the same planner result. Label `Message {lane name}`; placeholder `Message this lane…`. Draft stays on failed receipt; accepted drafts clear. Expose `aria-describedby` for mode hint and warning. Never relay a live lane message to main chat.

| Effective lane state | Send | Send now | Visible hint |
|---|---|---|---|
| Idle, continuation available | Starts a turn | Starts a turn | `Starts a turn` |
| Running, steer available | Queues next turn | Steers running turn | `Send: queued for next turn · Send now: steers into the running turn` |
| Running, interrupt + continuation | Queues next turn | Interrupts and resumes | `Send: queued for next turn · Send now: interrupts and restarts the turn` plus `Partial work in this turn will be discarded.` |
| Running, continuation only | Queues next turn | Disabled | `Send: queued for next turn · Send now: not supported by {CLI}` |
| Stopped, resumable | `Resume with message` if draft exists | Disabled | `Resume with message will {resume path}` |
| Unsupported or stale capability | Disabled | Disabled | `Messaging unavailable for {CLI}` |

Enter sends; Shift+Enter adds a line in FULL; Ctrl/Cmd+Enter sends now only when enabled; Escape closes the compact split menu first, then returns focus to lane header without clearing draft. Both message actions require non-whitespace text. Disabled Send now retains its reason through a focusable menu item/explanation. Queue-only lanes keep Send now disabled even if Stop/Resume exist: an explicit stop is a different action and should not be disguised as immediate messaging. Any transition from steer to interrupt requires the hint/disclosure to update before action; do not execute stale intent if the capability changes between render and press. The architect contract requires a separate explicit loss confirmation for interrupt-resume; the inline warning is the preview, not that confirmation.

### Queue and delivery receipts

Anatomy: `Queued messages (N)` heading; rows with short message preview, relative time, status label, Cancel and Send now where eligible. Queue row Send now uses the same effective mode hint and loss disclosure. When interrupt applies, its row action label is `Send now — interrupts turn` and the loss disclosure is visible before press. Cancel is available only before `started`; it yields `Cancelled`. Full receipt list lives with transcript; cards show latest plus pending count.

| Receipt | Copy | Treatment |
|---|---|---|
| Accepted | `Queued` | neutral clock; backend `accepted` |
| Started | `Sending` | running dot; backend `started` |
| Settled | `Received` then `Done` when turn settles | done check; backend `settled` |
| Failed | `Failed · {safe reason}` | error icon; Retry only if backend says retryable |
| Expired | `Expired · delivery was not confirmed` | warning icon; offer Copy message |
| Interrupted, undelivered | `Interrupted — not sent` | warning icon; offer Copy message and Resume |
| Cancelled | `Cancelled` | muted icon |

Status rows reserve a 120px status slot. `Received` is an optional intermediate display only when the backend reports actual recipient acceptance; otherwise render `Sending → Done`, never infer receipt. Announce terminal transitions once through a polite live region; failure is assertive only if user-initiated. Provide exact timestamp and message ID in the row detail for support. Hide queue section entirely when count is zero; compact surfaces show the one-line summary only.

### Stop / Resume

Anatomy: header-end secondary `Stop` while running; primary `Resume` when stopped/idle and continuation is possible. A typed draft exposes primary `Resume with message`; the draft becomes the first instruction in the selected resume path. The adjacent description must be visible before press: `Continue warm session`, `Resume CLI session {short id}`, or `Start fresh handoff`. Fresh handoff description: `Previous context is too large or too old. A summary will start a new session.` Trigger it proactively above approximately 150k context tokens or 10 minutes idle; warm handle continuation bypasses that gate. Unknown context by itself does not force fresh handoff. If no resume method exists, show disabled `Resume unavailable` with reason. Stop never erases pending receipt history. Keyboard: normal button activation; after Stop focus moves to Resume in place. `aria-live=polite` updates the resume description.

### Parent ↔ lane timeline

One chronological thread with sender labels `You`, `Parent agent · {CLI}`, `{lane label} · {CLI}`. Each You/Parent direction has a right-aligned receipt status. Message types: direction, lane report (`↗ Report` icon+text), completion (`✓ Completion` icon+text), parent signal. Report text preserves paragraphs, links and code as sanitized content; no raw HTML. Verdict chips: `Deliverables written`, `No deliverable`, `Failed`, `Unverified`. Parent signal states: `Waiting for parent`, `Sent to parent`, `Parent signal failed · retrying`. A waiting signal stays visible even if the parent is inactive; it is not a lane failure. Show absolute time on hover/focus and readable time in detail. Use a 2px left rule keyed to sender.

### CLI tools management

Settings → CLI tools table columns: CLI, Status, Messaging, Continue / Resume, Permission modes, Network, Limit source, Limit state, Enabled. Status is `Installed`, `Not found`, or `Needs setup`; enabled switch is separate from installation. Manifest values come from backend; unverified values say `Unverified`, never optimistic support. Capability cells show exact supported values or `Unavailable` with a reason tooltip. Limit state is `Tracked`, `Near limit`, `At limit`, or `No reliable source`; a reader is CLI/account-specific. Each row has a disclosure explaining messaging, resume, policy enforcement, and reader provenance. Table has sticky header on large viewport; at narrow width each row becomes a labeled definition list. Above table: `These are CLI capabilities. A running lane may offer fewer actions.`

Verified baseline for adapter rows (potential, not live): Codex steer/queue; Cursor interrupt/queue; Pi steer/queue (router fix pending); Claude, Copilot, OpenCode, Grok queue; Antigravity queue when stream-JSON is detected, otherwise unavailable. Ptah CLI providers use a separate provider session and have no declared steer. Reliable limit readers are registered for Anthropic, OpenAI Codex, and Ollama Cloud; Copilot, Cursor, Pi have no reliable source. Permission support remains `Unverified` or `Unsupported` until the adapter manifest enforces it; only Claude/Ptah provider mappings and Codex native sandbox mappings are evidenced. Network deny is not presumed from web-search filtering.

## State machine

Backend state remains `accepted → started → settled`, with `failed | expired | interrupted-undelivered` terminal branches. UI maps these to `Queued → Sending → Done`, with `Received` shown only on a distinct confirmed recipient-acceptance event. `accepted` is durable admission, `started` is CLI turn entry, `settled` means backend confirms handling. A queued item remains `Queued`; on lane stop, show explicit failure/interruption. A receipt that can no longer be looked up becomes `Expired`, never silently disappears. The UI renders receipt data from the shared coordinator; it does not infer success from an RPC response alone.

Availability is computed from `(lane status, effective live messaging capability, resume gate, draft nonempty, request pending)`. Default Send chooses queue for running lanes with continuation, and starts an idle turn. Send now chooses steer if effective steer exists; otherwise interrupt + resume only if both are effective; otherwise it is disabled with a reason. Stop and policy badges never change the pending draft. Revalidate capability atomically at invocation and return actual delivery mode for the receipt; if mode differs from the preview, explain it in the receipt.

## Copy deck

Primary labels: `Send`, `Send now`, `Stop`, `Resume`, `Cancel`, `Copy message`, `View all`, `CLI tools`.

Mode copy: `Queued for next turn`, `Steers into the running turn`, `Interrupts and restarts the turn`, `Partial work in this turn will be discarded.`, `Not supported by {CLI}`, `Starts a turn`, `Resume this lane to send a message`, `Messaging unavailable for {CLI}`.

Queue and receipt copy: `Queued messages ({count})`, `{count} queued · last: {status}`, `Queued`, `Sending`, `Received`, `Done`, `Failed · {safe reason}`, `Expired · delivery was not confirmed`, `Interrupted — not sent`, `Cancelled`. Completion copy: `Deliverables written`, `No deliverable`, `Failed`, `Unverified`. Parent signal copy: `Waiting for parent`, `Sent to parent`, `Parent signal failed · retrying`.

Policy/limit copy is specified under header and Settings. Avoid shorthand `yolo` in explanatory text; badge retains the existing product mode name `Yolo`.

## Mapping to existing components

| Existing file | Change |
|---|---|
| `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts` | Replace single-purpose steer input with shared two-action lane composer presentation; preserve existing composer-card classes. |
| `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts` | Embed compact shared controls and latest receipt. |
| `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane-composer.component.ts` | Bind effective capability, both actions, draft and receipt store. |
| `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts` | Host queue and attributed communication timeline. |
| `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts` | Keep resizable grid; place compact controls within supplied detail template, without changing split layout. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card*.component.ts` | Shared header badges, Stop/Resume, compact composer and latest receipt. |
| `libs/frontend/chat-ui/src/lib/molecules/lane-result/lane-result-card.component.ts` | Show verdict and parent-delivery state. |
| `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts` | Compact shared controls and transcript navigation. |

New presentation components: `lane-control-composer.component.ts`, `lane-capability-badges.component.ts`, `lane-receipt-list.component.ts`, `lane-queue-list.component.ts`, `lane-communication-timeline.component.ts`, `cli-tools-management.component.ts`. One data-access lane-control store owns effective capability, receipt and queue state, with RPC through `ClaudeRpcService` and message handlers. Exact ownership follows the architect contract once populated.

## Decisions

- Use Anubis and Anubis Light, not a new visual language. Evidence: webview Tailwind theme and existing composer classes. Reversible: yes.
- Keep Send as default queue for a running lane, even if steer exists. Evidence: user task and architect UX contract. Reversible: yes.
- Keep Send now disabled on queue-only lanes instead of offering Stop/restart. Evidence: stop changes lane lifecycle and can discard work, whereas Send now is defined as an immediate message mode; separate Stop remains available. Reversible: yes.
- Use neutral disabled fills and full-contrast disabled labels. Measured WCAG contrast: dark `#e8e6e1` on `#242430` is 12.29:1; light `#302635` on `#e9e5df` is 11.51:1. Avoid opacity on disabled buttons. Evidence: Anubis token values and sRGB luminance calculation. Reversible: yes.
- Show loss disclosure inline before interrupt, including queue-row Send now. Evidence: current router interrupts/resumes and discards partial work. Reversible: yes.
- Show capability manifest in Settings, effective handle capability on lanes. Evidence: static adapter declarations and live handle override in router. Reversible: yes.

## Assumptions

- Architect `implementation-plan.md` now defines `CliAdapterManifest`, effective capability resolution, `agent:previewMessage`, `agent:sendMessage`, pushed receipt updates, and explicit loss confirmation. This spec uses those names. Remaining gap: it does not define a separate backend `received` event, so that UI stage is conditional and must not be fabricated from `started` or `settled`.
- Prototype examples are illustrative combinations, not claims that installed CLIs support every displayed policy. Unsupported combinations remain disabled until backend validation supplies reasons.
- No new imagery is needed; existing Lucide glyphs and CSS state dots suffice. No asset could not be generated.
