# @ptah-extension/agent-sdk

Wrapper around `@anthropic-ai/claude-agent-sdk` that runs Claude chat sessions in process and
turns SDK messages into the execution-tree nodes the renderer shows.

## Entry points (`src/index.ts`)

- `SdkAgentAdapter` (`src/lib/sdk-agent-adapter.ts`): implements `IAgentAdapter` from
  `@ptah-extension/shared`. `startChatSession` starts a session.
- `SdkMessageTransformer` (`src/lib/sdk-message-transformer.ts`): SDK message to `ExecutionNode`.
- `InternalQueryService`: one-shot internal queries for background features (memory curator,
  skill synthesis, commit messages, agent generation) on governed query lanes.
- `SessionMetadataStore`, session history reader and importer, and the DI registration under
  `src/lib/di/`.

## Constraints

- Nx tags `scope:extension`, `type:feature` (`project.json`).
- Depends on `@ptah-extension/vscode-core` (Logger, ConfigManager, DI tokens), which is shared
  infrastructure despite its name.
- Consumed by the Electron app (`apps/ptah-electron`) and by backend libs such as
  `rpc-handlers`, `cli-engine`, `memory-curator` and `skill-synthesis`.
- The SDK persists transcripts itself; `SessionMetadataStore` keeps only UI metadata (see the
  header comment in `src/index.ts`).

## Tests

```bash
npm run verify -- -t test -p agent-sdk
```
