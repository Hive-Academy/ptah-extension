# TASK_2026_852_e271 — Retire the Tribunal page, keep Tribunal as a skill

- Type: REFACTORING, depth Full, approval mode lane-review.
- Worktree: `.claude-worktrees/retire-tribunal-page`, branch `refactor/retire-tribunal-page` from `main` @ ba0f98271.
- Lanes: codex (`cli: "codex"`, weekly 22% at start). No `taskKind`.
- Reviewer for shipping code: in-process Claude (different family from codex).

## User request (verbatim intent)

Remove the separate Tribunal UI (page/route, `libs/frontend/tribunal-panel`, Command Center
entry points, VS Code assets) so Tribunal (Council, Forge, Race, Crucible, Relay) runs only
through the `tribunal` skill from the main chat with `ptah_agent_*` lanes. Electron first;
keep every host compiling. Keep the skill, the `ptah_agent_*` tools and anything the skill
calls. Removals need user approval. Update docs (Tribunal = skill) and the skill text if it
mentions "Tribunal UI launches". Avoid `libs/frontend/chat` edits unless required (open
branch `fix/lane-chat-order` touches it) and report overlap.

## Flow

inventory (codex) → spot-check → user approves removals → plan → implement (codex) →
Claude review → scoped verify + typecheck ptah-electron, ptah-extension-vscode, ptah-tui,
ptah-extension-webview → docs → commit, push, PR, watch CI.

## User decisions (2026-10-29, after parity-inventory.md)

1. Approved Proposed Removals 1-8 in full (page/route/tab/Setup Hub card in Electron + VS Code,
   wizard, conductor pane + tile grid, phase rail/verdict chip, Close button, Command Center
   Tribunal proposal/confirm/voice/run grouping, tribunal-tour scene + tribunal e2e spec).
2. Delete the `tribunal-conductor` harness preset (asset + builtin-presets entry). Keep the
   generic harness system and the tribunal skill install.
3. Delete RPC `tasks:getRoundJudge` (handler, contract, allowlist, host-source baseline).
   KEEP `CommandCenterRunManifest` storage types and `tab-manager.service.ts` cleanup unchanged
   (old records keep working; avoids overlap with `fix/lane-chat-order`).
4. Skill accepts plain-text roster pins from main chat (lanes/models, duplicates allowed);
   rewrite `vendor-panel.md` §0, confirm panel + call count before spawning.

## Overlap with fix/lane-chat-order

That branch edits `chat-state/tab-manager.service.ts`, `chat/services/message-sender.service.ts`,
`chat/tokens/session-context.token.ts`, `chat-store/session-loader.service.spec.ts`.
Do NOT edit those four files. Required chat edits (no overlap): `app-shell.component.{html,ts}`,
`electron-shell.component.ts` + `electron-shell.apps-tab.spec.ts` +
`electron-shell.config-gate.spec.ts`, `workspace-coordinator.service.spec.ts`.

## Limits log

(none)
