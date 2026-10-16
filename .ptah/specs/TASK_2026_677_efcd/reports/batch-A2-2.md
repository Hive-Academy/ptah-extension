# Batch A2-2 report - composer chips + autopilot trigger re-skin

Status: IMPLEMENTED (awaiting team-leader MODE 2 scoped checks)

Executor: frontend-developer (Claude). Task A2-2.1. Worktree
`D:\projects\ptah-extension\.claude-worktrees\clean-session-view`. No git state changed, no nx/jest run
(decisions row 59).

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`
  - Card is now `<form aria-label="Message composer" (submit)="$event.preventDefault()">`
    (`data-testid="chat-composer-form"`); classes per design-spec §6 card line (`w-full max-w-[758px] mx-auto
    rounded-xl border bg-surface-1 shadow-[inset_0_1px_0_var(--surface-highlight),var(--elev-shadow)]`, neutral
    `border-surface-border focus-within:border-[var(--surface-border-strong)]`). Plan / autopilot border tints kept.
  - NEW top strip (`h-[38px] ... border-b border-surface-border text-xs text-base-content-muted`): workspace hint
    (`Folder` 14 + folder name, `title` = full root) and branch hint (`GitBranch` 14 + `font-mono text-[11.5px]`).
    Non-interactive spans, no tab stops; branch hint absent when null; whole strip absent when both null.
    Root = `sessionWorkingRoot(tab, findTabByIdAcrossWorkspaces(tab.id)?.workspacePath ?? null,
    vscode.config().workspaceRoot || undefined)`; no tab -> webview root. Branch =
    `sessionBranch(resolvedTab(), gitStore.stateFor(root))` (B-3 helper). Composer never calls `track()`.
  - Field: visually hidden `<label for>` "Message the orchestrator" with a per-instance id
    (`ptah-composer-input-N`, module counter as in `session-filter-bar.component.ts`); placeholder
    `Ask the orchestrator to plan, build or review...` (read-only placeholder unchanged); textarea `text-[13px]
    leading-[1.6] min-h-[60px] max-h-[calc(8lh+1rem)]`, `field-sizing: content` kept.
  - Bar order: `+` (aria-label `Attach files or add context`, 16 px icon, `rounded-md`) -> approval chip
    (`<ptah-autopilot-popover>` moved from the status line, same `[sessionId]="tabSessionId()"`) -> spacer (left
    group `flex-1`) -> `role="group" aria-label="Model and effort"` wrapping the existing `ptah-model-selector`,
    `·` separator and `ptah-effort-selector` -> mic (Electron only; idle label `Dictate`, 16 px icon) -> Stop
    (streaming only, now 28 px circle, same error tint) -> Send.
  - Send: D1 neutral inverse circle `h-7 w-7 rounded-full bg-base-content text-base-100`, `ArrowUp` 16,
    `enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed`. Still
    `type="button"` + `(click)="handleSend()"`, enabled while streaming (queues).
  - Status line keeps MCP chip, peer send, auth label (autopilot left it); aligned to the card
    (`w-full max-w-[758px] mx-auto`).
  - Styles: new `@container ptah-composer (max-width: 639px)` hides the workspace label (icon stays) and the
    effort selector's `.ptah-composer-label` (icon trigger stays). The existing 400 px rule is unchanged.
  - Focus rings on composer buttons: `focus-visible:outline-2 outline-offset-2 outline-[oklch(var(--s))]`, the
    A2-1 header idiom (design-spec §8.4).
  - Icons: `Send` -> `ArrowUp`; added `GitBranch`, `FolderHintIcon` (reuses the existing `Folder as FolderIcon`
    import).
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts`
  - "uses a neutral border when no mode is active": `surface-2` / `border-base-content/10` ->
    `bg-surface-1` / `border-surface-border` (the card re-skin changed those classes). No other case touched.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts`
  - Trigger re-skin only: `h-7 px-2 rounded-md text-xs font-medium`, `Shield` 14 (spinner while pending), ink
    from `text-state-*` via new `tabInk` computed (manual / plan / agent-plan-mode -> `idle`, `auto-edit` ->
    `need`, `yolo` -> `err`), hover and open tint `color-mix(in oklch, currentColor 10%, transparent)` (component
    style; Tailwind cannot apply `/10` to the `var()` state colours), `aria-haspopup="menu"`, `aria-label` and
    `title` `Approval mode: {status text}`, `data-testid="composer-approval-chip"`. Label span keeps
    `ptah-composer-label`. Chevron removed from the trigger (design chip has none); `ChevronDown` import dropped.
  - Popover content unchanged except `type="button"` on the Enable / Disable buttons (they now sit inside the
    composer `<form>`; without a type they were submit buttons).
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.spec.ts`
  - Fake `AutopilotStateService` gains `agentPlanMode: signal(false).asReadonly()` (the new ink computed reads
    it). No assertion changed.
- NOT touched: `libs/frontend/chat-ui/src/index.ts` (no new export needed).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Approval chip text keeps today's vocabulary (`Manual`, `Auto-edit`, `Full Auto (YOLO)`, `Plan Mode`) | design names `Ask` / `Bypass` / `Plan` | text comes from `AutopilotStateService.statusTextFor` + `PERMISSION_LEVEL_NAMES` (shared); popover spec asserts it; renaming is outside "trigger re-skin only" | yes |
| Ink mapping manual/plan -> idle, auto-edit -> need, yolo -> err | - | design-spec §6.3 (`Plan`/`Ask` idle, `Auto-edit` need, `Bypass` err); yolo = bypass | yes |
| Keep the plan / autopilot border tint on the card | drop it (design shows neutral card) | no removal approved in parity-inventory (R1, R2 only); spec cases assert the tints | yes |
| Form is the card itself; Send stays `type="button"` with its click handler | Send as `type="submit"` + `(ngSubmit)` | O4/no behaviour change; `handleKeyDown` already sends on Enter; submit only prevented | yes |
| Branch hint shows only when the root is tracked elsewhere or `agentOrigin.branch` exists | start `track()` from the composer | batch validation note "A2 never starts git tracking" | yes |
| No tab -> workspace hint from `vscode.config().workspaceRoot` | hide strip with no tab | a new session starts in that root; same fallback `sessionWorkingRoot` uses | yes |
| Mic idle label `Record voice` -> `Dictate` | keep | design-spec §8.1 composer names | yes |
| Composer outer wrapper padding (`px-3 pt-2 pb-2`) unchanged | design wrap `px-6 pt-2 pb-[18px]` | the wrap belongs to chat-view (`chat-view.component.html`, CV batches); narrow sidebars need `px-3` | yes |

## Deviations from plan / design

- Design §6.3 shows one model selector reading `Opus 5.5 · High` with `aria-haspopup="listbox"`; per Decision A2-5
  the two existing controls stay inside a `role="group" aria-label="Model and effort"` chip group.
- Approval chip `aria-haspopup="menu"` follows the plan, but the popover content is a panel of buttons, not a
  `role="menu"` (content unchanged by brief). Reviewer may prefer `dialog`; flagged, not changed.
- Stop keeps its error tint (`bg-error/15 text-error`) at the Send size, and sits left of Send (O4: both kept).

## Verification

- `ptah_get_diagnostics` (typescript-compiler), scoped:
  - `autopilot-popover.component.ts` + `.spec.ts`: 0 diagnostics in the requested files.
  - `chat-input.component.ts`: 0 diagnostics. `chat-input.component.spec.ts`: 1 error at `:981` (TS2352
    `{ target: { value } } as Event`), a line this batch did not touch (diff hunk is `:603-604` only); the same
    TS2352 spec-cast class appears in many sibling specs, so it comes from the diagnostics tool's stricter
    program, not from jest. Reported, not fixed.
  - Sibling-file errors reported by the tool (not this batch's files, pre-existing): chat-ui
    `streaming-quotes.component.spec.ts:22`, `compact-session-activity.component.spec.ts:1339,1375`,
    `compact-session-metrics.spec.ts:57`; core `testing/mock-rpc-service.ts:53-68`; shared
    `capability-id-codec.ts:262-263`; chat `agent-card-truncation.spec.ts`, `compact-lane-rows.spec.ts`,
    `compact-session-card.component.spec.ts`, `execution-node.send-message.spec.ts`,
    `send-message-chip.component.spec.ts`, `workflow-card.component.spec.ts`, `tab-bar.component.spec.ts`.
- No nx / jest / lint run (decisions row 59). The team-leader MODE 2 runs the Scoped checks
  (`a22-test`, `a22-typecheck`, `a22-lint`).
- Spec reasoning: `chat-input.component.spec.ts` builds the class with `new` in an injection context and never
  renders the template, so the new `SessionGitStatsStore` inject resolves against the existing `VSCodeService` /
  `TabManagerService` fakes and the new computeds (`config()`) are never read. `chat-view.component.spec.ts`
  replaces ChatView imports, so it never renders `ptah-chat-input`.

## Open items

- Visual review: the top strip, chip order, 640 px label hiding and send restyle need the Electron renderer
  visual pass (not runnable here).
- `aria-haspopup="menu"` on the approval chip vs non-menu popover content (see Deviations) - reviewer call.
- Branch hint depends on another surface tracking the root (inspector GIT section, B-4) unless the tab has
  `agentOrigin.branch`; with the inspector never opened in a session, the composer shows the workspace hint only.
- `chat-view.component.html` composer wrap (`px-6 pb-[18px]` per design §2) is outside this batch (CV owner).
