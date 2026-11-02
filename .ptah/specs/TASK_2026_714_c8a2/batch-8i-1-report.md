# Batch 8i-1: D7 open failure diagnostics

Implemented cause-preserving failure diagnostics, injected logging, bounded redacted stderr capture, and regression specs. No protocol acceptance or runtime routing changes.

## Changes

- `libs/backend/codex-runtime/src/lib/codex-runtime.ts:120`: open failures retain the original instance in native ES2022 `Error.cause`, preserving the exact public message `Codex context could not be opened`. Home mismatches are still rethrown unchanged. One error-level log supplies flat metadata: `errorClass`, `errorMessage`, optional `failedMethod`, optional `rpcCode` for a direct rejected request, optional `rootCauseClass`/`rootCauseMessage`, and `stderrTail` capped at 2048 UTF-8 bytes. Root traversal guards cycles. SyntaxError messages use `Invalid JSON` to avoid parser excerpts of raw frames. RuntimeContext passes the logger to the process and forwards the redacted tail at line 293.
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:81`: exported typed failure class retains reason, method, and native cause. Constructor at line 120 accepts an optional trailing logger. Failures preserve the first error via `??=`. Validation, JSON decoding, write, initialization, child-error and approval-handler exceptions retain causes. Correlated response methods and inbound frame method names are captured before validation; a sole pending request supplies a fallback when a malformed frame has no readable method. Debug logs at rejection/failure contain reason, method, RPC code when applicable, and redacted stderr only. Data listener is removed during cleanup at line 543.
- `libs/backend/codex-runtime/src/lib/codex-stderr-tail.ts:5`: credential redaction covers Bearer credentials, sk-style keys, Authorization header values, api_key/api-key/apikey assignments and token assignments, including quoted and unfinished quoted values. The bounded line queue at line 17 retains no more than 8192 UTF-8 bytes and 50 lines, dropping oldest lines. Buffer chunks use StringDecoder; strings are accepted directly. Oversized individual lines are discarded until newline with a marker so a retained suffix cannot expose a credential. Redaction happens before accessor byte truncation.
- `libs/backend/codex-runtime/src/index.ts:80`: package-root export of CodexProcessFailureError for the probe. Process and tail classes remain available from their implementation modules, consistent with the existing private process boundary.

## Exact API for Batch 8i-2

```ts
// Package root and ./lib/codex-app-server-process
export class CodexProcessFailureError extends Error {
  readonly reason: string;
  readonly method?: string;
  constructor(reason: string, method?: string, options?: ErrorOptions);
  // Inherited cause?: unknown; name === 'CodexProcessFailureError'; message === reason.
}

// ./lib/codex-app-server-process (existing class, not newly exported from package root)
constructor(
  spawner: IProcessSpawner,
  executable: CodexExecutableSource,
  binary: CodexBinaryIdentity,
  profile: CodexExecutionProfile,
  handlers: CodexAppServerHandlers,
  logger?: CodexRuntimeLogger,
);
stderrTail(maxBytes?: number): string;

// ./lib/codex-stderr-tail (internal module exports)
export function redactCodexDiagnostics(text: string): string;
export class CodexStderrTail {
  append(chunk: Buffer | string): void;
  tail(maxBytes?: number): string;
}
```

The tail accessor defaults to 8192 bytes, clamps finite limits to 0..8192 (floored), and uses 8192 for non-finite values. It returns redacted text and remains readable after process cleanup. For runtime-only probes, capture logger metadata `stderrTail` (2048 bytes) and inspect the thrown error's `cause`; no RuntimeContext API is exposed on CodexContext. Rejection debug metadata uses `method`; runtime error metadata uses `failedMethod`. No params, results, complete frames or remote rejection messages are supplied to logging.

## Specs added

- `codex-runtime.spec.ts:270`: protocol failure metadata/root cause; parser excerpt exclusion at 301; original persistence cause identity at 331; exact home mismatch identity at 344; rejected thread/start method/RPC code, redacted stderr, and exclusion of request/remote-message sentinels across every logger method at 357.
- `codex-app-server-process.spec.ts:158`: pending thread/start validator cause and method, first-error retention, one failure debug log, and payload sentinel exclusion. Inbound method at 191; original handler exception identity at 203; rejection debug metadata, Buffer/string stderr capture, limits, oldest removal, credential exclusion, and listener release at 227.
- `codex-stderr-tail.spec.ts:3`: split credential chunks, quoted/unfinished quoted credentials, byte/line bounds, oldest removal, oversized credential-line discard/recovery, UTF-8 fragmentation and small/zero accessor limits.

## Evidence and verification

- Target support: `tsconfig.base.json:11` targets ES2022 and its lib includes es2022; codex-runtime tsconfigs inherit it.
- Logger contract: `codex-runtime-ports.ts:47` accepts only flat string/number/boolean metadata. Existing protocol and request-rejection errors deliberately omit raw wire values; logging follows that convention.
- Requirements: task carrier, context, Batch 8i plan and live-test-p8d D7 evidence read; repository CLAUDE.md/CONTRIBUTING.md and local schema contracts consulted.
- Requested grep for `could not be opened` in `libs/backend/agent-sdk` and `libs/backend/rpc-handlers`: no matches; neither library edited.
- No npm verify, Nx, Jest, standalone tsc, build, serve, e2e, package, installation, git commands, real Codex process or paid run executed.
- Instruction conflict: the higher-priority backend role explicitly requires ptah_get_diagnostics after edits, whereas the batch prompt forbids it. One scoped call was made for the six changed source/spec files; it returned TypeScript compiler diagnostics with clean coverage, 0 errors and 0 warnings. This snapshot preceded final minor edits (home-mismatch failure logging, notification fixture correction, parser regression, unfinished-quote redaction and formatting); it is not a final test pass. No test suite was run. Team leader owns final verification.
- Prettier formatted only owned TypeScript files. AST inspection of the three implementation files reported no parse errors before the final quoted-redaction adjustment.

## Decisions

1. Native ErrorOptions rather than a manually assigned cause. Evidence: ES2022 target/lib and existing Error subclasses. Reversible; no new runtime dependency.
2. Preserve CodexHomeMismatchError itself in process failure storage and runtime rethrow. Alternative: wrapping it would break the explicitly required existing classification. Evidence: existing startup catch and home mismatch specs. Reversible but the identity contract must remain.
3. Use a bounded line queue in a dedicated module, with oversized-line discard until newline. Alternative: raw byte suffix truncation could lose Authorization/token prefixes and expose secrets. Evidence: required byte/line caps and redacted accessor. Reversible internal storage decision.
4. Use inbound frame method first, correlated response method second, and only a sole pending request as fallback; do not guess among concurrent pending requests. Evidence: existing request map and frame validation path. Reversible; no wire changes.
5. Export only the new failure class at package root. Alternative: exporting the whole process would broaden the existing private process boundary. Evidence: index.ts documents process/validator as implementation details; runtime logger metadata already supports the next probe. Reversible additive export.
6. Sanitize SyntaxError excerpts and non-Error thrown values while retaining the original cause object. Alternative: logging parser messages can expose raw frames. Evidence: onData performs JSON.parse on inbound wire data. Reversible diagnostic formatting, no behavior change.

## Not done

Final test execution is deferred to the team leader. No live reproduction of D7 or protocol behavior fix was attempted: this batch makes the existing failure diagnosable.

## Absolute paths created or modified

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-app-server-process.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-stderr-tail.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-stderr-tail.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8i-1-report.md
