---
status: in_review
type: bugfix
title: Harness builder — proposeConfig rejects record fields sent as lists
description: >-
  The AI Team Builder failed four times in one session on
  `ptah_harness_propose_config`, each time on a `Record` field the authoring
  agent sent as an array, and the run that finally parsed had silently lost its
  enabled agents. Accept the list shape where entries carry their own key, teach
  the wanted shape in the error, and state the shapes on every surface that
  describes the tool.
---

# Harness proposeConfig record-field contract

Measured from the Electron log for the `website-manager` workspace, 2026-09-21
14:34–14:35. Three of six `ptah_harness_propose_config` calls were rejected:

| Time | Field | Message |
| --- | --- | --- |
| 14:34:12 | `mcp.enabledTools` | expected record, received array |
| 14:34:45 | `agents.enabledAgents` | expected record, received array |
| 14:35:18 | `prompt.enhancedSections`, `claudeMd.customSections` | expected record, received array |

The agents update was never re-sent in a valid shape. The panel read
`0 agent(s) enabled` for a persona the user had approved.

See `context.md` for the narrative and the lane deliverables for the audit and
review findings.
