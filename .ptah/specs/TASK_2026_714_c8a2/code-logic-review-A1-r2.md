# A1 code logic review (r2)

**Score: 10/10 — APPROVED**

The `useFactory: () => null` change is correct. tsyringe's `isValueProvider` checks `provider.useValue != undefined`, so `useValue: null` is not recognized as a value provider; its factory provider check accepts the new registration. Production uses the same null factory for `DevRouteOverride` (`registration.ts:54–56`).

The test binds unpackaged chat with an empty environment, registers a closed parity gate and a resolvable null dev route, then invokes the chat `resolveRuntime` port. The Electron port delegates this unpackaged case to `resolveGatedCodexRuntime`; that resolver sees the closed gate, finds no covering dev route, and throws the exact asserted parity-gate message (`registration.ts:114–122`). This now exercises the intended gate path instead of failing during DI resolution.

The spec diff contains no other added `useValue: null` registration of a resolvable token. Source review only; checks were prohibited by the task.
