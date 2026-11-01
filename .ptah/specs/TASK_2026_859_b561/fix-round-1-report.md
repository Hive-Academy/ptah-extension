# Fix round 1 report — TASK_2026_859_b561

Status: complete. All seven findings have implementation and spec changes. No local test or type-check command ran, as instructed.

## Finding 1 — Required inputs

- Added stable `McpRequiredInput.key` values and keyed supplied values in `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:17` and `:441`.
- Required env, header, URL, and argument inputs now block installation until resolved. Optional unset values stay out of the config.
- Added detail-panel inputs, secret masking, choice selects, and computed installability in `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:237` and `:422`.
- Added repeatable `--input NAME=VALUE` handling in `apps/ptah-cli/src/cli/commands/mcp.ts:246` and `apps/ptah-cli/src/cli/router.ts:1762`.
- Specs: `mcp-registry-config.mapper.spec.ts:160`, `:422`, `:440`; `mcp-directory-browser.component.spec.ts:335`, `:407`; `mcp.spec.ts:392`, `:456`.

## Finding 2 — CLI list errors

- Added coded-result reporting to stderr with `ExitCode.GeneralError` in `apps/ptah-cli/src/cli/commands/mcp.ts:137`, `:175`, and `:423`.
- Specs: `mcp.spec.ts:194` and `:782` assert non-zero exits and no success notification.

## Finding 3 — Detail errors

- Added optional detail `errorCode` and `error` fields in `libs/shared/src/lib/types/mcp-directory.types.ts:843`.
- `getDetails` now returns shape and availability codes in `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:432`.
- The provider still returns `null` for 404. It now passes network failures to the RPC boundary in `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.ts:274`.
- The component and CLI present the coded detail error in `mcp-directory-browser.component.ts:570` and `apps/ptah-cli/src/cli/commands/mcp.ts:202`.
- Specs: `mcp-directory-rpc.handlers.spec.ts:294`, `:317`; `mcp-registry.provider.spec.ts:229`; `mcp-directory-browser.component.spec.ts:487`; `mcp.spec.ts:245`.

## Finding 4 — Placeholder resolution

- Added declared-variable resolution for argument and header values in `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:136` and `:190`.
- Unresolved placeholders add required inputs and block installation. Argument and header text stays unchanged when no variables are declared.
- Specs: `mcp-registry-config.mapper.spec.ts:478`, `:502`, `:528`, `:550`, and `:567`.

## Finding 5 — Secret preview

- Added a separate redacted `preview` config in `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:41`, `:271`, and `:395`.
- Secret env values, headers, arguments, nested variables, and URL variables use `••••••` only in the preview.
- The component summary reads the preview in `mcp-directory-browser.component.ts:699`. Installation reads the real config at `:610`.
- Specs: `mcp-registry-config.mapper.spec.ts:422`, `:528`, `:586`, `:611`; `mcp-directory-browser.component.spec.ts:335`.

## Finding 6 — Registry availability

- Added `MCP_REGISTRY_UNAVAILABLE` and its safe message in `libs/shared/src/lib/types/mcp-directory.types.ts:195` and `:205`.
- Official search and popular non-shape failures return the code in `mcp-directory-rpc.handlers.ts:379` and `:615`. Smithery error behavior is unchanged.
- The component shows coded errors instead of an empty-list message in `mcp-directory-browser.component.ts:142`, `:727`, and `:761`.
- Specs: `mcp-directory-rpc.handlers.spec.ts:212`, `:558`; `mcp-directory-browser.component.spec.ts:507`, `:524`; `mcp.spec.ts:782`.

## Finding 7 — Unsupported remote transport

- Added `MCP_REMOTE_TRANSPORT_UNSUPPORTED` in `libs/shared/src/lib/types/mcp-directory.types.ts:199` and `:213`.
- Remote-only unsupported entries now return that code in `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:473`.
- Spec: `mcp-registry-config.mapper.spec.ts:629`.

## Placeholder key form

The key form is `${location}:${varName}`. For a nested argument or header variable, `location` is the parent input location. Examples: `argument:host`, `header:token`, and `url:api_host`. Direct inputs use the same form, such as `env:AI_2KW_API_KEY` and `argument:--token`.

Resolution precedence is registry `value`, then registry `default`, then the supplied non-empty value. The component and CLI both pass values by this key.

## Files modified

- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-directory.types.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/apps/ptah-cli/src/cli/commands/mcp.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/apps/ptah-cli/src/cli/commands/mcp.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/apps/ptah-cli/src/cli/router.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/.ptah/specs/TASK_2026_859_b561/fix-round-1-report.md`

## Decisions

- Keep supplied inputs in `requiredInputs` so form fields do not disappear while the user types. `installable` tracks resolution separately. The CLI reports only inputs that remain missing.
- Use `ExitCode.GeneralError` for coded registry failures. Transport failures and mapper exceptions keep their existing error paths.
- Pass detail network failures through the provider to the RPC handler. This is necessary because the provider previously converted them to the same `null` used for 404.
- Keep optional secret inputs editable without blocking installation. Required unresolved inputs block installation.
- Reuse existing component classes and target-selection logic. No install-scope file changed.

## Verification

- Tree-sitter parsed every edited TypeScript file with no syntax errors.
- `git diff --check` passed.
- No `npm run verify`, Nx, Jest, TypeScript, build, or other heavy check ran, as instructed. CI remains the verification gate.
