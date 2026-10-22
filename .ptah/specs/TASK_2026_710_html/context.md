# Context

## User Request (2026-10-20)

The fixed agent-UI schema (ptah-ui fences, `ptah_surface_update` catalog, declarative
dashboard) limits the agent's creativity. A free `index.html` dashboard from the agent looks far
better than the same request through the schema. Research how Claude Code mods, t3code and
others solve this, and check the earlier Ptah tasks on the same idea.

## Research artifacts

- `external-research.md` — Claude Code mods, t3code visual replies, Claude artifacts, Canvas,
  MCP Apps (codex lane).
- `current-pipeline-inventory.md` — every agent-output-to-UI path in Ptah today, Electron
  security posture, plug-in points (Glm lane).
- `prior-tasks-synthesis.md` — decisions, proofs and open items from TASK_2026_298, 490-499,
  520-522, 538, 610, 623 (Glm lane).

## Findings the orchestrator verified

- Claude Code mods render a host component tree and run unsandboxed; they are not a free-HTML
  model.
- t3code "visual replies" (`docs/user/html-renders.md`) render agent HTML in an iframe with
  `sandbox="allow-scripts allow-forms"` and no `allow-same-origin`
  (`apps/web/src/components/files/BrowserDocumentFrame.tsx`).
- Electron shell CSP has `frame-src 'none'` (`apps/ptah-electron/scripts/copy-renderer.js:170`).
- TASK_2026_497 containment spike was prepared (fixtures, 7 controls) but never run.

## User decision (2026-10-20)

Agent HTML artifacts may run **scripts with no network**: opaque-origin sandboxed iframe, CSP
blocks all network, bridge limited to theme in and height/link out. This replaces the standing
rule "no agent scripts ever" (TASK_2026_490/493/494, quoted in TASK_2026_610 context.md:130)
for the new artifact surface only. `ptah-ui` blocks stay for small inline summaries.

## Orchestrator decisions during build

- Revision policy (review finding #12): every publish creates a new artifact id at revision 1.
  `savedPath` is never returned to the model or the webview. This replaces the "replacing a
  named artifact creates a new revision" line of acceptance criterion 2.
- `artifacts:list` carries `{ sessionId }`, resolved through the session registry (review
  finding #4, planned as Batch 6b). Not user-reserved: it is a correctness fix.

## Lane limits (this run)

- `grok` (family grok): usage limit, HTTP 402 "Grok Build usage balance exhausted" at
  2026-10-20T17:14Z. `ptah_agent_list` then showed AT LIMIT, Weekly 100%, reset
  2026-10-20 17:40 UTC. Skip until that reset. Batch 2 moved to `codex`.
- `Glm` (ptah-cli, provider Ollama Cloud): HTTP 429 "reached your session usage limit" at
  about 2026-10-20T18:25Z during Batch 11, reset unknown. Skip for the rest of this run.
  Batch 11 continues on `codex` from the partial edits.

## Proposed next phase

Phase 0: run the TASK_2026_497 containment spike with the new policy. Then specify the artifact
surface (display panel first, full screen, agent self-check screenshots via CDP).

## Revise round 2 (final) — 2026-10-20

- Orchestrator fixes after round 1: the display sheet reads artifact rows by tab id;
  `ptah_artifact_publish` takes the workspace only from the caller session's registered
  `projectPath` (`getSessionWorkspace`, no active-session or folder fallback; unknown session
  is a tool error); `artifacts:list` params typed as `ArtifactListRequest`; tool description
  cut to the 420-character budget; four chat specs given an `ArtifactStore` stub (codex lane,
  `spec-fix-report.md`).
- Re-reviews (grok, family grok; implementers codex): backend APPROVED 8/10
  (`code-logic-review-backend-r2.md`), frontend APPROVED 7/10
  (`code-logic-review-frontend-r2.md`). Revise cap reached.

## Follow-ups (non-blocking, not in this PR)

1. A child frame may navigate to another artifact id, not only its own
   (`artifact-frame-guard.ts`); restrict to the frame's current id.
2. Store `list` caps at 200 rows with no truncation signal.
3. Missing session workspace is reported as a bad HTML path (`electron-artifact-store.ts`).
4. `ArtifactStore.lastError` and the sheet `linkError` are not per tab.
5. Card "Full screen" leaves the sheet in `full` height after the viewer closes.
6. Private headless preview for agent self-check screenshots (t3code model); MCP Apps `ui://`
   hosting (TASK_2026_521 backlog).

## Task number

Renamed from `TASK_2026_708_html` to `TASK_2026_710_html` on 2026-10-20 because
`TASK_2026_708_bff3` (PR #786) already uses 708. Earlier commit messages on this branch keep 708.
