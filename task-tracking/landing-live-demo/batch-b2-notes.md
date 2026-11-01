# B2 scenario contract notes

## Files

- `libs/web/landing/src/lib/live-demo/scenario/replay-scenario.types.ts`: readonly scenario, RPC result/case/error maps, discriminated host message union.
- `libs/web/landing/src/lib/live-demo/scenario/scenario-contract.spec.ts`: registry, timing, UUID, turn ordering and generated-file drift checks.
- `libs/web/landing/src/lib/live-demo/scenario/privacy-scan.ts` and `scenario-privacy.spec.ts`: pure privacy detector, published fixture scan and canaries.
- `libs/web/landing/src/lib/live-demo/scenarios/chat-tool-call.json` and `.scenario.generated.ts`: synthetic chat fixture and generated type check.
- `scripts/landing/generate-live-demo-types.mjs`: generate and `--check` modes for every scenario JSON.

## Type design and shared gaps

`ScenarioRpc` maps each `RpcMethodName` to `RpcMethodResult<M>` from the shared registry, projected to JSON wire form. The projection turns branded string IDs (such as `SessionId`) into strings because JSON cannot carry a TypeScript brand; it preserves literal unions and object requirements. Cases use `RpcMethodParams<M>` as a partial parameter match and the same result projection. JSON is embedded in generated TypeScript with `satisfies ReplayScenario`, so no `resolveJsonModule` change is needed. The generator omits `as const`: shared RPC result interfaces contain mutable array fields, and `as const` would make JSON arrays readonly and reject otherwise valid results. Contextual `satisfies` typing still checks literal union fields such as stream `eventType` and `role`.

`MessagePayloadMap` supplies `chat:streamSnapshot`, `session:turnEnded`, `session:subagentEnded`, `agentSession:opened`, `sessionHandoff:opened`, `planLimits:changed`, and `workspaceChanged`. It lacks `chat:chunk`, `chat:complete`, `session:id-resolved`, `session:stats-live`, `agent-monitor:spawned`, `agent-monitor:output`, `agent-monitor:exited`, `permission:request`, and `batch`. Local envelopes use shared `FlatStreamEventUnion`, `SessionStatsLiveWire`, `AgentProcessInfo`, `AgentOutputDelta`, and `PermissionRequest` where available. `batch` is a transport envelope rather than a payload-map entry. All current timeline message types are in `MESSAGE_TYPES`; there are no missing runtime constants.

## Verification

`npm run verify -- -p web-landing` first run: failed. The generated fixture exposed stale spike RPC shapes and JSON branded-ID incompatibility; the privacy scanner had one lint escape error; the freshness Jest test used the project directory instead of the repository root. Those B2 issues were corrected. The B1 runtime files had lint warnings but no errors, and no B1 test failure appeared.

`npm run verify -- -p web-landing` second run: **passed** all 3 targets (lint, test, typecheck; 0 cache hits). No web-landing tsconfig or Jest config change was needed.

## B3 integration follow-up

The B3 smoke run found that an RPC error for `git:lastCommit` makes `GitBranchesService` log a warning. The chat fixture now answers that RPC with a synthetic commit. Its registry result requires `authorEmail`, so the fixture uses `demo@example.invalid`; the privacy scanner exempts exactly that address, and a canary confirms another `.invalid` address still fails. The synthetic commit timestamp equals `timeBase`. The session and tab UUID v4 values remain consistent in the fixture. The B1 lane owns the session-open sequence needed to bind the tab before playback; this follow-up does not change its runtime files.

Follow-up verification: `npm run verify -- -p web-landing` **passed** lint, test and typecheck (3/3 targets, 0 cache hits).

## Session open

`ReplayScenario.bootMessages` uses the same `ReplayTimelineMessage` union as timeline entries. `switchView` uses `MessagePayloadMap['switchView']` with local optional `sessionId` and `sessionName`; these two fields are absent from the shared `ViewChangedPayload` at the time of this edit and are owned by B1. The contract spec checks boot message types, requires exactly one `switchView` with view `chat` or `command-center`, and checks that a chat boot session ID appears in `session:list`. It permits `$activeTabId` only in a timeline `chat:chunk` payload's `tabId`; other tab and session IDs must remain UUID v4. `rpc:response` is rejected in boot messages, timeline messages, and nested batches.

The chat fixture boots into its listed `Explore the project` session, and each timeline chunk uses `$activeTabId`. The user prompt remains in `chat:resume`, and `git:lastCommit` remains a synthetic RPC result. No web-landing TypeScript or Jest config change is needed. Regenerated the TypeScript fixture after the JSON change.

Verification after the session-open change: the first `npm run verify -- -p web-landing` run passed lint and tests, but typecheck failed because an in-progress B1 runtime file (`runtime/csp-eval-guard.ts`) disappeared during compilation and remained in the compiler's root list. The second run passed lint and typecheck. Its test target failed only in B1's `runtime/replay-runtime.spec.ts`, which imports a missing `./session-bootstrap` module. Both B2 suites passed (31 tests total). B1 owns these runtime files; no B1 files were changed here.

Session-open scoped verify: `npm run verify -- -p web-landing` ran after regeneration. Lint and test passed; typecheck failed in B1-owned `libs/web/landing/src/lib/live-demo/runtime/disable-dynamic-function.ts:3` with TS2339 (`Property 'Function' does not exist on type 'Window'`). No B2 type error was reported. B1 owns that fix, so this lane did not edit the runtime file. The generator's `--check` also passed as part of the B2 contract test.

## Review fixes

- Added text assignment detection for credential keys, bearer and basic authorization values, and the requested token prefixes. Empty values and obvious redaction or environment placeholders are allowed.
- Limited the synthetic `demo@example.invalid` exemption to a direct value under the exact `authorEmail` key. Extended path detection to Windows forward slashes, `~/`, root and macOS temporary folders, and paths after punctuation.
- Replaced the closed hostname pattern with a generic dotted-name matcher. URL hosts and names following `//` or `@` are checked regardless of suffix; bare names require a short public-suffix list. `ptah.live` and its subdomains, `example.invalid`, and `example.com` are allowed. The list omits `.co` so code identifiers such as `ctx.co` do not fail, and file suffixes `.ts`, `.js`, and `.json` are ignored as bare names. Trade-off: an unlisted bare public suffix can pass; putting the host in a URL or after `//` or `@` catches it. Version-like IPv4 strings are ignored outside host contexts, except private ranges.
- Added canaries for each of these cases, including placeholder values, code identifiers, approved hosts, and version-like IPv4 values.
- Verification: the first `npm run verify -- -p web-landing` run passed typecheck but failed lint on four unnecessary regex escapes and failed the privacy spec because RPC keys `auth:getAuthStatus` and `auth:getScope` resembled assignments. Assignment scanning now applies only to string values, and the escapes were corrected. The second run **passed all 3 targets** (lint, test, typecheck; 0 cache hits).
