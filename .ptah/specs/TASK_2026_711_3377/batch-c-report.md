# Batch C report — docs, parent prompt, sync spec

Docs now tell a UI lane to load a design skill, render, and screenshot when `ptah_browser_*` is on its tool list. The parent prompt allows an in-workspace `file://` URL and tells the parent not to paste a tool table. The sync spec is written. It imports `PTAH_LANE_POLICY` from the public package, which does not export that name yet.

## Files

- `.claude/skills/agent-lanes/SKILL.md` — §3 item 10 is the UI render rule (`file://` inside the workspace, state what was checked) and names `PTAH_LANE_POLICY` so briefs skip the tool table. §7 keeps messaging capability-dependent and names `PTAH_LANE_POLICY`, `TWO_WAY_MESSAGING_GUIDANCE`, and `renderLaneCompletionContract` as the child-side sources of truth.
- `.claude/skills/tribunal/references/crucible.md` — one UI line after the roster. Line 52 stays the tribunal-UI roster rule.
- `.claude/skills/orchestration/references/lane-assignment.md` — replaced “lanes do not have” browser tools with the tool-list line. Visual-reviewer still owns independent dark+light evidence.
- `.claude/skills/orchestration/references/agent-catalog.md` — same line on the ui-ux-designer brief and after the visual-review checklist.
- `.claude/skills/orchestration/references/team-leader-modes.md` — same line under UI batch completion checks. The dark+light visual-reviewer requirement stays.
- Packaged twins of those five files under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/` — copied so the pairs stay byte-identical. Hashes matched before the edit and after the copy.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` — navigate text allows an http(s) URL or a `file://` URL inside the workspace. The agent section says each lane receives `PTAH_LANE_POLICY` automatically, so `task` gets no tool table. No vendor names added.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/lane-policy-sync.spec.ts` — new. Asserts the four shared tool names, canary `Lane policy id: ptah-lane-policy-v1` once, §3 UI rule plus `PTAH_LANE_POLICY`, and that neither the policy nor §7 says a messaging mode is available (`steer is available` / `is always available`).

Not edited, on purpose: `cli-adapter.utils.ts`, browser implementation files, `subagent-tool-allowlist.ts`, `vendor-roster-drift.spec.ts`. The drift spec already scans `PTAH_SYSTEM_PROMPT`. The new parent sentences add no brand from its banned list.

## C.3 — keep the six-role browser deny

**Recommendation: keep `SUBAGENT_DISALLOWED_TOOLS` denying browser and web tools to** `code-logic-reviewer`, `code-style-reviewer`, `modernization-detector`, `project-manager`, `software-architect`, and `team-leader`.

Reasons:

1. Those six roles plan, review, or scan code. Rendered checks belong to a UI lane that has `ptah_browser_*`, and independent dark+light evidence still belongs to `visual-reviewer`. `frontend-developer` and `ui-ux-designer` already keep the browser tools (they deny Firecrawl only). `visual-reviewer` denies nothing (`subagent-tool-allowlist.ts`).
2. Cost is on every spawn, in the prefix, whether or not the task has UI. The 11 browser tools plus `ptah_web_search` are about 7,337 characters, about 1,834 tokens at four characters per token. Input schemas alone are 3,585 characters, about 896 tokens (`code-inventory.md` §7). Removing the deny pays that on every spawn of those six roles.
3. A later exception for one role is reversible, and only worth it when a concrete task shows that role must render. This task does not change the allowlist.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| Keep the six-role browser deny | Drop the deny; keep it; exception per role when a task proves it | `subagent-tool-allowlist.ts` lines 53–84; `code-inventory.md` §7 (7,337 chars / ~1,834 tokens; schemas ~896 tokens) | Yes |
| Pin the canary to `Lane policy id: ptah-lane-policy-v1` | Plan draft `ptah-lane-711-3377`; the amended id | `context.md` approved amendment 3; `cli-adapter.utils.ts` line 416 | Yes, when the policy id changes on purpose |
| Leave crucible line 52 as the roster rule; put the UI line after item 4 | Rewrite item 2 (“UI lanes without tokens”) into the browser rule | `crucible.md` line 52 is which tribunal-UI lane executes vs judges, not an HTML brief | Yes |
| Copy the five skill edits onto the packaged twins | Edit only `.claude/skills` | Pairs were byte-identical before the edit; plugin assets are what the extension ships and what `lane-rule-single-home.spec.ts` reads | Yes |
| Do not export `PTAH_LANE_POLICY` from this lane | Export it from `cli-adapters/index.ts`; deep-import the file | Named re-export in `cli-adapters/index.ts` lines 10–18 omits it. `src/index.ts` only `export *`s that barrel. Another lane owns cli-agent-runtime | Yes |

## Clarifications needed

`PTAH_LANE_POLICY` is not on the `@ptah-extension/cli-agent-runtime` public entry. `lane-policy-sync.spec.ts` imports it from that entry, as specified. The spec will not compile until the cli-agent-runtime lane adds `PTAH_LANE_POLICY` to the named export in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts`.

1. Export `PTAH_LANE_POLICY` from that barrel (recommended). The package root already re-exports the barrel, and vscode-lm-tools already depends on the package.
2. Point the spec at a deep path. That breaks the required public import.
3. Leave the spec red until batch A exports the constant.

## Not done

- No nx, Jest, tsc, lint, or build. The orchestrator runs `lane-policy-sync.spec.ts`.
- `ptah_agent_report` is not in this session’s tool list (`search_tool` for `ptah` and `ptah_agent_report` returned no Ptah tools). The report is this file.
- `vendor-roster-drift.spec.ts` was not given a new `PTAH_LANE_POLICY` case. That constant lives in a library this lane must not edit, and the constant is not public yet. `cli-adapter.utils.spec.ts` already guards the policy text for vendor tokens.
