# F1 and F2 fix report

## Files changed
- libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts
- libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts
- libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.spec.ts
- libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts
- libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts

## Gate
SdkQueryOptionsBuilder now computes the existing Electron/coding-profile/ptahUiFence condition through one helper for both system-prompt assembly and hook creation. The boolean is captured by UserPromptSubmitHookHandler.createHooks; surfaceHookGuidance runs only when it is true. The default is false for callers that do not enable the UI hint. No DI registration changed.

## Spec cases
The hook spec asserts that a report prompt adds publish guidance with ptahUiHint=true and adds no guidance with ptahUiHint=false. The builder hook registration spec expects the false default. Routing cases pin compact for "file a bug report", "report this error", and "can you report on the crash", and report for "send me a report of all in-progress tasks" and "make a dashboard of my work". No regex adjustment was needed based on the current patterns; tests could not run.

## Verification
Ran only `npm run verify -- -p agent-sdk` once. It exited 1 before lint, typecheck, or tests: Windows returned `spawn EPERM` while Nx loaded its three default plugins. The project-count header did not appear. Scoped ptah_get_diagnostics was attempted twice for all five changed TypeScript files; it remained unavailable because its TypeScript check was still running after 45 seconds. The requested test results therefore remain unverified; the known pre-existing test failures were not reached.

## Decisions
- Reused the existing ptahUiHint condition for both prompt and hook; alternatives were a new host-global flag or duplicate conditions. The shared condition follows current builder behavior and is reversible.
- Kept the report regexes because the requested negative phrases are covered by NOT_A_VISUAL_REPORT and the positive phrases by REPORT_REQUEST/VISUAL_REQUEST. This is reversible if the targeted spec later fails.
