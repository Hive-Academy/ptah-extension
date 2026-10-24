# Fix round — TASK_2026_718_15b7

## Changes

1. `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts:569`: open the main-agent model search with `input?.click()` and render. Preserved the catalogue assertion unchanged.
2. `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts:764`: removed the real-registry group's blanket info/warn spies and their group cleanup. At line 842, the advisory fallback test now owns a debug spy, asserts one call with the advisory message and `{ sessionId: SESS }`, and restores in `finally`. At line 870, the safety-timeout test owns a warn spy, asserts one call with the safety-timeout message, and restores in `finally`. All existing behavioral assertions remain.
3. `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts:429`: the transport-failure warning spy now encloses the test body in `try/finally`. It asserts one warning with `[SessionBudgetSettings] settings:set failed` and `Error('timeout')` before restoration. Existing UI assertions remain.

## Verification

Two Jest runs, each restricted to the three assigned specs using `npx jest -c libs/frontend/chat/jest.config.ts <three assigned spec paths> --coverage=false --maxWorkers=2`, with output redirected to `%TEMP%\fixround.log`. No whole-library test, build, serve, e2e, package, or git command was run.

The first run, after removing group-wide stubs, passed 190 tests and emitted no console blocks in the captured log. Source inspection identified the intentional advisory diagnostic as `console.debug`, and the safety-timeout diagnostic as `console.warn`; local assertions were then added and verified in the second run.

Final filtered result (`Tests:|Test Suites:|^FAIL|●|console\.`, first 40 matches):

```text
Test Suites: 3 passed, 3 total
Tests:       190 passed, 190 total
```

Remaining console blocks/messages: none in the final captured log. No FAIL or failure-bullet matches. All existing test cases retained.

Scoped `ptah_get_diagnostics` initially returned unavailable while its TypeScript check continued; the completed result reported 253 errors and zero warnings across the owning project, including sibling files. The only diagnostic listed under requested files was existing TS2352 at `chat-input.component.spec.ts:1034`, an event-object cast outside the edited blocks. No reported requested-file diagnostic concerns this round's edits. This is not a clean project typecheck.

## Decisions

- Use click rather than focus: explicitly requested and consistent with the approved `openOnFocus=false` behavior. The unchanged catalogue assertion verifies the interaction. Reversible spec-only change.
- Use a local debug spy for the advisory and a local warn spy for the timeout, rather than blanket info/warn suppression: the current compaction service emits those levels, and the passing assertions verify the message arguments and counts. Both spies restore in `finally`. Reversible spec-only changes.
- Preserve earlier-lane edits and the zoneless setup. The existing task review documents earlier changes to setup, mocks, and production behavior; those are not changes made by this fix round. Only the three assigned specs and this report were written.
- Leave unrelated diagnostics untouched rather than expanding this fix round. Their repair was not assigned; no changes to production code or test setup were made.

## Anything not done

No requested defect remains outstanding. Existing project TypeScript errors remain unresolved as noted above. No git operations or wider verification were performed, per the task restrictions.
