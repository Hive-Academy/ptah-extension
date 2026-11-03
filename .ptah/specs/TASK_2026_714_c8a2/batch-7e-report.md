# Batch 7e report

Implemented FM-R1, FM-R3 and FM-R4 within the assigned ownership. No git operations, formatter, dependency installation, live tests or settings changes.

## Changes and regression coverage

- **FM-R1:** Catch model-substitution publication rejection after successful launch and log a fixed warning without exception details, then attach the returned stream as before. Start: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:954`; resume: same file at line 1699; slash relaunch: `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:398`.
  - Added start/resume regressions in `chat-session.native.spec.ts:174,190`: publication rejects, launch/resume resolves, the returned stream is attached, and the safe warning is emitted.
  - Added slash regression in `chat-slash-command-router.native.spec.ts:169`: publication rejects, RPC-facing result remains successful, the stream is attached, and the warning is emitted.
- **FM-R3:** `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:91` requires strict `nativeCodex === true` and bound native adapter/admission port for a prepared Codex marker before provider admission. Failure throws the existing coded ChatRuntimeAdmissionError. Undefined provider remains compatible with a prepared marker when native support is available.
  - Added parameterized disabled-capability, missing-adapter and missing-admission regressions at `routing-agent-adapter.spec.ts:284`, asserting the coded error and neither runtime starts. Added Claude-marker/native-disabled/undefined-provider success at line 307. Existing provider and marker cases are retained.
- **FM-R4:** Added exported `SessionUnavailableError extends SdkError`, code `session-unavailable`, in `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:46`. The existing missing-record/query guards for model, permission and effort now throw it (lines 505/509, 548/552, 592/596). Public export only at `libs/backend/agent-sdk/src/index.ts:155`. The fallback at `libs/backend/rpc-handlers/src/lib/handlers/config-runtime-controls.ts:24` uses instanceof instead of parsing error text.
  - Updated `config-runtime-controls.spec.ts:231` to verify save-only behavior with a typed error whose message does not match the former regex; strengthened line 239 to reject an ordinary SdkError with matching absence-like text and avoid saving.
  - Added real SessionControl/SessionRegistry coverage at `session-control.service.spec.ts:113` for both missing records and registered records without queries, across model, permission and effort (six absence paths). Existing expectations remain intact.

## Verification

- PASS: `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns="chat-session|chat-slash|config-runtime-controls"`
  - Exit 0; Nx reported 1 task succeeded, 0/1 cache hits; task run 48.1 seconds.
- PASS: `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="routing-agent-adapter|session-control"`
  - Exit 0; Nx reported 1 task succeeded, 0/1 cache hits; task run 17.5 seconds.
- PASS: ptah_get_diagnostics scoped to all 11 changed source/spec files: TypeScript compiler, clean coverage, zero errors/warnings. Initial call reported its check still running after 45 seconds; the subsequent cached/completed result was clean.
- Only the two authorized test commands were run, once each. Their output was tail-filtered. No separate host build/typecheck or di-lint command was run under the restricted verification contract; no injections or registrations changed.

## Decisions

1. **Catch notices locally and continue attaching streams.** Options: local catch, reorder publication, or change publication globally. Evidence: the three reviewed call sites already have a successfully launched stream before awaiting the notice; local catches preserve ordering and the existing one-attempt publication contract. The warning is fixed text so errors cannot leak secrets. Reversible: yes, localized catch blocks.
2. **Keep undefined-provider admission valid only behind native capability and bindings.** Options: reject all missing providers or require strict capability plus bound native adapter/admission port while preserving prepared selection. Evidence: explicit batch requirement and existing prepared-marker tests require undefined-provider compatibility; disabled/missing native support must fail closed. Reversible: yes, no schema or constructor change.
3. **Choose FM-R4 option (b), a typed error at SessionControl.** Options: existing isSessionActive/public lifecycle lookup or typed unavailability. Evidence: `sdk-agent-adapter.ts:1389` only tests record existence, so it does not identify registered records without queries. SessionControl already owns all six absence guards before query calls. A local subclass plus one public export avoids a new dependency, caller changes, or timing gap and keeps SdkError compatibility. Real apply errors continue to propagate. Reversible: yes, additive error export and localized guard changes; no persisted-data change.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-runtime-controls.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-runtime-controls.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-7e-report.md

## Handoff

All requested fixes and scoped verification completed. No known unfinished implementation. The invoking workflow owns git and broader host checks.

