---
id: TASK_2026_258
status: done
type: documentation
title: 'Plugins docs: correct a section that documents a UI which does not exist'
description: >-
  The Plugins section of docs.ptah.live describes an Installed tab, Update badges, an
  uninstall menu, version rollback from a `.versions/` directory, five `Ptah:` palette
  commands and a `plugins.autoUpdate` setting. None of it ships. Three pages give three
  contradictory and all-wrong answers for where enabled-plugin state lives, and one tells
  users to commit a file that does not exist. The runtime-download story — the part that
  looked most at risk — is the only accurate part.
---

# Plugins docs: correct a section that documents a UI which does not exist

Surfaced by a coverage audit run during TASK_2026_239. Ranked above the (larger, wholly
absent) Tasks-board gap because a missing page teaches nothing, while these pages walk a
user through controls that are not there and produce bug reports.

Findings and citations in `context.md`.
