# Code Logic Review, Batch 4 (native result wiring)

Read-only review of the uncommitted diff in the `codex-usage-pricing` worktree. Nothing was run
(no tests, lint, typecheck, diagnostics). The foreign `task-tracking/landing-live-demo/HANDOFF.md`
was ignored. I read the diff in full, and read the unchanged `register.ts` adapter factory and
`session-metadata-store.ts` write path in context. Some long hunks of the stream file were
read through truncated views, so claims about them are marked as such.

Score: 5.5/10. Verdict: REVISE.

## Blocking

### B1. Production wiring of the usage store is overridden, so nothing is persisted or restored

- `libs/backend/agent-sdk/src/lib/di/register.ts:1097-1105` builds the real `CodexChatAdapter` with
  `{ ...ports, logger, approvals, metadata: createCodexChatMetadataPort(identities) }`. The
  `metadata` key comes after the spread. It replaces the port that Electron built at
  `apps/ptah-electron/src/di/codex-runtime-composition.ts:533`
  (`createCodexChatMetadataPort(lookup, metadataStore)`). The override passes no `usageStore`.
- Result for every host, Electron included:
  - `readUsage` and `persistUsage` are `undefined`.
  - `codex-chat-adapter.ts:~307` always starts a fresh owner.
  - A resumed session is marked partial through `markMissingCheckpoint`.
  - `persistUsage` resolves silently (`codex-chat-adapter.ts:~584`, `?? Promise.resolve()`).
  - No checkpoint is ever written.
- Consequences:
  - "Resume continues lifetime totals" is not met in the shipped path.
  - The N1 fix cannot run in production.
  - After a restart, lifetime cost is always unavailable.
  - Persistence is skipped with no log, which is the silent success-looking failure the task forbids.
- The unit specs construct the adapter directly, so they cannot see this. The Electron change at
  `:533` is dead code as far as the adapter goes.
- Fix:
  - Make `register.ts` honour the composition's usage capability. For example, have the Electron
    ports expose the `SessionMetadataStore` usage methods, and let the factory pass them to
    `createCodexChatMetadataPort(identities, usageStore)`. Alternatively, spread
    `ports.metadata`'s `readUsage` and `persistUsage` into the override.
  - Add a wiring spec that resolves `CODEX_CHAT_ADAPTER` from the container and asserts that
    `readUsage` and `persistUsage` are callable.
  - Log at warn level once when the port is absent instead of silently skipping.
  - Decide explicitly for VS Code, CLI and TUI: "no durable store, so resume is partial" is
    acceptable only if it is documented and labelled with an `optional-capability` audit.

## Serious

None beyond B1.

## Moderate

- M1. `codex-chat-adapter.ts:~307-309`: `readUsage` is awaited with no try/catch. A thrown read
  rejects the session open. Wrap it, log with a real `Error`, and fall back to a fresh owner
  with `markMissingCheckpoint`.
- M2. `codex-chat-turn-stream.ts:~199-209`: `billingMode` is forced to `'unknown'` whenever
  lifetime coverage is partial. A fully observed turn therefore loses its own turn cost for the
  rest of the session after any earlier gap, such as a model change, a resume without a
  checkpoint, or one turn with no usage.
  - This is safe (never $0), but it over-withholds. Decide the turn cost from turn evidence
    only, and let only the lifetime value depend on lifetime coverage.
  - `model-change` (`codex-session-usage-owner.ts:~161`) makes lifetime cost permanently
    unavailable after any user model switch. That is a common action, so confirm it is intended.
- M3. `codex-chat-turn-stream.ts:~198-200`: when no thread record matches, the price model falls
  back to `session.settings?.model`. This is a configured alias rather than the model that
  produced the usage. A mismatch could price a turn at the wrong model's rate.
  - Prefer returning an unknown model, which gives a null cost.
  - The thread-match key compares `thread.threadId` with `session.id`. That holds only while
    the session id equals the root thread id (the metadata port enforces it). Use
    `context.identity.threadId` to be explicit.
- M4. `codex-session-usage-owner.ts:~114-118`: the relaxed restore accepts a self-parent
  (`parentThreadId === threadId`) and a missing root whenever coverage is `partial`. This is
  consistent with the N1 fix, but a self-parent is corruption, not an orphan. Keep that check
  unconditional.
- M5. `session-metadata-store.ts:1236`: the persist guard throws on any restore diagnostic. For
  owner-produced partial checkpoints, the relaxed restore avoids diagnostics, which I confirmed
  by reading the code, and the spec at `codex-session-usage-owner.spec.ts:25` covers the
  round-trip. Any future diagnostic raised from restore will again turn into a swallowed
  persist failure. This is acceptable now.
- M6. The metadata write at `session-metadata-store.ts:1260` stores `totalCost: 0` for native
  sessions. It was added in a previous batch. A session list that reads this field shows $0 for
  unknown cost, so ensure no consumer renders it. This is outside the scope of this batch, but
  it conflicts with "never $0".

## Minor

- m1. Billing mode is resolved once, at open (`codex-chat-host-ports.ts:~462`). A later
  `auth.json` change within the same open session is not seen. Acceptable.
- m2. N3 was confirmed as no change needed. The claim matches the code.
- m3. The `readUsage` and `persistUsage` option shape in `codex-chat-adapter.ts` uses
  `checkpoint?: unknown`. This is fine, because it is validated by `restore`.

## Checklist results

| Check | Result |
| --- | --- |
| Auth mode and owner reach each native session | Code path OK (`codex-chat-adapter.ts:~304-323,~411-430`), but see B1 for persistence |
| Root thread id wired | OK: `context.identity.threadId` |
| Every observed terminal emits a priced turn and lifetime `sessionStats` | OK in the stop/drain paths (read in full) and via the projected result callback (`finally { publishStats }`). A turn that ends by exception without a terminal event emits none, which matches "observed terminal" |
| billingMode mapping | OK (`codex-chat-host-ports.ts` `resolveBillingMode`): explicit mode takes precedence, a missing or ambiguous file gives unknown. The ENOENT path carries an audit tag. The other errors are logged without the path or content |
| Never $0 or an invented rate | OK: `usageObserved` is passed; no rate table was added; turn and lifetime cost are null on the unavailable paths |
| Resume continues lifetime | NOT met in production (B1); met in unit specs |
| Different `CODEX_HOME` homes isolated | OK: the billing mode is read from `profile.normalizedHome`, and the spec covers two homes |
| N1 accept never builds an unrestorable state; persist failure caught and logged | Logic fixed in the owner (`:203-208`, `:114-119`). The catch logs a real `Error` (`turn-stream:~180-188`). Unreachable in production per B1 |
| N2 `usage-regression` code | OK (`session-metadata-store.ts:212,1253`) |
| N3 | Confirmed no change needed |
| Provenance array shape | OK: wrapped as `[priceProvenance]` for both turn and lifetime |
| Stream change limited to stats construction | OK as far as read: no MCP or transport change. The threading of `observeUsage` and `publishStats` through `drainInterruptedTurn` is the only structural touch. Watch for conflicts with PR #881 |
| Strict TS, logger, degradation audit | No `any`, `ts-ignore` or `as unknown as` seen. Audit tag present on the ENOENT path. The persist and message-count catches log |
| Other hosts compile | Both construction sites keep the optional `usageStore` parameter and the optional port members, so signatures stay compatible. This is by reading only |
| Claude path unchanged | Yes, no Claude files in the diff |
| Frontend Codex special case | None |

## Five logic questions

1. Silent failure: with the B1 override, persistence is skipped with no signal.
2. Unexpected user action: switching models mid-session, or resuming after a restart, yields
   permanently unavailable lifetime cost (M2, B1).
3. Wrong answer from data: a settings-alias model priced when the evidence model is absent (M3).
4. Dependency failure: `readUsage` rejection fails the open (M1). A persist rejection is
   handled.
5. Missing: a container-level wiring spec (B1).

## Verdict

REVISE. Fix B1 first, because it defeats resume continuity and N1 in the real composition.
Address M1-M3 in the same pass. Confidence: HIGH on B1, because I read the factory and the
override. MEDIUM on the stream-file details, because some hunks were read through truncated
views. No tests were run.

## Round 1

Read-only re-review of the uncommitted Revision 1 diff. Nothing was run (no tests, lint,
typecheck, diagnostics). `task-tracking/landing-live-demo/HANDOFF.md` was ignored. Hunks of
`codex-chat-turn-stream.ts` and `codex-chat-adapter.ts` were read in part through truncated
views, so claims about their middle sections are by reading only.

Score: 8/10. Verdict: APPROVE.

### Original findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 usage port overridden | FIXED | `register.ts:1102-1108` keeps `readUsage` and `persistUsage` from `ports.metadata` and takes `save` and `completedTurn` from the initialized lookup. Electron now passes the store at `codex-runtime-composition.ts:533`. |
| B1 registration-level spec | COVERED | `register.codex-runtime.spec.ts:25-63` resolves `CODEX_CHAT_ADAPTER` from the container through `registerCodexChatServices`, then calls both wired functions and asserts the host spies were reached. This is the production factory path. |
| M1 read rejection | FIXED | `codex-chat-adapter.ts:307-325` catches the read, logs a real `Error` with a `reported` audit tag, and marks the owner partial. Spec: `codex-chat-turn-lifecycle.spec.ts:365-369`. |
| M2 over-withholding | FIXED | Turn price is computed from turn evidence and accumulated in the owner (`codex-session-usage-owner.ts` `recordTurnPrice`, `lifetimePrice`). A model switch no longer marks coverage partial. Spec at `lifecycle.spec.ts:320`. |
| M3 alias pricing | FIXED | `turn-stream.ts:~190-203` takes the model from the root-thread record keyed by `context.identity.threadId` and `session.turnId`. An absent model gives `calculateExactMessageCost('')`, which returns null cost (`pricing.utils.ts` unknown path). Spec at `:350`. |
| M4 self-parent | FIXED | `usage-owner.ts:~133` rejects self-parent unconditionally. Spec at `usage-owner.spec.ts:34`. |
| M5 persist guard | FIXED | Guard now uses `isRestoredCheckpoint()` (structural validity), and the regression code is `usage-regression` (`session-metadata-store.ts:1267-1272`). Spec at `store.spec.ts:2246`. |
| M6 `$0` metadata | FIXED | `nativeCheckpointCost` (`session-metadata-store.ts:200-205`) returns null unless coverage is complete, pricing is complete, and `throughRevision === revision`. `totalCost` becomes `number | null` (`:353`). Line 1225 keeps the Claude value for non-native rows. |

### New-regression checks

- Other hosts: `createCodexChatMetadataPort(store, usageStore?)` keeps the second argument
  optional. Only Electron passes it. The VS Code and CLI roots do not construct a metadata port
  of their own, and the optional members mean they compile unchanged. They get partial resume
  and one `optional-capability` warn per adapter (`codex-chat-adapter.ts:598-611`). No
  `exactOptionalPropertyTypes` is set, so `readUsage: undefined` in `register.ts` is accepted.
- `SessionMetadata.totalCost: number | null`: a grep of readers of the metadata field found no
  consumer that does arithmetic on it. The stats consumers read `stats?.totalCost`, which is a
  different type. Moderate residual risk is listed as R2.
- Never `$0` for missing evidence: unobserved turns record `{ totalCost: null }`, which sets
  `complete=false` for good. Old checkpoints without `pricing` restore with `complete=false`
  unless tokens are zero. Unknown billing mode, unknown model and unverified cache semantics all
  return null from `calculateExactMessageCost`.
- No invented rates: pricing is entirely delegated to `calculateExactMessageCost`.
- Stream file: the changes read are limited to stats construction, `observeUsage`, and threading
  `publishStats` through the interrupt drain. No MCP or transport change. The overlap with PR
  #881 remains a merge risk.
- Strict TS: no `any`, `ts-ignore` or `as unknown as`. The spec uses `as CodexChatAdapterPorts`
  on a partial object and `Reflect.get`, which is acceptable in a spec.
- Logging: the new catches use the injected logger with a real `Error`. The auth.json ENOENT
  path carries `optional-capability`. The non-ENOENT branch logs a fixed message with a new
  `Error` and does not leak the path.
- Claude path, frontend and MCP: untouched in the diff.

### Findings

- R1 (Moderate) `codex-chat-turn-stream.ts:~175-216` (`publishStats`): no once-per-turn guard.
  `recordTurnPrice` adds to `knownCost` on every call. If both the normal result callback and
  the interrupted-terminal path ever ran for one turn, the price would be added twice. By
  reading, the two paths are exclusive (the stop path skips `projection` handling and returns),
  so this is latent, not live. Add a `published` flag cheaply.
- R2 (Moderate) `session-metadata-store.ts:353`: widening `totalCost` to `number | null` is
  type-checked by reading only. Confirm with the scoped typecheck of agent-sdk, rpc-handlers and
  all four hosts that no reader dereferences it as `number`.
- R3 (Minor) `codex-chat-turn-stream.ts:~308-312`: `publishStats` runs in a `finally` after
  `callbacks.result`. If `deps.stats` throws, it can replace the result error. Wrap the stats
  callback or log it.
- R4 (Minor) `usage-owner.ts` `lifetimePrice`: `knownCost` is accumulated across turns that may
  have run under different billing modes (for example a switch from `chatgpt` to API key in
  `auth.json` between resumes). The basis label then reflects only the current mode. Edge case;
  consider recording the mode in provenance or marking coverage partial on a change.
- R5 (Minor) The registration spec asserts through a private `ports` field via `Reflect.get`.
  It will break on a rename but still proves the wiring.

### Five logic questions (round 1)

1. Silent failure: a missing durable store now logs a warn once; a failed read or persist logs
   an error. No silent success path found.
2. Unexpected action: a model switch keeps lifetime cost; a resume without a checkpoint is
   partial and unavailable, never `$0`.
3. Wrong answer from data: a missing or unknown model gives null cost, not an alias price.
4. Dependency failure: a read rejection falls back to a partial owner; a persist rejection is
   logged and the turn result still publishes.
5. Missing: a double-publish guard (R1); a typecheck pass for the nullable `totalCost` (R2).

### Verdict

APPROVE at 8/10. B1 and M1-M6 are fixed, and B1 has a container-level spec on the production
factory. No blocking or serious issues. Run the scoped typecheck, lint and the listed specs
before the push, and consider R1 and R3 as small follow-ups. Confidence: MEDIUM-HIGH, because no
test or typecheck ran and parts of the stream file were read in part.
