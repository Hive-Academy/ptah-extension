# TASK_2026_156 — Batch 3 Implementation Report (GatewayCommandService control plane + Electron host collaborators)

**Developer**: senior-backend-developer | **Date**: 2026-07-10
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang` (branch `fix/gateway-turn-hang`)
**Scope**: plan §9 Batch 3 — C10, C11, C12, C14, C15, M12, plus the register.ts line Batch 1 Decision 1 deferred here. NOT committed (per instructions). No touches to `gateway-chat-bridge`, `gateway.service.ts`, the Discord adapter, command-registration JSON, or `IMessagingAdapter` (Batches 2/4 own those; their concurrent edits are visible in the worktree and were left alone).

---

## Per-Item Status

| Item | Status | File(s) |
|---|---|---|
| C10 command service | DONE | `libs/backend/messaging-gateway/src/lib/commands/gateway-command.service.ts` — `@injectable() GatewayCommandService implements IGatewayCommandHandler`. Injects LOGGER, WORKSPACE_PROVIDER, BINDING_STORE, CONVERSATION_STORE, ATTACHED_SESSION_REGISTRY, SESSION_RESUMABILITY_CHECKER, TURN_TRACKER, SESSION_LISTER, SESSION_ACTIVITY_PROBE — deliberately NO MessageStore and no event emitter, so a command structurally cannot persist a gateway message or become an agent turn (AC-1.3, Data-6). Implements the full §4.5 behavior matrix: shared preamble (rate limit → approval gate → dispatch), shared thread-only + mid-turn `mutatingGate` (returns a discriminated union, no casts), `/sessions`, `/session use`, `/new`, `/workspace list`, `/workspace use`, and the autocomplete provider (`session-pick` / `workspace-pick`, choices ≤ 25, values = uuid / exact path / digest fallback for >100-char paths). Top-level `catch (error: unknown)` maps any failure to a fixed generic ephemeral reply. |
| C11 service spec (plan §7 numbering: the spec) | DONE | `libs/backend/messaging-gateway/src/lib/commands/gateway-command.service.spec.ts` — 55 tests, every refusal branch AND every success branch of §4.5 (details in the security table + AC list below). Constructor-injected fakes; real `AttachedSessionRegistry` + real `ConversationTurnTracker`; real `fs.access` against `process.cwd()` / `os.tmpdir()` / a nonexistent tmp path for AC-6.3. |
| C12 reply formatting (plan §7 numbering: command-replies) | DONE | `libs/backend/messaging-gateway/src/lib/commands/command-replies.ts` — pure functions + `COMMAND_REPLIES` fixed strings (no user data in any refusal, SEC-6): `humanizeLastActive`, `shortSessionId`, `workspaceBasename`, `disambiguateWorkspaceLabels` (basename → grows `parent/name` segments for same-named folders), `truncateChoiceText` (100-char Discord cap), `sessionChoiceName` (`name · uuid8 · humanized`), `formatSessionsReply` (current-marker, truncation note, empty message, parent-channel appendix), `formatWorkspaceListReply` (25-cap + truncation, current marker via injected normalizer), confirmation/audit builders for the three mutations. Platform-neutral for future Telegram/Slack parity (AC-8.3). |
| C14 Electron session lister | DONE | `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.ts` — `MetadataGatewaySessionLister implements IGatewaySessionLister` per plan §4.2: reads `ptah.sessionMetadata` from the active-or-default delegate AND every registered workspace storage (read-only — never switches the active workspace), Zod-validates each entry at the file-I/O boundary (malformed entries skipped, SEC-8 posture), filters by `normalizeWorkspacePath(entry.workspaceId) === normalizeWorkspacePath(requestedRoot)` (imported from messaging-gateway so lister membership and allowlist/turn resolution agree byte-for-byte), excludes `isChildSession`, dedupes by `sessionId` (max `lastActiveAt` wins), sorts desc, caps at 25 with `truncated` (AC-2.2). Constructor takes a structural `WorkspaceMetadataStorageLike` seam (get / getAllWorkspacePaths / getStorageForWorkspace) that `WorkspaceAwareStateStorage` satisfies. |
| C15 lister spec | DONE | `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.spec.ts` — 9 tests: cross-storage aggregation, normalized-workspaceId filtering (separators/case/trailing slash), child-session exclusion, dedupe-keep-freshest, desc sort, 25-cap + truncated, malformed-entry/non-array tolerance, missing-name default, empty-key case. |
| M12 phase-2 DI | DONE | `apps/ptah-electron/src/di/phase-2-libraries.ts` — registers `GATEWAY_TOKENS.GATEWAY_SESSION_LISTER` (factory over `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` → `MetadataGatewaySessionLister`) and `GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE` (factory: resolves `TOKENS.AGENT_ADAPTER` lazily inside `isActive`, wraps `isSessionActive(SessionId.from(uuid))`, `catch (error: unknown)` → `false` since an unresolvable adapter / invalid uuid means nothing can be running) — both immediately after the `GATEWAY_TOKEN_VAULT` registration and BEFORE `registerMessagingGatewayServices`, matching the register.ts host-precondition doc. |
| Deferred register.ts line (Batch 1 Decision 1) | DONE | `libs/backend/messaging-gateway/src/lib/di/register.ts` — `registerSingleton(GATEWAY_TOKENS.GATEWAY_COMMAND_SERVICE, GatewayCommandService)` with a comment pointing at the two host-registered collaborators. Registration is lazy; nothing resolves the token until Batch 4 wires `GatewayService → adapter.setCommandHandler`, so VS Code/CLI containers (which never call this register helper) are unaffected. |

## Security-Matrix Coverage (plan §5 → code → spec)

| SEC | Enforced where (my scope) | Spec coverage (gateway-command.service.spec.ts unless noted) |
|---|---|---|
| SEC-1 no raw paths/ids trusted | `resolveSessionPick` / `resolveWorkspacePick` resolve UNTRUSTED picks by closed-set membership only, against sets re-derived at execution time (`IGatewaySessionLister.listForWorkspace`, `IWorkspaceProvider.getWorkspaceFolders()`); workspace matching = exact normalized path → digest of an allowlisted entry → unique basename/prefix; session matching = exact uuid → unique uuid-prefix/name | pick-matches-nothing (valid-looking uuid absent from list), ambiguous prefix, raw attacker path refused, digest pick resolves to the allowlisted folder, unique uuid-prefix/basename picks resolve |
| SEC-2 allowlist source | Only `workspace.getWorkspaceFolders()` feeds `/workspace list` and `/workspace use` validation; comparison via Batch-1 `normalizeWorkspacePath` exact-root equality (no subpaths) | subpath-of-allowlisted-folder refused; `/workspace list` contains only provider basenames; conversation-root-revoked fail-closed test |
| SEC-3 contention | `/session use` gate order per §4.5: `isResumable` → `AttachedSessionRegistry.bindingFor` (≠ this binding ⇒ refuse, no stealing) → `ConversationStore.findBySessionId` (row owned by different conversation ⇒ refuse) → `ISessionActivityProbe.isActive` ⇒ refuse; registry kept consistent (attach new / detach old on session-use, detach on `/new` and `/workspace use`) | AC-3.4 registry half + durable half, AC-3.5 probe refusal, registry-swap assertion on success, `/new` + `/workspace use` detach assertions |
| SEC-4 switch clears session | `/workspace use` writes ONLY via `ConversationStore.setWorkspaceRootAndClearSession` (single txn, Batch 1) then detaches the old uuid; `/session use` re-gates `isResumable(uuid, effectiveRoot)` before linking; no-op path keeps the session | switch test asserts the txn method + detach; resumability-false refusal; AC-6.5 no-op keeps session and makes zero writes |
| SEC-5 approval gate | `handleCommand` preamble: `bindings.findByExternal` — missing/rejected/revoked → fixed generic refusal; pending → guidance WITHOUT the pairing code; never `upsertPending`; `handleAutocomplete` returns `[]` for any non-approved binding | unknown/pending/rejected/revoked tests (incl. assertion the reply does not contain the stored pairing code and `upsertPending` is never called), autocomplete-[] test |
| SEC-6 disclosure | All list/error/refusal output is `ephemeralText` (fixed strings, no session/workspace data on refusals); `publicText` is set ONLY on successful mutations (audit line) | outcome-shape assertions throughout: `publicText` undefined for lists/errors/no-ops, defined for the three mutation successes. (Guild allow-list + ephemeral rendering are adapter concerns → Batch 4 / C13, M5.) |
| SEC-7 rate limit | Sliding-window 60/min per `allowListId` inside `GatewayCommandService`, shared by `handleCommand` and `handleAutocomplete`, own counter map (commands bypass `handleInbound`) — same shape/constant as `gateway.service.ts` | 61st command dropped (and store not consulted), autocomplete capped by the same window, second guild unaffected |
| SEC-8 boundary validation | Adapter-boundary Zod (`discord-command.schema.ts`) is Batch 4 (C13). Within this batch: Zod at the lister's file-I/O boundary (state-JSON entries), strict TS + `catch (error: unknown)` throughout, and every chat-supplied string treated as untrusted membership input | lister spec: malformed entries / non-array values skipped; service spec: unexpected errors → fixed generic reply |

## AC coverage delivered by this batch's specs

US-2: AC-2.1 (list shape + effective-root precedence incl. conversation-pinned), 2.2 (truncation), 2.3 (empty), 2.4 (current marker), 2.5 (parent channel = binding-effective + thread note), 2.6 (gate). US-3: AC-3.1–3.9 (untrusted revalidation, ambiguity, resumability, both contention halves, activity probe, mid-turn refusal + NFR-4 other-conversation isolation, registry swap, parent-channel refusal, no workspace write). US-4: AC-4.1/4.2/4.3/4.5/4.6 (AC-4.4 is the bridge's first-turn path — Batch 2). US-5: AC-5.1–5.6 (disambiguation, provider-verbatim source, zero-folders, 25-cap, parent channel, gate). US-6: AC-6.1–6.9 minus adapter rendering (raw/subpath refusal, on-disk miss, session-preserving no-op incl. case-insensitive equality, txn switch + detach + "new session" confirmation, no binding/active-folder writes, digest + basename picks). AC-1.3/Data-6 structurally (no MessageStore/emit surface — asserted).

## Decisions Taken

1. **`GatewayAutocompleteRequest` gained a required `platform: GatewayPlatform` field** (edit to Batch 1's C9 types file). The plan's §4.4 shape omitted it, but the SEC-5 autocomplete gate requires `BindingStore.findByExternal(platform, externalChatId)`. Batch 4's adapter must populate it with `'discord'`.
2. **Lister "default storage" read**: `WorkspaceAwareStateStorage` exposes no direct default-storage accessor, so C14 reads the **active-or-default delegate** via `storage.get()` plus every registered workspace storage. When no workspace is active this IS the default storage (plan §4.2 letter); when one is active, that delegate is one of the registered storages and dedupe absorbs the overlap. No active-workspace switch either way.
3. **Lister workspaceId matching uses messaging-gateway's `normalizeWorkspacePath`** (resolve → forward slashes → lowercase → strip trailing slash) rather than `getForWorkspace`'s forward-slash-only compare — a strict superset that guarantees the `/sessions` list, `/session use` validation, and the turn resolver agree (AC-7.2 intent).
4. **Probe failure posture = inactive**: if `TOKENS.AGENT_ADAPTER` cannot resolve or the uuid is not a valid `SessionId`, no session can be running, so `isActive` returns `false` (logged). The uuid was already closed-set-validated before the probe runs.
5. **Durable-row contention reuses the "in use elsewhere" reply** (same refusal for the registry half and the `findBySessionId` half of AC-3.4) — one message, no extra disclosure.
6. **Single rate-limit window shared by commands + autocomplete** (one counter map, matching the plan's SEC-7 row which names both entry points).
7. **`mutatingGate` returns `{ refusal } | { threadId }`** so strict TS needs no non-null casts after the thread-only check.
8. **Exact-normalized-path duplicates** in the folder list (entries normalizing to the same root) resolve to the first entry — they denote the same folder, still closed-set.

## Conflicts / Deviations to flag

- Prompt/plan numbering note: the task prompt described "C11 (reply formatting), C12 (service spec)"; plan §7 defines C11 = service spec, C12 = command-replies. Both files exist; statuses above use the plan's numbering with filenames to disambiguate.
- The `GatewayAutocompleteRequest.platform` addition (Decision 1) is the only contract change to a Batch 1 artifact.

## Verification (from the worktree root)

1. `npx nx run-many -t typecheck --projects=messaging-gateway` → **Successfully ran target typecheck**.
2. `npx nx run ptah-electron:typecheck` → **Successfully ran target typecheck** (tsc over tsconfig.app.json).
3. `npx nx run ptah-electron:build-main:development` → **Successfully ran target build-main** (+ 20 dependent tasks; the `import.meta` esbuild note is pre-existing).
4. `npx nx test messaging-gateway` → **14 passed / 1 skipped suites, 197 passed / 32 skipped tests** (skips = pre-existing better-sqlite3 native-ABI guard, same as Batch 1). Isolated: `gateway-command.service.spec.ts` → **55/55 passed**.
5. `npx nx test ptah-electron` → **13 passed / 1 skipped suites, 140 passed / 4 skipped tests**. Isolated: `metadata-gateway-session-lister.spec.ts` → **9/9 passed**.
6. `npx nx lint messaging-gateway --skip-nx-cache` → **All files pass linting**.
7. `npx nx lint ptah-electron --skip-nx-cache` → **0 errors**, 4 pre-existing warnings, none in files touched by this batch (`electron-adapters.ts`, `electron-browser-capabilities.ts`, `update-rpc.handlers.spec.ts`).

## Files Created (5)

- `libs/backend/messaging-gateway/src/lib/commands/gateway-command.service.ts`
- `libs/backend/messaging-gateway/src/lib/commands/gateway-command.service.spec.ts`
- `libs/backend/messaging-gateway/src/lib/commands/command-replies.ts`
- `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.ts`
- `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.spec.ts`

## Files Modified (3)

- `libs/backend/messaging-gateway/src/lib/commands/gateway-command.types.ts` (autocomplete `platform` field — Decision 1)
- `libs/backend/messaging-gateway/src/lib/di/register.ts` (deferred `GATEWAY_COMMAND_SERVICE` registration)
- `apps/ptah-electron/src/di/phase-2-libraries.ts` (M12 host registrations + imports)

## Handoff notes for Batch 4

- The adapter should call `GATEWAY_COMMAND_SERVICE` through `IGatewayCommandHandler` only. Build `GatewayCommandInvocation` with `externalChatId` = parent channel id and `threadId` present iff inside a thread; build `GatewayAutocompleteRequest` including the new required `platform` field.
- Render `ephemeralText` via ephemeral `editReply`; when `publicText` is present, additionally `sendMessage` into the thread (`conversationId = threadId`).
- Autocomplete choice `value`s are already ≤ 100 chars (uuid / exact path / `#<digest>`), names pre-truncated; the service caps at 25 — the adapter can pass them straight to `interaction.respond`.
- `GatewayService` wiring (M7-part-2): inject `GATEWAY_TOKENS.GATEWAY_COMMAND_SERVICE` and call `adapter.setCommandHandler?.(commandService)` in `wireAdapter`/`maybeStartDiscord`; no cycle (this service never injects `GatewayService`).
