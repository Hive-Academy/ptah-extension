---
id: TASK_2026_340
status: done
type: BUGFIX
title: >-
  Stop editor:getFileTree walking 10738 directories on every workspace load
priority: high
description: >-
  On a large monorepo the file-tree RPC reads 10738 directories and returns a
  10.91 MB payload before the explorer can paint. Measured on
  D:\projects\ptah-extension: depth 6 costs 3945 ms cold and never answered
  inside 65 s while the post-window boot was competing for disk I/O. The
  renderer already lazy-loads at the depth boundary through
  editor:getDirectoryChildren, so the eager depth is pure waste.
executor: backend-developer
estimate: S
labels:
  - performance
  - electron
  - editor
relates_to:
  - TASK_2026_331
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->
