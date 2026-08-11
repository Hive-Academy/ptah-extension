---
id: TASK_2026_229
status: in_review
type: DEVOPS
title: >-
  copy-renderer builds the webview in production while build-dev builds it in
  development, into the same output directory, with no ordering guarantee
description: >-
  copy-renderer's `dependsOn: ["ptah-extension-webview:build"]` pins no
  configuration, so it resolves to the target's defaultConfiguration
  (production), while build-dev builds the same project explicitly with
  --configuration=development. Both write dist/apps/ptah-extension-webview/
  browser/. In apps/ptah-electron-e2e/project.json the e2e, showcase and
  e2e:nightly targets list build-dev and copy-renderer as sibling dependsOn
  entries with no ordering between them and no shared task ID to force
  synchronization, so which configuration's bundle survives into the Electron
  renderer is a race. The `package` path is accidentally safe -- there `build`
  and `copy-renderer` resolve to the same production task ID and get
  deduplicated. Found while fixing TASK_2026_226; reported rather than folded
  in, because a correct fix needs a caller-aware redesign across four call
  sites with genuinely conflicting configuration needs. This is also the
  leading unexplained candidate for the TASK_2026_222 staleness, which
  TASK_2026_226 turned out not to account for.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
