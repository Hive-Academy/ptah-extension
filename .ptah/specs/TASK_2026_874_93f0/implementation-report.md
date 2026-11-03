# Implementation report — TASK_2026_874_93f0

## Changed files

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts`: keep in-flight detection across invalidation; a generation counter prevents its stale result from entering the cache; clear only the matching promise.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts`: verify a post-invalidation caller joins the running scan, the next call rescans, and subsequent calls use the new cache. The existing caching test also covers ordinary caching.
- `libs/frontend/chat/src/lib/services/vitals/welcome-vitals.store.ts`: retry failed or discovery-incomplete plan limits on the shared clock when no load is in flight; map `loadError` to the plan ring's error state.
- `libs/frontend/chat/src/lib/services/vitals/welcome-vitals.store.spec.ts`: verify failed and incomplete retries, loading guard, and error ring state.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts`: log and rethrow installed-skills scan failures so the RPC cannot report a false zero.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.spec.ts`: verify the scan failure reaches the RPC caller.

## Caller review

Frontend callers of `skillsSh:listInstalled`: `HostInventoryCache` in chat, `SkillShBrowserComponent` in chat-ui, and `MarketplaceInventoryStore` in marketplace. The cache maps a failed RPC to error and retries. The browser keeps its previous installed badges after a failed result. The marketplace store maps a failed result to its error slice, which the installed page and overview already display. No caller change was needed.

## Decisions

- Kept the ring error mapping local to `WelcomeVitalsStore` because the brief targets the welcome surface and other `toPlanRingLoad` consumers may need their current behavior. Reversible by moving the mapping into the shared view if all consumers should use it.
- Preserved existing frontend caller behavior after RPC rejection. Their result handling already represents an error instead of an empty successful list. Reversible if product copy needs adjustment.

## Verification

- Initial command `npm run verify -- -p @ptah-extension/cli-agent-runtime @ptah-extension/chat @ptah-extension/rpc-handlers` exited 1 during argument parsing: `Unexpected argument '@ptah-extension/chat'` (the script requires a comma-separated project list).
- Scoped command: `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/chat,@ptah-extension/rpc-handlers`. Header: `verify lint,test,typecheck (@ptah-extension/cli-agent-runtime,@ptah-extension/chat,@ptah-extension/rpc-handlers)` — three requested projects. Tail: `Failed to load 3 default Nx plugin(s) ... spawn EPERM`; `Failed to load 3 Nx plugin(s) ... spawn EPERM`; `lock released after 8.2s, exit code 1`. No lint, tests, or typecheck completed.
- `ptah_get_diagnostics` was called after edits and retried; TypeScript checks remained unavailable after 45 seconds, with all three requested files unchecked. The verification status is blocked by the sandbox's process-spawn restriction, so code correctness is not confirmed by automated checks.
- UI rendering was not inspected because the brief forbids build, serve, dev, and e2e runs.

The named `angular-frontend-patterns` skill could not be loaded: this lane exposes no skill-loading tool or skill catalogue. Existing repository signal and effect patterns were followed.
