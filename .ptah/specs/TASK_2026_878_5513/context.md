# Task Context - TASK_2026_878_5513

## User Request
i went to our memory and skills tab first i tried to run the spec curator on skills tab , nothing happens, and i still not 100% sure how that works and how our learning is working !?   codebase indexing i clicked on re-index same nothing happens ? for memory curation as well tried to run it and nothing happens so after all of the work we have been doing on that part i don't know how to evaluate, enhance or test these integratoins and it feels like they are blackboxes ?

## Task Type
BUGFIX (ptah_route_decide pre-flight: model, confidence 0.885). Secondary goal: observability.

## Complexity
Complex

## Strategy
BUGFIX, Full depth (route depth null / low-confidence -> skill table: unclear scope).
Flow: research (3 parallel investigators: skill specs harvest, code re-index, memory curator
run-now; plus a learning-pipeline explainer) -> team-leader Mode 1 -> batches -> QA.

## CLI Lanes
Gate 0.1: no stored preference found (memory search returned none). Spawnable lanes with room:
codex (Weekly 59%), grok (Weekly 84%). Mode: enabled. Approval: lane-review.
Copilot and claude disabled; kimi at limit; Ollama near limit; antigravity limits unknown.

## Conversation Summary
- UI entry points: skill-specs-control.component.ts (Harvest now), memory-curator-tab.component.ts
  (onIndexNow / onRebuildIndex), memory-diagnostics-accordion.component.ts (Run curator now).
