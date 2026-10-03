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
