---
id: TASK_2026_259
status: done
type: bugfix
title: 'pruneStaleFiles deletes user-authored harness skills from ~/.ptah/plugins'
description: >-
  `ContentDownloadService.pruneStaleFiles` is called with the whole `~/.ptah/plugins` root
  and unlinks every file not listed in the remote content manifest. The harness wizard
  writes user-authored skills to `~/.ptah/plugins/ptah-harness-{slug}/skills/{slug}/SKILL.md`,
  inside that sweep, and those files can never appear in the manifest. Any change to the
  manifest `contentHash` should therefore delete every skill the user has authored. No test
  covers it.
---

# pruneStaleFiles deletes user-authored harness skills from ~/.ptah/plugins

Found while correcting the Plugins docs (TASK_2026_258). The writer documented the pruning
rule honestly and added a caution rather than asserting the deletion, because it had not
been run. The orchestrator then confirmed the code path by reading it. **Nobody has
reproduced it against a real profile yet** — step 1 is to do that before fixing anything.

Analysis in `context.md`.
