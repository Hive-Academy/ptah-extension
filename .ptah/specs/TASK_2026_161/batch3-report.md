# TASK_2026_161 — Batch 3 (issue #430, item D) Implementation Note

Pure cleanup refactor. Behavior byte-identical. No scope creep (no tree-kill/spawn/MCP touched).

## Step 1 — Generic helper added

Added `createBufferedEmitter<T>()` to
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts`
(inserted just above `stripAnsiCodes`). It reproduces the exact prior semantics:
buffer when no subscribers; on first `subscribe` flush the buffer in order then clear
(`buffer.length = 0`); `emit` fans out to all subscribers live. Returns `{ subscribe, emit }`.

## Step 2 — All 6 adapters migrated

Each adapter's two hand-rolled closure blocks (`outputBuffer`/`outputCallbacks`/`onOutput`/`emitOutput`
and `segmentBuffer`/`segmentCallbacks`/`onSegment`/`emitSegment`) were replaced with:

```ts
const output = createBufferedEmitter<string>();
const segment = createBufferedEmitter<CliOutputSegment>();
```

Reference updates inside `runSdk` only:

- `emitOutput(x)` → `output.emit(x)`, `emitSegment(x)` → `segment.emit(x)`
- returned `SdkHandle`: `onOutput` → `onOutput: output.subscribe`, `onSegment` → `onSegment: segment.subscribe`
- helper method call sites (e.g. `handleLine(line, emitOutput, emitSegment, ...)`) now pass
  `output.emit` / `segment.emit`. Helper method signatures were NOT changed — they still accept
  `(data: string) => void` / `(segment: CliOutputSegment) => void`, which `output.emit`/`segment.emit` satisfy.
- Added `createBufferedEmitter` to each adapter's existing `./cli-adapter.utils` import block.
- `CliOutputSegment` was already imported in every adapter (verified).

| Adapter     | File                         | runSdk emit-block replaced | Notes                                                                                                                      |
| ----------- | ---------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| codex       | `codex-cli.adapter.ts`       | 1                          | `handleStreamEvent` call site + error path + return handle                                                                 |
| copilot     | `copilot-sdk.adapter.ts`     | 1 (multi-turn `runSdk`)    | 2 return handles migrated (not-installed early return + main return); `handleJsonLine` call sites ×2, stderr + error paths |
| cursor      | `cursor-cli.adapter.ts`      | 1                          | `handleMessage` call site + 2 error paths                                                                                  |
| antigravity | `antigravity-cli.adapter.ts` | 1                          | `handleLine` call sites ×2, stderr/close/error paths                                                                       |
| opencode    | `opencode-cli.adapter.ts`    | 1                          | `handleLine` call sites ×2, stderr/close/error paths                                                                       |
| pi          | `pi-cli.adapter.ts`          | 1                          | `handleLine` call sites ×2, stderr/close/error paths                                                                       |

## Naming-clash handling

Checked each file. Two adapters declare a local `const output` elsewhere:

- opencode `opencode-cli.adapter.ts:652` (`const output = state?.output ?? ...`)
- cursor `cursor-cli.adapter.ts:471` (`const output = this.stringifyResult(...)`)

Both are inside **separate private helper methods**, not `runSdk`, so they occupy a different
function scope — no shadowing/redeclare clash with the `const output` added in `runSdk`. Confirmed
by a clean typecheck. Therefore the plain `output`/`segment` names were used consistently across all
6 adapters (no `outputEmitter`/`segmentEmitter` fallback was needed).

## Lines removed

Each removed closure pair was ~44 lines, replaced by 2 lines → net ~42 lines removed per adapter,
~250 lines removed across the 6 adapters. Added: one generic ~28-line helper (with doc comment) in
`cli-adapter.utils.ts` plus a single-line import addition per adapter.

## Verification

- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json` → **EXIT 0**.
- Grep across the 6 `*.adapter.ts`: **zero** leftover `outputBuffer` / `outputCallbacks` /
  `segmentBuffer` / `segmentCallbacks` / `const emitOutput` / `const emitSegment` / `const onOutput` /
  `const onSegment` references.
- Remaining `emitOutput` / `emitSegment` occurrences are exclusively **private helper-method parameter
  names and their in-body usages** (e.g. `antigravity-cli.adapter.ts:492-498` in `handleLine`), left
  untouched per the "do not change helper method signatures" constraint. No `runSdk` closure references remain.
- `SdkHandle` interface unchanged. `catch (error: unknown)` conventions unchanged. No git operations performed.
