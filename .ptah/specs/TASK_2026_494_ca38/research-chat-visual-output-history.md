# Research: chat visual-output history (charts / rendered components in the coding chat)

Investigation date: 2026-09-23. Scope: repository history, task specs, and past Claude Code session transcripts.

## Verdict

**Planned: yes. Implemented in the coding chat: no.**

The plan exists and is documented. The user's product vision (2026-09-20, recorded in `TASK_2026_490_583c/context.md:16-24`) says: "For coding, the chat must show **graphs, stats and other visual output** where it helps." The generative-UI research (TASK_2026_490, PR #546, merged 2026-09-20) turned that vision into a sequence. "Charts in the coding chat" is **Revision 4 sequence C** and is explicitly deferred as *later* work. The agreed path is:

1. **TASK_2026_493** — declarative dashboard contract (fixed five-kind catalog: stat, line-chart, bar-chart, table, list) plus one MCP tool `ptah_dashboard_propose_spec`. **Merged on `main`** (PR #565). The tool validates a spec and pushes `dashboard:spec-proposed`, but returns plain text — nothing in the webview renders it yet.
2. **TASK_2026_494** — Electron-only "Apps page" with its own agent session that renders specs with Ptah components and sends the user's selection back to the agent (the two-way channel). **Planned, not implemented.** The plan (`implementation-plan.md`) exists in the `feat/task-494-apps-page` worktree; no code exists on the branch.
3. **TASK_2026_495_2d9f** — pinned apps (store, scheduled refresh). Status: `backlog`.
4. **"Charts in the coding chat"** — the item the user remembers. Named in the 490 report as sequence C / "come last, through one narrow mount point, after the page proves the host" (`research-report.md:232`, `:314-315`). **No task folder, no branch, no code.** The 494 task-description explicitly puts it out of scope ("Rendering dashboards inside the coding chat. That is Revision 4 sequence C").

The "sidebar similar to the agent monitor panel" maps to the planned Apps page, not to a chat sidebar: it is a separate surface (an Electron shell tab) that runs its own agent conversation, renders the catalog components, and has two-way communication (`dashboard.select` goes back to the agent; the Apps session also appears in the session sidebar). daisyUI-style components are relevant because the fixed catalog renderer is planned to be built with Ptah's own Tailwind/daisyUI components, hand-rolled SVG for charts (decision D5: no chart library).

## Findings table

| Source | Location | Date | What it says | Status |
| --- | --- | --- | --- | --- |
| User product vision, recorded in 490 context | `.ptah/specs/TASK_2026_490_583c/context.md:16-24` | 2026-09-20 | "For coding, the chat must show graphs, stats and other visual output where it helps"; Ptah must host MCP Apps; focus Electron | planned (vision) |
| Generative-UI research (TASK_2026_490, PR #546) | `.ptah/specs/TASK_2026_490_583c/research-report.md:196-232, 298-315`; merged commit `243ac6a50` / merge `d5d1a6bd7` | 2026-09-20 | Revision 4 sequence: tool-to-component registry → apps page → pinned apps → "Charts in the coding chat come last, through one narrow mount point". Sequence C: "charts in the coding chat (reuse the declarative renderer, not third-party HTML)" | planned |
| 490 engineering critique | `.ptah/specs/TASK_2026_490_583c/critique-engineering.md:157` | 2026-09-20 | "Coding-chat chart mount. Reuse the proven declarative renderer, not arbitrary third-party HTML." Go/no-go tied to chat streaming, virtualization, markdown security, CSP | planned |
| 490 seams map | `.ptah/specs/TASK_2026_490_583c/ptah-integration-seams.md:106`; `research-report.md:111` | 2026-09-20 | Tool-name→component registry was to replace the `@switch` chains at `execution-node.component.ts:443-452`; later revision demoted it ("Step 0, no change", `research-report.md:143`) | planned, later demoted |
| TASK_2026_492 (design spec) | `.ptah/specs/TASK_2026_492_0bcc/task.md` | 2026-09-22 | Status `in_review`. Design spec for the dashboard catalog and the Apps page | partial |
| TASK_2026_493 (contract + MCP tool) | `.ptah/specs/TASK_2026_493_9f58/task.md`; PR #565 merged to `main` | ~2026-09-22 | "Dashboard catalog, Zod schema, and the MCP tool that emits a spec." Status `in_review`, but the code IS on `main` (see below). Renders nowhere: no frontend listener for `DASHBOARD_SPEC_PROPOSED` | implemented (backend/shared only) |
| TASK_2026_494 (Apps page renderer) | `feat/task-494-apps-page` worktree `.ptah/specs/TASK_2026_494_ca38/` (task-description.md, implementation-plan.md, modified task.md/context.md) | 2026-09-23 | Electron-only Apps page: own agent session, five catalog renderers (hand-rolled SVG charts, D5), selection sent back via `dashboard.select`, "The coding chat stays exactly as it is." Explicitly excludes "Rendering dashboards inside the coding chat" | planned (plan written, zero code) |
| TASK_2026_495_2d9f (pinned apps) | `.ptah/specs/TASK_2026_495_2d9f/task.md` | ~2026-09-22 | Status `backlog`. Pin a dashboard, scheduled refresh, text delivery | planned |
| TASK_2026_496 / 497 spikes (Track B) | `.ptah/specs/TASK_2026_496_fc4a/task.md`, `TASK_2026_497_debb/task.md` | 2026-09-22 | Both `done` (RESEARCH). Single-owner MCP connection; containment of app HTML in Electron (iframe vs WebContentsView) | done (research) |
| Git branches / worktrees | `git branch -a`, `git worktree list` | 2026-09-23 | No branch named for chat charts. Only `feat/task-494-apps-page` carries this workstream, and it holds only spec docs. One stash (codex context work, unrelated) | — |
| Commit log | `git log --all` grep chart/visual/generative/sidebar | 2026-09-23 | Only `243ac6a50` / `d5d1a6bd7` (490 research) and `3e8acecc2` ("agent sidebar incident findings" — an unrelated Electron tab-session bug, TASK_2026_466/467) | — |

## Code that exists today

Implemented and merged on `main` (the 493 contract — the foundation the chat charts would reuse):

- `libs/shared/src/mcp-apps-contracts/dashboard-spec.types.ts`, `dashboard-spec.schemas.ts`, `dashboard-spec.validator.ts`, `dashboard-catalog.ts` — the declarative spec contract. Chart kinds at `dashboard-catalog.ts:58-59` (`'line-chart'`, `'bar-chart'`), per-chart point budgets discussed at `:158`.
- `libs/shared/src/mcp-apps-contracts/dashboard-text-fallback.ts`, `dashboard-budgets.spec.ts`, `dashboard-trust-boundary.spec.ts` — plain-text fallback and budgets.
- `libs/shared/src/lib/types/messages/payload-map.ts:234-245` and `message-constants.ts` — the `DASHBOARD_SPEC_PROPOSED` push message (`dashboard:spec-proposed`). No match for `DASHBOARD_SPEC_PROPOSED` under `libs/frontend` or `apps/` — nothing renders it yet.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.ts` — the MCP tool `ptah_dashboard_propose_spec` an agent calls to emit a spec (catalog rules at `:78-79`). Also `dashboard-namespace.builder.ts`, `protocol-dispatcher.ts`, and the test `dashboard-propose-spec.tool.spec.ts`.
- `libs/shared/src/testing/fixtures/dashboard-spec.ts:36-160` — spec fixtures (`makeStats`, `makeChart`, `makeDashboardSpecOfExactBytes`).

Special tool renderers that already exist in the coding chat (today's tool-name→card mapping, not a registry):

- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:454-471` — `sdkCardKind` computed: purpose-built cards for `workflow`, `task`, `monitor`, `sendMessage`, `scheduleWakeup` SDK tools; everything else falls through to the generic `ToolCallItemComponent`. The `@switch` chain the 490 report cited has since become this computed.
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/` — `tool-output-display.component.ts`, `tool-input-display.component.ts`, `tool-call-header.component.ts`, `diff-display.component.ts`, `todo-list-display.component.ts`, `code-output.component.ts`.
- `libs/frontend/chat-ui/src/lib/molecules/question-card.component.ts` and `libs/frontend/ui/src/lib/native/form/json-schema-form.component.ts` — the closest existing "agent renders interactive UI in chat" components (the seam the 490 report identified for an A2UI-style renderer).
- `libs/frontend/chat-routing/src/lib/streaming-surface-registry.service.ts` (`StreamingSurfaceRegistry`) — the mechanism the Apps page plan reuses for its own interactive surface.

Not existing anywhere: a chart component, a tool-to-component registry, a chat mount for `dashboard:spec-proposed`, any chart library dependency (494 plan D5: hand-rolled SVG).

## Transcript excerpts

All from `C:\Users\abdal\.claude\projects\D--projects-ptah-extension\`.

- `9bb9f34b-04f7-44ac-a0aa-90fee7b35ba8.jsonl` (2026-09-20 20:43) — the session that created TASK_2026_490. Records the origin: "An earlier conversation about CopilotKit ended without a decision. The user then found [CopilotKit/openbot] and saw that it shares ideas with Ptah."
- `0c6bcb52-2f88-4f88-af02-30b11f2d1885.jsonl` (2026-09-21 22:04) — contains the 490 revision text: "**Charts in the coding chat** come last, through one narrow mount point, after the page proves the host."
- `a7d12f0b-1946-4373-b9c7-38df4e5d7cbc.jsonl` (2026-09-21 22:04) — same revision, plus: "C. **Later:** shared actions (one Zod schema, caller-aware policy, explicit exposure), charts in the coding chat (reuse the declarative renderer, not third-party HTML), app studio and gallery."
- `39e5c8db-2f14-4b02-9575-a225605b4ad2.jsonl` (2026-09-22 21:13) — the 490 report as filed, same two passages (`research-report.md:232`, `:314-315`).
- `14f6eead-4612-49fd-807f-2a5f49cd87d1.jsonl` (2026-09-23 18:54) — the TASK_2026_494 requirements session: "Rendering dashboards inside the coding chat. That is Revision 4 sequence C ('charts in the coding chat')." Listed as out of scope for the Apps page.
- `12ddb5fc-4427-4e4b-b502-d08d2947e688/subagents/*.jsonl` (2026-09-22) — subagent lanes that also quote the "charts in the coding chat" sequence.
- Worktree transcript folder `D--projects-ptah-extension--claude-worktrees-task-493-dashboard-contract` exists — the 493 implementation session ran in that worktree.

The "earlier conversation about CopilotKit" itself was not found by keyword before 2026-09-20 in this project's transcript folder (see Gaps).

## Gaps

- The pre-2026-09-20 CopilotKit conversation was not located. Keyword `copilotkit` first matches on 2026-09-20; it may live in another Claude project folder, in a compacted/summarized transcript, or have been deleted. Its content survives only as the paraphrase in `TASK_2026_490_583c/context.md`.
- Subagent transcript folders other than the ones sampled (about 60 worktree transcript folders exist) were not exhaustively read; the main-session findings are consistent across them, so the risk of a missed independent plan is low.
- `.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66` and other worktrees sit at `main` or unrelated branches; only `feat/task-494-apps-page` was inspected for this workstream (it contains only spec documents).
- Whether TASK_2026_492/493 PRs are fully merged was judged from code presence on `main` and the 494 task-description statement "TASK_2026_493 (PR #565, merged)"; the task frontmatter still says `in_review`, so the spec status field lags the merge.