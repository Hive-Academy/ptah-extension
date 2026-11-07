---
id: TASK_2026_604_e720
status: backlog
type: REFACTORING
title: Bring the oversized settings files under 700 lines and drop spec codes from comments
depends_on: []
created: "2026-10-03T12:10:06.444Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Seven files that Settings uses are past the 700-line cap (up to 4084 lines for styles.css), and
  Settings comments cite internal spec codes (A10, D15, M8) that a reader cannot resolve.
executor: frontend-developer
estimate: M
labels:
  - settings
  - tech-debt
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The soft file cap is 700 lines. These files are past it (line counts on 2026-11-07):

| File | Lines |
| --- | --- |
| `apps/ptah-extension-webview/src/styles.css` | 4084 |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts` | 1825 |
| `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts` | 1320 |
| `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` | 1056 |
| `libs/backend/platform-core/src/file-settings-manager.ts` | 836 |
| `libs/frontend/chat/src/lib/settings/ptah-ai/elevenlabs-panel.component.ts` | 810 |
| `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts` | 798 |

- Apply the facade rule: the public class keeps its name, DI token and signatures; the extracted
  concern is an injected, nameable collaborator. No `helpers`/`utils` names, no ~150-line fragments.
- Split the reachability table by tab behind the same export.
- `styles.css`: move Settings-only rules into the Settings layer or component styles only where it
  is safe. Do not change computed styles.
- Replace internal spec codes in Settings doc comments (A10, A26, D15, P8, M8, "Item 16") with the
  behaviour sentence. Keep a code only where it links to a living document.

Acceptance: each listed file is under 700 lines or is recorded as an accepted exception with a
reason; no behaviour change (Settings Playwright folder green, no pixel change in Electron
captures).

## Current state (2026-11-07)

- Not started, and the files grew since PR #631: for example `styles.css` 2260 to 4084 and
  `settings-reachability.table.ts` 1010 to 1825 lines.
- `cli-orchestration-matrix.component.ts`, `elevenlabs-panel.component.ts` and
  `provider-model-picker.component.ts` were "close to the cap" and are now past it.
  `web-search-config.component.ts` is 643 lines (under the cap).
- The source review (`TASK_2026_555/final-code-style-review.md`) is in git history only:
  `git show ff531866f:.ptah/specs/TASK_2026_555/final-code-style-review.md`.

Full context, plan and discussion live in [./context.md](./context.md).
