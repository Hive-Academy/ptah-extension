# TASK_2026_375 — Batch report B4

**Batch**: B4 — Session MCP status (agent-sdk capture → shared message → rpc-handlers → chat header)
**Libs**: `libs/shared`, `libs/backend/agent-sdk`, `libs/backend/rpc-handlers`,
`libs/frontend/chat`, `libs/frontend/chat-state`
**Status**: complete. `chat-ui` was NOT touched — no presentational atom was needed.

---

## Files changed

| File                                                                                                                                                        | Part | Change                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| `libs/shared/.../types/messages/session-mcp-status.ts`                                                                                                      | B4.1 | **NEW.** Payload types + `parseSessionMcpStatusPayload` (hand-written, no Zod).                       |
| `libs/shared/.../types/messages/session-mcp-status.spec.ts`                                                                                                 | B4.1 | **NEW.** 20 cases across both parsers.                                                                |
| `libs/shared/.../types/messages/message-constants.ts`                                                                                                       | B4.1 | `SESSION_MCP_STATUS: 'session:mcpStatus'` + the "why this is not turn state" comment.                 |
| `libs/shared/.../types/messages/payload-map.ts`                                                                                                             | B4.1 | `'session:mcpStatus': SessionMcpStatusPayload`.                                                       |
| `libs/shared/.../types/messages/index.ts`                                                                                                                   | B4.1 | Barrel line.                                                                                          |
| `libs/shared/.../types/messages/schemas.ts`                                                                                                                 | B4.1 | `SessionMcpStatusPayloadSchema` (Zod).                                                                |
| `libs/shared/.../types/rpc/rpc-session.types.ts`                                                                                                            | B4.1 | `SessionStatusResponse` gains optional `mcpServers` + `notices`.                                      |
| `libs/backend/agent-sdk/.../helpers/session-mcp-status-callback-registry.ts`                                                                                | B4.2 | **NEW.** `SessionMcpStatusCallbackRegistry` + `classifyCliNotice`.                                    |
| `libs/backend/agent-sdk/.../helpers/stream-transformer.ts`                                                                                                  | B4.2 | Injects the registry; publishes `mcp_servers` at the system `init` message.                           |
| `libs/backend/agent-sdk/.../helpers/stream-transformer.spec.ts`                                                                                             | B4.2 | Harness gains the fan-out capture; new describe, 5 cases.                                             |
| `libs/backend/agent-sdk/.../helpers/sdk-query-options-builder.ts`                                                                                           | B4.2 | Optional-last registry injection; the `stderr` handler classifies and publishes the claude.ai notice. |
| `libs/backend/agent-sdk/.../helpers/sdk-query-options-builder.cli-notice.spec.ts`                                                                           | B4.2 | **NEW.** 12 cases.                                                                                    |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                                                                                                               | B4.2 | `SDK_SESSION_MCP_STATUS_CALLBACK_REGISTRY`.                                                           |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                                                                                                             | B4.2 | Singleton registration, before the two consumers resolve.                                             |
| `libs/backend/agent-sdk/src/lib/helpers/index.ts`, `src/index.ts`                                                                                           | B4.2 | Barrel exports.                                                                                       |
| `libs/backend/rpc-handlers/.../chat/session/session-mcp-status.registry.ts`                                                                                 | B4.3 | **NEW.** `SessionMcpStatusRegistry`, LRU 256, merge-aware `rekey`.                                    |
| `libs/backend/rpc-handlers/.../chat/session/session-mcp-status.registry.spec.ts`                                                                            | B4.3 | **NEW.** 20 cases.                                                                                    |
| `libs/backend/rpc-handlers/.../chat/session/chat-session.service.ts`                                                                                        | B4.3 | Two new injections, constructor subscription, `publishMcpStatus`.                                     |
| `libs/backend/rpc-handlers/.../chat/session/chat-session-mcp-status.spec.ts`                                                                                | B4.3 | **NEW.** 6 cases on the fan-out wiring.                                                               |
| `libs/backend/rpc-handlers/.../chat/tokens.ts`                                                                                                              | B4.3 | `CHAT_TOKENS.MCP_STATUS`.                                                                             |
| `libs/backend/rpc-handlers/.../chat/di.ts`                                                                                                                  | B4.3 | Registration + `rekey` wired to `SessionIdResolvedCallbackRegistry`.                                  |
| `libs/backend/rpc-handlers/.../chat/di.spec.ts`                                                                                                             | B4.3 | New describe, 4 cases.                                                                                |
| `libs/backend/rpc-handlers/.../chat/session/index.ts`                                                                                                       | B4.3 | Barrel exports.                                                                                       |
| `libs/backend/rpc-handlers/.../handlers/session-rpc.handlers.ts`                                                                                            | B4.3 | Injects the registry; `session:status` returns `mcpServers` + `notices`.                              |
| `libs/backend/rpc-handlers/.../handlers/session-rpc.handlers.spec.ts`                                                                                       | B4.3 | Harness gains the mock; 3 new cases.                                                                  |
| `libs/backend/rpc-handlers/.../chat/session/chat-session-auth.spec.ts`, `chat-session-resume-activate.spec.ts`, `chat-continue-slash-before-resume.spec.ts` | B4.3 | Two constructor arguments appended. No behaviour change.                                              |
| `libs/frontend/chat-state/.../session-mcp-status.registry.ts`                                                                                               | B4.4 | **NEW.** Session-keyed signal store, dual-key read, LRU 128.                                          |
| `libs/frontend/chat-state/.../session-mcp-status.registry.spec.ts`                                                                                          | B4.4 | **NEW.** 13 cases.                                                                                    |
| `libs/frontend/chat-state/src/index.ts`                                                                                                                     | B4.4 | Barrel exports.                                                                                       |
| `libs/frontend/chat/.../services/chat-message-handler.service.ts`                                                                                           | B4.4 | Handles `SESSION_MCP_STATUS`.                                                                         |
| `libs/frontend/chat/.../components/molecules/mcp-status-chip.component.ts`                                                                                  | B4.4 | **NEW.** The chip, its popover, Authorize routing and the notice row.                                 |
| `libs/frontend/chat/.../components/molecules/mcp-status-chip.component.spec.ts`                                                                             | B4.4 | **NEW.** 31 cases.                                                                                    |
| `libs/frontend/chat/.../components/templates/chat-view.component.ts` / `.html`                                                                              | B4.4 | Mounts the chip under the stats bar.                                                                  |
| `libs/frontend/chat/src/lib/components/index.ts`                                                                                                            | B4.4 | Barrel export.                                                                                        |

No file outside the batch scope was touched. In particular
`sdk-adapter-events.service.ts`, `subagent-stop-hook-handler.*`,
`assistant-message.transformer.*`, `curator-llm-adapter/*`, `memory-curator`,
`chat-streaming`, `vscode-lm-tools`, `sdk-hook.types.ts`, `sdk-hook.parsers.ts`
and `execution/stream-background.ts` were left alone — they show as modified in
this working tree because they belong to the other engineer. No git state
command was run.

---

## The message payload shape

```ts
// MESSAGE_TYPES.SESSION_MCP_STATUS === 'session:mcpStatus'
interface SessionMcpStatusPayload {
  readonly sessionId: string; // SDK UUID once known, else the tabId
  readonly servers: readonly {
    readonly name: string; // the `mcpServersOverride` map key
    readonly status: // the CLI's own value set, left open
      'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | (string & {});
  }[];
  readonly notices: readonly {
    readonly code: 'claude-ai-connectors-disabled';
    readonly message: string; // the CLI's own sentence, trimmed, verbatim
  }[];
}
```

`session:status` gained the same two shapes as optional fields
(`mcpServers?`, `notices?`), so a cold-loaded webview can recover them.

The two backend producers publish a narrower internal union on
`SessionMcpStatusCallbackRegistry` — `{ kind: 'servers', sessionId, servers }`
and `{ kind: 'notice', sessionId, notice }` — and `ChatSessionService` folds
them into the record above before pushing.

---

## Test counts per project

Command:

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/agent-sdk \
  @ptah-extension/rpc-handlers @ptah-extension/chat @ptah-extension/chat-state --skip-nx-cache
```

Header: `NX  Running targets typecheck, lint, test for 5 projects:`
Result: `NX  Successfully ran targets typecheck, lint, test for 5 projects`

`chat-state` stayed in the list — it was touched (the new frontend registry
lives there).

| Project                        | Test suites               | Tests                              | Typecheck | Lint                                   |
| ------------------------------ | ------------------------- | ---------------------------------- | --------- | -------------------------------------- |
| `@ptah-extension/shared`       | 54 passed / 54            | **1278 passed / 1278**             | clean     | clean                                  |
| `@ptah-extension/agent-sdk`    | 86 passed, 1 skipped / 87 | **1431 passed, 2 skipped / 1433**  | clean     | 38 problems, **0 errors**, 38 warnings |
| `@ptah-extension/rpc-handlers` | 93 passed / 93            | **2707 passed, 31 skipped / 2738** | clean     | 19 problems, **0 errors**, 19 warnings |
| `@ptah-extension/chat`         | 61 passed / 61            | **940 passed, 2 skipped / 942**    | clean     | 17 problems, **0 errors**, 17 warnings |
| `@ptah-extension/chat-state`   | 15 passed / 15            | **338 passed / 338**               | clean     | 3 problems, **0 errors**, 3 warnings   |

**Cases added by this batch: 114.**

| Spec file                                          | Cases | Notes                                                            |
| -------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| `session-mcp-status.spec.ts` (shared)              | 20    | **NEW.** Both parsers, including where they deliberately differ. |
| `stream-transformer.spec.ts`                       | +5    | 18 → 23 in the file.                                             |
| `sdk-query-options-builder.cli-notice.spec.ts`     | 12    | **NEW.**                                                         |
| `session-mcp-status.registry.spec.ts` (backend)    | 20    | **NEW.**                                                         |
| `chat-session-mcp-status.spec.ts`                  | 6     | **NEW.**                                                         |
| `session-rpc.handlers.spec.ts`                     | +3    | 76 → 79 in the file.                                             |
| `chat/di.spec.ts`                                  | +4    | 4 → 8 in the file.                                               |
| `mcp-status-chip.component.spec.ts`                | 31    | **NEW.**                                                         |
| `session-mcp-status.registry.spec.ts` (chat-state) | 13    | **NEW.**                                                         |

Baseline check against the B3 report: `shared` was 53 suites / 1258 tests, now
54 / 1278 — exactly +1 suite and +20 cases. Every lint warning in every project
is `max-lines` or a pre-existing rule; grepping each lint output for
`session-mcp-status`, `mcp-status-chip` and `cli-notice` returns nothing. The
one warning that touches a file this batch edited is
`sdk-query-options-builder.ts` at 866 lines — it was already over the 700-line
warn ceiling before B4.

---

## Decisions

1. **The two agent-sdk callbacks are a DI fan-out registry, not
   `StreamTransformConfig` fields.** The batch text asks for
   `onMcpServers?` on `StreamTransformConfig` and `onCliNotice?` on "the same
   config surface". There is no such shared surface: `StreamTransformer` gets a
   config built by `SdkAgentAdapter`, `SdkQueryOptionsBuilder` gets a
   `QueryOptionsInput` built by `SessionQueryExecutor`, and neither reaches
   `ChatSessionService`, which B4.3 names as the consumer. Threading a callback
   from there would have meant widening `IAgentAdapter` — a port shared with
   `cli-agent-runtime`, `platform-vscode` and `platform-electron` — plus edits
   to `sdk-agent-adapter.ts`, `sdk-adapter-callback-registry.ts` and
   `wiring/sdk-callbacks.ts`, all outside this batch's scope and one of them in
   the other engineer's file set. `SessionIdResolvedCallbackRegistry` is the
   established precedent for exactly this shape (its own file header explains
   why a fan-out was added ALONGSIDE the single-slot setter rather than
   replacing it), both producers are already `@injectable`, and B4.3 already
   names that registry as the re-key source. Config callbacks were NOT added as
   well: with no caller they would be dead code.

2. **The registry injection is REQUIRED on `StreamTransformer` and
   OPTIONAL-LAST on `SdkQueryOptionsBuilder`.** `StreamTransformer` has one
   construction site outside DI. `SdkQueryOptionsBuilder` has eleven, all
   through `new ctor(...args: unknown[])` with positional stubs and several of
   them shorter than the parameter list. Inserting a required parameter in the
   middle of that constructor would silently re-bind ten existing stubs to the
   wrong fields — a worse defect than the one this fixes — so the parameter goes
   last, after the existing optional `codeSymbolPromptInjector`, and the publish
   site uses `?.`. `registerSdkServices` registers the token unconditionally, so
   every real host has it.

3. **The Zod schema lives in `messages/schemas.ts` and the webview uses a
   hand-written parser.** The batch asks for both, and they are not
   interchangeable: `messages/schemas.ts` is NOT on the `@ptah-extension/shared`
   barrel, and neither is `execution/schemas.ts` — that is what keeps the 304 kB
   Zod runtime out of the webview's initial bundle (TASK_2026_187 Unit 10).
   Exporting it would have been a bundle regression. So the schema is imported
   by relative path in its spec, and the frontend parses with
   `parseSessionMcpStatusPayload`, which is on the barrel. The two agree on
   everything except an unknown notice code: the parser drops it and keeps the
   servers, the schema rejects the payload. That asymmetry is deliberate and
   pinned — the backend is the producer, so an unknown code there is a contract
   break, while the webview's job is to render whatever it can.

4. **`SESSION_MCP_STATUS` rides the direct channel, and the publish site says
   why.** `agent-sdk/CLAUDE.md` forbids a `MESSAGE_TYPES` push for TURN STATE
   because of the three-channel ordering race (`session:turnEnded` direct,
   chunks batched, `session:stats` direct). MCP status is exempt for a
   structural reason rather than as an exception: it arrives ONCE per session at
   the SDK `init` message, never changes mid-turn, and nothing in the chunk
   stream depends on its arrival order — so there is no ordering relationship
   for a race to break. That reasoning is written at four sites: the
   `MESSAGE_TYPES` entry, the registry's file header, the `StreamTransformer`
   publish site, and `ChatSessionService.subscribeToMcpStatus`, each ending with
   "do not read this as a precedent for pushing status".

5. **The backend registry MERGES on `rekey` rather than dropping one side.**
   The stderr notice is written while the CLI starts, under the tabId; the
   `init` message arrives after it connects and may already have created the
   real-id entry. Dropping either half loses a real observation. The real id's
   server list wins when it has one; an empty list at the real id does NOT beat
   a populated placeholder list, because "no servers yet" and "no servers" are
   indistinguishable at that point.

6. **`session:status` OMITS the two new fields rather than emptying them.** An
   empty `mcpServers` array is a real answer — "this session has no MCP
   servers" — and the chip renders it as such. Returning `[]` for a session the
   backend never recorded would hide the chip on a session whose `init` message
   simply has not arrived yet. The chip's recovery read makes the same
   distinction: it writes nothing when both fields are absent.

7. **The frontend registry answers on TWO keys.** The backend re-keys its own
   record when the SDK UUID arrives, but a push that already reached the webview
   under the tabId stays under the tabId — the channel carries no re-key event.
   `statusFor(sessionId, tabId)` therefore consults both, SDK id first. Cheaper
   and more honest than mirroring a re-key the frontend never hears about.

8. **The chip is a smart component in `chat`, not an atom in `chat-ui`.** It
   reads a registry, makes four RPC calls and navigates. `chat-ui`'s neighbours
   are stateless by rule, and `session-stats-summary.component.ts` — the file
   the other chips live in — is already 861 lines. `chat-ui` was not touched.

9. **`failed` is actionable, not only `needs-auth`.** The user's next move is
   the same for both — open the surface that owns the connection — and offering
   nothing on a failed server is precisely what made the original defect
   invisible. `pending` and `disabled` are not actionable: one resolves itself,
   the other is a deliberate choice.

10. **The `smithery` key opens the Marketplace Smithery surface and calls NO
    RPC.** From the B2 report: a Connections-API install appears in the session
    as ONE server named `smithery`, backed by a namespace endpoint that can hold
    several connections in different states. There is no single connection for
    the chip to authorize, and `openSmitherySetup` needs a `serverKey` the
    session does not carry. The Smithery surface's Connections list (B3) has the
    per-connection Authorize buttons. A spec pins that neither
    `openSmitherySetup` nor `connectOAuth` fires.

11. **An `oauth-` key with no manifest record falls back to Connectors.**
    `connectOAuth` needs a `serverUrl`, which only `listOAuthConnected`
    supplies. Rather than fail silently on a key whose record was removed, the
    chip hands the user the surface that can rebuild the connection.

12. **The catalog match goes through the record's `serverUrl`, never the key
    text.** A key like `oauth-mcp.sentry.dev-mcp` contains `sentry` by
    coincidence of the host name; matching on that would attach the wrong label
    the first time two providers share a word. URLs are normalized for trailing
    slash and host case, the same rule B3 adopted for the Connectors surface.

13. **The provider name in the notice is read on demand, not from
    `AuthStateService`.** That service's `selectedProviderId` defaults to
    `'openrouter'` until something calls `loadAuthStatus()`, which nothing in the
    chat surface does. Naming the wrong provider in an explanation is worse than
    naming none, so the chip calls `auth:getAuthStatus` when the popover opens
    AND a notice exists, and falls back to "another provider" when the read
    fails. Two specs pin both halves.

14. **The notice row is worded as information.** Heading "claude.ai connectors
    are not loaded", body "…are disabled because Ptah runs this session on
    `<provider>`. Switch the provider to Claude login to load them.", styled with
    the `info` token, linked to Settings. A spec asserts the rendered text
    contains neither "error" nor "failed".

15. **The recovery read runs at most once per session id.** A cold-loaded
    webview missed the one `session:mcpStatus` push the session will ever send.
    The effect fires only when the id changes, nothing is recorded, and the id
    has not been read before — so a session the backend genuinely has no record
    for costs one call, not one per change detection pass.

16. **The chip owns its own spacing.** It was first mounted inside a padded
    wrapper in `chat-view.component.html` with `empty:hidden`, which does not
    work: Angular leaves comment anchors inside the wrapper, so `:empty` never
    matches and every session with no MCP servers got a padded empty strip. The
    wrapper moved INSIDE the component's `@if`, and the host is
    `display: block` with no padding, so it collapses to zero height.

17. **A blank `name` on an OAuth record is treated as absent.** Found by a spec
    that expected the catalog label and got an empty string: `??` accepts `''`.
    Fixed with `||` and a comment naming the case.

---

## Not done / notes for later batches

- **The `agent-sdk` lint warning count is 38, up from the 36 the B2 and B3
  reports measured.** Both new ones are `max-lines`, on files the other engineer
  is editing (`subagent-stop-hook-handler.ts`, `assistant-message.transformer.ts`
  and `curator-llm-adapter/*` all grew in this working tree). Nothing this batch
  wrote draws a warning; `sdk-query-options-builder.ts` was already over the
  ceiling at 700+ before B4 and is now 866.

- **B5 docs**: `connectors.md` and the chat page need the MCP chip described —
  the count is `connected` normally and `connected/total` when something needs
  attention, amber for `needs-auth` or `failed`, and the Authorize button routes
  by key (`smithery` → the Smithery surface, `oauth-*` → the browser flow,
  anything else → Connectors). The claude.ai connectors row is worth its own
  short section: Ptah cannot configure those connectors, it can only explain why
  they are absent and point at the provider switch.

- **`session:status` is now the recovery path for the chip.** If B5 documents
  the RPC surface anywhere, `mcpServers` and `notices` are additive and optional,
  and their absence means "nothing recorded", not "no servers".

- **No `MESSAGE_TYPES` entry was added for a chip refresh.** The chip has no
  live-update path beyond the one init push and the one recovery read, which
  matches the data: the CLI reports MCP status once per session and never
  revises it. If a future task adds mid-session MCP reconfiguration, this is the
  channel to extend, not a new one.

- **Nothing was committed.**
