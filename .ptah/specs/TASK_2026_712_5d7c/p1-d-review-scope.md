# P1-D review scope (Batches 16-22, first-parent task commits since 8fa5c01d9)

Diff command: git diff 8fa5c01d9..d9bb1c0b9 -- <file>

## Production files
- libs/backend/agent-sdk/src/lib/di/register.ts (14 insertions(+), 1 deletion(-))
- libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts (38 insertions(+), 2 deletions(-))
- libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts (43 insertions(+))
- libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts (324 insertions(+), 11 deletions(-))
- libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts (12 insertions(+))
- libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts (11 insertions(+))
- libs/backend/agent-sdk/src/lib/session-importer.service.ts (80 insertions(+), 12 deletions(-))
- libs/backend/agent-sdk/src/lib/session-metadata-store.ts (129 insertions(+), 16 deletions(-))
- libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts (23 insertions(+), 1 deletion(-))
- libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts (119 insertions(+), 18 deletions(-))
- libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts (36 insertions(+), 1 deletion(-))
- libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts (477 insertions(+), 30 deletions(-))
- libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts (148 insertions(+), 10 deletions(-))
- libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts (261 insertions(+), 112 deletions(-))
- libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts (57 insertions(+), 2 deletions(-))
- libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts (99 insertions(+), 1 deletion(-))
- libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts (3 insertions(+))
- libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts (5 insertions(+), 2 deletions(-))
- libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts (18 insertions(+), 1 deletion(-))
- libs/backend/persistence-sqlite/src/lib/migrations/0059_provider_account_session_links.ts (17 insertions(+))
- libs/backend/persistence-sqlite/src/lib/migrations/index.ts (6 insertions(+))
- libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts (83 insertions(+), 10 deletions(-))
- libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts (133 insertions(+), 2 deletions(-))
- libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts (12 insertions(+), 4 deletions(-))
- libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts (16 insertions(+), 2 deletions(-))
- libs/shared/src/lib/types/provider-account.schemas.ts (5 insertions(+), 2 deletions(-))

## Commits
- d9bb1c0b9 test(agent-sdk,cli-agent-runtime): add Claude account admission matrix
- eea3e1a89 feat(cli-agent-runtime,rpc-handlers): inherit parent account in child chats
- c124a1e4b fix(cli-agent-runtime): keep ambient lane logs and update stale mocks
- 9c3d441d5 fix(agent-sdk): resolve held named-account ports through a factory
- b95a97e47 feat(cli-agent-runtime): gate named Claude lanes with two-query admission
- c6e39a3ce fix(agent-sdk): register held named-account ports for di-lint
- 5361a3004 feat(cli-agent-runtime): carry lane account binding through resume
- 3cced9150 feat(rpc-handlers): gate session fork and every rewind on account
- a9bd94e49 feat(rpc-handlers): gate main-session resume and slash on account binding
- e3965c65c feat(agent-sdk,shared): require both stores for named session resume
- b559e3a77 test(agent-sdk): mock fs/promises stat instead of spying on it
- e02d03ea4 feat(agent-sdk): gate named Claude sessions behind bootstrap admission
- 738ae99ef feat(auth-providers,agent-sdk): attach and look up SDK session bindings
- ea27188eb feat(persistence-sqlite): add provider account session links table
- 91b86e380 feat(agent-sdk,auth-providers): add immutable session account linkage
- 7edd7679e test(cli-agent-runtime): read routing hint and closed mailbox correctly
