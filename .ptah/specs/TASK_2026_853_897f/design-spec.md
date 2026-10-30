# Design spec - TASK_2026_853_897f

Scope: Electron webview only. No new visual language: every class below already exists in
`mcp-port-config.component.ts`, `mcp-directory-browser.component.ts` or `skill-sh-browser.component.ts`.
Themes: `anubis` (dark) and `anubis-light` (`apps/ptah-extension-webview/tailwind.config.js`). Prototype:
`prototype/index.html`; screenshots `prototype/screenshots/dark.png` and `light.png`.

## Decisions

| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| 1 | Tool and skill toggles are **global** only (one list for all workspaces). The section says so in its note. Recorded as orchestrator decision #13 in decisions.md. | (a) global; (b) per workspace with override; (c) both | These are app-level prefix settings, not installed content. Phase A AC3 and B AC7 require survival across restart, not per-workspace values. `capabilities:setEnabled` `scope` (rpc-capability.types.ts:72) belongs to installable capabilities, which Surface 2 covers. Per-workspace would add a second column and a precedence rule for little gain. | Yes: add a scope control later. |
| 2 | Checked = "available in Ptah sessions". Same meaning as the MCP namespace checkbox. | on/off switch; checkbox | mcp-port-config.component.ts:134-143 uses `checkbox checkbox-xs checkbox-primary` in an "On" column. | Yes |
| 3 | Install scope is a 2-option radio group (segmented look) in a native `fieldset`/`legend`, not a checkbox. "This workspace" is the default when a folder is open; with no folder open nothing is preselected. | checkbox "Make global"; select; radio | A mutually exclusive choice with a visible default; radios announce "1 of 2". | Yes |
| 4 | Migration notice is one inline card at the top of the main chat view, dismissed with "Got it", plus "Open Marketplace". Shown whenever anything was retired or removed; persists across restarts until seen, including when migration finished before a chat view existed (decision #16). | toast (8 s, gone before reading counts); modal (blocks start); settings-only banner (missed) | P-4 wants one notice with counts and reinstall steps. Toasts here auto-close after 8 s (settings-save-feedback.service.ts); counts and steps need time. | Yes |
| 5 | Home-config MCP targets stay visible but disabled with a "Global only" badge in workspace scope. When the user explicitly selects All workspaces, all seven targets are preselected as today; switching back to This workspace clears only the home targets (decision #15). | keep seven everywhere; opt-in home targets | Review finding 7; mcp-directory-browser.component.ts:37-45,356-358; Phase D P-2 changes workspace preselection only. | Yes |
| 6 | Token costs in the prototype are illustrative. Only chars from context.md are measured (Workflow 5.5k chars, ScheduleWakeup 4.8k, ReportFindings 2.3k at ~4 chars/token); the rest are placeholders. The architect supplies the final list and costs. The UI shows "~" and no more than 2 significant digits. The final tool and skill rows, costs and the tool-to-skill dependency map are owned by the architect's measured list; rows here are placeholders. | measured per item; omit costs | The brief asks for an approx token cost. | Yes |
| 7 | ScheduleWakeup, Cron* and `/loop` are not in the default-off group (Decisions #11 of decisions.md). If the architect reverses this, they appear as rows with no layout change. | - | decisions.md #11, Phase A scheduling decision | Yes |
| 8 | No reverse conversion: only "Make global" exists; "Make workspace-only" is removed (decision #14). | - | Phase D AC2 asks only for conversion to global. | Yes |
| 9 | Tool and skill states are independent: a skill is available only when its own checkbox and its needed tool are both on. | tool owns skill; independent | Review finding 4; Phase B AC7 needs a re-enable control for every terminal-only skill. | Yes |

## 1. Claude Code tools & skills section

Placement: Advanced tab, directly below the `MCP & Browser` card, same parent spacing. New component, file next to
`mcp-port-config.component.ts` (`settings/pro-features/`).

### Structure and classes

| Part | Classes / token | Copy |
|---|---|---|
| Card | `card bg-base-200 border border-base-300 p-3`, `data-glass-surface="content"`, `aria-labelledby="claude-tools-heading"` | - |
| Title | `h2#claude-tools-heading.text-xs.font-bold.uppercase.tracking-wider.text-base-content` + lucide `Wrench` `w-4 h-4 text-secondary` (aria-hidden) | Claude Code tools & skills |
| Intro | `p.text-xs.text-base-content-muted.mb-3` | Choose which of Claude Code's own tools and skills Ptah sessions start with. Fewer items means a smaller first message and lower token use. |
| Applies note | `div[role=note].flex.gap-2.rounded.border.border-info/50.p-2.text-xs.text-base-content` (info dot) | Changes apply to **new sessions**. Sessions that are already open keep what they started with. These settings apply to all your workspaces. |
| Savings line | `p.text-xs.text-base-content` with `aria-live="polite"` | Currently hidden: about {N} tokens per new session (estimate). ({N} = sum of the costs of every item currently off, tools and skills together, rounded to 100; it recomputes live when any checkbox changes. Prototype example: tools off 2,900 + skills off 830 = 3,730, shown as 3,700.) |
| Group heading | `h3.text-xs.font-semibold` (one per table, referenced by `aria-labelledby` on the table) + `p.text-xs.text-base-content-muted` | see below |
| Table | `div.overflow-x-auto > table.table.table-xs` | - |
| On cell | `td.align-top > input.checkbox.checkbox-xs.checkbox-primary`, stable `aria-label="{name} tool"` (skills: `"{name} skill"`, e.g. "docx skill"); the checked state conveys on/off, so the name never changes, `[ptahBusyDisabled]="saving() \|\| !loaded()"` | - |
| Name cell | `td.align-top.font-medium.text-xs.text-base-content.whitespace-nowrap` | - |
| Cost cell | `span.badge.badge-outline.badge-xs.text-base-content` | ~1,400 |
| Description | `td.align-top.text-xs.text-base-content-muted` | one plain sentence |
| Skills that need it (tools table) / Needs tool (group 2) | same as description; "None" when empty. The RemoteTrigger row says "None": scheduling is not tied to it (decisions.md #11; `/schedule` stays listed by default). | - |

Group headings and one-liners:
1. "Built-in tools (off by default)" - "Turn a tool on to let agents use it. A skill that needs a tool also has its own checkbox below; both must be on."
2. "Terminal-only built-in skills (off by default)" - "Skills made for the terminal version of Claude Code."
3. "Skills synced from your claude.ai account (hidden by default)" - "Found in your Claude home folder. Turn one on to use it in new sessions."

Columns: tools table On / Tool / Token cost / Description / Skills that need it. Skill tables (groups 2) add a Needs tool column; group 3 is On / Skill / Token cost / Description. Skill tables On / Skill / Token cost / Description.
Header cells `scope="col"`, On column `w-10`, same as the matrix.

### States

| State | Behaviour |
|---|---|
| Default | Tool and skill rows unchecked (off); anything the user turned on checked. |
| Hover | Row `hover:bg-base-300/40` is not used by the matrix; keep none. Checkbox hover is DaisyUI default. |
| Focus | Visible DaisyUI focus ring on the checkbox; never removed. |
| Loading | Every checkbox disabled, 3 `skeleton h-4` rows per table; group headings stay. `aria-busy="true"` on the card. |
| Saving | Same as MCP matrix: `ptahBusyDisabled` while any save runs (D3). |
| Success | Existing `SettingsSaveFeedbackService.saveGeneric` toast and copy, unchanged: `Saved {label}.` with label e.g. "docx skill" (no shared feedback-service change). **Undo** restores the previous value of that one item and saves again (docx back to off). The "applies to new sessions" note stays visible above, so the toast does not repeat it. |
| Error (load) | Reuse the matrix block: `role=alert ... border-error/40` + `AlertCircle` + "Could not load the Claude Code tool and skill settings." + Retry `btn btn-ghost btn-xs`. Controls stay disabled; no defaults shown (a write built on defaults would overwrite the stored list). |
| Error (save) | Fixed copy, host text never shown (D15): "Could not update Claude Code tools and skills." The checkbox reverts to its stored value and keeps focus (focus returns to it if the save re-renders the row). |
| Dependency blocked | A skill whose own checkbox is on but whose needed tool is off keeps its checkbox checked and shows a `badge badge-warning badge-outline badge-xs` "{tool} tool is off" plus `aria-describedby` text "This skill is on but unavailable until the {tool} tool is on." Turning a tool on never changes a skill checkbox; a default-off skill stays off. |
| Empty (group 3) | `div.rounded-lg.border.border-dashed.p-3.text-center.text-xs`: bold "No claude.ai skills found", muted "If you sync skills from your claude.ai account, they will be listed here." No table, no heading change. |
| Fail-closed policy | If the capability policy cannot be verified, show the load-error block; toggles never bypass it (Phase B AC3). |

Dependency rule (AC A4): independent states. Every architect-listed terminal-only default-off skill keeps its own row and checkbox in group 2, including ones that need a tool (workflow-authoring needs Workflow; code-review needs ReportFindings in the prototype). A skill is effectively available only when its checkbox and its tool are both on; the Needs tool column and the Dependency blocked state say so. The final tool and skill rows and the dependency map are owned by the architect's measured list.

State gallery: the prototype shows the normal table once, then a compact gallery with one example per state (loading with disabled checkboxes and skeleton rows, load error, save error with focus return, saved toast, empty account skills).

Keyboard and a11y: Tab order = Retry (if shown), then checkboxes top to bottom in DOM order; Space toggles; Undo is
reachable in the toast. Every checkbox has a unique `aria-label`; tables have `aria-labelledby` the group heading; the savings line and toast use
`aria-live`/`role=status`; error blocks `role=alert`. No information by colour alone (the cost badge has text, the
info note has text). Test ids: `settings-toggle-claude-tool-{id}`, `settings-toggle-claude-skill-{id}`, `claude-tools-load-error`.

## 2. Install-scope choice

### Shared control (both install surfaces)

```
fieldset[aria-describedby=help] > legend.mb-1.5.text-[11px].font-medium.uppercase.tracking-wide.text-base-content-muted  ("Install to" / "Install for")
div.join (segmented, no role):
  label.btn.btn-sm.join-item  > input.radio.radio-xs.radio-primary[type=radio][name] + text
```
The native `fieldset`/`legend` names the group (no `role="radiogroup"`). Announced: "Install to, This workspace, radio button, 1 of 2, selected". Native radio arrow-key behaviour (Arrow keys move and select within the group, Tab leaves it) and a visible `:focus-visible` ring on the checked and unchecked label must be verified in the real DaisyUI build; the static prototype cannot prove them.
(Prototype draws the same with plain CSS; real build uses `join` + `btn btn-sm`, checked option `btn-primary`.)
Options: **This workspace** (default, `checked`), **All workspaces**. Help line under it, `p.text-xs.text-base-content-muted`:
- workspace: "Only {workspace name} will get this skill. You can make it global later." (MCP: "This workspace writes only project files. Tools that keep settings in your home folder need All workspaces.")
- all: "Every workspace will get this {skill|server}."

Placement: skills.sh install is a one-click card button today. Spec: clicking **Install** opens the same storefront panel the MCP directory uses (`ptah-storefront-panel`, heading "Install {name}") holding the scope radios and the primary button "Install to this workspace" / "Install to all workspaces". MCP: radios go above the existing "Install to" target fieldset.

States: default, hover/focus (DaisyUI), disabled (no folder), installing (button `loading loading-spinner loading-xs` + "Installing...", radios disabled), error.
- No folder open (AC4): both options stay visible. "This workspace" is `disabled`, **nothing is selected**, the primary button is `disabled`, help (`role=status`): "Open a folder to install into a workspace, or choose All workspaces to install for every workspace." Only after the user explicitly selects All workspaces does the button enable and read "Install to all workspaces". Never installs globally on its own.
- The "No workspace is open. Nothing was installed." `alert alert-error` appears only for an attempted workspace install (for example a stale request), never beside an available global choice.
- Install failure: existing `alert alert-error alert-sm` + Dismiss.

### MCP targets per scope (AC5, AC6)

| Scope | Preselected (checked) | Disabled |
|---|---|---|
| This workspace | VS Code, Claude, Cursor, OpenCode (workspace-file targets; the architect confirms the list against the delivery map) | Copilot, Codex, Antigravity: `checkbox disabled` + `badge badge-warning badge-outline badge-xs` "Global only" |
| All workspaces (explicit) | All seven checked, as today (decision #15) | none |

Choices the user changed that remain valid (for example unchecking Cursor) are preserved when switching scope. Returning to This workspace clears only the three home targets and disables them.
Each home target's choice is stored separately: switching back to All workspaces restores each one as the user left it (all three checked until the user changes one).

### Convert action on an installed row (AC2)

Row (marketplace installed lists; also the skills.sh Installed state): name, scope badge `badge badge-outline badge-sm` ("This workspace", or "All workspaces" with warning border), and a button `btn btn-outline btn-xs`:
- workspace item: **Make global** (`aria-label="Make {name} global"`)
- global item: no button; muted text "Available everywhere". No reverse action exists in this task (decision #14).
- Working: button disabled, label "Working...", spinner.
- Success toast (no Undo, since there is no reverse action): "{name} is now available in all workspaces."
- Error `role=alert`: "Could not change where {name} is installed."
- MCP "Make global" shows `role=note` before it applies: "Making this global also adds it to the Copilot, Codex and Antigravity files in your home folder, if you pick them." Choosing Make global opens a conversion state in place: the note, then the reused targets `fieldset` (legend "Also add to") with Copilot, Codex and Antigravity checkboxes, unchecked by default, help "Nothing is added to your home folder unless you tick it. The existing project files stay as they are.", then `btn btn-primary btn-sm` "Make global" and `btn btn-outline btn-sm` "Cancel".

Keyboard: arrow keys move the radio choice (native); Tab moves to the target fieldset, then the install button. After a convert the button is replaced by "Available everywhere"; focus moves to that row's name.

## 3. One-time migration notice

Where: top of the main chat view (above the transcript). Shown whenever the migration retired or removed anything (decision #16), including a run that only retired shared items. It persists across app restarts until the user chooses "Got it" or "Open Marketplace" (either marks it seen), and it also appears when migration finished before any chat view existed (the seen flag, not the view, governs it).
Component: `section.card.bg-base-200.border.border-info.p-3[role=region][aria-labelledby]`. Not an alert, so it never steals focus.

Copy (examples hypothetical, Ptah-managed names only):
- Title: "Installed items no longer load in every workspace"
- Body: "Skills and MCP servers installed earlier were shared with every workspace. Ptah has stopped sharing them. Files kept in a workspace may still be available in that workspace."
- Bullets (retired, deleted, kept, then left on disk), each omitted when its count is 0: "**{retired}** shared items were retired: they no longer load in every workspace." / "**{deleted}** copies Ptah created itself were deleted." / "**{kept}** files were kept in a workspace because you edited them or they are part of a git project. They may still be available in that workspace."
- How to reinstall: "To get something back: open the workspace, go to Marketplace, find the item and choose Install. It installs into that workspace. Pick All workspaces if you want it everywhere."
- "**{onDisk}** shared sources were left on disk because Ptah could not prove it created them ({n} skills.sh folders, {m} home-folder MCP entries). They are inactive in Ptah but may still be configured for other tools." Omitted when 0. This is a separate category from {kept}: these are retained global sources, not workspace files.
- `details` "Show the {kept} files kept in a workspace" listing paths in `font-mono text-xs` (only when {kept} > 0); a second `details` "Show the {onDisk} shared sources left on disk" listing each root or entry (only when {onDisk} > 0).
- Buttons: `btn btn-primary btn-sm` "Open Marketplace", `btn btn-outline btn-sm` "Got it".
- Counts are deduplicated per item (an item reconciled into 5 workspaces counts once; a source seen under several roots counts once). The notice is hidden only when all four counts ({retired}, {deleted}, {kept}, {onDisk}) are 0.

Keyboard/a11y: region labelled by title; buttons in DOM order Open Marketplace then Got it; `details` is native. On dismiss, focus moves to the chat input. Narrow width: buttons wrap below the text.

## Contrast (WCAG 2.2 AA: 4.5:1 text, 3:1 non-text) - measured in the browser from the prototype tokens

| Pair | Dark | Light |
|---|---|---|
| base-content on base-200 | 13.89 | 14.21 |
| base-content-muted on base-200 | 5.65 | 5.39 |
| base-content-muted on base-300 | 5.00 | 5.00 |
| base-content-muted on base-100 | 6.05 | 6.04 |
| primary-content on primary (button) | 4.82 | 6.81 |
| neutral-content on neutral (toast) | 11.23 | 11.89 |
| error stroke on base-200 (non-text) | 3.59 | 3.19 |
| info border on base-200 (non-text) | 4.71 | 2.32 (fails 3:1) |
| warning border on base-200 (non-text) | 6.18 | 2.20 (fails 3:1) |

Light-theme info and warning borders fail 3:1. They are decoration only: the meaning is carried by text ("Global only",
"All workspaces", the note wording), which uses base-content. Keep that rule; do not use border colour as the only signal.
The colour tint on `border-info` in the migration card is also decoration. The real build should confirm with the repo's axe run.

## What was checked

Round 1 revision: re-rendered `dark.png` and `light.png` after the changes. Contrast pairs are unchanged (same tokens; the new warning badge and skeleton reuse measured `bcm`/`b3` colours).

Prototype rendered with `ptah_browser_navigate` (file URL, headless, 1100x900) and `ptah_browser_screenshot` in both themes;
contrast computed from the rendered computed colours with `ptah_browser_evaluate`. Not checked: axe (not run here), real
DaisyUI rendering (prototype uses plain CSS equivalents), narrow viewports below 760 px (CSS stacks the two install panels).
Electron only; VS Code and TUI untouched.