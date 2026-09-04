# Implementation note

Changed files:

- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts`
- `libs/backend/agent-sdk/src/lib/types/sdk-types/content-block-contract.spec.ts`

Facts:

- `ThinkingBlock` now declares the observed optional `signature` field.
- Assistant content remains `message.content` typed as `ContentBlock[]`, with the existing predicate chain and an exhaustive warning-only terminal branch. The interrupt-only envelope suppression remains unchanged.
- The new contract spec pins exact locally observed text, tool-use, and tool-result transcript blocks plus the supplied signature-only thinking block, and offers an opt-in (`PTAH_CORPUS_SPECS=1`) defensive scan of `~/.claude/projects` JSONL assistant content.
