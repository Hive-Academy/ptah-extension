# Orchestrator review — wave 1 (batches 1 and 6)

## Verify (worktree, 2026-11-04)

`npm run verify -- -p shared,rpc-handlers,agent-sdk,ptah-electron,cli-engine`: lint and typecheck
pass for all 5 projects. Tests fail in 12 suites, none of them a file changed by batch 1 or 6:

- agent-sdk: off-thread-process-spawner, plugin-loader.service.capabilities,
  plugin-loader.service.session-notice
- rpc-handlers: chat-session-agent-child, chat-session-policy-roots, chat-session-resume-activate,
  chat-session-session-folder, session-folder, plugin-rpc.handlers.session-notice,
  install-scope-migration.fixtures, install-scope-migration.service, skills-sh-source-root

Comparison run of the same suites on `main`: see the result section below.

## Findings

- F1 (batch 6, must fix): `surfaceHookGuidance` is added in
  `user-prompt-submit-hook-handler.ts:119` for every host. The system-prompt hint is gated by
  `input.ptahUiHint === true` (`sdk-query-options-builder.ts:351`, Electron only). HTML artifacts
  display only in the Electron app, so VS Code and CLI sessions must not get the
  "publish an HTML artifact" guidance. Gate the hook guidance on the same flag.
- F2 (batch 6, minor): the "a report" alternative in `REPORT_REQUEST` is broad. Keep it, but the
  spec must pin false positives such as "file a bug report" and "report this error".

## Result of the comparison on main

Same 12 suites fail on `main` with the same counts (agent-sdk 4 failed tests, rpc-handlers 30
failed tests). The failures exist before this task and come from the local Windows environment.
