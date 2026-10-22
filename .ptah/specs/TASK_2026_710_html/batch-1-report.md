# Batch 1 report — TASK_2026_710_html

## Files changed

- `apps/ptah-electron/src/artifacts/artifact-protocol.ts` — privileged scheme, strict opaque-id handler, response headers and CSP, resolver interface.
- `apps/ptah-electron/src/artifacts/artifact-protocol.spec.ts` — exact policy/header and invalid/unknown URL coverage.
- `apps/ptah-electron/src/main.ts` — scheme before ready; handler before first window; guarded fixture resolver.
- `apps/ptah-electron/scripts/copy-renderer.js` — shell `frame-src ptah-artifact:` exception.
- `apps/ptah-electron-e2e/src/specs/artifacts/artifact-containment.spec.ts` — real Electron iframe containment assertions.
- `apps/ptah-electron-e2e/src/specs/artifacts/fixtures/containment.html` — unchanged copy of the 497 network-exfiltration fixture.
- `.ptah/specs/TASK_2026_710_html/batch-1-report.md` — this report.

## Test seam

`launchPtah` sets `PTAH_E2E=1`. The spec adds `PTAH_E2E_ARTIFACT_FIXTURE_DIR`, and only when both are present does the main-process resolver read `<validated-id>.html` from that directory. The spec requests `ptah-artifact://containment/index.html`. In normal launches the resolver returns null until Batch 3 connects the persistent store. The URL path is never passed to the resolver or used as a filesystem path.

## Verification

- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/artifacts/artifact-protocol.spec.ts --coverage=false --maxWorkers=2` — 1 suite passed; 11 tests passed.
- `npx nx typecheck ptah-electron --parallel=1` — Nx reported target failure and Nx Cloud HTTP 401 (organization free-plan limit). The underlying `npx tsc --noEmit --project apps/ptah-electron/tsconfig.app.json --pretty false` exited 0 with no diagnostics.
- Scoped `ptah_get_diagnostics` did not finish within its 45-second window; it reported files unchecked.
- Playwright containment spec was not run as instructed. After review, run exactly: `npx nx run ptah-electron-e2e:e2e --parallel=1 -- artifacts/artifact-containment.spec.ts`.

## Decisions

- **Fixture seam:** use the existing `PTAH_E2E=1` launch flag plus an explicit fixture directory. Alternatives were an IPC test hook or a hard-coded fixture path. The launcher already sets the flag, and the directory is supplied only by the named spec. Reversible.
- **Pre-store behavior:** return an undetailed 404 in normal launches. The persistent store belongs to Batch 3 and is not available in this batch. Reversible when its resolver is connected.
- **Traversal-like path tests:** use encoded slash in the path and encoded dot host cases. The standard WHATWG `Request` parser normalizes a path segment `%2e%2e` before the handler sees it; the resolver accepts only the validated host id. Reversible.

## Remaining work and limits

- The orchestrator must run the named Playwright spec and the packaged-Electron manual check. No e2e/build/serve/package target ran here.
- Batch 3 must connect the production resolver to the artifact store. Until then production ids return 404.
- The existing main-window popup guard delegates denied popup URLs to `openExternalSafely`; the current spec asserts `window.open()` returns null and the main URL stays fixed, but does not prove that no OS external browser was launched. This behavior is outside this batch's assigned files and needs review before the Phase 0 gate is accepted.
