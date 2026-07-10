# TASK_2026_156 — Future Enhancements & Deferral Record

**Author**: senior developer (Batch 5) | **Date**: 2026-07-10
**Scope**: items consciously deferred from the Gateway Session & Workspace Switching feature (AC-8.3 and plan §10), recorded so follow-up tasks don't have to re-derive the decisions.

## Deferred (documented follow-ups)

1. **Telegram command parity** (AC-8.3). Register the five control commands via the Bot API `setMyCommands` and route them through the same `IGatewayCommandHandler`. Groundwork already landed: `command-replies.ts` is pure/platform-neutral, `GatewayCommandInvocation.platform`/`GatewayAutocompleteRequest.platform` are part of the contract, and `IMessagingAdapter.setCommandHandler?` is optional so the adapter only needs its own boundary parsing (Telegram has no autocomplete — a numbered-picklist reply flow or inline keyboard will be needed for `pick`). Until then, a literal `/sessions` text on Telegram is a plain agent prompt (AC-8.4, verified unchanged).
2. **Slack command parity** (AC-8.3). Requires app-manifest slash-command declarations (per-workspace app config, not a runtime REST call like Discord) plus the same handler wiring. Same reuse notes as Telegram; Slack's picker could use Block Kit static selects (25-option cap matches the service's picklist cap).
3. **Session force-attach / steal flag** (AC-3.4 default). `/session use` refuses a session attached to another binding/conversation ("in use elsewhere") — no `force:` option in v1. A follow-up could add an explicit steal flag that detaches the current owner, but it needs a confirmation UX and an answer for the owning thread's next message (which would silently fork). Freeing today = `/new` (or webview detach) at the owning location.
4. **Binding-level default-workspace mutation from chat** (AC-6.8 default). `/workspace use` is conversation-scoped only; changing the binding default for all future threads from a public channel was rejected for v1. Revisit only with an explicit user-visible confirmation design; the webview Gateway tab remains the place to change binding defaults.
5. **Queue-behind-turn for mutating commands** (AC-3.6 default). Mid-turn mutations are rejected ("finish or wait for the current turn first") rather than queued behind the running turn. Queueing is possible on top of `ConversationQueue` but was deliberately not chosen (deterministic and simple wins); revisit only if refusals prove annoying in practice.
6. **Gateway tab: read-only display of conversation-level workspace**. Task-description §8 allowed this "only if trivially cheap"; no UI work was done. The data is on `GatewayConversation.workspaceRoot` — a follow-up can surface it in the bindings/conversations panel.
7. **Gateway tab button label**. The Discord pane button is still labeled "Register /ptah" (`discord-integration-kit.component.ts`), and the setup-guide drawer says "Register the `/ptah` slash command", although the underlying RPC now bulk-registers all six commands (`/ptah` + five control commands). Cosmetic rename ("Register commands") deferred — UI work was out of Batch 4's scope. Docs (`discord.md`) reference the button by its current label.
8. **Pre-metadata sessions don't list** (plan risk 5 residual). `MetadataGatewaySessionLister` scans `ptah.sessionMetadata` across all workspace storages; sessions created before metadata existed won't appear in `/sessions` — the same limitation the webview sidebar has today. A JSONL-directory fallback lister could close this at the cost of losing friendly names.

## Consciously excluded (not enhancements — do not revive without a security review)

- Free-text workspace paths from chat, subpath targeting, or adding NEW workspaces from Discord — the allowlist is managed only from the desktop app (SEC-1/SEC-2; gateway turns run yolo-approved).
- Message-prefix command parsing on any platform (design direction: slash commands only).
- Changing the yolo permission model for gateway turns; cross-binding session sharing; per-user ACLs on commands.

## Upgrade note carried into docs

Discord registration switched from a single-command POST to a bulk-overwrite PUT of the full command set. Users must re-run **Register /ptah** in the Gateway tab once after upgrading; global-scope registration propagates in up to ~1 hour (per-guild is instant). Documented in `apps/ptah-docs/src/content/docs/automation/messaging/discord.md`.
