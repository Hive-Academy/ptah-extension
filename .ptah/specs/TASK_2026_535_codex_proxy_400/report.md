# TASK_2026_535_codex_proxy_400 — implementation report

## Outcome

Fixed the proxy envelope regression. **The rejected field is `messages[1].role`: Claude Agent SDK 0.3.278 / Claude Code 2.1.278 legitimately sends `"system"` in the messages array.** A local capture reproduced this with model `gpt-5.6-sol`; `max_tokens` was a valid integer, **32000**. No token fallback or model/options change was needed.

All source changes are within `libs/backend/auth-providers`. No git commands were run.

## Root cause and evidence

Paths below are relative to this worktree unless absolute:
`D:\projects\ptah-extension\.claude-worktrees\fix-codex-proxy-envelope-400-639af16869db`.

1. `package.json:101` pins Claude Agent SDK 0.3.278; `package.json:102` pins Anthropic SDK 0.127.0. The lockfile agrees. Dependencies resolve from the parent workspace's `node_modules`, not a separate worktree installation. The installed `D:/projects/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/package.json:3` confirms 0.3.278, and line 83 identifies CLI 2.1.278.
2. **Static contract proof:** `D:/projects/ptah-extension/node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:2953` defines `BetaMessageParam`, and line **2955** permits `role: 'user' | 'assistant' | 'system'`. Content is a string or content-block array at line 2954. The pre-fix proxy schema at `translation/translation-proxy-base.ts:72` admitted only `user` and `assistant`; its generic rejection was at lines 363–366. The corrected schema is now at lines 71–92, including `system` at line 80.
3. **Actual SDK reproduction:** invoked the installed SDK's `query()` with a synthetic `Reply hello.` prompt, `model: 'gpt-5.6-sol'`, `tools: []`, no MCP servers, no setting sources, `persistSession: false`, and a loopback `ANTHROPIC_BASE_URL` with a placeholder API key. A temporary in-memory HTTP server captured request structure only, checked the original schema, and ended the diagnostic. It did not send an inference request to an external provider or print message content or credentials. Output:

   ```json
   {
     "url": "/v1/messages?beta=true",
     "model": "gpt-5.6-sol",
     "max_tokens": 32000,
     "stream": true,
     "messages": [
       { "role": "user", "blockTypes": ["text", "text"] },
       { "role": "system", "blockTypes": ["text"] }
     ],
     "validation": [{ "path": ["messages", 1, "role"], "code": "invalid_value" }]
   }
   ```

   The CLI also emitted `unrecognized_model`. Thus that notice does not imply a missing or invalid token limit. This reproduces the reported failure with the installed dependency versions; the original Electron request body was not supplied, so its exact bytes cannot be independently confirmed.

4. **CLI implementation:** the installed package ships native `D:/projects/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`, not `cli.js`. Read-only inspection of embedded JavaScript found `api_system` construction with `role:"system"` at byte offset **202529236**, and wire serialization of system turns at offsets **205066569** and **205066802**. The unknown-model output-token default is `Rz=32000` at offset **198330168**, selected by `v6` at **198332933** and used in request `max_tokens` at **204995396**. These are binary byte offsets, not invented source line numbers. `sdk.mjs:228` resolves the platform CLI, while line 127 forwards the SDK options into CLI arguments.
5. **Ptah model path is correct:** `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:785` resolves the model and line 942 passes it to the SDK; lines 993–1008 construct the provider environment without assigning an output-token limit. `sdk-model-service.ts:1056` delegates to `ModelResolver`; `libs/backend/auth-providers/src/lib/auth/model-resolver.ts:57` resolves tier environment overrides and line 90 preserves concrete IDs. `providers/codex/codex-translation-proxy.ts:106` preserves non-Claude model IDs; line 130 selects Responses for Codex. No changes to these paths were necessary.

## Implementation

- `translation/translation-proxy-base.ts:80`: allow the SDK's system role alongside user and assistant. Nonempty model, positive integer `max_tokens`, array/messages/content shape, and optional boolean stream validation remain enforced. Unknown fields and block types retain the existing passthrough behavior.
- `translation/translation-proxy-base.ts:384`: build the 400 explanation from Zod issue paths, deduplicate them, and include **field names only**. Array indices, issue messages, and request values are excluded. Invalid roots use `body`. Example: `Invalid Messages request: invalid fields: messages.role`.
- `translation/openai-translation.types.ts:195`: represent system turns in the local wire type.
- `translation/request-translator.ts:134`: preserve system text in its conversation position as a Chat Completions system message, reusing the existing system-text translator.
- `translation/responses-request-translator.ts:230`: preserve that text and position as a Responses developer message, matching the existing top-level system mapping. Accepting the role without these changes would silently discard the SDK instructions.
- Native Messages forwarding retains its original request bytes and fields (`translation/translation-proxy-base.ts:456`). No new module, registration, dependency, configuration setting, or compatibility shim was introduced.

## Specs

- `translation/translation-proxy-base.spec.ts:363`: **17 added cases**: 3 protocol-lane round trips; 12 malformed-field cases; 2 malformed-root cases. Synthetic fixtures reproduce the captured user-text/system-text shape with the same model and token limit. They additionally check top-level and in-conversation system ordering, string/block content, native passthrough, empty user string/array content, rejection before auth/upstream access, and field-only errors without private values.
- `providers/codex/codex-translation-proxy.spec.ts:82`: **7 existing transport cases strengthened** to send the SDK regression shape through the production Codex proxy at `/v1/messages?beta=true`. They assert preservation as a developer input item and retain coverage of OAuth forced SSE, caller streaming, API-key JSON, and alternate endpoint behavior.
- The original schema's failure was demonstrated by the real SDK capture before the edit. The final HTTP specs prove the same role shape reaches upstream successfully and malformed input still receives 400.

## Stack and repository conventions observed

This code uses Node's built-in HTTP server, not NestJS (`translation-proxy-base.ts:1–30`), TypeScript 6.0.3 (`package.json:283`), Zod 4.6.5 (`package.json:198`), and existing tsyringe constructor wiring (`codex-translation-proxy.ts:26–38`). Existing Logger/sendErrorResponse conventions were retained. Project scope/type tags and verification targets are declared in `libs/backend/auth-providers/project.json`; cross-library rules are in `eslint.config.mjs:254` and `:365`. No new cross-library imports were added. Root CONTRIBUTING/README guidance and sibling proxy/translator specs were inspected; no applicable AGENTS.md, CLAUDE.md, batch, plan, or task-description document was present for this task.

## Verification

- Required command, run once:
  `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers --skip-nx-cache 2>&1 | Select-Object -Last 30`
  **PASS: 3/3 targets; 48/48 suites; 881/881 tests; 2/2 snapshots.** Nx duration 1m 8s; Jest duration 62.047s. Nx suppressed successful task details in the terminal, so counts were read from the saved output at `C:/Users/abdal/.nx/d66630b900f534d5/cache/terminalOutputs/10409521949666289148`, whose header identifies this worktree's auth-providers Jest configuration. No suite was rerun to recover output.
- `ptah_get_diagnostics`, scoped to all six changed source/spec files: **0 errors, 0 warnings**, TypeScript compiler provider.
- `npx nx build @ptah-extension/auth-providers --skip-nx-cache --output-style=static 2>&1 | Select-Object -Last 20`: **PASS**, 1m 30s. Nx automatically ran the project's 8 dependency build tasks through its declared `^build` configuration; no dependency sources were edited.
- `npx prettier --write` on all six changed TypeScript files: **PASS**. The report was formatted separately. Prettier also normalized existing formatting in the large proxy and proxy-spec files.

## Open risks and limits

- A complete Electron UI session with real OAuth credentials was not run. Evidence consists of the installed SDK/CLI loopback capture, production Codex proxy transport specs, all auth-providers tests, lint, typecheck, and build.
- Native beta fields remain passthrough. The translated lanes retain their existing supported-field scope: system text is now preserved, while Anthropic-specific block extensions and per-message controls such as `output_config` or `clear_at` do not gain a full semantic translation in this fix.
- Jest emitted existing executor-deprecation/module-loading warnings, but completed all 48 suites successfully.
- The improved 400 remains the smallest safe diagnostic if a future SDK adds another incompatible shape: it reports the field path without exposing message content or credentials.

## Files written

All paths share the worktree root stated above:

1. `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts`
2. `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts`
3. `libs/backend/auth-providers/src/lib/translation/openai-translation.types.ts`
4. `libs/backend/auth-providers/src/lib/translation/request-translator.ts`
5. `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts`
6. `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts`
7. `.ptah/specs/TASK_2026_535_codex_proxy_400/report.md`
