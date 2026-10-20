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

## Lane limits (this run)

- `grok` (family grok): usage limit, HTTP 402 "Grok Build usage balance exhausted" at
  2026-10-20T17:14Z. `ptah_agent_list` then showed AT LIMIT, Weekly 100%, reset
  2026-10-20 17:40 UTC. Skip until that reset. Batch 2 moved to `codex`.

## Proposed next phase

Phase 0: run the TASK_2026_497 containment spike with the new policy. Then specify the artifact
surface (display panel first, full screen, agent self-check screenshots via CDP).
