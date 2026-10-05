# CodeRabbit batch CR1 report

## Findings

1. **Fixed — authored `note` grammar drift.** Removed unsupported `note` from the ptah-ui grammar, keyword table, and text-position guidance. Regenerated `content-manifest.json`.
   - Changed: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/ptah-ui.md`, `content-manifest.json`

2. **Fixed — `chat:resume activate:true` ptah-ui capability forwarding.** Added `ptahUiFence` to the resume RPC type and schema; passed it through activation preflight to the SDK resume request; and set it for Electron resume requests. Added true/false/undefined forwarding coverage.
   - Changed: `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`, `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`, `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`, `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.ptah-ui-flag.spec.ts`, `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`

3. **Fixed — semicolon-masked test results.** A test segment followed by `;` and a non-empty command is now classified as masked. Existing pipe and `||` handling remains covered alongside the new fixture.
   - Changed: `libs/shared/src/lib/utils/test-command-matcher.ts`, `libs/shared/src/lib/utils/test-command.fixtures.ts`, `libs/shared/src/lib/utils/test-command-matcher.spec.ts`

4. **Fixed — whole ptah-ui header keywords.** `title` and `chart` now dispatch only exactly or before a space; source `table` and `list` dispatch only before a space. Added prefix-rejection cases.
   - Changed: `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts`, `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts`

5. **Fixed — repeated chart-header spacing.** Chart headers accept repeated delimiter spaces while preserving internal spaces in the title. Existing invalid-header/title syntax failures remain intact.
   - Changed: `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts`, `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts`

6. **Fixed — zero-column row sources.** Table/list row-source uses of `$usage` now fail during parsing with an author-facing reason instead of reaching the resolver and becoming a list. Updated the resolver-pipeline regression case.
   - Changed: `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts`, `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts`, `libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts`

## Validation

- `npm run manifest:generate` — passed; manifest regenerated.
- `npm run manifest:check` — passed.
- `npx nx test shared` — passed: 105 suites, 2,930 tests.
- `npx nx test rpc-handlers` — passed: 144 suites, 4,223 passed, 7 skipped. Nx reported its existing forced worker-exit/flaky-task notice.
- `npx tsc --noEmit -p libs/shared/tsconfig.lib.json` — passed.
- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.lib.json` — passed.
- `npx nx run-many -t lint -p shared,rpc-handlers,chat` — passed.
- `npx tsx tools/degradation-audit/check-degradation.ts` — passed (exit 0; no baseline regression).
- `git diff --check` — passed.

The pre-existing edits under `.ptah/specs/TASK_2026_594_31ff` and `.ptah/specs/TASK_2026_595_1c01` were left untouched.
