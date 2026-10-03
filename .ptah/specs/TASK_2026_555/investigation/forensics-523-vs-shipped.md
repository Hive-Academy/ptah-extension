# Forensics: TASK_2026_523 design spec vs the shipped Providers page

Read-only investigation, 2026-09-29. Sources: `.ptah/specs/TASK_2026_523_c3df/*`, `.ptah/specs/TASK_2026_533/task.md`,
`.ptah/specs/TASK_2026_534/task.md`, `.ptah/specs/TASK_2026_555/screenshots/*.png`, and `main` @ `722d921ab`.
"Spec" means `.ptah/specs/TASK_2026_523_c3df/design-spec.md`. Code paths are relative to
`libs/frontend/chat/src/lib/settings/`.

**Short answer.** Nobody ever looked at the rendered page before it merged. No prototype existed and the user
never approved the design. The acceptance gates for every batch were unit tests, typecheck, lint, and VSIX
packaging. The design spec also contradicts itself: it sets a tight above-the-fold budget and then requires a
provenance strip with up to three text buttons under every editable value. Implementers kept the rules that
tests could check (strips, buttons, copy, states) and dropped the rules nothing checked (budget, hierarchy,
compactness, primary color). TASK_2026_534 was told not to restyle, and TASK_2026_555 was never started. So
the #575 layout is still on `main`, with a few more buttons added by #581.

---

## 1. Spec promises not met

Measurements come from `current-01-top.png` (viewport about 1014 px wide, taller than 768). Pixel values are
read off the screenshot and are approximate.

### 1.1 Above-the-fold budget (spec :22)

| Spec budget | Shipped | Evidence |
| --- | --- | --- |
| Header 64 px | About 145 px. The Settings strip, a "Runs 100% locally" banner, then a 4-line header block with **two** buttons | `settings.component.html:98-110` (banner kept above the page); `providers/providers-settings.component.ts:41-58` |
| Route summary 152 px | About 445 px (y≈328→773) | `providers-settings.component.ts:73-139`: summary + 3 buttons + always-open effort `<select>` + 1 "Mixed sources" strip + up to 4 more scope strips |
| 88 px per connection row, both rows above the fold | Rows are 82 px (no source strip) to 118 px (with "Credential: stored on this machine" strip). At 768 px height, **no** connection row is above the fold, because the main-agent card alone reaches y≈773 | `providers/provider-connection-card.component.ts:98-449`, `:435-447` |

The spec requires the budget, but no batch report measured it. The coordinator says so:
"no browser-based 320px/400%-zoom, theme contrast or above-the-fold audit was performed on this unmounted page"
(`batch-d1-coordinator-report.md:64`).

### 1.2 Page header (spec :13, :20, :62)

- Spec :20 asks for "2 configured · 11 available". Code shows `{total} providers · {n} configured` with the total
  first and counts every catalog entry (`providers-settings.component.ts:45`).
- Spec :62 asks for a primary **Connect provider** with a `Plus` icon. Code uses a neutral outline button with no
  icon, and adds a **Refresh settings** button that the spec never mentions (`providers-settings.component.ts:55-56`).
- Spec :62 asks for `NativeTabGroupComponent` for the settings tabs. The tabs are still hand-written daisyUI buttons
  (`settings.component.html:35-68`).

### 1.3 Main agent (spec :70-80)

- The **Active for main agent** badge is missing from the main card (spec :70). The only copy is on the connection
  card (`provider-connection-card.component.ts:~169`).
- Spec :74 says **Change main provider** "opens an inline selection of existing connection identities … then a
  review row". In code it only moves focus to the "Your connections" heading
  (`providers-settings.component.ts:91`, `:166`).
- The spec never mentions reasoning effort. Code adds an always-visible effort `<select>` plus a status line, a
  label, and a Save/Cancel pair (`providers-settings.component.ts:95-113`).
- Spec :150 asks for **Save to** as a radio group with full clickable labels. Code uses `<select>` in all three
  places (`providers-settings.component.ts:104-107`, `:145-148`, `:182-185`).

### 1.4 Your connections (spec :84-92)

- "Compact" rows: the code uses a `flex-col` card with a separate strip row, and every action is `btn-sm min-h-9`
  (36 px) (`provider-connection-card.component.ts:98-152`, `:184-410`).
- Spec :88 says **Manage** opens a `NativeDrawer` with Connection / Models / Used by sections, last probe time,
  **Disconnect**, and a disconnect impact review. Code opens the setup wizard instead
  (`providers-settings.component.ts:167`). No "Used by" section and no Disconnect action exist anywhere
  (grep over `providers/*.ts`).
- The **active** row's only primary button is "Change main provider", which moves focus to the same list the row
  is in (`provider-connection-card.component.ts:189-197` → `providers-settings.component.ts:166`). The only
  `btn-primary` on the page does nothing useful.
- #581 added a third button, "Use for main agent", to the `not-checked` / `check-unavailable` states
  (`provider-connection-card.component.ts:354-363`, `:387-396`). The screenshot shows the Ollama Cloud row with
  Retry, Use for main agent, and Manage.

### 1.5 Scope provenance (spec :136-158)

- Spec :138 wants a strip "directly underneath" each value. Code stacks all main-agent strips in one block at the
  bottom of the card, away from their values (`providers-settings.component.ts:114-137`).
- The strips have **no visible field name**. `fieldName` appears only in aria-labels
  (`providers/setting-scope-row.component.ts:298-301`, template `:64-146`). The screenshot shows four unlabeled
  strips ("From Workspace · ptah-extension (Desktop) — Clear override — Use global value — Will use openai-codex
  from the Desktop app.") with no way to tell which setting each one is about.
- Background rows get two strips each, both "From Global · All Ptah apps", and neither is labeled provider or
  model (`providers/provider-consumer-assignments.component.ts:261-278`; `current-02-connections.png`).
- The code does meet the letter of the spec: provenance is visible, Clear override and Use global value are text
  buttons, and "Mixed sources" appears. The spec itself (§4 below) is what made this section heavy.

### 1.6 Background models (spec :96-104)

- The six rows are present, in order, with Edit, the helper copy, and the timeout
  (`provider-consumer-assignments.component.ts:155-460`). Each "row" is a full NativeCard of about 145-160 px
  (two strips plus the Edit button). The six rows take roughly 900 px against the spec's idea of rows.
- One inline editor at a time is implemented as the spec asks.

### 1.7 CLI agents (spec :108-110)

- Spec :108 describes a single **row** per agent: name, identity, toggle, model summary, Edit, Check connection,
  Remove agent. Code renders a vertical stack per agent with an "{n} available models" line, a model line,
  "Edit {name} model", a toggle, "Edit name or key", "Test connection", and "Remove {name}". That is 4 buttons
  plus a toggle, not one row (`ptah-ai/ptah-cli-config.component.ts:62-104`).
- The spec does not mention a standalone **Cursor API key** input and Save button, but the code has one
  (`ptah-cli-config.component.ts:105-109`).
- Spec :31 moves the `agentOrchestration.*Model` controls into Providers. Code renders **nine** bordered boxes
  (6 CLI models + 3 reasoning efforts), each with a value line, an unlabeled scope strip, and its own
  "Edit {X}" button (`ptah-cli-config.component.ts:110-144`, list at `:159`). This is the long tail in
  `current-03-bottom.png`. #581 (commit `0848fe8ca`) replaced the free-text inputs with selects and added the
  effort handling, so the box pattern predates #581 and #581 extended it.

### 1.8 More providers (spec :20, :112-114)

- The catalog is collapsed by default, which meets the spec (`providers-settings.component.ts:213`, `:279`).
- Spec :20 wants "More providers (9)". The summary shows no count (`providers-settings.component.ts:214`).
- Spec :114 asks for a final **Custom endpoint** action with a `Server` icon. Code has a text button,
  "Custom endpoint · choose Custom in setup" (`providers-settings.component.ts:233`).
- OAuth/CLI entries get an extra "Sign in to X" button next to "Set up X" (`:224-226`). The spec defines one
  action per entry.

### 1.9 Global action hierarchy (spec :51-53)

- Spec :51 wants "exactly one primary action per local edit region". Code defines one neutral `CONTROL` class and
  uses it for almost every button (`providers-settings.component.ts:27`, `ptah-cli-config.component.ts:29`). The
  coordinator reported this as a "small visual deviation from the design's blue primary action"
  (`batch-d1-coordinator-report.md:64`). The page therefore has no visual hierarchy: every button in the
  screenshots is the same white-outlined box.

### 1.10 Size of the result

This is an estimate from the templates and screenshots, in the 5-connection state. About 40 visible buttons
before any editor opens: header 2, main card about 9, connections about 11, background 6, CLI section about 11
plus 4 per CLI agent. The page is about 4-5 viewport heights tall. The previous Providers tab was one bordered
`text-xs` section with `ptah-auth-config` and `btn-xs` controls
(`git show 7ecdefa45^1:libs/frontend/chat/src/lib/settings/settings.component.html`). Spec :51/:251 raised every
control to `min-h-9`, which is 36 px against the old 24 px.

---

## 2. Why it happened

### 2.1 No prototype, no user approval of the design

- The 523 task folder has no `prototype/` directory, and none of its files mention a prototype (grep over
  `.ptah/specs/TASK_2026_523_c3df`).
- The only user decisions recorded are D1 (vendor marks), D2 (delivery mechanism), and D3 (land in one PR)
  (`context.md:122-207`). There is no decision on layout or visual design.
- The orchestrator checked facts in the spec, not the design: "`design-spec.md` | codex, `ui-ux-designer` |
  `saveAndTest` ordering confirmed; component inventory checked against `libs/frontend/ui` barrel"
  (`batches.md:131`).
- TASK_2026_533 confirms it: "A Codex lane wrote `design-spec.md`, it went straight to implementation, the user
  never saw it" (`TASK_2026_533/task.md:15-16`).
- The spec is text only. It states: "No source files, assets, or production tests were modified for this
  design-only deliverable" (`design-spec.md:295`). It contains no mockup or rendered sketch.

### 2.2 The plan and batches had no visual acceptance

- The plan's quality requirements are functional, performance, security, maintainability, and 12 behaviour pins.
  None is visual (`implementation-plan.md:911-950`).
- The batches are A, A2, B, C, D-i, D-ii+iii, E (tests), F (Nx boundary / style review), and G (VSIX token scan).
  None has a visual-reviewer or screenshot step (`batches.md:30-40`).

### 2.3 Batches built the page in pieces, against stubs, unmounted

- D-i built six components in parallel lanes, "against stubs. Not mounted" (`batches.md:36`). Each lane reported
  "Deviations: None" on unit-test evidence:
  - `batch-d1-connection-card-report.md:175`: "None. The implementation adheres strictly to `design-spec.md`"
  - `batch-d1-consumer-assignments-report.md:157`: same claim
- The only file named "spec-fidelity" is about test **fixture types**, not design fidelity
  (`batch-d1-spec-fidelity-report.md:1-10`).
- The integration lane that mounted the page also skipped the browser: "No live browser/cross-runtime or
  real-credential network verification" (`batch-d2-d3-report.md:338`).
- The coordinator named the missing check and moved on: "no … above-the-fold audit was performed on this
  unmounted page" (`batch-d1-coordinator-report.md:64`).

### 2.4 Reviews covered code only, and one was partly self-review

- `code-style-review.md` scored the work 7/10, "APPROVE WITH CHANGES". Its concerns were file size and
  constructor parameters (`:5-8`).
- The reviewer disclosed that it wrote `provider-connection-card` and `provider-consumer-assignments` itself
  (`code-style-review.md:16-20`).
- Its only visual remark is that inline templates "make visual reviews difficult during git diff inspections"
  (`:171`). No visual review ever ran.

### 2.5 The spec's own rules produced the button-heavy layout

These rules are in the spec, and the code follows them:

| Spec rule | Effect on the page |
| --- | --- |
| `:50` "Use non-clickable shells with explicit buttons" | Rows can't be clicked, so every action needs a button, including Manage on every card |
| `:138` "Every editable value has a persistent source strip … visible when collapsed as well as editing" and `:146` (provider, auth, model, each tier, each background provider/model, timeout, CLI assignment) | Two strips per background row, 4-5 in the main card, one per delegated CLI box |
| `:148` "**Override for this workspace** … **Clear override** … These are real text buttons, never an overflow menu or tooltip" | Up to 2-3 text buttons per strip (`setting-scope-row.component.ts:78-131`) |
| `:154` add **Use global value** and **Copy global value to this workspace** | More per-strip buttons |
| `:118`, `:265-268`, `:272` all badges `badge-outline … bg-base-100 text-base-content`; no green/orange status text; do not assume `btn-primary` passes | A monochrome page: "Active" and "Connected" badges look identical in the screenshots |
| `:51-53`, `:251` `min-h-9` on every control; neutral buttons in failing themes | Taller controls. The coordinator extended "neutral" to every theme and every region (`batch-d1-coordinator-report.md:64`) |
| `:31` move all `agentOrchestration.*Model` controls into Providers | Nine separate boxes in the CLI section |
| `:122` state table: the active row's action is "Change main provider" | A primary button whose only effect is a focus jump |

The spec also contradicts itself. The 152 px route-summary budget (`:22`) cannot hold a model line, three actions,
and a separate provenance strip with text buttons for route, provider, auth, model, and tier (`:72-74`,
`:138-148`). Implementers could satisfy the per-field strip rules with unit tests, but nothing tested the budget,
so the budget is the rule that was dropped.

TASK_2026_533 reached the same diagnosis: "The spec invented rules the user never asked for ('override actions are
text buttons, never a tooltip', 'no btn-primary / badge-success')" (`TASK_2026_533/task.md:20-22`). The user's
request was "Global versus per-workspace scope must be far more visible" (`context.md:97`). The spec turned
"visible" into "actionable controls under every field".

### 2.6 Drift beyond the spec

The implementation also added things the spec did not ask for and left out things it did:

- Added: an always-open effort select, Refresh settings, a Cursor key field, extra Sign-in buttons, and "Use for
  main agent" on unchecked rows (from #581).
- Dropped: blue primary actions, Save-to radios, catalog count, the Manage drawer, Disconnect, and field labels
  on strips.

Each lane recorded its own deviations, but no one compared the assembled page with the spec.

---

## 3. What happened after #575

### 3.1 TASK_2026_533 (process only, PRs #582/#583)

TASK_2026_533 changed skills and agent templates only. It did not touch the Providers page.

- `agent-lanes`: a preserve list; decision artifacts treated as proposals with `## Lane-introduced constraints`;
  "UI code — typecheck/test/lint are not proof. Require visual-reviewer screenshots in dark + light themes,
  compared with the approved prototype" (`.claude/skills/agent-lanes/SKILL.md:152-154`); write-path trace.
- `orchestration`: FEATURE/CREATIVE flow runs `designer → prototype → Gate 1.7` with the user replying
  APPROVED; `parity-inventory.md` is required when a surface is replaced; team-leader completion requires
  parity and visual evidence.
- `ui-ux-designer`: a new `PROTOTYPING.md`, which exists at `.claude/skills/ui-ux-designer/PROTOTYPING.md`. It
  adds rules including "never ban a project component wholesale", "status and secondary info are hints, badges
  or tooltips, not buttons", and "each surface has one primary action".
- Agent templates (designer, PM, team-leader, visual-reviewer) were updated to match.

### 3.2 TASK_2026_534 (PR #581) and later commits

TASK_2026_534 was correctness only by mandate: "Scope is correctness only. The visual redesign is a separate task
— do not restyle, do not restructure the page" (`TASK_2026_534/task.md:8-9`).

Commits touching `settings/providers` or `settings.component.*` since `7ecdefa45`:

| Commit | Date | What | Layout impact |
| --- | --- | --- | --- |
| `0848fe8ca` fix(chat,core): make the providers and orchestration settings work again | 2026-09-23 | #581 runtime fixes | **Minor, additive.** Adds a "Use for main agent" button to not-checked / check-unavailable cards, the unchecked-activation note, delegated model/effort selects with retry and invalid-effort alerts, and the "Default model (chosen by Claude)" copy. No restructuring. |
| `c03bbba2f` fix(chat): consume deep links once and keep uncertain toggles honest | 2026-09-23 | #581 deep links and toggles | None. Bindings only; 3 lines in `settings.component.html` |
| `d61fc1d2b` feat(chat): batch 37b2 - go vet consent card | 2026-09-27 | Search & Voice tab | None on Providers |

None of these commits changed the layout. The structure on `main` is the one from #575. #581 made it slightly
more button-heavy.

TASK_2026_555, the task meant to own the visual rework, has been `status: backlog` since 2026-09-24
(`TASK_2026_555/task.md:4`) and was never started. Its folder has only `task.md` and today's screenshots.

---

## 4. Root causes

- **No design gate.** A lane-authored, text-only design spec went straight to architecture and implementation. The
  user never saw it, and there was no prototype to see.
- **The spec over-specified the wrong things.** Its accessibility and provenance rules require non-clickable cards,
  explicit text buttons for every override action, a strip under every value, monochrome badges, and 36 px
  controls. Together these produce the button wall, and they contradict the spec's own 152 px / 88 px budget.
- **Only testable requirements survived.** Every batch was accepted on unit tests, typecheck, lint, and packaging.
  Budgets, hierarchy, and compactness had no test, so they were dropped silently. There was no visual-reviewer
  batch.
- **The page was built piecemeal.** Six components came from parallel lanes against stubs, each claiming
  "Deviations: None". The integration lane did not render the page in a browser, and nobody owned the look of the
  whole page.
- **Scope was widened without design.** The whole Agent Orchestration model surface (9 settings), reasoning
  effort, and a Cursor key were moved in and rendered as repeated boxes instead of being designed.
- **Reviews checked code only.** The style review was partly self-review, and no review looked at the UI.
- **The follow-up was never run.** #581 was correctly limited to correctness, but TASK_2026_555 has stayed in the
  backlog, so the #575 layout plus #581's extra buttons is what users see today.

## 5. Lessons for TASK_2026_555

1. **Start from the user's words, not the 523 spec.** Treat the 523 spec as a source of lane-introduced
   constraints to challenge. The candidates to drop or rework are rules :50, :118, :138/:146, :148, :154, :122 and
   the global `min-h-9`. Record each one as `lane-proposed` and get an explicit decision from the user.
2. **Get the prototype approved first.** Build a static `prototype/` with real daisyUI themes, dark and light,
   about 1024×768 and about 400 px wide, populated with the real state (5 connections, 6 background rows, CLI
   agents, 9 delegated settings). The user approves it at Gate 1.7 before any architecture work.
3. **Make the budget a test, not a sentence.** Visual-reviewer screenshots at 1024×768 must show the header, the
   main-agent summary, and at least two connection rows above the fold. Record this as a pass/fail line in
   `visual-review.md`.
4. **Use progressive disclosure for provenance.** Show one compact source hint per group, and keep
   override/clear/use-global actions inside the editor or details drawer, not on the resting page. Give every
   strip a visible field name.
5. **Make rows clickable, with one primary action per surface.** Open Manage details by clicking the row. Don't
   add buttons that only move focus. Use color, with text, to tell Active from Connected.
6. **Collapse long lists.** Put background models in a compact table or list with a single inline editor. Group
   the delegated CLI models and efforts into one sub-panel, or return them to Agent Orchestration with a link, as
   spec :31 already allowed for policy.
7. **Keep parity and visuals as separate checks.** First write `parity-inventory.md` for the 16 capabilities lost
   in #575 and the ones #581 restored. Then have a single integration owner render the assembled page and compare
   it with the prototype before merge.
