# PR #580 round 3 — system-message text validation

## Verdict and evidence

**The finding is valid and fixed.** Before this follow-up, `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:83` checked only the block's `type`. A direct probe of that schema accepted system text blocks with absent, null, numeric, and object `text` values. `request-translator.ts:105` and `responses-request-translator.ts:202` map block text and join it: missing/null values become empty text and other values are coerced. Their whitespace checks then omit empty system instructions. The system-role dispatch reaches these helpers at `request-translator.ts:134` and `responses-request-translator.ts:230`.

Installed dependency evidence, resolved from `D:/projects/ptah-extension/node_modules`:

- `@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:3403`: `BetaTextBlockParam` requires `text: string` at line 3404.
- The same file at `:2953` defines `BetaMessageParam`; content is `string | Array<BetaContentBlockParam>` at line 2954, and roles include `system` at line 2955. It does not narrow system turns to text-only arrays.
- `BetaContentBlockParam` at `:2082` includes non-text variants, including `BetaRequestToolAdditionBlock` and `BetaRequestToolRemovalBlock`. Their declarations at `:3259` and `:3273` describe mid-conversation tool directives with no `text` field. The tool reference shape is declared at `:3830`.

**Decision:** preserve non-text system blocks under the SDK's declared contract; rejecting every non-text block would impose an unsupported restriction. Require string `text` only when a system block has `type: 'text'`. Preserve the existing open validation of user/assistant blocks and native extensions.

The manifest and lockfile pin Anthropic SDK 0.127.0, Claude Agent SDK 0.3.278, Zod 4.6.5, and TypeScript 6.0.3. This remains the existing Node HTTP proxy, with existing constructor wiring and no new dependency or registration.

## Fix

- `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:87`: add a role-scoped Zod refinement. It inspects system-message content arrays and rejects text blocks whose `text` is absent or not a string. String content remains valid. Other roles and non-text blocks retain their existing validation and passthrough behavior.
- `translation-proxy-base.ts:96`: attach each issue to `content.<index>.text`; the enclosing schema supplies the messages path. The existing field-only response formatter at `:400` removes array indices and deduplicates paths. The response at `:416` therefore says `Invalid Messages request: invalid fields: messages.content.text`, without request values, tokens, or raw Zod issue messages.
- Reused the repository's `superRefine`/`addIssue` pattern, observed in `libs/shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts:124` and the platform worker protocol. No translator changes were necessary.

## Regression coverage

`libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts`:

- `:501`: six added cases cover missing, null, numeric, boolean, array, and object text. Each uses duplicate malformed blocks to verify path deduplication, asserts the exact field-only 400, and confirms rejection before model normalization, authentication, or upstream resolution. Private marker values must not appear in the response.
- `:549`: one added native round trip preserves non-text system tool directives and confirms unchanged user/assistant validation for missing/null text and provider extension blocks.
- Existing three-lane cases at `:363` remain green: valid system text blocks and valid system strings are accepted, translated in their original conversation positions for Chat Completions/Responses, and preserved for native Messages.

**Seven new test cases; existing positive cases retained.**

## Verification

Executed once in the requested worktree:

```powershell
npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers --skip-nx-cache 2>&1 | Select-Object -Last 30
```

**PASS: 3/3 targets, 48/48 suites, 888/888 tests, 2/2 snapshots.** Nx duration: 1m 10s; Jest duration: 64.152s. Because Nx suppressed successful task details, counts were recovered from its saved output at `C:/Users/abdal/.nx/d66630b900f534d5/cache/terminalOutputs/8957601105235163752`, identifying this worktree's auth-providers configuration. No suite was rerun to recover output.

- Scoped `ptah_get_diagnostics` on the two changed TypeScript files: **0 errors, 0 warnings** from the TypeScript compiler provider.
- `npx prettier --write` on both changed TypeScript files and this report: **passed**.

## Scope and limitations

Work was limited to the requested new worktree. No git commands were run. The old proxy-fix worktree, frontend files, and Electron E2E files were not touched. The task folder's `task.md` was read without modification; the explicit review-follow-up request defines this backend assignment.

This fix validates the specified system text boundary. It does not add translation support or deeper validation for non-text SDK/provider extensions. No live external-provider session was needed or performed.

## Files written

Root: `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66`.

- MODIFIED `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts`
- MODIFIED `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts`
- CREATED `.ptah/specs/TASK_2026_534_lane_console/pr-580-round3-proxy.md`
