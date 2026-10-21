## Root cause

The Electron test's RPC map omitted `agent:getConfig` (`apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:57-82`). The orchestration state copies `config.detectedClis`, `disabledClis`, and `preferredAgentOrder` from that response (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:758-780`). The CLI matrix iterates those arrays (`libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts:298-301`). The missing response left `detectedClis` undefined and Angular change detection threw `TypeError: orchestration.detectedClis is not iterable` on each click. This prevented the Enhancement editor from rendering.

The first local trace's error context showed the loaded Enhancement row and its button, but no editor after repeated successful clicks. A temporary page-console/state probe showed that Angular error and `aria-expanded=false`, editor count `0` immediately and 100 ms after a click. This establishes an incomplete Electron test mock, not a popover defect or a timing race. The webview harness supplies `agent:getConfig` (`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts:137-194,705`). The temporary probe was removed.

## Fix

- `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts`: Supply the array fields and basic scalar values required by the `agent:getConfig` orchestration consumer; replace the blind retry with one click and a visible-editor assertion.
- `.ptah/specs/TASK_2026_662_3eea/reports/ci-788-e2e-fix-3-report.md`: Record the local diagnosis and verification.

## Local runs

- `NX_NO_CLOUD=true npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron --parallel=1` — `NX Successfully ran targets build-dev, copy-renderer-dev for project ptah-electron`.
- `npx playwright test --config=playwright.config.ts src/specs/thoth/skills.spec.ts --grep "Enhancement model picker shows its saved provider and model" --reporter=list --workers=1 --trace=on` before the fix — `1 failed`; editor element not found after 10 seconds of retries.
- Same single-test command after the fix, run 1 — `1 passed (13.4s)`.
- Same single-test command after the fix, run 2 — `1 passed (16.0s)`.

## Checks

- `NX_NO_CLOUD=true npx nx run-many -t typecheck lint -p ptah-electron-e2e --parallel=1` — `NX Successfully ran targets typecheck, lint for project ptah-electron-e2e`.
- `git diff --check -- apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts` — passed.
- Checked for Electron processes whose command line contained this worktree; none remained.

## Decisions

The failure came from this test's incomplete mock. No product code changed, so a renderer rebuild and chat checks were unnecessary. Only the named Playwright test was run, using `--grep` to exclude the other tests in its file. The passing runs verified both saved picker values (`moonshot`, `kimi-k2`).

## Risks

The minimal `agent:getConfig` response covers the fields consumed while this test opens Settings. If the orchestration view later requires more fields, the mock will need to follow that contract. No known remaining failure in this spec.
