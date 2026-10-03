# Lane B ? TASK_2026_595_1c01

Implemented components 2, 3 and 7. Verification is not fully green because of unrelated rpc-handlers test failures described below.

## Changes

- The interactive SDK MCP URL appends `/profile/apps` only for the apps profile; coding and omitted profiles preserve the bare session URL. Writer JSDoc names `http-server.handler.ts` / `extractCallerToolProfile`.
- Both RPC schemas validate the optional shared profile enum. Start, inactive-session resume and slash-query configs forward it using conditional spreads, preserving absent keys.
- Apps-page start and continue RPC requests send top-level `mcpToolProfile: 'apps'`.
- Specs cover profile validation, URL generation (including build(), stopped server and unchanged default URLs), actual SDK start/resume/slash forwarding, facade forwarding, and Apps-page payloads.

## Files modified

- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.schema.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.schema.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\backend\rpc-handlers\src\lib\chat\session\chat-continue-slash-before-resume.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\frontend\mcp-apps-page\src\lib\services\apps-session.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile\libs\frontend\mcp-apps-page\src\lib\services\apps-session.service.spec.ts`

## Stack and repository evidence

- Node 24 is declared in package.json; package-lock.json pins TypeScript 6.0.3, tsyringe 4.10.0 and Zod 4.6.5. Angular 22.1.7 is declared in package.json.
- Existing chat services use tsyringe injection; chat-rpc.schema.ts uses Zod at the RPC boundary. No new collaborators or registrations were introduced.
- CONVENTIONS.md section 8 and eslint.config.mjs define library boundaries. Imports remain through the shared barrel; shared/src/index.ts exports ai-provider.types.ts.
- The three project.json files define the scoped Jest, typecheck and lint targets used below.

## Plan deviations

The plan describes chat-rpc.handlers.spec.ts as asserting startChatSession arguments. Current source is a thin-facade suite mocking ChatSessionService. Added facade forwarding checks there and actual startChatSession config checks to the already-allowed chat-continue-slash-before-resume.spec.ts, reusing its real ChatSessionService harness. That file also tests the real slash router through continueSession.

No files outside the ten assigned source/spec paths and this report were intentionally edited. No shared or vscode-lm-tools changes; no git commands.

## Verification

Initial requested scoped run (Jest workers and Nx parallelism capped at two):

`npx nx run-many -t test,typecheck,lint -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/mcp-apps-page --parallel=2 --maxWorkers=2 --outputStyle=static`

Nx forwards maxWorkers to all targets, so the three compiler targets rejected it with TS5023. Corrected by running only typecheck without that Jest flag:

`npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/mcp-apps-page --parallel=2 --outputStyle=static`

Corrected typecheck command exited 0: all three targets passed. Tests and lint were not rerun.

| Project | Test suites | Tests | Typecheck | Lint |
| --- | --- | --- | --- | --- |
| agent-sdk | 125 passed, 2 skipped | 2,326 passed, 3 skipped | Pass | Pass: 0 errors, 48 warnings |
| rpc-handlers | 107 passed, 7 failed | 3,265 passed, 1 failed, 4 skipped | Pass | Pass: 0 errors, 47 warnings |
| mcp-apps-page | 16 passed | 288 passed | Pass | Pass: no warnings/errors reported |

All five edited spec files are outside the failed-suite list. Totals: 5,879 tests passed, 1 failed, 7 skipped; 248 suites passed, 7 failed, 2 skipped.

Scoped ptah_get_diagnostics was called after edits for all five production files. It reported unavailable: compiler still running after 45 seconds, five files unchecked. The completed Nx compiler targets above provide the typecheck result instead.

Prettier was run only over the ten edited source/spec files.

## Open items and unrelated failures

Six rpc-handlers suites fail to initialize because jest.preset.js maps marked to the absent worktree path `node_modules/marked/lib/marked.umd.js` (confirmed Test-Path returns false):

- output-style-rpc.handlers.spec.ts
- surface-rpc.handlers.spec.ts
- surface-rpc.handlers.submit.spec.ts
- surface-rpc.handlers.deadline.spec.ts
- resolve-handler-plan.spec.ts
- rpc-allowlist.spec.ts

The seventh failing suite is harness-skill-selection-rpc.service.spec.ts: its ?never writes state.json? test fails at line 114, the initial `expect(existsSync(statePath)).toBe(false)` before getSelection() is called. Expected false, received true. This untouched harness/workspace-state path does not exercise the modified profile paths. These are unrelated existing/environment failures; an unchanged-tree baseline was not run.

Other non-blocking output: the untouched peer-session-send-dialog.component.ts:181 emits Angular NG8107; Nx Cloud reports organization quota/401, while local typecheck still exits 0. No changes made for these notices.

Live Apps-page/server integration was not exercised in this lane; transport/dispatcher changes belong to the other lane. Overall verification remains red until the unrelated rpc-handlers failures are resolved by their owner.
