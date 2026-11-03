---
id: TASK_2026_709_rpg
status: done
type: BUGFIX
title: "Send ptah-cli streamed tool calls with their parsed input"
depends_on: []
created: "2026-10-20T17:19:40.000Z"
updated: "2026-10-30T01:09:07.477Z"
description: "Emit each streamed ptah-cli tool call after its input JSON completes, with call ID and full input, so the lane repeat guard sees real tool inputs and calls are not duplicated."
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Emit each streamed ptah-cli tool call after its input JSON completes, with call ID and full input, so the lane repeat guard sees real tool inputs and calls are not duplicated.


