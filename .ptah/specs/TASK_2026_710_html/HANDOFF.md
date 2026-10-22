# HANDOFF — TASK_2026_710_html: HTML artifacts ("visual replies")

Written 2026-10-20 by the orchestrator session (Claude Opus 5.5) at the user's request
(session token budget). Read this file first, then `context.md` in this folder.

## Goal

Let a coding agent in Ptah (Electron first) publish one self-contained `index.html`
(inline CSS + JS) for rich visual output, e.g. "turn the MCP benchmark into a dashboard".
Ptah shows it in chat as a card and in the display sheet as a sandboxed viewer. The fixed
`ptah-ui` schema blocks stay unchanged for small inline summaries.

**User decisions (fixed, do not reopen):**
- Artifact HTML may run **scripts with no network**: iframe `sandbox="allow-scripts"` (no
  `allow-same-origin`, forms or popups), opaque origin, response CSP `default-src 'none'`
  with inline script/style only, `connect-src 'none'`. Replaces the old rule "no agent
  scripts ever" for this surface only.
- Bridge: host → page `theme {mode, vars, nonce}`; page → host `height {px, nonce}` and
  `open-link {url, nonce}` only. Zod + `event.source` + nonce checks.
- The user allowed ONE named Electron Playwright run (the containment spec) per gate, with
  the `build-dev` + `copy-renderer-dev` steps it needs. No other e2e/build.
- Electron only; VS Code and CLI keep compiling and return "desktop app only".

**Orchestrator decisions (see `context.md`):** every publish creates a new id at
revision 1; `savedPath` never goes to the model or webview; `artifacts:list` takes
`{ sessionId }` resolved through the session registry.

## Where things are

| Item | Value |
| --- | --- |
| Worktree | `D:\projects\ptah-extension\.claude-worktrees\agent-html-freedom` |
| Branch | `docs/agent-html-freedom` (tracks origin) |
| PR | https://github.com/Hive-Academy/ptah-extension/pull/789 (title still "docs(task-specs): ..."; retitle to a `feat(...)` title when the code is final) |
| Task folder | `.ptah/specs/TASK_2026_710_html/` (inside the worktree) |
| `node_modules` | junction to the main checkout. Never `npm install` here. Before `git worktree remove`, run `cmd /c rmdir <worktree>\node_modules` first. |

### Commits on the branch
- `2d6535998` docs(task-specs): research (external-research.md, current-pipeline-inventory.md,
  prior-tasks-synthesis.md, context.md)
- `7aefb2bed` feat(electron,shared,platform-core): sandboxed ptah-artifact protocol
  (Batches 1-2 + Phase 0 gate fixes). Pushed.

### Uncommitted in the worktree (Batches 3, 5, 6/6a, 7, 8, 9, 10, 11 + revise round 1)
All verified by me per batch except where noted; NOT yet committed because the reviews
returned REVISE. See `batch-<n>-report.md` for each.
- B3 Electron store: `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts`
  (+spec), `platform-electron/src/registration.ts`, `apps/ptah-electron/src/main.ts`.
- B5 tool: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tools.ts`,
  `artifact-tool-handlers.ts` (+spec), `protocol-dispatcher.ts`, dispatcher + sweep specs.
- B6/6a RPC: `libs/backend/rpc-handlers/src/lib/handlers/artifact-rpc.handlers.ts` (+spec),
  `libs/shared/src/lib/types/rpc.types.ts`, allowlist/manifest, Electron `phase-4-handlers.ts`,
  3 `rpc-surface.spec.ts` files.
- B7 UI: `libs/frontend/chat-ui/src/lib/organisms/artifacts/*`, `display-panel.component.ts`,
  `libs/frontend/chat-ui/src/index.ts`.
- B8 webview data: `libs/frontend/chat/src/lib/services/artifact.store.ts`,
  `artifact-message-handler.service.ts` (+specs), `apps/ptah-extension-webview/src/app/app.config.ts`.
- B9 host wiring: `http-mcp-server.service.ts` (optional store + notify ports, ~316-320,
  402-403), Electron `phase-3-storage.ts` (notify factory 53-68), DI guard specs.
- B10 guidance: `ptah-system-prompt.constant.ts`, `.claude/skills/ptah-surface-authoring/SKILL.md`
  and the byte-identical copy under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/`.
- B11 UI wiring: `tool-call-item.component.ts` (card at `ptah_artifact_publish`, line ~152),
  `display-sheet.component.ts` (records + `artifacts:openLink`), `display-dock.state.ts`.

## In progress at handoff (revise round 1 of max 2)

Reviews (grok): `code-logic-review-backend.md` REVISE 4/10 (5 blocking),
`code-logic-review-frontend.md` REVISE (1 blocking). Three codex lanes fix them, file-disjoint:
- **R1** Electron + store → `revise-1-r1-report.md`: #3 strip `savedPath` from list, #5
  `will-frame-navigate` subframe allowlist + e2e self-navigation assertion, #6 no-follow read,
  #7 Zod-parse metadata, #8/#10 `IO_ERROR`/`QUOTA` + single writer, #11 symlinks/.tmp sweep/
  fixture env only when unpackaged, #13 shell-csp spec, #14 audit comment.
- **R2** contract/tool/RPC/store → `revise-1-r2-report.md`: #1 workspace from caller session
  (`resolveSessionWorkspaceRoot`), #2 real tool input schema, #4 `artifacts:list {sessionId}`
  via registry + same bucket key in `artifact.store.ts`, #9 `isSafeExternalUrl`, #12, error codes.
- **R3** frontend → `revise-1-r3-report.md`: one viewer only for active key (`@if`), Escape
  inside dialog, visible Open/openLink failures, real full screen, card shell without record,
  theme var skipping + Retry.

STATUS AT HANDOFF: see the "Lane results" section at the end of this file.

## Open problems and decisions

1. **Task number clash:** `TASK_2026_708_bff3` (voice-canvas-life, merged PR #786) also uses
   708. Plan: `git mv .ptah/specs/TASK_2026_710_html .ptah/specs/TASK_2026_710_html`, update
   references in context.md / PR text, before the final commit. Check that 710 is still free on
   `origin/main` first. Old commit messages keep 708 (no history rewrite without user consent).
   The user was asked and has not answered — keep 708 if they say so.
2. **Lane limits:** `Glm` AT LIMIT (Ollama 429, reset unknown) — skip. `grok` had a weekly
   limit earlier (reset 17:40 UTC, now has room). `codex` has room.
3. **Cross-session check coordination:** other sessions run a "checks: busy/free" protocol.
   Last message: voice-canvas-life is free (PR #794); session **707** has the next slot, then
   coordinate with **662**. Last seen state: **notification-fixes** announced "Electron: busy" and
   "checks: busy" (an Electron build plus a visual run on port 9347); wait for its "Electron: free"
   and "checks: free". Before any heavy run (typecheck of many projects, build, e2e,
   push gate), send "checks: busy" to the peers and "checks: free" after. Use `ListAgents` to
   find them.
4. Card "Full screen" and the transcript card behaviour depend on R3's result.

## Next steps (exact)

1. Read the three `revise-1-r*-report.md` files; read each diff (`git diff`) and spot-check
   every defect against the review file:line. Fix the two "Known defects left after round 1"
   (display-sheet key, session fallback) — small edits you can make yourself, then run Jest on
   `display-sheet.component.spec.ts` with `--maxWorkers=2`.
2. Re-review (revise round 1 → review): spawn `grok` (code-logic-reviewer) once for backend
   (R1+R2) and once for frontend (R3), read-only, naming the original defect numbers. This is
   the last allowed round: if defects remain, make ONE bounded correction, get it reviewed, and
   otherwise report open defects to the user (do not reset the cap).
3. After "checks: free" from peers, run scoped verification, ONE at a time, `NX_NO_CLOUD=true`
   (Nx Cloud returns 401):
   ```
   npx nx run-many -t typecheck -p shared platform-core platform-electron vscode-lm-tools rpc-handlers chat-ui chat ptah-electron ptah-extension-webview ptah-extension-vscode ptah-cli cli-engine --parallel=1
   npx nx run-many -t test -p shared platform-core platform-electron vscode-lm-tools rpc-handlers chat-ui chat ptah-electron --parallel=1
   ```
   Confirm the header says "Running target ... for N projects" with N as requested. Check the
   real project names in each `project.json` first (e.g. `@ptah-extension/shared`). If the test
   run is too heavy, run Jest per changed spec with `--maxWorkers=2` instead.
4. Phase 0 gate again (user-permitted, one named spec):
   ```
   npx nx build-dev ptah-electron --parallel=1
   npx nx copy-renderer-dev ptah-electron --parallel=1
   cd apps/ptah-electron-e2e && npx playwright test --config=playwright.config.ts src/specs/artifacts/artifact-containment.spec.ts --workers=1 --reporter=line
   ```
5. Visual check in Electron (dark + light): publish a small dashboard via the agent, see the
   card, open the viewer, toggle theme, full screen, Escape. Use the visual-reviewer role or
   screenshots; show them to the user before merge.
6. Rename the task folder (open problem 1), commit in the foreground with a commitlint-valid
   message (scopes from `.commitlintrc.json`, subject ≤ 72, body lines ≤ 100), push in the
   background, retitle PR #789 (e.g. `feat(electron,chat,shared): sandboxed HTML artifacts`)
   and update its body + test plan.
7. Follow-ups to record (not in scope): private headless preview for agent self-check
   screenshots (t3code model); MCP Apps `ui://` hosting (TASK_2026_521 backlog).

## Related work from this session
- PR #791 `fix/ptah-cli-repeat-guard` (TASK_2026_709_rpg): ptah-cli tool-call segments now
  carry parsed input, so `LaneBudgetGuard` no longer stops lanes on different calls to one
  tool. Reviewed by Glm: APPROVED 9/10. Worktree `.claude-worktrees/ptah-cli-repeat-guard`.
- User setting: `~/.ptah/settings.json` → `agentOrchestration.laneRepeatCallStopAt: 200`
  (workaround). After PR #791 merges, the user can remove it.

## Lane results (revise round 1 — all three lanes ended, verdict `delivered`)

No lane is running at handoff. All changes are UNCOMMITTED in the worktree. The orchestrator
did NOT yet read the diffs of round 1 — only the lane reports. Verify before trusting.

| Lane | Session id (for `resume_session_id`) | Report | Lane-claimed result |
| --- | --- | --- | --- |
| R1 Electron + store | `01a15aa1-2b98-7c51-9634-dc9c3f6c6071` | `revise-1-r1-report.md` | #3 #5 #6 #7 #8 #10 #11 #13 #14 fixed. New `apps/ptah-electron/src/windows/artifact-frame-guard.ts` (+spec) for `will-frame-navigate`. e2e spec + fixture extended with iframe self-navigation (not run). Jest: store 10/10, frame guard 7/7, shell CSP 7/7. |
| R2 contract/tool/RPC/store | `01a15aa1-ab7d-7272-8a62-39698517c26e` | `revise-1-r2-report.md` | #1 #2 #4 #9 #12 + `QUOTA`/`IO_ERROR` mapping. `artifacts:list { sessionId }` via registry; store buckets by **tab id** and has `lastError`. Jest: shared 7/7, vscode-lm-tools 5/5, rpc-handlers 10/10, chat 4/4. |
| R3 frontend | `01a15aa1-ccb8-70f3-84d1-f801acd40242` | `revise-1-r3-report.md` | single live iframe (`@if`), Escape capture, visible errors, real full screen, missing-row card, theme var filtering + Retry. Jest: chat-ui 41/41, chat 47/47. |

No typecheck ran in round 1 (peers held heavy checks; `ptah_get_diagnostics` timed out).

### Known defects left after round 1 (fix first)
1. **Cross-lane key mismatch (R2 report):** `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts:125-129`
   still reads artifact records by `tab.claudeSessionId`, but the store now buckets by the
   **tab id**. Change it to `this.artifactStore.records()[this.tabId()]` (check the store API)
   so the sheet shows artifacts. Also check `tool-call-item.component.ts` uses the same key.
2. **Session fallback (R2 report):** the MCP dispatcher's session-aware
   `workspace.getInfo()` resolver can fall back to another workspace for an unknown session
   id. Decide: unknown session → tool error (preferred). No transport integration spec exists.
3. The e2e self-navigation assertion (#5) is written but unproven until the Phase 0 run.

These count as part of revise round 1. The re-review in next step 2 is the last round.
