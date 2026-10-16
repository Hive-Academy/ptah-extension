# TASK_2026_685 — visual proof (pointer)

The session contract named this nested path. The deliverable is at the task-folder path that the
task brief names:

- [`../../../../visual-proof.md`](../../../../visual-proof.md)
  (`.ptah/specs/TASK_2026_685_64f4/visual-proof.md`)
- Prototype: `.ptah/specs/TASK_2026_685_64f4/prototype/index.html`
- Screenshots: `.ptah/specs/TASK_2026_685_64f4/screenshots/`

Summary:

- Real-app Electron screenshots: the parent's visual-reviewer captures them later (parent
  decision). The shot list is in the "## Screenshots" section of the main file.
- "71h 18m" is a confirmed bug. A restored CLI lane has no `completedAt`
  (`CliSessionReference` does not store it), so the lane card and the inspector show the lane's
  age (`now - startedAt`). The tab chip and the hover card show no duration.
- The prototype shows one disclosure row for both lane kinds, details behind it, one action place.
