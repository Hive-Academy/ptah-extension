# TASK_2026_280 — Harness UI surfaces

Follow-up to TASK_2026_278. Frontend-led; the backend contracts already exist.

## What exists today

- `harness:health` → `{ health, summary, cached }`, `harness:reconcile`, `harness:remove`, push `harness:healthChanged` (`libs/shared/src/lib/types/harness-sync.types.ts`, reducer `summarizeHarnessHealth`).
- `HarnessHealthStore` + badge + per-target row in `libs/frontend/marketplace/src/lib/harness/`, registered as a `MESSAGE_HANDLERS` provider in the webview app config.
- `ptah harness doctor --human` prints missing / foreign / adopted / removed **paths** (20 per group, then `+N more`).
- `skillSynthesis:listClones` returns `orphaned?: boolean` per clone (TASK_2026_278 Batch 1b); nothing consumes it.

## Scope

1. **Settings controls** for `harness.manageGitignore` (bool, default true) and `harness.preflightTimeoutMs` (number, default 1500). Both are read via `getConfiguration('ptah', 'harness.<key>')` and declared in `FILE_BASED_SETTINGS_KEYS`. Mirror how the skill-synthesis settings surface is built (schema + panel section); decide whether they belong in the existing Harness/Marketplace settings area or a new "Harness sync" section.
2. **Orphaned clones**: in the Library / skill-clone UI, an `orphaned` clone must not offer Rebase (there is no upstream to rebase onto). Show the state and offer Keep or Delete instead. Backend already populates the field per request from the sidecar.
3. **Path lists in the badge panel**: the panel shows counts; add the same grouped path lists the CLI prints (missing / foreign / adopted), truncated with a "+N more", plus the one-line remedy for a foreign entry ("this file is not Ptah's — move or delete it, then Reconcile"). Distinguish `unsupported` facets (grey, informational) from `missing` (red) as the badge already does.

## Notes

- `sources-missing` is classified `degraded` (amber) by the shared reducer, not `error`; red is reserved for `writeFailed`. Keep the presentation aligned with the reducer — do not re-derive severity in the UI.
- Angular rules apply: OnPush, signals + `inject()`, no `[innerHTML]`, `libs/frontend` must not import `libs/backend`.

## Acceptance

- Both settings are editable in the UI and round-trip to `~/.ptah/settings.json`.
- An orphaned clone cannot be sent to Rebase from any surface.
- Badge panel lists paths; specs cover severity derivation, orphaned gating, and truncation.
