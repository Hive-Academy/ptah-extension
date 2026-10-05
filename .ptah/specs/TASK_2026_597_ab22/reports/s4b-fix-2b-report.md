# S4-b fix 2b report

- Style S2 (compaction defaults): FIXED. compaction-config-provider.ts reads defaults from FILE_BASED_SETTINGS_DEFAULTS (platform-core); four constants removed.
- Barrel Moderate: FIXED. adviseSubagentResume + types now exported via helpers/index.ts; agent-sdk index.ts uses './lib/helpers'.
- M3 (spool .gitignore): FIXED. spool.ts ensureSpoolGitignore (wx, fail-open); spool.spec.ts +2 tests, EEXIST test updated. Specs that list the spool dir now filter '.gitignore': agent-sdk tool-output-capper.spec.ts; vscode-lm-tools mcp-contract.sweep, mcp-response-formatter-extra, tool-result-budget, protocol-dispatcher, agent-tool.dispatcher specs.
- Logic-B M4: FIXED. agent-spawn-environment.service.ts warns naming key and default used (steer/stop pair, repeat).
- Visual S1: FIXED. Both btn-primary buttons in session-budget-banner.component.ts get focus-visible outline-2 offset-2 outline-base-content. No spec pins classes.

## Checks
- tool-output-reducers, vscode-lm-tools, cli-agent-runtime: test/lint/typecheck pass (markdown.reducer.spec flaked once under load, passes alone).
- agent-sdk: typecheck/lint ok; only known flake session-handoff-writer.spec failed.
- chat: only electron-shell.review-dock.spec failed in the full run; passes alone.
- di-lint: pass. degradation-audit: no findings in my files (repo-wide has pre-existing apps/ptah-cli findings).
- No png rewritten.
