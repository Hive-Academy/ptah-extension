# Orchestrator verification — backend Batches 1-5

Command: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/cli-agent-runtime,
@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools`
and `npm run verify -- -t lint,typecheck -p ptah-electron,@ptah-extension/cli-engine,
@ptah-extension/platform-cli` (2026-11-06 ~08:20 UTC).

- lint + typecheck: 5/5 libraries pass; Electron, cli-engine, platform-cli pass.
- Tests: shared passes completely.

## Regressions from this branch (must fix)
1. rpc-handlers `src/lib/handlers/ptah-cli-rpc.handlers.spec.ts` — TS2345/TS2322 at :267, :555,
   :575, :593: fixtures are `PtahCliSummary` without the new `manifest: CliAdapterManifest`.
2. rpc-handlers `src/lib/handlers/agent-rpc.handlers.spec.ts`
3. rpc-handlers `src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts`
4. vscode-lm-tools `src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
5. vscode-lm-tools `src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`
6. vscode-lm-tools `src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.spec.ts`
7. vscode-lm-tools `src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts`

## Known environment failures (same set as on other branches; not this change)
cli-agent-runtime: claude-approval.reader, mcp-install, ptah-cli-registry-auto-compact-argv.
agent-sdk: off-thread-process-spawner, plugin-loader.service.capabilities,
plugin-loader.service.session-notice, sdk-query-options-builder.auto-compact-argv.
rpc-handlers: chat-session-* (5), file-view-rpc, plugin-rpc (2), skills-synthesis B13,
wizard-generation-checkpoint, install-scope-migration (2), skills-sh-source-root.
