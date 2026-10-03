# Prototype A — "Talk-to / Does-work split" — TASK_2026_555

## Concept (5 lines)

Providers answers "who can I talk to": a compact header, a one-card **main-agent strip**
of provider/model/effort chips with a single status line, and connections as dense
44px rows that open a management drawer. Agent Orchestration answers "who does the
work": one **Model roles** table, one **CLI agents** table, **Ptah CLI instances**,
and a compact **Policy** strip. Every edit is a popover, drawer, or modal — never an
"Edit X" button — and only overridden values carry a small scope badge.

## How to open

```
file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_555/prototypes/a-split/index.html
```

Automated captures (browser tool requires HTTP/HTTPS, not `file://`):
```bash
npx http-server D:/projects/ptah-extension/.ptah/specs/TASK_2026_555/prototypes/a-split -p 4555
# open http://localhost:4555/index.html
```

## Information architecture

| Tab | Contains |
| --- | --- |
| **Providers** (`index.html`) | Compact header ("5 connected · 15 available" + "+ Connect provider") · Main-agent strip (provider/model/effort chips, override badge, status) · Connections table (5 rows) · catalog teaser link (10 more) · Connect-provider modal wizard · per-connection drawer (Overview / Credentials / Models / Advanced) |
| **Agent Orchestration** (`orchestration.html`) | Model roles table (Main agent read-only + link to Providers, Memory curator, Archaeologist, Synthesis, Judge, Replay, Judging & enhancement) · CLI agents table (Codex, Copilot, Cursor, Antigravity, OpenCode, Pi) · Ptah CLI instances table (Glm, with a Manage drawer) · Policy strip (max concurrent, preferred order) |
| Advanced, Search & Voice | Unchanged, shown disabled in the tab bar per the brief (out of scope). |

## Save model

- **Model / effort / role / CLI-agent assignments**: save immediately on popover
  selection, confirmed with a bottom-right toast that carries an **Undo** button
  (5s window). The effort popover additionally offers a **"Save to" scope select**
  (This workspace / Desktop app / All Ptah apps) because effort commonly needs a
  narrower target than the provider.
- **Credentials** (replace/delete key, sign-in/out): the drawer's Credentials tab
  requires **Check connection** to pass before **Save** is enabled — Save stays
  `disabled` until a check has run, matching the backend rule that credentials are
  never persisted unverified. The catalog wizard applies the same rule as its own
  step 3 ("Check connection") gating the Save button on step 3 → step 4.
- **Advanced tab fields** (custom endpoint, models endpoint, help URL, pricing) save
  via an explicit **Save** button in the drawer (batched, since they're edited
  together), not inline-per-field.

## Fold check at 1024×768 (Providers)

Rendered stack, measured against the `.frame-1024` container (toggle in the
prototype toolbar):

| Region | Approx. height |
| --- | --- |
| Prototype toolbar (not part of product) | ~30px |
| Tab bar | ~44px |
| Compact header + "+ Connect provider" | ~44px |
| Main-agent strip card | ~68px |
| Connections header row | ~28px |
| 5 connection rows (44px each) | ~220px |
| **Total product content** | **~404px of 738px available (768 − 30 toolbar)** |

**Result: PASS**, with ~330px of headroom before the fold — well inside the
1024×768 budget, and every setting (provider switch, model, effort, scope
override, credentials, models/tier mapping, advanced, connect) opens in ≤ 2
clicks: one click on the chip/row/kebab, one click on the option or drawer tab.

## Deviations

- Local styling: `assets/app.css`, extended from `TASK_2026_494_ca38/prototype/assets/app.css`
  (same anubis / anubis-light token blocks) with new component rules for chips,
  popovers, the drawer, the modal wizard, dense rows, toggles and the toast stack
  — all built on the existing `--brand-*` variables, no new palette.
- CDN fallback: daisyUI 4.12 + Tailwind CDN are loaded per the brief's explicit
  allowance ("CDN daisyUI 4.12 + Tailwind CDN are allowed for the prototype").
  `assets/app.css` is loaded after the CDN sheet and overrides its baked-in theme
  colors, matching the pattern already used by `TASK_2026_494_ca38`.
- Icons are inline Lucide-style SVG (no icon font/CDN).
- Popover positioning is computed at click time (`getBoundingClientRect`) with a
  fixed max-width; it is not virtualized/collision-avoided beyond a left-edge
  clamp — acceptable for a static prototype at the specified viewport.

## Screens & states

- Providers: populated (default). Ollama Cloud row demonstrates the error state
  ("Check failed" + inline Retry). Connect-provider wizard demonstrates loading
  ("Checking…" toast) and the OAuth vs. API-key branches.
- Agent Orchestration: Cursor and Pi rows demonstrate "Not installed" (toggle
  disabled); OpenCode demonstrates "Quota reached"; Copilot demonstrates
  "Disabled" with an auto-approve toggle.
- Themes: `anubis` (dark, default) and `anubis-light`, via the toolbar toggle.
- Viewport: 1024×768 via the toolbar's frame toggle (`.frame-1024`); the page is
  otherwise responsive at wide widths (no dedicated narrow/sidebar variant was
  requested by the brief for this comparison round).

## Interactive features

- Theme toggle, 1024×768 frame toggle (prototype toolbar).
- Main-agent provider / model (searchable) / effort popovers with inline save + Undo toast.
- Override badge popover (Clear override / Use global value).
- Connection rows: click or kebab opens the management drawer (Overview,
  Credentials, Models with search + tool-use warnings, Advanced).
- "+ Connect provider" and the catalog teaser both open the same 4-step modal
  wizard (Catalog search → Configure → Check connection → Done), with a focus
  trap and Esc-to-close.
- Agent Orchestration: role/CLI table cells are click-to-open popovers; CLI
  enable and Copilot auto-approve are toggle switches; permission-note icon opens
  a popover; Ptah CLI instance rows open a drawer with tier-mapping badges;
  concurrency and preferred order (drag-to-reorder) are popovers off the policy strip.

## Project rules applied

- `[project-rule]` Reuse daisyUI 4 + Tailwind 3 tokens for themes `anubis` /
  `anubis-light`, extending `assets/app.css` from `TASK_2026_494_ca38`. Source:
  BRIEF.md #6.
- `[project-rule]` One primary (`btn-primary`) action per region: "+ Connect
  provider" on Providers; "+ Add CLI agent" on the CLI agents table. Source:
  BRIEF.md #4; `ui-ux-designer` SKILL.md "One primary action per surface".
- `[project-rule]` Status shown as a dot + text, never a button (Retry on the
  Ollama Cloud row is a distinct action next to the status, not the status
  itself). Source: BRIEF.md #4; PROTOTYPING.md "Status is a hint... not a button".
- `[project-rule]` Scope badges render only on overridden values; inherited
  values show nothing. Source: BRIEF.md #3.
- `[project-rule]` Editing happens in popovers/drawer/modal, never an "Edit X"
  button. Source: BRIEF.md #2.
- `[project-rule]` Credentials require a passing connection check before Save.
  Source: BRIEF.md #5.
- `[project-rule]` Accessible modals/drawers: `role="dialog"`, focus trap, Esc
  closes popovers/modals/drawer. Source: BRIEF.md #6.

## Lane-introduced constraints

| Constraint | Tag | Rationale |
| --- | --- | --- |
| Advanced-tab fields (custom endpoint, models endpoint, help URL, pricing) save as one batch via an explicit Save button rather than per-field inline save | `[lane-proposed]` | These four fields are edited together when configuring a custom gateway; per-field inline save would fire four separate toasts for one logical change. **Requires user approval at Gate 1.7.** |
| CLI-agent "Not installed" rows stay visible (dimmed toggle) instead of being hidden, with install help reachable by clicking the row | `[lane-proposed]` | Directly answers parity item #71 ("hiding them for CLIs not installed" was flagged as a regression); this variant keeps them visible for consistency across all system CLIs. **Requires user approval at Gate 1.7.** |
| Model-tier search inside the drawer's Models tab is a visual-only filter (dims the list) rather than removing non-matching rows | `[lane-proposed]` | Keeps the tier rows' pickers addressable in this static mock without a full virtualized list; a real implementation should filter the popover's option list, not the row. **Requires user approval at Gate 1.7.** |

## Parity mapping (17 restored capabilities, per `parity-inventory.md`)

| # | Capability | Prototype location | Visual treatment |
| --- | --- | --- | --- |
| 7 | Delete stored Anthropic API key | `index.html` → Connections row → drawer → Credentials tab | "Delete key" (`btn-outline btn-error`) below Replace key |
| 8 | Delete a stored third-party provider key | Same Credentials tab, generic to any `apikey` connection (Moonshot, Ollama Cloud, sovereigneg) | Same "Delete key" control |
| 12 | GitHub Copilot sign out / disconnect | Connect-provider wizard connects Copilot via OAuth; once connected, drawer → Credentials tab (`oauth` branch) | "Sign out" (`btn-outline btn-error`) |
| 21 | Reload-window button | **Not restored** — dropped per user-approved removal (BRIEF.md #2 references parity-inventory.md; "Missing capabilities" #4) | n/a |
| 25 | Delete a custom provider | `index.html` → sovereigneg row → drawer → Advanced tab | "Delete provider" (`btn-outline btn-error`) |
| 27 | Custom provider models endpoint | Drawer → Advanced tab | "Models endpoint" text field |
| 28 | Custom provider help URL | Drawer → Advanced tab | "Help URL" text field |
| 30 | Custom provider pricing (input/output per 1M) | Drawer → Advanced tab | Two-column price fields |
| 34 | Searchable model autocomplete | Main-agent Model chip popover (search input) and drawer → Models tab (search input) | Text input filtering a popover option list |
| 38 | Tool-use compatibility indicators | Drawer → Models tab | ⚠ icon + tooltip on tier picker rows/options that lack tool-use support, plus "N models • M support tool use" summary line |
| 43 | Ptah CLI agent status (Ready/Error/Init/No Key) | `orchestration.html` → CLI agents table → Status column | Status dot + text (Ready, Disabled, Not installed, Quota reached) |
| 44 | Ptah CLI agent key status | `orchestration.html` → Ptah CLI instances table → Key status column, and instance drawer | Text column + drawer row |
| 47 | Inline GitHub login when adding a Copilot-backed CLI agent | "+ Add CLI agent" modal | "Sign in with GitHub" button inside the add form |
| 49 | Show/hide API key in CLI agent add/edit forms | Same "+ Add CLI agent" modal, and drawer Credentials tab | Eye-toggle button next to the password input |
| 53 | CLI-agent tier mapping (opus/sonnet/haiku) | `orchestration.html` → Ptah CLI instance drawer → Tier mapping section | Per-tier rows with the resolved model |
| 54 | Tier-mapping badges on CLI agent cards | `orchestration.html` → Ptah CLI instances table → Tier mapping column | Three compact `tier-badge` pills (opus/sonnet/haiku) |
| 70 | Per-CLI permission/safety notes | `orchestration.html` → CLI agents table → permission-note icon column | ⓘ icon opens a popover with the exact safety copy (full auto / `--auto` / no approval gate) |
| 71 | Per-CLI grouping, not hidden when uninstalled | `orchestration.html` → CLI agents table | Cursor/Pi rows stay visible with "Not installed" status and a disabled toggle (see Lane-introduced constraints) |

## Screenshots

Captured via `ptah_browser_navigate`/`ptah_browser_screenshot` against a local
`http-server` on port 4555, viewport 1024×768:

- `screenshots/providers-dark-1024x768.png` — Providers, `anubis`, frame on. Fold check: PASS (~404px of 738px used).
- `screenshots/providers-light-1024x768.png` — Providers, `anubis-light`, frame on.
- `screenshots/orchestration-dark-1024x768.png` — Agent Orchestration, `anubis`, frame on (page runs past the fold; no fold budget applies to this tab per the brief).
- `screenshots/orchestration-light-1024x768.png` — Agent Orchestration, `anubis-light`, frame on.
- `screenshots/providers-drawer-dark.png` — Connection drawer, Overview tab (Ollama Cloud, error state, Disconnect visible).
- `screenshots/providers-drawer-credentials-dark.png` — Connection drawer, Credentials tab (Save disabled until Check connection passes).
