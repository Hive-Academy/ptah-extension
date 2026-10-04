# Task Context - TASK_2026_610_6a10

## User Request

"I want to be the first coding agent that implements A2UI and lets the agent send beautiful and unique
HTML elements, but without sacrificing performance and context." Then: "I liked your surgical and
focused plan, let's do so in a new worktree with codex cli tool and our subagents."

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat`
Branch: `feat/task-610-a2ui-coding-chat`, from `origin/main` at `f314a4f8a`.

## Task Type

FEATURE

## Complexity

Complex (backend MCP tools, shared contract, webview chat, Electron/VS Code hosts).

## Strategy

Full FEATURE flow: project-manager -> researcher-expert (A2UI v0.9 spec) -> ui-ux-designer +
prototype -> Gate 1.7 -> software-architect -> Gate 2 -> team-leader batches -> QA.
Every plan, design and architecture artifact gets a cross-side document review (Codex lane reviews
subagent-authored documents) before its user gate.

## CLI Lanes

Mode: enabled (user asked for "codex cli tool and our subagents", 2026-10-03).

ptah_agent_list rows (2026-10-03):

| Agent | Type | Status |
| ----- | ---- | ------ |
| codex | cli | installed |
| copilot | cli | disabled (installed) |
| cursor | cli | not installed |
| antigravity | cli | installed |
| opencode | cli | installed |
| pi | cli | not installed |
| Glm | ptah-cli | available (Ollama Cloud, pc-355b645d-35af-4974-84cf-9cf961ea0164) |

Roster: subagents author documents and own synthesis. Codex lanes do research sub-questions,
cross-side document reviews, and implementation batches the team-leader marks for a lane.

## Conversation Summary

### Agreed plan (the five parts)

1. **Host-built turn recap card.** Files changed with diff stats, tokens, cost, duration, tests run.
   Built from session data at turn end. Zero model tokens. The agent may add one or two sentences.
   Can ship before part 2 because it needs no agent tool.
2. **Surfaces in the coding chat (absorbs TASK_2026_539_67f5).** Coding sessions get ONE small tool
   (working name `ptah_render`) with a minimal schema. The full catalog lives in an on-demand skill.
   This keeps the TASK_2026_595 result: the coding profile does not get the Apps tool schemas. Includes
   539's chat-tab claim/release on `SurfaceUpdateInbox` and the `surface:release` RPC.
3. **A2UI v0.9 adapter at the boundary.** Accept A2UI messages and convert them to the internal
   dashboard-spec / surface contract. Our validator stays the trust boundary.
4. **Agent-registered custom catalog templates.** The agent writes an HTML/CSS template one time; it is
   saved as a custom catalog entry. After that it sends only `{ template, data }`. No scripts, CSS
   sanitized and limited to theme tokens, one-time user approval, cached per workspace. Rendered in a
   Shadow DOM sandbox (or one shared sandboxed frame - architect decides with evidence).
5. **Performance rules.** Lazy-load the renderer (same gate as TASK_2026_494 Req 9.1), render at turn
   end, convert old surfaces to static snapshots, cap live surfaces per tab (`SURFACE_STORE_LIMITS`).

### User decisions 2026-10-04 (supersede parts 2 and 4 above where they conflict)

- **Authoring channel = fenced block + host data.** The coding agent writes a compact ```` ```ptah-ui ````
  fenced block in its normal markdown reply, NOT a `ptah_render` tool call. No new coding-profile tool
  schema. Host sources (`$diff`, `$tests`, `$usage`, ...) are resolved by the host at render time so the
  agent never transcribes data the host already has. Invalid blocks fall back to a plain code block.
  Rationale: agent output stays in context and is resent on every later request; JSON is ~60% syntax.
- A2UI v0.9 JSON is accepted only at the boundary (external agents / Apps profile), via the adapter.
- Part 4 (custom templates) becomes optional/deferred; host bindings remove most of its saving.
- Start order: PM revises `task-description.md` + Codex cross-side review, while a Codex lane builds
  PR A (host-built recap card) in parallel. Architecture waits for Gate 1.
- Lanes: Codex for backend batches and document reviews, opencode for frontend batches, subagents
  for authoring docs and for reviewing lane-written code.

### Gate 1 — APPROVED 2026-10-04

`task-description.md` approved by the user after two revise rounds (Codex cross-side review,
`task-description-review.md`). The last open defect (Req 2 `value = scalar | cell` ambiguity) was
closed at the gate by the user-approved fix `cchar` excludes bare `$`. Next: software-architect →
Codex review of `implementation-plan.md` → Gate 2.

### User scope change 2026-10-04 (after Gate 1) — Electron only

"I would focus on electron for now, no need to do work on the TUI nor the VS Code extension."
- All TUI requirements (Req 1.9, D4 plain-text TUI output, TUI change-set subscription) are deferred.
- No VS Code-specific work. The Angular webview is shared with VS Code, so fence rendering and host
  sources must be gated to the Electron host (as the Apps route already is with `electronOnlySurface`);
  in VS Code a `ptah-ui` fence stays an ordinary code block. The syntax hint must not be sent to
  sessions that cannot render it (VS Code, TUI, CLI). Token/bundle measurements are Electron-only.

### Gate 2 decisions 2026-10-04 (before plan revision round 1)

- Static text/note kinds go into TASK_2026_594's `dashboard-catalog/3` (one bump). PR D waits for 594;
  594's scope must gain the text kind (coordinate with the 594 owner). A2UI catalog id stays `/3`.
- PR E (A2UI adapter) is removed from this Gate 2 approval. It gets its own plan amendment and Gate 2
  after the raw A2UI v0.9 schema check (Req 4.1).

### Gate 2 — APPROVED 2026-10-04

`implementation-plan.md` approved after one revise round (Codex review `implementation-plan-review.md`,
8/8 defects closed). Condition: D2 needs a plan amendment with its exact file list after TASK_2026_594
lands, before D2 starts. `HOST_KIND` token stays in `vscode-core` as planned. Start: team-leader writes
`batches.md`, then PR A + PR B batches (Codex lanes for shared/backend, opencode lanes for Angular,
max 3 in flight, subagent reviewers for lane-written code).

### Spec correction 2026-10-04 (during Wave 2)

The Gate 1 `$` fix (`cchar` excludes bare `$`) contradicted the lexical table row for escaped dollar
(`task-description.md:366`: `$` inside a table row cell or mid-cell is literal). Corrected the EBNF to
the lexical table's intent without reopening the ambiguity: `value = scalar | vcell`,
`vcell = [ (cchar - "$") { cchar } ]`, and `cchar` allows `$` again. So `$` is a source position only at
the start of a stats value and as a `table`/`list` argument; table cells and chart labels such as
`$5.00` are literal. B1's parser currently rejects a bare `$` at the start of non-value cells and must
be fixed to match.

### Standing decisions this task must respect

- No raw agent HTML rendered without the template gate, no agent scripts ever (TASK_2026_490/493/494).
- Dashboard and surface Apps tools stay Apps-only (TASK_2026_595, user decision 2026-10-03).
- Semantic kinds, never class names, in the built-in catalog (TASK_2026_594).
- Charts in the coding chat reuse the declarative renderer, not third-party HTML (TASK_2026_490 Rev 4 C).
  Part 4 is a deliberate, bounded extension of this rule; the PM must record it as a user decision.

### Coordination

- TASK_2026_594_31ff (status kinds, `dashboard-catalog/3`) was set `in_progress` in the main worktree
  on 2026-10-03 19:39 by another actor. Catalog version bumps here must sequence with 594.
- TASK_2026_524_1125 batches 3-4 and TASK_2026_584_5e7a touch chat tab code (from 539's context).
- The "first coding agent with A2UI" claim is unverified; CopilotKit, AG2, Google ADK and Lynx
  already support A2UI.

### References

- Claude Code mods post: https://claude.dev/blog/getting-started-with-claude-code-mods/ - declarative
  tree, no DOM/iframe, surface-aware `$.ui.resolve`, hook-driven host data (`turn.complete`).
- A2UI: https://a2ui.org/ , https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/
- Prior tasks: `.ptah/specs/TASK_2026_490_583c`, `TASK_2026_494_ca38`, `TASK_2026_538_3ccf`,
  `TASK_2026_539_67f5`, `TASK_2026_594_31ff`, `TASK_2026_595_1c01`.
