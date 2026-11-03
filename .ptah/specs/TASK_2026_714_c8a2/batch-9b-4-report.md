## Changes

- `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:91`: Select native capability from `consumer` for prepared-runtime admission, provider admission, and unprepared routing.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:275`: Default absent consumer to chat; validate prepared profile consumer at :323; gate runtime with that consumer at :349; enable read-only auto-accept only for chat at :482.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts:96`: Add an explicit read-only auto-accept flag, default off; classify commands only while enabled at :128.

## Specs added

- `routing-agent-adapter.spec.ts:290`: Chat and gateway capability combinations, including gateway off on a Codex provider; prepared gateway refusal with only chat capability at :307 and gateway admission at :325.
- `codex-chat-adapter.spec.ts:422`: Gateway start through a gateway-only gate with a visible read approval; gateway resume at :445; consumer/profile identity mismatches at :462.
- `codex-chat-approval-sink.spec.ts:91`: Default-off behavior and explicit gateway card behavior at :106. Existing chat auto-accept cases use the enabled fixture at :45.

## Decisions

- Resume and other session operations in RoutingAgentAdapter continue to use stored session identity; they do not choose a runtime from capabilities. Reopened native resumes use the resume config's consumer when validating the profile and opening the gated runtime.
- The sink flag defaults off so direct constructions require an explicit opt-in. CodexChatAdapter opts in only for chat.
- The only other CodexChatApprovalSink construction in agent-sdk is CodexChatAdapter; no additional spec file required changes.

## Not done

- No verify, test, lint, typecheck, build, nx, or diagnostics command was run, as requested. The coordinator owns checks.