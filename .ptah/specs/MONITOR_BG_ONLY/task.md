---
id: MONITOR_BG_ONLY
status: done
type: BUGFIX
title: >-
  List only background subagents in the agent monitor
depends_on: []
created: '2026-10-04T16:17:11.000Z'
updated: '2026-10-04T17:18:00.000Z'
description: >-
  The agent monitor panel listed every subagent, including foreground ones. Key the monitor on the background agent store so only background subagents appear, with correct lifecycle and counts. Shipped in PR #641 (merge 525f0ab87).
labels:
  - chat-streaming
  - agent-monitor
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The agent monitor panel listed every subagent, including foreground ones. Key the monitor on the background agent store so only background subagents appear, with correct lifecycle and counts. Shipped in PR #641 (merge 525f0ab87).
