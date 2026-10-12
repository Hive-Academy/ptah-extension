# Task Context - TASK_2026_623_3492

## User Request

"/orchestrate this in a new worktree please use codex cli as a reveiwer for our subagents"

"This" is the display-panel proposal agreed in conversation on 2026-10-09:

- "i would like the agent in chat to build unique elements with daisy ui to combine a couple of elements
  together into a shape for example send subagents list with their usage as a beautiful component in the
  chat rather a markdown"
- On the TASK_2026_610 PR A recap: "is not true and doesn't look right we need to be intelligent and show
  those as stats cards accordions that opens from the bottom of the chat i recall i asked a session to fix
  how we show commands and file preview but they still don't look polished enough" (two reference
  screenshots: soft dashboard cards, large numbers with trend pills, inline bar sparklines, generous
  spacing; a minimal light dashboard with stat tiles, small pie/bar visuals and a large revenue strip).
- "i'm think to have a better room we can like a display monitor panel similar to our cli agent
  monitor-panel component that automatically controlled by the agent to open up and show these beautiful
  responsive containers, with rows and columns as structural element and stats visuals titles etc"

Reference screenshots are in the session temp folder:
`C:\Users\abdal\AppData\Local\Temp\claude\D--projects-ptah-extension\3ee29208-cd83-450c-bed3-7c58819f62f3\images\1.png` and `2.png`.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`
Branch: `feat/task-623-display-panel`, from `origin/main` at `70f995a56`.

## Task Type

FEATURE

## Complexity

Complex (shared surface contract + ptah-ui grammar, Angular panel and renderer, host sources, agent-sdk
hint and skill, redesign of turn summary and previews).

## Strategy

Full FEATURE flow: project-manager (task-description.md + parity-inventory.md, since the turn summary,
command preview and file preview are redesigned) -> Codex cross-side review -> Gate 1 -> ui-ux-designer +
prototype -> Codex review -> Gate 1.7 -> software-architect -> Codex review -> Gate 2 -> team-leader
batches -> QA.

## CLI Lanes

Mode: enabled (user: "use codex cli as a reveiwer for our subagents").
Approval: lane-review, with Gate 1.7 (visual design) and any proposed removal escalated to the user.

Roster (pinned by user): subagents author; Codex lanes review every subagent-authored document and the
phase code reviews. Implementation executors decided at decomposition.

ptah_agent_list rows (2026-10-09):

| Agent | Type | Status |
| ----- | ---- | ------ |
| codex | cli | installed |
| copilot | cli | disabled (installed) |
| cursor | cli | not installed |
| antigravity | cli | installed |
| opencode | cli | installed |
| pi | cli | not installed |
| grok | cli | installed |
| Glm | ptah-cli | available (Ollama Cloud, pc-355b645d-35af-4974-84cf-9cf961ea0164) |

## Conversation Summary

### What already exists (on main)

- TASK_2026_610 PR A: tests row (`chat-ui/src/turn-recap.ts`, `turn-tests-row.component.ts`) and cost /
  duration badges attached to the TASK_2026_576 change-set card. Not a real recap; the user judged it
  unpolished.
- TASK_2026_610 PR B+C: ```` ```ptah-ui ```` fences in agent replies (title/stats/table/list/chart),
  host sources `$diff`/`$tests`/`$usage`, prompt hint (77 tokens), `ptah-surface-authoring` skill.
  Electron only; VS Code keeps a plain code block.
- TASK_2026_594: `dashboard-catalog/3`, status kinds, `text-block`, `alert`.
- Surface catalog already has `stack`, `grid`, `card` containers (`surface-catalog.ts:24-25`) and patch
  operations (`surface-patch.ts`); the fence grammar does not expose containers.
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts` is the panel
  pattern to follow.

### Agreed direction (to be scoped by the PM)

1. Display panel per chat tab, monitor-panel style, responsive by container width.
2. Agent control through ```` ```ptah-ui display ```` fences with an optional surface id; a repeated id
   updates in place. No new coding-profile tool (TASK_2026_595 rule).
3. Layout grammar: row, col, grid, card, section; atoms: stat with trend pill + sparkline, progress,
   badge, avatar, accordion, note (folds 610 PR D: note -> alert).
4. `$agents` host source (subagents with status, tokens, cost).
5. Host-built turn summary moves into the panel as expandable stat cards (replaces PR A badges/tests row
   placement - removal decisions go to the user via parity-inventory).
6. Command and file preview polish in the same visual language.
7. User control: pin, close, resize; the agent does not reopen a panel the user closed in the same turn;
   chat history keeps a static snapshot / chip.

### Parked

- A2UI v0.9 adapter (610 former PR E) and agent-written HTML templates (610 part 4).
- VS Code webview and TUI (Electron only, as in 610).

### Standing decisions this task must respect

- No raw agent HTML, no agent scripts (TASK_2026_490/493/494).
- Semantic kinds, never class names, in the built-in catalog (TASK_2026_594). DaisyUI is the renderer's
  implementation, not part of the grammar.
- Dashboard and surface Apps tools stay Apps-only (TASK_2026_595).
- Charts reuse the declarative renderer (TASK_2026_490 Rev 4 C).
- Memory-safe verification rules in CLAUDE.md for every agent and lane.
