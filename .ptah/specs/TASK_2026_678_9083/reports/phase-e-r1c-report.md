# Phase E r1c: N-1 correction

## Change

- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:314,616,619-626`: marked-tab change now cancels the current Tribunal discovery wait; `exit()` still permanently exits the transport. The run coordinator's `pageExit()` remains on both paths. Controller length: 690 lines, under the 700-line limit.

## Specs

- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:1451`: Start new calls `cancelDiscovery()` without calling transport `pageExit()`; page `exit()` calls transport `pageExit()`.
- `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.spec.ts:152`: the real transport rejects the old cancelled wait, completes a fresh discovery on the new tab's boundary, and rejects discovery after page exit.
- Jest: `Test Suites: 2 passed, 2 total`; `Tests: 58 passed, 58 total` (the two changed specs, one invocation).
- Scoped `ptah_get_diagnostics`: no diagnostics in changed files; 17 errors reported in sibling specs outside this correction.

## Decisions

- Kept one shared teardown with a `pageLeave` parameter. Evidence: both tab change and `exit()` call it, while only the transport's `pageExit()` sets a permanent exit flag. This is reversible and stays within the line limit.
- Used a real transport regression spec plus a controller routing spec because the existing controller test fixture injects a mock transport. This is reversible.

## Not done

- No changes outside the assigned controller, two specs, and this report. No Nx, build, serve, e2e, package, or git commands run.
