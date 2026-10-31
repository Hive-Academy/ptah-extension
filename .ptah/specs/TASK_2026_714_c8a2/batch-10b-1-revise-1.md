# Batch 10b-1 revise 1

| Defect | Fix (file:line) | New spec case |
| --- | --- | --- |
| 1. Startup callback return path | `codex-app-server-lane.adapter.ts:238`: make the late-open callback return `void` on every path and handle the close promise inside it. | `closes the opened context once when startup aborts in the open race` |
| 2. Startup abort double close | `codex-app-server-lane.adapter.ts:215`: memoize the context close promise and use it from the abort listener, late-open handler, and startup-abort branch. | `closes the opened context once when startup aborts in the open race` (also checks no pending timers) |
| 3. Idle stream end | `codex-app-server-lane.adapter.ts:305`: treat any unexpected stream end as an error; the existing catch emits an error segment and closes the lane. `:372` rejects a later continuation immediately. | `closes an idle lane when its event stream ends after a completed turn` |
| 4. Refused continuation role delivery | `codex-app-server-lane.adapter.ts:336`: update role delivery only after the continuation turn starts; `:371` refuses closed or active turns before doing so. | `awaits account binding before the prompt and continues on the same context with role resend` (new refused-continuation assertions) |

Verification: no verify, test, lint, typecheck, build, serve, e2e, nx, npm, or diagnostics command was run, per lane rules. CLI skill invocation was unavailable; the available local skill inventory exposed no matching native lane adapter skill.
