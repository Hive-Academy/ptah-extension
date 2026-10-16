# @ptah-extension/lane-routing

Host-neutral decision-model lane routing.

This library holds the route-decision tokens, the routing thresholds, and the
structural logger the hosts pass in. It may import only
`@ptah-extension/shared` and `@ptah-extension/platform-core`. It does not
import `@ptah-extension/vscode-core`. `platform-core` has no logger token, so
logging is the local `LaneRoutingLogger` interface (`debug`, `info`, `warn`,
`error`).

| Export | File |
| --- | --- |
| `LANE_ROUTING_TOKENS` | `src/lib/di/tokens.ts` |
| Routing thresholds, budgets, and storage keys | `src/lib/routing-constants.ts` |
| `LaneRoutingLogger` | `src/lib/lane-routing-logger.ts` |
