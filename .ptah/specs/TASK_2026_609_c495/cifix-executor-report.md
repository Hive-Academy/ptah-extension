# CI-FIX executor report — degradation-audit ratchet (PR #635)

Commit: `dc5bc09f3` chore(degradation-audit): log or annotate the new swallowed-failure sites (not pushed)

## New vs pre-existing

I used `git blame origin/main..HEAD` on each flagged line to tell new sites from old ones. New sites: 7. That matches the overage exactly: agent-generation +3, harness-sync +1, setup-wizard +1, skill-synthesis-ui +2. I did not touch the other 13 flagged sites, because they come from `^f314a4f8a` (main).

The audit only accepts `throw` or a `.error(...)` call. A `logger.warn` that is already there does not satisfy it. Raising a warn to error would change behaviour, so each site gets a suppression comment as the first line inside the catch body. That is the repository's existing placement (zone 2, e.g. `workspace.service.ts:978`).

## Sites handled (line numbers before the edit)

| Site | Handling |
|---|---|
| `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:1094` | `optional-capability` — model overrides are optional. The existing warn logs the failure and each agent falls back to its template model. |
| `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts:519` | `reported` — `'failed'` goes into `result.failed`. That withholds the pass marker so the slug is retried, and `user-layer-mirror.service.ts:378` adds it to the mirror result's `errors`. |
| `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts:1066` | `reported` — EEXIST is the expected `'exists'` outcome. Any other failure is returned as `{ copyFailed }`, and the callers (lines 633 and 919) turn it into a failure or a reason. |
| `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:283` | `optional-capability` — per-agent model overrides are optional. This class has no logger. |
| `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts:1061` | `reported` — the failure is shown via `previewError`. The early return only drops a reply that a newer request superseded. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-model-editor.component.ts:718` | `reported` — the editor shows the `'save-failed'` phase with the message, unless the save was superseded. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/clones/quarantined-agents-panel.component.ts:365` | `reported` — the panel shows the failure via `loadError`. The early return only drops a superseded reply. |

The run printed no bare or orphaned suppression violations, so the existing comments are in a valid form. I did not edit `baseline.json`.

## Checks

- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0:
  - `libs/backend/agent-generation: 1 ok (baseline 1)`
  - `libs/backend/harness-sync: 6 ok (baseline 6)`
  - `libs/frontend/setup-wizard: 1 ok (baseline 1)`
  - `libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)`
  - `TOTAL 293 unsuppressed site(s)`
- `npx nx run-many -t typecheck,lint -p (the 4 projects) --parallel=2`: "Successfully ran targets typecheck, lint for 4 projects" (8 tasks). The Nx Cloud 401 notice is unrelated.
- Tests: not run. The changes are comments only and add no log calls, so the condition for running tests does not apply.
- Commit hooks ran and passed; the commit was made without skipping them.
