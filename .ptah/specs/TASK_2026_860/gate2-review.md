# Gate 2 Architecture Review — TASK_2026_860

**Verdict: REVISE**

## Findings

1. **Blocking — Roving focus cannot reach expanded rail cards as planned.** The plan adds `tabStop` only to `CanvasRailCardComponent` and `CompactRailCardComponent` (`implementation-plan.md:66,69`). Expanded cards pass through `CompactSessionCardComponent`, which binds both `focused` and `innerTabbable` from `focused()` (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:133-149,236-243`). That component and its spec are absent from batch C. Unselected expanded cards therefore cannot receive the new roving tab stop. Add the intermediate component to batch C and test `tabStop` propagation.
2. **Blocking — The verification command is invalid under repository rules.** `implementation-plan.md:117` uses space-separated project names. Change it to `npm run verify -- -p @ptah-extension/canvas,@ptah-extension/chat,@ptah-extension/chat-ui,ptah-extension-webview,ptah-electron,ptah-extension-vscode`.
3. **Serious — The planned tests do not cover every approved parity row.** Examples include the running-cap summary and stray count (`parity-inventory.md:7`), auto-collapse reason and focus (`:10`), split reasons and chosen pane (`:16`), compact/full toggle and messaging handoff (`:20-21`), New session cap and Previous sessions keyboard behavior (`:24-25`), visible agent duration and hover-card exit/Escape (`:27,31`), and compact inspector expansion (`:34`). The generic preservation cases at `implementation-plan.md:104,108-113` do not specify these assertions. Map every parity row to an explicit planned test.

## Checks passed

- More than 20 cited files and line ranges were spot-checked. All matched their intended targets, including all eight pulse sites.
- All A–D acceptance criteria have planned production changes and test seams.
- Targeted Stop keeps one captured `{tabId, sessionId}` through query, confirmation, abort and fallback. It revalidates session ownership before tab-local mutation (`implementation-plan.md:76-80`; `conversation.service.ts:399-549,560-636`; `chat.store.ts:373-382`). It reuses one service path and changes no backend protocol.
- Current batches A–D are file-disjoint, including specs and the chat-ui barrel.
- Public aliases and Nx dependency direction are sound. The plan forbids `any`. Helper and child extraction addresses the 700-line warning rule (`eslint.config.mjs:561-571`).

Read-only review. No builds or tests ran.
