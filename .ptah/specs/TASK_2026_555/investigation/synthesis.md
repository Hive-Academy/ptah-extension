# TASK_2026_555 — Investigation synthesis

Sources (all in this folder): `forensics-523-vs-shipped.md` (subagent), `../parity-inventory.md` (subagent),
`lane-glm-providers-ux-audit.md` (Glm lane), `orchestration-ux-audit.md` (subagent; the opencode lane
failed twice on quota), `lane-agy-pattern-research.md` (Antigravity lane). Orchestrator spot-checked
the citations marked (verified).

## Why the page is still bad

1. TASK_2026_523 (PR #575) had no prototype and no user approval of its design; only fact checks of the
   spec (`TASK_2026_523_c3df/batches.md:131`). Batches passed on tests/typecheck/lint only; no batch
   opened the page in a browser (`batch-d2-d3-report.md:338`, verified).
2. The 523 spec contradicted itself: it demanded a persistent scope strip with text buttons under every
   editable value (`design-spec.md:138-148`, verified), non-clickable cards with explicit buttons (:50),
   and moved the nine CLI model/effort keys into Providers (:31) — while budgeting 152 px for the main
   card and 88 px per connection row (:22). The rules cannot fit the budget.
3. The blue primary action was dropped as "a small visual deviation" (`batch-d1-coordinator-report.md:64`,
   verified), so every button looks the same.
4. TASK_2026_534 (PR #581) was correctness-only by mandate; later commits only added buttons. The visual
   rework task (555) was filed and left in backlog.

## Measured state

- Page ≈ 2,900–3,300 px (≈ 4 screens at 768 px). Main card ≈ 420–445 px (budget 152). Scope strips ≈ 36 %
  of height (27 rows). Nine one-card-per-setting CLI blocks ≈ 1,100 px. (Glm; derived from Tailwind
  classes, not a rendered measurement.)
- "Change main provider" only moves focus (`providers-settings.component.ts:91`, verified). "Manage"
  opens the setup wizard (`:167`, verified). No drawer, no Disconnect, no "Used by".
- Parity: of 82 old capabilities, 43 present, 21 partial, 18 missing. Examples: delete stored API key
  (verified missing — `clearKey` only clears scope overrides, `:559-564`), Copilot sign-out, delete custom
  provider, model search for tier mapping, tool-use warnings, CLI-agent tier mapping, per-CLI permission
  notes. Only proposed removal: the post-save Reload button.
- Clicks old → new: change a tier model 2 → 8; add an API key 2 → 8 (11 without default models).
- Agent Orchestration: model/effort selects that lived in each CLI card (one action, saved on change,
  old `agent-orchestration-config.component.ts:303,332`, verified) were replaced by a
  "Manage … in Providers" button per row that deep-links to a generic section (`:296`, `:415-418`, verified).

## Converged direction (three independent sources agree)

| Tab | Answers | Contents |
| --- | --- | --- |
| **Providers** | "Who can I talk to?" | Compact header · Main-agent strip (provider, model, effort, one status line, one scope badge) · Connections as ~44 px rows with status dot + kebab (Manage drawer: key replace/delete, sign-out, models, "Used by", Disconnect) · "Connect provider" opens the catalog/wizard |
| **Agent Orchestration** | "Who does the work?" | One **model-roles table** (main agent read-only link, memory curator, synthesis lanes, judge) · One **CLI agents table** (enabled, provider, model, effort, status, auto-approve) · Ptah CLI instances · concurrency + agent order |

Scope provenance: one small badge per value only when it is overridden ("Workspace override" / "App
override") with a popover for details, Clear and "Use global"; inherited values show nothing. Replaces
`SettingScopeRowComponent` strips. (VS Code settings editor pattern.)

Target: at 1024×768 the header, main-agent strip and five connection rows fit above the fold
(Glm wireframe ≈ 660 px). This becomes a pass/fail line in the visual review.

## Open decisions for the user

1. Two-tab split as above.
2. Save model: inline select saves at once with undo, vs. current draft → verify → save.
   Constraint: `123c84c25` keeps provider edits off the running session; credential changes still need
   verification. Candidate: inline save for model/effort/role assignments; drawer + verify for credentials.
3. Restore the 17 missing capabilities; drop the Reload button.
4. Process: designer writes design-spec + static HTML prototype (dark + light) → user approves (Gate 1.7)
   → implementation with visual review against the prototype and the fold budget.
