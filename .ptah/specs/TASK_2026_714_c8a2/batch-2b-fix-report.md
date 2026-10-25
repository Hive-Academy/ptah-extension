# Batch 2b-fix report

Implemented pinned notification compatibility for Codex 0.155.1. Only the four authorized source/spec files and this deliverable were edited; no git commands, dependency installs, builds, workspace-wide checks, or changes to other lanes.

## Pinned notification inventory

Source: `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.manifest.json#/methods/serverNotifications`; cross-checked in specs against `codex-app-server-protocol.schema.json#/definitions/ServerNotification/oneOf`.

82 server notifications: 14 modeled, 68 accepted-unmodeled. The existing client notification `initialized` is modeled separately and is not a server notification.

### Modeled

- `account/rateLimits/updated`
- `error`
- `item/agentMessage/delta`
- `item/completed`
- `item/started`
- `mcpServer/startupStatus/updated`
- `remoteControl/status/changed`
- `serverRequest/resolved`
- `thread/started`
- `thread/status/changed`
- `thread/tokenUsage/updated`
- `turn/completed`
- `turn/moderationMetadata`
- `turn/started`

### Accepted-unmodeled

- `account/login/completed`
- `account/updated`
- `app/list/updated`
- `autoApprovalReview/strictReviewRequired`
- `command/exec/outputDelta`
- `configWarning`
- `deprecationNotice`
- `externalAgentConfig/import/completed`
- `externalAgentConfig/import/progress`
- `fs/changed`
- `fuzzyFileSearch/sessionCompleted`
- `fuzzyFileSearch/sessionUpdated`
- `guardianWarning`
- `hook/completed`
- `hook/started`
- `item/autoApprovalReview/completed`
- `item/autoApprovalReview/started`
- `item/commandExecution/outputDelta`
- `item/commandExecution/terminalInteraction`
- `item/fileChange/outputDelta`
- `item/fileChange/patchUpdated`
- `item/mcpToolCall/progress`
- `item/plan/delta`
- `item/reasoning/summaryPartAdded`
- `item/reasoning/summaryTextDelta`
- `item/reasoning/textDelta`
- `mcpServer/event/stream/notification`
- `mcpServer/oauthLogin/completed`
- `model/rerouted`
- `model/safetyBuffering/updated`
- `model/verification`
- `modelProvider/authRecoveryCompleted`
- `modelProvider/authRecoveryStarted`
- `process/exited`
- `process/outputDelta`
- `project/changed`
- `skills/changed`
- `thread/archived`
- `thread/attachment/updated`
- `thread/closed`
- `thread/compacted`
- `thread/deleted`
- `thread/environment/connected`
- `thread/environment/disconnected`
- `thread/goal/cleared`
- `thread/goal/updated`
- `thread/name/updated`
- `thread/project/updated`
- `thread/queue/changed`
- `thread/realtime/closed`
- `thread/realtime/error`
- `thread/realtime/item/completed`
- `thread/realtime/item/started`
- `thread/realtime/item/transcript/delta`
- `thread/realtime/itemAdded`
- `thread/realtime/outputAudio/delta`
- `thread/realtime/sdp`
- `thread/realtime/started`
- `thread/realtime/transcript/delta`
- `thread/realtime/transcript/done`
- `thread/reverted`
- `thread/settings/updated`
- `thread/unarchived`
- `turn/diff/updated`
- `turn/plan/updated`
- `warning`
- `windows/worldWritableWarning`
- `windowsSandbox/setupCompleted`

These notifications require a valid notification envelope with no request ID and object params. Returned params have type `Record<string, unknown>`, with `modeled: false`. Payload properties are not modeled; ordinary JSON frame validation still applies. Names outside the pinned allowlist remain `CodexProtocolError('unknownMethod')`. The fallback does not apply to requests or responses.

## Schema evidence

Every path below is in `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json`. Each method is selected from `#/definitions/ServerNotification/oneOf` by its literal method and params reference.

| Method | Params schema path | Required fields |
| --- | --- | --- |
| `account/rateLimits/updated` | `#/definitions/v2/AccountRateLimitsUpdatedNotification` | `rateLimits` |
| `mcpServer/startupStatus/updated` | `#/definitions/v2/McpServerStatusUpdatedNotification` | `name`, `status` |
| `remoteControl/status/changed` | `#/definitions/v2/RemoteControlStatusChangedNotification` | `installationId`, `serverName`, `status` |
| `serverRequest/resolved` | `#/definitions/v2/ServerRequestResolvedNotification` | `requestId`, `threadId` |
| `thread/started` | `#/definitions/v2/ThreadStartedNotification` | `thread` |
| `thread/status/changed` | `#/definitions/v2/ThreadStatusChangedNotification` | `status`, `threadId` |
| `turn/moderationMetadata` | `#/definitions/v2/TurnModerationMetadataNotification` | `metadata`, `threadId`, `turnId` |

- Rate limits: `#/definitions/v2/RateLimitSnapshot` has no required fields, so sparse updates including an empty snapshot are accepted. Nested RateLimitWindow, CreditsSnapshot, SpendControlLimitSnapshot, PlanType and RateLimitReachedType supply field and enum constraints. Notification-specific loose objects preserve allowed extensions without changing rate-limit response validation.
- MCP status uses name (not serverName), the four McpServerStartupState values, nullable optional error/threadId/failureReason, and the pinned reauthenticationRequired failure reason.
- Remote control requires installationId/serverName/status, accepts optional nullable environmentId, and the disabled/connecting/connected/errored status enum.
- Server request resolution requires threadId and a string or integer requestId; it is a notification, not a response envelope.
- Thread start requires the existing Thread payload (including required nullable projectId), with notification-specific allowance for thread/status extensions. ThreadStatus requires activeFlags for active status; each flag is a pinned ThreadActiveFlag.
- Moderation requires metadata, threadId and turnId; metadata accepts arbitrary JSON, including null and scalar values.
- The seven new notification parameter objects allow extra fields because their pinned schemas do not prohibit additional properties. Existing request/response schemas were left unchanged.

## Translator handling

The seven newly modeled notifications return no events. Account limits do not invent a new runtime event or usage count. All pinned accepted-unmodeled notifications also return no events, including when they contain thread/turn correlation fields. These paths do not advance sequence counters, set terminal state or fabricate usage. Existing translation and unknown-method fallback behavior remains intact; unknown wire methods fail validation before translation.

## Specs

- Replay discovers all 16 distinct inbound method names recursively from spike-run-6e.json through spike-run-6j.json. Each goes through validateCodexFrame and CodexEventTranslator using synthetic params, never captured payloads. The three server requests retain request envelopes and existing translator behavior; notification fixtures must not produce error events.
- Parameterized acceptance, missing required fields, malformed types/enums, optional/null fields, arbitrary moderation metadata and allowed nested extensions cover the seven new schemas.
- All 68 pinned unmodeled notifications are accepted with modeled:false, ignored by the translator, and rejected when presented as requests or response methods. Missing/scalar/array params are rejected.
- Manifest/schema notification enumeration is compared, and unknown methods outside the manifest still fail.
- Translator tests cover all ignored methods, unchanged sequencing and absent fabricated usage.

## Exact verification results

PowerShell equivalents of tail/grep were used to keep output bounded.

1. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20`
   - Initial run: 2 suites failed compilation, 0 tests, 5.675 s, because direct JSON imports are unsupported by the project configuration (with consequent inferred-type errors). Replaced runtime JSON import with a pinned literal allowlist and read/validate JSON only in specs; corrected replay fixture path before rerunning.
   - Final run: exit 0; 2 suites passed; 305 tests passed; 0 snapshots; 12.782 s. Node emitted an ES-module loading warning for jest.config.ts; execution succeeded.
2. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Tee-Object -FilePath "$env:TEMP/ptah-batch-2b-fix-nx.log" | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 10`
   - Exit 0. Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime. Duration 16.0 s, 0/2 cache hits.
   - 4 warnings, 0 errors: validator max-lines; evidence-harness.ts max-lines, preserve-caught-error and no-useless-assignment. No out-of-scope files were fixed.
3. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts libs/backend/codex-runtime/src/lib/codex-event-translator.ts libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts`
   - Exit 0; all four files formatted. No behavioral changes after the passing checks; import placement and formatting only.

## Decisions

- Pin the fallback to the server-notification set only. Do not infer notification status from arbitrary method names or accept unknown server requests/responses.
- Use a literal allowlist because runtime JSON imports are unsupported in this project. Tests exercise every pinned manifest method and compare manifest/schema enumeration.
- Keep new schemas separate from strict request/response contracts so notification compatibility cannot loosen those boundaries.
- Treat account limits, lifecycle/status/moderation notifications and unmodeled notifications as no-op translator inputs. Do not modify Batch 2a event types or invent fields.
- Preserve client initialized and existing modeled notification behavior.
- No modifications to src/index.ts, batches.md, Batch 2d, approvals bridge, usage client or evidence harness.

## Written files

- `D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat\libs\backend\codex-runtime\src\lib\codex-protocol-validator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat\libs\backend\codex-runtime\src\lib\codex-protocol-validator.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat\libs\backend\codex-runtime\src\lib\codex-event-translator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat\libs\backend\codex-runtime\src\lib\codex-event-translator.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat\.ptah\specs\TASK_2026_714_c8a2\batch-2b-fix-report.md`
