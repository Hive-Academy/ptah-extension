# Phase D style fix A

## Findings

| Finding | Change | Verification |
| --- | --- | --- |
| S3 | `model/command-center.store.ts:27` adds the node kind and optional agent kind. `model/work-projection.ts:61-220` sets kind on every produced node. `scene/scene-layout.ts:69-275`, `scene/sprite-cache.ts:82-84`, `scene/command-scene.component.ts:50-59`, and `voice/status-narrator.ts:68-84` use kind instead of decoding ids. All affected `CommandWorkNode` spec fixtures now have kind. | Command Center: 31 suites, 210 tests passed. |
| M3 | `model/work-state.ts:4` owns the status mapping; `components/command-center-projection.source.ts:21` defines `runState(agents)` and calls the shared mapper; `model/work-projection.ts:155` uses it for lanes. `model/work-state.spec.ts:5` checks every known status and the stopped/completed roll-up. | Command Center: 31 suites, 210 tests passed. |
| M6 | Renamed `integration/integration-harness.ts` to `integration/integration-harness.testing.ts`, updated six integration spec imports, excluded `src/**/*.testing.ts` in `tsconfig.lib.json:11`, and explicitly included it in `tsconfig.spec.json:15`. | Command Center Jest and library type check passed. |
| M7 | `tribunal-ui.types.ts:4` owns `TRIBUNAL_MAX_VENDOR_TILES`; `tribunal-state.service.ts:28` re-exports it, while `tribunal-discovery.service.ts:11` imports from types. `discovery.spec.ts:26` rejects state-service imports in the discovery relative import graph. | Tribunal: 2 suites, 3 tests passed. |
| M8 | `chat-input.component.ts:489,637` directly injects and uses `AppStateManager`; `chat-input.component.spec.ts:78,211,762` supplies it in both test setups. The lock spec already supplied it. | Chat input: 4 suites, 99 tests passed. |
| Toast type | `model/command-center.store.ts:56` adds optional `action: 'retry-speech'`. | Command Center tests and library type check passed. |

## Unified status mapping

| Agent status | Work state |
| --- | --- |
| streaming, resuming, running, background | running |
| pending, draft | queued |
| fresh, switching | starting |
| paused, awaiting-background | awaiting input |
| completed | completed |
| failed, timeout | failed |
| killed, stopped | cancelled |
| unrecognized | unknown |

Unbound lanes remain queued. An empty run is starting. A run with agents rolls up mapped states in this order: running, failed, awaiting input, starting, queued, unknown, cancelled, completed. Thus stopped plus completed is cancelled; paused is awaiting input; pending and draft are queued; background is running.

## Decisions

- Kept node ids unchanged and opaque. Added `agentKind?: 'cli' | 'sdk'` on agent nodes to preserve the source distinction without parsing ids. Sprite and palette behavior currently uses node kind and provider, so it does not branch on agent kind.
- Kept existing chat input spec `any` casts and file-length warning outside this fix. ESLint returned zero errors and three existing warnings (two `no-explicit-any` in `chat-input.component.spec.ts:500-501`, one `max-lines` in `chat-input.component.ts:899`).

## Checks

- Command Center Jest: `Test Suites: 31 passed, 31 total`; `Tests: 210 passed, 210 total`.
- Tribunal Jest: `Test Suites: 2 passed, 2 total`; `Tests: 3 passed, 3 total`.
- Chat input Jest: `Test Suites: 4 passed, 4 total`; `Tests: 99 passed, 99 total`.
- `npx tsc -p libs/frontend/command-center/tsconfig.lib.json --noEmit` with `grep -E "src/"`: no matching diagnostics.
- `npx eslint` on changed TypeScript files: zero errors, three existing warnings noted above.
- `npx prettier --write` followed by `npx prettier --check` on changed files: `All matched files use Prettier code style!`

## Anything not done

No requested fix remains outstanding. Existing chat spec casts and the existing component length warning were left as found.
