# Batch 1 report — TASK_2026_402_a5c7 (Group α: Components 1, 2, 8)

Executor: `backend-developer`. Worktree: `D:\projects\ptah-extension\.claude-worktrees\agent-messaging`
(branch `feat/agent-two-way-messaging`). Nothing committed, stashed or checked out; `npx nx reset`
was never run.

## Tasks completed

- **1.1** `buildFlagSettingsArg` — the one serializer of the flag tier.
- **1.2** `buildSessionName` + ONE merged `extraArgs` object.
- **1.3** `origin` passthrough on the injection path.
- **1.4** the peer branch in the transformer.

## Files

### Created

- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\agent-sdk\src\lib\helpers\session-name.builder.ts`
  — `buildSessionName` + `deriveWorkspaceLabel`.
- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\agent-sdk\src\lib\helpers\session-name.builder.spec.ts`
  — 15 assertions (composition, sanitisation, cap, uniqueness, `undefined` on empty input).

### Modified

- `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` — added
  `CROSS_SESSION_INBOUND_VALUES`, `CrossSessionInbound`, `buildFlagSettingsArg`, private
  `buildExtraArgs`; `options.settings` now calls the serializer; the conditional `extraArgs`
  spread replaced by one merged object.
- `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.output-style.spec.ts` — the
  ONE wiring guard updated; a new `buildFlagSettingsArg` describe block added. Every G4 / G4b /
  frozen-identity assertion untouched and green.
- `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.spec.ts` — three assertions
  that pinned the pre-change contract updated (see Deviations).
- `...\libs\backend\agent-sdk\src\lib\helpers\index.ts` — barrel exports.
- `...\libs\backend\agent-sdk\src\index.ts` — public barrel exports of `buildFlagSettingsArg`,
  `CROSS_SESSION_INBOUND_VALUES`, `CrossSessionInbound`, `buildSessionName`,
  `deriveWorkspaceLabel`, `SessionNameInput` for `cli-agent-runtime` (Batch 4).
- `...\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.ts` —
  `sendMessage(..., options?: { origin?: SDKMessageOrigin })`, forwarded to
  `createUserMessage`.
- `...\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts` — the facade forwards
  the same optional argument (it sits between the adapter and the pump).
- `...\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` — `sendMessageToSession` passes
  `options?.origin` through.
- `...\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts` — `NEUTRAL_PEER_LABEL`,
  `readOrigin`, `resolveInboundPeerLabel`; the peer branch ahead of both user paths; the replay
  drop now logs the origin kind.
- `...\libs\backend\agent-sdk\src\lib\sdk-message-transformer.replay.spec.ts` — one existing
  assertion updated for the new debug payload; a `human`-origin replay drop test; a new
  `inbound peer messages` describe (7 cases).
- `...\libs\backend\agent-sdk\src\lib\message-transform\user-message.transformer.ts` — optional
  `inboundPeer` argument stamped onto `message_start` only.
- `...\libs\backend\agent-sdk\src\lib\message-transform\user-message.transformer.spec.ts` — one
  case for the stamp and its absence.
- `...\libs\shared\src\lib\types\ai-provider.types.ts` — `AIMessageOrigin` union +
  `AIMessageOptions.origin`.
- `...\libs\shared\src\lib\types\execution\stream.ts` — `MessageStartEvent.inboundPeer?`.

Nothing outside those paths was touched. `agent-process.types.ts`,
`cli-agent-runtime\...\cli-adapters\**` and `ptah-cli-registry.ts` were not opened for edit.

## Stack observed

- Runtime/DI: tsyringe with `Symbol.for` tokens (`libs/backend/agent-sdk/src/lib/di/tokens.ts`);
  `SdkQueryOptionsBuilder` is `@injectable()` with constructor `@inject` — no new registration was
  needed, both new symbols are free functions.
- Provider SDK contracts read from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:
  `Options.settings?: string | Settings`, `extraArgs?: Record<string, string | null>` (:1359),
  `SDKMessageOrigin` (:3246), `SDKUserMessage.origin?` (:3679), `SDKUserMessageReplay.origin?`
  (:3708). `Settings` carries no `crossSessionInbound` key and no index signature — hence the
  string form, with no cast and no `@ts-ignore`.
- Validation: no new external boundary, so no Zod. The one untrusted value —
  `crossSessionInbound` — is checked against a closed constant set inside the serializer.
- Barrels: `agent-sdk` re-exports through `src/lib/helpers/index.ts` → `src/index.ts`, the
  existing pattern; `export type` used for the type-only re-exports.

## Verification (verbatim)

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/shared
 NX   Running target test for 2 projects:
> nx run @ptah-extension/shared:test  [existing outputs match the cache, left as is]
Test Suites: 56 passed, 56 total
Tests:       1363 passed, 1363 total
> nx run @ptah-extension/agent-sdk:test
Test Suites: 1 skipped, 87 passed, 87 of 88 total
Tests:       2 skipped, 1518 passed, 1520 total
 NX   Successfully ran target test for 2 projects
```

The header reads 2 projects. The 1 skipped suite / 2 skipped tests are pre-existing
(`describe.skip` behind `PTAH_PERF_SPECS=1`), not anything skipped by this batch.

```
$ npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/shared
 NX   Running target typecheck for 2 projects:
> tsc --noEmit --project libs/shared/tsconfig.lib.json
> tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json
 NX   Successfully ran target typecheck for 2 projects
```

```
$ npx nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/shared
 NX   Running target lint for 2 projects:
✖ 2 problems (0 errors, 2 warnings)
✖ 38 problems (0 errors, 38 warnings)
 NX   Successfully ran target lint for 2 projects
```

Zero errors. All 40 warnings are pre-existing (`no-non-null-assertion` in specs, `max-lines` on
`sdk-agent-adapter.ts` / `sdk-permission-handler.ts`). No new `max-lines` warning was introduced;
`sdk-query-options-builder.ts` does not appear in the lint output. `npx prettier --write` was run
over the touched files so the format hook has nothing to reformat later.

```
$ git status --short          # mine only; the other executor's Batch 2 files omitted
 M libs/backend/agent-sdk/src/index.ts
 M libs/backend/agent-sdk/src/lib/helpers/index.ts
 M libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.output-style.spec.ts
 M libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts
 M libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts
 M libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts
 M libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts
 M libs/backend/agent-sdk/src/lib/message-transform/user-message.transformer.spec.ts
 M libs/backend/agent-sdk/src/lib/message-transform/user-message.transformer.ts
 M libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts
 M libs/backend/agent-sdk/src/lib/sdk-message-transformer.replay.spec.ts
 M libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts
 M libs/shared/src/lib/types/ai-provider.types.ts
 M libs/shared/src/lib/types/execution/stream.ts
?? libs/backend/agent-sdk/src/lib/helpers/session-name.builder.spec.ts
?? libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts
```

## Assumption A0 — string `Options.settings` reaches `--settings` unmodified

**Verified statically at the exact code path, NOT at runtime.** This session is headless — no
Electron/VS Code host was launched, so no `Spawning Claude Code:` line could be produced or
grepped. What was read instead, in
`node_modules\@anthropic-ai\claude-agent-sdk\sdk.mjs`:

```js
let GX = { ...G ?? {} };
if (this.options.settings) GX.settings = this.options.settings;
let UX = U2(GX, S9);
for (let [m$, s$] of Object.entries(UX))
  if (s$ === null) i.push(`--${m$}`); else i.push(`--${m$}`, s$);
```

and

```js
function U2($, Q) { let J = { ...$ }; if (Q) { /* sandbox merge only */ } return J; }
function Fx($) { let Q = $.trim(); return Q.startsWith("{") && Q.endsWith("}"); }
```

Three facts follow, and they are stronger than the plan assumed:

1. `settings` is merged into the SAME map as `extraArgs` and emitted as `--settings <value>`.
   `U2` returns the map untouched unless a `sandbox` option is present (none is here), so the
   string is a passthrough. `Fx` recognises a `{`-to-`}` string as inline JSON rather than a file
   path, which is exactly the shape `buildFlagSettingsArg` emits.
2. **`options.settings` OVERWRITES an `extraArgs.settings` key**, so the two must never both carry
   settings. They do not: `buildExtraArgs` emits only `replay-user-messages` and `name`.
3. `extraArgs` with a `null` value becomes a bare flag and a string value becomes `--key value` —
   confirming both `--replay-user-messages` and `--name <value>` reach the CLI as intended.

The byte-for-byte no-regression contract is pinned by a unit test rather than by a log line:
`buildFlagSettingsArg()` with no style and no inbound value `=== JSON.stringify(PTAH_DISABLE_SDK_AUTO_MEMORY)`.
The live spawn-log grep is still worth doing once during Batch 7 acceptance; it is the only step
of A0 this batch could not perform.

## Assumption A1 — the CLI preserves a caller-supplied `origin` on the replayed turn

**Not resolved, and could not be from here.** Resolving it needs two live sessions and one real
`SendMessage`, which needs a running host. No fabricated evidence is offered.

What was done instead is to make it answerable from a log alone, which is what Task 1.4 asked for:

- `[SdkMessageTransformer] Rendering inbound peer message` at `debug`, with
  `{ label, isReplay }` — fires when the peer branch takes a turn.
- `[SdkMessageTransformer] Skipping replayed user message (…)` at `debug`, now carrying
  `{ originKind }` — so a dropped replay says whether it had an origin and which kind. If A1 is
  false, the log shows `originKind: undefined` on the injected turn, and the Component 8
  contingency (`SessionInboundCallbackRegistry`) is the answer. The shared type, the transformer
  branch and the tool contract are unchanged either way — only the producer would move.

Observed shape of the replay path in the existing fixtures: a replayed turn carries
`isReplay: true`, `uuid`, `session_id`, `parent_tool_use_id: null` and NO `origin` key at all
(`sdk-message-transformer.replay.spec.ts`'s log.log:2376 payload). That absence is what the "a
replay with no origin still returns `[]`" test pins.

## Assumption A2 — noted, not acted on

`--replay-user-messages` was left conditional on file checkpointing, because A2 could not be
tested (same reason as A1). It is now a one-line change in a single merged object
(`buildExtraArgs`) rather than a restructure, which is what Task 1.1 asked me to leave behind.

## Risks

### R-2 — two batches editing `libs/shared` concurrently

Held. I edited exactly `execution\stream.ts` and `ai-provider.types.ts` and never opened
`agent-process.types.ts`; `git status` shows the other executor's modification to that file
sitting untouched beside mine. `@ptah-extension/shared` test/typecheck/lint ran green in the same
worktree with no collision and no re-run needed.

One caveat, disclosed rather than hidden: during the middle of the batch I ran the test target
once with `--skip-nx-cache`, which R-2 says not to. It caused no observed collision, and all three
final verification commands quoted above were run WITHOUT it.

A design note for `ai-provider.types.ts`: `AIMessageOrigin` is a structural restatement of the
provider SDK's `SDKMessageOrigin`, not an import. `libs/shared` is the foundation layer and its
CLAUDE.md forbids depending on runtime packages; the two unions are assignable in both directions
and the comment on the type says to widen them together.

### R-7 — `--name` on a CLI older than the version floor

Held three ways:

1. `buildSessionName` returns `undefined` instead of throwing when the inputs sanitise to nothing
   (empty/punctuation-only role or suffix). Pinned by four `it.each` cases.
2. The caller omits the key and logs `[SdkQueryOptionsBuilder] Could not compose a session
   name — starting the session without --name, so the CLI derives one` at `warn`. A naming
   problem costs the name, never the session.
3. `--name` is emitted from exactly ONE place (`buildExtraArgs`), so making it conditional on a
   detected CLI version later is a single edit in a single method.

The name is vendor-free by construction: the fixed prefix is `ptah`, the role for this call site
is the literal `chat`, and every other segment (workspace label, task id, agent name at the Batch 4
call site) is user data pushed through `slugify` and never enumerated in a description string.

## Deviations from the plan

1. **`buildFlagSettingsArg` takes an optional THIRD parameter, `logger?: Pick<Logger, 'warn'>`.**
   The plan specifies the two-argument signature and also requires a `logger.warn` on an
   unrecognised value; the function is a free function in a file with no module-level logger, so
   the logger has to arrive as an argument. The two documented parameters keep their positions and
   meanings, and the call site passes `this.logger`. It also makes the warn assertable, which it
   would not otherwise be.
2. **`SessionLifecycleManager.sendMessage` also gained the `options` parameter.** The plan names
   the pump and the adapter; on disk the adapter calls the pump THROUGH this facade
   (`session-lifecycle-manager.ts:502`), so the origin would have been dropped in the middle
   without it. Signature-compatible and additive.
3. **`deriveWorkspaceLabel` was added beside `buildSessionName`.** The plan's `workspaceLabel`
   input has no stated producer; the builder needs the last segment of `sessionConfig.projectPath`
   and Batch 4 needs the same reduction, so it is exported rather than written twice.
4. **Three assertions in `sdk-query-options-builder.spec.ts` were updated** (not in the
   output-style spec, whose single wiring guard was the only change there, as instructed). They
   pinned exactly the contracts this batch changes: `extraArgs` deep-equalling only
   `replay-user-messages`, `extraArgs` being `undefined` when checkpointing is off, and
   `options.settings` being an object. The second is now the positive statement of the load-bearing
   point — *"keeps the session name when checkpointing is explicitly disabled"* — and a fourth test
   asserts the name matches `/^ptah-[a-z0-9-]+$/`. No assertion was deleted or skipped.
5. **The peer branch is restricted to `isUserMessage(msg) || isReplayMessage(msg)`.** `origin` is
   declared on other SDK message types too (`sdk.d.ts:3415,3441`), and only a user turn has a
   sender to attribute; without the narrowing the branch would blind-cast a non-user message into
   `UserMessageTransformer`.

## Out-of-scope observations (not touched)

- `ptah-cli-registry.ts:730` still builds its own settings value and passes no `--name`. Both
  symbols are exported from the public barrel and ready for Batch 4.
- `options.settings` overwriting `extraArgs.settings` inside the SDK (A0 finding 2) is worth a line
  in Batch 7's documentation — a future caller adding `settings` to `extraArgs` would find it
  silently discarded.
- `sdk-agent-adapter.ts` (880 lines) and `sdk-permission-handler.ts` (896) carry pre-existing
  `max-lines` warnings. Not this batch's blast radius.
