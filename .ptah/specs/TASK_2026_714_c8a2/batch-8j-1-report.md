# Batch 8j-1 ? additive server shapes

Implemented server-side unknown-key stripping without changing required fields, value types, enums, discriminators, literals, or the pinned method allowlist. Outgoing client params and approval replies retain strict validation.

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8j-1-report.md

No other files were written. No git operations were run.

## Exact schema inventory

### Strict to stripping, server-only shared schemas

All modeled object nodes within each listed schema now use z.object, including nested objects and objects within arrays/unions:

- commandAction: read, listFiles, search, unknown variants.
- item: userMessage, agentMessage, plan, reasoning, commandExecution, fileChange, mcpToolCall, webSearch, imageView, sleep, contextCompaction, hookPrompt, functionCallOutput, dynamicToolCall, collabAgentToolCall, subAgentActivity, imageGeneration, enteredReviewMode, exitedReviewMode. Includes memoryCitation and its entries, fileChange changes and kind variants, mcpToolCall result/error/app metadata, hookPrompt fragments, dynamicToolCall contentItems variants, collabAgentToolCall agentsStates values, and imageGeneration failure. User-message content and function-call output use the server variants listed below.
- turnError; turn; thread, including source object variants and every status variant; threadResult.
- elicitation: form, openai/form, openaiForm, url variants, including form.requestedSchema.
- usage; rateWindow; rateLimits, including individualLimit and credits.

### Dual-use strict/server pairs

The original names remain strict at every modeled object level. Explicit server variants use stripping objects and have comments explaining the direction boundary:

- empty / serverEmpty: client account/rateLimits/read params and initialized use empty; turn/interrupt and thread/compact/start results use serverEmpty.
- approvalPolicy / serverApprovalPolicy: wrapper and granular policy objects. Client threadOptions and turn/start retain approvalPolicy; threadResult uses serverApprovalPolicy.
- sandbox / serverSandbox: dangerFullAccess, readOnly, externalSandbox, workspaceWrite variants. Client turn/start.sandboxPolicy retains sandbox; threadResult uses serverSandbox.
- input / serverInput, textElement / serverTextElement: text, image, localImage, audio, localAudio, skill, mention variants; text_elements and byteRange objects. Client turn/start and turn/steer retain input; item.userMessage.content uses serverInput.
- functionOutput / serverFunctionOutput: input_text, input_image, input_audio, encrypted_content variants. Client turn/start.toolOutput.output retains functionOutput; item.functionCallOutput.output uses serverFunctionOutput.
- permissions / serverPermissions: network, fileSystem, entries, path variants (path, glob_pattern, special) and special value variants (root, minimal, project_roots, tmpdir, slash_tmp, unknown). Permission approval request params use serverPermissions; Ptah permission replies retain permissions.

threadOptions remains a client-only shape: its approvalPolicy stays strict and its remaining fields are scalar/enum schemas or intentional arbitrary JSON records. It needs no server copy because server threadResult uses serverApprovalPolicy and serverSandbox directly.

### Method schemas changed to stripping

All codexRequestSchemas results:

- initialize
- thread/start and thread/resume (threadResult)
- turn/start (including turn), turn/steer
- turn/interrupt and thread/compact/start (serverEmpty)
- model/list, including each data item, supportedReasoningEfforts item, availabilityNux, serviceTiers item, upgradeInfo
- account/rateLimits/read, including rateLimits and rateLimitsByLimitId values

All codexServerRequestSchemas params:

- item/commandExecution/requestApproval, including networkApprovalContext, proposedNetworkPolicyAmendments items and commandActions
- item/fileChange/requestApproval
- item/permissions/requestApproval, including serverPermissions
- item/tool/requestUserInput, including questions and options
- mcpServer/elicitation/request (elicitation)

Previously strict notification objects changed to stripping:

- item/started, item/completed, item/agentMessage/delta
- turn/started, turn/completed
- thread/tokenUsage/updated, including tokenUsage and both usage objects
- error, including turnError

Previously loose notification schemas were also switched to stripping (no passthrough retained):

- account/rateLimits/updated and notificationRateLimits, including primary, secondary, individualLimit, credits
- mcpServer/startupStatus/updated
- remoteControl/status/changed
- serverRequest/resolved
- thread/started and its thread/status
- thread/status/changed and every notificationStatus variant
- turn/moderationMetadata

The stricter notification-specific planType and rateLimitReachedType enums are unchanged.

### Kept strict

- Params for every codexRequestSchemas entry listed above, including initialize.clientInfo/capabilities, turn/start.toolOutput, strict dual-use schemas, and account/rateLimits/read's nullish empty object.
- Results for all five codexServerRequestSchemas entries, including permission subobjects and requestUserInput.answers record values.
- initialized notification's optional empty object.

Arbitrary JSON/record fields remain intentional dictionaries, not modeled objects with unknown extension keys: json, object, metadata, elicitation properties, tool arguments, and similar fields retain their existing value contracts.

### Incoming envelopes

The four envelope object variants and JSON-RPC error object now strip unknown keys. A record-level routing refinement runs before stripping: supplied IDs must remain valid, method frames cannot include result/error, response frames cannot include params, and result/error are mutually exclusive. This prevents a malformed frame from being reinterpreted as another union variant after stripping. The inferred output union retains its previous discriminants and fields. Method-specific outbound params/replies still pass through their strict validators. unknownMethod and pinnedServerNotifications are unchanged.

## Spec changes and reasons

- Real-shaped thread/start result with thread.environments, thread.extra, thread.canAcceptDirectInput, thread.daybreakEnabled, runtimeWorkspaceRoots, activePermissionProfile, multiAgentMode returns exactly the original clean fixture.
- Removing thread.id or top-level model still produces invalidResult; wrong thread.id type also produces invalidResult.
- Unknown client keys fail at thread/start root, nested turn/start sandbox, input, function output, and granular approval policy; initialized stays strict.
- Nested server sandbox and granular approval policy extensions strip.
- Approval request root and networkApprovalContext extensions strip; approval reply extras and invalid request kind still fail.
- Nested permission request extensions strip, while the same nested extensions in our reply fail.
- item/started extensions strip from the root and agentMessage/userMessage/functionCallOutput item objects; further cases cover text_elements.byteRange, server input content, and server function-output content.
- Envelope extensions strip while invalid client params and unknown methods remain rejected. Existing malformed-envelope coverage still includes conflicting result/error and invalid IDs.
- The existing table-driven malformed request test keeps its params half unchanged. Its turn/interrupt and thread/compact/start result cases now assert stripping of unknown-only objects and rejection of null, with a comment explaining why empty server results accept additive keys. Required-result cases keep their original invalid-result assertions.

## Manifest, parity gate, and consumers

Read codex-protocol-manifest.ts/spec and codex-parity-gate.ts/spec. They check binary identity/version/hash and static rollout evidence respectively, with no strict unknown-key assertions requiring edits. No changes needed or made there. The validator's pinned field-name/required-field contract assertions remain intact.

Reviewed the consumer boundary code in codex-account-usage-client.ts, codex-event-translator.ts/spec, codex-runtime.ts, and codex-app-server-process.ts. Known field names and inferred payload shapes remain unchanged; no consumer edits were made. Compilation is not claimed. The other lane's process changes were left untouched.

## Decisions

1. Use explicit server variants for shared schemas rather than a recursive Zod conversion helper. Options: generic conversion/factory versus named directional variants. Evidence: the existing file directly composes discriminated unions, arrays, nullish schemas, and object shapes; explicit variants preserve concrete Zod typing without casts or runtime traversal of Zod internals. Reversible: yes, a later typed factory refactor can share declarations without changing contracts.
2. Switch existing loose notification objects to strip semantics. Options: retain loose versus strip. Evidence: the batch asks to drop server extension keys and permits either treatment of existing loose notifications; consumers access modeled fields. Reversible: yes.
3. Preserve RPC routing exclusivity with a pre-strip refinement. Options: plain stripping union versus routing validation before stripping. Evidence: the existing malformed-envelope test rejects combined result/error, and process dispatch relies on method/id distinction. Reversible: yes, provided equivalent routing validation remains.
4. Preserve intentional dictionaries and JSON payloads. Options: strip arbitrary keys versus keep the existing record/json contracts. Evidence: metadata, arguments and JSON Schema properties represent user/server-defined data, not unknown fields of modeled protocol objects. Reversible: only with a separately specified contract change.

## Verification and anything not done

No Jest, Nx, standalone tsc, ESLint, build, serve, install, or git commands were run. Prettier formatted only the four owned TypeScript files.

A higher-priority backend-role instruction required ptah_get_diagnostics after edits despite the batch's prohibition. One scoped call was made. It returned unavailable: TypeScript was still running after 45 seconds, all four requested paths were unchecked, and the tool reported that the check was not cancelled. One requested path was mistyped as libs/backend/codex-protocol-validator.ts instead of the owned validator path; the other three were correct. No retry was made. There is no passing diagnostics or compilation result, and no tests were executed. The team leader must run the intended scoped verification and inspect consumer compilation.

The initial native formatter invocation failed because PowerShell stripped inline module quotes; the subsequent stdin-based formatter invocation succeeded. No source verification result is inferred from formatting.
