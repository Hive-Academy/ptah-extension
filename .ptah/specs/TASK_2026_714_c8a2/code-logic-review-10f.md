# Batch 10f code logic review

Score: **9/10**  
Verdict: **APPROVED**

## Numbered defects

None found. No source or configuration fix is required for this batch.

## Evidence

1. **Lane references:** A read-only search of all 285 files under `libs/backend/cli-agent-runtime` found zero literal `@openai/codex-sdk` references, including production, specs, and config. This covers static imports, dynamic imports, `require`, and `require.resolve` strings. The removed dependency occupied `libs/backend/cli-agent-runtime/package.json:24` before the edit; the current dependency list continues from `@cursor/sdk` at line 23 to `uuid` at line 24.
2. **Metadata:** `git diff -- libs/backend/cli-agent-runtime/package.json` shows only removal of `"@openai/codex-sdk": "^0.165.0",`. PowerShell `ConvertFrom-Json` parsed the current file. Comparing dependency keys and values against `HEAD` found exactly one removal, no additions, and no changed versions.
3. **Host packaging:** Electron's `apps/ptah-electron/project.json:33-41` generates a package manifest but keeps `@openai/codex-sdk` external; `apps/ptah-electron/package.json:16` declares it directly. `apps/ptah-electron/scripts/prune-dist-deps.js:29-36,83-98,100-126` makes the app manifest the packaged dependency source and fails if a declared dependency is absent from the generated manifest. `apps/ptah-electron/scripts/validate-deps.js:96-114` compares external imports with that app manifest. Electron's `apps/ptah-electron/electron-builder.yml:52-58` still unpacks Codex platform binaries.
4. **Other hosts:** CLI keeps the SDK external at `apps/ptah-cli/project.json:46`, declares it directly at `apps/ptah-cli/package.json:56`, copies its app manifest at `apps/ptah-cli/project.json:89-91`, and restores that manifest at `apps/ptah-cli/project.json:219-231`. TUI keeps the SDK external at `apps/ptah-tui/project.json:41`; its build is included in CLI's manifest restoration dependency at `apps/ptah-cli/project.json:225-231`. VS Code bundles third party dependencies and copies its own manifest (`apps/ptah-extension-vscode/project.json:32-33,42,49-52`); no inspected host packaging rule uses the runtime library's manifest as the sole source for the SDK.
5. **Main chat and lock:** `libs/backend/agent-sdk/package.json:19` and root `package.json:129` still declare the SDK. The main chat binary resolver still probes its package at `libs/backend/agent-sdk/src/lib/detector/codex-native-binary-path.ts:89,145`. Root `package-lock.json:48,11552-11558` retains the SDK and its `@openai/codex` dependency; `package-lock.json:11464-11481` retains the Codex binary package and platform optional dependencies. The root lock has no `libs/backend/cli-agent-runtime` or `libs/backend/agent-sdk` workspace package entries, and `git diff -- package-lock.json` is empty. No lock change is needed for this library manifest edit.

Review is static as required: no verify, Nx, Jest, TypeScript, lint, build, install, diagnostics, or packaging run was performed. `rg` was unavailable (access denied), so the search used PowerShell. Skill discovery was available, but found no locally invocable code review skill.