# TASK_2026_604 — oversized settings files and spec codes in comments

## Why

From `TASK_2026_555/final-code-style-review.md` (CS-3 to CS-7). The project's soft file cap is 700 lines; past 1000
needs a deliberate look. Line counts at the merge of PR #631:

| File | Lines | Note |
| --- | --- | --- |
| `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` | ~729 | already split once (1200 → 727) |
| `libs/backend/platform-core/src/file-settings-manager.ts` | ~761 | crossed the cap in TASK_2026_555 |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts` | ~1010 | test data table |
| `apps/ptah-extension-webview/src/styles.css` | ~2260 | global stylesheet |

Close to the cap (watch, do not split for its own sake): `cli-orchestration-matrix.component.ts`,
`elevenlabs-panel.component.ts`, `web-search-config.component.ts`, `provider-model-picker.component.ts` (exactly 700).

CS-7: doc comments in Settings cite internal spec codes (A10, A26, D15, P8, M8, "Item 16"); a reader cannot resolve
them. Highest counts: `cli-orchestration-matrix.component.ts`, `output-style-list.component.ts`,
`system-prompt-drawer.component.ts`, `mcp-port-config.component.ts`, `agent-behaviour-section.component.ts`.

## Scope

- Apply the facade rule (public class keeps its name, DI token and signatures; the extracted concern is an injected,
  nameable collaborator). No `helpers`/`utils` names, no ~150-line fragments.
- Split the reachability table by tab behind the same export.
- styles.css: move Settings-only rules into the Settings layer or component styles only where it is safe; do not
  change computed styles.
- Replace spec codes with the behaviour sentence; keep a code only where it links to a living document.

## Acceptance criteria

1. Each listed file is under 700 lines, or recorded as an accepted exception with a reason.
2. No behaviour change: typecheck, lint, tests green; the Settings Playwright folder green; captures show no pixel
   change.

## Out of scope

New features; the files outside Settings.
