# Electron attention rail redesign â€” proposal for Gate 1.7

Scope: visual and interaction design only. The clickable comparison is [prototype/attention.html](prototype/attention.html). This proposal restores pending requests inside the **Sessions rail** while retaining the existing bell, snackbars, and OS notices. Every rule introduced here is marked **proposed**; the approved notification contract below remains authoritative. No implementation may start before Gate 1.7 approval.

## Goals and system source

- Make the pending question visible beside its session in the canvas rail, with a route to answer it. **proposed**
- Make session name and workspace visible on every snackbar and bell card, then make request kind, short detail, and action scannable. **proposed**
- Replace full orange/blue card borders with a quiet raised surface and a state-colored icon plus 3px accent. **proposed**
- Keep the existing `anubis` / `anubis-light` DaisyUI 4 themes, Inter typography, status inks, and `surface-1/2/3` utilities. Sources: `apps/ptah-extension-webview/tailwind.config.js`, `apps/ptah-extension-webview/src/styles.css`; do not create a new theme.

## Shared attention card anatomy

The same content order and actions apply to snackbar and bell rows. Width changes padding, not information priority. All dimensions below are **proposed** unless named as existing.

| Element | Exact classes / value | Source |
| --- | --- | --- |
| Shell | `surface-3 relative rounded-2xl border border-[color:var(--surface-border)] shadow-[var(--elev-shadow-raised)] p-3` for snackbar; `surface-2 rounded-xl border border-[color:var(--surface-border)] shadow-[var(--elev-shadow)] p-3` for bell row | `styles.css` surface and elevation tokens; proposed 16/12px radii and 12px padding |
| State accent | `absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-state-need` for pending; `bg-state-err` for failure. Icon `size-4 text-state-need` / `text-state-err`; question uses MessageCircleQuestion, permission ShieldQuestion, lane permission CircleAlert | `tailwind.config.js` state inks; proposed 3px accent |
| Header | `flex items-start gap-2`; kind title `text-[11px] font-semibold uppercase tracking-[0.06em] text-base-content-muted`; time `ml-auto text-[11px] text-base-content-muted`; dismiss `btn btn-ghost btn-square size-8 min-h-8` with a 44px hit target overlay where space permits | Existing component buttons and muted token; proposed hierarchy |
| Identity | session `mt-1 truncate text-sm font-semibold text-base-content`; second line `flex min-w-0 items-center gap-1.5 text-xs text-base-content-muted`; provider plain text, workspace chip `max-w-[11rem] truncate rounded-md border border-[color:var(--surface-border)] bg-base-200 px-1.5 py-0.5 text-[11px] text-base-content` | Existing `base-*`, muted and surface border; proposed hierarchy |
| Detail | `mt-2 truncate text-xs text-base-content-muted`; question preview or safe tool name, one line; use title tooltip for full safe text | Existing muted token; proposed one-line clamp |
| Actions | `mt-3 flex flex-wrap items-center gap-1.5`; one `btn btn-primary btn-sm min-h-9` for Answer or Allow; `btn btn-ghost btn-sm min-h-9` for Deny and Show in canvas. If Allow unavailable, Show in canvas becomes the sole primary action. | Existing DaisyUI button variants; proposed order and sizing |

Display real session name and workspace basename on **every** card, including failures and unroutable requests. For missing metadata use explicit â€œSession unavailableâ€ and â€œWorkspace unavailableâ€ (never a blank identity or fabricated value). Provider is the runtime/provider label when known; omit its slot if unknown. Session titles and question previews are allowed **in app only**, not in OS notices. Long session names truncate visually and retain the full sanitized value in an accessible label/tooltip. **proposed**

The kind title is fixed text: â€œQuestion needs an answerâ€, â€œPermission requiredâ€, â€œLane permission requiredâ€, or a safe failure label. Do not use the session title as the kind title. Time is a relative label such as â€œ2m agoâ€, with full timestamp in `title` and accessible date text. Snackbar and bell derive one keyed item, not independent copies. **proposed**

### States

| State | Visual / behavior |
| --- | --- |
| Default | Raised surface as above; no full-perimeter state border. **proposed** |
| Hover | `hover:bg-[color:var(--surface-highlight)]` as an overlay on the card surface, no layout shift; action buttons retain DaisyUI hover. **proposed** |
| Keyboard focus | `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary` on actionable controls; do not tab-stop a passive card wrapper. **proposed** |
| Submitting / disabled | Native `disabled`; keep the button label readable with `disabled:opacity-60` only when its resolved text remains >=4.5:1, otherwise use full `text-base-content-muted` and a border. Explain why in adjacent `text-xs text-base-content-muted` status and `aria-describedby`. Never present disabled Show in canvas as a live link. **proposed** |
| Answered | Remove request from snackbar, bell, rail queue, rail status and badge after authoritative resolution; announce â€œRequest resolvedâ€ once. No lingering answered card. Existing shared lifecycle; rail projection **proposed**. |
| Stale / withdrawn | Disable action immediately, show â€œRequest changed. Open the current request.â€, then reconcile and remove once source confirms withdrawal. Do not send a second answer. Existing invalidation rule; rail status **proposed**. |

## Canvas rail Needs you queue

At >=900px with Sessions panel expanded, insert a compact `Needs you` section **between the Sessions header and session list**, inside the same rail scroll context. Header: `text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content-muted`, count aligned right as text. Show up to three oldest pending items, each a `surface-2 rounded-lg border border-[color:var(--surface-border)] p-2` row with kind icon, one-line session name, one-line safe question/tool preview, and Answer or Allow/Deny plus Show in canvas. `+N more` opens the bell with Needs you heading in view. Queue max-height 260px; do not crowd New session / Previous sessions controls. **proposed**

The matching session rail card keeps its normal running/idle mechanics but displays a `Needs you` status chip (`text-state-need`, icon, text) in its header and one compact pending preview below the session title. The first pending request on that session gets inline Answer (opens its question in canvas) or Allow/Deny (guarded direct response); `+N` on that card opens the rail queue or bell for other requests. On question cards, â€œAnswerâ€ is routing, not an automatic response. Never let the card's host click consume a nested button; maintain the existing session select action. **proposed**

Queue and card are projections of the same authoritative request IDs used by bell and snackbar (permission, ask-user, CLI lane permission). Action on any surface reconciles all four views and the bell count atomically after source confirmation. A request for a session outside the current workspace stays in the global bell, not the current workspace queue. Unroutable or `surfaceMode` requests stay counted in the bell and appear in this rail only if a reliable owning session/workspace can be resolved; otherwise bell shows the existing disabled target explanation. Old queue code in `de5756f04^` is evidence for direct Allow/Deny/Open and double-answer guard, not a second source to revive. **proposed**

When there are no local requests, collapse the section to a one-line `All clear` plus a quiet check icon; no empty panel or fixed-height blank area. Once a request resolves, preserve focus sensibly: action focus moves to the next queue row or Sessions heading; do not jump to the bell. Queue order is oldest first and stable until items resolve. **proposed**

At <900px, the Sessions panel follows existing automatic collapse; do not force it open. The collapsed rail card shows a state dot and accessible â€œNeeds youâ€ count. The global bell remains usable, the snackbar stack is capped at one per approved spec, and opening the compact Sessions sheet exposes the queue before session cards. At <=400px the card fills `min(348px, calc(100vw - 1rem))`; action buttons wrap and retain >=44px pointer target height. **proposed**

## Bell panel

Keep the existing right-aligned bell panel, sound toggle, Clear all notices, one internal scroll area, and sticky title header. At desktop use `w-[360px] max-w-[calc(100vw-1rem)] max-h-[min(780px,calc(100vh-1rem))] surface-3 rounded-2xl`; at narrow width use `w-[calc(100vw-1rem)]`. Section headers use `flex items-center justify-between px-1 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content-muted`, with count at right. Needs you contains the shared cards; Recent notices contains failure/warning cards. No success/completion rows. **proposed**

The Needs you header count equals the global bell badge, not only visible rows. Recent notices count is separate and never changes that badge. Clear all notices removes only Recent and transient warning/failure snackbars; it stays disabled when Recent is empty. The section remains present with â€œNothing needs your responseâ€ if Recent has entries but Needs you is empty. Existing semantics; typography and layout **proposed**.

## Accessibility, motion and contrast

Use `role="dialog" aria-modal="false"` for bell, labelled by its Notifications heading; sections use named headings and list/listitem semantics for queue and rows. Snackbar host is not a second live region. Button labels include action, kind, session and workspace, e.g. â€œAllow Bash for Fix login flow in ptah-extensionâ€. Dismiss says what presentation it hides. Native disabled buttons expose reason with `aria-describedby`. Focus order follows reading order: bell header actions, Needs you rows and their buttons, Recent rows; rail header, queue rows, session cards. Bell opens to first enabled request action (or heading), Escape/outside pointer closes and returns focus to bell. No automatic focus on snackbar arrival. **proposed** labels and rail order; approved bell behavior retained.

WCAG 2.2 AA criterion 1.4.3: ordinary text >=4.5:1, large text >=3:1; meaningful icon/focus UI >=3:1 under 1.4.11. Eager themes from `tailwind.config.js`: dark `base-content #e8e6e1` on `base-300 #242430` is 12.29:1, dark muted `--bcm` on `base-300` is 5.01:1 and dark `--state-ink-need #f97316` on `base-300` is 5.47:1 (project measured); light `base-content oklch(23.574% .066 313.189)` on `base-300 oklch(91.586% .006 53.44)` is 13.21:1 and light muted `--bcm` on `base-300` is 5.01:1 and light `--state-ink-need #8f5200` on `base-300` is 4.84:1 (project measured). Since `surface-2/3` mix those base steps, final implementation must measure these same pairs on the actual resolved surface, including hover, disabled labels, primary button text, focus ring, and `text-state-need` icon in both themes; do not lower opacity on text. The prototype uses full-opacity muted ink. Existing `text-base-content-muted` is specifically tuned across themes in `styles.css`; never use `text-base-content/NN` classes.

Motion: retain 120ms entrance, 4px translate only for a newly appearing snackbar; no pulse/bounce. `prefers-reduced-motion: reduce` removes motion. Focus and hover pause dismissal countdown; pending requests have no timeout. Existing timing/behavior.

## Approved behavior retained explicitly

- Bell badge counts only unresolved questions and permissions, including lane permissions, once across attached tabs; failures and warnings live in Recent notices. Key by kind + authoritative request ID, not title. 
- Clear all notices removes Recent and transient failure/warning presentations only; never unresolved Needs you requests. Snackbar X hides that presentation without answering.
- Suppress snackbar when its own session is visible and focused; keep that request in bell and rail and in the global count. Three desktop snackbars, one <=900px, then `+N more` routes to bell.
- OS notices remain advisory and emitted once per request when Electron is unfocused (and per existing VS Code visibility rules); fixed safe title/body, no session title, question preview, raw prompt, tool arguments or secrets. Failure OS notices remain off by default; host actions open Ptah, not direct Allow/Deny.
- Reconcile on reveal, invalidate stale actions, guard double submission, preserve sound gating/cooldown and active voice sound suppression. Routine info/success stays local.

## Component change map (design only)

- `libs/frontend/notification-center/src/lib/notification-center.component.ts` â€” bell layout, shared row anatomy, counts and section styling.
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts` â€” shared card anatomy, identity, action hierarchy and states.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` â€” feed authoritative pending projection to rail.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts` â€” queue placement, compact mode and overflow route.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts` â€” Needs you status/preview and per-session actions.
- `apps/ptah-extension-webview/src/styles.css` â€” only if a reusable shared card utility is needed; existing token values remain authoritative.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Queue above session cards, plus pending state on each owning card | Header queue only; card badge only; both | User misses live questions in rail; old queue exposed actions, while current card already has state semantics | Yes |
| Question Answer routes into canvas | Inline text field; route to existing question UI | Existing question flow owns response validation; old queue opened session | Yes |
| Show three oldest rail items then `+N more` | Unlimited rail scroll; bounded preview | Narrow Sessions panel, approved snackbar overflow model | Yes |
| Use surface elevation and small state accent | Full warning border; no state color | Current screenshots show rigid border dominance; project supplies surface/elevation and status inks | Yes |
| Keep global bell count and local queue count separate | Count only current workspace; show same global count | Approved spec counts all workspaces; rail belongs to current canvas | Yes |

## Open questions for the user

1. **Gate 1.7:** Approve this proposed rail position, card hierarchy, and action density after trying `prototype/attention.html`? Reply `APPROVED` or name changes. This is the required review before implementation, not a request to change the approved attention contract.

