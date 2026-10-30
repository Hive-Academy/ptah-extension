# Code Logic Re-review — `TASK_2026_855_d4b6`

Review family: grok (implementer: codex)

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED_WITH_NOTES |

The three findings and both notes are fixed in the paths the fix report names. No new Blocking or Serious defect. Score is 8, not 9, because this pass did not execute the suites (coordinator owns verify) and a live native slash now fails closed when an ancestor is invalid, which is stricter than a live plain-text turn. It is not 7 because reverting any of the four new tests would fail for the behavior they name.

No logic-review skill is assigned. `ptah_code_search_symbols` was not reused; the named files were read directly.

## Prior findings

| Id | Was | Status | Evidence |
| --- | --- | --- | --- |
| F1 | Blocking. Unix mode masks refuse Windows directories (`0o40666`) | FIXED | `session-folder.ts:46-53` keeps `isDirectory()` and `fs.access(R_OK \| X_OK)` and drops both mode masks. `session-folder.spec.ts:100-111` stubs `fs.promises.stat` (same `promises` import the implementation uses) with mode `0o40666` and expects the physical path. Restoring the masks makes that assertion reject. |
| F2 | Serious. Inactive slash skipped `restoreLineage`; a storage-less ancestor became an empty layer | FIXED | `chat-session.service.ts:1394-1405` calls `restoreLineage` before the router and returns `SESSION_FOLDER_UNAVAILABLE` without calling it. `chat-session.service.ts:1434-1441` forwards `slashLineage.roots` and upgrades after a successful slash result. `chat-slash-command-router.service.ts:332-334` copies those roots onto `sessionConfig`. `plugin-loader.service.ts:1107-1116` and `:1209` use `requireStorage` only for ancestor reads. `chat-continue-slash-before-resume.spec.ts:289-308` expects refusal and zero router/resume calls for an ancestor outside the open folder. `:643-694` expects `[workspaceId]` on the one slash `sessionConfig` and zero `resumeSession` calls. `plugin-loader.service.capabilities.spec.ts:302-317` expects `CapabilityPolicyUnknownError` with `missing workspace storage`. Each of those fails if the corresponding fix is removed. |
| F3 | Minor. Post-start legacy upgrade failure reported as a failed resume | FIXED | `chat-session.service.ts:2121-2124` still upgrades after the stream is attached. `upgradeLegacyLineage` at `:2154-2174` logs throw and malformed and does not rethrow. `chat-continue-slash-before-resume.spec.ts:379-409` expects `success: true`, one resume, one stream, for both a rejected upgrade and a malformed result. |
| Note | `fileSystemProvider` unused on `ResolveSessionFolderOptions` | FIXED | The field is gone from `session-folder.ts:13-18`. Call sites at `chat-history-read.service.ts:50-59`, `agent-rpc.handlers.ts:1503-1509`, and `session-rpc.handlers.ts:1207-1213` no longer pass it. `session-rpc.handlers.ts:1849` is a different helper (`resolveResumeWorkingDirectory`) and still takes a filesystem provider on purpose. |
| Note | Rejection cause not logged | FIXED | `session-folder.ts:81-96` logs `code` and `message`, unwrapping `cause` when the validator attached a filesystem error. Authorization failures still share the generic text because `unavailable()` does not carry a distinct reason string. That is enough to diagnose filesystem failures. |

## Questions asked this pass

Slash `restoreLineage` does not run for passthrough prompts. `SlashCommandInterceptor.isSlashCommand` and `intercept` use the same regex (`slash-command-interceptor.ts:47-59`). A non-command returns passthrough and never enters `chat-session.service.ts:1394`.

It does run for every real slash, including a live session and native `/clear`. That does not start a second SDK query: the slash branch still does not call `autoResumeIfInactive` or `resumeSession` (`chat-session.service.ts:1394-1416`). The inactive slash spec still expects zero `resumeSession` calls and one router call (`chat-continue-slash-before-resume.spec.ts:310-327`). A live plain-text turn can proceed while a slash is refused if an ancestor has become unauthorized. That is fail-closed, not a policy leak. It is recorded under Decisions, not as a finding.

`workspacePath` on the slash path is the string from `resolveSessionFolder` at `chat-session.service.ts:1348-1349`, before the branch. It is not left undefined.

`requireStorage` does not change the no-ancestor case. `readWorkspaceLayer(localRoot)` is still called without the flag (`plugin-loader.service.ts:1203`). The flag is set only inside the ancestor loop (`:1209`). `ancestorRoots === undefined` skips that loop. `ancestorRoots: []` iterates nothing. A worktree with no local storage still reads as an empty local layer.

## New findings

None. The checks above were traced to the cited lines. No additional failure scenario held.

## Decisions

- Live native slash revalidation is accepted. Options: validate only when the router will start an SDK query; validate every slash before the router. Evidence: the router is invoked only after `restoreLineage`, and native `/clear` does not need a new query, but refusing it when an ancestor is unauthorized matches the fail-closed rule and does not double-launch. Reversible: yes.
- Generic authorization log text is accepted as the note fix. Options: log a distinct reason per check; log the wrapper message plus filesystem `cause`. Evidence: `session-folder.ts:85-96` now records code and message, and filesystem errors are on `cause`. Reversible: yes.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the diff that was read; MEDIUM for Windows runtime behavior, which is covered by the mocked mode and Node's `0o40666` directory mode, not by a Windows run in this pass
- Top residual: a live `/clear` is refused when an ancestor root fails validation, while a live plain-text turn is not
