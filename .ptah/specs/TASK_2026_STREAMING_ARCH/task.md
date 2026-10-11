---
id: TASK_2026_STREAMING_ARCH
status: done
type: REFACTORING
title: >-
  Streaming architecture: host delivery coordinator, tiered webview scheduler, per-message records and zoneless change detection
depends_on: []
created: '2026-10-07T22:57:21.000Z'
updated: '2026-10-09T16:37:51.000Z'
description: >-
  Six-phase streaming redesign to fix a 2 s interaction delay dominated by zone-driven ticking: host stream-delivery coordinator, three-tier webview flush scheduler, per-message presentation records, incremental Markdown with scroll coalescing, composer responsiveness, and zoneless webview change detection. All six phases merged via PRs #674, #676, #678, #680, #681 and #684.
labels:
  - chat
  - streaming
  - performance
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Six-phase streaming redesign to fix a 2 s interaction delay dominated by zone-driven ticking: host stream-delivery coordinator, three-tier webview flush scheduler, per-message presentation records, incremental Markdown with scroll coalescing, composer responsiveness, and zoneless webview change detection. All six phases merged via PRs #674, #676, #678, #680, #681 and #684.
