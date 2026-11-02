# Batch 4: native result wiring

## Summary

Native Codex chat sessions now carry a home-scoped billing mode and a durable usage
owner. Each observed terminal publishes a priced turn result and lifetime session
statistics. A known API-key rate is an estimate; a known ChatGPT-plan rate is
covered by subscription. Unknown billing mode, missing rate, missing evidence,
ambiguous cache semantics leaves a turn cost unavailable. Incomplete lifetime
coverage leaves lifetime cost unavailable while a fully observed turn can
still carry its own exact price.
No rates, frontend contracts, or MCP configuration were changed.

## Files changed

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`:
  restores or creates the owner using the native root thread ID and carries it
  with billing mode and message count into each session.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts`:
  observes native usage evidence, saves checkpoints, and constructs turn and
  lifetime result statistics on terminal events.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts`:
  covers API key, plan, unknown auth/rate, resume, failed and interrupted
  terminals, provenance arrays, and checkpoint-write failure.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-session-usage-owner.ts`
  and `.spec.ts`: preserve partial orphan coverage through checkpoint restore.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` and `.spec.ts`:
  distinguish usage regression from invalid identity.
- `libs/backend/agent-sdk/src/lib/wiring/codex-chat-metadata-port.ts`:
  expose optional checkpoint read/write through the existing metadata store.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts`:
  connect the Electron metadata store to that port.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts`:
  resolve billing mode from the selected profile's normalized home, validating
  `auth.json` with Zod and giving explicit auth mode precedence.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts`:
  covers two separate `CODEX_HOME` directories and absent auth metadata.

## Decisions and requirement mapping

1. The selected native profile and resolved billing mode are returned by host
   ports (`codex-chat-host-ports.ts:462`) and stored with the owner in each
   native session (`codex-chat-adapter.ts:307-323`, `:408-430`). The owner's
   root is `context.identity.threadId` (`codex-chat-adapter.ts:309-310`).
   Electron supplies the durable metadata store
   (`codex-runtime-composition.ts:533`); the port reads and writes the
   checkpoint (`codex-chat-metadata-port.ts:12-20`).
2. Native evidence enters the owner before projection
   (`codex-chat-turn-stream.ts:274-280`, `:383`, `:569`). Every observed
   terminal invokes `publishStats`, including projected completed/failed/
   interrupted results and stop/drain terminals (`:299-324`, `:393`, `:579`).
   It builds authoritative lifetime tokens from the owner (`:189-200`), calls
   `calculateExactMessageCost` for turn and lifetime (`:201-221`), and sends
   `sessionStats`, cost basis, coverage, and provenance arrays in the existing
   result payload (`:229-273`). Cache semantics are `disjoint` only when the
   evidence has not marked them ambiguous (`:204-206`). Missing evidence marks
   coverage partial (`:179`); missing rates keep totals null with unknown
   basis and no pricing coverage (`:208-221`).
3. N1: `accept()` marks child usage seen before root/parent as partial and
   records `missing-parent` (`codex-session-usage-owner.ts:203-208`); `restore()`
   accepts that owner-produced partial orphan checkpoint (`:114-119`). Its
   round-trip spec is at `codex-session-usage-owner.spec.ts:25`. Checkpoint
   writes are caught and logged with the injected logger and a real `Error`
   (`codex-chat-turn-stream.ts:180-188`), covered at
   `codex-chat-turn-lifecycle.spec.ts:318`.
4. N2: regression rejection uses the dedicated `usage-regression` code
   (`session-metadata-store.ts:212`, `:1253`), asserted at
   `session-metadata-store.spec.ts:2252`.
5. N3: inspection confirmed `validateSessionId` is called once per applicable
   method in `session-history-reader.service.ts:381`, `:641`, and `:1033`.
   No duplicate call exists within the same method; no edit was needed.
6. Specs for API key and plan pricing are at
   `codex-chat-turn-lifecycle.spec.ts:235-259`; unknown rate on failed
   terminal at `:261-281`; unknown auth at `:283-296`; restored lifetime at
   `:298-316`; interrupted and failed terminal statistics at `:524-550`.
   Different homes are covered at `codex-chat-native-contract.spec.ts:88`.

The turn stream changes are confined to usage observation and result-statistics
construction. MCP setup and native turn transport were left intact. The
`codex-chat-turn-stream.ts` overlap with PR #881 remains a merge watchpoint.

## Evidence and open risks

- `git diff --check` passed. Changed files have LF line endings, no BOM or CR,
  and no newly added line over 100 characters.
- No test, typecheck, lint, build, Nx, npm, or prettier command was run, as
  requested. Runtime and compile behavior therefore await coordinator checks.
- The local auth classification relies on the native `auth.json` shape and
  has not been confirmed against a live paid session. An absent, malformed,
  or ambiguous auth file resolves to `unknown`; raw credentials are not logged.
- Revision 1 adds a durable exact-price accumulator for model switches and
  resume. Older checkpoints without this accumulator keep historical cost
  unavailable; already priced turns are not retroactively inferred.
- Skill discovery found no installed matching skill or callable skill loader
  for this coding lane. Ptah workspace/dependency tools were consulted; source
  inspection used native fallback where index results were unavailable.

## Coordinator verification commands (do not run in this lane)

Run one heavy command at a time from the workspace root:

```powershell
$changedProjects = (
  '@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,' +
  'ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui'
)
npm run verify -- -t typecheck,lint -p $changedProjects --parallel=1
$testProjects = '@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers'
$testPattern = (
  'codex-chat-turn-lifecycle|codex-chat-native-contract|' +
  'codex-session-usage-owner|session-metadata-store'
)
npm run verify -- -t test -p $testProjects -- "--testPathPatterns=$testPattern" `
  --coverage=false --maxWorkers=2
```

After PR #881 lands, compare its `codex-chat-turn-stream.ts` changes with the
stats and evidence code above before merging.

## Revision 1

The review's blocking production wiring defect is fixed. The registered
adapter now keeps the host port's `readUsage` and `persistUsage` while using
the initialized identity lookup for metadata saves
(`libs/backend/agent-sdk/src/lib/di/register.ts:1102-1108`). The container
spec resolves the adapter, invokes both wired functions, and checks the host
spies (`register.codex-runtime.spec.ts:25-63`). If a host has no persistence
capability, the adapter warns once (`codex-chat-adapter.ts:598-611`). Electron's
existing usage-aware port at `apps/ptah-electron/src/di/
codex-runtime-composition.ts:533` now reaches the real adapter. Hosts without
a durable store retain partial resume coverage.

- **M1:** A thrown checkpoint read is logged with a real `Error`, and the open
  proceeds with a partial empty owner (`codex-chat-adapter.ts:307-325`). The
  resume spec is `codex-chat-turn-lifecycle.spec.ts:365`.
- **M2:** The owner persists bounded per-turn price accumulation and restores
  it with the checkpoint (`codex-session-usage-owner.ts:32-38, 90-93,
  146-154, 159-202, 279-288`). Each terminal records its exact turn price;
  lifetime stats sum all priced turns (`codex-chat-turn-stream.ts:195-218`).
  A model switch no longer marks usage coverage partial
  (`codex-session-usage-owner.ts:221-228`). The model-switch resume spec is
  `codex-chat-turn-lifecycle.spec.ts:320`.
- **M3:** Pricing uses the current root thread's observed model and leaves an
  absent model unavailable (`codex-chat-turn-stream.ts:190-203`). The alias
  regression spec is `codex-chat-turn-lifecycle.spec.ts:350`.
- **M4:** Restore rejects self-parent threads even in partial checkpoints
  (`codex-session-usage-owner.ts:133`), covered by its spec at line 34.
- **M5:** The store accepts a structurally restored partial checkpoint and
  rejects invalid data independently of benign coverage diagnostics
  (`session-metadata-store.ts:191-197, 1249-1255`). The orphan persistence
  spec is `session-metadata-store.spec.ts:2246`; the existing regression code
  remains `usage-regression` (`session-metadata-store.ts:1267-1272`). Priced
  checkpoint totals also reject regression (`session-metadata-store.ts:171-176`,
  `session-metadata-store.spec.ts:2239-2243`).
- **M6:** Native metadata now stores `null` until the checkpoint contains a
  complete priced cost, then stores that cost (`session-metadata-store.ts:
  200-205, 353, 1224-1225, 1277, 1387`). The metadata reload spec checks
  unpriced and priced values (`session-metadata-store.spec.ts:2211-2236`).

The new pricing accumulator is optional in old checkpoints. A resumed old
checkpoint with usage but no saved prices keeps lifetime cost unavailable;
new turns still show their own exact price. Usage gaps, unknown rates, and
unverified child inclusion also keep lifetime cost null. The stream changes
remain within usage and statistics construction; MCP and transport were not
changed. This file still overlaps PR #881.

No test, typecheck, lint, build, Nx, npm, prettier, or diagnostics command ran
in this lane. `git diff --check` passed; added source lines are at most 100
characters, and the edited files have LF with no BOM or CR. The coordinator
should run the scoped commands above, including the added
`register.codex-runtime` spec in the agent-sdk test selection:

```powershell
$changedProjects = (
  '@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,' +
  'ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui'
)
npm run verify -- -t typecheck,lint -p $changedProjects --parallel=1
$testProjects = '@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers'
$testPattern = (
  'register.codex-runtime|codex-chat-turn-lifecycle|' +
  'codex-chat-native-contract|codex-session-usage-owner|' +
  'session-metadata-store'
)
npm run verify -- -t test -p $testProjects -- "--testPathPatterns=$testPattern" `
  --coverage=false --maxWorkers=2
```
