---
status: in-progress
type: devops
title: >-
  Restore Windows Electron packaging after the dependency migration
description: >-
  Keep electron-builder current while preventing Windows Search from locking
  its freshly extracted Electron directory before electron-builder renames it.
---

# Restore Windows Electron packaging

## Acceptance criteria

1. The Electron builder version used by fresh installs is deterministic and is
   the newest stable v26 release.
2. The manifest and lockfile cannot silently drift to npm's stale latest tag.
3. The local-production packaging test passes.
4. A complete unsigned local-production installer builds and passes all packed
   runtime verification gates.
5. The user's pre-existing TypeSafe skill edits are restored after packaging.
