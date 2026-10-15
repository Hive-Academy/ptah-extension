# Design Spec - TASK_2026_649_33c4: AI Team Builder and New Project builder page on shared chat sessions

Designer: ui-ux-designer. Status: revision round 1 (after the cross-side review, `design-spec-review.md`), awaiting re-review and Gate 1.7 (user APPROVED). See the Revision log at the end.
Prototype: `prototype/` (open `prototype/index.html` and `prototype/hub.html`; states are URL parameters, listed in `prototype/README.md`). Screenshots: `prototype/screenshots/`.
Companion inputs: `context.md`, `decisions.md` (D1, D2, D5-D8), `parity-inventory.md` (60 rows, section 12 below maps every keep, move and wire row), `../TASK_2026_648_374e/decisions.md` (D5-D9), `../TASK_2026_652_7284/draft-workflow-plan.md`.

## 1. Overview

After 649 the AI Team Builder (Configure Harness) page and the New Project page are one page with two parts. The page keeps its own header and its builder sidebar. It replaces only its own chat (composer, transcript, claim and stream plumbing) with the shared chat:

```html
<ptah-session-embed [tabId]="tabId()" />            <!-- the same ChatView as the main chat -->
<ptah-harness-builder-sidebar [tabId]="tabId()" />  <!-- the existing side panel, extracted -->
```

Layout, wide (host width 720 px and up):

```
+------------------------------------------------------------------------------------+
| AI Team Builder [Configure Harness] 4 agents, 3 skills [Targeting x]  [Hide panel] [Start over] [X] |  header (page-owned)
+--------------------------------------------------------+---------------------------+
| ChatView (shared): transcript role="log", permission   | CONFIGURATION             |
| and question cards, composer with model, effort, Stop  |  APPLY        (state card) |
|                                                        |  STACK PROFILE (New Project)|
|                                                        |  PREVIEW      (live)       |
|                                                        |  AI HELPERS                |
|                                                        |  PRESETS                   |
|                                                        |  SESSION      (stats)      |
+--------------------------------------------------------+---------------------------+
                      flex-1, min-w-0                              336 px
```

Layout, narrow (host width under 720 px): the header loses its labels, a 44 px "peek bar" under it shows the configuration summary and state, and the sidebar becomes a full-cover, non-modal sheet opened from the peek bar (section 8).

What this spec does not design: the chat internals (transcript, cards, composer, model and effort selectors). They come from the shared ChatView through `ptah-session-embed` (648). The prototype draws a labelled stand-in only so the layout can be judged.

## 2. Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| 1 | The sidebar is 336 px wide (304 px content, 16 px side padding). Today it is 420 px. | 420 px kept; 336 px | 677 inspector recipe (336 px aside, 304 px content) named in the task brief; at a 960 px host the chat keeps 624 px | yes |
| 2 | Docked sidebar from host width 720 px, open by default. Under 720 px it is a closed, non-modal full-cover sheet toggled from a peek bar. Widths come from the page host (ResizeObserver), not the viewport. | stacked under the chat; modal sheet; non-modal sheet | 677 D43: a modal sheet at 400 px covers the thread and is rejected; stacking leaves the chat under 300 px tall at 860 px viewport height; 677 and `railWidthBand` measure the host | yes |
| 3 | One Stop control: the shared chat's "Stop generating" button. Today's header Stop is dropped. Stop is a pause: transcript and preview stay, no dialog. | keep both; chat only | Parity row 27; 652 D16 (Stop never prompts); two Stops on one page would be duplicates | yes |
| 4 | Apply lives only in the sidebar. Today there are two Apply buttons (banner above the composer and the side panel). The shared chat knows nothing about the builder, so the banner has no host. | keep a banner in the chat; sidebar only | Parity rows 39-42; 649 D1 (no add-ons in the chat) | yes |
| 5 | Apply button weight follows the preview: partial preview = outline button; "Configuration looks ready" = the one primary button. | always primary (today); outline; state-based | 648 D6 rule "at most one primary button per section"; today's panel button is primary at any completeness, which makes the recommended moment indistinguishable | yes |
| 6 | The Apply result stays until the user dismisses it or the preview changes. A later change shows "Preview changed since the last apply" with the primary button again. | auto-clear; sticky | Epic defect 3 (silent Apply): a result that vanishes is the same defect | yes |
| 7 | AI helpers are sidebar rows, run one at a time, and their results are proposals. Config-shaped results (Suggest, Analyze intent, Design subagents, Generate skill specs, MCP suggestions, Generate prompt) enter the preview only on "Add to preview". Documents (Generate document, CLAUDE.md preview) are viewers with Copy. | agent tools only; sidebar actions; auto-merge | Parity rows 49-54 ("wire as add-on actions or agent tools"); agent tools for skills and MCP already exist (row 48) and are not discoverable; an auto-merge would race the agent's own proposals | yes |
| 8 | (D7) Parity row 54 is split. `harness:search-skills` and `harness:create-skill` are reclassified from `wire` to `keep (agent tool)`: the agent's existing tools cover them (row 48) and there is no new sidebar UI for them. `harness:discover-mcp`, `harness:generate-prompt` and `harness:generate-claude-md` stay `wire` (5.5 More helpers). This is not a removal: no user can reach the two wrappers today and the agent tools keep working. If wanted later, a "Find skills" row follows the row recipe (5.5). | add rows; agent tools | User answer 2026-10-15 ("Agent tools are enough"); `decisions.md` D7; review finding 6 | yes |
| 9 | Loading a preset updates the preview and prefills the composer with a short note naming the preset, so the agent and the preview do not diverge. The user edits and sends it. This is one of only two prefill uses (the other is "Ask the agent to propose it again", 5.4). | preview only; prefill; auto-send | Embedded ChatView consumes a tab-targeted prefill today (`chat-view.component.ts:1375-1389`); prefill inserts sendable content (`chat-input.component.ts:234-240,1574-1581`); an auto-send would start a turn the user did not write | yes |
| 17 | (D5) Builder entry uses a builder-local adapter. The shared `WorkflowTabLauncherService` is not split or changed by 649 (section 11, entry sequence). | split the launcher; builder-local adapter | `decisions.md` D5; review finding 3: the launcher always navigates to `chat` (`workflow-tab-launcher.service.ts:26-59`) | yes |
| 18 | (D6) The Configure first screen shows the shared chat's normal composer placeholder. The builder guidance lives in the sidebar (Preview empty state, 5.4). No placeholder API is added to the chat. | scoped placeholder API; generic placeholder | `decisions.md` D6; review finding 2: prefill sets the value, not the placeholder | yes |
| 19 | (D8, agreed with 677: option B, 677 owns the token) The builder page tells the embed to render in bare chrome (no 677 session header, no 677 inspector). Contract in section 11, note 1. | embed input only; 677 skips embedded builder tabs; agreed contract | `decisions.md` D8; user answer 2026-10-15; review finding 1 | yes |
| 10 | Leave dialog: initial focus on Cancel; button order Cancel, Discard, Save as draft; Escape and backdrop click = Cancel; Save is disabled with a stated reason until the chat session exists. | initial focus on Save; Cancel | 652 requirements (focus trap, Escape = Cancel, focus return); the old confirm defaulted to the safe "Keep this workflow" | yes |
| 11 | The header X keeps today's meaning, "Back to chat, this session keeps running". It opens the chat view with this tab active, where the session appears as a normal chat with the workflow badge (649 D2). No return action is added. | Setup Hub; chat | Parity row 32; D2 | yes |
| 12 | The "Targeting <workspace>" pin badge keeps today's rule: shown only when the active workspace differs from the one the build started in. The Apply section always states the target ("Writes into <workspace>"). | always on; on mismatch | Parity row 13 (`workspaceSwitchedDuringBuild`), `harness-builder-view.component.ts` header | yes |
| 13 | A failed builder init never blocks the chat. The sidebar shows the error with Retry; Apply and the AI helpers wait for init because they need the pinned workspace. Today a full-page error hides everything. | full-page error (today); degrade | Parity row 12; losing a running conversation because a side call failed is the worse failure | yes |
| 14 | Error messages use base-content text; the error colour is only on the icon and border. | state-err text | Measured: `state-err` text on the error tint is 4.35:1 and on surface-3 is 4.15:1 in the dark theme (section 9) | yes |
| 15 | Setup Hub: the AI Team Builder card gets the same "Running" / "In progress" label and "Resume" wording the New Project card already has. | none; label | Parity row 3 (move) and row 4; same rule for both modes avoids a card that silently re-enters a session | yes |
| 16 | `technical-content-writer/DESIGN-SYSTEM.md` is not applied. It defines the marketing identity (Cinzel display, obsidian and gold hero gradients). This surface is product UI in the webview, so its authority is the webview theme (`anubis`, `anubis-light`) in `apps/ptah-extension-webview/tailwind.config.js` and `styles.css`. | marketing system; webview theme | Same call as 677; the existing builder uses DaisyUI tokens | yes |

## 3. Page anatomy and header

Source for the header values is today's header (`harness-builder-view.component.ts`, `header` element) unless another source is named.

| Element | Spec | Token or source |
| ------- | ---- | --------------- |
| Header container | `flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3 border-b border-base-300 bg-base-100 shrink-0`; at host width under 720 px `px-3 py-2` | existing header; `flex-wrap` lets the pin badge drop to a second line instead of overflowing |
| Title | `h1 text-base font-bold text-base-content`: "AI Team Builder" or "New Project Setup" (no change to the strings) | `headerTitle`, parity row 14 |
| Workflow badge | `<ptah-workflow-badge [workflow]="tab.workflow" />`, full variant at 720 px and up, `variant="compact"` under 720 px. Label comes from the component: "Configure Harness" or "New Project". Text "Workflow: " is in an `sr-only` span. | `workflow-badge.component.ts`; the same badge as the tab bar (648) |
| Config summary | `text-xs text-base-content-muted`, e.g. "4 agents, 3 skills", hidden under 720 px (the peek bar carries it) | `state.configSummary()`; hidden when "No configuration yet" as today |
| Pin badge | `badge badge-sm gap-1 max-w-[200px]` warning tint (`bg-warning/12 border-warning/45 text-state-need`), `role="status"`, pin icon, "Targeting <workspace>", name truncated with `title` carrying the full text and today's sentence "You switched workspaces mid-build. This configuration will still be applied to the workspace this build started in." | today's `badge-warning`; text colour moved to `text-state-need` (4.78:1 on the tint, section 9) |
| Sidebar toggle | `btn btn-ghost btn-sm` (32 px), panel-right icon plus "Hide panel" / "Show panel" label (label hidden under 720 px, where the toggle itself is replaced by the peek bar). `aria-expanded`, `aria-controls="builder-sidebar"`, `aria-label` "Hide configuration panel" / "Show configuration panel". `btn-active` while open. When closed and the preview is ready to apply, a 8 px dot (`bg-state-done`, 2 px `border-base-100` ring) sits on the top right of the button. | today's toggle plus `aria-expanded`; dot follows 677's needs-you dot pattern |
| Start over | `btn btn-ghost btn-sm`, rotate-ccw icon, label "Start over" (label hidden under 720 px), `aria-label` "Start over: leave this workflow". It opens the leave dialog (7.1). It is always shown on this page because the page is only reachable with a session. | parity row 43; today's button was shown only while `workflow.isActive()` |
| Back | `btn btn-ghost btn-sm btn-square` (32 px), X icon, `aria-label` "Back to chat. This session keeps running." | decision 11 |
| Stop | Not in the header. The shared chat's Stop (`aria-label` "Stop generating") replaces it. | decision 3 |

Screenshots: `dark-configure-building-wide.png`, `light-configure-ready-wide.png`, `dark-configure-pin-badge-wide.png`, `dark-configure-sidebar-closed-ready-dot.png`, `dark-newproject-stack-profile-wide.png`, `light-newproject-stack-profile-wide.png`.

## 4. Chat region contract (what the page asks of the embed)

The chat region is `<ptah-session-embed [tabId]>` filling the remaining width. The page adds nothing inside it. What the user sees there comes from the shared chat:

- Transcript with `role="log"`, user and agent turns, the "Working" line, permission cards and AskUserQuestion cards, the "Resumed" handling after reload (parity rows 15, 21-24, 26, 27, 29, 31).
- Composer with Send, Stop, attach, per-tab model selector ("Select model") and effort selector ("Select reasoning effort level") (rows 15, 19, 27).
- Turn errors (row 28, turn-level).

Start behaviour per kind (parity rows 16 and 17):

| Kind | First screen | First turn |
| ---- | ------------ | ---------- |
| Configure Harness | Empty chat, composer focused, with the shared chat's normal placeholder ("Ask a question or describe a task..."; D6, nothing builder-specific is injected). The builder guidance is in the sidebar's Preview empty state (5.4), which names the first step. The composer is not prefilled on first load. | The user's first message starts the builder. The builder instructions go in as the tab's first-message preamble (row 16). Nothing is auto-sent. |
| New Project | The intake summary is already the visible first user turn and the agent is streaming. | Auto-sent on arrival through the normal tab sender (row 17). The composer stays empty. The stack profile (5.3) shows what the start step did. |

Failure of the preamble or seed composition is a page-level notice, not a console line (section 6).

## 5. Builder sidebar

### 5.1 Shell

`<aside id="builder-sidebar" aria-label="Configuration" class="flex flex-col w-[336px] shrink-0 min-h-0 bg-surface-1">`.

- Header strip `px-4 py-2.5 min-h-12 border-b border-surface-border`: settings icon, `h2 text-xs font-semibold` "Configuration", config summary `text-[11px] text-base-content-muted` at the right. Hidden under 720 px (the peek bar is the header there).
- Scroll body: `flex-1 min-h-0 overflow-y-auto`. Sections are `<section aria-labelledby>`, `p-4 border-b border-surface-border` (677 recipe), label `h3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted`, meta `text-[11px] text-base-content-muted`.
- Section order, top to bottom: Apply, Stack profile (New Project only), Preview, AI helpers, Presets, Session. Reason: the state the user must act on comes first; the live preview is next because it is why the page exists; helpers and presets are optional; stats are reference.
- At most one primary button in the whole sidebar at any time (the Apply button in its "ready" or "changed" state).
- Every field edge uses `border-base-content/50` (section 9: the stock 20% edge measures 1.6 to 1.9:1).

Screenshots of the whole sidebar: `dark-sidebar-full-configure-ai-helpers.png`, `light-sidebar-full-configure-ai-helpers.png`, `dark-sidebar-full-newproject-stack.png`, `dark-sidebar-full-presets-save-form.png`, `light-sidebar-full-presets-saved.png`, `dark-sidebar-full-preset-loaded.png`.

### 5.2 Apply section (parity rows 13, 39-42, 47)

Label "APPLY". Content depends on state. Only one state shows at a time.

| State | When | Content | Screenshot |
| ----- | ---- | ------- | ---------- |
| (absent) | No preview content, or init not finished | Section not rendered | `dark-configure-empty-wide.png` |
| Partial | Preview has some content, not complete | Help line "The preview is partial. You can apply what is here now, or keep chatting to finish it." Outline button `btn btn-outline btn-sm w-full border-base-content/50` "Apply to Workspace". Target line `text-[11px]` "Writes into <b>workspace</b>". | `dark-configure-building-wide.png` |
| Ready | `isConfigComplete()` and the agent is idle | Success card (`rounded-lg border px-3 py-2.5 bg-success/10 border-state-done/45`), check-circle icon `text-state-done`, heading "Configuration looks ready", line "Review the preview, then apply it to the workspace." Then the one primary button `btn btn-primary btn-sm w-full` "Apply to Workspace" and the target line. | `light-configure-ready-wide.png` |
| Blocked | Complete but the agent is still working | Info card (`bg-surface-2 border-surface-border`), spinner, "Waiting for the agent", "Apply is available when the agent finishes its turn." Outline button `aria-disabled="true"` with `aria-describedby` on that line. (Today's panel Apply is disabled while processing.) | `dark-configure-apply-blocked-wide.png` |
| Applying | `isApplying()` | `role="status"` line "Applying the configuration..."; the primary button `aria-disabled="true"` `aria-busy="true"` with spinner and "Applying...". | `dark-configure-applying-wide.png` |
| Applied | `harness:apply` returned | See below | `dark-configure-applied-wide.png`, `light-configure-applied-wide.png` |
| Changed | Preview changed after Applied | Info card "Preview changed since the last apply" with "7 files were written at 14:02. Apply again to update them."; primary button "Apply to Workspace". | (same pattern as Ready) |
| Error | `harness:apply` rejected | `role="alert"` card (error tint, error icon, base-content text): heading "Apply failed", the message, outline "Dismiss". Below it the primary "Try again". The user's preview is untouched. | `dark-configure-apply-error-wide.png` |

Applied state, in order (epic defect 3 fixed):

1. `role="status"` success card: "Applied to <workspace>" and "N files written." (`appliedPaths.length`).
2. File list `ul` with `aria-label="Files written"`: one row per `appliedPaths` entry, `font-mono text-[11px]`, `break-all` (wraps, never truncates, never scrolls sideways), file-check icon `text-state-done`. First 5 rows show, then a "Show all N" button (`btn btn-ghost btn-xs`, 24 px high minimum), then all rows. Path text is shown relative to the pinned workspace root when it starts with it, otherwise as returned.
3. "Copy list" button (copy icon, `aria-label` "Copy the list of written files").
4. Warnings, when `warnings.length > 0`: warning card (`bg-warning/12 border-state-need/45`, triangle icon `text-state-need`, base-content text), heading "N warning(s)", one list item per warning, `role="status"`. Warnings are information after a success, not errors.
5. Health line (`role="status"`, `text-xs`) from `HarnessHealthStore`: checking (spinner, "Checking harness health..."), healthy (heart-pulse icon `text-state-done`, "Health: all checks pass", "checked just now"), issues (triangle icon, "Health: 2 issues need repair" and a text button "Open in Dashboard" that routes to the existing harness card), unavailable (line omitted). Screenshot `dark-configure-applied-health-issues.png`.
6. "Dismiss result" ghost button. It returns the section to Partial or Ready.

Focus: on Applied, focus moves to the card heading (`tabindex="-1"`) because the Apply button leaves the DOM. On Error, focus moves to "Try again". On Dismiss, focus moves to the Apply button or, if absent, to the section heading.

When the sidebar is closed (wide) or the sheet is closed (narrow), the toggle dot or the peek bar state shows Ready, Applied (check-circle, "Applied") and Error ("Apply failed") so the result is never hidden.

### 5.3 Stack profile (New Project only; parity row 7)

Label "STACK PROFILE", meta "from project setup". Data: `harness:start-new-project` result (`plugins.enabledBundled`, `plugins.missingExternal`, `plugins.availableSkillIds`, `toolchain`). Layout is a `dl` with a 2-column grid (`grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs`), `dt` `text-[11px] text-base-content-muted`.

| Row | Content | Empty / edge |
| --- | ------- | ------------ |
| Plugins on | `badge badge-outline` chip per enabled bundled plugin, check icon | Row omitted when none |
| Not installed | Chip per `missingExternal` (`marketplace: plugin`), triangle icon, `border-warning/55`. Title attribute holds both ids. | Row omitted when none |
| Skills | "N available", first three skill ids as chips, then a text button "+N more" (expands in place) | "None available" |
| Toolchain | Icon plus sentence plus the probe command in `font-mono text-[11px]`. Found and meets minimum: check icon `text-state-done`, ".NET SDK 9.0.100 meets 8.0+". Older than minimum: triangle icon `text-state-need`, "older than the 8.0 minimum" and `installHint` as text. Not installed: triangle icon, "Not installed" and `installHint`. Status is always icon plus words, never colour alone. | Row omitted when `toolchain` is absent |

Not-installed and older-than-minimum are warnings, not errors: the agent can still work. Screenshots: `dark-newproject-stack-profile-wide.png` (older than minimum), `light-newproject-stack-profile-wide.png` (meets minimum), `dark-sidebar-full-newproject-stack.png`.

Data comes from the stack-profile handoff (section 11, note 4): stored per tab and workspace at entry, validated on read, found again after a reload. The fallback shows only when that lookup yields nothing usable: no stored record for this tab id and workspace, the record fails validation, or the tab was not started by `harness:start-new-project`. Then the section shows `bg-surface-2` info text "Setup details are not available for this session. The agent still has them." with `role="status"`. It never shows while the record exists and is valid, and never flashes during the first read (the section renders a skeleton until the lookup settles, then either the profile or the fallback). Screenshot: `dark-newproject-stack-unavailable.png`.

### 5.4 Preview section (parity rows 34-38)

Label "PREVIEW", meta = config summary ("4 agents, 3 skills") or, after a reload, "Restored after reload" with a history icon (`role="status"`).

Content is the existing `ptah-harness-config-preview` component, unchanged in structure: Persona (open by default), Agents (+N custom), Skills (+N custom), System Prompt, MCP Servers, as `collapse collapse-arrow surface-2 rounded-lg` cards. One fix in passing: each card's hidden checkbox gets an `aria-label` equal to its title (today it has none).

Live updates arrive for every session of the tab and for both kinds (row 36; New Project proposals are no longer dropped). Updates merge field by field (row 38).

States:

| State | Content | Screenshot |
| ----- | ------- | ---------- |
| Empty | Centered `text-xs text-base-content-muted` text. Configure (also the first-screen guidance, D6): "No configuration yet. Start by telling the agent what you are building in the chat: who the team is for and which tools you use. The agents, skills, prompt and MCP servers will appear here as the agent proposes them." New Project: "No configuration yet. Answer the agent in the chat; the plan will appear here as the agent proposes it." | `dark-configure-empty-wide.png` |
| Hydrating (after reload) | Three `skel` bars, `role="status"` `aria-busy="true"`, sr-only "Restoring configuration", caption "Restoring the configuration from your last session..." | `dark-configure-hydrating.png` |
| Restored | Normal content, meta shows "Restored after reload" | (state of the content) |
| Unavailable or expired | Info card `role="status"`: "Saved configuration unavailable", "The configuration saved for this session has expired or was cleared, so the preview is empty. Your conversation is intact." Outline button "Ask the agent to propose it again" (prefills the composer with that request through `requestComposerPrefill(text, tabId)`; the user edits and sends it, nothing is auto-sent). | `light-configure-proposal-unavailable.png` |
| Restore failed | Error card `role="alert"`: "Could not restore the configuration", "Something went wrong while loading it. Your conversation is not affected." Outline "Retry". | `dark-configure-proposal-restore-failed.png` |

**Preview ownership and precedence (review finding 5).** The preview the user sees is the agent's proposals (kept by the backend, hydrated per session) overlaid with a user snapshot. Behaviour, independent of where the architect stores it:

1. Ownership. The snapshot belongs to one tab in one workspace: key = pinned workspace root + tab id (the same key as the stack-profile record, section 11 note 4). It holds only user-chosen fields: results added with "Add to preview", a loaded preset, and "Use as prompt". Each field carries `source` (`user`) and `updatedAt`; each hydrated agent proposal field carries the time the proposal was written.
2. Precedence, per field (persona, agents, skills, system prompt, MCP servers). A user-chosen field records `chosenAt`. An agent proposal carries its turn-start time: the time of the last user message of this tab's session before the proposal was written (live: the in-flight turn's start; after a reload: derived from the persisted session transcript, which survives the reload, and the proposal's write time). An agent proposal replaces a user-chosen field only when its turn-start time is later than `chosenAt`; a proposal from a turn that started before the user's choice is stale and is ignored for the fields the user chose. The same rule applies live and after a reload, so a late result of an older turn can never replace the user's choice. When the turn-start time cannot be derived, the user's choice wins. Fields the user did not choose take the latest proposal. Lists (agents, skills, MCP servers) merge by id, never by position; an item missing from a later proposal is not removed. A preset load wins over existing items of the same id and keeps the others (the Presets help line, 5.6).
3. Clearing. The snapshot and the stack-profile record are deleted on Start over, on Discard in the leave dialog, when the tab closes, and when its session is deleted (an init sweep also removes records whose tab id is no longer in the tab list). Save as draft and Stop keep them. Apply keeps them; the preview stays so "Preview changed since the last apply" can compare.
4. No resurrection. Hydration reads only the proposals of this tab's own session ids (row 36). It never falls back to "the latest proposal for the workspace", so a new builder session starts with an empty preview even though an older session's proposal record stays in the backend (7.1 note).
5. Workspace isolation. The page is pinned to the workspace the build started in (row 13). Reading with another workspace finds nothing, so switching the active workspace mid-build neither shows nor writes another workspace's preview. The "Targeting <workspace>" badge (decision 12) is the only visible effect.

### 5.5 AI helpers (parity rows 49-54, 56)

Label "AI HELPERS", meta "one at a time". Help line: "One-off helpers. Results go into the preview only when you choose Add to preview."

Row anatomy (`rounded-lg border border-surface-border bg-surface-2`, 6 px gap): a full-width button `min-h-11 px-3 py-1.5 flex items-center gap-2.5 text-left` with a 20 px icon, title `text-[13px] font-medium`, description `text-[11px] text-base-content-muted`, and a status slot at the right (`text-[11px]`). `aria-expanded` is true while the row shows a body.

| Row | Needs | Description | Result | Result actions |
| --- | ----- | ----------- | ------ | -------------- |
| Suggest from persona (`harness:suggest-config`, 2 min) | A persona in the preview | "Agents, skills, MCP servers and a prompt" | Counts line and the reasoning text | Add to preview, Dismiss |
| Analyze intent (`harness:analyze-intent`, 3 min) | Free text. Opening the row shows a labelled textarea "Describe the product or paste a PRD", buttons "Analyze" and "Cancel". | "Turn a description or PRD into a full blueprint" | Persona label plus counts | Add to preview, Dismiss |
| Design subagents (`harness:design-agents`, 2 min) | A persona | "A custom subagent fleet for the persona" | Subagent names plus reasoning | Add to preview, Dismiss |
| Generate skill specs (`harness:generate-skills`, 2 min) | A persona | "Specialised skills for the persona" | Skill spec names plus reasoning | Add to preview, Dismiss |
| Generate document (`harness:generate-document`, 2 min) | Something in the preview | "A requirements document from the preview" | Scrollable viewer (`max-h-40 overflow-auto font-mono text-[11px]`, focusable, labelled "Generated document") | Copy, Dismiss |

A `<details>` "More helpers" holds three more rows with the same anatomy: MCP suggestions (`harness:discover-mcp`, result list, Add to preview), Generate prompt (`harness:generate-prompt`, result in a viewer, "Use as prompt" replaces the preview prompt, Copy), CLAUDE.md preview (`harness:generate-claude-md`, viewer, Copy).

`harness:search-skills` and `harness:create-skill` have no row (decision 8, D7): parity row 54 is `keep (agent tool)` for those two, because the agent's existing tools already reach them (row 48). `harness:discover-mcp`, `harness:generate-prompt` and `harness:generate-claude-md` are `wire` through the three rows above.

States of one row:

- Idle: description shown, status slot empty.
- Needs input missing: row button `aria-disabled="true"`, description replaced by the reason ("Needs a persona. Describe who this is for in the chat first.") and referenced by `aria-describedby`. Never a tooltip-only reason. (`dark-sidebar-full-newproject-stack.png`)
- Busy: status "Working..." in `text-state-run` with a spinner, body "Analyzing your description. This can take up to 3 minutes; you can keep chatting." (2 minutes for the others). `aria-busy="true"` on the row. A section-level sr-only `role="status"` region announces "Analyzing intent. This can take up to 3 minutes." There is no cancel because the RPC cannot be cancelled; the copy says so by saying the user can keep chatting. While one row is busy every other row's button is `aria-disabled="true"` (one helper at a time, so results cannot merge in a different order than the user expects).
- Result: status "Ready" with a check icon; body shows the result and its actions. Add to preview merges field by field into the preview and the row returns to idle with an sr-only "Added to preview" announcement.
- Error: body is an error card (`role="alert"`, base-content text): "<Helper> failed", the reason in plain words, outline "Try again", ghost "Dismiss". The preview is not changed.

Focus: the row button keeps focus while its body opens. Dismiss and Add to preview return focus to the row button.

Screenshots: `dark-sidebar-full-configure-ai-helpers.png` (Suggest = result, Analyze = busy, Design subagents = error, others idle), `light-sidebar-full-configure-ai-helpers.png`, `dark-sidebar-full-presets-save-form.png` (Generate document result).

### 5.6 Presets (parity rows 44-46)

Label "PRESETS", meta "N saved".

Start from a preset: `label` "Start from a preset", a `select select-sm` (edge `border-base-content/50`) listing "Choose a preset...", then "<name> (N agents, N skills)" per preset, and an outline "Load" button. Help line "Loads the preset into the preview. Existing preview items are kept where they do not conflict." After loading: info card `role="status"` "Loaded "<name>"", "It is in the preview now. A note was added to your message box so the agent knows; edit it and send when ready." (`dark-sidebar-full-preset-loaded.png`). With zero presets the select is replaced by "No saved presets yet. Apply or save one to reuse it." Presets list is read once at init (row 46).

Save as preset: a disclosure button ("Save as preset", chevron, `aria-expanded`, `aria-controls="save-form"`). The form: help "Saves the current preview as a reusable preset. Nothing is written to the workspace until you apply." Name input (required; label shows "(required)"), Description textarea (optional), outline "Save preset". A missing name shows `aria-invalid="true"`, `aria-describedby` to "Enter a name for the preset." (`role="alert"`, error icon, base-content text). The button is `aria-disabled` while the preview is empty. Success: `role="status"` card "Saved "<name>"" and "You can start from it in any workspace." Error: `role="alert"` card "Could not save the preset" and "The presets folder is not writable. Nothing was saved." (`dark-sidebar-full-presets-save-form.png`, `light-sidebar-full-presets-saved.png`)

Apply also writes a preset to disk (row 44); the Hub's Saved Presets card keeps listing them (7.2).

### 5.7 Session (parity row 25)

A disclosure section, collapsed by default: button with chevron, label "SESSION", and a one-line summary at the right ("Context 41% · $0.31"). Expanded: the existing `ptah-session-stats-summary` component, unchanged, fed from the tab's session. It is here because 677 moves the stats strip out of the chat area and into its inspector, and the builder page shows no inspector (section 11, note 2).

### 5.8 Setup states (parity row 12)

| State | Sidebar | Chat | Screenshot |
| ----- | ------- | ---- | ---------- |
| Initializing | Skeleton bars under Preview with caption "Initializing AI Team Builder..." (`role="status"`, `aria-busy`); AI helpers and Presets read "Available once the builder has loaded."; no Apply section | Usable at once | `dark-configure-init-loading.png` |
| Init error | A "Builder setup" section first: `role="alert"` card "Could not load workspace details", "Apply and the AI helpers need them. You can keep chatting meanwhile.", outline "Retry". Apply, helpers and presets stay off until Retry succeeds. | Usable | `dark-configure-init-error.png` |
| Session missing | Page body replaced by a centered `role="status"` card "This builder session is no longer open." with "Back to Setup Hub". It shows when the page is entered without a tab id, when the tab id in the route does not resolve (closed from the tab bar, or not restorable after a reload), or when the tab is closed while the page is open. The stack-profile and preview records for that tab id are not read. | none | `dark-page-session-missing.png` |
| Wrong session kind | Same card layout, `role="status"`: "This session is not an AI Team Builder session." (or "...not a New Project session.") / "It is open as a normal chat." with "Open in chat" (activates the tab in the chat view) and "Back to Setup Hub". Shown when the tab exists but its workflow tag is missing or of the other kind than the page mode in the route. The page never retags or adopts the tab. | none | `dark-page-wrong-kind.png` |

## 6. Page notices (under the header, above the body)

Full-width strips, `px-4 py-2.5 border-b`, icon, heading `text-[13px] font-semibold`, text `text-xs`, optional actions. They never block Stop, Send or Apply.

| Notice | Role | Copy | Actions | Screenshot |
| ------ | ---- | ---- | ------- | ---------- |
| Builder instructions could not be loaded (failed `harness:workflow-prompt` or seed; today only `console.error`) | `alert` | "The builder instructions could not be loaded" / "The agent does not know it is configuring a team yet. Retry, or start over." | Retry (outline), Start over (ghost) | `dark-configure-launch-error.png` |
| Draft resumed | `status` | "Draft resumed" / "The agent is paused. Send a message to continue." | Dismiss | `dark-configure-draft-resumed.png` |

The "agent may still be running" warning from a failed abort belongs to the Setup Hub (7.2), because leaving always lands there.

There is no "Not shown in the grid" notice on this page (D5, section 11): the builder entry never asks the canvas to adopt the tab, so the grid tile cap cannot occur on this path. The notice and its screenshot (`dark-configure-gridcap-notice.png`) were removed in round 1. `dark-configure-empty-wide.png` shows the first screen: normal composer placeholder, guidance in the sidebar.

## 7. Leave and draft flow

### 7.1 The shared leave dialog (replaces the builder confirm and the Hub confirm; parity rows 8, 43)

One standalone OnPush component, used on the builder page and on the Hub. It appears only on leaving actions: Start over, a conflicting start from the Hub, a mode switch, and Resume while another session is active. Stop never opens it.

Structure: `role="dialog" aria-modal="true" aria-labelledby aria-describedby`. Backdrop `fixed inset-0 z-[60] flex items-center justify-center bg-base-300/70 p-4` (same as today's Hub confirm). Panel `surface-3 rounded-lg p-5 w-full max-w-[420px] max-h-[calc(100vh-2rem)] overflow-y-auto`. Title `text-base font-semibold`. Body `text-sm text-base-content-muted`. Notes `rounded-md border border-surface-border-strong bg-surface-2 px-2.5 py-2 text-xs`. Buttons `btn btn-sm`, right aligned, in this DOM and visual order:

1. Cancel: `btn-outline border-base-content/50`. Initial focus.
2. Discard: `btn-outline border-base-content/50` with a trash icon in `text-state-err`.
3. Save as draft: `btn-primary`. The only primary button.

Copy by context (the same three buttons everywhere):

| Context | Title | Body |
| ------- | ----- | ---- |
| start-over (agent running) | "Leave AI Team Builder?" or "Leave New Project Setup?" | "Save this session as a draft to pick it up later from Setup Hub, or discard it. The agent is running and will be stopped either way." |
| start-over (idle) | same | "Save this session as a draft to pick it up later from Setup Hub, or discard it." |
| new-project (Hub intake while a builder session is open) | "Start the New Project?" | "An AI Team Builder session is open in this workspace. Save it as a draft to come back to later, or discard it. Starting a new project stops its agent." |
| switch (Hub opens the builder while New Project is open) | "Open the AI Team Builder?" | "A New Project session is open in this workspace. Save it as a draft to come back to later, or discard it. Opening the builder stops its agent." |
| resume (Resume draft while another session is open) | "Resume this draft?" | "Your current session becomes the draft, and the draft you picked opens in its place. Or discard the current session instead." |

Extra note when a draft already exists in this workspace: "You already have a saved draft from 14 Oct, 11:05. Saving replaces it. The older session stays in your session history." (one draft per workspace, 652 D16).

States:

| State | Behaviour | Screenshot |
| ----- | --------- | ---------- |
| Default | As above | `dark-leave-dialog-start-over.png`, `light-leave-dialog-start-over.png` |
| Session not started | Save as draft is `aria-disabled="true"` with `aria-describedby` to a visible note "Waiting for the chat session to start. Save as draft is available once the session exists." Discard and Cancel stay available. | `dark-leave-dialog-save-pending.png` |
| Saving | All buttons `disabled`; Save shows a spinner and "Saving..."; `aria-busy="true"` on the dialog; no second confirmation | `dark-leave-dialog-saving.png` |
| Save failed | `role="alert"` strip inside the dialog: "The draft could not be saved, so nothing changed. Try again, or discard." Buttons re-enabled, Save reads "Try again". The workflow stays active; success is never claimed. | `light-leave-dialog-save-failed.png` |
| Narrow (host under 460 px) | Buttons stack full width, 40 px high, same order | `dark-narrow-400-leave-dialog.png` |

Keyboard (verified with real key presses in the prototype, `capture.mjs checks`): focus lands on Cancel; Tab and Shift+Tab cycle only through the enabled buttons; Escape and a backdrop click are Cancel; the page behind (header and body) is `inert`; on close focus returns to the trigger (Start over button, or on the Hub the control that started the action). On the Hub intake flow the intake modal stays mounted and `inert` underneath; Cancel returns focus to its "Start planning" button.

Abort failure: leaving continues. The destination (Setup Hub) shows a persistent, dismissible warning (7.2). The raw RPC error is never shown. One leave transition runs at a time.

### 7.2 Setup Hub changes (parity rows 1-10)

The Hub keeps its look. Changes only:

| Element | Change | Screenshot |
| ------- | ------ | ---------- |
| Resume draft card | After the hero line, before the card grid, current workspace only: `rounded-xl border border-state-run/45 bg-base-200 px-5 py-4`. Label "DRAFT", title "AI Team Builder draft" or "New Project draft", meta row with workspace, "Last activity", "Saved" and turn count. Buttons: primary "Resume draft" (play icon) and outline "Delete draft" (`aria-label` "Delete the AI Team Builder draft"). A blank workspace shows no card. | `dark-hub-resume-draft.png`, `light-hub-resume-draft.png` |
| Delete draft confirm | Small dialog (`max-w-[380px]`), same structure: "Delete this draft?" / "The draft is removed from Setup Hub. The session stays in your session history, and nothing in the workspace changes." Buttons Cancel (initial focus) and Delete draft. | `dark-hub-delete-draft-confirm.png` |
| Resume with another session open | The leave dialog, context "resume" | `light-leave-dialog-resume-from-hub.png` |
| Draft whose chat session is gone | The card stays with an error line `role="alert"` "This draft's chat session could not be found, so the transcript cannot be restored. Nothing was started." and buttons Retry, Delete draft. No agent is started silently. | `dark-hub-draft-session-missing.png` |
| New Project card | Unchanged structure: "Start New Project" when nothing is open; when a New Project session is open the label "In progress" (or "Running" while the agent works), the text "A New Project session is already open in this workspace. Pick up where you left off; starting again would replace it." and "Resume New Project" (focuses that session's builder page). | `dark-hub-new-project-resume.png` |
| AI Team Builder card | Same rule: "Running" or "In progress" label and "Resume AI Team Builder" while a session is open (decision 15) | `dark-hub-new-project-resume.png` (card) |
| Conflict (Start New Project while a builder session is open) | The leave dialog, context "new-project" | `dark-leave-dialog-new-project-from-hub.png` |
| Abort failed | Warning banner above the hero, `role="status"`, dismissible: "The workflow was closed, but the agent may still be running" / "Stopping it failed. Check the session list and stop it there if it keeps going." | `dark-hub-abort-warning.png` |
| Open failed (adapter outcome `failed`) | Error banner `role="alert"`: "Could not open the builder" / "Nothing was started. Try again." with Retry. Outcome `cancelled` shows nothing. | `dark-hub-open-failed.png` |
| Legacy relay with a conflicting mode (row 10) | Info banner `role="status"`: "A New Project session is already open" / "Use the cards below to choose what happens to it." Nothing is discarded. | `dark-hub-relay-cancelled.png` |

The intake modal, the card grid, the progress ring, the CLAUDE.md status and the Saved Presets card are unchanged (rows 1, 2, 5, 44).

## 8. Responsive behaviour

Bands come from the width of the page host (ResizeObserver, as the canvas rail does), not from the viewport. In the VS Code side panel and a narrow Electron window the host width is the panel width.

| Host width | Sidebar | Header | Chat |
| ---------- | ------- | ------ | ---- |
| 960 px and up | Docked 336 px, open by default | Full labels | At least 624 px |
| 720 to 959 px | Docked 336 px, open by default | Full labels; summary may wrap to a second line | At least 384 px |
| Under 720 px | Closed full-cover sheet, opened from the peek bar | Workflow badge compact, summary hidden, toggle replaced by the peek bar, Start over and Back icon only (32 px, `aria-label`s kept) | Full width |

Peek bar (under 720 px): `button` `flex items-center gap-2 w-full min-h-11 px-4 py-1.5 border-b border-base-300 bg-surface-1`. Left "Configuration" (`text-xs font-semibold`), summary (`text-[11px]` muted), then the status at the right: "Ready to apply" (`text-state-done`, check-circle), "Applied" (`text-state-done`), "Apply failed" (error icon, base-content text), "Needs your answer" (`text-state-need`, hand icon) when the chat has a pending permission or question, then a chevron that turns 180 degrees when open. `aria-expanded`, `aria-controls="builder-sidebar"`. (`dark-narrow-400-closed-peek.png`, `light-narrow-400-closed-peek.png`, `dark-narrow-400-needs-answer.png`)

Sheet (under 720 px): the sidebar covers the body (`absolute inset-0 z-20 bg-surface-1`, `shadow-[var(--elev-shadow-raised)]`), the header and the peek bar stay visible and active above it. It slides in over 180 ms with `--ptah-ease-soft` (instant with reduced motion). The peek bar is its header and its close control, so there is no second close button.

- Not modal and no focus trap. The covered chat column is `inert` and `aria-hidden` while the sheet is open, so Tab cannot land on content nobody can see. Header, peek bar and sheet stay in the tab order; after the last sheet control Tab continues out of the page as normal.
- Opening from the keyboard leaves focus on the peek bar; the next Tab enters the sheet (677 D43: no focus move on open).
- Escape closes the sheet and returns focus to the peek bar. Activating the peek bar again does the same.
- If a permission or question arrives while the sheet is open, the sheet closes, focus moves to the peek bar, and its status reads "Needs your answer". The user is never left unable to see a card that blocks the agent.
- Focus when the sheet closes while focus is inside it (review finding 7), whatever the cause: Escape, the peek bar, a permission or question arriving, or the host widening past 720 px. Focus moves to the peek bar. If the close came from another control that still exists and is visible, focus goes to that invoking control instead. If the host widened and the peek bar is gone, the sidebar becomes the docked panel; focus stays where it is when that node survives, otherwise it goes to the header "Hide panel" toggle. Focus is never left on a removed or `inert` node, and a close while focus is outside the sheet does not move focus.
- A dialog opened over the open sheet (for example Start over): the dialog traps focus (Cancel first, Tab cycles inside, 7.1). While it is open, the header, peek bar, sheet and covered chat column are all `inert`. Inert is derived, not stored: the chat column is `inert` when the sheet is open or a dialog is open; the other regions are `inert` only while a dialog is open. On close the previous state is therefore restored exactly: the chat column stays `inert` if the sheet is still open, and becomes interactive if the sheet closed meanwhile (for example a permission arrived). Focus returns to the invoking control (the Start over button); if it no longer exists, to the peek bar. Verified with real key presses in `capture.mjs checks`.
- The sheet scrolls vertically inside; there is no horizontal scroll at 360 or 400 px (measured, `capture.mjs checks`). File paths, chips and toolchain text wrap (`break-all` and `flex-wrap`).

Dialogs under 460 px stack their buttons (7.1). Short windows: dialog panel and sheet scroll internally.

Screenshots: `dark-narrow-400-sheet-open.png`, `light-narrow-400-sheet-open.png`, `dark-narrow-360-sheet-applied.png`, `dark-narrow-400-newproject-sheet.png`, `dark-narrow-400-leave-dialog.png`.

## 9. Themes and contrast

Only existing tokens are used: DaisyUI semantic colours of `anubis` and `anubis-light`, `surface-0..3`, `surface-border`, `surface-border-strong`, `text-base-content-muted` (`--bcm`), `text-state-run|need|err|done` (`--state-ink-*`), the global 2 px focus ring, `--ptah-ease-soft`. No new token. Sources: `apps/ptah-extension-webview/tailwind.config.js` (theme values lines 105-190), `styles.css` (surfaces, focus ring).

Standard applied: WCAG 2.2 AA (the project names no other). Text 4.5:1, graphics and focus indicators 3:1, field edges 3:1 (1.4.11). Measured by `prototype/assets/contrast-check.mjs` (re-runnable; sRGB compositing for tints, sRGB approximation of the two `color-mix` surfaces).

| Pair | Dark | Light | Needs |
| ---- | ---- | ----- | ----- |
| base-content on page (b1) | 14.86 | 15.91 | 4.5 |
| base-content on sidebar (surface-1) | 14.01 | 14.41 | 4.5 |
| base-content on dialog (surface-3) | 12.52 | 13.35 | 4.5 |
| muted text on page | 6.06 | 6.03 | 4.5 |
| muted text on sidebar | 5.71 | 5.46 | 4.5 |
| muted text on dialog | 5.10 | 5.06 | 4.5 |
| muted text on preview card (b2) | 5.66 | 5.39 | 4.5 |
| primary-content on primary (Apply, Save as draft) | 4.82 | 6.84 | 4.5 |
| state-done text on success tint (ready card) | 4.70 | 4.74 | 4.5 |
| state-need text on warning tint (pin badge) | 5.29 | 4.78 | 4.5 |
| base-content on error tint (alert body) | 13.13 | 12.50 | 4.5 |
| state-run text on sidebar (busy label) | 4.75 | 5.49 | 4.5 |
| state-need text on page (peek "Needs your answer") | 6.61 | 5.83 | 4.5 |
| state-done text on page (peek "Ready", "Applied") | 5.62 | 5.71 | 4.5 |
| base-content on workflow badge (b3) | 12.29 | 13.21 | 4.5 |
| state-err icon on error tint (graphic) | 4.35 | 4.81 | 3 |
| state-err icon on dialog (Discard trash icon) | 4.15 | 5.14 | 3 |
| Focus ring on sidebar | 8.31 | 5.68 | 3 |
| Focus ring on dialog | 7.43 | 5.26 | 3 |
| Field edge `base-content/50` on sidebar | 4.41 | 3.20 | 3 |
| Field edge `base-content/50` on dialog | 4.22 | 3.14 | 3 |
| Rejected: stock field edge (`base-content/20`) on sidebar | 1.87 | 1.58 | 3 (fails, so inputs use /50) |
| Rejected: `state-err` as text on error tint | 4.35 | 4.81 | 4.5 (fails in dark, so error text is base-content) |
| Rejected: `state-err` as text on dialog | 4.15 | 5.14 | 4.5 (fails in dark) |

Status is never colour alone: every status has an icon and words.

## 10. Accessibility

- Landmarks and names: page `h1`; sidebar `aside` named "Configuration"; each sidebar section `section` with `aria-labelledby` its `h3`; the dialog `aria-labelledby` and `aria-describedby`.
- Transcript `role="log"` and permission and question cards come from the shared ChatView (rows 21-24). The page adds no second log.
- Live regions: `role="alert"` for Apply failed, restore failed, init error, preset save error, helper errors, launch error, draft-session-missing, open failed, and the dialog save error. `role="status"` for the pin badge, Apply result and warnings, health line, "Restored after reload", the AI helper busy announcement (sr-only, polite), the session-missing card, the resumed notice, the Hub relay and abort banners. One announcement per event: the warnings card is part of the same result, not a second alert.
- Icon-only buttons have `aria-label`s: Back, Start over (narrow), Stop generating, Send message, Select model, Select reasoning effort level, Copy the list of written files, Dismiss notice, Dismiss warning, Delete the AI Team Builder draft.
- Toggle and disclosure controls expose state: sidebar toggle and peek bar `aria-expanded` and `aria-controls`; "Save as preset", "Session", helper rows `aria-expanded`.
- Disabled-with-reason controls use `aria-disabled="true"` plus a visible reason tied with `aria-describedby`, so keyboard and screen-reader users can reach the reason. They ignore activation.
- Focus management: dialog (7.1), sheet (8), Apply result (5.2), helper rows (5.5). Global focus ring (2 px, theme secondary, gold-strong in the light theme) is never overridden.
- Targets: every control is at least 32 px high except text buttons inside lists (24 px minimum) and the 44 px peek bar and helper rows; the prototype audits every visible control at 24 x 24 minimum (`capture.mjs checks`, 0 failures).
- Reduced motion: the sheet, chevron rotation and skeleton shimmer collapse through the existing reduced-motion block in `styles.css`.
- Keyboard order: header (toggle, Start over, Back) then chat then sidebar sections; under 720 px header, peek bar, sheet when open, then chat.

## 11. Notes for the architect

**Entry sequence (D5, review finding 3).** 649 does not split or change the shared `WorkflowTabLauncherService`: it always navigates to `chat` and may ask the grid to adopt the tab (`workflow-tab-launcher.service.ts:26-59`), neither of which the builder wants. The builder owns a local adapter built on existing `TabManagerService` APIs (`createTab`, `setWorkflow`):

1. Setup Hub card or legacy relay (`requestHarnessWorkflow`).
2. `HarnessWorkflowRequestService` resolves the entry: same-mode resume, cross-mode abort and reset, and the draft choice (652 D16-D18, 7.1). Outcomes `landed`, `cancelled`, `failed` stay as today (7.2).
3. Builder-local adapter, in this order: (a) for New Project, call `harness:start-new-project` and keep its result; (b) `createTab`; (c) `setWorkflow(tabId, kind)`, which tags the tab and registers it in the workflow index (same rules and lifecycle as the launcher's tag, so tab-bar and session-list opening still gives a normal chat with the workflow badge, D2); (d) install the first-message preamble from `harness:workflow-prompt` (failure = page notice, section 6); (e) New Project only: write and validate the durable stack-profile record (note 4) and wait for the write to finish; (f) New Project only: make the intake summary the visible first user turn and send it through the normal tab sender (so New Project has a visible first turn from the start). The record write always comes before the first turn; a failed write does not block the turn, it only means the Stack profile section later shows "details unavailable". The adapter never calls `requestCanvasTab`, never targets a canvas tile, and never prefills the composer.
4. Navigate to `harness-builder` carrying the tab id (note 6).
5. The page binds to that tab and renders `ptah-session-embed` plus the sidebar.

Grid tile cap (FU-648-2). On the builder path it cannot occur: nothing in the sequence asks the grid to adopt the tab, so the page has no "Not shown in the grid" notice and the screenshot was removed (section 6). The case still exists for a caller that adopts into the grid (any non-builder workflow caller such as 650/651 using the combined `open()`); that caller needs the result to say `adopted: false` and owns its notice. A builder session opened later from the session list in grid mode is normal chat adoption (D2), owned by the grid code. Parity row 58 therefore does not apply to the builder page and stays open for the first grid-adopting caller.

**Other points the design depends on** (architect decisions unless marked; none changes what the user sees except as stated):

1. Chat chrome inside the builder page. AGREED with the 677 session (D8, option B, 677 decisions row 85). The page owns the header, so the embedded ChatView must show no 677 session header and no 677 inspector there (677 D36 opens the inspector by default for workflow tabs; two right panels and two headers is the conflict 677 D35 rejected). Contract:
   - 677 owns `libs/frontend/chat/src/lib/tokens/session-embed-chrome.token.ts` (`SessionEmbedChrome = 'full' | 'bare'`, `SESSION_EMBED_CHROME`) and the barrel line `export { SESSION_EMBED_CHROME, type SessionEmbedChrome } from './lib/tokens/session-embed-chrome.token';` in `libs/frontend/chat/src/index.ts`. 649 adds a BYTE-IDENTICAL copy of that file and line (exact text in `decisions.md` D8), so either merge order works.
   - The builder page sets `chrome="bare"` on `ptah-session-embed` (new embed input, `'full' | 'bare'`, default `'full'`); the embed provides `SESSION_EMBED_CHROME` in its scoped injector, next to `SESSION_CONTEXT`. Canvas keeps `'full'` (no change).
   - 677 reads the token (optional inject; absent or `'full'` = today's behaviour): batch CV-1 renders no inspector, skips the D36 default-open and attaches no shell controller; batch CV-2 renders no `ptah-session-header`, header chips or limit dot. 649 edits none of 677's files and 677 edits none of 649's.
   - Before 677 lands: nothing renders 677 chrome, so there is nothing to hide. Today's ChatView still shows its stats strip in the chat column, so stats appear both there and in the Session section (5.7) until 677 lands. This duplicate is accepted; 649 does NOT add a token read to ChatView (that is 677's side of the contract).
   - After 677 lands: `'bare'` hides the header and the inspector; the layout is exactly the one in this spec.
   - Not changed by this contract: every other ChatView behaviour (transcript, composer, Stop, cards).
2. Session stats. After 677 (its delta 3) the stats strip, plan limits and background-agent tray leave the chat column and move into the inspector, so in bare mode the chat column shows no stats. The "Session" section (5.7) renders them itself: before 677 with the existing `ptah-session-stats-summary` component; after 677 with `injectSessionStatsSource({ tab, sessionId, budget })` from `@ptah-extension/chat` (added by 677 CV-1) feeding `ptah-inspector-session-stats` (`InspectorSessionStatsComponent`, input `stats: SessionStatsInputs`, `@ptah-extension/chat-ui`) or the existing strip.
3. Composer prefill by tab. Preset load (decision 9) and "Ask the agent to propose it again" (5.4) use `requestComposerPrefill(text, tabId)`; the Configure first screen does not (D6). Verified in the review: the embedded ChatView consumes a prefill targeted at its tab (`chat-view.component.ts:1375-1389`) and `app-state.service.ts:1432-1448` publishes and clears it; no chat change needed.
4. Stack-profile handoff (review finding 4). The `harness:start-new-project` result is already returned by the RPC (`rpc-harness.types.ts:516-528`: `plugins` and optional `toolchain`) but the Hub passes on only `seedPrompt` and `intake` (`setup-hub.component.ts:1440-1460`), and the chat tab workflow tag has no field for it (`chat-types.ts:603-610`; D1 forbids adding one).
   - What is stored: one record `{ version, tabId, workspaceRoot, plugins, toolchain?, capturedAt }`, with `plugins` and `toolchain` exactly as the RPC returns them.
   - Where: a builder-owned store in the harness-builder lib, not a chat-types change. Key = pinned workspace root + tab id. Written by the adapter (entry step 3e) before navigation and before the first turn, only when the RPC succeeded. Memory plus the webview's existing persisted state, so a reload keeps it; the storage backend is the architect's choice, the behaviour is fixed here.
   - Validation on read: the key matches the page's tab id and pinned workspace, `version` is known, `plugins` has the expected arrays, `toolchain` is absent or has the RPC shape. Any failure counts as absent and the bad record is deleted.
   - Reload lookup: after the page binds its tab (note 6), it reads the key with the pinned workspace. Never "latest record for the workspace".
   - Cleared with the preview snapshot (5.4 rule 3): Start over, Discard, tab close, session delete, init sweep. Kept by Save as draft, Stop and Apply.
   - When the "details unavailable" fallback shows (5.3): only when the lookup yields nothing usable for this tab and workspace, and always after a skeleton, never during it. A Configure tab never shows the section.
5. Preview snapshot. Today the proposal store is written only by the agent tool, and the preview lives in root-service signals (`harness-builder-state.service.ts:85-103,312`); nothing persists sidebar-made edits keyed by a normal tab, and the old workflow record restores the old separate surface (`harness-workflow.service.ts:112-117,568-616`). This is new state work. The behaviour (ownership, per-field precedence, clearing, no resurrection, workspace isolation) is specified in 5.4; the "Restored after reload" label covers agent proposals and user snapshot alike.
6. Page to tab binding (review finding 4). The tab id is carried as a route parameter (`harness-builder` with the tab id), and the route parameter is the only authority for which tab the page shows, also after a reload (the surface router persists it with the navigation state). If the surface router cannot carry or persist a parameter, the architect adds that capability to the route; a single mutable "active builder tab id" value is NOT an acceptable substitute, because opening another builder would silently rebind a page that reloads. The binding changes only through an explicit entry (Hub card, legacy relay, Resume, or later TASK_2026_680), which navigates with the new tab id. The page binds to that tab, not to "the active tab", so a tab switch in the tab bar does not rebind it. On bind it checks: the tab exists (else "Session missing"), its workflow tag matches the page mode (else "Wrong session kind"), both cards in 5.8. After a reload the route parameter is the lookup key for the tab, the stack profile and the preview snapshot. The `harness-builder` route stays the permanent host (`app.routes.ts:118-138`).
7. Header X destination (decision 11): activate this tab and switch to the chat view.
8. Apply while processing is disabled and explained (5.2). One leave transition at a time (7.1). A failed `chat:abort` never blocks leaving and yields the Hub warning (FU-17).
9. Draft = the kept workflow-tagged tab and its session (652 plan, superseded for storage). Replacing a draft closes the older draft tab; the backend session and proposal record stay (7.1 note), and the new session never hydrates them (5.4 rule 4).

## 12. Parity table

Every row marked keep, move or wire has a place. Section numbers refer to this document. Source of the rows is `parity-inventory.md`.

| # | Capability | Decision | Design place |
| - | ---------- | -------- | ------------ |
| 1 | Hub card grid, ring, CLAUDE.md status | keep | 7.2 (unchanged) |
| 2 | Hub header, back, refresh | keep | 7.2 (unchanged) |
| 3 | AI Team Builder card opens the builder | move | 7.2 AI Team Builder card; opens the builder page (section 1) |
| 4 | New Project card, Start vs Resume, label | move | 7.2 New Project card |
| 5 | New Project intake modal | keep | 7.2 (unchanged; leave dialog stacks over it, 7.1) |
| 6 | Intake submit and backend start | keep | 4 (start behaviour), 5.3 |
| 7 | Start-new-project report | wire | 5.3 Stack profile |
| 8 | Hub conflict confirm | keep | 7.1 contexts new-project and switch |
| 9 | Entry adapter outcomes | move | 7.2 open failed, 11 (entry sequence, D5) |
| 10 | Legacy relay | keep | 7.2 relay banner |
| 12 | Builder init, retry | keep | 5.8 |
| 13 | Workspace pin and badge | keep | 3 pin badge; 5.2 target line |
| 14 | Title per mode and summary | move | 3 title, badge, summary |
| 16 | Configure Harness first-turn composition | keep | 4; failure in 6 |
| 17 | New Project auto-start | keep | 4 |
| 33 | Side panel toggle | move | 3 toggle; 8 peek bar |
| 34 | Live config preview | keep | 5.4 |
| 35 | Proposal channel | keep | 5.4 (backend unchanged) |
| 36 | Live proposal intake, both kinds | keep | 5.4 |
| 37 | Proposal hydration, unavailable state | keep | 5.4 states |
| 38 | Field-aware merge | keep | 5.4 |
| 39 | "Configuration looks ready" and Apply | keep | 5.2 Ready |
| 40 | Apply with pinned root | keep | 5.2 |
| 41 | Apply result and warnings | wire | 5.2 Applied |
| 42 | Apply error with Dismiss | keep | 5.2 Error |
| 43 | Start over | keep | 3; 7.1 |
| 44 | Presets written by Apply, Hub list | keep | 5.6 last line; 7.2 |
| 45 | Save a named preset | wire | 5.6 Save as preset |
| 46 | Start from a preset | wire | 5.6 Start from a preset |
| 47 | Harness health | keep | 5.2 health line |
| 48 | Agent tools | keep | No UI; available to the tab's agent (decision 8) |
| 49 | AI suggest from persona | wire | 5.5 |
| 50 | AI design subagents | wire | 5.5 |
| 51 | AI generate skill specs | wire | 5.5 |
| 52 | AI generate document | wire | 5.5 |
| 53 | AI analyze intent | wire | 5.5 |
| 54 | Other wrapped endpoints | keep (agent tool) for search-skills and create-skill per D7; wire for discover-mcp, generate-prompt, generate-claude-md | 5.5 More helpers (three rows) and the note after them; decision 8 |
| 55 | Backend AI streaming | keep | No UI change (backend and CLI unchanged) |
| 57 | Accessibility set | keep | 10; 7.1 |
| 58 | Grid adoption of a workflow tab (FU-648-2) | wire, not on the builder path (D5) | 11: the builder adapter never adopts into the grid, so no notice here; open for the first grid-adopting caller |
| 59 | Workflow tag and badge | wire | 3 badge |
| 60 | `harness-builder` route | keep | 11 note 6; the route is the permanent host |

Rows delivered by the shared chat inside the embed (`replace-infra`): 11 (hand-off, no UI), 15 composer, 18 turn transport, 19 model and effort, 20 claim, 21 transcript, 22 execution nodes, 23 permission and question cards, 24 pending-question restore, 26 processing state, 27 Stop (decision 3), 29 reload resume, 30 tile and badge, 31 auto-scroll, 32 leave (the header X, decision 11), 56 operation streaming (helper busy state, 5.5). Rows with a page-side part: 25 session stats (5.7), 28 workflow-level errors (section 6 notices; turn errors stay in the chat).

## 13. Constraints

### Project rules in force (`[project-rule]`)

- `[project-rule]` Theme tokens only, no hex in components: `tailwind.config.js` colours and `styles.css` surfaces.
- `[project-rule]` Muted text through `text-base-content-muted` (`--bcm`): `styles.css` comment block, `base-content-muted.spec.ts`.
- `[project-rule]` Global focus ring `outline: 2px solid` secondary, gold-strong in the light theme: `styles.css` lines 683-710.
- `[project-rule]` Reduced motion collapses durations: `styles.css` lines 672-681.
- `[project-rule]` Workflow badge and compact variant: `workflow-badge.component.ts` (648).
- `[project-rule]` Existing components stay: `ptah-harness-config-preview`, `ptah-session-stats-summary`, badges and tooltips. Nothing is banned.
- `[project-rule]` Keep and fix: no removal without user approval (`context.md`).

### Inherited 648/677 design guidance (not project rules)

- Sidebar sections `p-4 border-b border-surface-border`, 304 px content, targets at least 24 px, at most one primary button per section: `../TASK_2026_648_374e/decisions.md` D5-D9 and the 677 inspector recipe. These are design decisions of sibling tasks, adopted here for consistency; they are not rules from `CLAUDE.md` or the repository configuration. If 648 or 677 changes them, this page follows.

### Lane-introduced constraints (`[lane-proposed]`)

- `[lane-proposed]` L1: new builder fields use `border-base-content/50` (the stock edge fails 3:1).
- `[lane-proposed]` L2: error text is base-content; error colour only on icon and border (dark theme contrast).
- `[lane-proposed]` L3: sidebar width 336 px (decision 1).
- `[lane-proposed]` L4: width bands (720 px, and 460 px for the dialog) are measured on the page host, not the viewport (decision 2).
- `[lane-proposed]` L5: peek bar plus non-modal sheet with the covered chat `inert`, and auto-close of the sheet when a permission or question arrives (section 8).
- `[lane-proposed]` L6: AI helpers run one at a time and their config results are proposals needing "Add to preview" (decision 7).
- `[lane-proposed]` L7: loading a preset prefills the composer with a note (decision 9).
- `[lane-proposed]` L12: preview precedence and snapshot lifecycle (5.4) and the sheet/dialog focus and derived-`inert` rules (section 8).
- `[lane-proposed]` L8: leave dialog default focus on Cancel, order Cancel, Discard, Save as draft, backdrop click = Cancel (decision 10).
- `[lane-proposed]` L9: Apply shows weight by completeness and a sticky result with a "Preview changed" state (decisions 5 and 6).
- `[lane-proposed]` L10: Setup Hub AI Team Builder card gets the Running / In progress label and "Resume" wording (decision 15).
- `[lane-proposed]` L11: focus moves to the result heading after Apply succeeds and to "Try again" after it fails (5.2).

### Tool-introduced constraints

- The prototype CSS is hand-written because the task forbids builds and the worktree has no Tailwind build step; `design-spec.md` section 14 gives the real utility strings. Class names in `prototype/assets/app.css` are prototype-only.
- Icons in the prototype are lucide-angular 1.0.0 data from the repo's `node_modules`, the same set the app renders.
- Screenshots come from headless Chromium via Playwright from the worktree's `node_modules`. Fonts fall back to system fonts offline, so text widths can differ by a few pixels.
- The chat in every screenshot is a labelled stand-in; the real chat is the shared ChatView.

## 14. Utility map (what the developer writes)

| Piece | Utilities | Source |
| ----- | --------- | ------ |
| Page header | `flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3 border-b border-base-300 bg-base-100` | existing header |
| Header buttons | `btn btn-ghost btn-sm`, square: `btn-square`, active: `btn-active` | existing |
| Pin badge | `badge badge-sm gap-1 max-w-[200px] border border-warning/45 bg-warning/12 text-state-need` | tailwind colours `state-need` |
| Sidebar | `w-[336px] shrink-0 min-h-0 flex flex-col bg-surface-1` | `surface-1` colour |
| Sidebar section | `p-4 border-b border-surface-border` | 677 recipe |
| Section label | `text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted` | 677 recipe |
| Section meta | `text-[11px] text-base-content-muted` | 677 recipe |
| Status card | `flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]`; done `bg-success/10 border-state-done/45`; warn `bg-warning/12 border-state-need/45`; error `bg-error/10 border-state-err/55`; info `bg-surface-2 border-surface-border`; icon `text-state-done` / `text-state-need` / `text-state-err` | tailwind colours |
| Apply button | primary `btn btn-primary btn-sm w-full`; partial `btn btn-outline btn-sm w-full border-base-content/50` | DaisyUI |
| File list | `ul rounded-lg border border-surface-border bg-surface-2`; row `px-2.5 py-1.5 font-mono text-[11px] break-all border-b border-surface-border last:border-0` | |
| Chip | `badge badge-outline badge-sm` (existing `badge-xs` in the preview component stays) | existing |
| Helper row | `rounded-lg border border-surface-border bg-surface-2`; button `min-h-11 w-full px-3 py-1.5 flex items-center gap-2.5 text-left rounded-lg hover:bg-base-content/5` | |
| Inputs | `input input-sm input-bordered w-full border-base-content/50`; `select select-sm select-bordered ...`; `textarea textarea-bordered ... border-base-content/50` | L1 |
| Viewer | `max-h-40 overflow-auto rounded-md border border-surface-border bg-base-100 p-2 font-mono text-[11px] whitespace-pre-wrap break-words` | |
| Peek bar | `flex items-center gap-2 w-full min-h-11 px-4 py-1.5 border-b border-base-300 bg-surface-1 text-left` | |
| Sheet | `absolute inset-0 z-20 bg-surface-1 shadow-[var(--elev-shadow-raised)]` | `styles.css` elevation |
| Dialog | backdrop `fixed inset-0 z-[60] flex items-center justify-center bg-base-300/70 p-4`; panel `surface-3 rounded-lg p-5 w-full max-w-[420px]` | existing Hub confirm |
| Draft card | `rounded-xl border border-state-run/45 bg-base-200 px-5 py-4` | |
| Motion | sheet 180 ms `--ptah-ease-soft`; chevron 150 ms | `chat-view.component.css` |
| Icons (lucide-angular names) | Workflow, X, RotateCcw, PanelRight, Settings, CircleCheck, CircleAlert, TriangleAlert, Info, LoaderCircle, Square, Send, ChevronRight, ChevronDown, Sparkles, Bot, Server, FileText, FileCheck, FilePen, User, History, Pin, Hand, Copy, Trash2, CirclePlay, HeartPulse, WandSparkles, Brain, Plug, Rocket, RefreshCw, ArrowLeft, Folder. Use the alias already imported in each file where one exists (`Loader2`, `AlertCircle`, `CheckCircle`). | repo `lucide-angular` 1.0.0 |

## 15. Proposed Removals

None. Nothing a user can see today is removed. Items that look like removals and are not: the header Stop (the chat's Stop replaces it), the banner above the composer (the sidebar Apply replaces it), the two Apply buttons (merged into one section), the builder's own transcript and composer (shared chat).

## Clarifications Needed

None. D8 (header and inspector of 677 inside the embed) was agreed with the 677 session on 2026-10-15 (option B, section 11 note 1, `decisions.md` D8).

Everything else in section 11 is an architect decision with a stated behaviour; none changes scope intent or removes a capability.

## Revision log

Round 1 (after `design-spec-review.md`, decisions D5-D8 in `decisions.md`):

| Finding | Change | Where |
| ------- | ------ | ----- |
| 1 chat chrome (D8) | `chrome="bare"` plus `SESSION_EMBED_CHROME` contract, behaviour before and after 677, marked pending 677 agreement; no longer an architect-only decision; Clarifications Needed lists D8 with owner orchestrator | 2 (row 19), 11 note 1, Clarifications Needed |
| 2 placeholder (D6) | Configure first screen uses the chat's normal placeholder; guidance in the sidebar Preview empty state; prefill kept only for the preset note and "propose it again". Prototype stand-in and the empty-chat screenshots re-captured | 2 (rows 9, 18), 4, 5.4, 11 note 3 |
| 3 launcher (D5) | No launcher split; builder entry sequence with a builder-local adapter; grid-cap notice and `dark-configure-gridcap-notice.png` removed (unreachable on the builder path); row 58 re-scoped | 2 (row 17), 6, 11 entry sequence, 12 |
| 4 stack handoff and binding | Tab-and-workspace keyed record, validation, reload lookup, fallback rule; route-param binding, kind check, "Wrong session kind" card | 5.3, 5.8, 11 notes 4 and 6 |
| 5 preview snapshot | Ownership, per-field precedence, clearing, no resurrection, workspace isolation | 5.4, 11 notes 5 and 9 |
| 6 row 54 (D7) | search-skills and create-skill are `keep (agent tool)`; `parity-inventory.md` row 54 and tally updated | 2 (row 8), 5.5, 12 |
| 7 sheet focus | Focus return when the sheet closes with focus inside; dialog over the sheet traps focus with derived `inert`; new real-key check | 8, `prototype/assets/capture.mjs` |
| 8 inherited guidance | 304 px / one-primary-button recipe moved out of `[project-rule]` into "Inherited 648/677 design guidance" | 13 |

Round 2 (orchestrator, after `design-spec-re-review.md`; findings 4 and 5 were PARTIAL):

| Finding | Change | Sections |
| --- | --- | --- |
| 4 stack write order and binding | Entry step 3: the durable stack-profile write (3e) now comes before the first New Project turn (3f); note 4 cites 3e. Note 6: the route parameter is the only binding authority across reloads; a single mutable "active builder tab id" is not acceptable; only explicit entries rebind | 11 entry step 3, notes 4 and 6 |
| 5 stale result after reload | Rule 2: proposals carry a turn-start time (live, or derived after reload from the persisted transcript); a proposal replaces a user-chosen field only if its turn started after `chosenAt`; same rule live and after reload; underivable turn start = user choice wins | 5.4 rule 2 |
