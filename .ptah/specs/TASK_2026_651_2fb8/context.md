# TASK_2026_651_2fb8 — context

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: Run each wizard analysis phase as a normal, visible chat session/tab (workflow-tagged tile) that survives turns; the manifest/freshness side is done.
- Evidence on main: Manifest part delivered by PR #732: main:libs/backend/agent-generation/src/lib/types/multi-phase.types.ts has MultiPhaseManifestV4 with per-phase attempt, sessionId, verification status and workspaceFingerprint (27bf6b468, 54f4932c0); AnalysisFreshnessService + wizard:analysis-status exist. No tab/chat-tile wiring for analysis phases: git grep tabId in agent-generation/src/lib/services/wizard = 0 hits (PR #763 only moved agent and guidance generation into chat tabs).

## Triage 2026-10-30 (premise audit)

Verdict: PARTIAL (lane grok, verified by Claude).

- Delivered: manifest v4 and freshness (#732, 4eef18165); agent and guidance generation moved into chat tabs (#763) but analysis phases did not.
- Analysis phases still register as non-tab surfaces: `main:libs/frontend/chat-routing/src/lib/stream-router.service.ts:225-235` ("non-tab surface (wizard analysis phase, harness operation)").
