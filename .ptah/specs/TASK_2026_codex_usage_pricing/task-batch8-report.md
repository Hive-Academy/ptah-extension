# Batch 8: limit failure and generic presentation

## Changed files

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts`: validates one optional structured `limitReached` cause on a failed terminal, adds it to the result beside the existing error, and uses a sanitized retry notice. The existing terminal event, token usage, failure callback and rejected settlement stay in place. Missing or malformed evidence retains the generic failure.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.spec.ts`: covers structured reached type/reset, safe notice, retained usage and failure transport, plus malformed evidence fallback.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts`: creates generic credit and individual allowance status tiles from the optional shared `allowances` DTO, preserving bucket order. Legacy singular fields are a fallback. Unlimited credits remain a state, not a numeric balance. No Codex-specific UI branch or new DTO was needed.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts`: renders ordered allowance tiles, unlimited credits, a balance and an individual reset.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts`: appends generic credit and individual allowance rows to the existing six-column plan-limits table, with the existing window rows first.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts`: asserts allowance text and unchanged six-column owner/window rows.
- `libs/frontend/core/src/lib/services/plan-limits.store.spec.ts`: strengthens the existing newer-push/older-pull test with allowances, owner, window usage and session-owner identity.
- `.ptah/specs/TASK_2026_codex_usage_pricing/task-batch8-report.md`: this report.

## Acceptance coverage

| Case | Spec |
| --- | --- |
| Structured reached type and reset, one cause, safe message, retained failure and usage behavior | `maps one structured usage-limit cause and reset beside the existing failed terminal`; `keeps the generic failure for malformed or absent structured limit evidence` |
| Existing owner/window RPC shape | `lists credits and individual allowance without changing the owner/window row shape`; `keeps newer pushed allowances and owner/window data when a slower pull returns an older snapshot` |
| Credit and individual allowance tiles, unlimited state and bucket order | `renders provider-neutral credit and individual allowance tiles in bucket order` |
| Agent-list limit text | `lists credits and individual allowance without changing the owner/window row shape` |
| Push/pull order | `keeps newer pushed allowances and owner/window data when a slower pull returns an older snapshot` |

## Projects and limits

Exact Nx projects touched: `@ptah-extension/agent-sdk`, `@ptah-extension/chat-ui`, `@ptah-extension/vscode-lm-tools`, `@ptah-extension/core`. Their dependent host surfaces include Electron, VS Code, webview, CLI and TUI; the Ptah dependency index reported partial coverage, so the coordinator should include the batch plan's dependent host gates.

**Required change outside this file list:** `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts` needs an optional typed limit cause on `CodexRuntimeError`, and `libs/backend/codex-runtime/src/lib/codex-event-translator.ts` needs to map validated native `turn.error.codexErrorInfo` into that cause. Today the translator replaces every native turn error with generic `turnError`, so the structured mapper added here cannot receive real native reached type/reset evidence. The owner-aware ledger/stream consumer also needs to receive that cause if the plan's error-derived ledger update is required. Those paths were not edited because this lane's file list forbids it. The focused backend spec supplies a structured runtime error to prove the mapping once the upstream contract exists; it does not prove end-to-end native propagation.

No test, typecheck, lint, build, Nx, npm, Jest, tsc or diagnostics command was run, per this lane's rules. The Angular result was not rendered or screenshot inspected: no running UI or HTML artifact was supplied, and starting a host or server is prohibited. I reviewed the source diff and existing component contract only. The CLI exposed skill search but no skill loader; `angular-frontend-patterns` was not found, so project Angular rules were applied directly.
