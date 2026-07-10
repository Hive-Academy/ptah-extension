# TASK_2026_156 — Batch 4 Implementation Report (Discord surface — the user-visible switch-on)

**Developer**: senior-backend-developer | **Date**: 2026-07-10
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang` (branch `fix/gateway-turn-hang`)
**Scope**: plan §9 Batch 4 — M4, C13, M5 (+spec), M6 (+spec), M7-part-2 (+spec). NOT committed (per instructions). No touches to Batch 1/2/3 production artifacts, Telegram/Slack adapters, `handleIncomingMessage`, `handleInbound`, the bridge, or docs (Batch 5).

---

## Per-Item Status

| Item | Status | File(s) / Detail |
|---|---|---|
| M4 — optional `setCommandHandler` on `IMessagingAdapter` | DONE | `libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts` — `setCommandHandler?(handler: IGatewayCommandHandler): void` (type-only import from `commands/gateway-command.types`, no cycle). Optional per plan §4.3 so Telegram/Slack and every existing test fake compile unchanged (AC-8.1, NFR-7) — verified: full messaging-gateway suite passes with zero edits to non-Discord adapters or their fakes. |
| C13 — Zod schemas at the interaction boundary | DONE | NEW `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command.schema.ts` (SEC-8). `discordControlCommandSchema` = `z.union` of the five valid shapes, each `.transform()`-ing straight into the Batch-1 `GatewayCommand` union (commandName literal, subcommand literal `use`/`list`, `pick` = `z.string().trim().min(1).max(200)`); any other commandName/subcommand/pick combination fails closed. `routingSchema` validates channel/guild/user ids + thread shape; `autocompleteSchema` extends it with `commandName: z.enum(['session','workspace'])` and a length-clamped `focused` string. Exported parse helpers `parseDiscordControlCommand` / `parseDiscordAutocomplete` return `null` on any failure (incl. thread-with-null-parent) and derive `externalChatId` (parent channel in threads) / `threadId` / `allowListId` with no casts. Internal to the adapter — not added to the barrel. |
| M5 — DiscordAdapter routing + seam extension | DONE | `discord.adapter.ts`. Seam (`DiscordInteractionLike`) grew ONLY optional-or-defaulted members per plan §2.2/risk-1: `options.getSubcommand?(required?)`, `options.getFocused?()`, `isAutocomplete?()`, `respond?(choices)`, and `deferReply(opts?: { ephemeral?: boolean })` (parameter optional — existing fakes with zero-arg `deferReply` remain structurally assignable). Adapter stores the handler via `setCommandHandler`. `handleInteraction` routes: autocomplete first (`isAutocomplete?.() === true`), then `commandName ∈ {sessions, session, new, workspace}` → control plane, then the EXISTING `/ptah` prompt path — its body is byte-identical (same allow-list block, same bare `deferReply()`, same thread create/attach/editReply/InboundMessage builds). Control branch: no handler wired → ignored (debug log); guild allow-list gate BEFORE any ack (same disclosure posture as prompts, SEC-6); `deferReply({ ephemeral: true })` immediately (NFR-1); Zod parse → failure = fixed ephemeral error `'Ptah could not process that command.'`, handler never called; success → `handler.handleCommand(invocation)` → ephemeral `editReply(outcome.ephemeralText)`; `outcome.publicText` + threadId → one public `sendMessage(parentId, publicText, { conversationId: threadId })` audit line (NFR-3). Handler throw → warn + fixed ephemeral error. Autocomplete branch: never defers; unwired handler / non-allowlisted guild / parse failure / thrown error → `respond([])`; success → `respond(choices.slice(0, 25))`. Command interactions are NEVER forwarded to the inbound listener — structurally, the control/autocomplete branches return before the prompt path (AC-1.3). |
| M5 — adapter spec | DONE | `discord.adapter.spec.ts` +14 specs in two new describes (details below); all 23 pre-existing test bodies untouched and passing (AC-1.4 regression gate). New `fakeControlInteraction` builder + `createCommandHandler` fake; existing `fakeInteraction`/client/channel fakes reused unmodified. |
| M6 — bulk-overwrite registration | DONE | `discord-command-registration.ts` — single-command POST replaced with **PUT** of the full array (plan §2.1 JSON verbatim: `/ptah` byte-identical + `/sessions` + `/session use pick(autocomplete)` + `/new` + `/workspace list|use pick(autocomplete)`). Still one REST call per guild (`PUT …/guilds/{gid}/commands`) or one global (`PUT …/commands`) — NFR-6; `registered` keeps its existing meaning (calls made). Header documents: bulk overwrite replaces ALL of the application's commands in scope (acceptable — Ptah owns them) and the ~1h global-propagation caveat. Exported names/signatures unchanged, so `gateway.service.ts:718` caller needed no edit. |
| M6 — registration spec | DONE | `discord-command-registration.spec.ts` — PUT (not POST) asserted for guild and global scopes; one call per guild; array body carries exactly `['ptah','sessions','session','new','workspace']`; `/ptah` element deep-equals its pre-task shape (AC-1.4); subcommand tree asserted (`session→use→pick{required,autocomplete}`, `workspace→[list, use→pick{required,autocomplete}]`, `sessions`/`new` option-less); Bot auth header; error surfacing + missing token/applicationId rejections retained. |
| M7-part-2 — GatewayService wiring | DONE | `gateway.service.ts` — constructor gains `@inject(GATEWAY_TOKENS.GATEWAY_COMMAND_SERVICE) private readonly commandHandler: IGatewayCommandHandler` (type-only import; no cycle — the command service never injects GatewayService). `wireAdapter` now ends with `adapter.setCommandHandler?.(this.commandHandler)`, so `start()`, `startPlatform()`, and every `maybeStart{Telegram,Discord,Slack}` path wire the control plane; adapters (and test overrides) without the member are a safe no-op. |
| M7-part-2 — spec | DONE | `gateway.service.spec.ts` — suite harness gains the `commandHandler` fake (15th ctor arg, exposed on `Suite`); `gateway.cipher.spec.ts` harness gains the same 15th arg. New describe `GatewayService — command handler wiring (TASK_2026_156)` (4 specs, below). All pre-existing GatewayService/cipher test bodies unmodified. |

## Behavioral spec coverage added

`discord.adapter.spec.ts — control-plane commands`:
1. `/sessions` in a thread: `deferReply({ ephemeral: true })`, exact invocation (`externalChatId` = parent, `threadId` = thread, `allowListId` = guild, `{ kind: 'sessions' }`), ephemeral editReply, inbound listener NEVER called, no thread created, no public send.
2. `/sessions` in a parent channel: `externalChatId` = channel id, `threadId: undefined` (context propagation).
3. `/session use`: untrusted pick forwarded verbatim as `{ kind: 'session-use', pick }`; `publicText` posted into the thread via `sendMessage(parent, …, { conversationId: threadId })`; nothing to the parent channel; zero inbound.
4. `/new`: `{ kind: 'new' }`; no `publicText` → no public send.
5. `/workspace list` + `/workspace use`: both mappings incl. thread vs parent context.
6. Guild allow-list refusal for control commands: no defer, no handler call (SEC-6).
7. Zod rejection (whitespace-only pick, unknown subcommand, thread with null parent): ephemeral defer + fixed error reply, handler never called (SEC-8).
8. Handler throw → fixed ephemeral error + warn log.
9. No handler wired → interaction ignored entirely.
10. Non-command interaction ignored + `/ptah` regression inside the same wired-adapter state: bare `deferReply()` (non-ephemeral), thread created, inbound emitted, command handler untouched (AC-1.3/1.4).

`discord.adapter.spec.ts — autocomplete`:
11. Session autocomplete in a thread → `handleAutocomplete` gets `{ platform:'discord', target:'session-pick', query, externalChatId=parent, threadId, allowListId }`; `respond(choices)`; never defers; never inbound.
12. Workspace autocomplete → `target: 'workspace-pick'`.
13. 30 handler choices → responded slice of 25 (Discord cap).
14. Non-allowlisted guild → `respond([])`, handler not consulted (SEC-6); unwired handler and non-autocomplete commandName (`sessions`) → `respond([])`; handler throw → `respond([])` + warn.

`gateway.service.spec.ts — command handler wiring`:
15. `startPlatform('discord')` calls the override adapter's `setCommandHandler` exactly once with the injected handler instance.
16. `start()` (enabled discord) wires it too.
17. Override adapters WITHOUT the method: start resolves, adapter started — no throw.
18. The wired handler object IS the injected `IGatewayCommandHandler`; driving it produces no `inbound` event and no `messages.insert` (commands reach GatewayCommandService, never `handleInbound`).

## Seam-extension details (risk-1 mitigation)

- `deferReply(opts?: { ephemeral?: boolean })` — parameter optional; zero-arg fakes stay assignable; prompt path still calls it with no args (defer stays public there). Real discord.js 14.16.3 accepts `{ ephemeral: true }` (maps to flags 64).
- `options.getSubcommand?(required?: boolean): string | null` — called as `getSubcommand?.(false) ?? null` (discord.js returns null instead of throwing with `false`; absent on old fakes → null).
- `options.getFocused?(): string` — `?? ''` default.
- `isAutocomplete?(): boolean` — `?.() === true`; button/select interactions and old fakes fall through to the existing filters.
- `respond?(choices): Promise<unknown>` — autocomplete branch exits immediately if absent.
- All existing fakes in `discord.adapter.spec.ts` and the `IMessagingAdapter` fakes in `gateway.service.spec.ts`/rpc-land compile with zero edits (verified by typecheck + suites).

## Decisions Taken

1. **Adapter-owned fixed error string** (`'Ptah could not process that command.'`) for Zod/handler failures instead of importing `COMMAND_REPLIES.commandFailed` — the boundary error is a platform-adapter concern and carries no user data (SEC-6); the service keeps its own generic reply for internal failures.
2. **Listener-null guard relocated below the control/autocomplete routing** in `handleInteraction`: control commands work even before/without an inbound listener (they need only the command handler). For `/ptah` the observable behavior is identical (still returns when no listener).
3. **`focused` autocomplete text is length-clamped (200) via a Zod transform** rather than rejected — autocomplete is advisory filter-only input; commands' `pick` stays strict (`min(1).max(200)` fail-closed) per the plan's "pick ≤ 200" boundary rule.
4. **Thread-with-null-parent on a control command → validation failure** (generic ephemeral error), mirroring the prompt path's refusal to proceed without a parent channel; encoded in the parse helpers (`externalChatId === null → null`).
5. **`registered` result semantics kept** as "REST calls made" (1 per guild / 1 global) so the existing `gateway.service.ts` caller and RPC/UI surface stay contract-compatible under the PUT switch.
6. **Adapter re-caps autocomplete at 25** (`slice(0, 25)`) even though `GatewayCommandService` already caps — defense in depth at the platform boundary where the 25-choice limit actually lives.
7. **No-handler-wired control command is silently ignored** (debug log, no defer): without a handler there is no outcome to render, and acking without a follow-up would leave a dangling ephemeral "thinking…". Production always wires it via `wireAdapter`.
8. **C13 has no dedicated spec file** (plan §7 lists none): schema behavior is covered through the adapter specs (valid mappings for all five commands, trim/min/max pick failure, unknown subcommand, orphan thread, autocomplete enum/clamp) — the schemas are exercised only through the adapter, which is the boundary under test.

## Conflicts / Deviations to flag

- None against the plan. Batch 3's required `GatewayAutocompleteRequest.platform` field is populated with `'discord'` as instructed in its handoff notes.

## Verification (from the worktree root, final state)

1. `npx nx run-many -t typecheck --projects=messaging-gateway,gateway-chat-bridge` → **Successfully ran target typecheck for 2 projects**.
2. `npx nx test messaging-gateway` → **14 passed / 1 skipped suites, 219 passed / 32 skipped tests** (was 197 passed pre-batch; +22 new Batch 4 specs; skips = pre-existing better-sqlite3 native-ABI guard). All pre-existing `/ptah`, @mention, thread-lifecycle, pairing/allow-list and outbound specs pass with bodies unmodified.
3. `npx nx lint messaging-gateway --skip-nx-cache` → **All files pass linting** (0 errors, 0 warnings).
4. `npx nx run ptah-electron:build-main:development` → **Successfully ran target build-main** (+20 dependent tasks).
5. Regression extra: `npx nx test gateway-chat-bridge` → **green** (all TASK_2026_155/Batch-2 specs passing).

## Files Created (1)

- `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command.schema.ts`

## Files Modified (7)

- `libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts` (M4)
- `libs/backend/messaging-gateway/src/lib/adapters/discord/discord.adapter.ts` (M5)
- `libs/backend/messaging-gateway/src/lib/adapters/discord/discord.adapter.spec.ts` (M5 spec)
- `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command-registration.ts` (M6)
- `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command-registration.spec.ts` (M6 spec)
- `libs/backend/messaging-gateway/src/lib/gateway.service.ts` (M7-part-2)
- `libs/backend/messaging-gateway/src/lib/gateway.service.spec.ts` (M7-part-2 spec + harness 15th arg)

plus `libs/backend/messaging-gateway/src/lib/gateway.cipher.spec.ts` (harness-only: 15th ctor arg).

## Handoff notes for Batch 5

- Docs (M13) should state: users must re-run "Register commands" from the Gateway tab once after upgrade (bulk PUT replaces the old single `/ptah` registration) and the ~1h global-propagation caveat.
- The five commands are live end-to-end once `registerDiscordSlashCommands` re-runs; parent-channel invocations of read-only commands work, mutating ones reply with in-thread guidance (service-side, already covered by Batch 3 specs).
- Full-repo sweeps (`npm run typecheck:all`, `npm run lint:all`, affected Jest) remain Batch 5's gate; the four Batch-4 gates above are green.
