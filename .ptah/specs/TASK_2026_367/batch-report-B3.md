# Batch B3 — Remove PulseMCP registry source

## Files deleted

- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/pulsemcp-registry.source.ts`
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/pulsemcp-registry.source.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/pulsemcp-wire.constants.ts`

## Files modified

- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/index.ts` — removed PulseMCP exports.
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry-source.interface.ts` — `McpRegistrySourceId` narrowed to `'official' | 'smithery'`.
- `libs/backend/cli-agent-runtime/CLAUDE.md` — removed PulseMCP from the mcp-directory surface description; recorded that `v0beta` returned `410 Gone` and `v0.1` is key-gated, so the source was removed rather than repointed.
- `libs/shared/src/lib/types/mcp-directory.types.ts` — `McpRegistrySourceKind` narrowed to `'official' | 'smithery'`.
- `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts` — dropped PulseMCP import, field, construction/registration, and the `getPopular` branch.
- `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts` — dropped PulseMCP cases; added spec that `getPopular` with an unknown source falls back to the official registry and never throws.
- `libs/backend/rpc-handlers/src/lib/harness/ai/harness-workflow-prompt.service.ts` — prompt text now names official + Smithery only.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` — tool description updated to the two remaining sources.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts` — `HarnessMcpServerResult.source` narrowed; removed `pulseMcpRegistry` dependency; `searchMcpRegistry` fans out to two sources; updated stale comment.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts` — removed all PulseMCP test cases; added assertions that `searchMcpRegistry` fans out to exactly two sources and reports only `official` + `smithery`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` — updated inline tool summary (not in the explicit modify list, but contained a PulseMCP reference).
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` — removed PulseMCP import and wiring.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts` — removed PulseMCP stub.
- `apps/ptah-docs/src/content/docs/mcp-and-skills/ptah-tools.md` — updated the `ptah_harness_search_mcp_registry` description.

## Remaining `pulsemcp` / `PulseMcp` / `PulseMCP` grep hits

All remaining hits are intentional documentation or a deliberate fallback test:

- `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts:249` — `source: 'pulsemcp' as never` used to assert unknown-source fallback.
- `libs/backend/cli-agent-runtime/CLAUDE.md:17-18` — records why PulseMCP was removed.
- `.ptah/specs/TASK_2026_367/` — task documentation (expected).
- `tmp/logs/log.log` — runtime log (expected).

No hits remain in `libs/`, `apps/`, or `docs/` source code outside the intentional items above.

## Verification results

### Tests

Command: `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools @ptah-extension/shared`

- First run: `@ptah-extension/rpc-handlers:test` failed because `libs/backend/memory-curator` (another concurrent agent's files) had compile errors (`clampTranscript`, `CURATOR_TRANSCRIPT_MAX_CHARS`, `windowRunner`). This was outside Batch B3's files; per instructions it was not fixed.
- Re-run: **4 projects passed**.
  - `@ptah-extension/shared`: 51 suites passed, 1231 tests passed.
  - `@ptah-extension/cli-agent-runtime`: 43 suites passed, 533 tests passed.
  - `@ptah-extension/vscode-lm-tools`: 46 suites passed, 980 tests passed.
  - `@ptah-extension/rpc-handlers`: 91 suites passed, 2619 tests passed, 31 skipped.

### Lint

Command: `npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools @ptah-extension/shared`

- 4 projects passed with pre-existing warnings only (no new errors):
  - `@ptah-extension/cli-agent-runtime`: 35 warnings (existing).
  - `@ptah-extension/shared`: 1 warning (existing).
  - `@ptah-extension/vscode-lm-tools`: 21 warnings (existing).
  - `@ptah-extension/rpc-handlers`: 18 warnings (existing).

### Type check

Command: `npm run typecheck:all`

- **Successfully ran target `typecheck` for 70 projects** — no errors.

## Deviations / notes

- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` was edited even though it was not in the explicit per-file modify list. It contained a PulseMCP reference in an inline tool summary and is not in the off-limits set (`index.ts`, `protocol-dispatcher.ts`, `slow-tool-warning.ts`, `ptah-tool-catalog.ts`, `mcp-http/*`, `di/register.ts`).
- The first test run exposed unrelated `memory-curator` compile errors from another concurrent agent's work. It was re-run once and passed on the second attempt; no Batch B3 files were changed.

## Left undone

None. All files listed in section 9 of the implementation plan have been edited or deleted, the follow-up repo-wide grep is clean, and verification passed.

DONE: B3 — PulseMCP registry source removed; verification passed on re-run.
