## Backend implementation — `TASK_2026_610`, batch A7

**Tasks completed**: A7.1 baseline fixture; A7.2 host-source registry contract spec.

**Files**:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\rpc\host-source-registry.baseline.ts` — generated, sorted host RPC and push-message registry baselines.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\types\rpc\host-source-registry.contract.spec.ts` — deep-equality contract test with the required Gate 2 exception header.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\.ptah\specs\TASK_2026_610_6a10\batch-A7-report.md` — batch report.

**Baseline generation**: Generated from the supplied current-HEAD baseline `f314a4f8a` with:

```powershell
npx tsx -e "import { writeFileSync } from 'node:fs'; import { RPC_METHOD_NAMES } from './libs/shared/src/lib/types/rpc.types.ts'; import { MESSAGE_TYPES } from './libs/shared/src/lib/types/messages/message-constants.ts'; const rpcMethodNames = [...RPC_METHOD_NAMES].sort(); const messageTypes = Object.values(MESSAGE_TYPES).sort(); const content = ['/** Generated from the f314a4f8a host-source registries. */', '', 'export const BASELINE_RPC_METHOD_NAMES: readonly string[] = ' + JSON.stringify(rpcMethodNames, null, 2) + ';', '', 'export const BASELINE_MESSAGE_TYPES: readonly string[] = ' + JSON.stringify(messageTypes, null, 2) + ';', ''].join(String.fromCharCode(10)); writeFileSync('libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts', content);"
```

Array lengths: 413 RPC method names; 154 message-type values.

**Verification**:

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts` — passed: 1 suite, 2 tests.
- `npx tsc -p libs/shared/tsconfig.lib.json --noEmit` — passed (exit 0).

Jest emitted the existing CommonJS/ES-module config warning for `jest.config.ts`; it did not affect the passing result.

**Plan deviations**: none.

**Out-of-scope observations**: none.
