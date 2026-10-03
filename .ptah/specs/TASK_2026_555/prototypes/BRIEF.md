# TASK_2026_555 — Prototype brief (shared by all variants)

Goal: redesign Settings → **Providers** and **Agent Orchestration** (the first two tabs; the other tabs
"Advanced" and "Search & Voice" stay as they are and only appear in the tab bar). The user wants several
competing prototypes to compare, and asked explicitly to **use modals, popovers and advanced UI layouts**
instead of the current flat stack of cards with "Edit X" buttons.

Read first (absolute paths):
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_555\investigation\synthesis.md` — why the current page fails.
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_555\parity-inventory.md` — sections "Missing capabilities"
  and "Regressed UX". The user approved: **restore all 17 missing capabilities, drop only the Reload button.**
- Current page: screenshots in `D:\projects\ptah-extension\.ptah\specs\TASK_2026_555\screenshots\` (skip if
  your model cannot read images; the synthesis describes them).

## Hard requirements (user-requested or project-rule)

1. **Fold budget (user-requested):** at a 1024×768 viewport, on Providers the user sees without scrolling:
   the tab bar, what the next main-agent request uses (provider, model, effort, status), and all 5 connected
   providers. Every setting must be reachable in ≤ 2 clicks from its tab.
2. **Progressive disclosure (user-requested):** editing happens in popovers (short choices: model, effort,
   provider for a role, scope), a side drawer or modal (connection details: credentials, sign-in/out, key
   replace/delete, models/tier mapping with search, "Used by", disconnect), and a modal wizard (connect a
   new provider from the catalog of 15). No "Edit X" button per setting.
3. **Scope provenance (Global / App / Workspace):** never full-width strips. Show nothing for inherited
   values; show a small badge ("Workspace override", "App override") only on overridden values; details,
   "Clear override" and "Use global value" live in the badge's popover. Where a save needs a target scope,
   choose it inside the popover/modal ("Save to: This workspace / Desktop app / All Ptah apps").
4. **Visual hierarchy:** one primary (blue `btn-primary`) action per region; status by colour **and** text
   (Active / Connected / Check failed / Not signed in). Rows may be clickable.
5. **Credentials** still need a connection check before they are saved (current backend rule). Model /
   effort / role changes may save on selection with a toast + Undo — or use an explicit Apply in the
   popover; state which one your variant uses.
6. **Project design system (project-rule):** daisyUI 4 + Tailwind 3, themes `anubis` (dark, default) and
   `anubis-light`. Reuse the token overrides in
   `D:\projects\ptah-extension\.ptah\specs\TASK_2026_494_ca38\prototype\assets\app.css` (copy it into your
   variant's `assets/` and extend). CDN daisyUI 4.12 + Tailwind CDN are allowed for the prototype.
   Font Inter/system, text-sm body. Lucide-style inline SVG icons. No new palette. Accessible: labels,
   visible focus, `role="dialog"` + focus trap for modals, Esc closes popovers.
7. **Prototype toolbar** (not part of the product): theme toggle (anubis / anubis-light), a "1024×768 frame"
   toggle that constrains the page to that viewport, and links to the other states of your variant.
8. Static HTML + vanilla JS only. Everything clickable must open its real popover/drawer/modal with
   realistic content. No backend.

## Realistic data (use exactly this so variants can be compared)

- Workspace `ptah-extension` (`d:\projects\ptah-extension`), app: Desktop. 15 providers in catalog, 5 configured.
- Main agent: **Claude (Subscription)**, auth: CLI subscription, model "Default (chosen by Claude)",
  reasoning effort **medium** — effort is a *Workspace override* (global = provider default); provider
  is from *App · Desktop*.
- Connections:
  | Provider | Auth | Status | Credential |
  | --- | --- | --- | --- |
  | Claude (Subscription) | CLI subscription | Active for main agent | Claude CLI login |
  | Moonshot (Kimi) | API key | Connected | stored on this machine |
  | OpenAI Codex | OAuth | Connected | OAuth session |
  | Ollama Cloud | API key | Check failed (Retry) | stored on this machine |
  | sovereigneg | API key (custom endpoint) | Connected | stored on this machine |
  Not configured (catalog): Anthropic API, OpenAI API, OpenRouter, GitHub Copilot, Google Gemini, Z.ai (GLM),
  DeepSeek, Groq, Mistral, xAI.
- Background model roles: Memory curator → OpenAI Codex · gpt-5.6-luna; Archaeologist lane → follows main
  agent (haiku tier); Synthesis lane → follows main agent (sonnet tier); Judge lane → Moonshot · kimi-k2.5;
  Replay lane → follows main agent (haiku tier); Judging & enhancement → inherit, time limit 120 s.
- CLI agents (system CLIs): Codex (installed, on, model gpt-5.5-codex, effort medium), Copilot
  (installed, disabled, model provider default, effort provider default, auto-approve off), Cursor
  (not installed), Antigravity (installed, on, claude-sonnet-4-6 Thinking), OpenCode (installed, on,
  opencode/nemotron-3-ultra-free, **quota reached**), Pi (not installed). Ptah CLI instances: "Glm"
  (provider Ollama Cloud, glm-5.3:cloud, tier mapping opus/sonnet/haiku).
- Orchestration policy: max concurrent agents 3, preferred order Codex → Antigravity → Glm → Copilot.

## Deliverables per variant (in your own folder only)

- `prototypes/<variant>/index.html` (Providers tab) and `prototypes/<variant>/orchestration.html`
  (Agent Orchestration tab); more pages optional (e.g. `states.html` for empty/error/loading).
- `prototypes/<variant>/assets/app.css` (+ optional `app.js`).
- `prototypes/<variant>/README.md`: the concept in 5 lines, the IA (what lives on which tab), the save
  model, how each of the 17 restored capabilities is reached (table: capability → where), a fold check at
  1024×768, and `## Lane-introduced constraints` (rules you added that are not in this brief).
