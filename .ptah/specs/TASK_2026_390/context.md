# Context — TASK_2026_390

## The defect

Observed 2026-09-07: a spawned Codex agent hit the OpenAI usage limit. The
`@openai/codex-sdk` rejects with an `Error` whose `.message` is not a headline —
it embeds the last ~500 lines of the child process's captured output:

```
Codex SDK Error: Codex Exec exited with code 1: Reading prompt from stdin...
ERROR codex_core::tools::router ...
Total output lines: 500 Output: <hundreds of lines of grep results>
```

`CodexCliAdapter.runSdk`'s catch block forwarded `.message` verbatim into both
`output.emit` and `segment.emit`, so the whole dump rendered as one error block
in the chat bubble / agent card. Two separate problems:

1. **The forwarded text was unbounded.** Whatever the vendor put in `.message`
   went straight to the UI.
2. **A quota failure was not recognised.** The one actionable fact — "usage
   limit, retry at 5:05 PM" — was buried in the dump instead of being the
   message.

`CursorCliAdapter` had the identical verbatim-forward pattern. The spawn-based
adapters (copilot, antigravity, opencode, pi) do not: they stream the child's
stdio and were left alone.

## The fix

`sdk-error-summary.ts` — one pure function, `summarizeCliSdkError(error,
vendor)`:

- **Usage limit** (`/usage limit/i`) collapses to
  `Codex usage limit reached. Try again at 5:05 PM.`, keeping the retry hint
  only when it parses and is at most 40 characters.
- **Everything else** keeps the SDK's own headline — first non-empty line, cut
  at the `Output:` marker where the dump begins — capped at 500 characters and
  marked `[output truncated]` when anything was dropped. The exit code lives in
  that headline, so it survives.

It is vendor-parameterised rather than Codex-specific because Cursor needed the
same treatment.

**Nothing is lost for diagnostics.** Both adapters now take an optional
`Logger` (supplied by `CliDetectionService`, which already has one) and log the
FULL original text before emitting the summary. The `AbortError` branch is
untouched.

## Verification

- `npx nx test @ptah-extension/cli-agent-runtime` — 51 suites, 658 passed,
  1 skipped.
- `npx nx lint @ptah-extension/cli-agent-runtime` — 0 errors (36 pre-existing
  warnings, none in the changed files).
- `npx nx typecheck @ptah-extension/cli-agent-runtime` — clean.
