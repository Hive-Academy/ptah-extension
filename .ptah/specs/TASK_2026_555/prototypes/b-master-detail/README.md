# Variant B — Master–detail control center

TASK_2026_555 · Settings → Providers and Agent Orchestration redesign.
Design system: project daisyUI 4 (`anubis` / `anubis-light`) with the TASK_2026_494
`app.css` token overrides copied into `assets/app.css` and extended [project-rule, BRIEF §6].
Sources: `../../parity-inventory.md` (Missing capabilities, Regressed UX),
`../../investigation/synthesis.md`, `../BRIEF.md`.

Open `index.html` (Providers) or `orchestration.html` (Agent Orchestration). The toolbar
above the frame is prototype-only (BRIEF §7): theme toggle, 1024×768 frame toggle, links.

## Concept (5 lines)

Each tab is a two-pane master–detail layout: a 240 px left list and a right detail pane,
like macOS System Settings or Raycast. No page-long scroll — each pane scrolls alone.
The left list shows everything at a glance: the main agent, every connection with a status
dot, every CLI agent, model roles, and the policy entry. One click opens a detail pane;
short choices (model, effort, tier, provider, scope) edit inline in popovers, so no
"Edit X" button exists anywhere. Credentials, models, tier mapping, and danger actions
live in the detail pane sections. The "Connect provider" wizard is the only modal.

## IA — what lives where

**index.html — Providers tab**
- Left list: `Main agent` pinned row (two lines: name / provider · model · effort),
  group `Connections` (5 rows, status dot + status text, e.g. `Check failed`), primary
  `Connect provider` button (opens the 4-step wizard modal).
- Right pane `Main agent`: Provider / Model / Effort popovers (model popover has search),
  scope badges with popovers (`Workspace override` on effort, `App · Desktop` on provider).
- Connection panes: `Status` (+ `Use for main agent`), `Credentials` (replace key, delete
  key, sign out, show/hide key, `Check connection` gate), `Models & tier mapping`
  (search, tool badges, tier chips, pricing), `Used by`, custom endpoint fields
  (sovereigneg: Base URL, Models endpoint, Help URL, pricing), help link, `Danger zone`
  (disconnect, delete custom provider).
- `pane-dynamic`: generic pane the wizard fills for a newly connected provider.
- Modal wizard: catalog (15 providers, search) → auth method → credentials (key input
  with show/hide, OAuth sign-in, CLI login) → verify (`Check connection` → Save, save-to
  scope radios). A configured provider tile jumps straight to its pane.

**orchestration.html — Agent Orchestration tab**
- Left list: group `Model roles` (6 rows: role → provider · model or `Follows main agent
  · tier`), group `CLI agents` (Codex, Copilot, Cursor, Antigravity, OpenCode, Pi, Glm —
  status dots, on/off toggles on the rows), `Policy` row.
- Role panes: provider/model/tier popovers; `Judging & enhancement` adds the time-limit
  popover (60–240 s) and an Inherit-or-explicit source popover.
- CLI panes: installed state, delegated settings (model, effort, auto-approve popovers),
  tier mapping with chips, per-CLI permission notes, `Test connection` with latency,
  OpenCode quota-reached status, Copilot inline GitHub sign-in, Glm Ptah-CLI agent
  status + key status + tier mapping, install help for Cursor/Pi.
- Policy pane: max-concurrent range slider, drag-reorder preferred agent order
  (Codex → Antigravity → Glm → Copilot-off), `Re-detect CLIs`.

## Save model

- **Popover choices save on selection** (BRIEF §5, option A): provider, model, effort,
  tier, auto-approve, time limit, model source. Each shows a toast with **Undo** that
  restores the previous value. No Apply button.
- **Credentials save only after `Check connection` passes** (backend rule): replace-key,
  endpoint fields, and wizard step 4 keep their Save button disabled until the simulated
  check completes (~0.9 s).
- **Scope choices** happen inside the popover that made the change: the scope badge popover
  offers `Clear override`, `Use global value`, and `Save to: This workspace / Desktop app /
  All Ptah apps`.
- Connection status changes (`Retry`, sign in, connect, disconnect) show a toast; `Retry`
  flips the status dot and text in place.

## Restored capabilities (17 of 18; #21 Reload dropped with user approval)

| # | Capability | Where it is reached |
|---|------------|---------------------|
| 7 | Delete key | Connection pane → Credentials → `Delete key` (Moonshot, sovereigneg) |
| 8 | Replace key | Connection pane → Credentials → `Replace key` form, gated by `Check connection` |
| 12 | Copilot sign out | Copilot pane (Orchestration) → GitHub authentication → `Sign out`; also CLI subscription sign-out on the Claude pane |
| 25 | Delete custom provider | sovereigneg pane → Danger zone → `Delete custom provider` |
| 27 | Models endpoint | sovereigneg pane → Custom endpoint → `Models endpoint` field |
| 28 | Help URL | sovereigneg pane → `Help URL` field; wizard sets the per-provider help link (`claude /login`, docs) |
| 30 | Pricing | Connection panes → Models section → input/output price per 1M tokens |
| 34 | Searchable model autocomplete | Every model popover has a search field (main agent, roles, CLI delegated settings, Glm) |
| 38 | Tool-use indicators | Model rows carry `tools ✓ / tools ⚠` badges; `⚠` warns before you select a model for tool use |
| 43 | Ptah CLI status | Glm pane → Status: `Ready`, `Test agent` with latency |
| 44 | Key status | Glm pane: `Key status: Cloud signin`; API-key panes: `stored on this machine`; OAuth panes: session state |
| 47 | Inline GitHub login | Copilot pane → `Sign in with GitHub` (simulated device flow, updates row + toggle) |
| 49 | Show/hide key | Eye toggle on the stored key (masked/full text) and on the key input in the wizard and Replace-key form |
| 53 | CLI-agent tier mapping | Codex and Glm panes → Tier mapping (Opus / Sonnet / Haiku rows) |
| 54 | Tier badges | `.tier-chip` chips next to section titles and tier rows |
| 70 | Per-CLI permission notes | Each CLI pane → Permissions & safety (`--auto`, full-auto unsupported, Pi no approval gate and no MCP) |
| 71 | Per-CLI grouping/hiding of settings | Delegated settings hidden on Cursor/Pi (not installed) and locked with an explanation on Copilot until signed in |

## Fold check at 1024×768

Use the toolbar button `1024×768 frame: on`. The frame constrains the page to that size.

- **Providers:** the left list (~240 px wide) holds the Main agent row, all 5 connection
  rows, and the `Connect provider` button with no scroll (~380 px tall). The right pane
  shows the main agent provider, model, effort, and status. Tab bar visible. Fold budget met.
- **Orchestration:** the left list needs ~700 px for 14 rows; the frame lets the list scroll
  alone (groups stay reachable; the pane never scrolls the page). Every setting is ≤ 2 clicks:
  1 click selects a row, 1 click opens its popover or inline form.
- No full-width scope strips exist; badges sit on the single overridden value (BRIEF §3).

## Accessibility notes

Labels on all inputs and toggles; `role="dialog"` + focus trap + Esc on the modal; Esc and
outside click close popovers; status shown by colour **and** text; visible focus states from
the daisyUI themes; `aria-checked` marks the current popover choice; `aria-selected` marks
the active master-list row; the toast host is `aria-live="polite"`.

## Lane-introduced constraints

- [lane-proposed] Popover choices save on selection with a toast + Undo (BRIEF §5 allowed
  save-on-select or Apply; this variant commits to save-on-select).
- [lane-proposed] Row-level on/off toggles for CLI agents live on the master-list rows
  (Orchestration tab). A toggle click never switches the selected pane.
- [lane-proposed] The connection wizard uses 4 short steps (catalog → auth method →
  credentials → verify) instead of one long form; step 4 cannot complete without a passing
  check.
- [lane-proposed] `Test connection` on CLI panes reports a simulated latency value
  (e.g. `340 ms — Ready`) to make the status concrete in the prototype.
- [lane-proposed] For not-installed CLIs (Cursor, Pi), delegated settings are hidden and
  replaced by install help; the brief did not say what to show for them.

All other rules trace to the brief or the project: [project-rule] entries (daisyUI themes,
token overrides, one primary action per region, colour + text status) come from
`../BRIEF.md` §4–§6 and the copied 494 `app.css`; the 17-capability list comes from
`../../parity-inventory.md` "Missing capabilities"; the fold budget and scope-badge rules
come from `../BRIEF.md` §1 and §3.