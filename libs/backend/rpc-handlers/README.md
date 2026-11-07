# @ptah-extension/rpc-handlers

Shared RPC handler classes and their DI registration (`registerSharedRpcHandlers`,
`registerHarnessServices`, `registerChatServices`; see `src/index.ts`). The handlers import no
`vscode` module. The Electron app (`apps/ptah-electron`) wires them in; `cli-engine`,
`worker-host` and other backend libs also import this library.

```bash
npm run verify -- -p rpc-handlers
```
