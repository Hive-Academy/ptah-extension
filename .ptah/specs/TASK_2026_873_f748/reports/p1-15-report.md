# P1-15 — Review drawers and findings

## Files
- Added `libs/frontend/review-runs-ui/src/lib/components/review-run-detail.component.ts` and focused spec.
- Added `libs/frontend/review-runs-ui/src/lib/components/review-settings-drawer.component.ts` and focused spec.
- Added `libs/frontend/review-runs-ui/src/lib/components/review-findings-table.component.ts` and focused spec.
- Updated `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts`, `components/review-runs-page.component.ts`, and `src/index.ts`.

## Component APIs
- Run detail: required `run`, optional `findings` and `loadState`; emits `close` and `retry`. Shows stages, durations, coverage, lens/verifier family, same-family weaker-evidence label, findings, and unavailable walkthrough/artifacts. Raw stage errors and artifact paths are withheld.
- Settings drawer: optional `repository`, `settings`, `minimumSeverity` (default Minor), `loadState`; emits `close` and `retry`. Shows dry-run context, read-only maintainer allowlist and thresholds; no publication controls.
- Findings table: required `rows: ReviewFindingRow[]`; filters status/lens and sorts severity, lens, location, status and confidence. Suppressed reason is visible.
- Both drawers close on Escape, wrap Tab focus, and return focus to opener.

## Store additions and RPC for P1-16
- Added selected run/detail and settings state, `loadRun` through `review:getRun`, and `loadSettings` through `review:getSettings`. Existing list calls remain. All responses are parsed by the review contract schemas and errors become safe generic UI states.
- P1-16 must register `review:getRun` and `review:getSettings` in the shared RPC method union/handler/allowlist and supply verified findings through an extended run-detail contract.

## Contract gaps
- `ReviewRun` lacks persisted findings, per-lane coverage and unavailable checks, walkthrough preview, artifact metadata, PR title/URL, published review URL, and posted/suppressed counts. `RepositorySettings` lacks effective repository config and exact config validation error. Bot credential status is absent. The UI says unavailable instead of fabricating data. Finding rows are a presentation shape awaiting a validated RPC source.
- Current run stages have one family per stage; same-family comparison uses the `lenses` and `verification` stage family when both exist. Per-lens/verifier pairing needs contract data in P1-16.

## Prototype parity
- Inspected approved static prototype at 900px with Ptah browser. Preserved surface/badge/table/drawer structure and timeline. Prototype publication switches and token controls are omitted under P1 dry-run scope. Minor default follows D16 rather than prototype's Major sample. Electron dark/light rendered comparison remains pending under D22/D33 after P1-16 route integration.

## Verification
- Focused Jest specs added for partial/weak evidence, Minor/no publication controls, sort/filter/suppression reason, and Escape. D26 prohibits Nx execution here, so specs were not run. Scoped Ptah diagnostics initially found ElementRef typing errors, which were fixed; the follow-up compiler check has not yet returned a completed result.

## Decisions
- Use the existing list-selected run as an immediate detail shell, then refresh it with `review:getRun`; reversible. Evidence: P1-14 list already selects attempt IDs and `review:getRun` is defined.
- Keep settings read-only for P1; reversible. Evidence: P1 dry-run N3 and no effective repo config mutation contract.
- Hide raw stage errors and local artifact paths; reversible when safe structured fields exist. Evidence: stage schema exposes raw strings/paths and the task prohibits secrets/logs.

## Open issues
- P1-16 contract extension and Electron screenshots are required for full visual/data acceptance.
- Orchestrator must run `npm run verify -- -p review-runs-ui` and relay failures.
- Skill loader is unavailable in this host, so `angular-frontend-patterns` could not be loaded.

## Fix round 1
- Renamed both drawer outputs from `close` to `closed` and updated the page bindings and Escape specs, resolving Angular's reserved native-output lint rule.
- Made both backdrops non-interactive; each drawer retains its visible Close button, Escape handling, focus trap, and focus restoration. This resolves the backdrop click keyboard/focus lint errors without rule suppressions.
- The orchestrator's prior `npm run verify -- -p review-runs-ui` passed test and typecheck but reported six lint errors addressed here. D26 prohibits running Nx/npm verification in this lane; the orchestrator must rerun verify.
- Scoped Ptah diagnostics after the fix: no diagnostics in the five changed component/spec files; five pre-existing BigInt target errors appear in unrelated shared siblings.
