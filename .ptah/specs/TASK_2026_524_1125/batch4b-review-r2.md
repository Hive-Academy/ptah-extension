# Batch 4b cross-side review, round 2 — APPROVE

## Round 1 defects

1. **Resolved** — `libs/frontend/core/src/lib/routing/surface-route-persistence.ts:69-88` passes the complete candidate record, under `WEBVIEW_ROUTE_STATE_KEY`, to `parseWebviewRouteState` and writes the parser's accepted object only. A settled `/settings?time=12:30`, `/settings#at:top`, `/chat(aux:help)`, or URL over 2048 characters leaves the last valid record intact. The spec at `surface-route-persistence.spec.ts:167-196` requires `router.navigateByUrl` to resolve `true` before asserting the old record survives. Its `router.resetConfig` includes an `aux` outlet at lines 179-183, so that case can actually settle.

2. **Resolved** — `libs/frontend/core/src/lib/routing/surface-route-persistence.ts:43-46,113-117` checks the seed through the shared parser and substitutes `null` if rejected. The spec at `surface-route-persistence.spec.ts:228-251` covers 65 and 64 character seeds. With a null seed, `resolveBootNavigation` gives any non-null host value precedence (`libs/frontend/core/src/lib/routing/boot-navigation.ts:58-63`), preserving D5's behavior for an unrecordable host deep link.

## Notes

- Validation has the parser's real input shape, including the state key; boot reads the same shape. The one-warning-per-lifetime flag applies only to parser-rejected navigations (`surface-route-persistence.ts:77-84`). A later valid record is still written, and synchronous `setState` failures continue to warn on each failure (`:87-95`), so the flag does not hide those write failures.
- The long URL case explicitly awaits successful navigation at `surface-route-persistence.spec.ts:188`; the auxiliary outlet case is configured at `:179-183` and uses the same success assertion. No tests, lint, typecheck, Nx, or build commands were run, as requested.
