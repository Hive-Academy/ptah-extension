# Batch 8p-3 report

## Task 3.1 — resume fingerprint (D23)

- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:279-293`: the SHA-256 input is now only `permissionLevel`, `sandboxPolicy`, and `approvalPolicy`. Previously it also included `contextId`, `consumer`, `accountId`, `providerId`, `workspaceId`, `normalizedHome`, `cwd`, `systemPrompt`, `developerPrompt`, `outputStyle`, `instructionSources`, and `lane`. Model, effort, enhanced prompt, attachments, and MCP servers were already excluded. The runtime checks context/home/provider/workspace identity separately and re-sends instructions on `thread/resume`.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.spec.ts:319-372,446-514`: changed the existing *fingerprints thread policy and instructions* spec to expect a changed context ID to retain the same fingerprint, and changed the existing *changes identity when thread policy or instructions change* spec to expect prompt, style, instruction, model, and effort drift to retain it. Added deterministic equal-input and independent permission, sandbox, and approval-policy cases.

## Task 3.2 — typed resume error

- `libs/backend/codex-runtime/src/lib/codex-resume-profile-error.ts:1-18`: moved the error class into its own module with the stable code and message constants and a direct `instanceof` guard. The guard does not traverse `cause`.
- `libs/backend/codex-runtime/src/index.ts:52-57`: exports the class, guard, code, and message.
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts:17,94-99`: imports the moved class; resume mismatch still refuses before spawn.
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:688-723,1632-1674`: the existing mismatch spec now checks the guard and constants, including a wrapper that the guard must reject. The existing resume-frame spec now checks `baseInstructions` and `developerInstructions` on `thread/resume`.

## Task 3.3 — refused async answer

- `libs/backend/codex-runtime/src/lib/codex-runtime.ts:285,659-716`: extracted one event helper for edit follow-ups and async user answers. A refused answer steer or a steer response with another turn ID logs the existing warning and emits one `codexFollowUpRejected` error while the turn is live. A terminal turn or closed context emits no late error. Denial feedback remains log-only.
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1037-1111,1196-1237`: added live refused/different-turn cases with exactly one error, a refused-after-terminal case with none, and an explicit no-error assertion for refused denial feedback.

## Verification

No test, lint, typecheck, build, diagnostics, or git command was run, per lane rules. The team leader owns verification and commit. Existing stored fingerprints will differ from the new formula and refuse resume once, as accepted in D23 for the dev-gated runtime.

## Absolute paths of files written

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-execution-profile.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-execution-profile.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-resume-profile-error.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8p-3-report.md`

## Fix round 1

- `libs/backend/codex-runtime/src/lib/codex-runtime.ts:270-286`: capture `approvalTurnId` as a string immediately after the live-turn guard, pass it to the approval bridge, and reuse it for the edit follow-up rejection event. This keeps the event tied to the approval's turn across the awaited bridge call.
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts:660-666`: require `turnId: string` in `emitFollowUpRejected` and remove the optional-ID branch from its terminal check. The async answer call sites already pass the required string.
- Reviewed the newly added runtime specs at `codex-runtime.spec.ts:1037-1106,1196-1237,1632-1674` for the same optional-ID issue; no spec edit was needed. No verification command was run in this lane.

Absolute paths written in this fix round:

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8p-3-report.md`
