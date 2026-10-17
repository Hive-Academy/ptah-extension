---
id: TASK_2026_678_9083
status: done
type: FEATURE
title: Voice Command Center page with Ptah head-of-engineering orchestrator
description: >-
  New canvas page where the user talks by voice (ElevenLabs) to Ptah, the head of
  engineering orchestrator, which delegates work to CLI agent lanes, sessions and the
  tribunal workflow, with every agent drawn live on an HTML canvas.
depends_on: []
created: 2026-10-15T10:00:00.000Z
updated: 2026-10-15T10:00:00.000Z
---

## Description

Build a Command Center page. The user holds a near-realtime voice conversation (ElevenLabs
voice mode) with the main orchestrator, drawn on an HTML canvas as "Ptah, head of
engineering". Ptah uses the Ptah tools, MCP servers, CLI agents and agent sessions to assign
work, and every delegated agent and its progress is drawn on the canvas. The page focuses on
voice command and status updates, not on session detail. It handles CLI tools and the
tribunal-defined workflow only. A reference ElevenLabs implementation exists in
D:/projects/property-hub.
