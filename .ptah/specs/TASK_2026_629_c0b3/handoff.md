# Handoff: TASK_2026_629_c0b3 — Orchestra Canvas mission board

Date: 2026-10-12. Branch: `feat/task-629-canvas-board`.
Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`.
Parent session (TASK_2026_628 orchestrator): `a8e8e895-242e-4c1c-be6b-b9d07ed509c6`.

## 1. Approvals (from the user)

- `task-description.md` and `implementation-plan.md` are approved.
- The user approved "everything, don't wait for me": one commit per batch after its
  scoped checks pass, and a push + PR at the end (global CLAUDE.md rule). Do not stop
  at each gate. Still report to the parent at each gate.
- Lanes: the user asked why CLI lanes were not used. From B2a on, implementation runs on
  CLI lanes (codex first), and review is cross-side (see §6).

## 2. Documents (read in this order)

All in `.ptah/specs/TASK_2026_629_c0b3/`:

1. `implementation-plan.md` — the merged plan. It wins over the part files. Read §1
   (decisions D1-D8), §4 (files), §5 (TASK_2026_628 dependencies), §7 (batches).
2. `batches.md` — the batch list with tasks, "Check first" items, acceptance and
   verification commands. Task states in it are NOT updated (all still PENDING); use §3
   below as the source of truth for progress.
3. `plan-part-1.md` (steps 1-3), `plan-part-2.md` (steps 4-5, Gridstack spike),
   `plan-part-3.md` (steps 6-7, perf procedure), `plan-part-4.md` (leak, batch BL) — detail.
4. `task-description.md` — requirements and acceptance criteria.
5. `prototypes/01-board.html` — the agreed design.

## 3. Progress

| Batch | What | State | Commit |
|---|---|---|---|
| docs | requirements, plan, batches | done | `c7ca2dec4` |
| B0 | optional `tabId` on `handlePermissionResponse` (D8) | done | `5e843c69f` |
| B1 | 500 ms summary sampler in `CompactSessionCardComponent` (D5) | done | `74adfd690` |
| B2a | status card zones + lane types in `chat-ui` (codex lane; report `lane-B2a-report.md`) | done | `b8f529c74` |
| B2b → B2c → B3 → B4 | Phase A rest + Phase B | pending | — |
| B5a → B5b → BL → B6 → B7a → B7b → B8a → B8b | step 1, leak, spike, detail, lane tabs | pending | — |
| B10 | running-cap start guard (after rebase over 628 Batch 3) | pending | — |
| B9 | manual perf record (user) | pending | — |

Order: B2b → B2c → (Phase A review) → B3 → B4 → (Phase B review) → B5a → B5b →
(Phase C review) → BL (Phase E review) → B6 (go/no-go) → B7a → B7b → B8a → B8b →
(Phase D review) → rebase over 628 → B10 (Phase F review) → B9.

Note: BL runs after B5b and before the B6 spike (orchestrator decision; overrides the
"after B8b" placement in older text). See `batches.md` "Batch BL".

## 4. Notes the next batches must carry

- **Open gap from B2a (decide in B2c or the Phase A review):** the prototype metrics zone
  shows todos, context %, cost and git +/−. `CompactSessionSummary.metrics` has none of
  todos, context or git, so B2a kept the existing `CompactSessionStatsComponent` (model,
  tokens, cost, agents, compactions). `compact-session-summary.ts` is 628-owned. Add the
  fields as separate card inputs computed in `CompactSessionCardComponent` (B2c), not in
  the summary. Also: `CompactSessionSummary` has no branch or elapsed (B2a assumption A9),
  so those also come in as card inputs.
- **B2a behaviour:** the board layout renders only when the `lanes` input is set. With
  `lanes = null`, the old recap/feed view stays. B2c wires the lanes.
- **Phase A review is due after B2c** (B0, B1, B2a-c): B0/B1 were written in-process →
  review them on a CLI lane; B2a (codex lane) and later lane batches → Claude sub-agent
  reviewers. Include a visual check of the card against `prototypes/01-board.html`.

- **B2b**: `ChatStore.handlePermissionResponse` (`libs/frontend/chat/src/lib/services/chat.store.ts:477`)
  does not pass `tabId` yet. If the permission responder calls `ChatStore`, add the
  optional `tabId` there too. B2b must also check that `chat` may import `VSCodeService`
  and `MESSAGE_TYPES` (plan issue 6).
- **B2c**: a 1 s timer, only while a lane runs, so the lane elapsed time does not freeze.
- **B7b** (added after user questions):
  - The card's question callout gets an "Answer" button. It opens the detail on the
    Orchestrator tab through `SESSION_CARD_ACTIONS.openSession()` (outside the canvas:
    `expandToFull`). No inline question form.
  - The card's permission callout keeps inline Allow/Deny (B2c) and gets "Open": session
    permission → Orchestrator tab, CLI-lane permission → lane tab (`openLane(laneKey)`).
    Several pending → oldest plus "+N more".
- **BL**: parent review points are in `batches.md` BL "Check first" (3) and (4): check
  whether `gridstack.js` `load()` re-adds nodes (then pass `locked: true` in the items),
  and whether a locked node still takes the authoritative `x/y`. The real-engine test goes
  through `GridStack.load(items, false)`.
- **B10**: the guard goes in the send/start-turn path, NOT in the `AGENT_SUMMARY_CHUNK`
  handler of `chat-lifecycle.service.ts` (628 Batch 3 edits that handler). Needs the
  rebase over 628 first. May need an optional token so `chat` can read the canvas count.

## 5. TASK_2026_628 coordination (settled)

- 628 edits NO canvas file now (the detached tile leak moved to 629 as batch BL).
- 628 Batch 4 keeps the `AgentMonitorStore` public API. Batch 5 moves tiles to the
  `tab-<id>` tree key (the detail transcript uses the normal ChatView path, never
  `buildTree`). Batch 6 makes `summarizeLive` linear and keeps its signature.
- Do not edit 628-owned files: `compact-session-summary.ts`, `chat-transcript.component.ts`,
  `libs/frontend/markdown`, `batched-update.service.ts`, the execution tree builder, the
  `AGENT_SUMMARY_CHUNK` handler in `chat-lifecycle.service.ts`, `agent-monitor.store.ts` and
  agent-card output files, `tab-manager.service.ts`, `stream-presentation-store.service.ts`,
  `apps/ptah-extension-webview/src/styles.css`.
- Report to the parent with `ptah_agent_report` at each phase end, on any file-list change,
  and on any conflict. If the parent is not live, repeat the report in the final message.
- Rebase onto `main` only after 628 merges (needed before B10 and B9). Never merge, rebase
  onto or push another branch.

## 6. How to run the rest

- Load the `orchestration` and `agent-lanes` skills first.
- Implementation: one CLI lane per batch (`ptah_agent_spawn`, `cli: codex`,
  `role: frontend-developer`, `workingDirectory` = the worktree, `deliverables:
  ["lane-<batch>-report.md"]`, `timeout: 1200000`, max 40 tool calls). One batch at a time:
  most batches share files, and only one heavy check may run on the machine.
- Then review the diff, and commit with commitlint format: `type(scope): subject`. Scopes
  are in `.commitlintrc.json` (`canvas`, `chat`, `chat-ui`, `chat-streaming`). End each
  message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Phase reviews (cross-side): B0/B1 were written in-process → a CLI lane reviews Phase A
  for them. Lane-written batches → a Claude sub-agent (`code-logic-reviewer`,
  `code-style-reviewer`) reviews. UI phases (A, D) also need visual review against the
  prototype in dark and light themes.
- Sub-agents and lanes have a context cap: tell them to write their file first and update
  it every 3-4 reads, use offset reads (<= 80 lines), and stay under 20-40 tool calls.

## 7. Verification rules (STRICT, from CLAUDE.md; repeat in every prompt)

- Only the changed project. Single spec:
  `npx nx test <project> --testFile=<spec-file-name> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  Do NOT use `--testPathPattern` (Nx ignores it and runs the whole suite — this happened in B1).
- Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
  `npx nx lint <project> --parallel=1 --skip-nx-cache`. `--skip-nx-cache` avoids an Nx Cloud
  401 notice that hides the result.
- Projects: `@ptah-extension/canvas`, `@ptah-extension/chat`, `@ptah-extension/chat-ui`,
  `@ptah-extension/chat-streaming`.
- One heavy check at a time (628 runs checks on the same machine). No workspace-wide runs,
  no `nx run-many` over unchanged projects, no build/serve/dev/e2e/package, no npm install
  (`node_modules` is a junction to the main checkout). Filter output.
- Do not reintroduce `content-visibility`. No `--max-old-space-size`.
