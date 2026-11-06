# A9 implementation report

## Changes

1. **Receipt correlation:** Added `sender` (`user` or `parent`) and a whitespace-collapsed preview capped at 160 characters to in-memory receipts and the shared, Zod-validated receipt push. Renderer `agent:sendMessage` selects `user`; the MCP coordinator path selects `parent`. The same metadata is retained on refused sends. Persistence strips preview; a regression spec proves it is absent from the stored value.
2. **Lane thread:** The existing bounded receipt and parent-delivery maps feed one timestamp-ordered communication section containing transcript messages, receipt previews, report delivery previews and a completion row. Parent report pushes now include a bounded preview and creation time. SDK SubagentLane rows without a monitored CLI ID skip the section safely. Failed completion rows use the error accent and `CircleX`; other completion rows use the success accent.
3. **Chat regression:** The optional monitor lookup guards absent `agentsById` in SubagentLane mocks. The full chat suite passed with one Jest worker.
4. **Capability view:** A summary category with no supported values and any unverified values now shows an `Unverified` warning badge. Existing `MCP: unsupported` badges already use `CircleSlash`, and no-manifest detail lines already use `CircleHelp`; no template edit was needed.

## Verification

- `npm run verify -- -p @ptah-extension/shared,@ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools -- --output-style=static`: lint/typecheck passed for all four projects (8 targets). Test phase did not start because the Nx project graph plugin worker exited unexpectedly. This is an environment failure, not a test assertion failure.
- `npm run verify -- -p @ptah-extension/chat-streaming,@ptah-extension/chat-ui,@ptah-extension/chat -- --output-style=static`: lint/typecheck passed for all three projects (6 targets); chat-streaming 34/34 suites and 837 tests passed; chat-ui 110/110 suites and 1,893 tests passed. Chat Jest stalled with memory-heavy workers and was stopped for the allowed retry.
- `npm run verify -- -p @ptah-extension/chat-streaming,@ptah-extension/chat-ui,@ptah-extension/chat -- --output-style=static --maxWorkers=1`: Jest passed for all three projects, including chat 343/343 suites and 6,095 tests. The wrapper exited 1 because it forwarded the Jest-only flag to lint/typecheck, where ESLint and ngc reject it. Those stages passed in the first chat run.
- `npm run verify -- -t lint,typecheck -p ptah-electron,@ptah-extension/cli-engine,@ptah-extension/platform-cli`: 6/6 tasks succeeded.
- Focused Jest with project configs and `--coverage=false --maxWorkers=2`: receipt store 5/5 tests, shared agent-monitor contract 9/9 tests, message coordinator 5/5 tests passed.
- Scoped `ptah_get_diagnostics` timed out twice, with files unchecked. The project typechecks above passed. Browser status had no connected session; no rendered Electron screenshot was available under the no build/serve rule.

## Decisions

- Use the existing bounded receipt and parent-delivery maps to supply the thread. They already cap records per agent; creating a second long-lived cache would duplicate state. Reversible: yes.
- Add a bounded report preview to the parent-delivery push because the prior payload carried only delivery state and could not render a report line. The parent envelope is already in memory. Reversible: yes.

## Known limits

SDK strip and Claude SDK subagent lanes keep their existing actions because they use tool-call IDs and the tray RPC.
The renderer derives its completion verdict from the monitored agent status because the completion signal's deliverable verdict is not present on the current monitor push.
