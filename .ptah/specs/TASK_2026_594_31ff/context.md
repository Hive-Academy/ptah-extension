# TASK_2026_594_31ff — context

Filed 2026-10-02 at the user's request. Follows TASK_2026_494_ca38 (Apps page, done) and the
contract from TASK_2026_493.

## Current state

- The agent sends a JSON surface spec through `ptah_surface_update` (v2) or
  `ptah_dashboard_propose_spec` (v1). The webview renders it in
  `libs/frontend/declarative-dashboard` with Ptah components that use daisyUI classes.
- The vocabulary is fixed in `libs/shared/src/mcp-apps-contracts/surface-catalog.ts`:
  layout `section | stack | grid | card`, input `text | select | radio-group | checkbox`,
  display `stat | line-chart | bar-chart | table | list` (`dashboard-catalog.ts:55-61`).
- The validator rejects an unknown kind for the whole spec (fail closed).
- Agents learn the contract only from `APPS_SYSTEM_PROMPT`
  (`libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts`), so the knowledge exists only on the Apps page.

## Decisions (user, 2026-10-02)

1. Add the "status set" only: `alert`, `badge`, `progress`, `radial-progress`, `divider`.
2. Deliver the catalog to agents as a skill plus a pointer in the Apps system prompt. No slash command.

## Design rule — semantic kinds, never class names

The agent must never send daisyUI class names or raw HTML. Each new kind carries semantic
props from closed enums. The renderer maps them to daisy classes. Reason: class strings are
agent-controlled values, and the trust boundary in `dashboard-catalog.ts:11-19` rejects any
free-form styling or markup. Text stays plain text (`DASHBOARD_TEXT_FORMATS`).

Proposed props (architect confirms):

| kind | props |
|------|-------|
| `alert` | `tone: info \| success \| warning \| error`, `title?`, `text` |
| `badge` | `tone: neutral \| primary \| info \| success \| warning \| error`, `text`, optional `dashboard.select` |
| `progress` | `value` 0-100 or data-model binding, `tone`, `label` |
| `radial-progress` | same as `progress` |
| `divider` | `text?`, `direction: horizontal \| vertical` |

## Scope

- Contract: bump to `dashboard-spec/3` + `dashboard-catalog/3` (or document why v2 can absorb the
  kinds), add zod schemas, budgets, text fallback, validator cases, trust-boundary tests.
- Renderer: one standalone OnPush component per kind in `declarative-dashboard`, wired in
  `surface-node.component.ts`; budget-render cases.
- Backend: MCP tool descriptions in `vscode-lm-tools` list the new kinds.
- Skill: `.claude/skills/ptah-surface-authoring/` (SKILL.md + `references/catalog.md` with one
  JSON example per kind). The catalog reference must stay in sync with `surface-catalog.ts`;
  add a spec that fails when a kind is missing from the reference.
- Prompt: `APPS_SYSTEM_PROMPT` names the skill and lists the kinds in one line.

## Out of scope

Structure kinds (tabs, collapse, steps, timeline), content kinds, new input kinds, iframes,
any agent-supplied HTML or CSS.

## Acceptance

- A spec with each new kind validates in the backend and in the webview, and renders in dark and light themes.
- A spec with an unknown `tone`, a `class`/`style`/`html` field, or a value outside 0-100 is rejected.
- Older `dashboard-spec/1` and `/2` specs still render.
- The skill's catalog reference lists every kind in `SURFACE_COMPONENT_KINDS`.
- `nx test` passes for `shared`, `declarative-dashboard`, `mcp-apps-page` and `vscode-lm-tools`.

## User Decisions (2026-10-05) — corrections to the sections above

Work starts after PR #649 (TASK_2026_610, ptah-ui blocks) merged into main (`186b1b25d`).
Worktree `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds`, branch `feat/task-594-status-kinds`.

1. The `ptah-surface-authoring` skill ALREADY EXISTS (from TASK_2026_610) at
   `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/`
   (`SKILL.md` + `references/ptah-ui.md`, registered in `content-manifest.json`). Do NOT create
   `.claude/skills/ptah-surface-authoring/`. Extend the existing skill: add `references/catalog.md`
   (one JSON example per kind) and a spec that fails when a kind in `SURFACE_COMPONENT_KINDS` is
   missing from that reference. Regenerate `content-manifest.json` with `npm run manifest:generate`.
2. This task is the single catalog bump: `SURFACE_CATALOG_VERSION` `'dashboard-catalog/2'` → `'/3'`
   (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:11`, `surface.types.ts:124`,
   declarative-dashboard `surface-view-model.ts:113`, test fixtures/harness). TASK_2026_610 depends on
   `'/3'` existing and will NOT bump it again.
3. Add the static text kind in the same bump (TASK_2026_610 decision L-10, see
   `.ptah/specs/TASK_2026_610_6a10/implementation-plan.md` §14 "D1"): display kind `text-block`
   `{ id, kind: 'text-block', text: RichText, role: 'heading' | 'body' }`, plain text per
   `DASHBOARD_TEXT_FORMATS`, with schema, budget, text fallback, contract-spec cases (reject unknown
   role, empty/over-length text, extra fields) and a renderer component.
4. `alert` must render well as a short inline note: 610's ptah-ui `note` line will map to `alert`
   (tone + text).
5. Extra acceptance: `npm run gate:eager-closure` passes (declarative-dashboard is in the webview).
6. Constraints: lanes never commit; commits end with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; no bare `git stash`; nothing pushed to
   main without the user.

## CLI Lanes

Mode: enabled (user named opencode, codex and glm, 2026-10-05).

| Agent | Type | Status | Capabilities |
| ----- | ---- | ------ | ------------ |
| codex | cli | installed | messaging: queue |
| opencode | cli | installed | messaging: none |
| Glm | ptah-cli | available | provider: Ollama Cloud, ptahCliId: pc-355b645d-35af-4974-84cf-9cf961ea0164, messaging: queue |

Roster (orchestrator assignment; the user named the lanes, not the phases):

| Phase | Author | Independent review (cross-side) |
| ----- | ------ | ------------------------------- |
| Requirements `task-description.md` | codex lane | project-manager subagent |
| Architecture `implementation-plan.md` | codex lane | software-architect subagent |
| Implement batches | Glm and opencode lanes (file-disjoint) | code-logic-reviewer subagent (one per phase) |
| Rendered evidence | — | visual-reviewer subagent (dark + light) |

UI note: the new kinds are renderer components inside the existing surface renderer, not a new or
redesigned screen. No designer/prototype phase. Completion needs dark + light screenshots of a spec
that uses every new kind.

## Gate 1 — Requirements (2026-10-05)

User: APPROVED `task-description.md` revision 3 (reviewer verdict APPROVED, round 2 of 2). Open questions resolved with the recommendations:

- Q1: `dashboard-spec/2` + `dashboard-catalog/2` envelopes are rejected after the bump (version-pair error).
- Q2: badge `actions` are restricted to `dashboard.select`.
- Q3: `progress` / `radial-progress` take a literal value only; data-model binding is deferred.

## Gate 2 — Architecture (2026-10-05)

User: APPROVED `implementation-plan.md` revision 3 (reviewer verdict APPROVED, round 2 of 2). User instruction: run through to an open PR without stopping (QA choice gate pre-answered: default QA — code-logic review, one fix round, visual review dark + light). Push only the feature branch; never merge to main.
