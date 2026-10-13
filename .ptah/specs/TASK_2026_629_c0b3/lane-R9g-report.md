# R9g lane report

## Files changed

- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts`: adds opt-in `agentTileMode`; renders one compact tile for agent nodes and forwards mode through message, tool, SendMessage and inline-agent recursion.
- `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts` (new): compact agent row with kind/status icons, name, activity, descendant tool count, duration, descendant pending permission badge and safe lane routing (`sub:`/`bg:`); route action is optional. Permission action rechecks the request id at activation.
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts` and `.html`: input boundary and forwarding to the execution tree; default remains inline.
- `execution-node.ptah-ui.spec.ts`, `subagent-tile.component.spec.ts` (new), `message-bubble.component.spec.ts`: focused regression coverage.

## Named cases and observed results

- Other hosts still inline by default: PASS, `execution-node.ptah-ui.spec.ts`.
- Nested tool and SendMessage agents inherit tile mode: PASS, `execution-node.ptah-ui.spec.ts`.
- Finalize does not replay the tile fade: PASS, `execution-node.ptah-ui.spec.ts`.
- Tile pending permission, stale request guard, and sub/background routing: PASS, `subagent-tile.component.spec.ts`.
- Missing action provider safely disables opening: PASS, `subagent-tile.component.spec.ts`.
- Message bubble forwards opt-in mode: PASS, `message-bubble.component.spec.ts`.
- `node .ptah/tmp/check-run.mjs R9g-1-fix -- npx nx test @ptah-extension/chat --testFile=execution-node.ptah-ui.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 30 passed. Initial run failed 2 tests because the new test setup lacked an `AgentMonitorStore` stub; corrected.
- `node .ptah/tmp/check-run.mjs R9g-2-final -- npx nx test @ptah-extension/chat --testFile=subagent-tile.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 4 passed.
- `node .ptah/tmp/check-run.mjs R9g-3 -- npx nx test @ptah-extension/chat --testFile=message-bubble.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 18 passed.
- Scoped `ptah_get_diagnostics`: no diagnostics in the three changed component files; sibling project errors were reported elsewhere.

## Decisions

- Tile mode defaults to false. The main transcript caller can opt in in R9n; this batch only adds the boundary.
- The tile uses the background-agent strip's `formatAgentElapsed` and its status icon pattern. The formatter is not exported from the chat-ui public barrel, so the component imports its source by relative path within the allowed file scope. A chat-ui barrel export is needed before linting module boundaries; that file is outside this batch's edit scope.
- The compact tile does not render descendants; the selected lane owns the full live execution tree. The permission badge opens that lane after a fresh lookup confirms the request is still pending.

## Not done

- No public-barrel export for `formatAgentElapsed` (outside assigned files).
- No full suite, typecheck, lint, build or e2e, per batch verification rules.
