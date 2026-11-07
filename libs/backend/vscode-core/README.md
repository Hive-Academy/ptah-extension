# @ptah-extension/vscode-core

Shared backend infrastructure, kept under its historical name. It is not a VS Code host: the
VS Code extension was removed. It provides the DI `TOKENS`, `Logger`, `ConfigManager`,
`ErrorHandler`, message validation and related services (see `src/index.ts`). Hosts call
`registerVsCodeCorePlatformAgnostic` (the Electron app does so in `src/di/phase-1-infra.ts`).
Most backend libs depend on it.

```bash
npm run verify -- -p vscode-core
```
