# CI unit test fix, round 1

The failure digest lists 15 distinct failing spec files. I updated product code for the import-time crash and unsupported history item, and updated tests whose fixtures or expectations encoded behavior removed by the Codex binary unpin change. Jest execution was prohibited for this lane.

| Spec file | Root cause | Fix (code or test) | Files changed |
| --- | --- | --- | --- |
| `codex-account-usage-client.spec.ts` | Fake `/codex` executable fails the new native-file selection validation before the account request. | Test: use the real path of the current Node executable as a valid fixture. | `libs/backend/codex-runtime/src/lib/codex-account-usage-client.spec.ts` |
| `codex-runtime.spec.ts` | Open now fetches the model catalog before callers request it; several tests exhausted one-page fixtures or configured a child before asynchronous spawn. Error matching also ignored the new cause. | Test: provide an initial catalog page for open, await spawn in affected cases, adjust request counts, and assert the safe error message. | `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts` |
| `codex-app-server-process.spec.ts` | Simulated Windows launch used a non-`.exe` fixture; empty catalog fixture omitted required `skippedCount`. | Test: create a temporary executable `.exe` fixture for the simulated platform and return a complete empty catalog response. | `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts` |
| `codex-protocol-validator.spec.ts` | Assertions required closed optional enums and rejected unfamiliar item keys; Zod output schema generation now encounters transforms. | Test: assert tolerant optional values, redacted validation issues, and the input JSON schema contract. | `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts` |
| `codex-chat-adapter.spec.ts` | A test expected the removed legacy gate to block startup; an approval fixture used a command/cwd combination rejected by current platform validation. | Test: assert successful startup and use a platform-valid approval command and cwd. | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts` |
| `codex-history-projector.spec.ts` | Tolerant protocol parsing passes unknown items to the projector, but the projector silently omitted their skip record. | Code: record unhandled non-sleep items as unsupported while preserving no rendered event. | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts` |
| `workspace-provider-profile-resolver.spec.ts` | Tests assumed a removed static Codex model catalog and treated an uncatalogued workspace model as selectable. | Test: expect the default without a live catalog; seed the workspace model into the live catalog for scope resolution. | `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts` |
| `codex-auth.service.spec.ts` | Tests still expected the old `0.162.0` minimum. | Test: expect the new `0.165.0` minimum. | `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.spec.ts` |
| `agent-process-manager.service.spec.ts` | Log assertions expected no model where lane activation now selects `cli-default`. | Test: assert `cli-default` in the log while keeping the SDK request model assertion unchanged. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts` |
| `agent-process-manager.account-binding.spec.ts` | Codex default source assertion used the prior `ptah-default` label. | Test: assert `cli-default`. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts` |
| `codex-lane-activation.spec.ts` | Binary resolver mock omitted the immutable `selection` snapshot passed to `runtime.open`. | Test: return a selected binary and snapshot; assert the snapshot reaches open. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-activation.spec.ts` |
| `surface-composition.spec.ts` | Test expected eager Codex runtime DI registrations after the lane factory became lazy. | Test: assert the lane factory and selection snapshot registrations, and absence of eager runtime registrations. | `libs/backend/cli-engine/src/lib/surface-composition.spec.ts` |
| `config-rpc.handlers.spec.ts` | Model-list tests assumed saved Codex IDs were offered without a live catalog. | Test: assert uncatalogued IDs are absent; seed a cached catalog for workspace selection and scoped snapshots. | `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts` |
| `skills-sh-rpc.handlers.spec.ts` | Its child-process mock imports the Codex runtime barrel, which previously called `promisify(execFile)` at import time on a missing mock member. | Code: create the promisified function only when the binary probe runs. | `libs/backend/codex-runtime/src/lib/select-codex-executable.ts` |
| `pricing.utils.spec.ts` | Missing rates now carry the explicit `rate-missing` reason for “Not priced.” | Test: assert the reason alongside existing pricing fields. | `libs/shared/src/lib/utils/pricing.utils.spec.ts` |

## TypeScript checks

All seven initial spec TypeScript checks exited 0 with no `error TS` output: `codex-runtime`, `agent-sdk`, `cli-agent-runtime`, `auth-providers`, `cli-engine`, `rpc-handlers`, and `shared` (`npx tsc -p <project>/tsconfig.spec.json --noEmit`, output filtered to `error TS`). After the review fixes, `codex-runtime`, `agent-sdk`, and `shared` spec checks also exited 0 with no `error TS` output, reaching the ten-call limit. A final scoped Ptah diagnostics request for the changed backend and shared files returned zero errors; scoped frontend diagnostics found no errors in the changed `chat-ui` component or spec, but reported 16 errors in unrelated sibling files. No Jest, Nx, build, or git command was run. Earlier Ptah diagnostics attempts timed out.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the new native executable validation and repair fixtures. | Relax product validation; supply real executable fixtures. | The selection contract requires an existing native file; `/codex` and a Linux path under simulated Windows fail before the behavior each test targets. | Yes. |
| Resolve Codex model defaults from the live catalog. | Restore the removed static list; update tests to seed a catalog or expect default. | The branch removes static Codex model IDs and the resolver/config handler read cached model IDs. | Yes. |
| Preserve unknown protocol items as explicit skips in history. | Ignore them silently; record an unsupported item. | Tolerant parsing is intentional, while the projector test checks that unsupported items are visible to diagnostics without crashing. | Yes. |
| Defer `promisify(execFile)` until the version probe. | Expand every child-process mock; remove the import-time side effect. | Two suites crash during module import because their mocks omit `execFile`; the probe itself still uses the same API. | Yes. |

## Unrelated failures

None identified in the supplied digest. `config-rpc.handlers.spec.ts` exercises the changed dynamic Codex catalog behavior. `skills-sh-rpc.handlers.spec.ts` reaches the changed binary selector through an imported barrel and fails at its former import-time `promisify(execFile)` call. The other listed failures correspond to changed binary validation, model discovery, protocol tolerance, default selection, or missing-rate pricing.

The later scoped `chat-ui` diagnostics returned 16 errors in unchanged sibling files, including `agent-avatar.component.spec.ts` (regex target) and `streaming-quotes.component.spec.ts` (`ApplicationRef.afterTick`). Neither changed cost-badge file had diagnostics. Those sibling errors are outside these review comments and were left untouched.

## Remaining risk

- Runtime test outcomes remain unverified because this lane was explicitly barred from running Jest. The sponsoring session should run the affected CI unit tests.
- Scoped TypeScript checks provide compile evidence only. Frontend diagnostics found 16 errors in unchanged sibling files, with none in the changed component or spec.
- No skill-loading tool was listed for this lane, so no optional skill could be loaded.

## Review comments

| Comment | Fix | Files | Tests |
| --- | --- | --- | --- |
| MCP secrets remained on `TrackedSession` for the session lifetime. | Make `secrets` mutable and clear it after the first turn receipt; also clear it in a `finally` after the bundled retry runs. | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts` | Added an adapter spec asserting secrets are absent from the tracked session after the receipt in `codex-chat-adapter.spec.ts`; `agent-sdk` spec TypeScript check passed. |
| Unsupported `turn/steer` in approval follow-ups was treated as a context failure. | Treat `CodexUnsupportedMethodError` as refusal in both the constructor follow-up handler and denial feedback delivery. | `libs/backend/codex-runtime/src/lib/codex-context.ts` | Expanded `codex-runtime.spec.ts` cases for approval edit, async user answer, and denial feedback with RPC `-32601`; `codex-runtime` spec TypeScript check passed. |
| “Not priced” tooltip claimed no rate had been published. | State that Ptah lacks the rate needed to calculate this cost. | `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts` | Updated exact tooltip assertion in `cost-badge.component.spec.ts`; scoped Ptah diagnostics reported no errors in either changed file. |
| Missing model or usage evidence was labeled `rate-missing`. | Return `usage-incomplete` for an empty model or absent/invalid usage before classifying rate coverage. Preserve provenance for known models with incomplete usage. `codex-chat-turn-stream.ts` passes `evidenceModel ?? ''` to exact pricing; on a terminal without usage this now yields `usage-incomplete`. | `libs/shared/src/lib/utils/pricing.utils.ts` | Added zero-usage, unpriced-model and empty-model cases in `pricing.utils.spec.ts`, plus an adapter terminal without usage case in `codex-chat-adapter.spec.ts`; `shared` and `agent-sdk` spec TypeScript checks passed, and final scoped diagnostics found no errors in the adapter spec. |
| Repeated opens spawned `codex --version` despite unchanged binary. | Cache valid parsed versions and raw responses by canonical path, file `mtimeMs`, and size; re-probe after metadata changes. | `libs/backend/codex-runtime/src/lib/select-codex-executable.ts` | Added `select-codex-executable-cache.spec.ts` for cache hit and changed-size invalidation; `codex-runtime` spec TypeScript check passed. |
